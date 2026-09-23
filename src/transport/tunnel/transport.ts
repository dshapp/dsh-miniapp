/**
 * 隧道传输：把 Noise 隧道里的 HTTP/1.1 适配成 [RpcTransport]。
 *
 * 这是手机端唯一的传输（对齐 Android 的 ApiClient + NoiseSocketFactory）：连接走
 * TCP + Noise，认证用设备静态密钥，不需要浏览器 cookie。RPC 信封、插件路由、上传、
 * 多路下行与主机契约都和直连时代保持同一套。
 *
 * 连接是懒建且被复用的：平台每 5 分钟只允许建 20 条 TCPSocket，RPC 复用一条
 * keep-alive 连接，多路下行单独占一条（Upgrade 之后连接就归它了）。
 */

import { bool, jget, parseJson, str, type JsonValue } from '../../model/json';
import { utf8ToBytes } from './crypto/bytes';
import { buildClientRequest, encodeClientRequest, unwrapServerResponse, unwrapUploadReceipt } from '../envelope';
import { decodeBinaryResponse, multipartBoundary } from '../multipart';
import { ApiException, type MuxConnection, type MuxEvent, type RemoteEventOutcome, type RpcTransport, type WsConnectionState } from '../types';
import { TunnelHttpClient, responseText } from './http';
import { TunnelMux, MOBILE_HOST } from './mux';
import { createRandomSource } from './random';
import { dialTunnel, type TunnelStream } from './stream';
import type { SocketFactory } from './socket';
import { WeappWssSocketFactory } from './wsSocket';
import type { KeyPair } from './noise';

const DIAL_TIMEOUT_MS = 15_000;
/** 只读 RPC 遇到隧道解帧失败时的重试次数（写入方法不重试）。 */
const RETRY_ATTEMPTS = 5;

/**
 * 只读方法清单：重试它们不会产生副作用。
 *
 * 开发者工具（模拟器）会随机损坏 TCP 帧，所以这里要能自愈；真机不受影响，
 * 这几条重试也只是让偶发断链更稳，不会把任何写操作执行两次。
 */
const READ_ONLY_METHODS = new Set<string>([
  'session/list',
  'session/search',
  'session/page',
  'session/modelCatalog',
  'session/attachment',
  'workspaceFiles/read',
  'workspaceFiles/readBytes',
  'commands/list',
  'permissionPresets/catalog',
  'skills/list',
  'fileReferences/list',
  'sessionReferenceResolver/candidates',
  'agentPresets/list',
  // 0.1.7：子代理目录改读 session/projections（subagents/list 已删除）。
  'session/projections',
]);

/** 解帧/解密失败这类瞬时隧道错误可以换一条连接重试；业务错误不能。 */
function isTransientTunnel(error: unknown): boolean {
  if (error instanceof ApiException) return false;
  const message = error instanceof Error ? error.message : String(error);
  // 配额用尽是平台限制，立刻重试只会继续失败并更快耗尽配额；交给上层等下一次触发。
  if (/quota|created too much/i.test(message)) return false;
  return /authentication failed|connection closed|tcp |decrypt|frame|transport/i.test(message);
}

export interface TunnelTransportOptions {
  host: string;
  port: number;
  bridgeKey: Uint8Array;
  deviceKey: KeyPair;
  /** 首次配对的一次性码；已配对时可省。 */
  pairingToken?: Uint8Array;
  /** 便于联调注入；默认走小程序 TCP。 */
  factory?: SocketFactory;
  /** 读本地文件为字节；默认走 `wx.getFileSystemManager`，联调时可注入。 */
  readFile?: (path: string) => Promise<Uint8Array>;
}

export class TunnelTransport implements RpcTransport {
  readonly kind = 'relay' as const;
  readonly baseUrl: string;
  private readonly factory: SocketFactory;
  private readonly readFile: (path: string) => Promise<Uint8Array>;
  private channel: Promise<{ stream: TunnelStream; http: TunnelHttpClient }> | undefined;
  /**
   * 一次性配对码：只随第一条连接的握手发一次，用掉即弃
   * （对齐 Android `MobileTarget.consumePairingToken` 的 `getAndSet(null)`）。
   *
   * RPC 通道与多路下行共用这一份，所以两条连接里只有先握手的那条带着它；
   * 每次拨号、每次 mux 重连都重发同一个一次性码，等于把它变成长期凭据。
   */
  private pairingToken: Uint8Array | undefined;

  constructor(private readonly options: TunnelTransportOptions) {
    this.factory = options.factory ?? new WeappWssSocketFactory();
    this.readFile = options.readFile ?? readLocalFile;
    this.baseUrl = 'http://' + options.host + ':' + options.port;
    this.pairingToken = options.pairingToken;
  }

  /** 取走一次性配对码；之后的每一次握手都不再带它。 */
  private consumePairingToken(): Uint8Array | undefined {
    const token = this.pairingToken;
    this.pairingToken = undefined;
    return token;
  }

  /** 当前是否已建立隧道（设置页用它显示状态）。 */
  get connected(): boolean {
    return this.channel !== undefined;
  }

  async call(method: string, args: JsonValue = {}): Promise<JsonValue> {
    const request = buildClientRequest(method, args);
    const body = utf8ToBytes(encodeClientRequest(request));
    // 只读方法可以安全重试；写方法绝不能，否则可能被应用两次。
    const attempts = READ_ONLY_METHODS.has(method) ? RETRY_ATTEMPTS : 1;
    for (let attempt = 1; ; attempt += 1) {
      let response;
      try {
        // 拨号（TCP + Noise 握手）也要在重试范围内：模拟器可能在握手阶段的响应里就损坏
        // 字节，只重试 HTTP 请求会漏掉这种情况。
        const http = await this.client();
        response = await http.request({
          method: 'POST',
          path: '/api/' + method,
          headers: { 'content-type': 'application/json' },
          body,
        });
      } catch (error) {
        this.invalidate();
        // 模拟器（开发者工具）会随机损坏 TCP 字节流，换一条连接重试通常就好；
        // 真机没有这个缺陷，重试只会在真实的临时断链上兜一次底。
        if (attempt < attempts && isTransientTunnel(error)) continue;
        throw transportError(error);
      }
      if (response.status !== 200) {
        const text = responseText(response);
        throw new ApiException({ code: 'http', message: text.trim() || 'HTTP ' + response.status });
      }
      // 0.1.7：带原生字节的结果（readBytes）以 multipart/form-data 应答，先还原成 JSON 信封。
      const boundary = multipartBoundary(response.headers.get('content-type'));
      let text: string;
      try {
        text = boundary === undefined ? responseText(response) : decodeBinaryResponse(response.body, boundary);
      } catch (error) {
        throw transportError(error);
      }
      return unwrapServerResponse(text, request.rpcId);
    }
  }

  async getJson(path: string, query: Array<[string, string]> = []): Promise<JsonValue | undefined> {
    const suffix = query.map(([name, value]) => encodeURIComponent(name) + '=' + encodeURIComponent(value)).join('&');
    const target = '/' + path.replace(/^\/+/, '') + (suffix.length > 0 ? '?' + suffix : '');
    for (let attempt = 1; ; attempt += 1) {
      let response;
      try {
        const http = await this.client();
        response = await http.request({ method: 'GET', path: target });
      } catch (error) {
        this.invalidate();
        if (attempt < RETRY_ATTEMPTS && isTransientTunnel(error)) continue;
        throw transportError(error);
      }
      // 404 是「记录已经没了」，按正常结果处理（与 Android ApiClient.getJson 同义）。
      if (response.status === 404) return undefined;
      const text = responseText(response);
      if (response.status !== 200) {
        throw new ApiException({ code: 'http', message: text.trim() || 'HTTP ' + response.status });
      }
      return parseJson(text);
    }
  }

  /**
   * 上传一个附件。
   *
   * 请求体是**裸字节**，`content-type: application/octet-stream`（对齐 Android
   * `ApiClient.uploadFile` 的 `file.asRequestBody("application/octet-stream")`）：
   * `/api/session/uploadFileBinary` 只接受这一种，文件名与会话都只从查询串取。
   * 以前这里拼的是 multipart/form-data，主机直接 415，附件永远上传不上去。
   */
  async uploadFile(sessionId: string, filePath: string, name: string): Promise<string> {
    const body = await this.readFile(filePath);
    const query = '?sessionId=' + encodeURIComponent(sessionId) + '&name=' + encodeURIComponent(name);

    const http = await this.client();
    let response;
    try {
      response = await http.request({
        method: 'POST',
        path: '/api/session/uploadFileBinary' + query,
        headers: { 'content-type': 'application/octet-stream' },
        body,
      });
    } catch (error) {
      this.invalidate();
      throw transportError(error);
    }
    const text = responseText(response);
    if (response.status !== 200) {
      throw new ApiException({ code: 'http', message: text || 'HTTP ' + response.status });
    }
    return unwrapUploadReceipt(text);
  }

  async settleRemoteEvent(clientId: string, eventId: string, outcome: RemoteEventOutcome): Promise<boolean> {
    const outcomeJson: JsonValue =
      outcome.kind === 'result'
        ? { kind: 'result', ...(outcome.value === undefined ? {} : { value: outcome.value }) }
        : outcome.kind === 'next'
          ? { kind: 'next' }
          : { kind: 'rejected', error: { name: outcome.name, message: outcome.message } };
    try {
      await this.call('$events/result', { clientId, eventId, outcome: outcomeJson });
      return true;
    } catch {
      return false;
    }
  }

  openMux(onEvent: (event: MuxEvent) => void, onState?: (state: WsConnectionState) => void): MuxConnection {
    return new TunnelMux(
      {
        host: this.options.host,
        port: this.options.port,
        bridgeKey: this.options.bridgeKey,
        deviceKey: this.options.deviceKey,
        // 用掉即弃：RPC 通道先握手时这里就是 undefined。
        pairingToken: this.consumePairingToken(),
        factory: this.factory,
      },
      onEvent,
      onState,
    );
  }

  /** 关掉 RPC 通道；多路下行由持有者各自关闭。 */
  close(): void {
    const pending = this.channel;
    this.channel = undefined;
    void pending?.then(({ stream }) => stream.close()).catch(() => undefined);
  }

  private client(): Promise<TunnelHttpClient> {
    if (this.channel === undefined) this.channel = this.dial();
    return this.channel.then(({ http }) => http);
  }

  /** 连接失败后丢弃这条通道，下一次请求重新拨号。 */
  private invalidate(): void {
    const pending = this.channel;
    this.channel = undefined;
    void pending?.then(({ stream }) => stream.close()).catch(() => undefined);
  }

  private async dial(): Promise<{ stream: TunnelStream; http: TunnelHttpClient }> {
    const random = await createRandomSource();
    const stream = await dialTunnel({
      factory: this.factory,
      address: this.options.host,
      port: this.options.port,
      bridgeKey: this.options.bridgeKey,
      deviceKey: this.options.deviceKey,
      pairingToken: this.consumePairingToken(),
      random,
      connectTimeoutMs: DIAL_TIMEOUT_MS,
    });
    return { stream, http: new TunnelHttpClient(stream, MOBILE_HOST) };
  }
}

function transportError(error: unknown): ApiException {
  if (error instanceof ApiException) return error;
  return new ApiException({ code: 'transport', message: error instanceof Error ? error.message : 'tunnel failed' });
}

/** 读本地文件为字节；附件上传在隧道里必须自己读原始字节。 */
async function readLocalFile(path: string): Promise<Uint8Array> {
  const holder = globalThis as unknown as { wx?: { getFileSystemManager?: () => { readFileSync(p: string): ArrayBuffer | string } } };
  const manager = holder.wx?.getFileSystemManager?.();
  if (manager === undefined) throw new Error('file system unavailable');
  const data = manager.readFileSync(path);
  if (typeof data === 'string') return utf8ToBytes(data);
  return new Uint8Array(data);
}

export { bool, jget, str };

import type { JsonValue } from '../model/json';

/** 手机端只有一条传输：连到已配对 Mac 的 TCP + Noise 加密隧道（对齐 Android ApiClient）。 */
export type TransportKind = 'relay';

export interface RpcError { code: string; message: string; details?: JsonValue }

/** 业务失败与传输失败统一成这个异常。 */
export class ApiException extends Error {
  readonly code: string;
  readonly detail: string;

  constructor(error: RpcError) {
    super(`${error.code}: ${error.message}`);
    this.name = 'ApiException';
    this.code = error.code;
    this.detail = error.message;
  }
}

export function internalError(message: string): ApiException {
  return new ApiException({ code: 'internal', message });
}

export type RemoteEventOutcome =
  | { kind: 'result'; value?: JsonValue }
  | { kind: 'next' }
  /** 让请求失败；`code` 随错误一起送到提问方（如限时提问的 `ASK_TIMED_OUT`）。 */
  | { kind: 'rejected'; name: string; message: string; code?: string };

export type WsConnectionState = 'connected' | 'reconnecting';

export type MuxEvent =
  | { kind: 'item'; streamId: string; value: JsonValue }
  | { kind: 'failure'; streamId: string; error: RpcError }
  | { kind: 'end'; streamId: string }
  | { kind: 'opened' };

export interface MuxConnection {
  subscribe(streamId: string, endpoint: string, args?: JsonValue): void;
  unsubscribe(streamId: string): void;
  isSubscribed(streamId: string): boolean;
  /** 回到前台时探活当前这一代连接。 */
  probeNow(): void;
  close(): void;
}

export interface RpcTransport {
  readonly kind: TransportKind;
  readonly baseUrl: string;
  call(method: string, args?: JsonValue): Promise<JsonValue>;
  /**
   * GET 一条插件路由，返回裸 JSON。
   *
   * 与 call 的 POST RPC 不同：这类路由不是 Remote 方法，主机直接以裸 JSON 应答，
   * 记录随会话销毁而消失时用 404 表达「没有可显示的东西」——是正常结果而非错误，
   * 所以返回 undefined 让调用方不画卡片，其余非 2xx 才抛。与 Android ApiClient.getJson 同义。
   */
  getJson(path: string, query?: Array<[string, string]>): Promise<JsonValue | undefined>;
  uploadFile(sessionId: string, filePath: string, name: string): Promise<string>;
  settleRemoteEvent(clientId: string, eventId: string, outcome: RemoteEventOutcome): Promise<boolean>;
  openMux(onEvent: (event: MuxEvent) => void, onState?: (state: WsConnectionState) => void): MuxConnection;
  /**
   * 释放底层长连接（隧道会关掉那条 TCPSocket）。
   *
   * 平台每 5 分钟只给 20 条 TCPSocket，teardown 时只把引用置空会让 socket 一直占着
   * 配额，所以换连接时必须显式关闭。
   */
  close?(): void;
}

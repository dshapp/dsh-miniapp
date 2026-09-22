/**
 * 隧道内的 HTTP/1.1 客户端。
 *
 * 桥接把解密后的流直接交给 `node:http`，所以隧道里就是明文 HTTP/1.1——但这里不能再用
 * `wx.request`（它只会走小程序的网络栈），必须自己拼请求、自己解响应：
 * 状态行、头部、Content-Length 与 chunked 两种长度、keep-alive 复用。
 *
 * 请求在同一连接上串行化：Node 的 HTTP/1.1 服务端可以流水线，但响应顺序不保证，
 * 而代价只有一次 Promise 链。
 */

import { bytesToUtf8, concat, utf8ToBytes } from './crypto/bytes';
import type { TunnelStream } from './stream';

export interface HttpResponse {
  status: number;
  headers: Map<string, string>;
  body: Uint8Array;
}

export interface HttpRequestOptions {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: Uint8Array;
}

/**
 * 单次请求的读超时（对齐 Android OkHttp 的 60s readTimeout）。
 *
 * 请求在这条连接上串行化：一次响应丢了（对端进程被挂起、隧道半死不活）之后，
 * 没有超时的话那个 await 会永远挂着，后面每一条 RPC 都排在它后面——整条通道就此哑掉，
 * 而界面上只表现为"一直转圈"。超时让这一代连接失败，上层拨号重来。
 */
const REQUEST_TIMEOUT_MS = 60_000;

/** 隧道内的 HTTP/1.1 长连接。 */
export class TunnelHttpClient {
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly stream: TunnelStream,
    private readonly host: string,
  ) {}

  request(options: HttpRequestOptions): Promise<HttpResponse> {
    const run = this.tail.then(
      () => this.performWithTimeout(options),
      () => this.performWithTimeout(options),
    );
    // 让后续请求等待本次完成，但不把失败传染给链本身。
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async performWithTimeout(options: HttpRequestOptions): Promise<HttpResponse> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('tunnel http timeout')), REQUEST_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.perform(options), timeout]);
    } catch (error) {
      // 超时说明这条连接已经不可信（半条响应还留在流里），不能再拿它发下一个请求：
      // 关掉让调用方重新拨号，而不是把后面的请求继续喂给一条错位的流。
      this.closed = true;
      this.stream.close();
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** GET 一条路由；状态码交给调用方判断。 */
  async getText(path: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return await this.request({ method: 'GET', path, headers });
  }

  private async perform(options: HttpRequestOptions): Promise<HttpResponse> {
    if (this.closed) throw new Error('tunnel http client is closed');
    const body = options.body ?? new Uint8Array(0);
    const headers: Record<string, string> = {
      host: this.host,
      connection: 'keep-alive',
      ...options.headers,
    };
    if (body.length > 0 && headers['content-length'] === undefined) {
      headers['content-length'] = String(body.length);
    }

    const lines = [options.method + ' ' + options.path + ' HTTP/1.1'];
    for (const name of Object.keys(headers)) lines.push(name + ': ' + headers[name]);
    this.stream.write(concat(utf8ToBytes(lines.join('\r\n') + '\r\n\r\n'), body));

    const response = await this.readResponse(options.method);
    if (response.headers.get('connection') === 'close') this.closed = true;
    return response;
  }

  private async readResponse(method: string): Promise<HttpResponse> {
    const statusLine = await this.stream.readLine();
    const status = parseStatus(statusLine);
    const headers = new Map<string, string>();
    for (;;) {
      const line = await this.stream.readLine();
      if (line.length === 0) break;
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }

    const body = await this.readBody(method, status, headers);
    return { status, headers, body };
  }

  private async readBody(method: string, status: number, headers: Map<string, string>): Promise<Uint8Array> {
    if (method === 'HEAD' || status === 204 || status === 304) return new Uint8Array(0);
    const transferEncoding = headers.get('transfer-encoding');
    if (transferEncoding !== undefined && transferEncoding.toLowerCase().includes('chunked')) {
      return await this.readChunked();
    }
    const contentLength = headers.get('content-length');
    if (contentLength !== undefined) {
      const length = Number.parseInt(contentLength, 10);
      if (Number.isFinite(length) && length > 0) return await this.stream.readExactly(length);
      return new Uint8Array(0);
    }
    // 既没有长度也没有分块：读到连接关闭为止。
    const chunks: Uint8Array[] = [];
    for (;;) {
      try {
        chunks.push(await this.stream.readExactly(1));
      } catch {
        break;
      }
    }
    return concat(...chunks);
  }

  private async readChunked(): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    for (;;) {
      const sizeLine = await this.stream.readLine();
      const size = Number.parseInt(sizeLine.split(';')[0].trim(), 16);
      if (!Number.isFinite(size) || size <= 0) {
        await this.stream.readLine();
        break;
      }
      chunks.push(await this.stream.readExactly(size));
      await this.stream.readLine();
    }
    return concat(...chunks);
  }
}

function parseStatus(statusLine: string): number {
  const match = /^HTTP\/1\.[01]\s+(\d{3})/.exec(statusLine);
  if (match === null) throw new Error('bad HTTP status line: ' + statusLine);
  return Number.parseInt(match[1], 10);
}

export function responseText(response: HttpResponse): string {
  return bytesToUtf8(response.body);
}

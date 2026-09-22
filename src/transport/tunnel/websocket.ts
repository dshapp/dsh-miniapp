/**
 * 隧道内的 WebSocket 客户端（RFC 6455）。
 *
 * 多路下行 `/api/remote.mux` 是一次 `Upgrade`，升级之后同一条 TCP 连接只跑 WS 帧，
 * 所以它必须独占一条隧道连接，不能与 RPC 的 keep-alive 复用。
 * 这里自己完成握手（含 `Sec-WebSocket-Accept` 校验）与收发帧、分片重组、ping/pong。
 */

import { bytesToUtf8, concat, toBase64, u16be, u32be, utf8ToBytes } from './crypto/bytes';
import { sha1 } from './crypto/sha';
import type { TunnelStream } from './stream';

/** RFC 6455 规定的握手 GUID。 */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

export interface WebSocketHandlers {
  onText(text: string): void;
  onClose(reason?: Error): void;
}

/** 升级成 WebSocket 的隧道连接。 */
export class TunnelWebSocket {
  private closed = false;
  private fragments: Uint8Array[] = [];

  private constructor(
    private readonly stream: TunnelStream,
    private readonly handlers: WebSocketHandlers,
    private readonly random: (length: number) => Uint8Array,
  ) {
    void this.pump();
  }

  /**
   * 在一条隧道流上对 `path` 发起 WebSocket 升级；这条流之后归 WebSocket 独占。
   */
  static async connect(options: {
    stream: TunnelStream;
    path: string;
    host: string;
    handlers: WebSocketHandlers;
    random: (length: number) => Uint8Array;
  }): Promise<TunnelWebSocket> {
    const { stream, path, host, handlers, random } = options;
    const key = toBase64(random(16));
    const accept = toBase64(sha1(utf8ToBytes(key + GUID)));
    const request = [
      'GET ' + path + ' HTTP/1.1',
      'Host: ' + host,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: ' + key,
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n');
    stream.write(utf8ToBytes(request));

    const statusLine = await stream.readLine();
    if (!/^HTTP\/1\.[01]\s+101/.test(statusLine)) {
      throw new Error('websocket upgrade refused: ' + statusLine);
    }
    let acceptHeader = '';
    for (;;) {
      const line = await stream.readLine();
      if (line.length === 0) break;
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      if (line.slice(0, colon).trim().toLowerCase() === 'sec-websocket-accept') {
        acceptHeader = line.slice(colon + 1).trim();
      }
    }
    if (acceptHeader !== accept) throw new Error('websocket accept mismatch');
    return new TunnelWebSocket(stream, handlers, random);
  }

  /**
   * 发一条文本帧（客户端帧必须掩码）。
   *
   * 返回是否真的递出去了（对齐 Android `WebSocket.send` 的布尔返回）：探活帧发不出去
   * 时调用方要主动废掉这一代连接，否则会一直对着一条死 socket 等下行。
   */
  sendText(text: string): boolean {
    if (this.closed) return false;
    try {
      this.stream.write(encodeFrame(OPCODE_TEXT, utf8ToBytes(text), this.random(4)));
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.stream.write(encodeFrame(OPCODE_CLOSE, new Uint8Array(0), this.random(4)));
    } catch {
      // 对端已断开：关闭帧发不出去是正常情况。
    }
    this.stream.close();
  }

  private emitClose(reason?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.handlers.onClose(reason);
  }

  /** 后台泵：逐帧读取并分发。 */
  private async pump(): Promise<void> {
    try {
      for (;;) {
        const header = await this.stream.readExactly(2);
        const fin = (header[0] & 0x80) !== 0;
        const opcode = header[0] & 0x0f;
        const masked = (header[1] & 0x80) !== 0;
        let length = header[1] & 0x7f;
        if (length === 126) {
          const extended = await this.stream.readExactly(2);
          length = (extended[0] << 8) | extended[1];
        } else if (length === 127) {
          const extended = await this.stream.readExactly(8);
          // 超过 2^53 的帧在本协议里不可能出现，只取低 32 位。
          length = ((extended[4] << 24) | (extended[5] << 16) | (extended[6] << 8) | extended[7]) >>> 0;
        }
        const mask = masked ? await this.stream.readExactly(4) : undefined;
        let payload = length > 0 ? await this.stream.readExactly(length) : new Uint8Array(0);
        if (mask !== undefined) {
          const unmasked = new Uint8Array(payload.length);
          for (let i = 0; i < payload.length; i += 1) unmasked[i] = payload[i] ^ mask[i & 3];
          payload = unmasked;
        }

        if (opcode === OPCODE_PING) {
          this.stream.write(encodeFrame(OPCODE_PONG, payload, this.random(4)));
          continue;
        }
        if (opcode === OPCODE_PONG) continue;
        if (opcode === OPCODE_CLOSE) {
          this.emitClose();
          this.stream.close();
          return;
        }
        if (opcode === OPCODE_CONTINUATION) {
          this.fragments.push(payload);
          if (fin) this.deliver();
          continue;
        }
        if (opcode === OPCODE_TEXT || opcode === OPCODE_BINARY) {
          this.fragments = [payload];
          if (fin) this.deliver();
        }
      }
    } catch (error) {
      this.emitClose(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private deliver(): void {
    const merged = concat(...this.fragments);
    this.fragments = [];
    this.handlers.onText(bytesToUtf8(merged));
  }
}

/** 组一个带掩码的客户端帧；掩码由调用方的安全随机源给出。 */
export function encodeFrame(opcode: number, payload: Uint8Array, mask: Uint8Array): Uint8Array {
  const fin = 0x80 | opcode;
  const masked = new Uint8Array(payload.length);
  for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i] ^ mask[i & 3];
  const length = payload.length;
  const header =
    length < 126
      ? new Uint8Array([fin, 0x80 | length])
      : length < 65536
        ? concat(new Uint8Array([fin, 0x80 | 126]), u16be(length))
        : concat(new Uint8Array([fin, 0x80 | 127]), u32be(0), u32be(length));
  return concat(header, mask, masked);
}

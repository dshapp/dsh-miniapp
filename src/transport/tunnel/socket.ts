/**
 * TCP 字节通道，以及 [wx.createTCPSocket] 的实现。
 *
 * 抽成 [SocketFactory] 是为了让整条隧道（Noise + HTTP/1.1 + WebSocket）能在 Node 下
 * 用同一份代码跑联调：小程序侧用 [WeappSocketFactory]，联调侧注入一个 net.Socket 版本。
 *
 * 平台限制（官方文档）：禁止连接 1024 以下的端口，只允许同局域网的非本机 IP 或已配置的
 * 服务器域名，每 5 分钟最多建立 20 条连接——所以隧道必须复用长连接，而不是一请求一连。
 *
 * 已核实的坑：开发者工具（模拟器）36.6.0 的 wx.createTCPSocket 在服务端「零间隔、
 * 小分片」连发时会损坏字节流。用与实际位置绑定的校验（不依赖回调切分方式）实测：
 * 同一台服务器、同一段 20 万字节的定向数据，Node net.Socket 三次都 firstBad=-1，而
 * 模拟器会出现 firstBad 落在分片边界（如 7240=5×1448）甚至少收 176 字节。字节流一旦
 * 被改，Noise 的 AEAD 校验必然失败，HTTP/1.1 的帧边界也随之错位，表现就是大响应随机
 * 倒在 chacha20poly1305: authentication failed。真机走原生 TCP 栈没有这个问题。
 * 判定脚本：scripts/verify-tunnel-tcp-order.mjs；只读 RPC 的兜底重试见 transport.ts。
 */

import { ByteQueue } from './queue';
import { utf8ToBytes } from './crypto/bytes';

/** 已连接、可写、可关闭的字节通道。 */
export interface SocketLike {
  write(bytes: Uint8Array): void;
  close(): void;
}

export interface SocketHandlers {
  onData(chunk: Uint8Array): void;
  onClose(reason?: Error): void;
}

export interface SocketFactory {
  connect(address: string, port: number, timeoutMs: number, handlers: SocketHandlers): Promise<SocketLike>;
}

/** 恰好覆盖 [bytes] 的 ArrayBuffer：不能把视图的整个 backing buffer 递过去。 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.length);
  new Uint8Array(out).set(bytes);
  return out;
}

function toBytes(message: ArrayBuffer | string | undefined): Uint8Array {
  if (message === undefined) return new Uint8Array(0);
  if (typeof message === 'string') return utf8ToBytes(message);
  // 复制一份再入队：平台可能复用同一个 ArrayBuffer，只存视图会让已入队的字节被后续
  // 回调覆盖（分片到达时就会破坏帧内容）。
  return new Uint8Array(message).slice();
}

function errorText(err: unknown): string {
  if (err === null || typeof err !== 'object') return String(err);
  const record = err as { errMsg?: string; errCode?: number; message?: string };
  if (record.errMsg !== undefined) return record.errMsg;
  // MiniProgramError（如配额用尽的 "[TCPSocket] created too much."）带的是
  // message，直接 JSON.stringify(Error) 只会得到 "{}"，关键字就丢了。
  if (typeof record.message === 'string' && record.message.length > 0) return record.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

interface WeappTcpSocket {
  connect(options: { address: string; port: number; timeout?: number }): void;
  write(data: ArrayBuffer): void;
  close(): void;
  onConnect(listener: () => void): void;
  onMessage(listener: (res: { message: ArrayBuffer | string }) => void): void;
  onError(listener: (err: unknown) => void): void;
  onClose(listener: () => void): void;
}

/** 小程序侧：把 `wx.createTCPSocket` 适配成 [SocketFactory]。 */
export class WeappSocketFactory implements SocketFactory {
  connect(address: string, port: number, timeoutMs: number, handlers: SocketHandlers): Promise<SocketLike> {
    const holder = globalThis as unknown as { wx?: { createTCPSocket?: () => WeappTcpSocket } };
    if (holder.wx === undefined || typeof holder.wx.createTCPSocket !== 'function') {
      return Promise.reject(new Error('wx.createTCPSocket unavailable (needs base library 2.18.0+)'));
    }
    // 配额用尽（平台限制：每 5 分钟 20 条）时平台既可能返回 undefined，也可能
    // 直接抛 MiniProgramError: [TCPSocket] created too much.，两种都要给出可读且
    // 明确「不可立刻重试」的错误，否则会被当成普通瞬时故障、越重试越快耗尽配额。
    let socket: WeappTcpSocket;
    try {
      socket = holder.wx.createTCPSocket();
    } catch (error) {
      return Promise.reject(new Error('tcp quota exhausted (20 connections / 5 min): ' + errorText(error)));
    }
    if (socket === undefined || socket === null) {
      return Promise.reject(new Error('tcp quota exhausted (20 connections / 5 min)'));
    }
    return new Promise<SocketLike>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          socket.close();
        } catch {
          // 已超时，关闭失败无需上报。
        }
        reject(new Error('tcp connect timeout'));
      }, timeoutMs);
      socket.onConnect(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          write: (bytes) => socket.write(toArrayBuffer(bytes)),
          close: () => {
            try {
              socket.close();
            } catch {
              // 关闭一个已断开的 socket 不构成错误。
            }
          },
        });
      });
      socket.onMessage((res) => {
        handlers.onData(toBytes(res.message));
      });
      socket.onError((err) => {
        const failure = new Error('tcp error: ' + errorText(err));
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(failure);
          return;
        }
        handlers.onClose(failure);
      });
      socket.onClose(() => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(new Error('tcp closed before connect'));
          return;
        }
        handlers.onClose();
      });
      socket.connect({ address, port, timeout: timeoutMs });
    });
  }
}

/** 原始字节流：把 socket 的 chunk 接进队列，并可写。 */
export class BufferedStream {
  constructor(
    readonly socket: SocketLike,
    readonly queue: ByteQueue = new ByteQueue(),
  ) {}

  write(bytes: Uint8Array): void {
    this.socket.write(bytes);
  }

  close(): void {
    this.queue.end();
    this.socket.close();
  }
}

/** 连接一个原始 TCP 通道。 */
export async function openSocket(
  factory: SocketFactory,
  address: string,
  port: number,
  timeoutMs: number,
): Promise<BufferedStream> {
  const queue = new ByteQueue();
  const socket = await factory.connect(address, port, timeoutMs, {
    onData: (chunk) => queue.push(chunk),
    onClose: (reason) => queue.end(reason),
  });
  return new BufferedStream(socket, queue);
}

export { ByteQueue };

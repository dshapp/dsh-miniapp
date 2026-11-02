/**
 * WSS 字节通道：用 [wx.connectSocket] 承载隧道。
 *
 * 和 [WeappSocketFactory] 实现同一个 [SocketFactory] 接口，所以它上面的整条隧道
 * —— Noise_IK、mux、HTTP/1.1、以及隧道内的 WebSocket —— 一行都不用改。变的只是
 * 字节由谁搬运：从裸 TCP 换成 wss://<host>/tunnel。
 *
 * 为什么要换：小程序的 TCPSocket 有硬配额（每 5 分钟 20 条）、要求目标端口 >1024，
 * 而且开发者工具会损坏字节流；WSS 没有这些限制，只要域名在 socket 合法域名里。
 *
 * 端到端加密没有变弱：帧里装的仍然是设备与 Mac 之间的 Noise_IK 会话，公网 proxy
 * 只拆 WebSocket 帧、转发字节，看不懂里面任何一个字节。
 *
 * 平台约束（已按文档处理）：
 * - `send` 必须在 `onOpen` 之后才被接受，所以握手完成前的写入先排队。
 * - 消息可能以 string 或 ArrayBuffer 到达；我们只发二进制，但收端两种都兜住。
 * - 平台可能复用同一个 ArrayBuffer，所以入队前必须复制，否则后续回调会覆盖已收字节。
 */

import { utf8ToBytes } from './crypto/bytes';
import { toArrayBuffer, type SocketFactory, type SocketHandlers, type SocketLike } from './socket';

/** 隧道在 proxy 上的路径；升级之后这条连接只跑隧道字节。 */
const TUNNEL_PATH = '/tunnel';

interface WeappSocketTask {
  send(options: { data: ArrayBuffer | string; fail?: (err: unknown) => void }): void;
  close(options?: { code?: number; reason?: string }): void;
  onOpen(listener: () => void): void;
  onMessage(listener: (result: { data: ArrayBuffer | string }) => void): void;
  onClose(listener: () => void): void;
  onError(listener: (err: unknown) => void): void;
}

interface WeappWss {
  connectSocket(options: {
    url: string;
    header?: Record<string, string>;
    timeout?: number;
  }): WeappSocketTask;
}

function errorText(err: unknown): string {
  if (err === null || typeof err !== 'object') return String(err);
  const record = err as { errMsg?: string; message?: string };
  if (typeof record.errMsg === 'string') return record.errMsg;
  if (typeof record.message === 'string' && record.message.length > 0) return record.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** 平台可能复用 ArrayBuffer，收到就复制一份。 */
function toBytes(message: ArrayBuffer | string): Uint8Array {
  if (typeof message === 'string') return utf8ToBytes(message);
  return new Uint8Array(message).slice();
}

/**
 * 由 address/port 拼出隧道地址。
 *
 * 443 不写端口：小程序的 socket 合法域名是按域名配的，带上默认端口反而容易配错。
 */
export function tunnelUrl(address: string, port: number): string {
  const host = port === 443 ? address : address + ':' + String(port);
  return 'wss://' + host + TUNNEL_PATH;
}

/** 用 wx.connectSocket 实现的字节通道。 */
export class WeappWssSocketFactory implements SocketFactory {
  connect(
    address: string,
    port: number,
    timeoutMs: number,
    handlers: SocketHandlers,
  ): Promise<SocketLike> {
    const platform = (globalThis as unknown as { wx?: WeappWss }).wx;
    if (platform === undefined || typeof platform.connectSocket !== 'function') {
      return Promise.reject(new Error('wss: 当前环境没有 wx.connectSocket'));
    }
    return new Promise<SocketLike>((resolve, reject) => {
      let settled = false;
      let open = false;
      let closed = false;
      // onOpen 之前的写入先排队：平台会直接拒收，而调用方的 write 是同步的。
      const queued: Uint8Array[] = [];

      const task = platform.connectSocket({
        url: tunnelUrl(address, port),
        timeout: timeoutMs,
      });

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        closed = true;
        try {
          task.close();
        } catch {
          // 连接还没建立时 close 会抛，忽略即可。
        }
        reject(new Error('wss: 连接超时'));
      }, timeoutMs);

      const fail = (err: unknown): void => {
        const error = new Error('wss: ' + errorText(err));
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
          return;
        }
        if (closed) return;
        closed = true;
        handlers.onClose(error);
      };

      const socket: SocketLike = {
        write(bytes: Uint8Array): void {
          if (closed) return;
          if (!open) {
            queued.push(bytes.slice());
            return;
          }
          task.send({ data: toArrayBuffer(bytes), fail });
        },
        close(): void {
          if (closed) return;
          closed = true;
          try {
            task.close();
          } catch {
            // 已经断开，没什么可做的。
          }
        },
      };

      task.onOpen(() => {
        open = true;
        for (const pending of queued.splice(0)) {
          task.send({ data: toArrayBuffer(pending), fail });
        }
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(socket);
      });

      task.onMessage((result) => {
        handlers.onData(toBytes(result.data));
      });

      task.onClose(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('wss: 连接在建立前被关闭'));
          return;
        }
        if (closed) return;
        closed = true;
        handlers.onClose();
      });

      task.onError(fail);
    });
  }
}

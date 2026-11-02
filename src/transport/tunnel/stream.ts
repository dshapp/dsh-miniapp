/**
 * 隧道流：Noise 传输层之上的明文字节流。
 *
 * 帧格式照 PROTOCOL.md：每条 Noise 消息（握手与传输都是）前面加 `[u16 BE len]`，
 * 明文上限 65519（封包后 65535，正好占满 u16）。写入时按上限切分，
 * 读取时后台泵循环把帧解出来投进明文队列，上层看到的就是一条普通字节流。
 */

import { readU16be, u16be, concat } from './crypto/bytes';
import { BufferedStream, openSocket, type SocketFactory } from './socket';
import { ByteQueue } from './queue';
import { InitiatorHandshake, type KeyPair, type NoiseTransport } from './noise';
/** 一条 Noise 帧能装的最大明文。 */
export const MAX_NOISE_PLAINTEXT = 65519;
/** 前导：magic(4) + ver(1) + bridgeKey(32)。 */
export const PREAMBLE_LENGTH = 37;
/** 协议版本。 */
const VERSION = 1;

/** 把一条消息按隧道帧写出去。 */
export function writeFrame(socket: { write(bytes: Uint8Array): void }, body: Uint8Array): void {
  socket.write(concat(u16be(body.length), body));
}

/** 从原始队列读一条隧道帧。 */
async function readFrame(queue: ByteQueue): Promise<Uint8Array> {
  const head = await queue.readExactly(2);
  const length = readU16be(head, 0);
  return await queue.readExactly(length);
}

/** 前导字节：与 Android 的 `MobileTunnel` 一致。 */
export function buildPreamble(bridgeKey: Uint8Array): Uint8Array {
  if (bridgeKey.length !== 32) throw new Error('bridge key must be 32 bytes');
  const preamble = new Uint8Array(PREAMBLE_LENGTH);
  preamble[0] = 0x44; // D
  preamble[1] = 0x53; // S
  preamble[2] = 0x48; // H
  preamble[3] = 0x43; // C
  preamble[4] = VERSION;
  preamble.set(bridgeKey, 5);
  return preamble;
}

/** 一条已建立的隧道：明文可读可写。 */
export class TunnelStream {
  private readonly plaintext = new ByteQueue();
  private readonly transport: NoiseTransport;
  /** sdbg: 已从底层消费的原始字节数（诊断损坏发生的位置）。 */
  private rawBytes = 0;

  constructor(
    private readonly stream: BufferedStream,
    transport: NoiseTransport,
  ) {
    this.transport = transport;
    void this.pump();
  }

  async readExactly(count: number): Promise<Uint8Array> {
    return await this.plaintext.readExactly(count);
  }

  async readLine(): Promise<string> {
    return await this.plaintext.readLine();
  }

  /** 写明文：按 65519 切分，逐帧封包。 */
  write(bytes: Uint8Array): void {
    for (let offset = 0; offset < bytes.length; offset += MAX_NOISE_PLAINTEXT) {
      const chunk = bytes.slice(offset, offset + MAX_NOISE_PLAINTEXT);
      writeFrame(this.stream, this.transport.encrypt(chunk));
    }
    if (bytes.length === 0) writeFrame(this.stream, this.transport.encrypt(new Uint8Array(0)));
  }

  close(): void {
    this.stream.close();
    this.plaintext.end();
  }

  /** 后台泵：把一条条隧道帧解成明文。 */
  private async pump(): Promise<void> {
    try {
      for (;;) {
        const frame = await readFrame(this.stream.queue);
        this.rawBytes += frame.length + 2;
        this.plaintext.push(this.transport.decrypt(frame));
      }
    } catch (error) {
      console.log('sdbg raw=' + this.rawBytes + ' err=' + (error instanceof Error ? error.message : String(error)));
      this.plaintext.end(error instanceof Error ? error : new Error(String(error)));
      // 解帧失败期间不再收数据，留着的 TCP 连接会反过来占满平台配额，直接关掉。
      this.stream.close();
    }
  }
}

export interface TunnelDialOptions {
  factory: SocketFactory;
  address: string;
  port: number;
  /** 桥接静态公钥（配对码里的那段）。 */
  bridgeKey: Uint8Array;
  /** 本机设备静态密钥（设备 id 就是它的公钥）。 */
  deviceKey: KeyPair;
  /** 首次配对的 32 字节一次性配对码；已配对传 undefined。 */
  pairingToken?: Uint8Array;
  /** 同步随机源，连接前预取。 */
  random: (length: number) => Uint8Array;
  connectTimeoutMs?: number;
  /** 明文首包的 payload：已配对时为空。 */
  payload?: Uint8Array;
}

/** 拨号：前导 → Noise_IK → 得到一条明文流。 */
export async function dialTunnel(options: TunnelDialOptions): Promise<TunnelStream> {
  const stream = await openSocket(options.factory, options.address, options.port, options.connectTimeoutMs ?? 15000);
  const preamble = buildPreamble(options.bridgeKey);
  // 前导是明文，也是 Noise 的 prologue。
  stream.write(preamble);

  const handshake = new InitiatorHandshake(
    options.deviceKey,
    options.bridgeKey,
    preamble,
    options.random,
  );
  const payload = options.payload ?? options.pairingToken ?? new Uint8Array(0);
  const msg1 = handshake.writeMessage1(payload);
  writeFrame(stream, msg1);
  const message2 = await readFrame(stream.queue);
  handshake.readMessage2(message2);
  return new TunnelStream(stream, handshake.split());
}

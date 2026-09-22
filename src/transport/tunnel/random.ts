/**
 * 密码学安全随机数。
 *
 * 小程序里唯一可用的来源是 `wx.getRandomValues`（基础库 2.15.0 起，**对象式** API：
 * 传 `{length, success}`，成功回调里拿 `res.randomValues` 这个 ArrayBuffer，
 * 不是 Web Crypto 那种 `getRandomValues(typedArray)` 签名——传 TypedArray 会被忽略并
 * 返回全零，这一点在开发者工具里踩过）。Node 下（单测/联调）走 `globalThis.crypto`。
 */

import { chacha20 } from './crypto/chacha';

interface WeappRandomApi {
  getRandomValues(options: {
    length: number;
    success?: (res: { randomValues: ArrayBuffer }) => void;
    fail?: (err: unknown) => void;
  }): void;
}

function weappApi(): WeappRandomApi | undefined {
  const holder = globalThis as unknown as { wx?: WeappRandomApi };
  return holder.wx !== undefined && typeof holder.wx.getRandomValues === 'function' ? holder.wx : undefined;
}

/** 取 [length] 字节安全随机数。 */
export async function randomBytes(length: number): Promise<Uint8Array> {
  const api = weappApi();
  if (api !== undefined) {
    return await new Promise<Uint8Array>((resolve, reject) => {
      api.getRandomValues({
        length,
        success: (res) => resolve(new Uint8Array(res.randomValues)),
        fail: (err) => reject(new Error('getRandomValues failed: ' + describe(err))),
      });
    });
  }
  const holder = globalThis as unknown as { crypto?: { getRandomValues(bytes: Uint8Array): Uint8Array } };
  if (holder.crypto !== undefined) {
    const out = new Uint8Array(length);
    holder.crypto.getRandomValues(out);
    return out;
  }
  throw new Error('no secure random source available');
}

function describe(err: unknown): string {
  if (err === null || typeof err !== 'object') return String(err);
  const message = (err as { errMsg?: string }).errMsg;
  return message ?? JSON.stringify(err);
}

/**
 * 把一串已取到的随机数做成同步取用器。
 *
 * Noise 握手构造时需要同步取临时私钥，所以连接前一次性预取一批，再从这里切分；
 * 池子耗尽会抛错而不是退化到 Math.random——宁可连不上也不能用弱随机。
 */

/** 同步随机源：一次取好种子后，可靠地产生任意多字节。 */
export type RandomSource = (length: number) => Uint8Array;

/**
 * 建一个同步随机源。
 *
 * 多路下行连接需要长期产生 WebSocket 掩码（每帧 4 字节），固定长度的随机池一定会
 * 耗尽（这是实测踩到的：连到一半报 pool exhausted）。这里用 ChaCha20 做 CSPRNG：
 * 种子是 44 字节安全随机数（32 字节密钥 + 12 字节 nonce），之后每次取密钥流的下一段，
 * 用量不限而强度不降。
 */
export async function createRandomSource(): Promise<RandomSource> {
  const seed = await randomBytes(44);
  const key = seed.slice(0, 32);
  const nonce = seed.slice(32, 44);
  let counter = 0;
  return (length: number): Uint8Array => {
    const out = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const block = chacha20(key, nonce, counter, new Uint8Array(64));
      counter += 1;
      const take = Math.min(64, length - offset);
      out.set(block.slice(0, take), offset);
      offset += take;
    }
    return out;
  };
}



/**
 * SHA-256 / SHA-1 / HMAC-SHA256，纯 TS 实现。
 *
 * 小程序运行时没有 Web Crypto（`crypto.subtle`），隧道层的所有摘要都要自己算。
 * SHA-1 只用在 WebSocket 的 `Sec-WebSocket-Accept`（RFC 6455 指定的），不是安全用途。
 */

import { concat, utf8ToBytes } from './bytes';

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 的初始状态。 */
const H256 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/** 消息填充：一个 0x80、若干 0、64 位大端比特长度。 */
function padded(message: Uint8Array, blockSize: number): Uint8Array {
  const withOne = message.length + 1;
  const blocks = Math.ceil((withOne + 8) / blockSize);
  const out = new Uint8Array(blocks * blockSize);
  out.set(message, 0);
  out[message.length] = 0x80;
  const bitLength = message.length * 8;
  const tail = blocks * blockSize - 8;
  // 长度按 64 位大端写；JS 数值安全范围内高位恒为 0。
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  out[tail] = (high >>> 24) & 0xff;
  out[tail + 1] = (high >>> 16) & 0xff;
  out[tail + 2] = (high >>> 8) & 0xff;
  out[tail + 3] = high & 0xff;
  out[tail + 4] = (low >>> 24) & 0xff;
  out[tail + 5] = (low >>> 16) & 0xff;
  out[tail + 6] = (low >>> 8) & 0xff;
  out[tail + 7] = low & 0xff;
  return out;
}

export function sha256(message: Uint8Array): Uint8Array {
  const data = padded(message, 64);
  const h = H256.slice();
  const w = new Uint32Array(64);

  for (let block = 0; block < data.length; block += 64) {
    for (let i = 0; i < 16; i += 1) {
      const at = block + i * 4;
      w[i] = ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + K256[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i += 1) {
    out[i * 4] = (h[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (h[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (h[i] >>> 8) & 0xff;
    out[i * 4 + 3] = h[i] & 0xff;
  }
  return out;
}

/** HMAC-SHA256（RFC 2104），Noise 的 HKDF 与握手都靠它。 */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockKey = new Uint8Array(64);
  if (key.length > 64) blockKey.set(sha256(key), 0);
  else blockKey.set(key, 0);
  const inner = new Uint8Array(64);
  const outer = new Uint8Array(64);
  for (let i = 0; i < 64; i += 1) {
    inner[i] = blockKey[i] ^ 0x36;
    outer[i] = blockKey[i] ^ 0x5c;
  }
  return sha256(concat(outer, sha256(concat(inner, message))));
}

export function sha1(message: Uint8Array): Uint8Array {
  const data = padded(message, 64);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let block = 0; block < data.length; block += 64) {
    for (let i = 0; i < 16; i += 1) {
      const at = block + i * 4;
      w[i] = ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;
    }
    for (let i = 16; i < 80; i += 1) {
      const value = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = ((value << 1) | (value >>> 31)) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const words = [h0, h1, h2, h3, h4];
  for (let i = 0; i < 5; i += 1) {
    out[i * 4] = (words[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (words[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (words[i] >>> 8) & 0xff;
    out[i * 4 + 3] = words[i] & 0xff;
  }
  return out;
}

/** Noise 的 HKDF：两条（或三条）链式 HMAC 输出。 */
export function hkdf(chainingKey: Uint8Array, ikm: Uint8Array): [Uint8Array, Uint8Array] {
  const temp = hmacSha256(chainingKey, ikm);
  const first = hmacSha256(temp, new Uint8Array([1]));
  const second = hmacSha256(temp, concat(first, new Uint8Array([2])));
  return [first, second];
}

export { utf8ToBytes };

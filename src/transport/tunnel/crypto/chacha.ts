/**
 * ChaCha20-Poly1305 AEAD（RFC 8439），纯 TS。
 *
 * Noise 的传输密钥用它封包：nonce 是高 32 位为 0、低 64 位递增计数器的 12 字节，
 * 每次调用自增，与 Android 的 CipherState 和桥接的 node:crypto 路径一致。
 *
 * 只实现 AEAD 组合（Noise 用不到裸流密码），nonce 之外的参数都与 RFC 一致：
 * 32 位计数器从 0 起，Poly1305 的 one-time key 取 block 0 的前 32 字节。
 */

const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function writeU32LE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

/** 一轮 16 字的 ChaCha 变换在给定状态上执行 [rounds] 次；返回 16 个字。 */
function chaChaBlock(state: Uint32Array, rounds: number): Uint32Array {
  const working = state.slice();
  const quarter = (a: number, b: number, c: number, d: number): void => {
    working[a] = (working[a] + working[b]) >>> 0;
    working[d] = rotl(working[d] ^ working[a], 16);
    working[c] = (working[c] + working[d]) >>> 0;
    working[b] = rotl(working[b] ^ working[c], 12);
    working[a] = (working[a] + working[b]) >>> 0;
    working[d] = rotl(working[d] ^ working[a], 8);
    working[c] = (working[c] + working[d]) >>> 0;
    working[b] = rotl(working[b] ^ working[c], 7);
  };
  for (let i = 0; i < rounds; i += 2) {
    quarter(0, 4, 8, 12);
    quarter(1, 5, 9, 13);
    quarter(2, 6, 10, 14);
    quarter(3, 7, 11, 15);
    quarter(0, 5, 10, 15);
    quarter(1, 6, 11, 12);
    quarter(2, 7, 8, 13);
    quarter(3, 4, 9, 14);
  }
  for (let i = 0; i < 16; i += 1) working[i] = (working[i] + state[i]) >>> 0;
  return working;
}

function stateFor(key: Uint8Array, nonce: Uint8Array, counter: number): Uint32Array {
  const state = new Uint32Array(16);
  state[0] = SIGMA[0];
  state[1] = SIGMA[1];
  state[2] = SIGMA[2];
  state[3] = SIGMA[3];
  for (let i = 0; i < 8; i += 1) state[4 + i] = readU32LE(key, i * 4);
  state[12] = counter >>> 0;
  state[13] = readU32LE(nonce, 0);
  state[14] = readU32LE(nonce, 4);
  state[15] = readU32LE(nonce, 8);
  return state;
}

/** ChaCha20 加密（异或）：流与明文等长。 */
export function chacha20(key: Uint8Array, nonce: Uint8Array, counter: number, input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  for (let offset = 0; offset < input.length; offset += 64) {
    const block = chaChaBlock(stateFor(key, nonce, counter + offset / 64), 20);
    const keystream = new Uint8Array(64);
    for (let i = 0; i < 16; i += 1) writeU32LE(keystream, i * 4, block[i]);
    const take = Math.min(64, input.length - offset);
    for (let i = 0; i < take; i += 1) out[offset + i] = input[offset + i] ^ keystream[i];
  }
  return out;
}

/** Poly1305（RFC 8439），一次性的 32 字节 key，按整块 + 高位 1 处理。 */
export function poly1305(key: Uint8Array, message: Uint8Array): Uint8Array {
  const rBytes = key.slice(0, 16);
  // clamp: r &= 0x0ffffffc0ffffffc0ffffffc0fffffff
  rBytes[3] &= 15;
  rBytes[7] &= 15;
  rBytes[11] &= 15;
  rBytes[15] &= 15;
  rBytes[4] &= 252;
  rBytes[8] &= 252;
  rBytes[12] &= 252;
  let r = 0n;
  for (let i = 15; i >= 0; i -= 1) r = (r << 8n) | BigInt(rBytes[i]);
  let s = 0n;
  for (let i = 15; i >= 0; i -= 1) s = (s << 8n) | BigInt(key[16 + i]);

  const modulus = (1n << 130n) - 5n;
  let accumulator = 0n;
  for (let offset = 0; offset < message.length; offset += 16) {
    const take = Math.min(16, message.length - offset);
    let block = 0n;
    for (let i = take - 1; i >= 0; i -= 1) block = (block << 8n) | BigInt(message[offset + i]);
    // full 16-byte block 加 2^128；尾部短块（RFC 只对完整块要求）按 2^(8*len)。
    block += take === 16 ? 1n << 128n : 1n << BigInt(8 * take);
    accumulator = ((accumulator + block) * r) % modulus;
  }
  accumulator = (accumulator + s) % (1n << 128n);

  const out = new Uint8Array(16);
  let value = accumulator;
  for (let i = 0; i < 16; i += 1) {
    out[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return out;
}

/** AEAD 封包：返回 ciphertext ‖ tag（Noise 的 wire 形状）。 */
export function seal(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const block0 = chaChaBlock(stateFor(key, nonce, 0), 20);
  const oneTimeKey = new Uint8Array(32);
  for (let i = 0; i < 8; i += 1) writeU32LE(oneTimeKey, i * 4, block0[i]);
  const ciphertext = chacha20(key, nonce, 1, plaintext);

  // Poly1305 的输入：pad(aad) ‖ pad(ciphertext) ‖ len(aad) LE64 ‖ len(ciphertext) LE64
  const macData = new Uint8Array(
    Math.ceil(aad.length / 16) * 16 + Math.ceil(ciphertext.length / 16) * 16 + 16,
  );
  macData.set(aad, 0);
  macData.set(ciphertext, Math.ceil(aad.length / 16) * 16);
  const lengthAt = macData.length - 16;
  const aadLen = aad.length;
  const textLen = ciphertext.length;
  for (let i = 0; i < 8; i += 1) {
    macData[lengthAt + i] = (aadLen / 2 ** (8 * i)) & 0xff;
    macData[lengthAt + 8 + i] = (textLen / 2 ** (8 * i)) & 0xff;
  }
  const tag = poly1305(oneTimeKey, macData);

  const out = new Uint8Array(ciphertext.length + 16);
  out.set(ciphertext, 0);
  out.set(tag, ciphertext.length);
  return out;
}

/** 拆包校验；失败抛错，调用方按握手/传输失败处理。 */
export function open(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, sealed: Uint8Array): Uint8Array {
  if (sealed.length < 16) throw new Error('chacha20poly1305: truncated');
  const ciphertext = sealed.slice(0, sealed.length - 16);
  const tag = sealed.slice(sealed.length - 16);

  const block0 = chaChaBlock(stateFor(key, nonce, 0), 20);
  const oneTimeKey = new Uint8Array(32);
  for (let i = 0; i < 8; i += 1) writeU32LE(oneTimeKey, i * 4, block0[i]);

  const macData = new Uint8Array(
    Math.ceil(aad.length / 16) * 16 + Math.ceil(ciphertext.length / 16) * 16 + 16,
  );
  macData.set(aad, 0);
  macData.set(ciphertext, Math.ceil(aad.length / 16) * 16);
  const lengthAt = macData.length - 16;
  for (let i = 0; i < 8; i += 1) {
    macData[lengthAt + i] = (aad.length / 2 ** (8 * i)) & 0xff;
    macData[lengthAt + 8 + i] = (ciphertext.length / 2 ** (8 * i)) & 0xff;
  }
  const expected = poly1305(oneTimeKey, macData);
  let diff = 0;
  for (let i = 0; i < 16; i += 1) diff |= expected[i] ^ tag[i];
  if (diff !== 0) throw new Error('chacha20poly1305: authentication failed');

  return chacha20(key, nonce, 1, ciphertext);
}

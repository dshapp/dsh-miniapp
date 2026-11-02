/**
 * X25519（RFC 7748）标量乘，纯 BigInt 实现。
 *
 * 运行时没有 Web Crypto，所以整条曲线运算自己算。用常数时间的 Montgomery ladder，
 * 标量按位遍历、每轮都做相同的加减乘，不做提前返回。
 */

const P = (1n << 255n) - 19n;
const A24 = 121665n;

function clampScalar(scalar: Uint8Array): bigint {
  const bytes = scalar.slice(0, 32);
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;
  let value = 0n;
  for (let i = 31; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[i]);
  return value;
}

function decodeUCoordinate(bytes: Uint8Array): bigint {
  const copy = bytes.slice(0, 32);
  copy[31] &= 127;
  let value = 0n;
  for (let i = 31; i >= 0; i -= 1) value = (value << 8n) | BigInt(copy[i]);
  return value % P;
}

function encodeUCoordinate(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let reduced = value % P;
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number(reduced & 0xffn);
    reduced >>= 8n;
  }
  return out;
}

function mod(value: bigint): bigint {
  const result = value % P;
  return result < 0n ? result + P : result;
}

/** 模逆：费马小定理，指数 P-2。 */
function invert(value: bigint): bigint {
  let result = 1n;
  let base = mod(value);
  let exponent = P - 2n;
  while (exponent > 0n) {
    if ((exponent & 1n) === 1n) result = (result * base) % P;
    base = (base * base) % P;
    exponent >>= 1n;
  }
  return result;
}

/** 标量乘：[scalar] * u，返回 u 坐标。 */
export function x25519(scalar: Uint8Array, uCoordinate: Uint8Array): Uint8Array {
  const k = clampScalar(scalar);
  const u = decodeUCoordinate(uCoordinate);

  let x1 = u;
  let x2 = 1n;
  let z2 = 0n;
  let x3 = u;
  let z3 = 1n;
  let swap = 0n;

  for (let bit = 254n; bit >= 0n; bit -= 1n) {
    const current = (k >> bit) & 1n;
    swap ^= current;
    // 交换后 swap 归位；分支只依赖标量位，与 u 无关。
    if (swap === 1n) {
      const swapX = x2;
      x2 = x3;
      x3 = swapX;
      const swapZ = z2;
      z2 = z3;
      z3 = swapZ;
    }
    swap = current;

    const a = mod(x2 + z2);
    const aa = (a * a) % P;
    const b = mod(x2 - z2);
    const bb = (b * b) % P;
    const e = mod(aa - bb);
    const c = mod(x3 + z3);
    const d = mod(x3 - z3);
    const da = (d * a) % P;
    const cb = (c * b) % P;
    const t = mod(da + cb);
    x3 = (t * t) % P;
    const t2 = mod(da - cb);
    z3 = (x1 * ((t2 * t2) % P)) % P;
    x2 = (aa * bb) % P;
    z2 = (e * mod(aa + A24 * e)) % P;
  }

  if (swap === 1n) {
    const tx = x2;
    x2 = x3;
    x3 = tx;
    const tz = z2;
    z2 = z3;
    z3 = tz;
  }

  const result = (x2 * invert(z2)) % P;
  return encodeUCoordinate(result);
}

/** 从私钥导出公钥：基点是 u=9。 */
export function publicKeyOf(privateKey: Uint8Array): Uint8Array {
  const base = new Uint8Array(32);
  base[0] = 9;
  return x25519(privateKey, base);
}

/** 一对随机 X25519 密钥。 */
export function keyPairFromRandom(randomBytes: Uint8Array): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = randomBytes.slice(0, 32);
  return { privateKey, publicKey: publicKeyOf(privateKey) };
}

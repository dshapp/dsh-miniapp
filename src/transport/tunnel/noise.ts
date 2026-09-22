/**
 * Noise_IK_25519_ChaChaPoly_SHA256，发起方一侧。
 *
 * 与 Android 的 `net/Noise.kt` 和桥接的 `src/noise.ts` 是同一套 token 驱动逻辑，
 * 只是这里跑在纯 TS 的 crypto 上（见 ./crypto）。手机只做发起方，所以只实现 IK。
 *
 * 一次握手同时完成：加密、证明自己（设备静态公钥就是设备 id）、认证对方
 * （扫码时已经拿到桥接公钥）。没有 TLS、证书、令牌，也没有时间窗与重放表。
 */

import { concat, equal } from './crypto/bytes';
import { hkdf, sha256 } from './crypto/sha';
import { open, seal } from './crypto/chacha';
import { publicKeyOf, x25519 } from './crypto/x25519';

const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const PROTOCOL = 'Noise_IK_25519_ChaChaPoly_SHA256';

/** 一对 X25519 密钥。 */
export interface KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

/** 一个方向上的 ChaChaPoly 密钥与它的 64 位计数器。 */
export class CipherState {
  private key: Uint8Array | undefined;
  private nonce = 0n;

  constructor(key?: Uint8Array) {
    this.key = key;
  }

  get hasKey(): boolean {
    return this.key !== undefined;
  }

  encrypt(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    if (this.key === undefined) return plaintext;
    return seal(this.key, this.iv(), ad, plaintext);
  }

  decrypt(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    if (this.key === undefined) return ciphertext;
    return open(this.key, this.iv(), ad, ciphertext);
  }

  /** 12 字节 nonce：高 4 字节为零，低 8 字节是小端计数器。 */
  private iv(): Uint8Array {
    const iv = new Uint8Array(12);
    let value = this.nonce;
    for (let i = 4; i < 12; i += 1) {
      iv[i] = Number(value & 0xffn);
      value >>= 8n;
    }
    this.nonce += 1n;
    return iv;
  }
}

/** 握手完成后的会话：两个方向各一把密钥。 */
export class NoiseTransport {
  constructor(private readonly send: CipherState, private readonly receive: CipherState) {}

  encrypt(plaintext: Uint8Array): Uint8Array {
    return this.send.encrypt(new Uint8Array(0), plaintext);
  }

  decrypt(ciphertext: Uint8Array): Uint8Array {
    return this.receive.decrypt(new Uint8Array(0), ciphertext);
  }
}

/** 生成一对随机静态密钥；随机数由调用方注入，便于测试用固定种子。 */
export function generateKeyPair(random: (length: number) => Uint8Array): KeyPair {
  const privateKey = random(KEY_LENGTH);
  return { privateKey, publicKey: publicKeyOf(privateKey) };
}

/**
 * IK 发起方握手。
 *
 * 构造即固定前两条状态（协议名与 prologue），[writeMessage1] 写出 e/es/s/ss/payload，
 * [readMessage2] 读 e/ee/se/payload 后即可 [split]。
 */
export class InitiatorHandshake {
  private chainingKey: Uint8Array;
  private hash: Uint8Array;
  private cipher = new CipherState();
  private readonly ephemeral: KeyPair;
  private remoteEphemeral: Uint8Array | undefined;
  private sentMessage1 = false;
  private readMessage2Done = false;

  constructor(
    private readonly staticKey: KeyPair,
    private readonly remoteStatic: Uint8Array,
    prologue: Uint8Array,
    random: (length: number) => Uint8Array,
  ) {
    const name = new Uint8Array(PROTOCOL.length);
    for (let i = 0; i < PROTOCOL.length; i += 1) name[i] = PROTOCOL.charCodeAt(i) & 0xff;
    this.hash = name.length <= 32 ? concat(name, new Uint8Array(32 - name.length)) : sha256(name);
    this.chainingKey = this.hash.slice();
    this.mixHash(prologue);
    // IK 的预消息：发起方已知响应方静态公钥。
    this.mixHash(remoteStatic);
    this.ephemeral = generateKeyPair(random);
  }

  /** 第一条消息：e, es, s, ss, payload（payload 为首连时的一次性配对码）。 */
  writeMessage1(payload: Uint8Array): Uint8Array {
    if (this.sentMessage1) throw new Error('noise: message 1 already written');
    this.sentMessage1 = true;
    this.mixHash(this.ephemeral.publicKey);
    this.mixKey(x25519(this.ephemeral.privateKey, this.remoteStatic));
    const encryptedStatic = this.encryptAndHash(this.staticKey.publicKey);
    this.mixKey(x25519(this.staticKey.privateKey, this.remoteStatic));
    return concat(this.ephemeral.publicKey, encryptedStatic, this.encryptAndHash(payload));
  }

  /** 第二条消息：e, ee, se, payload。 */
  readMessage2(message: Uint8Array): void {
    if (!this.sentMessage1) throw new Error('noise: read message 2 before writing message 1');
    if (message.length < KEY_LENGTH) throw new Error('noise: truncated handshake message');
    const remoteEphemeral = message.slice(0, KEY_LENGTH);
    this.remoteEphemeral = remoteEphemeral;
    this.mixHash(remoteEphemeral);
    this.mixKey(x25519(this.ephemeral.privateKey, remoteEphemeral));
    this.mixKey(x25519(this.staticKey.privateKey, remoteEphemeral));
    this.decryptAndHash(message.slice(KEY_LENGTH));
    this.readMessage2Done = true;
  }

  get complete(): boolean {
    return this.readMessage2Done;
  }

  split(): NoiseTransport {
    if (!this.readMessage2Done) throw new Error('noise: handshake is not complete');
    const [first, second] = hkdf(this.chainingKey, new Uint8Array(0));
    // 发起方：先发的用 first，先收的用 second。
    return new NoiseTransport(new CipherState(first), new CipherState(second));
  }

  /** 响应方静态公钥应等于预期（桥接公钥即路由键）。 */
  verifyRemoteStatic(): boolean {
    return this.remoteEphemeral !== undefined;
  }

  private mixHash(data: Uint8Array): void {
    this.hash = sha256(concat(this.hash, data));
  }

  private mixKey(ikm: Uint8Array): void {
    const [chainingKey, key] = hkdf(this.chainingKey, ikm);
    this.chainingKey = chainingKey;
    this.cipher = new CipherState(key);
  }

  private encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const ciphertext = this.cipher.encrypt(this.hash, plaintext);
    this.mixHash(ciphertext);
    return ciphertext;
  }

  private decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    const plaintext = this.cipher.decrypt(this.hash, ciphertext);
    this.mixHash(ciphertext);
    return plaintext;
  }
}

export { TAG_LENGTH, KEY_LENGTH, equal };

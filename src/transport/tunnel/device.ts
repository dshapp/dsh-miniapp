/**
 * 设备静态密钥的生成。
 *
 * 设备私钥就是设备 id：桥接按它登记设备（180 天有效期）。生成之后由配对流程写进
 * [ServerProfile]（state/profileStore.ts）持久化，所以这里只负责「安全地生成」。
 * 小程序没有安全芯片，密钥与业务数据同级存放，和 Android 的 Keystore 不同。
 */

import { randomBytes } from './random';
import { publicKeyOf } from './crypto/x25519';

export interface DeviceIdentity {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

/**
 * 生成一对新的设备密钥。
 *
 * 走 [randomBytes]（\`wx.getRandomValues\` 的对象式 API）——**不能**用同步调用的
 * \`wx.getRandomValues({length})\` 再读返回值：它是回调式接口，同步拿不到 randomValues，
 * 旧实现因此静默退化成 Math.random，密钥强度形同虚设。
 */
export async function generateDeviceKey(): Promise<DeviceIdentity> {
  const privateKey = await randomBytes(32);
  return { privateKey, publicKey: publicKeyOf(privateKey) };
}

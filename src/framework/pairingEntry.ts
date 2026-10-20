import { openPage, pageRoutes } from './page';

/**
 * 进配对页时带的「意图」：一进来就该是什么样子。
 *
 * - payload：引导页已经就地扫到的配对串，进来直接校验并弹命名框；
 * - mode：'paste' 直接进粘贴态并把焦点给输入框，'scan'（默认）进扫码态；
 * - cameraUnavailable：引导页调相机失败，进粘贴态并说明原因。
 *
 * 不走页面 query：配对页的初始状态在首帧渲染时就要定下来（否则先画一帧扫码态、
 * 再跳成粘贴态，还会顺手弹一次「请扫描二维码」），而首帧里能不能从
 * getCurrentInstance().router 读到参数取决于 Taro 的挂载时序；配对串本身又带 URL
 * 编码的 ?name= 与 #配对码，过 query 再被 pageParams 解码一次就不是原串了。
 * 小程序各页面共用同一个 JS 运行时，模块级变量足够，取一次就清掉。
 */
export interface PairingEntry {
  payload?: string;
  mode?: 'scan' | 'paste';
  cameraUnavailable?: boolean;
}

let pending: PairingEntry | undefined;

export function openPairing(entry: PairingEntry = {}): void {
  pending = entry;
  openPage(pageRoutes.PAIRING);
}

/** 配对页首帧调用一次；没有引导页带来的意图（比如从设置页进来）就是默认的扫码态。 */
export function takePairingEntry(): PairingEntry {
  const entry = pending ?? {};
  pending = undefined;
  return entry;
}

/**
 * 扫配对二维码的一次调用。
 *
 * 引导页和配对页都要直接拉起相机：引导页的「扫描二维码」不能先跳到配对页再让用户
 * 点一次扫码，所以 wx.scanCode 的调用与结果分类收在这里，两处共用。
 */
export type ScanOutcome =
  | { kind: 'scanned'; text: string }
  /** 用户主动取消，不是错误，调用方什么都不用做。 */
  | { kind: 'cancelled' }
  /** 相机不可用 / 没有权限，调用方要给出「改为粘贴」的路。 */
  | { kind: 'unavailable' };

export function scanQrCode(onResult: (outcome: ScanOutcome) => void): void {
  wx.scanCode({
    onlyFromCamera: false,
    scanType: ['qrCode'],
    success: res => onResult({ kind: 'scanned', text: res.result }),
    fail: err => {
      const message = String((err as { errMsg?: string } | undefined)?.errMsg ?? '');
      onResult(/cancel/i.test(message) ? { kind: 'cancelled' } : { kind: 'unavailable' });
    },
  });
}

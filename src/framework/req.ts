import Taro from '@tarojs/taro';

/** H5 构建（仅本地调试用）与小程序端的区分。 */
export const isWeb = process.env.TARO_ENV === 'h5';

export function toast(title: string, icon: 'none' | 'success' | 'error' = 'none') {
  Taro.showToast({ title, icon, duration: 2000 });
}

export function toastError(error: unknown, fallback = '操作失败') {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  toast(message || fallback, 'none');
}

/** 把一个 Promise 的失败收敛成「有没有成功」，UI 里大量使用。 */
export async function attempt<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    toastError(error);
    return null;
  }
}

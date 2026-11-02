import Taro from '@tarojs/taro';
import { ROUTES } from '../route';

/**
 * 页面跳转的薄封装。
 *
 * 小程序同时存在 navigateTo（压栈）与 redirectTo（替换）两套语义，页面里到处都是
 * 二选一的判断很容易写错；这里按「要不要回退」收敛成两个函数，页面只表达意图。
 */
export function openPage(path: string, params?: Record<string, string | number | undefined>, replace = false): void {
  const query = buildQuery(params);
  const url = query.length === 0 ? path : `${path}?${query}`;
  if (replace) {
    void Taro.redirectTo({ url });
    return;
  }
  void Taro.navigateTo({ url });
}

export function buildQuery(params?: Record<string, string | number | undefined>): string {
  if (params === undefined) return '';
  return Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

export function back(delta = 1): void {
  void Taro.navigateBack({ delta });
}

/** 路由写死一处：页面互相跳转时不要散落字符串。 */
export const pageRoutes = ROUTES;

/** 读取当前页面参数（小程序每个页面实例的参数是静态的）。 */
export function pageParams(): Record<string, string> {
  const instance = Taro.getCurrentInstance();
  const params = instance?.router?.params ?? {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') result[key] = decodeURIComponent(value);
  }
  return result;
}

/** 列表回到顶部的锚点：切换会话/分组时用。 */
export function scrollTop(): void {
  void Taro.pageScrollTo({ scrollTop: 0, duration: 0 });
}

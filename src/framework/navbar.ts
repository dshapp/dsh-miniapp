import Taro from '@tarojs/taro';
import {
  computeNavMetrics,
  FALLBACK_STATUS_BAR,
  type MenuButtonRect,
  type NavMetrics,
  type SystemMetrics,
} from '../model/navBarMetrics';
import { getSystemInfo } from './systemInfo';

/**
 * 自定义标题栏的度量：读一次平台数据，按 model/navBarMetrics.ts 的公式算好并缓存。
 *
 * 公式与兜底的说明见那边；这里只负责"从 `wx` 把数字取出来，取不到就交给兜底"。
 */
function systemInfo(): SystemMetrics {
  try {
    const info = getSystemInfo();
    return {
      statusBarHeight: typeof info.statusBarHeight === 'number' ? info.statusBarHeight : FALLBACK_STATUS_BAR,
      screenWidth: typeof info.screenWidth === 'number' ? info.screenWidth : 375,
      platform: typeof info.platform === 'string' ? info.platform : 'devtools',
    };
  } catch {
    return { statusBarHeight: FALLBACK_STATUS_BAR, screenWidth: 375, platform: 'devtools' };
  }
}

function menuRect(): MenuButtonRect | undefined {
  try {
    const rect = Taro.getMenuButtonBoundingClientRect();
    if (rect === undefined || rect === null) return undefined;
    return { width: rect.width, height: rect.height, top: rect.top, right: rect.right };
  } catch {
    return undefined;
  }
}

let cached: NavMetrics | undefined;

/**
 * 测量一次并缓存。
 *
 * 官方建议放在 `onLaunch`：那时胶囊已经就位，而页面还没开始画，后面所有页面读到的都是
 * 同一份度量，不会出现"首页算出一套、二级页算出另一套"的跳动。
 */
export function measureNavBar(): NavMetrics {
  cached = computeNavMetrics(systemInfo(), menuRect());
  return cached;
}

/** 取度量；没测过就当场测一次（页面可能先于 onLaunch 的副作用渲染）。 */
export function navMetrics(): NavMetrics {
  return cached ?? measureNavBar();
}

/** 仅测试用：清掉缓存。 */
export function resetNavMetrics(): void {
  cached = undefined;
}

export type { NavMetrics };

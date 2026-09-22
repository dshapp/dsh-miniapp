/**
 * 平台信息的统一入口。
 *
 * `wx.getSystemInfoSync` 已被官方标记为废弃（基础库一页能刷好几条
 * "getSystemInfoSync is deprecated" 警告），替代品是拆开的三个更轻的接口：
 *
 * - `wx.getWindowInfo`  → 窗口宽高 / 状态栏 / 安全区 / 屏幕宽
 * - `wx.getDeviceInfo`  → platform 等设备信息
 * - `wx.getAppBaseInfo` → 语言 / 主题 / 基础库版本
 *
 * 这三个同步接口在基础库 2.20.1+ 都有；老基础库缺哪个就跳过哪个，三个全缺时退回
 * `getSystemInfoSync`，行为与改前一致。字段在这里合并成一份扇出对象，调用方不用关心来源。
 */
export interface SystemInfo {
  windowWidth?: number;
  windowHeight?: number;
  screenWidth?: number;
  screenHeight?: number;
  statusBarHeight?: number;
  safeArea?: { bottom: number; height: number; top: number; left: number; right: number; width?: number };
  platform?: string;
  language?: string;
  theme?: string;
}

type PartialInfo = Partial<SystemInfo>;

/** 每个 wx API 都可能不存在或抛错，统一收窄成「拿不到就 undefined」。 */
function invoke(fn: unknown): PartialInfo | undefined {
  if (typeof fn !== 'function') return undefined;
  try {
    return (fn as () => PartialInfo)() ?? undefined;
  } catch {
    return undefined;
  }
}

export function getSystemInfo(): SystemInfo {
  const api = (typeof wx === 'undefined' ? undefined : wx) as unknown as Record<string, unknown> | undefined;
  if (api === undefined) return {};

  const window = invoke(api.getWindowInfo);
  const device = invoke(api.getDeviceInfo);
  const base = invoke(api.getAppBaseInfo);

  if (window === undefined && device === undefined && base === undefined) {
    return invoke(api.getSystemInfoSync) ?? {};
  }
  return { ...window, ...device, ...base };
}

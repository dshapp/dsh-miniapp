import Taro from '@tarojs/taro';
import { getSystemInfo } from '../framework/systemInfo';
import { Store } from './store';
import type { AppThemeMode } from './settings';

/** 主题解析后的实际值：light / dark。 */
export type ResolvedTheme = 'light' | 'dark';

/**
 * 深色主题的落地方式。
 *
 * 小程序没有 Compose 那套 MaterialTheme，也没有可下发的 page class；这里用
 * `dsh-theme-dark` 这个全局 class + CSS 自定义属性实现：app.tsx 把它挂在每页内容
 * 的最外层容器上，theme.scss 只负责换掉那一组 --dsh-* 变量。
 *
 * 「跟随系统」在 JS 侧解析（settings.ts 落盘的是 system/light/dark 三态选择）。
 */
export const themeStore = new Store<ResolvedTheme>('light');

function systemTheme(): ResolvedTheme {
  try {
    const info = getSystemInfo();
    return info.theme === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function resolveTheme(mode: AppThemeMode): ResolvedTheme {
  return mode === 'system' ? systemTheme() : mode;
}

/** 把选择落成实际主题，并顺带调好导航栏配色（对齐 Android 的状态栏/导航栏跟随主题）。 */
export function applyTheme(mode: AppThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  themeStore.set(resolved);
  const surface = resolved === 'dark' ? '#121417' : '#f5f6f8';
  const nav = resolved === 'dark' ? '#121417' : '#ffffff';
  void Taro.setNavigationBarColor({
    frontColor: resolved === 'dark' ? '#ffffff' : '#000000',
    backgroundColor: nav,
  }).catch(() => undefined);
  void Taro.setBackgroundColor({
    backgroundColor: surface,
    backgroundColorTop: surface,
    backgroundColorBottom: surface,
  }).catch(() => undefined);
  return resolved;
}

/** 系统主题在运行期变了：跟随系统时重新解析。 */
export function refreshSystemTheme(onChange: () => void): void {
  try {
    Taro.onThemeChange((event: { theme?: string }) => {
      themeStore.set(event?.theme === 'dark' ? 'dark' : 'light');
      onChange();
    });
  } catch {
    // 老基础库不支持 onThemeChange：忽略，系统主题只在启动时判定一次。
  }
}

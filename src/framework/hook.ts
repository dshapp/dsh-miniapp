import React from 'react';
import Taro, { useDidShow, useDidHide } from '@tarojs/taro';
import { useStore } from '../state/store';
import { themeStore } from '../state/theme';
import { getSystemInfo } from './systemInfo';

/** 定时器：intervalMs 为 0 表示不跑。 */
export function useInterval(callback: () => void, intervalMs: number): void {
  const ref = React.useRef(callback);
  ref.current = callback;
  React.useEffect(() => {
    if (intervalMs <= 0) return undefined;
    const timer = setInterval(() => ref.current(), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
}

/**
 * 防抖值：搜索框用它把每击一次的请求合成一次。
 * 返回的是「延迟后的值」，调用方只管按当前值发请求即可。
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** 小程序没有 beforeunload，用 didShow/didHide 表达前台可见性。 */
export function useVisibility(onShow?: () => void, onHide?: () => void): void {
  const showRef = React.useRef(onShow);
  showRef.current = onShow;
  const hideRef = React.useRef(onHide);
  hideRef.current = onHide;
  useDidShow(() => showRef.current?.());
  useDidHide(() => hideRef.current?.());
}

/** 一次性副作用：把异步函数收敛成「跑一次、出错不炸页面」。 */
export function useOnce(effect: () => void | Promise<void>): void {
  const ran = React.useRef(false);
  React.useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void effect();
    // 依赖有意留空：只想在挂载后跑一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function measureSafeBottom(): number {
  try {
    const info = getSystemInfo();
    const safe = info.safeArea;
    const height = info.windowHeight ?? 0;
    if (safe === undefined || height === 0) return 0;
    return Math.max(0, height - safe.bottom);
  } catch {
    return 0;
  }
}

/**
 * 底部安全区高度：iPhone 的 home indicator 会盖住输入区。
 *
 * 原来只在挂载时算一次，旋屏 / 折叠屏 / 分屏切换后就会停在旧值上（安卓那边是系统在
 * 布局期实时给 navigationBarsPadding）。这里订阅一次窗口尺寸变化，让数值跟着更新；
 * 没有 onWindowResize 的老基础库退化为「只算一次」。
 */
export function useSafeBottom(): number {
  const [value, setValue] = React.useState(measureSafeBottom);
  React.useEffect(() => {
    const onChange = (): void => setValue(measureSafeBottom());
    try {
      Taro.onWindowResize(onChange);
    } catch {
      return undefined;
    }
    return () => {
      try {
        Taro.offWindowResize(onChange);
      } catch {
        // 老基础库没有这对 API：忽略。
      }
    };
  }, []);
  return value;
}

export { Taro };

/**
 * 深色主题的全局 class：挂在每页内容最外层（由 `ui/pageShell.tsx` 统一挂），换主题时整棵子树重绘。
 * 只认 class 不认 `page` 属性——小程序没法给 page 元素加 class。
 */
export function useThemeClass(): string {
  const theme = useStore(themeStore);
  return theme === 'dark' ? 'dsh-theme-dark' : '';
}

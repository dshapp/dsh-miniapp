import { useSyncExternalStore } from 'react';

/**
 * 极小的可订阅状态容器：替代 Compose 的 mutableStateOf。
 *
 * 小程序没有 Compose 的重组，这里用 useSyncExternalStore 把订阅接到 React 上；
 * 页面里通过 useStore(store) 拿到值，任何 set 都会让用到的组件重绘。
 * 之所以不引状态库：这台客户端的更新几乎全部来自流式推送，不是重新取数，
 * SWR 那套缓存-失效模型反而多余。
 */
export class Store<T> {
  private value: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get = (): T => this.value;

  set = (updater: T | ((previous: T) => T)): void => {
    const next = typeof updater === 'function' ? (updater as (previous: T) => T)(this.value) : updater;
    if (Object.is(next, this.value)) return;
    this.value = next;
    this.emit();
  };

  patch = (partial: Partial<T>): void => {
    this.set({ ...(this.value as T & object), ...partial } as T);
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  emit = (): void => {
    for (const listener of Array.from(this.listeners)) listener();
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** 任何「订阅 + 取快照」的对象都能接进来：Store 之外的设置/配对存储也各有自己的类。 */
export interface Subscribable<T> {
  subscribe(listener: () => void): () => void;
  get(): T;
}

export function useSubscribed<T>(source: Subscribable<T>): T {
  return useSyncExternalStore(source.subscribe, source.get, source.get);
}

/** 每次都产出新对象的派生值，配合 useStore 使用时要注意引用相等。 */
export function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(key => Object.is(a[key], b[key]));
}

/** 写入微信本地存储；失败时静默降级（配额用完不能影响主流程）。 */
export function writeStorage(key: string, value: string): void {
  try {
    wx.setStorageSync(key, value);
  } catch {
    // 配额或平台限制：忽略，下一次读取会走默认值。
  }
}

export function readStorage(key: string): string | undefined {
  try {
    const value = wx.getStorageSync(key);
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function removeStorage(key: string): void {
  try {
    wx.removeStorageSync(key);
  } catch {
    // 同上。
  }
}

export function readStringList(key: string): string[] {
  const raw = readStorage(key);
  if (raw === undefined) return [];
  return raw.split('\n').filter(item => item.length > 0);
}

export function writeStringList(key: string, value: string[]): void {
  writeStorage(key, value.join('\n'));
}

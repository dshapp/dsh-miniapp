import React from 'react';
import { isWeb } from './framework/req';
import { getAppModel, type AppModel } from './state/appModel';

/**
 * 全局应用状态。AppModel 是进程级单例（对应 Android 挂在 Application 上的 PhoneModel），
 * Context 只负责把它传给页面，不参与状态同步——各 store 用 useStore 订阅。
 */
export interface AppState {
  isWeb: boolean;
  model: AppModel;
}

export const AppContext = React.createContext<AppState | null>(null);

export function useAppState(): AppState {
  const model = React.useMemo(() => getAppModel(), []);
  return React.useMemo(() => ({ isWeb, model }), [model]);
}

export function useModel(): AppModel {
  return useAppState().model;
}

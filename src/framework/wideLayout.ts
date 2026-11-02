import Taro from '@tarojs/taro';
import type { SessionId } from '../model/types';
import { MAIN_ROUTE } from '../route';
import { Store, useStore } from '../state/store';
import { measureNavBar } from './navbar';
import { openPage, pageRoutes } from './page';
import { getSystemInfo } from './systemInfo';

/**
 * 宽屏（平板、手机横屏、桌面微信）并排布局：会话列表与会话详情放在同一页，
 * 点列表只换右侧内容，不再整页跳转（对齐 Mac 的边栏 + 详情、安卓端的 WideSessionLayout）。
 *
 * 600px 与安卓端同一个门槛（Material 的 Medium 窗口档）：手机竖屏（320–430）都在它之下，
 * 手机横屏（≥ 640）、iPad、折叠屏展开都在它之上。样式单位是 px（见 config/index.ts 的
 * pxtransform.targetUnit），所以这里的数值与样式里写的 px 是同一把尺子。
 */
export const WIDE_LAYOUT_MIN_WIDTH = 600;

function readWindowWidth(): number {
  const width = getSystemInfo().windowWidth;
  return typeof width === 'number' && width > 0 ? width : 375;
}

/** 当前窗口宽度；转屏、iPad 分屏拖动时随 wx.onWindowResize 更新。 */
export const windowWidthStore = new Store<number>(readWindowWidth());

let listening = false;

function ensureListening(): void {
  if (listening) return;
  listening = true;
  try {
    Taro.onWindowResize(result => {
      // 转屏后状态栏高度与胶囊位置都变了：先重测顶栏度量，再通知订阅者重画。
      measureNavBar();
      const width = result?.size?.windowWidth;
      windowWidthStore.set(typeof width === 'number' && width > 0 ? width : readWindowWidth());
    });
  } catch {
    // 老基础库没有 onWindowResize：宽度就停在启动时那一份。
  }
}

export function useWindowWidth(): number {
  ensureListening();
  return useStore(windowWidthStore);
}

export function useWideLayout(): boolean {
  return useWindowWidth() >= WIDE_LAYOUT_MIN_WIDTH;
}

export function isWideLayout(): boolean {
  return windowWidthStore.get() >= WIDE_LAYOUT_MIN_WIDTH;
}

/** 左栏宽度：随窗口变宽而变宽，夹在一个读得下标题、又不挤占详情的区间里（与安卓同口径）。 */
export function listPaneWidth(windowWidth: number): number {
  return Math.round(Math.min(380, Math.max(280, windowWidth * 0.32)));
}

/**
 * 并排页右侧正在显示的会话。放在模块级而不是首页的 state：
 * 从归档页、新建页、转屏的会话页回到首页时要把会话带过去，首页实例不一定是同一个渲染周期。
 */
export const splitSelectionStore = new Store<SessionId | undefined>(undefined);

/** 首页在页面栈里离栈顶有几层；首页不在栈里（从分享卡片直接进会话页）返回 undefined。 */
export function indexPageDepth(): number | undefined {
  try {
    const pages = Taro.getCurrentPages();
    const index = pages.findIndex(page => page.route === MAIN_ROUTE.INDEX);
    return index < 0 ? undefined : pages.length - 1 - index;
  } catch {
    return undefined;
  }
}

/** 当前栈顶是不是首页。 */
export function indexPageOnTop(): boolean {
  return indexPageDepth() === 0;
}

/**
 * 打开一条会话：宽屏且首页在栈里时，把它放到首页右栏并退回首页；否则照旧进会话页。
 * replace 只对窄屏生效（新建页发出第一条消息后用 redirect，返回键不再回到新建页）。
 */
export function openChatSession(sessionId: SessionId, replace = false): void {
  if (isWideLayout()) {
    const depth = indexPageDepth();
    if (depth !== undefined) {
      splitSelectionStore.set(sessionId);
      if (depth > 0) void Taro.navigateBack({ delta: depth });
      return;
    }
  }
  openPage(pageRoutes.CHAT, { sessionId }, replace);
}

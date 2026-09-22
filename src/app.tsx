import './app.scss';
import React from 'react';
import { useDidHide, useDidShow, useLaunch } from '@tarojs/taro';
import { AppContext, useAppState } from './state';
import { getAppModel } from './state/appModel';
import { settings } from './state/settings';
import { refreshSystemTheme } from './state/theme';
import { measureNavBar } from './framework/navbar';

/**
 * 小程序入口：负责生命周期、全局单例与 Context，本身不产生任何小程序节点。
 *
 * 关键：Taro 的 AppWrapper 把各页面当作 `children` 传进 App（见
 * @tarojs/plugin-framework-react 的 `h(App, props, elements.slice())`），所以 App **必须
 * 把 children 渲染出去**，否则所有页面都不会挂载（返回 null 会得到一页空白）。
 *
 * 但 App 自己返回的节点不会出现在任何页面的 WXML 里：小程序每个页面是独立的自定义组件，
 * 页面数据只从该页面自己的根节点往下序列化，App 那层是「祖先」，不进页面。因此在 App 里
 * 放主题 class / 连接横幅 / 卡片详情层等于永远不显示（实测 querySelectorAll 在页面上查不到
 * `.dsh-app-root`）。这些「全局 UI」改由每个页面的 PageShell（ui/pageShell.tsx）承载。
 *
 * Context Provider 不产生小程序节点，放在这里正好把 AppModel 透传给所有页面。
 *
 * 生命周期只做两件事：启动时连上当前配对的电脑；回前台补一次同步。小程序没有 Android 的
 * 前台服务，后台期间 socket 大概率被系统冻结，所以「回前台探活并重新拉取」是保证状态不丢的
 * 唯一手段（见 StreamCoordinator.onForeground）。
 */
function App(props: { children?: React.ReactNode }): JSX.Element {
  const appState = useAppState();
  useLaunch(() => {
    // 自定义导航栏的度量要在任何页面开画之前拿到，否则首页会先按兜底值画一版再跳一下。
    // 官方也建议放在 onLaunch：那时胶囊已经就位（见 framework/navbar.ts 的公式）。
    measureNavBar();
    getAppModel().connectCurrent();
  });

  useDidShow(() => {
    // 系统主题可能被用户在系统设置里改过：回前台补一次解析。
    settings.refreshSystemTheme();
    // 系统语言可能在这次进前台前被改过：补一次解析（对齐 Android refreshSystemLocale）。
    settings.refreshSystemLocale();
    getAppModel().onForeground();
  });

  // 系统主题变化时立刻跟着切（「跟随系统」下才有意义）。
  React.useEffect(() => {
    refreshSystemTheme(() => settings.refreshSystemTheme());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useDidHide(() => {
    getAppModel().onBackground();
  });

  // Provider 不是小程序节点，只透传 context；真正挂载页面的就是这里的 children。
  return <AppContext.Provider value={appState}>{props.children}</AppContext.Provider>;
}

export default App;

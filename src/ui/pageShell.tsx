import React from 'react';
import { View } from '@tarojs/components';
import { getAppModel } from '../state/appModel';
import { connectionBannerTone, connectionStore, connectionSummary } from '../state/connection';
import { useStore } from '../state/store';
import { useThemeClass } from '../framework/hook';
import { useAppShare } from '../framework/share';
import { CardDetailHost } from './cardDetail';
import { ConnectionBanner } from './connectionBanner';

/**
 * 页面外壳：主题 class + 全局连接横幅 + 全局卡片详情弹层 + 转发/朋友圈内容。
 *
 * 这三样原来都挂在 app.tsx 的 App 组件里，但 **Taro 的小程序端不会把 App 组件渲染出的
 * 节点放进任何页面**：小程序每个页面是独立的自定义组件，Taro 只把该页面自己的 React
 * 子树序列化成 `root` 数据，App 那一层 View 不会出现在任何页面的 WXML 里（已在开发者
 * 工具里用 querySelectorAll 实测：`.dsh-app-root` / `connectionBanner` / `cardDetail`
 * 在任何页面上都查不到）。结果是深色主题 class 从没生效、连接横幅从没显示过、卡片详情
 * 弹层也从没打开过。
 *
 * 所以外壳改由每个页面自己包一层：最外层 View 承载主题变量与页面底色，页面原来的
 * `styles.page` 原样嵌在里面（不再额外加一层 View，避免影响流内布局）。横幅与详情层
 * 都是 fixed 定位，不占流内空间。
 */
export function PageShell(props: { children: React.ReactNode }): JSX.Element {
  const themeClass = useThemeClass();
  const connection = useStore(connectionStore);
  // 每个页面都包这一层，转发/朋友圈的内容在这里统一给（页面配置里另需打开开关）。
  useAppShare();
  return (
    <View className={(themeClass + ' dsh-app-root').trim()}>
      <ConnectionBanner
        tone={connectionBannerTone(connection)}
        detail={connectionSummary(connection)}
        onRetry={() => getAppModel().refresh()}
      />
      {props.children}
      <CardDetailHost />
    </View>
  );
}

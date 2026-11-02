import { useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import { getLocale } from '../i18n/strings';
import { ROUTES } from '../route';

/**
 * 右上角胶囊菜单里的「转发给朋友」「分享到朋友圈」。
 *
 * 为什么之前是灰的：小程序只有在页面定义了 onShareAppMessage / onShareTimeline 时才点亮这两项，
 * 而 Taro 只在页面配置写了 `enableShareAppMessage` / `enableShareTimeline` 时才给原生页面挂上
 * 这两个方法（不能默认注册，因为它们决定按钮亮不亮）。项目里一个页面都没写，于是全灰。
 * 现在每个页面的 index.config.ts 都打开这两个开关，内容统一由这里给（PageShell 里调用）。
 *
 * 分享出去的只是「小程序本身」，不带会话：
 *  · 转发一律落到首页，不带 sessionId——对方的微信没和你的电脑配对，会话打不开，
 *    带上只会把会话 id 漏出去；首页在未配对时就是配对引导。
 *  · 卡片图用包里的固定图。不给 imageUrl 时微信会截当前页面当封面，在会话页上等于把
 *    对话内容截给了对方。
 *  · 朋友圈只能分享当前页（单页模式打开），query 留空，同样不带会话。
 */
const SHARE_IMAGE = '/assets/share.png';

function shareTitle(): string {
  return getLocale() === 'en'
    ? 'Use DeepSeek Harness on your computer from WeChat'
    : '在微信里远程使用电脑上的 DeepSeek Harness';
}

/** 在页面组件树里调用一次即可（Taro 的页面生命周期 hook 按 PageContext 绑定到所在页面）。 */
export function useAppShare(): void {
  useShareAppMessage(() => ({ title: shareTitle(), path: ROUTES.INDEX, imageUrl: SHARE_IMAGE }));
  useShareTimeline(() => ({ title: shareTitle(), query: '', imageUrl: SHARE_IMAGE }));
}

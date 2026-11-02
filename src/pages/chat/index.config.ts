export default definePageConfig({
  // 标题（会话名）由 ui/navBar.tsx 画，不再写进微信导航栏。
  // 转写自己就是滚动容器：页面级滚动会和 ScrollView 抢手势，还会把输入区顶飞。
  disableScroll: true,
  // 点亮胶囊菜单的「转发给朋友」「分享到朋友圈」；分享内容见 src/framework/share.ts。
  enableShareAppMessage: true,
  enableShareTimeline: true,
});

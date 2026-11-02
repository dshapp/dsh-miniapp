export default definePageConfig({
  // 标题（当前电脑名）由 ui/navBar.tsx 画，不再写进微信导航栏。
  enablePullDownRefresh: true,
  onReachBottomDistance: 120,
  // 点亮胶囊菜单的「转发给朋友」「分享到朋友圈」；分享内容见 src/framework/share.ts。
  enableShareAppMessage: true,
  enableShareTimeline: true,
});

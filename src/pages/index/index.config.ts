export default definePageConfig({
  // 标题（当前电脑名）由 ui/navBar.tsx 画，不再写进微信导航栏。
  enablePullDownRefresh: true,
  onReachBottomDistance: 120,
});

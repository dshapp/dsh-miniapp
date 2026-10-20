export default definePageConfig({
  // 标题栏由 ui/navBar.tsx 自己画（全局 navigationStyle: custom），
  // 这里的 navigationBarTitleText 不再有效，所以直接不写。
  enablePullDownRefresh: false,
  // 点亮胶囊菜单的「转发给朋友」「分享到朋友圈」；分享内容见 src/framework/share.ts。
  enableShareAppMessage: true,
  enableShareTimeline: true,
});

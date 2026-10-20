export default definePageConfig({
  // 标题由 ui/navBar.tsx 画（见 pages/settings/index.tsx 的 NavBar）。
  // 点亮胶囊菜单的「转发给朋友」「分享到朋友圈」；分享内容见 src/framework/share.ts。
  enableShareAppMessage: true,
  enableShareTimeline: true,
});

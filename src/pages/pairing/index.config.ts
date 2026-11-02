export default definePageConfig({
  // 标题由 ui/navBar.tsx 画，并且跟着界面语言走——写进微信导航栏的话只能是
  // 编译期常量，英文界面上会露出中文。
  // 点亮胶囊菜单的「转发给朋友」「分享到朋友圈」；分享内容见 src/framework/share.ts。
  enableShareAppMessage: true,
  enableShareTimeline: true,
});

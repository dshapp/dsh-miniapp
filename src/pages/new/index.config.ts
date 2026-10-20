export default definePageConfig({
  // 安卓这页顶栏没有标题（`title = {}`），只留返回键。改用自定义导航栏之后
  // 这条返回键由页面自己画（见 pages/new/index.tsx 的 NavBar）。
  // 点亮胶囊菜单的「转发给朋友」「分享到朋友圈」；分享内容见 src/framework/share.ts。
  enableShareAppMessage: true,
  enableShareTimeline: true,
});

export default definePageConfig({
  // 标题栏由 ui/navBar.tsx 自己画（全局 navigationStyle: custom），
  // 这里的 navigationBarTitleText 不再有效，所以直接不写。
  enablePullDownRefresh: false,
});

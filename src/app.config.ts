import { MAIN_ROUTE } from './route';

export default defineAppConfig({
  pages: Object.values(MAIN_ROUTE),
  // 打开 darkmode 才能从 wx.getAppBaseInfo().theme 读到系统的 light/dark。
  // 不配这一项时该字段永远是 undefined，设置页的「跟随系统」会静默地一直解析成浅色——
  // 这正是本项修复的缺陷。（小程序没有安卓那样的壁纸动态取色，这里只用它判深浅。）
  darkmode: true,
  // darkmode:true 时 themeLocation 是必填项（微信会直接校验），指向随包发布的 theme.json。
  themeLocation: 'theme.json',
  window: {
    backgroundTextStyle: 'light',
    // 全局自定义导航栏：微信自带的 navigationBar 只能在编译期写死标题、放不下任何按钮，
    // 与安卓端 TopAppBar（标题位变搜索框、右侧一排动作）根本对不上。改成 custom 之后
    // 顶栏全部由 ui/navBar.tsx 自己画，右上角只剩微信不让动的胶囊。
    navigationStyle: 'custom',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: 'DeepSeek Harness',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f5f6f8',
  },
  // 这里曾有 permission['scope.camera'].desc，但 app.json 的 permission 只接受
  // 位置类 scope（scope.userLocation 等），相机不在其中，基础库会直接报
  // invalid app.json permission["scope.camera"]。相机授权由 wx.scanCode 首次调用时
  // 按需弹出，不需要也无法在这里预声明，故移除。
});

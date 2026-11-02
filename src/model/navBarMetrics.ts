/**
 * 自定义标题栏的高度公式（纯计算，不碰任何平台 API）。
 *
 * 小程序把导航栏画在原生层：标题只能在编译期写死、图标一个都放不上去，与安卓端的
 * TopAppBar（标题位能变搜索框、右侧一排动作）根本对不上。所以全局开
 * `navigationStyle: "custom"`，把导航栏让给我们自己画，右上角只剩微信不让动的胶囊。
 *
 * 高度按官方口径推：
 *
 *   状态栏到胶囊的间距 = 胶囊距上边界 - 状态栏高度
 *   标题栏内容高       = 该间距 * 2 + 胶囊高度      （胶囊上下间距相等，所以 *2）
 *   导航栏总高         = 状态栏高度 + 标题栏内容高
 *
 * 这么算出来的条子，垂直中线恰好与胶囊重合：返回键、标题、动作按钮因此天然与胶囊
 * 同一水平线，换任何机型都不会错位。
 *
 * 公式与兜底单独放在 model/ 层：它是纯函数，可以像其它渲染口径一样被单测钉住
 * （见 scripts/test/navBarMetrics.test.ts）；碰 `wx` 的部分在 framework/navbar.ts。
 */
export interface NavMetrics {
  /** 状态栏高度（信号/时间那一条）。 */
  statusBarHeight: number;
  /** 胶囊高度。 */
  menuHeight: number;
  /** 胶囊宽度。 */
  menuWidth: number;
  /** 胶囊距屏幕上边界的距离。 */
  menuTop: number;
  /** 状态栏到胶囊的间距，也等于胶囊到标题栏下边界的间距。 */
  menuGap: number;
  /** 胶囊距屏幕右边界的距离。 */
  menuRight: number;
  /** 标题栏内容区高度（不含状态栏）。 */
  barHeight: number;
  /** 导航栏总高度 = 状态栏 + 标题栏内容区。页面正文从这里往下开始画。 */
  totalHeight: number;
  /** 正文右侧要让开的宽度：胶囊宽 + 胶囊左右两边各一份间距。 */
  rightInset: number;
  /** 屏幕宽度，横向布局偶尔要用。 */
  screenWidth: number;
  /** 是否是兜底值（测量失败时为真，仅用于诊断）。 */
  fallback: boolean;
}

/** 胶囊的矩形，字段名与 `wx.getMenuButtonBoundingClientRect()` 一致。 */
export interface MenuButtonRect {
  width: number;
  height: number;
  top: number;
  right: number;
}

export interface SystemMetrics {
  statusBarHeight: number;
  screenWidth: number;
  platform: string;
}

/**
 * 兜底值。
 *
 * `wx.getMenuButtonBoundingClientRect()` 在极少数机型/极早的时机会返回全 0，真按 0 去算
 * 会得到一条 0 高的导航栏，整页内容直接顶进状态栏。所以测不出来时用微信各端实测的
 * 常见值兜底：胶囊 87×32，右边距 7，iOS 上下各 4、其它平台各 8。
 */
export const FALLBACK_MENU_WIDTH = 87;
export const FALLBACK_MENU_HEIGHT = 32;
export const FALLBACK_MENU_RIGHT = 7;
export const FALLBACK_STATUS_BAR = 20;

/** 胶囊测量结果是否可用：宽或高为 0 就是没测出来（此时 top 多半也是 0）。 */
export function isUsableMenuRect(rect: MenuButtonRect | undefined): rect is MenuButtonRect {
  if (rect === undefined) return false;
  return rect.height > 0 && rect.width > 0;
}

/** 按公式算出整套度量；`rect` 缺失或不可用时走兜底。 */
export function computeNavMetrics(system: SystemMetrics, rect: MenuButtonRect | undefined): NavMetrics {
  const statusBarHeight = Number.isFinite(system.statusBarHeight) && system.statusBarHeight > 0
    ? system.statusBarHeight
    : FALLBACK_STATUS_BAR;
  const screenWidth = Number.isFinite(system.screenWidth) && system.screenWidth > 0 ? system.screenWidth : 375;

  if (!isUsableMenuRect(rect)) {
    const gap = system.platform === 'ios' ? 4 : 8;
    return {
      statusBarHeight,
      menuHeight: FALLBACK_MENU_HEIGHT,
      menuWidth: FALLBACK_MENU_WIDTH,
      menuTop: statusBarHeight + gap,
      menuGap: gap,
      menuRight: FALLBACK_MENU_RIGHT,
      barHeight: gap * 2 + FALLBACK_MENU_HEIGHT,
      totalHeight: statusBarHeight + gap * 2 + FALLBACK_MENU_HEIGHT,
      rightInset: FALLBACK_MENU_WIDTH + FALLBACK_MENU_RIGHT * 2,
      screenWidth,
      fallback: true,
    };
  }

  // 间距可能因为机型/基础库算出负数（胶囊被画进状态栏里），夹到 0 以上再用。
  const menuGap = Math.max(0, rect.top - statusBarHeight);
  const menuRight = Math.max(0, screenWidth - rect.right);
  const barHeight = menuGap * 2 + rect.height;
  return {
    statusBarHeight,
    menuHeight: rect.height,
    menuWidth: rect.width,
    menuTop: rect.top,
    menuGap,
    menuRight,
    barHeight,
    totalHeight: statusBarHeight + barHeight,
    rightInset: rect.width + menuRight * 2,
    screenWidth,
    fallback: false,
  };
}

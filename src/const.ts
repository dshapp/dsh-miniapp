/**
 * 业务色值：行内 `style` 用的颜色，一律指向主题的 CSS 自定义属性。
 *
 * 这些常量被 markdown / cards / messageRow / changedFilesCard 当行内样式用了几十处。
 * 行内样式的优先级高于类选择器，所以只要这里是写死的十六进制，`.dsh-theme-dark` 下
 * 那套深色变量就永远盖不住它们——深色主题下正文仍是浅色模式的 #1f2328 铺在近黑底上，
 * 基本读不了。写成 `var(--dsh-*)` 之后同一份取值既跟随主题，也与 .module.scss 里的口径一致。
 *
 * 默认值（浅色）与深色覆盖都在 styles/vars.scss 与 styles/theme.scss 里。
 */
export const color_primary = 'var(--dsh-color-primary)';
export const color_good = 'var(--dsh-color-good)';
export const color_bad = 'var(--dsh-color-bad)';
export const color_warning = 'var(--dsh-color-warning)';
export const color_text = 'var(--dsh-color-text)';
export const color_text_sub = 'var(--dsh-color-text-sub)';
export const color_text_faint = 'var(--dsh-color-text-faint)';
export const color_bg = 'var(--dsh-color-bg)';
export const color_card = 'var(--dsh-color-card)';
export const color_border = 'var(--dsh-color-border)';
export const color_outline = 'var(--dsh-color-outline)';
export const color_surface_variant = 'var(--dsh-color-surface-variant)';
/** 转写里所有「块」的统一底色（代码块、引用、行内码、工具结果、变更文件卡片…）。 */
export const color_card_surface = 'var(--dsh-color-card-surface)';
export const color_on_surface_variant = 'var(--dsh-color-on-surface-variant)';

/** 转写里的度量，对应 Android ui/theme/Theme.kt 的 Dimens（13 项，逐一对齐）。 */
export const DIMENS = {
  columnMaxWidth: 760,
  columnInset: 16,
  rowSpacing: 4,
  messageTopInset: 8,
  cardRadius: 12,
  cardPadding: 12,
  chromeRowHeight: 24,
  /** 卡片行左侧图标：比正文行的图标小一级，跟摘要的字号配套。 */
  iconSlot: 14,
  bubbleRadius: 18,
  listRowPadding: 4,
  stripRowHeight: 44,
  stripIconSlot: 28,
  stripSpacing: 8,
};

export const DEFAULT_TITLE = 'DeepSeek Harness';
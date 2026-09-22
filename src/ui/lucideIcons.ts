/**
 * Lucide 图标表。
 *
 * 由 scripts/build-icons.mjs 生成，不要手改；图标来自
 * https://github.com/lucide-icons/lucide （lucide-static 1.47.0，ISC License）。
 * 码点取自官方 font/codepoints.json，字形子集见 src/styles/lucide.scss。
 */

export const LUCIDE_CODEPOINTS = {
  archive: 0xe041,
  'arrow-down': 0xe042,
  'arrow-left': 0xe048,
  'arrow-up': 0xe04a,
  ban: 0xe051,
  bell: 0xe059,
  'book-open': 0xe05f,
  camera: 0xe064,
  check: 0xe06c,
  'chevron-down': 0xe06d,
  'chevron-left': 0xe06e,
  'chevron-right': 0xe06f,
  'chevron-up': 0xe070,
  circle: 0xe076,
  'circle-alert': 0xe077,
  'pause-circle': 0xe07f,
  'circle-help': 0xe082,
  clock: 0xe087,
  'cloud-off': 0xe08d,
  code: 0xe093,
  copy: 0xe09e,
  ellipsis: 0xe0b6,
  'ellipsis-vertical': 0xe0b7,
  'file-text': 0xe0cc,
  flag: 0xe0d1,
  folder: 0xe0d7,
  image: 0xe0f6,
  info: 0xe0f9,
  list: 0xe106,
  'loader-circle': 0xe10a,
  'maximize-2': 0xe113,
  menu: 0xe115,
  'message-circle': 0xe116,
  paperclip: 0xe12d,
  pause: 0xe12e,
  play: 0xe13c,
  plus: 0xe13d,
  'refresh-cw': 0xe145,
  'rotate-ccw': 0xe148,
  search: 0xe151,
  send: 0xe152,
  square: 0xe167,
  terminal: 0xe181,
  'trash-2': 0xe18e,
  'triangle-alert': 0xe193,
  users: 0xe1a4,
  wrench: 0xe1b1,
  x: 0xe1b2,
  zap: 0xe1b4,
  'list-checks': 0xe1d0,
  'list-ordered': 0xe1d1,
  hand: 0xe1d7,
  'qr-code': 0xe1df,
  timer: 0xe1e0,
  history: 0xe1f5,
  pencil: 0xe1f9,
  sigma: 0xe201,
  'circle-check': 0xe226,
  pin: 0xe259,
  'git-fork': 0xe28d,
  puzzle: 0xe29c,
  'file-pen': 0xe31f,
  'folder-tree': 0xe33c,
  'circle-dot': 0xe345,
  brain: 0xe3c6,
  'fold-vertical': 0xe43c,
  'list-filter': 0xe460,
  'move-right': 0xe490,
  'text-quote': 0xe49e,
  'search-x': 0xe4ad,
  'circle-dashed': 0xe4b0,
  layers: 0xe529,
  'square-check': 0xe559,
} as const;

/** 图标名；用错名字会在编译期报错。 */
export type LucideIconName = keyof typeof LUCIDE_CODEPOINTS;

/** 取图标的字符（Lucide 私有使用区码点），直接放进 <Text>。 */
export function lucideIcon(name: LucideIconName): string {
  return String.fromCodePoint(LUCIDE_CODEPOINTS[name]);
}

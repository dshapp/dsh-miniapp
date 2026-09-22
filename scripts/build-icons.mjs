/**
 * 生成 Lucide 图标集。
 *
 * 图标全部来自 https://github.com/lucide-icons/lucide（lucide-static 发行包里的官方
 * `lucide.ttf` 图标字体，ISC License）。小程序里不方便引 SVG 组件，所以把图标当字体
 * 字形用：脚本从官方 codepoints.json 取码点生成 src/ui/lucideIcons.ts，再从中裁出
 * 只含这些字形的 woff2 子集（几 KB），base64 内联进 src/styles/lucide.scss。
 *
 * 重新生成：
 *   node scripts/build-icons.mjs
 * 依赖：python3 -m pip install fonttools brotli（子集化用），以及一次联网下载字体。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = resolve(ROOT, '.icon-cache');
const LUCIDE_VERSION = '1.47.0';
const LUCIDE_BASE = 'https://cdn.jsdelivr.net/npm/lucide-static@' + LUCIDE_VERSION;
const ICONS_TS = resolve(ROOT, 'src/ui/lucideIcons.ts');
const SCSS = resolve(ROOT, 'src/styles/lucide.scss');

/** 项目用到的 Lucide 图标清单；改这里之后重跑脚本，两个生成物会一起更新。 */
const ICONS = [
  'archive', 'arrow-down', 'arrow-left', 'arrow-up', 'ban', 'bell', 'book-open', 'brain',
  'check', 'chevron-down', 'chevron-left', 'chevron-right', 'chevron-up', 'circle', 'circle-alert',
  'circle-dashed', 'circle-dot', 'circle-help', 'cloud-off', 'copy', 'fold-vertical',
  'camera', 'ellipsis', 'file-pen', 'file-text', 'flag', 'folder-tree', 'git-fork', 'hand',
  'history', 'image', 'info', 'list', 'list-filter', 'list-ordered', 'ellipsis-vertical', 'loader-circle', 'maximize-2', 'menu', 'message-circle', 'move-right',
  // 第三轮对齐安卓补的字形：垃圾桶（移除配对）、文件夹/图层（新建会话胶囊）、
  // 清单/圆圈勾（待办）、时钟（队列）、暂停圈（目标条）。
  'trash-2', 'folder', 'layers', 'list-checks', 'circle-check', 'clock', 'pause-circle',
  'paperclip', 'pause', 'pencil', 'pin', 'play', 'plus', 'refresh-cw', 'rotate-ccw',
  'code', 'puzzle', 'search', 'search-x', 'send', 'sigma', 'square', 'square-check',
  'qr-code', 'terminal', 'text-quote', 'timer', 'triangle-alert', 'users',
  'wrench', 'x', 'zap',
];

function download(path, file) {
  const target = resolve(CACHE, file);
  if (existsSync(target)) return target;
  mkdirSync(CACHE, { recursive: true });
  execFileSync('curl', ['-fsSL', '-o', target, LUCIDE_BASE + '/' + path], { stdio: 'inherit' });
  return target;
}

const codepoints = JSON.parse(readFileSync(download('font/codepoints.json', 'codepoints.json'), 'utf8'));
const entries = ICONS.map((name) => {
  const cp = codepoints[name];
  if (typeof cp !== 'number') throw new Error('lucide ' + LUCIDE_VERSION + ' 没有这个图标: ' + name);
  return { name, cp };
});
entries.sort((a, b) => a.cp - b.cp);

const header = [
  '/**',
  ' * Lucide 图标表。',
  ' *',
  ' * 由 scripts/build-icons.mjs 生成，不要手改；图标来自',
  ' * https://github.com/lucide-icons/lucide （lucide-static ' + LUCIDE_VERSION + '，ISC License）。',
  ' * 码点取自官方 font/codepoints.json，字形子集见 src/styles/lucide.scss。',
  ' */',
  '',
  'export const LUCIDE_CODEPOINTS = {',
];
const rows = entries.map(({ name, cp }) => {
  const key = /^[a-z][a-zA-Z0-9]*$/.test(name) ? name : "'" + name + "'";
  return '  ' + key + ': 0x' + cp.toString(16).padStart(4, '0') + ",";
});
const footer = [
  '} as const;',
  '',
  '/** 图标名；用错名字会在编译期报错。 */',
  'export type LucideIconName = keyof typeof LUCIDE_CODEPOINTS;',
  '',
  '/** 取图标的字符（Lucide 私有使用区码点），直接放进 <Text>。 */',
  'export function lucideIcon(name: LucideIconName): string {',
  '  return String.fromCodePoint(LUCIDE_CODEPOINTS[name]);',
  '}',
  '',
];
writeFileSync(ICONS_TS, header.concat(rows, footer).join('\n'));

const ttf = download('font/lucide.ttf', 'lucide.ttf');
const woff2 = resolve(CACHE, 'lucide-subset.woff2');
execFileSync(
  'python3',
  [
    '-m', 'fontTools.subset', ttf,
    '--unicodes=' + entries.map(({ cp }) => 'U+' + cp.toString(16).toUpperCase()).join(','),
    '--flavor=woff2',
    '--output-file=' + woff2,
  ],
  { stdio: 'inherit' },
);

// 字形又少又小，统一嵌成 base64 的 woff2（小程序 image 也认 data: 的 svg，字体更稳）。
// 微信只认 url(...) 形式的数据源，所以这里自己拼 @font-face，不写成 base64 里带引号的写法。
const base64 = readFileSync(woff2).toString('base64');
writeFileSync(
  SCSS,
  [
    '// 由 scripts/build-icons.mjs 生成，不要手改。',
    '//',
    '// Lucide ' + LUCIDE_VERSION + ' 官方图标字体 lucide.ttf 的子集，仅保留',
    '// src/ui/lucideIcons.ts 用到的 ' + entries.length + ' 个字形。来源：',
    '// https://github.com/lucide-icons/lucide （ISC License）。',
    '',
    '@font-face {',
    "  font-family: 'lucide';",
    "  font-style: normal;",
    "  font-weight: normal;",
    "  src: url('data:font/woff2;base64," + base64 + "') format('woff2');",
    '}',
    '',
  ].join('\n'),
);

console.log('图标 ' + entries.length + ' 个：' + entries.map(({ name }) => name).join(', '));
console.log('woff2 ' + readFileSync(woff2).length + 'B -> ' + SCSS);

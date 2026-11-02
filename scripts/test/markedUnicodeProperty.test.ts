/**
 * config/expandUnicodePropertyLoader.cjs 的回归：marked 里的 Unicode 属性转义必须在构建期
 * 全部展开，且展开结果与原来的 \p{…} 逐码点等价。
 *
 * 背景：安卓微信的小程序 JS 引擎不支持 \p{…}，marked 12 在模块加载时就 new RegExp(…, 'u')，
 * 会话页一加载就抛 SyntaxError，被 Taro 吞成整页空白。开发者工具是新版 Chromium，测不出来。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const loader = require('../../config/expandUnicodePropertyLoader.cjs') as {
  expandMarkedSource(source: string): string;
  classBody(properties: string[]): string;
};

const MARKED_FILES = ['marked.esm.js', 'marked.cjs', 'marked.umd.js'];

function sameSet(expanded: RegExp, original: RegExp): number {
  let diff = 0;
  for (let cp = 0; cp < 0x110000; cp += 1) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const ch = String.fromCodePoint(cp);
    if (expanded.test(ch) !== original.test(ch)) diff += 1;
  }
  return diff;
}

test('marked 各发行文件展开后不再含 Unicode 属性转义', () => {
  for (const file of MARKED_FILES) {
    const source = readFileSync(new URL('../../node_modules/marked/lib/' + file, import.meta.url), 'utf8');
    assert.match(source, /\\\\p\{P\}\\\\p\{S\}/, file + ' 里应当还有 \\p{P}\\p{S}（否则说明 marked 变了，loader 要跟着看）');
    const out = loader.expandMarkedSource(source);
    const code = out.replace(/^[ \t]*\/\/.*$/gm, '');
    assert.equal(/\\p\{/.test(code), false, file + ' 展开后仍有 \\p{');
  }
});

test('展开的区间与 \\p{P}\\p{S} / \\p{L}\\p{N} 逐码点等价', () => {
  assert.equal(sameSet(new RegExp('[' + loader.classBody(['P', 'S']) + ']', 'u'), /[\p{P}\p{S}]/u), 0);
  assert.equal(sameSet(new RegExp('[' + loader.classBody(['L', 'N']) + ']', 'u'), /[\p{L}\p{N}]/u), 0);
});

test('展开后的 marked 仍能正常解析强调', () => {
  const source = readFileSync(new URL('../../node_modules/marked/lib/marked.cjs', import.meta.url), 'utf8');
  const sandboxModule = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(loader.expandMarkedSource(source), { module: sandboxModule, exports: sandboxModule.exports, require });
  const marked = sandboxModule.exports as { marked: { parse(md: string): string } };
  assert.equal(marked.marked.parse('a **b**，c *d*。_e_!').trim(), '<p>a <strong>b</strong>，c <em>d</em>。<em>e</em>!</p>');
});

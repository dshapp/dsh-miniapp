/**
 * 渲染层真正用的那个 marked 实例（src/model/markdownLexer.ts）在安卓黄金语料上的回归。
 *
 * gfmAutolink.test.ts 测的是纯函数模块本身；这一份测的是**接线**：marked 的
 * `url` tokenizer 有没有真的关掉、inline 扩展有没有在强调之前接管、`emStrong` 的让位
 * 有没有生效。少任何一条，纯函数再对，屏幕上的链接也是错的。
 *
 * 语料在安卓仓（权威口径，不在本仓内）：
 *   /Users/user/dshapp/dsh-androidapp/app/src/test/resources/gfm-autolink-golden.json
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lex } from '../../src/model/markdownLexer';
import { findTransformAutolinks } from '../../src/model/gfmAutolink';
import { decodeEntities } from '../../src/model/markdownText';

const GOLDEN_PATH = '/Users/user/dshapp/dsh-androidapp/app/src/test/resources/gfm-autolink-golden.json';

type GoldenCase = [string, [string, string][], string];

interface LooseToken {
  type: string;
  raw: string;
  text?: string;
  href?: string;
  tokens?: LooseToken[];
  items?: LooseToken[];
  header?: { tokens: LooseToken[] }[];
  rows?: { tokens: LooseToken[] }[][];
}

/** 链接的可见文本：与渲染层 renderInline 走同一条遍历。 */
function linkLabel(token: LooseToken): string {
  let out = '';
  const walk = (list: LooseToken[] | undefined): void => {
    for (const item of list ?? []) {
      if (item.type === 'dshAutolink') out += item.text ?? '';
      else if (item.type === 'text' || item.type === 'escape' || item.type === 'codespan') {
        out += decodeEntities(item.text ?? '');
      } else if (item.tokens) walk(item.tokens);
    }
  };
  walk(token.tokens);
  return out;
}

/**
 * 按文档顺序收集链接，与渲染层一致：词法层的 dshAutolink 直接算一条，
 * 相邻的文本/转义先拼回一个整体再交给语法树层（前置字符判定以节点开头为准）。
 */
function collect(tokens: LooseToken[] | undefined, links: [string, string][]): void {
  let buffer = '';
  const flush = (): void => {
    if (buffer.length === 0) return;
    for (const match of findTransformAutolinks(buffer)) links.push([match.href, match.text]);
    buffer = '';
  };
  for (const token of tokens ?? []) {
    if (token.type === 'text' && !token.tokens) {
      buffer += decodeEntities(token.raw);
      continue;
    }
    if (token.type === 'escape') {
      buffer += token.raw.slice(1);
      continue;
    }
    flush();
    if (token.type === 'image') continue;
    if (token.type === 'dshAutolink') {
      links.push([token.href ?? '', token.text ?? '']);
      continue;
    }
    if (token.type === 'link') {
      links.push([token.href ?? '', linkLabel(token)]);
      continue;
    }
    // 代码、原始 HTML、换行等都不参与链接识别。
    if (['code', 'codespan', 'html', 'br', 'space', 'hr'].includes(token.type)) continue;
    if (token.type === 'table') {
      for (const row of [token.header ?? [], ...(token.rows ?? [])]) {
        for (const cell of row) collect(cell.tokens, links);
      }
      continue;
    }
    if (token.type === 'list') {
      for (const item of token.items ?? []) collect(item.tokens, links);
      continue;
    }
    if (token.tokens) collect(token.tokens, links);
  }
  flush();
}

function linksOf(source: string): [string, string][] {
  const links: [string, string][] = [];
  // 与安卓 Markdown.kt#parseMarkdown 一致：文档开头的一个 U+FEFF 先摘掉。
  collect(lex(source.startsWith('\ufeff') ? source.slice(1) : source) as unknown as LooseToken[], links);
  return links;
}

test('渲染层的 marked 配置与安卓黄金语料逐条一致', () => {
  const cases = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenCase[];
  assert.ok(cases.length > 10000, '语料条数不对，检查安卓仓路径');
  const failures: string[] = [];
  for (const [source, expected] of cases) {
    const actual = linksOf(source);
    if (JSON.stringify(actual) !== JSON.stringify(expected) && failures.length < 10) {
      failures.push(JSON.stringify({ source, actual, expected }));
    }
  }
  assert.equal(failures.length, 0, '与安卓口径有差异：\n' + failures.join('\n'));
});

test('marked 自带的 autolink 已经让位', () => {
  // ftp:// 在 marked 自带的口径里会成链，在 GFM 字面量自动链接里不会。
  assert.deepEqual(linksOf('see ftp://example.com/f'), []);
  // 中文域名 marked 自带的口径认不出来。
  assert.deepEqual(linksOf('看 https://例子.测试/路径'), [['https://例子.测试/路径', 'https://例子.测试/路径']]);
  // 强调让位：整条链接不被 *b* 切断。
  assert.deepEqual(linksOf('https://ex.com/a*b*c'), [['https://ex.com/a*b*c', 'https://ex.com/a*b*c']]);
});

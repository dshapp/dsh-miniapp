/**
 * GFM 字面量自动链接：逐条对照安卓 GfmAutolink 的黄金语料。
 *
 * 语料文件在安卓仓（权威口径，不在本仓内）：
 *   /Users/user/dshapp/dsh-androidapp/app/src/test/resources/gfm-autolink-golden.json
 * 每行是 [markdown 源, [[href, 可见文本], ...], 整段可见文本]，由 Web 端
 * micromark + mdast 的 gfm-autolink-literal 生成；安卓 GfmAutolinkTest 跑的是同一份。
 * 显式用例则搬自安卓 ui/component/GfmAutolinkTest.kt。
 *
 * 为什么这里要拼一个 marked 解析壳：语料的输入是 Markdown 源码，而被测模块是纯文本级的
 * 函数，两者中间缺的正是「先把 Markdown 结构解析出来」这一步（行内代码、链接/图片、<> 自动链接、
 * 字符引用、强调切分）。安卓那边这一步由 commonmark 承担，本仓里对应的就是 marked。
 * 这个壳同时也是渲染层接线的参考实现：
 *   1. 词法层 findTokenizerAutolinks 作为 marked 的 inline 扩展，在强调/链接解析之前接管；
 *   2. 语法树层 findTransformAutolinks 跑在剩下的文本节点上。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Marked } from 'marked';
import {
  findAutolinks,
  findTokenizerAutolinks,
  findTransformAutolinks,
  isSafeExternalUrl,
} from '../../src/model/gfmAutolink';

const GOLDEN_PATH = '/Users/user/dshapp/dsh-androidapp/app/src/test/resources/gfm-autolink-golden.json';

/** 语料行：[markdown 源, 期望链接, 期望可见文本]。 */
type GoldenCase = [string, [string, string][], string];

/** marked 的 token 在这里只按结构用，避免为一个测试壳去精确复刻它的联合类型。 */
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

// ---------------------------------------------------------------- Markdown 解析壳

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

/**
 * 字符引用解码：CommonMark 在建树时就把 &amp; 变成 &，语法树层看到的是解码后的文本，
 * 尾随标点剥离才会把这个 & 剥出去。语料只用到具名的 &amp; 与数字引用。
 */
function decodeEntities(s: string): string {
  return s.replace(/&(#\d{1,7}|#[Xx][0-9a-fA-F]{1,6}|\w+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const cp = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!cp || cp > 0x10ffff) return '\ufffd';
      try {
        return String.fromCodePoint(cp);
      } catch {
        return '\ufffd';
      }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}

/** 同一段 inline 源会被 marked 在每个位置各问一次，扫描结果按源文本缓存。 */
const scanCache = new Map<string, ReturnType<typeof findTokenizerAutolinks>>();
function scan(full: string): ReturnType<typeof findTokenizerAutolinks> {
  let cached = scanCache.get(full);
  if (!cached) {
    cached = findTokenizerAutolinks(full);
    scanCache.set(full, cached);
  }
  return cached;
}

const marked = new Marked({ gfm: true });
marked.use({
  tokenizer: {
    /**
     * 关掉 marked 自带的 GFM autolink：它的口径正是要被替换掉的那一套。
     * 注意 marked 的 use() 约定——返回 false 表示「退回原实现」，所以这里返回 undefined。
     */
    url() {
      return undefined;
    },
    /**
     * micromark 的字面量自动链接是词法构造，比强调更早定型；marked 则先切强调。
     * 只在「开标记后面紧跟一个自动链接、且链接体内含同一个强调符」时让位给链接，
     * 复现 https://ex.com/a*b*c 整条成链而不是被 *b* 切断。
     */
    emStrong(src: string) {
      const runChar = src[0];
      let runLength = 0;
      while (runLength < src.length && src[runLength] === runChar) runLength++;
      const hit = scan(src).find((m) => m.start === runLength);
      if (hit && hit.text.indexOf(runChar) >= 0) return undefined;
      return false;
    },
  },
  extensions: [
    {
      name: 'dshAutolink',
      level: 'inline',
      // 让 marked 把文本切到下一个可能的起点，保证每个候选位置都问得到扩展。
      start(src: string) {
        const m = /[0-9A-Za-z+\-._]/.exec(src);
        return m ? m.index : undefined;
      },
      tokenizer(src: string, tokens: LooseToken[]) {
        // 词法层的判定依赖整段 inline 源（前置字符、方括号深度），这里用已消费
        // token 的 raw 还原出当前偏移。
        let prefix = '';
        for (const t of tokens) prefix += t.raw;
        const hit = scan(prefix + src).find((m) => m.start === prefix.length);
        if (!hit) return false;
        return { type: 'dshAutolink', raw: hit.text, href: hit.href, text: hit.text };
      },
    },
  ],
} as Parameters<typeof marked.use>[0]);

function linkLabel(token: LooseToken): string {
  let out = '';
  const walk = (list: LooseToken[] | undefined): void => {
    for (const t of list ?? []) {
      if (t.type === 'dshAutolink') out += t.text ?? '';
      else if (t.type === 'text' || t.type === 'escape' || t.type === 'codespan') out += decodeEntities(t.text ?? '');
      else if (t.tokens) walk(t.tokens);
    }
  };
  walk(token.tokens);
  return out;
}

/**
 * 按文档顺序收集链接。相邻的文本/转义 token 先拼回一个整体再交给语法树层，
 * 因为安卓那边它们本就是同一个 Text 节点，前置字符判定以节点开头为准。
 */
function collect(tokens: LooseToken[] | undefined, links: [string, string][]): void {
  let buffer = '';
  const flush = (): void => {
    if (!buffer) return;
    for (const m of findTransformAutolinks(buffer)) links.push([m.href, m.text]);
    buffer = '';
  };
  for (const t of tokens ?? []) {
    // marked 的 text.text 是给 HTML 渲染用的转义结果（& 会被再转义一次），
    // 取 raw 再按 CommonMark 解码才是树上的文本。
    if (t.type === 'text' && !t.tokens) {
      buffer += decodeEntities(t.raw);
      continue;
    }
    if (t.type === 'escape') {
      buffer += t.raw.slice(1);
      continue;
    }
    flush();
    if (t.type === 'image') continue;
    if (t.type === 'dshAutolink') {
      links.push([t.href ?? '', t.text ?? '']);
      continue;
    }
    if (t.type === 'link') {
      links.push([t.href ?? '', linkLabel(t)]);
      continue;
    }
    // 代码、原始 HTML、换行等都不参与链接识别。
    if (t.type === 'code' || t.type === 'codespan' || t.type === 'html' || t.type === 'br' ||
        t.type === 'space' || t.type === 'hr') {
      continue;
    }
    if (t.type === 'table') {
      for (const row of [t.header ?? [], ...(t.rows ?? [])]) for (const cell of row) collect(cell.tokens, links);
      continue;
    }
    if (t.type === 'list') {
      for (const item of t.items ?? []) collect(item.tokens, links);
      continue;
    }
    if (t.tokens) collect(t.tokens, links);
  }
  flush();
}

/** 和安卓 Markdown.kt#parseMarkdown 一致：文档开头的一个 U+FEFF 先摘掉。 */
function linksOf(source: string): [string, string][] {
  const links: [string, string][] = [];
  collect(marked.lexer(source.startsWith('\ufeff') ? source.slice(1) : source) as unknown as LooseToken[], links);
  return links;
}

// ---------------------------------------------------------------- 语料回归

test('与安卓黄金语料逐条一致', () => {
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

test('命中区间必须是原文的切片且互不重叠', () => {
  const cases = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenCase[];
  for (const [source] of cases) {
    let cursor = 0;
    for (const m of findAutolinks(source)) {
      // 链接化只能切分文本、不能改写：渲染层照着区间切片就该拿到同样的字符。
      assert.equal(m.text, source.slice(m.start, m.end));
      assert.ok(m.start >= cursor && m.end > m.start);
      cursor = m.end;
    }
  }
});

// ---------------------------------------------------------------- 安卓显式用例

test('日常 URL 与邮箱（GfmAutolinkTest.recognisesEverydayUrlsAndEmails）', () => {
  assert.deepEqual(linksOf('看这个 https://example.com/a_b(c) 和 www.ex.com, 联系 a@b.com.'), [
    ['https://example.com/a_b(c)', 'https://example.com/a_b(c)'],
    ['http://www.ex.com', 'www.ex.com'],
    ['mailto:a@b.com', 'a@b.com'],
  ]);
});

test('中文标点留在链接里（GfmAutolinkTest.cjkPunctuationStaysInsideLinkLikeWeb）', () => {
  // Web 端的 trail 字符集不含中文标点，www.ex.com：test 整段都算链接；
  // 这里如实固定该行为，免得被「顺手修掉」而与 Web 端走偏。
  assert.deepEqual(linksOf('www.ex.com：test'), [['http://www.ex.com：test', 'www.ex.com：test']]);
});

test('只有安全协议可点（GfmAutolinkTest.onlySafeProtocolsAreTappable）', () => {
  assert.ok(isSafeExternalUrl('https://example.com'));
  assert.ok(isSafeExternalUrl('http://example.com'));
  assert.ok(isSafeExternalUrl('mailto:a@b.com'));
  assert.ok(!isSafeExternalUrl('javascript:alert(1)'));
  assert.ok(!isSafeExternalUrl('data:text/html,x'));
  assert.ok(!isSafeExternalUrl('dsh-resource://file/tmp/a.txt'));
  assert.ok(!isSafeExternalUrl('file:///tmp/a.txt'));
  assert.ok(!isSafeExternalUrl('/tmp/a.txt'));
});

// ---------------------------------------------------------------- 纯文本入口逐条规则

const hrefs = (text: string): string[] => findAutolinks(text).map((m) => m.href);

test('中文域名与 CJK 紧邻的 URL', () => {
  // 这几条正是 marked 自带口径完全不成链接的场景，是移植的主要动因。
  assert.deepEqual(hrefs('看这个https://example.com/路径?q=1'), ['https://example.com/路径?q=1']);
  assert.deepEqual(hrefs('访问 https://中文域名.中国/页面 看看'), ['https://中文域名.中国/页面']);
  assert.deepEqual(hrefs('请看 https://example.com。'), ['https://example.com。']);
});

test('协议前缀限制', () => {
  assert.deepEqual(hrefs('ftp://x.com'), []);
  assert.deepEqual(hrefs('file:///tmp/a.txt'), []);
  // xmpp: 不是自动链接协议，只有后面的邮箱本体成链。
  assert.deepEqual(hrefs('xmpp:a@b.com'), ['mailto:a@b.com']);
  assert.deepEqual(hrefs('xhttps://ex.com'), []);
  assert.deepEqual(hrefs('http:/ex.com'), []);
});

test('邮箱的前置字符与域名收尾限制', () => {
  // 路径片段不是邮箱。
  assert.deepEqual(hrefs('x/a@b.com'), []);
  assert.deepEqual(hrefs('a@b.com'), ['mailto:a@b.com']);
  assert.deepEqual(hrefs('中文a@b.com中文'), ['mailto:a@b.com']);
  // 顶级域名不能以数字或 _ 收尾。
  assert.deepEqual(hrefs('1@2.3'), []);
  assert.deepEqual(hrefs('see a@b.com_'), []);
});

test('括号配对与尾随标点剥离', () => {
  assert.deepEqual(hrefs('www.example.com/path_(x)'), ['http://www.example.com/path_(x)']);
  assert.deepEqual(hrefs('https://ex.com/a(b)c.'), ['https://ex.com/a(b)c']);
  assert.deepEqual(hrefs('https://ex.com/a(b'), ['https://ex.com/a(b']);
  assert.deepEqual(hrefs('(见 https://ex.com/a)'), ['https://ex.com/a']);
  assert.deepEqual(hrefs('https://ex.com/a, https://ex.com/b.'), ['https://ex.com/a', 'https://ex.com/b']);
});

test('HTML 实体结尾与下划线域名限制', () => {
  // 词法层只看形状（& + 字母 + ;）就把整段当实体剥出链接，不去核对实体名。
  assert.deepEqual(hrefs('www.ex.com&amp;'), ['http://www.ex.com']);
  assert.deepEqual(hrefs('www.ex.com&x;'), ['http://www.ex.com']);
  // 语法树层只按尾随标点集剥，& 之后的字母留在地址里——两层口径本就不同，照搬安卓。
  assert.deepEqual(hrefs('foo.www.ex.com&x;'), ['http://www.ex.com&x']);
  // 渲染层拿到的是已解码文本，&amp; 解码成 & 之后同样被剥掉。
  assert.deepEqual(hrefs(decodeEntities('foo.www.ex.com&amp;')), ['http://www.ex.com']);
  // 域名最后两段带 _ 一律不成链接。
  assert.deepEqual(hrefs('www.a_b.com'), []);
  assert.deepEqual(hrefs('https://ex_ample.com/x'), []);
  assert.deepEqual(hrefs('https://ex.com/a_b_c'), ['https://ex.com/a_b_c']);
});

test('www 的前置字符限制', () => {
  assert.deepEqual(hrefs('www.ex.com'), ['http://www.ex.com']);
  assert.deepEqual(hrefs('见 www.ex.com'), ['http://www.ex.com']);
  // 词中间的 www 不起链接。
  assert.deepEqual(hrefs('awww.ex.com'), []);
  assert.deepEqual(hrefs('foo.www.ex.com'), ['http://www.ex.com']);
});

test('行内代码与未闭合方括号的词法门禁', () => {
  // 反引号内的内容不参与词法层识别。
  assert.equal(findTokenizerAutolinks('`https://ex.com`').length, 0);
  // 未闭合的 [ 之后词法层让位，由语法树层兜底，于是 [x@y.com] 仍然成链。
  assert.equal(findTokenizerAutolinks('[x@y.com]').length, 0);
  assert.deepEqual(hrefs('[x@y.com]'), ['mailto:x@y.com']);
});

test('标点判定表与引擎的 Unicode 属性一致', () => {
  // 表是生成物，这里用引擎自带的 \p{P}|\p{S} 反查一遍，防止它悄悄过期。
  let property: RegExp;
  try {
    property = new RegExp('[\\p{P}\\p{S}]', 'u');
  } catch {
    return; // 引擎不支持属性转义时跳过，模块本身并不依赖它。
  }
  const whitespace = new Set([
    9, 10, 11, 12, 13, 32, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
  ]);
  for (let c = 0x2000; c <= 0x200a; c++) whitespace.add(c);
  for (let c = 0; c <= 0xffff; c++) {
    const ch = String.fromCharCode(c);
    // 语法树层的前置字符判定就是「空白或标点」，拿它当探针。
    const linked = findTransformAutolinks(ch + 'www.a.com').length > 0;
    assert.equal(linked, property.test(ch) || whitespace.has(c), 'U+' + c.toString(16));
  }
});

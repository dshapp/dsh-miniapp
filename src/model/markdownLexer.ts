/**
 * Markdown 词法层：marked 实例的配置与解析缓存。
 *
 * 单独成一个模块（而不是留在 markdown.tsx 里）是为了能在 node 里直接跑——
 * 自动链接的口径要拿安卓那份 10531 条黄金语料回归，而 .tsx 带 JSX，测试进程加载不了。
 * 渲染层只管把这里吐出来的 token 画出来。
 */
import { Marked } from 'marked';
import type { TokensList } from 'marked';
import { findTokenizerAutolinks, type AutolinkMatch } from './gfmAutolink';

/** 词法层认出来的字面量自动链接 token（www./http(s):///邮箱）。 */
export interface AutolinkToken { type: 'dshAutolink'; raw: string; href: string; text: string }

/*
 * 自己的 marked 实例：显式钉住 GFM（删除线、表格、任务列表全靠它），并且把自动链接
 * 换成 model/gfmAutolink 那一套。用实例而不是全局 `marked.use`，免得这些改写外溢到
 * 别处对 marked 的调用。
 *
 * 自动链接为什么不能只在文本节点上做：micromark（web / 安卓走的那条）把字面量自动链接
 * 当成**词法**构造，比强调更早定型——`https://ex.com/a*b*c` 是整条链接，而 marked 会先
 * 把 `*b*` 切成强调。所以这里分两层，与安卓 GfmAutolink 的两层同构：
 *   1. 词法层：一个 inline 扩展，在强调/链接解析之前按整段 inline 源认出自动链接；
 *   2. 语法树层：剩下的纯文本节点再跑一次正则替换。
 */
const marked = new Marked({ gfm: true });

/** 同一段 inline 源会被 marked 在每个位置各问一次，扫描结果按源文本缓存。 */
const autolinkScanCache = new Map<string, AutolinkMatch[]>();
const AUTOLINK_SCAN_LIMIT = 64;

function scanAutolinks(source: string): AutolinkMatch[] {
  const cached = autolinkScanCache.get(source);
  if (cached !== undefined) return cached;
  const matches = findTokenizerAutolinks(source);
  if (autolinkScanCache.size >= AUTOLINK_SCAN_LIMIT) {
    const oldest = autolinkScanCache.keys().next().value;
    if (oldest !== undefined) autolinkScanCache.delete(oldest);
  }
  autolinkScanCache.set(source, matches);
  return matches;
}

marked.use({
  tokenizer: {
    /**
     * 关掉 marked 自带的 GFM autolink：它的口径正是要被替换掉的那一套
     * （ftp:// 会成链、中文域名不成链、带括号的 URL 被截断……）。
     * marked 的约定是「返回 false = 退回原实现」，所以这里必须返回 undefined。
     */
    url(): undefined {
      return undefined;
    },
    /**
     * 强调在这一种场景下给自动链接让位：开标记后面紧跟一个自动链接、且链接体内含
     * 同一个强调符时，整条链接优先（复现 `*https://ex.com/a*b*c` 的 micromark 口径）。
     */
    emStrong(src: string): undefined | false {
      const runChar = src[0];
      let runLength = 0;
      while (runLength < src.length && src[runLength] === runChar) runLength += 1;
      const hit = scanAutolinks(src).find(match => match.start === runLength);
      return hit !== undefined && hit.text.includes(runChar) ? undefined : false;
    },
  },
  extensions: [
    {
      name: 'dshAutolink',
      level: 'inline',
      /** 把文本切到下一个可能的起点，保证每个候选位置都问得到这个扩展。 */
      start(src: string): number | undefined {
        const match = /[0-9A-Za-z+\-._]/.exec(src);
        return match === null ? undefined : match.index;
      },
      tokenizer(src: string, tokens: { raw: string }[]): AutolinkToken | false {
        // 词法层的判定依赖整段 inline 源（前置字符、方括号深度），用已消费 token 的
        // raw 还原出当前偏移。
        let prefix = '';
        for (const token of tokens) prefix += token.raw;
        const hit = scanAutolinks(prefix + src).find(match => match.start === prefix.length);
        if (hit === undefined) return false;
        return { type: 'dshAutolink', raw: hit.text, href: hit.href, text: hit.text };
      },
    },
  ],
} as Parameters<typeof marked.use>[0]);

/*
 * 同一段文本会在滚动、查找高亮时被反复渲染，按文本缓存 lex 结果，
 * 避免每帧都重新解析整篇 Markdown。用简单的 LRU 上限防止长会话把内存吃满。
 */
const lexCache = new Map<string, TokensList>();
const LEX_CACHE_LIMIT = 64;

export function lex(text: string): TokensList {
  const cached = lexCache.get(text);
  if (cached) return cached;
  let tokens: TokensList;
  try {
    tokens = marked.lexer(text);
  } catch {
    // 解析失败不能把整条消息吞掉：退化成一段纯文本，至少内容还看得见。
    tokens = [
      {
        type: 'paragraph',
        raw: text,
        text,
        tokens: [{ type: 'text', raw: text, text }],
      },
    ] as unknown as TokensList;
  }
  if (lexCache.size >= LEX_CACHE_LIMIT) {
    const oldest = lexCache.keys().next().value;
    if (oldest !== undefined) lexCache.delete(oldest);
  }
  lexCache.set(text, tokens);
  return tokens;
}


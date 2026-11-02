/**
 * Markdown 正文的两条硬口径：
 *  · marked 的 lexer 面向 HTML 输出，token 里的 & < > " ' 都被转义过，渲染前必须还原
 *    （安卓走 commonmark AST，拿到的是原字符）；
 *  · 外部链接只放行 http/https/mailto（对齐安卓 isSafeExternalUrl）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { marked } from 'marked';
import { decodeEntities, isSafeExternalUrl } from '../../src/model/markdownText';

test('marked 确实会转义正文，还原后与原文一致', () => {
  const source = 'don\'t say "hi" & a < b';
  const tokens = marked.lexer(source);
  const paragraph = tokens[0] as { tokens: { text: string }[] };
  const raw = paragraph.tokens[0].text;
  assert.notEqual(raw, source, 'marked 若不再转义，这条断言会提醒我们可以去掉还原');
  assert.equal(decodeEntities(raw), source);
});

test('具名与数字实体都能还原', () => {
  assert.equal(decodeEntities('a &amp; b'), 'a & b');
  assert.equal(decodeEntities('&lt;tag&gt;'), '<tag>');
  assert.equal(decodeEntities('&quot;q&quot;'), '"q"');
  assert.equal(decodeEntities('don&#39;t'), "don't");
  assert.equal(decodeEntities('&#x27;'), "'");
});

test('外部链接只放行 http/https/mailto', () => {
  for (const href of ['http://example.com', 'https://example.com/a', 'HTTPS://EXAMPLE.COM', 'mailto:a@b.com']) {
    assert.equal(isSafeExternalUrl(href), true, href);
  }
  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'intent://x', 'tel:+123', 'ftp://h/f', 'relative/path']) {
    assert.equal(isSafeExternalUrl(href), false, href);
  }
});

test('作者自己写的实体与非实体保持原样', () => {
  // 未知具名实体不认，原样留着（避免把作者写的字面量改掉）。
  assert.equal(decodeEntities('&copyright;'), '&copyright;');
  assert.equal(decodeEntities('a & b'), 'a & b');
  assert.equal(decodeEntities('100% & more'), '100% & more');
  // 没有 & 的文本直接短路返回。
  assert.equal(decodeEntities('plain text'), 'plain text');
});

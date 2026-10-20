/** 圈选元素 XML → 键值卡片：逐条对照安卓 model/XmlMessageCardsTest。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  XML_CARD_MAX_ATTRS,
  XML_CARD_MAX_CHARS,
  XML_CARD_MAX_DEPTH,
  XML_CARD_MAX_ELEMENTS,
  parseXmlMessageCards,
  xmlCardsPlainText,
} from '../../src/model/xmlMessageCards';

test('圈选 payload 投影成卡片，属性按文档顺序保留', () => {
  // 回归：小程序把这段 XML 原样铺在用户气泡里。
  const text = [
    '<selected_page_elements url="http://127.0.0.1:1313/docs/" title="DSH App 文档 – DSH App">',
    '<element i="1" tag="span" css="#main &gt; div &gt; nav &gt; span" name="选择端" note="去掉这个" />',
    '</selected_page_elements>',
  ].join('\n');
  const parsed = parseXmlMessageCards(text)!;
  assert.equal(parsed.rootTag, 'selected_page_elements');
  assert.equal(parsed.cards.length, 2);
  assert.deepEqual(parsed.cards[0].attributes, [
    { name: 'url', value: 'http://127.0.0.1:1313/docs/' },
    { name: 'title', value: 'DSH App 文档 – DSH App' },
  ]);
  const element = parsed.cards[1];
  assert.equal(element.position, 2);
  assert.equal(element.tag, 'element');
  assert.deepEqual(element.attributes.map((a) => a.name), ['i', 'tag', 'css', 'name', 'note']);
  assert.equal(element.attributes[2].value, '#main > div > nav > span');
  assert.equal(parsed.remainder, '');
});

test('XML 之后的指令尾巴留给气泡', () => {
  const parsed = parseXmlMessageCards(
    '<selected_page_elements url="https://a.com">\n<element i="1" tag="p" />\n</selected_page_elements>\n\n  [指令] 把它改成红色  ',
  )!;
  assert.equal(parsed.remainder, '[指令] 把它改成红色');
});

test('引号里的 > 与另一种引号属于值本身', () => {
  const parsed = parseXmlMessageCards('<e a="x > y" b=\'say "hi"\' c="it\'s" />')!;
  assert.deepEqual(parsed.cards[0].attributes.map((a) => a.value), ['x > y', 'say "hi"', "it's"]);
});

test('解开实体，认不出的留字面量', () => {
  const parsed = parseXmlMessageCards('<e a="&lt;b&gt; &amp; &quot;q&quot; &#20013;&#x6587; &bogus; &#xD800;" />')!;
  assert.equal(parsed.cards[0].attributes[0].value, '<b> & "q" 中文 &bogus; &#xD800;');
});

test('元素文本落成「文本」行，复制文本与卡片同序', () => {
  const parsed = parseXmlMessageCards('<root id="1"><item k="v">hello <!-- c --> world</item><bare/></root>')!;
  assert.deepEqual(parsed.cards.map((c) => c.tag), ['root', 'item']);
  assert.equal(parsed.cards[1].text, 'hello world');
  assert.equal(xmlCardsPlainText(parsed.cards, '文本'), '#1 root\nid: 1\n\n#2 item\nk: v\n文本: hello world');
});

test('散文与读不动的标记照旧当文本', () => {
  for (const text of [
    '',
    'hello <b>world</b>',
    '<b>no attributes</b>',
    '<e a="1">',
    '<e a="1"></f>',
    '<e a=1 />',
    '<e a="1"><![CDATA[x]]></e>',
    '<e a="unterminated />',
  ]) {
    assert.equal(parseXmlMessageCards(text), undefined, text);
  }
});

test('超过上限退回文本', () => {
  let many = '<r>';
  for (let i = 1; i <= XML_CARD_MAX_ELEMENTS; i += 1) many += '<e i="' + i + '"/>';
  assert.equal(parseXmlMessageCards(many + '</r>'), undefined);
  assert.equal(parseXmlMessageCards('<a x="1">'.repeat(XML_CARD_MAX_DEPTH + 1)), undefined);
  const attrs = Array.from({ length: XML_CARD_MAX_ATTRS + 1 }, (_, i) => 'a' + i + '="v"').join(' ');
  assert.equal(parseXmlMessageCards('<e ' + attrs + ' />'), undefined);
  assert.equal(parseXmlMessageCards('<e a="' + 'x'.repeat(XML_CARD_MAX_CHARS) + '" />'), undefined);
});

test('源码里没有 Unicode 属性转义（安卓微信 JS 引擎不支持）', () => {
  const source = readFileSync(new URL('../../src/model/xmlMessageCards.ts', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/\\p\{/.test(code), false);
});

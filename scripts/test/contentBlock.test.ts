/**
 * 内容块编解码的来回：逐条对照安卓 ContentBlockRoundTripTest。
 *
 * 工具结果的"复制"与错误摘要行都靠这条编码把非文本块摊成文本，丢了嵌套 content
 * 就是整段消失。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeContentBlock, encodeContentBlock, fileAttachmentRefs } from '../../src/model/chatNode';
import type { ContentBlock } from '../../src/model/chatNode';

test('tool-result 保留嵌套内容', () => {
  const block: ContentBlock = {
    kind: 'tool-result', toolCallId: 'call-1', isError: false,
    content: [{ kind: 'text', text: 'first line' }, { kind: 'text', text: 'second line' }],
  };
  const decoded = decodeContentBlock(encodeContentBlock(block));
  assert.equal(decoded.kind, 'tool-result');
  const result = decoded as Extract<ContentBlock, { kind: 'tool-result' }>;
  assert.equal(result.toolCallId, 'call-1');
  assert.equal(result.isError, false);
  assert.deepEqual(result.content.map(item => (item as { text: string }).text), ['first line', 'second line']);
});

test('深层嵌套也活得下来', () => {
  const inner: ContentBlock = {
    kind: 'tool-result', toolCallId: 'inner', isError: true, content: [{ kind: 'text', text: 'deep' }],
  };
  const outer: ContentBlock = { kind: 'tool-result', toolCallId: 'outer', isError: false, content: [inner] };
  const decoded = decodeContentBlock(encodeContentBlock(outer)) as Extract<ContentBlock, { kind: 'tool-result' }>;
  const nested = decoded.content[0] as Extract<ContentBlock, { kind: 'tool-result' }>;
  assert.equal(nested.toolCallId, 'inner');
  assert.equal(nested.isError, true);
  assert.equal((nested.content[0] as { text: string }).text, 'deep');
});

test('普通块照常来回', () => {
  const cases: ContentBlock[] = [
    { kind: 'text', text: 't' },
    { kind: 'reasoning', text: 'r' },
    { kind: 'tool-call', id: 'id', name: 'name', arguments: '{}' },
  ];
  for (const block of cases) {
    assert.deepEqual(decodeContentBlock(encodeContentBlock(block)), block);
  }
});

test('用户消息的 file 块解出文件卡片引用，原样回写', () => {
  const raw = { type: 'file', attachment: { attachmentId: 'att-1', name: 'report.pdf', bytes: 2048 } };
  const content = [decodeContentBlock(raw), decodeContentBlock({ type: 'file' })];
  assert.deepEqual(fileAttachmentRefs(content), [{ attachmentId: 'att-1', name: 'report.pdf', bytes: 2048 }]);
  assert.deepEqual(encodeContentBlock(content[0]), raw);
});

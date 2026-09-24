/**
 * 0.1.7 协议适配：断言都对着 0.1.7-alpha.2 主机的真实 wire 形状
 * （multipart 样本是从本机 0.1.7 主机的 workspaceFiles/readBytes 原样抓下来的）。
 *
 * 只覆盖纯解码与会话 store 的物化，不碰 UI 与网络。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeJobListFrame, decodeWorkspaceFrame } from '../../src/model/frames';
import { agentPresetIsBuiltIn } from '../../src/model/types';
import { agentPresetDisplayText, agentPresetMenuLabel } from '../../src/model/format';
import { decodeSubagentMode } from '../../src/transport/rpcMethods';
import { decodeBinaryResponse, multipartBoundary, parseMultipart } from '../../src/transport/multipart';
import { unwrapServerResponse } from '../../src/transport/envelope';
import { fromBase64, bytesToUtf8, utf8ToBytes, concat } from '../../src/transport/tunnel/crypto/bytes';
import { SessionStore } from '../../src/state/sessionStore';
import { setLocale } from '../../src/i18n/strings';

const ev = (type: string, seq: number, data: unknown) => ({ type, seq, time: seq, data }) as never;

// —— 工具结果：v4 的 role:'tool' 消息 ————————————————————————

const v4Result = (seq: number, callId: string, text: string, extra: Record<string, unknown> = {}) => ev('tool/result', seq, {
  turn: 1, step: 1,
  message: {
    role: 'tool',
    source: { kind: 'tool', callId },
    toolCallId: callId,
    content: [{ type: 'text', text }],
    id: 'm-' + seq,
    ...extra,
  },
});

test('v4 工具结果：内容直接是块，按 toolCallId 接回调用', () => {
  const store = new SessionStore('s1');
  store.apply(ev('tool/call', 10, { callId: 'c1', name: 'bash', arguments: '{}', turn: 1, step: 1 }), undefined);
  store.apply(v4Result(11, 'c1', 'ok'), undefined);
  const call = store.toolCall('c1');
  assert.deepEqual(call?.result?.content?.[0], { kind: 'text', text: 'ok' });
  assert.equal(call?.result?.isError, false);
});

test('v4 工具结果：没有 data.error 的失败只在 message.isError 上，也要算失败', () => {
  const store = new SessionStore('s1');
  store.apply(ev('tool/call', 10, { callId: 'c1', name: 'bash', arguments: '{}', turn: 1, step: 1 }), undefined);
  store.apply(v4Result(11, 'c1', 'Error: boom', { isError: true }), undefined);
  assert.equal(store.toolCall('c1')?.result?.isError, true);
});

test('0.1.6 的 tool-result 包装块仍能解（老主机）', () => {
  const store = new SessionStore('s1');
  store.apply(ev('tool/call', 10, { callId: 'c1', name: 'bash', arguments: '{}', turn: 1, step: 1 }), undefined);
  store.apply(ev('tool/result', 11, {
    turn: 1, step: 1,
    message: {
      source: { kind: 'tool', callId: 'c1' },
      content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'old' }], isError: true }],
    },
  }), undefined);
  const result = store.toolCall('c1')?.result;
  assert.deepEqual(result?.content?.[0], { kind: 'text', text: 'old' });
  assert.equal(result?.isError, true);
});

// —— 消息来源：compact-checkpoint 与 plugin:<名字> ——————————————

test('compact-checkpoint 来源的消息不进转写（0.1.6 的 plugin:compact 也一样）', () => {
  const store = new SessionStore('s1');
  store.apply(ev('user/message', 1, {
    id: 'u1', content: [{ type: 'text', text: 'summary' }], source: { kind: 'compact-checkpoint', compactionId: 'c-1' },
  }), undefined);
  store.apply(ev('user/message', 2, {
    id: 'u2', content: [{ type: 'text', text: 'summary' }], source: { kind: 'plugin', plugin: 'compact' },
  }), undefined);
  assert.equal(store.nodes.filter(node => node.kind === 'turnTrigger' || node.kind === 'user').length, 0);
});

// —— job/list ——————————————————————————————————————————————

test('job/list 的 rows 帧整组替换，带 progress', () => {
  const jobs = decodeJobListFrame({
    type: 'rows',
    jobs: [{
      id: 'bash-1', kind: 'bash', label: 'npm test', owner: 's1', status: 'running', progress: '3/10',
      startedAt: 10, output: { total: 0, earliest: 0 },
    }],
  });
  assert.equal(jobs?.length, 1);
  assert.equal(jobs?.[0].progress, '3/10');
  assert.equal(jobs?.[0].status, 'running');
  assert.equal(decodeJobListFrame({ type: 'other' }), undefined);
  assert.deepEqual(decodeJobListFrame({ type: 'rows' }), []);
});

// —— workspace/follow 的置顶集合 ————————————————————————————

test('workspace 基线带 pinnedSessionIds，pinned 帧整组替换', () => {
  const baseline = decodeWorkspaceFrame({
    type: 'baseline', value: { items: [], archivedSessionIds: [], pinnedSessionIds: ['b', 'a'] },
  });
  assert.equal(baseline.kind, 'baseline');
  assert.deepEqual((baseline as { pinnedSessionIds?: string[] }).pinnedSessionIds, ['b', 'a']);
  const old = decodeWorkspaceFrame({ type: 'baseline', value: { items: [], archivedSessionIds: [] } });
  assert.equal((old as { pinnedSessionIds?: string[] }).pinnedSessionIds, undefined);
  assert.deepEqual(decodeWorkspaceFrame({ type: 'pinned', pinnedSessionIds: ['x'] }), { kind: 'pinned', pinnedSessionIds: ['x'] });
});

// —— 子代理目录与预设 ————————————————————————————————————————

test('subagentCatalog 的 mode 多了 unknown，其余值都按 unknown 处理', () => {
  assert.equal(decodeSubagentMode('continuable'), 'continuable');
  assert.equal(decodeSubagentMode('one-shot'), 'one-shot');
  assert.equal(decodeSubagentMode('unknown'), 'unknown');
  assert.equal(decodeSubagentMode(undefined), 'unknown');
});

test('预设按 id 判内置（code 改名 ptc），自带 name 的一律是用户预设', () => {
  setLocale('zh');
  assert.equal(agentPresetIsBuiltIn({ id: 'ptc', isDefault: false }), true);
  assert.equal(agentPresetIsBuiltIn({ id: 'code', isDefault: false }), false);
  assert.equal(agentPresetIsBuiltIn({ id: 'standard', isDefault: false, name: 'Mine' }), false);
  assert.equal(agentPresetDisplayText({ id: 'ptc', isDefault: false }).name, 'PTC 模式');
  assert.ok((agentPresetDisplayText({ id: 'standard', isDefault: true }).description ?? '').length > 0);
  assert.equal(agentPresetMenuLabel({ id: 'mine', isDefault: false, name: 'Mine' }), 'Mine · 自定义');
  assert.equal(agentPresetMenuLabel({ id: 'minimal', isDefault: false }), '极简模式');
});

// —— readBytes 的 multipart 二进制应答 ——————————————————————

const CONTENT_TYPE = 'multipart/form-data; boundary=----formdata-undici-091268069241';
const SAMPLE = '------formdata-undici-091268069241\r\nContent-Disposition: form-data; name="bytes-0"; filename="blob"\r\nContent-Type: application/octet-stream\r\n\r\n// swift-tools-version: 6.0\n// DeepSeek \r\n------formdata-undici-091268069241\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{"type":"server-response","rpcId":"r1","result":{"ok":true,"value":{"absolutePath":"/Users/user/dshapp/dsh-macapp/Package.swift","version":"16777233:102492974:2594:1789782547330955438:1789782547338959722","bytes":2594,"offset":0,"data":null,"eof":false}},"attachments":[{"path":["data"],"codec":"bytes","part":"bytes-0"}]}\r\n------formdata-undici-091268069241--\r\n';

test('multipart 边界从 content-type 取；非 multipart 返回 undefined', () => {
  assert.equal(multipartBoundary(CONTENT_TYPE), '----formdata-undici-091268069241');
  assert.equal(multipartBoundary('application/json'), undefined);
  assert.equal(multipartBoundary(undefined), undefined);
  assert.equal(multipartBoundary('multipart/form-data; boundary="q b"'), 'q b');
});

test('真实 readBytes 应答：字节按 path 放回 data（base64），信封照常解', () => {
  const text = decodeBinaryResponse(utf8ToBytes(SAMPLE), multipartBoundary(CONTENT_TYPE)!);
  const value = unwrapServerResponse(text, 'r1') as { data: string; bytes: number; eof: boolean };
  assert.equal(value.bytes, 2594);
  assert.equal(value.eof, false);
  assert.equal(bytesToUtf8(fromBase64(value.data)), '// swift-tools-version: 6.0\n// DeepSeek ');
  assert.equal(fromBase64(value.data).length, 40);
});

test('二进制内容里出现 CRLF 与非 UTF-8 字节也不会截断', () => {
  const boundary = 'XyZ';
  const payload = new Uint8Array([0x00, 0xff, 0x0d, 0x0a, 0x2d, 0x2d, 0x0d, 0x0a, 0x80]);
  const body = concat(
    utf8ToBytes('--XyZ\r\nContent-Disposition: form-data; name="bytes-0"\r\n\r\n'),
    payload,
    utf8ToBytes('\r\n--XyZ\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n'),
    utf8ToBytes('{"type":"server-response","rpcId":"r","result":{"ok":true,"value":{"data":null,"eof":true}},"attachments":[{"path":["data"],"codec":"bytes","part":"bytes-0"}]}'),
    utf8ToBytes('\r\n--XyZ--\r\n'),
  );
  const parts = parseMultipart(body, boundary);
  assert.deepEqual(Array.from(parts.get('bytes-0')!), Array.from(payload));
  const value = unwrapServerResponse(decodeBinaryResponse(body, boundary), 'r') as { data: string };
  assert.deepEqual(Array.from(fromBase64(value.data)), Array.from(payload));
});

test('缺附件字段的 multipart 按传输失败抛', () => {
  const body = utf8ToBytes('--B\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{"type":"server-response","rpcId":"r","result":{"ok":true,"value":{"data":null}},"attachments":[{"path":["data"],"codec":"bytes","part":"bytes-0"}]}\r\n--B--\r\n');
  assert.throws(() => decodeBinaryResponse(body, 'B'));
});

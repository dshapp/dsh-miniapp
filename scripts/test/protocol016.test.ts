/**
 * 0.1.6 协议适配的握手测试：逐条对照安卓 Protocol016Test，断言都对着主机真实 wire 形状。
 *
 * 只覆盖纯解码函数（inbox 投影与 placement 推导、权限目录合并、改动汇总与逐文件比较），
 * 不碰 UI 与网络。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeControlFrame, decodeInbox, decodeQueuedItem, queuedItemText, rowsFromInbox } from '../../src/model/frames';
import { decodeChangedFileDiff, decodeTurnChangesSummary } from '../../src/model/turnChanges';
import { permissionCurrentOption, permissionSelectableOptions, permissionSelectionMerge } from '../../src/model/types';

// —— P0-1：0.1.6 的 inbox 投影 ————————————————————————————

const inboxJson = {
  'next-turn': [
    { id: 'm1', role: 'user', content: [{ type: 'text', text: '排队一' }], source: { kind: 'user', rpcId: 'rpc-1' } },
    { id: 'm2', role: 'user', content: [{ type: 'text', text: '排队二' }], source: { kind: 'user' } },
  ],
  'next-step': [
    { id: 'm3', role: 'user', content: [{ type: 'text', text: '插队' }], source: { kind: 'user' } },
    { id: 'm4', role: 'user', content: [{ type: 'text', text: '注入' }], source: { kind: 'plugin', plugin: 'recall' } },
  ],
};

test('inbox 两个列表都解得出来', () => {
  const inbox = decodeInbox(inboxJson);
  assert.equal(inbox?.nextTurn.length, 2);
  assert.equal(inbox?.nextStep.length, 2);
});

test('placement 本地推导：next-turn=queued，next-step 看 source.kind', () => {
  const rows = rowsFromInbox(decodeInbox(inboxJson)!);
  assert.deepEqual(rows.map(row => [row.id, row.placement]), [
    ['m1', 'queued'], ['m2', 'queued'], ['m3', 'steering'], ['m4', 'context'],
  ]);
  assert.equal(rows[0].rpcId, 'rpc-1');
  assert.equal(rows[1].rpcId, undefined);
  assert.equal(queuedItemText(rows[0]), '排队一');
});

test('inbox 容忍缺字段', () => {
  assert.equal(decodeInbox(null), undefined);
  assert.deepEqual(decodeInbox({})?.nextTurn, []);
});

test('0.1.5 的 queue 条目仍要能解（双版本兼容）', () => {
  const item = decodeQueuedItem({
    id: 'q1', placement: 'steering', rpcId: 'rpc-old', message: { content: [{ type: 'text', text: '旧' }] },
  });
  assert.equal(item?.placement, 'steering');
  assert.equal(item?.rpcId, 'rpc-old');
  assert.equal(queuedItemText(item!), '旧');
});

test('0.1.6 的 control 基线没有 queues，0.1.5 的 queue 帧解码路径留着', () => {
  const baseline = decodeControlFrame({ type: 'baseline', value: { jobs: {}, projections: {} } });
  assert.equal(baseline?.kind, 'baseline');
  assert.equal((baseline as { queues: Map<string, unknown> }).queues.size, 0);
  const queue = decodeControlFrame({ type: 'queue', sessionId: 's' });
  assert.equal(queue?.kind, 'queue');
  assert.deepEqual((queue as { frame: { items: unknown[] } }).frame.items, []);
});

// —— P0-2：权限目录 ————————————————————————————————————

test('目录填进收窄后的 permissions 投影', () => {
  const merged = permissionSelectionMerge({ currentValue: 'auto', options: [] }, [
    { value: 'plan', name: 'Plan' }, { value: 'auto', name: 'Auto' }, { value: 'custom', name: 'Custom' },
  ]);
  assert.equal(merged?.currentValue, 'auto');
  assert.equal(merged?.options.length, 3);
  assert.equal(permissionCurrentOption(merged!)?.name, 'Auto');
  // custom 不可选。
  assert.deepEqual(permissionSelectableOptions(merged!).map(option => option.value), ['plan', 'auto']);
});

test('没有目录时退回投影内联的 options', () => {
  const legacy = { currentValue: 'auto', options: [{ value: 'auto', name: 'Auto' }, { value: 'custom', name: 'Custom' }] };
  assert.equal(permissionSelectionMerge(legacy, undefined)?.options.length, 2);
  assert.equal(permissionSelectionMerge(undefined, []), undefined);
});

// —— P1-1：改动汇总与逐文件比较 ——————————————————————————

test('改动汇总解码，畸形文件行丢掉', () => {
  const summary = decodeTurnChangesSummary({
    turn: 3, total: 4, added: 10, deleted: 2,
    files: [
      { path: 'a/One.kt', display: 'a/One.kt', added: 10, deleted: 2 },
      { path: 'a/Two.png', display: 'a/Two.png', added: 0, deleted: 0, binary: true },
      { path: 'a/Big.bin', display: 'a/Big.bin', added: 0, deleted: 0, oversized: true },
      { path: '', display: 'bad' },
    ],
  });
  assert.equal(summary?.turn, 3);
  assert.equal(summary?.total, 4);
  assert.equal(summary?.files.length, 3);
  assert.equal(summary?.files[1].binary, true);
  assert.equal(summary?.files[1].oversized, false);
  assert.equal(summary?.files[2].oversized, true);
});

test('改动汇总拒绝缺 turn 与 turn 0', () => {
  assert.equal(decodeTurnChangesSummary({ total: 0 }), undefined);
  assert.equal(decodeTurnChangesSummary({ turn: 0, total: 0, added: 0, deleted: 0, files: [] }), undefined);
});

test('三种逐文件比较都解得出，未知 kind 拒掉', () => {
  const text = decodeChangedFileDiff({
    kind: 'text', path: 'a/One.kt', display: 'a/One.kt', before: true, after: true, coarse: false,
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }],
  });
  assert.equal(text?.kind, 'text');
  assert.deepEqual((text as { hunks: { lines: string[] }[] }).hunks[0].lines, ['-old', '+new']);
  assert.equal(decodeChangedFileDiff({ kind: 'binary', path: 'p', display: 'd' })?.kind, 'binary');
  assert.equal(decodeChangedFileDiff({ kind: 'oversized', path: 'p', display: 'd' })?.kind, 'oversized');
  assert.equal(decodeChangedFileDiff({ kind: 'weird', path: 'p', display: 'd' }), undefined);
});

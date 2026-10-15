/**
 * dsh 0.2.1-alpha.2 协议差异（对照 Android 2b296b4 / Mac f670941 / 扩展 a95a5ef）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../../src/state/sessionStore';
import { decodeSubagentMode } from '../../src/transport/rpcMethods';
import { goalPhaseAction } from '../../src/model/format';
import { decodeToolError, resultFirstLine } from '../../src/model/chatNode';
import { preparingArguments, toolRowModel } from '../../src/model/toolRow';

const ev = (type: string, seq: number, data: unknown) => ({ type, seq, time: seq, data }) as never;

test('external 子代理不再落成 unknown', () => {
  assert.equal(decodeSubagentMode('external'), 'external');
  assert.equal(decodeSubagentMode('bogus'), 'unknown');
});

test('workingDirectory 投影与 working-directory/change 事件谁新听谁的', () => {
  const store = new SessionStore('s1');
  store.applyProjection({ sessionId: 's1', key: 'workingDirectory', value: '/repo', seq: 3 });
  assert.equal(store.workingDirectoryStore.get(), '/repo');
  store.apply(ev('working-directory/change', 5, { cwd: '/repo/pkg' }), undefined);
  assert.equal(store.workingDirectoryStore.get(), '/repo/pkg');
  store.apply(ev('working-directory/change', 4, { cwd: '/stale' }), undefined);
  assert.equal(store.workingDirectoryStore.get(), '/repo/pkg');
});

test('disarmed 的 active 目标只给恢复；activation 对不上当前版本时不算', () => {
  assert.equal(goalPhaseAction('active', true), 'resume');
  assert.equal(goalPhaseAction('active'), 'pause');
  const store = new SessionStore('s1');
  store.applyProjection({ sessionId: 's1', key: 'goal', value: { goal: { id: 'g1', revision: 2, phase: 'active', objective: 'x' } }, seq: 1 });
  store.setGoalActivation({ id: 'g1', revision: 1, activation: 'disarmed' });
  assert.equal(store.goalDisarmed, false);
  store.setGoalActivation({ id: 'g1', revision: 2, activation: 'disarmed' });
  assert.equal(store.goalDisarmed, true);
});

test('工具失败优先显示 error.reason', () => {
  const error = decodeToolError({ name: 'ToolError', code: 'EIO', reason: 'disk full\nretry later' });
  assert.equal(resultFirstLine({ seq: 1, time: 1, content: [], isError: true, error }), 'disk full');
});

test('参数流式生成时先画「准备中」的工具行，tool/call 落定后让位', () => {
  const store = new SessionStore('s1');
  store.apply(ev('turn/start', 1, { turn: 1 }), undefined);
  store.applyAssistantStreamFrame({ kind: 'start', attemptId: 'a1', revision: 1, startedAfterSeq: 1, turn: 1, step: 1 });
  const chunk = (index: number, value: unknown) =>
    store.applyAssistantStreamFrame({ kind: 'chunk', attemptId: 'a1', revision: 1, index, time: 2, chunk: value as never });
  chunk(0, { type: 'block-start', index: 0, blockType: 'tool-call' });
  chunk(1, { type: 'tool-call-delta', index: 0, id: 'c1', name: 'write', argumentsDelta: '{"file_path":"/repo/a.ts","content":"x' });
  const tools = store.nodes.filter(node => node.kind === 'tool');
  assert.equal(tools.length, 1);
  const data = tools[0].kind === 'tool' ? tools[0].data : undefined;
  assert.equal(data?.preparing, true);
  const row = data === undefined ? undefined : toolRowModel(data, '/repo');
  assert.deepEqual([row?.state, row?.summary, row?.summarySuffix], ['preparing', 'a.ts', '1 KB']);
  store.apply(ev('tool/call', 3, { callId: 'c1', name: 'write', arguments: '{}', turn: 1, step: 1 }), undefined);
  const after = store.nodes.filter(node => node.kind === 'tool');
  assert.deepEqual(after.map(node => (node.kind === 'tool' ? node.data.preparing === true : null)), [false]);
});

test('半截路径不当摘要', () => {
  assert.equal(preparingArguments('read', '{"file_path":"/repo/sr').summary, '');
  assert.equal(preparingArguments('bash', '{"description":"Run tests","command":"np').summary, 'Run tests');
});

test('轮次页脚：停止/失败只交代结局，成功轮（哪怕以工具收尾）才有用时', () => {
  const tail = (reason: string) => {
    const store = new SessionStore('s1');
    store.apply(ev('turn/start', 1, { turn: 1 }), undefined);
    store.apply(ev('tool/call', 2, { callId: 'c1', name: 'bash', arguments: '{}', turn: 1, step: 1 }), undefined);
    store.apply({ type: 'turn/end', seq: 3, time: 4000, data: { turn: 1, reason: { kind: reason } } } as never, undefined);
    const node = store.nodes.find(item => item.kind === 'turnTail');
    return node?.kind === 'turnTail' ? node.data : undefined;
  };
  assert.deepEqual([tail('aborted')?.outcome, tail('aborted')?.runMs], ['stopped', undefined]);
  assert.equal(tail('error')?.outcome, 'failed');
  assert.deepEqual([tail('completed')?.outcome, tail('completed')?.runMs], ['completed', 3999]);
});

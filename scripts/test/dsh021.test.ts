/**
 * dsh 0.2.1-alpha.2 协议差异（对照 Android 2b296b4 / Mac f670941 / 扩展 a95a5ef）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../../src/state/sessionStore';
import { decodeSubagentMode } from '../../src/transport/rpcMethods';
import { goalPhaseAction } from '../../src/model/format';
import { decodeToolError, resultFirstLine } from '../../src/model/chatNode';

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

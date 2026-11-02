/**
 * 0.1.7 对话区可见性（web `isVisibleChatNode` / `turn-trigger`，对照 Mac 267bcde）：
 * system prompt、普通上下文注入、权限命令都不进对话区；唤醒这一轮的非人类消息画成触发通知。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../../src/state/sessionStore';
import { turnTriggerPresentation } from '../../src/model/turnTrigger';

const ev = (type: string, seq: number, data: unknown, extra: Record<string, unknown> = {}) =>
  ({ type, seq, time: seq, data, ...extra }) as never;
const text = (value: string) => [{ type: 'text', text: value }];
const splice = (seq: number, target: string, inserted: unknown[], removedCount = 0, extra: Record<string, unknown> = {}) =>
  ev('agent/inbox/spliced', seq, { target, start: 0, removedCount, inserted, ...extra });

test('system/message 不再出系统提示卡片，也不落进未知 surface', () => {
  const store = new SessionStore('s1');
  store.apply(ev('turn/start', 1, { turn: 1 }), undefined);
  store.apply(ev('system/message', 2, { turn: 1, step: 1, message: { role: 'system', content: text('You are…') } }, { surfaceOp: 'append' }), undefined);
  assert.deepEqual(store.nodes.filter(node => node.kind !== 'turnTail').map(node => node.kind), []);
});

test('developer/message 只留工具增减提示行，其余内容不显示也不落进未知 surface', () => {
  const store = new SessionStore('s1');
  store.apply(ev('turn/start', 1, { turn: 1 }), undefined);
  const dev = (seq: number, content: unknown[]) =>
    ev('developer/message', seq, { turn: 1, step: 1, message: { role: 'developer', content } }, { surfaceOp: 'append' });
  store.apply(dev(2, text('note')), undefined);
  store.apply(dev(3, [{ type: 'tool-addition', toolName: 'a' }, { type: 'tool-removal', toolName: 'c' }]), undefined);
  const rows = store.nodes.filter(node => node.kind !== 'turnTail');
  assert.deepEqual(rows.map(node => node.kind), ['toolChange']);
  const change = rows[0];
  assert.deepEqual(change.kind === 'toolChange' ? [change.data.added, change.data.removed] : [], [['a'], ['c']]);
});

test('普通上下文注入不进对话区', () => {
  const store = new SessionStore('s1');
  store.apply(ev('user/message', 1, { id: 'c1', content: text('AGENTS.md'), source: { kind: 'agent-instructions' } }), undefined);
  store.apply(ev('user/message', 2, { id: 'c2', content: text('recall'), source: { kind: 'plugin:recall' } }), undefined);
  assert.equal(store.nodes.length, 0);
});

test('next-turn 认领的非人类消息画成触发通知，并挡在过程折叠之外', () => {
  const store = new SessionStore('s1');
  const message = { id: 'j1', role: 'user', content: text('job done'), source: { kind: 'tool-jobs' } };
  store.apply(splice(1, 'next-turn', [message]), undefined);
  store.apply(ev('turn/start', 2, { turn: 1 }), undefined);
  store.apply(splice(3, 'next-turn', [], 1), undefined);
  store.apply(ev('step/start', 4, { turn: 1, step: 1 }), undefined);
  store.apply(ev('user/message', 5, message), undefined);
  const trigger = store.nodes.find(node => node.kind === 'turnTrigger');
  assert.equal(trigger?.kind, 'turnTrigger');
  assert.equal(trigger?.kind === 'turnTrigger' ? trigger.data.messageId : undefined, 'j1');
});

test('人类消息同批认领时仍是用户气泡', () => {
  const store = new SessionStore('s1');
  const message = { id: 'u1', role: 'user', content: text('hi'), source: { kind: 'user', rpcId: 'r1' } };
  store.apply(splice(1, 'next-turn', [message]), undefined);
  store.apply(ev('turn/start', 2, { turn: 1 }), undefined);
  store.apply(splice(3, 'next-turn', [], 1), undefined);
  store.apply(ev('user/message', 4, message), undefined);
  assert.deepEqual(store.nodes.filter(node => node.kind !== 'turnTail').map(node => node.kind), ['user']);
});

test('空闲插队：第 1 步里 next-step 认领的非人类消息也算触发', () => {
  const store = new SessionStore('s1');
  const message = { id: 'g1', role: 'user', content: text('continue'), source: { kind: 'goal' } };
  store.apply(ev('turn/start', 1, { turn: 1 }), undefined);
  store.apply(ev('step/start', 2, { turn: 1, step: 1 }), undefined);
  store.apply(splice(3, 'next-step', [message]), undefined);
  store.apply(splice(4, 'next-step', [], 1), undefined);
  store.apply(ev('user/message', 5, message), undefined);
  assert.equal(store.nodes.some(node => node.kind === 'turnTrigger'), true);
});

test('取消的认领不算触发', () => {
  const store = new SessionStore('s1');
  const message = { id: 'g1', role: 'user', content: text('continue'), source: { kind: 'goal' } };
  store.apply(splice(1, 'next-turn', [message]), undefined);
  store.apply(splice(2, 'next-turn', [], 1, { outcome: 'canceled' }), undefined);
  store.apply(ev('user/message', 3, message), undefined);
  assert.equal(store.nodes.length, 0);
});

test('权限命令行不显示，其他命令照常', () => {
  const store = new SessionStore('s1');
  store.apply(ev('command/run', 1, { commandId: 'k1', name: 'permission', args: 'full' }), undefined);
  store.apply(ev('command/run', 2, { commandId: 'k2', name: 'compact' }), undefined);
  const names = store.nodes.filter(node => node.kind === 'command').map(node => node.kind === 'command' ? node.data.name : '');
  assert.deepEqual(names, ['compact']);
});

test('触发来源 → 标题与字形', () => {
  assert.equal(turnTriggerPresentation({ kind: 'schedule' }).title, 'turnTriggerSchedule');
  assert.equal(turnTriggerPresentation({ kind: 'webhook', provider: 'github' }).title, 'turnTriggerGitHub');
  assert.equal(turnTriggerPresentation({ kind: 'webhook' }).title, 'turnTriggerWebhook');
  assert.equal(turnTriggerPresentation({ kind: 'plugin:x' }).title, 'turnTriggerRequest');
  assert.equal(turnTriggerPresentation(undefined).icon, 'file-text');
});

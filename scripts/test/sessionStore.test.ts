/**
 * 会话 store 的几条口径：逐条对照安卓
 * TurnFailureMessageTest / GoalBarGoalTest。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../../src/state/sessionStore';
import { setLocale } from '../../src/i18n/strings';

// —— 工具调用与结果的配对（安卓 ToolResultLinkageTest）————————————

const ev = (type: string, seq: number, data: unknown) => ({ type, seq, time: seq, data }) as never;

const emptyIdResult = (seq: number, text: string) => ev('tool/result', seq, {
  turn: 1, step: 1,
  message: {
    source: { kind: 'tool', callId: '' },
    content: [{ type: 'tool-result', toolCallId: '', content: [{ type: 'text', text }], isError: false }],
  },
});

test('空 callId 的结果接回那条调用，而不是另起一行', () => {
  const store = new SessionStore('s1');
  store.apply(ev('tool/call', 10, { callId: '', name: 'read', arguments: '{}', turn: 1, step: 1 }), undefined);
  assert.notEqual(store.toolCall('seq-10'), undefined);
  store.apply(emptyIdResult(11, 'ok'), undefined);
  assert.equal(store.nodes.filter(node => node.kind === 'tool').length, 1);
  assert.deepEqual(store.toolCall('seq-10')?.result?.content?.[0], { kind: 'text', text: 'ok' });
});

test('一条都接不上时孤儿结果拿到唯一 id', () => {
  const store = new SessionStore('s1');
  store.apply(emptyIdResult(11, 'stray'), undefined);
  assert.notEqual(store.toolCall('orphan-11'), undefined);
});

// —— 失败轮次的文案 ————————————————————————————————————

function failedTurnMessage(error: unknown): string {
  const store = new SessionStore('s1');
  store.apply({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } } as never, undefined);
  store.apply({ type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'error', error } } } as never, undefined);
  const errors = store.nodes.filter(node => node.kind === 'turnError');
  assert.equal(errors.length, 1);
  return (errors[0] as { data: { message: string } }).data.message;
}

test('AUTH 失败用本地化说法', () => {
  setLocale('zh');
  assert.equal(failedTurnMessage({ message: '401 Unauthorized: invalid api key', code: 'AUTH' }), 'API 密钥无效');
  setLocale('en');
  assert.equal(failedTurnMessage({ message: '401 Unauthorized', code: 'AUTH' }), 'API key is invalid');
});

test('没有 message 时兜底也要本地化', () => {
  setLocale('zh');
  assert.equal(failedTurnMessage({ code: 'SERVER' }), '智能体因错误中止。');
  setLocale('en');
});

// —— 目标条画哪个目标 ————————————————————————————————————

function storeWith(phase: string): SessionStore {
  const store = new SessionStore('s1');
  store.applyProjection({
    sessionId: 's1', key: 'goal', seq: 1,
    value: { goal: { id: 'g1', revision: 3, objective: 'ship it', phase } },
  } as never);
  return store;
}

test('完成态的目标不画在输入区上', () => {
  assert.equal(storeWith('complete').activeGoal, undefined);
});

test('active / paused / blocked 都留在输入区上', () => {
  assert.equal(storeWith('active').activeGoal?.id, 'g1');
  assert.equal(storeWith('paused').activeGoal?.id, 'g1');
  assert.equal(storeWith('blocked').activeGoal?.id, 'g1');
});

test('每一条画出来的目标都解析得出可用的 ref', () => {
  for (const phase of ['active', 'paused', 'blocked', 'complete']) {
    const store = storeWith(phase);
    if (store.activeGoal !== undefined) assert.notEqual(store.goalRef, undefined, phase);
  }
});

test('完成态快照留在 store 里，只是不再活跃', () => {
  const store = storeWith('complete');
  assert.notEqual(store.goal, undefined);
  assert.equal(store.activeGoal, undefined);
});

// —— 轮次页脚的用量与用时（安卓 TurnTailRow 的两枚 StatPill）————————

function tailOf(withStart: boolean, firstStep: number) {
  const store = new SessionStore('s1');
  if (withStart) store.apply(ev('turn/start', 1, { turn: 1 }), undefined);
  store.apply(ev('step/start', 2, { step: firstStep }), undefined);
  store.apply(
    {
      type: 'assistant/message',
      seq: 3,
      time: 3000,
      data: {
        turn: 1,
        step: firstStep,
        message: { id: 'm1', source: { provider: 'p', model: 'm' }, content: [{ type: 'text', text: 'hi' }] },
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    } as never,
    undefined,
  );
  store.apply({ type: 'turn/end', seq: 4, time: 4000, data: { turn: 1, reason: { kind: 'completed' } } } as never, undefined);
  const node = store.nodes.find(item => item.kind === 'turnTail');
  return node === undefined ? undefined : (node as { data: { usage?: unknown; runMs?: number } }).data;
}

test('轮次页脚带用量与用时', () => {
  const tail = tailOf(true, 1);
  assert.equal((tail?.usage as { outputTokens?: number } | undefined)?.outputTokens, 50);
  assert.equal((tail?.usage as { uncachedInputTokens?: number } | undefined)?.uncachedInputTokens, 100);
  assert.equal(typeof tail?.runMs, 'number');
});

test('turn/start 被分页裁掉时用量与用时仍然给得出来', () => {
  // 首屏只取最后 15 条消息，历史轮次的 turn/start 常常不在窗口里：只要这一轮的
  // 第 1 步还在，合计就是完整的，页脚不该整个空掉。
  const tail = tailOf(false, 1);
  assert.equal((tail?.usage as { outputTokens?: number } | undefined)?.outputTokens, 50);
  assert.equal((tail?.usage as { uncachedInputTokens?: number } | undefined)?.uncachedInputTokens, 100);
  assert.equal(tail?.runMs, 1000);
});

test('轮次被从中间截断时不给残缺读数', () => {
  const tail = tailOf(false, 3);
  assert.equal(tail?.usage, undefined);
  assert.equal(tail?.runMs, undefined);
});

// —— 轮次过程折叠的边界（对照 Mac 2710859 / efc4175，web `canCollapse`）————————

function foldTranscript(store: SessionStore) {
  let seq = 0;
  const put = (type: string, data: unknown) => store.apply(ev(type, ++seq, data), undefined);
  const user = (id: string) => put('user/message', { id, content: [{ type: 'text', text: id }], source: { kind: 'user' } });
  const reply = (turn: number, step: number, content: unknown[]) =>
    put('assistant/message', { turn, step, message: { id: 'a' + turn + step, content } });
  const toolStep = (turn: number, step: number) => {
    const callId = 'c' + turn + step;
    reply(turn, step, [{ type: 'tool-call', id: callId, name: 'bash', arguments: '{}' }]);
    put('tool/call', { callId, name: 'bash', arguments: '{}', turn, step });
  };
  const text = [{ type: 'text', text: 'done' }];
  // 第 1 轮：工具后给最终回答 → 折到回答之前。
  user('u1'); put('turn/start', { turn: 1 }); toolStep(1, 1); reply(1, 2, text); put('turn/end', { turn: 1, reason: { kind: 'completed' } });
  // 第 2 轮：以工具调用收尾 → 整轮折到 turn/end。
  user('u2'); put('turn/start', { turn: 2 }); toolStep(2, 1); put('turn/end', { turn: 2, reason: { kind: 'completed' } });
  // 第 3 轮：轮中插话 → 不折叠。
  user('u3'); put('turn/start', { turn: 3 }); toolStep(3, 1);
  put('agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 0, inserted: [{ id: 's3', source: { kind: 'user' } }] });
  put('agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 1, inserted: [] });
  user('s3'); reply(3, 2, text); put('turn/end', { turn: 3, reason: { kind: 'completed' } });
  // 第 4 轮：turn/start 之前输入的 /goal 留在折叠头上方。
  user('u4'); put('command/run', { commandId: 'k4', name: 'goal' }); put('turn/start', { turn: 4 });
  toolStep(4, 1); reply(4, 2, text); put('turn/end', { turn: 4, reason: { kind: 'completed' } });
}

test('轮次折叠：插话轮不折、无最终回答整轮折、轮前命令不折进过程', () => {
  const store = new SessionStore('s1');
  store.hasMore = false;
  foldTranscript(store);
  const kinds = store.nodes
    .filter(node => node.kind !== 'turnTail')
    .map(node => (node.kind === 'user' || node.kind === 'steering' ? node.messageId : node.kind));
  assert.deepEqual(kinds, [
    'u1', 'turnProcess', 'assistant',
    'u2', 'turnProcess',
    'u3', 'assistant', 'tool', 's3', 'assistant',
    'u4', 'command', 'turnProcess', 'assistant',
  ]);
});

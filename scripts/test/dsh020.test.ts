/**
 * 对齐 dsh 0.2.0-rc.2 web 的行为（Android `Dsh020ParityTest`、Mac `c710a29`）：
 * 时长单元制、标题口径、rankByName、供应商排序与空组隐藏、question-reply 解析、
 * continued 问题的收起与已回答过滤、答案 payload 形状，以及限时提问的认领 / 倒计时 / 超时回执。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setLocale, Strings } from '../../src/i18n/strings';
import { formatDuration } from '../../src/model/format';
import { rankByName, visibleModelGroups } from '../../src/model/modelSearch';
import { questionAnswerPayload, questionIdentity } from '../../src/model/questionFlow';
import { questionReplyPairs, turnTriggerPresentation } from '../../src/model/turnTrigger';
import { rowsFromInbox } from '../../src/model/frames';
import { SessionStore } from '../../src/state/sessionStore';
import { StreamCoordinator, type StreamSession } from '../../src/state/streamCoordinator';
import type { MuxConnection, MuxEvent, RemoteEventOutcome } from '../../src/transport/types';
import type { ModelProviderGroup } from '../../src/model/types';

const ev = (type: string, seq: number, data: unknown) => ({ type, seq, time: seq, data }) as never;

test('时长单元制：每个数字跟单位、不补零', () => {
  setLocale('en');
  assert.equal(formatDuration(5_900), '5s');
  assert.equal(formatDuration(125_000), '2m 5s');
  assert.equal(formatDuration(3_603_000), '1h 0m 3s');
  setLocale('zh');
  assert.equal(formatDuration(125_000), '2分5秒');
  assert.equal(formatDuration(3_603_000), '1小时0分3秒');
  setLocale('en');
});

test('定时触发卡改为「自动化任务」+ 时钟；迟到回答有自己的标题', () => {
  assert.deepEqual(turnTriggerPresentation({ kind: 'schedule' }), { title: 'turnTriggerSchedule', icon: 'clock' });
  setLocale('zh');
  assert.equal(Strings.turnTriggerSchedule, '自动化任务');
  setLocale('en');
  assert.equal(turnTriggerPresentation({ kind: 'user-question-reply' }).title, 'questionReplyLabel');
});

test('rankByName：前缀命中在前，不是子序列的丢掉，空查询原样返回', () => {
  const names = ['gpt-flash', 'flash-pro', 'deepseek-v4', 'falsh'];
  assert.deepEqual(rankByName(names, 'flash', name => name), ['flash-pro', 'gpt-flash']);
  assert.equal(rankByName(names, '', name => name), names);
  assert.deepEqual(rankByName(names, 'dsv', name => name), ['deepseek-v4']);
  assert.deepEqual(rankByName(names, 'FLASH', name => name), ['flash-pro', 'gpt-flash']);
});

test('供应商排序 DeepSeek 账号 → 官方 → 其余目录顺序；空组隐藏', () => {
  const group = (id: string, ...models: string[]): ModelProviderGroup =>
    ({ id, name: id, models: models.map(model => ({ id: model, name: model })) }) as ModelProviderGroup;
  const groups = [
    group('mock', 'alpha', 'beta'),
    group('deepseek-official', 'chat'),
    group('empty'),
    group('deepseek-account', 'flash'),
  ];
  assert.deepEqual(visibleModelGroups(groups, '').map(item => item.id), ['deepseek-account', 'deepseek-official', 'mock']);
  assert.deepEqual(visibleModelGroups(groups, 'be').map(item => item.id), ['mock']);
  assert.deepEqual(visibleModelGroups(groups, 'zzq'), []);
});

const replyText = JSON.stringify({
  kind: 'answer_to_pending_question', tool: 'ask_user_question', callId: 'c1',
  questions: [{ id: 'q1', question: 'Which DB?' }, { id: 'q2', question: 'Name?' }],
  answers: [{ id: 'q1', selected: ['Postgres'], custom: 'v16' }, { id: 'q2', selected: [] }],
});

test('迟到回答即使没唤醒本轮也画成 question-reply，并读出问题 → 答案', () => {
  const store = new SessionStore('s1');
  store.apply(ev('turn/start', 1, { turn: 1 }), undefined);
  store.apply(ev('user/message', 2, {
    id: 'm1',
    content: [{ type: 'text', text: replyText }],
    source: { kind: 'user-question-reply', callId: 'c1', outcome: 'answered' },
  }), undefined);
  const triggers = store.nodes.filter(node => node.kind === 'turnTrigger');
  assert.equal(triggers.length, 1);
  const data = (triggers[0] as Extract<typeof triggers[0], { kind: 'turnTrigger' }>).data;
  assert.deepEqual(questionReplyPairs(data.content, data.source), [
    { question: 'Which DB?', answers: ['Postgres', 'v16'] },
    { question: 'Name?', answers: [] },
  ]);
  // 别的来源不是迟到回答。
  assert.equal(questionReplyPairs(data.content, { kind: 'schedule' }), undefined);
});

test('continued 问题来自投影，去掉已回答 / 已排队的；收起的让位给下一个', () => {
  const store = new SessionStore('s1');
  store.applyProjection({
    sessionId: 's1',
    key: 'userQuestions',
    seq: 5,
    value: {
      timed: true,
      active: [
        { callId: 'open', questions: [{ id: 'q', question: 'Live?' }], state: 'open' },
        { callId: 'c1', questions: [{ id: 'q', question: 'First?' }], state: 'continued' },
        { callId: 'c2', questions: [{ id: 'q', question: 'Second?' }], state: 'continued' },
        { callId: 'c3', questions: [{ id: 'q', question: 'Third?' }], state: 'continued' },
      ],
      settled: [],
    },
  });
  assert.deepEqual(store.continuedQuestions.map(item => item.callId), ['c1', 'c2', 'c3']);
  assert.equal(store.presentedQuestion?.callId, 'c1');
  assert.equal(store.presentedQuestion?.continued, true);
  store.hideQuestion('c1');
  assert.equal(store.presentedQuestion?.callId, 'c2', '收起的问题让位给下一个');
  store.markQuestionReplied('c2');
  assert.equal(store.presentedQuestion?.callId, 'c3');
  // inbox 里已排着对 c3 的回答。
  store.setQueue({
    sessionId: 's1',
    items: rowsFromInbox({
      nextTurn: [],
      nextStep: [{ id: 'm9', content: [{ type: 'text', text: '{}' }], source: { kind: 'user-question-reply', callId: 'c3' } }],
    }),
  });
  assert.equal(store.presentedQuestion, undefined);
  assert.deepEqual(store.continuedQuestions.map(item => item.callId), ['c1'], '被收起的仍可作答（输入框上方的入口）');
  store.reopenQuestion('c1');
  assert.equal(store.presentedQuestion?.callId, 'c1');
  // 实时 waterfall 优先于 continued 问题。
  store.setQuestion({ eventId: 'e1', sessionId: 's1', questions: [{ id: 'q', question: 'Now?' }] });
  assert.equal(store.presentedQuestion?.eventId, 'e1');
});

test('答案 payload 与 wire 形状一致；问题身份不随倒计时变', () => {
  assert.equal(
    JSON.stringify(questionAnswerPayload([{ id: 'q1', selected: ['A'] }, { id: 'q2', selected: [], custom: 'x' }])),
    '{"answers":[{"id":"q1","selected":["A"]},{"id":"q2","selected":[],"custom":"x"}]}',
  );
  const base = { eventId: 'e1', sessionId: 's1', questions: [], callId: 'c1' };
  assert.equal(questionIdentity(base), questionIdentity({ ...base, deadline: 123, held: true }));
  assert.equal(questionIdentity({ sessionId: 's1', questions: [], callId: 'c1', continued: true }), 'call:c1');
});

// —— 限时提问：attachWait 认领、倒计时、ASK_TIMED_OUT、慢慢回答 ——————————————

interface Harness {
  coordinator: StreamCoordinator;
  store: SessionStore;
  emit: (event: MuxEvent) => void;
  subscribed: { streamId: string; endpoint: string; args: unknown }[];
  unsubscribed: string[];
  settled: { eventId: string; outcome: RemoteEventOutcome }[];
}

function harness(): Harness {
  const store = new SessionStore('s1');
  const subscribed: Harness['subscribed'] = [];
  const unsubscribed: string[] = [];
  const settled: Harness['settled'] = [];
  let emit: (event: MuxEvent) => void = () => {};
  const noop = (): void => {};
  const coordinator = new StreamCoordinator({
    openMux: onEvent => {
      emit = onEvent;
      const connection: MuxConnection = {
        subscribe: (streamId, endpoint, args) => { subscribed.push({ streamId, endpoint, args }); },
        unsubscribe: streamId => { unsubscribed.push(streamId); },
        close: noop,
        probeNow: noop,
      } as MuxConnection;
      return connection;
    },
    listStore: {
      upsert: noop, remove: noop, setRunning: noop, recordActivity: noop,
      markAwaitingUser: noop, clearAwaitingUser: noop, clearAllAwaitingUser: noop, updateProjection: noop,
    },
    workspaceStore: { setWorkspaces: noop, upsert: noop, remove: noop, applyOrder: noop, setArchived: noop },
    sessionLookup: id => (id === 's1' ? (store as unknown as StreamSession) : undefined),
    sessionUpsert: () => store as unknown as StreamSession,
    allSessions: () => [store as unknown as StreamSession],
    remoteEventHandler: noop,
    sessionRemovedHandler: noop,
    sessionsArchivedHandler: noop,
    resyncHandler: noop,
    gapRepairLoader: () => Promise.reject(new Error('unused')),
    attentionHandler: noop,
    settle: async (_clientId, eventId, outcome) => { settled.push({ eventId, outcome }); return true; },
  });
  coordinator.start();
  emit({ kind: 'item', streamId: 'events', value: { type: 'ready', clientId: 'client-1' } });
  return { coordinator, store, emit: event => emit(event), subscribed, unsubscribed, settled };
}

function askTimed(h: Harness, eventId: string): void {
  h.emit({
    kind: 'item',
    streamId: 'events',
    value: {
      type: 'waterfall', event: 'user-questions/request', eventId, agentId: 's1',
      request: { questions: [{ id: 'q', question: 'DB?', options: [{ label: 'Postgres' }] }], wait: { callId: 'c1', timed: true } },
    },
  });
}

test('限时提问：先认领再计时，到点以 ASK_TIMED_OUT 回执并就地撤下', async () => {
  const h = harness();
  askTimed(h, 'e1');
  const claim = h.subscribed.find(item => item.endpoint === 'userQuestions/attachWait');
  assert.deepEqual(claim, { streamId: 'question-wait:e1', endpoint: 'userQuestions/attachWait', args: { agentId: 's1', callId: 'c1' } });
  assert.equal(h.store.pendingQuestion?.callId, 'c1');
  assert.equal(h.store.pendingQuestion?.deadline, undefined, '认领的首帧到之前不计时');
  h.emit({ kind: 'item', streamId: 'question-wait:e1', value: { remainingMs: 20 } });
  assert.ok(h.store.pendingQuestion?.deadline !== undefined);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(h.settled.length, 1);
  assert.deepEqual(h.settled[0], {
    eventId: 'e1',
    outcome: {
      kind: 'rejected',
      name: 'UserQuestionError',
      message: 'ask_user_question timed out before the user answered',
      code: 'ASK_TIMED_OUT',
    },
  });
  assert.equal(h.store.pendingQuestion, undefined, '应答方收不到自己的撤回帧，本地撤下');
  assert.ok(h.unsubscribed.includes('question-wait:e1'));
  h.coordinator.stop();
});

test('慢慢回答 / 开始作答：停掉倒计时，一直等到本端提交', async () => {
  const h = harness();
  askTimed(h, 'e2');
  h.emit({ kind: 'item', streamId: 'question-wait:e2', value: { remainingMs: 20 } });
  const question = h.store.pendingQuestion;
  assert.ok(question !== undefined);
  h.coordinator.holdQuestion(question);
  assert.equal(h.store.pendingQuestion?.held, true);
  assert.equal(h.store.pendingQuestion?.deadline, undefined);
  assert.equal(questionIdentity(h.store.pendingQuestion!), questionIdentity(question), '按住不换身份，草稿不丢');
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(h.settled.length, 0);
  assert.equal(h.store.pendingQuestion?.eventId, 'e2');
  // 本端提交后就地撤下认领。
  h.coordinator.retireLocally('e2');
  assert.equal(h.store.pendingQuestion, undefined);
  assert.ok(h.unsubscribed.includes('question-wait:e2'));
  h.coordinator.stop();
});

test('阻塞式提问不认领、不计时', () => {
  const h = harness();
  h.emit({
    kind: 'item',
    streamId: 'events',
    value: {
      type: 'waterfall', event: 'user-questions/request', eventId: 'e3', agentId: 's1',
      request: { questions: [{ id: 'q', question: 'DB?' }] },
    },
  });
  assert.equal(h.subscribed.some(item => item.endpoint === 'userQuestions/attachWait'), false);
  assert.equal(h.store.pendingQuestion?.eventId, 'e3');
  assert.equal(h.store.pendingQuestion?.callId, undefined);
  h.coordinator.stop();
});

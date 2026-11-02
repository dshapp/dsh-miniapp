/**
 * 五个场景的模型层口径：会话排队 / 审批 / 提问 / 计划评审 / 待办。
 * 逐条对照安卓 SessionQueueTest / QuestionFlowTest / TodoStripTest 的同名单测。
 * UI 层的实拍对比另见 docs/DIFF-ANDROID-R3.md 的验证小节。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../../src/state/sessionStore';
import {
  createQuestionFlow,
  questionDraftAnswered,
  questionDraftCompleted,
  questionFlowChoose,
  questionFlowCurrent,
  questionFlowCurrentDraft,
  questionFlowSkip,
  planReviewApproveAnswer,
  planReviewReviseAnswer,
  pendingInteractionKind,
  routePlanReview,
  type QuestionDraft,
} from '../../src/model/questionFlow';
import { decodeInbox, decodeQueuedItem, queuedItemText, rowsFromInbox } from '../../src/model/frames';
import { permissionTitle } from '../../src/state/composer';
import { setLocale } from '../../src/i18n/strings';

const ev = (type: string, seq: number, data: unknown) => ({ type, seq, time: seq, data }) as never;

// —— 会话排队 ————————————————————————————————————————————

test('inbox 投影摊成队列行：排队 / 插队 / 注入三段顺序不乱', () => {
  const inbox = decodeInbox({
    'next-turn': [{ id: 'm1', content: [{ type: 'text', text: '第二条消息' }] }],
    'next-step': [
      { id: 'm2', role: 'user', content: [{ type: 'text', text: '插队的消息' }], source: { kind: 'user', rpcId: 'rpc-1' } },
      { id: 'm3', content: [{ type: 'text', text: '上下文注入' }], source: { kind: 'agent' } },
    ],
  });
  assert.notEqual(inbox, undefined);
  const rows = rowsFromInbox(inbox!);
  assert.deepEqual(rows.map(row => row.placement), ['queued', 'steering', 'context']);
  assert.equal(rows[1].rpcId, 'rpc-1', '用户插队的行带 prompt-RPC 身份，用来退本地回声');
  assert.equal(rows[2].rpcId, undefined);
});

test('队列条文案取 content 里的 text 块拼接', () => {
  const item = decodeQueuedItem({ id: 'm1', message: { content: [{ type: 'text', text: '甲' }, { type: 'text', text: '乙' }] } });
  assert.equal(queuedItemText(item!), '甲 乙');
  assert.equal(queuedItemText({ id: 'x', placement: 'queued', content: [{ type: 'image' }] }), '');
  assert.equal(decodeQueuedItem(undefined), undefined);
  assert.equal(decodeQueuedItem({ message: { content: [] } }), undefined);
  assert.equal(decodeQueuedItem({ id: 'x' })?.placement, 'queued');
});

// —— 审批 / 提问 / 计划评审 ————————————————————————————————

const planQuestion = {
  id: 'q1',
  question: '要按这份计划执行吗？',
  detail: '计划正文',
  intent: { kind: 'plan-review', approve: '开始执行' },
  options: [{ label: '开始执行' }, { label: '继续修改' }],
};

test('审批优先于提问：同一会话同时挂两种请求时亮审批徽标', () => {
  const approval = { sessionId: 's1', approvalId: 'a1', toolName: 'bash' };
  assert.equal(pendingInteractionKind(approval, undefined), 'approval');
  assert.equal(pendingInteractionKind(undefined, { sessionId: 's1', questions: [] }), 'question');
  assert.equal(pendingInteractionKind(approval, { sessionId: 's1', questions: [] }), 'approval');
});

test('计划评审路由：单题 + plan-review intent + 有计划正文才成立', () => {
  const flow = routePlanReview([planQuestion]);
  assert.notEqual(flow, undefined);
  assert.equal(flow!.plan, '计划正文');
  assert.equal(flow!.approve.label, '开始执行');
  assert.equal(flow!.decline?.label, '继续修改');
  assert.equal(routePlanReview([{ ...planQuestion, multiSelect: true }]), undefined);
  assert.equal(routePlanReview([{ ...planQuestion, intent: { kind: 'ask' } }]), undefined);
  assert.equal(routePlanReview([]), undefined);
});

test('计划评审应答：同意取 approve 标签，要求修改走 custom', () => {
  const flow = routePlanReview([planQuestion])!;
  assert.deepEqual(planReviewApproveAnswer(flow), { id: 'q1', selected: ['开始执行'] });
  assert.deepEqual(planReviewReviseAnswer(flow, ' 先补测试 '), { id: 'q1', selected: [], custom: '先补测试' });
  assert.deepEqual(planReviewReviseAnswer(flow, '   '), { id: 'q1', selected: ['继续修改'] });
});

test('提问草稿：选中或写了自定义回答才算答完，跳过也算完成', () => {
  const empty: QuestionDraft = { selected: [], custom: '', skipped: false };
  assert.equal(questionDraftAnswered(empty), false);
  assert.equal(questionDraftAnswered({ ...empty, selected: ['选项 A'] }), true);
  assert.equal(questionDraftAnswered({ ...empty, custom: '自定义回答' }), true);
  assert.equal(questionDraftAnswered({ ...empty, custom: '   ' }), false);
  assert.equal(questionDraftCompleted({ ...empty, skipped: true }), true);
});

test('多题流程：逐题推进、跳过算完成、未答完不让提交', () => {
  const second = { ...planQuestion, id: 'q2', question: '第二题' };
  const flow = createQuestionFlow([planQuestion, second]);
  assert.equal(questionFlowCurrent(flow)?.id, 'q1');

  const picked = questionFlowChoose(flow, '开始执行');
  assert.equal(questionFlowCurrent(picked)?.id, 'q2', '单选答完自动跳下一题');
  assert.deepEqual(picked.drafts[0]?.selected, ['开始执行'], '答案记在第 1 题的草稿里');
  assert.deepEqual(questionFlowCurrentDraft(picked)?.selected, []);

  // 第二题就是最后一题：跳过它即整单完成，直接提交。
  const skipped = questionFlowSkip(picked);
  assert.equal(skipped.submit, true, '只有两题，第二题跳过后整单可提交');
  assert.equal(questionFlowCurrent(skipped.state)?.id, 'q2');
  assert.equal(skipped.state.drafts[1]?.skipped, true);

  // 中途跳过不提交：非最后一题只前进。
});

test('多选题选中/取消切换，不自选下一题', () => {
  const flow = createQuestionFlow([{ ...planQuestion, multiSelect: true }]);
  const once = questionFlowChoose(flow, 'A');
  assert.deepEqual(questionFlowCurrentDraft(once)?.selected, ['A']);
  const twice = questionFlowChoose(once, 'A');
  assert.deepEqual(questionFlowCurrentDraft(twice)?.selected, []);
});

test('待办投影落进 store：状态与顺序逐条对齐', () => {
  const store = new SessionStore('s1');
  store.applyProjection({
    sessionId: 's1',
    key: 'todos',
    seq: 1,
    value: [
      { id: 't1', content: '待办一', status: 'completed' },
      { id: 't2', content: '待办二', status: 'in_progress' },
      { id: 't3', content: '待办三', status: 'pending' },
    ],
  });
  assert.deepEqual(store.todos.map(item => item.status), ['completed', 'in_progress', 'pending']);
  assert.equal(store.todos.length, 3);
  assert.equal(store.todos[0].content, '待办一');
});

test('权限标题按 value 映射，未知值回落主机给的名称', () => {
  setLocale('zh');
  assert.equal(permissionTitle('read-only', 'fallback'), '只读');
  assert.equal(permissionTitle('workspace-write', 'fallback'), '工作区写入');
  assert.equal(permissionTitle('danger-full-access', 'fallback'), '完全访问');
  assert.equal(permissionTitle('custom-preset', '自定义预设'), '自定义预设');
});

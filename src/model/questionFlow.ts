import { arr, bool, jget, str, type JsonElement } from './json';
import type { SessionId } from './types';
import type { SessionAwaitingKind } from './format';

// 可应答的审批 / 提问 ————————————————————————————————————————

export interface ApprovalRequested {
  eventId?: string;
  sessionId: SessionId;
  approvalId: string;
  toolName: string;
  callId?: string;
  reason?: string;
}

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

export interface AskUserQuestionOption { label: string; description?: string }
export interface QuestionIntent { kind: string; approve?: string }
export interface AskUserQuestionItem {
  id: string;
  question: string;
  header?: string;
  detail?: string;
  options?: AskUserQuestionOption[];
  multiSelect?: boolean;
  intent?: QuestionIntent;
}

export interface QuestionRequested {
  /** 待应答 waterfall 的关联 id；continued 问题没有，它改走 `userQuestions/answer`。 */
  eventId?: string;
  sessionId: SessionId;
  questions: AskUserQuestionItem[];
  /** 这组问题所属的 `ask_user_question` 调用（请求里的 `wait.callId`，0.2.0）。 */
  callId?: string;
  /** 工具调用已经以 pending 返回：agent 继续干活，这时的回答是迟到回答。 */
  continued?: boolean;
  /** 限时等待放行 agent 的时刻（epoch 毫秒，来自 `attachWait` 认领）；阻塞式提问或用户已按住时没有。 */
  deadline?: number;
  /** 用户改了草稿或点了「慢慢回答」：本端一直按住等待，直到提交或取消。 */
  held?: boolean;
}

/** 弹层与草稿的稳定身份：倒计时开始、按住等待都不该把正在填的草稿重置掉（对齐 Android `identity`）。 */
export function questionIdentity(question: QuestionRequested): string {
  return question.eventId === undefined && question.callId !== undefined
    ? 'call:' + question.callId
    : 'event:' + (question.eventId ?? '');
}

export interface QuestionAnswer { id: string; selected: string[]; custom?: string }

/** 一整组答案的 wire 形状 `{answers:[{id, selected, custom?}]}`，waterfall 结果与迟到回答共用。 */
export function questionAnswerPayload(answers: QuestionAnswer[]): { answers: { id: string; selected: string[]; custom?: string }[] } {
  return {
    answers: answers.map(answer => (answer.custom === undefined
      ? { id: answer.id, selected: answer.selected.slice() }
      : { id: answer.id, selected: answer.selected.slice(), custom: answer.custom })),
  };
}

/**
 * `userQuestions` 投影里还能作答的那一半（0.2.0）：仍可回答的限时提问，按提问顺序。
 * `state` 为 `open`（工具调用还可能直接拿到答案）或 `continued`（已 pending 返回）。
 */
export interface UserQuestionRow { callId: string; questions: AskUserQuestionItem[]; state: string }

// Android 用 kotlinx @Serializable 生成提问项的解码；TS 侧没有对应模块，
// 就地解一遍，避免为一个小结构再引一层依赖。
export function decodeAskUserQuestionItem(value: JsonElement | undefined): AskUserQuestionItem | undefined {
  const id = str(jget(value, 'id'));
  // `id` / `question` / 选项的 `label` 在 Android 的 @Serializable 里都没有默认值，
  // 缺任意一个整条题目会被 mapNotNull 丢掉（Frames.kt:39/44-53）。这里照同样的必填
  // 口径丢弃，而不是兜底成空串——否则畸形帧在小程序上会弹出「无标题」或少一个选项的题。
  if (id === undefined) return undefined;
  const question = str(jget(value, 'question'));
  if (question === undefined) return undefined;
  const rawOptions = arr(jget(value, 'options')) ?? [];
  const options: AskUserQuestionOption[] = [];
  for (const item of rawOptions) {
    const label = str(jget(item, 'label'));
    if (label === undefined) return undefined;
    if (label.length > 0) options.push({ label, description: str(jget(item, 'description')) });
  }
  const intentRaw = jget(value, 'intent');
  const intentKind = str(jget(intentRaw, 'kind'));
  const intent: QuestionIntent | undefined =
    intentKind === undefined ? undefined : { kind: intentKind, approve: str(jget(intentRaw, 'approve')) };
  return {
    id,
    question,
    header: str(jget(value, 'header')),
    detail: str(jget(value, 'detail')),
    options: options.length > 0 ? options : undefined,
    multiSelect: bool(jget(value, 'multiSelect')),
    intent,
  };
}

/** 解 `userQuestions` 投影的 `active` 半边；畸形行丢掉。 */
export function decodeUserQuestions(value: JsonElement | undefined): UserQuestionRow[] {
  const rows: UserQuestionRow[] = [];
  for (const row of arr(jget(value, 'active')) ?? []) {
    const callId = str(jget(row, 'callId'));
    if (callId === undefined) continue;
    const questions = (arr(jget(row, 'questions')) ?? [])
      .map(decodeAskUserQuestionItem)
      .filter((item): item is AskUserQuestionItem => item !== undefined);
    rows.push({ callId, questions, state: str(jget(row, 'state')) ?? 'open' });
  }
  return rows;
}

/** 迟到的提问回答里的一道题和它的答案：选中的选项加自填文字；跳过时为空。 */
export interface QuestionReplyPair { question: string; answers: string[] }

/** 计划评审（exit_plan_mode）的路由与应答编码，与 iOS/web 完全一致。 */
export interface PlanReviewFlow {
  id: string;
  question: string;
  plan: string;
  approve: AskUserQuestionOption;
  decline?: AskUserQuestionOption;
}

export function planReviewApproveAnswer(flow: PlanReviewFlow): QuestionAnswer {
  return { id: flow.id, selected: [flow.approve.label] };
}

export function planReviewReviseAnswer(flow: PlanReviewFlow, notes: string): QuestionAnswer {
  const trimmed = notes.trim();
  if (trimmed.length > 0) return { id: flow.id, selected: [], custom: trimmed };
  return { id: flow.id, selected: flow.decline ? [flow.decline.label] : [] };
}

export function routePlanReview(questions: AskUserQuestionItem[]): PlanReviewFlow | undefined {
  if (questions.length !== 1) return undefined;
  const question = questions[0];
  if (question.intent?.kind !== 'plan-review') return undefined;
  const approveLabel = question.intent.approve;
  if (approveLabel === undefined) return undefined;
  const plan = question.detail;
  if (plan === undefined) return undefined;
  if (question.multiSelect === true) return undefined;
  const options = question.options ?? [];
  if (options.length > 2) return undefined;
  const approve = options.find(option => option.label === approveLabel);
  if (approve === undefined) return undefined;
  const decline = options.find(option => option.label !== approveLabel);
  return { id: question.id, question: question.question, plan, approve, decline };
}

/** 会话停在哪一种请求上（与边栏徽标共用判定）。 */
export function pendingInteractionKind(
  approval: ApprovalRequested | undefined,
  question: QuestionRequested | undefined,
): SessionAwaitingKind | undefined {
  if (approval !== undefined) return 'approval';
  if (question !== undefined) {
    return routePlanReview(question.questions) !== undefined ? 'planReview' : 'question';
  }
  return undefined;
}

// 提问卡片的逐题流程 ————————————————————————————————————————

export interface QuestionDraft { selected: string[]; custom: string; skipped: boolean }

export function questionDraftAnswered(draft: QuestionDraft): boolean {
  return draft.selected.length > 0 || draft.custom.trim().length > 0;
}

export function questionDraftCompleted(draft: QuestionDraft): boolean {
  return questionDraftAnswered(draft) || draft.skipped;
}

export type QuestionFlowValidation = 'unanswered' | 'incomplete';

export interface QuestionFlowState {
  questions: AskUserQuestionItem[];
  index: number;
  drafts: QuestionDraft[];
  validation?: QuestionFlowValidation;
}

export interface QuestionFlowStep { state: QuestionFlowState; submit: boolean }

function emptyDraft(): QuestionDraft {
  return { selected: [], custom: '', skipped: false };
}

export function createQuestionFlow(questions: AskUserQuestionItem[]): QuestionFlowState {
  return { questions, index: 0, drafts: questions.map(() => emptyDraft()) };
}

export function questionFlowCurrent(state: QuestionFlowState): AskUserQuestionItem | undefined {
  return state.questions[state.index];
}

export function questionFlowCurrentDraft(state: QuestionFlowState): QuestionDraft | undefined {
  return state.drafts[state.index];
}

export function questionFlowIsFirst(state: QuestionFlowState): boolean {
  return state.index === 0;
}

export function questionFlowIsLast(state: QuestionFlowState): boolean {
  return state.index >= state.questions.length - 1;
}

export function questionFlowPrevious(state: QuestionFlowState): QuestionFlowState {
  return state.index <= 0 ? state : { ...state, index: state.index - 1, validation: undefined };
}

export function questionFlowNext(state: QuestionFlowState): QuestionFlowState {
  return state.index + 1 >= state.questions.length
    ? state
    : { ...state, index: state.index + 1, validation: undefined };
}

export function questionFlowChoose(state: QuestionFlowState, label: string): QuestionFlowState {
  const question = questionFlowCurrent(state);
  const draft = questionFlowCurrentDraft(state);
  if (question === undefined || draft === undefined) return state;
  let updated: QuestionDraft;
  if (question.multiSelect === true) {
    const selected = draft.selected.includes(label)
      ? draft.selected.filter(item => item !== label)
      : [...draft.selected, label];
    updated = { selected, custom: draft.custom, skipped: false };
  } else {
    updated = { selected: [label], custom: '', skipped: false };
  }
  const drafts = state.drafts.slice();
  drafts[state.index] = updated;
  const advance = question.multiSelect !== true && !questionFlowIsLast(state);
  return { ...state, index: advance ? state.index + 1 : state.index, drafts, validation: undefined };
}

export function questionFlowChooseSettlingBatch(state: QuestionFlowState, label: string): QuestionFlowStep {
  const settles = questionFlowIsLast(state) && questionFlowCurrent(state)?.multiSelect !== true;
  const next = questionFlowChoose(state, label);
  if (!settles) return { state: next, submit: false };
  return questionFlowValidateForSubmission(next);
}

export function questionFlowSetCustom(state: QuestionFlowState, value: string): QuestionFlowState {
  const question = questionFlowCurrent(state);
  const draft = questionFlowCurrentDraft(state);
  if (question === undefined || draft === undefined) return state;
  const updated: QuestionDraft = {
    custom: value,
    skipped: false,
    selected: question.multiSelect === true ? draft.selected : [],
  };
  const drafts = state.drafts.slice();
  drafts[state.index] = updated;
  return { ...state, drafts, validation: undefined };
}

export function questionFlowSkip(state: QuestionFlowState): QuestionFlowStep {
  if (questionFlowCurrentDraft(state) === undefined) return { state, submit: false };
  const drafts = state.drafts.slice();
  drafts[state.index] = { selected: [], custom: '', skipped: true };
  const next = { ...state, drafts, validation: undefined };
  if (!questionFlowIsLast(next)) return { state: { ...next, index: state.index + 1 }, submit: false };
  return questionFlowValidateForSubmission(next);
}

export function questionFlowContinue(state: QuestionFlowState): QuestionFlowStep {
  const draft = questionFlowCurrentDraft(state);
  if (draft === undefined || !questionDraftAnswered(draft)) {
    return { state: { ...state, validation: 'unanswered' }, submit: false };
  }
  if (!questionFlowIsLast(state)) {
    return { state: { ...state, index: state.index + 1, validation: undefined }, submit: false };
  }
  return questionFlowValidateForSubmission(state);
}

export function questionFlowValidateForSubmission(state: QuestionFlowState): QuestionFlowStep {
  const missing = state.drafts.findIndex(draft => !questionDraftCompleted(draft));
  if (missing < 0) return { state: { ...state, validation: undefined }, submit: true };
  return { state: { ...state, index: missing, validation: 'incomplete' }, submit: false };
}

/** 整组答案的上报编码，与 Mac 的 responseAnswers() 一致。 */
export function questionFlowAnswers(state: QuestionFlowState): QuestionAnswer[] {
  return state.questions.map((question, position) => {
    const draft = state.drafts[position] ?? emptyDraft();
    if (draft.skipped) return { id: question.id, selected: [] };
    const custom = draft.custom.trim();
    return {
      id: question.id,
      selected: custom.length === 0 || question.multiSelect === true ? draft.selected : [],
      custom: custom.length === 0 ? undefined : custom,
    };
  });
}

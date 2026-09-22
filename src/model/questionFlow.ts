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
  eventId?: string;
  sessionId: SessionId;
  questions: AskUserQuestionItem[];
}

export interface QuestionAnswer { id: string; selected: string[]; custom?: string }

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

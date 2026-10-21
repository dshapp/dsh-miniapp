/**
 * 会话窗口状态：把 SessionEvent 重放成 ChatNode，并维护会话级投影。
 *
 * 对应 Android 的 state/SessionStore.kt（与 iOS 的 SessionStore 同一套分组与折叠规则）。
 * Compose 的 mutableStateOf 在这里换成 Store<T>：每个对外可观察的字段都配一个
 * xStore 字段，页面用 useStore(store.xStore) 订阅。之所以每个字段单独一个 Store，
 * 是因为转写、队列、投影各自的更新频率差着几个数量级，合成一个对象会让每帧流式
 * 增量都重绘整个页面。
 *
 * 本文件刻意不碰 transport：加载历史、follow 注册都由 appModel 编排，这里只接收
 * 已经解码好的值，并把「还要不要再取一次」的判断（hasMore / historyCursor）暴露出去。
 */
import {
  clipTurnRailPreview,
  mergeTurnRailItems,
  presentedFiles as decodePresentedFiles,
  producedPath,
  submittedPlan,
  TURN_RAIL_PROMPT_LIMIT,
  TURN_RAIL_RESPONSE_LIMIT,
} from '../model/format';
import type { PresentedFile, TurnRailItem } from '../model/format';
import {
  assistantStepIsVisible,
  chatNodeAnchorSeq,
  chatNodeId,
  chatNodeTurnNumber,
  decodeContentBlock,
  decodeToolError,
  toAssistantBlock,
  turnProcessCovers,
  turnProcessKey,
} from '../model/chatNode';
import type {
  AssistantBlock,
  AssistantStepData,
  ChatNode,
  CommandNode,
  CompactionSummaryNode,
  ContentBlock,
  ModelRetryNode,
  SubmittedPlan,
  TokenUsage,
  ToolChatData,
  ToolResultData,
  TurnMaxTokensNode,
  TurnOutcome,
  TurnProcessSpec,
  TurnTailData,
  WorkflowRunData,
  WorkflowRunMemberData,
  WorkflowRunStatus,
} from '../model/chatNode';
import { arr, bool, dbl, encodeJson, int, isObject, jget, str, type JsonElement, type JsonObject } from '../model/json';
import { modelDirectoryApplyProjected, permissionSelectionMerge } from '../model/types';
import type {
  CallId,
  HistoryEntry,
  ImageAttachmentLimits,
  JobView,
  MessageId,
  ModelDirectoryState,
  ModelSelection,
  PermissionPresetOption,
  PermissionSelection,
  PermissionSelectValue,
  SessionAddress,
  SessionEvent,
  SessionHistoryValue,
  SessionId,
  SubagentAddress,
  ToolEventView,
  GoalActivation,
} from '../model/types';
import {
  decodeInbox,
  rowsFromInbox,
  type AssistantStreamBaseline,
  type AssistantStreamFrame,
  type QueuedInboxItem,
  type SessionJobsFrame,
  type SessionProjectionFrame,
  type SessionQueueFrame,
} from '../model/frames';
import type { TurnChangesAddress } from '../model/turnChanges';
import { decodeUserQuestions, type ApprovalRequested, type QuestionRequested, type UserQuestionRow } from '../model/questionFlow';
import { Strings } from '../i18n/strings';
import { turnFailureMessage } from '../model/turnFailure';
import type { CachedWindow } from './cache';
import { Store } from './store';

const MAX_REPAIR_BUFFER = 10_000;
const MAX_PROJECTION_VERSIONS = 32;
const MAX_BLOCK_INDEX = 1024;

/** 首屏窄、往上翻宽；与 Android PhoneModel 的取值一致。 */
export const INITIAL_HISTORY_MESSAGES = 15;
export const HISTORY_MESSAGES = 30;

/**
 * 取历史的注入点：transport 由 appModel 持有，sessionStore 不直接调用它。
 *
 * beforeSeq 只在往上翻时给（那页之前的最旧 seq），throughSeq 是权威截止游标。
 */
export interface HistoryPageRequest {
  sessionId: SessionId;
  throughSeq: number;
  beforeSeq?: number;
  limit: number;
  firstPage: boolean;
}

export type HistoryPageLoader = (request: HistoryPageRequest) => Promise<SessionHistoryValue>;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Kotlin 的 Int.MIN_VALUE：用来表达「这个槽还没有值」。 */
const NO_VALUE = Number.MIN_SAFE_INTEGER;

// —— 对外投影类型 ————————————————————————————————————————————

export interface TodoItem {
  id: string;
  content: string;
  status: string;
  priority?: string;
}

export interface GoalProjection {
  id: string;
  revision: number;
  objective: string;
  phase: string;
  maxGoalRounds?: number;
  blockedMessage?: string;
}

export interface SessionStatsProjection {
  turns: number;
  steps: number;
  llmMs: number;
  toolMs: number;
  ttftMs: number;
  ttftSteps: number;
  decodeMs: number;
  decodeTokens: number;
}

export interface ContextOccupancy {
  percent: number;
  usedTokens: number;
  contextWindow: number;
}

export interface HistoryError {
  code: string;
  message: string;
}

/** 本地已发出、主机尚未回声的消息。 */
export interface PendingSubmission {
  requestId: string;
  placement: string;
  time: number;
  text: string;
}

// —— 内部上下文槽 ————————————————————————————————————————————

interface PendingTurnError {
  turn: number;
  startSeq: number;
  time: number;
  seq?: number;
  message?: string;
  code?: string;
}

interface WorkflowMemberState {
  seq: number;
  label: string;
  phase?: string;
  childId: SessionId;
  outcome?: string;
}

interface WorkflowState {
  runId: string;
  name: string;
  anchorSeq: number;
  stopReason?: string;
  members: WorkflowMemberState[];
}

type NodeContext =
  | { kind: 'finalized'; node: ChatNode }
  | { kind: 'assistant'; state: AssistantStepData }
  | { kind: 'tool'; data: ToolChatData }
  | { kind: 'compaction'; node: CompactionSummaryNode }
  | { kind: 'retry'; node: ModelRetryNode }
  | { kind: 'turnErrorPending'; pending: PendingTurnError }
  | { kind: 'maxTokens'; node: TurnMaxTokensNode }
  | { kind: 'command'; node: CommandNode }
  | { kind: 'tail'; data: TurnTailData }
  | { kind: 'workflow'; state: WorkflowState };

type ProjectionEntry = [value: JsonElement, seq: number];
type KeyedNode = { anchor: number; id: string; node: ChatNode };

// —— 通用小工具 ——————————————————————————————————————————————

function cloneAssistantStep(state: AssistantStepData): AssistantStepData {
  return { ...state, blocks: state.blocks.slice() };
}

function newAssistantStep(turn: number, step: number, startSeq: number, time: number): AssistantStepData {
  return { turn, step, startSeq, time, status: 'running', blocks: [], interrupted: false };
}

function newToolChatData(init: {
  callId: CallId;
  name: string;
  argsRaw: string;
  turn: number;
  step: number;
  startSeq: number;
  time: number;
  rootCallId?: CallId;
  parentCallId?: CallId;
  result?: ToolResultData;
  callView?: JsonElement;
}): ToolChatData {
  return { ...init, subCalls: [] };
}

function cloneToolData(tool: ToolChatData): ToolChatData {
  return { ...tool, subCalls: tool.subCalls.slice() };
}

function newModelRetryNode(retryId: string, seq: number, time: number): ModelRetryNode {
  return { retryId, seq, time, retryState: 'scheduled', retry: 1 };
}

function newTurnTail(turn: number, seq: number, time: number): TurnTailData {
  return { turn, seq, time, routes: [] };
}

function sumNullable(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

function keyedCompare(a: KeyedNode, b: KeyedNode): number {
  if (a.anchor !== b.anchor) return a.anchor < b.anchor ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function randomId(): string {
  return 'local-' + Date.now().toString(16) + '-' + Math.random().toString(16).slice(2);
}

/** 事件窗口的等价判定：seq/type/time 之外还要嗅 data，否则同 seq 的更新会被吞掉。 */
function historyEntryEquals(a: HistoryEntry, b: HistoryEntry): boolean {
  if (a.event.type !== b.event.type || a.event.seq !== b.event.seq || a.event.time !== b.event.time) return false;
  if (JSON.stringify(a.event.data ?? null) !== JSON.stringify(b.event.data ?? null)) return false;
  if (JSON.stringify(a.event.surfaceOp ?? null) !== JSON.stringify(b.event.surfaceOp ?? null)) return false;
  return JSON.stringify(a.view ?? null) === JSON.stringify(b.view ?? null);
}

function entriesEqual(a: HistoryEntry[], b: HistoryEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (!historyEntryEquals(a[i], b[i])) return false;
  return true;
}

/** 两条同 seq 的记录先看谁带视图：view 为空的让位给有视图的那条。 */
function preferredEntry(left: HistoryEntry, right: HistoryEntry): HistoryEntry {
  const leftMissing = left.view === undefined;
  const rightMissing = right.view === undefined;
  if (leftMissing && !rightMissing) return right;
  if (!leftMissing && rightMissing) return left;
  return right;
}

/**
 * 去重、按 seq 排序的原始历史窗口；分页与实时投递共用。
 *
 * 单独一层是因为「同一 seq 的记录可能被投递两遍」：分页先到、实时后到，
 * 或补洞重放与实时重叠。谁带 tool 视图谁优先，其余以后到者为准。
 */
export class SessionEventWindow {
  private items: HistoryEntry[] = [];
  private more = true;
  private rev = 0;

  get entries(): HistoryEntry[] {
    return this.items;
  }

  get hasMore(): boolean {
    return this.more;
  }

  get revision(): number {
    return this.rev;
  }

  get firstSeq(): number | undefined {
    return this.items.length > 0 ? this.items[0].event.seq : undefined;
  }

  get lastSeq(): number | undefined {
    return this.items.length > 0 ? this.items[this.items.length - 1].event.seq : undefined;
  }

  replace(value: SessionHistoryValue): void {
    const replacement = this.deduplicated(value.events);
    this.more = value.hasMore;
    if (entriesEqual(replacement, this.items)) return;
    this.items = replacement;
    this.rev += 1;
  }

  prepend(value: SessionHistoryValue): void {
    const merged = this.mergeOrdered(this.deduplicated(value.events), this.items);
    this.more = value.hasMore;
    if (entriesEqual(merged, this.items)) return;
    this.items = merged;
    this.rev += 1;
  }

  repair(value: SessionHistoryValue, buffered: HistoryEntry[]): void {
    const repaired = this.mergeOrdered(this.deduplicated(value.events), this.deduplicated(buffered));
    this.more = value.hasMore;
    if (entriesEqual(repaired, this.items)) return;
    this.items = repaired;
    this.rev += 1;
  }

  truncate(afterSeq: number): boolean {
    const kept = this.items.filter(entry => entry.event.seq <= afterSeq);
    if (kept.length === this.items.length) return false;
    this.items = kept;
    this.rev += 1;
    return true;
  }

  /** 插入或替换一条实时事件；返回窗口是否真的变了。 */
  applyLive(entry: HistoryEntry): boolean {
    let low = 0;
    let high = this.items.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const seq = this.items[mid].event.seq;
      if (seq === entry.event.seq) {
        found = mid;
        break;
      }
      if (seq < entry.event.seq) low = mid + 1;
      else high = mid - 1;
    }
    if (found >= 0) {
      if (historyEntryEquals(this.items[found], entry)) return false;
      const updated = this.items.slice();
      updated[found] = preferredEntry(this.items[found], entry);
      this.items = updated;
      this.rev += 1;
      return true;
    }
    const updated = this.items.slice();
    updated.splice(low, 0, entry);
    this.items = updated;
    this.rev += 1;
    return true;
  }

  private deduplicated(items: HistoryEntry[]): HistoryEntry[] {
    const bySequence = new Map<number, HistoryEntry>();
    for (const entry of items) {
      const seq = entry.event.seq;
      const existing = bySequence.get(seq);
      bySequence.set(seq, existing === undefined ? entry : preferredEntry(existing, entry));
    }
    return Array.from(bySequence.values()).sort((a, b) => a.event.seq - b.event.seq);
  }

  private mergeOrdered(left: HistoryEntry[], right: HistoryEntry[]): HistoryEntry[] {
    const merged: HistoryEntry[] = [];
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
      const a = left[i];
      const b = right[j];
      if (a.event.seq < b.event.seq) {
        merged.push(a);
        i += 1;
      } else if (b.event.seq < a.event.seq) {
        merged.push(b);
        j += 1;
      } else {
        merged.push(preferredEntry(a, b));
        i += 1;
        j += 1;
      }
    }
    while (i < left.length) merged.push(left[i++]);
    while (j < right.length) merged.push(right[j++]);
    return merged;
  }
}

// —— 投影解码 ————————————————————————————————————————————————
//
// Android 那边这一层由 kotlinx.serialization 的 decodeOrNull 承担；这里手写，
// 缺失字段按模型默认值补齐，形状完全不对（不是对象）才返回 undefined。

function decodeTokenUsage(value: JsonElement | undefined): TokenUsage | undefined {
  if (!isObject(value)) return undefined;
  return {
    inputTokens: int(value.inputTokens),
    uncachedInputTokens: int(value.uncachedInputTokens),
    outputTokens: int(value.outputTokens),
    cacheReadTokens: int(value.cacheReadTokens),
    cacheWriteTokens: int(value.cacheWriteTokens),
    reasoningTokens: int(value.reasoningTokens),
  };
}

function decodeSessionStats(value: JsonElement | undefined): SessionStatsProjection | undefined {
  if (!isObject(value)) return undefined;
  return {
    turns: int(value.turns) ?? 0,
    steps: int(value.steps) ?? 0,
    llmMs: dbl(value.llmMs) ?? 0,
    toolMs: dbl(value.toolMs) ?? 0,
    ttftMs: dbl(value.ttftMs) ?? 0,
    ttftSteps: int(value.ttftSteps) ?? 0,
    decodeMs: dbl(value.decodeMs) ?? 0,
    decodeTokens: int(value.decodeTokens) ?? 0,
  };
}

function decodeImageLimits(value: JsonElement | undefined): ImageAttachmentLimits | undefined {
  if (!isObject(value)) return undefined;
  const maxImageBytes = int(value.maxImageBytes);
  const maxImagesPerMessage = int(value.maxImagesPerMessage);
  const maxMessageImageBytes = int(value.maxMessageImageBytes);
  const maxImagePixels = int(value.maxImagePixels);
  const mediaTypes = arr(value.mediaTypes);
  if (
    maxImageBytes === undefined ||
    maxImagesPerMessage === undefined ||
    maxMessageImageBytes === undefined ||
    maxImagePixels === undefined ||
    mediaTypes === undefined
  ) {
    return undefined;
  }
  return {
    maxImageBytes,
    maxImagesPerMessage,
    maxMessageImageBytes,
    maxImagePixels,
    mediaTypes: mediaTypes.map(item => str(item) ?? ''),
  };
}

function decodePermissionSelect(value: JsonElement | undefined): PermissionSelectValue | undefined {
  if (!isObject(value)) return undefined;
  // 0.1.6 的投影只带 currentValue：options 缺失是正常形状，不是坏帧。
  const raw = arr(value.options);
  const options = raw === undefined
    ? undefined
    : raw.map(option => ({
        value: str(jget(option, 'value')) ?? '',
        name: str(jget(option, 'name')) ?? '',
        description: str(jget(option, 'description')),
      }));
  return { options, currentValue: str(value.currentValue) ?? '' };
}

function decodeModelSelection(value: JsonElement | undefined): ModelSelection | undefined {
  const provider = str(jget(value, 'provider'));
  const model = str(jget(value, 'model'));
  if (provider === undefined || model === undefined) return undefined;
  return { provider, model, reasoningEffort: str(jget(value, 'reasoningEffort')) };
}

function workflowStatusFromStopReason(reason: string): WorkflowRunStatus {
  switch (reason) {
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'error':
      return 'failed';
    default:
      return 'interrupted';
  }
}

function workflowStatusFromOutcome(outcome: string): WorkflowRunStatus {
  switch (outcome) {
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
      return 'failed';
    default:
      return 'interrupted';
  }
}

/** 一个 inbox 目标当前的认领（web `InboxState.currentClaimed`）。 */
interface InboxClaim {
  ids: Set<MessageId>;
  seq: number;
  /** 这一批里有没有人类发的消息。 */
  human: boolean;
}

/** 展开 DSH 1.5 压缩的 assistant stream 记录。 */
function expandAssistantStream(stream: JsonElement | undefined): Array<[number, JsonElement]> {
  const records = arr(stream);
  if (records === undefined) return [];
  const out: Array<[number, JsonElement]> = [];
  for (const record of records) {
    const type = str(jget(record, 'type'));
    if (type === undefined) continue;
    if (type === 'chunk') {
      const chunk = jget(record, 'chunk');
      const time = dbl(jget(record, 'time'));
      if (chunk === undefined || time === undefined) continue;
      out.push([time, chunk]);
      continue;
    }
    const index = int(jget(record, 'index'));
    if (index === undefined) continue;
    const time0 = dbl(jget(record, 'time0'));
    if (time0 === undefined) continue;
    const isToolCall = type === 'tool-call-chunks';
    const rawMembers = isToolCall ? arr(jget(record, 'args')) : arr(jget(record, 'texts'));
    if (rawMembers === undefined) continue;
    const members = rawMembers.map(item => str(item)).filter((item): item is string => item !== undefined);
    if (members.length === 0) continue;
    const gaps = (arr(jget(record, 'dt')) ?? [])
      .map(item => int(item))
      .filter((item): item is number => item !== undefined);
    if (gaps.length !== members.length - 1) continue;
    const chunkType = isToolCall ? 'tool-call-delta' : type === 'reasoning-chunks' ? 'reasoning-delta' : 'text-delta';
    const callId = str(jget(record, 'id'));
    const callName = str(jget(record, 'name'));
    let time = time0;
    members.forEach((member, k) => {
      if (k > 0) time += gaps[k - 1];
      const chunk: JsonObject = { type: chunkType, index };
      if (isToolCall) {
        if (callId !== undefined) chunk.id = callId;
        if (callName !== undefined) chunk.name = callName;
        chunk.argumentsDelta = member;
      } else {
        chunk.text = member;
      }
      out.push([time, chunk]);
    });
  }
  return out;
}

/** 会话 follow 注册用的流 id；与 Android StreamCoordinator 同口径。 */
export function followStreamId(sessionId: SessionId): string {
  return 'follow:' + sessionId;
}

export function sessionIdOfFollow(streamId: string): SessionId | undefined {
  return streamId.startsWith('follow:') ? streamId.slice('follow:'.length) : undefined;
}

/**
 * 把 SessionEvent 重放成 ChatNode，并维护会话级投影。
 *
 * 对外可观察字段统一走 xStore + getter/setter：setter 全部公开，因为编排层
 * （appModel）也要写 running / loadingHistory / historyError 这类由它拍板的状态；
 * Android 里它们是 private set，但写入者同样在同一进程的 PhoneModel 里。
 */
export class SessionStore {
  sessionId: SessionId;

  // —— 可观察状态 ————————————————————————————————————————————

  readonly nodesStore = new Store<ChatNode[]>([]);
  readonly hasMoreStore = new Store<boolean>(true);
  readonly loadingHistoryStore = new Store<boolean>(false);
  readonly historyLoadedStore = new Store<boolean>(false);
  readonly historyErrorStore = new Store<HistoryError | undefined>(undefined);
  readonly lastSeqStore = new Store<number>(-1);
  readonly runningStore = new Store<boolean>(false);
  readonly blankStore = new Store<boolean>(true);
  readonly titleStore = new Store<string>('');
  readonly cwdStore = new Store<string | undefined>(undefined);
  /**
   * 会话当前的工作目录（0.2.1 `workingDirectory` 投影 / `working-directory/change` 事件）：
   * 智能体切过目录后文件路径按它解析；没有就退回会话原始的 cwd。
   */
  readonly workingDirectoryStore = new Store<string | undefined>(undefined);
  /** workingDirectory 最近一次落值的 seq：投影与事件谁新听谁的。 */
  private workingDirectorySeq = -1;
  /** 窗口里按顺序重放到此刻为止最近的一条 working-directory/change（seq, cwd）。 */
  private replayedDirectory: [number, string | undefined] | undefined;
  readonly agentPresetStore = new Store<string | undefined>(undefined);
  readonly pendingApprovalStore = new Store<ApprovalRequested | undefined>(undefined);
  readonly pendingQuestionStore = new Store<QuestionRequested | undefined>(undefined);
  /** `userQuestions` 投影（0.2.0）：本会话里仍可作答的限时提问。 */
  readonly userQuestionsStore = new Store<UserQuestionRow[]>([]);
  /** 用户收起了弹层的 continued 问题（web `nav.close`）：仍可作答，输入框上方给入口重开。 */
  readonly hiddenQuestionCallsStore = new Store<ReadonlySet<string>>(new Set());
  /** 本端已经迟到作答的 continued 问题，在投影把它结掉之前先藏起来。 */
  readonly repliedQuestionCallsStore = new Store<ReadonlySet<string>>(new Set());
  /**
   * 可在输入区作答的 continued 问题（web `publishContinuedQuestions`）：投影里 continued 的行，
   * 去掉已经在 inbox 里排着回答、或本端已经答过的。由 refreshQuestionPresentation 派生。
   */
  readonly continuedQuestionsStore = new Store<QuestionRequested[]>([]);
  /** 弹层该呈现的问题：实时 waterfall 优先，否则是第一个没被收起的 continued 问题。 */
  readonly presentedQuestionStore = new Store<QuestionRequested | undefined>(undefined);
  readonly queueStore = new Store<QueuedInboxItem[]>([]);
  readonly jobsStore = new Store<JobView[]>([]);
  /**
   * 会话标题 → 会话 id：这个会话引用过的其它会话。
   *
   * host 把发出的 `@[标题](dsh-session:…)` 在落库前重写成了纯文本 `@标题`，
   * 会话 id 只剩紧随其后的 `session-reference` 上下文还带着 —— 气泡要把标题
   * 点成跳转就得靠它。
   */
  readonly referencedSessionsStore = new Store<Record<string, string>>({});
  readonly todosStore = new Store<TodoItem[]>([]);
  readonly goalStore = new Store<GoalProjection | undefined>(undefined);
  /** 当前目标的进程内 activation（0.2.1）；读到之前是 undefined，不猜。 */
  readonly goalActivationStore = new Store<GoalActivation | undefined>(undefined);
  /**
   * `plan` / `contextPressure` 的版本号。
   *
   * 这两个投影没有各自的快照 Store：它们的消费方（输入区的计划 chip 与占用环）读的是
   * `planModeTarget` / `contextOccupancy` 两个派生 getter。订阅 nodesStore 会被每条流式
   * 增量带着重绘整块输入区，所以改成只在这两个 key 真的落值时 +1，消费方订阅这一个
   * 计数器再去读 getter——等价于 Android 直读 store.planModeTarget 的快照订阅，
   * 不再按秒轮询（chip 的出现/消失以前最多要等 1s）。
   */
  readonly derivedProjectionStore = new Store<number>(0);
  readonly tokenUsageStore = new Store<TokenUsage | undefined>(undefined);
  readonly sessionStatsStore = new Store<SessionStatsProjection | undefined>(undefined);
  readonly imageLimitsStore = new Store<ImageAttachmentLimits | undefined>(undefined);
  /** 投影与进程级目录合并后的权限选择（0.1.5 只有投影，0.1.6 还要并上 catalog）。 */
  readonly permissionsStore = new Store<PermissionSelection | undefined>(undefined);
  readonly modelDirectoryStore = new Store<ModelDirectoryState>({
    groups: [],
    failures: [],
    status: 'idle',
    generation: 0,
  });
  readonly turnRailStore = new Store<TurnRailItem[]>([]);
  readonly deliverablesRevisionStore = new Store<number>(0);
  readonly subagentAddressStore = new Store<SubagentAddress | undefined>(undefined);
  readonly parentAvailableStore = new Store<boolean>(false);
  readonly lastTurnErroredStore = new Store<boolean>(false);
  readonly subscribedLastSeqStore = new Store<number | undefined>(undefined);
  readonly pendingSubmissionsStore = new Store<PendingSubmission[]>([]);
  readonly repairingGapStore = new Store<boolean>(false);

  get nodes(): ChatNode[] {
    return this.nodesStore.get();
  }
  set nodes(value: ChatNode[]) {
    this.nodesStore.set(value);
  }

  get hasMore(): boolean {
    return this.hasMoreStore.get();
  }
  set hasMore(value: boolean) {
    this.hasMoreStore.set(value);
  }

  get loadingHistory(): boolean {
    return this.loadingHistoryStore.get();
  }
  set loadingHistory(value: boolean) {
    this.loadingHistoryStore.set(value);
  }

  get historyLoaded(): boolean {
    return this.historyLoadedStore.get();
  }
  set historyLoaded(value: boolean) {
    this.historyLoadedStore.set(value);
  }

  get historyError(): HistoryError | undefined {
    return this.historyErrorStore.get();
  }
  set historyError(value: HistoryError | undefined) {
    this.historyErrorStore.set(value);
  }

  get lastSeq(): number {
    return this.lastSeqStore.get();
  }
  set lastSeq(value: number) {
    this.lastSeqStore.set(value);
  }

  /**
   * 输入框上方的运行状态条（对齐 Mac `RunningStatusRow` / 扩展 a268f45）：最新一轮里还没出结果的那个工具调用，
   * 以及本轮 turn/start 的时刻；模型在思考时 toolName 为空，没载到 turn/start 时不给用时。
   * 刚发出、主机还没开轮（有待确认的 transcript 提交）时也亮，文案是「正在分析请求」、不带用时。
   */
  get runningStatus(): { toolName?: string; startedAt?: number } | undefined {
    if (!this.running) {
      const awaiting = this.pendingSubmissions.some(item => item.placement === 'transcript');
      return awaiting ? { toolName: undefined, startedAt: undefined } : undefined;
    }
    let newestTurn: number | undefined;
    let toolName: string | undefined;
    for (let i = this.nodes.length - 1; i >= 0; i -= 1) {
      const node = this.nodes[i];
      const turn = chatNodeTurnNumber(node);
      if (turn !== undefined) {
        if (newestTurn === undefined) newestTurn = turn;
        else if (turn !== newestTurn) break;
      }
      if (node.kind === 'tool' && node.data.result === undefined) {
        toolName = node.data.name;
        break;
      }
    }
    const startedAt = this.currentTurn === 0 ? undefined : this.turnStartTimes.get(this.currentTurn);
    return { toolName, startedAt };
  }

  get running(): boolean {
    return this.runningStore.get();
  }
  set running(value: boolean) {
    this.runningStore.set(value);
  }

  get blank(): boolean {
    return this.blankStore.get();
  }
  set blank(value: boolean) {
    this.blankStore.set(value);
  }

  get title(): string {
    return this.titleStore.get();
  }
  set title(value: string) {
    this.titleStore.set(value);
  }

  get cwd(): string | undefined {
    return this.cwdStore.get();
  }
  set cwd(value: string | undefined) {
    this.cwdStore.set(value);
  }

  get agentPreset(): string | undefined {
    return this.agentPresetStore.get();
  }
  set agentPreset(value: string | undefined) {
    this.agentPresetStore.set(value);
  }

  get pendingApproval(): ApprovalRequested | undefined {
    return this.pendingApprovalStore.get();
  }
  set pendingApproval(value: ApprovalRequested | undefined) {
    this.pendingApprovalStore.set(value);
  }

  get pendingQuestion(): QuestionRequested | undefined {
    return this.pendingQuestionStore.get();
  }
  set pendingQuestion(value: QuestionRequested | undefined) {
    this.pendingQuestionStore.set(value);
    this.refreshQuestionPresentation();
  }

  get queue(): QueuedInboxItem[] {
    return this.queueStore.get();
  }
  set queue(value: QueuedInboxItem[]) {
    this.queueStore.set(value);
    this.refreshQuestionPresentation();
  }

  get userQuestions(): UserQuestionRow[] {
    return this.userQuestionsStore.get();
  }
  set userQuestions(value: UserQuestionRow[]) {
    if (JSON.stringify(value) === JSON.stringify(this.userQuestionsStore.get())) return;
    this.userQuestionsStore.set(value);
    this.refreshQuestionPresentation();
  }

  get continuedQuestions(): QuestionRequested[] {
    return this.continuedQuestionsStore.get();
  }

  get presentedQuestion(): QuestionRequested | undefined {
    return this.presentedQuestionStore.get();
  }

  hideQuestion(callId: string): void {
    const hidden = this.hiddenQuestionCallsStore.get();
    if (hidden.has(callId)) return;
    this.hiddenQuestionCallsStore.set(new Set([...Array.from(hidden), callId]));
    this.refreshQuestionPresentation();
  }

  reopenQuestion(callId: string): void {
    const hidden = this.hiddenQuestionCallsStore.get();
    if (!hidden.has(callId)) return;
    this.hiddenQuestionCallsStore.set(new Set(Array.from(hidden).filter(item => item !== callId)));
    this.refreshQuestionPresentation();
  }

  markQuestionReplied(callId: string): void {
    const replied = this.repliedQuestionCallsStore.get();
    if (replied.has(callId)) return;
    this.repliedQuestionCallsStore.set(new Set([...Array.from(replied), callId]));
    this.refreshQuestionPresentation();
  }

  /**
   * 重算 continued 问题与弹层该呈现的那一个（对齐 Android `continuedQuestions` /
   * `presentedQuestion` 两个派生值）。内容没变时沿用旧对象，弹层不会因为无关的队列帧重绘。
   */
  private refreshQuestionPresentation(): void {
    const queued = new Set(
      this.queueStore.get().map(item => item.questionCallId).filter((item): item is string => item !== undefined),
    );
    const replied = this.repliedQuestionCallsStore.get();
    const continued: QuestionRequested[] = [];
    for (const row of this.userQuestionsStore.get()) {
      if (row.state !== 'continued' || queued.has(row.callId) || replied.has(row.callId)) continue;
      continued.push({ sessionId: this.sessionId, questions: row.questions, callId: row.callId, continued: true });
    }
    const previous = this.continuedQuestionsStore.get();
    if (JSON.stringify(previous) !== JSON.stringify(continued)) this.continuedQuestionsStore.set(continued);
    const list = this.continuedQuestionsStore.get();
    const hidden = this.hiddenQuestionCallsStore.get();
    const presented = this.pendingQuestionStore.get()
      ?? list.find(question => !hidden.has(question.callId ?? ''));
    this.presentedQuestionStore.set(presented);
  }

  get jobs(): JobView[] {
    return this.jobsStore.get();
  }
  set jobs(value: JobView[]) {
    this.jobsStore.set(value);
  }

  get todos(): TodoItem[] {
    return this.todosStore.get();
  }
  set todos(value: TodoItem[]) {
    this.todosStore.set(value);
  }

  get goal(): GoalProjection | undefined {
    return this.goalStore.get();
  }
  set goal(value: GoalProjection | undefined) {
    this.goalStore.set(value);
  }

  get tokenUsage(): TokenUsage | undefined {
    return this.tokenUsageStore.get();
  }
  set tokenUsage(value: TokenUsage | undefined) {
    this.tokenUsageStore.set(value);
  }

  get sessionStats(): SessionStatsProjection | undefined {
    return this.sessionStatsStore.get();
  }
  set sessionStats(value: SessionStatsProjection | undefined) {
    this.sessionStatsStore.set(value);
  }

  get imageLimits(): ImageAttachmentLimits | undefined {
    return this.imageLimitsStore.get();
  }
  set imageLimits(value: ImageAttachmentLimits | undefined) {
    this.imageLimitsStore.set(value);
  }

  get permissions(): PermissionSelection | undefined {
    return this.permissionsStore.get();
  }
  set permissions(value: PermissionSelection | undefined) {
    this.permissionsStore.set(value);
  }

  get modelDirectory(): ModelDirectoryState {
    return this.modelDirectoryStore.get();
  }
  set modelDirectory(value: ModelDirectoryState) {
    this.modelDirectoryStore.set(value);
  }

  get turnRail(): TurnRailItem[] {
    return this.turnRailStore.get();
  }
  set turnRail(value: TurnRailItem[]) {
    this.turnRailStore.set(value);
  }

  get deliverablesRevision(): number {
    return this.deliverablesRevisionStore.get();
  }
  set deliverablesRevision(value: number) {
    this.deliverablesRevisionStore.set(value);
  }

  get subagentAddress(): SubagentAddress | undefined {
    return this.subagentAddressStore.get();
  }
  set subagentAddress(value: SubagentAddress | undefined) {
    this.subagentAddressStore.set(value);
  }

  get parentAvailable(): boolean {
    return this.parentAvailableStore.get();
  }
  set parentAvailable(value: boolean) {
    this.parentAvailableStore.set(value);
  }

  get lastTurnErrored(): boolean {
    return this.lastTurnErroredStore.get();
  }
  set lastTurnErrored(value: boolean) {
    this.lastTurnErroredStore.set(value);
    this.syncUnreadError();
  }

  get subscribedLastSeq(): number | undefined {
    return this.subscribedLastSeqStore.get();
  }
  set subscribedLastSeq(value: number | undefined) {
    this.subscribedLastSeqStore.set(value);
  }

  get pendingSubmissions(): PendingSubmission[] {
    return this.pendingSubmissionsStore.get();
  }
  set pendingSubmissions(value: PendingSubmission[]) {
    this.pendingSubmissionsStore.set(value);
  }

  get repairingGap(): boolean {
    return this.repairingGapStore.get();
  }
  set repairingGap(value: boolean) {
    this.repairingGapStore.set(value);
  }

  /**
   * 队列条只吃这一份：主机的 next-turn 项，也就是下一轮才会被取走的消息。
   *
   * queue 里还混着 next-step 的项（placement === 'steering'）：那些是已经点了
   * "插队发送"、正等着在下一个步骤边界送进当前回合的消息。它们不属于"排队"，
   * 画在队列条里就会和排队项长得一模一样（见 ComposerBar.QueueStrip 的说明）。
   */
  get queued(): QueuedInboxItem[] {
    return this.queue.filter(item => item.placement === 'queued');
  }

  /** 已插队、等主机在下一个步骤边界取走的消息；画在转写尾部。 */
  get steering(): QueuedInboxItem[] {
    return this.queue.filter(item => item.placement === 'steering');
  }

  private lastErroredTurn: number | undefined;
  private seenErroredTurn: number | undefined;

  /**
   * 「有一条没读过的失败」这件事本身，单独发布出来。
   *
   * 列表的红点集合要靠订阅重算，而它有两个自变量：失败位（lastTurnErrored）与已读位
   * （seenErroredTurn）。只订阅前者的话，markErrorSeen 改的是后者，订阅者收不到通知，
   * 红点读过也消不掉。
   */
  readonly unreadErrorStore = new Store<boolean>(false);

  get unreadError(): boolean {
    return this.unreadErrorStore.get();
  }

  /** 两个自变量任何一个动过都要重算一次。 */
  private syncUnreadError(): void {
    this.unreadErrorStore.set(this.lastTurnErrored && this.lastErroredTurn !== this.seenErroredTurn);
  }

  // —— 内部状态 ——————————————————————————————————————————————

  private readonly projections = new Map<string, ProjectionEntry>();
  private readonly projectionHistory = new Map<string, Map<number, JsonElement>>();
  private readonly contexts = new Map<string, NodeContext>();
  private eventWindow = new SessionEventWindow();
  private readonly inboxByTarget = new Map<string, MessageId[]>();
  private readonly claimedSteeringIds = new Set<MessageId>();
  private currentTurn = 0;
  private readonly activeSteps = new Set<number>();
  private readonly stepStartTimes = new Map<string, number>();
  private readonly turnStartSeqs = new Map<number, number>();
  /** 每一轮 turn/start 的时刻：运行中底部状态的用时从这里起算。 */
  private readonly turnStartTimes = new Map<number, number>();
  /** 每一轮在窗口里最早那条事件的时刻：turn/start 被裁掉时当用时的计时起点。 */
  private readonly turnFirstEventTime = new Map<number, number>();
  /** 当前轮里最近开始的那一步。 */
  private currentStep = 0;
  /**
   * 每个 inbox 目标的当前认领（web `InboxState`）：最近一次非取消的移除拿走了哪些 id、
   * 发生在哪个 seq、这批里有没有人类消息。之后再插回来的 id 从认领里剔除。
   */
  private readonly inboxClaims = new Map<string, InboxClaim>();
  /** 来源是人类的 inbox 消息 id，认领时据此判断这一批里有没有人类。 */
  private readonly humanInboxIds = new Set<MessageId>();
  private readonly turnEndBoundaries: Array<[seq: number, time: number, reason?: string]> = [];
  private readonly presentedByTurn = new Map<number, PresentedFile[]>();
  /** `permissions` 投影（0.1.6 只带 currentValue，0.1.5 还内联候选）。 */
  private permissionProjection: PermissionSelectValue | undefined;
  /** `permissionPresets/catalog` 拉到之前的候选是空的，退回投影内联的那份。 */
  private permissionCatalogOptions: PermissionPresetOption[] | undefined;
  /** 每轮最新的 `workspace/changes` 公告 seq（见 changesAddress）。 */
  private readonly changesSeqByTurn = new Map<number, number>();
  private readonly producedPathsByTurn = new Map<number, string[]>();
  private readonly closingAssistantStepByTurn = new Map<number, number>();
  private readonly turnAnchorRows = new Map<number, string>();
  private readonly turnPromptAnchors = new Map<number, string>();
  private readonly turnPromptRow = new Map<number, number>();
  private readonly turnResponseRow = new Map<number, number>();
  private readonly turnProcessSpecs = new Map<string, TurnProcessSpec>();
  private readonly expandedProcessKeys = new Set<string>();
  /** 每个 TurnProcessSpec 的展开态各是一个 Store：转写行订阅它才会随展开重绘。 */
  private readonly expandedProcessStores = new Map<string, Store<boolean>>();
  private readonly toolCallRootIndex = new Map<CallId, number>();

  private historyPageLoader: HistoryPageLoader | undefined;
  private liveAttemptId: string | undefined;
  private liveAttemptTurn = 0;
  private liveAttemptStep = 0;
  private durableCursor = -1;
  private transientInGap = 0;

  private historyCursorHint = -1;
  private readonly liveRepairBuffer: HistoryEntry[] = [];
  private gapRepairGeneration = 0;
  private gapRepairTargetSeq: number | undefined;
  private droppedTailSeq: number | undefined;

  constructor(sessionId: SessionId = '') {
    this.sessionId = sessionId;
  }

  // —— 派生只读量 ————————————————————————————————————————————

  get firstSeq(): number | undefined {
    return this.eventWindow.firstSeq;
  }

  get historyWindow(): HistoryEntry[] {
    return this.eventWindow.entries;
  }

  /**
   * 分页请求的 throughSeq；没有权威游标时是 -1，调用方必须跳过这次请求。
   *
   * 不能把未知游标钳成 0：主机把 throughSeq 读作"截止到这一条事件"，0 只会回来
   * 一条 permission/preset，historyLoaded 却已置真，转写于是闪一下"还没有消息"，
   * 而且那页带回的 hasMore=false 还会顺手关掉"加载更早"。
   */
  get historyCursor(): number {
    return this.subscribedLastSeq ?? Math.max(this.lastSeq, this.historyCursorHint);
  }

  get repairCursor(): number {
    const last =
      this.liveRepairBuffer.length > 0 ? this.liveRepairBuffer[this.liveRepairBuffer.length - 1].event.seq : -1;
    return Math.max(this.subscribedLastSeq ?? -1, this.lastSeq, last, this.droppedTailSeq ?? -1, 0);
  }

  get followAddress(): SessionAddress {
    const address = this.subagentAddress;
    return address === undefined ? { kind: 'session', sessionId: this.sessionId } : { kind: 'subagent', address };
  }

  get contextOccupancy(): ContextOccupancy | undefined {
    const value = this.projectionValue('contextPressure');
    if (value === undefined) return undefined;
    const window = dbl(jget(value, 'contextWindow'));
    if (window === undefined || window <= 0 || !Number.isFinite(window)) return undefined;
    const used = dbl(jget(value, 'projectedTokens')) ?? dbl(jget(value, 'pressureTokens'));
    if (used === undefined || !Number.isFinite(used)) return undefined;
    const percent = Math.round(Math.min(100, Math.max(0, (used / window) * 100)));
    return { percent, usedTokens: used, contextWindow: window };
  }

  /** 折叠后的计划模式目标状态。 */
  get planModeTarget(): boolean | undefined {
    const value = this.projectionValue('plan');
    if (value === undefined) return undefined;
    const active = bool(jget(value, 'active'));
    if (active === undefined) return undefined;
    const pending = bool(jget(value, 'pending')) ?? false;
    return pending ? !active : active;
  }

  get activeGoal(): GoalProjection | undefined {
    const goal = this.goal;
    return goal === undefined || goal.phase === 'complete' ? undefined : goal;
  }

  setGoalActivation(activation: GoalActivation | undefined): void {
    this.goalActivationStore.set(activation);
  }

  /**
   * 主机不会自己续跑的 active 目标（重启后恢复的那种）：按「已暂停」画、给「恢复」
   * （web GoalBar 0.2.1，对齐 Mac `goalDisarmed`）。activation 必须对得上当前目标的 id 与版本。
   */
  get goalDisarmed(): boolean {
    const goal = this.activeGoal;
    const activation = this.goalActivationStore.get();
    if (goal === undefined || goal.phase !== 'active' || activation === undefined) return false;
    return activation.id === goal.id && activation.revision === goal.revision && activation.activation === 'disarmed';
  }

  get goalRef(): { id: string; revision: number } | undefined {
    const goal = this.activeGoal;
    return goal === undefined ? undefined : { id: goal.id, revision: goal.revision };
  }

  projectionValue(key: string): JsonElement | undefined {
    const entry = this.projections.get(key);
    return entry === undefined ? undefined : entry[0];
  }

  producedPaths(turn: number): string[] {
    return this.producedPathsByTurn.get(turn) ?? [];
  }

  presentedFiles(turn: number): PresentedFile[] {
    return this.presentedByTurn.get(turn) ?? [];
  }

  /** 收尾步骤才带上文件提及词表。 */
  closingMentions(turn: number, step: number, isRunning: boolean): string[] {
    if (isRunning || this.closingAssistantStepByTurn.get(turn) !== step) return [];
    const produced = this.producedPathsByTurn.get(turn) ?? [];
    const presented = this.presentedByTurn.get(turn);
    if (presented === undefined || presented.length === 0) return produced;
    const paths = produced.slice();
    for (const file of presented) if (!paths.includes(file.path)) paths.push(file.path);
    return paths;
  }

  toolCall(id: CallId): ToolChatData | undefined {
    const index = this.toolCallRootIndex.get(id);
    if (index !== undefined) {
      const node = this.nodes[index];
      if (node !== undefined && node.kind === 'tool') return node.data;
    }
    return this.findNestedTool(id);
  }

  private findNestedTool(id: CallId): ToolChatData | undefined {
    const search = (tool: ToolChatData, depth: number): ToolChatData | undefined => {
      if (tool.callId === id) return tool;
      if (depth > 64) return undefined;
      for (const sub of tool.subCalls) {
        const found = search(sub, depth + 1);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    for (const node of this.nodes) {
      if (node.kind !== 'tool') continue;
      const found = search(node.data, 0);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  // —— 会话开关 ——————————————————————————————————————————————

  /**
   * 切到另一条会话。窗口整体重置：上一条的节点、投影版本账本、审批挂载点
   * 都不能留在新会话里。
   */
  open(sessionId: SessionId): void {
    this.sessionId = sessionId;
    this.pendingApproval = undefined;
    this.hiddenQuestionCallsStore.set(new Set());
    this.repliedQuestionCallsStore.set(new Set());
    this.pendingQuestion = undefined;
    this.resetWindow();
  }

  /** 退回列表：只摘掉与「当前就在眼前」绑定的交互挂载点，窗口留着以便再点开时秒开。 */
  close(): void {
    this.pendingApproval = undefined;
    this.pendingQuestion = undefined;
  }

  // —— 本地投递回声 ——————————————————————————————————————————

  beginPendingSubmission(requestId: string, placement: string, text: string): void {
    this.pendingSubmissions = this.pendingSubmissions.concat([{ requestId, placement, time: Date.now(), text }]);
  }

  retirePendingSubmission(requestId: string): void {
    this.pendingSubmissions = this.pendingSubmissions.filter(item => item.requestId !== requestId);
  }

  configureSubagent(address: SubagentAddress | undefined, parentAvailable: boolean): void {
    this.subagentAddress = address;
    this.parentAvailable = address === undefined ? false : parentAvailable;
  }

  seedHistoryCursor(seq: number): void {
    if (this.subscribedLastSeq !== undefined) return;
    this.historyCursorHint = Math.max(this.historyCursorHint, seq);
  }

  markErrorSeen(): void {
    if (this.seenErroredTurn === this.lastErroredTurn) return;
    this.seenErroredTurn = this.lastErroredTurn;
    this.syncUnreadError();
  }

    // —— 事件摄入 ——————————————————————————————————————————————

  apply(event: SessionEvent, view?: ToolEventView): void {
    const entry: HistoryEntry = { event, view };
    if (this.repairingGap) {
      this.liveRepairBuffer.push(entry);
      if (this.liveRepairBuffer.length > MAX_REPAIR_BUFFER) this.resetWindow();
      return;
    }
    const lastWindowSeq = this.eventWindow.lastSeq ?? Number.MIN_SAFE_INTEGER;
    const extendsTail = event.seq > lastWindowSeq;
    if (!this.eventWindow.applyLive(entry)) return;
    this.lastSeq = Math.max(this.lastSeq, event.seq);
    if (!extendsTail || this.requiresFullReplay(event)) {
      this.replayHistory();
      return;
    }
    this.noteTurnBoundary(event);
    this.applyEvent(event, view);
    this.rebuildNodes();
  }

  private requiresFullReplay(event: SessionEvent): boolean {
    if (event.surfaceOp !== undefined) return true;
    switch (event.type) {
      case 'agent/inbox/spliced':
      case 'compaction/start':
      case 'compaction/summary':
      case 'compaction/end':
      case 'compaction/prune':
        return true;
      default:
        return false;
    }
  }

  noteDroppedLiveEvent(seq: number): void {
    if (!this.historyLoaded) return;
    this.droppedTailSeq = Math.max(this.droppedTailSeq ?? seq, seq);
  }

  beginGapRepair(entry: HistoryEntry): number | undefined {
    this.liveRepairBuffer.push(entry);
    if (this.repairingGap) return undefined;
    this.gapRepairGeneration += 1;
    this.repairingGap = true;
    this.gapRepairTargetSeq = this.repairCursor;
    return this.gapRepairGeneration;
  }

  completeGapRepair(value: SessionHistoryValue, generation: number): void {
    if (!this.repairingGap || generation !== this.gapRepairGeneration) return;
    const buffered = this.liveRepairBuffer.slice();
    const target = this.gapRepairTargetSeq;
    this.gapRepairTargetSeq = undefined;
    const pageTail = value.events.length > 0 ? value.events[value.events.length - 1].event.seq : -1;
    if (pageTail < (target ?? -1)) {
      this.repairingGap = false;
      this.droppedTailSeq = Math.max(this.droppedTailSeq ?? -1, target ?? -1);
      return;
    }
    this.liveRepairBuffer.length = 0;
    this.repairingGap = false;
    this.droppedTailSeq = undefined;
    this.eventWindow.repair(value, buffered);
    this.historyLoaded = true;
    this.hasMore = this.eventWindow.hasMore;
    const block = value.projections;
    if (block !== undefined) {
      for (const key of Object.keys(block.values)) {
        this.recordProjectionVersion(block.values[key], key, block.asOfSeq);
      }
    }
    this.lastSeq = Math.max(this.subscribedLastSeq ?? -1, this.eventWindow.lastSeq ?? -1);
    this.rebuildProjections(this.lastSeq);
    this.replayHistory();
  }

  failGapRepair(generation: number): void {
    if (!this.repairingGap || generation !== this.gapRepairGeneration) return;
    this.repairingGap = false;
    if (this.liveRepairBuffer.length > MAX_REPAIR_BUFFER) this.resetWindow();
  }

  loadHistory(value: SessionHistoryValue, replacing: boolean): void {
    if (replacing && this.repairingGap) {
      this.gapRepairGeneration += 1;
      this.liveRepairBuffer.length = 0;
      this.repairingGap = false;
    }
    this.historyLoaded = true;
    const pageTail = value.events.length > 0 ? value.events[value.events.length - 1].event.seq : -1;
    const liveTailBeyondPage = (this.eventWindow.lastSeq ?? -1) > pageTail;
    if (replacing && !liveTailBeyondPage) {
      this.droppedTailSeq = undefined;
      this.eventWindow.replace(value);
    } else {
      this.eventWindow.prepend(value);
    }
    this.hasMore = this.eventWindow.hasMore;
    const block = value.projections;
    if (block !== undefined) {
      this.lastSeq = Math.max(this.lastSeq, block.asOfSeq);
      for (const key of Object.keys(block.values)) {
        this.recordProjectionVersion(block.values[key], key, block.asOfSeq);
      }
      this.rebuildProjections(this.lastSeq);
    }
    this.replayHistory();
  }

  /**
   * 把本机缓存里的窗口铺出来，供点开会话时立刻看到内容（stale-while-revalidate）。
   *
   * 只是一份"先看着"的底稿：不设 historyLoaded、也不动 lastSeq/historyCursor，
   * 所以它不参与任何裁切与去重判定；follow 的 snapshot 回来照样 replacing 整体替换，
   * 已有实时内容或已加载过的窗口也不会被它盖掉。
   */
  seedFromCache(window: CachedWindow): void {
    if (this.historyLoaded || this.eventWindow.entries.length > 0 || window.records.length === 0) return;
    this.eventWindow.replace({ events: window.records, hasMore: window.hasMore });
    // 底稿自己知道是不是最后一页，这条结论必须跟窗口一起铺上去：留着默认的 true，
    // 一份完整历史的短会话在 follow 快照回来之前会一直显示「加载更早」，过程行也不折叠。
    this.hasMore = this.eventWindow.hasMore;
    this.replayHistory();
  }

  subscribe(authoritativeLastSeq: number): void {
    this.subscribedLastSeq = authoritativeLastSeq;
    this.align(authoritativeLastSeq);
  }

  align(authoritativeLastSeq: number): void {
    const windowLast = this.eventWindow.lastSeq;
    const staleProjection = Array.from(this.projections.values()).some(entry => entry[1] > authoritativeLastSeq);
    const needsTruncate =
      authoritativeLastSeq < this.lastSeq ||
      (windowLast !== undefined && windowLast > authoritativeLastSeq) ||
      staleProjection;
    if (!needsTruncate) {
      this.lastSeq = authoritativeLastSeq;
      return;
    }
    this.eventWindow.truncate(authoritativeLastSeq);
    for (const key of Array.from(this.projectionHistory.keys())) {
      const versions = this.projectionHistory.get(key);
      if (versions === undefined) continue;
      for (const seq of Array.from(versions.keys())) if (seq > authoritativeLastSeq) versions.delete(seq);
      if (versions.size === 0) this.projectionHistory.delete(key);
    }
    this.rebuildProjections(authoritativeLastSeq);
    this.queue = [];
    this.jobs = [];
    this.pendingApproval = undefined;
    this.pendingQuestion = undefined;
    this.lastSeq = authoritativeLastSeq;
    this.replayHistory();
    this.lastSeq = authoritativeLastSeq;
  }

  resetWindow(): void {
    this.gapRepairGeneration += 1;
    this.eventWindow = new SessionEventWindow();
    this.lastSeq = -1;
    this.subscribedLastSeq = undefined;
    this.liveRepairBuffer.length = 0;
    this.repairingGap = false;
    this.droppedTailSeq = undefined;
    this.nodes = [];
    this.hasMore = true;
    this.historyLoaded = false;
    this.replayHistory();
  }

  private nextLiveChunkSeq(): number {
    this.transientInGap += 1;
    return this.durableCursor + 1 - 1 / (this.transientInGap + 1);
  }

  private replayHistory(): void {
    this.contexts.clear();
    this.referencedSessionsStore.set({});
    // 先落投影里的工作目录，重放的 working-directory/change 只有比它新才覆盖。
    this.replayedDirectory = undefined;
    const directory = this.projections.get('workingDirectory');
    this.workingDirectorySeq = -1;
    this.workingDirectoryStore.set(undefined);
    if (directory !== undefined) this.noteWorkingDirectory(str(directory[0]), directory[1]);
    this.durableCursor = -1;
    this.transientInGap = 0;
    this.presentedByTurn.clear();
    // 公告坐标跟着事件窗口一起重建，否则重放后旧 turn 的坐标会把新公告挡掉。
    this.changesSeqByTurn.clear();
    this.inboxByTarget.clear();
    this.claimedSteeringIds.clear();
    this.stepStartTimes.clear();
    this.turnStartSeqs.clear();
    this.turnStartTimes.clear();
    this.turnFirstEventTime.clear();
    this.currentStep = 0;
    this.inboxClaims.clear();
    this.humanInboxIds.clear();
    this.turnEndBoundaries.length = 0;
    this.currentTurn = 0;
    this.activeSteps.clear();
    let highestSeq = this.lastSeq;
    for (const entry of this.eventWindow.entries) {
      highestSeq = Math.max(highestSeq, entry.event.seq);
      this.noteTurnBoundary(entry.event);
      this.applyEvent(entry.event, entry.view);
    }
    this.lastSeq = highestSeq;
    this.rebuildNodes();
  }

  private noteTurnBoundary(event: SessionEvent): void {
    if (event.type !== 'turn/end') return;
    if (this.turnEndBoundaries.some(entry => entry[0] === event.seq)) return;
    this.turnEndBoundaries.push([event.seq, event.time, str(jget(jget(event.data, 'reason'), 'kind'))]);
    this.turnEndBoundaries.sort((a, b) => a[0] - b[0]);
  }

  private applyEvent(event: SessionEvent, view: ToolEventView | undefined): void {
    if (event.seq > this.durableCursor) this.durableCursor = event.seq;
    this.transientInGap = 0;
    const eventTurn = int(jget(event.data, 'turn'));
    if (eventTurn !== undefined && !this.turnFirstEventTime.has(eventTurn)) {
      this.turnFirstEventTime.set(eventTurn, event.time);
    }
    switch (event.type) {
      case 'agent/inbox/spliced':
        this.applyInboxSplice(event);
        break;
      case 'user/message':
        this.applyUserMessage(event);
        break;
      case 'assistant/message':
        this.applyAssistantMessage(event);
        break;
      case 'assistant/attempt':
        this.applyAssistantAttempt(event);
        break;
      case 'tool/call':
        this.applyToolCall(event, view);
        break;
      case 'tool/result':
        this.applyToolResult(event, view);
        break;
      // PTC 子调用：0.1.6 起主机把 code-dispatch 改名成 ptc-dispatch，
      // 旧日志里的 code-dispatch 仍然要能解（Web 端两个都收）。
      case 'tool/ptc-dispatch-start':
      case 'tool/code-dispatch-start':
        this.applySubcallStart(event);
        break;
      case 'tool/ptc-dispatch':
      case 'tool/code-dispatch':
        this.applySubcallEnd(event);
        break;
      case 'turn/start':
        this.applyTurnStart(event);
        break;
      case 'turn/end':
        this.applyTurnEnd(event);
        break;
      case 'step/start':
        this.applyStepStart(event);
        break;
      case 'step/end':
        this.applyStepEnd(event);
        break;
      case 'compaction/start':
      case 'compaction/summary':
      case 'compaction/end':
      case 'compaction/prune':
        this.applyCompaction(event);
        break;
      case 'llm/retry':
      case 'llm/retry-started':
        this.applyRetry(event);
        break;
      case 'command/run':
      case 'command/done':
        this.applyCommand(event);
        break;
      case 'tool-workflow/run-start':
      case 'tool-workflow/agent-start':
      case 'tool-workflow/agent-end':
      case 'tool-workflow/run-end':
        this.applyWorkflow(event);
        break;
      case 'session/title': {
        const title = str(jget(event.data, 'title'));
        if (title !== undefined) this.title = title;
        break;
      }
      case 'working-directory/change':
        this.replayedDirectory = [event.seq, str(jget(event.data, 'cwd'))];
        this.noteWorkingDirectory(str(jget(event.data, 'cwd')), event.seq);
        break;
      case 'deliverables/presented':
        this.applyPresented(event);
        break;
      // 只带轮次，本身不画任何东西：汇总与 diff 要按这条事件的 seq 去主机读。
      case 'workspace/changes':
        this.applyWorkspaceChanges(event);
        break;
      // 对话区不显示 system prompt（web `isVisibleChatNode`）；在这里认领，免得落进未知 surface 兜底。
      case 'system/message':
        break;
      case 'developer/message':
        this.applyDeveloperMessage(event);
        break;
      default:
        this.applyUnknownSurface(event);
        break;
    }
  }

  private isAppendSurface(event: SessionEvent): boolean {
    const op = event.surfaceOp;
    if (op === undefined) return false;
    if (str(op) === 'append') return true;
    return str(jget(op, 'op')) === 'append';
  }

  private isReplacementSurface(event: SessionEvent): boolean {
    return str(jget(event.surfaceOp, 'op')) === 'replace';
  }

  /**
   * developer/message 是上下文（web `developerMessageDefinition`）：只有其中的工具增减
   * 留一条提示行（web `isVisibleChatNode`），其余 developer 内容一律不进对话区。
   */
  private applyDeveloperMessage(event: SessionEvent): void {
    const added: string[] = [];
    const removed: string[] = [];
    for (const block of arr(jget(jget(event.data, 'message'), 'content')) ?? []) {
      const name = str(jget(block, 'toolName'));
      if (name === undefined) continue;
      const type = str(jget(block, 'type'));
      if (type === 'tool-addition') added.push(name);
      else if (type === 'tool-removal') removed.push(name);
    }
    if (added.length === 0 && removed.length === 0) return;
    const node: ChatNode = { kind: 'toolChange', data: { seq: event.seq, time: event.time, added, removed } };
    this.contexts.set(chatNodeId(node), { kind: 'finalized', node });
  }

  private applyUnknownSurface(event: SessionEvent): void {
    if (!this.isAppendSurface(event)) return;
    const node: ChatNode = {
      kind: 'unknownSurface',
      data: { seq: event.seq, time: event.time, type: event.type, data: event.data },
    };
    this.contexts.set('unknown-surface:' + event.seq, { kind: 'finalized', node });
  }

  private applyInboxSplice(event: SessionEvent): void {
    const data = event.data;
    if (!isObject(data)) return;
    const target = str(data.target);
    if (target === undefined) return;
    const start = int(data.start);
    if (start === undefined) return;
    const inserted = arr(data.inserted);
    if (inserted === undefined) return;
    let pending = this.inboxByTarget.get(target);
    if (pending === undefined) {
      pending = [];
      this.inboxByTarget.set(target, pending);
    }
    const boundedStart = Math.min(Math.max(start, 0), pending.length);
    const requested = Math.max(int(data.removedCount) ?? 0, 0);
    const removalCount = Math.min(requested, pending.length - boundedStart);
    const removed = pending.slice(boundedStart, boundedStart + removalCount);
    const insertedIds = inserted.map(item => str(jget(item, 'id'))).filter((item): item is string => item !== undefined);
    for (let i = 0; i < removalCount; i += 1) pending.splice(boundedStart, 1);
    pending.splice(boundedStart, 0, ...insertedIds);
    for (const id of insertedIds) this.claimedSteeringIds.delete(id);
    const claimed = removalCount > 0 && str(data.outcome) !== 'canceled';
    if (claimed) {
      if (target === 'next-step') for (const id of removed) this.claimedSteeringIds.add(id);
      const human = removed.some(id => this.humanInboxIds.has(id));
      this.inboxClaims.set(target, { ids: new Set(removed), seq: event.seq, human });
    } else {
      const claim = this.inboxClaims.get(target);
      if (claim !== undefined) for (const id of insertedIds) claim.ids.delete(id);
    }
    for (const item of inserted) {
      const id = str(jget(item, 'id'));
      if (id !== undefined && str(jget(jget(item, 'source'), 'kind')) === 'user') this.humanInboxIds.add(id);
    }
  }

  /**
   * 这条非人类消息是不是唤醒了它所在的轮次（web `message.ts` 的 `waking`）：
   * 它在当前 next-turn 认领里；或者是一次空闲插队——当前轮第 1 步、轮次起点已载入、
   * 在起点之后被 next-step 认领、这一轮没有 next-turn 认领、且这批里没有人类消息。
   */
  private isWaking(id: MessageId): boolean {
    const nextTurn = this.inboxClaims.get('next-turn');
    if (nextTurn !== undefined && nextTurn.ids.has(id)) return true;
    if (this.currentTurn === 0 || this.currentStep !== 1) return false;
    const turnStart = this.turnStartSeqs.get(this.currentTurn);
    if (turnStart === undefined) return false;
    const step = this.inboxClaims.get('next-step');
    if (step === undefined || step.seq <= turnStart || step.human || !step.ids.has(id)) return false;
    return (nextTurn?.seq ?? -1) < turnStart;
  }

  private applyUserMessage(event: SessionEvent): void {
    const data = event.data;
    if (!isObject(data)) return;
    const id = str(data.id);
    if (id === undefined) return;
    const content: ContentBlock[] = (arr(data.content) ?? []).map(decodeContentBlock);
    const source = data.source;
    const rpcId = str(jget(source, 'rpcId'));
    if (rpcId !== undefined) this.retirePendingSubmission(rpcId);
    if (this.isReplacementSurface(event)) return;
    const sourceKind = str(jget(source, 'kind')) ?? 'user';
    // 压缩检查点不进转写：0.1.7 起它自报 kind:'compact-checkpoint'（v4 迁移把旧日志也改写成这样），
    // 0.1.6 及更早是 {kind:'plugin', plugin:'compact'}，两种都认。
    if (sourceKind === 'compact-checkpoint' || str(jget(source, 'plugin')) === 'compact') return;
    if (sourceKind === 'session-reference') this.noteReferencedSessions(source);
    let node: ChatNode;
    if (sourceKind === 'user') {
      node = this.claimedSteeringIds.has(id)
        ? { kind: 'steering', seq: event.seq, time: event.time, messageId: id, content }
        : { kind: 'user', seq: event.seq, time: event.time, messageId: id, content };
    } else if (this.isWaking(id) || sourceKind === 'user-question-reply') {
      // 迟到的提问回答是用户自己的答案（web `question-reply` 节点），不论它是否唤醒了这一轮都要画。
      node = { kind: 'turnTrigger', data: { seq: event.seq, time: event.time, messageId: id, content, source } };
    } else {
      // 普通上下文注入不进对话区（web `isVisibleChatNode`）。
      return;
    }
    this.contexts.set(chatNodeId(node), { kind: 'finalized', node });
  }

  /** 记下一条 recall 上下文里的 label → sessionId，供用户气泡把标题点成跳转。 */
  private noteReferencedSessions(source: JsonElement | undefined): void {
    const list = arr(jget(source, 'references'));
    if (list === undefined) return;
    const merged = { ...this.referencedSessionsStore.get() };
    let changed = false;
    for (const entry of list) {
      const label = str(jget(entry, 'label'));
      const sessionId = str(jget(entry, 'sessionId'));
      if (label === undefined || label.length === 0) continue;
      if (sessionId === undefined || sessionId.length === 0) continue;
      if (merged[label] === sessionId) continue;
      merged[label] = sessionId;
      changed = true;
    }
    if (changed) this.referencedSessionsStore.set(merged);
  }

  // —— 助手流 ————————————————————————————————————————————————

  private assistantStepKey(turn: number, step: number): string {
    return 'assistant-step:' + turn + ':' + step;
  }

  private applyAssistantLiveChunk(
    turn: number,
    step: number,
    seq: number,
    time: number,
    rawChunk: JsonElement | undefined,
  ): void {
    if (!isObject(rawChunk)) return;
    const chunkType = str(rawChunk.type);
    if (chunkType === undefined) return;
    const key = this.assistantStepKey(turn, step);
    const existing = this.contexts.get(key);
    const state =
      existing !== undefined && existing.kind === 'assistant'
        ? cloneAssistantStep(existing.state)
        : newAssistantStep(turn, step, seq, time);
    state.time = time;
    if (state.stepStartTime === undefined) state.stepStartTime = this.stepStartTimes.get(turn + ':' + step);
    this.applyStreamChunk(chunkType, rawChunk, seq, state);
    this.contexts.set(key, { kind: 'assistant', state });
  }

  private applyStreamChunk(type: string, chunk: JsonElement, eventSeq: number, state: AssistantStepData): void {
    const index = int(jget(chunk, 'index'));
    switch (type) {
      case 'block-start': {
        const slot = index ?? 0;
        if (slot < 0 || slot > MAX_BLOCK_INDEX) return;
        while (state.blocks.length <= slot) state.blocks.push(null);
        const blockType = str(jget(chunk, 'blockType'));
        state.blocks[slot] =
          blockType === 'text'
            ? { kind: 'text', text: '' }
            : blockType === 'reasoning'
              ? { kind: 'reasoning', text: '' }
              : blockType === 'tool-call'
                ? { kind: 'toolCall', callId: '', name: '', argsRaw: '' }
                : { kind: 'other' };
        break;
      }
      case 'text-delta': {
        const text = str(jget(chunk, 'text')) ?? '';
        const slot = this.startedSlot(index, state);
        if (slot !== undefined) {
          const previous = state.blocks[slot];
          const prior = previous !== null && previous.kind === 'text' ? previous.text : '';
          state.blocks[slot] = { kind: 'text', text: prior + text };
        }
        if (state.firstVisibleSeq === undefined && text.length > 0) state.firstVisibleSeq = eventSeq;
        this.stampFirstToken(state, text);
        break;
      }
      case 'reasoning-delta': {
        const text = str(jget(chunk, 'text')) ?? '';
        const slot = this.startedSlot(index, state);
        if (slot !== undefined) {
          const previous = state.blocks[slot];
          const prior = previous !== null && previous.kind === 'reasoning' ? previous.text : '';
          state.blocks[slot] = { kind: 'reasoning', text: prior + text };
        }
        this.stampFirstToken(state, text);
        break;
      }
      case 'tool-call-delta': {
        const delta = str(jget(chunk, 'argumentsDelta')) ?? '';
        const slot = this.startedSlot(index, state);
        if (slot !== undefined) {
          const previous = state.blocks[slot];
          if (previous !== null && previous.kind === 'toolCall') {
            state.blocks[slot] = {
              kind: 'toolCall',
              // block-start 开槽时还没有 id，第一条 delta 才带上（0.2.1）。
              callId: previous.callId.length > 0 ? previous.callId : str(jget(chunk, 'id')) ?? '',
              name: str(jget(chunk, 'name')) ?? previous.name,
              argsRaw: previous.argsRaw + delta,
            };
          } else {
            state.blocks[slot] = {
              kind: 'toolCall',
              callId: str(jget(chunk, 'id')) ?? '',
              name: str(jget(chunk, 'name')) ?? '',
              argsRaw: delta,
            };
          }
        }
        this.stampFirstToken(state, delta);
        break;
      }
      case 'block-end': {
        const slot = this.startedSlot(index, state);
        if (slot === undefined) return;
        const block = jget(chunk, 'block');
        if (block === undefined) return;
        state.blocks[slot] = toAssistantBlock(decodeContentBlock(block));
        break;
      }
      case 'usage': {
        const usage = decodeTokenUsage(jget(chunk, 'usage'));
        if (usage !== undefined) state.usage = usage;
        break;
      }
      default:
        break;
    }
  }

  private startedSlot(index: number | undefined, state: AssistantStepData): number | undefined {
    if (index === undefined || index < 0 || index >= state.blocks.length) return undefined;
    return index;
  }

  private stampFirstToken(state: AssistantStepData, text: string | undefined): void {
    if (state.firstTokenTime === undefined && text !== undefined && text.length > 0) state.firstTokenTime = state.time;
  }

  /** 把一个 attempt 的压缩 stream 记录展开并重放。 */
  private applyAssistantStreamRecords(turn: number, step: number, seq: number | undefined, stream: JsonElement | undefined): void {
    const chunks = expandAssistantStream(stream);
    if (chunks.length === 0) return;
    for (const timed of chunks) {
      this.applyAssistantLiveChunk(turn, step, seq ?? this.nextLiveChunkSeq(), timed[0], timed[1]);
    }
  }

  private applyAssistantAttempt(event: SessionEvent): void {
    const data = event.data;
    if (!isObject(data)) return;
    const turn = int(data.turn) ?? 0;
    const step = int(data.step) ?? 0;
    const key = this.assistantStepKey(turn, step);
    const existing = this.contexts.get(key);
    let state: AssistantStepData;
    if (existing !== undefined && existing.kind === 'assistant') {
      state = cloneAssistantStep(existing.state);
    } else {
      state = newAssistantStep(turn, step, event.seq, event.time);
      this.contexts.set(key, { kind: 'assistant', state });
      this.applyAssistantStreamRecords(turn, step, event.seq, data.stream);
      const applied = this.contexts.get(key);
      state = applied !== undefined && applied.kind === 'assistant' ? cloneAssistantStep(applied.state) : state;
    }
    if (state.stepStartTime === undefined) state.stepStartTime = this.stepStartTimes.get(turn + ':' + step);
    state.time = event.time;
    state.status = 'interrupted';
    state.interrupted = true;
    state.settledSeq = event.seq;
    this.contexts.set(key, { kind: 'assistant', state });
  }

  private applyAssistantMessage(event: SessionEvent): void {
    const data = event.data;
    if (!isObject(data)) return;
    const turn = int(data.turn) ?? 0;
    const step = int(data.step) ?? 0;
    const message = data.message;
    const key = this.assistantStepKey(turn, step);
    const blocks: AssistantBlock[] = (arr(jget(message, 'content')) ?? []).map(item =>
      toAssistantBlock(decodeContentBlock(item)),
    );
    const existing = this.contexts.get(key);
    const state =
      existing !== undefined && existing.kind === 'assistant'
        ? cloneAssistantStep(existing.state)
        : newAssistantStep(turn, step, event.seq, event.time);
    if (state.stepStartTime === undefined) state.stepStartTime = this.stepStartTimes.get(turn + ':' + step);
    const interrupted = bool(data.interrupted) === true;
    state.status = interrupted ? 'interrupted' : 'settled';
    state.interrupted = interrupted;
    state.settledSeq = event.seq;
    state.blocks = blocks.slice();
    state.messageId = str(jget(message, 'id'));
    state.provider = str(jget(jget(message, 'source'), 'provider'));
    state.model = str(jget(jget(message, 'source'), 'model'));
    const usage = decodeTokenUsage(data.usage);
    if (usage !== undefined) state.usage = usage;
    this.contexts.set(key, { kind: 'assistant', state });
  }

  // —— 工具调用 ————————————————————————————————————————————

  private applyToolCall(event: SessionEvent, view: ToolEventView | undefined): void {
    const data = event.data;
    if (!isObject(data)) return;
    const name = str(data.name);
    if (name === undefined) return;
    const rawId = str(data.callId) ?? '';
    const callId = rawId.length === 0 ? 'seq-' + event.seq : rawId;
    const tool = newToolChatData({
      callId,
      name,
      argsRaw: str(data.arguments) ?? '',
      turn: int(data.turn) ?? 0,
      step: int(data.step) ?? 0,
      startSeq: event.seq,
      time: event.time,
      callView: view !== undefined && view.for === 'call' ? view.view : undefined,
    });
    tool.cwd = this.directoryAt(event.seq);
    this.contexts.set('tool-call:' + callId, { kind: 'tool', data: tool });
  }

  private applyToolResult(event: SessionEvent, view: ToolEventView | undefined): void {
    const data = event.data;
    if (!isObject(data)) return;
    const message = data.message;
    if (!isObject(message)) return;
    // 0.1.7（日志 v4）的结果是 `role:'tool'` 消息：内容直接是块，`toolCallId` 与 `isError`
    // 挂在消息上；tool-result 包装块只在 0.1.6 及更早的主机上出现，这里两种都认。
    const toolCallId = str(message.toolCallId);
    const callIdFromSource = str(jget(jget(message, 'source'), 'callId')) ?? toolCallId;
    if (callIdFromSource === undefined) return;
    const decoded = (arr(jget(message, 'content')) ?? []).map(decodeContentBlock);
    const wrappers = decoded.filter(
      (block): block is Extract<ContentBlock, { kind: 'tool-result' }> => block.kind === 'tool-result',
    );
    const content: ContentBlock[] = wrappers.length === 0 ? decoded : wrappers.flatMap(block => block.content);
    const wrappedCallId = toolCallId ?? (wrappers.length > 0 ? wrappers[0].toolCallId : callIdFromSource);
    const error = data.error === undefined ? undefined : decodeToolError(data.error);
    const result: ToolResultData = {
      seq: event.seq,
      time: event.time,
      content,
      // 没有 data.error 的失败（例如工具自己报的错）只在 message.isError 上。
      isError: error !== undefined || bool(message.isError) === true || wrappers.some(block => block.isError),
      error,
      meta: data.meta,
      resultView: view !== undefined && view.for === 'result' ? view.view : undefined,
    };
    // callId 为空时要能接回那条调用。调用那端在 callId 为空时把键写成 `seq-<seq>`
    // （见 applyToolCall），所以结果这端不能拿空串去查——那样既接不上真正的调用
    //（它永远停在「没有结果」），又会在 `tool-call:` 这把空键上反复互相覆盖。
    // 对齐 Mac / Android：挑最近一条还没有结果的工具调用接上去。
    const key = wrappedCallId.length === 0 ? this.pendingToolKey() : 'tool-call:' + wrappedCallId;
    const existing = key === undefined ? undefined : this.contexts.get(key);
    if (key !== undefined && existing !== undefined && existing.kind === 'tool') {
      const updated = cloneToolData(existing.data);
      updated.result = result;
      if (view !== undefined && view.for === 'call') updated.callView = view.view;
      this.contexts.set(key, { kind: 'tool', data: updated });
      return;
    }
    // 一条都接不上时才另起一行；id 必须唯一（Mac 用 `orphan-<seq>`），否则多条孤儿结果
    // 会挤在同一把键上，只剩最后一条可见。
    const orphanId = wrappedCallId.length === 0 ? 'orphan-' + event.seq : wrappedCallId;
    const orphan = newToolChatData({
      callId: orphanId,
      name: 'orphan-result',
      argsRaw: '',
      turn: int(data.turn) ?? 0,
      step: int(data.step) ?? 0,
      startSeq: event.seq,
      time: event.time,
      result,
    });
    this.contexts.set('tool-call:' + orphanId, { kind: 'tool', data: orphan });
  }

  /** 最近一条还没有结果的工具调用的上下文键（空 callId 的结果往它身上接）。 */
  private pendingToolKey(): string | undefined {
    let bestKey: string | undefined;
    let bestSeq = Number.NEGATIVE_INFINITY;
    for (const [key, node] of this.contexts) {
      if (node.kind !== 'tool' || node.data.result !== undefined) continue;
      if (node.data.startSeq > bestSeq) {
        bestSeq = node.data.startSeq;
        bestKey = key;
      }
    }
    return bestKey;
  }

  private applySubcallStart(event: SessionEvent): void {
    const data = event.data;
    if (!isObject(data)) return;
    const rootCallId = str(data.rootCallId);
    if (rootCallId === undefined) return;
    const parentCallId = str(data.parentCallId);
    if (parentCallId === undefined) return;
    const subCallId = str(data.subCallId);
    if (subCallId === undefined) return;
    const rootCtx = this.contexts.get('tool-call:' + rootCallId);
    const root = rootCtx !== undefined && rootCtx.kind === 'tool' ? rootCtx.data : undefined;
    const tool = newToolChatData({
      callId: subCallId,
      name: str(data.name) ?? '',
      argsRaw: jget(data, 'arguments') === undefined ? '' : encodeJson(jget(data, 'arguments') as JsonElement),
      turn: root?.turn ?? this.currentTurn,
      step: root?.step ?? this.maxActiveStep(),
      startSeq: event.seq,
      time: event.time,
      rootCallId,
      parentCallId,
    });
    tool.cwd = root?.cwd ?? this.directoryAt(event.seq);
    this.contexts.set('tool-call:' + subCallId, { kind: 'tool', data: tool });
  }

  private applySubcallEnd(event: SessionEvent): void {
    const data = event.data;
    if (!isObject(data)) return;
    const subCallId = str(data.subCallId);
    if (subCallId === undefined) return;
    const key = 'tool-call:' + subCallId;
    const existingCtx = this.contexts.get(key);
    const existing = existingCtx !== undefined && existingCtx.kind === 'tool' ? existingCtx.data : undefined;
    const child =
      existing !== undefined
        ? cloneToolData(existing)
        : newToolChatData({
            callId: subCallId,
            name: str(data.name) ?? '',
            // 结算事件同样带着规范化后的 arguments：start 不在窗口里时也别丢参数。
            argsRaw: data.arguments === undefined ? '' : encodeJson(data.arguments),
            turn: this.currentTurn,
            step: this.maxActiveStep(),
            startSeq: event.seq,
            time: event.time,
            rootCallId: str(data.rootCallId),
            parentCallId: str(data.parentCallId),
          });
    if (existing === undefined) child.cwd = this.directoryAt(event.seq);
    child.result = {
      seq: event.seq,
      time: event.time,
      content: (arr(data.content) ?? []).map(decodeContentBlock),
      isError: bool(data.isError) ?? false,
      // 子调用同样会带 error 与 presentationMeta：丢掉 error 的话，失败的子调用在卡片上
      // 读不出原因；丢掉 meta 的话，嵌套 read_image 的路径标签只能退回参数里的 file_path。
      error: data.error === undefined ? undefined : decodeToolError(data.error),
      meta: data.meta,
    };
    this.contexts.set(key, { kind: 'tool', data: child });
  }

  private maxActiveStep(): number {
    let max = 0;
    for (const step of this.activeSteps) if (step > max) max = step;
    return max;
  }

  // —— 轮次与步骤 ————————————————————————————————————————————

  private applyTurnStart(event: SessionEvent): void {
    const turn = int(jget(event.data, 'turn'));
    if (turn === undefined) return;
    this.currentTurn = turn;
    this.currentStep = 0;
    this.turnStartSeqs.set(turn, event.seq);
    this.turnStartTimes.set(turn, event.time);
    this.running = true;
    this.lastTurnErrored = false;
    const errKey = 'turn-error:' + turn;
    if (!this.contexts.has(errKey)) {
      this.contexts.set(errKey, {
        kind: 'turnErrorPending',
        pending: { turn, startSeq: event.seq, time: event.time },
      });
    }
    const tailKey = 'turn-tail:' + turn;
    if (!this.contexts.has(tailKey)) {
      this.contexts.set(tailKey, { kind: 'tail', data: newTurnTail(turn, event.seq, event.time) });
    }
  }

  private applyStepStart(event: SessionEvent): void {
    const step = int(jget(event.data, 'step'));
    if (step === undefined) return;
    this.activeSteps.add(step);
    this.currentStep = step;
    if (this.currentTurn === 0) return;
    this.stepStartTimes.set(this.currentTurn + ':' + step, event.time);
    const key = this.assistantStepKey(this.currentTurn, step);
    const ctx = this.contexts.get(key);
    if (ctx !== undefined && ctx.kind === 'assistant') {
      const state = cloneAssistantStep(ctx.state);
      state.stepStartTime = event.time;
      this.contexts.set(key, { kind: 'assistant', state });
    }
  }

  private applyStepEnd(event: SessionEvent): void {
    const step = int(jget(event.data, 'step'));
    if (step !== undefined) this.activeSteps.delete(step);
  }

  private applyTurnEnd(event: SessionEvent): void {
    const data = event.data;
    if (!isObject(data)) return;
    const turn = int(data.turn);
    if (turn === undefined) return;
    this.activeSteps.clear();
    const reason = data.reason;
    const kind = str(jget(reason, 'kind'));
    if (kind === 'error') {
      const failure = jget(reason, 'error');
      // AUTH 换成本地化说法、无 message 落到本地化兜底（对齐 Android turnFailureMessage）。
      const rawMessage = str(jget(failure, 'message')) ?? str(jget(reason, 'message'));
      const rawCode = str(jget(failure, 'code'));
      // turnFailureMessage 只读 reason.error.{code,message}；这里把已取到的两段拼回同一形状，
      // 省去第二次 jget 的不确定性。
      const message = turnFailureMessage(
        rawMessage === undefined && rawCode === undefined
          ? reason
          : ({ error: { code: rawCode, message: rawMessage } } as unknown as JsonElement),
      );
      const errKey = 'turn-error:' + turn;
      const ctx = this.contexts.get(errKey);
      if (ctx !== undefined && ctx.kind === 'turnErrorPending') {
        ctx.pending.message = message;
        ctx.pending.code = str(jget(failure, 'code'));
        ctx.pending.seq = event.seq;
      }
      this.lastTurnErrored = true;
      this.lastErroredTurn = turn;
      this.syncUnreadError();
    } else if (kind === 'max-tokens') {
      this.contexts.set('turn-max-tokens:' + turn, {
        kind: 'maxTokens',
        node: { seq: event.seq, time: event.time, turn },
      });
    } else {
      this.contexts.delete('turn-error:' + turn);
    }

    const tailKey = 'turn-tail:' + turn;
    const hasStart = this.contexts.get(tailKey)?.kind === 'tail';
    if (!hasStart) this.contexts.set(tailKey, { kind: 'tail', data: newTurnTail(turn, event.seq, event.time) });
    const tailCtx = this.contexts.get(tailKey);
    if (tailCtx === undefined || tailCtx.kind !== 'tail') return;
    const tail = tailCtx.data;
    tail.outcome = kind === 'aborted' ? 'stopped' : kind === 'error' ? 'failed' : 'completed';
    tail.endedAt = event.time;
    if (kind === 'completed') {
      tail.seq = event.seq;
      let lastAssistant: AssistantStepData | undefined;
      let firstStep: number | undefined;
      let firstStepTtftMs: number | undefined;
      // 这一轮最早那步的开始时刻：turn/start 被分页裁掉时用它当计时起点。
      let firstStepStartTime: number | undefined;
      let decodeMs = 0;
      let outputTokens = 0;
      let sampled = false;
      let turnUsage: TokenUsage = {};
      let billed = false;
      const steps: AssistantStepData[] = [];
      for (const ctx of Array.from(this.contexts.values())) {
        if (ctx.kind !== 'assistant') continue;
        const s = ctx.state;
        if (s.turn !== turn) continue;
        steps.push(s);
        if (lastAssistant === undefined || s.step > lastAssistant.step) lastAssistant = s;
        const usage = s.usage;
        if (usage !== undefined) {
          billed = true;
          turnUsage = {
            uncachedInputTokens: sumNullable(turnUsage.uncachedInputTokens, usage.uncachedInputTokens ?? usage.inputTokens),
            outputTokens: sumNullable(turnUsage.outputTokens, usage.outputTokens),
            cacheReadTokens: sumNullable(turnUsage.cacheReadTokens, usage.cacheReadTokens),
            cacheWriteTokens: sumNullable(turnUsage.cacheWriteTokens, usage.cacheWriteTokens),
            reasoningTokens: sumNullable(turnUsage.reasoningTokens, usage.reasoningTokens),
          };
        }
        const ttftMs =
          s.stepStartTime === undefined || s.firstTokenTime === undefined
            ? undefined
            : Math.max(0, s.firstTokenTime - s.stepStartTime);
        const stepDecodeMs = s.firstTokenTime === undefined ? undefined : Math.max(0, s.time - s.firstTokenTime);
        const out = s.usage?.outputTokens ?? 0;
        if (firstStep === undefined || s.step < firstStep) {
          firstStep = s.step;
          firstStepTtftMs = ttftMs;
          firstStepStartTime = s.stepStartTime;
        }
        if (stepDecodeMs !== undefined && out > 0) {
          decodeMs += stepDecodeMs;
          outputTokens += out;
          sampled = true;
        }
      }
      // 用量只有在「这一轮的步骤都在窗口里」时才作数，否则合计是残缺的。安卓用
      // hasStart（见过 turn/start）单独判定；小程序首屏只取最后 15 条消息，历史里那些
      // 轮次的 turn/start 经常被裁在窗口外，于是页脚一个读数都不剩。既然分步用量本身
      // 是按轮归属的，判据放宽成「窗口里最早的那一步就是第 1 步」——同样能证明这一轮
      // 没有被从中间截断，却不再依赖 turn/start 这一条事件是否恰好还在窗口里。
      const turnFullyLoaded = hasStart || firstStep === 1;
      if (billed && turnFullyLoaded) tail.usage = turnUsage;
      const routes: string[] = [];
      for (const s of steps.slice().sort((a, b) => a.step - b.step)) {
        const provider = s.provider;
        const model = s.model;
        if (provider === undefined || model === undefined) continue;
        if (provider.length === 0 || model.length === 0) continue;
        const route = provider + '/' + model;
        if (!routes.includes(route)) routes.push(route);
      }
      tail.routes = routes;
      tail.ttftMs = firstStepTtftMs;
      tail.decodeTokensPerSec = sampled && decodeMs > 0 ? outputTokens / (decodeMs / 1000) : undefined;
      if (lastAssistant !== undefined) {
        tail.messageId = lastAssistant.messageId;
        tail.closingText = lastAssistant.blocks
          .filter((block): block is Extract<AssistantBlock, { kind: 'text' }> => block !== null && block.kind === 'text')
          .map(block => block.text)
          .join('');
      }
      // 计时起点同理：没有 turn/start 时 tail.time 就是 turn/end 自己的时刻，
      // 相减恒为 0，用时胶囊会整个消失；这时退回这一轮最早那步的开始时刻。
      // 被截断的轮次不给兜底：算出来的用时只是窗口内那一段，比真实值短，读数会骗人。
      // 没有收尾消息（以工具调用结束）的成功轮次同样有用时。
      const startedAt = hasStart
        ? tail.time
        : turnFullyLoaded
          ? firstStepStartTime ?? this.turnFirstEventTime.get(turn)
          : undefined;
      tail.runMs = startedAt === undefined ? undefined : Math.max(0, event.time - startedAt);
    } else {
      tail.seq = event.seq;
    }

    this.running = false;
    if (this.currentTurn === turn) this.currentTurn = 0;
    for (const [key, ctx] of Array.from(this.contexts.entries())) {
      if (ctx.kind !== 'assistant') continue;
      const state = ctx.state;
      if (state.turn !== turn || state.status !== 'running') continue;
      const closed = cloneAssistantStep(state);
      closed.status = 'interrupted';
      closed.interrupted = true;
      this.contexts.set(key, { kind: 'assistant', state: closed });
    }
  }

  // —— 压缩 / 重试 / 命令 / 工作流 ————————————————————————————

  private applyCompaction(event: SessionEvent): void {
    const data = event.data;
    if (!isObject(data)) return;
    const compactionId = str(data.compactionId);
    if (compactionId === undefined) return;
    const key = 'compaction:' + compactionId;
    const existing = this.contexts.get(key);
    const node: CompactionSummaryNode =
      existing !== undefined && existing.kind === 'compaction'
        ? existing.node
        : { compactionId, seq: event.seq, time: event.time };
    if (event.type === 'compaction/summary') {
      const first = arr(data.summary);
      if (first !== undefined && first.length > 0) {
        const block = decodeContentBlock(first[0]);
        if (block.kind === 'text') node.summary = block.text;
      }
      node.summaryEventSeq = event.seq;
      node.shadowedTokenCount = int(data.shadowedTokenCount);
    }
    this.contexts.set(key, { kind: 'compaction', node });
  }

  private applyRetry(event: SessionEvent): void {
    const data = event.data;
    if (!isObject(data)) return;
    const retryId = str(data.retryId);
    if (retryId === undefined) return;
    const key = 'model-retry:' + retryId;
    const existing = this.contexts.get(key);
    const node =
      existing !== undefined && existing.kind === 'retry' ? existing.node : newModelRetryNode(retryId, event.seq, event.time);
    if (event.type === 'llm/retry') {
      node.retry = int(data.retry) ?? node.retry;
      node.maxRetries = int(data.maxRetries);
      node.delayMs = int(data.delayMs);
      node.failureMessage = str(jget(data.failure, 'message'));
      node.failureCode = str(jget(data.failure, 'code'));
      node.provider = str(data.provider);
      node.retryState = 'scheduled';
    } else if (event.type === 'llm/retry-started') {
      node.retryState = 'started';
    }
    this.contexts.set(key, { kind: 'retry', node });
    const retryTurn = int(data.turn);
    if (retryTurn !== undefined) this.contexts.delete('turn-error:' + retryTurn);
    if (event.type === 'llm/retry' && retryTurn !== undefined) {
      const step = int(data.step);
      if (step !== undefined) {
        const stepKey = this.assistantStepKey(retryTurn, step);
        const ctx = this.contexts.get(stepKey);
        if (ctx !== undefined && ctx.kind === 'assistant') {
          const state = cloneAssistantStep(ctx.state);
          state.blocks = [];
          state.status = 'running';
          state.firstVisibleSeq = undefined;
          state.settledSeq = undefined;
          state.messageId = undefined;
          state.usage = undefined;
          this.contexts.set(stepKey, { kind: 'assistant', state });
        }
      }
    }
  }

  private applyCommand(event: SessionEvent): void {
    const data = event.data;
    if (!isObject(data)) return;
    const commandId = str(data.commandId);
    if (commandId === undefined) return;
    const key = 'command:' + commandId;
    const existing = this.contexts.get(key);
    const node: CommandNode =
      existing !== undefined && existing.kind === 'command'
        ? existing.node
        : { commandId, seq: event.seq, time: event.time };
    if (event.type === 'command/run') {
      node.name = str(data.name);
      node.args = str(data.args);
    } else if (event.type === 'command/done') {
      node.outcome = {
        kind: str(data.kind) ?? 'success',
        text: str(data.text),
        sourceEventSeq: int(data.sourceEventSeq),
      };
    }
    this.contexts.set(key, { kind: 'command', node });
  }

  private applyWorkflow(event: SessionEvent): void {
    const data = event.data;
    if (!isObject(data)) return;
    const runId = str(data.runId);
    if (runId === undefined) return;
    const key = 'workflow-run:' + runId;
    const existing = this.contexts.get(key);
    let state: WorkflowState;
    if (existing !== undefined && existing.kind === 'workflow') {
      state = existing.state;
    } else if (event.type === 'tool-workflow/run-start') {
      state = { runId, name: str(data.name) ?? Strings.workflowUntitled, anchorSeq: event.seq, members: [] };
    } else {
      return;
    }
    if (event.type === 'tool-workflow/agent-start') {
      const seq = int(data.seq);
      const label = str(data.label);
      const childId = str(data.childId);
      if (seq === undefined || label === undefined || childId === undefined) return;
      state.members.push({ seq, label, phase: str(data.phase), childId });
    } else if (event.type === 'tool-workflow/agent-end') {
      const seq = int(data.seq);
      const outcome = str(data.outcome);
      if (seq === undefined || outcome === undefined) return;
      for (const member of state.members) if (member.seq === seq) member.outcome = outcome;
    } else if (event.type === 'tool-workflow/run-end') {
      state.stopReason = str(data.stopReason);
    }
    this.contexts.set(key, { kind: 'workflow', state });
  }

  private projectWorkflow(state: WorkflowState): WorkflowRunData {
    // 工作流转后台后会比它的步骤活得久：普通的 turn/end 什么也证明不了，只有崩溃或分叉截断的轮次
    // 才让没写 run-end 的工作流停下（web `turnAbandoned`，0.2.1）。
    const reason = this.turnEndBoundaryAfter(state.anchorSeq)?.[2];
    const interrupted = state.stopReason === undefined && (reason === 'interrupted' || reason === 'forked');
    const order: string[] = [];
    const groups = new Map<string, [phase: string | undefined, members: WorkflowRunMemberData[]]>();
    for (const member of state.members) {
      const key = member.phase !== undefined ? 'value:' + member.phase.length + ':' + member.phase : 'missing';
      if (!groups.has(key)) {
        groups.set(key, [member.phase, []]);
        order.push(key);
      }
      const group = groups.get(key);
      if (group === undefined) continue;
      group[1].push({
        seq: member.seq,
        label: member.label,
        childId: member.childId,
        status:
          member.outcome !== undefined
            ? workflowStatusFromOutcome(member.outcome)
            : interrupted
              ? 'interrupted'
              : 'running',
      });
    }
    const status =
      state.stopReason !== undefined
        ? workflowStatusFromStopReason(state.stopReason)
        : interrupted
          ? 'interrupted'
          : 'running';
    return {
      runId: state.runId,
      name: state.name,
      status,
      phases: order.map(key => {
        const group = groups.get(key) as [string | undefined, WorkflowRunMemberData[]];
        return { key, phase: group[0], members: group[1] };
      }),
      anchorSeq: state.anchorSeq,
    };
  }

  private turnEndBoundaryAfter(anchorSeq: number): [number, number, string?] | undefined {
    return this.turnEndBoundaries.find(entry => entry[0] > anchorSeq);
  }

  private applyPresented(event: SessionEvent): void {
    const parsed = decodePresentedFiles(event.seq, event.data);
    if (parsed === undefined) return;
    let files = this.presentedByTurn.get(parsed[0]);
    if (files === undefined) {
      files = [];
      this.presentedByTurn.set(parsed[0], files);
    }
    for (const file of parsed[1]) {
      const at = files.findIndex(existing => existing.path === file.path);
      if (at >= 0) files[at] = file;
      else files.push(file);
    }
    this.deliverablesRevision = this.deliverablesRevision + 1;
  }

  // —— 投影 ————————————————————————————————————————————————

  private recordProjectionVersion(value: JsonElement, key: string, seq: number): void {
    let versions = this.projectionHistory.get(key);
    if (versions === undefined) {
      versions = new Map<number, JsonElement>();
      this.projectionHistory.set(key, versions);
    }
    versions.set(seq, value);
    if (versions.size > MAX_PROJECTION_VERSIONS) {
      const retained = new Set(Array.from(versions.keys()).sort((a, b) => a - b).slice(-MAX_PROJECTION_VERSIONS));
      for (const version of Array.from(versions.keys())) if (!retained.has(version)) versions.delete(version);
    }
  }

  /**
   * 应用一帧 session/projection。
   *
   * 投影只进不退：键相同、seq 更小的帧直接丢弃。主机重连后可能把旧 seq 的投影
   * 又推一遍，若让旧值覆盖新值，标题/待办会往回跳。
   */
  applyProjection(frame: SessionProjectionFrame): void {
    this.recordProjectionVersion(frame.value, frame.key, frame.seq);
    const existing = this.projections.get(frame.key);
    if (existing === undefined || frame.seq > existing[1]) {
      this.projections.set(frame.key, [frame.value, frame.seq]);
      this.decodeSingleProjection(frame.key, frame.value);
    }
  }

  private rebuildProjections(throughSeq: number): void {
    this.projections.clear();
    for (const [key, versions] of Array.from(this.projectionHistory.entries())) {
      let bestSeq: number | undefined;
      let bestValue: JsonElement | undefined;
      for (const [seq, value] of Array.from(versions.entries())) {
        if (seq > throughSeq) continue;
        if (bestSeq === undefined || seq > bestSeq) {
          bestSeq = seq;
          bestValue = value;
        }
      }
      if (bestSeq === undefined || bestValue === undefined) continue;
      this.projections.set(key, [bestValue, bestSeq]);
    }
    this.title = '';
    this.blank = true;
    this.todos = [];
    this.goal = undefined;
    this.tokenUsage = undefined;
    this.sessionStats = undefined;
    this.imageLimits = undefined;
    this.permissionProjection = undefined;
    this.permissions = undefined;
    this.userQuestions = [];
    for (const [key, entry] of Array.from(this.projections.entries())) {
      this.decodeSingleProjection(key, entry[0]);
    }
  }

  /**
   * seq 那一刻的工作目录（对齐 Android `directoryAtSeq`）：新一刀的投影不能改写历史调用的路径，
   * 所以只认不晚于这个 seq 的目录变更事件或投影版本，取其中较新的那个；都没有就交给会话级 cwd。
   */
  private directoryAt(seq: number): string | undefined {
    let projected: [number, string | undefined] | undefined;
    for (const [version, value] of Array.from(this.projectionHistory.get('workingDirectory')?.entries() ?? [])) {
      if (version <= seq && (projected === undefined || version > projected[0])) projected = [version, str(value)];
    }
    const change = this.replayedDirectory !== undefined && this.replayedDirectory[0] <= seq ? this.replayedDirectory : undefined;
    if (change !== undefined && (projected === undefined || change[0] >= projected[0])) return change[1];
    return projected?.[1];
  }

  private noteWorkingDirectory(cwd: string | undefined, seq: number): void {
    if (seq < this.workingDirectorySeq) return;
    this.workingDirectorySeq = seq;
    this.workingDirectoryStore.set(cwd);
  }

  private decodeSingleProjection(key: string, value: JsonElement): void {
    // 没有专属 Store 的两个派生投影：落值就通知订阅方重新读 getter（见 derivedProjectionStore）。
    if (key === 'plan' || key === 'contextPressure') {
      this.derivedProjectionStore.set(this.derivedProjectionStore.get() + 1);
    }
    switch (key) {
      case 'turnOutline':
        this.rebuildTurnRail();
        break;
      case 'title': {
        const title = str(value);
        if (title !== undefined && title.length > 0) this.title = title;
        break;
      }
      case 'workingDirectory':
        this.noteWorkingDirectory(str(value), this.projections.get(key)?.[1] ?? -1);
        break;
      case 'sessionListMetadata': {
        const blank = bool(jget(value, 'blank'));
        if (blank !== undefined) this.blank = blank;
        break;
      }
      case 'todos': {
        const list = arr(value);
        if (list === undefined) break;
        this.todos = list.map(item => ({
          id: str(jget(item, 'id')) ?? randomId(),
          content: str(jget(item, 'content')) ?? '',
          status: str(jget(item, 'status')) ?? 'pending',
          priority: str(jget(item, 'priority')),
        }));
        break;
      }
      case 'goal': {
        if (value === null) {
          this.goal = undefined;
          break;
        }
        const snapshot = jget(value, 'goal');
        if (isObject(snapshot)) {
          this.goal = {
            id: str(snapshot.id) ?? '',
            revision: int(snapshot.revision) ?? 0,
            objective: str(snapshot.objective) ?? '',
            phase: str(snapshot.phase) ?? 'active',
            maxGoalRounds: int(snapshot.maxGoalRounds),
            blockedMessage: str(jget(snapshot.blockedReason, 'message')),
          };
        } else {
          this.goal = undefined;
        }
        break;
      }
      case 'tokenUsage': {
        const usage = decodeTokenUsage(value);
        if (usage !== undefined) this.tokenUsage = usage;
        break;
      }
      case 'sessionStats': {
        const stats = decodeSessionStats(value);
        if (stats !== undefined) this.sessionStats = stats;
        break;
      }
      case 'imageLimits': {
        const limits = decodeImageLimits(value);
        if (limits !== undefined) this.imageLimits = limits;
        break;
      }
      case 'permissions': {
        const permissions = decodePermissionSelect(value);
        if (permissions !== undefined) this.setPermissionProjection(permissions);
        break;
      }
      case 'inbox': {
        // 0.1.6：待发队列由这条会话投影发布整条消息，placement 由客户端推导。
        // 基线之后才创建的 store 没有投影历史，靠这一支把队列补上。
        const inbox = decodeInbox(value);
        if (inbox !== undefined) {
          this.setQueue({ sessionId: this.sessionId, items: rowsFromInbox(inbox) });
        }
        break;
      }
      case 'userQuestions':
        // 0.2.0：限时提问的会话投影 `{timed, active, settled}`，这里只要 active。
        this.userQuestions = decodeUserQuestions(value);
        break;
      case 'agentPreset': {
        const preset = str(value);
        if (preset !== undefined && preset.length > 0) this.agentPreset = preset;
        break;
      }
      case 'modelSelection': {
        const selection = decodeModelSelection(jget(value, 'next'));
        if (selection !== undefined) this.modelDirectory = modelDirectoryApplyProjected(this.modelDirectory, selection);
        break;
      }
      default:
        break;
    }
  }

  // —— 节点物化 ————————————————————————————————————————————

  /**
   * 还在流式生成的步骤里正在写参数的工具调用（web `preparing` 阶段，0.2.1，对齐 Mac `preparingTools`）：
   * 每条紧跟在它的步骤之后、按块序排；同 id 的 tool/call 一落就让位给正式行。
   */
  private preparingTools(state: AssistantStepData): ToolChatData[] {
    if (state.status !== 'running') return [];
    const anchor = chatNodeAnchorSeq({ kind: 'assistant', step: state });
    const out: ToolChatData[] = [];
    state.blocks.forEach((block, index) => {
      if (block === null || block.kind !== 'toolCall' || block.callId.length === 0 || block.name.length === 0) return;
      const tool = newToolChatData({
        callId: block.callId,
        name: block.name,
        argsRaw: block.argsRaw,
        turn: state.turn,
        step: state.step,
        startSeq: Math.trunc(anchor),
        time: state.time,
      });
      tool.preparing = true;
      tool.displaySeq = anchor + (index + 1) * 1e-6;
      tool.cwd = this.directoryAt(Math.trunc(anchor));
      out.push(tool);
    });
    return out;
  }

  private rebuildNodes(): void {
    const built: ChatNode[] = [];
    const tools = new Map<CallId, ToolChatData>();
    const preparing: ToolChatData[] = [];
    for (const ctx of Array.from(this.contexts.values())) {
      switch (ctx.kind) {
        case 'finalized':
          built.push(ctx.node);
          break;
        case 'assistant':
          if (assistantStepIsVisible(ctx.state)) built.push({ kind: 'assistant', step: ctx.state });
          preparing.push(...this.preparingTools(ctx.state));
          break;
        case 'tool': {
          const tool = cloneToolData(ctx.data);
          if (tool.result === undefined) {
            const boundary = this.turnEndBoundaryAfter(tool.startSeq);
            if (boundary !== undefined) {
              tool.result = {
                seq: boundary[0],
                time: boundary[1],
                content: [],
                isError: true,
                error: { name: Strings.workflowStatusInterrupted, code: 'interrupted' },
              };
            }
          }
          tools.set(tool.callId, tool);
          break;
        }
        case 'compaction':
          built.push({ kind: 'compaction', data: ctx.node });
          break;
        case 'retry':
          built.push({ kind: 'modelRetry', data: ctx.node });
          break;
        case 'turnErrorPending':
          if (ctx.pending.message !== undefined) {
            built.push({
              kind: 'turnError',
              data: {
                seq: ctx.pending.seq ?? ctx.pending.startSeq,
                time: ctx.pending.time,
                turn: ctx.pending.turn,
                message: ctx.pending.message,
                code: ctx.pending.code,
              },
            });
          }
          break;
        case 'maxTokens':
          built.push({ kind: 'turnMaxTokens', data: ctx.node });
          break;
        // 权限模式命令是界面自身的操作，对话区不显示（web `isVisibleChatNode`）。
        case 'command':
          if (ctx.node.name !== 'permission') built.push({ kind: 'command', data: ctx.node });
          break;
        case 'tail':
          built.push({ kind: 'turnTail', data: ctx.data });
          break;
        case 'workflow':
          built.push({ kind: 'workflow', data: this.projectWorkflow(ctx.state) });
          break;
        default:
          break;
      }
    }
    this.attachSubmittedPlans(built, tools);
    const childrenByParent = new Map<CallId, ToolChatData[]>();
    for (const tool of Array.from(tools.values())) {
      const parent = tool.parentCallId;
      if (parent === undefined) continue;
      if (!tools.has(parent)) continue;
      let children = childrenByParent.get(parent);
      if (children === undefined) {
        children = [];
        childrenByParent.set(parent, children);
      }
      children.push(tool);
    }
    for (const children of Array.from(childrenByParent.values())) children.sort((a, b) => a.startSeq - b.startSeq);

    const nested = (tool: ToolChatData, visited: Set<CallId>, depth: number): ToolChatData => {
      const children = childrenByParent.get(tool.callId);
      if (children === undefined || visited.has(tool.callId) || depth >= 64) return tool;
      const value = cloneToolData(tool);
      const seen = new Set(visited);
      seen.add(tool.callId);
      value.subCalls = children.map(child => nested(child, seen, depth + 1));
      return value;
    };
    for (const tool of Array.from(tools.values())) {
      if (tool.parentCallId === undefined || !tools.has(tool.parentCallId)) {
        built.push({ kind: 'tool', data: nested(tool, new Set<CallId>(), 0) });
      }
    }
    // 流式写参数的调用先占一行，tool/call 落定后由正式行接替。
    for (const tool of preparing) if (!tools.has(tool.callId)) built.push({ kind: 'tool', data: tool });

    let keyed: KeyedNode[] = built
      .map(node => ({ anchor: chatNodeAnchorSeq(node), id: chatNodeId(node), node }))
      .sort(keyedCompare);
    keyed = this.applyTurnProcessFolding(keyed);
    this.nodes = keyed.map(item => item.node);
    this.indexRows();
  }

  /**
   * 已结束轮次里 exit_plan_mode 提交的计划（含程序内派发的子调用）挂到该轮页脚，
   * 不论审批结果；审批中的不挂，免得与计划评审弹层重复（web ui-plan `PlanCards`）。
   */
  private attachSubmittedPlans(built: ChatNode[], tools: Map<CallId, ToolChatData>): void {
    const byTurn = new Map<number, ToolChatData[]>();
    for (const tool of Array.from(tools.values())) {
      if (tool.name !== 'exit_plan_mode' || this.turnEndBoundaryAfter(tool.startSeq) === undefined) continue;
      const calls = byTurn.get(tool.turn);
      if (calls === undefined) byTurn.set(tool.turn, [tool]);
      else calls.push(tool);
    }
    if (byTurn.size === 0) return;
    built.forEach((node, index) => {
      if (node.kind !== 'turnTail') return;
      const calls = byTurn.get(node.data.turn);
      if (calls === undefined) return;
      const plans = calls
        .sort((a, b) => a.startSeq - b.startSeq)
        .map(call => submittedPlan(call.callId, call.argsRaw))
        .filter((plan): plan is SubmittedPlan => plan !== undefined);
      if (plans.length > 0) built[index] = { kind: 'turnTail', data: { ...node.data, plans } };
    });
  }

  private applyTurnProcessFolding(input: KeyedNode[]): KeyedNode[] {
    this.rebuildTurnProcessSpecs(input.map(item => item.node));
    if (this.turnProcessSpecs.size === 0) return input;
    let keyed = input.slice();
    for (const spec of Array.from(this.turnProcessSpecs.values())) {
      const control: ChatNode = { kind: 'turnProcess', spec };
      keyed.push({ anchor: chatNodeAnchorSeq(control), id: chatNodeId(control), node: control });
    }
    keyed = keyed.sort(keyedCompare);
    keyed = keyed.filter(item => !this.isFoldedProcessRow(item.node));
    // 折叠状态下把答案步骤自己的 reasoning 隐掉。
    for (const spec of Array.from(this.turnProcessSpecs.values())) {
      if (!spec.inlineReasoning || this.expandedProcessKeys.has(turnProcessKey(spec))) continue;
      const index = keyed.findIndex(
        item =>
          item.node.kind === 'assistant' && item.node.step.turn === spec.turn && item.node.step.step === spec.answerStep,
      );
      if (index < 0) continue;
      const current = keyed[index];
      if (current.node.kind !== 'assistant') continue;
      const step = cloneAssistantStep(current.node.step);
      step.blocks = step.blocks.map(block => (block !== null && block.kind === 'reasoning' ? null : block));
      keyed[index] = { ...current, node: { kind: 'assistant', step } };
    }
    return keyed;
  }

  private isReplyBlock(block: AssistantBlock | null | undefined): boolean {
    if (block === null || block === undefined) return false;
    if (block.kind === 'text') return block.text.trim().length > 0;
    return block.kind === 'image' || block.kind === 'other';
  }

  private rebuildTurnProcessSpecs(rows: ChatNode[]): void {
    this.turnProcessSpecs.clear();
    // 不看 hasMore：已载入 turn/end 的局部历史轮次同样可折（web `processWindowReady`、Mac/安卓都不设此门槛），
    // 否则首屏只要还有更早历史就整屏不折叠。

    interface Accumulator {
      processAnchors: number[];
      lastAnchor?: number;
      lastStep: number;
      lastIsAnswer: boolean;
      lastReasoning: boolean;
      /** 轮中插话（web `hasInterleavedInput`）：这一轮保持展开。 */
      interleaved: boolean;
    }

    const byTurn = new Map<number, Accumulator>();
    const order: number[] = [];
    let openTurn: number | undefined;
    // 本轮第一个带轮次号的行之前见到的无轮次行；command 单独标出，turn/start 之前输入的命令不算过程。
    const pendingAnchors: Array<{ anchor: number; command: boolean }> = [];
    // 输入到来时已经有行的那一轮：同一轮随后又产出过程证据，这条输入就是轮中插话。
    let turnBeforeInput: number | undefined;
    const accumulatorFor = (turn: number): Accumulator => {
      let acc = byTurn.get(turn);
      if (acc === undefined) {
        acc = {
          processAnchors: [],
          lastStep: 0,
          lastIsAnswer: false,
          lastReasoning: false,
          interleaved: false,
        };
        byTurn.set(turn, acc);
        order.push(turn);
      }
      return acc;
    };

    for (const node of rows) {
      // 用户、插队与轮次触发都是一轮的开头，之后的行不能再算给前一轮。
      if (node.kind === 'user' || node.kind === 'steering' || node.kind === 'turnTrigger') {
        if (openTurn !== undefined) turnBeforeInput = openTurn;
        openTurn = undefined;
        pendingAnchors.length = 0;
        continue;
      }
      const turnNumber = chatNodeTurnNumber(node);
      if (turnNumber !== undefined) {
        if (turnNumber === turnBeforeInput && (node.kind === 'assistant' || node.kind === 'tool')) {
          const steered = byTurn.get(turnNumber);
          if (steered !== undefined) steered.interleaved = true;
        }
        turnBeforeInput = undefined;
        openTurn = turnNumber;
      }
      const turn = openTurn;
      if (turn === undefined) {
        pendingAnchors.push({ anchor: chatNodeAnchorSeq(node), command: node.kind === 'command' });
        continue;
      }
      const acc = accumulatorFor(turn);
      if (pendingAnchors.length > 0) {
        // turn/start 之前输入的命令（如 /goal）是读者自己的输入，不能把折叠起点拉到它上面（web 从 turn/start 起折）。
        const start = this.turnStartSeqs.get(turn);
        for (const pending of pendingAnchors) {
          if (!pending.command || start === undefined || pending.anchor >= start) acc.processAnchors.push(pending.anchor);
        }
        pendingAnchors.length = 0;
      }
      switch (node.kind) {
        case 'assistant': {
          const step = node.step;
          const hasReply = step.blocks.some(block => this.isReplyBlock(block));
          if (acc.lastAnchor !== undefined) acc.processAnchors.push(acc.lastAnchor);
          const isAnswer =
            step.status === 'settled' && hasReply && !step.blocks.some(block => block !== null && block.kind === 'toolCall');
          const reasoning = step.blocks.some(block => block !== null && block.kind === 'reasoning' && block.text.trim().length > 0);
          acc.lastAnchor = chatNodeAnchorSeq(node);
          acc.lastStep = step.step;
          acc.lastIsAnswer = isAnswer;
          acc.lastReasoning = reasoning;
          break;
        }
        case 'tool':
        case 'modelRetry':
        case 'compaction':
        case 'command':
        case 'workflow':
        case 'unknownSurface':
        case 'toolChange':
          acc.processAnchors.push(chatNodeAnchorSeq(node));
          break;
        default:
          break;
      }
    }

    for (const turn of order) {
      const acc = byTurn.get(turn);
      if (acc === undefined) continue;
      const lastAnchor = acc.lastAnchor;
      if (lastAnchor === undefined) continue;
      // 每个已关闭的轮次都有一个折叠头（对齐 Mac：文案就是结局，停止/失败也画）；
      // 进行中的轮次没有（web 只在轮次关闭后渲染）。
      const end = this.turnEndBoundaryAfter(Math.trunc(lastAnchor));
      if (end === undefined) continue;
      const outcome: TurnOutcome = end[2] === 'aborted' ? 'stopped' : end[2] === 'error' ? 'failed' : 'completed';
      const answered = acc.lastIsAnswer;
      // 有最终回答：收起回答之前的过程；没有：整轮都是过程，收到 turn/end 为止，也没有内联 reasoning 要藏。
      const externalCandidates = answered ? acc.processAnchors.filter(anchor => anchor < lastAnchor) : acc.processAnchors;
      const external = externalCandidates.length > 0 ? Math.min(...externalCandidates) : undefined;
      // 只有正常结束、没有轮中插话、且真有东西可藏的轮次才可折（web `canCollapse`）；
      // 其余轮次的折叠头只交代结局，不带箭头。
      const foldable = outcome === 'completed' && !acc.interleaved && (!answered || external !== undefined || acc.lastReasoning);
      this.turnProcessSpecs.set(turn + ':' + acc.lastStep, {
        turn,
        processStartSeq: Math.min(external ?? lastAnchor, lastAnchor),
        foldEndSeq: foldable ? (answered ? lastAnchor : end[0] + 0.5) : undefined,
        answerStep: acc.lastStep,
        inlineReasoning: foldable && answered && acc.lastReasoning,
        outcome,
        // 用时只给完成的轮次（停止/失败用结局替掉用时）；tail.runMs = turn/end - turn/start。
        durationMs:
          outcome !== 'completed'
            ? undefined
            : (tail => (tail !== undefined && tail.kind === 'tail' ? tail.data.runMs : undefined))(
                this.contexts.get('turn-tail:' + turn),
              ),
      });
    }
  }

  private isFoldedProcessRow(node: ChatNode): boolean {
    switch (node.kind) {
      case 'user':
      case 'steering':
      // 触发通知说明是谁唤醒了这一轮，不能折进它开启的过程里。
      case 'turnTrigger':
      case 'turnProcess':
      case 'turnError':
      case 'turnMaxTokens':
      case 'turnTail':
        return false;
      default:
        break;
    }
    const anchor = chatNodeAnchorSeq(node);
    const spec = Array.from(this.turnProcessSpecs.values()).find(candidate => turnProcessCovers(candidate, anchor));
    if (spec === undefined) return false;
    return !this.expandedProcessKeys.has(turnProcessKey(spec));
  }

  isTurnProcessExpanded(spec: TurnProcessSpec): boolean {
    return this.expandedProcessKeys.has(turnProcessKey(spec));
  }

  /** 该轮过程折叠的展开态 Store；行组件订阅它，展开/收起才会即时重绘。 */
  expandedProcessStore(spec: TurnProcessSpec): Store<boolean> {
    const key = turnProcessKey(spec);
    let store = this.expandedProcessStores.get(key);
    if (store === undefined) {
      store = new Store<boolean>(this.expandedProcessKeys.has(key));
      this.expandedProcessStores.set(key, store);
    }
    return store;
  }

  setTurnProcessExpanded(spec: TurnProcessSpec, expanded: boolean): void {
    const key = turnProcessKey(spec);
    const changed = expanded ? !this.expandedProcessKeys.has(key) : this.expandedProcessKeys.has(key);
    if (expanded) this.expandedProcessKeys.add(key);
    else this.expandedProcessKeys.delete(key);
    // 先把行组件的 Store 定下来：展开后折叠过滤把这轮的思考/工具行放回转写，
    // 行自己也要知道现在是展开态（对齐 Android store.isTurnProcessExpanded）。
    this.expandedProcessStore(spec).set(expanded);
    if (changed) this.rebuildNodes();
  }

  private indexRows(): void {
    const producedBefore = this.snapshotProducedPaths();
    this.producedPathsByTurn.clear();
    this.closingAssistantStepByTurn.clear();
    this.toolCallRootIndex.clear();
    this.turnAnchorRows.clear();
    this.turnPromptRow.clear();
    this.turnPromptAnchors.clear();
    this.turnResponseRow.clear();
    const seenPaths = new Map<number, Set<string>>();
    let pendingPromptRow: number | undefined;
    const nodes = this.nodes;
    nodes.forEach((node, index) => {
      if (node.kind === 'user' || node.kind === 'command') pendingPromptRow = index;
      const turn = chatNodeTurnNumber(node);
      if (turn !== undefined && !this.turnAnchorRows.has(turn)) {
        const anchor = pendingPromptRow ?? index;
        const label = chatNodeId(nodes[anchor]);
        this.turnAnchorRows.set(turn, label);
        if (pendingPromptRow !== undefined) {
          this.turnPromptRow.set(turn, anchor);
          this.turnPromptAnchors.set(turn, label);
        }
        pendingPromptRow = undefined;
      }
      if (node.kind === 'tool') {
        this.toolCallRootIndex.set(node.data.callId, index);
        const data = node.data;
        if (data.parentCallId === undefined) {
          const result = data.result;
          if (result !== undefined && !result.isError) {
            const path = producedPath(data.name, data.argsRaw);
            if (path !== undefined) {
              let seen = seenPaths.get(data.turn);
              if (seen === undefined) {
                seen = new Set<string>();
                seenPaths.set(data.turn, seen);
              }
              if (!seen.has(path)) {
                seen.add(path);
                let list = this.producedPathsByTurn.get(data.turn);
                if (list === undefined) {
                  list = [];
                  this.producedPathsByTurn.set(data.turn, list);
                }
                list.push(path);
              }
            }
          }
        }
      } else if (node.kind === 'assistant') {
        const step = node.step;
        if (step.step >= (this.closingAssistantStepByTurn.get(step.turn) ?? NO_VALUE)) {
          this.closingAssistantStepByTurn.set(step.turn, step.step);
        }
        if (step.blocks.some(block => block !== null && block.kind === 'text' && block.text.length > 0)) {
          this.turnResponseRow.set(step.turn, index);
        }
      }
    });
    if (!this.producedPathsEqual(producedBefore)) this.deliverablesRevision = this.deliverablesRevision + 1;
    this.rebuildTurnRail();
  }

  private snapshotProducedPaths(): Map<number, string[]> {
    const copy = new Map<number, string[]>();
    for (const [turn, paths] of Array.from(this.producedPathsByTurn.entries())) copy.set(turn, paths.slice());
    return copy;
  }

  private producedPathsEqual(before: Map<number, string[]>): boolean {
    if (before.size !== this.producedPathsByTurn.size) return false;
    for (const [turn, paths] of Array.from(before.entries())) {
      const current = this.producedPathsByTurn.get(turn);
      if (current === undefined || current.length !== paths.length) return false;
      for (let i = 0; i < paths.length; i += 1) if (paths[i] !== current[i]) return false;
    }
    return true;
  }

  private rebuildTurnRail(): void {
    const merged = mergeTurnRailItems(
      this.projectionValue('turnOutline'),
      this.turnAnchorRows,
      this.turnPromptAnchors,
      turn => this.loadedTurnPreview(turn),
    );
    if (JSON.stringify(merged) !== JSON.stringify(this.turnRail)) this.turnRail = merged;
  }

  private loadedTurnPreview(turn: number): [string, string] {
    let prompt = '';
    const promptRow = this.turnPromptRow.get(turn);
    if (promptRow !== undefined) {
      const node = this.nodes[promptRow];
      if (node !== undefined && node.kind === 'user') {
        prompt = clipTurnRailPreview(
          node.content.filter((block): block is Extract<ContentBlock, { kind: 'text' }> => block.kind === 'text').map(block => block.text),
          TURN_RAIL_PROMPT_LIMIT,
        );
      }
    }
    let response = '';
    const responseRow = this.turnResponseRow.get(turn);
    if (responseRow !== undefined) {
      const node = this.nodes[responseRow];
      if (node !== undefined && node.kind === 'assistant') {
        response = clipTurnRailPreview(
          node.step.blocks
            .filter((block): block is Extract<AssistantBlock, { kind: 'text' }> => block !== null && block.kind === 'text')
            .map(block => block.text),
          TURN_RAIL_RESPONSE_LIMIT,
        );
      }
    }
    return [prompt, response];
  }

  // —— 实时助手侧信道 ————————————————————————————————————————

  applyAssistantStreamFrame(frame: AssistantStreamFrame): void {
    if (frame.kind === 'start') {
      this.liveAttemptId = frame.attemptId;
      this.liveAttemptTurn = frame.turn;
      this.liveAttemptStep = frame.step;
      return;
    }
    if (frame.kind === 'chunk') {
      if (this.liveAttemptId !== frame.attemptId) return;
      this.applyAssistantLiveChunk(
        this.liveAttemptTurn,
        this.liveAttemptStep,
        this.nextLiveChunkSeq(),
        frame.time,
        frame.chunk,
      );
      this.rebuildNodes();
      return;
    }
    if (this.liveAttemptId === frame.attemptId) this.liveAttemptId = undefined;
  }

  applyAssistantStreamBaseline(baseline: AssistantStreamBaseline | undefined): void {
    const attempt = baseline?.activeAttempt;
    if (attempt === undefined) {
      this.liveAttemptId = undefined;
      return;
    }
    this.liveAttemptId = attempt.attemptId;
    this.liveAttemptTurn = attempt.turn;
    this.liveAttemptStep = attempt.step;
    this.applyAssistantStreamRecords(attempt.turn, attempt.step, undefined, attempt.stream);
    this.rebuildNodes();
  }

  // —— 可应答帧 ————————————————————————————————————————————

  setApproval(approval: ApprovalRequested | undefined): void {
    this.pendingApproval = approval;
  }

  setQuestion(question: QuestionRequested | undefined): void {
    this.pendingQuestion = question;
  }

  setQueue(frame: SessionQueueFrame): void {
    this.applyQueue(frame.items);
  }

  /**
   * 落一份待发队列。
   *
   * 0.1.5 走 control 流的 queue 帧，0.1.6 走 inbox 投影；两条通道都归到这里，
   * 上层（composer 的队列条与插队条）只认这一份值。
   */
  applyQueue(items: QueuedInboxItem[]): void {
    const observed = new Set(
      items.map(item => item.rpcId).filter((item): item is string => item !== undefined),
    );
    if (observed.size > 0) {
      this.pendingSubmissions = this.pendingSubmissions.filter(item => !observed.has(item.requestId));
    }
    if (JSON.stringify(this.queue) !== JSON.stringify(items)) {
      this.queue = items;
    }
  }

  // —— 权限预设 ————————————————————————————————————————————

  /**
   * 进程级预设目录（0.1.6 的 permissionPresets/catalog）。
   *
   * 目录是进程级、跨会话共享的，所以由 appModel 拉到后推给每个打开的会话；
   * 一旦有值就优先它——0.1.6 的投影已经不带 options 了。
   */
  setPermissionCatalog(options: PermissionPresetOption[] | undefined): void {
    // 空目录按「没有目录」处理：0.1.5 主机拉不到 catalog，不能把投影内联的那份候选盖掉。
    this.permissionCatalogOptions = options === undefined || options.length === 0 ? undefined : options;
    this.refreshPermissions();
  }

  private setPermissionProjection(value: PermissionSelectValue): void {
    this.permissionProjection = value;
    this.refreshPermissions();
  }

  private refreshPermissions(): void {
    const merged = permissionSelectionMerge(this.permissionProjection, this.permissionCatalogOptions);
    this.permissions = merged;
  }

  // —— 每轮改动文件（0.1.6） ————————————————————————————————

  /**
   * 接住一条 `workspace/changes` 公告。
   *
   * 事件本身不画任何东西——它只说「第 N 轮变了，去 seq 处读」——所以这里只记下
   * 「这一轮最新的公告 seq」。汇总与 diff 的取数由页面按这个坐标发起。
   */
  private applyWorkspaceChanges(event: SessionEvent): void {
    const turn = int(jget(event.data, 'turn'));
    if (turn === undefined || turn < 1) return;
    const previous = this.changesSeqByTurn.get(turn);
    if (previous === undefined || event.seq > previous) this.changesSeqByTurn.set(turn, event.seq);
    this.deliverablesRevision = this.deliverablesRevision + 1;
  }

  /** 一条已公告的改动记录的坐标；没有公告时返回 undefined。 */
  changesAddress(turn: number): TurnChangesAddress | undefined {
    const seq = this.changesSeqByTurn.get(turn);
    return seq === undefined ? undefined : { sessionId: this.sessionId, seq };
  }

  setJobs(frame: SessionJobsFrame): void {
    this.jobs = frame.jobs;
  }

  // —— 加载更早的历史 ————————————————————————————————————————
  //
  // 取数本身在 appModel（它持有 transport），这里只负责「该不该发、发哪一段、
  // 结果怎么并入窗口」。Android 里这几个方法是 PhoneModel 的，但它们全部只吃
  // SessionStore 的游标状态，放在这里可以让游标与窗口的裁切逻辑待在同一处。

  setHistoryPageLoader(loader: HistoryPageLoader | undefined): void {
    this.historyPageLoader = loader;
  }

  get canLoadEarlier(): boolean {
    return this.hasMore && !this.loadingHistory;
  }

  private async loadPage(loadingOlder: boolean): Promise<void> {
    const loader = this.historyPageLoader;
    if (loader === undefined) return;
    // 没有权威游标就不发 session/page：throughSeq 只能填一个假的 0，
    // 主机会当成"截止到第 0 条事件"回一页非消息事件，反而把转写打成空态。
    const throughSeq = this.historyCursor;
    if (throughSeq < 0) return;
    this.loadingHistory = true;
    try {
      const value = await loader({
        sessionId: this.sessionId,
        throughSeq,
        beforeSeq: loadingOlder ? this.firstSeq : undefined,
        limit: loadingOlder ? HISTORY_MESSAGES : INITIAL_HISTORY_MESSAGES,
        firstPage: !loadingOlder,
      });
      this.loadHistory(value, !loadingOlder);
      this.historyError = undefined;
    } catch (error) {
      this.historyError = { code: 'internal', message: describeError(error) };
    } finally {
      this.loadingHistory = false;
    }
  }

  async loadEarlier(): Promise<void> {
    if (!this.hasMore || this.loadingHistory) return;
    await this.loadPage(true);
  }

  /** 基线取不回来时的重试：清掉错误再取一次首屏。 */
  async retryHistory(): Promise<void> {
    this.historyError = undefined;
    await this.loadPage(false);
  }

  /** 为轮次跳转分页到指定序号。 */
  async loadHistoryThrough(seq: number): Promise<void> {
    let pages = 0;
    while (this.hasMore && (this.firstSeq ?? Number.MAX_SAFE_INTEGER) > seq && pages < 20) {
      const before = this.firstSeq;
      await this.loadPage(true);
      if (this.firstSeq === before) return;
      pages += 1;
    }
  }

  /** 为轮次导航补齐某一轮的用户消息（还没加载到时往上翻）。 */
  async loadHistoryForPrompt(turn: number): Promise<void> {
    let pages = 0;
    while (this.hasMore && this.turnRail.find(item => item.turn === turn)?.promptRow === undefined && pages < 20) {
      const before = this.firstSeq;
      await this.loadPage(true);
      if (this.firstSeq === before) return;
      pages += 1;
    }
  }
}

/**
 * 模块级单例入口：页面与 appModel 都从它拿「当前这条会话」的窗口。
 *
 * 多会话并行时（后台还在跑的会话）由 appModel 另外 new SessionStore(sessionId)
 * 持有，写完把正在看的那条 open() 到这个单例上。
 */
export const sessionStore = new SessionStore();

/**
 * 消费唯一的多路下行，把每条逻辑流路由到各个 Store。
 *
 * 与 Android 的 StreamCoordinator 一一对应：连接期间常开三条流（$events /
 * workspace/follow / session/control），外加每个打开会话一条 session/follow 与一条
 * job/list（0.1.7 把后台任务从 session/control 拆成了独立的 `job` 命名空间）。
 * 每条流都以完整基线开场，所以"重连"等于"重新订阅"而不是"重新同步"。
 *
 * 移植时把 kotlinx.coroutines 的 scope.launch 换成 Promise，把 MuxStream 换成
 * 注入的 MuxConnection 工厂（手机端由 transport/tunnel/mux.ts 的 TunnelMux 提供）；
 * Android 上挂在 Compose mutableStateOf 上的三个可观察量收进一个 Store，
 * 页面照常用 useStore 订阅。所有 store 都靠构造参数注入，这里不 new 任何传输。
 */
import { arr, bool, dbl, jget, str, type JsonElement, type JsonValue } from '../model/json';
import {
  decodeControlFrame,
  decodeFollowFrame,
  decodeInbox,
  decodeJobListFrame,
  decodeRemoteEventFrame,
  decodeSessionSummary,
  decodeWorkspaceFrame,
  rowsFromInbox,
  type AssistantStreamBaseline,
  type AssistantStreamFrame,
  type QueuedInboxItem,
  type RemoteEventFrame,
  type SessionControlFrame,
  type SessionFollowFrame,
  type WorkspaceFollowFrame,
} from '../model/frames';
import type { SessionAwaitingKind } from '../model/format';
import { liveTurnFailureMessage } from '../model/turnFailure';
import {
  pendingInteractionKind,
  type ApprovalRequested,
  type AskUserQuestionItem,
  type AskUserQuestionOption,
  type QuestionIntent,
  type QuestionRequested,
} from '../model/questionFlow';
import type {
  HistoryEntry,
  JobView,
  SessionAddress,
  SessionEvent,
  SessionHistoryValue,
  SessionId,
  SessionSummary,
  WorkspaceId,
  WorkspaceView,
} from '../model/types';
import type {
  MuxConnection,
  MuxEvent,
  RemoteEventOutcome,
  RpcError,
  WsConnectionState,
} from '../transport/types';
import { encodeSessionAddress } from '../transport/rpcMethods';
import { Store } from './store';

/** 连接实况。Android 上是三个独立的 mutableStateOf，这里合成一个可订阅快照。 */
export interface StreamCoordinatorState {
  /** ready 帧里的 clientId，后续 settleRemoteEvent 要用它回执。 */
  remoteEventClientId?: string;
  hostHome?: string;
  connectionState?: WsConnectionState;
}

export interface HistoryError { code: string; message: string }

/** 一份可以立刻画出来的窗口；只负责喂给缓存写盘回调。 */
export interface CachedWindow {
  cursor: number;
  hasMore: boolean;
  records: HistoryEntry[];
}

/** 本机缓存的最小契约；小程序端按需要接到 wx 存储或直接丢弃。 */
export interface StreamSessionCache {
  saveWindow(sessionId: SessionId, window: CachedWindow): void | Promise<void>;
}

export interface SessionQueueFrame { sessionId: SessionId; items: QueuedInboxItem[] }
export interface SessionJobsFrame { sessionId: SessionId; jobs: JobView[] }
export interface SessionProjectionFrame { sessionId: SessionId; key: string; value: JsonElement; seq: number }

/**
 * 会话 Store 的最小契约，字段与 Android SessionStore 同名。
 *
 * 不直接依赖具体的 SessionStore 实现：这一层只负责把流帧翻译成这些写入动作，
 * 谁持有窗口、怎么重放历史由会话 Store 自己决定。这里不引 frames.ts 的同名
 * 帧类型，避免同一个名字在两处各自演化。
 */
export interface StreamSession {
  readonly sessionId: SessionId;
  loadingHistory: boolean;
  running: boolean;
  historyError?: HistoryError;
  readonly historyLoaded: boolean;
  readonly lastSeq: number;
  readonly repairCursor: number;
  readonly followAddress: SessionAddress;
  readonly historyWindow: HistoryEntry[];
  readonly pendingApproval?: ApprovalRequested;
  readonly pendingQuestion?: QuestionRequested;
  apply(event: SessionEvent, view?: HistoryEntry['view']): void;
  markErrorSeen(): void;
  beginGapRepair(entry: HistoryEntry): number | undefined;
  completeGapRepair(value: SessionHistoryValue, generation: number): void;
  failGapRepair(generation: number): void;
  loadHistory(value: SessionHistoryValue, replacing: boolean): void;
  subscribe(authoritativeLastSeq: number): void;
  applyAssistantStreamBaseline(baseline: AssistantStreamBaseline | undefined): void;
  applyAssistantStreamFrame(frame: AssistantStreamFrame): void;
  applyProjection(frame: SessionProjectionFrame): void;
  setQueue(frame: SessionQueueFrame): void;
  setJobs(frame: SessionJobsFrame): void;
  setApproval(approval: ApprovalRequested | undefined): void;
  setQuestion(question: QuestionRequested | undefined): void;
}

/** 会话列表侧信道。 */
export interface SessionListSink {
  upsert(summary: SessionSummary): void;
  remove(sessionId: SessionId): void;
  setRunning(sessionId: SessionId, running: boolean): void;
  recordActivity(sessionId: SessionId, updatedAt: number): void;
  markAwaitingUser(sessionId: SessionId, kind: SessionAwaitingKind): void;
  clearAwaitingUser(sessionId: SessionId): void;
  clearAllAwaitingUser(): void;
  updateProjection(sessionId: SessionId, key: string, value: JsonElement, seq: number): void;
}

/** 工作区注册表侧信道。 */
export interface WorkspaceSink {
  setWorkspaces(items: WorkspaceView[], archivedSessionIds: SessionId[]): void;
  upsert(workspace: WorkspaceView): void;
  remove(workspaceId: WorkspaceId): void;
  applyOrder(workspaceIds: WorkspaceId[]): void;
  setArchived(archivedSessionIds: SessionId[]): void;
}

/** 通知中心消费的注意力事实。 */
export type AttentionSignal =
  | { kind: 'running'; sessionId: SessionId; running: boolean }
  | { kind: 'failed'; sessionId: SessionId; message: string }
  | { kind: 'approvalRequested'; approval: ApprovalRequested }
  | { kind: 'questionAsked'; question: QuestionRequested }
  | { kind: 'waterfallRetired'; sessionId: SessionId; eventId: string }
  | { kind: 'sessionCompleted'; sessionId: SessionId };

/** 只有真正的人类消息才推进会话活跃时间。 */
export function sessionActivityTimestamp(event: SessionEvent): number | undefined {
  if (event.type !== 'user/message') return undefined;
  if (str(jget(jget(event.data, 'source'), 'kind')) !== 'user') return undefined;
  return event.time;
}

export const EVENTS = 'events';
export const WORKSPACES = 'workspaces';
export const CONTROL = 'control';

/**
 * follow 快照默认带几轮消息，与首屏口径一致。
 *
 * 这里只兜底调用方没显式给窗口的情况（reopenAssistantStream、补洞重开）；
 * 首屏那份由调用方显式指定。
 */
const DEFAULT_FOLLOW_MESSAGES = 15;

export function followStreamId(sessionId: SessionId): string {
  return `follow:${sessionId}`;
}

export function sessionIdOfFollow(streamId: string): SessionId | undefined {
  return streamId.startsWith('follow:') ? streamId.slice('follow:'.length) : undefined;
}

export function jobsStreamId(sessionId: SessionId): string {
  return `jobs:${sessionId}`;
}

export function sessionIdOfJobs(streamId: string): SessionId | undefined {
  return streamId.startsWith('jobs:') ? streamId.slice('jobs:'.length) : undefined;
}

// Android 用 kotlinx @Serializable 生成提问项的解码；TS 侧没有对应模块，
// 就地解一遍，避免为一个小结构再引一层依赖。
function decodeAskUserQuestionItem(value: JsonElement | undefined): AskUserQuestionItem | undefined {
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

export interface StreamCoordinatorOptions {
  /** 打开唯一多路下行；小程序端通常是 transport.openMux。 */
  openMux: (onEvent: (event: MuxEvent) => void, onState: (state: WsConnectionState) => void) => MuxConnection;
  /** 本机缓存；每次拿到完整的 follow 快照后把窗口落盘，供下次冷启动先画。 */
  cache?: StreamSessionCache;
  listStore: SessionListSink;
  workspaceStore: WorkspaceSink;
  sessionLookup: (sessionId: SessionId) => StreamSession | undefined;
  sessionUpsert: (sessionId: SessionId) => StreamSession;
  allSessions: () => StreamSession[];
  remoteEventHandler: (event: string) => void;
  sessionRemovedHandler: (sessionId: SessionId) => void;
  sessionsArchivedHandler: (sessionIds: SessionId[]) => void;
  /** 0.1.7 的主机侧置顶集合（workspace/follow 基线与 pinned 帧），最近置顶的在前。 */
  pinnedHandler?: (sessionIds: SessionId[]) => void;
  resyncHandler: () => void;
  gapRepairLoader: (address: SessionAddress, throughSeq: number) => Promise<SessionHistoryValue>;
  attentionHandler: (signal: AttentionSignal) => void;
  /**
   * 这条会话此刻是不是正显示在屏幕上。
   *
   * 失败算不算「用户已经看见」只取决于这一点：后台上来的错误帧不能清红点，
   * 否则列表行的未读失败永远不会亮（对齐 Android StreamCoordinator.sessionIsOnScreen）。
   */
  sessionIsOnScreen?: (sessionId: SessionId) => boolean;
  /** 会话运行状态变过一次：宿主据此决定要不要起常驻的调度。 */
  runActivityHandler?: () => void;
  /** $events/result 的出站回执；返回是否已送达。 */
  settle?: (clientId: string, eventId: string, outcome: RemoteEventOutcome) => Promise<boolean>;
}

export class StreamCoordinator {
  private readonly deps: StreamCoordinatorOptions;

  private mux?: MuxConnection;

  /** 三个可观察量；页面用 useStore 订阅。 */
  readonly state = new Store<StreamCoordinatorState>({});

  onConnectionState?: (state: WsConnectionState) => void;

  private readonly removedSessionIds = new Set<SessionId>();
  private readonly pendingEventSessions = new Map<string, SessionId>();
  /** 0.1.5 的 control 队列状态（baseline 的 queues 块与 queue 帧）；0.1.6 不再有这条通道。 */
  private queues = new Map<SessionId, QueuedInboxItem[]>();
  /**
   * 0.1.6 的 inbox 投影最新值。
   *
   * 「基线之后才创建的 store」没有投影历史可回放，只能从这份最新值回灌
   * （对齐 Android 的 inboxQueues）。
   */
  private readonly inboxQueues = new Map<SessionId, QueuedInboxItem[]>();
  /**
   * 0.1.6 及更早由 session/control 发布的任务镜像；0.1.7 起改由每会话的 job/list 流
   * 整组替换，这里只留给老主机与「基线之后才建的 store」回灌用。
   */
  private jobs = new Map<SessionId, JobView[]>();
  private readonly followAddresses = new Map<SessionId, SessionAddress>();
  private readonly assistantExpectations = new Map<SessionId, { attemptId: string; nextIndex: number }>();

  /** 小程序切后台会冻结 socket，记一笔用于回前台判断要不要补同步。 */
  private backgrounded = false;

  constructor(options: StreamCoordinatorOptions) {
    this.deps = options;
  }

  get remoteEventClientId(): string | undefined {
    return this.state.get().remoteEventClientId;
  }

  get hostHome(): string | undefined {
    return this.state.get().hostHome;
  }

  get connectionState(): WsConnectionState | undefined {
    return this.state.get().connectionState;
  }

  start(): void {
    if (this.mux !== undefined) return;
    const connection = this.deps.openMux(this.handleEvent, this.foldSocketState);
    this.mux = connection;
    connection.subscribe(EVENTS, '$events');
    connection.subscribe(WORKSPACES, 'workspace/follow');
    connection.subscribe(CONTROL, 'session/control');
  }

  stop(): void {
    this.mux?.close();
    this.mux = undefined;
  }

  probeNow(): void {
    this.mux?.probeNow();
  }

  /**
   * 小程序没有 Android 的前台服务，切后台时 socket 可能被系统冻结：
   * 回前台先探活这一代连接，再补一次全量同步。
   */
  onBackground(): void {
    this.backgrounded = true;
  }

  onForeground(): void {
    const wasBackgrounded = this.backgrounded;
    this.backgrounded = false;
    const connection = this.mux;
    if (connection === undefined) return;
    connection.probeNow();
    if (wasBackgrounded || this.connectionState !== 'connected') this.deps.resyncHandler();
  }

  /**
   * 打开一个会话的实时窗口，幂等。
   *
   * @returns 订阅是否已经登记。登记之后每一代连接都会自动重开，所以调用方可以据此
   *   判断"基线已经有人给了"，不必再自己发一次分页。
   */
  follow(sessionId: SessionId, address?: SessionAddress, maxMessages = DEFAULT_FOLLOW_MESSAGES): boolean {
    const target: SessionAddress = address ?? { kind: 'session', sessionId };
    this.followAddresses.set(sessionId, target);
    const args: JsonValue = {
      request: {
        address: encodeSessionAddress(target),
        maxMessages,
        assistantStream: true,
      },
    };
    this.mux?.subscribe(followStreamId(sessionId), 'session/follow', args);
    // 后台任务：0.1.7 的 job/list 首帧就是完整集合，之后每次生命周期变化再整组推一帧。
    // 老主机没有这个命名空间，这条订阅会以 failure 结束，任务仍走 session/control。
    this.mux?.subscribe(jobsStreamId(sessionId), 'job/list', { request: { sessionId } });
    return true;
  }

  /** 重开一条 follow：流失败后重试基线用（subscribe 幂等，失败的那条得先撤掉）。 */
  refollow(sessionId: SessionId): boolean {
    const address = this.followAddresses.get(sessionId) ?? { kind: 'session', sessionId };
    this.unfollow(sessionId);
    return this.follow(sessionId, address);
  }

  unfollow(sessionId: SessionId): void {
    this.followAddresses.delete(sessionId);
    this.assistantExpectations.delete(sessionId);
    this.mux?.unsubscribe(followStreamId(sessionId));
    this.mux?.unsubscribe(jobsStreamId(sessionId));
  }

  /**
   * waterfall 出站回执：只有拿到 ready 帧记下的 clientId 才能发 $events/result。
   * 返回是否已送达；缺 clientId 或没注入 settle 时直接算失败。
   */
  async settleRemoteEvent(eventId: string | undefined, outcome: RemoteEventOutcome): Promise<boolean> {
    const clientId = this.remoteEventClientId;
    if (eventId === undefined || clientId === undefined || this.deps.settle === undefined) return false;
    return this.deps.settle(clientId, eventId, outcome);
  }

  private readonly foldSocketState = (state: WsConnectionState): void => {
    const previous = this.connectionState;
    this.state.patch({ connectionState: state });
    this.onConnectionState?.(state);
    if (state === previous) return;
    if (state === 'connected') {
      this.deps.resyncHandler();
    } else if (previous !== undefined) {
      this.dropStaleInteractions();
    }
  };

  private dropStaleInteractions(): void {
    this.state.patch({ remoteEventClientId: undefined });
    this.pendingEventSessions.clear();
    this.deps.listStore.clearAllAwaitingUser();
    for (const store of this.deps.allSessions()) {
      if (store.pendingApproval !== undefined) store.setApproval(undefined);
      if (store.pendingQuestion !== undefined) store.setQuestion(undefined);
    }
  }

  private readonly handleEvent = (event: MuxEvent): void => {
    switch (event.kind) {
      case 'opened':
        this.dropStaleInteractions();
        break;
      case 'item':
        this.handleItem(event.streamId, event.value);
        break;
      case 'failure': {
        const sessionId = sessionIdOfFollow(event.streamId);
        if (sessionId !== undefined) this.failFollow(sessionId, event.error);
        break;
      }
      case 'end':
        break;
    }
  };

  private failFollow(sessionId: SessionId, error: RpcError): void {
    const store = this.deps.sessionLookup(sessionId);
    if (store === undefined) return;
    store.loadingHistory = false;
    store.running = false;
    store.historyError = { code: error.code, message: error.message };
  }

  private handleItem(streamId: string, value: JsonElement): void {
    switch (streamId) {
      case EVENTS:
        this.handleRemoteEvent(decodeRemoteEventFrame(value));
        break;
      case WORKSPACES:
        this.handleWorkspace(decodeWorkspaceFrame(value));
        break;
      case CONTROL:
        this.handleControl(decodeControlFrame(value));
        break;
      default: {
        const jobsSessionId = sessionIdOfJobs(streamId);
        if (jobsSessionId !== undefined) {
          this.handleJobList(jobsSessionId, value);
          return;
        }
        const sessionId = sessionIdOfFollow(streamId);
        if (sessionId === undefined) return;
        this.handleFollow(sessionId, decodeFollowFrame(value));
      }
    }
  }

  // —— $events ————————————————————————————————————————————

  private handleRemoteEvent(frame: RemoteEventFrame): void {
    switch (frame.kind) {
      case 'ready':
        this.state.patch({ remoteEventClientId: frame.clientId });
        if (frame.home !== undefined) this.state.patch({ hostHome: frame.home });
        break;
      case 'emit':
        this.handleHostEmit(frame.event, frame.args);
        break;
      case 'waterfall':
        this.handleWaterfall(frame);
        break;
      case 'cancel':
        this.retireWaterfall(frame.eventId);
        break;
      default:
        break;
    }
  }

  private handleHostEmit(event: string, args: JsonElement[]): void {
    switch (event) {
      case 'api-session/added': {
        const summary = decodeSessionSummary(args[0]);
        if (summary === undefined) return;
        if (this.removedSessionIds.has(summary.sessionId)) return;
        this.deps.listStore.upsert(summary);
        break;
      }
      case 'api-session/removed': {
        const sessionId = str(args[0]);
        if (sessionId === undefined) return;
        this.removedSessionIds.add(sessionId);
        this.deps.listStore.remove(sessionId);
        this.queues.delete(sessionId);
        this.inboxQueues.delete(sessionId);
        this.jobs.delete(sessionId);
        this.unfollow(sessionId);
        this.deps.sessionRemovedHandler(sessionId);
        break;
      }
      case 'api-session/status': {
        const sessionId = str(args[0]);
        if (sessionId === undefined) return;
        const running = bool(args[1]);
        if (running === undefined) return;
        this.deps.listStore.setRunning(sessionId, running);
        const store = this.deps.sessionLookup(sessionId);
        if (store !== undefined) store.running = running;
        this.deps.runActivityHandler?.();
        this.deps.attentionHandler({ kind: 'running', sessionId, running });
        break;
      }
      case 'api-session/activity': {
        const sessionId = str(args[0]);
        if (sessionId === undefined) return;
        const updatedAt = dbl(args[1]);
        if (updatedAt === undefined) return;
        this.deps.listStore.recordActivity(sessionId, updatedAt);
        break;
      }
      case 'api-session/error': {
        const sessionId = str(args[0]);
        if (sessionId === undefined) return;
        const message = str(args[1]);
        if (message === undefined) return;
        this.deps.attentionHandler({ kind: 'failed', sessionId, message });
        break;
      }
      default:
        this.deps.remoteEventHandler(event);
    }
  }

  private handleWaterfall(frame: Extract<RemoteEventFrame, { kind: 'waterfall' }>): void {
    const sessionId = frame.agentId;
    switch (frame.event) {
      case 'approval/request': {
        this.pendingEventSessions.set(frame.eventId, sessionId);
        const approval: ApprovalRequested = {
          eventId: frame.eventId,
          sessionId,
          approvalId: str(jget(frame.request, 'approvalId')) ?? frame.eventId,
          toolName: str(jget(frame.request, 'toolName')) ?? '',
          callId: str(jget(frame.request, 'callId')),
          reason: str(jget(frame.request, 'reason')),
        };
        const store = this.deps.sessionUpsert(sessionId);
        store.setApproval(approval);
        this.syncAwaitingUser(sessionId, store);
        this.deps.attentionHandler({ kind: 'approvalRequested', approval });
        break;
      }
      case 'user-questions/request': {
        const raw = arr(jget(frame.request, 'questions'));
        if (raw === undefined) return;
        const questions = raw
          .map(decodeAskUserQuestionItem)
          .filter((item): item is AskUserQuestionItem => item !== undefined);
        if (questions.length === 0) return;
        this.pendingEventSessions.set(frame.eventId, sessionId);
        const question: QuestionRequested = { eventId: frame.eventId, sessionId, questions };
        const store = this.deps.sessionUpsert(sessionId);
        store.setQuestion(question);
        this.syncAwaitingUser(sessionId, store);
        this.deps.attentionHandler({ kind: 'questionAsked', question });
        break;
      }
      default:
        break;
    }
  }

  private retireWaterfall(eventId: string): void {
    const sessionId = this.pendingEventSessions.get(eventId);
    if (sessionId === undefined) return;
    this.pendingEventSessions.delete(eventId);
    this.deps.attentionHandler({ kind: 'waterfallRetired', sessionId, eventId });
    const store = this.deps.sessionLookup(sessionId);
    if (store === undefined) return;
    if (store.pendingApproval?.eventId === eventId) store.setApproval(undefined);
    if (store.pendingQuestion?.eventId === eventId) store.setQuestion(undefined);
    this.syncAwaitingUser(sessionId, store);
  }

  private syncAwaitingUser(sessionId: SessionId, store: StreamSession): void {
    const kind = pendingInteractionKind(store.pendingApproval, store.pendingQuestion);
    if (kind === undefined) this.deps.listStore.clearAwaitingUser(sessionId);
    else this.deps.listStore.markAwaitingUser(sessionId, kind);
  }

  // —— workspace/follow ——————————————————————————————————

  private handleWorkspace(frame: WorkspaceFollowFrame): void {
    switch (frame.kind) {
      case 'baseline':
        this.deps.workspaceStore.setWorkspaces(frame.items, frame.archivedSessionIds);
        // 归档集合的两侧镜像都要落：把 sets 里的 archivedSessionIds 只写进 workspaceStore
        // 的话，主列表渲染时读的列表侧镜像会在每次重连的基线之后被旧值覆盖回去。
        this.deps.sessionsArchivedHandler(frame.archivedSessionIds);
        if (frame.pinnedSessionIds !== undefined) this.deps.pinnedHandler?.(frame.pinnedSessionIds);
        break;
      case 'upsert':
        this.deps.workspaceStore.upsert(frame.workspace);
        break;
      case 'remove':
        this.deps.workspaceStore.remove(frame.workspaceId);
        break;
      case 'order':
        this.deps.workspaceStore.applyOrder(frame.workspaceIds);
        break;
      case 'archived':
        this.deps.workspaceStore.setArchived(frame.archivedSessionIds);
        this.deps.sessionsArchivedHandler(frame.archivedSessionIds);
        break;
      case 'pinned':
        this.deps.pinnedHandler?.(frame.pinnedSessionIds);
        break;
      default:
        break;
    }
  }

  // —— session/control ——————————————————————————————————

  private handleControl(frame: SessionControlFrame): void {
    switch (frame.kind) {
      case 'baseline': {
        this.queues = new Map(frame.queues);
        this.jobs = new Map(frame.jobs);
        for (const store of this.deps.allSessions()) this.hydrateControlState(store);
        for (const [sessionId, block] of frame.projections) {
          for (const [key, value] of Object.entries(block.values)) {
            this.applyControlProjection({ sessionId, key, value, seq: block.asOfSeq });
          }
        }
        break;
      }
      case 'queue':
        this.queues.set(frame.frame.sessionId, frame.frame.items);
        this.deps.sessionLookup(frame.frame.sessionId)?.setQueue(frame.frame);
        break;
      case 'jobs':
        this.jobs.set(frame.frame.sessionId, frame.frame.jobs);
        this.deps.sessionLookup(frame.frame.sessionId)?.setJobs(frame.frame);
        break;
      case 'projection':
        this.applyControlProjection(frame.frame);
        break;
      default:
        break;
    }
  }

  /**
   * 折叠一条 control 投影：写进对应的 store，并同步到扁平列表行。
   *
   * `inbox` 额外在这里镜像一份：基线之后才创建的 store 没有投影历史，待发队列必须靠
   * 这份最新值补上，口径等同被删掉的 queue 基线。
   */
  private applyControlProjection(frame: SessionProjectionFrame): void {
    if (frame.key === 'inbox') {
      const inbox = decodeInbox(frame.value);
      if (inbox !== undefined) this.inboxQueues.set(frame.sessionId, rowsFromInbox(inbox));
    }
    this.deps.sessionLookup(frame.sessionId)?.applyProjection(frame);
    this.deps.listStore.updateProjection(frame.sessionId, frame.key, frame.value, frame.seq);
  }

  hydrateControlState(store: StreamSession): void {
    // 0.1.5 走 control 的 queues，0.1.6 走 inbox 投影；两者只会有一个有值。
    store.setQueue({
      sessionId: store.sessionId,
      items: this.queues.get(store.sessionId) ?? this.inboxQueues.get(store.sessionId) ?? [],
    });
    store.setJobs({ sessionId: store.sessionId, jobs: this.jobs.get(store.sessionId) ?? [] });
  }

  // —— job/list ————————————————————————————————————————

  private handleJobList(sessionId: SessionId, value: JsonElement): void {
    if (this.removedSessionIds.has(sessionId)) return;
    const jobs = decodeJobListFrame(value);
    if (jobs === undefined) return;
    this.jobs.set(sessionId, jobs);
    this.deps.sessionLookup(sessionId)?.setJobs({ sessionId, jobs });
  }

  // —— session/follow ——————————————————————————————————

  private handleFollow(sessionId: SessionId, frame: SessionFollowFrame): void {
    switch (frame.kind) {
      case 'snapshot': {
        const store = this.deps.sessionUpsert(sessionId);
        store.loadHistory(
          { events: frame.records, hasMore: frame.hasMore, projections: frame.projections },
          true,
        );
        store.subscribe(frame.cursor);
        // 快照就是这条会话最新的窗口，落盘留给下次冷启动。写盘不挂在帧处理上：
        // 大窗口落盘要几十毫秒，不该拖住后面的实时帧。
        const cache = this.deps.cache;
        if (cache !== undefined) {
          const window: CachedWindow = {
            cursor: frame.cursor,
            hasMore: frame.hasMore,
            records: store.historyWindow,
          };
          try {
            void Promise.resolve(cache.saveWindow(sessionId, window)).catch(() => {});
          } catch {
            // 落盘失败不影响主流程：下一次冷启动没有底稿而已。
          }
        }
        store.applyAssistantStreamBaseline(frame.assistantStream);
        // 快照的重放会把失败位重新抬起来，所以「已读」要在窗口落定之后再标一次；
        // 少了这一步，正看着的会话反而会留一颗未读失败红点。
        if (this.deps.sessionIsOnScreen?.(sessionId) !== false) store.markErrorSeen();
        const attempt = frame.assistantStream?.activeAttempt;
        if (attempt === undefined) this.assistantExpectations.delete(sessionId);
        else {
          this.assistantExpectations.set(sessionId, {
            attemptId: attempt.attemptId,
            nextIndex: attempt.nextIndex,
          });
        }
        break;
      }
      case 'event':
        this.applyLiveEvent(sessionId, frame.entry);
        break;
      case 'stream':
        if (!this.foldAssistantStreamFrame(frame.frame, sessionId)) return;
        this.deps.sessionLookup(sessionId)?.applyAssistantStreamFrame(frame.frame);
        break;
      default:
        break;
    }
  }

  /** 侧信道的连续性闸门：漏一帧就重开这条 follow 重新拿基线。 */
  private foldAssistantStreamFrame(frame: AssistantStreamFrame, sessionId: SessionId): boolean {
    switch (frame.kind) {
      case 'start': {
        if (this.assistantExpectations.has(sessionId)) {
          this.reopenAssistantStream(sessionId);
          return false;
        }
        this.assistantExpectations.set(sessionId, { attemptId: frame.attemptId, nextIndex: 0 });
        return true;
      }
      case 'chunk': {
        const expectation = this.assistantExpectations.get(sessionId);
        if (expectation === undefined) return false;
        if (expectation.attemptId !== frame.attemptId) return false;
        if (frame.index !== expectation.nextIndex) {
          this.reopenAssistantStream(sessionId);
          return false;
        }
        this.assistantExpectations.set(sessionId, {
          attemptId: expectation.attemptId,
          nextIndex: frame.index + 1,
        });
        return true;
      }
      case 'end': {
        const expectation = this.assistantExpectations.get(sessionId);
        if (expectation === undefined) return false;
        if (expectation.attemptId !== frame.attemptId) return false;
        if (frame.index !== expectation.nextIndex) {
          this.reopenAssistantStream(sessionId);
          return false;
        }
        this.assistantExpectations.delete(sessionId);
        return true;
      }
    }
  }

  private reopenAssistantStream(sessionId: SessionId): void {
    this.assistantExpectations.delete(sessionId);
    const address = this.followAddresses.get(sessionId);
    if (address === undefined) return;
    this.unfollow(sessionId);
    this.follow(sessionId, address);
  }

  applyLiveEvent(sessionId: SessionId, entry: HistoryEntry): void {
    const event = entry.event;
    if (event.type === 'turn/start') this.deps.listStore.setRunning(sessionId, true);
    else if (event.type === 'turn/end') this.deps.listStore.setRunning(sessionId, false);
    const activity = sessionActivityTimestamp(event);
    if (activity !== undefined) this.deps.listStore.recordActivity(sessionId, activity);
    // 失败 peek 搭在这一帧上，所以要在下面折叠/丢帧之前发出：正是用户切走的那条会话，
    // 它的失败最需要被记下来（与 Mac / Android applyLiveEvent 同一顺序）。
    // 只认 `$events` 的 api-session/error 的话，同一次失败要么漏报，要么两条流各说一套。
    const failure = liveTurnFailureMessage(event);
    if (failure !== undefined) this.deps.attentionHandler({ kind: 'failed', sessionId, message: failure });
    const store = this.deps.sessionUpsert(sessionId);
    if (store.historyLoaded && event.seq > store.lastSeq + 1) {
      const generation = store.beginGapRepair(entry);
      if (generation !== undefined) {
        const address = store.followAddress;
        const cursor = store.repairCursor;
        this.deps.gapRepairLoader(address, cursor)
          .then(value => store.completeGapRepair(value, generation))
          .catch(() => store.failGapRepair(generation));
      }
    } else {
      store.apply(event, entry.view);
      // 失败清红点只对屏上的会话生效（对齐 Android sessionIsOnScreen 判定）。
      if (this.deps.sessionIsOnScreen?.(sessionId) !== false) store.markErrorSeen();
    }
  }
}

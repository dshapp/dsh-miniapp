import { arr, bool, dbl, int, jget, obj, str, type JsonElement, type JsonObject } from './json';
import type {
  HistoryEntry,
  JobView,
  JobStatus,
  MessageId,
  SessionId,
  SessionProjectionsBlock,
  SessionSummary,
  ToolEventView,
  WorkspaceId,
  WorkspaceView,
} from './types';

// 队列 ————————————————————————————————————————————————————————

export interface QueuedInboxItem {
  id: MessageId;
  placement: string;
  rpcId?: string;
  content: JsonElement[];
}

export function queuedItemText(item: QueuedInboxItem): string {
  return item.content
    .map(block => str(jget(block, 'text')))
    .filter((text): text is string => text !== undefined)
    .join(' ');
}

export function decodeQueuedItem(value: JsonElement | undefined): QueuedInboxItem | undefined {
  const id = str(jget(value, 'id'));
  if (id === undefined) return undefined;
  return {
    id,
    placement: str(jget(value, 'placement')) ?? 'queued',
    rpcId: str(jget(value, 'rpcId')),
    content: arr(jget(jget(value, 'message'), 'content')) ?? [],
  };
}

/**
 * 0.1.6 的 inbox 会话投影里的一条待发消息（主机侧的整条 user message）。
 *
 * 0.1.5 由 control 流发布的条目只带呈现所需字段；0.1.6 改成投影发布整条消息，
 * 因此 placement 不再由主机给，而是由客户端按「它在哪个列表里」推导（见 rowsFromInbox）。
 */
export interface QueuedInboxMessage {
  id: MessageId;
  role?: string;
  content: JsonElement[];
  source?: JsonElement;
}

/** `inbox` 会话投影的 wire 值：两个有序的待发列表。 */
export interface SessionInboxValue {
  nextTurn: QueuedInboxMessage[];
  nextStep: QueuedInboxMessage[];
}

/** 浏览器提交的消息在 source 里带着 prompt-RPC 身份，用来退掉本地回声。 */
export function inboxMessageRpcId(message: QueuedInboxMessage): string | undefined {
  if (str(jget(message.source, 'kind')) !== 'user') return undefined;
  return str(jget(message.source, 'rpcId'));
}

export function decodeInbox(value: JsonElement | undefined): SessionInboxValue | undefined {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const messages = (key: string): QueuedInboxMessage[] =>
    (arr(jget(value, key)) ?? []).flatMap((item): QueuedInboxMessage[] => {
      const id = str(jget(item, 'id'));
      if (id === undefined) return [];
      return [{
        id,
        role: str(jget(item, 'role')),
        content: arr(jget(item, 'content')) ?? [],
        source: jget(item, 'source'),
      }];
    });
  return { nextTurn: messages('next-turn'), nextStep: messages('next-step') };
}

/**
 * 把一份 inbox 投影摊成待发队列行，主机顺序在前。
 *
 * next-turn 是「下一轮才会取走」的排队项；next-step 里由用户写的（source.kind == "user"）
 * 是已点插队、等下一个步骤边界送进当前回合的项，其余是上下文注入。与 Android 的
 * rowsFromInbox 同一口径。
 */
export function rowsFromInbox(value: SessionInboxValue): QueuedInboxItem[] {
  const row = (message: QueuedInboxMessage, placement: string): QueuedInboxItem => ({
    id: message.id,
    placement,
    rpcId: inboxMessageRpcId(message),
    content: message.content,
  });
  return [
    ...value.nextTurn.map(message => row(message, 'queued')),
    ...value.nextStep.map(message => row(message, str(jget(message.source, 'kind')) === 'user' ? 'steering' : 'context')),
  ];
}

export interface SessionQueueFrame { sessionId: SessionId; items: QueuedInboxItem[] }
export interface SessionJobsFrame { sessionId: SessionId; jobs: JobView[] }
export interface SessionProjectionFrame { sessionId: SessionId; key: string; value: JsonElement; seq: number }

// $events 流 ——————————————————————————————————————————————————

export type RemoteEventFrame =
  | { kind: 'ready'; clientId: string; home?: string }
  | { kind: 'emit'; event: string; args: JsonElement[] }
  | { kind: 'waterfall'; event: string; eventId: string; agentId: string; request?: JsonElement }
  | { kind: 'cancel'; eventId: string }
  | { kind: 'unknown' };

export function decodeRemoteEventFrame(value: JsonElement | undefined): RemoteEventFrame {
  switch (str(jget(value, 'type'))) {
    case 'ready':
      return { kind: 'ready', clientId: str(jget(value, 'clientId')) ?? '', home: str(jget(jget(value, 'host'), 'home')) };
    case 'emit':
      return { kind: 'emit', event: str(jget(value, 'event')) ?? '', args: arr(jget(value, 'args')) ?? [] };
    case 'waterfall':
      return {
        kind: 'waterfall',
        event: str(jget(value, 'event')) ?? '',
        eventId: str(jget(value, 'eventId')) ?? '',
        agentId: str(jget(value, 'agentId')) ?? '',
        request: jget(value, 'request'),
      };
    case 'cancel':
      return { kind: 'cancel', eventId: str(jget(value, 'eventId')) ?? '' };
    default:
      return { kind: 'unknown' };
  }
}

// workspace/follow 流 ————————————————————————————————————————

export interface WorkspaceArchivedItem { workspaceId: WorkspaceId; archivedSessionIds: SessionId[] }

export type WorkspaceFollowFrame =
  /** `pinnedSessionIds` 是 0.1.7 新增的主机侧置顶集合；老主机不发时为 undefined。 */
  | { kind: 'baseline'; items: WorkspaceView[]; archivedSessionIds: SessionId[]; pinnedSessionIds?: SessionId[] }
  | { kind: 'upsert'; workspace: WorkspaceView }
  | { kind: 'remove'; workspaceId: WorkspaceId }
  | { kind: 'order'; workspaceIds: WorkspaceId[] }
  | { kind: 'archived'; archivedSessionIds: SessionId[] }
  | { kind: 'pinned'; pinnedSessionIds: SessionId[] }
  | { kind: 'unknown' };

export function decodeWorkspaceFrame(value: JsonElement | undefined): WorkspaceFollowFrame {
  switch (str(jget(value, 'type'))) {
    case 'baseline': {
      const inner = jget(value, 'value');
      return {
        kind: 'baseline',
        items: (arr(jget(inner, 'items')) ?? [])
          .map(decodeWorkspaceView)
          .filter((item): item is WorkspaceView => item !== undefined),
        archivedSessionIds: (arr(jget(inner, 'archivedSessionIds')) ?? [])
          .map(str)
          .filter((id): id is string => id !== undefined),
        pinnedSessionIds: arr(jget(inner, 'pinnedSessionIds'))
          ?.map(str)
          .filter((id): id is string => id !== undefined),
      };
    }
    case 'upsert': {
      const workspace = decodeWorkspaceView(jget(value, 'workspace'));
      return workspace === undefined ? { kind: 'unknown' } : { kind: 'upsert', workspace };
    }
    case 'remove':
      return { kind: 'remove', workspaceId: str(jget(value, 'workspaceId')) ?? '' };
    case 'order':
      return {
        kind: 'order',
        workspaceIds: (arr(jget(value, 'workspaceIds')) ?? []).map(str).filter((id): id is string => id !== undefined),
      };
    case 'archived':
      return {
        kind: 'archived',
        archivedSessionIds: (arr(jget(value, 'archivedSessionIds')) ?? [])
          .map(str)
          .filter((id): id is string => id !== undefined),
      };
    case 'pinned':
      return {
        kind: 'pinned',
        pinnedSessionIds: (arr(jget(value, 'pinnedSessionIds')) ?? [])
          .map(str)
          .filter((id): id is string => id !== undefined),
      };
    default:
      return { kind: 'unknown' };
  }
}

// session/control 流 ——————————————————————————————————————————

export type SessionControlFrame =
  | {
      kind: 'baseline';
      queues: Map<SessionId, QueuedInboxItem[]>;
      jobs: Map<SessionId, JobView[]>;
      projections: Map<SessionId, SessionProjectionsBlock>;
    }
  | { kind: 'queue'; frame: SessionQueueFrame }
  | { kind: 'jobs'; frame: SessionJobsFrame }
  | { kind: 'projection'; frame: SessionProjectionFrame }
  | { kind: 'unknown' };

function mapValues<T>(value: JsonElement | undefined, decode: (item: JsonElement) => T | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  const source = obj(value);
  if (source === undefined) return out;
  for (const [key, raw] of Object.entries(source)) {
    out.set(key, (arr(raw) ?? []).map(decode).filter((item): item is T => item !== undefined));
  }
  return out;
}

export function decodeControlFrame(value: JsonElement | undefined): SessionControlFrame {
  switch (str(jget(value, 'type'))) {
    case 'baseline': {
      const v = jget(value, 'value');
      const projections = new Map<SessionId, SessionProjectionsBlock>();
      const rawProjections = obj(jget(v, 'projections'));
      if (rawProjections !== undefined) {
        for (const [key, raw] of Object.entries(rawProjections)) {
          projections.set(key, decodeProjectionsBlock(raw) ?? { asOfSeq: 0, values: {} });
        }
      }
      return {
        kind: 'baseline',
        queues: mapValues(jget(v, 'queues'), decodeQueuedItem),
        jobs: mapValues(jget(v, 'jobs'), decodeJobView),
        projections,
      };
    }
    case 'queue':
      return {
        kind: 'queue',
        frame: {
          sessionId: str(jget(value, 'sessionId')) ?? '',
          items: (arr(jget(value, 'items')) ?? [])
            .map(decodeQueuedItem)
            .filter((item): item is QueuedInboxItem => item !== undefined),
        },
      };
    case 'jobs':
      return {
        kind: 'jobs',
        frame: {
          sessionId: str(jget(value, 'sessionId')) ?? '',
          jobs: (arr(jget(value, 'jobs')) ?? [])
            .map(decodeJobView)
            .filter((item): item is JobView => item !== undefined),
        },
      };
    case 'projection':
      return {
        kind: 'projection',
        frame: {
          sessionId: str(jget(value, 'sessionId')) ?? '',
          key: str(jget(value, 'key')) ?? '',
          value: jget(value, 'value') ?? {},
          seq: int(jget(value, 'seq')) ?? 0,
        },
      };
    default:
      return { kind: 'unknown' };
  }
}

// session/follow 流 ——————————————————————————————————————————

export type AssistantStreamFrame =
  | { kind: 'start'; attemptId: string; revision: number; startedAfterSeq: number; turn: number; step: number }
  | { kind: 'chunk'; attemptId: string; revision: number; index: number; time: number; chunk?: JsonElement }
  | { kind: 'end'; attemptId: string; revision: number; index: number; committedSeq?: number };

export interface AssistantStreamAttempt {
  attemptId: string;
  startedAfterSeq: number;
  turn: number;
  step: number;
  nextIndex: number;
  stream?: JsonElement;
}

export interface AssistantStreamBaseline { revision: number; activeAttempt?: AssistantStreamAttempt }

function decodeAssistantAttempt(value: JsonElement | undefined): AssistantStreamAttempt | undefined {
  const attemptId = str(jget(value, 'attemptId'));
  if (attemptId === undefined) return undefined;
  return {
    attemptId,
    startedAfterSeq: int(jget(value, 'startedAfterSeq')) ?? 0,
    turn: int(jget(value, 'turn')) ?? 0,
    step: int(jget(value, 'step')) ?? 0,
    nextIndex: int(jget(value, 'nextIndex')) ?? 0,
    stream: jget(value, 'stream'),
  };
}

export function decodeAssistantBaseline(value: JsonElement | undefined): AssistantStreamBaseline | undefined {
  if (value === undefined) return undefined;
  const active = decodeAssistantAttempt(jget(value, 'activeAttempt'));
  return { revision: int(jget(value, 'revision')) ?? 0, activeAttempt: active };
}

export function decodeAssistantStreamFrame(value: JsonElement | undefined): AssistantStreamFrame | undefined {
  const attemptId = str(jget(value, 'attemptId'));
  if (attemptId === undefined) return undefined;
  const revision = int(jget(value, 'revision')) ?? 0;
  switch (str(jget(value, 'type'))) {
    case 'start':
      return {
        kind: 'start',
        attemptId,
        revision,
        startedAfterSeq: int(jget(value, 'startedAfterSeq')) ?? 0,
        turn: int(jget(value, 'turn')) ?? 0,
        step: int(jget(value, 'step')) ?? 0,
      };
    case 'chunk':
      return {
        kind: 'chunk',
        attemptId,
        revision,
        index: int(jget(value, 'index')) ?? 0,
        time: dbl(jget(value, 'time')) ?? 0,
        chunk: jget(value, 'chunk'),
      };
    case 'end': {
      const outcome = jget(value, 'outcome');
      const committedSeq = str(jget(outcome, 'kind')) === 'committed' ? int(jget(outcome, 'seq')) : undefined;
      return { kind: 'end', attemptId, revision, index: int(jget(value, 'index')) ?? 0, committedSeq };
    }
    default:
      return undefined;
  }
}

export type SessionFollowFrame =
  | {
      kind: 'snapshot';
      cursor: number;
      records: HistoryEntry[];
      hasMore: boolean;
      projections?: SessionProjectionsBlock;
      assistantStream?: AssistantStreamBaseline;
    }
  | { kind: 'event'; entry: HistoryEntry }
  | { kind: 'stream'; frame: AssistantStreamFrame }
  | { kind: 'unknown' };

export function decodeFollowFrame(value: JsonElement | undefined): SessionFollowFrame {
  switch (str(jget(value, 'type'))) {
    case 'snapshot':
      return {
        kind: 'snapshot',
        cursor: int(jget(value, 'cursor')) ?? 0,
        records: (arr(jget(value, 'records')) ?? [])
          .map(decodeHistoryEntry)
          .filter((entry): entry is HistoryEntry => entry !== undefined),
        hasMore: bool(jget(value, 'hasMore')) ?? false,
        projections: decodeProjectionsBlock(jget(value, 'projections')),
        assistantStream: decodeAssistantBaseline(jget(value, 'assistantStream')),
      };
    case 'assistant-stream': {
      const frame = decodeAssistantStreamFrame(jget(value, 'frame'));
      return frame === undefined ? { kind: 'unknown' } : { kind: 'stream', frame };
    }
    default: {
      const entry = decodeHistoryEntry(value);
      return entry === undefined ? { kind: 'unknown' } : { kind: 'event', entry };
    }
  }
}

/** 主机在设置里推送的连接错误。 */
export interface StreamFailure { streamId: string; error: { code: string; message: string } }

// 通用解码 ————————————————————————————————————————————————————

/**
 * 一份投影基线：asOfSeq + values 容器（values 里才是逐键投影值）。
 *
 * 主机的每一路投影都放在 values 里（follow 快照、session/list、session/control 基线
 * 都是这个容器），asOfSeq 是这些值的共同水位。解码要按 values 摊平——直接把外层对象当
 * 投影表会把 asOfSeq / values 本身也当成两个投影键。
 *
 * 形状认两代：values 容器（主机实际形状）与「键直接挂在对象上」的扁平形状（早期 Mock
 * 的口径），后者仍按每键的 value 字段解一层壳，免得旧离线数据整片失效。
 */
export function decodeProjectionsBlock(value: JsonElement | undefined): SessionProjectionsBlock | undefined {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const asOfSeq = int(jget(value, 'asOfSeq')) ?? 0;
  const container = jget(value, 'values');
  const source = obj(container) ?? obj(value);
  const values: Record<string, JsonElement> = {};
  for (const [key, raw] of Object.entries(source ?? {})) {
    if (container === undefined) {
      if (key === 'asOfSeq') continue;
      // 扁平形状：每键是 { value } 壳，解一层。
      const entry = jget(raw, 'value');
      values[key] = entry === undefined ? raw : entry;
      continue;
    }
    // values 容器：每键就是投影值本身，原样收下（真正的值里也可能有 value 字段）。
    values[key] = raw;
  }
  return { asOfSeq, values };
}

export function decodeWorkspaceView(value: JsonElement | undefined): WorkspaceView | undefined {
  const workspaceId = str(jget(value, 'workspaceId'));
  const path = str(jget(value, 'path'));
  if (workspaceId === undefined || path === undefined) return undefined;
  return {
    workspaceId,
    path,
    title: str(jget(value, 'title')) ?? '',
    sessionIds: (arr(jget(value, 'sessionIds')) ?? []).map(str).filter((id): id is string => id !== undefined),
    createdAt: str(jget(value, 'createdAt')) ?? '',
    updatedAt: str(jget(value, 'updatedAt')) ?? '',
  };
}

export function decodeJobView(value: JsonElement | undefined): JobView | undefined {
  const id = str(jget(value, 'id'));
  if (id === undefined) return undefined;
  const status = (str(jget(value, 'status')) ?? 'running') as JobStatus;
  return {
    id,
    kind: str(jget(value, 'kind')) ?? '',
    label: str(jget(value, 'label')) ?? '',
    status,
    detail: str(jget(value, 'detail')),
    progress: str(jget(value, 'progress')),
    startedAt: dbl(jget(value, 'startedAt')) ?? 0,
    finishedAt: dbl(jget(value, 'finishedAt')),
  };
}

/**
 * 0.1.7 `job/list` 流的一帧：`{type:'rows', jobs}`，是这条会话可见任务的完整集合
 * （自己的任务加上所有无主任务），整组替换。其他 type 一律忽略。
 */
export function decodeJobListFrame(value: JsonElement | undefined): JobView[] | undefined {
  if (str(jget(value, 'type')) !== 'rows') return undefined;
  return (arr(jget(value, 'jobs')) ?? [])
    .map(decodeJobView)
    .filter((item): item is JobView => item !== undefined);
}

export function decodeToolEventView(value: JsonElement | undefined): ToolEventView | undefined {
  if (value === undefined) return undefined;
  return { for: str(jget(value, 'for')) ?? '', view: jget(value, 'view') };
}

export function decodeSessionEvent(value: JsonElement | undefined): HistoryEntry['event'] | undefined {
  if (value === undefined) return undefined;
  const type = str(jget(value, 'type'));
  if (type === undefined) return undefined;
  return {
    type,
    seq: dbl(jget(value, 'seq')) ?? 0,
    time: dbl(jget(value, 'time')) ?? 0,
    data: jget(value, 'data'),
    sourceEventSeqs: arr(jget(value, 'sourceEventSeqs'))?.map(item => int(item) ?? 0),
    surfaceOp: jget(value, 'surfaceOp'),
    ignorable: bool(jget(value, 'ignorable')),
  };
}

export function decodeHistoryEntry(value: JsonElement | undefined): HistoryEntry | undefined {
  const event = decodeSessionEvent(jget(value, 'event') ?? value);
  if (event === undefined) return undefined;
  return { event, view: decodeToolEventView(jget(value, 'view')) };
}

export function decodeSessionSummary(value: JsonElement | undefined): SessionSummary | undefined {
  const sessionId = str(jget(value, 'sessionId'));
  if (sessionId === undefined) return undefined;
  return {
    sessionId,
    updatedAt: dbl(jget(value, 'updatedAt')) ?? 0,
    running: bool(jget(value, 'running')) ?? false,
    blank: bool(jget(value, 'blank')) ?? false,
    parentSessionId: str(jget(value, 'parentSessionId')),
    origin: str(jget(value, 'origin')),
    cwd: str(jget(value, 'cwd')),
    agentPreset: str(jget(value, 'agentPreset')),
    projections: decodeProjectionsBlock(jget(value, 'projections')),
  };
}

export type { JsonObject };

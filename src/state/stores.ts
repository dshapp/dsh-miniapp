import { isSubagentOrigin, type SessionId, type SessionProjectionsBlock, type SessionSummary, type WorkspaceId, type WorkspaceView } from '../model/types';
import type { SessionAwaitingKind } from '../model/format';
import type { JsonValue } from '../model/json';
import { readStringList, Store, writeStringList } from './store';

const PINNED_KEY = 'dsh.pinnedSessionOrder';
const MANUAL_KEY = 'dsh.flatSessionOrder';
/** 落盘的「上次还在跑」的会话集合，用于进程重启后的完成补发。 */
const RUNNING_KEY = 'dsh.runningSessionIds';

/** 拉取基线期间录下的增量。 */
type RosterMutation =
  | { kind: 'upserted'; summary: SessionSummary }
  | { kind: 'removed'; sessionId: SessionId }
  | { kind: 'running'; sessionId: SessionId; running: boolean }
  | { kind: 'activity'; sessionId: SessionId; updatedAt: number }
  | { kind: 'engaged'; sessionId: SessionId }
  | { kind: 'projection'; sessionId: SessionId; key: string; value: JsonValue; seq: number };

/**
 * 会话列表：主机推来的会话清单加上本机侧的置顶/草稿/待办标记。
 *
 * 与 Android 的 SessionListStore 同构。整体赋值 sessions 是唯一的写入口，顺手作废
 * 派生缓存 —— 其中就包括投影版本账本：它必须跟着行里的 projections 一起重建，否则一次
 * session/list 刷新把行上的 title 换没了之后，旧的 seq 还会把重新推来的 title 挡在门外。
 */
class SessionListStore {
  private readonly sessionsStore = new Store<SessionSummary[]>([]);
  readonly archivedSessionIdsStore = new Store<SessionId[]>([]);
  readonly completedSessionIdsStore = new Store<Set<SessionId>>(new Set());
  readonly awaitingUserSessionIdsStore = new Store<Set<SessionId>>(new Set());
  readonly awaitingUserKindsStore = new Store<Map<SessionId, SessionAwaitingKind>>(new Map());
  readonly draftSessionIdsStore = new Store<Set<SessionId>>(new Set());
  readonly pinnedSessionOrderStore = new Store<SessionId[]>([]);
  readonly flatManualOrderStore = new Store<SessionId[]>([]);

  selectedSessionId?: SessionId;

  /** 判定「要不要弹」是通知中心的事，这里只负责把运行→停止的边沿交出去。 */
  onCompleted?: (sessionId: SessionId) => void;

  private projectionSeqCache?: Map<SessionId, Map<string, number>>;
  private readonly previousRunning = new Map<SessionId, boolean>();
  private pullRecording?: RosterMutation[];
  private pullRecordingToken = 0;

  constructor() {
    this.pinnedSessionOrderStore.set(readStringList(PINNED_KEY));
    this.flatManualOrderStore.set(readStringList(MANUAL_KEY));
    // 上次进程结束时还在跑的那些会话。进程被系统回收后重开时，内存里的 previousRunning
    // 已经没了，只有这份落盘的记录能让「运行->停止」的边沿重新成立。
    for (const sessionId of readStringList(RUNNING_KEY)) this.previousRunning.set(sessionId, true);
  }

  get sessions(): SessionSummary[] {
    return this.sessionsStore.get();
  }

  /** 列表页使用的订阅对象。 */
  get sessionsState(): Store<SessionSummary[]> {
    return this.sessionsStore;
  }

  get archivedSessionIds(): SessionId[] {
    return this.archivedSessionIdsStore.get();
  }

  /** 归档集合整体替换（0.1.6 的 workspace/unarchiveSession 应答直接落库）。 */
  setArchivedSessionIds(ids: SessionId[]): void {
    this.archivedSessionIdsStore.set(ids);
  }

  get completedSessionIds(): Set<SessionId> {
    return this.completedSessionIdsStore.get();
  }

  get awaitingUserSessionIds(): Set<SessionId> {
    return this.awaitingUserSessionIdsStore.get();
  }

  get awaitingUserKinds(): Map<SessionId, SessionAwaitingKind> {
    return this.awaitingUserKindsStore.get();
  }

  get draftSessionIds(): Set<SessionId> {
    return this.draftSessionIdsStore.get();
  }

  get pinnedSessionOrder(): SessionId[] {
    return this.pinnedSessionOrderStore.get();
  }

  get flatManualOrder(): SessionId[] {
    return this.flatManualOrderStore.get();
  }

  get pinnedSessionIds(): Set<SessionId> {
    return new Set(this.pinnedSessionOrderStore.get());
  }

  get sessionsById(): Map<SessionId, SessionSummary> {
    return new Map(this.sessionsStore.get().map(summary => [summary.sessionId, summary]));
  }

  private buildProjectionSeqs(): Map<SessionId, Map<string, number>> {
    const computed = new Map<SessionId, Map<string, number>>();
    for (const summary of this.sessionsStore.get()) {
      const block = summary.projections;
      if (block === undefined) continue;
      const keys = new Map<string, number>();
      for (const key of Object.keys(block.values)) keys.set(key, block.asOfSeq);
      computed.set(summary.sessionId, keys);
    }
    return computed;
  }

  private get projectionSeqBySession(): Map<SessionId, Map<string, number>> {
    if (this.projectionSeqCache === undefined) this.projectionSeqCache = this.buildProjectionSeqs();
    return this.projectionSeqCache;
  }

  private setSessions(next: SessionSummary[]): void {
    this.projectionSeqCache = undefined;
    this.sessionsStore.set(next);
  }

  private persistRunning(): void {
    writeStringList(
      RUNNING_KEY,
      Array.from(this.previousRunning.entries())
        .filter(([, running]) => running)
        .map(([sessionId]) => sessionId),
    );
  }

  // —— 拉取基线期间的增量录制 ——
  //
  // session/list 是一次 HTTP 往返，而 session/control 基线（会话标题就在它的
  // projections 里）常常在往返途中就到了：那一刻列表还是空的，updateProjection
  // 找不到行直接丢帧，行上就只剩 cwd basename。把拉取期间的增量录下来，等基线
  // 落库后原样重放，这些帧就不会再丢。

  beginBaselinePull(): number {
    this.pullRecordingToken += 1;
    this.pullRecording = [];
    return this.pullRecordingToken;
  }

  discardBaselinePull(token: number): void {
    if (this.pullRecordingToken === token) this.pullRecording = undefined;
  }

  endBaselinePull(items: SessionSummary[], token: number): void {
    if (this.pullRecordingToken !== token) return;
    const mutations = this.pullRecording;
    if (mutations === undefined) return;
    this.pullRecording = undefined;
    this.replaceSessions(items);
    for (const mutation of mutations) this.apply(mutation);
  }

  private record(mutation: RosterMutation): void {
    this.pullRecording?.push(mutation);
  }

  private apply(mutation: RosterMutation): void {
    switch (mutation.kind) {
      case 'upserted':
        this.upsert(mutation.summary);
        break;
      case 'removed':
        this.remove(mutation.sessionId);
        break;
      case 'running':
        this.setRunning(mutation.sessionId, mutation.running);
        break;
      case 'activity':
        this.recordActivity(mutation.sessionId, mutation.updatedAt);
        break;
      case 'engaged':
        this.markEngaged(mutation.sessionId);
        break;
      case 'projection':
        this.updateProjection(mutation.sessionId, mutation.key, mutation.value, mutation.seq);
        break;
    }
  }

  private replaceSessions(items: SessionSummary[]): void {
    this.setSessions(items.slice().sort((a, b) => b.updatedAt - a.updatedAt));
    this.syncCompletedNotifications();
  }

  /** 用本机缓存里的清单铺底；只在还没有任何远端数据时铺，永远不会盖掉已落库的基线。 */
  seedFromCache(items: SessionSummary[]): void {
    if (items.length === 0 || this.sessionsStore.get().length > 0) return;
    this.replaceSessions(items);
  }

  upsert(summary: SessionSummary): void {
    this.record({ kind: 'upserted', summary });
    const sessions = this.sessionsStore.get();
    const index = sessions.findIndex(item => item.sessionId === summary.sessionId);
    if (index < 0) {
      this.setSessions([...sessions, summary].sort((a, b) => b.updatedAt - a.updatedAt));
      this.reconcileCompleted(summary);
      this.persistRunning();
      return;
    }
    const existing = sessions[index];
    const merged: SessionSummary = {
      ...existing,
      blank: existing.blank && summary.blank,
      cwd: existing.cwd ?? summary.cwd,
      parentSessionId: existing.parentSessionId ?? summary.parentSessionId,
      origin: existing.origin ?? summary.origin,
      agentPreset: summary.agentPreset ?? existing.agentPreset,
    };
    const next = sessions.slice();
    next[index] = merged;
    this.setSessions(next);
    this.reconcileCompleted(merged);
    this.persistRunning();
  }

  remove(sessionId: SessionId): void {
    this.record({ kind: 'removed', sessionId });
    this.setSessions(this.sessionsStore.get().filter(item => item.sessionId !== sessionId));
    this.previousRunning.delete(sessionId);
    this.persistRunning();
    this.completedSessionIdsStore.set(new Set(Array.from(this.completedSessionIdsStore.get()).filter(id => id !== sessionId)));
    this.awaitingUserSessionIdsStore.set(new Set(Array.from(this.awaitingUserSessionIdsStore.get()).filter(id => id !== sessionId)));
    const kinds = new Map(this.awaitingUserKindsStore.get());
    kinds.delete(sessionId);
    this.awaitingUserKindsStore.set(kinds);
    this.draftSessionIdsStore.set(new Set(Array.from(this.draftSessionIdsStore.get()).filter(id => id !== sessionId)));
    if (this.pinnedSessionIds.has(sessionId)) this.setPinned(sessionId, false);
  }

  recordActivity(sessionId: SessionId, updatedAt: number): void {
    this.record({ kind: 'activity', sessionId, updatedAt });
    const sessions = this.sessionsStore.get();
    const index = sessions.findIndex(item => item.sessionId === sessionId);
    if (index < 0 || updatedAt <= sessions[index].updatedAt) return;
    const next = sessions.slice();
    next[index] = { ...next[index], updatedAt };
    this.setSessions(next.sort((a, b) => b.updatedAt - a.updatedAt));
  }

  markEngaged(sessionId: SessionId): void {
    this.record({ kind: 'engaged', sessionId });
    const sessions = this.sessionsStore.get();
    const index = sessions.findIndex(item => item.sessionId === sessionId);
    if (index < 0 || !sessions[index].blank) return;
    const next = sessions.slice();
    next[index] = { ...next[index], blank: false };
    this.setSessions(next);
  }

  setRunning(sessionId: SessionId, running: boolean): void {
    this.record({ kind: 'running', sessionId, running });
    const sessions = this.sessionsStore.get();
    const index = sessions.findIndex(item => item.sessionId === sessionId);
    if (index < 0) return;
    const next = sessions.slice();
    next[index] = { ...next[index], running, blank: running ? false : next[index].blank };
    this.setSessions(next);
    this.reconcileCompleted(next[index]);
    this.persistRunning();
  }

  /**
   * 把一帧 session/projection 镜像进这条会话的列表行快照：
   * 列表行的标题只认 projections['title']，而 session/list 的投影列来自主机侧缓存、
   * host/session-added 更是完全不带投影，所以没打开过的会话全靠这条路拿到标题。
   * 乱序/重复帧按键比对 seq，只有更新的才覆盖。
   */
  updateProjection(sessionId: SessionId, key: string, value: JsonValue, seq: number): void {
    this.record({ kind: 'projection', sessionId, key, value, seq });
    const sessions = this.sessionsStore.get();
    const index = sessions.findIndex(item => item.sessionId === sessionId);
    if (index < 0) return;
    const seqs = this.projectionSeqBySession;
    if (seq <= (seqs.get(sessionId)?.get(key) ?? -1)) return;
    const existing = sessions[index].projections;
    const values: Record<string, JsonValue> = { ...(existing?.values ?? {}) };
    values[key] = value;
    const block: SessionProjectionsBlock = {
      asOfSeq: Math.max(existing?.asOfSeq ?? 0, seq),
      values,
    };
    const next = sessions.slice();
    next[index] = { ...next[index], projections: block };
    this.setSessions(next);
    // 上一行作废了账本缓存，这里把刚算好的账本连同本键的新版本重新装回去，
    // 免得高频投影帧每来一帧都重建一遍。
    const perKey = seqs.get(sessionId) ?? new Map<string, number>();
    perKey.set(key, seq);
    seqs.set(sessionId, perKey);
    this.projectionSeqCache = seqs;
  }

  setPinned(sessionId: SessionId, pinned: boolean): void {
    const current = this.pinnedSessionOrderStore.get();
    const next = pinned
      ? current.includes(sessionId)
        ? current
        : [...current, sessionId]
      : current.filter(id => id !== sessionId);
    this.pinnedSessionOrderStore.set(next);
    writeStringList(PINNED_KEY, next);
  }

  pinnedOrder(visible: SessionSummary[]): SessionSummary[] {
    const order = this.pinnedSessionOrderStore.get();
    if (order.length === 0) return [];
    const byId = new Map(visible.map(summary => [summary.sessionId, summary]));
    return order.map(id => byId.get(id)).filter((summary): summary is SessionSummary => summary !== undefined);
  }

  manualOrder(visible: SessionSummary[]): SessionSummary[] {
    const order = this.flatManualOrderStore.get();
    if (order.length === 0) return visible.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    const position = new Map(order.map((id, index) => [id, index]));
    const known = visible
      .filter(summary => position.has(summary.sessionId))
      .sort((a, b) => (position.get(a.sessionId) ?? 0) - (position.get(b.sessionId) ?? 0));
    const fresh = visible
      .filter(summary => !position.has(summary.sessionId))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return [...known, ...fresh];
  }

  /**
   * 正在跑的子智能体所牵连到的祖先会话。
   *
   * 子智能体只在父会话的子智能体面板里存在、也不进顶层列表，所以「父会话自己早已停下、
   * 派出去的子智能体还在跑」的行，光看 summary.running 会被当成空闲。这里沿 origin=subagent
   * 这条边往父走，把祖先链都标上（对齐 Android Stores.runningSubagentRoots）。
   */
  runningSubagentRoots(): Set<SessionId> {
    const sessions = this.sessionsState.get();
    const parentOf = new Map<SessionId, SessionId>();
    for (const summary of sessions) {
      if (isSubagentOrigin(summary) && summary.parentSessionId !== undefined) {
        parentOf.set(summary.sessionId, summary.parentSessionId);
      }
    }
    const roots = new Set<SessionId>();
    for (const summary of sessions) {
      if (!summary.running || !isSubagentOrigin(summary)) continue;
      let current: SessionId | undefined = summary.sessionId;
      const seen = new Set<SessionId>([current]);
      for (;;) {
        const parent: SessionId | undefined = current === undefined ? undefined : parentOf.get(current);
        if (parent === undefined || seen.has(parent)) break;
        seen.add(parent);
        roots.add(parent);
        current = parent;
      }
    }
    return roots;
  }

  statusOrder(visible: SessionSummary[], erroredIds: Set<SessionId>): SessionSummary[] {
    const completed = this.completedSessionIdsStore.get();
    const awaiting = this.awaitingUserSessionIdsStore.get();
    const awaitingKinds = this.awaitingUserKindsStore.get();
    const drafts = this.draftSessionIdsStore.get();
    const subagentRoots = this.runningSubagentRoots();
    // 与 Android SessionStatusRank 同档位：审批(3) 与提问/计划评审(4) 必须分开——
    // 「等你点允许」和「等你回答」是两种不同的阻塞，挤在一档会让列表顺序失去意义。
    const rank = (summary: SessionSummary): number => {
      const id = summary.sessionId;
      if (summary.running || subagentRoots.has(id)) return 0;
      // 「用户不在场时结束」的那一轮才是未读：错误的档次再说是不是失败收场
      // （对齐 Android sessionStatusRank 的 isUnread → FAILED_UNREAD / DONE_UNREAD）。
      if (completed.has(id)) return erroredIds.has(id) ? 1 : 2;
      // 集合是「是否停在这」的权威，kind 表只负责命名：没有名字的标记仍按批准排档，
      // 与行尾等待徽标的兜底同一口径（对齐 Android statusOrder 的 `?: APPROVAL`）。
      if (awaiting.has(id)) return (awaitingKinds.get(id) ?? 'approval') === 'approval' ? 3 : 4;
      if (drafts.has(id)) return 5;
      return 6;
    };
    return visible
      .slice()
      .sort((a, b) => (rank(a) - rank(b)) || (b.updatedAt - a.updatedAt));
  }

  /** 只在 manual 排序下生效：把 moving 挪到 before 之前。 */
  reorderWithinSubset(moving: SessionId, before: SessionId | undefined, within: SessionSummary[]): void {
    const subsetIds = within.map(summary => summary.sessionId);
    const from = subsetIds.indexOf(moving);
    if (from < 0 || moving === before) return;
    subsetIds.splice(from, 1);
    const anchor = before === undefined ? -1 : subsetIds.indexOf(before);
    subsetIds.splice(anchor >= 0 ? anchor : subsetIds.length, 0, moving);
    const subsetSet = new Set(subsetIds);
    const result = this.flatManualOrderStore.get().slice();
    const slots: number[] = [];
    result.forEach((id, index) => {
      if (subsetSet.has(id)) slots.push(index);
    });
    let cursor = 0;
    for (const slot of slots) {
      if (cursor >= subsetIds.length) break;
      result[slot] = subsetIds[cursor];
      cursor += 1;
    }
    const appended = subsetIds.slice(cursor);
    const next = [...result, ...appended];
    this.flatManualOrderStore.set(next);
    writeStringList(MANUAL_KEY, next);
  }

  setDraft(sessionId: SessionId, hasDraft: boolean): void {
    const current = this.draftSessionIdsStore.get();
    const next = new Set(current);
    if (hasDraft) next.add(sessionId);
    else next.delete(sessionId);
    this.draftSessionIdsStore.set(next);
  }

  markAwaitingUser(sessionId: SessionId, kind: SessionAwaitingKind): void {
    const ids = new Set(this.awaitingUserSessionIdsStore.get());
    ids.add(sessionId);
    this.awaitingUserSessionIdsStore.set(ids);
    const kinds = new Map(this.awaitingUserKindsStore.get());
    kinds.set(sessionId, kind);
    this.awaitingUserKindsStore.set(kinds);
  }

  clearAwaitingUser(sessionId: SessionId): void {
    const ids = new Set(this.awaitingUserSessionIdsStore.get());
    ids.delete(sessionId);
    this.awaitingUserSessionIdsStore.set(ids);
    const kinds = new Map(this.awaitingUserKindsStore.get());
    kinds.delete(sessionId);
    this.awaitingUserKindsStore.set(kinds);
  }

  clearAllAwaitingUser(): void {
    this.awaitingUserSessionIdsStore.set(new Set());
    this.awaitingUserKindsStore.set(new Map());
  }

  clearCompleted(sessionId: SessionId): void {
    const next = new Set(this.completedSessionIdsStore.get());
    next.delete(sessionId);
    this.completedSessionIdsStore.set(next);
  }

  private syncCompletedNotifications(): void {
    const sessions = this.sessionsStore.get();
    const seen = new Set(sessions.map(summary => summary.sessionId));
    for (const summary of sessions) this.reconcileCompleted(summary);
    for (const key of Array.from(this.previousRunning.keys())) {
      if (!seen.has(key)) this.previousRunning.delete(key);
    }
    this.persistRunning();
    this.completedSessionIdsStore.set(
      new Set(Array.from(this.completedSessionIdsStore.get()).filter(id => seen.has(id))),
    );
  }

  private reconcileCompleted(summary: SessionSummary): void {
    const previous = this.previousRunning.get(summary.sessionId);
    if (previous === undefined) {
      this.previousRunning.set(summary.sessionId, summary.running);
      return;
    }
    if (previous && !summary.running) {
      if (summary.sessionId !== this.selectedSessionId) {
        const next = new Set(this.completedSessionIdsStore.get());
        next.add(summary.sessionId);
        this.completedSessionIdsStore.set(next);
      }
      this.onCompleted?.(summary.sessionId);
    } else if (summary.running) {
      const next = new Set(this.completedSessionIdsStore.get());
      next.delete(summary.sessionId);
      this.completedSessionIdsStore.set(next);
    }
    this.previousRunning.set(summary.sessionId, summary.running);
  }
}

export const sessionListStore = new SessionListStore();

/** 工作区注册表。 */
class WorkspaceStore {
  readonly workspacesStore = new Store<WorkspaceView[]>([]);
  readonly archivedSessionIdsStore = new Store<SessionId[]>([]);

  get workspaces(): WorkspaceView[] {
    return this.workspacesStore.get();
  }

  get archivedSessionIds(): SessionId[] {
    return this.archivedSessionIdsStore.get();
  }

  /** sessionId -> 工作区标题，列表分组用。 */
  bySessionMap(): Map<SessionId, string> {
    const result = new Map<SessionId, string>();
    for (const workspace of this.workspacesStore.get()) {
      for (const id of workspace.sessionIds) result.set(id, workspace.title);
    }
    return result;
  }

  setWorkspaces(items: WorkspaceView[], archived: SessionId[]): void {
    this.workspacesStore.set(items);
    this.archivedSessionIdsStore.set(archived);
  }

  upsert(workspace: WorkspaceView): void {
    const items = this.workspacesStore.get();
    const index = items.findIndex(item => item.workspaceId === workspace.workspaceId);
    if (index < 0) {
      this.workspacesStore.set([...items, workspace]);
      return;
    }
    const next = items.slice();
    next[index] = workspace;
    this.workspacesStore.set(next);
  }

  remove(workspaceId: WorkspaceId): void {
    this.workspacesStore.set(this.workspacesStore.get().filter(item => item.workspaceId !== workspaceId));
  }

  applyOrder(order: WorkspaceId[]): void {
    const items = this.workspacesStore.get();
    const byId = new Map(items.map(item => [item.workspaceId, item]));
    const ordered = order
      .map(id => byId.get(id))
      .filter((item): item is WorkspaceView => item !== undefined);
    const rest = items.filter(item => !order.includes(item.workspaceId));
    this.workspacesStore.set([...ordered, ...rest]);
  }

  /**
   * 把一个工作区挪到另一个工作区之前，beforeWorkspaceId 为空表示挪到末尾。
   *
   * 锚点用 id 而不是下标：列表里只渲染「有会话的工作区」，下标是渲染序，跟注册表的
   * 真实顺序对不上；而且这次本地移动随后还要交给主机落定，主机认的也是 id。
   * 返回是否真的动过，没动就不必发请求。
   */
  moveWorkspace(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): boolean {
    if (workspaceId === beforeWorkspaceId) return false;
    const items = this.workspacesStore.get();
    const from = items.findIndex(item => item.workspaceId === workspaceId);
    if (from < 0) return false;
    if (beforeWorkspaceId !== undefined && !items.some(item => item.workspaceId === beforeWorkspaceId)) return false;
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    const anchor = beforeWorkspaceId === undefined ? -1 : next.findIndex(item => item.workspaceId === beforeWorkspaceId);
    next.splice(anchor >= 0 ? anchor : next.length, 0, moved);
    if (next.map(item => item.workspaceId).join('|') === items.map(item => item.workspaceId).join('|')) return false;
    this.workspacesStore.set(next);
    return true;
  }

  setArchived(ids: SessionId[]): void {
    this.archivedSessionIdsStore.set(ids);
  }
}

export const workspaceStore = new WorkspaceStore();

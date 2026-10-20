import { Store } from './store';
import type { ObservedJobOutput } from '../model/jobs';
import { searchStore, type SearchState } from './search';
import { connectionStore, socketStateStore } from './connection';
import { profileStore, decodeKey, type ServerProfile } from './profileStore';
import { settings } from './settings';
import { sessionCache } from './cache';
import { sessionListStore, workspaceStore } from './stores';
import { SessionStore, HISTORY_MESSAGES, type HistoryPageRequest } from './sessionStore';
import { StreamCoordinator, type AttentionSignal, type StreamSession } from './streamCoordinator';
import { TunnelTransport } from '../transport/tunnel/transport';
import { publicKeyOf } from '../transport/tunnel/crypto/x25519';
import type { RemoteEventOutcome, RpcTransport } from '../transport/types';
import { ApiException } from '../transport/types';
import {
  agentPresetList,
  agentPresetSelect,
  changesDiff,
  changesSummary,
  commandsExecute,
  commandsList,
  fileReferencesList,
  goalClear,
  goalCreate,
  goalEdit,
  goalGet,
  goalPause,
  goalResume,
  hostOpenPath,
  sessionAttachment,
  sessionCancel,
  sessionFork,
  sessionList,
  sessionModels,
  sessionPage,
  sessionPrompt,
  sessionReferenceCandidates,
  sessionRename,
  sessionSearch,
  sessionSelectModel,
  sessionSelectPermission,
  sessionUpdateQueue,
  sessionCreate,
  workspaceInitializeDefault,
  permissionCatalog,
  skillList,
  subagentInterrupt,
  subagentCatalog,
  jobKill,
  workspaceSetPinned,
  SESSION_ACTIVE_ERROR,
  subagentPrompt,
  workspaceArchiveSession,
  workspaceFileRead,
  workspaceFileReadBytes,
  workspaceInsertBefore,
  workspaceUnarchiveSession,
  type PromptContentPart,
  type QueueAction,
  answerUserQuestion,
} from '../transport/rpcMethods';
import { goalPhaseAction, planModeLine, sessionDisplayTitle, sessionStoredTitle } from '../model/format';
import { reusableBlankSession } from '../model/blankSessionReuse';
import { copyWorkspaceFileChunked } from '../model/chunkedCopy';
import { fileExtension } from '../model/imageFileType';
import { modelDirectoryBeginLoading, modelDirectoryBeginSelecting, modelDirectoryFail, modelDirectoryReceiveModels, modelDirectoryReceiveSelected } from '../model/types';
import type {
  AgentPresetEntry,
  ModelSelection,
  PermissionPresetOption,
  SessionAddress,
  SessionHistoryValue,
  SessionId,
  SessionSearchItem,
  SubagentAddress,
  WorkspaceId,
} from '../model/types';
import type { ChangedFileDiff, TurnChangesAddress, TurnChangesSummary } from '../model/turnChanges';
import { questionAnswerPayload, type ApprovalRequested, type ApprovalOutcome, type QuestionRequested, type QuestionAnswer } from '../model/questionFlow';
import type { JsonValue } from '../model/json';
import type { PhoneAttachment } from './composer';
import { Strings } from '../i18n/strings';

/** 原始异常文本：只用于日志排查，绝不直接展示给用户。 */
function rawDescription(error: unknown): string {
  if (error instanceof ApiException) return error.code + ': ' + error.detail;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * 面向用户的失败文案：把底层异常收敛成一句人话（对齐 Android `describe`）。
 *
 * 传输/解析失败在传输层被包成 code = 'transport' / 'internal' 的 ApiException，它的 detail
 * 就是「connection closed」「frame too large」这类原样异常文本——直接端给用户既看不懂
 * 也没有可操作性。主机主动回的业务错误（code 非 internal/transport）本身通常是可读的，保留。
 */
function describe(error: unknown): string {
  console.warn('[dsh] request failed:', rawDescription(error));
  if (error instanceof ApiException && error.code !== 'internal' && error.code !== 'transport') {
    const detail = error.detail.trim();
    if (detail.length > 0) return detail;
  }
  return Strings.operationFailed;
}

/** 主机不认识这个方法（老版本主机）。 */
function isMethodMissing(error: unknown): boolean {
  return error instanceof ApiException && (error.code === 'method-not-found' || error.code === 'not-found');
}

export interface AppModelSnapshot {
  connectionKind: 'idle' | 'connecting' | 'connected' | 'failed' | 'reconnecting';
}

/**
 * 进程级编排层，对应 Android 挂在 Application 上的 PhoneModel。
 *
 * 它持有唯一一份传输与唯一的流协调器：传输按设置里的 transport 在 local / mock 之间切换，
 * 直连 localhost 打不通的问题被隔离在传输层，这一层只认 RpcTransport 接口。
 *
 * 会话窗口按需 new SessionStore(id)，页面通过 useStore(store.xStore) 订阅自己关心的那一份。
 */
export class AppModel {
  readonly profiles = profileStore;
  readonly settings = settings;
  readonly listStore = sessionListStore;
  readonly workspaceStore = workspaceStore;
  readonly searchStore: Store<SearchState> = searchStore;
  readonly refreshingStore = new Store<boolean>(false);
  readonly agentPresetsStore = new Store<AgentPresetEntry[]>([]);
  /** 新建页给不给预设选择入口：0.2.1 删掉了部署开关，只看有没有可用（未损坏）的预设（对齐 Android）。 */
  readonly agentPresetPickerEnabledStore = new Store<boolean>(true);
  readonly lastErrorStore = new Store<string | undefined>(undefined);
  /** 最近一条主机广播：管理页据此重读（对齐安卓 ManagementRefresh 的事件触发）。 */
  readonly managementEventStore = new Store<{ name: string; at: number } | undefined>(undefined);
  /**
   * 有「还没看过」错误的会话 id。
   *
   * 列表页按状态排序时要用它把出错的会话顶到前面（与 Android
   * `model.sessions.filterValues { it.unreadError }.keys` 同一口径）。会话窗口是懒建的，
   * 所以只能在窗口创建时挂订阅，谁的错误状态一变就重算一次并广播。
   */
  readonly erroredSessionIdsStore = new Store<SessionId[]>([]);
  readonly coordinatorState = new Store<{ hostHome?: string; socket?: 'connected' | 'reconnecting' }>({});

  /** 已打开过的会话窗口。关闭（离开会话页）时保留，回来能立刻画出上一次的样子。 */
  readonly sessions = new Map<SessionId, SessionStore>();

  selectedSessionId?: SessionId;

  /** 进程级权限目录（0.1.6）；0.1.5 主机上始终是空的，各会话退回投影内联的候选。 */
  private permissionCatalogOptions?: PermissionPresetOption[];

  /**
   * 每轮改动文件的汇总与比较缓存（0.1.6 的 ui-deliverables 路由）。
   *
   * 键是「会话 + 公告 seq」的地址：同一轮后来的公告会取代先前的记录。
   */
  private readonly turnChangesSummaries = new Map<string, TurnChangesSummary>();
  private readonly turnChangesDiffs = new Map<string, ChangedFileDiff>();
  /** 主机明确回 404 的地址：不再重发，卡片直接按「没有记录」画。 */
  private readonly turnChangesUnavailable = new Set<string>();
  /** 在飞的改动请求：同一个地址只留一份，卡片重绘不叠并发。 */
  private readonly turnChangesInflight = new Map<string, Promise<unknown>>();
  /** 会话列表刷新的代次：晚到的旧基线按代次丢弃。 */
  private listRefreshGeneration = 0;

  private transport?: RpcTransport;
  private coordinator?: StreamCoordinator;
  /**
   * 连接代号：每次 connectWith 递增。
   *
   * 冷启动时 useLaunch、useDidShow、onForeground 会各触发一次连接，三条流程会同时
   * teardown 并替换 this.transport——后一条把前一条正在读的隧道 socket 关掉，大响应
   * 正好读到一半就报 chacha20poly1305: authentication failed，同时白白多耗连接配额。
   * 只有自己这一代还是当前代号时，才允许继续写公共状态、开多路下行。
   */
  private connectGeneration = 0;
  /** 正在进行的连接流程；并发调用（useLaunch/useDidShow/onForeground）复用它。 */
  private connecting: Promise<void> | undefined;
  /** 上面这条流程连的是哪台电脑；只有同一台才复用。 */
  private connectingProfileId: string | undefined;
  private searchGeneration = 0;
  private readonly imageCache = new Map<string, string>();

  constructor() {
    // 冷启动先把上次的清单铺出来，随后照常连远端整体替换（stale-while-revalidate）。
    sessionListStore.seedFromCache(sessionCache.loadRoster());
    sessionListStore.selectedSessionId = this.selectedSessionId;
    sessionListStore.onCompleted = sessionId => {
      // 小程序没有系统通知，「跑完了」只能在列表行上体现；这里不额外弹条。
      void sessionId;
    };
  }

  // —— 连接 ————————————————————————————————————————————————

  /**
   * 建传输。
   *
   * 手机端只有一条路：走配对资料的 TCP + Noise 加密隧道（与 Android 的 ApiClient
   * 一致——那边也只有 NoiseSocketFactory 一条）。没有可用配对资料就抛错，由引导页
   * 接手，绝不静默退回某种「本地直连」。
   */
  private buildTransport(): RpcTransport {
    const profile = profileStore.current;
    if (profile === undefined) throw new Error('no paired desktop');
    const transport = this.buildTunnelTransport(profile);
    if (transport === undefined) throw new Error('pairing record is unusable');
    return transport;
  }

  /**
   * 从一条配对资料建隧道传输。
   *
   * 设备私钥在配对时就生成并落盘了（见 transport/tunnel/device.ts），这里只是解出来；
   * 解不出来（老数据/被改坏）就返回 undefined，由 buildTransport 报错、引导页接手。
   */
  private buildTunnelTransport(profile: ServerProfile): RpcTransport | undefined {
    const bridgeKey = decodeKey(profile.bridgeKey);
    const privateKey = decodeKey(profile.devicePrivateKey);
    if (bridgeKey === undefined || bridgeKey.length !== 32) return undefined;
    if (privateKey === undefined || privateKey.length !== 32) return undefined;
    // 一次性配对码：首次连接用它登记设备，成功后 profileStore.markConnected 会清掉。
    const token = profile.pairingToken === undefined ? undefined : decodeKey(profile.pairingToken);
    return new TunnelTransport({
      host: profile.proxyHost,
      port: profile.proxyPort,
      bridgeKey,
      deviceKey: { privateKey, publicKey: publicKeyOf(privateKey) },
      ...(token === undefined || token.length !== 32 ? {} : { pairingToken: token }),
    });
  }

  /** 管理页（插件、自动化任务、宿主设置）直接走 RPC：它们的状态只活在页面里，不进会话模型。 */
  managementTransport(): RpcTransport {
    return this.requireTransport();
  }

  private requireTransport(): RpcTransport {
    if (this.transport === undefined) this.transport = this.buildTransport();
    return this.transport;
  }

  private ensureCoordinator(): StreamCoordinator {
    if (this.coordinator !== undefined) return this.coordinator;
    const transport = this.requireTransport();
    const coordinator = new StreamCoordinator({
      openMux: (onEvent, onState) => transport.openMux(onEvent, onState),
      cache: { saveWindow: (sessionId, window) => sessionCache.saveWindow(sessionId, window) },
      listStore: sessionListStore,
      workspaceStore: workspaceStore,
      sessionLookup: sessionId => this.sessions.get(sessionId),
      sessionUpsert: sessionId => this.ensureSession(sessionId),
      // 会话页在场就是它；退回列表就没有了（对齐 Android model.visibleSessionId）。
      sessionIsOnScreen: sessionId => this.selectedSessionId === sessionId,
      allSessions: () => Array.from(this.sessions.values()),
      remoteEventHandler: event => {
        // 管理页只听自己那一路广播（plugin-manager/changed、schedule/changed……），不另开 $events。
        this.managementEventStore.set({ name: event, at: Date.now() });
        // 主机实时贡献改变就叫一声，目录要跟着重拉；其余事件照旧刷新列表。
        if (event === 'permission-presets/catalog-changed') void this.loadPermissionCatalog();
        void this.refreshInternal();
      },
      sessionRemovedHandler: sessionId => {
        this.sessions.delete(sessionId);
        sessionListStore.remove(sessionId);
        // 改动记录是主机在会话存活期间才提供的东西，会话没了就整批丢掉；
        // 缓存里的窗口跟着删，别让下一屏画出幽灵会话。
        this.closeSessionArtifacts(sessionId);
        if (this.selectedSessionId === sessionId) {
          this.selectedSessionId = undefined;
          this.lastErrorStore.set(Strings.sessionGone);
        }
      },
      pinnedHandler: sessionIds => sessionListStore.applyHostPinned(sessionIds),
      sessionsArchivedHandler: sessionIds => {
        // 归档集合是「渲染时过滤」的唯一依据：两个 store 都要同步，否则主机推来的
        // workspace 归档帧只更新了 workspaceStore，列表侧镜像还留着旧的（对齐 Android
        // PhoneModel.handleSessionsArchived 同时写两侧）。
        workspaceStore.setArchived(sessionIds);
        sessionListStore.setArchivedSessionIds(sessionIds);
        // 归档不是删除：名册行留着（主机 session/list 还会带回来），但运行时状态收掉——
        // 改动记录归档后再打开也不会回填，缓存窗口留着只会画出过期内容。
        // 这里**不**写 lastError：会话还在主机上，说「已在主机上消失」是谎报。
        for (const sessionId of sessionIds) this.closeSessionArtifacts(sessionId);
      },
      resyncHandler: () => {
        void (async () => {
          await this.refreshInternal();
          // 重连后每条已注册的流都会重开，follow 的 snapshot 帧会重新送来完整基线；
          // 正开着的那条先清空窗口等基线，别拿没有游标的分页去抢跑
          //（对齐 Android resyncAfterReconnect）。
          const sessionId = this.selectedSessionId;
          if (sessionId === undefined) return;
          const store = this.sessions.get(sessionId);
          if (store === undefined) return;
          store.resetWindow();
          await store.retryHistory();
        })();
      },
      gapRepairLoader: (address, throughSeq) => this.loadAddressPage(address, throughSeq),
      attentionHandler: signal => this.handleAttention(signal),
      settle: (clientId, eventId, outcome) => transport.settleRemoteEvent(clientId, eventId, outcome),
    });
    coordinator.onConnectionState = state => {
      socketStateStore.set(state);
      this.coordinatorState.patch({ socket: state });
      if (state === 'connected') {
        const current = connectionStore.get();
        if (current.kind !== 'connected') {
          connectionStore.set({ kind: 'connected', profileId: profileStore.currentId });
        }
      } else {
        connectionStore.set({ kind: 'reconnecting' });
      }
    };
    coordinator.start();
    this.coordinator = coordinator;
    return coordinator;
  }

  /** 切到某台已配对的电脑：重开传输与流，再拉一次基线。 */
  async connectProfile(profile: ServerProfile): Promise<void> {
    profileStore.setCurrent(profile.id);
    await this.connectWith(profile.id, profile.id);
  }

  private async connectWith(profileId: string, cacheProfileId: string): Promise<void> {
    // 冷启动可能连着触发三次（useLaunch / useDidShow / onForeground）；已经在连
    // 同一台电脑就直接复用，别把刚建好的隧道关掉重来。必须在抢代号之前判断，
    // 否则后来者一递增代号就把正在跑的那一代作废了。
    if (this.connecting !== undefined && this.connectingProfileId === profileId) {
      await this.connecting;
      return;
    }
    // 换一台电脑：这一代作废上一代（上一代不会再碰公共状态）。
    const generation = ++this.connectGeneration;
    const run = this.runConnect(profileId, cacheProfileId, generation);
    this.connecting = run;
    this.connectingProfileId = profileId;
    try {
      await run;
    } finally {
      if (this.connecting === run) {
        this.connecting = undefined;
        this.connectingProfileId = undefined;
      }
    }
  }

  private async runConnect(profileId: string, cacheProfileId: string, generation: number): Promise<void> {
    this.teardown();
    connectionStore.set({ kind: 'connecting' });
    try {
      const transport = this.buildTransport();
      this.transport = transport;
      sessionCache.setProfile(cacheProfileId);
      // 先只用 RPC 那条连接把基线拉回来，成功后再开多路下行（WebSocket 要独占一条
      // 隧道）。平台每 5 分钟只给 20 条 TCPSocket，失败时把 mux 也一起拨出去等于
      // 双倍消耗，还会让 mux 的重连把配额抢光、RPC 反而建不出来。
      await this.refreshInternal(transport);
      if (generation !== this.connectGeneration) return;
      this.ensureCoordinator();
      // catalog 与列表并行拉：它是进程级的，拉不到（0.1.5 主机）也不影响连上。
      void this.loadPermissionCatalog();
      profileStore.markConnected(profileId);
      connectionStore.set({ kind: 'connected', profileId });
    } catch (error) {
      if (generation !== this.connectGeneration) return;
      // 连接失败在横幅上就是「连不上」这条人话，底层异常只进日志
      //（对齐 Android `Connection.Failed(Strings.offlineBannerTitle)`）。
      console.warn('[dsh] connect failed:', rawDescription(error));
      connectionStore.set({ kind: 'failed', message: Strings.offlineBannerTitle });
      this.lastErrorStore.set(describe(error));
    }
  }

  /**
   * 启动与断线重连的入口。
   *
   * 与 Android 的 PhoneModel.connect 同口径：没有配对资料就什么都不连，停在 idle，
   * 列表页据此显示引导页（扫码 / 粘贴配对串）。这里不存在「先直连凑合一下」的路。
   */
  connectCurrent(): void {
    const profile = profileStore.current;
    if (profile === undefined) {
      connectionStore.set({ kind: 'idle' });
      return;
    }
    void this.connectProfile(profile);
  }

  /** 断线或切回前台后的整表刷新。 */
  async refresh(): Promise<void> {
    try {
      await this.refreshInternal();
      const current = connectionStore.get();
      if (current.kind !== 'connected') connectionStore.set({ kind: 'connected', profileId: profileStore.currentId });
    } catch (error) {
      console.warn('[dsh] session list refresh failed:', rawDescription(error));
      connectionStore.set({ kind: 'failed', message: Strings.offlineBannerTitle });
    }
  }

  /** 下拉刷新：重拉会话列表，并把当前会话的窗口对齐到最新。 */
  async pullToRefresh(): Promise<void> {
    // 重入保护：连点几次下拉会叠出几轮基线拉取，晚到的旧基线还会盖掉新的
    //（对齐 Android `if (refreshing) return`）。
    if (this.refreshingStore.get()) return;
    this.refreshingStore.set(true);
    try {
      await this.refresh();
      // 列表刷新不会动会话窗口：正开着的那条要一起对齐到最新，否则下拉之后转写还停在
      // 旧位置（对齐 Android pullToRefresh 里那句 loadHistory(selected)）。
      const selected = this.selectedSessionId;
      if (selected !== undefined) await this.sessions.get(selected)?.retryHistory();
    } finally {
      this.refreshingStore.set(false);
    }
  }

  onForeground(): void {
    if (this.coordinator === undefined) {
      this.connectCurrent();
      return;
    }
    this.coordinator.onForeground();
  }

  onBackground(): void {
    this.coordinator?.onBackground();
  }

  private teardown(): void {
    this.coordinator?.stop();
    this.coordinator = undefined;
    // 关闭而不是只丢引用：未关闭的 TCPSocket 会一直占着平台配额（20 条 / 5 分钟）。
    this.transport?.close?.();
    this.transport = undefined;
    this.sessions.clear();
    this.imageCache.clear();
    this.permissionCatalogOptions = undefined;
    this.turnChangesSummaries.clear();
    this.turnChangesDiffs.clear();
    this.turnChangesUnavailable.clear();
    this.turnChangesInflight.clear();
  }

  private async refreshInternal(target?: RpcTransport): Promise<void> {
    const transport = target ?? this.requireTransport();
    // 刷新代次：下拉、回前台、重连 resync 可能同时在飞，晚回来的旧基线不能盖掉新的
    //（对齐 Android sessionListRefreshGeneration 的双查）。
    this.listRefreshGeneration += 1;
    const generation = this.listRefreshGeneration;
    const token = sessionListStore.beginBaselinePull();
    try {
      const list = await sessionList(transport);
      if (generation !== this.listRefreshGeneration) return;
      sessionListStore.endBaselinePull(list.items, token);
      // 落盘的是合并后的清单（基线 + 往返期间重放的增量），比裸的 list.items 更接近
      // 用户此刻看到的那一份（对齐 Android `cache.saveRoster(listStore.sessions)`）。
      sessionCache.saveRoster(sessionListStore.sessions);
    } catch (error) {
      if (generation !== this.listRefreshGeneration) return;
      sessionListStore.discardBaselinePull(token);
      throw error;
    }
    void this.loadAgentPresets();
  }

  private handleAttention(signal: AttentionSignal): void {
    switch (signal.kind) {
      // 等待档位由协调器的 syncAwaitingUser 按 pendingInteractionKind 统一标记
      //（审批优先，其次计划评审 / 提问），这里不能再标一次：
      // 覆盖一遍会把「计划待审」降级成普通提问，列表行的徽标与排序都跟着错。
      case 'approvalRequested':
      case 'questionAsked':
        break;
      case 'failed':
        this.lastErrorStore.set(signal.message);
        break;
      case 'running':
      case 'sessionCompleted':
      case 'waterfallRetired':
        break;
    }
  }

  // —— 会话窗口 ————————————————————————————————————————————

  ensureSession(sessionId: SessionId): SessionStore {
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) return existing;
    const store = new SessionStore(sessionId);
    // 目录是进程级的、不随会话走，新建的 store 也得补上那份已经在手里的。
    store.setPermissionCatalog(this.permissionCatalogOptions);
    store.setHistoryPageLoader(request => this.loadHistoryPage(request));
    store.unreadErrorStore.subscribe(() => this.publishErroredSessions());
    this.sessions.set(sessionId, store);
    return store;
  }

  store(sessionId: SessionId): SessionStore | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 每轮改动文件的公告坐标。
   *
   * 没有公告（这一轮没改东西）时返回 undefined，调用方据此不画卡片。
   */
  changesAddressForTurn(sessionId: SessionId, turn: number): TurnChangesAddress | undefined {
    return this.sessions.get(sessionId)?.changesAddress(turn);
  }

  /**
   * 读一轮的改动汇总；主机不再提供（404）时得到 undefined。
   *
   * 三条规矩与 Android TurnChangesStore 一致：
   *  · 404（主机明确不再提供）记成 unavailable，之后的重绘不再重发——否则每次重绘都打一次 RPC；
   *  · 传输失败**不**算答案，不写任何缓存，留给下次重绘重试，免得主机重启一次就把卡片
   *    永久钉死成「这一轮没有改动」；
   *  · 同一个地址在飞的请求只留一份，卡片重绘不会叠出一堆并发请求。
   */
  async loadTurnChanges(address: TurnChangesAddress): Promise<TurnChangesSummary | undefined> {
    const key = changesKey(address);
    const cached = this.turnChangesSummaries.get(key);
    if (cached !== undefined) return cached;
    if (this.turnChangesUnavailable.has(key)) return undefined;
    const inflight = this.turnChangesInflight.get(key);
    if (inflight !== undefined) return inflight as Promise<TurnChangesSummary | undefined>;
    const pending = (async () => {
      try {
        const summary = await changesSummary(this.requireTransport(), address.sessionId, address.seq);
        if (summary !== undefined) this.turnChangesSummaries.set(key, summary);
        else this.turnChangesUnavailable.add(key);
        return summary;
      } catch (error) {
        this.lastErrorStore.set(describe(error));
        return undefined;
      } finally {
        this.turnChangesInflight.delete(key);
      }
    })();
    this.turnChangesInflight.set(key, pending);
    return pending;
  }

  /** 读一个列出的文件的轮首/轮末比较；缓存与失败口径同 loadTurnChanges。 */
  async loadTurnChangesDiff(address: TurnChangesAddress, index: number): Promise<ChangedFileDiff | undefined> {
    const key = changesKey(address) + '#' + String(index);
    const cached = this.turnChangesDiffs.get(key);
    if (cached !== undefined) return cached;
    if (this.turnChangesUnavailable.has(key)) return undefined;
    const inflight = this.turnChangesInflight.get(key);
    if (inflight !== undefined) return inflight as Promise<ChangedFileDiff | undefined>;
    const pending = (async () => {
      try {
        const diff = await changesDiff(this.requireTransport(), address.sessionId, address.seq, index);
        if (diff !== undefined) this.turnChangesDiffs.set(key, diff);
        else this.turnChangesUnavailable.add(key);
        return diff;
      } catch (error) {
        // 没有 catch 的话，一次网络抖动会把 Promise 抛到渲染层去，卡片直接卡在加载态。
        this.lastErrorStore.set(describe(error));
        return undefined;
      } finally {
        this.turnChangesInflight.delete(key);
      }
    })();
    this.turnChangesInflight.set(key, pending);
    return pending;
  }

  /** 会话被删或被归档：它的改动记录与磁盘窗口一起收掉。 */
  private closeSessionArtifacts(sessionId: SessionId): void {
    const prefix = sessionId + '@';
    for (const key of Array.from(this.turnChangesSummaries.keys())) {
      if (key.startsWith(prefix)) this.turnChangesSummaries.delete(key);
    }
    for (const key of Array.from(this.turnChangesDiffs.keys())) {
      if (key.startsWith(prefix)) this.turnChangesDiffs.delete(key);
    }
    for (const key of Array.from(this.turnChangesUnavailable)) {
      if (key.startsWith(prefix)) this.turnChangesUnavailable.delete(key);
    }
    sessionCache.removeWindow(sessionId);
  }

  /**
   * 拉进程级权限目录（0.1.6 的 permissionPresets/catalog）并广播给每个已打开的会话。
   *
   * 目录与单个会话的历史无关，拉一次即可；0.1.5 主机没有这条 RPC，失败时保持空，
   * 各会话会退回 permissions 投影内联的那份，不丢功能。
   */
  async loadPermissionCatalog(): Promise<void> {
    let catalog: PermissionPresetOption[];
    try {
      catalog = await permissionCatalog(this.requireTransport());
    } catch {
      return;
    }
    if (catalog.length === 0) return;
    this.permissionCatalogOptions = catalog;
    for (const store of this.sessions.values()) store.setPermissionCatalog(catalog);
  }

  private publishErroredSessions(): void {
    const errored: SessionId[] = [];
    for (const store of this.sessions.values()) {
      if (store.unreadError) errored.push(store.sessionId);
    }
    this.erroredSessionIdsStore.set(errored);
  }

  private async loadHistoryPage(request: HistoryPageRequest): Promise<SessionHistoryValue> {
    const transport = this.requireTransport();
    const page = await sessionPage(
      transport,
      { kind: 'session', sessionId: request.sessionId },
      request.throughSeq,
      request.beforeSeq,
      request.limit,
    );
    return { events: page.records, hasMore: page.hasMore };
  }

  private async loadAddressPage(address: SessionAddress, throughSeq: number): Promise<SessionHistoryValue> {
    const transport = this.requireTransport();
    const page = await sessionPage(transport, address, throughSeq, undefined, HISTORY_MESSAGES);
    return { events: page.records, hasMore: page.hasMore };
  }

  /** 打开一个会话：先铺缓存，再登记 follow，最后把 control 流的队列/任务基线补上。 */
  open(sessionId: SessionId): SessionStore {
    const store = this.ensureSession(sessionId);
    store.open(sessionId);
    const cached = sessionCache.loadWindow(sessionId);
    if (cached !== undefined) store.seedFromCache(cached);
    // 先喂首页裁切点再 follow：少了这一步 historyCursor 会退化成 0，之后补分页
    // 只能拿一个假的 throughSeq 去要「截止到第 0 条事件」，转写反而被打成空态
    //（对齐 Android open 里那句 seedHistoryCursor）。
    const asOfSeq = sessionListStore.sessionsById.get(sessionId)?.projections?.asOfSeq;
    if (asOfSeq !== undefined) store.seedHistoryCursor(asOfSeq);
    const coordinator = this.ensureCoordinator();
    coordinator.follow(sessionId, store.followAddress);
    coordinator.hydrateControlState(store as unknown as StreamSession);
    this.selectedSessionId = sessionId;
    // 进场就当用户已经看过：把未读失败红点收掉（对齐 Android model.markErrorSeen）。
    store.markErrorSeen();
    sessionListStore.selectedSessionId = sessionId;
    // 这里**不** markEngaged：那是「用户真的发过东西」的标记，Android 只在 send /
    // 命令成功之后才打（PhoneModel.kt:735,771）。仅仅点开就把空白会话标成非空白，
    // 新建会话页下次就复用不到它，每进一次新建会话都会在主机上多留一条空会话。
    sessionListStore.clearCompleted(sessionId);
    return store;
  }

  /**
   * 退回列表。
   *
   * **不** unfollow：follow 是「这条会话的实时流」，退订它等于让后台会话停止更新——
   * 跑挂了不会亮红点、跑完了不会变状态，回到列表看到的是一条安静的会话。Android 只在
   * 三处退订（会话消失、切换服务、整体 teardown），离开会话页从来不退
   *（StreamCoordinator.kt 的调用点只有 156/248/459）。
   * 这里只摘掉与「当前就在眼前」绑定的交互挂载点，窗口与订阅都留着。
   */
  close(sessionId: SessionId): void {
    this.sessions.get(sessionId)?.close();
    // 跳去另一条会话时，新页进场早于本页退场：不比一次就会把新页刚写下的那条抹掉
    //（对齐 Android DisposableEffect 的 `if (visibleSessionId == sessionId)`）。
    if (this.selectedSessionId === sessionId) this.selectedSessionId = undefined;
  }

  // —— 搜索 ————————————————————————————————————————————————

  /**
   * 运行一次主机内容搜索（session/search，可选能力）。
   *
   * 失败（部署关掉了内容检索、没连上）落成这次查询的空命中：页面只显示本地命中，不提示（对齐 web）。
   * 边打边搜会叠很多次请求，晚到的旧结果必须丢掉：用代次比对，只有最新一次能落库。
   */
  search(query: string): void {
    const trimmed = query.trim();
    const generation = this.searchGeneration + 1;
    this.searchGeneration = generation;
    const settle = (items: SessionSearchItem[], hasMore: boolean): void => {
      if (generation === this.searchGeneration) this.searchStore.set({ query: trimmed, items, hasMore });
    };
    if (trimmed.length === 0 || this.transport === undefined) {
      settle([], false);
      return;
    }
    void sessionSearch(this.transport, trimmed)
      .then(result => settle(result.items, result.hasMore))
      .catch(() => settle([], false));
  }

  // —— 会话管理 ————————————————————————————————————————————

  async forkSession(sessionId: SessionId, atSeq?: number): Promise<SessionId | undefined> {
    try {
      const value = await sessionFork(this.requireTransport(), sessionId, atSeq);
      await this.refreshInternal();
      return value.sessionId;
    } catch (error) {
      this.lastErrorStore.set(describe(error));
      return undefined;
    }
  }

  async renameSession(sessionId: SessionId, title: string): Promise<void> {
    try {
      await sessionRename(this.requireTransport(), sessionId, title);
      await this.refreshInternal();
    } catch (error) {
      this.lastErrorStore.set(describe(error));
    }
  }

  /**
   * 恢复一条已归档会话（0.1.6 新增的 workspace/unarchiveSession）。
   *
   * 归档时本地把它从列表里摘掉了，恢复成功后必须重拉列表才回得来；返回的归档集合同步应用，
   * 归档页不必等下一次 workspace/follow 帧。老主机上这条 RPC 不存在，失败会走错误提示，
   * 而不是看起来像成功了却没动静。
   */
  async unarchiveSession(sessionId: SessionId): Promise<boolean> {
    if (this.unarchivingIdsStore.get().includes(sessionId)) return false;
    this.unarchivingIdsStore.set([...this.unarchivingIdsStore.get(), sessionId]);
    try {
      const archived = await workspaceUnarchiveSession(this.requireTransport(), sessionId);
      workspaceStore.setArchived(archived);
      sessionListStore.setArchivedSessionIds(archived);
      await this.refreshInternal();
      return true;
    } catch (error) {
      this.lastErrorStore.set(describe(error));
      return false;
    } finally {
      this.unarchivingIdsStore.set(this.unarchivingIdsStore.get().filter(id => id !== sessionId));
    }
  }

  /**
   * 归档一条会话。
   *
   * 归档不是删除：主机上这条会话还在，只是被 Workspace 注册表记进了归档集合。所以这里
   * 只把主机落定后的归档集合写进两个 store（主列表据此在渲染时把它滤掉），**不再**
   * `sessionListStore.remove`——摘要在名册里留着，归档页才拿得到标题与工作区名
   * （对齐 Android PhoneModel.archive 与 Mac archiveSession 先 handleSessionsArchived
   * 再 refreshSessions 同一口径）。
   */
  async archiveSession(sessionId: SessionId): Promise<void> {
    try {
      let archived: SessionId[];
      try {
        archived = await workspaceArchiveSession(this.requireTransport(), sessionId);
      } catch (error) {
        // 0.1.7：会话里还有任务在跑时主机拒绝归档。问一次用户，确认后让主机先停再归档。
        if (!(error instanceof ApiException) || error.code !== SESSION_ACTIVE_ERROR) throw error;
        if (!(await this.confirmStopActivity())) return;
        archived = await workspaceArchiveSession(this.requireTransport(), sessionId, true);
      }
      workspaceStore.setArchived(archived);
      // 本地这一次归档掉它的运行时 store：名册行留着给归档页，但没人在看的会话流
      // 没必要继续挂着（再打开时会重新 open() 建回来）。
      this.sessions.delete(sessionId);
      sessionListStore.setArchivedSessionIds(archived);
      this.erroredSessionIdsStore.set(this.erroredSessionIdsStore.get().filter(id => id !== sessionId));
    } catch (error) {
      this.lastErrorStore.set(describe(error));
    }
  }

  private confirmStopActivity(): Promise<boolean> {
    return new Promise(resolve => {
      wx.showModal({
        title: Strings.archiveActiveTitle,
        content: Strings.archiveActiveBody,
        confirmText: Strings.archiveActiveConfirm,
        cancelText: Strings.cancel,
        success: result => resolve(result.confirm),
        fail: () => resolve(false),
      });
    });
  }

  /** 正在取消归档的会话：归档页据此显示行内进度并挡重复点击（对齐 Android unarchivingIds）。 */
  readonly unarchivingIdsStore = new Store<SessionId[]>([]);

  /**
   * 工作区换位：先本地乐观移动，再交给主机 workspace/insertBefore 落定。
   * 落定与回滚前都比一次「本地顺序是否还等于我们乐观改出来的那个」，
   * 免得请求在飞的这段时间里跟随流推来的新顺序被旧结果冲掉。
   */
  async moveWorkspace(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void> {
    const previousOrder = workspaceStore.workspaces.map(item => item.workspaceId);
    if (!workspaceStore.moveWorkspace(workspaceId, beforeWorkspaceId)) return;
    const optimisticOrder = workspaceStore.workspaces.map(item => item.workspaceId);
    const previousIds = new Set(previousOrder);
    const untouched = (): boolean =>
      workspaceStore.workspaces
        .map(item => item.workspaceId)
        .filter(id => previousIds.has(id))
        .join('|') === optimisticOrder.join('|');
    try {
      const value = await workspaceInsertBefore(this.requireTransport(), workspaceId, beforeWorkspaceId);
      if (!untouched()) return;
      workspaceStore.applyOrder(value.workspaceIds);
    } catch (error) {
      if (untouched()) workspaceStore.applyOrder(previousOrder);
      this.lastErrorStore.set(describe(error));
    }
  }

  async openOnHost(path: string): Promise<void> {
    try {
      await hostOpenPath(this.requireTransport(), path);
    } catch (error) {
      this.lastErrorStore.set(describe(error));
    }
  }

  // —— 发送 ————————————————————————————————————————————————

  /**
   * 发送一条消息。
   *
   * 行首的斜杠命令走主机的命令通道，不能当作普通提示词交给模型：主机才会跑处理器并
   * 落 command/run、command/done，/plan 也由此真正进入计划模式。主机没认下这个名字时
   * 按普通消息继续（与 web 的 matchEnter 落点一致）。
   */
  async send(text: string, sessionId: SessionId, attachments: PhoneAttachment[] = []): Promise<boolean> {
    const store = this.sessions.get(sessionId);
    if (store === undefined) return false;
    const trimmed = text.trim();
    if (trimmed.length === 0 && attachments.length === 0) return false;
    const transport = this.requireTransport();
    if (attachments.length === 0 && isCommand(trimmed)) {
      try {
        const execution = await commandsExecute(transport, sessionId, trimmed);
        if (execution !== undefined) {
          const failure = execution.result !== undefined && execution.result.kind !== 'success' ? execution.result.text : undefined;
          if (failure !== undefined) {
            this.lastErrorStore.set(failure);
            store.historyError = { code: 'internal', message: failure };
          } else {
            store.historyError = undefined;
            store.blank = false;
          }
          sessionListStore.markEngaged(sessionId);
          return true;
        }
      } catch (error) {
        this.lastErrorStore.set(describe(error));
        return false;
      }
    }
    const requestId = newRequestId();
    store.beginPendingSubmission(requestId, store.running ? 'queued' : 'transcript', trimmed);
    const content: PromptContentPart[] = [];
    if (trimmed.length > 0) content.push({ kind: 'text', text: trimmed });
    try {
      for (const attachment of attachments) {
        if (attachment.payload.kind === 'image') {
          content.push({
            kind: 'image',
            mediaType: attachment.payload.mediaType,
            data: attachment.payload.base64,
            name: attachment.name,
          });
        } else {
          const receiptId = await transport.uploadFile(sessionId, attachment.payload.filePath, attachment.name);
          content.push({ kind: 'file', receiptId });
        }
      }
    } catch (error) {
      store.retirePendingSubmission(requestId);
      this.lastErrorStore.set(describe(error));
      return false;
    }
    try {
      const accepted = await sessionPrompt(transport, sessionId, 'queue', content, timeZone(), requestId);
      if (!accepted) {
        store.retirePendingSubmission(requestId);
        return false;
      }
      store.blank = false;
      store.running = true;
      sessionListStore.markEngaged(sessionId);
      return true;
    } catch (error) {
      store.retirePendingSubmission(requestId);
      store.historyError = { code: 'internal', message: describe(error) };
      return false;
    }
  }

  async steer(text: string, sessionId: SessionId): Promise<boolean> {
    const store = this.sessions.get(sessionId);
    const trimmed = text.trim();
    if (store === undefined || trimmed.length === 0) return false;
    const requestId = newRequestId();
    store.beginPendingSubmission(requestId, 'steering', trimmed);
    try {
      await sessionPrompt(this.requireTransport(), sessionId, 'steer', [{ kind: 'text', text: trimmed }], timeZone(), requestId);
      return true;
    } catch (error) {
      store.retirePendingSubmission(requestId);
      this.lastErrorStore.set(describe(error));
      return false;
    }
  }

  async sendToSubagent(address: SubagentAddress, text: string): Promise<void> {
    try {
      await subagentPrompt(this.requireTransport(), address, text, timeZone());
    } catch (error) {
      this.lastErrorStore.set(describe(error));
    }
  }

  async interruptSubagent(address: SubagentAddress): Promise<void> {
    try {
      await subagentInterrupt(this.requireTransport(), address);
    } catch (error) {
      this.lastErrorStore.set(describe(error));
    }
  }

  async stop(sessionId: SessionId): Promise<void> {
    try {
      await sessionCancel(this.requireTransport(), sessionId);
    } catch (error) {
      this.lastErrorStore.set(describe(error));
    }
  }

  /**
   * 队列动作：主机收下就在控制流里推新队列帧，界面随即收敛，所以不做乐观更新。
   *
   * 只在「用户还能做点什么」时才报错：插队撞上 steer-unavailable / queue-item-not-found
   * （行已经被主机取走、或已经被上一次点击插过队）属于竞态收敛，静默吃掉即可——与
   * Android PhoneModel.queueMutation / Mac QueueInteractionState.completeMutation 对齐。
   */
  async queueMutation(
    sessionId: SessionId,
    itemId: string,
    action: QueueAction,
    failure: string,
  ): Promise<void> {
    try {
      await sessionUpdateQueue(this.requireTransport(), sessionId, itemId, action);
    } catch (error) {
      // 主机抛的是带命名空间的 "session/steer-unavailable"，两种写法都认。
      const code = error instanceof ApiException ? error.code.substring(error.code.lastIndexOf('/') + 1) : '';
      const converged =
        action.kind === 'steer' && (code === 'steer-unavailable' || code === 'queue-item-not-found');
      if (!converged) this.lastErrorStore.set(failure.length > 0 ? failure : describe(error));
    }
  }

  // —— 目标 / 模型 / 权限 / 预设 ————————————————————————————

  async createGoal(objective: string, sessionId: SessionId, maxGoalRounds?: number): Promise<void> {
    try {
      await goalCreate(this.requireTransport(), sessionId, objective, maxGoalRounds);
    } catch (error) {
      this.lastErrorStore.set(describe(error));
    }
  }

  async editGoal(objective: string, sessionId: SessionId): Promise<void> {
    const ref = this.sessions.get(sessionId)?.goalRef;
    if (ref === undefined) return;
    try {
      await goalEdit(this.requireTransport(), sessionId, ref, objective);
    } catch (error) {
      this.lastErrorStore.set(describe(error));
    }
  }

  async toggleGoalPause(sessionId: SessionId): Promise<void> {
    const store = this.sessions.get(sessionId);
    const ref = store?.goalRef;
    const action = store?.activeGoal === undefined ? undefined : goalPhaseAction(store.activeGoal.phase, store.goalDisarmed);
    // 只有主机真的接受的转移才发：blocked 上不给动作，避免 GOAL_INVALID_TRANSITION
    // （对齐 Android model/GoalPhaseAction.kt）。
    if (action === undefined || ref === undefined) return;
    try {
      const transport = this.requireTransport();
      if (action === 'resume') await goalResume(transport, sessionId, ref);
      else await goalPause(transport, sessionId, ref);
    } catch (error) {
      this.lastErrorStore.set(describe(error));
    }
    void this.refreshGoalActivation(sessionId);
  }

  /** 读当前目标的进程内 activation（0.2.1 `goals/get`）；老主机没有这个方法时静默不猜。 */
  async refreshGoalActivation(sessionId: SessionId): Promise<void> {
    const store = this.sessions.get(sessionId);
    if (store === undefined || store.activeGoal === undefined) return;
    try {
      const activation = await goalGet(this.requireTransport(), sessionId);
      if (this.sessions.get(sessionId) === store) store.setGoalActivation(activation);
    } catch {
      // 读失败保持上一份（或未知）：未知时不当成 disarmed。
    }
  }

  async clearGoal(sessionId: SessionId): Promise<void> {
    const ref = this.sessions.get(sessionId)?.goalRef;
    if (ref === undefined) return;
    try {
      await goalClear(this.requireTransport(), sessionId, ref);
    } catch (error) {
      this.lastErrorStore.set(describe(error));
    }
  }

  async loadModels(sessionId: SessionId): Promise<void> {
    const store = this.sessions.get(sessionId);
    if (store === undefined) return;
    const loading = modelDirectoryBeginLoading(store.modelDirectory);
    store.modelDirectory = loading;
    try {
      const value = await sessionModels(this.requireTransport());
      store.modelDirectory = modelDirectoryReceiveModels(store.modelDirectory, value, loading.generation);
    } catch (error) {
      store.modelDirectory = modelDirectoryFail(store.modelDirectory, describe(error), loading.generation);
    }
  }

  async selectModel(selection: ModelSelection, sessionId: SessionId): Promise<void> {
    const store = this.sessions.get(sessionId);
    if (store === undefined) return;
    const selecting = modelDirectoryBeginSelecting(store.modelDirectory);
    store.modelDirectory = selecting;
    try {
      const value = await sessionSelectModel(
        this.requireTransport(),
        sessionId,
        selection.provider,
        selection.model,
        selection.reasoningEffort,
      );
      store.modelDirectory = modelDirectoryReceiveSelected(store.modelDirectory, value, selecting.generation);
    } catch (error) {
      store.modelDirectory = modelDirectoryFail(store.modelDirectory, describe(error), selecting.generation);
      this.lastErrorStore.set(describe(error));
    }
  }

  async selectPermission(presetId: string, sessionId: SessionId): Promise<void> {
    if (presetId === 'custom') return;
    try {
      await sessionSelectPermission(this.requireTransport(), sessionId, presetId);
    } catch (error) {
      this.lastErrorStore.set(describe(error));
    }
  }

  async loadAgentPresets(): Promise<void> {
    try {
      const value = await agentPresetList(this.requireTransport());
      this.agentPresetsStore.set(value.presets);
      this.agentPresetPickerEnabledStore.set(value.presets.some(preset => preset.broken === undefined || preset.broken.length === 0));
    } catch {
      // 预设目录失败不影响主流程；保持上一次的列表即可。
    }
  }

  async selectAgentPreset(id: string, sessionId: SessionId): Promise<boolean> {
    try {
      await agentPresetSelect(this.requireTransport(), sessionId, id);
      return true;
    } catch (error) {
      this.lastErrorStore.set(describe(error));
      return false;
    }
  }

  async setPlanMode(on: boolean, sessionId: SessionId): Promise<void> {
    // 命令行口径只留在 model/format.ts 一处（对齐 Android PhoneModel.kt:1238 调
    // PlanModeToggle.line(on)），不在这里重抄字面量。
    await this.runCommand(planModeLine(on), sessionId);
  }

  async compactContext(sessionId: SessionId): Promise<void> {
    await this.runCommand('/compact', sessionId);
  }

  async runCommand(line: string, sessionId: SessionId): Promise<void> {
    try {
      await commandsExecute(this.requireTransport(), sessionId, line);
    } catch (error) {
      this.lastErrorStore.set(describe(error));
    }
  }

  async loadSkills(sessionId: SessionId) {
    return skillList(this.requireTransport(), sessionId);
  }

  async loadFileReferences(sessionId: SessionId, query: string) {
    return fileReferencesList(this.requireTransport(), sessionId, query);
  }

  /** 主机命令表（部署自定义命令也在里面）；失败时抛给调用方退回静态内置表。 */
  async loadCommands(sessionId: SessionId) {
    return commandsList(this.requireTransport(), sessionId);
  }

  /** @ 引用候选里的「会话引用」（对齐 Android PhoneModel.suggestions 的 REFERENCE 分支）。 */
  async loadSessionReferenceCandidates(sessionId: SessionId, query: string) {
    return sessionReferenceCandidates(this.requireTransport(), sessionId, query);
  }

  /**
   * 父会话的直接子代理（0.1.7：session/projections 的 subagentCatalog）。
   *
   * 目录本身不带运行状态，从会话名册里对应子会话的摘要补上；读取失败时给空目录，
   * 面板只是不画这一节，而不是整张面板报错。
   */
  async loadSubagents(parentSessionId: SessionId) {
    try {
      const value = await subagentCatalog(this.requireTransport(), parentSessionId);
      const byId = sessionListStore.sessionsById;
      const parents = new Set(sessionListStore.sessions.map(summary => summary.parentSessionId));
      return {
        ...value,
        entries: value.entries.map(entry => ({
          ...entry,
          running: byId.get(entry.sessionId)?.running ?? this.sessions.get(entry.sessionId)?.running ?? false,
          hasChildren: parents.has(entry.sessionId),
        })),
      };
    } catch (error) {
      this.lastErrorStore.set(describe(error));
      return { entries: [], parentAvailable: false };
    }
  }

  /**
   * 替用户停掉一个后台任务（0.1.7 的 job/kill）；列表由 job/list 流自己刷新。
   * @returns 主机是否受理了这次停止（已经结束的任务也算受理）。
   */
  async killJob(sessionId: SessionId, jobId: string): Promise<boolean> {
    try {
      await jobKill(this.requireTransport(), sessionId, jobId);
      return true;
    } catch (error) {
      this.lastErrorStore.set(describe(error));
      return false;
    }
  }

  /** 正在观察输出的后台任务；任务详情页订阅它。 */
  get observedJobStore(): Store<ObservedJobOutput | undefined> {
    return this.ensureCoordinator().observedJobStore;
  }

  /** 任务详情页出现时打开 `job/follow`，离开时关掉（同一时间只观察一个）。 */
  observeJob(sessionId: SessionId, jobId: string): void {
    this.ensureCoordinator().observeJob(sessionId, jobId);
  }

  stopObservingJob(jobId?: string): void {
    this.coordinator?.stopObservingJob(jobId);
  }

  /**
   * 置顶 / 取消置顶。
   *
   * 0.1.7 的主机维护全局置顶集合：走 workspace/pinSession / unpinSession，应答就是落定后的
   * 集合，直接落库（其他端的改动由 workspace/follow 的 pinned 帧推来）。老主机没有这个概念，
   * 仍记在本机。
   */
  async setPinned(sessionId: SessionId, pinned: boolean): Promise<void> {
    if (!sessionListStore.pinsOwnedByHost) {
      sessionListStore.setPinned(sessionId, pinned);
      return;
    }
    try {
      const ids = await workspaceSetPinned(this.requireTransport(), sessionId, pinned);
      sessionListStore.applyHostPinned(ids);
    } catch (error) {
      this.lastErrorStore.set(describe(error));
    }
  }

  // —— 审批与提问 ————————————————————————————————————————————

  async respondApproval(approval: ApprovalRequested, outcome: ApprovalOutcome): Promise<void> {
    await this.settle(approval.eventId, { kind: 'result', value: outcome });
    this.sessions.get(approval.sessionId)?.setApproval(undefined);
    sessionListStore.clearAwaitingUser(approval.sessionId);
  }

  async respondQuestion(question: QuestionRequested, answers: QuestionAnswer[]): Promise<void> {
    const callId = question.callId;
    if (question.continued === true && callId !== undefined) {
      // continued 问题已经没有 waterfall 可回执：迟到回答走 userQuestions/answer（0.2.0）。
      try {
        if (await answerUserQuestion(this.requireTransport(), question.sessionId, callId, answers)) {
          this.sessions.get(question.sessionId)?.markQuestionReplied(callId);
        }
      } catch (error) {
        this.lastErrorStore.set(describe(error));
      }
      return;
    }
    await this.settle(question.eventId, { kind: 'result', value: questionAnswerPayload(answers) as unknown as JsonValue });
    this.sessions.get(question.sessionId)?.setQuestion(undefined);
    // 应答方收不到自己那份撤回帧：就地放掉认领与倒计时。
    this.coordinator?.retireLocally(question.eventId);
    sessionListStore.clearAwaitingUser(question.sessionId);
  }

  async cancelQuestion(question: QuestionRequested): Promise<void> {
    const callId = question.callId;
    if (question.continued === true && callId !== undefined) {
      // continued 问题没有请求可拒：关掉只是收起，输入框上方的入口能重新打开。
      this.sessions.get(question.sessionId)?.hideQuestion(callId);
      return;
    }
    await this.settle(question.eventId, { kind: 'next' });
    this.sessions.get(question.sessionId)?.setQuestion(undefined);
    this.coordinator?.retireLocally(question.eventId);
    sessionListStore.clearAwaitingUser(question.sessionId);
  }

  /** 用户开始作答或点了「慢慢回答」：限时提问停止倒计时，一直等到本端提交或取消。 */
  holdQuestion(question: QuestionRequested): void {
    this.coordinator?.holdQuestion(question);
  }

  /**
   * 不作答、只把弹层划走：实时问题在本地撤下（倒计时照走，到点仍会放行 agent），
   * continued 问题收起；两者都不会再自己弹出来，留给输入框上方的入口（对齐 Android dismissQuestion）。
   */
  dismissQuestion(question: QuestionRequested): void {
    const store = this.sessions.get(question.sessionId);
    if (store === undefined) return;
    if (question.callId !== undefined) store.hideQuestion(question.callId);
    if (question.continued !== true && store.pendingQuestion?.eventId === question.eventId) store.setQuestion(undefined);
  }

  private async settle(eventId: string | undefined, outcome: RemoteEventOutcome): Promise<void> {
    if (eventId === undefined) return;
    await this.coordinator?.settleRemoteEvent(eventId, outcome);
  }

  // —— 新建会话 ————————————————————————————————————————————

  /**
   * 新建会话：显式新建总是新建（dsh 0.2.1 起与 web `startSession` 一致，Agent 按当前预设定义）；
   * `reuseBlank` 只给新建页里切换工作区用，先复用该工作区下已有的空白会话（对齐 Mac f670941）。
   */
  async createSession(workspaceId?: WorkspaceId, reuseBlank = false): Promise<SessionId | undefined> {
    const workspace = workspaceId === undefined || !reuseBlank
      ? undefined
      : workspaceStore.workspaces.find(item => item.workspaceId === workspaceId);
    if (workspace !== undefined) {
      // 复用的空白会话必须「主机还认得出」：预设被删/损坏的空白会话每次都会以
      // agent-presets 失败，复用它等于把新建页做成发不出消息的死胡同
      // （对齐 Android BlankSessionReuse.canResumeBlankSession）。
      const archived = new Set(workspaceStore.archivedSessionIds);
      const reuse = reusableBlankSession(
        sessionListStore.sessions,
        workspace,
        archived,
        this.agentPresetsStore.get(),
      );
      if (reuse !== undefined) {
        this.open(reuse.sessionId);
        return reuse.sessionId;
      }
    }
    try {
      const value = await sessionCreate(this.requireTransport(), workspaceId);
      // 这里**不**等整表 session/list：那是全部会话（几千条、近 2 MB）的一次全量拉取，经加密
      // 隧道在真机上要 2.5～6 秒，新建页的转圈几乎全花在它上面。新会话会由主机的
      // `api-session/added` 实时补进名册；万一那一路没送到，再在后台补拉一次。
      this.open(value.sessionId);
      this.ensureInRoster(value.sessionId);
      return value.sessionId;
    } catch (error) {
      this.lastErrorStore.set(describe(error));
      return undefined;
    }
  }

  /**
   * 新建的会话应当很快经 `api-session/added` 出现在名册里；过一会儿还没有（$events 那一路
   * 正好在重连、丢了这一帧）就后台整表补拉一次，失败也不打扰用户——列表下次刷新会带回来。
   */
  private ensureInRoster(sessionId: SessionId): void {
    setTimeout(() => {
      if (sessionListStore.sessionsById.has(sessionId)) return;
      void this.refreshInternal().catch(() => undefined);
    }, ROSTER_UPSERT_GRACE_MS);
  }

  /**
   * 新建会话落在哪个工作区：先按 defaultNewSessionWorkspaceId；一个工作区、一个会话都没有时
   * 算首次使用，向主机要默认工作区（web `initializeDefaultWorkspace`，对齐 Mac 267bcde）。
   * 主机不再认为是首次、或调用失败时返回 undefined，交给工作区选择。
   */
  async resolveNewSessionWorkspaceId(): Promise<WorkspaceId | undefined> {
    const preferred = this.defaultNewSessionWorkspaceId();
    if (preferred !== undefined) return preferred;
    if (workspaceStore.workspaces.length > 0 || sessionListStore.sessions.length > 0) return undefined;
    const title = Strings.defaultWorkspaceTitle;
    try {
      const workspace = await workspaceInitializeDefault(this.requireTransport(), title, title);
      if (workspace === undefined) return undefined;
      workspaceStore.upsert(workspace);
      return workspace.workspaceId;
    } catch (error) {
      // 老主机没有这个方法：静默退回「无工作区」，别在每次新建时报错。
      if (!isMethodMissing(error)) this.lastErrorStore.set(Strings.defaultWorkspaceFailed);
      return undefined;
    }
  }

  /** 默认工作区：上一次真正开出新会话的那个，取不到才退回最近更新过的。 */
  defaultNewSessionWorkspaceId(): WorkspaceId | undefined {
    const remembered = readNewSessionWorkspace();
    if (remembered !== undefined && workspaceStore.workspaces.some(item => item.workspaceId === remembered)) {
      return remembered;
    }
    return this.recentWorkspaceId();
  }

  rememberNewSessionWorkspace(workspaceId?: WorkspaceId): void {
    writeNewSessionWorkspace(workspaceId);
  }

  private recentWorkspaceId(): WorkspaceId | undefined {
    const workspaces = workspaceStore.workspaces;
    if (workspaces.length === 0) return undefined;
    const byId = new Map(workspaces.map(item => [item.workspaceId, item]));
    let best: { id: WorkspaceId; at: number } | undefined;
    for (const summary of sessionListStore.sessions) {
      const workspace = workspaces.find(item => item.sessionIds.includes(summary.sessionId));
      if (workspace === undefined) continue;
      if (best === undefined || summary.updatedAt > best.at) best = { id: workspace.workspaceId, at: summary.updatedAt };
    }
    void byId;
    return best?.id ?? workspaces[0]?.workspaceId;
  }

  // —— 文件与图片 ————————————————————————————————————————————

  async workspaceFilePage(sessionId: SessionId, path: string, offset: number) {
    return workspaceFileRead(this.requireTransport(), sessionId, path, offset);
  }

  /** 图片附件：拿到 base64 后落成临时文件，Image 组件只吃本地路径。 */
  async attachmentImage(sessionId: SessionId, attachmentId: string): Promise<string | undefined> {
    const cached = this.imageCache.get(attachmentId);
    if (cached !== undefined) return cached;
    try {
      const value = await sessionAttachment(this.requireTransport(), sessionId, attachmentId);
      if (value.data.length === 0) return undefined;
      const filePath = writeTempImage(attachmentId, value.data);
      if (filePath === undefined) return undefined;
      this.imageCache.set(attachmentId, filePath);
      return filePath;
    } catch {
      return undefined;
    }
  }

  /**
   * 图片文件链接：分片读回工作区文件并落成临时文件，交给 Taro.previewImage。
   *
   * 与 Android SystemImageViewer.stageFile + workspaceFileBytes 同口径：图片绝不用文本渲染；
   * 每次只拉一片（2 MiB，等于主机默认 maxBytes），靠 eof 翻到读完，避免为了看一张图把整份
   * 文件（readAll 上限 32 MiB，base64 后更大）一次攥在手里。失败返回 undefined。
   */
  async workspaceImageTempPath(sessionId: SessionId, path: string): Promise<string | undefined> {
    // 扩展名只在文件名上找：`/tmp/v1.2/shot` 这种目录里带点的路径，在整条路径上找点
    // 会把 `2/shot` 当扩展名（与 model/imageFileType 的口径一致）。
    const ext = fileExtension(path).replace(/[^a-z0-9]/g, '');
    const filePath = wx.env.USER_DATA_PATH + '/img-' + hashString(path) + (ext.length > 0 ? '.' + ext : '.png');
    const transport = this.requireTransport();
    try {
      await copyWorkspaceFileChunked({
        chunkBytes: IMAGE_CHUNK_BYTES,
        limit: IMAGE_MAX_BYTES,
        fetch: (offset, length) => workspaceFileReadBytes(transport, sessionId, path, offset, length),
        write: (data, first) => {
          const fs = wx.getFileSystemManager();
          if (first) fs.writeFileSync(filePath, data, 'base64');
          else fs.appendFileSync(filePath, data, 'base64');
        },
      });
      return filePath;
    } catch {
      // 半截文件绝不能留：交给 previewImage 只会是一张打不开的破图
      //（对齐 Android 失败时删掉缓存文件的处理）。
      try {
        wx.getFileSystemManager().unlinkSync(filePath);
      } catch {
        // 还没写出任何一片时文件本来就不存在。
      }
      return undefined;
    }
  }

  sessionTitle(sessionId: SessionId): string {
    const store = this.sessions.get(sessionId);
    const summary = sessionListStore.sessions.find(item => item.sessionId === sessionId);
    // 名册里还没有这条会话（通知/深链直接进来的）：退回实时标题，再没有就是「未命名」——
    // 把一长串 sessionId 摆到顶栏上等于什么也没说（对齐 Android title 的 sessionUntitled 兜底）。
    if (summary === undefined) return store?.title || Strings.sessionUntitled;
    return sessionDisplayTitle(summary, store?.title);
  }

  /** 会话自己的标题（重命名预填用）：未命名为空串，不拿「未命名」或目录名去预填。 */
  sessionStoredTitle(sessionId: SessionId): string {
    const store = this.sessions.get(sessionId);
    const summary = sessionListStore.sessions.find(item => item.sessionId === sessionId);
    if (summary === undefined) return store?.title.trim() ?? '';
    return sessionStoredTitle(summary, store?.title);
  }
}

// —— 小工具 ————————————————————————————————————————————————

/** 新建会话后等 `api-session/added` 把它补进名册的宽限时间，过了还没有就后台整表补拉。 */
const ROSTER_UPSERT_GRACE_MS = 5000;

/** 图片分片大小：等于主机 readBytes 的默认上限 2 MiB。 */
const IMAGE_CHUNK_BYTES = 2 * 1024 * 1024;
/** 图片文件上限 64 MiB（对齐 Android SystemImageViewer.MAX_BYTES）。 */
const IMAGE_MAX_BYTES = 64 * 1024 * 1024;

const COMMAND_PATTERN = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/;

function isCommand(text: string): boolean {
  return COMMAND_PATTERN.test(text);
}

/** 给临时图片文件名用的一段稳定哈希：不同目录下的同名图片不能互相覆盖。 */
function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

function newRequestId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function timeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

const NEW_SESSION_WORKSPACE_KEY = 'dsh.newSessionWorkspace';

function readNewSessionWorkspace(): WorkspaceId | undefined {
  try {
    const value = wx.getStorageSync(NEW_SESSION_WORKSPACE_KEY);
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeNewSessionWorkspace(workspaceId?: WorkspaceId): void {
  try {
    if (workspaceId === undefined) wx.removeStorageSync(NEW_SESSION_WORKSPACE_KEY);
    else wx.setStorageSync(NEW_SESSION_WORKSPACE_KEY, workspaceId);
  } catch {
    // 落不下不影响主流程。
  }
}

/** 改动记录按「会话 + 公告 seq」寻址（同一轮后来的公告会取代先前的记录）。 */
function changesKey(address: TurnChangesAddress): string {
  return address.sessionId + '#' + String(address.seq);
}

/** 把 base64 图片写到 USER_DATA_PATH，返回本地路径。 */
function writeTempImage(attachmentId: string, base64: string): string | undefined {
  try {
    const path = wx.env.USER_DATA_PATH + '/att-' + attachmentId.replace(/[^A-Za-z0-9_-]/g, '_') + '.png';
    wx.getFileSystemManager().writeFile({
      filePath: path,
      data: base64,
      encoding: 'base64',
    });
    return path;
  } catch {
    return undefined;
  }
}

let singleton: AppModel | undefined;

export function getAppModel(): AppModel {
  if (singleton === undefined) singleton = new AppModel();
  return singleton;
}

export { Strings };

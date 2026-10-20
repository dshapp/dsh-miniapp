import React from 'react';
import { ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidHide, useDidShow } from '@tarojs/taro';
import { Strings, fmt } from '../../i18n/strings';
import { isImageFile } from '../../model/imageFileType';
import { toast } from '../../framework/req';
import { back, openPage, pageParams, pageRoutes } from '../../framework/page';
import { getAppModel } from '../../state/appModel';
import { useStore } from '../../state/store';
import type { SessionStore } from '../../state/sessionStore';
import {
  chatNodeAnchorSeq,
  chatNodeId,
  chatNodeRendersRow,
  chatNodeSearchText,
  decodeContentBlock,
} from '../../model/chatNode';
import type { ChatNode } from '../../model/chatNode';
import { TURN_RAIL_PROMPT_LIMIT, TURN_RAIL_RESPONSE_LIMIT } from '../../model/format';
import type { TurnRailItem } from '../../model/format';
import type { SessionId } from '../../model/types';
import { ActionMenu, anchorFromEvent } from '../../ui/actionMenu';
import type { ActionMenuAnchor, ActionMenuItem } from '../../ui/actionMenu';
import { getSystemInfo } from '../../framework/systemInfo';
import { ComposerBar } from '../../ui/composerBar';
import { EmptyState } from '../../ui/emptyState';
import { Icon } from '../../ui/icon';
import { MessageRow, RunningStatusRow } from '../../ui/messageRow';
import { NavBar, NavIconButton, NavLabel, NavSearchInput, NavTitle, useNavMetrics } from '../../ui/navBar';
import {
  ApprovalSheet,
  ContextSheet,
  FilePreviewSheet,
  ModelPickerSheet,
  QuestionSheet,
  SessionPanelSheet,
} from '../../ui/sheets';
import { PageShell } from '../../ui/pageShell';
import styles from './index.module.scss';

/*
 * 会话页：转写 + 轮次轨道 + 查找 + 面板。
 *
 * 移植自 Android ui/screen/ChatScreen.kt。小程序没有 LazyColumn 的 layoutInfo 与
 * interactionSource，滚动跟尾改用 ScrollView 的事件近似：
 * - 只有 scrollTop 已经贴底时，新到达的增量才自动跟下去（对齐 Android 的 canScrollForward）；
 * - 用户往上滚（deltaY < 0）就关掉跟尾，直到点「回到最新」或自己滚回底部；
 * - 初始落位把 scrollTop 顶到上限，等价于 scrollToItem(last, Int.MAX_VALUE)。
 */

/** 贴底判定容差：ScrollView 的 scrollHeight 与 scrollTop 常常差一两像素。 */
const BOTTOM_EPSILON = 24;

function sanitizeId(raw: string): string {
  // 小程序元素 id 首字符不能是数字，其余非字母数字统一换成下划线。
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, '_');
  return /^[0-9]/.test(cleaned) ? 'n' + cleaned : cleaned;
}

function clipText(text: string, limit: number): string {
  const normalized = text.split(/\s+/).filter(Boolean).join(' ');
  if (normalized.length <= limit) return normalized;
  return normalized.slice(0, limit - 1).trim() + '…';
}

/** 轮次轨道一行展示的预览：优先用户提问，没有就退回回复摘要（对齐 Android 的 preview 选择）。 */
function railPreview(item: TurnRailItem): string {
  const prompt = clipText(item.prompt, TURN_RAIL_PROMPT_LIMIT);
  if (prompt.length > 0) return prompt;
  const response = clipText(item.response, TURN_RAIL_RESPONSE_LIMIT);
  return response.length > 0 ? response : Strings.turns + ' ' + item.turn;
}

export default function ChatPage(): JSX.Element {
  const params = React.useMemo(() => pageParams(), []);
  const sessionId = params.sessionId ?? '';
  const model = getAppModel();
  // 顶栏高度：把「更多」菜单锚到右上角动作按钮下面（安卓是 DropdownMenu 锚在按钮上）。
  const { totalHeight: navHeight } = useNavMetrics();
  const store = React.useMemo<SessionStore>(() => model.ensureSession(sessionId), [model, sessionId]);

  const nodes = useStore(store.nodesStore);
  // 运行态单独订阅：输入框上方的状态条随它出现/消失；刚发出、主机还没开轮时也要亮。
  useStore(store.runningStore);
  useStore(store.pendingSubmissionsStore);
  const turnRail = useStore(store.turnRailStore);
  const hasMore = useStore(store.hasMoreStore);
  const loadingHistory = useStore(store.loadingHistoryStore);
  const historyLoaded = useStore(store.historyLoadedStore);
  const historyError = useStore(store.historyErrorStore);
  const queue = useStore(store.queueStore);
  const title = useStore(store.titleStore);
  // 文件路径按会话当前的工作目录解析（0.2.1 workingDirectory 投影），没有才退回原始 cwd。
  const workingDirectory = useStore(store.workingDirectoryStore);
  const originalCwd = useStore(store.cwdStore);
  const cwd = workingDirectory ?? originalCwd;
  const pendingApproval = useStore(store.pendingApprovalStore);
  // 弹层呈现的问题（0.2.0）：实时 waterfall 优先，否则是第一个没被收起的 continued 问题。
  const presentedQuestion = useStore(store.presentedQuestionStore);
  const subagentAddress = useStore(store.subagentAddressStore);
  const parentAvailable = useStore(store.parentAvailableStore);
  // 改动文件的公告是 observation-ignored 的：首次渲染早于公告落库的页脚靠这个修订标量重画。
  const deliverablesRevision = useStore(store.deliverablesRevisionStore);
  const referencedSessions = useStore(store.referencedSessionsStore);
  void deliverablesRevision;

  const [finding, setFinding] = React.useState(false);
  const [findQuery, setFindQuery] = React.useState('');
  const [activeHit, setActiveHit] = React.useState(0);
  // 清除只清文字、把光标留在框里（对齐 Android findFocus.requestFocus()）。
  const [findFocused, setFindFocused] = React.useState(false);
  const [showPanel, setShowPanel] = React.useState(false);
  const [showContext, setShowContext] = React.useState(false);
  const [showModel, setShowModel] = React.useState(false);
  // 轮次轨道默认收起：它是「需要时才展开」的导航，常驻会挤压正文（对齐 Android 顶栏菜单）。
  const [showRail, setShowRail] = React.useState(false);
  /** 文件预览落点：path 加它所属的会话（dsh-resource 跨会话地址自带会话）。 */
  const [preview, setPreview] = React.useState<{ path: string; sessionId: string } | undefined>(undefined);
  const [railBusy, setRailBusy] = React.useState<number | undefined>(undefined);
  const [railActiveTurn, setRailActiveTurn] = React.useState<number | undefined>(undefined);
  const [followTail, setFollowTail] = React.useState(true);
  const [atBottom, setAtBottom] = React.useState(true);
  const [scrollTop, setScrollTop] = React.useState(0);
  const scrollHeightRef = React.useRef(0);
  const viewportHeightRef = React.useRef(0);
  const settledInitial = React.useRef(false);

  // 操作错误（fork 失败、分页失败等）统一弹一次：安卓 ChatScreen 用 Snackbar 报
  // model.lastErrorMessage 并随即清空，这里同口径，避免聊天页里的失败静默无反馈。
  const lastError = useStore(model.lastErrorStore);
  React.useEffect(() => {
    if (lastError === undefined || lastError.length === 0) return;
    toast(lastError);
    model.lastErrorStore.set(undefined);
  }, [lastError, model]);

  /**
   * 文件链接落点：图片走图片查看器，其余进文本预览（对齐 Android ChatScreen.openFileLink）。
   * 图片读不回来只弹一条「无法打开这张图片」，不回落到文本预览——拿文本打开二进制
   * 只会看到乱码。
   */
  const openFileLink = React.useCallback((path: string, scopeSessionId: string, image = false): void => {
    // 图片语法写的落点（image）不看扩展名：附件对象没有扩展名（对齐 Android openFileLink）。
    if (!image && !isImageFile(path)) {
      setPreview({ path, sessionId: scopeSessionId });
      return;
    }
    void model.workspaceImageTempPath(scopeSessionId, path).then(localPath => {
      if (localPath === undefined) {
        toast(Strings.imageOpenFailed);
        return;
      }
      void Taro.previewImage({ urls: [localPath], current: localPath });
    });
  }, [model]);

  /**
   * 转写里的图片（用户发送的、助手回复的、工具结果里的）点开：交给微信原生图片预览，
   * 双指放大、拖动、左右切换同组图片都由微信负责。urls 是同组已取到的本地路径。
   */
  const openImage = React.useCallback((localPath: string, _name?: string, urls?: string[]): void => {
    const group = urls === undefined || urls.length === 0 ? [localPath] : urls;
    Taro.previewImage({ urls: group, current: localPath }).catch(() => toast(Strings.imageOpenFailed));
  }, []);

  // 进页 open、退页 close。标题不再写进微信导航栏：顶栏已经是我们自己画的。
  // 没有配对资料时 open 会同步抛错（建不了传输）：吞掉它改画提示，否则 effect 里的异常会让整页不再更新。
  const [openError, setOpenError] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    try {
      model.open(sessionId);
      setOpenError(undefined);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    }
    return () => {
      model.close(sessionId);
    };
  }, [model, sessionId]);

  // 转写容器高度：贴底判定要用它换算「底下还有多少」。
  const measureViewport = React.useCallback((): void => {
    const query = Taro.createSelectorQuery();
    query.select('#chat-scroll').boundingClientRect();
    query.exec(result => {
      const rect = (result as ({ height?: number } | null)[])[0];
      if (rect !== null && rect !== undefined && typeof rect.height === 'number' && rect.height > 0) {
        viewportHeightRef.current = rect.height;
      }
    });
  }, []);

  React.useEffect(() => {
    measureViewport();
    // 首次布局时 ScrollView 可能还没拿到高度，补测一次。
    const timer = setTimeout(measureViewport, 300);
    return () => clearTimeout(timer);
  }, [measureViewport]);

  useDidShow(() => {
    model.onForeground();
  });
  useDidHide(() => {
    // 退到后台就不再跟尾：回来时用户往往想接着看刚才那条。
    setFollowTail(false);
  });

  // 可见行：画不出的节点不占位，查找时只留命中行。
  const visibleNodes = React.useMemo(() => {
    const rows = nodes.filter(node => chatNodeRendersRow(node));
    const needle = findQuery.trim();
    if (!finding || needle.length === 0) return rows;
    const lowered = needle.toLowerCase();
    return rows.filter(node => chatNodeSearchText(node).toLowerCase().includes(lowered));
  }, [nodes, finding, findQuery]);

  // 已插队、主机还没在步骤边界取走的消息：画在转写尾部，被取走时同步消失。
  const pendingSteering = React.useMemo(
    () => queue.filter(item => item.placement === 'steering'),
    [queue],
  );

  const earlierRow = hasMore && historyLoaded && visibleNodes.length > 0 ? 1 : 0;
  // 没有可跳转的命中时，上一条/下一条置灰（对齐 Android 的 enabled = canStep）。
  const canStepFind = finding && findQuery.trim().length > 0 && visibleNodes.length > 0;

  // 查询一变就是一组新结果：光标回到第 1 条并滚过去（对齐 Android 的
  // LaunchedEffect(findQuery, finding) -> scrollToItem）。
  React.useEffect(() => {
    setActiveHit(0);
    if (!finding || findQuery.trim().length === 0 || visibleNodes.length === 0) return;
    setFollowTail(false);
    scrollToNodeId(chatNodeId(visibleNodes[0]));
    // 只在查询/查找态变化时定位一次，滚动本身不再反过来触发它。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findQuery, finding]);

  // 结果集缩小（继续打字、历史重载）时把光标夹回范围内。
  React.useEffect(() => {
    if (activeHit >= visibleNodes.length) setActiveHit(0);
  }, [activeHit, visibleNodes.length]);

  const lastContentHeight = React.useRef(0);

  const scrollToBottom = React.useCallback((): void => {
    setFollowTail(true);
    // 读真实的内容高与视口高，滚到「内容底 - 视口高」——比凭空加大数可靠，也不会因为
    // 累计溢出而越滚越偏（对齐 Android ChatScreen.kt:165-171 的 scrollToItem(last)）。
    const query = Taro.createSelectorQuery();
    query.select('#chat-scroll').boundingClientRect();
    query.select('#chat-inner').boundingClientRect();
    query.exec(raw => {
      const result = raw as ({ height?: number } | null)[];
      const container = result[0];
      const inner = result[1];
      if (container === null || inner === null) {
        // 首帧还没量到（元素尚未布局）：退回原来的增量法，下一帧的轮询会校正。
        setScrollTop(current => current + 100000);
        return;
      }
      const height = inner.height ?? 0;
      lastContentHeight.current = Math.max(lastContentHeight.current, height);
      setScrollTop(Math.max(0, height - (container.height ?? 0) + 1));
    });
  }, []);

  // 跟尾的兜底：流式回复只让正文长高、不新增节点，ScrollView 不会自己滚。安卓靠
  // listState.canScrollForward 在布局后判定（ChatScreen.kt:179-187）；小程序拿不到，
  // 改为周期性读一次内容高度，只要还在跟尾且内容变高了就贴回底部。
  React.useEffect(() => {
    if (!followTail) return undefined;
    const timer = setInterval(() => {
      const query = Taro.createSelectorQuery();
      query.select('#chat-inner').boundingClientRect();
      query.exec(raw => {
        const inner = (raw as ({ height?: number } | null)[])[0];
        if (inner === null) return;
        const height = inner.height ?? 0;
        if (height > lastContentHeight.current) {
          lastContentHeight.current = height;
          scrollToBottom();
        }
      });
    }, 400);
    return () => clearInterval(timer);
  }, [followTail, scrollToBottom]);

  const scrollToNodeId = React.useCallback((rawId: string): void => {
    const query = Taro.createSelectorQuery();
    query.select('#chat-scroll').boundingClientRect();
    query.select('#chat-row-' + sanitizeId(rawId)).boundingClientRect();
    query.select('#chat-scroll').scrollOffset();
    query.exec(raw => {
      const result = raw as ({ top?: number; scrollTop?: number } | null)[];
      const container = result[0];
      const target = result[1];
      const offset = result[2];
      if (container === null || target === null || offset === null) return;
      const delta = (target.top ?? 0) - (container.top ?? 0);
      setScrollTop(Math.max(0, (offset.scrollTop ?? 0) + delta));
      setFollowTail(false);
    });
  }, []);

  const scrollToNodeIndex = React.useCallback((index: number): void => {
    const node = visibleNodes[index];
    if (node !== undefined) scrollToNodeId(chatNodeId(node));
  }, [visibleNodes, scrollToNodeId]);

  // 初始落位：拿到基线后贴底一次。
  React.useEffect(() => {
    if (settledInitial.current) return;
    if (visibleNodes.length === 0 && pendingSteering.length === 0) return;
    settledInitial.current = true;
    scrollToBottom();
  }, [visibleNodes.length, pendingSteering.length, scrollToBottom]);

  // 跟尾：有新的节点或队列变化、并且用户没往上滚时贴回底部。
  React.useEffect(() => {
    if (!followTail || !settledInitial.current) return;
    scrollToBottom();
  }, [nodes, queue, followTail, scrollToBottom]);

  // 贴底就是最新一轮；否则沿用上一次跳转/滚动到的轮次。
  React.useEffect(() => {
    if (!atBottom || turnRail.length === 0) return;
    setRailActiveTurn(turnRail[turnRail.length - 1].turn);
  }, [atBottom, turnRail]);

  const stepFind = React.useCallback((delta: number): void => {
    const count = visibleNodes.length;
    if (!finding || findQuery.trim().length === 0 || count === 0) return;
    const next = ((activeHit + delta) % count + count) % count;
    setActiveHit(next);
    setFollowTail(false);
    scrollToNodeIndex(next + earlierRow);
  }, [activeHit, earlierRow, findQuery, finding, scrollToNodeIndex, visibleNodes.length]);

  // 清除命中后要保持焦点：微信对 focus 属性 true→false→true 往往合并不触发，
  // 改成给输入框换一个 key 让它重挂（对齐 Android ChatScreen.kt:317-320 的 requestFocus）。
  const [findInputNonce, setFindInputNonce] = React.useState(0);

  const exitFind = React.useCallback((): void => {
    setFinding(false);
    setFindFocused(false);
    setFindQuery('');
    setActiveHit(0);
  }, []);

  const openSession = React.useCallback((target: SessionId): void => {
    // 会话页之间用 redirect：小程序页面栈只有 10 层，会话互跳很容易撞上限。
    openPage(pageRoutes.CHAT, { sessionId: target }, true);
  }, []);

  const forkAtSeq = React.useCallback((seq: number): void => {
    void model.forkSession(sessionId, Math.trunc(seq)).then(created => {
      if (created !== undefined) openSession(created);
    });
  }, [model, openSession, sessionId]);

  /** 跳去所选轮次；更早的轮次还没载入时先往上分页（对齐 Android 的 jumpTarget）。 */
  const jumpToTurn = React.useCallback(async (item: TurnRailItem): Promise<void> => {
    if (railBusy !== undefined) return;
    // 跳历史轮次是明确的「往上读」，别再自动跟回底部。
    setFollowTail(false);
    setRailBusy(item.turn);
    try {
      let targetRow = item.promptRow;
      if (targetRow === undefined && item.seq !== undefined && store.hasMore) {
        await store.loadHistoryThrough(item.seq);
        await store.loadHistoryForPrompt(item.turn);
        const loaded = store.turnRail.find(entry => entry.turn === item.turn);
        targetRow = loaded === undefined ? undefined : loaded.promptRow;
      }
      const anchor = targetRow ?? item.anchorRow;
      if (anchor === undefined) return;
      scrollToNodeId(anchor);
      setRailActiveTurn(item.turn);
      // 选完就收起，行为与安卓的 DropdownMenuItem 一致（菜单选完即关）。
      setShowRail(false);
    } finally {
      setRailBusy(undefined);
    }
  }, [railBusy, scrollToNodeId, store]);

  // 行长按菜单与「更多」菜单改自绘锚定浮层（对齐 Android ChatScreen.kt:459-503 / :377-394 的
  // DropdownMenu + leadingIcon）。`wx.showActionSheet` 是系统底部面板、不支持图标，
  // 形态与安卓差得远，这里用 ui/actionMenu.tsx 自绘。
  const [rowMenu, setRowMenu] = React.useState<{ anchor: ActionMenuAnchor; node: ChatNode } | undefined>(undefined);
  const [moreMenu, setMoreMenu] = React.useState<ActionMenuAnchor | undefined>(undefined);

  const rowMenuItems = React.useMemo((): ActionMenuItem[] => {
    if (rowMenu === undefined) return [];
    const items: ActionMenuItem[] = [];
    // 正文为空（纯工具行）时不给复制项，与安卓 copyable 判定一致。
    if (chatNodeSearchText(rowMenu.node).trim().length > 0) {
      items.push({ key: 'copy', label: Strings.copy, icon: 'copy' });
    }
    items.push({ key: 'fork', label: Strings.forkHere, icon: 'git-fork' });
    return items;
  }, [rowMenu]);

  const moreMenuItems = React.useMemo((): ActionMenuItem[] => [
    { key: 'find', label: Strings.findInChat, icon: 'search' },
    { key: 'panel', label: Strings.panel, icon: 'info' },
  ], []);

  const showRowMenu = React.useCallback((node: ChatNode, anchor: ActionMenuAnchor): void => {
    setRowMenu({ anchor, node });
  }, []);

  const selectRowMenu = React.useCallback((key: string): void => {
    if (rowMenu === undefined) return;
    const node = rowMenu.node;
    setRowMenu(undefined);
    if (key === 'copy') {
      wx.setClipboardData({ data: chatNodeSearchText(node) });
      return;
    }
    forkAtSeq(chatNodeAnchorSeq(node));
  }, [forkAtSeq, rowMenu]);

  const selectMoreMenu = React.useCallback((key: string): void => {
    setMoreMenu(undefined);
    if (key === 'find') {
      setFinding(true);
      setFindFocused(true);
      // 查找期间不再跟随流式输出：读者在逐条看命中，被拽回底部会丢掉刚跳到的位置。
      setFollowTail(false);
      return;
    }
    setShowPanel(true);
  }, []);

  const rows: React.ReactNode[] = [];
  if (earlierRow === 1) {
    rows.push(
      <View key='earlier' className={styles.earlierRow} onClick={() => { void store.loadEarlier(); }}>
        {loadingHistory
          ? <Icon name='loader-circle' spin className={styles.earlierLoading} />
          : <Text className={styles.earlierText}>{Strings.loadEarlier}</Text>}
      </View>,
    );
  }
  visibleNodes.forEach((node, index) => {
    const active = finding && findQuery.trim().length > 0 && index === activeHit;
    rows.push(
      <View
        key={chatNodeId(node)}
        id={'chat-row-' + sanitizeId(chatNodeId(node))}
        className={styles.row + (active ? ' ' + styles.rowActive : '')}
        onLongPress={event => {
          // 长按弹行菜单时给一次轻震（对齐 Android 的触觉反馈）。
          try {
            wx.vibrateShort({ type: 'light' });
          } catch {
            // 忽略不支持震动的环境。
          }
          showRowMenu(node, anchorFromEvent(event));
        }}
      >
        <MessageRow
          node={node}
          sessionId={sessionId}
          cwd={cwd}
          findQuery={finding && findQuery.trim().length > 0 ? findQuery : ''}
          findActive={active}
          onOpenFile={path => openFileLink(path, sessionId)}
          onOpenFileLink={target => openFileLink(target.path, target.sessionId ?? sessionId, target.image === true)}
          referencedSessions={referencedSessions}
          onOpenSession={openSession}
          onFork={seq => forkAtSeq(seq)}
          changesAddress={turn => model.changesAddressForTurn(sessionId, turn)}
          loadTurnChanges={address => model.loadTurnChanges(address)}
          loadTurnChangesDiff={(address, index) => model.loadTurnChangesDiff(address, index)}
          fileMentions={node.kind === 'assistant'
            ? store.closingMentions(node.step.turn, node.step.step, node.step.status === 'running')
            : undefined}
          resolveImage={(attachmentId, sid) => model.attachmentImage(sid, attachmentId)}
          // 过程折叠的展开态归 store：展开后这一轮的思考/工具行会真的回到转写里
          // （对齐 Android store.isTurnProcessExpanded / setTurnProcessExpanded）。
          turnProcessExpanded={spec => store.expandedProcessStore(spec)}
          onToggleTurnProcess={spec => store.setTurnProcessExpanded(spec, !store.isTurnProcessExpanded(spec))}
          onOpenImage={openImage}
        />
      </View>,
    );
  });
  pendingSteering.forEach(item => {
    const steeringNode: ChatNode = {
      kind: 'steering',
      seq: store.lastSeq,
      time: 0,
      messageId: item.id,
      content: item.content.map(decodeContentBlock),
    };
    rows.push(
      <View key={'pending-steer:' + item.id} className={styles.row}>
        <MessageRow
          node={steeringNode}
          sessionId={sessionId}
          cwd={cwd}
          onOpenFile={path => openFileLink(path, sessionId)}
          onOpenFileLink={target => openFileLink(target.path, target.sessionId ?? sessionId, target.image === true)}
          referencedSessions={referencedSessions}
          onOpenSession={openSession}
          // 插队消息带的图也要能显示、能点开（与转写里的用户气泡同一条通路）。
          resolveImage={(attachmentId, sid) => model.attachmentImage(sid, attachmentId)}
          onOpenImage={openImage}
        />
      </View>,
    );
  });

  // 运行状态条（查找态不画）：不进转写，见下方输入框正上方的那条。
  const runningStatus = finding ? undefined : store.runningStatus;

  const emptyByFind = finding && findQuery.trim().length > 0 && visibleNodes.length === 0 && pendingSteering.length === 0;
  const transcriptEmpty = nodes.length === 0 && pendingSteering.length === 0;
  const showEmptyChat = transcriptEmpty && historyError === undefined && historyLoaded && !loadingHistory;
  const showHistoryLoading = transcriptEmpty && historyError === undefined && !showEmptyChat && openError === undefined;

  return (
    <PageShell>
      <View className={styles.page}>
        {/* 顶栏对齐 Android ChatScreen 的 TopAppBar：
            普通态 = 返回 + 会话名 + 轮次 / 更多；
            查找态 = 返回 + 标题位变一行输入 + 第几条/共几条 + 上一条 / 下一条 + 清除。
            「上一条 / 下一条」没命中时置灰但保留槽位，数字宽度变化时按钮不会左右挪。 */}
        <NavBar
          mode='flow'
          left={
            <NavIconButton name='arrow-left' onClick={() => { if (finding) exitFind(); else back(); }} />
          }
          title={
            finding ? (
              <NavSearchInput
                key={findInputNonce}
                value={findQuery}
                focus={findFocused}
                placeholder={Strings.findInChat}
                onInput={value => {
                  setFindQuery(value);
                  // 查询一变光标就回到第 1 条（对齐 Android ChatScreen.kt:218-223 的 onValueChange）。
                  setActiveHit(0);
                }}
              />
            ) : (
              <NavTitle text={title.length > 0 ? title : model.sessionTitle(sessionId)} />
            )
          }
          actions={
            finding ? (
              <React.Fragment>
                {findQuery.trim().length === 0 ? null : (
                  <NavLabel
                    text={visibleNodes.length === 0 ? '0/0' : fmt(Strings.findCount, activeHit + 1, visibleNodes.length)}
                  />
                )}
                <NavIconButton
                  name='arrow-up'
                  disabled={!canStepFind}
                  ariaLabel={Strings.findPrevious}
                  onClick={() => stepFind(-1)}
                />
                <NavIconButton
                  name='arrow-down'
                  disabled={!canStepFind}
                  ariaLabel={Strings.findNext}
                  onClick={() => stepFind(1)}
                />
                {findQuery.length === 0 ? null : (
                  <NavIconButton
                    name='x'
                    ariaLabel={Strings.close}
                    onClick={() => {
                      setFindQuery('');
                      setActiveHit(0);
                      setFindFocused(true);
                      setFindInputNonce(value => value + 1);
                    }}
                  />
                )}
              </React.Fragment>
            ) : (
              <React.Fragment>
                <NavIconButton
                  name='list-ordered'
                  disabled={turnRail.length === 0}
                  ariaLabel={Strings.turns}
                  onClick={() => setShowRail(current => !current)}
                />
                <NavIconButton
                  name='ellipsis-vertical'
                  ariaLabel={Strings.more}
                  onClick={() => setMoreMenu({ x: getSystemInfo().windowWidth ?? 375, y: navHeight })}
                />
              </React.Fragment>
            )
          }
        />

        {subagentAddress === undefined ? null : (
          <View className={styles.subagentBar}>
            <Text className={styles.subagentText}>
              {subagentAddress.mode === 'continuable' ? Strings.subagentComposer : Strings.subagentReadOnly}
            </Text>
            {parentAvailable ? (
              <Text className={styles.subagentBack} onClick={() => openSession(subagentAddress.parentSessionId)}>
                {Strings.backToParent}
              </Text>
            ) : null}
          </View>
        )}


        <View className={styles.transcriptWrap}>
          <ScrollView
            id='chat-scroll'
            scrollY
            className={styles.transcript}
            scrollTop={scrollTop}
            scrollWithAnimation={false}
            onScroll={event => {
              const detail = event.detail as { scrollTop: number; scrollHeight: number; deltaY: number };
              scrollHeightRef.current = detail.scrollHeight;
              const distance = detail.scrollHeight - detail.scrollTop - viewportHeightRef.current;
              const bottom = distance <= BOTTOM_EPSILON;
              setAtBottom(bottom);
              // 手一往上划就停止跟尾；滚回底部再恢复（对齐 Android 的手势判定）。
              if (detail.deltaY < 0 && !bottom) setFollowTail(false);
              else if (bottom) setFollowTail(true);
              // 滚到最上面就自动拉更早的历史（对齐 Android 顶部哨兵 earlier）。
              // 初始落位之前不要触发：那时 scrollTop 可能短暂为 0，会误拉一页历史
              // （对齐 Android ChatScreen.kt:432-446 的 earlier 哨兵条件）。
              if (detail.scrollTop <= 8 && store.hasMore && !loadingHistory && historyLoaded && settledInitial.current) {
                void store.loadEarlier();
              }
            }}
            onScrollToLower={() => setFollowTail(true)}
          >
            <View className={styles.transcriptInner} id='chat-inner'>
            {rows}
            {emptyByFind ? <EmptyState name='search-x' title={Strings.findNoResults} description={findQuery} /> : null}
            {showHistoryLoading ? (
              <View className={styles.center}>
                <Icon name='loader-circle' spin className={styles.loadingGlyph} />
              </View>
            ) : null}
            {historyError !== undefined && transcriptEmpty ? (
              <View className={styles.center}>
                <Icon name='cloud-off' className={styles.loadingGlyph} />
                <Text className={styles.emptyTitle}>{Strings.historyUnavailable}</Text>
                <Text className={styles.emptyBody}>{historyError.message}</Text>
                <Text className={styles.retry} onClick={() => { void store.retryHistory(); }}>{Strings.retry}</Text>
              </View>
            ) : null}
            {showEmptyChat && openError === undefined ? (
              <EmptyState name='message-circle' title={Strings.emptyChat} description={Strings.emptyChatHint} />
            ) : null}
            {openError !== undefined && transcriptEmpty ? (
              <EmptyState
                name='cloud-off'
                title={Strings.chatNotPaired}
                description={Strings.chatNotPairedHint}
                actionText={Strings.goBack}
                onAction={() => back()}
              />
            ) : null}
            </View>
          </ScrollView>

          {/*
            轮次导航：安卓是顶栏的 DropdownMenu（ChatScreen.kt:324-374）。小程序没有锚定下拉，
            但也不能像以前那样把 132px 的轨道栏常驻在正文右侧（会压缩转写宽度）。这里做成
            从顶栏按钮唤出的浮层菜单：盖在正文之上、选完即关，正文始终占满整宽。
          */}
          {showRail && turnRail.length > 0 ? (
            <View className={styles.railOverlay} onClick={() => setShowRail(false)}>
              <ScrollView
                scrollY
                className={styles.rail}
                id='chat-rail'
                onClick={event => event.stopPropagation()}
              >
                {turnRail.map(item => (
                  <View
                    key={item.turn}
                    className={
                      styles.railRow
                      + (item.turn === railActiveTurn ? ' ' + styles.railRowActive : '')
                      + (railBusy !== undefined ? ' ' + styles.railRowBusy : '')
                    }
                    onClick={() => { void jumpToTurn(item); }}
                  >
                    <Icon
                      name={item.turn === railBusy ? 'loader-circle' : item.turn === railActiveTurn ? 'check' : 'circle'}
                      spin={item.turn === railBusy}
                      className={styles.railGlyph}
                    />
                    <Text className={styles.railText}>{item.turn + ' · ' + railPreview(item)}</Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* 「回到最新」：对齐 Android SmallFloatingActionButton 的 BottomEnd + 16dp 内边距。 */}
          {!atBottom && visibleNodes.length > 0 ? (
            <View className={styles.toBottom} onClick={scrollToBottom}>
              <Icon name='arrow-down' className={styles.toBottomGlyph} />
            </View>
          ) : null}
        </View>

        {/*
          运行状态条（对齐 Mac RunningStatusRow）：固定在输入框正上方、滚动区之外，不随记录滚动。
          有没有轮次在跑都占同一高度，出现/消失不会推动记录，也不会盖住最后一行。
        */}
        <View className={styles.runningStatusBar}>
          <View className={styles.runningStatusInner}>
            {runningStatus === undefined ? null : (
              <RunningStatusRow toolName={runningStatus.toolName} startedAt={runningStatus.startedAt} />
            )}
          </View>
        </View>

        <ComposerBar
          sessionId={sessionId}
          onSubmitted={() => { setFollowTail(true); scrollToBottom(); }}
          onOpenContext={() => setShowContext(true)}
          onOpenModel={() => setShowModel(true)}
        />

        <ActionMenu anchor={rowMenu?.anchor} items={rowMenuItems} onSelect={selectRowMenu} onClose={() => setRowMenu(undefined)} />
        <ActionMenu anchor={moreMenu} items={moreMenuItems} onSelect={selectMoreMenu} onClose={() => setMoreMenu(undefined)} width={180} />

        <SessionPanelSheet
          open={showPanel}
          sessionId={sessionId}
          onClose={() => setShowPanel(false)}
          onOpenSession={openSession}
          onOpenFile={path => { setShowPanel(false); openFileLink(path, sessionId); }}
          onOpenOnHost={path => { void model.openOnHost(path); }}
        />
        <ContextSheet open={showContext} sessionId={sessionId} onClose={() => setShowContext(false)} />
        <ModelPickerSheet open={showModel} sessionId={sessionId} onClose={() => setShowModel(false)} />
        <FilePreviewSheet
          open={preview !== undefined}
          sessionId={preview?.sessionId ?? sessionId}
          path={preview?.path}
          onClose={() => setPreview(undefined)}
        />
        {pendingApproval === undefined ? null : (
          <ApprovalSheet open approval={pendingApproval} onClose={() => store.setApproval(undefined)} />
        )}
        {presentedQuestion === undefined ? null : (
          <QuestionSheet open question={presentedQuestion} onClose={() => model.dismissQuestion(presentedQuestion)} />
        )}
      </View>
    </PageShell>
  );
}


import React from 'react';
import { Text, View } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro';
import { Strings } from '../../i18n/strings';
import { openPage, pageRoutes } from '../../framework/page';

import { ActionMenu, anchorFromEvent } from '../../ui/actionMenu';
import type { ActionMenuAnchor, ActionMenuItem } from '../../ui/actionMenu';
import { EditDialog } from '../../ui/editDialog';
import { EmptyState } from '../../ui/emptyState';
import { Icon, type LucideIconName } from '../../ui/icon';
import { NavBar, NavIconButton, NavSearchInput, NavTitle, useNavMetrics } from '../../ui/navBar';
import { Onboarding } from '../../ui/onboarding';
import { connectionStore, connectionTone, type Connection } from '../../state/connection';
import { getSystemInfo } from '../../framework/systemInfo';
import { getAppModel } from '../../state/appModel';
import { sessionListStore, workspaceStore } from '../../state/stores';
import { readStorage, Store, useStore, useSubscribed, writeStorage } from '../../state/store';
import {
  deriveSessionSearchResults,
  relativeTime,
  resolveSessionRowTrailing,
  sanitizeSearchQuery,
  sessionAwaitingBadge,
  sessionListTitle,
  SESSION_SEARCH_RESULT_LIMIT,
} from '../../model/format';
import type { SessionId, SessionSummary, WorkspaceId } from '../../model/types';
import { listSessionsVisible } from '../../model/archivedSessions';
import { PageShell } from '../../ui/pageShell';
import styles from './index.module.scss';

const PAGE_SIZE = 60;
const GROUP_BY_KEY = 'dsh.listGroupBy';
const ORDER_BY_KEY = 'dsh.listOrderBy';

interface SessionGroup {
  id: string;
  title: string;
  sessions: SessionSummary[];
  /** 只有真实工作区分组才带 id，也只有它们能换位。 */
  workspaceId?: WorkspaceId;
}

type GroupBy = 'workspace' | 'flat';
type OrderBy = 'updated' | 'status' | 'manual';

/** 会话 store 还没建起来时的占位标题源：避免在行组件里做条件 hook。 */
const EMPTY_TITLE_STORE = new Store<string>('');

/**
 * 一行会话。
 *
 * 单独成组件只为订阅这一个会话的实时标题：主机把 title 投影推到 `titleStore` 时，
 * 行上的名字要立刻跟着变，而不是等下一次会话名册刷新（对齐 Android 的
 * `titleOf(model, summary) = sessionDisplayTitle(summary, model.sessions[id]?.title)`）。
 */
function SessionRow(props: {
  summary: SessionSummary;
  icon: { name: LucideIconName; spin?: boolean; className: string };
  trailing: ReturnType<typeof resolveSessionRowTrailing>;
  onOpen: () => void;
  onLongPress: (event: unknown) => void;
}): JSX.Element {
  const sessionStore = getAppModel().store(props.summary.sessionId);
  const liveTitle = useStore(sessionStore === undefined ? EMPTY_TITLE_STORE : sessionStore.titleStore);
  const title = sessionListTitle(props.summary, liveTitle.length > 0 ? liveTitle : undefined);
  return (
    <View
      className={styles.row}
      onClick={props.onOpen}
      onLongPress={event => {
        // 长按给一次轻震（对齐 Android combinedClickable 的触觉反馈）
        try {
          wx.vibrateShort({ type: 'light' });
        } catch {
          // 不支持震动的环境忽略。
        }
        props.onLongPress(event);
      }}
    >
      <Icon name={props.icon.name} spin={props.icon.spin} className={props.icon.className} />
      <Text className={styles.rowTitle}>{title}</Text>
      {props.trailing.kind === 'awaitingUser' ? (
        <Text className={styles.badge}>{sessionAwaitingBadge(props.trailing.awaiting)}</Text>
      ) : props.trailing.kind === 'draft' ? (
        <Text className={styles.badge}>{Strings.sessionHasDraft}</Text>
      ) : props.trailing.kind === 'time' ? (
        <Text className={styles.trailing}>{relativeTime(props.trailing.updatedAt)}</Text>
      ) : null}
    </View>
  );
}

/**
 * 行首状态字形，优先级与 Android StatusGlyph 完全一致：
 * 正在跑 > 等我审批/回答 > 未读错误 > 已置顶 > 普通会话。
 */
function iconFor(summary: SessionSummary, awaiting: boolean, errored: boolean, pinned: boolean): {
  name: LucideIconName;
  spin?: boolean;
  className: string;
} {
  if (summary.running) return { name: 'loader-circle', spin: true, className: styles.glyph + ' ' + styles.glyphRunning };
  if (awaiting) return { name: 'hand', className: styles.glyph + ' ' + styles.glyphAwaiting };
  if (errored) return { name: 'circle-alert', className: styles.glyph + ' ' + styles.glyphError };
  if (pinned) return { name: 'pin', className: styles.glyph + ' ' + styles.glyphPinned };
  return { name: 'message-circle', className: styles.glyph };
}

/**
 * 会话列表：搜索 + 可折叠分组 + 视图菜单（分组/排序）。
 *
 * 与 Android 的 SessionListScreen 同一口径：空白会话与 origin=subagent 的会话不进列表，
 * 行上只有「点击进入」与「长按菜单」两种手势，左滑不承载任何动作。
 * 小程序端把 Android 的拖拽换位改成了长按后选择落点（原生拖拽在小程序里体验很差），
 * 落点语义与主机 workspace/insertBefore 完全一致。
 */
export default function SessionListPage(): JSX.Element {
  const listState = useStore(sessionListStore.sessionsState);
  const workspaces = useStore(workspaceStore.workspacesStore);
  const archivedIds = useStore(workspaceStore.archivedSessionIdsStore);
  const listArchivedIds = useStore(sessionListStore.archivedSessionIdsStore);
  const awaitingKinds = useStore(sessionListStore.awaitingUserKindsStore);
  const draftIds = useStore(sessionListStore.draftSessionIdsStore);
  const pinnedIds = useStore(sessionListStore.pinnedSessionOrderStore);
  const awaitingUserIds = useStore(sessionListStore.awaitingUserSessionIdsStore);
  const connection = useStore(connectionStore);
  const search = useStore(getAppModel().searchStore);
  // 清除只清文字、把光标留在框里；退出搜索交给左上角返回（对齐 Android 的 TopAppBar）。
  const [searchFocused, setSearchFocused] = React.useState(false);
  const erroredSessionIds = useStore(getAppModel().erroredSessionIdsStore);
  const profilesState = useSubscribed(getAppModel().profiles);
  const profileName = profilesState.profiles.find(profile => profile.id === profilesState.currentId)?.name;

  const [query, setQuery] = React.useState('');
  const [finding, setFinding] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState<string[]>([]);
  const [pages, setPages] = React.useState<Record<string, number>>({});
  // 视图选项是纯本机偏好，落盘后下次进来保持原样（与 Android persistView 同口径）。
  const [groupBy, setGroupBy] = React.useState<GroupBy>(() => (readStorage(GROUP_BY_KEY) === 'flat' ? 'flat' : 'workspace'));
  const [orderBy, setOrderBy] = React.useState<OrderBy>(() => {
    const stored = readStorage(ORDER_BY_KEY);
    return stored === 'status' || stored === 'manual' ? stored : 'updated';
  });

  React.useEffect(() => {
    writeStorage(GROUP_BY_KEY, groupBy);
  }, [groupBy]);

  React.useEffect(() => {
    writeStorage(ORDER_BY_KEY, orderBy);
  }, [orderBy]);

  const model = getAppModel();
  // 顶栏高度：把视图选项菜单锚到右上角动作按钮下面（安卓是 DropdownMenu 锚在按钮上）。
  const { totalHeight: navHeight } = useNavMetrics();

  useDidShow(() => {
    model.onForeground();
  });

  usePullDownRefresh(async () => {
    await model.pullToRefresh();
    Taro.stopPullDownRefresh();
  });

  // 边打边搜：本地标题匹配即时生效，主机内容搜索按 250ms 防抖发出。
  const normalizedQuery = query.trim();
  React.useEffect(() => {
    const timer = setTimeout(() => model.search(normalizedQuery), 250);
    return () => clearTimeout(timer);
  }, [normalizedQuery, model]);

  // 归档这一道闸加在渲染口径里，而不是靠归档时把行从名册摘掉：主机 \`session/list\`
  // 会把已归档的会话带回来，只摘行的话每次刷新都会重现一次（对齐 Android listSessionsVisible）。
  // 两个 store 的归档集合取并集，与归档页同源。
  const listed = React.useMemo(
    () => listSessionsVisible(listState, new Set([...archivedIds, ...listArchivedIds])),
    [listState, archivedIds, listArchivedIds],
  );

  const erroredIds = new Set(erroredSessionIds);
  const workspaceTitles = React.useMemo(() => workspaceStore.bySessionMap(), [workspaces]);
  const searching = finding && normalizedQuery.length > 0;
  // 主机命中只认当前查询：换了查询词，旧命中立刻丢掉并视为还在等（防抖 + 请求期间）。
  const searchPending = search.query !== normalizedQuery;

  const searchRows = React.useMemo(() => {
    if (!searching) return { sessions: [] as SessionSummary[], hasMore: false };
    return deriveSessionSearchResults(
      listed,
      workspaceTitles,
      id => model.store(id)?.title,
      normalizedQuery,
      searchPending ? { items: [], hasMore: false } : search,
    );
  }, [searching, normalizedQuery, listed, search, searchPending, workspaceTitles, model]);

  const ordered = React.useCallback(
    (items: SessionSummary[]): SessionSummary[] => {
      if (orderBy === 'manual') return sessionListStore.manualOrder(items);
      if (orderBy === 'status') return sessionListStore.statusOrder(items, erroredIds);
      return items.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    },
    [orderBy, erroredIds],
  );

  const groups: SessionGroup[] = React.useMemo(() => {
    if (searching) return [];
    const result: SessionGroup[] = [];
    const pinned = sessionListStore.pinnedOrder(listed);
    if (pinned.length > 0) result.push({ id: 'pinned', title: Strings.pinned, sessions: pinned });
    const pinnedSet = new Set(pinnedIds);
    const rest = listed.filter(summary => !pinnedSet.has(summary.sessionId));
    if (groupBy === 'flat') {
      result.push({ id: 'all', title: Strings.allSessions, sessions: ordered(rest) });
      return result;
    }
    const owner = new Map<SessionId, WorkspaceId>();
    for (const workspace of workspaces) {
      for (const id of workspace.sessionIds) owner.set(id, workspace.workspaceId);
    }
    const grouped = new Map<WorkspaceId, SessionSummary[]>();
    const loose: SessionSummary[] = [];
    for (const summary of rest) {
      const id = owner.get(summary.sessionId);
      if (id === undefined) loose.push(summary);
      else grouped.set(id, [...(grouped.get(id) ?? []), summary]);
    }
    for (const workspace of workspaces) {
      const items = grouped.get(workspace.workspaceId);
      if (items === undefined || items.length === 0) continue;
      result.push({
        id: workspace.workspaceId,
        title: workspace.title,
        sessions: ordered(items),
        workspaceId: workspace.workspaceId,
      });
    }
    if (loose.length > 0) result.push({ id: 'loose', title: Strings.ungrouped, sessions: ordered(loose) });
    return result;
  }, [searching, listed, pinnedIds, groupBy, workspaces, ordered]);

  const archivedSet = new Set(archivedIds);

  const openSession = React.useCallback((sessionId: SessionId) => {
    openPage(pageRoutes.CHAT, { sessionId });
  }, []);

  // 行长按菜单与视图菜单改自绘锚定浮层（对齐 Android SessionListScreen 的 DropdownMenu +
  // leadingIcon/勾选态）；wx.showActionSheet 是底部系统面板、无图标也无选中态。
  const [rowMenu, setRowMenu] = React.useState<{ anchor: ActionMenuAnchor; summary: SessionSummary } | undefined>(undefined);
  const [viewMenu, setViewMenu] = React.useState<ActionMenuAnchor | undefined>(undefined);
  const [renameTarget, setRenameTarget] = React.useState<SessionSummary | undefined>(undefined);

  const rowMenuItems = React.useMemo((): ActionMenuItem[] => {
    if (rowMenu === undefined) return [];
    const pinned = pinnedIds.includes(rowMenu.summary.sessionId);
    return [
      { key: 'fork', label: Strings.fork, icon: 'git-fork' },
      { key: 'pin', label: pinned ? Strings.unpin : Strings.pin, icon: 'pin' },
      { key: 'rename', label: Strings.rename, icon: 'pencil' },
      { key: 'archive', label: Strings.archive, icon: 'archive' },
    ];
  }, [pinnedIds, rowMenu]);

  const selectRowMenu = React.useCallback((key: string): void => {
    if (rowMenu === undefined) return;
    const summary = rowMenu.summary;
    setRowMenu(undefined);
    if (key === 'fork') {
      void model.forkSession(summary.sessionId).then(created => {
        if (created !== undefined) openSession(created);
      });
      return;
    }
    if (key === 'pin') {
      void model.setPinned(summary.sessionId, !pinnedIds.includes(summary.sessionId));
      return;
    }
    if (key === 'rename') {
      setRenameTarget(summary);
      return;
    }
    void model.archiveSession(summary.sessionId);
  }, [model, openSession, pinnedIds, rowMenu]);

  const [groupMenu, setGroupMenu] = React.useState<{ anchor: ActionMenuAnchor; group: SessionGroup } | undefined>(undefined);

  const groupMenuItems = React.useMemo((): ActionMenuItem[] => {
    if (groupMenu === undefined || groupMenu.group.workspaceId === undefined) return [];
    const others = workspaces.filter(item => item.workspaceId !== groupMenu.group.workspaceId);
    return [
      { key: 'end', label: Strings.moveWorkspaceBefore + Strings.listEnd, icon: 'arrow-down' },
      ...others.map(item => ({ key: 'ws:' + item.workspaceId, label: item.title, icon: 'folder' as const })),
    ];
  }, [groupMenu, workspaces]);

  const selectGroupMenu = React.useCallback((key: string): void => {
    if (groupMenu === undefined || groupMenu.group.workspaceId === undefined) return;
    const workspaceId = groupMenu.group.workspaceId;
    setGroupMenu(undefined);
    if (key === 'end') {
      void model.moveWorkspace(workspaceId, undefined);
      return;
    }
    if (key.startsWith('ws:')) void model.moveWorkspace(workspaceId, key.slice(3) as WorkspaceId);
  }, [groupMenu, model]);

  // 归档入口不进这个菜单：它固定在这一列的底部（对齐 Android/Mac 侧栏），
  // 折进视图选项菜单会让人以为归档是一种「视图」。
  const viewMenuItems = React.useMemo((): ActionMenuItem[] => [
    { key: 'group-workspace', label: Strings.groupByWorkspace, checked: groupBy === 'workspace' },
    { key: 'group-flat', label: Strings.groupByFlat, checked: groupBy === 'flat' },
    { key: 'order-updated', label: Strings.orderUpdated, checked: orderBy === 'updated' },
    { key: 'order-status', label: Strings.orderStatus, checked: orderBy === 'status' },
    { key: 'order-manual', label: Strings.orderManual, checked: orderBy === 'manual' },
  ], [groupBy, orderBy]);

  const selectViewMenu = React.useCallback((key: string): void => {
    setViewMenu(undefined);
    if (key === 'group-workspace') setGroupBy('workspace');
    else if (key === 'group-flat') setGroupBy('flat');
    else if (key === 'order-updated') setOrderBy('updated');
    else if (key === 'order-status') setOrderBy('status');
    else if (key === 'order-manual') setOrderBy('manual');
  }, []);

  const toggleGroup = React.useCallback((id: string) => {
    setCollapsed(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]));
  }, []);

  useReachBottom(() => {
    // 滚到底自动翻一页：比让用户去点「再显示 N 个」顺手，按钮仍然保留给分组很短的情况。
    setPages(current => {
      const next: Record<string, number> = { ...current };
      for (const group of groups) {
        const limit = PAGE_SIZE * (current[group.id] ?? 1);
        if (limit < group.sessions.length) next[group.id] = (current[group.id] ?? 1) + 1;
      }
      return next;
    });
  });

  const rows: React.ReactNode[] = [];
  if (searching) {
    rows.push(
      <View key='search-header' className={styles.groupHeader}>
        <Text className={styles.groupTitle}>
          {Strings.searchResults + ' (' + searchRows.sessions.length + ')'}
        </Text>
      </View>,
    );
    for (const summary of searchRows.sessions) rows.push(renderRow(summary));
    if (searchRows.hasMore) {
      rows.push(
        <View key='search-more' className={styles.notice}>
          <Text>{Strings.searchHasMore.replace('%s', String(SESSION_SEARCH_RESULT_LIMIT))}</Text>
        </View>,
      );
    }
  } else {
    for (const group of groups) {
      const isCollapsed = collapsed.includes(group.id);
      rows.push(
        <View
          key={'h-' + group.id}
          className={styles.groupHeader}
          ariaLabel={Strings.reorderGroups}
          onClick={() => toggleGroup(group.id)}
          onLongPress={event => setGroupMenu({ anchor: anchorFromEvent(event), group })}
        >
          <Text className={styles.groupTitle}>{group.title}</Text>
          <Text className={styles.groupCount}>{group.sessions.length}</Text>
          <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} className={styles.chevron} />
        </View>,
      );
      if (isCollapsed) {
        // 折叠的分组仍露出运行中的会话，正在跑的活不会被藏起来（对齐 web 0.1.7 / Mac 267bcde）。
        for (const summary of group.sessions) if (summary.running) rows.push(renderRow(summary));
        continue;
      }
      const limit = PAGE_SIZE * (pages[group.id] ?? 1);
      const shown = group.sessions.slice(0, limit);
      for (const summary of shown) rows.push(renderRow(summary));
      if (shown.length < group.sessions.length) {
        rows.push(
          <View
            key={'m-' + group.id}
            className={styles.showMore}
            onClick={() => setPages(current => ({ ...current, [group.id]: (current[group.id] ?? 1) + 1 }))}
          >
            <Text>{Strings.showMore.replace('%d', String(group.sessions.length - shown.length))}</Text>
          </View>,
        );
      }
    }
  }

  const connectionIsFailed = connection.kind === 'failed';
  const connectionIsPending = connection.kind === 'connecting';
  // 空态要用「过滤后的可见名册」判定：全部会话都被归档时，原始名册非空但列表一条不剩，
  // 这时必须给空态（对齐 Android SessionListScreen 的 listEmpty = listed.isEmpty()）。
  const isEmpty = listed.length === 0;

  // 一台 Mac 都没配对：不画列表，直接送去配对（对齐 Android App.kt 的 root 分支）。
  // 手机端没有「没配对也能连」的路，所以这里不该出现任何假装在连的界面。
  if (profilesState.profiles.length === 0) {
    // 引导页自己就是一整屏（含顶栏），不要再套一层列表页的容器：那层还留着
    // 给底部归档入口的 72px 内边距，套上去会多出一截空白。
    return <Onboarding onPair={() => openPage(pageRoutes.PAIRING)} />;
  }

  return (
    <PageShell>
      <View className={styles.page}>
        {/* 顶栏对齐 Android SessionListScreen 的 TopAppBar：
            普通态 = 连接状态点（进设置）+ 机器名 + 搜索 / 视图 / 新建；
            搜索态 = 返回键 + 标题位变成一行无边框输入 + 清除。 */}
        <NavBar
          left={
            finding ? (
              <NavIconButton
                name='arrow-left'
                onClick={() => { setFinding(false); setQuery(''); model.search(''); }}
              />
            ) : (
              <View
                className={styles.statusDotButton}
                aria-label={Strings.connectionStateLabel}
                onClick={() => openPage(pageRoutes.SETTINGS)}
              >
                <View className={styles.statusDot + ' ' + dotClass(connection)} />
              </View>
            )
          }
          title={
            finding ? (
              <NavSearchInput
                value={query}
                focus={searchFocused}
                placeholder={Strings.searchSessions}
                onInput={value => setQuery(sanitizeSearchQuery(value))}
              />
            ) : (
              <NavTitle text={profileName ?? Strings.appName} />
            )
          }
          actions={
            finding ? (
              // 清除只清文字并把光标留在框里，退出搜索交给左上角返回键，二者不混用
              // （对齐 Android 的注释与实现）。
              query.length === 0 ? null : (
                <NavIconButton
                  name='x'
                  ariaLabel={Strings.close}
                  onClick={() => {
                    setQuery('');
                    model.search('');
                    // focus 是受控的：先置假再置真，光标才会回到输入框。
                    setSearchFocused(false);
                    setTimeout(() => setSearchFocused(true), 0);
                  }}
                />
              )
            ) : (
              <React.Fragment>
                <NavIconButton
                  name='search'
                  ariaLabel={Strings.searchSessions}
                  onClick={() => { setFinding(true); setSearchFocused(true); }}
                />
                <NavIconButton
                  name='list-filter'
                  ariaLabel={Strings.viewOptions}
                  onClick={() => setViewMenu({ x: getSystemInfo().windowWidth ?? 375, y: navHeight })}
                />
                <NavIconButton name='plus' ariaLabel={Strings.newSession} onClick={() => openPage(pageRoutes.NEW)} />
              </React.Fragment>
            )
          }
        />


        {rows}

        {/* 四个空态互斥，按 Android StatusOverlay 的 when 次序取第一条命中的：
            并列判断会让「搜索无结果 + 名册为空 + 连接失败」同时画出两层提示。 */}
        {/* 只有真的要画空态时才铺这层居中容器：有行的时候它不能占位。 */}
        {isEmpty || (searching && !searchPending && searchRows.sessions.length === 0) ? (
          <View className={styles.stateArea}>
            {isEmpty && connectionIsFailed ? (
              <EmptyState name='cloud-off' title={Strings.offlineBannerTitle} description={Strings.offlineBannerBody} />
            ) : isEmpty && connectionIsPending ? (
              // 连接中的空态是居中转圈（对齐 Android StatusOverlay 的 Connecting 分支）。
              <View className={styles.centered}>
                <Icon name='loader-circle' spin className={styles.centeredGlyph} />
              </View>
            ) : searching && !searchPending && searchRows.sessions.length === 0 ? (
              <EmptyState name='search' title={Strings.searchNoResults} description={normalizedQuery} />
            ) : !searching && isEmpty && connection.kind === 'connected' ? (
              <EmptyState name='message-circle' title={Strings.noSessions} />
            ) : null}
          </View>
        ) : null}


        {/* 归档会话已经在 listed 里被滤掉了，这里是它们唯一的入口，所以固定在这一列底部
            （不随列表滚动），而不是折进视图选项菜单——对齐 Android/Mac 侧栏。 */}
        <View className={styles.archiveEntry} onClick={() => openPage(pageRoutes.ARCHIVED)}>
          <Icon name='archive' className={styles.archiveGlyph} />
          <Text className={styles.archiveLabel}>{Strings.archivedSessions}</Text>
        </View>

        <ActionMenu anchor={rowMenu?.anchor} items={rowMenuItems} onSelect={selectRowMenu} onClose={() => setRowMenu(undefined)} width={168} />
        <ActionMenu anchor={groupMenu?.anchor} items={groupMenuItems} onSelect={selectGroupMenu} onClose={() => setGroupMenu(undefined)} width={200} />
        <ActionMenu anchor={viewMenu} items={viewMenuItems} onSelect={selectViewMenu} onClose={() => setViewMenu(undefined)} width={200} />
        <EditDialog
          open={renameTarget !== undefined}
          title={Strings.rename}
          label={Strings.rename}
          // 预填会话自己的标题（对齐 Android sessionStoredTitle），实时标题优先；未命名就留空。
          initial={renameTarget === undefined ? '' : model.sessionStoredTitle(renameTarget.sessionId)}
          onSubmit={value => {
            const target = renameTarget;
            setRenameTarget(undefined);
            if (target !== undefined) void model.renameSession(target.sessionId, value);
          }}
          onClose={() => setRenameTarget(undefined)}
        />
      </View>
    </PageShell>
  );

  function renderRow(summary: SessionSummary): React.ReactNode {
    // 闸门是 awaitingUserIds，kinds 表只决定文案、缺条目时兜底 approval（A-14，
    // 对齐 Android SessionListScreen.kt:841-843 与本端 stores.ts 的 statusOrder 同一口径：
    // 两份集合万一失步时，以「是否在等用户」为准，不靠 kinds 表反推）。
    const awaiting = awaitingUserIds.has(summary.sessionId)
      ? (awaitingKinds.get(summary.sessionId) ?? 'approval')
      : undefined;
    // 未读错误只看 erroredIds，不再被「已完成」抑制（A-13，对齐 Android unreadError）。
    const icon = iconFor(
      summary,
      awaiting !== undefined,
      erroredIds.has(summary.sessionId),
      pinnedIds.includes(summary.sessionId),
    );
    const trailing = resolveSessionRowTrailing(
      awaiting,
      false,
      archivedSet.has(summary.sessionId),
      summary.blank,
      draftIds.has(summary.sessionId),
      summary.updatedAt,
    );
    return (
      <SessionRow
        key={summary.sessionId}
        summary={summary}
        icon={icon}
        trailing={trailing}
        onOpen={() => openSession(summary.sessionId)}
        onLongPress={event => setRowMenu({ anchor: anchorFromEvent(event), summary })}
      />
    );
  }
}

function dotClass(connection: Connection): string {
  const tone = connectionTone(connection);
  if (tone === 'connected') return styles.dotOk;
  if (tone === 'connecting') return styles.dotPending;
  return styles.dotBad;
}

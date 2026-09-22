import React from 'react';
import { Text, View } from '@tarojs/components';
import { Strings, fmt } from '../../i18n/strings';
import { back, openPage, pageRoutes } from '../../framework/page';
import { toast } from '../../framework/req';
import { EmptyState } from '../../ui/emptyState';
import { Icon } from '../../ui/icon';
import { NavBar, NavIconButton, NavSearchInput, NavTitle } from '../../ui/navBar';
import { getAppModel } from '../../state/appModel';
import { sessionListStore, workspaceStore } from '../../state/stores';
import { useStore } from '../../state/store';
import {
  archivedSessionRows,
  filterArchivedSessions,
} from '../../model/archivedSessions';
import { relativeTime, sessionDisplayTitle, sessionWorkspaceName } from '../../model/format';
import type { SessionId } from '../../model/types';
import { PageShell } from '../../ui/pageShell';
import styles from './index.module.scss';

/**
 * 已归档会话页：会话列表底部「已归档会话」入口的落点。
 *
 * 开成独立页面而不是底部弹层（原来那个 ArchivedSheet）：取消归档会让会话回到列表，
 * 盖住列表的弹层看不到这个结果；独立页返回一步就能看见它回来了。口径照抄 Android
 * ui/screen/ArchivedSessionsScreen.kt 与 Mac ArchivedSessionsView——权威归档集合在
 * Workspace 注册表里，与已加载的会话摘要求交后成行，搜索按标题或工作区名本地过滤，
 * 每行一个取消归档动作，三种空态各自区分。
 *
 * 不额外拉取：归档集合与会话摘要分别由常驻的 workspace/follow 与会话流维持最新。
 */
export default function ArchivedSessionsPage(): JSX.Element {
  const model = getAppModel();
  const workspaceArchived = useStore(workspaceStore.archivedSessionIdsStore);
  const listArchived = useStore(sessionListStore.archivedSessionIdsStore);
  const sessions = useStore(sessionListStore.sessionsState);
  const workspaces = useStore(workspaceStore.workspacesStore);
  const unarchiving = useStore(model.unarchivingIdsStore);

  const [query, setQuery] = React.useState('');
  const [finding, setFinding] = React.useState(false);

  const exitFind = React.useCallback((): void => {
    setFinding(false);
    setQuery('');
  }, []);

  // 两个 store 的归档集合取并集：workspace/follow 写入 WorkspaceStore，恢复成功后
  // appModel 也会同步应用到两边，这里合起来读不会漏掉任何一侧；顺序沿用注册表
  // （最近归档的在前），不再本地排序——排序会把「归档先后」这条信息抹掉。
  const ids = React.useMemo<SessionId[]>(() => {
    const seen = new Set<SessionId>();
    const result: SessionId[] = [];
    for (const id of workspaceArchived) if (!seen.has(id)) { seen.add(id); result.push(id); }
    for (const id of listArchived) if (!seen.has(id)) { seen.add(id); result.push(id); }
    return result;
  }, [workspaceArchived, listArchived]);

  const workspaceTitles = React.useMemo(() => workspaceStore.bySessionMap(), [workspaces]);
  const rows = React.useMemo(
    () => archivedSessionRows(ids, new Map(sessions.map(item => [item.sessionId, item]))),
    [ids, sessions],
  );
  const visibleRows = React.useMemo(
    () => filterArchivedSessions(rows, workspaceTitles, query),
    [rows, workspaceTitles, query],
  );

  const restore = React.useCallback(async (sessionId: SessionId): Promise<void> => {
    // 旧主机没有 workspace/unarchiveSession：不提示的话这里就是「点了没反应」
    // （对齐 Android ArchivedSessionsScreen 用 Snackbar 报失败原因）。
    if (!(await model.unarchiveSession(sessionId))) {
      toast(model.lastErrorStore.get() ?? Strings.operationFailed);
    }
  }, [model]);

  const openSession = React.useCallback((sessionId: SessionId): void => {
    openPage(pageRoutes.CHAT, { sessionId });
  }, []);

  const body = (): JSX.Element => {
    if (rows.length === 0 && ids.length > 0) {
      // 归档集合非空、却没有一行能解析出摘要：成员在 Workspace 注册表之外被删掉了，
      // 这里没有可恢复的东西。与「归档为空」区分开，别让人以为归档丢了。
      return <EmptyState name='archive' title={Strings.unavailableArchivedSessions} />;
    }
    if (rows.length === 0) {
      return <EmptyState name='archive' title={Strings.noArchived} />;
    }
    if (visibleRows.length === 0) {
      // 有行但被查询滤空：这是搜索无匹配，不是归档为空。
      return <EmptyState name='search-x' title={Strings.searchNoResults} description={query} />;
    }
    return (
      <View className={styles.rows}>
        {visibleRows.map(summary => {
          const title = sessionDisplayTitle(summary, undefined);
          const workspaceName = sessionWorkspaceName(workspaceTitles.get(summary.sessionId), summary.cwd) ?? Strings.ungrouped;
          const restoring = unarchiving.includes(summary.sessionId);
          return (
            <View key={summary.sessionId} className={styles.row} onClick={() => openSession(summary.sessionId)}>
              <View className={styles.rowMain}>
                <Text className={styles.rowTitle}>{title}</Text>
                <Text className={styles.rowMeta}>{workspaceName + ' · ' + relativeTime(summary.updatedAt)}</Text>
              </View>
              {restoring ? (
                // 进行中就不给按钮了：进度指示本身也是防重复点击的那道闸。
                <Icon name='loader-circle' spin className={styles.rowBusy} />
              ) : (
                <Text
                  className={styles.rowRestore}
                  aria-label={fmt(Strings.unarchiveSessionNamed, title)}
                  onClick={event => { event.stopPropagation(); restore(summary.sessionId); }}
                >
                  {Strings.unarchiveSession}
                </Text>
              )}
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <PageShell>
      <View className={styles.page}>
        {/* 顶栏对齐 Android ArchivedSessionsScreen 的 TopAppBar：
            普通态 = 返回 + 「已归档会话」+ 搜索；搜索态 = 返回 + 标题位变输入 + 清除。 */}
        <NavBar
          mode='flow'
          left={<NavIconButton name='arrow-left' onClick={() => { if (finding) exitFind(); else back(); }} />}
          title={
            finding ? (
              <NavSearchInput
                value={query}
                focus
                placeholder={Strings.searchArchivedSessions}
                onInput={setQuery}
              />
            ) : (
              <NavTitle text={Strings.archivedSessions} />
            )
          }
          actions={
            finding ? (
              query.length === 0 ? null : (
                <NavIconButton name='x' ariaLabel={Strings.close} onClick={() => setQuery('')} />
              )
            ) : (
              <NavIconButton
                name='search'
                ariaLabel={Strings.searchArchivedSessions}
                onClick={() => setFinding(true)}
              />
            )
          }
        />
        {/* 空态在剩余空间里居中（对齐 Android ArchivedSessionsScreen 的 Box + EmptyStateColumn 居中）；
            有行时这层不占位，行照常滚动。居中靠 .stateCenter 自身的 margin:auto（wxss 不支持
            :first-child 这类伪类选择器，不能靠父选择器下钻）。 */}
        <View className={styles.body}>
          {visibleRows.length === 0 ? <View className={styles.stateCenter}>{body()}</View> : body()}
        </View>
      </View>
    </PageShell>
  );
}

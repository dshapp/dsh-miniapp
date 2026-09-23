import React from 'react';
import { ScrollView, Text, Textarea, View } from '@tarojs/components';
import { Strings, fmt } from '../i18n/strings';
import { getAppModel } from '../state/appModel';
import { useStore } from '../state/store';
import type { SessionStore } from '../state/sessionStore';
import type { TodoItem, GoalProjection } from '../state/sessionStore';
import {
  agentPresetDisplayText,
  saturatingAdd,
  sessionCacheHitPercent,
  formatStatsDuration,
  formatTokens,
  formatTokensPerSecond,
  pathBasename,
  splitRecommended,
  tokenCount,
} from '../model/format';
import type { PresentedFile } from '../model/format';
import { parseArgsMap } from '../model/toolRow';
import { jobIsLive } from '../model/types';
import type { JobView, ModelProviderGroup, SubagentListEntry } from '../model/types';
import {
  createQuestionFlow,
  planReviewApproveAnswer,
  planReviewReviseAnswer,
  questionFlowAnswers,
  questionFlowChooseSettlingBatch,
  questionFlowContinue,
  questionFlowCurrent,
  questionFlowCurrentDraft,
  questionFlowIsFirst,
  questionFlowIsLast,
  questionFlowNext,
  questionFlowPrevious,
  questionFlowSetCustom,
  questionFlowSkip,
  routePlanReview,
} from '../model/questionFlow';
import type {
  ApprovalOutcome,
  ApprovalRequested,
  QuestionFlowState,
  QuestionFlowStep,
  QuestionFlowValidation,
  QuestionRequested,
} from '../model/questionFlow';
import { MarkdownView } from './markdown';
import { Icon, type LucideIconName } from './icon';
import { cardDetailStore, closeCardDetail, openCardDetail } from './cardDetail';
import styles from './sheets.module.scss';

/*
 * 会话页的可复用底部弹层集合：会话面板 / 上下文 / 模型 / 归档 / 文件预览 / 审批 / 提问。
 *
 * 对齐 Android ui/screen/Sheets.kt。小程序没有 ModalBottomSheet，这里用固定定位的
 * 遮罩 + 底部面板自绘（见 Sheet）：对外只暴露 open/onClose，内部数据一律从 appModel
 * 与 SessionStore 订阅，调用方不需要自己取数。
 */

/**
 * 底部弹层外壳：遮罩点击即关闭，面板内滚动区不穿透。
 *
 * 固定头/尾：Android 的提问/计划评审弹层是三段式——头部（问题 / 计划标题）与底部操作区
 * 都在滚动区之外，只有中段正文 `verticalScroll`（Sheets.kt:641-664、721-777、794-839）。
 * 这里对应地给出 header / footer 两个插槽：传了就不进 ScrollView，长正文滚走时它们仍然可见。
 */
export function Sheet(props: {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * 正文复位标识：值一变就把正文滚回顶部（换题/换内容的调用方传一个随内容变化的键）。
   *
   * 小程序的 ScrollView 节点没有可写的 scrollTop，滚动只能用受控属性表达。
   */
  bodyScrollKey?: string | number;
  /** 调用方自己画标题栏（提问弹层）：不再重复渲染外壳的标题与关闭键。 */
  hideHeader?: boolean;
  /** 固定头部：放在滚动区之外（对齐 Android 问题头 Row / 计划标题）。 */
  header?: React.ReactNode;
  /** 固定底部操作区：放在滚动区之外（对齐 Android 的底部按钮列，长正文滚不飞它）。 */
  footer?: React.ReactNode;
  /** 面板最大高度（对齐 Android 逐层 heightIn(max = 560/600/620/640.dp)）。 */
  maxHeight?: string;
  /** 锁住正文滚动（对齐 Android selecting 期间 userScrollEnabled = false）。 */
  scrollLocked?: boolean;
  /** 滚到正文底部（文件预览的自动续页哨兵）。 */
  onReachBottom?: () => void;
}): JSX.Element {
  // 受控的正文滚动位置：小程序只在 scroll-top 真的变化时才重新滚动，所以复位要先落到
  // 1px 再回 0——两帧之间的一像素看不出来，但「已经在顶部」的那次复位不会被吞掉。
  const [bodyTop, setBodyTop] = React.useState(0);
  const bodyScrollKey = props.bodyScrollKey;
  React.useEffect(() => {
    if (bodyScrollKey === undefined) return undefined;
    setBodyTop(1);
    const timer = setTimeout(() => setBodyTop(0), 0);
    return () => clearTimeout(timer);
  }, [bodyScrollKey]);
  // 下拉关闭：安卓的 ModalBottomSheet 自带拖拽手势，自绘面板补一个（只认向下、
  // 且以纵向位移为主，免得把横滑手势误判成关闭）。
  const dragStart = React.useRef<number | undefined>(undefined);
  const touchY = (event: { touches?: { clientY?: number }[]; changedTouches?: { clientY?: number }[] }): number | undefined => {
    const list = event.touches !== undefined && event.touches.length > 0 ? event.touches : event.changedTouches;
    const first = list === undefined || list.length === 0 ? undefined : list[0];
    return first === undefined ? undefined : first.clientY;
  };
  const SWIPE_CLOSE_DP = 72;
  // 没有标题就不再画空标题栏 + 关闭 ×：Android 的会话面板/上下文弹层在 ModalBottomSheet
  // 里直接铺内容，没有标题也没有关闭键（Sheets.kt:286、460）；那些弹层靠遮罩下拉关闭。
  const showHeader = props.hideHeader !== true && props.title !== undefined && props.title.length > 0;
  if (!props.open) return <View />;
  return (
    <View className={styles.backdrop} onClick={props.onClose}>
      <View
        className={styles.sheet}
        style={props.maxHeight === undefined ? undefined : { maxHeight: props.maxHeight }}
        onClick={event => event.stopPropagation()}
        onTouchStart={event => {
          dragStart.current = touchY(event as unknown as { touches?: { clientY?: number }[] });
        }}
        onTouchEnd={event => {
          const start = dragStart.current;
          dragStart.current = undefined;
          const end = touchY(event as unknown as { changedTouches?: { clientY?: number }[] });
          if (start === undefined || end === undefined) return;
          if (end - start > SWIPE_CLOSE_DP) props.onClose();
        }}
      >
        <View className={styles.handle} />
        {props.header === undefined ? null : <View className={styles.sheetHeaderFixed}>{props.header}</View>}
        {showHeader ? (
          <View className={styles.sheetHeader}>
            <Text className={styles.sheetTitle}>{props.title ?? ''}</Text>
            <Icon name='x' className={styles.sheetClose} ariaLabel={Strings.close} onClick={props.onClose} />
          </View>
        ) : null}
        <ScrollView
          scrollY={props.scrollLocked !== true}
          className={styles.sheetBody}
          lowerThreshold={80}
          scrollTop={bodyTop}
          scrollWithAnimation={false}
          onScrollToLower={props.onReachBottom}
        >
          {props.children}
        </ScrollView>
        {props.footer === undefined ? null : <View className={styles.sheetFooter}>{props.footer}</View>}
      </View>
    </View>
  );
}

/**
 * 一行「标签 + 值」。
 *
 * section 行同样带右侧 value——Android 的 DetailRow 不分 section 与否都渲染
 * `Spacer(weight(1f)); Text(row.value)`（Sheets.kt:396-405），所以「Token 用量」
 * 这类 section 标题右侧是有总值的。
 */
function DetailRow(props: { label: string; value: string; section?: boolean }): JSX.Element {
  const section = props.section === true;
  return (
    <View className={section ? styles.detailRowSection : styles.detailRow}>
      <Text className={section ? styles.detailLabelSection : styles.detailLabel}>{props.label}</Text>
      <Text className={styles.detailValue}>{props.value}</Text>
    </View>
  );
}

function SectionTitle(props: { text: string }): JSX.Element {
  return <Text className={styles.sectionTitle}>{props.text}</Text>;
}

// —— 会话面板 ————————————————————————————————————————————————

function todoIcon(status: string): { name: LucideIconName; spin?: boolean } {
  if (status === 'completed') return { name: 'check' };
  if (status === 'in_progress' || status === 'in-progress') return { name: 'refresh-cw', spin: true };
  return { name: 'circle' };
}

function todoClass(status: string): string {
  if (status === 'completed') return styles.todoDone;
  if (status === 'in_progress' || status === 'in-progress') return styles.todoActive;
  return styles.todoPending;
}

/**
 * 会话面板：待办 / 后台任务 / 子智能体 / 产物 / 统计。
 *
 * 与 Android SessionPanelSheet 同序。产物按 Android 的口径「从最近一轮往前找 5 轮」，「
 * 找不到就留空——不做全量扫描，避免每次打开都翻整份转写。
 */
export function SessionPanelSheet(props: {
  open: boolean;
  sessionId: string;
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenFile: (path: string) => void;
  /** 在电脑上打开（主机 host/open-path）；缺省时不给这个次级入口。 */
  onOpenOnHost?: (path: string) => void;
}): JSX.Element {
  const model = getAppModel();
  const store = React.useMemo(() => model.ensureSession(props.sessionId), [model, props.sessionId]);
  const todos = useStore(store.todosStore);
  const jobs = useStore(store.jobsStore);
  const stats = useStore(store.sessionStatsStore);
  const deliverablesRevision = useStore(store.deliverablesRevisionStore);
  const occupancy = store.contextOccupancy;
  const [subagents, setSubagents] = React.useState<SubagentListEntry[]>([]);

  // 打开一次拉一次子会话；关闭后不重复拉，避免每次重开都打主机。
  React.useEffect(() => {
    if (!props.open) return undefined;
    let cancelled = false;
    void model.loadSubagents(props.sessionId).then(value => {
      if (!cancelled) setSubagents(value.entries);
    });
    return () => {
      cancelled = true;
    };
  }, [model, props.open, props.sessionId]);

  const deliverables = React.useMemo<PresentedFile[]>(() => {
    void deliverablesRevision;
    const turn = stats === undefined ? undefined : stats.turns;
    if (turn === undefined) return [];
    for (let candidate = turn; candidate >= Math.max(turn - 5, 0); candidate -= 1) {
      const files = store.presentedFiles(candidate);
      if (files.length > 0) return files;
    }
    // 近 5 轮都找不到就留空（对齐 Android Sheets.kt:450-458：不整份扫描、也不从工具参数推断）。
    return [];
  }, [deliverablesRevision, stats, store]);

  // 运行中的任务点一下可以停掉（0.1.7 的 job/kill）；已结束的行点了不做事。
  const stopJob = (job: JobView): void => {
    if (!jobIsLive(job)) return;
    wx.showModal({
      title: Strings.jobStopTitle,
      content: job.label,
      confirmText: Strings.jobStopConfirm,
      cancelText: Strings.cancel,
      success: result => {
        if (result.confirm) void model.killJob(props.sessionId, job.id);
      },
    });
  };

  const openSubagent = (entry: SubagentListEntry): void => {
    if (!entry.isChild) return;
    const child = model.ensureSession(entry.sessionId);
    child.configureSubagent(
      { parentSessionId: props.sessionId, childSessionId: entry.sessionId, mode: entry.mode },
      // 从会话面板进子会话时父会话一定存在，给 true 才会长回「返回父会话」的出口；
      // 写死 false 会让子会话里永远看不到它（对齐 Android SessionPanelSheet → openSubagent(..., true)）。
      true,
    );
    if (entry.label !== undefined) child.title = entry.label;
    child.running = entry.running;
    props.onClose();
    props.onOpenSession(entry.sessionId);
  };

  return (
    <Sheet open={props.open} onClose={props.onClose} maxHeight='640px'>
      {todos.length === 0 ? null : (
        <View>
          <SectionTitle text={Strings.todos} />
          {todos.map((todo: TodoItem) => (
            <View key={todo.id} className={styles.listRow}>
              <Icon
                name={todoIcon(todo.status).name}
                spin={todoIcon(todo.status).spin}
                className={styles.rowGlyph + ' ' + todoClass(todo.status)}
              />
              <Text className={styles.rowTitle}>{todo.content}</Text>
            </View>
          ))}
        </View>
      )}

      {jobs.length === 0 ? null : (
        <View>
          <SectionTitle text={Strings.jobs} />
          {jobs.map((job: JobView) => (
            <View key={job.id} className={styles.listRow} onClick={() => stopJob(job)}>
              {/* 尾部是「运行中转圈 + 状态码」，与 Android ListItem 的 trailing 一致。 */}
              <View className={styles.rowTextColumn}>
                <Text className={styles.rowTitle}>{job.label}</Text>
                {(job.progress ?? job.detail) === undefined
                  ? null
                  : <Text className={styles.rowDetail}>{job.progress ?? job.detail}</Text>}
              </View>
              <View className={styles.rowTrailingGroup}>
                {jobIsLive(job) ? <Icon name='loader-circle' spin className={styles.rowTrailing} /> : null}
                <Text className={styles.rowMeta}>{job.status}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {subagents.length === 0 ? null : (
        <View>
          <SectionTitle text={Strings.subagents} />
          {subagents.map(entry => (
            <View key={entry.sessionId} className={styles.listRow} onClick={() => openSubagent(entry)}>
              {/* 图标放尾部（对齐 Android ListItem 的 trailing：运行中转圈、否则右箭头）。 */}
              <Text className={styles.rowTitle}>{entry.label ?? entry.sessionId}</Text>
              <Icon
                name={entry.running ? 'loader-circle' : 'chevron-right'}
                spin={entry.running}
                className={styles.rowTrailing}
              />
            </View>
          ))}
        </View>
      )}

      {deliverables.length === 0 ? null : (
        <View>
          <SectionTitle text={Strings.deliverables} />
          {deliverables.map(file => (
            // 整行主点击 = 在电脑上打开（对齐 Android Sheets.kt:522-527 的
            // ListItem(clickable { model.openOnHost(file.path) })）；安卓这一行没有
            // leading 图标。小程序没有系统文件查看器，额外留一个次级图标走站内文本预览，
            // 这是对安卓结构的增强，已在第三轮审计 D-13 登记。
            <View key={file.path} className={styles.listRow} onClick={() => props.onOpenOnHost?.(file.path)}>
              <View className={styles.rowTextColumn}>
                <Text className={styles.rowTitle}>{pathBasename(file.path)}</Text>
                {file.description === undefined ? null : <Text className={styles.rowDetail}>{file.description}</Text>}
              </View>
              <Icon
                name='file-text'
                className={styles.rowAction}
                ariaLabel={Strings.preview}
                onClick={event => {
                  event.stopPropagation();
                  props.onOpenFile(file.path);
                }}
              />
            </View>
          ))}
        </View>
      )}

      {stats === undefined ? null : (
        <View>
          <SectionTitle text={Strings.stats} />
          <DetailRow label={Strings.turns} value={String(stats.turns)} />
          <DetailRow label={Strings.steps} value={String(stats.steps)} />
          {occupancy === undefined ? null : <DetailRow label={Strings.context} value={occupancy.percent + '%'} />}
        </View>
      )}
    </Sheet>
  );
}

// —— 上下文明细 ————————————————————————————————————————————————

interface ContextBreakdown {
  system: number;
  tools: number;
  messages: number;
}

const CONTEXT_SYSTEM_TINT = '#8e8e93';
const CONTEXT_TOOLS_TINT = '#af52de';
const CONTEXT_MESSAGES_TINT = '#0a84ff';

/** contextBreakdown 投影的三段启发式读数（与 Android contextBreakdown 同构）。 */
function contextBreakdown(value: unknown): ContextBreakdown | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  const read = (key: string): number => (typeof obj[key] === 'number' ? (obj[key] as number) : 0);
  return { system: read('systemTokens'), tools: read('toolsTokens'), messages: read('messageTokens') };
}

interface SessionStatsReading {
  turns: number;
  steps: number;
  llmMs: number;
  toolMs: number;
  ttftMs: number;
  ttftSteps: number;
  decodeMs: number;
  decodeTokens: number;
}

/**
 * 会话统计读数：有 sessionStats 投影就用投影，否则按已加载窗口折算（同 Android resolveSessionStats）。
 * 规模是可见节点数，渲染时即时算一次足够便宜。
 */
function resolveSessionStats(store: SessionStore): SessionStatsReading {
  const projected = store.sessionStats;
  if (projected !== undefined) {
    return {
      turns: projected.turns,
      steps: projected.steps,
      llmMs: projected.llmMs,
      toolMs: projected.toolMs,
      ttftMs: projected.ttftMs,
      ttftSteps: projected.ttftSteps,
      decodeMs: projected.decodeMs,
      decodeTokens: projected.decodeTokens,
    };
  }
  const turns = new Set<number>();
  let steps = 0;
  let llmMs = 0;
  let toolMs = 0;
  let ttftMs = 0;
  let ttftSteps = 0;
  let decodeMs = 0;
  let decodeTokens = 0;
  for (const node of store.nodes) {
    if (node.kind === 'assistant') {
      const step = node.step;
      steps += 1;
      turns.add(step.turn);
      if (step.stepStartTime !== undefined) {
        llmMs += Math.max(0, step.time - step.stepStartTime);
        if (step.firstTokenTime !== undefined) {
          ttftMs += Math.max(0, step.firstTokenTime - step.stepStartTime);
          ttftSteps += 1;
        }
      }
      const output = step.usage === undefined ? undefined : step.usage.outputTokens;
      if (step.firstTokenTime !== undefined && output !== undefined) {
        decodeMs += Math.max(0, step.time - step.firstTokenTime);
        decodeTokens += output;
      }
    } else if (node.kind === 'tool' && node.data.result !== undefined) {
      toolMs += Math.max(0, node.data.result.time - node.data.time);
    }
  }
  return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens };
}

/** 上下文占用 + 明细。 */
export function ContextSheet(props: { open: boolean; sessionId: string; onClose: () => void }): JSX.Element {
  const model = getAppModel();
  const store = React.useMemo(() => model.ensureSession(props.sessionId), [model, props.sessionId]);
  // 占用/统计是投影派生量，没有单独 Store，与 Android 一样按秒读一次；
  // 同时订阅节点与用量 Store，让流式期间的值立刻反映出来。
  useStore(store.nodesStore);
  useStore(store.tokenUsageStore);
  useStore(store.agentPresetStore);
  const [, forceTick] = React.useState(0);
  React.useEffect(() => {
    if (!props.open) return undefined;
    const timer = setInterval(() => forceTick(current => current + 1), 1000);
    return () => clearInterval(timer);
  }, [props.open]);
  const occupancy = store.contextOccupancy;

  const breakdown = contextBreakdown(store.projectionValue('contextBreakdown'));
  const stats = resolveSessionStats(store);
  const usage = store.tokenUsage;
  const presetId = store.agentPreset;
  const presets = useStore(model.agentPresetsStore);
  const preset = presetId === undefined ? undefined : presets.find(item => item.id === presetId);
  const presetName = presetId === undefined ? undefined : (preset === undefined ? presetId : agentPresetDisplayText(preset).name);

  const percent = occupancy === undefined ? 0 : occupancy.percent;
  const contextAriaParts = Strings.contextAria.split('%d%%');
  const contextAriaBefore = (contextAriaParts[0] ?? '').trim();
  const contextAriaAfter = (contextAriaParts[1] ?? '').trim();
  const fraction = Math.min(1, Math.max(0, percent / 100));
  const segments: { color: string; fraction: number }[] = [];
  if (breakdown !== undefined && breakdown.system + breakdown.tools + breakdown.messages > 0) {
    const total = breakdown.system + breakdown.tools + breakdown.messages;
    if (fraction * (breakdown.system / total) > 0) segments.push({ color: CONTEXT_SYSTEM_TINT, fraction: fraction * (breakdown.system / total) });
    if (fraction * (breakdown.tools / total) > 0) segments.push({ color: CONTEXT_TOOLS_TINT, fraction: fraction * (breakdown.tools / total) });
    if (fraction * (breakdown.messages / total) > 0) segments.push({ color: CONTEXT_MESSAGES_TINT, fraction: fraction * (breakdown.messages / total) });
  } else if (fraction > 0) {
    segments.push({ color: '#6b7280', fraction });
  }

  const detailRows: { label: string; value: string; section?: boolean }[] = [];
  if (presetName !== undefined) detailRows.push({ label: Strings.preset, value: presetName });
  if (stats.steps > 0) {
    detailRows.push({ label: Strings.statsDialogTitle, value: '', section: true });
    detailRows.push({ label: Strings.statsProgress, value: fmt(Strings.statsCounts, stats.turns, stats.steps) });
    if (stats.llmMs > 0) detailRows.push({ label: Strings.statsLlm, value: formatStatsDuration(stats.llmMs) });
    if (stats.toolMs > 0) detailRows.push({ label: Strings.statsTools, value: formatStatsDuration(stats.toolMs) });
    if (stats.ttftSteps > 0) detailRows.push({ label: Strings.statsTtft, value: formatStatsDuration(stats.ttftMs / stats.ttftSteps) });
    if (stats.decodeMs > 0) {
      detailRows.push({
        label: Strings.statsDecode,
        value: fmt(Strings.messageTokensPerSecond, formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1000))),
      });
    }
  }
  if (usage !== undefined) {
    const uncached = usage.uncachedInputTokens ?? usage.inputTokens ?? 0;
    const cacheRead = usage.cacheReadTokens ?? 0;
    const cacheWrite = usage.cacheWriteTokens ?? 0;
    const output = usage.outputTokens ?? 0;
    // 饱和相加：三个桶各自都可能是极值，直接相加会回绕成负数，整组 Token 行消失。
    const billed = saturatingAdd(saturatingAdd(uncached, cacheRead), cacheWrite);
    if (billed > 0 || output > 0) {
      detailRows.push({ label: Strings.statsUsageTitle, value: tokenCount(saturatingAdd(billed, output)), section: true });
      // 会话级读数用 sessionCacheHitPercent，不是单轮那个固定一位小数的口径。
      const hit = sessionCacheHitPercent(cacheRead, billed);
      if (hit !== undefined) detailRows.push({ label: Strings.turnUsageCacheHit, value: hit + '%' });
      detailRows.push({ label: Strings.turnUsageInput, value: tokenCount(uncached) });
      detailRows.push({ label: Strings.turnUsageCacheRead, value: tokenCount(cacheRead) });
      if (cacheWrite !== 0) detailRows.push({ label: Strings.turnUsageCacheWrite, value: tokenCount(cacheWrite) });
      detailRows.push({ label: Strings.turnUsageOutput, value: tokenCount(output) });
    }
  }

  return (
    <Sheet open={props.open} onClose={props.onClose} maxHeight='600px'>
      {/* 没有占用投影时整段不画（对齐 Android：occupancy == null 就什么都不渲染）。 */}
      {occupancy === undefined ? null : (
        <View>
          {/* 把 contextAria 按 %d%% 拆成前后两半夹住百分比，右侧给 ~used / window（对齐 Android ContextSheet）。 */}
          <View className={styles.occupancyRow}>
            <View className={styles.occupancyInfo}>
              <Text className={styles.occupancyLine}>{contextAriaBefore}<Text className={styles.occupancyPercent}>{percent + '%'}</Text>{contextAriaAfter}</Text>
            </View>
            <Text className={styles.occupancySub}>
              {'~' + formatTokens(Math.round(occupancy.usedTokens)) + ' / ' + formatTokens(Math.round(occupancy.contextWindow))}
            </Text>
          </View>
          <View className={styles.barTrack}>
            {segments.map((segment, index) => (
              <View
                key={index}
                className={styles.barSeg}
                style={{ width: (segment.fraction * 100).toFixed(3) + '%', backgroundColor: segment.color }}
              />
            ))}
          </View>
          {breakdown === undefined ? null : (
            <View>
              <LegendRow label={Strings.contextSystem} value={'~' + formatTokens(Math.round(breakdown.system))} color={CONTEXT_SYSTEM_TINT} />
              <LegendRow label={Strings.contextTools} value={'~' + formatTokens(Math.round(breakdown.tools))} color={CONTEXT_TOOLS_TINT} />
              <LegendRow label={Strings.contextMessages} value={'~' + formatTokens(Math.round(breakdown.messages))} color={CONTEXT_MESSAGES_TINT} />
            </View>
          )}
        </View>
      )}
      {detailRows.length === 0 ? null : (
        <View>
          <View className={styles.divider} />
          {detailRows.map((row, index) => (
            <DetailRow key={index} label={row.label} value={row.value} section={row.section === true} />
          ))}
        </View>
      )}
    </Sheet>
  );
}

function LegendRow(props: { label: string; value: string; color: string }): JSX.Element {
  return (
    <View className={styles.legendRow}>
      <View className={styles.legendSwatch} style={{ backgroundColor: props.color }} />
      <Text className={styles.legendLabel}>{props.label}</Text>
      <Text className={styles.legendValue}>{props.value}</Text>
    </View>
  );
}

// —— 模型选择 ————————————————————————————————————————————————

/**
 * 模型列表在切换中的类名：整列变暗 + 不收点击。
 *
 * Android 在 selecting 时给整列 alpha(0.5f) 且 LazyColumn userScrollEnabled = false
 * （Sheets.kt:78-83）。变暗在这里；禁滚由 Sheet 的 scrollLocked（scrollY=false）负责，
 * 这一层只再收掉点击（点击本来也被 pickModel/pickEffort 的 selecting 守卫兜住）。
 */
function modelListClass(selecting: boolean): string {
  return selecting ? styles.modelListBusy + ' ' + styles.modelListLock : '';
}

/** 模型 / 思考强度两页签选择。 */
export function ModelPickerSheet(props: { open: boolean; sessionId: string; onClose: () => void }): JSX.Element {
  const model = getAppModel();
  const store = React.useMemo(() => model.ensureSession(props.sessionId), [model, props.sessionId]);
  const directory = useStore(store.modelDirectoryStore);
  const [tab, setTab] = React.useState(0);

  React.useEffect(() => {
    if (props.open) void model.loadModels(props.sessionId);
  }, [model, props.open, props.sessionId]);

  const currentGroup = directory.groups.find(group => group.id === directory.current?.provider);
  const currentModel = currentGroup === undefined
    ? undefined
    : currentGroup.models.find(entry => entry.id === directory.current?.model);
  const efforts = currentModel === undefined || currentModel.reasoning === undefined ? [] : currentModel.reasoning.efforts;
  const hasEfforts = efforts.length > 0;
  const selecting = directory.status === 'selecting';

  const pickModel = (group: ModelProviderGroup, modelId: string): void => {
    if (selecting) return;
    const selected = directory.current?.provider === group.id && directory.current?.model === modelId;
    if (!selected) void model.selectModel({ provider: group.id, model: modelId }, props.sessionId);
    props.onClose();
  };

  const pickEffort = (effortId: string): void => {
    if (selecting) return;
    const current = directory.current;
    if (current === undefined) return;
    if (current.reasoningEffort !== effortId) {
      void model.selectModel(
        { provider: current.provider, model: current.model, reasoningEffort: effortId },
        props.sessionId,
      );
    }
    props.onClose();
  };

  // 面板高度对齐 Android Sheets.kt:59 的 heightIn(max = 560.dp)。
  // 有页签时不再画「模型」标题（页签里已经有同一个词）；无页签时用弹层标题栏承载它
  //（安卓 Sheets.kt:66-70 是无页签分支的 titleMedium 标题）。
  return (
    <Sheet
      open={props.open}
      title={hasEfforts ? undefined : Strings.model}
      onClose={props.onClose}
      hideHeader={hasEfforts}
      maxHeight='560px'
      scrollLocked={selecting}
    >
      {hasEfforts ? (
        <View className={styles.tabRow}>
          <View
            className={styles.tab + ' ' + (tab === 0 ? styles.tabActive : '')}
            onClick={() => setTab(0)}
          >
            <Text className={styles.tabLabel}>{Strings.model}</Text>
            {tab === 0 ? <View className={styles.tabIndicator} /> : null}
          </View>
          <View
            className={styles.tab + ' ' + (tab === 1 ? styles.tabActive : '')}
            onClick={() => setTab(1)}
          >
            <Text className={styles.tabLabel}>{Strings.thinkingEffort}</Text>
            {tab === 1 ? <View className={styles.tabIndicator} /> : null}
          </View>
        </View>
      ) : null}

      {/* 加载态：160dp 高的居中转圈（对齐 Android Sheets.kt:72-76）。 */}
      {directory.status === 'loading' && directory.current === undefined ? (
        <View className={styles.loadingBox}>
          <Icon name='loader-circle' spin className={styles.loadingSpinner} />
        </View>
      ) : null}
      {/* error / failures 是安卓弹层没有的两类内容（Sheets.kt:84-135 只遍历 groups），
          这里作为小程序增强保留：整块挂在 modelListBusy 之下，selecting 时随列表一起变暗。 */}
      {directory.status === 'error' ? (
        <View className={selecting ? styles.modelListBusy : ''}>
          <Text className={styles.errorText}>{directory.error ?? Strings.operationFailed}</Text>
        </View>
      ) : null}

      {tab === 0 || !hasEfforts ? (
        <View className={modelListClass(selecting)}>
          {directory.groups.map(group => (
            <View key={group.id}>
              <Text className={styles.modelGroupTitle}>{group.name}</Text>
              {group.models.map(entry => {
                const selected = directory.current?.provider === group.id && directory.current?.model === entry.id;
                return (
                  <View key={entry.id} className={styles.modelRow} onClick={() => pickModel(group, entry.id)}>
                    <Text className={styles.modelName}>{entry.name}</Text>
                    {selected ? <Icon name='check' className={styles.modelCheck} /> : null}
                  </View>
                );
              })}
            </View>
          ))}
          {directory.failures.map(failure => (
            <View key={failure.id} className={styles.modelRow}>
              <Text className={styles.modelName}>{failure.name}</Text>
              <Text className={styles.rowMeta}>{failure.message}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {tab === 1 && hasEfforts ? (
        <View className={modelListClass(selecting)}>
          {efforts.map(effort => {
            const selected = directory.current?.reasoningEffort === effort.id;
            return (
              <View key={effort.id} className={styles.modelRow} onClick={() => pickEffort(effort.id)}>
                <Text className={styles.modelName}>{effort.name}</Text>
                {selected ? <Icon name='check' className={styles.modelCheck} /> : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </Sheet>
  );
}

// —— 文件预览 ————————————————————————————————————————————————

/**
 * 文件预览正文：把分页正文按安卓 MonospaceBlock 的等宽口径渲染。
 *
 * 与 Android FilePreviewSheet 同一条规则：翻到一半换版本（主机又写了一版）就整篇重来，
 * 避免把两个版本的正文拼在一起；首屏失败换不可用态 + 重试，中途失败保留正文只给重试。
 */
function FilePreviewBody(props: { text: string; loading: boolean; eof: boolean; failure: string | undefined; onRetry: () => void }): JSX.Element {
  const { text, loading, eof, failure } = props;
  if (text.length === 0) {
    if (failure !== undefined) {
      return (
        <View>
          <Text className={styles.fileNotice}>{Strings.fileUnavailable}</Text>
          <Text className={styles.errorText}>{failure}</Text>
          <View className={styles.fileMore} onClick={props.onRetry}>
            <Text>{Strings.retry}</Text>
          </View>
        </View>
      );
    }
    if (eof) return <Text className={styles.fileNotice}>{Strings.fileEmpty}</Text>;
    return <Text className={styles.fileNotice}>{Strings.fileLoading}</Text>;
  }
  return (
    <View>
      <Text className={styles.fileText}>{text}</Text>
      {loading ? (
        <Text className={styles.fileLoading}>{Strings.statusLoading}</Text>
      ) : failure !== undefined ? (
        <View>
          <Text className={styles.errorText}>{failure}</Text>
          <View className={styles.fileMore} onClick={props.onRetry}>
            <Text>{Strings.retry}</Text>
          </View>
        </View>
      ) : eof ? null : (
        // 滚到底会自动续页；按钮留着给「滚不到底」（内容不足一屏）的情况。
        // 安卓的底部哨兵没有这个按钮（Sheets.kt:930-936），这里登记为小程序增强。
        <View className={styles.fileMore} onClick={props.onRetry}>
          <Text>{Strings.loadMore}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * 工作区文件预览：全屏详情弹层。
 *
 * 对齐 Android：文件预览并不走底部 Sheet，而是复用与卡片详情同一个壳
 * `CardDetailDialog`（Sheets.kt:898 → Cards.kt:115-149）——顶栏左关闭、图标 + 文件名、
 * 顶栏右复制，正文可滚可横向查看。小程序里对应 `ui/cardDetail.tsx#openCardDetail`。
 *
 * 分页取数与「换版本整篇重来」的行为保持不变（Android FilePreviewSheet 同口径）。
 * 与 CardDetailHost 的互斥：详情层 z-index 1000 高于底部弹层的 900，所以打开预览时
 * 先 `closeCardDetail()` 清掉可能压在下面的卡片详情，避免内容叠印。
 */
export function FilePreviewSheet(props: { open: boolean; sessionId: string; path: string | undefined; onClose: () => void }): JSX.Element {
  const model = getAppModel();
  const [text, setText] = React.useState('');
  const [nextOffset, setNextOffset] = React.useState(1);
  const [version, setVersion] = React.useState<string | undefined>(undefined);
  const [eof, setEof] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [failure, setFailure] = React.useState<string | undefined>(undefined);
  // 是否已经由本组件把详情层打开过；用来区分「还没开」与「被用户关掉」。
  const openedRef = React.useRef(false);
  const path = props.path;

  const loadNextPage = React.useCallback(async (reset: boolean): Promise<void> => {
    if (path === undefined || loading || (!reset && eof)) return;
    setLoading(true);
    setFailure(undefined);
    try {
      let requested = reset ? 1 : nextOffset;
      const knownVersion = reset ? undefined : version;
      const knownText = reset ? '' : text;
      let page = await model.workspaceFilePage(props.sessionId, path, requested);
      if (requested > 1 && knownVersion !== undefined && knownVersion !== page.version) {
        requested = 1;
        page = await model.workspaceFilePage(props.sessionId, path, requested);
      }
      if (requested === 1) {
        setText(page.lines > 0 ? page.text : '');
        setNextOffset(page.lines > 0 ? page.offset + page.lines : 1);
      } else if (page.lines > 0) {
        setText(knownText.length === 0 ? page.text : knownText + '\n' + page.text);
        setNextOffset(page.offset + page.lines);
      }
      setVersion(page.version);
      setEof(page.eof || page.lines === 0);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [eof, loading, model, nextOffset, path, props.sessionId, text, version]);

  // 换文件（或首次打开）重置整块状态并取第一页。
  React.useEffect(() => {
    if (!props.open || path === undefined) return undefined;
    setText('');
    setNextOffset(1);
    setVersion(undefined);
    setEof(false);
    setFailure(undefined);
    setLoading(false);
    void loadNextPage(true);
    // 只在文件变化时取第一页。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, path]);

  // 打开 / 刷新全屏详情层：分页读数一变就重开一次，让正文与顶栏复制拿到最新内容。
  // 详情层是全局单例，openCardDetail 会顶掉可能压在下面的卡片详情
  //（z-index 1000 > 底部弹层 900），天然互斥。
  React.useEffect(() => {
    if (!props.open || path === undefined) {
      closeCardDetail();
      return;
    }
    openedRef.current = true;
    openCardDetail({
      icon: 'file-text',
      // 标题取文件名（对齐 Android pathBasename(path).ifEmpty { path }）。
      title: pathBasename(path) || path,
      // 顶栏复制键始终存在（安卓即使正文为空也有 ContentCopy），复制的是当前已加载正文。
      copyText: text,
      content: (
        <FilePreviewBody
          text={text}
          loading={loading}
          eof={eof}
          failure={failure}
          onRetry={() => {
            void loadNextPage(text.length === 0);
          }}
        />
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, path, text, loading, eof, failure]);

  // 详情层被宿主关闭（顶栏 ×）时同步收掉页面上的预览状态，否则再点同一个文件不会重开。
  const detail = useStore(cardDetailStore);
  React.useEffect(() => {
    if (!props.open || !openedRef.current) return;
    if (cardDetailStore.get() !== undefined) return;
    openedRef.current = false;
    props.onClose();
  }, [props.open, detail, props.onClose]);

  // 页面卸载时收掉这一层：CardDetailHost 挂在 app 顶层，不随聊天页卸载。
  React.useEffect(() => () => closeCardDetail(), []);

  return <View />;
}

// —— 审批 ————————————————————————————————————————————————————

/** 审批：主机没给理由时套统一的越权文案；bash 且调用未出结果时展示完整命令。 */
export function ApprovalSheet(props: { open: boolean; approval: ApprovalRequested; onClose: () => void }): JSX.Element {
  const model = getAppModel();
  const store = model.store(props.approval.sessionId);
  const command = React.useMemo(() => {
    const callId = props.approval.callId;
    if (callId === undefined || props.approval.toolName !== 'bash' || store === undefined) return undefined;
    const call = store.toolCall(callId);
    if (call === undefined || call.result !== undefined) return undefined;
    const args = parseArgsMap(call.argsRaw);
    return args === undefined || typeof args.command !== 'string' ? undefined : args.command;
  }, [props.approval.callId, props.approval.toolName, store]);

  const respond = (outcome: ApprovalOutcome): void => {
    // 批准/拒绝各给一次触觉反馈（对齐 Android haptics.performHapticFeedback(LongPress)）。
    try {
      wx.vibrateShort({ type: 'medium' });
    } catch {
      // 不支持震动的环境忽略。
    }
    void model.respondApproval(props.approval, outcome);
    props.onClose();
  };

  return (
    // 安卓的审批标题是正文第一行（titleMedium）、弹层无标题栏也无关闭键（Sheets.kt:565-576）。
    <Sheet open={props.open} onClose={props.onClose}>
      <Text className={styles.approvalTitle}>{Strings.approvalTitle}</Text>
      <Text className={styles.approvalText}>
        {props.approval.reason !== undefined && props.approval.reason.trim().length > 0
          ? props.approval.reason
          : fmt(Strings.approvalEscalation, props.approval.toolName)}
      </Text>
      <Text className={styles.approvalTool}>{props.approval.toolName}</Text>
      {command === undefined ? null : <Text className={styles.monoBlock}>{command}</Text>}
      <View className={styles.buttonRow}>
        <View className={styles.primaryButton} onClick={() => respond('allowed-once')}>
          <Text>{Strings.approve}</Text>
        </View>
        <View className={styles.outlineButton} onClick={() => respond('rejected')}>
          <Text>{Strings.deny}</Text>
        </View>
      </View>
    </Sheet>
  );
}

// —— 提问 / 计划评审 ————————————————————————————————————————

function PlanReviewSheet(props: { question: QuestionRequested; onClose: () => void }): JSX.Element {
  const model = getAppModel();
  const review = routePlanReview(props.question.questions);
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  if (review === undefined) return <View />;
  const submit = (approve: boolean): void => {
    if (busy) return;
    setBusy(true);
    const answer = approve
      ? (notes.trim().length === 0 ? planReviewApproveAnswer(review) : planReviewReviseAnswer(review, notes))
      : planReviewReviseAnswer(review, notes);
    void model.respondQuestion(props.question, [answer]);
    props.onClose();
  };
  return (
    // 三段式：标题固定在头部、计划正文单独滚动、反馈输入框 + 三颗按钮固定在底部
    //（对齐 Android Sheets.kt:793-839，长计划滚走时按钮不跟着跑）。
    <Sheet
      open
      onClose={props.onClose}
      maxHeight='640px'
      header={<Text className={styles.planHeader}>{Strings.questionPlanHeader}</Text>}
      footer={
        <View>
          {/* 字段 label 常驻在输入框上方（对齐 Android OutlinedTextField 的 label，D-19）。 */}
          <Text className={styles.fieldLabel}>{Strings.questionPlanFeedbackPlaceholder}</Text>
          <Textarea
            className={styles.input}
            value={notes}
            maxlength={-1}
            disabled={busy}
            onInput={event => setNotes(event.detail.value)}
          />
          {/* 提交中三颗都置灰（对齐 Android Sheets.kt:812-837 的 enabled = !busy）：
              逻辑上 submit()/discuss 已有 busy 早退，这里补的是「已提交」的视觉反馈。 */}
          <View className={styles.buttonRow}>
            <View
              className={styles.textButton + (busy ? ' ' + styles.buttonOff : '')}
              onClick={() => { if (!busy) { setBusy(true); void model.cancelQuestion(props.question); props.onClose(); } }}
            >
              <Text>{Strings.questionPlanDiscuss}</Text>
            </View>
            <View className={styles.outlineButtonNeutral + (busy ? ' ' + styles.buttonOff : '')} onClick={() => submit(false)}>
              <Text>{Strings.questionPlanDecline}</Text>
            </View>
            <View className={styles.primaryButton + (busy ? ' ' + styles.buttonOff : '')} onClick={() => submit(true)}>
              <Text>{notes.trim().length === 0 ? Strings.questionPlanApprove : Strings.questionPlanApproveWithNotes}</Text>
            </View>
          </View>
        </View>
      }
    >
      <View className={styles.planBody}>
        <MarkdownView text={review.plan} />
      </View>
    </Sheet>
  );
}

/** 提问：逐题作答，最后一题才提交整组答案；计划评审走单独的分支。 */
export function QuestionSheet(props: { open: boolean; question: QuestionRequested; onClose: () => void }): JSX.Element {
  const model = getAppModel();
  const review = routePlanReview(props.question.questions);
  const [flow, setFlow] = React.useState<QuestionFlowState>(() => createQuestionFlow(props.question.questions));
  const [busy, setBusy] = React.useState(false);
  // 换一组问题（或重新打开）时重置流程，避免把上一组答案带进来。
  React.useEffect(() => {
    setFlow(createQuestionFlow(props.question.questions));
    setBusy(false);
  }, [props.question]);

  const submit = (state: QuestionFlowState): void => {
    if (busy) return;
    setBusy(true);
    void model.respondQuestion(props.question, questionFlowAnswers(state));
    props.onClose();
  };

  const advance = (step: QuestionFlowStep): void => {
    setFlow(step.state);
    if (step.submit) submit(step.state);
  };

  if (!props.open) return <View />;
  if (review !== undefined) return <PlanReviewSheet question={props.question} onClose={props.onClose} />;

  const item = questionFlowCurrent(flow);
  const draft = questionFlowCurrentDraft(flow);
  if (item === undefined || draft === undefined) return <View />;

  const validation: QuestionFlowValidation | undefined = flow.validation;
  const canContinue = draft.selected.length > 0 || draft.custom.trim().length > 0;

  const cancelAll = (): void => {
    // 头部关闭键放弃整组问题（= 拒答），与底部只跳过当前这题的「跳过」分工不同；
    // 一致性上不能只做本地 close——主机仍会停在待答状态（对齐 Android Sheets.kt:655-664）。
    if (busy) return;
    setBusy(true);
    void model.cancelQuestion(props.question);
    props.onClose();
  };

  const customLabel = (item.options ?? []).length === 0
    ? Strings.questionCustomPlaceholder
    : Strings.answerCustom;

  return (
    // 三段式（对齐 Android Sheets.kt:638-778）：问题头固定在顶部、选项/自填框单独滚动、
    // 校验文案与「上一题/进度/下一题 + 跳过 + 提交」固定在底部，长题目滚不走按钮。
    // 不再重复「提问」标题：问题正文本身就是标题，弹层已有拖拽把手标识层级。
    // 换题就把正文滚回顶部（对齐 Android LaunchedEffect(flow.index) { scroll.scrollTo(0) }）。
    <Sheet
      open
      // 遮罩点击 / 下滑只本地收起，问题仍挂在会话上可以再进来答（对齐 Android
      // ChatScreen.kt:585-587 的 onDismiss = setQuestion(null)）；真正的「拒答」只有
      // 头部那颗 X 才触发，见下面的 cancelAll。
      onClose={props.onClose}
      bodyScrollKey={flow.index + ':' + item.question}
      hideHeader
      maxHeight='620px'
      header={
        <View className={styles.questionHeader}>
          <View className={styles.questionHeaderText}>
            {item.header === undefined || item.header.length === 0 ? null : (
              <Text className={styles.questionKicker}>{item.header}</Text>
            )}
            <Text className={styles.questionText}>{item.question}</Text>
          </View>
          <Icon name='x' className={styles.sheetClose} ariaLabel={Strings.questionCancel} onClick={cancelAll} />
        </View>
      }
      footer={
        <View>
          {validation === 'unanswered' ? <Text className={styles.errorText}>{Strings.questionErrorUnanswered}</Text> : null}
          {validation === 'incomplete' ? <Text className={styles.errorText}>{Strings.questionErrorIncomplete}</Text> : null}
          <View className={styles.questionFooter}>
            {flow.questions.length > 1 ? (
              <Icon
                name='chevron-left'
                ariaLabel={Strings.questionPrev}
                className={styles.stepButton + ' ' + (questionFlowIsFirst(flow) ? styles.stepButtonOff : '')}
                onClick={() => { if (!busy && !questionFlowIsFirst(flow)) setFlow(questionFlowPrevious(flow)); }}
              />
            ) : null}
            {flow.questions.length > 1 ? (
              <Text className={styles.stepCount}>
                {fmt(Strings.questionProgress, flow.index + 1, flow.questions.length)}
              </Text>
            ) : null}
            {flow.questions.length > 1 ? (
              <Icon
                name='chevron-right'
                ariaLabel={Strings.questionNext}
                className={styles.stepButton + ' ' + (questionFlowIsLast(flow) ? styles.stepButtonOff : '')}
                onClick={() => { if (!busy && !questionFlowIsLast(flow)) setFlow(questionFlowNext(flow)); }}
              />
            ) : null}
            {/* 进度与「跳过/提交」之间留弹性空隙（对齐 Android 的 Spacer(weight(1f))）。 */}
            <View className={styles.footerSpacer} />
            <Text className={styles.textButton} onClick={() => { if (!busy) advance(questionFlowSkip(flow)); }}>
              {Strings.questionSkip}
            </Text>
            <View
              // 未作答时用真禁用观感（灰底 + 淡色文字），不再是看起来可点的中性按钮
              //（对齐 Android Button(enabled = !busy && draft.answered)，D-20）。
              className={canContinue ? styles.primaryButton : styles.disabledButton}
              onClick={() => { if (!busy && canContinue) advance(questionFlowContinue(flow)); }}
            >
              <Text>{questionFlowIsLast(flow) ? Strings.submit : Strings.questionActionNext}</Text>
            </View>
          </View>
        </View>
      }
    >
      {item.detail === undefined || item.detail.length === 0 ? null : (
        <View className={styles.detailText}>
          <MarkdownView text={item.detail} compact />
        </View>
      )}

      {(item.options ?? []).map(option => {
        const display = splitRecommended(option.label);
        const picked = draft.selected.includes(option.label);
        const multi = item.multiSelect === true;
        const markClass = styles.optionMark
          + (multi ? '' : ' ' + styles.optionMarkRound)
          + (picked ? ' ' + styles.optionMarkOn : '')
          + (picked && multi ? ' ' + styles.optionMarkFilled : '');
        return (
          <View key={option.label} className={styles.optionRow} onClick={() => { if (!busy) advance(questionFlowChooseSettlingBatch(flow, option.label)); }}>
            {/* 多选画成带描边的方形复选框、单选画成带描边的圆形单选钮（选中填充），
                观感贴近安卓真实的 Checkbox / RadioButton（Sheets.kt:695-702）。 */}
            <View className={markClass}>
              {picked && multi ? <Icon name='check' className={styles.optionMarkGlyph} /> : null}
              {picked && !multi ? <View className={styles.optionMarkDot} /> : null}
            </View>
            <View className={styles.optionText}>
              {/* 推荐标签紧跟选项文字（对齐 Android headline Row 里的 labelSmall），不再推到行尾。 */}
              <View className={styles.optionHeadline}>
                <Text className={styles.optionLabel}>{display.label}</Text>
                {display.recommended ? <Text className={styles.optionTag}>{Strings.questionRecommended}</Text> : null}
              </View>
              {option.description === undefined || option.description.length === 0 ? null : (
                <Text className={styles.optionDesc}>{option.description}</Text>
              )}
            </View>
          </View>
        );
      })}

      {/* 自填框带常驻字段 label（对齐 Android OutlinedTextField 的 label，D-19）。 */}
      <Text className={styles.fieldLabel}>{customLabel}</Text>
      <Textarea
        className={styles.input}
        value={draft.custom}
        placeholder=''
        maxlength={-1}
        disabled={busy}
        onInput={event => { if (!busy) setFlow(current => questionFlowSetCustom(current, event.detail.value)); }}
      />
    </Sheet>
  );
}

export type { GoalProjection };

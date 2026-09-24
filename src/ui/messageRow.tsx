import React, { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { color_bad, color_good, color_primary, color_text_faint, color_text_sub, color_warning, DIMENS } from '../const';
import { Strings, fmt } from '../i18n/strings';
import { turnTriggerPresentation } from '../model/turnTrigger';
import { Store, useStore } from '../state/store';
import { openCardDetail } from './cardDetail';

/** 没有 store 可订阅时给 TurnProcessRow 用的常量空 store（避免在组件里做条件 hook）。 */
const EMPTY_EXPANDED_STORE = new Store<boolean>(false);
import type { JsonValue } from '../model/json';
import {
  chatNodeRendersRow,
  plainText,
} from '../model/chatNode';
import type {
  AssistantBlock,
  AssistantStepData,
  ChatNode,
  ContentBlock,
  TurnProcessSpec,
  TurnTriggerNode,
  TurnTailData,
  UnknownSurfaceNode,
  WorkflowRunData,
  WorkflowRunStatus,
} from '../model/chatNode';
import {
  cacheHitPercent,
  clockTime,
  compactTokenCount,
  formatDuration,
  formatLatencySeconds,
  formatTokensPerSecond,
  tokenCount,
  turnTotalTokens,
} from '../model/format';
import { JsonTree, NoticeRow, ThinkCard, ToolCard } from './cards';
import { ImageGallery, decodeAttachmentRef } from './attachmentImage';
export { AttachmentImage, decodeAttachmentRef, type AttachmentRef } from './attachmentImage';
import { ChangedFilesCard } from './changedFilesCard';
import type { FileLinkTarget } from '../model/fileLink';
import type { ChangedFileDiff, TurnChangesAddress, TurnChangesSummary } from '../model/turnChanges';
import { HighlightedText } from './findHighlight';
import { projectUserRefs } from '../model/userRefs';
import { MarkdownView } from './markdown';
import { Icon, type LucideIconName } from './icon';
import styles from './messageRow.module.scss';

/*
 * 转写行：Android 版 ui/component/MessageRow.kt 的小程序移植。
 *
 * 与 Android 版最大的不同：这里完全不认识 appModel / store / PhoneModel，
 * 附件解析、Fork、查找、轮次摘要这些跨模块能力一律从 props 注入，
 * 这样这个文件可以独立于尚未落地的状态层先走通。
 */

/** 按 props 注入的依赖集。找齐了这些，MessageRow 就不再需要任何全局单例。 */
export interface MessageRowProps {
  node: ChatNode;
  sessionId: string;
  cwd?: string;
  /** 会话内查找：空串表示不在查找态 */
  findQuery?: string;
  findActive?: boolean;
  /** 正文里 @文件 提及的路径集合，用于把 mention 渲染成可点链接 */
  fileMentions?: string[];
  onOpenFile?: (path: string) => void;
  /** 轮次页脚的 Fork 按钮：参数是这一轮的收尾 seq（对齐 Android onFork(data.seq)）。 */
  onFork?: (seq: number) => void;
  /** 拉取图片附件的本地临时路径；返回 undefined 时显示占位骨架 */
  resolveImage?: (attachmentId: string, sessionId: string) => Promise<string | undefined>;
  /** 点击图片附件时打开大图 */
  onOpenImage?: (localPath: string, name?: string) => void;
  /** 轮次处理摘要（TurnProcess 行用）；缺省时该行不展开 */
  turnProcessSummary?: (turn: number) => string | undefined;
  /** 过程折叠的展开态真相源：展开后 store 会把这轮的思考/工具行放回转写。 */
  turnProcessExpanded?: (spec: TurnProcessSpec) => Store<boolean>;
  onToggleTurnProcess?: (spec: TurnProcessSpec) => void;
  /** 正文里的文件链接（Markdown 链接与行内路径）落点；缺省时退回复制地址。 */
  onOpenFileLink?: (target: FileLinkTarget) => void;
  /** 被引用会话的 标题 → 会话 id：气泡把整条标题画成可点的引用。 */
  referencedSessions?: Record<string, string>;
  /** 点击会话引用的落点。 */
  onOpenSession?: (sessionId: string) => void;
  /** 一轮改动文件的公告坐标；没有公告说明这一轮没改东西。 */
  changesAddress?: (turn: number) => TurnChangesAddress | undefined;
  /** 读一轮的改动汇总。 */
  loadTurnChanges?: (address: TurnChangesAddress) => Promise<TurnChangesSummary | undefined>;
  /** 读单个列出的文件的比较。 */
  loadTurnChangesDiff?: (address: TurnChangesAddress, index: number) => Promise<ChangedFileDiff | undefined>;
}

/**
 * 用户气泡。
 *
 * 关键约束（对齐 Android）：气泡最多占列宽 82%，短消息按内容收缩——
 * 旧写法固定占比会把一句「好」拉成横贯半屏的长条。
 */
function UserBubble(props: {
  content: ContentBlock[];
  sessionId: string;
  findQuery: string;
  findActive: boolean;
  resolveImage?: MessageRowProps['resolveImage'];
  onOpenImage?: MessageRowProps['onOpenImage'];
  referencedSessions?: Record<string, string>;
  onOpenSession?: (sessionId: string) => void;
}): JSX.Element {
  const { content, sessionId, findQuery, findActive, resolveImage, onOpenImage, onOpenSession } = props;
  const text = plainText(content);
  // 只有解得出的附件才排进气泡；解不出的按 Android 口径直接丢掉。
  const images = content
    .filter((block): block is Extract<ContentBlock, { kind: 'image' }> => block.kind === 'image')
    .map((block) => block.attachment)
    .filter((attachment): attachment is JsonValue => attachment !== undefined && decodeAttachmentRef(attachment) !== undefined);
  // 点一下气泡弹「复制」；长按仍交给系统文本选择（外层 Text 的 selectable/user-select）。
  const [copyMenu, setCopyMenu] = useState(false);
  const copyText = async () => {
    setCopyMenu(false);
    try {
      await Taro.setClipboardData({ data: text });
    } catch {
      void Taro.showToast({ title: Strings.copyFailed, icon: 'none' });
    }
  };
  return (
    <View className={styles.userRow}>
      <ImageGallery refs={images} sessionId={sessionId} resolveImage={resolveImage} onOpenImage={onOpenImage} alignEnd />
      {text.length === 0 ? null : (
        <View className={styles.bubbleWrap}>
          <View
            className={styles.bubble}
            style={{ borderRadius: DIMENS.bubbleRadius + 'px' }}
            onClick={() => setCopyMenu(true)}
          >
            <Text className={styles.bubbleText} selectable userSelect>
              {projectUserRefs(text, props.referencedSessions ?? {}).map((token, index) =>
                token.kind === 'session' ? (
                  // 被引用会话：整条标题是一个可点的主题色引用，点了切过去。
                  <Text
                    key={'ref' + index}
                    className={styles.bubbleRef}
                    style={{ color: color_primary }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenSession?.(token.sessionId);
                    }}
                  >
                    {'@' + token.label}
                  </Text>
                ) : findQuery.length > 0 ? (
                  <HighlightedText key={'t' + index} text={token.text} query={findQuery} active={findActive} />
                ) : (
                  token.text
                ),
              )}
            </Text>
          </View>
          {copyMenu ? (
            <View className={styles.copyMenu} onClick={() => void copyText()}>
              <Text className={styles.copyMenuText}>{Strings.copy}</Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

/** 助手一行：正文 Markdown、思考折叠卡、图片附件，外加运行中的加载态。 */
function AssistantRow(props: {
  step: AssistantStepData;
  sessionId: string;
  findQuery: string;
  findActive: boolean;
  fileMentions?: string[];
  onOpenFile?: (path: string) => void;
  onOpenFileLink?: MessageRowProps['onOpenFileLink'];
  resolveImage?: MessageRowProps['resolveImage'];
  onOpenImage?: MessageRowProps['onOpenImage'];
}): JSX.Element {
  const { step, sessionId, findQuery, findActive, resolveImage, onOpenImage } = props;
  const blocks = step.blocks.filter((block): block is AssistantBlock => block !== null);
  // 连续图片块合成一组相册（对齐 Android ImageGallery 的相邻分组）：
  // 组首记下 refs，组内其余下标跳过。
  const galleries = new Map<number, JsonValue[]>();
  const gallerySkip = new Set<number>();
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind !== 'image') continue;
    const refs: JsonValue[] = [];
    let cursor = i;
    while (cursor < blocks.length) {
      const candidate = blocks[cursor];
      if (candidate.kind !== 'image') break;
      if (candidate.attachment !== undefined) refs.push(candidate.attachment);
      cursor++;
    }
    galleries.set(i, refs);
    for (let j = i + 1; j < cursor; j++) gallerySkip.add(j);
    i = cursor - 1;
  }
  return (
    <View className={styles.assistant}>
      {blocks.map((block, index) => {
        // 正文里的提及交给 MarkdownView 就地渲染（对齐 Android 把 fileMentions 传进
        // MarkdownText）：词表命中的行内代码直接变成可点的文件，不再另起一条提及行。
        if (block.kind === 'text') {
          return (
            <View key={index} className={styles.mdBlock}>
              <MarkdownView
                text={block.text}
                findQuery={findQuery}
                findActive={findActive}
                fileMentions={props.fileMentions}
                onOpenFile={props.onOpenFile}
                onOpenFileLink={props.onOpenFileLink}
              />
            </View>
          );
        }
        if (block.kind === 'reasoning') {
          return <ThinkCard key={index} text={block.text} findQuery={findQuery} findActive={findActive} />;
        }
        if (block.kind === 'image') {
          if (gallerySkip.has(index)) return null;
          return (
            <ImageGallery
              key={index}
              refs={galleries.get(index) ?? []}
              sessionId={sessionId}
              resolveImage={resolveImage}
              onOpenImage={onOpenImage}
            />
          );
        }
        // tool-call / other 由独立的 Tool 行或未知 surface 承载，这里不重复画。
        return null;
      })}
      {step.status === 'running' && step.blocks.length === 0 ? (
        <Icon name='loader-circle' spin className={styles.loadingGlyph} style={{ color: color_primary }} />
      ) : null}
    </View>
  );
}

/** 折叠卡片的公共头：图标 + 摘要（带查找高亮）+ 可选附注 + 展开箭头。 */
function CardHeader(props: {
  name: LucideIconName;
  summary: string;
  suffix?: string;
  running?: boolean;
  tint?: string;
  findQuery?: string;
  findActive?: boolean;
  expanded?: boolean;
  onClick?: () => void;
}): JSX.Element {
  const { name, summary, suffix, running = false, tint = color_text_sub, findQuery, findActive, expanded, onClick } = props;
  return (
    <View className={onClick === undefined ? styles.row : styles.row + ' ' + styles.rowClickable} onClick={onClick}>
      {/* 进行中不再换成转圈的 loader-circle：保留本行自己的图标，只让它闪烁。 */}
      <Icon name={name} blink={running} className={styles.rowGlyph} style={{ color: tint }} />
      <HighlightedText className={styles.rowTitle} text={summary} query={findQuery} active={findActive} />
      {suffix === undefined || suffix.length === 0 ? null : <Text className={styles.rowSuffix}>{suffix}</Text>}
      {expanded === undefined ? null : <Icon name={expanded ? 'chevron-down' : 'chevron-right'} className={styles.caret} />}
    </View>
  );
}

/**
 * 详情卡壳：卡片头 + 全屏详情弹层。
 *
 * 与 Android 的 CardRow + CardDetailDialog 同一种交互——行上只露摘要，点开是全屏
 * 详情（左上角关闭、右上角复制、正文可选中），不是就地铺开。
 */
function DetailCard(props: {
  name: LucideIconName;
  title: string;
  suffix?: string;
  running?: boolean;
  tint?: string;
  findQuery?: string;
  findActive?: boolean;
  /** 右上角复制的正文；缺省时不显示复制按钮。 */
  copyText?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <View className={styles.card}>
      <CardHeader
        name={props.name}
        summary={props.title}
        suffix={props.suffix}
        running={props.running}
        tint={props.tint}
        findQuery={props.findQuery}
        findActive={props.findActive}
        onClick={() =>
          openCardDetail({
            icon: props.name,
            title: props.title,
            copyText: props.copyText,
            content: props.children,
          })
        }
      />
    </View>
  );
}

/**
 * 轮次触发通知：是谁唤醒了这一轮（定时任务、后台任务、goal、webhook、插件……），
 * 一行摘要，全文在详情里看（对齐 Mac `PhoneTurnTriggerRow`）。
 */
function TurnTriggerRow(props: { data: TurnTriggerNode; findQuery: string; findActive: boolean }): JSX.Element {
  const { data, findQuery, findActive } = props;
  const presentation = turnTriggerPresentation(data.source);
  const title = Strings[presentation.title];
  const text = plainText(data.content);
  return (
    <DetailCard name={presentation.icon} title={title} findQuery={findQuery} findActive={findActive} copyText={text}>
      <Text className={styles.detailText} style={{ color: color_text_sub }}>
        {Strings.turnTriggerExplanation}
      </Text>
      <Text className={styles.detailText} selectable userSelect>
        {text}
      </Text>
    </DetailCard>
  );
}

/** 未知 surface：标题只有类型名，正文摊成 JSON 树，宁可难看也别丢信息。 */
function UnknownSurfaceRow(props: { data: UnknownSurfaceNode }): JSX.Element {
  return (
    <DetailCard name='circle-help' title={props.data.type}>
      <JsonTree value={props.data.data} />
    </DetailCard>
  );
}

/** 工作流状态的字形与语义色；与 Android 的 workflowIcon 一一对应（进行中改闪烁）。 */
function workflowIcon(status: WorkflowRunStatus): { name: LucideIconName; blink?: boolean } {
  switch (status) {
    case 'running':
      return { name: 'refresh-cw', blink: true };
    case 'completed':
      return { name: 'check' };
    case 'failed':
      return { name: 'x' };
    case 'cancelled':
      return { name: 'ban' };
    case 'interrupted':
      return { name: 'pause' };
  }
}

function workflowTint(status: WorkflowRunStatus): string {
  switch (status) {
    case 'running':
      return color_primary;
    case 'completed':
      return color_good;
    case 'failed':
      return color_bad;
    case 'cancelled':
      return color_text_faint;
    case 'interrupted':
      return color_warning;
  }
}

function workflowStatusLabel(status: WorkflowRunStatus): string {
  switch (status) {
    case 'running':
      return Strings.workflowStatusRunning;
    case 'completed':
      return Strings.workflowStatusCompleted;
    case 'failed':
      return Strings.workflowStatusFailed;
    case 'cancelled':
      return Strings.workflowStatusCancelled;
    case 'interrupted':
      return Strings.workflowStatusInterrupted;
  }
}

/** 工作流卡片：状态 + 名称 + 各阶段成员，展开后逐行列出。 */
function WorkflowRunCard(props: { data: WorkflowRunData }): JSX.Element {
  const { data } = props;
  const [expanded, setExpanded] = useState(false);
  const title = data.name.length > 0 ? data.name : Strings.workflowUntitled;
  return (
    <View className={styles.card}>
      <CardHeader
        name={workflowIcon(data.status).name}
        summary={title}
        suffix={workflowStatusLabel(data.status)}
        running={workflowIcon(data.status).blink === true}
        tint={workflowTint(data.status)}
        expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <View className={styles.cardBody}>
          {data.phases.map((phase, phaseIndex) => (
            <View key={phase.key + ':' + phaseIndex} className={styles.phase}>
              {phase.phase === undefined || phase.phase.length === 0 ? null : (
                <Text className={styles.phaseLabel}>{phase.phase}</Text>
              )}
              {phase.members.map((member, memberIndex) => (
                <View key={member.seq + ':' + memberIndex} className={styles.memberRow}>
                  <Icon
                    name={workflowIcon(member.status).name}
                    blink={workflowIcon(member.status).blink}
                    className={styles.memberGlyph}
                    style={{ color: workflowTint(member.status) }}
                  />
                  <Text className={styles.memberLabel}>{member.label}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** 把 spec 的计数摊成一行行文案，展开 TurnProcess 时逐条列出。 */
function processSummaryParts(spec: TurnProcessSpec): string[] {
  const parts: string[] = [];
  if (spec.messageCount > 0) parts.push(fmt(Strings.processMessages, spec.messageCount));
  if (spec.toolCallCount > 0) parts.push(fmt(Strings.processTools, spec.toolCallCount));
  if (spec.subagentCount > 0) parts.push(fmt(Strings.processSubagents, spec.subagentCount));
  return parts;
}

/**
 * 过程折叠控件：一轮里的思考与工具调用折在它后面。
 *
 * Android 的展开态由 store 记账；这里改成组件本地状态。只要这一轮真的折进了东西
 * （builtin 有内容，或宿主额外给了 turnProcessSummary），就给箭头允许展开——与 Android
 * 「过程折叠行永远可展开」同口径，缺省只是没有额外摘要而已。
 */
function TurnProcessRow(props: {
  spec: TurnProcessSpec;
  turnProcessSummary?: (turn: number) => string | undefined;
  findQuery: string;
  findActive: boolean;
  /** 展开态的权威是会话 store：展开后折叠过滤会把这轮的思考/工具行真正放出来。 */
  expandedStore?: Store<boolean>;
  onToggleExpand?: () => void;
}): JSX.Element {
  const { spec, turnProcessSummary, findQuery, findActive } = props;
  const stored = useStore(props.expandedStore ?? EMPTY_EXPANDED_STORE);
  const [localExpanded, setLocalExpanded] = useState(false);
  // 没有 store 时退回组件本地状态（缺省只是这一行自己的展开，不影响转写过滤）。
  const expanded = props.expandedStore === undefined ? localExpanded : stored;
  const provided = turnProcessSummary === undefined ? undefined : turnProcessSummary(spec.turn);
  const builtin = processSummaryParts(spec);
  const fallback = builtin.length > 0 ? builtin.join(' · ') : spec.inlineReasoning ? Strings.thinking : '';
  const summary = provided !== undefined && provided.length > 0 ? provided : fallback;
  const expandable = turnProcessSummary !== undefined || builtin.length > 0;
  return (
    <View className={styles.card}>
      <CardHeader
        name='ellipsis'
        summary={summary.length > 0 ? summary : Strings.thinking}
        findQuery={findQuery}
        findActive={findActive}
        expanded={expandable ? expanded : undefined}
        onClick={
          expandable
            ? () => {
                if (props.onToggleExpand !== undefined) props.onToggleExpand();
                else setLocalExpanded(value => !value);
              }
            : undefined
        }
      />
      {expandable && expanded ? (
        <View className={styles.cardBody}>
          {(builtin.length > 0 ? builtin : [Strings.thinking]).map((line, index) => (
            <Text key={index} className={styles.processLine}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** 统计行：左标签右数值，数值超宽时截断，不把面板撑破。 */
function StatRow(props: { label: string; value: string }): JSX.Element {
  return (
    <View className={styles.statRow}>
      <Text className={styles.statLabel}>{props.label}</Text>
      <Text className={styles.statValue}>{props.value}</Text>
    </View>
  );
}

/** 本轮用量明细；与 Android StatDialog 的 usage 分支同字段、同顺序。 */
function UsagePanel(props: { data: TurnTailData }): JSX.Element {
  const { data } = props;
  const usage = data.usage;
  const rows: JSX.Element[] = [];
  if (data.routes.length > 0) {
    rows.push(<StatRow key="model" label={Strings.turnUsageModel} value={data.routes.join(', ')} />);
  }
  if (usage !== undefined) {
    const hit = cacheHitPercent(usage);
    if (hit !== undefined) {
      rows.push(<StatRow key="cacheHit" label={Strings.turnUsageCacheHit} value={hit + '%'} />);
    }
    rows.push(
      <StatRow
        key="input"
        label={Strings.turnUsageInput}
        value={tokenCount(usage.uncachedInputTokens ?? usage.inputTokens ?? 0)}
      />,
    );
    if (usage.cacheReadTokens !== undefined) {
      rows.push(<StatRow key="cacheRead" label={Strings.turnUsageCacheRead} value={tokenCount(usage.cacheReadTokens)} />);
    }
    if (usage.cacheWriteTokens !== undefined) {
      rows.push(<StatRow key="cacheWrite" label={Strings.turnUsageCacheWrite} value={tokenCount(usage.cacheWriteTokens)} />);
    }
    const output = tokenCount(usage.outputTokens ?? 0);
    const reasoning =
      usage.reasoningTokens === undefined ? '' : ' ' + fmt(Strings.turnUsageReasoning, tokenCount(usage.reasoningTokens));
    rows.push(<StatRow key="output" label={Strings.turnUsageOutput} value={output + reasoning} />);
  }
  return <View className={styles.statPanel}>{rows}</View>;
}

/**
 * 本轮输出速度：宿主给了实测 TPS 就用实测，否则用 outputTokens / 用时现算一个。
 * 口径与 Android TurnTailRow 的兜底分支完全一致。
 */
function turnTps(data: TurnTailData): number | undefined {
  if (data.decodeTokensPerSec !== undefined) return data.decodeTokensPerSec;
  if (data.runMs === undefined || data.runMs <= 0) return undefined;
  const output = data.usage?.outputTokens;
  if (output === undefined || output <= 0) return undefined;
  return output / (data.runMs / 1000);
}

/** 本轮用时与速度明细；TPS 的兜底算法与 Android 完全一致。 */
function TimePanel(props: { data: TurnTailData }): JSX.Element {
  const { data } = props;
  const rows: JSX.Element[] = [];
  if (data.runMs !== undefined) {
    rows.push(<StatRow key="duration" label={Strings.turnTimeDuration} value={formatDuration(data.runMs)} />);
  }
  const tps = turnTps(data);
  if (tps !== undefined && tps > 0) {
    rows.push(
      <StatRow
        key="tps"
        label={Strings.turnTimeSpeed}
        value={fmt(Strings.messageTokensPerSecond, formatTokensPerSecond(tps))}
      />,
    );
  }
  if (data.ttftMs !== undefined && data.ttftMs > 0) {
    rows.push(
      <StatRow
        key="ttft"
        label={Strings.turnTimeTtft}
        value={fmt(Strings.durationSecondsText, formatLatencySeconds(data.ttftMs))}
      />,
    );
  }
  return <View className={styles.statPanel}>{rows}</View>;
}

/**
 * 一轮结束的页脚：复制回复、分支、用量与用时、结束时刻。
 *
 * 明细从 Android 的弹窗改成点击胶囊就地展开，避免在滚动容器里再叠一层浮层。
 */
interface TurnChangesDeps {
  changesAddress?: MessageRowProps['changesAddress'];
  loadTurnChanges?: MessageRowProps['loadTurnChanges'];
  loadTurnChangesDiff?: MessageRowProps['loadTurnChangesDiff'];
}

function TurnTailRow(props: { data: TurnTailData; onFork?: (turn: number) => void } & TurnChangesDeps): JSX.Element {
  const { data, onFork, changesAddress, loadTurnChanges, loadTurnChangesDiff } = props;
  const [copied, setCopied] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  // 复制反馈只存活 1.5s；卸载时清掉定时器，避免对已卸载组件 setState。
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const closingText = data.closingText;
  const copyClosing = async () => {
    if (closingText === undefined || closingText.length === 0) return;
    try {
      await Taro.setClipboardData({ data: closingText });
      setCopied(true);
    } catch {
      void Taro.showToast({ title: Strings.copyFailed, icon: 'none' });
    }
  };
  const totalTokens = data.usage === undefined ? 0 : turnTotalTokens(data.usage);
  // 页脚只有两个读数胶囊：总 token 与用时；TPS/TTFT 在用时明细里（对齐 Android StatPill）。
  return (
    <View>
      {changesAddress === undefined || loadTurnChanges === undefined || loadTurnChangesDiff === undefined ? null : (
        <ChangedFilesCard
          address={changesAddress(data.turn)}
          loadSummary={loadTurnChanges}
          loadDiff={loadTurnChangesDiff}
        />
      )}
      <View className={styles.tail}>
        {closingText === undefined || closingText.length === 0 ? null : (
          <View className={styles.tailButton} onClick={() => void copyClosing()}>
            <Icon
              name={copied ? 'check' : 'copy'}
              className={styles.tailGlyph}
              style={{ color: copied ? color_good : color_text_sub }}
              ariaLabel={Strings.copyAction}
            />
          </View>
        )}
        {onFork === undefined ? null : (
          <View className={styles.tailButton} onClick={() => onFork(data.seq)}>
            <Icon
              name='git-fork'
              className={styles.tailGlyph}
              style={{ color: color_text_sub }}
              ariaLabel={Strings.messageBranch}
            />
          </View>
        )}
        {totalTokens > 0 ? (
          <View className={styles.pill} onClick={() => setUsageOpen((value) => !value)}>
            <Icon name='sigma' className={styles.pillGlyph} style={{ color: color_text_sub }} />
            <Text className={styles.pillText}>{compactTokenCount(totalTokens)}</Text>
          </View>
        ) : null}
        {data.runMs === undefined || data.runMs <= 0 ? null : (
          <View className={styles.pill} onClick={() => setTimeOpen((value) => !value)}>
            <Icon name='timer' className={styles.pillGlyph} style={{ color: color_text_sub }} />
            <Text className={styles.pillText}>{formatDuration(data.runMs)}</Text>
          </View>
        )}
        <Text className={styles.tailClock}>{clockTime(data.time)}</Text>
      </View>
      {usageOpen ? <UsagePanel data={data} /> : null}
      {timeOpen ? <TimePanel data={data} /> : null}
    </View>
  );
}

/**
 * 一行转写：用户气泡、助手 Markdown 回复、工具卡片、系统提示等。
 *
 * 判别式联合的每个分支都必须落到一个组件上——少一个分支会在 switch 的
 * never 检查里报错，提醒这里漏了一行。
 */
export function MessageRow(props: MessageRowProps): JSX.Element {
  const { node, sessionId, cwd, resolveImage, onOpenImage, onFork, turnProcessSummary } = props;
  const findQuery = props.findQuery ?? '';
  const findActive = props.findActive ?? false;
  switch (node.kind) {
    case 'user':
    case 'steering':
      return (
        <UserBubble
          content={node.content}
          sessionId={sessionId}
          findQuery={findQuery}
          findActive={findActive}
          resolveImage={resolveImage}
          onOpenImage={onOpenImage}
          referencedSessions={props.referencedSessions}
          onOpenSession={props.onOpenSession}
        />
      );
    case 'turnTrigger':
      return <TurnTriggerRow data={node.data} findQuery={findQuery} findActive={findActive} />;
    case 'assistant':
      return (
        <AssistantRow
          step={node.step}
          sessionId={sessionId}
          findQuery={findQuery}
          findActive={findActive}
          fileMentions={props.fileMentions}
          onOpenFile={props.onOpenFile}
          onOpenFileLink={props.onOpenFileLink}
          resolveImage={resolveImage}
          onOpenImage={onOpenImage}
        />
      );
    case 'tool':
      return (
        <ToolCard
          data={node.data}
          cwd={cwd}
          findQuery={findQuery}
          findActive={findActive}
          sessionId={sessionId}
          resolveImage={resolveImage}
          onOpenImage={onOpenImage}
        />
      );
    // 图标按节点类型分派，与 Android MessageRow 的 when 分支一一对应：
    // 失败=警告三角、压缩=向中间收拢、模型重试=重试箭头、长度上限=感叹号圆圈、命令=右尖括号。
    case 'turnError':
      return <NoticeRow tone="error" text={node.data.message} detailed icon="triangle-alert" />;
    case 'compaction':
      return <NoticeRow tone="info" text={Strings.compacted} icon="fold-vertical" />;
    case 'modelRetry':
      return <NoticeRow tone="warning" text={Strings.modelRetry} icon="refresh-cw" />;
    case 'turnMaxTokens':
      return <NoticeRow tone="warning" text={Strings.maxTokens} icon="circle-alert" />;
    case 'command':
      return <NoticeRow tone="info" text={'/' + (node.data.name ?? '')} icon="chevron-right" />;
    case 'turnTail':
      // 收尾消息还没落定的轮次没有页脚（对齐 Mac 的 TurnTailRow）。
      return chatNodeRendersRow(node) ? (
        <TurnTailRow
          data={node.data}
          onFork={onFork}
          changesAddress={props.changesAddress}
          loadTurnChanges={props.loadTurnChanges}
          loadTurnChangesDiff={props.loadTurnChangesDiff}
        />
      ) : <View />;
    case 'turnProcess':
      return (
        <TurnProcessRow
          spec={node.spec}
          turnProcessSummary={turnProcessSummary}
          findQuery={findQuery}
          findActive={findActive}
          expandedStore={
            props.turnProcessExpanded === undefined ? undefined : props.turnProcessExpanded(node.spec)
          }
          onToggleExpand={
            props.onToggleTurnProcess === undefined
              ? undefined
              : () => props.onToggleTurnProcess?.(node.spec)
          }
        />
      );
    case 'workflow':
      return <WorkflowRunCard data={node.data} />;
    case 'unknownSurface':
      return <UnknownSurfaceRow data={node.data} />;
  }
}

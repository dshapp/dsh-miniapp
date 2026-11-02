import React from 'react';
import { Image, ScrollView, Text, Textarea, View } from '@tarojs/components';
import { Strings, fmt } from '../i18n/strings';
import { getAppModel } from '../state/appModel';
import { useStore } from '../state/store';
import {
  activeTrigger,
  atomicTokenEdit,
  attachmentRejection,
  permissionTitle,
  readDraft,
  triggerRanges,
  writeDraft,
} from '../state/composer';
import type { PhoneAttachment, TriggerKind } from '../state/composer';
import { goalPhaseAction, pathBasename } from '../model/format';
import { fileExtension, isImageFile } from '../model/imageFileType';
import { permissionCurrentOption, permissionSelectableOptions } from '../model/types';
import type { CommandDescriptor, SkillEntry } from '../model/types';
import { jget, str, type JsonElement } from '../model/json';
import { queuedItemText } from '../model/frames';
import type { QueuedInboxItem } from '../model/frames';
import type { QuestionRequested } from '../model/questionFlow';
import type { GoalProjection, TodoItem } from '../state/sessionStore';
import { useSafeBottom } from '../framework/hook';
import { toast } from '../framework/req';
import { ActionMenu, anchorFromEvent } from './actionMenu';
import type { ActionMenuAnchor, ActionMenuItem } from './actionMenu';
import { EditDialog } from './editDialog';
import { Icon, type LucideIconName } from './icon';
import { ContextSheet, ModelPickerSheet } from './sheets';
import styles from './composerBar.module.scss';

/**
 * 输入区：待办 → 目标 → 队列 → 候选 → 附件 → 输入卡片（正文 + 一行控制）。
 *
 * 移植自 Android ui/screen/ComposerBar.kt，与 Mac/iOS 的 composer dock 同序、同主机动作。
 * 小程序端少了 Compose 的能力，逐条替换如下：
 * - 正文里的富文本胶囊（BasicTextField 的 VisualTransformation + drawBehind）画不出来，
 *   改在输入框上方摆一条「已选 token 条」：token 本身仍按整块删除（atomicTokenEdit），
 *   点一下胶囊也能把它整段摘掉。
 * - DropdownMenu 用 ui/actionMenu.tsx 自绘锚定浮层（带 leading 图标、危险项染色、选中态），
 *   不再退化成底部 wx.showActionSheet；AlertDialog 类（多行编辑、全权限确认）用
 *   ui/editDialog.tsx 或 wx.showModal；模型/上下文弹层与 Android 一样挂在输入区内部，
 *   宿主漏注入时（新建会话页）组件自己兜底。
 * - 上下文占用环用 conic-gradient 画 18px 进度弧（对齐 Android ComposerBar.kt:596-618），
 *   外层 32px 命中区，不画百分比文字。
 */

/** 输入区里一枚触发 token（对外契约，chat 页按这个签名引用）。 */
export interface ComposerToken { kind: 'file' | 'command' | 'skill'; label: string; value: string }

export interface ComposerBarProps {
  sessionId: string;
  /** 进入页面自动聚焦（新建会话页用）。 */
  autoFocus?: boolean;
  /** 会话还没有草稿时预填的文字（自动化任务页的「新建」用）。 */
  initialDraft?: string;
  /** 输入框上方的一排胶囊（新建会话页放工作区/预设）。 */
  header?: React.ReactNode;
  /** 第一条消息真的发出去了才回调（新建会话页据此 remember 工作区并跳转）。 */
  onSubmitted?: (sessionId: string) => void;
  /** 点上下文占用环时打开明细；未注入时组件自带 ContextSheet（对齐 Android ComposerBar.kt:416）。 */
  onOpenContext?: () => void;
  /** 打开完整模型弹层（含思考强度 Tab）；未注入时组件自带 ModelPickerSheet（对齐 ComposerBar.kt:415）。 */
  onOpenModel?: () => void;
}

/** 候选条的一行。 */
interface Suggestion {
  id: string;
  title: string;
  subtitle?: string;
  hint?: string;
  insert: string;
  /** 声明了参数：只有行首上下文才允许召唤。 */
  wantsArgs?: boolean;
}

/**
 * 占用环的进度弧：conic-gradient 从 -90° 起、按 percent 画 sweep，内层再挖空成 2px 环
 * （对齐 Android ContextRing 的 drawArc(startAngle=-90f, sweep=360*percent/100)，2dp stroke）。
 */
function ringGradient(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  return 'conic-gradient(from -90deg, var(--dsh-color-on-surface-variant) 0% ' + clamped + '%, var(--dsh-color-border) ' + clamped + '% 100%)';
}

function toComposerKind(kind: TriggerKind): ComposerToken['kind'] {
  if (kind === 'reference') return 'file';
  return kind === 'skill' ? 'skill' : 'command';
}

/** 正文里所有已完成的触发 token：Textarea 画不了底色，这里供上方 token 条使用。 */
function composerTokenEntries(text: string): { token: ComposerToken; start: number; end: number }[] {
  return triggerRanges(text).map(range => ({
    token: {
      kind: toComposerKind(range.kind),
      label: text.slice(range.start + 1, range.end),
      value: text.slice(range.start, range.end),
    },
    start: range.start,
    end: range.end,
  }));
}

/**
 * 主机命令表 → 候选行。commands 为 undefined 表示 commands/list 拉失败或主机没有这张表。
 *
 * 对齐 Android PhoneModel.kt:1111-1122：`runCatching { commandsList }.getOrDefault(emptyList())`
 * ——失败与空表都当「这台主机没有命令」，一律不给候选，绝不回落静态内置表（那会插进部署
 * 根本不认识的 /goal、/permission 幽灵命令）。带参数的命令只在行首上下文出现
 * （Mac commandCandidates 的 position == .leading || command.input == nil 口径）。
 */
function hostCommandSuggestions(commands: CommandDescriptor[] | undefined, query: string, leading: boolean): Suggestion[] {
  if (commands === undefined || commands.length === 0) return [];
  const needle = query.toLowerCase();
  return commands
    .filter(command => needle.length === 0 || command.name.toLowerCase().includes(needle))
    .filter(command => leading || command.input === undefined || command.input === null)
    .slice(0, 8)
    .map(command => {
      const hint = commandInputHint(command.input);
      return {
        id: 'cmd:' + command.name,
        title: '/' + command.name,
        subtitle: command.description,
        hint,
        wantsArgs: command.input !== undefined && command.input !== null,
        insert: '/' + command.name + ' ',
      };
    });
}

/** input.hint：跟在命令名后面的参数提示（对齐 Android PhoneSuggestion 的 input?.hint）。 */
function commandInputHint(input: JsonElement | undefined): string | undefined {
  if (input === undefined || input === null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  return str(jget(input, 'hint'));
}

/** 技能候选：与主机命令同列在 / 之后（对齐 Android COMMAND 分支的技能一簇）。 */
function skillSuggestions(skills: SkillEntry[], query: string): Suggestion[] {
  const needle = query.toLowerCase();
  return skills
    .filter(skill => needle.length === 0 || skill.name.toLowerCase().includes(needle))
    .slice(0, 5)
    .map(skill => ({
      id: 'skill:' + skill.name,
      title: '$' + skill.name,
      subtitle: skill.description,
      insert: '$' + skill.name + ' ',
    }));
}

// —— 附件读取 ————————————————————————————————————————————————

function newAttachmentId(): string {
  return 'att-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/** 读成 base64；失败按「这件附件取不到」处理，不把整条输入区带崩。 */
function readBase64(path: string): string | undefined {
  try {
    return wx.getFileSystemManager().readFileSync(path, 'base64');
  } catch {
    return undefined;
  }
}

/**
 * 扩展名 → MIME：与 Android ImageFileType.mimeTypeOf 同表，表里没有的图片退回通配类型。
 *
 * 「这件附件算不算图片」只认 model/imageFileType 的那一份扩展名集合：另起一张表迟早会漂移，
 * .svg/.avif/.tiff 这类图片就会掉进 file 分支，绕过主机的图片上限校验。
 */
const IMAGE_MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
};

function imageMediaTypeOf(path: string): string | undefined {
  if (!isImageFile(path)) return undefined;
  return IMAGE_MEDIA_TYPES[fileExtension(path)] ?? 'image/*';
}

function makeImageAttachment(path: string, name: string): PhoneAttachment | undefined {
  const base64 = readBase64(path);
  if (base64 === undefined || base64.length === 0) return undefined;
  return {
    id: newAttachmentId(),
    name,
    payload: { kind: 'image', mediaType: imageMediaTypeOf(path) ?? 'image/jpeg', base64, preview: path },
  };
}

function makeFileAttachment(path: string, name: string, size: number): PhoneAttachment | undefined {
  // 相册/微信文件都可能夹带图片；图片一律走图片附件，才能过主机的图片上限校验。
  const mediaType = imageMediaTypeOf(path);
  if (mediaType !== undefined) {
    const base64 = readBase64(path);
    if (base64 === undefined || base64.length === 0) return undefined;
    return { id: newAttachmentId(), name, payload: { kind: 'image', mediaType, base64, preview: path } };
  }
  return { id: newAttachmentId(), name, payload: { kind: 'file', filePath: path, name, size } };
}

// —— 小组件 ————————————————————————————————————————————————

function InfoLine(props: { name: LucideIconName; text: string; tone: 'sub' | 'warn' | 'bad' }): JSX.Element {
  return (
    <View className={styles.infoLine}>
      <Icon name={props.name} className={styles.infoGlyph} />
      <Text className={styles.infoText + ' ' + (props.tone === 'warn' ? styles.infoWarn : props.tone === 'bad' ? styles.infoBad : styles.infoSub)}>
        {props.text}
      </Text>
    </View>
  );
}

/** 待办带：只在有条目时出现，点开看全部（对齐 Android TodoStrip）。 */
function TodoStrip(props: { todos: TodoItem[] }): JSX.Element {
  const [expanded, setExpanded] = React.useState(false);
  const todos = props.todos;
  const done = todos.filter(item => item.status === 'completed').length;
  const active = todos.filter(item => item.status === 'in_progress' || item.status === 'in-progress').length;
  const pending = todos.length - done - active;
  const running = todos.find(item => item.status === 'in_progress' || item.status === 'in-progress');
  const header = running === undefined ? Strings.todoPanelTitle : running.content;
  const groups: { name: LucideIconName; spin?: boolean; count: number; className: string }[] = [];
  // 图标字形对齐 Android ComposerBar.kt:653-658：CheckCircle / RadioButtonUnchecked / Autorenew。
  if (done > 0) groups.push({ name: 'circle-check', count: done, className: styles.todoDone });
  if (pending > 0) groups.push({ name: 'circle', count: pending, className: styles.todoPending });
  if (active > 0) groups.push({ name: 'refresh-cw', spin: true, count: active, className: styles.todoActive });
  return (
    <View className={styles.strip}>
      <View className={styles.stripHeader} onClick={() => setExpanded(current => !current)}>
        <Icon name='list-checks' className={styles.stripGlyph} />
        {groups.map((group, index) => (
          <React.Fragment key={group.className}>
            {index > 0 ? <Text className={styles.stripDot}>·</Text> : null}
            <View className={styles.stripCount + ' ' + group.className}>
              <Icon name={group.name} spin={group.spin} />
              <Text>{' ' + group.count}</Text>
            </View>
          </React.Fragment>
        ))}
        <Text className={styles.stripTitle}>{header}</Text>
        {/* 折叠态也是向下箭头（对齐 Android ExpandMore，语义是「展开更多」而非「进入下级」）。 */}
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} className={styles.stripChevron} />
      </View>
      {expanded ? (
        <View className={styles.todoList}>
          {todos.map(item => (
            <View key={item.id} className={styles.todoRow}>
              <Icon
                name={todoStatusIcon(item.status).name}
                spin={todoStatusIcon(item.status).spin}
                className={styles.todoItemGlyph + ' ' + todoStatusClass(item.status)}
              />
              <Text className={styles.todoContent}>{item.content}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function todoStatusIcon(status: string): { name: LucideIconName; spin?: boolean } {
  if (status === 'completed') return { name: 'circle-check' };
  if (status === 'in_progress' || status === 'in-progress') return { name: 'refresh-cw', spin: true };
  return { name: 'circle' };
}

function todoStatusClass(status: string): string {
  if (status === 'completed') return styles.todoDone;
  if (status === 'in_progress' || status === 'in-progress') return styles.todoActive;
  return styles.todoPending;
}

/**
 * 被收起的 continued 问题（0.2.0）：agent 已经继续干活，这组问题仍可回答，点「回答」重新打开弹层
 *（web 从工具行重开；对齐 Android HiddenQuestionStrip）。
 */
function HiddenQuestionStrip(props: { question: QuestionRequested; onReopen: () => void }): JSX.Element {
  return (
    <View className={styles.goalBar}>
      <Icon name='circle-help' className={styles.goalGlyph} />
      <Text className={styles.goalText}>{props.question.questions[0]?.question ?? Strings.questionWaitContinued}</Text>
      <Text className={styles.hiddenQuestionAction} onClick={props.onReopen}>{Strings.questionReopen}</Text>
    </View>
  );
}

/** 目标条：有目标才出现，可暂停/恢复、编辑、清除（对齐 Android GoalBar）。 */
function GoalBar(props: {
  goal: GoalProjection;
  /** active 但主机不会自己续跑（0.2.1 activation = disarmed）：按已暂停画、给恢复。 */
  disarmed: boolean;
  onTogglePause: () => void;
  onEdit: (objective: string) => void;
  onClear: () => void;
}): JSX.Element {
  const goal = props.goal;
  // 锚定菜单取代 wx.showActionSheet（对齐 Android ComposerBar.kt:736-762 的 DropdownMenu）：
  // 系统动作面板在底部、无图标、也不能只把「清空」染红，形态与安卓差得远。
  const [menuAnchor, setMenuAnchor] = React.useState<ActionMenuAnchor | undefined>(undefined);
  const [editing, setEditing] = React.useState(false);

  const menuItems = React.useMemo((): ActionMenuItem[] => {
    // 只映射主机真的接受的转移：pause 仅 active、resume 仅 paused；blocked 两个都不给
    // （对齐 Android GoalPhaseAction.kt）。给了也只会被主机回 GOAL_INVALID_TRANSITION。
    const phaseAction = goalPhaseAction(goal.phase, props.disarmed);
    const items: ActionMenuItem[] = [];
    if (phaseAction !== undefined) {
      items.push(
        phaseAction === 'resume'
          ? { key: 'resume', label: Strings.goalResume, icon: 'play' }
          : { key: 'pause', label: Strings.goalPause, icon: 'pause' },
      );
    }
    items.push({ key: 'edit', label: Strings.goalEdit, icon: 'pencil' });
    // 清空是破坏性动作，安卓单独染 error 色（ComposerBar.kt:760）。
    items.push({ key: 'clear', label: Strings.goalClear, icon: 'trash-2', danger: true });
    return items;
  }, [goal.phase, props.disarmed]);

  const selectMenu = (key: string): void => {
    setMenuAnchor(undefined);
    if (key === 'pause' || key === 'resume') props.onTogglePause();
    else if (key === 'edit') setEditing(true);
    else props.onClear();
  };

  return (
    <View className={styles.goalBar}>
      <Icon name={goal.phase === 'paused' || props.disarmed ? 'pause-circle' : 'flag'} className={styles.goalGlyph} />
      <Text className={styles.goalText}>{goal.objective}</Text>
      <Icon
        name='ellipsis'
        className={styles.goalMore}
        ariaLabel={Strings.goalMenu}
        onClick={event => setMenuAnchor(anchorFromEvent(event))}
      />
      <ActionMenu anchor={menuAnchor} items={menuItems} onSelect={selectMenu} onClose={() => setMenuAnchor(undefined)} width={168} />
      <EditDialog
        open={editing}
        title={Strings.goalEdit}
        label={Strings.goalObjective}
        initial={goal.objective}
        onSubmit={value => { setEditing(false); props.onEdit(value); }}
        onClose={() => setEditing(false)}
      />
    </View>
  );
}

/**
 * 排队中的消息：可编辑、插队发送、撤回（对齐 Android QueueStrip）。
 *
 * 只画 placement === 'queued'：一旦点了插队发送，主机把它挪进 next-step，那一行
 * 就改由转写尾部的待定气泡接管，必须立刻从这条上消失。
 */
function QueueStrip(props: {
  items: QueuedInboxItem[];
  running: boolean;
  onEdit: (itemId: string, text: string) => void | Promise<unknown>;
  onSteer: (itemId: string) => void | Promise<unknown>;
  onRemove: (itemId: string) => void | Promise<unknown>;
}): JSX.Element {
  const [busy, setBusy] = React.useState<string[]>([]);
  // 编辑中的那一行；用自绘多行弹层而不是 wx.showModal（对齐 Android ComposerBar.kt:860-872
  // 的 AlertDialog + OutlinedTextField），队列文本常是整段话，系统单行框编辑不了。
  const [editing, setEditing] = React.useState<QueuedInboxItem | undefined>(undefined);
  // 动作返回 Promise 时等它落定再解锁（对齐 Android 在协程 finally 里移除 busy）；
  // 主机回声很快，固定超时要么早解锁（连点）要么多锁一会儿。
  const run = (itemId: string, action: () => void | Promise<unknown>): void => {
    if (busy.includes(itemId)) return;
    setBusy(current => current.concat([itemId]));
    void Promise.resolve(action()).finally(() =>
      setBusy(current => current.filter(id => id !== itemId)),
    );
  };
  const edit = (item: QueuedInboxItem): void => {
    setEditing(item);
  };
  return (
    <View className={styles.queueStrip}>
      {props.items.map(item => {
        // 一行的动作在飞行中时整行都禁掉（对齐 Android ComposerBar.kt:829/836/852 的
        // enabled = item.id !in busy）：否则编辑弹层还能打开、填完提交却被 run 的 busy
        // 早退静默丢掉，用户看到的是「内容凭空消失」。
        const inFlight = busy.includes(item.id);
        const steerable = props.running && !inFlight;
        const off = ' ' + styles.queueActionOff;
        return (
          <View key={item.id} className={styles.queueRow}>
            <Icon name='clock' className={styles.queueGlyph} />
            <Text className={styles.queueText}>{queuedItemText(item)}</Text>
            <Icon
              name='pencil'
              ariaLabel={Strings.queueEdit}
              className={styles.queueAction + (inFlight ? off : '')}
              onClick={() => {
                if (!inFlight) edit(item);
              }}
            />
            <Icon
              name='send'
              ariaLabel={Strings.queueSteer}
              className={styles.queueAction + (steerable ? '' : off)}
              onClick={() => {
                if (steerable) run(item.id, () => props.onSteer(item.id));
              }}
            />
            <Icon
              name='x'
              ariaLabel={Strings.queueRemove}
              className={styles.queueAction + (inFlight ? off : '')}
              onClick={() => {
                if (!inFlight) run(item.id, () => props.onRemove(item.id));
              }}
            />
          </View>
        );
      })}
      <EditDialog
        open={editing !== undefined}
        title={Strings.queueEdit}
        // 对齐 OutlinedTextField 的常驻 label：安卓这里没有单独 label，用输入提示占位。
        label={Strings.queueEdit}
        initial={editing === undefined ? '' : queuedItemText(editing)}
        onSubmit={value => {
          const item = editing;
          setEditing(undefined);
          if (item !== undefined) run(item.id, () => props.onEdit(item.id, value));
        }}
        onClose={() => setEditing(undefined)}
      />
    </View>
  );
}

/** 附件缩略：选图时拿到的本地临时路径直接当 src（还没发出去，主机那边没有这张图）。 */
function AttachmentThumb(props: { attachment: PhoneAttachment }): JSX.Element {
  const payload = props.attachment.payload;
  if (payload.kind !== 'image') return <Icon name='file-text' className={styles.chipGlyph} />;
  return <Image className={styles.thumb} src={payload.preview} mode='aspectFill' />;
}

// —— 主组件 ————————————————————————————————————————————————

export function ComposerBar(props: ComposerBarProps): JSX.Element {
  const { sessionId } = props;
  const model = getAppModel();
  const safeBottom = useSafeBottom();
  // ensureSession 幂等：会话页通常已经 open 过，这里只是保证订阅一定拿得到 store。
  const store = React.useMemo(() => model.ensureSession(sessionId), [model, sessionId]);

  const running = useStore(store.runningStore);
  const imageLimits = useStore(store.imageLimitsStore);
  const permissions = useStore(store.permissionsStore);
  const modelDirectory = useStore(store.modelDirectoryStore);
  const subagentAddress = useStore(store.subagentAddressStore);
  const historyError = useStore(store.historyErrorStore);
  const queue = useStore(store.queueStore);
  const todos = useStore(store.todosStore);
  const goal = useStore(store.goalStore);
  const goalActivation = useStore(store.goalActivationStore);
  void goalActivation;
  const goalDisarmed = store.goalDisarmed;
  // 目标换了版本、或会话开始/停止运行时重读 activation（对齐 web `createGoalActivationSource`）。
  React.useEffect(() => {
    if (goal?.phase === 'active') void model.refreshGoalActivation(sessionId);
  }, [model, sessionId, goal?.id, goal?.revision, goal?.phase, running]);
  const presentedQuestion = useStore(store.presentedQuestionStore);
  const continuedQuestions = useStore(store.continuedQuestionsStore);
  // 弹层没在呈现问题、但还有可答的 continued 问题（都被收起了）：输入框上方给一条入口。
  const hiddenQuestion = presentedQuestion === undefined ? continuedQuestions[0] : undefined;

  const initialDraft = (): string => readDraft(sessionId) || (props.initialDraft ?? '');
  const [draft, setDraft] = React.useState<string>(initialDraft);
  const [cursor, setCursor] = React.useState<number>(() => initialDraft().length);
  const [attachments, setAttachments] = React.useState<PhoneAttachment[]>([]);
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
  const [commandLauncher, setCommandLauncher] = React.useState(false);
  const [focused, setFocused] = React.useState(props.autoFocus === true);
  const [lineCount, setLineCount] = React.useState(1);
  const [planTarget, setPlanTarget] = React.useState<boolean | undefined>(undefined);
  const [occupancy, setOccupancy] = React.useState<number | undefined>(undefined);
  // 宿主没注入 onOpenModel/onOpenContext 时（新建会话页），输入区自己持有这两个弹层开关；
  // Android 的 ComposerBar 就是把 ModelPickerSheet/ContextSheet 挂在组件内部
  // （ComposerBar.kt:415-416），新建会话页复用输入区即自动获得完整能力。
  const [showModelSheet, setShowModelSheet] = React.useState(false);
  const [showContextSheet, setShowContextSheet] = React.useState(false);

  // 刚发出去的那串文字：输入法有时会拿旧文字再回调一次 onInput，紧跟着的第一次原样回灌直接丢掉。
  const sentEcho = React.useRef<{ text: string; at: number } | null>(null);
  const suggestionGeneration = React.useRef(0);

  React.useEffect(() => {
    const saved = initialDraft();
    setDraft(saved);
    setCursor(saved.length);
    setAttachments([]);
    setSuggestions([]);
    setCommandLauncher(false);
    sentEcho.current = null;
  }, [sessionId]);

  React.useEffect(() => {
    void model.loadModels(sessionId);
  }, [model, sessionId]);

  // planModeTarget / contextOccupancy 是投影派生量，会话窗口没有为它们单独发快照 Store；
  // 直接订阅 nodesStore 会被每个流式增量带着重绘整块输入区。改订阅 derivedProjectionStore
  // 这个只在 plan / contextPressure 落值时才 +1 的计数器，再去读 getter：既不被流式增量
  // 拖着重绘，也不再有轮询造成的最多 1s 延迟（对齐 Android 直读 store.planModeTarget）。
  const derivedVersion = useStore(store.derivedProjectionStore);

  React.useEffect(() => {
    setPlanTarget(store.planModeTarget);
    setOccupancy(store.contextOccupancy?.percent);
  }, [store, derivedVersion]);

  // 队列条只认 next-turn 的待发项：steering（已点过插队、等步骤边界）与 context 注入项
  // 都不画（对齐 Android ComposerBar.kt:223 的 store.queued）。口径收敛在这一处，
  // 条件判断与传参共用，避免出现「0 行的空条」还占着 flex 间距。
  const queuedItems = React.useMemo(() => queue.filter(item => item.placement === 'queued'), [queue]);

  const rejection = attachments.length === 0 ? undefined : attachmentRejection(attachments, imageLimits);

  const publishDraft = React.useCallback((text: string) => {
    setDraft(text);
    writeDraft(sessionId, text);
    // 与 Android 的 isNotBlank 同口径：只有纯空白也不该在列表行上亮「草稿」。
    model.listStore.setDraft(sessionId, text.trim().length > 0);
  }, [model, sessionId]);

  const clearComposer = React.useCallback(() => {
    publishDraft('');
    setCursor(0);
    setAttachments([]);
    setSuggestions([]);
    setCommandLauncher(false);
  }, [publishDraft]);

  const refreshSuggestions = React.useCallback((text: string, caret: number): void => {
    const token = activeTrigger(text, caret);
    if (token === undefined) {
      setSuggestions([]);
      return;
    }
    const generation = suggestionGeneration.current + 1;
    suggestionGeneration.current = generation;
    const leading = text.slice(0, token.start).trim().length === 0;
    const kind = token.kind;
    const query = token.query;
    Promise.resolve()
      .then(async () => {
        if (kind === 'reference') {
          // 文件引用与「会话引用」同列：主机 fileReferences/list 拿文件，
          // sessionReferenceResolver/candidates 拿可 @ 的别的会话
          // （对齐 Android PhoneModel.suggestions 的 REFERENCE 分支）。
          const files = await model.loadFileReferences(sessionId, query).catch(() => []);
          const sessions = await model.loadSessionReferenceCandidates(sessionId, query).catch(() => []);
          return [
            ...files.slice(0, 8).map<Suggestion>(file => ({
              id: 'file:' + file.path,
              title: pathBasename(file.path),
              subtitle: file.path,
              insert: '@' + file.path + ' ',
            })),
            ...sessions.slice(0, 5).map<Suggestion>(item => ({
              id: 'session:' + item.sessionId,
              title: item.label,
              subtitle: item.cwd,
              insert: item.mention + ' ',
            })),
          ];
        }
        if (kind === 'skill') {
          const value = await model.loadSkills(sessionId);
          return skillSuggestions(value.skills, query);
        }
        // 命令与技能同列：主机命令表优先，拉不到才退回静态内置表。
        const commands = await model.loadCommands(sessionId).catch(() => undefined);
        const skills = await model.loadSkills(sessionId).then(value => value.skills).catch(() => [] as SkillEntry[]);
        return [
          ...hostCommandSuggestions(commands, query, leading),
          ...skillSuggestions(skills, query),
        ];
      })
      .catch(() => [] as Suggestion[])
      .then(items => {
        if (suggestionGeneration.current !== generation) return;
        setSuggestions(items);
      });
  }, [model, sessionId]);

  const launchCommandLauncher = React.useCallback((): void => {
    const at = Math.min(Math.max(cursor, 0), draft.length);
    const leading = draft.slice(0, at).trim().length === 0;
    setCommandLauncher(true);
    const generation = suggestionGeneration.current + 1;
    suggestionGeneration.current = generation;
    void Promise.resolve()
      .then(async () => {
        const commands = await model.loadCommands(sessionId).catch(() => undefined);
        const skills = await model.loadSkills(sessionId).then(value => value.skills).catch(() => [] as SkillEntry[]);
        return [...hostCommandSuggestions(commands, '', leading), ...skillSuggestions(skills, '')];
      })
      .then(items => {
        if (suggestionGeneration.current !== generation) return;
        setSuggestions(items);
      });
  }, [cursor, draft, model, sessionId]);

  const pickSuggestion = React.useCallback((suggestion: Suggestion): void => {
    const token = activeTrigger(draft, cursor);
    if (token !== undefined) {
      // 替换触发 token，并把光标落到插入内容之后（胶囊后面）。
      const text = draft.slice(0, token.start) + suggestion.insert + draft.slice(token.end);
      publishDraft(text);
      setCursor(token.start + suggestion.insert.length);
    } else if (commandLauncher) {
      // 加号启动器：草稿里没有可替换的斜杠 token，就插到光标处，正文原样留着。
      const at = Math.min(Math.max(cursor, 0), draft.length);
      const text = draft.slice(0, at) + suggestion.insert + draft.slice(at);
      publishDraft(text);
      setCursor(at + suggestion.insert.length);
    }
    setCommandLauncher(false);
    setSuggestions([]);
  }, [commandLauncher, cursor, draft, publishDraft]);

  const handleInput = React.useCallback((value: string, caret: number): void => {
    const echo = sentEcho.current;
    if (echo !== null && value === echo.text && Date.now() - echo.at < 1500) {
      // 输入法把刚发出去的那句原样送了回来：留住空输入框，别写回草稿。
      sentEcho.current = null;
      publishDraft('');
      setCursor(0);
      return;
    }
    sentEcho.current = null;
    const next = atomicTokenEdit(value, caret, draft);
    publishDraft(next.text);
    setCursor(next.cursor);
    setCommandLauncher(false);
    refreshSuggestions(next.text, next.cursor);
  }, [draft, publishDraft, refreshSuggestions]);

  const removeToken = React.useCallback((start: number, end: number): void => {
    const text = draft.slice(0, start) + draft.slice(end);
    publishDraft(text);
    setCursor(start);
    setSuggestions([]);
  }, [draft, publishDraft]);

  const send = React.useCallback(async (): Promise<void> => {
    if (rejection !== undefined) return;
    const address = subagentAddress;
    if (address !== undefined) {
      if (address.mode !== 'continuable') return;
      const text = draft;
      if (text.trim().length === 0) return;
      sentEcho.current = { text, at: Date.now() };
      clearComposer();
      await model.sendToSubagent(address, text);
      props.onSubmitted?.(sessionId);
      return;
    }
    const text = draft;
    const files = attachments;
    if (text.trim().length === 0 && files.length === 0) return;
    // 发送给一次触觉反馈（对齐 Android ComposerBar 的 TextHandleMove）。
    try {
      wx.vibrateShort({ type: 'light' });
    } catch {
      // 不支持震动的环境忽略。
    }
    sentEcho.current = { text, at: Date.now() };
    clearComposer();
    const accepted = await model.send(text, sessionId, files);
    if (!accepted) {
      // 失败时 appModel 已经把 pendingSubmission 退掉；这里只负责把原因端给用户。
      toast(Strings.sendFailed, 'none');
      return;
    }
    props.onSubmitted?.(sessionId);
  }, [attachments, clearComposer, draft, model, props, rejection, sessionId, subagentAddress]);

  const choosePhoto = React.useCallback((): void => {
    wx.chooseMedia({
      count: 4,
      mediaType: ['image'],
      // 只从相册取图，不给相机来源（对齐 Android ComposerBar.kt:314-316 PickVisualMedia）。
      sourceType: ['album'],
      success: res => {
        const picked = res.tempFiles
          // 附件名取临时路径 basename，多张相册图才分得清（对齐 Android 的 DISPLAY_NAME，
          // 取不到时退回 uri.lastPathSegment；小程序没有 DISPLAY_NAME，basename 最接近）。
          .map(file => makeImageAttachment(file.tempFilePath, pathBasename(file.tempFilePath) || 'image'))
          .filter((item): item is PhoneAttachment => item !== undefined);
        if (picked.length > 0) setAttachments(current => current.concat(picked));
      },
      fail: () => {
        // 取消选择。
      },
    });
  }, []);

  const chooseFile = React.useCallback((): void => {
    wx.chooseMessageFile({
      count: 4,
      type: 'file',
      success: res => {
        const picked = res.tempFiles
          .map(file => makeFileAttachment(file.path, file.name ?? pathBasename(file.path), file.size ?? 0))
          .filter((item): item is PhoneAttachment => item !== undefined);
        if (picked.length > 0) setAttachments(current => current.concat(picked));
      },
      fail: () => {
        // 取消选择。
      },
    });
  }, []);

  // 权限选择改自绘锚定浮层（对齐 Android ComposerBar.kt:336-360 的 DropdownMenu）；
  // 权限项很多，自绘也不用再分页翻页。
  // 附件选择也是锚定菜单（对齐 Android ComposerBar.kt:308-326 的 DropdownMenu + Image /
  // InsertDriveFile leadingIcon），不是系统底部面板。
  const [attachMenu, setAttachMenu] = React.useState<ActionMenuAnchor | undefined>(undefined);
  const attachMenuItems = React.useMemo((): ActionMenuItem[] => [
    { key: 'photo', label: Strings.pickPhoto, icon: 'image' },
    { key: 'file', label: Strings.pickFile, icon: 'file-text' },
  ], []);
  const selectAttach = React.useCallback((key: string): void => {
    setAttachMenu(undefined);
    if (key === 'photo') choosePhoto();
    else chooseFile();
  }, [choosePhoto, chooseFile]);

  const [permissionMenu, setPermissionMenu] = React.useState<ActionMenuAnchor | undefined>(undefined);

  const permissionMenuItems = React.useMemo((): ActionMenuItem[] => {
    const options = permissionSelectableOptions(permissions);
    // 权限项不带当前项勾选标记（对齐 Android ComposerBar.kt:342-343 的 DropdownMenuItem）。
    return options.map(option => ({
      key: option.value,
      label: permissionTitle(option.value, option.name),
      // 危险档单独染 warning 色（对齐安卓 danger 档的强调处理）。
      danger: option.value === 'danger-full-access',
    }));
  }, [permissions]);

  const selectPermission = React.useCallback((value: string): void => {
    setPermissionMenu(undefined);
    if (value === permissions?.currentValue) return;
    if (value === 'danger-full-access') {
      wx.showModal({
        title: Strings.fullAccessTitle,
        content: Strings.fullAccessMessage,
        confirmText: Strings.fullAccessConfirm,
        cancelText: Strings.cancel,
        success: res => {
          if (res.confirm) void model.selectPermission(value, sessionId);
        },
      });
      return;
    }
    void model.selectPermission(value, sessionId);
  }, [model, permissions, sessionId]);

  const openModelPicker = React.useCallback((): void => {
    // 宿主给了完整模型弹层（含思考强度 Tab）就用它；否则输入区自己开一份——
    // Android 的 ComposerBar 自带 ModelPickerSheet，新建会话页同样能换模型。
    if (props.onOpenModel !== undefined) {
      props.onOpenModel();
      return;
    }
    setShowModelSheet(true);
  }, [props]);

  const openContext = React.useCallback((): void => {
    // 宿主注入就用宿主的；否则自己开一份（对齐 Android ComposerBar.kt:416 自带 ContextSheet）。
    // 安卓在输入区没有「压缩上下文」按钮（要压缩就敲 /compact）。
    if (props.onOpenContext !== undefined) {
      props.onOpenContext();
      return;
    }
    setShowContextSheet(true);
  }, [props]);

  const currentPermission = permissionCurrentOption(permissions);
  const permissionLabel = currentPermission === undefined
    ? Strings.permissions
    : permissionTitle(currentPermission.value, currentPermission.name);
  const modelLabel = modelDirectory.current?.model ?? Strings.model;

  // 子智能体 takeover 文案：与 Android ComposerBar.kt:176-178 同口径，位置在候选面板之后、
  // 附件条之前的那行 InfoLine（ComposerBar.kt:244）。
  const takeover = subagentAddress === undefined
    ? undefined
    : subagentAddress.mode === 'continuable' ? Strings.subagentComposer : Strings.subagentReadOnly;
  const sendDisabled = (draft.trim().length === 0 && attachments.length === 0) || rejection !== undefined;
  // 停止键只看「正文是否为空」，不看附件（对齐 Android ComposerBar：running && text.isBlank）。
  const showStop = running && draft.trim().length === 0;

  const tokens = composerTokenEntries(draft);
  // 正文行高 24px（对齐 Android bodyLarge 的 24sp 行高，ComposerBar.kt:505）。
  const textareaHeight = Math.min(Math.max(lineCount, 1), 6) * 24 + 16;

  return (
    <View className={styles.root} style={{ paddingBottom: (8 + safeBottom) + 'px' }}>
      {props.header === undefined ? null : <View className={styles.header}>{props.header}</View>}
      {todos.length > 0 ? <TodoStrip todos={todos} /> : null}
      {/* 完成态的目标不再画出来：条上的暂停/编辑/清除都经 goalRef（= activeGoal），
          对 complete 会静默失效（对齐 Android SessionStore.activeGoal / ComposerBar GoalBar）。 */}
      {goal === undefined || goal.phase === 'complete' ? null : (
        <GoalBar
          goal={goal}
          disarmed={goalDisarmed}
          onTogglePause={() => { void model.toggleGoalPause(sessionId); }}
          onEdit={objective => { void model.editGoal(objective, sessionId); }}
          onClear={() => { void model.clearGoal(sessionId); }}
        />
      )}
      {hiddenQuestion === undefined ? null : (
        <HiddenQuestionStrip
          question={hiddenQuestion}
          onReopen={() => { if (hiddenQuestion.callId !== undefined) store.reopenQuestion(hiddenQuestion.callId); }}
        />
      )}
      {queuedItems.length > 0 ? (
        <QueueStrip
          items={queuedItems}
          running={running}
          onEdit={(itemId, text) => model.queueMutation(sessionId, itemId, { kind: 'edit', text }, Strings.queueEditFailed)}
          onSteer={itemId => model.queueMutation(sessionId, itemId, { kind: 'steer' }, Strings.queueSteerFailed)}
          onRemove={itemId => model.queueMutation(sessionId, itemId, { kind: 'remove' }, Strings.queueRemoveFailed)}
        />
      ) : null}

      {suggestions.length > 0 ? (
        <ScrollView scrollY className={styles.suggestionPanel}>
          {suggestions.map(suggestion => (
            <View key={suggestion.id} className={styles.suggestionRow} onClick={() => pickSuggestion(suggestion)}>
              <Text className={styles.suggestionTitle}>{suggestion.title}</Text>
              {suggestion.hint === undefined ? null : <Text className={styles.suggestionHint}>{suggestion.hint}</Text>}
              {suggestion.subtitle === undefined ? null : <Text className={styles.suggestionSubtitle}>{suggestion.subtitle}</Text>}
            </View>
          ))}
        </ScrollView>
      ) : null}

      {/* 子智能体 takeover：位置对齐 Android ComposerBar.kt:244（候选面板之后、附件条之前），
          属于输入区的一部分；chat 页顶部那条子会话入口条保留，不重复渲染同一文案。 */}
      {takeover === undefined ? null : <InfoLine name='users' text={takeover} tone='sub' />}
      {rejection === undefined ? null : <InfoLine name='triangle-alert' text={rejection} tone='warn' />}
      {historyError === undefined ? null : <InfoLine name='circle-alert' text={historyError.message} tone='bad' />}

      {tokens.length > 0 ? (
        <ScrollView scrollX className={styles.tokenStrip}>
          <View className={styles.tokenRow}>
            {tokens.map(entry => (
              <View key={entry.start + ':' + entry.token.value} className={styles.tokenPill} onClick={() => removeToken(entry.start, entry.end)}>
                <Text className={styles.tokenText}>{entry.token.value}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}

      {attachments.length > 0 ? (
        <ScrollView scrollX className={styles.attachmentStrip}>
          <View className={styles.attachmentRow}>
            {attachments.map(attachment => (
              <View key={attachment.id} className={styles.chip}>
                <AttachmentThumb attachment={attachment} />
                <Text className={styles.chipText}>{attachment.name}</Text>
                <Icon
                  name='x'
                  className={styles.chipRemove}
                  ariaLabel={fmt(Strings.removeAttachmentNamed, attachment.name)}
                  onClick={() => setAttachments(current => current.filter(item => item.id !== attachment.id))}
                />
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}

      <View className={styles.card}>
        <Textarea
          className={styles.textarea}
          style={{ height: textareaHeight + 'px' }}
          value={draft}
          cursor={cursor}
          maxlength={-1}
          placeholder={Strings.composerPlaceholder}
          focus={focused}
          disableDefaultPadding
          showConfirmBar={false}
          adjustPosition
          onBlur={() => setFocused(false)}
          onInput={event => handleInput(event.detail.value, event.detail.cursor)}
          onSelectionChange={event => {
            const detail = event.detail as { selectionStart?: number };
            if (typeof detail.selectionStart === 'number') setCursor(detail.selectionStart);
          }}
          onLineChange={event => setLineCount(event.detail.lineCount)}
        />
        <View className={styles.controls}>
          {/* 加号与附件入口固定在左侧、不随控制行横滚（对齐 Android：只有权限/计划/模型那段可滚）。 */}
          <Icon name='plus' className={styles.launcher} ariaLabel={Strings.commands} onClick={() => {
            // 加号是命令启动器：草稿为空时落一个 "/"，已有正文时只换菜单、绝不动正文。
            if (commandLauncher) {
              setCommandLauncher(false);
              setSuggestions([]);
              return;
            }
            if (draft.length === 0) {
              publishDraft('/');
              setCursor(1);
              refreshSuggestions('/', 1);
              return;
            }
            launchCommandLauncher();
          }} />
          <Icon
            name='paperclip'
            className={styles.launcher + ' ' + styles.attachLauncher}
            ariaLabel={Strings.attachFile}
            onClick={event => setAttachMenu(anchorFromEvent(event))}
          />
          <ScrollView scrollX className={styles.actionScroll}>
            <View className={styles.actionRow}>
              <Text
                className={styles.controlAction + (permissions?.currentValue === 'danger-full-access' ? ' ' + styles.controlWarn : '')}
                onClick={event => setPermissionMenu(anchorFromEvent(event))}
              >
                {permissionLabel}
              </Text>
              {/* 只在计划模式已开启时给一个可关闭的 chip；开启走 /plan 命令
                  （对齐 Android：没有「点一下开启」的入口，避免与命令语义冲突）。 */}
              {planTarget === true ? (
                <View className={styles.planChip} onClick={() => { void model.setPlanMode(false, sessionId); }}>
                  <Text className={styles.planChipText}>{Strings.planMode}</Text>
                  <Icon name='x' className={styles.planChipText} />
                </View>
              ) : null}
              {/* Agent 预设只在新建会话页选：会话开跑后再换预设，已经发生的轮次不会重来，
                  留一个半生效的入口只会误导（对齐 Android ComposerBar 没有这个入口）。 */}
              <Text className={styles.controlAction} onClick={openModelPicker}>{modelLabel}</Text>
            </View>
          </ScrollView>
          {occupancy === undefined ? null : (
            // 占用环：32px 命中区里画 18px 进度弧（对齐 Android ComposerBar.kt:596-618），
            // conic-gradient 画弧、内层挖空，不画百分比文字（安卓没有文字）。
            <View className={styles.contextRing} onClick={openContext}>
              <View className={styles.contextRingArc} style={{ background: ringGradient(occupancy) }} />
              <View className={styles.contextRingHole} />
            </View>
          )}
          {showStop ? (
            <View className={styles.stopButton} onClick={() => {
              if (subagentAddress !== undefined) void model.interruptSubagent(subagentAddress);
              else void model.stop(sessionId);
            }}>
              <View className={styles.stopCircle} ariaLabel={Strings.stop}>
                <View className={styles.stopSquare} />
              </View>
            </View>
          ) : (
            <View
              className={styles.sendButton}
              aria-label={Strings.send}
              onClick={() => {
                // 只读子会话不置灰、也不在这里拦截；send() 内部对非 continuable 静默早退
                // （对齐 Android ComposerBar.kt:179,184-187,399：sendDisabled 不含子会话模式）。
                if (!sendDisabled) void send();
              }}
            >
              {/* 运行中发送就是排队，图标仍是发送（对齐 Android：没有单独的 enqueue 文案）。 */}
              <View className={styles.sendCircle + (sendDisabled ? ' ' + styles.sendCircleOff : '')}>
                <Icon
                  name='send'
                  ariaLabel={Strings.send}
                  className={sendDisabled ? styles.sendLabelOff : styles.sendLabel}
                />
              </View>
            </View>
          )}
        </View>
      </View>
      {showModelSheet ? (
        <ModelPickerSheet open sessionId={sessionId} onClose={() => setShowModelSheet(false)} />
      ) : null}
      {showContextSheet ? (
        <ContextSheet open sessionId={sessionId} onClose={() => setShowContextSheet(false)} />
      ) : null}
      {/* 权限/附件浮层挂在输入卡外层：锚点是 fixed 定位，不受输入卡 overflow 裁剪。 */}
      <ActionMenu
        anchor={permissionMenu}
        items={permissionMenuItems}
        onSelect={selectPermission}
        onClose={() => setPermissionMenu(undefined)}
        width={240}
      />
      <ActionMenu
        anchor={attachMenu}
        items={attachMenuItems}
        onSelect={selectAttach}
        onClose={() => setAttachMenu(undefined)}
        width={168}
      />
    </View>
  );
}
import type { JsonElement } from './json';

export type SessionId = string;
export type MessageId = string;
export type WorkspaceId = string;
export type AttachmentId = string;
export type CallId = string;

export interface RpcError {
  code: string;
  message: string;
  details?: JsonElement;
}

// 会话 —————————————————————————————————————————————————————————

export interface SessionProjectionsBlock {
  asOfSeq: number;
  values: Record<string, JsonElement>;
}

export interface SessionSummary {
  sessionId: SessionId;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  parentSessionId?: SessionId;
  origin?: string;
  cwd?: string;
  agentPreset?: string;
  projections?: SessionProjectionsBlock;
}

/** 子智能体归父会话的面板管，不进顶层列表、也不进搜索。 */
export function isSubagentOrigin(summary: SessionSummary): boolean {
  return summary.origin === 'subagent';
}

export interface SessionListValue { items: SessionSummary[] }
export interface SessionSearchItem { sessionId: SessionId; snippet: string }
export interface SessionSearchValue { items: SessionSearchItem[]; hasMore: boolean }
export interface SessionCreateValue { sessionId: SessionId; agentPreset?: string }
export interface SessionForkValue { sessionId: SessionId }
export interface FileReferenceItem { path: string; kind: string }
export interface SessionReferenceItem {
  mention: string;
  sessionId: SessionId;
  label: string;
  cwd?: string;
  createdAt: number;
}

// 模型目录 ————————————————————————————————————————————————————

export interface ModelSelection { provider: string; model: string; reasoningEffort?: string }
export interface ModelReasoningEffort { id: string; name: string; description?: string }
export interface ModelReasoning { efforts: ModelReasoningEffort[]; defaultEffort?: string }
export interface ModelCatalogModel { id: string; name: string; description?: string; reasoning?: ModelReasoning }
export interface ModelProviderGroup { id: string; name: string; models: ModelCatalogModel[] }
export interface ModelCatalogFailure { id: string; name: string; message: string }
export interface ModelCatalogValue {
  default: ModelSelection;
  routableProviders: string[];
  groups: ModelProviderGroup[];
  failures?: ModelCatalogFailure[];
}
export interface SessionModelsValue {
  current: ModelSelection;
  routable: boolean;
  groups: ModelProviderGroup[];
  failures: ModelCatalogFailure[];
}
export interface SessionSelectModelValue { selected: ModelSelection }

export type ModelDirectoryStatus = 'idle' | 'loading' | 'ready' | 'selecting' | 'error';

export interface ModelDirectoryState {
  current?: ModelSelection;
  projected?: ModelSelection;
  routable?: boolean;
  groups: ModelProviderGroup[];
  failures: ModelCatalogFailure[];
  status: ModelDirectoryStatus;
  error?: string;
  generation: number;
}

export function modelDirectoryBeginLoading(state: ModelDirectoryState): ModelDirectoryState {
  return { ...state, generation: state.generation + 1, status: 'loading', error: undefined };
}

export function modelDirectoryBeginSelecting(state: ModelDirectoryState): ModelDirectoryState {
  return { ...state, generation: state.generation + 1, status: 'selecting', error: undefined };
}

export function modelDirectoryReceiveModels(
  state: ModelDirectoryState,
  value: SessionModelsValue,
  expected: number,
): ModelDirectoryState {
  if (state.generation !== expected) return state;
  return {
    ...state,
    current: state.projected === undefined ? value.current : state.current,
    routable: value.routable,
    groups: value.groups,
    failures: value.failures,
    status: 'ready',
    error: undefined,
  };
}

export function modelDirectoryReceiveSelected(
  state: ModelDirectoryState,
  value: SessionSelectModelValue,
  expected: number,
): ModelDirectoryState {
  if (state.generation !== expected) return state;
  return {
    ...state,
    projected: undefined,
    current: value.selected,
    routable: true,
    status: 'ready',
    error: undefined,
  };
}

export function modelDirectoryApplyProjected(
  state: ModelDirectoryState,
  selection: ModelSelection,
): ModelDirectoryState {
  return {
    ...state,
    projected: selection,
    current: selection,
    routable: state.groups.some(group => group.id === selection.provider) ? true : state.routable,
  };
}

export function modelDirectoryFail(state: ModelDirectoryState, message: string, expected: number): ModelDirectoryState {
  if (state.generation !== expected) return state;
  return { ...state, status: 'error', error: message };
}

// 权限 ————————————————————————————————————————————————————————

export interface PermissionPresetOption { value: string; name: string; description?: string }

/**
 * `permissions` 会话投影的 wire 值：在位的那个选择。
 *
 * 0.1.6 把这个投影收窄成只剩 currentValue，可选预设改由 PermissionCatalogValue 的另一条 RPC
 * 发布；options 仍保留且可缺省，因为 0.1.5 主机仍把列表内联在这里，客户端要能连两个版本。
 */
export interface PermissionSelectValue { options?: PermissionPresetOption[]; currentValue: string }

/** `permissionPresets/catalog` 发布的进程级预设目录。 */
export interface PermissionCatalogValue { options: PermissionPresetOption[] }

/**
 * 一个会话能提供的权限选择：在位的当前值 + 候选预设。
 *
 * 两半来自不同来源（0.1.6 是投影 + RPC，0.1.5 只有投影），合并后各界面只读这一个值。
 * catalog 一旦拉到就优先；否则退回投影内联的那份（0.1.5 主机）。
 */
export interface PermissionSelection {
  currentValue: string;
  options: PermissionPresetOption[];
}

export function permissionSelectionMerge(
  projection: PermissionSelectValue | undefined,
  catalog: PermissionPresetOption[] | undefined,
): PermissionSelection | undefined {
  if (projection === undefined) return undefined;
  return { currentValue: projection.currentValue, options: catalog ?? projection.options ?? [] };
}

export function permissionCurrentOption(value: PermissionSelection | undefined): PermissionPresetOption | undefined {
  return value?.options.find(option => option.value === value.currentValue);
}

export function permissionSelectableOptions(value: PermissionSelection | undefined): PermissionPresetOption[] {
  return (value?.options ?? []).filter(option => option.value !== 'custom');
}

/** 归一化缩放前的输入尺寸；只有被缩放过的图片才有（web 的 originalDimensions）。 */
export interface ImageDimensions { width: number; height: number }

// 附件 ————————————————————————————————————————————————————————

export interface ImageAttachmentRef {
  attachmentId: AttachmentId;
  mediaType: string;
  bytes: number;
  width: number;
  height: number;
  name?: string;
  originalDimensions?: ImageDimensions;
}
export interface SessionAttachmentValue { attachment: ImageAttachmentRef; data: string }
export interface ImageAttachmentLimits {
  maxImageBytes: number;
  maxImagesPerMessage: number;
  maxMessageImageBytes: number;
  maxImagePixels: number;
  mediaTypes: string[];
}

/** 轮次用量（与 Android 的 TokenUsage 同字段）。 */
export interface TokenUsage {
  inputTokens?: number;
  uncachedInputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

// 历史 ————————————————————————————————————————————————————————

export interface SessionEvent {
  type: string;
  seq: number;
  time: number;
  data?: JsonElement;
  sourceEventSeqs?: number[];
  surfaceOp?: JsonElement;
  ignorable?: boolean;
}
export interface ToolEventView { for: string; view?: JsonElement }
export interface HistoryEntry { event: SessionEvent; view?: ToolEventView }
export interface SessionHistoryValue {
  events: HistoryEntry[];
  hasMore: boolean;
  projections?: SessionProjectionsBlock;
}
export interface SessionPageValue { records: HistoryEntry[]; hasMore: boolean }

/** `workspaceFiles/readBytes` 的一窗字节：base64 的 data + 是否读到页尾。 */
export interface WorkspaceFileBytesValue {
  absolutePath: string;
  version: string;
  data: string;
  bytes: number;
  eof: boolean;
}

export interface WorkspaceFileTextValue {
  absolutePath: string;
  version: string;
  bytes?: number;
  offset: number;
  text: string;
  lines: number;
  eof: boolean;
}

export interface WorkspaceFileReadArgs {
  workspaceFileScopeId: SessionId;
  path: string;
  range: { offset: number };
}

/** session/attachment 的图片应答（base64 -> 本地临时文件）。 */
export interface ImagePayload { mediaType: string; base64: string }

// 工作区 ————————————————————————————————————————————————————————

export interface WorkspaceView {
  workspaceId: WorkspaceId;
  path: string;
  title: string;
  sessionIds: SessionId[];
  createdAt: string;
  updatedAt: string;
}
export interface WorkspaceOrderValue { workspaceIds: WorkspaceId[] }

// Agent 预设 ——————————————————————————————————————————————————

export interface AgentPresetEntry {
  id: string;
  isDefault: boolean;
  name?: string;
  description?: string;
  broken?: string;
}
/**
 * agentPresets/list 的返回值。
 *
 * `modeSelectionEnabled` 是部署策略：关掉时新会话统一走部署默认模式，选择器不给入口。
 * 0.1.6 之前的主机不发布这个字段，缺省按允许处理（与 Android AgentPresetRoster 同一口径）。
 */
export interface AgentPresetListValue {
  presets: AgentPresetEntry[];
  modeSelectionEnabled: boolean;
}

/** 随 DSH 发布的预设 id（0.1.7 把 `code` 改名成 `ptc`）。 */
export const BUILT_IN_AGENT_PRESET_IDS: readonly string[] = ['standard', 'ptc', 'minimal', 'cordis'];

/**
 * 是否内置预设（对齐主机 isBuiltInPreset / Mac `isBuiltIn`）：内置预设不发布 name，
 * 自己带 name 的声明即便 id 撞上内置 id，也按用户预设处理、文案用它自己的。
 */
export function agentPresetIsBuiltIn(preset: AgentPresetEntry): boolean {
  return preset.name === undefined && BUILT_IN_AGENT_PRESET_IDS.includes(preset.id);
}

// 命令与 skills ————————————————————————————————————————————————

export interface CommandDescriptor { name: string; description: string; input?: JsonElement }
export interface CommandResultValue { kind: string; text?: string }
export interface CommandExecutionValue { commandId: string; result?: CommandResultValue }
export interface SkillEntry { name: string; description?: string; modelInvocable: boolean }
export interface SkillListValue { skills: SkillEntry[] }

// 目标 ————————————————————————————————————————————————————————

export interface GoalRef { id: string; revision: number }
export interface GoalCreateValue { ref: GoalRef }
export interface GoalViewValue { ref: GoalRef }

// 后台任务 ————————————————————————————————————————————————————

export type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed';

export interface JobView {
  id: string;
  kind: string;
  label: string;
  status: JobStatus;
  detail?: string;
  /** 0.1.7：生产方的实时进度行（`3/10`、当前阶段），结束时清空。 */
  progress?: string;
  startedAt: number;
  finishedAt?: number;
  /** 0.1.7：输出环的绝对坐标。`total` 是下一块的起始偏移（没写过就是 0），`earliest` 是最早保留的字节。 */
  output?: { total: number; earliest: number };
}

export function jobIsLive(job: JobView): boolean {
  return job.status === 'running' || job.status === 'stopping';
}

/** web `isObservable`：还可能有实时输出，或已结束但留下了输出。 */
export function jobIsObservable(job: JobView): boolean {
  return jobIsLive(job) || (job.output?.total ?? 0) > 0;
}

// 子智能体 ————————————————————————————————————————————————————

/** `unknown` 是 0.1.7 迁移补出来的目录项：只能浏览，不能继续对话。 */
export type SubagentMode = 'one-shot' | 'continuable' | 'unknown';

export interface SubagentListEntry {
  sessionId: SessionId;
  isChild: boolean;
  mode: SubagentMode;
  running: boolean;
  hasChildren: boolean;
  label?: string;
  reason?: string;
}
export interface SubagentListValue { entries: SubagentListEntry[]; parentAvailable: boolean }

// 会话地址 ————————————————————————————————————————————————————

export interface SubagentAddress {
  parentSessionId: SessionId;
  childSessionId: SessionId;
  mode: SubagentMode;
}

export type SessionAddress =
  | { kind: 'session'; sessionId: SessionId }
  | { kind: 'subagent'; address: SubagentAddress };

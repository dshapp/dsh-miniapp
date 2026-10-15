import { bool, int, jget, str, type JsonValue, type JsonObject } from '../model/json';
import { internalError, ApiException, type RpcTransport } from './types';
import type {
  AgentPresetListValue, CommandDescriptor, CommandExecutionValue, FileReferenceItem, GoalActivation, GoalRef,
  SessionAddress, SessionCreateValue, SessionForkValue, SessionHistoryValue, SessionId, SessionListValue,
  SessionModelsValue, SessionPageValue, SessionReferenceItem, SessionSearchValue, SessionSelectModelValue,
  SkillListValue, SubagentAddress, SubagentListEntry, SubagentListValue, SubagentMode, SessionAttachmentValue,
  WorkspaceFileBytesValue,
  WorkspaceFileTextValue, WorkspaceId, WorkspaceOrderValue, ModelCatalogValue,
  PermissionPresetOption, WorkspaceView,
} from '../model/types';
import { decodeHistoryEntry, decodeSessionSummary, decodeWorkspaceView } from '../model/frames';
import { questionAnswerPayload, type QuestionAnswer } from '../model/questionFlow';
import {
  decodeChangedFileDiff,
  decodeTurnChangesSummary,
  type ChangedFileDiff,
  type TurnChangesSummary,
} from '../model/turnChanges';

// —— 请求辅助 ————————————————————————————————————————————————

function request(body: JsonObject): JsonValue {
  return { request: body };
}

/** prompt 的一块内容。 */
export type PromptContentPart =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mediaType: string; data: string; name?: string }
  | { kind: 'file'; receiptId: string };

export function encodePromptContentPart(part: PromptContentPart): JsonValue {
  switch (part.kind) {
    case 'text':
      return { type: 'text', text: part.text };
    case 'image':
      return part.name === undefined
        ? { type: 'image', mediaType: part.mediaType, data: part.data }
        : { type: 'image', mediaType: part.mediaType, data: part.data, name: part.name };
    case 'file':
      return { type: 'file', receiptId: part.receiptId };
  }
}

export function encodeSessionAddress(address: SessionAddress): JsonValue {
  if (address.kind === 'session') return { kind: 'session', sessionId: address.sessionId };
  return {
    kind: 'subagent',
    parentSessionId: address.address.parentSessionId,
    childSessionId: address.address.childSessionId,
    mode: address.address.mode,
  };
}

export type QueueAction = { kind: 'edit'; text: string } | { kind: 'remove' } | { kind: 'steer' };

function encodeQueueAction(action: QueueAction): JsonValue {
  if (action.kind === 'edit') return { kind: 'edit', content: [{ type: 'text', text: action.text }] };
  return { kind: action.kind };
}

function sessionIdOf(value: JsonValue): SessionId | undefined {
  return str(jget(value, 'sessionId'));
}

// —— session ——————————————————————————————————————————————————

/**
 * 会话列表。_request.projections 是给 mobile bridge 的提示：只保留 title 与 agentPreset，
 * 其余投影块由 bridge 转发时丢掉。主机不认识这个字段会直接忽略。
 */
export async function sessionList(transport: RpcTransport): Promise<SessionListValue> {
  const value = await transport.call('session/list', {
    _request: { projections: ['title', 'agentPreset'] },
  });
  const raw = jget(value, 'items');
  const items = Array.isArray(raw) ? raw : [];
  return {
    items: items
      .map(decodeSessionSummary)
      .filter((item): item is NonNullable<typeof item> => item !== undefined),
  };
}

export async function sessionSearch(transport: RpcTransport, query: string): Promise<SessionSearchValue> {
  const value = await transport.call('session/search', request({ query }));
  const raw = jget(value, 'items');
  const items = Array.isArray(raw) ? raw : [];
  return {
    items: items
      .map(item => {
        const sessionId = sessionIdOf(item);
        if (sessionId === undefined) return undefined;
        return { sessionId, snippet: str(jget(item, 'snippet')) ?? '' };
      })
      .filter((item): item is { sessionId: string; snippet: string } => item !== undefined),
    hasMore: bool(jget(value, 'hasMore')) ?? false,
  };
}

export async function sessionCreate(transport: RpcTransport, workspaceId?: WorkspaceId): Promise<SessionCreateValue> {
  const args: JsonObject = {};
  if (workspaceId !== undefined) args.workspaceId = workspaceId;
  const value = await transport.call('session/create', request(args));
  const sessionId = sessionIdOf(value);
  if (sessionId === undefined) throw internalError('session/create returned no value');
  return { sessionId, agentPreset: str(jget(value, 'agentPreset')) };
}

/** 按轮次对齐的历史窗口上限（web session-controller `HISTORY_PAGE_OPTIONS.maxMessages`）。 */
export const HISTORY_MESSAGE_CAP = 500;

/**
 * 按轮次边界对齐的历史窗口（0.1.7 `turnWindow`，对齐 web `HISTORY_PAGE_OPTIONS`）：
 * 至少 `minMessages` 条消息、两个轮次起点，所以一页不会从半轮开始；总量封顶 500。
 * `session/page` 与 `session/follow` 共用这一份参数。
 */
export function historyWindowArgs(minMessages: number): JsonObject {
  const minimum = Math.max(1, Math.min(Math.trunc(minMessages), HISTORY_MESSAGE_CAP));
  return { maxMessages: HISTORY_MESSAGE_CAP, turnWindow: { minMessages: minimum, minTurns: 2 } };
}

export async function sessionPage(
  transport: RpcTransport,
  address: SessionAddress,
  throughSeq: number,
  beforeSeq?: number,
  maxMessages?: number,
): Promise<SessionPageValue> {
  const args: JsonObject = { address: encodeSessionAddress(address), throughSeq };
  if (beforeSeq !== undefined) args.beforeSeq = beforeSeq;
  if (maxMessages !== undefined) Object.assign(args, historyWindowArgs(maxMessages));
  const value = await transport.call('session/page', request(args));
  const raw = jget(value, 'records');
  const records = Array.isArray(raw) ? raw : [];
  return {
    records: records
      .map(decodeHistoryEntry)
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined),
    hasMore: bool(jget(value, 'hasMore')) ?? false,
  };
}

export async function sessionHistory(
  transport: RpcTransport,
  sessionId: SessionId,
  throughSeq: number,
  beforeSeq?: number,
  maxMessages = 50,
): Promise<SessionHistoryValue> {
  const page = await sessionPage(transport, { kind: 'session', sessionId }, throughSeq, beforeSeq, maxMessages);
  return { events: page.records, hasMore: page.hasMore };
}

export async function subagentHistory(
  transport: RpcTransport,
  address: SubagentAddress,
  throughSeq: number,
  beforeSeq?: number,
  maxMessages = 50,
): Promise<SessionHistoryValue> {
  const page = await sessionPage(transport, { kind: 'subagent', address }, throughSeq, beforeSeq, maxMessages);
  return { events: page.records, hasMore: page.hasMore };
}

/** modelCatalog 是全局目录，sessionModels 把它整理成某个会话的当前选择。 */
export async function sessionModels(transport: RpcTransport): Promise<SessionModelsValue> {
  const value = await transport.call('session/modelCatalog', {});
  const catalog = decodeModelCatalog(value);
  if (catalog === undefined) throw internalError('model catalog unavailable');
  return {
    current: catalog.default,
    routable: catalog.routableProviders.includes(catalog.default.provider),
    groups: catalog.groups,
    failures: catalog.failures ?? [],
  };
}

export function decodeModelCatalog(value: JsonValue): ModelCatalogValue | undefined {
  const selection = jget(value, 'default');
  const provider = str(jget(selection, 'provider'));
  const model = str(jget(selection, 'model'));
  if (provider === undefined || model === undefined) return undefined;
  const rawProviders = jget(value, 'routableProviders');
  const routableProviders = Array.isArray(rawProviders)
    ? rawProviders.map(str).filter((item): item is string => item !== undefined)
    : [];
  const rawGroups = jget(value, 'groups');
  const groups = (Array.isArray(rawGroups) ? rawGroups : []).map(group => {
    const rawModels = jget(group, 'models');
    return {
      id: str(jget(group, 'id')) ?? '',
      name: str(jget(group, 'name')) ?? '',
      models: (Array.isArray(rawModels) ? rawModels : []).map(entry => {
        const reasoning = jget(entry, 'reasoning');
        const rawEfforts = jget(reasoning, 'efforts');
        return {
          id: str(jget(entry, 'id')) ?? '',
          name: str(jget(entry, 'name')) ?? '',
          description: str(jget(entry, 'description')),
          reasoning: reasoning === undefined ? undefined : {
            efforts: (Array.isArray(rawEfforts) ? rawEfforts : []).map(effort => ({
              id: str(jget(effort, 'id')) ?? '',
              name: str(jget(effort, 'name')) ?? '',
              description: str(jget(effort, 'description')),
            })),
            defaultEffort: str(jget(reasoning, 'defaultEffort')),
          },
        };
      }),
    };
  });
  const rawFailures = jget(value, 'failures');
  const failures = Array.isArray(rawFailures)
    ? rawFailures.map(failure => ({
        id: str(jget(failure, 'id')) ?? '',
        name: str(jget(failure, 'name')) ?? '',
        message: str(jget(failure, 'message')) ?? '',
      }))
    : undefined;
  return {
    default: { provider, model, reasoningEffort: str(jget(selection, 'reasoningEffort')) },
    routableProviders,
    groups,
    failures,
  };
}
export async function sessionSelectModel(
  transport: RpcTransport,
  sessionId: SessionId,
  provider: string,
  model: string,
  reasoningEffort?: string,
): Promise<SessionSelectModelValue> {
  const args: JsonObject = { sessionId, provider, model };
  if (reasoningEffort !== undefined) args.reasoningEffort = reasoningEffort;
  const value = await transport.call('session/selectModel', request(args));
  const selected = jget(value, 'selected');
  const selectedProvider = str(jget(selected, 'provider'));
  const selectedModel = str(jget(selected, 'model'));
  if (selectedProvider === undefined || selectedModel === undefined) throw internalError('selectModel returned no value');
  return {
    selected: {
      provider: selectedProvider,
      model: selectedModel,
      reasoningEffort: str(jget(selected, 'reasoningEffort')),
    },
  };
}

export async function sessionRename(transport: RpcTransport, sessionId: SessionId, title: string): Promise<void> {
  await transport.call('session/rename', request({ sessionId, title }));
}

/**
 * 分叉一条会话。
 *
 * 0.1.7 把 `atSeq` 改成精确的包含式截断点：给了就必须命中日志里真实存在的 seq，
 * 否则报 `fork-unavailable`、不再回退；省略时主机取最后一个已完成 turn 的前缀。
 * 所以调用方只在确知某条 turn/end 的 seq 时才传它。
 */
export async function sessionFork(transport: RpcTransport, sessionId: SessionId, atSeq?: number): Promise<SessionForkValue> {
  const args: JsonObject = { sessionId };
  if (atSeq !== undefined) args.atSeq = atSeq;
  const value = await transport.call('session/fork', request(args));
  const forked = sessionIdOf(value);
  if (forked === undefined) throw internalError('fork returned no value');
  return { sessionId: forked };
}

export async function sessionPrompt(
  transport: RpcTransport,
  sessionId: SessionId,
  mode: 'queue' | 'steer',
  content: PromptContentPart[],
  clientTimeZone: string | undefined,
  requestId: string,
): Promise<boolean> {
  const args: JsonObject = { requestId, sessionId, mode, content: content.map(encodePromptContentPart) };
  if (clientTimeZone !== undefined) args.clientTimeZone = clientTimeZone;
  const value = await transport.call('session/prompt', request(args));
  return bool(jget(value, 'accepted')) ?? true;
}

export async function sessionCancel(transport: RpcTransport, sessionId: SessionId): Promise<void> {
  await transport.call('session/cancel', request({ sessionId }));
}

export async function sessionUpdateQueue(
  transport: RpcTransport,
  sessionId: SessionId,
  itemId: string,
  action: QueueAction,
): Promise<void> {
  await transport.call('session/updateQueue', request({ sessionId, itemId, action: encodeQueueAction(action) }));
}

export async function sessionAttachment(
  transport: RpcTransport,
  sessionId: SessionId,
  attachmentId: string,
): Promise<SessionAttachmentValue> {
  const value = await transport.call('session/attachment', request({ sessionId, attachmentId }));
  const attachment = jget(value, 'attachment');
  return {
    attachment: {
      attachmentId: str(jget(attachment, 'attachmentId')) ?? attachmentId,
      mediaType: str(jget(attachment, 'mediaType')) ?? 'image/png',
      bytes: 0,
      width: 0,
      height: 0,
      name: str(jget(attachment, 'name')),
    },
    data: str(jget(value, 'data')) ?? '',
  };
}

/**
 * 归档一条会话（0.1.6 起返回主机落定后的完整归档集合，与 unarchive 同一形状）。
 *
 * 0.1.7：有任务在跑的会话默认被拒（`workspace/session-active`）；`stopActivity` 为真时
 * 主机先停掉这些任务再归档。
 */
export async function workspaceArchiveSession(
  transport: RpcTransport,
  sessionId: SessionId,
  stopActivity = false,
): Promise<SessionId[]> {
  const body: JsonObject = { sessionId };
  if (stopActivity) body.stopActivity = true;
  const value = await transport.call('workspace/archiveSession', request(body));
  const raw = jget(value, 'archivedSessionIds');
  return (Array.isArray(raw) ? raw : []).map(str).filter((id): id is string => id !== undefined);
}

/** 归档被拒是因为会话里还有任务在跑（0.1.7 的错误码）。 */
export const SESSION_ACTIVE_ERROR = 'workspace/session-active';

/**
 * 置顶 / 取消置顶（0.1.7 新增，主机侧的全局置顶集合）。
 * 返回落定后的完整集合，最近置顶的在前。
 */
export async function workspaceSetPinned(
  transport: RpcTransport,
  sessionId: SessionId,
  pinned: boolean,
): Promise<SessionId[]> {
  const value = await transport.call(pinned ? 'workspace/pinSession' : 'workspace/unpinSession', request({ sessionId }));
  const raw = jget(value, 'pinnedSessionIds');
  return (Array.isArray(raw) ? raw : []).map(str).filter((id): id is string => id !== undefined);
}

/**
 * 首次使用的默认工作区（0.1.7 `workspace/initializeDefault`，对齐 web `initializeDefaultWorkspace`）。
 * 是否算"首次"由主机独自判断（工作区注册表与会话历史都为空）；不再是首次时应答为空，返回 undefined。
 */
export async function workspaceInitializeDefault(
  transport: RpcTransport,
  directoryName: string,
  title: string,
): Promise<WorkspaceView | undefined> {
  const value = await transport.call('workspace/initializeDefault', request({ directoryName, title }));
  return decodeWorkspaceView(jget(value, 'workspace'));
}

// —— 后台任务（0.1.7 的 `job` 命名空间） ————————————————————————

/**
 * 替用户停掉一个后台任务。任务必须在这条会话的 job/list 里可见。
 * 返回 `requested` 或 `already-finished`。
 */
export async function jobKill(transport: RpcTransport, sessionId: SessionId, jobId: string): Promise<string> {
  const value = await transport.call('job/kill', request({ sessionId, jobId }));
  return str(jget(value, 'outcome')) ?? 'requested';
}

/** 恢复已归档会话（0.1.6 新增）；返回主机落定后的完整归档集合。 */
export async function workspaceUnarchiveSession(
  transport: RpcTransport,
  sessionId: SessionId,
): Promise<SessionId[]> {
  const value = await transport.call('workspace/unarchiveSession', request({ sessionId }));
  const raw = jget(value, 'archivedSessionIds');
  return (Array.isArray(raw) ? raw : []).map(str).filter((id): id is string => id !== undefined);
}

// —— 每轮改动文件（0.1.6 的 ui-deliverables 插件路由） ————————————

/**
 * 一轮改动文件的汇总。
 *
 * 这是插件路由而不是 Remote 方法：`workspace/changes` 事件只带轮次，汇总（文件与增删行数）
 * 要按该事件自己的 seq 来这里读。主机在会话销毁后返回 404，那是「没有可显示的东西」，
 * 因此返回 undefined 而不是抛错（与 Android changesSummary 同口径）。
 */
export async function changesSummary(
  transport: RpcTransport,
  sessionId: SessionId,
  seq: number,
): Promise<TurnChangesSummary | undefined> {
  const value = await transport.getJson('api/changes.summary', [
    ['sessionId', sessionId],
    ['seq', String(seq)],
  ]);
  return decodeTurnChangesSummary(value);
}

/** 一个列出的文件在轮首与轮末的比较；同样以 404 表示主机不再提供。 */
export async function changesDiff(
  transport: RpcTransport,
  sessionId: SessionId,
  seq: number,
  index: number,
): Promise<ChangedFileDiff | undefined> {
  const value = await transport.getJson('api/changes.diff', [
    ['sessionId', sessionId],
    ['seq', String(seq)],
    ['index', String(index)],
  ]);
  return decodeChangedFileDiff(value);
}

/** beforeWorkspaceId 为空表示挪到末尾——用「不带字段」表达，而不是 null。 */
export async function workspaceInsertBefore(
  transport: RpcTransport,
  workspaceId: WorkspaceId,
  beforeWorkspaceId?: WorkspaceId,
): Promise<WorkspaceOrderValue> {
  const args: JsonObject = { workspaceId };
  if (beforeWorkspaceId !== undefined) args.beforeWorkspaceId = beforeWorkspaceId;
  const value = await transport.call('workspace/insertBefore', request(args));
  const raw = jget(value, 'workspaceIds');
  const workspaceIds = (Array.isArray(raw) ? raw : [])
    .map(str)
    .filter((item): item is string => item !== undefined);
  if (workspaceIds.length === 0) throw internalError('workspace/insertBefore returned no value');
  return { workspaceIds };
}

export async function hostOpenPath(transport: RpcTransport, path: string): Promise<void> {
  await transport.call('session/openWorkspacePath', request({ path }));
}

/**
 * 读回一个工作区文件的字节窗口（base64），用于把图片交给系统查看器。
 *
 * 主机 readBytes 的单窗口上限默认 2 MiB，靠 `eof` 分片读；不用 readAll（上限 32 MiB，
 * base64 后更大，解成字节时两份同时在内存里）。对齐 Android RpcMethods.workspaceFileReadBytes。
 *
 * 0.1.7：范围改放进 `options.range`；应答改成 multipart 二进制，传输层把字节还原成
 * base64 放回 `data`，所以这里的解码不变。
 */
export async function workspaceFileReadBytes(
  transport: RpcTransport,
  sessionId: SessionId,
  path: string,
  offset: number,
  length: number,
): Promise<WorkspaceFileBytesValue> {
  const value = await transport.call('workspaceFiles/readBytes', {
    workspaceFileScopeId: sessionId,
    path,
    options: { range: { offset, length } },
  });
  return {
    absolutePath: str(jget(value, 'absolutePath')) ?? path,
    version: str(jget(value, 'version')) ?? '',
    data: str(jget(value, 'data')) ?? '',
    bytes: typeof jget(value, 'bytes') === 'number' ? (jget(value, 'bytes') as number) : 0,
    eof: bool(jget(value, 'eof')) ?? true,
  };
}

export async function workspaceFileRead(
  transport: RpcTransport,
  sessionId: SessionId,
  path: string,
  offset: number,
): Promise<WorkspaceFileTextValue> {
  const value = await transport.call('workspaceFiles/read', {
    workspaceFileScopeId: sessionId,
    path,
    range: { offset },
  });
  const bytes = jget(value, 'bytes');
  const lines = jget(value, 'lines');
  const readOffset = jget(value, 'offset');
  return {
    absolutePath: str(jget(value, 'absolutePath')) ?? path,
    version: str(jget(value, 'version')) ?? '',
    bytes: typeof bytes === 'number' ? bytes : undefined,
    offset: typeof readOffset === 'number' ? readOffset : offset,
    text: str(jget(value, 'text')) ?? '',
    lines: typeof lines === 'number' ? lines : 0,
    eof: bool(jget(value, 'eof')) ?? true,
  };
}

// —— commands / skills ————————————————————————————————————————

export async function commandsList(transport: RpcTransport, sessionId: SessionId): Promise<CommandDescriptor[]> {
  const value = await transport.call('commands/list', { agentId: sessionId });
  const items = Array.isArray(value) ? value : [];
  return items.map(item => ({
    name: str(jget(item, 'name')) ?? '',
    description: str(jget(item, 'description')) ?? '',
    input: jget(item, 'input'),
  }));
}

/** 返回 undefined 表示主机没认出这条命令；认出但处理器失败时 result 里带错误。 */
export async function commandsExecute(
  transport: RpcTransport,
  sessionId: SessionId,
  line: string,
): Promise<CommandExecutionValue | undefined> {
  const value = await transport.call('commands/execute', {
    agentId: sessionId,
    line,
    submittedAttachments: [],
  });
  if (value === null) return undefined;
  const commandId = str(jget(value, 'commandId'));
  if (commandId === undefined) return undefined;
  const result = jget(value, 'result');
  return {
    commandId,
    result: result === undefined
      ? undefined
      : { kind: str(jget(result, 'kind')) ?? 'success', text: str(jget(result, 'text')) },
  };
}

export async function sessionSelectPermission(
  transport: RpcTransport,
  sessionId: SessionId,
  presetId: string,
): Promise<void> {
  await commandsExecute(transport, sessionId, '/permission ' + presetId);
}

/**
 * 进程级权限预设目录（0.1.6 新增）。
 *
 * 0.1.6 把 `permissions` 会话投影收窄成只剩 currentValue 之后，候选列表只能从这里拿；
 * 0.1.5 主机没有这条 RPC，调用会以 endpoint-unknown 失败，调用方按「没有目录」处理即可。
 */
export async function permissionCatalog(transport: RpcTransport): Promise<PermissionPresetOption[]> {
  const value = await transport.call('permissionPresets/catalog', {});
  const raw = jget(value, 'options');
  return (Array.isArray(raw) ? raw : [])
    .map(decodePermissionOption)
    .filter((option): option is PermissionPresetOption => option !== undefined);
}

function decodePermissionOption(value: JsonValue): PermissionPresetOption | undefined {
  const presetValue = str(jget(value, 'value'));
  if (presetValue === undefined) return undefined;
  return {
    value: presetValue,
    name: str(jget(value, 'name')) ?? presetValue,
    description: str(jget(value, 'description')),
  };
}

export async function skillList(transport: RpcTransport, sessionId: SessionId): Promise<SkillListValue> {
  const value = await transport.call('skills/list', request({ sessionId }));
  const raw = jget(value, 'skills');
  return {
    skills: (Array.isArray(raw) ? raw : []).map(skill => ({
      name: str(jget(skill, 'name')) ?? '',
      description: str(jget(skill, 'description')),
      modelInvocable: bool(jget(skill, 'modelInvocable')) ?? false,
    })),
  };
}

// —— 引用候选 ——————————————————————————————————————————————————

export async function fileReferencesList(
  transport: RpcTransport,
  sessionId: SessionId,
  query: string,
): Promise<FileReferenceItem[]> {
  const value = await transport.call('fileReferences/list', { agentId: sessionId, query });
  const items = Array.isArray(value) ? value : [];
  return items.map(item => ({ path: str(jget(item, 'path')) ?? '', kind: str(jget(item, 'kind')) ?? 'file' }));
}

export async function sessionReferenceCandidates(
  transport: RpcTransport,
  sessionId: SessionId,
  query: string,
): Promise<SessionReferenceItem[]> {
  const value = await transport.call('sessionReferenceResolver/candidates', { agentId: sessionId, query });
  const items = Array.isArray(value) ? value : [];
  const createdAtOf = (item: JsonValue): number => {
    const raw = jget(item, 'createdAt');
    return typeof raw === 'number' ? raw : 0;
  };
  return items.map(item => ({
    mention: str(jget(item, 'mention')) ?? '',
    sessionId: str(jget(item, 'sessionId')) ?? '',
    label: str(jget(item, 'label')) ?? '',
    cwd: str(jget(item, 'cwd')),
    createdAt: createdAtOf(item),
  }));
}

// —— agent 预设 ————————————————————————————————————————————————

export async function agentPresetList(transport: RpcTransport): Promise<AgentPresetListValue> {
  const value = await transport.call('agentPresets/list', {});
  const raw = jget(value, 'presets');
  return {
    // 0.1.7 起预设在配置文件里声明，列表不再带 trust / authorable / hasDocument；
    // 内置与否改按 id + 是否自带 name 判断（见 agentPresetIsBuiltIn）。
    presets: (Array.isArray(raw) ? raw : []).map(preset => ({
      id: str(jget(preset, 'id')) ?? '',
      isDefault: bool(jget(preset, 'isDefault')) ?? false,
      name: str(jget(preset, 'name')),
      description: str(jget(preset, 'description')),
      broken: str(jget(preset, 'broken')),
    })),
  };
}

export async function agentPresetSelect(
  transport: RpcTransport,
  sessionId: SessionId,
  agentPreset: string,
): Promise<void> {
  await transport.call('agentPresets/select', { agentId: sessionId, agentPreset });
}

// —— 限时提问（0.2.0）——————————————————————————————————————————

/**
 * 给一个已继续（continued）的 `ask_user_question` 迟到作答：主机把它作为
 * `user-question-reply` 消息插进 agent（对齐 Android `answerUserQuestion`）。
 *
 * @returns 问题已不再是 continued 时为 false；已有一条回答在排队时主机报 `REPLY_QUEUED`。
 */
export async function answerUserQuestion(
  transport: RpcTransport,
  sessionId: SessionId,
  callId: string,
  answers: QuestionAnswer[],
): Promise<boolean> {
  const value = await transport.call('userQuestions/answer', {
    agentId: sessionId,
    callId,
    answer: questionAnswerPayload(answers) as unknown as JsonValue,
  });
  return bool(value) === true;
}

// —— 目标 ——————————————————————————————————————————————————————

export async function goalCreate(
  transport: RpcTransport,
  sessionId: SessionId,
  objective: string,
  maxGoalRounds?: number,
): Promise<GoalRef> {
  const body: JsonObject = { objective };
  if (maxGoalRounds !== undefined) body.maxGoalRounds = maxGoalRounds;
  const value = await transport.call('goals/create', { agentId: sessionId, request: body });
  const ref = jget(value, 'ref');
  const id = str(jget(ref, 'id'));
  const revision = jget(ref, 'revision');
  if (id === undefined || typeof revision !== 'number') throw internalError('goal create failed');
  return { id, revision };
}

function goalRefArgs(sessionId: SessionId, ref: GoalRef): JsonObject {
  return { agentId: sessionId, ref: { id: ref.id, revision: ref.revision } };
}

export async function goalClear(transport: RpcTransport, sessionId: SessionId, ref: GoalRef): Promise<void> {
  await transport.call('goals/clear', goalRefArgs(sessionId, ref));
}

/** 读目标的进程内 activation（0.2.1）；没有当前目标时主机回 undefined。 */
export async function goalGet(transport: RpcTransport, sessionId: SessionId): Promise<GoalActivation | undefined> {
  const value = await transport.call('goals/get', { agentId: sessionId });
  const id = str(jget(value, 'id'));
  const revision = int(jget(value, 'revision'));
  if (id === undefined || revision === undefined) return undefined;
  return { id, revision, activation: str(jget(value, 'activation')) };
}

export async function goalPause(transport: RpcTransport, sessionId: SessionId, ref: GoalRef): Promise<void> {
  await transport.call('goals/pause', goalRefArgs(sessionId, ref));
}

export async function goalResume(transport: RpcTransport, sessionId: SessionId, ref: GoalRef): Promise<void> {
  await transport.call('goals/resume', goalRefArgs(sessionId, ref));
}

export async function goalEdit(
  transport: RpcTransport,
  sessionId: SessionId,
  ref: GoalRef,
  objective: string,
): Promise<void> {
  await transport.call('goals/edit', {
    agentId: sessionId,
    ref: { id: ref.id, revision: ref.revision },
    request: { objective },
  });
}

// —— 子智能体 ————————————————————————————————————————————————

/**
 * 一个父会话的直接子代理目录（0.1.7）。
 *
 * 0.1.7 删掉了 `subagents/list`，改从 `session/projections` 读父会话的 `subagentCatalog`
 * 投影（不会激活父会话的 Agent）；会话不存在时整个值是 null。目录只有 id / mode / label，
 * 运行状态由调用方从会话名册里的子会话摘要补上。
 */
export async function subagentCatalog(
  transport: RpcTransport,
  parentSessionId: SessionId,
): Promise<SubagentListValue> {
  const value = await transport.call('session/projections', request({ sessionId: parentSessionId }));
  if (value === null || value === undefined) return { entries: [], parentAvailable: false };
  const raw = jget(jget(value, 'values'), 'subagentCatalog');
  const entries: SubagentListEntry[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const id = str(jget(entry, 'id'));
    if (id === undefined) continue;
    entries.push({
      sessionId: id,
      isChild: true,
      mode: decodeSubagentMode(str(jget(entry, 'mode'))),
      running: false,
      hasChildren: false,
      label: str(jget(entry, 'label')),
    });
  }
  return { entries, parentAvailable: true };
}

/** 0.1.7 多了 `unknown`（迁移补出来的目录项）：只能浏览、不能继续；0.2.1 多了 `external`。 */
export function decodeSubagentMode(mode: string | undefined): SubagentMode {
  if (mode === 'continuable' || mode === 'one-shot' || mode === 'external') return mode;
  return 'unknown';
}

/** 0.1.6 及更早的子代理目录；0.1.7 主机上这条 RPC 已删除（404）。 */
export async function subagentList(transport: RpcTransport, parentSessionId: SessionId): Promise<SubagentListValue> {
  const value = await transport.call('subagents/list', { parentSessionId });
  const raw = jget(value, 'entries');
  const entries: SubagentListEntry[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const id = str(jget(entry, 'id'));
    if (id === undefined) continue;
    const kind = str(jget(entry, 'kind'));
    if (kind === 'child') {
      entries.push({
        sessionId: id,
        isChild: true,
        mode: str(jget(entry, 'mode')) === 'continuable' ? 'continuable' : 'one-shot',
        running: str(jget(entry, 'activity')) === 'running',
        hasChildren: bool(jget(entry, 'hasChildren')) ?? false,
        label: str(jget(entry, 'label')),
      });
    } else if (kind === 'diagnostic') {
      entries.push({
        sessionId: id,
        isChild: false,
        mode: 'one-shot',
        running: false,
        hasChildren: false,
        reason: str(jget(entry, 'reason')),
      });
    }
  }
  return { entries, parentAvailable: bool(jget(value, 'parentAvailable')) ?? false };
}

export async function subagentPrompt(
  transport: RpcTransport,
  address: SubagentAddress,
  text: string,
  clientTimeZone?: string,
): Promise<void> {
  const args: JsonObject = {
    parentSessionId: address.parentSessionId,
    childSessionId: address.childSessionId,
    mode: address.mode,
    content: [{ type: 'text', text }],
  };
  if (clientTimeZone !== undefined) args.clientTimeZone = clientTimeZone;
  await transport.call('subagents/prompt', request(args));
}

export async function subagentInterrupt(transport: RpcTransport, address: SubagentAddress): Promise<void> {
  await transport.call('subagents/interruptByParent', {
    childSessionId: address.childSessionId,
    parentSessionId: address.parentSessionId,
    mode: address.mode,
  });
}

export { ApiException };

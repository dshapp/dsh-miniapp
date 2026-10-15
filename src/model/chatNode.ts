import { encodeJson, firstLine as _firstLine, jget, str, type JsonElement } from './json';
import type { CallId, MessageId, RpcError, SessionId } from './types';

/** 出厂的子智能体委派工具（send_message / list_agents 这类控制工具算普通调用）。 */
export function isSubagentDelegationTool(name: string): boolean {
  return name === 'subagent' || name.startsWith('subagent_');
}

// 内容块 ——————————————————————————————————————————————————————

export type ContentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'image'; attachment?: JsonElement }
  | { kind: 'tool-call'; id: CallId; name: string; arguments: string }
  | { kind: 'tool-result'; toolCallId: CallId; content: ContentBlock[]; isError: boolean }
  | { kind: 'other'; raw?: JsonElement };

export function decodeContentBlock(value: JsonElement | undefined): ContentBlock {
  if (value === undefined || value === null || Array.isArray(value) || typeof value !== 'object') {
    return { kind: 'other', raw: value };
  }
  switch (str(value.type)) {
    case 'text':
      return { kind: 'text', text: str(value.text) ?? '' };
    case 'reasoning':
      return { kind: 'reasoning', text: str(value.text) ?? '' };
    case 'image':
      return { kind: 'image', attachment: value.attachment };
    case 'tool-call':
      return {
        kind: 'tool-call',
        id: str(value.id) ?? '',
        name: str(value.name) ?? '',
        arguments: str(value.arguments) ?? '',
      };
    case 'tool-result': {
      const content = Array.isArray(value.content) ? value.content : [];
      return {
        kind: 'tool-result',
        toolCallId: str(value.toolCallId) ?? '',
        content: content.map(decodeContentBlock),
        isError: value.isError === true,
      };
    }
    default:
      return { kind: 'other', raw: value };
  }
}

export function encodeContentBlock(block: ContentBlock): JsonElement {
  switch (block.kind) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'reasoning':
      return { type: 'reasoning', text: block.text };
    case 'image':
      return block.attachment === undefined ? { type: 'image' } : { type: 'image', attachment: block.attachment };
    case 'tool-call':
      return { type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments };
    case 'tool-result':
      // 嵌套 content 不能丢：工具结果的图片块要靠它才认得出来（对齐 Android encode）。
      return {
        type: 'tool-result',
        toolCallId: block.toolCallId,
        content: block.content.map(encodeContentBlock),
        isError: block.isError,
      };
    case 'other':
      return block.raw ?? {};
  }
}

export function plainText(content: ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { kind: 'text' }> => block.kind === 'text')
    .map(block => block.text)
    .join('\n');
}

/** 用户消息 `file` 块里的上传文件引用：{type:'file', attachment:{attachmentId, name, bytes}}。 */
export interface FileAttachmentRef { attachmentId: string; name: string; bytes: number }

/** 本端把 file 块留作 other（原样回写），这里挑出解得出的文件引用（对齐 Mac `fileAttachmentRefs`）。 */
export function fileAttachmentRefs(content: ContentBlock[]): FileAttachmentRef[] {
  const refs: FileAttachmentRef[] = [];
  for (const block of content) {
    if (block.kind !== 'other' || str(jget(block.raw, 'type')) !== 'file') continue;
    const attachment = jget(block.raw, 'attachment');
    const attachmentId = str(jget(attachment, 'attachmentId'));
    const name = str(jget(attachment, 'name'));
    const bytes = jget(attachment, 'bytes');
    if (attachmentId === undefined || name === undefined || typeof bytes !== 'number') continue;
    refs.push({ attachmentId, name, bytes });
  }
  return refs;
}

// 助手块 ——————————————————————————————————————————————————————

export type AssistantBlock =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'image'; attachment?: JsonElement }
  | { kind: 'toolCall'; callId: CallId; name: string; argsRaw: string }
  | { kind: 'other'; raw?: JsonElement };

export function toAssistantBlock(block: ContentBlock): AssistantBlock {
  switch (block.kind) {
    case 'text':
      return { kind: 'text', text: block.text };
    case 'reasoning':
      return { kind: 'reasoning', text: block.text };
    case 'image':
      return { kind: 'image', attachment: block.attachment };
    case 'tool-call':
      return { kind: 'toolCall', callId: block.id, name: block.name, argsRaw: block.arguments };
    case 'tool-result':
      return { kind: 'other', raw: null };
    case 'other':
      return { kind: 'other', raw: block.raw };
  }
}

// 轮次过程折叠 ————————————————————————————————————————————————

export interface TurnProcessKey { turn: number; answerStep: number }

export interface TurnProcessSpec {
  turn: number;
  processStartSeq: number;
  /**
   * 折叠区间的开区间终点：有最终回答时是回答的锚点；没有（如以工具调用收尾）时整轮都是过程，
   * 一直收到 turn/end 之后（web `answerAnchorSeq === null`）。
   */
  foldEndSeq: number;
  answerStep: number;
  messageCount: number;
  toolCallCount: number;
  subagentCount: number;
  inlineReasoning: boolean;
  /** 成功轮次的用时（对齐 Mac `TurnProcessSpec.durationMs`）。 */
  durationMs?: number;
}

export function turnProcessKey(spec: TurnProcessSpec): string {
  return `${spec.turn}:${spec.answerStep}`;
}

export function turnProcessCovers(spec: TurnProcessSpec, anchor: number): boolean {
  return anchor >= spec.processStartSeq && anchor < spec.foldEndSeq;
}

// 助手步骤 ————————————————————————————————————————————————————

export type AssistantStatus = 'running' | 'settled' | 'interrupted';

export interface TokenUsage {
  inputTokens?: number;
  uncachedInputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export interface AssistantStepData {
  turn: number;
  step: number;
  startSeq: number;
  time: number;
  firstVisibleSeq?: number;
  settledSeq?: number;
  status: AssistantStatus;
  blocks: (AssistantBlock | null)[];
  usage?: TokenUsage;
  messageId?: MessageId;
  provider?: string;
  model?: string;
  interrupted: boolean;
  stepStartTime?: number;
  firstTokenTime?: number;
}

export function assistantStepHasVisibleContent(step: AssistantStepData): boolean {
  return step.blocks.some(block => {
    if (block === null) return false;
    switch (block.kind) {
      case 'text':
      case 'reasoning':
        return block.text.length > 0;
      case 'toolCall':
        return block.callId.length > 0;
      case 'image':
      case 'other':
        return true;
    }
  });
}

/** 被打断的步骤即使没有可见内容也要出现：那一行本身就是"已停止"的证据。 */
export function assistantStepIsVisible(step: AssistantStepData): boolean {
  return assistantStepHasVisibleContent(step) || step.interrupted;
}

// 工具调用 ————————————————————————————————————————————————————

/** `reason`（0.2.1）是给人看的原始失败详情，不进模型上下文。 */
export interface ToolError { name: string; code: string; reason?: string }

function toolErrorText(error: ToolError): string {
  return error.reason !== undefined && error.reason.length > 0 ? error.reason : `${error.name}: ${error.code}`;
}

export interface ToolResultData {
  seq: number;
  time: number;
  content: ContentBlock[];
  isError: boolean;
  error?: ToolError;
  meta?: JsonElement;
  resultView?: JsonElement;
}

export interface ToolChatData {
  callId: CallId;
  name: string;
  argsRaw: string;
  turn: number;
  step: number;
  startSeq: number;
  time: number;
  rootCallId?: CallId;
  parentCallId?: CallId;
  result?: ToolResultData;
  callView?: JsonElement;
  subCalls: ToolChatData[];
  /** 模型还在流式生成这次调用的参数，tool/call 还没落（web `preparing` 阶段，0.2.1）。 */
  preparing?: boolean;
  /** 准备中的行的位置：紧跟在它所在的助手步骤之后，按块序排。 */
  displaySeq?: number;
}

// 工作流 ——————————————————————————————————————————————————————

export type WorkflowRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface WorkflowRunMemberData { seq: number; label: string; childId: SessionId; status: WorkflowRunStatus }
export interface WorkflowRunPhaseData { key: string; phase?: string; members: WorkflowRunMemberData[] }
export interface WorkflowRunData {
  runId: string;
  name: string;
  status: WorkflowRunStatus;
  phases: WorkflowRunPhaseData[];
  anchorSeq: number;
}

// 其它节点 ————————————————————————————————————————————————————

/**
 * 唤醒这一轮的非人类消息（web `turn-trigger`）：定时任务、后台任务结束、goal 续跑、
 * webhook、插件……单独画成一条折叠通知；其余非人类上下文一律不进对话区。
 */
export interface TurnTriggerNode {
  seq: number;
  time: number;
  messageId: MessageId;
  content: ContentBlock[];
  source?: JsonElement;
}

export interface UnknownSurfaceNode { seq: number; time: number; type: string; data?: JsonElement }

/**
 * 工具增减提示（web `ContextInjectionRow` 的工具形态）：下一次请求的工具表与上一次不同时，
 * agent loop 记一条 `developer/message`，其中 tool-addition / tool-removal 块带 toolName。
 */
export interface ToolChangeNode { seq: number; time: number; added: string[]; removed: string[] }

export interface CompactionSummaryNode {
  compactionId: string;
  seq: number;
  time: number;
  summary?: string;
  summaryEventSeq?: number;
  shadowedItemCount?: number;
  shadowedTokenCount?: number;
}

export type RetryState = 'scheduled' | 'started' | 'cancelled';

export interface ModelRetryNode {
  retryId: string;
  seq: number;
  time: number;
  retryState: RetryState;
  retry: number;
  maxRetries?: number;
  delayMs?: number;
  failureMessage?: string;
  failureCode?: string;
  provider?: string;
}

export interface TurnErrorNode {
  seq: number;
  time: number;
  turn: number;
  step?: number;
  message: string;
  code?: string;
}

export interface TurnMaxTokensNode { seq: number; time: number; turn: number; step?: number }

export interface CommandOutcome { kind: string; text?: string; sourceEventSeq?: number }

export interface CommandNode {
  commandId: string;
  seq: number;
  time: number;
  name?: string;
  args?: string;
  outcome?: CommandOutcome;
}

export interface TurnTailData {
  turn: number;
  seq: number;
  time: number;
  usage?: TokenUsage;
  routes: string[];
  ttftMs?: number;
  decodeTokensPerSec?: number;
  closingText?: string;
  messageId?: MessageId;
  /** 只有成功的轮次才有用时（web 停止/失败的轮次用状态替掉用时）。 */
  runMs?: number;
  /** turn/end 落定后的结局：aborted → 停止，error → 失败，其余算完成（web `TurnProcessNodeView`）。 */
  outcome?: TurnOutcome;
  endedAt?: number;
}

export type TurnOutcome = 'completed' | 'stopped' | 'failed';

// 转写节点 ————————————————————————————————————————————————————

export type ChatNode =
  | { kind: 'user'; seq: number; time: number; messageId: MessageId; content: ContentBlock[] }
  | { kind: 'steering'; seq: number; time: number; messageId: MessageId; content: ContentBlock[] }
  | { kind: 'turnTrigger'; data: TurnTriggerNode }
  | { kind: 'assistant'; step: AssistantStepData }
  | { kind: 'tool'; data: ToolChatData }
  | { kind: 'compaction'; data: CompactionSummaryNode }
  | { kind: 'modelRetry'; data: ModelRetryNode }
  | { kind: 'turnError'; data: TurnErrorNode }
  | { kind: 'turnMaxTokens'; data: TurnMaxTokensNode }
  | { kind: 'command'; data: CommandNode }
  | { kind: 'turnTail'; data: TurnTailData }
  | { kind: 'workflow'; data: WorkflowRunData }
  | { kind: 'turnProcess'; spec: TurnProcessSpec }
  | { kind: 'unknownSurface'; data: UnknownSurfaceNode }
  | { kind: 'toolChange'; data: ToolChangeNode };

export function chatNodeId(node: ChatNode): string {
  switch (node.kind) {
    case 'user': return `u-${node.messageId}`;
    case 'steering': return `s-${node.messageId}`;
    case 'turnTrigger': return `trg-${node.data.messageId}`;
    case 'assistant': return `a-${node.step.turn}:${node.step.step}`;
    case 'tool': return `t-${node.data.callId}`;
    case 'compaction': return `cmp-${node.data.compactionId}`;
    case 'modelRetry': return `rty-${node.data.retryId}`;
    case 'turnError': return `err-${node.data.turn}`;
    case 'turnMaxTokens': return `mt-${node.data.turn}`;
    case 'command': return `cmd-${node.data.commandId}`;
    case 'turnTail': return `ttl-${node.data.turn}`;
    case 'workflow': return `wf-${node.data.runId}`;
    case 'turnProcess': return `tp-${node.spec.turn}`;
    case 'unknownSurface': return `unk-${node.data.seq}`;
    case 'toolChange': return `tc-${node.data.seq}`;
  }
}

/** 排序锚点：这一行在转写里的位置。 */
export function chatNodeAnchorSeq(node: ChatNode): number {
  switch (node.kind) {
    case 'user': return node.seq;
    case 'steering': return node.seq;
    case 'turnTrigger': return node.data.seq;
    case 'assistant': return node.step.settledSeq ?? node.step.firstVisibleSeq ?? node.step.startSeq;
    case 'tool': return node.data.displaySeq ?? node.data.startSeq;
    case 'compaction': return node.data.seq;
    case 'modelRetry': return node.data.seq;
    case 'turnError': return node.data.seq;
    case 'turnMaxTokens': return node.data.seq + 0.05;
    case 'command': return node.data.seq;
    case 'turnTail': return node.data.seq + 0.1;
    case 'workflow': return node.data.anchorSeq;
    case 'turnProcess': return node.spec.processStartSeq - 0.001;
    case 'unknownSurface': return node.data.seq;
    case 'toolChange': return node.data.seq;
  }
}

/**
 * 这一行是不是真的有内容可画。轮次页脚要等 turn/end 把收尾助手消息折进来才成立。
 */
export function chatNodeRendersRow(node: ChatNode): boolean {
  if (node.kind === 'turnTail') return node.data.outcome !== undefined || node.data.messageId !== undefined;
  return true;
}

export function chatNodeTurnNumber(node: ChatNode): number | undefined {
  switch (node.kind) {
    case 'assistant': return node.step.turn;
    case 'tool': return node.data.turn;
    case 'turnError': return node.data.turn;
    case 'turnMaxTokens': return node.data.turn;
    case 'turnTail': return node.data.turn;
    case 'turnProcess': return node.spec.turn;
    default: return undefined;
  }
}

/** 转写内查找用的可检索文本。 */
export function chatNodeSearchText(node: ChatNode): string {
  switch (node.kind) {
    case 'user':
    case 'steering':
      return plainText(node.content);
    case 'turnTrigger':
      return plainText(node.data.content);
    case 'assistant':
      return node.step.blocks
        .map(block => (block && (block.kind === 'text' || block.kind === 'reasoning') ? block.text : null))
        .filter((text): text is string => text !== null)
        .join('\n');
    case 'tool':
      return `${node.data.name} ${node.data.argsRaw}`;
    default:
      return '';
  }
}

/** 工具结果摊平成可复制文本。 */
export function toolResultText(result: ToolResultData): string {
  const parts: string[] = [];
  for (const block of result.content) {
    if (block.kind === 'text') parts.push(block.text);
    else parts.push(encodeJson(encodeContentBlock(block)));
  }
  if (parts.length === 0 && result.error) parts.push(toolErrorText(result.error));
  return parts.join('\n');
}

export function resultFirstLine(result: ToolResultData): string {
  for (const block of result.content) {
    if (block.kind === 'text') {
      if (block.text.length === 0) continue;
      return _firstLine(block.text);
    }
    return _firstLine(encodeJson(encodeContentBlock(block)));
  }
  if (result.error) return _firstLine(toolErrorText(result.error));
  return '';
}

export function decodeToolError(value: JsonElement | undefined): ToolError | undefined {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return { name: str(value.name) ?? '', code: str(value.code) ?? '', reason: str(value.reason) };
}

export function rpcErrorMessage(error: RpcError | undefined): string {
  return error ? error.message || error.code : '';
}

export { jget };

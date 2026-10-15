import { fmt, Strings } from '../i18n/strings';
import { firstLine, parseJson, str, int, type JsonElement } from './json';
import { resultFirstLine, type ContentBlock, type ToolChatData } from './chatNode';

export type ToolRowVariant = 'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'others';

export type ToolRowState = 'preparing' | 'running' | 'ok' | 'error' | 'stopped';

export interface ToolRowModel {
  variant: ToolRowVariant;
  summary: string;
  filePath?: string;
  summarySuffix?: string;
  errorSummary?: string;
  state: ToolRowState;
}

const TOOL_VARIANTS: Record<string, ToolRowVariant> = {
  bash: 'bash',
  pwsh: 'bash',
  read: 'read',
  read_image: 'read',
  web_fetch: 'read',
  web_search: 'search',
  grep: 'search',
  glob: 'search',
  write: 'write',
  edit: 'edit',
  run_code: 'code',
  cordis_package_inspect: 'read',
  cordis_runtime_inspect: 'read',
  cordis_run: 'others',
  cordis_stop: 'others',
  cordis_undefine: 'others',
};

const KEYED_ROW_TOOLS = new Set([
  'cordis_run',
  'cordis_stop',
  'cordis_undefine',
  'skill',
  'todo_write',
  'ask_user_question',
  'exit_plan_mode',
]);

const SUMMARY_KEYS: Record<ToolRowVariant, string[]> = {
  bash: ['description', 'command'],
  read: ['path', 'file_path', 'url'],
  search: ['query', 'pattern', 'url'],
  write: ['path', 'file_path'],
  edit: ['path', 'file_path'],
  code: ['description'],
  others: [],
};

const FILE_PATH_VARIANTS = new Set<ToolRowVariant>(['read', 'write', 'edit']);

export function classifyTool(name: string): ToolRowVariant {
  return TOOL_VARIANTS[name] ?? 'others';
}

export type ArgsMap = Record<string, unknown>;

/** 把 JSON 对象摊成普通 JS 值，非 JSON 返回 undefined（流式截断时会遇到）。 */
export function parseArgsMap(raw: string): ArgsMap | undefined {
  if (raw.trim().length === 0) return undefined;
  const element = parseJson(raw);
  if (element === undefined || element === null || typeof element !== 'object' || Array.isArray(element)) {
    return undefined;
  }
  const out: ArgsMap = {};
  for (const [key, value] of Object.entries(element)) out[key] = value;
  return out;
}

function pickString(args: ArgsMap, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export function deriveSummary(variant: ToolRowVariant, argsRaw: string, args: ArgsMap | undefined): string {
  if (argsRaw.length === 0) return '';
  if (args !== undefined) {
    if (variant === 'search') {
      const raw = args.queries;
      if (Array.isArray(raw)) {
        const queries = raw.filter((item): item is string => typeof item === 'string' && item.length > 0);
        if (queries.length > 0) return queries.map(firstLine).join(', ');
      }
    }
    const picked = pickString(args, SUMMARY_KEYS[variant]);
    if (picked !== undefined) return firstLine(picked);
    for (const value of Object.values(args)) {
      if (typeof value === 'string' && value.length > 0) return firstLine(value);
    }
  }
  return firstLine(argsRaw);
}

function deriveFilePath(variant: ToolRowVariant, args: ArgsMap | undefined): string | undefined {
  if (!FILE_PATH_VARIANTS.has(variant) || args === undefined) return undefined;
  const picked = pickString(args, ['path', 'file_path']);
  return picked === undefined ? undefined : firstLine(picked);
}

function cardOf(value: JsonElement | undefined): string | undefined {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return str(value.card);
}

function terminalFailed(resultView: JsonElement | undefined): boolean {
  if (cardOf(resultView) !== 'terminal') return false;
  const exit = resultView && typeof resultView === 'object' && !Array.isArray(resultView) ? int(resultView.exitCode) : undefined;
  if (exit !== undefined && exit !== 0) return true;
  return resultView && typeof resultView === 'object' && !Array.isArray(resultView)
    ? str(resultView.signal) !== undefined
    : false;
}

function searchResultTitle(resultView: JsonElement | undefined): string | undefined {
  if (cardOf(resultView) !== 'search') return undefined;
  return resultView && typeof resultView === 'object' && !Array.isArray(resultView) ? str(resultView.title) : undefined;
}

function terminalDescription(callView: JsonElement | undefined): string | undefined {
  if (cardOf(callView) !== 'terminal') return undefined;
  return callView && typeof callView === 'object' && !Array.isArray(callView)
    ? str(callView.description)
    : undefined;
}

/** 把工作区内的绝对路径显示成相对路径。 */
function relativizeToCwd(summary: string, cwd: string | undefined): string {
  if (cwd === undefined || cwd.length === 0 || summary.length === 0) return summary;
  const root = cwd.replace(/\/+$/, '');
  if (summary === root) return '.';
  if (summary.startsWith(root + '/')) return summary.slice(root.length + 1);
  return summary;
}

export interface PreparingArguments { summary: string; kilobytes?: number }

const CONTENT_FIELDS = ['content', 'old_string', 'new_string'];

/**
 * 参数还在流式生成时的行摘要（对齐 Android/Mac `PreparingArguments`）：只看参数头 8K，
 * 从半截 JSON 里抠出已经写完的 file_path / path（文件类工具）或 description；
 * write / edit 带上内容大小。不对几 MB 的流式写入反复整段解析。
 */
export function preparingArguments(name: string, raw: string): PreparingArguments {
  const head = raw.slice(0, 8192);
  const partialString = (key: string): [string, boolean] | undefined => {
    const match = new RegExp('"' + key + '"\\s*:\\s*"').exec(head);
    if (match === null) return undefined;
    const start = match.index + match[0].length;
    let i = start;
    while (i < head.length) {
      if (head[i] === '\\') { i += 2; continue; }
      if (head[i] === '"') break;
      i += 1;
    }
    const complete = i < head.length;
    let encoded = head.slice(start, Math.min(i, head.length));
    if (!complete) encoded = encoded.replace(/\\(?:u[0-9a-fA-F]{0,3})?$/, '');
    try {
      const value: unknown = JSON.parse('"' + encoded + '"');
      return typeof value === 'string' ? [value, complete] : undefined;
    } catch {
      return undefined;
    }
  };
  const variant = classifyTool(name);
  const fileVariant = FILE_PATH_VARIANTS.has(variant);
  const path = fileVariant ? partialString('file_path') ?? partialString('path') : undefined;
  const summary =
    path !== undefined && path[1] ? firstLine(path[0]) : fileVariant ? '' : firstLine(partialString('description')?.[0] ?? '');
  const writes = variant === 'write' || variant === 'edit';
  const kilobytes =
    writes && CONTENT_FIELDS.some(key => new RegExp('"' + key + '"\\s*:').test(head)) ? Math.ceil(raw.length / 1024) : undefined;
  return { summary, kilobytes };
}

/** write / edit 的内容大小（KB），给已派发的行当后缀（对齐 Android contentKilobytes）。 */
function contentKilobytes(args: ArgsMap | undefined): number | undefined {
  if (args === undefined) return undefined;
  const values = CONTENT_FIELDS.map(key => args[key]).filter((value): value is string => typeof value === 'string');
  return values.length === 0 ? undefined : Math.ceil(values.reduce((sum, value) => sum + value.length, 0) / 1024);
}

export function toolRowModel(data: ToolChatData, cwd: string | undefined): ToolRowModel {
  const variant = classifyTool(data.name);
  if (data.preparing === true) {
    const preview = preparingArguments(data.name, data.argsRaw);
    return {
      variant,
      summary: relativizeToCwd(preview.summary, cwd),
      summarySuffix: preview.kilobytes === undefined ? undefined : preview.kilobytes + ' KB',
      state: 'preparing',
    };
  }
  const done = data.result !== undefined;
  const argsRaw = data.argsRaw;
  const args = argsRaw.length === 0 ? undefined : parseArgsMap(argsRaw);
  let state: ToolRowState = !done
    ? 'running'
    : data.result?.error?.code === 'interrupted'
      ? 'stopped'
      : data.result?.isError === true
        ? 'error'
        : 'ok';
  const base =
    data.name === 'todo_write'
      ? (todoSummary(argsRaw)?.[0] ?? '')
      : data.name === 'ask_user_question'
        ? (askSummary(data) ?? '')
        : data.name === 'exit_plan_mode'
          ? (planSummary(data) ?? '')
          : relativizeToCwd(deriveSummary(variant, argsRaw, args), cwd);
  const replacement = terminalDescription(data.callView) ?? searchResultTitle(data.result?.resultView);
  const summary =
    variant === 'others' && data.name.length > 0 && !KEYED_ROW_TOOLS.has(data.name)
      ? `${data.name} · ${base}`
      : (replacement ?? base);
  if (data.name === 'ask_user_question' && data.result?.error?.code === 'ASK_ABORTED') state = 'stopped';
  const resolvedState: ToolRowState =
    state === 'ok' && terminalFailed(data.result?.resultView) ? 'error' : state;
  const errorSummary =
    resolvedState === 'error' && data.result
      ? (resultFirstLine(data.result) || undefined)
      : undefined;
  return {
    variant,
    summary,
    filePath: deriveFilePath(variant, args),
    summarySuffix:
      errorSummary !== undefined
        ? undefined
        : data.name === 'todo_write'
          ? todoSummary(argsRaw)?.[1]
          : variant === 'write' || variant === 'edit'
            ? (kb => (kb === undefined ? undefined : kb + ' KB'))(contentKilobytes(args))
            : undefined,
    errorSummary,
    state: resolvedState,
  };
}

/** todo 行的摘要：完成数 + 当前进行项；后缀是并行数，不能被截断。 */
export function todoSummary(argsRaw: string): [string, string | undefined] | undefined {
  const args = parseArgsMap(argsRaw);
  if (args === undefined) return undefined;
  const rawTodos = args.todos;
  if (!Array.isArray(rawTodos)) return undefined;
  // 元素级校验：任一元素不是对象就整体回退到通用摘要（对齐 Mac 的 `as? [[String: Any]]`）。
  // 只过滤不拒绝的话，畸形参数会安静地读成「0/0 已完成」，比没有摘要更误导。
  const todos = rawTodos.filter(
    (item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item),
  );
  if (todos.length !== rawTodos.length) return undefined;
  const active = todos.filter(todo => todo.status === 'in_progress');
  const done = todos.filter(todo => todo.status === 'completed').length;
  const head = fmt(Strings.todoCompleted, done, todos.length);
  const first = active
    .map(todo => todo.content)
    .find((content): content is string => typeof content === 'string' && content.trim().length > 0);
  if (first === undefined) return [head, undefined];
  const suffix = active.length > 1 ? `+${active.length - 1}` : undefined;
  return [`${head} · ${first}`, suffix];
}

export function askSummary(data: ToolChatData): string | undefined {
  if (data.result?.error?.code === 'ASK_CANCELLED') return Strings.askCancelled;
  if (data.result?.error?.code === 'ASK_ABORTED') return Strings.askInterrupted;
  const result = data.result;
  if (result === undefined) return Strings.askWaiting;
  if (result.isError) return undefined;
  const text = result.content
    .filter((block): block is Extract<ContentBlock, { kind: 'text' }> => block.kind === 'text')
    .map(block => block.text)
    .join('');
  const args = parseArgsMap(text);
  if (args === undefined) return undefined;
  const rawAnswers = args.answers;
  if (!Array.isArray(rawAnswers)) return undefined;
  // 与 todoSummary 同款的元素级校验：元素不是对象就整体回退，不要读成「0/0 已回答」。
  const answers = rawAnswers.filter(
    (item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item),
  );
  if (answers.length !== rawAnswers.length) return undefined;
  const answered = answers.filter(answer => {
    const selected = answer.selected;
    const hasSelected = Array.isArray(selected) && selected.length > 0;
    const custom = answer.custom;
    const hasCustom = typeof custom === 'string' && custom.length > 0;
    return hasSelected || hasCustom;
  }).length;
  return fmt(Strings.askAnswered, answered, answers.length);
}

export function planSummary(data: ToolChatData): string | undefined {
  const result = data.result;
  if (result === undefined) return Strings.planAwaitingReview;
  if (result.isError) return undefined;
  return Strings.planApproved;
}

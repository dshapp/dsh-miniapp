import { fmt, getLocale, Strings } from '../i18n/strings';
import { arr, firstLine, int, jget, str, type JsonElement } from './json';
import { parseArgsMap } from './toolRow';
import {
  agentPresetIsBuiltIn,
  type AgentPresetEntry,
  type SessionId,
  type SessionSearchItem,
  type SessionSummary,
  type SubagentListEntry,
  type TokenUsage,
} from './types';
import type { ChatNode } from './chatNode';

// 轮次页脚格式化（与 iOS/web 同口径）——————————————————————————

/**
 * 非负夹取，NaN / 无穷读作 0（对齐 Android nonNegative 与 Mac 的 max(0, x)）。
 *
 * 时长与速率都从主机投影与 wire 上来：wire 上 `"NaN"` / `"1e400"` 这类字符串会被原样
 * 解析成 NaN / Infinity。JS 的 `Math.max(0, NaN)` 是 NaN，之后 `toFixed` 会把
 * "NaN"、`Math.floor` 会把 "NaN分NaN秒" 直接印到界面上。
 */
function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * 整秒向下取（web `formatRunDuration`）：每个数字后面跟本地化单位、不补零；满 60 秒出分钟，
 * 满 60 分钟出小时——「5s / 2m 5s / 1h 0m 3s」「5秒 / 2分5秒 / 1小时0分3秒」。
 */
export function formatDuration(ms: number): string {
  const total = Math.floor(nonNegative(ms) / 1000);
  let text = '';
  if (total >= 3600) text += String(Math.floor(total / 3600)) + Strings.durationHourUnit;
  if (total >= 60) text += String(Math.floor(total / 60) % 60) + Strings.durationMinuteUnit;
  return text + String(total % 60) + Strings.durationSecondUnit;
}

/** 上下文面板里的用时读数：不足一分钟保留一位小数，超过按分秒拆开。 */
export function formatStatsDuration(ms: number): string {
  const seconds = nonNegative(ms) / 1000;
  if (seconds < 60) {
    const tenths = Math.round(seconds * 10);
    const text = tenths % 10 === 0 ? String(tenths / 10) : `${Math.floor(tenths / 10)}.${tenths % 10}`;
    return fmt(Strings.durationSecondsText, text);
  }
  const whole = Math.round(seconds);
  return fmt(Strings.statsDurationMinutes, Math.floor(whole / 60), whole % 60);
}

export function formatLatencySeconds(ms: number): string {
  const s = nonNegative(ms) / 1000;
  return s < 10 ? (Math.round(s * 10) / 10).toFixed(1) : s.toFixed(0);
}

export function formatTokensPerSecond(tps: number): string {
  const clamped = nonNegative(tps);
  return clamped >= 10 ? clamped.toFixed(0) : (Math.round(clamped * 10) / 10).toFixed(1);
}

/**
 * 单轮 Token 总量（对齐 Mac/Android 的 saturatingAdding 口径）。
 *
 * 四个桶都直接来自 wire，wire 上的整数没有上界；两端都把总量夹在 32 位区间内，
 * 这样同一条会话在手机与桌面上读到的是同一个数字。
 */
export function turnTotalTokens(usage: TokenUsage): number {
  const uncached = usage.uncachedInputTokens ?? usage.inputTokens ?? 0;
  return saturatingAdd(
    saturatingAdd(saturatingAdd(uncached, usage.cacheReadTokens ?? 0), usage.cacheWriteTokens ?? 0),
    usage.outputTokens ?? 0,
  );
}

export function formatTokens(value: number): string {
  const scaled = (candidate: number): string => {
    if (candidate >= 100) return candidate.toFixed(0);
    const tenths = Math.round(candidate * 10);
    return tenths % 10 === 0 ? String(tenths / 10) : `${Math.floor(tenths / 10)}.${tenths % 10}`;
  };
  if (value < 1000) return String(value);
  if (value < 1_000_000) return scaled(value / 1000) + 'K';
  return scaled(value / 1_000_000) + 'M';
}

export function formatExactTokens(value: number): string {
  return value.toLocaleString('en-US');
}

export function tokenCount(value: number): string {
  return fmt(Strings.turnUsageCount, formatExactTokens(value));
}

export function compactTokenCount(value: number): string {
  return fmt(Strings.turnUsageCount, formatTokens(value));
}

/** 与 Mac/Android WireNumbers.saturatingAdding 同一口径：溢出就顶到该方向的极值。 */
export function saturatingAdd(a: number, b: number): number {
  const sum = a + b;
  if (sum > 2_147_483_647) return 2_147_483_647;
  if (sum < -2_147_483_648) return -2_147_483_648;
  return sum;
}

/** 定点小数；只用于非负小读数，与 Mac/Android 的固定小数位同口径。 */
function formatFixed(value: number, places: number): string {
  const scale = 10 ** places;
  const units = Math.round(value * scale);
  const whole = Math.floor(units / scale);
  const fraction = Math.abs(units % scale);
  return places === 0 ? String(whole) : whole + '.' + String(fraction).padStart(places, '0');
}

/**
 * 会话级缓存命中率（Mac/Android `sessionCacheHitPercent`）。
 *
 * 先按整数百分比取；只有会读成 100 的部分命中才多要几位小数（99.9、99.99…），
 * 最多 6 位，仍不够就退到 "99.9"——任何部分命中都不许读成整 100%。
 *
 * 不能用单轮的 cacheHitPercent 代替：那个是「固定一位小数 + 夹到 99.9」的口径，
 * 99.94% 这样的会话读数会被它显示成 99.9（对齐 Android SessionUsageReading.kt:53-77）。
 */
export function sessionCacheHitPercent(cacheRead: number, billed: number): string | undefined {
  if (billed <= 0) return undefined;
  if (cacheRead >= billed) return '100';
  const ratio = (cacheRead / billed) * 100;
  for (let places = 0; places <= 6; places += 1) {
    const scale = 10 ** places;
    const rounded = Math.round(ratio * scale) / scale;
    if (rounded >= 100) continue;
    if (places === 0) return String(Math.round(rounded));
    return formatFixed(rounded, places);
  }
  return '99.9';
}

export function cacheHitPercent(usage: TokenUsage): string | undefined {
  const cacheRead = usage.cacheReadTokens;
  if (cacheRead === undefined) return undefined;
  const prompt = turnTotalTokens(usage) - (usage.outputTokens ?? 0);
  if (prompt <= 0) return undefined;
  const tenths = Math.min(1000, Math.max(0, Math.round((cacheRead / prompt) * 1000)));
  const units = cacheRead < prompt ? Math.min(tenths, 999) : tenths;
  const whole = Math.floor(units / 10);
  const fraction = units % 10;
  return fraction === 0 ? String(whole) : `${whole}.${fraction}`;
}

// 会话标题 ————————————————————————————————————————————————————

export function pathBasename(path: string): string {
  let trimmed = path;
  while (trimmed.length > 0 && (trimmed.endsWith('/') || trimmed.endsWith('\\'))) {
    trimmed = trimmed.slice(0, -1);
  }
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

/**
 * 会话的显示标题（web `displayTitle`）：空白会话是「新会话」占位，然后是打开中会话的实时标题、
 * 投影标题；都没有就显示「未命名」——0.2.0 起 web 不再拿目录名或 sessionId 兜底
 *（对齐 Android Format.kt `sessionDisplayTitle`）。
 *
 * 空白会话还没有任何内容，主机也没给过标题；不先判 blank 的话，新建出来的会话在
 * 会话页顶栏上读作「未命名」，而列表里同一条会话写的是「新会话」——两处对不上。
 */
export function sessionDisplayTitle(summary: SessionSummary, liveTitle?: string): string {
  if (summary.blank) return Strings.newSessionPlaceholder;
  const stored = sessionStoredTitle(summary, liveTitle);
  return stored.length > 0 ? stored : Strings.sessionUntitled;
}

/** 列表标题：空白会话显示占位名，实时标题优先。 */
export function sessionListTitle(summary: SessionSummary, liveTitle: string | undefined): string {
  return sessionDisplayTitle(summary, liveTitle);
}

/**
 * 会话自己的标题（web `titleOf`）：实时标题 → 投影标题，去掉首尾空白；没有就是空串。
 *
 * 搜索与重命名预填只用这一份：未命名会话不能再借一个已经不显示的目录名命中搜索。
 */
export function sessionStoredTitle(summary: SessionSummary, liveTitle: string | undefined): string {
  if (summary.blank) return '';
  const live = liveTitle?.trim();
  if (live !== undefined && live.length > 0) return live;
  return str(jget(summary.projections?.values as JsonElement, 'title'))?.trim() ?? '';
}

export function sessionWorkspaceName(workspaceTitle: string | undefined, cwd: string | undefined): string | undefined {
  if (workspaceTitle !== undefined && workspaceTitle.length > 0) return workspaceTitle;
  if (cwd === undefined || cwd.length === 0) return undefined;
  const base = pathBasename(cwd);
  return base.length > 0 ? base : undefined;
}

export function sessionMatchesSearch(title: string, workspaceName: string | undefined, query: string): boolean {
  const needle = query.trim();
  if (needle.length === 0) return false;
  const lower = needle.toLowerCase();
  if (title.toLowerCase().includes(lower)) return true;
  return workspaceName !== undefined && workspaceName.toLowerCase().includes(lower);
}

export const SESSION_SEARCH_RESULT_LIMIT = 20;
const SESSION_SEARCH_QUERY_MAX_CODE_UNITS = 500;

/** 把输入限制在 session/search 的线上契约里：去 NUL、截到 500 个 code unit（不劈开代理对），对齐 web。 */
export function sanitizeSearchQuery(value: string): string {
  const withoutNul = value.split('\0').join('');
  if (withoutNul.length <= SESSION_SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul;
  let end = SESSION_SEARCH_QUERY_MAX_CODE_UNITS;
  const last = withoutNul.charCodeAt(end - 1);
  const next = withoutNul.charCodeAt(end);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
  return withoutNul.slice(0, end);
}

export interface SessionSearchRows {
  sessions: SessionSummary[];
  hasMore: boolean;
}

/**
 * 会话搜索结果，逐条对齐 web deriveSearchResults：
 * 本地标题（只认会话自己的标题 [sessionStoredTitle]，0.2.0 起不回落到目录名/sessionId）/工作区名子串命中按 updatedAt 新到旧领先，主机内容命中按后端顺序去重接在后面，
 * 截到 limit 条；hasMore = 后端 hasMore || 合并总数超过 limit。
 * `listed` 是主列表可见的名册（已滤掉空白、subagent 与已归档），主机命中不在其中的直接丢弃。
 */
export function deriveSessionSearchResults(
  listed: SessionSummary[],
  workspaceTitles: Map<SessionId, string>,
  liveTitle: (sessionId: SessionId) => string | undefined,
  query: string,
  remote: { items: SessionSearchItem[]; hasMore: boolean },
  limit = SESSION_SEARCH_RESULT_LIMIT,
): SessionSearchRows {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return { sessions: [], hasMore: false };
  const local = listed
    .filter(summary =>
      sessionStoredTitle(summary, liveTitle(summary.sessionId)).toLowerCase().includes(needle)
      || (sessionWorkspaceName(workspaceTitles.get(summary.sessionId), summary.cwd) ?? '').toLowerCase().includes(needle),
    )
    .sort((a, b) => (a.updatedAt !== b.updatedAt ? b.updatedAt - a.updatedAt : a.sessionId < b.sessionId ? -1 : 1));
  const byId = new Map(listed.map(summary => [summary.sessionId, summary]));
  const ordered: SessionSummary[] = [];
  const seen = new Set<SessionId>();
  const include = (summary: SessionSummary): void => {
    if (seen.has(summary.sessionId)) return;
    seen.add(summary.sessionId);
    ordered.push(summary);
  };
  for (const summary of local) include(summary);
  for (const hit of remote.items) {
    const summary = byId.get(hit.sessionId);
    if (summary !== undefined) include(summary);
  }
  return { sessions: ordered.slice(0, limit), hasMore: remote.hasMore || ordered.length > limit };
}

// 列表行尾 ————————————————————————————————————————————————————

export type SessionAwaitingKind = 'approval' | 'planReview' | 'question';

export function sessionAwaitingBadge(kind: SessionAwaitingKind): string {
  switch (kind) {
    case 'approval': return Strings.sessionAwaitingApproval;
    case 'planReview': return Strings.sessionAwaitingPlanReview;
    case 'question': return Strings.sessionAwaitingQuestion;
  }
}

export type SessionRowTrailing =
  | { kind: 'awaitingUser'; awaiting: SessionAwaitingKind }
  | { kind: 'draft' }
  | { kind: 'time'; updatedAt: number }
  | { kind: 'none' };

export function resolveSessionRowTrailing(
  awaitingUser: SessionAwaitingKind | undefined,
  isSelected: boolean,
  isArchived: boolean,
  isBlank: boolean,
  hasDraft: boolean,
  updatedAt: number,
): SessionRowTrailing {
  if (isArchived || isBlank) return { kind: 'none' };
  if (isSelected) return { kind: 'time', updatedAt };
  if (awaitingUser !== undefined) return { kind: 'awaitingUser', awaiting: awaitingUser };
  if (hasDraft) return { kind: 'draft' };
  return { kind: 'time', updatedAt };
}

// 轮次导航 ————————————————————————————————————————————————————

export interface TurnRailItem {
  turn: number;
  prompt: string;
  response: string;
  anchorRow?: string;
  promptRow?: string;
  seq?: number;
}

export const TURN_RAIL_PROMPT_LIMIT = 50;
export const TURN_RAIL_RESPONSE_LIMIT = 120;

export function clipTurnRailPreview(parts: string[], limit: number): string {
  let text = '';
  let unread = false;
  for (const part of parts) {
    if (text.length >= limit * 2) {
      unread = true;
      break;
    }
    const clipped = part.length > limit * 2;
    const chunk = clipped ? part.slice(0, limit * 2) : part;
    text = text.length === 0 ? chunk : `${text} ${chunk}`;
    if (clipped) {
      unread = true;
      break;
    }
  }
  const normalized = text.split(/\s+/).filter(Boolean).join(' ');
  if (normalized.length > limit - 1) return normalized.slice(0, limit - 1).trim() + '…';
  return unread ? normalized + '…' : normalized;
}

export function mergeTurnRailItems(
  outline: JsonElement | undefined,
  anchors: Map<number, string>,
  promptAnchors: Map<number, string>,
  loadedPreview: (turn: number) => [string, string],
): TurnRailItem[] {
  const prompts = new Map<number, string>();
  const responses = new Map<number, string>();
  const seqs = new Map<number, number>();
  for (const entry of arr(outline) ?? []) {
    const turn = int(jget(entry, 'turn'));
    const seq = int(jget(entry, 'seq'));
    if (turn === undefined || seq === undefined) continue;
    if (turn < 0 || seq < 0) continue;
    seqs.set(turn, seq);
    prompts.set(turn, str(jget(entry, 'prompt')) ?? '');
    responses.set(turn, str(jget(entry, 'response')) ?? '');
  }
  const turns = Array.from(new Set([...seqs.keys(), ...anchors.keys()])).sort((a, b) => a - b);
  return turns.map(turn => {
    const anchor = anchors.get(turn);
    let prompt = prompts.get(turn) ?? '';
    let response = responses.get(turn) ?? '';
    if (anchor !== undefined && (prompt.length === 0 || response.length === 0)) {
      const [loadedPrompt, loadedResponse] = loadedPreview(turn);
      if (prompt.length === 0) prompt = loadedPrompt;
      if (response.length === 0) response = loadedResponse;
    }
    return { turn, prompt, response, anchorRow: anchor, promptRow: promptAnchors.get(turn), seq: seqs.get(turn) };
  });
}

// 计划模式 ————————————————————————————————————————————————————

export const PLAN_MODE_ENTER = '/plan';
export const PLAN_MODE_LEAVE = '/plan off';

export function planModeLine(target: boolean): string {
  return target ? PLAN_MODE_ENTER : PLAN_MODE_LEAVE;
}

// 产物 ————————————————————————————————————————————————————————

export interface PresentedFile { seq: number; index: number; path: string; description?: string }

export function presentedFiles(seq: number, data: JsonElement | undefined): [number, PresentedFile[]] | undefined {
  const turn = int(jget(data, 'turn'));
  if (turn === undefined || turn < 1) return undefined;
  const entries = arr(jget(data, 'files'));
  if (entries === undefined) return undefined;
  const files: PresentedFile[] = [];
  entries.forEach((entry, index) => {
    const path = str(jget(entry, 'path'));
    if (path === undefined || path.trim().length === 0) return;
    files.push({ seq, index, path, description: str(jget(entry, 'description')) });
  });
  return files.length === 0 ? undefined : [turn, files];
}

function pathValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** 从模型自己的参数解析出这次调用产出的文件。 */
export function producedPath(name: string, argsRaw: string): string | undefined {
  const args = parseArgsMap(argsRaw);
  if (args === undefined) return undefined;
  if (name === 'write') return typeof args.content === 'string' ? pathValue(args.file_path) : undefined;
  if (name === 'edit') {
    const old = args.old_string;
    const next = args.new_string;
    if (typeof old !== 'string' || old.length === 0) return undefined;
    if (typeof next !== 'string' || old === next) return undefined;
    // replace_all 要么缺省、要么必须是布尔：别的类型说明这次调用畸形，不算产出
    // （Web validEditArgs / Mac producedPath 同款校验）。漏掉这道校验会让「本轮改动」
    // 里多出一个根本没写成的路径。
    const replaceAll = args.replace_all;
    if (replaceAll !== undefined && replaceAll !== null && typeof replaceAll !== 'boolean') return undefined;
    return pathValue(args.file_path);
  }
  if (name === 'str_replace_editor') {
    const path = pathValue(args.path);
    if (path === undefined) return undefined;
    if (args.command === 'create') return typeof args.file_text === 'string' ? path : undefined;
    if (args.command === 'str_replace') {
      const old = args.old_str;
      if (typeof old !== 'string' || old.length === 0) return undefined;
      // new_str 缺省或字符串都行，别的类型整条不算（Web editorMutationPath）。
      const next = args.new_str;
      if (next !== undefined && next !== null && typeof next !== 'string') return undefined;
      return path;
    }
    if (args.command === 'insert') {
      // 必须是整数行号：1.5 这种小数在 Web 走 Number.isInteger 被拒、Mac 的 as? Int 也拒；
      // 截断（Math.trunc）会把它当成合法的第 1 行。
      const raw = args.insert_line;
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return undefined;
      return typeof args.new_str === 'string' ? path : undefined;
    }
    return undefined;
  }
  return undefined;
}

export function resolveMention(value: string, paths: string[]): string | undefined {
  if (paths.includes(value)) return value;
  const matches = paths.filter(path => pathBasename(path) === value);
  return matches.length === 1 ? matches[0] : undefined;
}

export function turnDeliverablesFor(nodes: ChatNode[]): PresentedFile[] {
  const files: PresentedFile[] = [];
  let scannedTurns = 0;
  const seenTurns = new Set<number>();
  for (let i = nodes.length - 1; i >= 0 && scannedTurns < 6; i -= 1) {
    const node = nodes[i];
    if (node.kind === 'turnTail' && !seenTurns.has(node.data.turn)) {
      seenTurns.add(node.data.turn);
      scannedTurns += 1;
      continue;
    }
    // 只认根调用的、成功收尾的那一次写入（对齐 Android SessionStore 推断产物时的两道闸）：
    // 失败的 write/edit 什么也没写成，run_code 里派发的嵌套子调用则归它的根调用统计，
    // 两者都算进来会让「本轮改动」列出根本不存在的文件。
    if (node.kind === 'tool' && node.data.parentCallId === undefined) {
      const result = node.data.result;
      if (result !== undefined && !result.isError) {
        const path = producedPath(node.data.name, node.data.argsRaw);
        if (path !== undefined && !files.some(file => file.path === path)) {
          files.push({ seq: node.data.startSeq, index: 0, path });
        }
      }
    }
  }
  return files.reverse();
}

// Agent 预设显示 ——————————————————————————————————————————————

export interface AgentPresetDisplayText { name: string; description?: string }

export function agentPresetDisplayText(preset: AgentPresetEntry): AgentPresetDisplayText {
  // 0.1.7：内置预设不再带 trust，也不发布 name/description，按 id 本地化（对齐 Mac isBuiltIn）。
  if (agentPresetIsBuiltIn(preset)) {
    switch (preset.id) {
      case 'standard':
        return { name: Strings.presetStandardName, description: preset.description ?? Strings.presetStandardDescription };
      case 'ptc':
        return { name: Strings.presetPtcName, description: preset.description ?? Strings.presetPtcDescription };
      case 'minimal':
        return { name: Strings.presetMinimalName, description: preset.description ?? Strings.presetMinimalDescription };
      case 'cordis':
        return { name: Strings.presetCordisName, description: preset.description ?? Strings.presetCordisDescription };
      default:
        break;
    }
  }
  return { name: preset.name ?? preset.id, description: preset.description };
}

/** 非内置预设在选择器里追加「· 自定义」，不让它读起来像随 DSH 发布、经过审核的预设。 */
export function agentPresetMenuLabel(preset: AgentPresetEntry): string {
  const { name } = agentPresetDisplayText(preset);
  return agentPresetIsBuiltIn(preset) ? name : `${name} · ${Strings.presetUserTrust}`;
}

// "(Recommended)" 后缀拆分 ——————————————————————————————————

export interface RecommendedOptionLabel { label: string; recommended: boolean }

const RECOMMENDED_SUFFIX = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;

export function splitRecommended(raw: string): RecommendedOptionLabel {
  const match = RECOMMENDED_SUFFIX.exec(raw);
  if (match === null) return { label: raw, recommended: false };
  const label = raw.slice(0, match.index).trim();
  if (label.length === 0) return { label: raw, recommended: false };
  return { label, recommended: true };
}

// 目标 ————————————————————————————————————————————————————————

/**
 * 目标条上暂停/恢复那一项的落点；undefined = 条上不给这一项。
 *
 * 只映射主机真的接受的转移（dsh-goal 的 pause/resume）：pause 仅 active，
 * resume 仅 paused。web 的 GoalBar 只有 showResume = paused || (active && disarmed)、
 * pause 仅 active && armed；Mac 的 GoalBarContent 同样只画 active→pause、paused→resume。
 * 所以 blocked 两个都不给——对它发 pause 必被主机回 GOAL_INVALID_TRANSITION，
 * 那个按钮点了只会报错，永远不成（对齐 Android model/GoalPhaseAction.kt）。
 */
export type GoalPhaseAction = 'pause' | 'resume';

export function goalPhaseAction(phase: string, disarmed = false): GoalPhaseAction | undefined {
  // 0.2.1：主机不会自己续跑的 active 目标（disarmed）只能「恢复」。
  if (phase === 'active') return disarmed ? 'resume' : 'pause';
  if (phase === 'paused') return 'resume';
  return undefined;
}

// 相对时间 ————————————————————————————————————————————————————

/**
 * 紧凑相对时间，六档桶与 Web ui-primitives / Mac / Android 的 relativeTime 同口径：
 * now（<1 分钟）、minutes、hours、days、months（30 天起）、years（365 天起）。
 *
 * 口径必须各端一致：同一屏里对同一条会话的说法不能一个是"刚刚"一个是"0秒"，
 * 也不能把一年前读成 "395天"。
 */
export function relativeTime(updatedAtMs: number): string {
  // 时钟漂移会让 updatedAt 落到未来；夹到 0 后走 now 档，不出现负数。
  const delta = Math.max(0, Date.now() - updatedAtMs);
  const en = getLocale() === 'en';
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  const month = 30 * day;
  const year = 365 * day;
  if (delta < minute) return en ? 'now' : '刚刚';
  if (delta < hour) return en ? `${Math.floor(delta / minute)}min` : `${Math.floor(delta / minute)}分钟`;
  if (delta < day) return en ? `${Math.floor(delta / hour)}h` : `${Math.floor(delta / hour)}小时`;
  if (delta < month) return en ? `${Math.floor(delta / day)}d` : `${Math.floor(delta / day)}天`;
  if (delta < year) return en ? `${Math.floor(delta / month)}mo` : `${Math.floor(delta / month)}个月`;
  return en ? `${Math.floor(delta / year)}y` : `${Math.floor(delta / year)}年`;
}

export function clockTime(ms: number): string {
  const date = new Date(ms);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatBytes(count: number): string {
  if (count >= 1 << 20) return (count / (1 << 20)).toFixed(1) + ' MB';
  return (count / 1024).toFixed(0) + ' KB';
}

export function subagentSessionIds(entries: SubagentListEntry[]): SessionId[] {
  return entries.map(entry => entry.sessionId);
}

export { firstLine };

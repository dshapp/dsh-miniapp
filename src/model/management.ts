import { arr, bool, isObject, jget, str, type JsonObject, type JsonValue } from './json';

/*
 * 管理页（插件、自动化任务、宿主设置）的数据口径，照安卓 model/ManagementModels.kt 与 HostSettings.kt：
 * 原始对象整份留着（主机以后多出的字段不丢），界面只读用得到的几个字段；乐观写只回写精确的 ScheduleRecord。
 */

/** pluginManager/listBundles 的一项。 */
export interface ManagedBundle {
  raw: JsonObject;
  name: string;
  official: boolean;
  enabled: boolean;
  installed: boolean;
  /** 官方按需安装、还没装上的条目。 */
  missing: boolean;
  readOnlyReason?: string;
  removable: boolean;
  version?: string;
  description?: string;
  /** 主机给出的精确安装目标；没有版本就不给安装入口。 */
  installSpec?: string;
  installVersion?: string;
  updateAvailable: boolean;
  rows: JsonObject[];
}

export function decodeBundle(raw: JsonObject): ManagedBundle {
  const installed = bool(raw.installed) === true;
  const installVersion = str(jget(raw.installTarget, 'version'));
  const spec = str(jget(raw.installTarget, 'spec'));
  const installSpec = spec !== undefined && spec.trim().length > 0 && installVersion !== undefined && installVersion.length > 0 ? spec : undefined;
  const version = str(raw.version);
  return {
    raw,
    name: str(raw.name) ?? '',
    official: bool(raw.official) === true,
    enabled: bool(raw.enabled) === true,
    installed,
    missing: str(raw.availability) === 'missing',
    readOnlyReason: str(raw.readOnlyReason),
    removable: bool(raw.removable) === true && installed,
    version,
    description: str(raw.description),
    installSpec,
    installVersion,
    updateAvailable:
      installed &&
      str(raw.availability) === 'profile' &&
      installSpec !== undefined &&
      (version !== installVersion || (installSpec.startsWith('link:') && str(raw.source) !== installSpec)),
    rows: (arr(raw.rows) ?? []).filter(isObject),
  };
}

export function decodeBundles(value: JsonValue | undefined): ManagedBundle[] {
  if (!Array.isArray(value)) throw new Error('Invalid bundle catalog');
  return value.filter(isObject).map(decodeBundle);
}

/** 一组不兼容的「插件包版本 × 运行时版本」。 */
export interface IncompatiblePair { name: string; version: string; runtimeVersion: string }

/** 安装结果与各 bundle 诊断里报出的不兼容组合，去重（对齐安卓 PluginManagerScreen 的 incompatible）。 */
export function incompatiblePairs(result: JsonValue | undefined, bundles: ManagedBundle[]): IncompatiblePair[] {
  const raw = [
    ...(arr(jget(jget(result, 'error'), 'incompatible')) ?? arr(jget(jget(result, 'packageResult'), 'incompatible')) ?? []),
    ...bundles.flatMap(bundle => arr(jget(bundle.raw.error, 'incompatible')) ?? []),
  ];
  const seen = new Set<string>();
  const out: IncompatiblePair[] = [];
  for (const item of raw) {
    const name = str(jget(item, 'name'));
    const version = str(jget(item, 'version'));
    const runtimeVersion = str(jget(item, 'runtimeVersion'));
    if (name === undefined || version === undefined || runtimeVersion === undefined) continue;
    const key = name + '@' + version + '/' + runtimeVersion;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, version, runtimeVersion });
  }
  return out;
}

/** listVersionExemptions 摊平成「包@版本 / 运行时」行。 */
export function savedExemptions(value: JsonValue | undefined): Array<{ packageVersion: string; runtimeVersion: string }> {
  const map = jget(value, 'exemptions');
  if (!isObject(map)) return [];
  return Object.entries(map).flatMap(([packageVersion, runtimes]) =>
    (arr(runtimes) ?? []).flatMap(runtime => (typeof runtime === 'string' ? [{ packageVersion, runtimeVersion: runtime }] : [])),
  );
}

/** schedule/catalog 的一项（自动化任务规则）。 */
export interface ManagedAutomation {
  raw: JsonObject;
  id: string;
  sessionId: string;
  title: string;
  prompt: string;
  kind: string;
  status: string;
  active: boolean;
  scheduledAt?: string;
  lastDeliveredAt?: string;
  key: string;
}

export function decodeAutomations(value: JsonValue | undefined): ManagedAutomation[] {
  if (!Array.isArray(value)) throw new Error('Invalid automation catalog');
  return value.filter(isObject).map(raw => {
    const id = str(raw.id) ?? '';
    const sessionId = str(raw.sessionId) ?? '';
    return {
      raw,
      id,
      sessionId,
      title: str(raw.title) ?? '',
      prompt: str(raw.prompt) ?? '',
      kind: str(raw.kind) ?? '',
      status: str(raw.status) ?? '',
      active: str(raw.status) === 'active',
      scheduledAt: str(raw.scheduledAt),
      lastDeliveredAt: str(jget(raw.lastDelivery, 'deliveredAt')),
      key: sessionId + ':' + id,
    };
  });
}

const RECORD_FIELDS: Record<string, string[]> = {
  after: ['afterSeconds'],
  at: [],
  every: ['everySeconds'],
  daily: ['time', 'timeZone'],
  weekly: ['time', 'timeZone', 'weekdays'],
  cron: ['expression', 'timeZone'],
};

/** schedule/update 的 expected：编辑开始时看到的那份完整 ScheduleRecord（对齐安卓 scheduleExpected）。 */
export function scheduleExpected(entry: JsonObject): JsonObject {
  const fields = RECORD_FIELDS[str(entry.kind) ?? ''];
  if (fields === undefined) throw new Error('Unsupported ScheduleRecord kind');
  const out: JsonObject = {};
  for (const key of ['id', 'kind', 'title', 'prompt', 'scheduledAt', ...fields]) {
    const value = entry[key];
    if (value === undefined || value === null) throw new Error('Missing ScheduleRecord field: ' + key);
    out[key] = value;
  }
  return out;
}

/**
 * 规则编辑草稿（对齐安卓 `AutomationDraft`）：快照不可变——广播与冲突都不能替换编辑开始时的 expected。
 * 不勾「修改时间规则」时保留原精确目标；after 规则只能改成 at（绝对时间）或别的规则。
 */
export interface AutomationDraft {
  entry: ManagedAutomation;
  title: string;
  prompt: string;
  timingChanged: boolean;
  kind: string;
  at: string;
  seconds: string;
  time: string;
  zone: string;
  weekdays: string;
  expression: string;
}

export const AUTOMATION_KINDS = ['at', 'every', 'daily', 'weekly', 'cron'];

export function automationDraft(entry: ManagedAutomation): AutomationDraft {
  const raw = entry.raw;
  const weekdays = arr(raw.weekdays);
  return {
    entry,
    title: entry.title,
    prompt: entry.prompt,
    timingChanged: false,
    kind: entry.kind === 'after' ? 'at' : entry.kind,
    at: str(raw.scheduledAt) ?? '',
    seconds: raw.everySeconds === undefined || raw.everySeconds === null ? '3600' : String(raw.everySeconds),
    time: str(raw.time) ?? '09:00:00',
    zone: str(raw.timeZone) ?? 'UTC',
    weekdays: weekdays === undefined ? '1,2,3,4,5' : weekdays.map(item => String(item)).join(','),
    expression: str(raw.expression) ?? '0 9 * * *',
  };
}

const MAX_SAFE = 9007199254740991;

/** 数字五段 cron（分 时 日 月 星期），与安卓 `validManagementCron` 同一口径。 */
export function validManagementCron(expression: string): boolean {
  if (expression !== expression.trim()) return false;
  const fields = expression.split(/\s+/);
  const bounds: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  if (fields.length !== 5) return false;
  return fields.every((field, i) =>
    field.split(',').every(part => {
      const match = /^(\*|[0-9]+(?:-[0-9]+)?)(?:\/([0-9]+))?$/.exec(part);
      if (match === null) return false;
      const step = match[2] ?? '';
      if (step.length > 0 && !(Number(step) >= 1 && Number(step) <= MAX_SAFE)) return false;
      const selector = match[1];
      if (selector === '*') return true;
      const range = selector.split('-').map(Number);
      const [low, high] = bounds[i];
      if (!range.every(value => Number.isInteger(value) && value >= low && value <= high)) return false;
      if (range.length !== 2 && step.length > 0) return false;
      return range.length !== 2 || range[0] <= range[1];
    }),
  );
}

function validTimeZone(zone: string): boolean {
  if (zone === 'UTC') return true;
  if (!/^[A-Za-z_+-]+(\/[A-Za-z0-9_+-]+)+$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    // 运行时没有完整时区库时只按格式判，最终由主机校验。
    return typeof Intl === 'undefined';
  }
}

/** 第一个无效字段的名字；全部合法返回 undefined。 */
export function automationDraftError(draft: AutomationDraft): string | undefined {
  const title = draft.title.trim();
  if (title.length === 0 || title.length > 120) return 'title';
  if (draft.prompt.trim().length === 0) return 'prompt';
  if (!draft.timingChanged) return undefined;
  switch (draft.kind) {
    case 'every':
      return /^[0-9]+$/.test(draft.seconds) && Number(draft.seconds) >= 60 && Number(draft.seconds) <= MAX_SAFE ? undefined : 'interval';
    case 'at':
      return /^[0-9]{4}-.*Z$/.test(draft.at) && !Number.isNaN(Date.parse(draft.at)) ? undefined : 'UTC timestamp';
    case 'daily':
    case 'weekly':
    case 'cron':
      break;
    default:
      return 'kind';
  }
  if (!validTimeZone(draft.zone)) return 'time zone';
  if (draft.kind === 'cron') return validManagementCron(draft.expression) ? undefined : 'cron';
  const time = /^([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]{1,3})?$/.exec(draft.time);
  if (time === null || Number(time[1]) > 23 || Number(time[2]) > 59 || Number(time[3]) > 59) return 'time';
  if (draft.kind === 'weekly') {
    const days = draft.weekdays.split(',').map(item => Number(item.trim()));
    if (days.length === 0 || days.some(day => !Number.isInteger(day) || day < 1 || day > 7) || new Set(days).size !== days.length) {
      return 'weekdays';
    }
  }
  return undefined;
}

/** schedule/update 的 change（ScheduleTimingChange）；没勾修改时间规则就不带。 */
export function automationTiming(draft: AutomationDraft): JsonObject | undefined {
  if (!draft.timingChanged) return undefined;
  if (draft.kind === 'at') return { kind: 'at', at: draft.at };
  if (draft.kind === 'every') return { kind: 'every', every_seconds: Number(draft.seconds) };
  const body: JsonObject = { time_zone: draft.zone };
  if (draft.kind === 'cron') body.expression = draft.expression;
  else body.time = draft.time;
  if (draft.kind === 'weekly') body.weekdays = draft.weekdays.split(',').map(item => Number(item.trim())).sort((a, b) => a - b);
  return { kind: draft.kind, [draft.kind]: body };
}

/** 宿主设置：llm/listConfigurableProviders 的一项，加上凭证引用的只读状态。 */
export interface ProviderSettingsRow {
  provider: string;
  displayName: string;
  error?: string;
  credentialRef?: string;
  /** provider 没有显式点名 apiKeyEnv，按命名规则推导出来的引用。 */
  derivedRef: boolean;
  configured?: boolean;
  source?: string;
}

export function deriveCredentialRef(provider: string): string {
  return provider.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase() + '_API_KEY';
}

function valueAt(root: JsonValue | undefined, path: string[]): JsonValue | undefined {
  let cursor = root;
  for (const segment of path) {
    if (Array.isArray(cursor)) cursor = cursor[Number(segment)];
    else if (isObject(cursor)) cursor = cursor[segment];
    else return undefined;
  }
  return cursor;
}

/** 把 provider 列表与 settings/describe 的命名空间对上，算出每家的凭证引用（对齐安卓 ProviderSettingsRow）。 */
export function providerSettingsRows(providers: JsonValue | undefined, describe: JsonValue | undefined): ProviderSettingsRow[] {
  const namespaces = (arr(jget(describe, 'namespaces')) ?? []).filter(isObject);
  return (Array.isArray(providers) ? providers : []).filter(isObject).map(entry => {
    const provider = str(entry.provider) ?? '';
    const ns = namespaces.find(item => str(item.ns) === str(entry.settingsNs));
    const path = (arr(entry.settingsPath) ?? []).map(item => String(item));
    const named = provider === 'deepseek-account' ? undefined : str(valueAt(ns?.value, [...path, 'apiKeyEnv']));
    const namedRef = named !== undefined && named.trim().length > 0 ? named : undefined;
    const credentialRef = provider === 'deepseek-account' ? undefined : namedRef ?? deriveCredentialRef(provider);
    return {
      provider,
      displayName: str(entry.displayName) ?? '',
      error: str(entry.error),
      credentialRef,
      derivedRef: credentialRef !== undefined && namedRef === undefined,
    };
  });
}

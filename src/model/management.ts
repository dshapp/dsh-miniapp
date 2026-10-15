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
  settingsNs: string;
  settingsPath: string[];
  /** settings/describe 里对应的命名空间（schema / value / base / user / revision / secrets）。 */
  namespace?: JsonObject;
  /** 模型目录可在手机上编辑：公开、未脱敏的 models 数组，元素带 string 型 id。 */
  catalogSupported: boolean;
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
      settingsNs: str(entry.settingsNs) ?? '',
      settingsPath: path,
      namespace: ns,
      catalogSupported: catalogSupported(ns, [...path, 'models']),
      error: str(entry.error),
      credentialRef,
      derivedRef: credentialRef !== undefined && namedRef === undefined,
    };
  });
}

/** schemastery 的 schema 用数字引用（refs），不是 JSON-schema 的 properties 树（对齐安卓 settingsSchemaNodeAt）。 */
export function schemaNodeAt(schema: JsonValue | undefined, path: string[]): JsonObject | undefined {
  if (!isObject(schema)) return undefined;
  const refs = isObject(schema.refs) ? schema.refs : undefined;
  const resolve = (value: JsonValue | undefined): JsonObject | undefined => {
    if (isObject(value)) return value;
    if (typeof value === 'number' && refs !== undefined) {
      const node = refs[String(value)];
      return isObject(node) ? node : undefined;
    }
    return undefined;
  };
  let node = resolve(schema.uid ?? schema);
  for (const segment of path) {
    if (node === undefined) return undefined;
    const type = str(node.type);
    node = resolve(type === 'object' ? jget(node.dict, segment) : type === 'dict' || type === 'array' ? node.inner : undefined);
  }
  return node;
}

function samePrefix(a: string[], b: string[]): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function catalogSupported(ns: JsonObject | undefined, modelsPath: string[]): boolean {
  if (ns === undefined) return false;
  // 含脱敏密钥的数组不能整份回写。
  const secrets = (arr(ns.secrets) ?? []).map(secret => (arr(jget(secret, 'path')) ?? []).map(item => String(item)));
  if (secrets.some(path => samePrefix(path, modelsPath))) return false;
  if (str(schemaNodeAt(ns.schema, modelsPath)?.type) !== 'array') return false;
  const fields = schemaNodeAt(ns.schema, [...modelsPath, '0'])?.dict;
  if (!isObject(fields) || !('id' in fields)) return false;
  return str(schemaNodeAt(ns.schema, [...modelsPath, '0', 'id'])?.type) === 'string';
}

/** 目录里的一个模型：raw 保留 compat/reasoning/input 等其它字段，只接管四个公开字段。 */
export interface CatalogModelDraft { raw: JsonObject; id: string; name: string; contextWindow: string; maxTokens: string }

const scalarText = (value: JsonValue | undefined): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

export function catalogModelDraft(raw: JsonObject): CatalogModelDraft {
  return { raw, id: scalarText(raw.id), name: scalarText(raw.name), contextWindow: scalarText(raw.contextWindow), maxTokens: scalarText(raw.maxTokens) };
}

function catalogModelValue(draft: CatalogModelDraft): JsonObject {
  const out: JsonObject = { ...draft.raw };
  const field = (key: 'id' | 'name' | 'contextWindow' | 'maxTokens', numeric: boolean): void => {
    const text = draft[key];
    // 没动过的字段（包括主机给的非常规值）原样保留。
    if (text === scalarText(draft.raw[key])) return;
    if (text.trim().length === 0) delete out[key];
    else out[key] = numeric ? Number(text.trim()) : text.trim();
  };
  field('id', false);
  field('name', false);
  field('contextWindow', true);
  field('maxTokens', true);
  return out;
}

/** 一家 provider 的模型目录草稿：expectedRevision 定格在打开那一刻，冲突不自动重试（对齐安卓 ProviderCatalogDraft）。 */
export interface ProviderCatalogDraft {
  row: ProviderSettingsRow;
  namespace: JsonObject;
  rows: CatalogModelDraft[];
  /** 用户层覆盖了这份目录（否则是继承的）。 */
  owned: boolean;
  touched: boolean;
}

export function openCatalogDraft(row: ProviderSettingsRow): ProviderCatalogDraft {
  const ns = row.namespace;
  if (!row.catalogSupported || ns === undefined) throw new Error('Unsupported model catalog');
  const path = [...row.settingsPath, 'models'];
  const models = valueAt(ns.value, path);
  const list = Array.isArray(models) ? models : [];
  if (!list.every(isObject)) throw new Error('Unsupported model catalog');
  return { row, namespace: ns, rows: (list as JsonObject[]).map(catalogModelDraft), owned: valueAt(ns.user, path) !== undefined, touched: false };
}

/** 恢复继承：换成 base 层（或 schema 默认值）的目录，保存时只 unset 用户覆盖。 */
export function resetCatalogDraft(draft: ProviderCatalogDraft): ProviderCatalogDraft {
  const path = [...draft.row.settingsPath, 'models'];
  const inherited = valueAt(draft.namespace.base, path) ?? jget(jget(schemaNodeAt(draft.namespace.schema, path), 'meta'), 'default');
  const list = Array.isArray(inherited) ? inherited.filter(isObject) : [];
  return { ...draft, rows: list.map(catalogModelDraft), owned: false, touched: true };
}

export function catalogDraftError(draft: ProviderCatalogDraft): string | undefined {
  if (!draft.touched || !draft.owned) return undefined;
  if (draft.rows.some(row => row.id.trim().length === 0)) return 'Model id is required';
  if (new Set(draft.rows.map(row => row.id.trim())).size !== draft.rows.length) return 'Duplicate model id';
  const positive = (text: string): boolean => text.trim().length === 0 || (/^[0-9]+$/.test(text.trim()) && Number(text.trim()) > 0);
  if (draft.rows.some(row => !positive(row.contextWindow) || !positive(row.maxTokens))) return 'Token limits must be positive integers';
  return undefined;
}

/** settings/mutate 的参数；没有实质变化返回 undefined。只写这一棵 models 子树，从不整份替换命名空间。 */
export function catalogMutation(draft: ProviderCatalogDraft): JsonObject | undefined {
  if (!draft.touched) return undefined;
  const error = catalogDraftError(draft);
  if (error !== undefined) throw new Error(error);
  const path = [...draft.row.settingsPath, 'models'];
  const original = valueAt(draft.namespace.user, path);
  let op: JsonObject;
  if (!draft.owned) {
    if (original === undefined) return undefined;
    op = { op: 'unset', path };
  } else {
    const models = draft.rows.map(catalogModelValue);
    if (JSON.stringify(models) === JSON.stringify(original)) return undefined;
    op = { op: 'set', path, value: models };
  }
  return { ns: draft.row.settingsNs, expectedRevision: draft.namespace.revision ?? 0, ops: [op] };
}

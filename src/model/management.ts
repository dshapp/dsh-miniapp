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

/** 编辑只改名称与内容；时间规则保留原精确目标（安卓的规则编辑本端未移植）。 */
export function automationEditError(title: string, prompt: string): 'title' | 'prompt' | undefined {
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return 'title';
  if (prompt.trim().length === 0) return 'prompt';
  return undefined;
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

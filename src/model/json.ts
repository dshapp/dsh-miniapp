/**
 * 宽松 JSON 取值器，对应 Android 的 net/Json.kt。
 *
 * 主机的 wire 约定是可扩展的：未知字段要忽略，字符串/数字要能互相读成文本，
 * null 与缺失一视同仁。所有解码都走这里，别在业务代码里裸读对象。
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type JsonElement = JsonValue;

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isArray(value: JsonValue | undefined): value is JsonValue[] {
  return Array.isArray(value);
}

/** obj[key]，null 视为缺失。 */
export function jget(value: JsonValue | undefined, key: string): JsonValue | undefined {
  if (!isObject(value)) return undefined;
  const found = value[key];
  return found === null ? undefined : found;
}

/** 只接受字符串。 */
export function str(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** 字符串或数字都读成文本。 */
export function text(value: JsonValue | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

export function int(value: JsonValue | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : undefined;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
  }
  return undefined;
}

export function dbl(value: JsonValue | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function bool(value: JsonValue | undefined): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function arr(value: JsonValue | undefined): JsonValue[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function obj(value: JsonValue | undefined): JsonObject | undefined {
  return isObject(value) ? value : undefined;
}

/** 标量的展示文本（对应 PhoneJSONTree.scalar）。 */
export function jsonScalarText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return '[]';
  if (typeof value === 'object') return '{}';
  return String(value);
}

export function parseJson(raw: string): JsonValue | undefined {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return undefined;
  }
}

/** 缩进后的 JSON 文本；不是合法 JSON 就原样返回。 */
export function prettyJson(raw: string): string {
  const parsed = parseJson(raw);
  if (parsed === undefined) return raw;
  try {
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

export function encodeJson(value: JsonValue): string {
  return JSON.stringify(value ?? null);
}

export function firstLine(text: string): string {
  const index = text.indexOf('\n');
  return index < 0 ? text : text.slice(0, index);
}

export function jsonPrimitiveText(value: JsonValue | undefined): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

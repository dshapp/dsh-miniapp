/**
 * 用户气泡正文的引用投影：把已发送正文切成普通文本与会话引用。
 *
 * host 落库前会把 `@[标题](dsh-session:…)` 重写成纯文本 `@标题`，会话 id 只剩
 * 紧随其后的 `session-reference` 上下文还带着，所以标题要点成跳转就得靠
 * store 里那份 标题 → 会话 id。
 */

export type UserRefToken =
  | { kind: 'text'; text: string }
  | { kind: 'session'; label: string; sessionId: string };

const WIRE_RE = /@\[((?:\\.|[^\\\]])+)\]\((dsh-session:[^)\s]+)\)/gu;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * `dsh-session:` 之后是「会话 id 的 JSON 字符串」的 base64url。
 *
 * 自己解 base64url，而不是借 atob / Buffer / wx.base64ToArrayBuffer：前两个在小程序
 * 里不存在，第三个是平台 API，而这里只需要认 ASCII 的会话 id，几行就够。
 */
function wireSessionId(uri: string): string | undefined {
  const payload = uri.slice('dsh-session:'.length);
  let bits = 0;
  let width = 0;
  let decoded = '';
  for (const char of payload) {
    const value = BASE64_ALPHABET.indexOf(char);
    if (value < 0) return undefined;
    bits = (bits << 6) | value;
    width += 6;
    if (width >= 8) {
      width -= 8;
      decoded += String.fromCharCode((bits >> width) & 0xff);
    }
  }
  try {
    const id: unknown = JSON.parse(decoded);
    return typeof id === 'string' && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 切分正文。优先级：wire 形式 > 已知标题最长匹配 > 普通文本。
 *
 * @param text 已发送正文。
 * @param sessions 标题 → 会话 id。
 */
export function projectUserRefs(text: string, sessions: Record<string, string>): UserRefToken[] {
  const titles = Object.keys(sessions);
  if (titles.length === 0 && !text.includes('@[')) return [{ kind: 'text', text }];
  type Range = { start: number; end: number; label: string; sessionId: string };
  const ranges: Range[] = [];
  WIRE_RE.lastIndex = 0;
  let wire: RegExpExecArray | null;
  while ((wire = WIRE_RE.exec(text)) !== null) {
    const sessionId = wireSessionId(wire[2]);
    if (sessionId === undefined) continue;
    ranges.push({
      start: wire.index,
      end: wire.index + wire[0].length,
      label: wire[1].replace(/\\(.)/gu, '$1'),
      sessionId,
    });
  }
  // 长的先排：一个标题可能是另一个的前缀，发送者选中的是更长的那个。
  for (const title of [...titles].sort((a, b) => b.length - a.length)) {
    const needle = '@' + title;
    let start = text.indexOf(needle);
    while (start >= 0) {
      const before = start === 0 || /\s/u.test(text[start - 1]);
      const after = start + needle.length === text.length || /\s/u.test(text[start + needle.length]);
      if (before && after) {
        ranges.push({ start, end: start + needle.length, label: title, sessionId: sessions[title] });
      }
      start = text.indexOf(needle, start + needle.length);
    }
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);

  const tokens: UserRefToken[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) tokens.push({ kind: 'text', text: text.slice(cursor, range.start) });
    tokens.push({ kind: 'session', label: range.label, sessionId: range.sessionId });
    cursor = range.end;
  }
  if (cursor < text.length || tokens.length === 0) tokens.push({ kind: 'text', text: text.slice(cursor) });
  return tokens;
}

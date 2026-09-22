/**
 * 输入区的纯逻辑层：触发 token、附件校验、草稿读写、展示辅助。
 *
 * 刻意不依赖 React、也不依赖 appModel：这些规则在 Android 上散落在 PhoneModel 与
 * ComposerBar 两处，但全都是纯粹的字符串/数组运算，抽出来才能单独复用（列表行、
 * 输入区组件、将来的测试）而不必把整份手机端状态拖进来。
 */
import { fmt, Strings } from '../i18n/strings';
import { formatBytes } from '../model/format';
import { readStorage, writeStorage } from './store';

// —— 触发 token ————————————————————————————————————————————————

export type TriggerKind = 'reference' | 'command' | 'skill';

/** 输入区里一个触发 token；start/end 都是下标，end 为开区间。 */
export interface TriggerToken { kind: TriggerKind; query: string; start: number; end: number }

/**
 * 光标所在的触发 token，没有就返回 undefined。
 *
 * 与 Android TriggerToken.parse 是同一套识别规则，区别在于它写死了"token 在草稿末尾"
 * （整个草稿只解析最后一个词），这里要跟着光标走：先向左退到最近一个空白（Android 的
 * lastBreak 口径，只认空格与换行），再看词首是不是触发符。`/` 命令只在整段最开头成立
 * （对齐 Android 的 `start == 0`）。
 * `query` 取触发符之后、光标之前的一段——补全列表按它过滤，所以 `end` 是光标而不是词尾：
 * 调用方替换 token 时用 [start, end) 覆盖掉已经敲进去的部分即可。
 */
export function activeTrigger(text: string, cursor: number): TriggerToken | undefined {
  // 光标越界时先夹回正文范围：输入法偶尔会给到 -1 或 length+1。
  const at = Math.max(0, Math.min(cursor, text.length));
  if (at === 0) return undefined;
  let start = at;
  while (start > 0 && text[start - 1] !== ' ' && text[start - 1] !== '\n') start -= 1;
  const head = text[start];
  if (head === '@') return { kind: 'reference', query: text.slice(start + 1, at), start, end: at };
  if (head === '$') return { kind: 'skill', query: text.slice(start + 1, at), start, end: at };
  if (head === '/' && start === 0) return { kind: 'command', query: text.slice(start + 1, at), start, end: at };
  return undefined;
}

/**
 * 正文里所有已完成的触发 token 区间，用来把整段画成胶囊。
 *
 * 照搬 Android composerTokens：`@引用` / `$技能` 只认空白边界，`/命令` 只认整段开头；
 * 词长必须大于 1（光一个触发符不画胶囊）。这里的 end 是词尾（开区间）而不是光标——
 * 画底纹要覆盖整个 token；`$技能` 是 Android TriggerToken 之外新增的一类。
 */
export function triggerRanges(text: string): { start: number; end: number; kind: TriggerKind }[] {
  const out: { start: number; end: number; kind: TriggerKind }[] = [];
  let i = 0;
  while (i < text.length) {
    const head = text[i];
    const atBoundary = i === 0 || text[i - 1] === ' ' || text[i - 1] === '\n';
    const kind: TriggerKind | undefined =
      head === '@' ? 'reference' : head === '$' ? 'skill' : head === '/' && i === 0 ? 'command' : undefined;
    if (atBoundary && kind !== undefined) {
      let end = i + 1;
      while (end < text.length && text[end] !== ' ' && text[end] !== '\n') end += 1;
      if (end > i + 1) out.push({ start: i, end, kind });
      i = end;
    } else {
      i += 1;
    }
  }
  return out;
}

/**
 * 退格删到 token 内部时整段删掉，返回新的 { text, cursor }；其余编辑原样返回。
 *
 * Android atomicTokenEdit 的纯函数版：调用方给出编辑前后的两段文本与新光标。
 * 只有"恰好少一个字符、且少掉的正是某个 token 里的字符"才改写（退格删进胶囊中间）；
 * 多选删除、输入法组字、粘贴等其余编辑一律放行，避免误吞用户的正常输入。
 * cut 用的是新光标：单字符退格时，它正好是被删掉那个字符的下标（Android 同此）。
 */
export function atomicTokenEdit(text: string, cursor: number, previousText: string): { text: string; cursor: number } {
  if (text.length !== previousText.length - 1) return { text, cursor };
  const cut = cursor;
  if (cut < 0 || cut >= previousText.length) return { text, cursor };
  if (previousText.slice(0, cut) + previousText.slice(cut + 1) !== text) return { text, cursor };
  const token = triggerRanges(previousText).find(range => cut >= range.start && cut < range.end);
  if (token === undefined) return { text, cursor };
  return {
    text: previousText.slice(0, token.start) + previousText.slice(token.end),
    cursor: token.start,
  };
}

// —— 附件 ————————————————————————————————————————————————————————

export type AttachmentPayload =
  | { kind: 'image'; mediaType: string; base64: string; preview: string }
  | { kind: 'file'; filePath: string; name: string; size: number };

export interface PhoneAttachment { id: string; name: string; payload: AttachmentPayload }

/** 主机公布的图片上限；字段与 model/types 的 ImageAttachmentLimits 对齐（后者另有 maxImagePixels）。 */
export interface ImageLimits {
  maxImagesPerMessage: number;
  maxImageBytes: number;
  maxMessageImageBytes: number;
  mediaTypes: string[];
}

/**
 * base64 长度换算成字节数（Android 是 length / 4 * 3）。
 *
 * 先整除 4 再乘 3、不做补位修正，是为了和 Android 逐字节一致：这里只用来跟主机公布的
 * 上限比大小，同一张图在两端必须判出同一个结论。
 */
export function imageBytes(base64: string): number {
  return Math.floor(base64.length / 4) * 3;
}

/**
 * 附件是否越过主机公布的上限；返回可直接展示的拒绝文案，未越界返回 undefined。
 *
 * 判定顺序与 Android attachmentRejection 完全一致：张数 → 单张大小 → 总量 → 类型，
 * 先撞上的那条就是提示。limits 缺失（会话还没拿到配置）时不拦，交给主机兜底；
 * 非图片附件不参与任何一种判定。
 */
export function attachmentRejection(attachments: PhoneAttachment[], limits: ImageLimits | undefined): string | undefined {
  if (limits === undefined) return undefined;
  const images: { mediaType: string; bytes: number }[] = [];
  for (const attachment of attachments) {
    const payload = attachment.payload;
    if (payload.kind === 'image') images.push({ mediaType: payload.mediaType, bytes: imageBytes(payload.base64) });
  }
  if (images.length > limits.maxImagesPerMessage) {
    return fmt(Strings.tooManyImages, limits.maxImagesPerMessage);
  }
  const oversized = images.find(image => image.bytes > limits.maxImageBytes);
  if (oversized !== undefined) return fmt(Strings.imageTooLarge, formatBytes(oversized.bytes));
  const total = images.reduce((sum, image) => sum + image.bytes, 0);
  if (total > limits.maxMessageImageBytes) {
    return fmt(Strings.imagesTooLarge, formatBytes(limits.maxMessageImageBytes));
  }
  const unsupported = images.find(image => !limits.mediaTypes.includes(image.mediaType));
  if (unsupported !== undefined) return fmt(Strings.imageTypeUnsupported, unsupported.mediaType);
  return undefined;
}

// —— 草稿 ————————————————————————————————————————————————————————

/** 草稿存储键前缀。Android 是 phone.draft.<id>，小程序端统一收进 dsh. 命名空间。 */
const DRAFT_PREFIX = 'dsh.draft.';

export function draftKey(sessionId: string): string {
  return `${DRAFT_PREFIX}${sessionId}`;
}

/** 读回上次没发出去的草稿；没存过或已清空都得到空串。 */
export function readDraft(sessionId: string): string {
  return readStorage(draftKey(sessionId)) ?? '';
}

/**
 * 写下草稿。清空时写空串而不是删键：readStorage 把空值当成"没存过"，
 * 效果与 Android 的 remove 相同，因此不必为这一处再引一个 removeStorage。
 */
export function writeDraft(sessionId: string, text: string): void {
  writeStorage(draftKey(sessionId), text);
}

// —— 展示辅助 ————————————————————————————————————————————————

/**
 * 权限值 -> 文案；value 不在表里时用 fallback（通常是主机给的选项名）。
 *
 * 键名与 Android 的 accessRead/accessWrite/accessFull 一一对应，只是本项目的 Strings
 * 表把它们命名为 accessReadOnly/accessWorkspaceWrite/accessFullName——复用现有条目，
 * 不再另加一组同义 key，免得两处文案各自漂移。
 */
export function permissionTitle(value: string, fallback: string): string {
  switch (value) {
    case 'read-only': return Strings.accessReadOnly;
    case 'workspace-write': return Strings.accessWorkspaceWrite;
    case 'danger-full-access': return Strings.accessFullName;
    default: return fallback;
  }
}

/**
 * 命令名：去掉前导 `/` 与空白之后的参数。名字后必须是行尾或空白，
 * 所以 `/plan off` 得到 `plan`，而 `/`、`/ plan` 都不是命令。
 */
export function commandName(text: string): string | undefined {
  const match = /^\/(\S+)(?=\s|$)/.exec(text);
  return match === null ? undefined : match[1];
}

/** 行首是不是一条 /命令（名字后必须是行尾或空白）。 */
export function isCommandLine(text: string): boolean {
  return commandName(text) !== undefined;
}

/**
 * 转写里一个文件链接的落点：主机 workspaceFiles/read 要读的路径，加上它该用哪条会话做作用域。
 *
 * sessionId 为空表示「用当前会话」——普通相对路径、绝对路径、file:// 都是这种。
 * 只有 Web 的 dsh-resource://file/session/<id>/… 地址自带会话，跨会话引用时才非空。
 * 与 Android model/FileLink.kt 逐条对齐（含 Web 的 file-address 用例）。
 */
export interface FileLinkTarget {
  path: string;
  sessionId?: string;
  /**
   * 作者用图片语法 `![alt](…)` 写的落点：打开时按图片走 previewImage，不看扩展名
   *（对齐 Android FileLinkTarget.image）。无扩展名的附件对象
   * `~/.dsh/attachments/v1/objects/<sha256>` 靠它才不会掉进文本预览。
   */
  image?: boolean;
}

const RESOURCE_PREFIX = 'dsh-resource://file/';
const FILE_SCHEME = 'file:';

/** 形如 scheme: 的前缀；http/https/mailto/… 都不是文件。 */
const SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** Windows 盘符（C:\dir、C:/dir）形状上也是 scheme，单独放行。 */
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;

/** 单独一个盘符段（C:），Web isDriveSegment 同形：只看首段是不是「字母 + 冒号」。 */
const DRIVE_SEGMENT = /^[A-Za-z]:$/;

/** Web parseFileLink 认的行号片段：#L24 或 #L24-L30（L 大写，两端都是正整数）。 */
const LINE_FRAGMENT = /^L([1-9][0-9]*)(?:-L([1-9][0-9]*))?$/;

/** 片段是不是一行合法的行号锚点（区间不能倒着写，与 Web 的 end < line 判定一致）。 */
function isLineFragment(fragment: string): boolean {
  const match = LINE_FRAGMENT.exec(fragment);
  if (!match) return false;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start;
  return end >= start;
}

/**
 * 去掉行号锚点与查询串，留下真正要读的地址。
 *
 * 系统提示要求模型把文件提及写成 `路径#L24` / `路径#L24-L30`（host 的
 * FILE_REFERENCE_PROMPT），Web 的 parseFileLink 也是先切 `#` 再解析。不切就会拿着
 * `Foo.kt#L24` 去 workspaceFiles/read，主机只会回 workspace-file/not-found。
 * `#` 之后不是行号锚点说明它不是文件链接（返回 undefined 让调用方退回普通链接）；
 * 含 `?` 的是查询串，同样不当路径。文件名里的 #/? 已经是 %23/%3F，不会被误切。
 */
function fileAddress(trimmed: string): string | undefined {
  const hash = trimmed.indexOf('#');
  const address = hash < 0 ? trimmed : trimmed.slice(0, hash);
  if (hash >= 0 && !isLineFragment(trimmed.slice(hash + 1))) return undefined;
  if (address.includes('?')) return undefined;
  return address;
}

/** 百分号解码；先把手写的 + 挡掉（地址里的 + 就是文件名里的加号）。 */
export function decodeFileLinkPath(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, '%2B'));
  } catch {
    return value;
  }
}

/**
 * 解析一个 Markdown 链接目的地。
 *
 * 空串、页内锚点、以及 http/https/mailto 等外部地址都返回 undefined。
 */
export function parseFileLink(destination: string): FileLinkTarget | undefined {
  const trimmed = destination.trim();
  if (trimmed.length === 0) return undefined;
  const raw = fileAddress(trimmed);
  if (raw === undefined || raw.length === 0) return undefined;

  if (raw.toLowerCase().startsWith(RESOURCE_PREFIX)) {
    return parseResource(raw.slice(RESOURCE_PREFIX.length));
  }

  if (raw.toLowerCase().startsWith(FILE_SCHEME)) {
    const decoded = decodeFileLinkPath(fileUrlPath(raw.slice(FILE_SCHEME.length)));
    return decoded.length > 0 ? { path: decoded } : undefined;
  }

  if (SCHEME_PREFIX.test(raw)) {
    // 其他 scheme 一律交给系统；只有盘符那种「看着像 scheme」的本地绝对路径继续往下走。
    if (!WINDOWS_DRIVE.test(raw)) return undefined;
    return { path: raw.replace(/\\/g, '/') };
  }

  const decoded = decodeFileLinkPath(raw);
  return decoded.trim().length > 0 ? { path: decoded } : undefined;
}

/**
 * 行内代码里「看着就是文件」的 token。
 *
 * 只认明确无歧义的情况：显式文件地址、绝对路径（但不是协议相对的 //…）、
 * 以及既有目录段又有像样扩展名的相对路径。含空白的 token 直接拒掉。
 */
export function parseInlineCodeFileLink(value: string): FileLinkTarget | undefined {
  const token = value.trim();
  if (token.length === 0 || /\s/.test(token)) return undefined;
  // 行号锚点（…Foo.kt#L24）不算路径，判形状前先切掉。
  const address = fileAddress(token);
  if (address === undefined || address.length === 0) return undefined;
  const lower = address.toLowerCase();
  if (lower.startsWith(RESOURCE_PREFIX) || lower.startsWith(FILE_SCHEME)) return parseFileLink(token);
  if (address.startsWith('//')) return undefined;
  if (address.startsWith('/')) return parseFileLink(token);
  if (!address.includes('/')) return undefined;
  const name = address.slice(address.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return undefined;
  const extension = name.slice(dot + 1);
  if (extension.length > 8 || !/^[A-Za-z0-9]+$/.test(extension)) return undefined;
  return parseFileLink(token);
}

/** dsh-resource://file/ 之后的部分：session/<id>/<path> 或 absolute/<path>。 */
function parseResource(rest: string): FileLinkTarget | undefined {
  const scopeEnd = rest.indexOf('/');
  if (scopeEnd < 0) return undefined;
  const scope = rest.slice(0, scopeEnd);
  const tail = rest.slice(scopeEnd + 1);
  if (scope === 'session') {
    const idEnd = tail.indexOf('/');
    if (idEnd < 0) return undefined;
    const sessionId = decodeFileLinkPath(tail.slice(0, idEnd));
    const path = decodeFileLinkPath(tail.slice(idEnd + 1));
    // 空会话段是坏地址：没有会话就没有工作区根。
    if (sessionId.length === 0 || path.length === 0) return undefined;
    return { path, sessionId };
  }
  if (scope === 'absolute') {
    // absolute 作用域把自己的分隔斜杠当作根：地址里省略了路径开头的 "/"。
    // 与 Web parseFileAddress 的 absolute 分支同构：先分段再逐段解码，双斜杠开头是
    // UNC（拼回 "//host/share/…"），首段是 Windows 盘符时不再补前导 "/"——
    // "/C:/work/x.ts" 交给主机只会 workspace-file/not-found。
    const segments = tail.split('/');
    const unc = segments[0] === '' && segments.length > 1;
    const parts = (unc ? segments.slice(1) : segments).map(decodeFileLinkPath);
    const first = parts[0];
    if (first === undefined || first.length === 0) return undefined;
    if (unc) return { path: '//' + parts.join('/') };
    if (DRIVE_SEGMENT.test(first)) return { path: parts.join('/') };
    return { path: '/' + parts.join('/') };
  }
  return undefined;
}

/** file: 之后的部分：///abs/path、//host/abs/path、/abs/path 都归一到路径。 */
function fileUrlPath(rest: string): string {
  let path = rest;
  if (path.startsWith('//')) {
    path = path.slice(2);
    const slash = path.indexOf('/');
    path = slash < 0 ? '' : path.slice(slash);
  }
  return path;
}

/** 展示用的文件名。 */
export function fileLinkBasename(path: string): string {
  const clean = path.replace(/\\/g, '/');
  const trimmed = clean.endsWith('/') ? clean.slice(0, -1) : clean;
  const index = trimmed.lastIndexOf('/');
  return index < 0 ? trimmed : trimmed.slice(index + 1);
}

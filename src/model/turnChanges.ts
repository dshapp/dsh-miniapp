import { arr, bool, int, jget, str, type JsonValue } from './json';

/**
 * 一轮里被改动的一个文件（主机 WorkspaceChangedFile）。
 *
 * display 是主机的排序键与展示文案——相对工作目录的路径、往上的 ../ 路径、
 * home 下的 ~ 路径或绝对路径——卡片显示它；path 是 diff 路由寻址用的身份。
 * 与 Android model/TurnChanges.kt 同字段。
 */
export interface ChangedFileEntry {
  path: string;
  display: string;
  added: number;
  deleted: number;
  binary: boolean;
  oversized: boolean;
}

/**
 * 一条已公告的改动记录的坐标：会话 + 公告它那条 workspace/changes 事件的 seq。
 *
 * 按 seq 而不是按轮次寻址：同一轮后来的公告会取代先前的记录，被取代的那条不再可寻址，
 * 与主机替换自己的记录一致。
 */
export interface TurnChangesAddress { sessionId: string; seq: number }

/** 一轮改动文件的汇总（主机 WorkspaceChangesSummary）。 */
export interface TurnChangesSummary {
  turn: number;
  /** 这一轮的会话工作目录：files 里相对的 path 都相对它（主机 WorkspaceChangesSummary.cwd）。 */
  cwd?: string;
  files: ChangedFileEntry[];
  /** 完整的改动文件数，可能大于 files（主机有上限）。 */
  total: number;
  added: number;
  deleted: number;
}

/** 解一条 /api/changes.summary 的响应体，缺字段的记录直接丢掉。 */
export function decodeTurnChangesSummary(value: JsonValue | undefined): TurnChangesSummary | undefined {
  const turn = int(jget(value, 'turn'));
  if (turn === undefined || turn < 1) return undefined;
  const total = int(jget(value, 'total'));
  const added = int(jget(value, 'added'));
  const deleted = int(jget(value, 'deleted'));
  const entries = arr(jget(value, 'files'));
  if (total === undefined || added === undefined || deleted === undefined || entries === undefined) return undefined;
  const files: ChangedFileEntry[] = [];
  for (const entry of entries) {
    const path = str(jget(entry, 'path'));
    const display = str(jget(entry, 'display'));
    const fileAdded = int(jget(entry, 'added'));
    const fileDeleted = int(jget(entry, 'deleted'));
    if (path === undefined || path.length === 0) continue;
    if (display === undefined || display.length === 0) continue;
    if (fileAdded === undefined || fileDeleted === undefined) continue;
    files.push({
      path,
      display,
      added: fileAdded,
      deleted: fileDeleted,
      binary: bool(jget(entry, 'binary')) === true,
      oversized: bool(jget(entry, 'oversized')) === true,
    });
  }
  return { turn, cwd: str(jget(value, 'cwd')), files, total, added, deleted };
}

/**
 * 改动文件在主机上可读的路径：主机给的 path 在工作目录内是相对路径（相对的是**这一轮**的
 * cwd，会话之后换了工作目录也不变），在外面是绝对路径。相对的拼上 summary.cwd，再交给
 * workspaceFiles 读；没有 cwd（老主机）就原样交出，由主机按会话作用域解析——与正文文件链接同一条通路。
 */
export function changedFileHostPath(summary: TurnChangesSummary, file: ChangedFileEntry): string {
  const { path } = file;
  const { cwd } = summary;
  if (cwd === undefined || cwd.length === 0) return path;
  if (path.startsWith('/') || path.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(path)) return path;
  return cwd.replace(/[\\/]+$/, '') + '/' + path;
}

/** 比较结果里的一段统一 diff；每行保留 +、- 或空格前缀。 */
export interface ChangedFileHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/**
 * 一个列出的文件在轮首与轮末的比较（主机 WorkspaceFileDiff）。
 *
 * 二进制或超限的一侧没有行可给，所以 kind 是值的一部分，而不是「空 hunk 列表」。
 */
export type ChangedFileDiff =
  | { kind: 'text'; path: string; display: string; hunks: ChangedFileHunk[]; coarse: boolean }
  | { kind: 'binary'; path: string; display: string }
  | { kind: 'oversized'; path: string; display: string };

export function decodeChangedFileDiff(value: JsonValue | undefined): ChangedFileDiff | undefined {
  const kind = str(jget(value, 'kind'));
  const path = str(jget(value, 'path'));
  const display = str(jget(value, 'display'));
  if (kind === undefined || path === undefined || display === undefined) return undefined;
  if (kind === 'binary') return { kind: 'binary', path, display };
  if (kind === 'oversized') return { kind: 'oversized', path, display };
  if (kind !== 'text') return undefined;
  const hunks: ChangedFileHunk[] = [];
  for (const hunk of arr(jget(value, 'hunks')) ?? []) {
    const oldStart = int(jget(hunk, 'oldStart'));
    const oldLines = int(jget(hunk, 'oldLines'));
    const newStart = int(jget(hunk, 'newStart'));
    const newLines = int(jget(hunk, 'newLines'));
    const lines = arr(jget(hunk, 'lines'));
    if (oldStart === undefined || oldLines === undefined) continue;
    if (newStart === undefined || newLines === undefined || lines === undefined) continue;
    hunks.push({
      oldStart,
      oldLines,
      newStart,
      newLines,
      lines: lines.map(str).filter((line): line is string => line !== undefined),
    });
  }
  return { kind: 'text', path, display, hunks, coarse: bool(jget(value, 'coarse')) === true };
}

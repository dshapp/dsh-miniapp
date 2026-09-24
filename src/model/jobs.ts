/**
 * 后台任务的纯逻辑（对齐 web 0.1.7 的 JobListAction / job 输出面板，Mac 267bcde 同一口径）：
 * 列表分段排序、结束原因拆出退出码与信号、`job/follow` 帧解码与输出折叠。
 */
import { arr, bool, jget, str, type JsonElement } from './json';
import { decodeJobView } from './frames';
import { jobIsLive, type JobView } from './types';

/** 进行中的任务按开始时间升序。 */
export function liveJobs(jobs: JobView[]): JobView[] {
  return jobs.filter(jobIsLive).sort((a, b) => a.startedAt - b.startedAt);
}

/** 已结束且没被用户清掉的任务：最近结束的在前，同一毫秒结束的按开始时间。 */
export function settledJobs(jobs: JobView[], cleared: ReadonlySet<string>): JobView[] {
  return jobs
    .filter(job => !jobIsLive(job) && !cleared.has(job.id))
    .sort((a, b) => {
      const finished = (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt);
      return finished !== 0 ? finished : a.startedAt - b.startedAt;
    });
}

export interface JobTermination {
  exitCode?: number;
  signal?: string;
  remainder?: string;
}

/**
 * 把主机给的结束原因（`exit code: 3`、`signal: SIGTERM; cancelled by the user`）
 * 拆成退出码、信号与剩下的自由文本。
 */
export function parseJobTermination(detail: string | undefined): JobTermination {
  const out: JobTermination = {};
  const rest: string[] = [];
  for (const part of (detail ?? '').split(';')) {
    const piece = part.trim();
    if (piece.startsWith('exit code:') && out.exitCode === undefined) {
      const raw = piece.slice('exit code:'.length).trim();
      const code = /^-?\d+$/.test(raw) ? Number(raw) : undefined;
      if (code !== undefined) {
        out.exitCode = code;
        continue;
      }
    } else if (piece.startsWith('signal:') && out.signal === undefined) {
      const value = piece.slice('signal:'.length).trim();
      if (value.length > 0 && value !== 'null') out.signal = value;
      continue;
    }
    if (piece.length > 0) rest.push(piece);
  }
  if (rest.length > 0) out.remainder = rest.join('; ');
  return out;
}

/** `job/follow` 一帧：`opened` 锚点、合并后的 `output` 批次、任务结束且输出排空后的一次 `status`。 */
export type JobFollowFrame =
  | { type: 'opened'; job: JobView; from: number }
  | { type: 'output'; text: string; gap: boolean }
  | { type: 'status'; job: JobView }
  | { type: 'unknown' };

export function decodeJobFollowFrame(value: JsonElement | undefined): JobFollowFrame {
  switch (str(jget(value, 'type'))) {
    case 'opened': {
      const job = decodeJobView(jget(value, 'job'));
      const from = jget(value, 'from');
      if (job === undefined || typeof from !== 'number') return { type: 'unknown' };
      return { type: 'opened', job, from };
    }
    case 'output': {
      const chunks = arr(jget(value, 'chunks')) ?? [];
      const text = chunks.map(chunk => str(jget(chunk, 'text')) ?? '').join('');
      const gap = bool(jget(value, 'lossy')) === true || chunks.some(chunk => bool(jget(chunk, 'gapBefore')) === true);
      return { type: 'output', text, gap };
    }
    case 'status': {
      const job = decodeJobView(jget(value, 'job'));
      return job === undefined ? { type: 'unknown' } : { type: 'status', job };
    }
    default:
      return { type: 'unknown' };
  }
}

/** 一个任务正在被观察的输出（web `ObservedJob`）。 */
export interface ObservedJobOutput {
  sessionId: string;
  jobId: string;
  text: string;
  /** 更早的字节已被丢弃（环形缓冲淘汰，或本端只留尾部）。 */
  gapBefore: boolean;
  streaming: boolean;
  error?: string;
}

/** web `RENDER_TAIL_LIMIT`：只留最新的 128K 字符。 */
export const JOB_OUTPUT_TAIL_LIMIT = 128 * 1024;

export function newObservedJob(sessionId: string, jobId: string): ObservedJobOutput {
  return { sessionId, jobId, text: '', gapBefore: false, streaming: true };
}

/** 折叠一帧；重连后重开会从最早保留的字节重放，所以锚点帧让文本从头来。 */
export function reduceObservedJob(observed: ObservedJobOutput, frame: JobFollowFrame): ObservedJobOutput {
  switch (frame.type) {
    case 'opened':
      return {
        ...observed,
        text: '',
        gapBefore: frame.from > 0 || frame.from < (frame.job.output?.earliest ?? 0),
        streaming: true,
        error: undefined,
      };
    case 'output': {
      let text = observed.text + frame.text;
      let gapBefore = observed.gapBefore || frame.gap;
      if (text.length > JOB_OUTPUT_TAIL_LIMIT) {
        text = text.slice(text.length - JOB_OUTPUT_TAIL_LIMIT);
        gapBefore = true;
      }
      return { ...observed, text, gapBefore };
    }
    case 'status':
      return { ...observed, streaming: false };
    default:
      return observed;
  }
}

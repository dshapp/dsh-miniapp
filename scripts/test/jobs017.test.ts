/**
 * 0.1.7 后台任务与历史窗口（对照 Mac 267bcde / web 0.1.7）：
 * turnWindow 参数、JobView.output、job/follow 帧与输出折叠、分段排序、退出码/信号拆分。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeJobView } from '../../src/model/frames';
import { jobIsObservable } from '../../src/model/types';
import {
  JOB_OUTPUT_TAIL_LIMIT,
  decodeJobFollowFrame,
  liveJobs,
  newObservedJob,
  parseJobTermination,
  reduceObservedJob,
  settledJobs,
} from '../../src/model/jobs';
import { historyWindowArgs } from '../../src/transport/rpcMethods';

test('历史窗口：maxMessages 封顶 500，turnWindow 带最少条数与两个轮次', () => {
  assert.deepEqual(historyWindowArgs(50), { maxMessages: 500, turnWindow: { minMessages: 50, minTurns: 2 } });
  assert.deepEqual(historyWindowArgs(900), { maxMessages: 500, turnWindow: { minMessages: 500, minTurns: 2 } });
  assert.deepEqual(historyWindowArgs(0), { maxMessages: 500, turnWindow: { minMessages: 1, minTurns: 2 } });
});

const job = (extra: Record<string, unknown>) =>
  decodeJobView({ id: 'j', kind: 'bash', label: 'npm test', status: 'running', startedAt: 10, ...extra })!;

test('JobView.output 解码；结束但留有输出的任务仍可观察', () => {
  assert.deepEqual(job({ output: { total: 12, earliest: 2 } }).output, { total: 12, earliest: 2 });
  assert.equal(job({}).output, undefined);
  assert.equal(jobIsObservable(job({ status: 'completed', output: { total: 3, earliest: 0 } })), true);
  assert.equal(jobIsObservable(job({ status: 'completed', output: { total: 0, earliest: 0 } })), false);
  assert.equal(jobIsObservable(job({ status: 'stopping' })), true);
});

test('job/follow：opened 重置文本，output 追加并记 gap，status 结束流', () => {
  let observed = newObservedJob('s1', 'j');
  observed = reduceObservedJob(observed, decodeJobFollowFrame({
    type: 'opened', job: { id: 'j', kind: 'bash', label: 'x', status: 'running', startedAt: 1, output: { total: 5, earliest: 0 } }, from: 0,
  }));
  assert.equal(observed.gapBefore, false);
  observed = reduceObservedJob(observed, decodeJobFollowFrame({ type: 'output', chunks: [{ text: 'ab' }, { text: 'c' }] }));
  assert.equal(observed.text, 'abc');
  observed = reduceObservedJob(observed, decodeJobFollowFrame({ type: 'output', chunks: [{ text: 'd', gapBefore: true }] }));
  assert.equal(observed.text, 'abcd');
  assert.equal(observed.gapBefore, true);
  observed = reduceObservedJob(observed, decodeJobFollowFrame({
    type: 'status', job: { id: 'j', kind: 'bash', label: 'x', status: 'completed', startedAt: 1 },
  }));
  assert.equal(observed.streaming, false);
  // 重连重开：锚点让文本从头来。
  observed = reduceObservedJob(observed, decodeJobFollowFrame({
    type: 'opened', job: { id: 'j', kind: 'bash', label: 'x', status: 'running', startedAt: 1, output: { total: 9, earliest: 4 } }, from: 4,
  }));
  assert.equal(observed.text, '');
  assert.equal(observed.gapBefore, true);
  assert.equal(observed.streaming, true);
});

test('job/follow：lossy 批次算 gap；超过 128K 只留尾部', () => {
  let observed = newObservedJob('s1', 'j');
  observed = reduceObservedJob(observed, decodeJobFollowFrame({ type: 'output', chunks: [{ text: 'x' }], lossy: true }));
  assert.equal(observed.gapBefore, true);
  observed = newObservedJob('s1', 'j');
  observed = reduceObservedJob(observed, decodeJobFollowFrame({
    type: 'output', chunks: [{ text: 'a'.repeat(JOB_OUTPUT_TAIL_LIMIT) + 'tail' }],
  }));
  assert.equal(observed.text.length, JOB_OUTPUT_TAIL_LIMIT);
  assert.equal(observed.text.endsWith('tail'), true);
  assert.equal(observed.gapBefore, true);
  assert.equal(decodeJobFollowFrame({ type: 'weird' }).type, 'unknown');
});

test('分段：进行中按开始升序；已结束按结束降序并排除已清空', () => {
  const jobs = [
    job({ id: 'a', status: 'running', startedAt: 30 }),
    job({ id: 'b', status: 'stopping', startedAt: 20 }),
    job({ id: 'c', status: 'completed', startedAt: 1, finishedAt: 5 }),
    job({ id: 'd', status: 'failed', startedAt: 2, finishedAt: 9 }),
    job({ id: 'e', status: 'killed', startedAt: 3, finishedAt: 7 }),
  ];
  assert.deepEqual(liveJobs(jobs).map(item => item.id), ['b', 'a']);
  assert.deepEqual(settledJobs(jobs, new Set()).map(item => item.id), ['d', 'e', 'c']);
  assert.deepEqual(settledJobs(jobs, new Set(['d'])).map(item => item.id), ['e', 'c']);
});

test('结束原因拆出退出码、信号与剩余文本', () => {
  assert.deepEqual(parseJobTermination('exit code: 3'), { exitCode: 3 });
  assert.deepEqual(parseJobTermination('signal: SIGTERM; cancelled by the user'), { signal: 'SIGTERM', remainder: 'cancelled by the user' });
  assert.deepEqual(parseJobTermination('exit code: 0; signal: null'), { exitCode: 0 });
  assert.deepEqual(parseJobTermination('exit code: abc'), { remainder: 'exit code: abc' });
  assert.deepEqual(parseJobTermination(undefined), {});
});

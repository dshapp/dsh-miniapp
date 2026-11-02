/**
 * `orderBy: "status"` 的档位顺序：逐条对照安卓 StatusOrderRankTest。
 *
 * 这条排序回答的是"谁最需要我"：跑着的 > 未读失败 > 未读完成 > 等我批准 > 等我回答 >
 * 我有草稿 > 其余。直接对着 statusOrder 的实际输出钉，接线错了同样算错。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionListStore } from '../../src/state/stores';
import type { SessionSummary } from '../../src/model/types';

const summary = (id: string, updatedAt: number, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  sessionId: id, updatedAt, running: false, blank: false, ...extra,
});

/** 每条用例都从干净的名册开始（这个 store 是进程级单例）。 */
function reset(items: SessionSummary[]): void {
  for (const existing of sessionListStore.sessions.slice()) sessionListStore.remove(existing.sessionId);
  sessionListStore.clearAllAwaitingUser();
  for (const item of items) sessionListStore.upsert(item);
}

/** 走真实路径造出"未读完成"：先推成运行，再落回停止。 */
function markUnreadCompleted(id: string): void {
  sessionListStore.setRunning(id, true);
  sessionListStore.setRunning(id, false);
}

const order = (errored: string[] = []): string[] =>
  sessionListStore
    .statusOrder(sessionListStore.sessions.filter(item => item.origin !== 'subagent'), new Set(errored))
    .map(item => item.sessionId);

test('批准排在提问之前', () => {
  reset([summary('approval', 1), summary('question', 99)]);
  sessionListStore.markAwaitingUser('approval', 'approval');
  sessionListStore.markAwaitingUser('question', 'question');
  assert.deepEqual(order(), ['approval', 'question']);
});

test('草稿排在等人回答之下', () => {
  reset([summary('draft', 99), summary('question', 1)]);
  sessionListStore.markAwaitingUser('question', 'question');
  sessionListStore.setDraft('draft', true);
  assert.deepEqual(order(), ['question', 'draft']);
  sessionListStore.setDraft('draft', false);
});

test('计划评审与提问同档，仍在批准之后', () => {
  reset([summary('approval', 1), summary('plan-review', 99)]);
  sessionListStore.markAwaitingUser('approval', 'approval');
  sessionListStore.markAwaitingUser('plan-review', 'planReview');
  assert.deepEqual(order(), ['approval', 'plan-review']);
});

test('未读失败排在未读完成之前', () => {
  reset([summary('done', 99), summary('failed', 1)]);
  markUnreadCompleted('done');
  markUnreadCompleted('failed');
  assert.deepEqual(order(['failed']), ['failed', 'done']);
});

test('正在跑的压过一切', () => {
  reset([summary('running', 1, { running: true }), summary('failed', 99)]);
  markUnreadCompleted('failed');
  assert.deepEqual(order(['failed']), ['running', 'failed']);
});

test('子智能体还在跑，父会话按"正在跑"排最前', () => {
  reset([
    summary('parent', 1),
    summary('child', 99, { running: true, parentSessionId: 'parent', origin: 'subagent' }),
    summary('idle', 50),
  ]);
  assert.deepEqual(order(), ['parent', 'idle']);
});

test('等待档位缺 kind 时按批准兜底', () => {
  reset([summary('unnamed', 1), summary('question', 99)]);
  // 只进"等待集合"、没有 kind：安卓按 APPROVAL 排档。
  sessionListStore.markAwaitingUser('unnamed', 'approval');
  sessionListStore.markAwaitingUser('question', 'question');
  assert.deepEqual(order(), ['unnamed', 'question']);
});

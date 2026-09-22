/**
 * 会话显示名与「本轮产出文件」的推断口径：
 * 对照安卓 Format.kt 的两个 sessionDisplayTitle 重载与 SessionStore 推断产物的两道闸。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionDisplayTitle, sessionListTitle, sessionName, turnDeliverablesFor } from '../../src/model/format';
import { Strings, setLocale } from '../../src/i18n/strings';
import type { SessionSummary } from '../../src/model/types';
import type { ChatNode } from '../../src/model/chatNode';

const summary = (extra: Partial<SessionSummary> & { title?: string } = {}): SessionSummary => {
  const { title, ...rest } = extra;
  return {
    sessionId: 'session-abc', updatedAt: 0, running: false, blank: false,
    ...rest,
    projections: title === undefined ? rest.projections : { values: { title } },
  } as SessionSummary;
};

test('空白会话在任何入口都读作「新会话」', () => {
  setLocale('zh');
  const blank = summary({ blank: true, cwd: '/work/alpha' });
  assert.equal(sessionDisplayTitle(blank, undefined), Strings.newSessionPlaceholder);
  assert.equal(sessionDisplayTitle(blank, 'live'), Strings.newSessionPlaceholder);
  assert.equal(sessionListTitle(blank, undefined), Strings.newSessionPlaceholder);
  setLocale('en');
});

test('非空白会话：实时标题 → 投影标题 → 目录名 → sessionId', () => {
  assert.equal(sessionDisplayTitle(summary({ title: 'Projected' }), 'Live'), 'Live');
  assert.equal(sessionDisplayTitle(summary({ title: 'Projected' }), undefined), 'Projected');
  assert.equal(sessionDisplayTitle(summary({ cwd: '/work/alpha' }), undefined), 'alpha');
  assert.equal(sessionDisplayTitle(summary(), undefined), 'session-abc');
  // sessionName 是不看 blank 的那一档。
  assert.equal(sessionName(summary({ blank: true, cwd: '/work/alpha' })), 'alpha');
});

// —— 本轮产出文件的两道闸 ——————————————————————————————

const toolNode = (extra: Record<string, unknown>): ChatNode => ({
  kind: 'tool',
  data: {
    callId: 'c1', name: 'write', argsRaw: '{"file_path":"a.ts","content":"x"}',
    turn: 1, step: 1, startSeq: 5, time: 0,
    result: { seq: 6, time: 0, content: [], isError: false },
    ...extra,
  },
}) as unknown as ChatNode;

test('失败的写入不算产出', () => {
  const ok = turnDeliverablesFor([toolNode({})]);
  assert.deepEqual(ok.map(file => file.path), ['a.ts']);
  const failed = turnDeliverablesFor([toolNode({ result: { seq: 6, time: 0, content: [], isError: true } })]);
  assert.deepEqual(failed, []);
});

test('嵌套子调用归它的根调用，不单独算产出', () => {
  const nested = turnDeliverablesFor([toolNode({ parentCallId: 'root' })]);
  assert.deepEqual(nested, []);
});

test('还没有结果的调用不算产出', () => {
  assert.deepEqual(turnDeliverablesFor([toolNode({ result: undefined })]), []);
});

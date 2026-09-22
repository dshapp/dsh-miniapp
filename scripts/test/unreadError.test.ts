/**
 * 未读失败红点：逐条对照安卓 UnreadErrorGateTest 的口径。
 *
 * 红点 = 有一条失败过的轮次，且它不是"已经看过"的那一条。屏幕之外跑挂的会话必须留红点，
 * 正看着的那条不留；已读之后订阅者要收到通知，否则列表上的红点消不掉。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../../src/state/sessionStore';

const ev = (type: string, seq: number, data: unknown) => ({ type, seq, time: seq, data }) as never;

const failedTurn = (turn: number, startSeq: number) => [
  ev('turn/start', startSeq, { turn }),
  ev('turn/end', startSeq + 1, { turn, reason: { kind: 'error', error: { message: 'boom' } } }),
];

function storeWithSeenFailure(): SessionStore {
  const store = new SessionStore('s1');
  for (const event of failedTurn(1, 1)) store.apply(event, undefined);
  store.markErrorSeen();
  return store;
}

test('失败一轮后红点亮起', () => {
  const store = new SessionStore('s1');
  for (const event of failedTurn(1, 1)) store.apply(event, undefined);
  assert.equal(store.unreadError, true);
});

test('标记已读后红点熄灭', () => {
  assert.equal(storeWithSeenFailure().unreadError, false);
});

test('已读之后再失败一轮，红点重新亮起', () => {
  const store = storeWithSeenFailure();
  for (const event of failedTurn(2, 3)) store.apply(event, undefined);
  assert.equal(store.unreadError, true);
});

test('已读要通知订阅者，否则列表红点消不掉', () => {
  const store = new SessionStore('s1');
  for (const event of failedTurn(1, 1)) store.apply(event, undefined);
  let notifications = 0;
  store.unreadErrorStore.subscribe(() => { notifications += 1; });
  store.markErrorSeen();
  assert.equal(store.unreadError, false);
  assert.ok(notifications > 0, 'markErrorSeen 必须推一次订阅');
});

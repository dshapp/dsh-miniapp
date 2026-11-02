/**
 * 实时帧上的失败读数：逐条对照安卓 LiveTurnFailureSignalTest。
 *
 * 失败事实必须能搭在 turn/end 这一帧上发出，正文用主机给的原因、AUTH 换本地化说法。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveTurnFailureMessage, turnFailureMessage } from '../../src/model/turnFailure';
import { Strings, setLocale } from '../../src/i18n/strings';

const turnEnd = (message?: string) => ({
  type: 'turn/end',
  data: { turn: 1, reason: { kind: 'error', error: message === undefined ? { code: 'AUTH' } : { code: 'AUTH', message } } },
});

test('实时失败读出本地化原因', () => {
  setLocale('zh');
  assert.equal(liveTurnFailureMessage(turnEnd('401 Unauthorized: bad key')), 'API 密钥无效');
  setLocale('en');
  assert.equal(liveTurnFailureMessage(turnEnd('401 Unauthorized: bad key')), 'API key is invalid');
});

test('正常收尾不算失败', () => {
  assert.equal(liveTurnFailureMessage({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }), undefined);
  assert.equal(liveTurnFailureMessage({ type: 'turn/start', data: { turn: 1 } }), undefined);
});

test('非 AUTH 失败保留主机给的原因，空原因才兜底', () => {
  setLocale('zh');
  assert.equal(turnFailureMessage({ error: { code: 'SERVER', message: 'boom' } }), 'boom');
  assert.equal(turnFailureMessage({ error: { code: 'SERVER' } }), Strings.turnFailureFallback);
  assert.equal(turnFailureMessage(undefined), Strings.turnFailureFallback);
  setLocale('en');
});

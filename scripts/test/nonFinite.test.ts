/**
 * 读数格式化扛非有限输入：逐条对照安卓 NonFiniteReadingsTest。
 *
 * 时长/速率都从主机投影与 wire 上来，wire 上 "NaN"/"1e400" 会原样解析成
 * NaN / Infinity；不挡住就会把 "NaN分NaN秒" 印到上下文面板里。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, formatLatencySeconds, formatStatsDuration, formatTokensPerSecond } from '../../src/model/format';
import { Strings, fmt, setLocale } from '../../src/i18n/strings';

test('统计时长把 NaN 读作 0', () => {
  setLocale('zh');
  assert.equal(formatStatsDuration(NaN), fmt(Strings.durationSecondsText, '0'));
});

test('统计时长扛得住无穷', () => {
  setLocale('zh');
  assert.equal(formatStatsDuration(Infinity), fmt(Strings.durationSecondsText, '0'));
  assert.equal(formatStatsDuration(-Infinity), fmt(Strings.durationSecondsText, '0'));
});

test('速率与延迟把 NaN 读作 0', () => {
  assert.equal(formatTokensPerSecond(NaN), '0.0');
  assert.equal(formatLatencySeconds(NaN), '0.0');
});

test('轮次用时扛得住非有限输入', () => {
  setLocale('en');
  assert.equal(formatDuration(NaN), '0' + Strings.durationSecondUnit);
  assert.equal(formatDuration(Infinity), '0' + Strings.durationSecondUnit);
});

test('正常读数不受影响', () => {
  setLocale('zh');
  assert.equal(formatStatsDuration(45_200), fmt(Strings.durationSecondsText, '45.2'));
  assert.equal(formatStatsDuration(162_000), fmt(Strings.statsDurationMinutes, 2, 42));
  assert.equal(formatTokensPerSecond(1.5), '1.5');
  assert.equal(formatTokensPerSecond(41.6), '42');
  assert.equal(formatLatencySeconds(640), '0.6');
  setLocale('en');
});

/**
 * 读数格式化：逐条对照安卓 NumberFormatTest / RelativeTimeTest / PlaceholderFormatTest。
 *
 * 界面语言只有中/英两种，所以小数点固定 `.`、千分位固定 `,`，不跟设备区域走。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBytes,
  formatDuration,
  formatExactTokens,
  formatLatencySeconds,
  formatTokens,
  formatTokensPerSecond,
  relativeTime,
} from '../../src/model/format';
import { Strings, fmt, setLocale } from '../../src/i18n/strings';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const ago = (ms: number): string => relativeTime(Date.now() - ms);

test('latency 保留点号小数位', () => {
  assert.equal(formatLatencySeconds(4_500), '4.5');
  assert.equal(formatLatencySeconds(12_400), '12');
});

test('tok/s 保留点号小数位', () => {
  assert.equal(formatTokensPerSecond(3.25), '3.3');
  assert.equal(formatTokensPerSecond(42.4), '42');
});

test('token 计数用逗号千分位', () => {
  assert.equal(formatExactTokens(1_234_567), '1,234,567');
  assert.equal(formatTokens(12_200), '12.2K');
});

test('字节读数保留点号小数位', () => {
  assert.equal(formatBytes((1 << 20) + (1 << 19)), '1.5 MB');
  assert.equal(formatBytes(512 * 1024), '512 KB');
});

test('相对时间：不足一分钟是 now', () => {
  setLocale('en');
  assert.equal(ago(0), 'now');
  assert.equal(ago(30_000), 'now');
  assert.equal(ago(MINUTE - 1), 'now');
  // 时钟漂移导致的未来时间戳夹到 0。
  assert.equal(relativeTime(Date.now() + HOUR), 'now');
});

test('相对时间：六档桶与 web/Mac 一致', () => {
  setLocale('en');
  assert.equal(ago(5 * MINUTE), '5min');
  assert.equal(ago(3 * HOUR), '3h');
  assert.equal(ago(2 * DAY), '2d');
  assert.equal(ago(4 * MONTH), '4mo');
  assert.equal(ago(YEAR), '1y');
  assert.equal(ago(45 * DAY), '1mo');
  assert.equal(ago(395 * DAY), '1y');
  assert.equal(ago(2 * YEAR), '2y');
});

test('相对时间：中文档位', () => {
  setLocale('zh');
  assert.equal(ago(10_000), '刚刚');
  assert.equal(ago(5 * MINUTE), '5分钟');
  assert.equal(ago(3 * HOUR), '3小时');
  assert.equal(ago(2 * DAY), '2天');
  assert.equal(ago(4 * MONTH), '4个月');
  assert.equal(ago(YEAR), '1年');
  setLocale('en');
});

test('占位符：%d 与 %02d 都要填', () => {
  setLocale('en');
  assert.equal(fmt(Strings.findCount, 7, 12), '7/12');
  assert.equal(fmt(Strings.questionProgress, 7, 12), '7 / 12');
  assert.equal(fmt('%d', 2025), '2025');
  assert.equal(fmt('%02d', 7), '07');
  // durationMinutes 同时含 %d 与 %02d：安卓 String.format 两者都填。
  assert.equal(fmt(Strings.durationMinutes, 2, 7), '2m 07s');
  assert.equal(fmt(Strings.statsCounts, 3, 12), '3 turns 12 steps');
});

test('占位符：%s 原样填入', () => {
  setLocale('en');
  assert.equal(fmt(Strings.searchHasMore, 20), 'Showing the first 20 results. Narrow your search.');
});

test('占位符：%% 是一个百分号', () => {
  setLocale('en');
  assert.equal(fmt(Strings.contextAria, 42), '42% of context used');
});

test('时长格式化不漏占位符', () => {
  setLocale('en');
  assert.equal(formatDuration(127_000), '2m 07s');
  assert.equal(formatDuration(65_000), '1m 05s');
  assert.equal(formatDuration(9_000), '9s');
});

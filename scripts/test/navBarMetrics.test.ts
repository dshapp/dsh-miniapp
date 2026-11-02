/**
 * 自定义标题栏的高度公式。
 *
 * 公式来自小程序官方口径（也是掘金那篇《小程序自定义导航栏，兼容适配所有机型》的做法）：
 *
 *   标题栏内容高 = (胶囊距上边界 - 状态栏高度) * 2 + 胶囊高度
 *   导航栏总高   = 状态栏高度 + 标题栏内容高
 *
 * 这几条数字决定了每一页顶栏的高度与胶囊避让宽度，画错一两个像素，标题就会与胶囊错开
 * 一档；所以按真机实测的几组机型参数钉死在单测里。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNavMetrics,
  FALLBACK_MENU_HEIGHT,
  FALLBACK_MENU_WIDTH,
  isUsableMenuRect,
} from '../../src/model/navBarMetrics';

/** iPhone X 及之后的刘海屏：状态栏 44，胶囊 32 高、顶到 48。 */
const iphoneX = {
  system: { statusBarHeight: 44, screenWidth: 375, platform: 'ios' },
  rect: { width: 87, height: 32, top: 48, right: 368 },
};

/** 老 iPhone（非刘海）：状态栏 20。 */
const iphone8 = {
  system: { statusBarHeight: 20, screenWidth: 375, platform: 'ios' },
  rect: { width: 87, height: 32, top: 24, right: 368 },
};

/** 典型安卓机：状态栏 24，胶囊间距更大。 */
const android = {
  system: { statusBarHeight: 24, screenWidth: 360, platform: 'android' },
  rect: { width: 87, height: 32, top: 32, right: 353 },
};

test('iPhone X：导航栏总高 = 状态栏 + (间距 * 2 + 胶囊高)', () => {
  const m = computeNavMetrics(iphoneX.system, iphoneX.rect);
  assert.equal(m.menuGap, 4);
  assert.equal(m.barHeight, 4 * 2 + 32);
  assert.equal(m.totalHeight, 44 + 40);
  assert.equal(m.fallback, false);
});

test('老 iPhone：状态栏矮一截，总高跟着矮', () => {
  const m = computeNavMetrics(iphone8.system, iphone8.rect);
  assert.equal(m.menuGap, 4);
  assert.equal(m.barHeight, 40);
  assert.equal(m.totalHeight, 60);
});

test('安卓：间距更大，标题栏内容区也更高', () => {
  const m = computeNavMetrics(android.system, android.rect);
  assert.equal(m.menuGap, 8);
  assert.equal(m.barHeight, 8 * 2 + 32);
  assert.equal(m.totalHeight, 24 + 48);
});

test('标题栏内容区的中线压在胶囊中线上', () => {
  for (const fixture of [iphoneX, iphone8, android]) {
    const m = computeNavMetrics(fixture.system, fixture.rect);
    const barCenter = m.statusBarHeight + m.barHeight / 2;
    const menuCenter = m.menuTop + m.menuHeight / 2;
    assert.equal(barCenter, menuCenter);
  }
});

test('右侧让位 = 胶囊宽 + 两侧间距，动作按钮不会钻到胶囊底下', () => {
  const m = computeNavMetrics(iphoneX.system, iphoneX.rect);
  // 375 - 368 = 7
  assert.equal(m.menuRight, 7);
  assert.equal(m.rightInset, 87 + 7 * 2);
  // 让位之后，动作区的右边界落在胶囊左沿之外（还多留一份 menuRight 的呼吸位）。
  const capsuleLeft = m.screenWidth - m.menuRight - m.menuWidth;
  assert.equal(m.screenWidth - m.rightInset, capsuleLeft - m.menuRight);
  assert.ok(m.screenWidth - m.rightInset < capsuleLeft);
});

test('胶囊测不出来时走兜底，而不是算出一条 0 高的导航栏', () => {
  for (const rect of [undefined, { width: 0, height: 0, top: 0, right: 0 }]) {
    assert.equal(isUsableMenuRect(rect), false);
    const m = computeNavMetrics(iphoneX.system, rect);
    assert.equal(m.fallback, true);
    assert.equal(m.menuHeight, FALLBACK_MENU_HEIGHT);
    assert.equal(m.menuWidth, FALLBACK_MENU_WIDTH);
    assert.ok(m.totalHeight > m.statusBarHeight);
  }
});

test('兜底的间距按平台分档：iOS 4、其它 8', () => {
  const ios = computeNavMetrics({ statusBarHeight: 44, screenWidth: 375, platform: 'ios' }, undefined);
  const other = computeNavMetrics({ statusBarHeight: 24, screenWidth: 360, platform: 'android' }, undefined);
  assert.equal(ios.menuGap, 4);
  assert.equal(other.menuGap, 8);
});

test('状态栏高度不可用时也不返回 0 高导航栏', () => {
  const m = computeNavMetrics({ statusBarHeight: 0, screenWidth: 0, platform: 'devtools' }, undefined);
  assert.ok(m.statusBarHeight > 0);
  assert.ok(m.screenWidth > 0);
  assert.ok(m.totalHeight > 0);
});

test('胶囊被画进状态栏里时，间距夹到 0 而不是负数', () => {
  const m = computeNavMetrics(
    { statusBarHeight: 44, screenWidth: 375, platform: 'ios' },
    { width: 87, height: 32, top: 40, right: 368 },
  );
  assert.equal(m.menuGap, 0);
  assert.equal(m.barHeight, 32);
});

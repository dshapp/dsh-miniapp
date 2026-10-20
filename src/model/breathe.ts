/**
 * 执行中卡片的「呼吸」相位（对齐扩展 a268f45 的 syncBreathePhase）。
 *
 * 小程序的 CSS 动画从元素挂上动画的那一刻起算，各张卡片挂载时刻不同，直接播放就各闪各的；
 * 卡片内容一更新（重建）也会从头再来。这里用负的 animation-delay 把每张卡的起点拨到
 * 「全局时钟此刻应处的位置」：delay = -(now % 周期)，于是所有执行中的卡片同起同落。
 */

/** 呼吸一周的时长，与 ui/breathe.module.scss 的 card-breathe 一致。 */
export const BREATHE_PERIOD_MS = 1600;

/** 此刻开始播放时应带的 animation-delay（毫秒，≤ 0）。 */
export function breatheDelayMs(now: number): number {
  if (!Number.isFinite(now)) return 0;
  const phase = ((now % BREATHE_PERIOD_MS) + BREATHE_PERIOD_MS) % BREATHE_PERIOD_MS;
  return phase === 0 ? 0 : -phase;
}

import React from 'react';
import { breatheDelayMs } from '../model/breathe';
import styles from './breathe.module.scss';

/** 一张卡片里参与呼吸的内容（图标、标题、附注）共用的 className 与 style。 */
export interface BreatheProps {
  className: string;
  style?: React.CSSProperties;
}

const IDLE: BreatheProps = { className: '' };

/**
 * 执行中卡片的呼吸态。相位只在「开始执行」那一刻按全局时钟取一次：
 * 之后卡片内容再怎么更新，animation-delay 都不变——中途改 delay 会让正在播的动画跳相位。
 * 结束即停（className 撤掉）。
 */
export function useBreathe(active: boolean): BreatheProps {
  const delay = React.useMemo(() => (active ? breatheDelayMs(Date.now()) : 0), [active]);
  return React.useMemo(
    () => (active ? { className: styles.breathe, style: { animationDelay: delay + 'ms' } } : IDLE),
    [active, delay],
  );
}

/** 把呼吸的 className 拼到已有 className 后面。 */
export function withBreathe(className: string, breathe: BreatheProps): string {
  return breathe.className.length === 0 ? className : className + ' ' + breathe.className;
}

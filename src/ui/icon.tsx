import React from 'react';
import { Text, type TextProps } from '@tarojs/components';
import { lucideIcon, type LucideIconName } from './lucideIcons';
import styles from './icon.module.scss';

/**
 * Lucide 图标。
 *
 * 字形来自 lucide 官方图标字体的子集（见 lucideIcons.ts / scripts/build-icons.mjs），
 * 所以这里就用 <Text> 写一个私有区字符——不额外引 SVG 组件，颜色与字号完全跟着
 * 调用方的 className 走，和原来的字符字形是同一套排版。
 */
export function Icon(props: {
  name: LucideIconName;
  className?: string;
  /** 转圈：只给 loader-circle / refresh-cw 这类"进行中"图标用。 */
  spin?: boolean;
  /** 闪烁：转写里"正在执行"的卡片用它，图标不转、只做明暗呼吸。 */
  blink?: boolean;
  style?: React.CSSProperties;
  onClick?: TextProps['onClick'];
  /** 读屏用标签：纯图标按钮没有可见文字，必须给一个（对齐 Android 的 contentDescription）。 */
  ariaLabel?: string;
}): JSX.Element {
  const className = [
    styles.icon,
    props.spin === true ? styles.spin : '',
    props.blink === true ? styles.blink : '',
    props.className ?? '',
  ]
    .filter(part => part.length > 0)
    .join(' ');
  return (
    <Text
      className={className}
      style={props.style}
      onClick={props.onClick}
      aria-label={props.ariaLabel}
      aria-hidden={props.ariaLabel === undefined ? true : undefined}
    >
      {lucideIcon(props.name)}
    </Text>
  );
}

export type { LucideIconName };

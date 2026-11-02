/**
 * 锚定动作菜单：贴在触发按钮下方的一张浮层卡片。
 *
 * 安卓里这类菜单都是 `DropdownMenu`（锚在触发元素下、带 leading 图标、危险项单独染色）。
 * 小程序没有原生锚定菜单，`wx.showActionSheet` 又是系统底部面板且不支持图标与单项颜色，
 * 所以这里自绘：`fixed` 遮罩 + 绝对定位的圆角卡片，位置由调用方按点击坐标给出。
 */
import React from 'react';
import { Text, View } from '@tarojs/components';
import type { LucideIconName } from './lucideIcons';
import { getSystemInfo } from '../framework/systemInfo';
import { Icon } from './icon';
import styles from './actionMenu.module.scss';

/** 一条菜单项；`danger` 用于「清空目标」这类破坏性动作（安卓染 error 色）。 */
export interface ActionMenuItem {
  key: string;
  label: string;
  icon?: LucideIconName;
  danger?: boolean;
  disabled?: boolean;
  /** 选中项在图标槽画一枚对勾（对齐安卓 DropdownMenuItem 的 leadingIcon = Check）。 */
  checked?: boolean;
  /** 在这一项上方画一条分隔线，把「切换选项」和「跳去别的页面」这类不同性质的项隔开。 */
  divider?: boolean;
}

/** 触发点坐标（`clientX/clientY`，视口坐标）与菜单宽高上限。 */
export interface ActionMenuAnchor {
  x: number;
  y: number;
}

/**
 * 菜单浮层。`anchor` 为 `undefined` 时不渲染。
 *
 * 位置做了边界收敛：右边缘超屏就右对齐，下边缘超屏就翻到触发点上方，保证 6~8 项的长菜单
 * 在窄屏上也能完整看到（`wx.showActionSheet` 由系统负责这件事，自绘就得自己来）。
 */
export function ActionMenu(props: {
  anchor?: ActionMenuAnchor;
  items: ActionMenuItem[];
  onSelect: (key: string) => void;
  onClose: () => void;
  /** 菜单宽度；默认 200px，与安卓 DropdownMenu 的视觉宽度接近。 */
  width?: number;
}): JSX.Element | null {
  const { anchor, items, onSelect, onClose, width = 200 } = props;
  if (anchor === undefined) return null;

  // 视口尺寸拿不到时按 iPhone 逻辑宽兜底，边界收敛退化成「贴着右边」。
  const info = getSystemInfo();
  const viewportWidth = info.windowWidth ?? 375;
  const viewportHeight = info.windowHeight ?? 667;
  const estimatedHeight = items.length * 44 + items.filter(item => item.divider === true).length * 9 + 8;

  const left = Math.max(8, Math.min(anchor.x, viewportWidth - width - 8));
  const openUpward = anchor.y + estimatedHeight > viewportHeight;
  // 向上翻时让菜单底边落在触发点上；这里用 top 表达，负值由边界收敛夹住。
  const top = openUpward ? Math.max(8, anchor.y - estimatedHeight) : Math.min(anchor.y, viewportHeight - estimatedHeight - 8);

  return (
    <View className={styles.overlay} onClick={onClose}>
      <View
        className={styles.menu}
        style={{ left: left + 'px', top: top + 'px', width: width + 'px' }}
        // 点菜单体不该关掉它（冒泡到遮罩会误关）。
        onClick={event => event.stopPropagation()}
      >
        {items.map(item => (
          <View
            key={item.key}
            className={
              styles.row
              + (item.disabled === true ? ' ' + styles.rowDisabled : '')
              + (item.divider === true ? ' ' + styles.rowDivider : '')
            }
            onClick={() => {
              if (item.disabled === true) return;
              onSelect(item.key);
            }}
          >
            {/* 图标槽固定：有 checked 就画对勾（优先，和安卓一致），否则画 item.icon。 */}
            <Icon
              name={item.checked === true ? 'check' : item.icon ?? 'chevron-right'}
              className={
                styles.glyph +
                (item.danger === true ? ' ' + styles.glyphDanger : '') +
                (item.checked === true ? ' ' + styles.glyphChecked : '') +
                (item.checked !== true && item.icon === undefined ? ' ' + styles.glyphHidden : '')
              }
            />
            <Text className={styles.label + (item.danger === true ? ' ' + styles.labelDanger : '')}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** 从点击事件里取触发点；拿不到时退回右上方（顶栏动作按钮的位置）。 */
export function anchorFromEvent(event: unknown): ActionMenuAnchor {
  const detail = (event as { detail?: { x?: number; y?: number }; currentTarget?: { offsetLeft?: number; offsetTop?: number } } | undefined);
  const x = detail?.detail?.x;
  const y = detail?.detail?.y;
  if (typeof x === 'number' && typeof y === 'number') return { x, y };
  return { x: 320, y: 60 };
}

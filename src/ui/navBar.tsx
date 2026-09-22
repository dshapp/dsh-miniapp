import React from 'react';
import { Input, Text, View } from '@tarojs/components';
import type { BaseEventOrig, InputProps } from '@tarojs/components';
import { navMetrics } from '../framework/navbar';
import type { NavMetrics } from '../model/navBarMetrics';
import { Icon, type LucideIconName } from './icon';
import styles from './navBar.module.scss';

/**
 * 自定义标题栏。
 *
 * 这是小程序端唯一的顶栏出口，对齐安卓 `TopAppBar` 的三槽位签名：
 *
 *   TopAppBar(navigationIcon = {...}, title = {...}, actions = {...})
 *   <NavBar left={...} title={...} actions={...} />
 *
 * 与安卓的两处必要差异，都是平台真做不到，不是偷懒：
 *
 * 1. 右上角那颗胶囊（关闭/更多）是微信画的，谁也去不掉。所以动作区的右边界收到
 *    胶囊左侧（`rightInset`），安卓端"按钮贴右边界"在这里变成"按钮贴胶囊左边"。
 * 2. 标题栏内容区的垂直中线对齐胶囊中线（见 framework/navbar.ts 的公式），所以
 *    我们的按钮与胶囊天然在同一条水平线上。
 *
 * 布局形态：整条 `sticky` 在顶部（默认）——普通滚动页里它随页面置顶不动；
 * 会话页那种"自己管滚动"的 flex 列里传 `flow`，它就是一个普通的 flex 项。
 */
export interface NavBarProps {
  /** 左槽：返回键/关闭键/连接状态点，对齐安卓 navigationIcon。 */
  left?: React.ReactNode;
  /** 标题槽：普通态是一行文字，搜索态是一行无边框输入（对齐安卓把 BasicTextField 塞进 title）。 */
  title?: React.ReactNode;
  /** 右槽：一排动作按钮，对齐安卓 actions。 */
  actions?: React.ReactNode;
  /**
   * 定位方式。
   * - `sticky`（默认）：普通滚动页，顶栏随页面置顶；
   * - `flow`：页面自己是 flex 列（会话页），顶栏只是第一个 flex 项；
   * - `fixed`：盖在内容之上（全屏弹层）。
   */
  mode?: 'sticky' | 'flow' | 'fixed';
  /** 顶栏底部是否画分隔线。安卓 TopAppBar 默认无分隔线；这里默认也关。 */
  divider?: boolean;
  /**
   * 底色。默认 `card`（白），与下方内容区分开；`page` 与正文同色，用在正文本来就
   * 没有卡片、顶栏只放一个返回键的页面（新建会话页），免得出现一块没有来由的白条。
   */
  background?: 'card' | 'page';
  /**
   * 标题居中，对齐安卓的 `CenterAlignedTopAppBar`（只有引导页用）。
   * 小程序这里的"居中"是相对于让开胶囊之后的可用宽度，不是屏幕正中——否则标题
   * 看上去会被胶囊往左推一截。 */
  centerTitle?: boolean;
  className?: string;
}

export function NavBar(props: NavBarProps): JSX.Element {
  const metrics = navMetrics();
  const mode = props.mode ?? 'sticky';
  const className = [
    styles.bar,
    mode === 'sticky' ? styles.sticky : mode === 'fixed' ? styles.fixed : styles.flow,
    // 安卓 TopAppBar 默认不画底部分隔线，只有滚动时才现；这里默认也关掉，
    // 需要分隔线的页面显式传 divider。
    props.divider === true ? styles.divider : '',
    props.background === 'page' ? styles.onPage : '',
    props.className ?? '',
  ]
    .filter(part => part.length > 0)
    .join(' ');
  return (
    <View className={className} style={{ paddingTop: metrics.statusBarHeight + 'px', height: metrics.totalHeight + 'px' }}>
      <View className={styles.row} style={{ height: metrics.barHeight + 'px', paddingRight: metrics.rightInset + 'px' }}>
        {props.left === undefined ? null : <View className={styles.leading}>{props.left}</View>}
        <View className={styles.titleSlot + (props.centerTitle === true ? ' ' + styles.titleCentered : '')}>
          {props.title}
        </View>
        {props.actions === undefined ? null : <View className={styles.actions}>{props.actions}</View>}
      </View>
    </View>
  );
}

/**
 * 顶栏占位。
 *
 * `mode="fixed"` 的顶栏脱离文档流，正文要自己让出这一段高度；`sticky`/`flow` 不需要。
 */
export function NavBarSpacer(): JSX.Element {
  return <View style={{ height: navMetrics().totalHeight + 'px', flexShrink: 0 }} />;
}

/**
 * 顶栏里的图标按钮，对齐安卓 `IconButton`：点按范围固定 44×44（安卓是 48dp，但
 * 小程序这条栏只有 32-44px 高，48 会顶破；44 是通用最小触摸目标，高度再由
 * `max-height: 100%` 跟住实际行高）。禁用态只变淡不消失——安卓也是 `enabled = false`
 * 留着槽位，数字宽度变化时按钮不会左右乱挪。
 */
export function NavIconButton(props: {
  name: LucideIconName;
  onClick?: () => void;
  ariaLabel?: string;
  disabled?: boolean;
  spin?: boolean;
}): JSX.Element {
  const disabled = props.disabled === true;
  return (
    <View
      className={styles.iconButton + (disabled ? ' ' + styles.iconButtonOff : '')}
      aria-label={props.ariaLabel}
      onClick={() => {
        if (disabled) return;
        props.onClick?.();
      }}
    >
      <Icon name={props.name} spin={props.spin} className={styles.icon} />
    </View>
  );
}

/** 顶栏里的文字按钮，对齐安卓 `TextButton`（配对页的「扫码/手动输入」切换）。 */
export function NavTextButton(props: { text: string; onClick?: () => void }): JSX.Element {
  return (
    <View className={styles.textButton} onClick={props.onClick}>
      <Text className={styles.textButtonLabel}>{props.text}</Text>
    </View>
  );
}

/**
 * 顶栏标题文字，对齐安卓 `TopAppBar` 的 `title = { Text(..., maxLines = 1,
 * overflow = TextOverflow.Ellipsis) }`：一行、超长省略、左对齐。
 */
export function NavTitle(props: { text: string }): JSX.Element {
  return <Text className={styles.title}>{props.text}</Text>;
}

/** 顶栏里的一段说明文字，对齐安卓 actions 里的 `Text`（会话页的「第几条/共几条」）。 */
export function NavLabel(props: { text: string }): JSX.Element {
  return <Text className={styles.label}>{props.text}</Text>;
}

/**
 * 标题位的搜索输入，对齐安卓在 `title = {}` 里塞 `BasicTextField` 的做法：
 * 一行、无边框、无背景，占位符用次级色。安卓在注释里写得很清楚——带描边的
 * 输入框最小 56dp，塞进标题栏会被挤扁，也不是系统搜索栏的样子。
 */
export function NavSearchInput(props: {
  value: string;
  placeholder: string;
  focus?: boolean;
  onInput: (value: string) => void;
  onConfirm?: () => void;
}): JSX.Element {
  return (
    <Input
      className={styles.searchInput}
      value={props.value}
      focus={props.focus}
      confirmType='search'
      placeholderClass={styles.searchPlaceholder}
      placeholder={props.placeholder}
      onInput={(event: BaseEventOrig<InputProps.inputEventDetail>) => props.onInput(event.detail.value)}
      onConfirm={() => props.onConfirm?.()}
    />
  );
}

/** 顶栏度量：页面要自己算高度时用（会话页的转写区、全屏弹层）。 */
export function useNavMetrics(): NavMetrics {
  return navMetrics();
}

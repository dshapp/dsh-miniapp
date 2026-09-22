import React from 'react';
import { Text, View } from '@tarojs/components';
import { Strings } from '../i18n/strings';
import { navMetrics } from '../framework/navbar';
import styles from './connectionBanner.module.scss';

/** 连接态。与 appModel 的 Connection 联合一一对应。 */
export type ConnectionTone = 'connected' | 'connecting' | 'reconnecting' | 'failed';

export interface ConnectionBannerProps {
  tone: ConnectionTone | undefined;
  /**
   * 失败时的具体原因。
   *
   * 只在开发者信息里用：提示条本身不展示底层异常（对齐 Android ConnectionBanner：
   * 胶囊里只有本地化结论 + 重试，异常只进日志）。
   */
  detail?: string;
  onRetry?: () => void;
}

function toneClass(tone: ConnectionTone): string {
  if (tone === 'failed') return styles.bad;
  return styles.pending;
}

function toneLabel(tone: ConnectionTone): string {
  switch (tone) {
    // 重连与首次连接给同一句中性提示：底层 WebSocket 自己会接回来，区分「重连中」只会
    // 让人以为出了事故（对齐 Android ConnectionBanner 的 connectingBanner）。
    case 'connecting':
    case 'reconnecting':
      return Strings.statusConnecting;
    // 结论说的是「够不着电脑」而不是「连不上主机」：用户能采取的动作在电脑那头
    //（对齐 Android offlineBanner 的 offlineBannerTitle）。
    case 'failed':
      return Strings.offlineBannerTitle;
    // 已连接没有横幅：一切正常时不该占用屏幕（对齐 Android ConnectionBanner 的 null 分支）。
    case 'connected':
      return Strings.statusConnected;
  }
}

/** 上滑关掉的手势阈值：超过这个纵向位移才认为是「滑走」而不是误触。 */
const DISMISS_DP = 24;

/**
 * 连接状态胶囊。
 *
 * 只有 connecting / reconnecting / failed 三种状态会画出来；已连接与空闲都不画
 * （对齐 Android ui/component/ConnectionBanner.kt 的 when 分支）。形态是悬浮胶囊而不是
 * 通栏：它不该把正文往下顶，失败原因过长也不该撑破一行。上滑可以手动关掉，
 * 但状态一变化就会重新出现。
 */
export function ConnectionBanner(props: ConnectionBannerProps): JSX.Element | null {
  const [dismissed, setDismissed] = React.useState(false);
  const startY = React.useRef(0);
  const tone = props.tone;

  React.useEffect(() => {
    // 状态变了就把「已滑走」重置：新状态该被看见。
    setDismissed(false);
    // 底层异常只留日志，不进提示条（中文界面里冒出英文接口报错只会更费解）。
    if (props.detail !== undefined && props.detail.length > 0) console.warn('[connection]', props.detail);
  }, [tone, props.detail]);

  if (tone === undefined || tone === 'connected' || dismissed) return null;

  // 只有 failed 给重试：重连中主机那边已经在重试了，再给一个按钮只会误导
  // （对齐 Android ConnectionBanner 的 retryable = tone == Failed）。
  const isRetryable = tone === 'failed';
  return (
    <View
      className={styles.capsule + ' ' + toneClass(tone)}
      // 落点是导航栏下沿再 8px，不是状态栏下沿：小程序的顶栏里左边是标题、右边是微信
      // 不让动的胶囊，胶囊飘在那一行上会把标题盖掉、还和胶囊叠在一起（安卓的 TopAppBar
      // 没有这颗胶囊，所以那边可以直接贴状态栏）。挂在顶栏下方同样是"浮在整个小程序
      // 顶部"，但不跟任何既有元素抢位置。
      style={{ top: navMetrics().totalHeight + 8 + 'px' }}
      onTouchStart={event => {
        const touches = (event as unknown as { touches?: { clientY?: number }[] }).touches;
        startY.current = touches?.[0]?.clientY ?? 0;
      }}
      onTouchEnd={event => {
        const changed = (event as unknown as { changedTouches?: { clientY?: number }[] }).changedTouches;
        const end = changed?.[0]?.clientY ?? startY.current;
        if (startY.current - end > DISMISS_DP) setDismissed(true);
      }}
    >
      <View className={styles.dot} />
      <Text className={styles.label}>{toneLabel(tone)}</Text>
      {isRetryable && props.onRetry !== undefined ? (
        <View className={styles.retry} onClick={props.onRetry}>
          <Text className={styles.retryText}>{Strings.retry}</Text>
        </View>
      ) : null}
    </View>
  );
}

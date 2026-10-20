import React from 'react';
import { Text, View } from '@tarojs/components';
import { Strings } from '../i18n/strings';
import { Icon } from './icon';
import { NavBar, NavTitle } from './navBar';
import styles from './onboarding.module.scss';

/**
 * 未配对时的引导页。
 *
 * 对应 Android 的 OnboardingScreen：手机端只有加密隧道一条路，能连哪台 Mac 完全由
 * 配对资料决定，所以「一台都没配」时不能装作连得上——这里只做一件事，带用户去配对：
 * 「扫描二维码」直接拉起相机（不经过配对页再点一次），「粘贴配对串」进配对页的粘贴态。
 */
export interface OnboardingProps {
  onScan: () => void;
  onPaste: () => void;
}

export function Onboarding(props: OnboardingProps): JSX.Element {
  return (
    <View className={styles.page}>
      {/* 对齐 Android OnboardingScreen 的
          `Scaffold(topBar = { CenterAlignedTopAppBar(title = { Text(Strings.appName) }) })`。
          自定义导航栏之后这条必须自己画，否则首配引导页的内容会直接顶进状态栏。 */}
      <NavBar mode='flow' centerTitle background='page' divider={false} title={<NavTitle text={Strings.appName} />} />
      <View className={styles.center}>
        <Icon name='qr-code' className={styles.glyph} />
        <Text className={styles.title}>{Strings.onboardingTitle}</Text>
        <Text className={styles.body}>{Strings.onboardingBody}</Text>
        <View className={styles.primary} onClick={props.onScan}>
          <Text className={styles.primaryText}>{Strings.scanQR}</Text>
        </View>
        <Text className={styles.secondary} onClick={props.onPaste}>
          {Strings.pastePairing}
        </Text>
      </View>
    </View>
  );
}

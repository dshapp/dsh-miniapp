import React from 'react';
import Taro from '@tarojs/taro';
import { ScrollView, Text, View } from '@tarojs/components';
import { Strings } from '../i18n/strings';
import { Store, useStore } from '../state/store';
import { Icon, type LucideIconName } from './icon';
import { NavBar, NavIconButton } from './navBar';
import styles from './cardDetail.module.scss';

/**
 * 卡片详情的全屏弹层（对齐 Android ui/component/Cards.kt#CardDetailDialog）。
 *
 * 安卓的思考卡、工具卡、上下文行、系统提示行的正文都不是就地展开，而是开一个全屏
 * 弹层：左上角关闭、右上角复制、正文可选中可滚动。小程序里没有 Modal/Portal，所以
 * 用一个全局 Store 承载当前请求，宿主组件挂在页面顶层即可。
 */
export interface CardDetailRequest {
  icon: LucideIconName;
  title: string;
  /** 右上角复制的正文；缺省时不显示复制按钮。 */
  copyText?: string;
  content: React.ReactNode;
}

export const cardDetailStore = new Store<CardDetailRequest | undefined>(undefined);

/**
 * 被 pushCardDetail 压下去的上层详情。弹层只有一层，从详情里再点开一张卡片
 * （run_code 的子调用行）时把当前这层记下来，左上角关闭先回到它（对齐 Android
 * 子调用详情叠在父详情之上、返回回到父详情）。
 */
let parentDetails: CardDetailRequest[] = [];

/** 打开一层新的详情，替换掉已经打开的所有层。 */
export function openCardDetail(request: CardDetailRequest): void {
  parentDetails = [];
  cardDetailStore.set(request);
}

/** 在当前详情之上再打开一层；关闭这层回到当前这层。 */
export function pushCardDetail(request: CardDetailRequest): void {
  const current = cardDetailStore.get();
  if (current !== undefined) parentDetails.push(current);
  cardDetailStore.set(request);
}

/** 关闭所有层。 */
export function closeCardDetail(): void {
  parentDetails = [];
  cardDetailStore.set(undefined);
}

/** 关闭最上面一层，有上层详情就回到它。 */
function backCardDetail(): void {
  cardDetailStore.set(parentDetails.pop());
}

/** 全局唯一的详情弹层宿主；没打开时渲染 null。 */
export function CardDetailHost(): JSX.Element | null {
  const request = useStore(cardDetailStore);
  if (request === undefined) return null;
  return (
    <View className={styles.overlay}>
      {/* 顶栏走与页面同一个 NavBar：这层弹层是全屏的，微信的胶囊照样盖在它上面，
          所以右上角的复制按钮必须跟页面一样让开胶囊，否则点不到
          （对齐 Android CardDetailDialog 的 TopAppBar：关闭 + 图标&标题 + 复制）。 */}
      <NavBar
        mode='flow'
        left={<NavIconButton name='x' ariaLabel={Strings.close} onClick={backCardDetail} />}
        title={
          <View className={styles.headerTitleRow}>
            <Icon name={request.icon} className={styles.headerIcon} />
            <Text className={styles.headerTitle}>{request.title}</Text>
          </View>
        }
        actions={
          request.copyText === undefined ? undefined : (
            <NavIconButton
              name='copy'
              ariaLabel={Strings.copy}
              onClick={() => {
                void Taro.setClipboardData({ data: request.copyText ?? '' });
              }}
            />
          )
        }
      />
      <ScrollView className={styles.body} scrollY>
        {request.content}
        {/* 正文末尾（如子调用列表）不能压在 iPhone 底部横条下面。 */}
        <View className={styles.bodyEnd} />
      </ScrollView>
    </View>
  );
}

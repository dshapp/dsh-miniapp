import React from 'react';
import { Text, View } from '@tarojs/components';
import { Icon, type LucideIconName } from './icon';
import styles from './emptyState.module.scss';

/**
 * 空态：图标统一用 Lucide（见 ui/lucideIcons.ts），字号与配色跟着 .glyph 走。
 */
export interface EmptyStateProps {
  name?: LucideIconName;
  title: string;
  description?: string;
  actionText?: string;
  onAction?: () => void;
}

export function EmptyState(props: EmptyStateProps): JSX.Element {
  return (
    <View className={styles.empty}>
      <Icon name={props.name ?? 'circle-dashed'} className={styles.glyph} />
      <Text className={styles.title}>{props.title}</Text>
      {props.description === undefined ? null : <Text className={styles.description}>{props.description}</Text>}
      {props.actionText === undefined || props.onAction === undefined ? null : (
        <View className={styles.action} onClick={props.onAction}>
          <Text className={styles.actionText}>{props.actionText}</Text>
        </View>
      )}
    </View>
  );
}

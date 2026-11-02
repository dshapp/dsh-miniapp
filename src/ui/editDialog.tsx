/**
 * 单字段编辑对话框：安卓 `AlertDialog + OutlinedTextField` 的小程序移植。
 *
 * 为什么不用 `wx.showModal({ editable: true })`：它的输入框是系统单行输入，目标/队列文本
 * 经常是整段话，安卓那边是多行 `OutlinedTextField`（带常驻 label，不是 placeholder）。
 * 这里自绘一张居中卡片 + `Textarea`，提交/取消两个按钮的语义与安卓一致。
 */
import React from 'react';
import { Text, Textarea, View } from '@tarojs/components';
import { Strings } from '../i18n/strings';
import styles from './editDialog.module.scss';

export function EditDialog(props: {
  open: boolean;
  title: string;
  /** 常驻字段标签（对齐 OutlinedTextField 的 label，不随输入消失）。 */
  label: string;
  initial: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}): JSX.Element | null {
  const { open, title, label, initial, onSubmit, onClose } = props;
  const [draft, setDraft] = React.useState(initial);

  // 每次打开都用最新的初值重置草稿：弹层是常驻组件，不重置会带出上一次的内容。
  React.useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  if (!open) return null;
  return (
    <View className={styles.overlay} onClick={onClose}>
      <View className={styles.card} onClick={event => event.stopPropagation()}>
        <Text className={styles.title}>{title}</Text>
        <Text className={styles.label}>{label}</Text>
        <Textarea
          className={styles.input}
          value={draft}
          // 安卓的 OutlinedTextField 是多行自适应；这里给固定 3 行高、可内部滚动。
          autoHeight={false}
          maxlength={-1}
          adjustPosition
          onInput={event => setDraft(event.detail.value)}
        />
        <View className={styles.actions}>
          <Text className={styles.button} onClick={onClose}>{Strings.cancel}</Text>
          <Text className={styles.button + ' ' + styles.primary} onClick={() => onSubmit(draft)}>{Strings.submit}</Text>
        </View>
      </View>
    </View>
  );
}

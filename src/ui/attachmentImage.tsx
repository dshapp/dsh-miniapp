import React, { useEffect, useRef, useState } from 'react';
import { Image, Text, View } from '@tarojs/components';
import { Strings } from '../i18n/strings';
import { jget, str } from '../model/json';
import type { JsonValue } from '../model/json';
import { Icon } from './icon';
import styles from './messageRow.module.scss';

/** 图片附件在这层只认 attachmentId/name 两个字段，其余元数据附件组件并不需要。 */
export interface AttachmentRef {
  attachmentId: string;
  name?: string;
}

/**
 * 从 image 内容块的 attachment 里解出可用的引用。
 *
 * 与 Android 的 decodeImageRef 同义：解不出来（老版本消息、被截断的流式 JSON）
 * 就当这条附件不存在，宁可少画一张图，也不要抛错把整条转写带崩。
 */
export function decodeAttachmentRef(value: JsonValue | undefined): AttachmentRef | undefined {
  const attachmentId = str(jget(value, 'attachmentId'));
  if (attachmentId === undefined || attachmentId.length === 0) return undefined;
  const name = str(jget(value, 'name'));
  return name === undefined || name.length === 0 ? { attachmentId } : { attachmentId, name };
}

/** 用户气泡、助手附件与工具结果共用的图片：先从宿主拿本地临时路径，拿到前先摆一个骨架。 */
export function AttachmentImage(props: {
  sessionId: string;
  attachment: JsonValue;
  resolveImage?: (attachmentId: string, sessionId: string) => Promise<string | undefined>;
  onOpenImage?: (localPath: string, name?: string) => void;
  /** 一组多图时缩成小图（Web/Android 的 compact 相册）。 */
  compact?: boolean;
}): JSX.Element {
  const ref = decodeAttachmentRef(props.attachment);
  const attachmentId = ref === undefined ? undefined : ref.attachmentId;
  const [localPath, setLocalPath] = useState<string | undefined>(undefined);
  // 取不到附件时给一句人能读的失败文案，而不是永远转圈（对齐 Android imageUnavailable）。
  const [failed, setFailed] = useState(false);
  // resolveImage 可能是内联函数，每帧换引用；用 ref 兜住，避免把它写进 effect 依赖后循环拉取。
  const resolveRef = useRef(props.resolveImage);
  useEffect(() => {
    resolveRef.current = props.resolveImage;
  }, [props.resolveImage]);
  useEffect(() => {
    let cancelled = false;
    // 换了一张附件：先退回骨架态，免得旧图短促地闪一下。
    setLocalPath(undefined);
    setFailed(false);
    const resolve = resolveRef.current;
    if (resolve === undefined || attachmentId === undefined) {
      return () => {
        cancelled = true;
      };
    }
    resolve(attachmentId, props.sessionId)
      .then((path) => {
        if (cancelled) return;
        setLocalPath(path);
        setFailed(path === undefined);
      })
      .catch(() => {
        if (cancelled) return;
        setLocalPath(undefined);
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentId, props.sessionId]);

  if (ref === undefined) return <View />;
  if (failed) {
    return (
      <View className={props.compact === true ? styles.imageFailed + ' ' + styles.imageFailedCompact : styles.imageFailed}>
        <Icon name='image' className={styles.imageFailedGlyph} />
        <Text className={styles.imageFailedText}>{Strings.imageUnavailable}</Text>
      </View>
    );
  }
  if (localPath === undefined) {
    return (
      <View className={props.compact === true ? styles.imageSkeleton + ' ' + styles.imageSkeletonCompact : styles.imageSkeleton}>
        <Icon name='loader-circle' spin className={styles.imageSkeletonGlyph} />
      </View>
    );
  }
  const openImage = props.onOpenImage;
  return (
    <Image
      className={props.compact === true ? styles.attachmentImage + ' ' + styles.attachmentImageCompact : styles.attachmentImage}
      src={localPath}
      mode="widthFix"
      onClick={openImage === undefined ? undefined : () => openImage(localPath, ref.name)}
    />
  );
}

/**
 * 连续图片排成一组，与 Web 的 `renderMessageImages` 同口径：
 * 一张铺开，多张缩成一行；用户气泡靠右（alignEnd），助手正文靠左。
 * 对齐 Android ImageGallery。
 */
export function ImageGallery(props: {
  refs: JsonValue[];
  sessionId: string;
  resolveImage?: (attachmentId: string, sessionId: string) => Promise<string | undefined>;
  onOpenImage?: (localPath: string, name?: string) => void;
  alignEnd?: boolean;
}): JSX.Element | null {
  const valid = props.refs.filter((value) => decodeAttachmentRef(value) !== undefined);
  if (valid.length === 0) return null;
  const compact = valid.length > 1;
  return (
    <View className={props.alignEnd === true ? styles.gallery + ' ' + styles.galleryEnd : styles.gallery}>
      {valid.map((attachment, index) => (
        <AttachmentImage
          key={index}
          sessionId={props.sessionId}
          attachment={attachment}
          resolveImage={props.resolveImage}
          onOpenImage={props.onOpenImage}
          compact={compact}
        />
      ))}
    </View>
  );
}

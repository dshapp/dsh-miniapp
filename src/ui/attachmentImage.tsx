import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Text, View } from '@tarojs/components';
import { Strings } from '../i18n/strings';
import type { ImageAttachmentRef } from '../model/imageCards';
import { previewUrls } from '../model/imagePreview';
import { Icon } from './icon';
import styles from './messageRow.module.scss';

/**
 * 取一张图片附件的本地临时路径。参数是转写里图片块的完整引用：0.2.2 的 session/attachment
 * 要拿整份 ImageAttachmentRef 去换字节，只给 attachmentId 会被网关拒绝。
 */
export type ResolveImage = (attachment: ImageAttachmentRef, sessionId: string) => Promise<string | undefined>;

/**
 * 点开图片：localPath 是被点的那张，urls 是同组可左右滑动的全部本地路径（含 localPath）。
 * 页面拿它调微信原生预览（Taro.previewImage），放大、拖动、左右切换都由微信负责。
 */
export type OpenImage = (localPath: string, name?: string, urls?: string[]) => void;

/**
 * 同一组图片（一条消息的相册 / 一个工具结果里的几张）共用的登记簿：
 * 每张图取到本地路径后按自己的下标登记，点开时整组一起交给原生预览。
 */
export interface ImageGroup {
  register(index: number, localPath: string | undefined): void;
  urls(current: string): string[];
}

/** 在相册类组件里建一个登记簿；用 ref 存，登记不触发重渲染。 */
export function useImageGroup(): ImageGroup {
  const paths = useRef<Array<string | undefined>>([]);
  const register = useCallback((index: number, localPath: string | undefined) => {
    paths.current[index] = localPath;
  }, []);
  const urls = useCallback((current: string) => previewUrls(paths.current, current), []);
  return useRef<ImageGroup>({ register, urls }).current;
}

/** 用户气泡、助手附件与工具结果共用的图片：先从宿主拿本地临时路径，拿到前先摆一个骨架。 */
export function AttachmentImage(props: {
  sessionId: string;
  attachment: ImageAttachmentRef;
  resolveImage?: ResolveImage;
  onOpenImage?: OpenImage;
  /** 一组多图时缩成小图（Web/Android 的 compact 相册）。 */
  compact?: boolean;
  /** 所在的图片组与组内下标：点开时整组进原生预览，可左右滑动。 */
  group?: ImageGroup;
  groupIndex?: number;
}): JSX.Element {
  const ref = props.attachment;
  const attachmentId = ref.attachmentId;
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
    if (resolve === undefined) {
      return () => {
        cancelled = true;
      };
    }
    resolve(ref, props.sessionId)
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

  // 取到（或换掉、失败）后同步到组里，点开时同组的其它图才能一起进预览。
  const group = props.group;
  const groupIndex = props.groupIndex ?? 0;
  useEffect(() => {
    group?.register(groupIndex, localPath);
  }, [group, groupIndex, localPath]);
  useEffect(() => () => group?.register(groupIndex, undefined), [group, groupIndex]);

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
      onClick={openImage === undefined
        ? undefined
        : () => openImage(localPath, ref.name, group === undefined ? [localPath] : group.urls(localPath))}
    />
  );
}

/**
 * 连续图片排成一组，与 Web 的 `renderMessageImages` 同口径：
 * 一张铺开，多张缩成一行；用户气泡靠右（alignEnd），助手正文靠左。
 * 对齐 Android ImageGallery。
 */
export function ImageGallery(props: {
  refs: ImageAttachmentRef[];
  sessionId: string;
  resolveImage?: ResolveImage;
  onOpenImage?: OpenImage;
  alignEnd?: boolean;
}): JSX.Element | null {
  const group = useImageGroup();
  if (props.refs.length === 0) return null;
  const compact = props.refs.length > 1;
  return (
    <View className={props.alignEnd === true ? styles.gallery + ' ' + styles.galleryEnd : styles.gallery}>
      {props.refs.map((attachment, index) => (
        <AttachmentImage
          key={index}
          sessionId={props.sessionId}
          attachment={attachment}
          resolveImage={props.resolveImage}
          onOpenImage={props.onOpenImage}
          compact={compact}
          group={group}
          groupIndex={index}
        />
      ))}
    </View>
  );
}

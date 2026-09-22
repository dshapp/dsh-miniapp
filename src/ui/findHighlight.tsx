import React from 'react';
import { Text } from '@tarojs/components';
import styles from './findHighlight.module.scss';

/** 一段文本被查找词切开后的结果；hit 为 true 表示这一段正好命中了查询词。 */
export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/**
 * 把 text 按 query 切成命中/非命中片段。
 *
 * 与 Android 版 appendFindHighlighted 保持同一口径：query 先 trim、大小写不敏感、
 * 命中区间不重叠地一路往后找。query 为空时不返回空数组，而是退化成整段普通文本，
 * 这样调用方不用再分两种情况拼装。
 */
export function splitHighlight(text: string, query: string): HighlightSegment[] {
  const needle = query.trim();
  if (!needle) return [{ text, hit: false }];

  const segments: HighlightSegment[] = [];
  const haystack = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let start = 0;
  // 用 <= 而不是 <：当区间正好落在末尾时还要补最后一段尾巴。
  while (start <= text.length) {
    const index = haystack.indexOf(lowerNeedle, start);
    if (index < 0) {
      segments.push({ text: text.slice(start), hit: false });
      break;
    }
    if (index > start) segments.push({ text: text.slice(start, index), hit: false });
    segments.push({ text: text.slice(index, index + needle.length), hit: true });
    start = index + needle.length;
  }
  return segments;
}

/**
 * 带查找高亮的行内文本。
 *
 * 没有任何命中时直接渲染成一个普通 Text，避免多套一层无意义的嵌套节点；
 * 命中片段套 .hit，当前停靠的那一块再叠 .active。查询词为空字符串即视为不在查找态。
 */
export function HighlightedText(props: {
  text: string;
  query?: string;
  active?: boolean;
  className?: string;
}): JSX.Element {
  const { text, query = '', active = false, className } = props;
  const segments = splitHighlight(text, query);
  const hasHit = segments.some((segment) => segment.hit);
  if (!hasHit) {
    return <Text className={className}>{text}</Text>;
  }
  return (
    <Text className={className}>
      {segments.map((segment, index) =>
        segment.hit ? (
          <Text key={index} className={active ? styles.hit + ' ' + styles.active : styles.hit}>
            {segment.text}
          </Text>
        ) : (
          <Text key={index}>{segment.text}</Text>
        ),
      )}
    </Text>
  );
}

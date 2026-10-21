import React from 'react';
import { Image, Text, View } from '@tarojs/components';
import { color_bad, color_good, color_text, color_text_faint } from '../const';
import { Strings, fmt } from '../i18n/strings';
import type {
  ChangedFileDiff,
  ChangedFileEntry,
  TurnChangesAddress,
  TurnChangesSummary,
} from '../model/turnChanges';
import { changedFileHostPath } from '../model/turnChanges';
import { EmptyState } from './emptyState';
import { Icon } from './icon';
import { openCardDetail } from './cardDetail';
import styles from './changedFilesCard.module.scss';

/** 展开前显示的文件行数（对齐 web CHANGED_FILES_SHOWN 与 Android 的 shownLimit）。 */
const CHANGED_FILES_SHOWN = 3;

export interface ChangedFilesCardProps {
  /** 公告坐标；没有就说明这一轮没有改动，整张卡片不出现。 */
  address?: TurnChangesAddress;
  /** 读一轮的改动汇总；主机在记录随会话销毁后返回 undefined。 */
  loadSummary: (address: TurnChangesAddress) => Promise<TurnChangesSummary | undefined>;
  /** 读单个列出的文件的轮首/轮末比较。 */
  loadDiff: (address: TurnChangesAddress, index: number) => Promise<ChangedFileDiff | undefined>;
  /** 读回二进制文件当图片看（本地临时路径）；'missing' 表示主机明确说文件已不存在。 */
  loadImage?: (sessionId: string, path: string) => Promise<string | 'missing' | undefined>;
}

/**
 * 一轮改动文件卡片（web ui-deliverables 的 changed-files card，0.1.6）。
 *
 * 公告（`workspace/changes`）是持久的；汇总与逐文件比较要趁会话还活着去主机读，
 * 所以这里三步：公告给出地址 → 读汇总画列表 → 用户点某个文件才去读它的比较。
 * 与 Android ChangedFilesCard 同一口径：点文件行开详情弹层看比较（安卓是 AlertDialog，
 * 这里复用全局 CardDetailHost）。
 */
export function ChangedFilesCard(props: ChangedFilesCardProps): JSX.Element | null {
  const { address, loadSummary, loadDiff, loadImage } = props;
  const [summary, setSummary] = React.useState<TurnChangesSummary | undefined>(undefined);
  const [expanded, setExpanded] = React.useState(false);
  // 正在读比较的文件行：安卓在弹窗里转圈，这里先把行标出来，读完再开弹层。
  const [pendingPath, setPendingPath] = React.useState<string | undefined>(undefined);

  const seq = address?.seq;
  const sessionId = address?.sessionId;

  React.useEffect(() => {
    if (address === undefined) {
      setSummary(undefined);
      return undefined;
    }
    let cancelled = false;
    void loadSummary(address)
      .then(value => {
        if (!cancelled) setSummary(value);
      })
      .catch(() => {
        if (!cancelled) setSummary(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [loadSummary, sessionId, seq]);

  React.useEffect(() => {
    setExpanded(false);
    setPendingPath(undefined);
  }, [sessionId, seq]);

  if (address === undefined || summary === undefined || summary.files.length === 0) return null;

  const rows = expanded ? summary.files : summary.files.slice(0, CHANGED_FILES_SHOWN);

  const openDiff = (file: ChangedFileEntry, index: number): void => {
    if (pendingPath !== undefined) return;
    setPendingPath(file.path);
    // 二进制文件先（与比较并行）按路径读回字节当图片看：不等比较先回来，
    // 免得比较走了缓存或并发时图片永远不去取（对齐 Mac）。
    const image = file.binary && loadImage !== undefined
      ? loadImage(address.sessionId, changedFileHostPath(summary, file)).catch(() => undefined)
      : Promise.resolve(undefined);
    void Promise.all([loadDiff(address, index), image])
      .then(([value, imagePath]) => {
        const body = <DiffBody diff={value} />;
        openCardDetail({
          icon: 'file-text',
          title: file.display,
          content: imagePath === 'missing' ? (
            <EmptyState name='circle-help' title={Strings.changedFileMissingTitle} description={Strings.changedFileMissingBody} />
          ) : imagePath !== undefined ? (
            <ChangedFileImage src={imagePath} fallback={body} />
          ) : body,
        });
      })
      .catch(() => {
        openCardDetail({
          icon: 'file-text',
          title: file.display,
          content: <Text className={styles.note} style={{ color: color_bad }}>{Strings.changedFilesUnavailable}</Text>,
        });
      })
      .finally(() => setPendingPath(undefined));
  };

  return (
    <View className={styles.card}>
      <View className={styles.header}>
        <Icon name='folder-tree' className={styles.glyph} />
        <Text className={styles.title}>{fmt(Strings.changedFilesTitle, summary.total)}</Text>
        <Text className={styles.added} style={{ color: color_good }}>{'+' + summary.added}</Text>
        <Text className={styles.deleted} style={{ color: color_bad }}>{'−' + summary.deleted}</Text>
      </View>
      {rows.map(file => {
        const index = summary.files.indexOf(file);
        return (
          <View key={file.path}>
            <View className={styles.row} onClick={() => openDiff(file, index)}>
              <Text className={styles.path}>{file.display}</Text>
              {file.binary ? (
                <Text className={styles.note} style={{ color: color_text_faint }}>{Strings.changedFilesBinary}</Text>
              ) : file.oversized ? (
                <Text className={styles.note} style={{ color: color_text_faint }}>{Strings.changedFilesOversized}</Text>
              ) : (
                <React.Fragment>
                  {file.added > 0 ? <Text className={styles.count} style={{ color: color_good }}>{'+' + file.added}</Text> : null}
                  {file.deleted > 0 ? <Text className={styles.count} style={{ color: color_bad }}>{'−' + file.deleted}</Text> : null}
                </React.Fragment>
              )}
            </View>
            {pendingPath !== file.path ? null : (
              <Text className={styles.note} style={{ color: color_text_faint }}>{Strings.statusLoading}</Text>
            )}
          </View>
        );
      })}
      {summary.files.length > CHANGED_FILES_SHOWN ? (
        <View className={styles.more} onClick={() => setExpanded(value => !value)}>
          {/* 收起态朝下（点开展开更多）、展开态朝上（点了收起来）——对齐 Android 的
              ExpandMore / ExpandLess；用右尖括号会读成「进入下一级」，是另一种语义。 */}
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} className={styles.moreGlyph} />
          <Text className={styles.moreText} style={{ color: color_text_faint }}>
            {expanded
              ? Strings.changedFilesCollapse
              : fmt(Strings.changedFilesShowAll, summary.files.length - CHANGED_FILES_SHOWN)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * 二进制改动文件按图片显示：原生 Image + widthFix 等比缩放，宽度取图片本身宽度、
 * 不超过弹层宽度（小图不放大）；解不出图（不是图片）退回原来的「二进制」文案。
 */
function ChangedFileImage(props: { src: string; fallback: JSX.Element }): JSX.Element {
  const [width, setWidth] = React.useState<number | undefined>(undefined);
  const [failed, setFailed] = React.useState(false);
  if (failed) return props.fallback;
  return (
    <View className={styles.imageBox}>
      <Image
        className={styles.image}
        src={props.src}
        mode='widthFix'
        style={width === undefined ? { visibility: 'hidden' } : { width: width + 'px' }}
        onLoad={event => setWidth(Number(event.detail.width))}
        onError={() => setFailed(true)}
      />
    </View>
  );
}

/** 单个文件的比较正文：与 Android ChangedFileDiffDialog 的内容同一份渲染。 */
function DiffBody(props: { diff?: ChangedFileDiff }): JSX.Element {
  const { diff } = props;
  if (diff === undefined) {
    return <Text className={styles.note}>{Strings.changedFilesUnavailable}</Text>;
  }
  if (diff.kind === 'binary') return <Text className={styles.note}>{Strings.changedFilesBinary}</Text>;
  if (diff.kind === 'oversized') return <Text className={styles.note}>{Strings.changedFilesOversized}</Text>;
  return (
    <React.Fragment>
      {/* 超时读数用错误红，与 Android coarse 的 colorScheme.error 一致。 */}
      {diff.coarse ? <Text className={styles.note} style={{ color: color_bad }}>{Strings.changedFilesCoarse}</Text> : null}
      {diff.hunks.length === 0 ? <Text className={styles.note}>{Strings.changedFilesNoLines}</Text> : null}
      {diff.hunks.map((hunk, hunkIndex) => (
        <View key={hunkIndex} className={styles.hunk}>
          <Text className={styles.hunkHeader} style={{ color: color_text_faint }}>
            {'@@ -' + hunk.oldStart + ',' + hunk.oldLines + ' +' + hunk.newStart + ',' + hunk.newLines + ' @@'}
          </Text>
          {hunk.lines.map((line, lineIndex) => (
            <Text
              key={lineIndex}
              className={styles.line}
              style={{
                color: line.startsWith('+') ? color_good : line.startsWith('-') ? color_bad : color_text,
              }}
            >
              {line.length === 0 ? ' ' : line}
            </Text>
          ))}
        </View>
      ))}
    </React.Fragment>
  );
}

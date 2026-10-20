import React, { useState } from 'react';
import { Text, View } from '@tarojs/components';
import { color_bad, color_good, color_text_sub, color_warning } from '../const';
import { Strings } from '../i18n/strings';
import { arr, int, isArray, isObject, jget, jsonScalarText, prettyJson, str } from '../model/json';
import type { JsonValue } from '../model/json';
import { toolResultText } from '../model/chatNode';
import type { ToolChatData, ToolResultData } from '../model/chatNode';
import { imageReferences, lenientImageRefs, readImageCard, type ImageCard } from '../model/imageCards';
import { openCardDetail } from './cardDetail';
import { toolRowModel } from '../model/toolRow';
import { AttachmentImage } from './attachmentImage';
import type { ToolRowState, ToolRowVariant } from '../model/toolRow';
import { HighlightedText } from './findHighlight';
import { Icon, type LucideIconName } from './icon';
import { useBreathe, withBreathe } from './breathe';
import { MonospaceText } from './markdown';
import styles from './cards.module.scss';

/**
 * 转写卡片：Android 版 ui/component/Cards.kt 的小程序移植。
 *
 * 这里刻意不认识 appModel / store，只吃宿主传进来的数据；弹层也换成了"就地展开"，
 * 因为小程序没有 Android 的 Dialog，就地展开在滚动容器里反而更稳。
 */

// 列表类渲染的上限，防止一份超大工具结果把 setData 撑爆 —— 与 Android 的 take(200/400) 同口径。
const JSON_CHILD_LIMIT = 200;
const READ_LINE_LIMIT = 400;
const DIFF_LINE_LIMIT = 400;

/** 状态色：与 Android 的 tint 分派一致 —— 失败的 run_code 用警示橙而非错误红。 */
function stateTintClass(state: ToolRowState, variant: ToolRowVariant): string {
  if (state === 'error') return variant === 'code' ? styles.tintWarning : styles.tintBad;
  if (state === 'stopped') return styles.tintWarning;
  // 正常态与 running 一样走 text-sub：转写里的卡片行（思考、工具、代码执行、上下文）
  // 是过程信息，统一成思考卡片那一档灰；只有出错/被停这类状态才提色。
  return styles.tintSubtle;
}

/** 工具变体对应的 Lucide 图标名。 */
export function toolVariantIcon(variant: ToolRowVariant): LucideIconName {
  switch (variant) {
    case 'bash':
      return 'terminal';
    case 'read':
      return 'file-text';
    case 'search':
      return 'search';
    case 'write':
      return 'file-pen';
    // edit / code 取「铅笔」「尖括号」而不是剪刀 / 拼图：与 Android 的 Edit / Code
    // 同义，剪刀读作「剪切」、拼图读作「插件」，都是另一回事。
    case 'edit':
      return 'pencil';
    case 'code':
      return 'code';
    case 'others':
      return 'wrench';
  }
}

/** 等宽文本块。真正的等宽排版交给 Markdown 模块的 MonospaceText，这里只补块级外壳。 */
export function MonospaceBlock(props: { text: string; className?: string }): JSX.Element {
  const className = props.className === undefined ? styles.monoBlock : styles.monoBlock + ' ' + props.className;
  return (
    <View className={className}>
      <MonospaceText text={props.text} className={styles.monoText} />
    </View>
  );
}

/** 详情里的一段：小标题 + 卡面正文。 */
export function DetailSection(props: { title: string; children?: React.ReactNode }): JSX.Element {
  return (
    <View className={styles.section}>
      <Text className={styles.sectionTitle}>{props.title}</Text>
      <View className={styles.sectionBody}>{props.children}</View>
    </View>
  );
}

/**
 * 最新一段的第一行，且这一行已经写完（后面出现了换行）；还没有就是 undefined
 * （web ReasoningRow `latestCompletedParagraphFirstLine`）。段落以空白行分隔。
 */
function latestParagraphLead(text: string): string | undefined {
  let lead: string | undefined;
  let paragraphStart = true;
  const lines = text.split('\n');
  // 最后一段是正在写的行，只看写完的行。
  for (const line of lines.slice(0, -1)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) paragraphStart = true;
    else if (paragraphStart) {
      lead = trimmed;
      paragraphStart = false;
    }
  }
  return lead;
}

/**
 * 思考卡片：行上只露一行摘要，点开是全屏详情（对齐 Android ThinkCard + CardDetailDialog）。
 * 摘要口径对齐 web ReasoningRow：结束后是第一行；思考中跟着进度走到最新一段的第一行，
 * 放不下时不打省略号，而是裁掉并在右侧渐隐，表示还在写。
 *
 * 详情正文是纯文本而不是 Markdown：reasoning 是模型的草稿，里面的 #、*、``` 往往是随手
 * 写的符号，按 Markdown 解析会改变原意（Android 这里用的也是 SelectionText）。
 */
export function ThinkCard(props: {
  text: string;
  findQuery?: string;
  findActive?: boolean;
  /** 仍在流式输出（所在 step 运行中、且这段 reasoning 是它的最后一个 block）：整行呼吸。 */
  running?: boolean;
}): JSX.Element {
  const { text, findQuery = '', findActive = false } = props;
  const running = props.running === true;
  const firstLine = text.trimStart().split('\n')[0].trim();
  const line = ((running ? latestParagraphLead(text) : undefined) ?? firstLine).split('**').join('');
  const summary = line.length > 0 ? line : Strings.thinking;
  const breathe = useBreathe(running);
  return (
    <View className={styles.card}>
      <View
        className={withBreathe(styles.row, breathe)}
        style={breathe.style}
        onClick={() =>
          openCardDetail({
            icon: 'brain',
            title: Strings.thinking,
            copyText: text,
            content: (
              <Text className={styles.detailText} selectable userSelect>
                {text}
              </Text>
            ),
          })
        }
      >
        <Icon name='brain' className={styles.rowGlyph + ' ' + styles.tintSubtle} />
        <HighlightedText
          className={styles.rowTitle + ' ' + styles.tintSubtle + (running ? ' ' + styles.rowTitleStreaming : '')}
          text={summary}
          query={findQuery}
          active={findActive}
        />
      </View>
    </View>
  );
}

/** 子调用最多缩进到第 8 层（对齐 Android Cards.kt 的 depth < 8）。 */
const MAX_TOOL_DEPTH = 8;

/** 工具调用卡片：一行标题 + 状态点，点开看参数、图片与结果；子调用递归缩进挂在下面。 */
export function ToolCard(props: {
  data: ToolChatData;
  cwd?: string;
  findQuery?: string;
  findActive?: boolean;
  sessionId?: string;
  resolveImage?: (attachmentId: string, sessionId: string) => Promise<string | undefined>;
  onOpenImage?: (localPath: string, name?: string) => void;
  /** 子调用递归深度；根调用是 0。 */
  depth?: number;
}): JSX.Element {
  const { data, cwd, findQuery = '', findActive = false } = props;
  const sessionId = props.sessionId ?? '';
  const depth = props.depth ?? 0;
  const imageCard = readImageCard(data);
  const model = toolRowModel(data, cwd);
  const rawTitle = model.errorSummary ?? model.summary;
  const title = rawTitle.length > 0 ? rawTitle : data.name;
  const tint = stateTintClass(model.state, model.variant);
  // 运行中或参数仍在生成的调用整行呼吸（图标仍是这个工具自己的图标，不另放转圈）。
  const breathe = useBreathe(model.state === 'running' || model.state === 'preparing');
  // 详情弹层需要的两种文本：折叠出标题，拼出可复制的正文。
  const detailTitle = model.summary.split('\n')[0].trim() || data.name;
  const parts: string[] = [];
  if (data.argsRaw.length > 0) parts.push(prettyJson(data.argsRaw));
  if (data.result !== undefined) parts.push(toolResultText(data.result));
  const copyText = parts.join('\n\n');
  const openDetail = (): void =>
    openCardDetail({
      icon: toolVariantIcon(model.variant),
      title: detailTitle,
      copyText,
      content: (
        <View>
          {data.argsRaw.length > 0 ? (
            <DetailSection title={Strings.toolInput}>
              <MonospaceBlock text={prettyJson(data.argsRaw)} />
            </DetailSection>
          ) : null}
          {data.result === undefined ? null : (
            <DetailSection title={Strings.toolOutput}>
              <ToolResultView
                result={data.result}
                sessionId={sessionId}
                resolveImage={props.resolveImage}
                onOpenImage={props.onOpenImage}
              />
            </DetailSection>
          )}
          {/* 展开态里逐层列出子调用（对齐 Android Cards.kt detail 分支的 subCalls）。 */}
          {depth >= MAX_TOOL_DEPTH
            ? null
            : data.subCalls.map(child => (
                <DetailSection key={child.callId} title={child.name}>
                  {child.argsRaw.length > 0 ? <MonospaceBlock text={prettyJson(child.argsRaw)} /> : null}
                  {child.result === undefined ? null : (
                    <ToolResultView
                      result={child.result}
                      sessionId={sessionId}
                      resolveImage={props.resolveImage}
                      onOpenImage={props.onOpenImage}
                    />
                  )}
                </DetailSection>
              ))}
        </View>
      ),
    });

  return (
    <View className={styles.card}>
      {/* 准备中的行还没有参数与结果可看：只露摘要，不给详情（对齐 Android ToolCard）。 */}
      {/* 执行态 = 整行（图标 + 摘要 + 附注）呼吸：呼吸挂在行上，行本身不画背景，
          动的只是内容的透明度；中途才出现的附注也跟着同一相位。 */}
      <View
        className={withBreathe(styles.row, breathe)}
        style={breathe.style}
        onClick={data.preparing === true ? undefined : openDetail}
      >
        <Icon name={toolVariantIcon(model.variant)} className={styles.rowGlyph + ' ' + tint} />
        <HighlightedText className={styles.rowTitle + ' ' + tint} text={title} query={findQuery} active={findActive} />
        {model.summarySuffix === undefined ? null : (
          <Text className={styles.rowSuffix}>{model.summarySuffix}</Text>
        )}
        {/* 行尾不再另画一枚状态图标：安卓只把状态体现在行首变体图标上（running 时
            行首转圈），行尾多一枚会与行首重复（对齐 Cards.kt:406-421 与 :70-78）。 */}
      </View>
      {imageCard !== undefined && sessionId.length > 0 ? (
        <ToolImageCard card={imageCard} sessionId={sessionId} resolveImage={props.resolveImage} onOpenImage={props.onOpenImage} />
      ) : null}
      {/* 子调用树：run_code 里派发的嵌套调用（子智能体调度等）只有在这里才看得见。 */}
      {depth >= MAX_TOOL_DEPTH
        ? null
        : data.subCalls.map(child => (
            <View key={child.callId} className={styles.subCall}>
              <ToolCard
                data={child}
                cwd={cwd}
                findQuery={findQuery}
                findActive={findActive}
                sessionId={sessionId}
                resolveImage={props.resolveImage}
                onOpenImage={props.onOpenImage}
                depth={depth + 1}
              />
            </View>
          ))}
    </View>
  );
}

/** read_image 的卡身：路径标签 + 持久化图片（对齐 Android ToolImageCard）。 */
function ToolImageCard(props: {
  card: ImageCard;
  sessionId: string;
  resolveImage?: (attachmentId: string, sessionId: string) => Promise<string | undefined>;
  onOpenImage?: (localPath: string, name?: string) => void;
}): JSX.Element {
  return (
    <View className={styles.toolImageCard}>
      <Text className={styles.toolImagePath}>{props.card.path}</Text>
      {props.card.images.map(ref => (
        <AttachmentImage
          key={ref.attachmentId}
          sessionId={props.sessionId}
          attachment={{ attachmentId: ref.attachmentId, name: ref.name } as unknown as JsonValue}
          resolveImage={props.resolveImage}
          onOpenImage={props.onOpenImage}
        />
      ))}
    </View>
  );
}

/** 把 resultView.diffs 摊成可逐行着色的文本，口径与 Android 的 diffText 一致。 */
function diffText(value: JsonValue): string {
  const direct = str(value);
  if (direct !== undefined) return direct;
  const items = arr(value);
  if (items !== undefined) {
    return items
      .map((item) => str(item) ?? str(jget(item, 'patch')) ?? str(jget(item, 'text')) ?? '')
      .filter((line) => line.length > 0)
      .join('\n');
  }
  return jsonScalarText(value);
}

/** 大纲里 + 行等宽显示且逐行着色。 */
function diffLineClass(line: string): string {
  if (line.startsWith('+')) return styles.diffAdd;
  if (line.startsWith('-')) return styles.diffDel;
  if (line.startsWith('@@')) return styles.diffHunk;
  return styles.diffPlain;
}

function DiffBlock(props: { result: ToolResultData }): JSX.Element {
  const diffs = jget(props.result.resultView, 'diffs');
  const text = diffs === undefined ? toolResultText(props.result) : diffText(diffs);
  const lines = text.split('\n').slice(0, DIFF_LINE_LIMIT);
  return (
    <View className={styles.diffBlock}>
      {lines.map((line, index) => (
        <Text key={index} className={styles.diffLine + ' ' + diffLineClass(line)} selectable userSelect>
          {line.length === 0 ? ' ' : line}
        </Text>
      ))}
    </View>
  );
}

/** 工具结果：先看图片，再按 resultView.card 分派。 */
export function ToolResultView(props: {
  result: ToolResultData;
  sessionId?: string;
  resolveImage?: (attachmentId: string, sessionId: string) => Promise<string | undefined>;
  onOpenImage?: (localPath: string, name?: string) => void;
}): JSX.Element {
  const { result } = props;
  const card = str(jget(result.resultView, 'card'));
  if (result.isError) {
    return <MonospaceBlock text={toolResultText(result)} className={styles.errorBlock} />;
  }
  // 图片结果优先：read_image 与任何带 image 块的结果都不能退化成 JSON 树。
  const sessionId = props.sessionId ?? '';
  if (sessionId.length > 0) {
    const refs = imageReferences(result.content) ?? lenientImageRefs(result.content);
    if (refs.length > 0) {
      return (
        <View className={styles.resultColumn}>
          {refs.map(ref => (
            <AttachmentImage
              key={ref.attachmentId}
              sessionId={sessionId}
              attachment={{ attachmentId: ref.attachmentId, name: ref.name } as unknown as JsonValue}
              resolveImage={props.resolveImage}
              onOpenImage={props.onOpenImage}
            />
          ))}
          {result.content.some(block => block.kind === 'text') ? (
            <MonospaceBlock text={toolResultText(result)} />
          ) : null}
        </View>
      );
    }
  }
  if (card === 'terminal') {
    const exit = int(jget(result.resultView, 'exitCode'));
    const signal = str(jget(result.resultView, 'signal'));
    const output = str(jget(result.resultView, 'output')) ?? toolResultText(result);
    return (
      <View className={styles.resultColumn}>
        {exit === undefined && signal === undefined ? null : (
          <View className={styles.resultMeta}>
            {exit === undefined ? null : (
              <View className={styles.exitChip + ' ' + (exit === 0 ? styles.exitOk : styles.exitBad)}>
                <Icon name={exit === 0 ? 'check' : 'x'} />
                <Text>{' ' + exit}</Text>
              </View>
            )}
            {signal === undefined ? null : <Text className={styles.signalText}>{signal}</Text>}
          </View>
        )}
        <MonospaceBlock text={output} />
      </View>
    );
  }
  if (card === 'read') {
    const lines = arr(jget(result.resultView, 'lines'));
    if (lines !== undefined && lines.length > 0) {
      return (
        <View className={styles.resultColumn}>
          {lines.slice(0, READ_LINE_LIMIT).map((line, index) => (
            <View className={styles.readLine} key={index}>
              <Text className={styles.readNumber}>{jsonScalarText(jget(line, 'number'))}</Text>
              <MonospaceText text={str(jget(line, 'text')) ?? ''} className={styles.readText} />
            </View>
          ))}
        </View>
      );
    }
    return <MonospaceBlock text={toolResultText(result)} />;
  }
  if (card === 'search' || card === 'web') {
    return <MonospaceBlock text={toolResultText(result)} />;
  }
  if (card === 'diff') {
    return <DiffBlock result={result} />;
  }
  // 图片与未知形态都兜底成 JSON 树，宁可难看也别丢信息。
  return <JsonTree value={result.resultView ?? toolResultText(result)} />;
}

export type NoticeTone = 'info' | 'warning' | 'error' | 'success';

/** 通知行的色调：直接取 const.ts 的语义色，与 Android 的 tint 参数同义。 */
function noticeColor(tone: NoticeTone): string {
  switch (tone) {
    case 'info':
      return color_text_sub;
    case 'warning':
      return color_warning;
    case 'error':
      return color_bad;
    case 'success':
      return color_good;
  }
}

function noticeIcon(tone: NoticeTone): LucideIconName {
  switch (tone) {
    case 'info':
      return 'info';
    case 'warning':
      return 'triangle-alert';
    case 'error':
      return 'x';
    case 'success':
      return 'check';
  }
}

/**
 * 转写里的系统提示行（错误、压缩、命令等）。
 *
 * `icon` 由调用方按节点类型给（对齐 Android：MessageRow 的 when 分支为每种通知行各传一个
 * 图标）。只按 tone 取图标的话，压缩与 `/命令` 会共用一个 info、模型重试与长度上限
 * 共用一个警告三角——五种不同的事在转写里长成同一张脸。
 */
export function NoticeRow(props: {
  tone: NoticeTone;
  text: string;
  detailed?: boolean;
  icon?: LucideIconName;
}): JSX.Element {
  const { tone, text, detailed = false, icon = noticeIcon(tone) } = props;
  // 失败轮次的通知行可点开全文并复制（对齐 Android NoticeRow 的 detailed = true）。
  const onClick = detailed
    ? () =>
        openCardDetail({
          icon,
          title: text,
          copyText: text,
          content: (
            <Text className={styles.detailText} selectable userSelect>
              {text}
            </Text>
          ),
        })
    : undefined;
  return (
    <View className={styles.noticeRow} onClick={onClick}>
      <Icon name={icon} className={styles.noticeGlyph} style={{ color: noticeColor(tone) }} />
      <Text className={styles.noticeText}>{text}</Text>
    </View>
  );
}

/** 标量按类型分色，键名走次级灰，一眼能分清结构。 */
function scalarClass(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return styles.jsonNull;
  if (typeof value === 'string') return styles.jsonString;
  if (typeof value === 'number') return styles.jsonNumber;
  if (typeof value === 'boolean') return styles.jsonBool;
  return styles.jsonScalar;
}

/** 对象/数组的折叠头；只有根节点（depth=0）默认展开，其余逐层点开。 */
function JsonContainer(props: {
  label: string;
  keyName?: string;
  entries: ReadonlyArray<readonly [string, JsonValue]>;
  depth: number;
}): JSX.Element {
  const { label, keyName, entries, depth } = props;
  const [expanded, setExpanded] = useState(depth === 0);
  return (
    <View className={styles.jsonContainer}>
      <View className={styles.jsonToggle} onClick={() => setExpanded((value) => !value)}>
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} className={styles.jsonCaret} />
        <Text className={styles.jsonKey}>{(keyName === undefined ? '' : keyName + ' ') + label}</Text>
      </View>
      {expanded ? (
        <View className={styles.jsonChildren}>
          {entries.slice(0, JSON_CHILD_LIMIT).map(([childKey, child]) => (
            <JsonTree key={childKey} value={child} keyName={childKey} depth={depth + 1} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** 结构化 JSON 树，可逐层展开；键名与标量分色。 */
export function JsonTree(props: { value?: JsonValue; keyName?: string; depth?: number }): JSX.Element {
  const { value, keyName, depth = 0 } = props;
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > 0) {
      const entries: Array<readonly [string, JsonValue]> = keys
        .slice()
        .sort()
        .map((key) => [key, value[key]] as const);
      return <JsonContainer label={'{' + entries.length + '}'} keyName={keyName} entries={entries} depth={depth} />;
    }
  }
  if (isArray(value) && value.length > 0) {
    const entries: Array<readonly [string, JsonValue]> = value.map((child, index) => [String(index), child] as const);
    return <JsonContainer label={'[' + entries.length + ']'} keyName={keyName} entries={entries} depth={depth} />;
  }
  return (
    <View className={styles.jsonScalarRow}>
      {keyName === undefined ? null : <Text className={styles.jsonKey}>{keyName + ':'}</Text>}
      <Text className={styles.jsonScalar + ' ' + scalarClass(value)} selectable userSelect>
        {jsonScalarText(value)}
      </Text>
    </View>
  );
}

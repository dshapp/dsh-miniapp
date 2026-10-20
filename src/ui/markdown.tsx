import React, { useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Image, ScrollView, Text, View } from '@tarojs/components';
import type { Token, Tokens } from 'marked';
import {
  color_border,
  color_card_surface,
  color_outline,
  color_primary,
  color_text,
  color_text_faint,
  color_text_sub,
} from '../const';
import { Strings } from '../i18n/strings';
import { HighlightedText } from './findHighlight';
import { Icon } from './icon';
import { fileLinkBasename, parseFileLink, parseInlineCodeFileLink, type FileLinkTarget } from '../model/fileLink';
import { resolveMention } from '../model/format';
import { decodeEntities } from '../model/markdownText';
import { findTransformAutolinks, isSafeExternalUrl } from '../model/gfmAutolink';
import { lex, type AutolinkToken } from '../model/markdownLexer';
import { isImageDestination } from '../model/imageFileType';
import styles from './markdown.module.scss';

/** 递归渲染时一路携带的上下文：查找高亮口径 + 是否紧凑排版 + 文件链接回调。 */
interface RenderContext {
  findQuery: string;
  findActive: boolean;
  /** 紧凑排版：卡片内嵌、列表项、引用块里用，行高与块间距都收一档。 */
  compact: boolean;
  /** 文件链接（Markdown 链接与行内路径）的落点；缺省时退回复制地址。 */
  onOpenFileLink?: (target: FileLinkTarget) => void;
  /** 本轮产物的提及词表：行内代码命中词表就地变成可点的文件提及。 */
  mentions: string[];
  /** 词表命中的提及落点（路径原样回传，不是 FileLinkTarget）。 */
  onOpenFile?: (path: string) => void;
}

/** 行内代码底色；和 Android 一样靠窄空格在字形两侧垫出「内边距」。 */
const INLINE_CODE_STYLE: React.CSSProperties = { backgroundColor: color_card_surface, color: color_text };

/** 指向文件的行内代码换成链接色（对齐 Android 的 codeStyle.color = linkColor）。 */
const INLINE_CODE_LINK_STYLE: React.CSSProperties = { backgroundColor: color_card_surface, color: color_primary };

/** 能直接交给 Image / previewImage 的远程地址；其余都当工作区路径处理。 */
const REMOTE_IMAGE = /^https?:\/\//i;

/** 把 HTML 标签剥干净只留可读文本；<br> 换算成换行，其他标签直接删。 */
function stripHtml(raw: string): string {
  return raw.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
}

/** 有序/无序列表的层级符号，按深度在三种字形间轮换（对齐 Android 的 bulletGlyph）。 */
function bulletGlyph(depth: number): string {
  const mod = depth % 3;
  if (mod === 0) return '•';
  if (mod === 1) return '◦';
  return '▪';
}

/** 表格列宽估算：中日韩与全角按两格算，再沿用 Android 的 7.6px/字经验值钳到 48~200。 */
function visualWidth(text: string): number {
  let width = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    const wide =
      (code >= 0x2e80 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xff60);
    width += wide ? 2 : 1;
  }
  return width;
}

function columnWidth(table: Tokens.Table, index: number): number {
  let longest = 0;
  const rows: Tokens.TableCell[][] = [table.header, ...table.rows];
  rows.forEach((row) => {
    const cell = row[index];
    if (cell) longest = Math.max(longest, visualWidth(cell.text));
  });
  return Math.min(200, Math.max(48, Math.min(longest, 26) * 7.6 + 20));
}

/** marked 的 align 允许 null，落到具体样式时统一收紧成三值。 */
function cellAlign(align: 'center' | 'left' | 'right' | null | undefined): 'left' | 'center' | 'right' {
  if (align === 'center') return 'center';
  if (align === 'right') return 'right';
  return 'left';
}

/** 标题色：5/6 级降一档，避免和正文抢视线。 */
function headingStyle(level: number): React.CSSProperties {
  return { color: level >= 5 ? color_text_sub : color_text };
}

/*
 * 块间留白按「下一块是什么」来定，标题前留得多、段内元素留得少，
 * 这样标题能领起下一段，正文之间又不至于散开。数值对齐 Android 的 gapBefore。
 */
function gapBefore(previous: Token, token: Token, compact: boolean): number {
  let base: number;
  switch (token.type) {
    case 'heading': {
      const level = (token as Tokens.Heading).depth;
      base = previous.type === 'heading' ? 10 : level <= 2 ? 18 : 15;
      break;
    }
    case 'hr':
      base = 14;
      break;
    case 'code':
    case 'table':
    case 'blockquote':
      base = 10;
      break;
    case 'list':
      base = previous.type === 'heading' ? 6 : 8;
      break;
    case 'paragraph':
      base = previous.type === 'heading' ? 6 : 10;
      break;
    default:
      base = 8;
      break;
  }
  return compact ? Math.max(4, Math.round(base * 0.55)) : base;
}

/** 复制到剪贴板；微信端 setClipboardData 自带 toast，其他端补一个。 */
async function copyToClipboard(data: string): Promise<void> {
  try {
    await Taro.setClipboardData({ data });
    if (process.env.TARO_ENV !== 'weapp') void Taro.showToast({ title: Strings.copied, icon: 'none' });
  } catch {
    void Taro.showToast({ title: Strings.copyFailed, icon: 'none' });
  }
}

/**
 * 外部链接的落点。
 *
 * Android 把 http/https/mailto 交给系统浏览器（ACTION_VIEW）。小程序不允许跳转任意
 * 外链——只有备案并配进业务域名的地址才能用 web-view 打开——所以这里取平台限制下最接近
 * 的做法：把完整地址摊在弹窗里给人看，确认即复制。静默复制会让人以为点击没生效。
 */
async function showExternalLink(href: string): Promise<void> {
  try {
    const result = await Taro.showModal({ content: href, confirmText: Strings.copy, cancelText: Strings.cancel });
    if (result.confirm) await copyToClipboard(href);
  } catch {
    // 同时只允许一个原生弹窗；弹不出来时退回直接复制，地址至少还在剪贴板里。
    await copyToClipboard(href);
  }
}

/**
 * 图片目的地的落点：远程地址直接进系统预览，工作区路径交给宿主读回本机再打开图片查看器。
 * 判定顺序与 Android 的 Image 分支一致：只有真的是图片文件才给点击，其余不猜、不乱点。
 */
function imageAction(href: string, ctx: RenderContext): (() => void) | undefined {
  const address = href.trim();
  if (address.length === 0) return undefined;
  if (REMOTE_IMAGE.test(address)) {
    return () => {
      void Taro.previewImage({ urls: [address], current: address });
    };
  }
  const target = parseFileLink(address);
  const open = ctx.onOpenFileLink;
  // 无扩展名也算（附件对象没有扩展名，见 isImageDestination）；打开时带上 image 标记。
  if (target === undefined || open === undefined || !isImageDestination(target.path)) return undefined;
  return () => open({ ...target, image: true });
}

/**
 * GFM Markdown 渲染：marked 解析成 token，再用 Taro 组件树递归渲染。
 *
 * 小程序没有 dangerouslySetInnerHTML（HTML 字符串塞进 rich-text 会丢掉组件能力、
 * 也拿不到点击回调），所以整棵树都走 View/Text，才能让查找高亮、复制、点链接这些交互落地。
 */
export interface MarkdownViewProps {
  text: string;
  /** 查找高亮用的关键词 */
  findQuery?: string;
  /** 是否当前命中项 */
  findActive?: boolean;
  /** 紧凑排版（卡片内嵌时用） */
  compact?: boolean;
  /** 文件链接落点（对齐 Android：链接与行内路径都读回本机，不交给系统浏览器）。 */
  onOpenFileLink?: (target: FileLinkTarget) => void;
  /** 本轮产物的提及词表（Android MessageRow 传给 MarkdownText 的 fileMentions）。 */
  fileMentions?: string[];
  /** 词表命中的提及点击落点。 */
  onOpenFile?: (path: string) => void;
}

export function MarkdownView(props: MarkdownViewProps): JSX.Element {
  const { text, findQuery = '', findActive = false, compact = false, onOpenFileLink, onOpenFile } = props;
  const tokens = lex(text);
  const ctx: RenderContext = {
    findQuery,
    findActive,
    compact,
    onOpenFileLink,
    mentions: props.fileMentions ?? [],
    onOpenFile,
  };
  return (
    <View
      className={compact ? styles.root + ' ' + styles.rootCompact : styles.root}
      style={{ color: color_text }}
    >
      <BlockList tokens={tokens} ctx={ctx} depth={0} />
    </View>
  );
}

/** 保留换行的等宽纯文本块（diff / 日志用）。 */
export function MonospaceText(props: { text: string; className?: string }): JSX.Element {
  const { text, className } = props;
  return (
    // 横向可滚：卡片详情里的等宽正文（diff / 日志 / 工具结果）不折行，与 Android 一致
    // （对齐 Cards.kt:353-366 的横向滚动；.monoText 自身 white-space: pre）。
    <ScrollView scrollX className={className ? styles.monoWrap + ' ' + className : styles.monoWrap}>
      {/* 详情弹层里的等宽正文要能长按选中复制（对齐 Android 的 SelectionText）。 */}
      <Text className={styles.monoText} style={{ color: color_text }} selectable userSelect>
        {text}
      </Text>
    </ScrollView>
  );
}

/** 顺序渲染一组块级 token；每个块外面套一层只负责块间距的壳。 */
function BlockList(props: { tokens: Token[]; ctx: RenderContext; depth: number }): JSX.Element {
  const { tokens, ctx, depth } = props;
  const nodes: JSX.Element[] = [];
  let previous: Token | null = null;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const gap = previous ? gapBefore(previous, token, ctx.compact) : 0;
    previous = token;
    const block = renderBlock(token, ctx, depth);
    if (!block) continue;
    nodes.push(
      <View key={index} style={{ marginTop: gap > 0 ? gap + 'px' : undefined }}>
        {block}
      </View>,
    );
  }
  return <>{nodes}</>;
}

function renderBlock(token: Token, ctx: RenderContext, depth: number): JSX.Element | null {
  switch (token.type) {
    case 'heading': {
      const heading = token as Tokens.Heading;
      const level = Math.min(6, Math.max(1, heading.depth));
      return (
        <InlineFlow
          tokens={heading.tokens}
          ctx={ctx}
          className={styles['heading' + level]}
          style={headingStyle(level)}
        />
      );
    }
    case 'paragraph': {
      const paragraph = token as Tokens.Paragraph;
      return <InlineFlow tokens={paragraph.tokens} ctx={ctx} className={styles.paragraph} />;
    }
    case 'code': {
      const code = token as Tokens.Code;
      // 去掉结尾换行，否则代码块底部总多一行空白。
      return <CodeBlock code={code.text.replace(/\n$/, '')} lang={code.lang} />;
    }
    case 'blockquote': {
      const quote = token as Tokens.Blockquote;
      return (
        <View className={styles.quote}>
          <View className={styles.quoteBar} style={{ backgroundColor: color_primary }} />
          {/* 引用正文降一档色，明显退到主文后面。 */}
          <View className={styles.quoteBody} style={{ color: color_text_sub }}>
            <BlockList tokens={quote.tokens} ctx={{ ...ctx, compact: true }} depth={depth} />
          </View>
        </View>
      );
    }
    case 'list':
      return <ListBlock token={token as Tokens.List} ctx={ctx} depth={depth} />;
    case 'table':
      return <TableView token={token as Tokens.Table} ctx={ctx} />;
    case 'hr':
      return <View className={styles.hr} style={{ backgroundColor: color_outline, opacity: 0.7 }} />;
    case 'html': {
      const html = token as Tokens.HTML;
      const stripped = stripHtml(html.text);
      if (!stripped) return null;
      return (
        <Text className={styles.paragraph} style={{ color: color_text_sub }} selectable userSelect>
          <HighlightedText text={stripped} query={ctx.findQuery} active={ctx.findActive} />
        </Text>
      );
    }
    case 'text': {
      // 紧列表的项本身就是 text token，不是 paragraph。
      const textToken = token as Tokens.Text;
      if (textToken.tokens && textToken.tokens.length > 0) {
        return <InlineFlow tokens={textToken.tokens} ctx={ctx} className={styles.paragraph} />;
      }
      return (
        <Text className={styles.paragraph} selectable userSelect>
          <AutolinkedText text={decodeEntities(textToken.raw)} ctx={ctx} />
        </Text>
      );
    }
    default:
      // space 等没有可渲染内容的块直接跳过。
      return null;
  }
}

/** 代码块：语言标签 + 复制按钮的顶栏，正文横向滚动，长行不折行。 */
function CodeBlock(props: { code: string; lang?: string }): JSX.Element {
  const { code, lang } = props;
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 卸载时清掉「已复制」的回退定时器，避免对已卸载组件 setState。
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const onCopy = async () => {
    try {
      await Taro.setClipboardData({ data: code });
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      void Taro.showToast({ title: Strings.copyFailed, icon: 'none' });
    }
  };
  const language = (lang || '').trim().split(/\s+/)[0].toLowerCase();
  return (
    <View className={styles.codeCard} style={{ backgroundColor: color_card_surface, borderColor: color_border }}>
      <View className={styles.codeHeader} style={{ borderBottomColor: color_border }}>
        <Text className={styles.codeLang} style={{ color: color_text_faint }}>
          {language}
        </Text>
        <View className={styles.codeCopy} onClick={onCopy} aria-label={Strings.copy}>
          <Icon
            name={copied ? 'check' : 'copy'}
            className={styles.codeCopyGlyph}
            style={{ color: copied ? color_primary : color_text_sub }}
          />
        </View>
      </View>
      <ScrollView scrollX className={styles.codeScroll}>
        <Text className={styles.codeText} style={{ color: color_text }} selectable userSelect>
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}

/** 列表：标记占固定槽位，序号右对齐，任务项画勾选框，层级换符号。 */
function ListBlock(props: { token: Tokens.List; ctx: RenderContext; depth: number }): JSX.Element {
  const { token, ctx, depth } = props;
  const start = typeof token.start === 'number' ? token.start : 1;
  return (
    <View className={styles.list}>
      {token.items.map((item, index) => (
        <View key={index} className={styles.listItem}>
          {item.task ? (
            <Icon
              name={item.checked ? 'circle-check' : 'circle'}
              className={styles.markerTask}
              style={{ color: item.checked ? color_primary : color_text_faint }}
            />
          ) : (
            <Text className={styles.marker} style={{ color: color_text_sub }}>
              {token.ordered ? start + index + '.' : bulletGlyph(depth)}
            </Text>
          )}
          <View className={styles.listBody}>
            <BlockList tokens={item.tokens} ctx={{ ...ctx, compact: true }} depth={depth + 1} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** 表格：横向可滚动，表头加粗带底色，列宽按内容估。 */
function TableView(props: { token: Tokens.Table; ctx: RenderContext }): JSX.Element {
  const { token, ctx } = props;
  const columns = Math.max(token.header.length, ...token.rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, index) => columnWidth(token, index));
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  return (
    <ScrollView scrollX className={styles.tableScroll}>
      <View className={styles.table} style={{ width: totalWidth + 'px', borderColor: color_border }}>
        <View className={styles.tableRow + ' ' + styles.tableRowHeader}>
          {renderTableRow(token.header, token.align, widths, true, ctx)}
        </View>
        {token.rows.map((row, index) => (
          <View
            key={index}
            className={styles.tableRow}
            // 只有表头与正文之间、以及正文行之间画线；正文第一行不加（对齐 Android Markdown.kt:533-554）。
            style={index === 0 ? undefined : { borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: color_border }}
          >
            {renderTableRow(row, token.align, widths, false, ctx)}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function renderTableRow(
  cells: Tokens.TableCell[],
  align: Array<'center' | 'left' | 'right' | null>,
  widths: number[],
  header: boolean,
  ctx: RenderContext,
): JSX.Element[] {
  return cells.map((cell, index) => (
    <Text
      key={index}
      className={header ? styles.tableHeadCell : styles.tableCell}
      style={{ width: widths[index] + 'px', textAlign: cellAlign(align[index]) }}
      selectable
      userSelect
    >
      {renderInline(cell.tokens, ctx)}
    </Text>
  ));
}

/**
 * 一段行内内容。
 *
 * 正文一律套一层可长按选中的 Text（对齐 Android 把助手正文包进 SelectionContainer）：
 * 微信新基础库认 user-select，老基础库只认 selectable，两个都给才在真机上都能选。
 *
 * 另一件事是图片：小程序的 Text 只接受文本子节点，Image 塞进去不会渲染，所以段落里
 * 顶层的图片要提出来单独成块，剩下的部分才继续当一段文本排版。
 */
function InlineFlow(props: {
  tokens: Token[] | undefined;
  ctx: RenderContext;
  className: string;
  style?: React.CSSProperties;
}): JSX.Element {
  const { ctx, className, style } = props;
  const tokens = props.tokens ?? [];
  if (!tokens.some((token) => token.type === 'image')) {
    return (
      <Text className={className} style={style} selectable userSelect>
        {renderInline(tokens, ctx)}
      </Text>
    );
  }
  const parts: JSX.Element[] = [];
  let run: Token[] = [];
  const flush = (): void => {
    const current = run;
    run = [];
    if (current.length === 0) return;
    // 图片之间的换行/空白自成一段没有意义，别在版面上撑出空行。
    const blank = current.every((token) => token.type === 'text' && (token as Tokens.Text).text.trim().length === 0);
    if (blank) return;
    parts.push(
      <Text key={'t' + parts.length} className={className} style={style} selectable userSelect>
        {renderInline(current, ctx)}
      </Text>,
    );
  };
  tokens.forEach((token) => {
    if (token.type === 'image') {
      flush();
      parts.push(<MarkdownImage key={'i' + parts.length} token={token as Tokens.Image} ctx={ctx} />);
      return;
    }
    run.push(token);
  });
  flush();
  return <View className={styles.inlineFlow}>{parts}</View>;
}

/**
 * 块级图片：`![alt](src)`。
 *
 * Android 会真的把图画出来，这里按地址分两条路——远程地址交给 Image 直接显示、点开进
 * 系统预览；工作区路径在这一层拿不到字节，画成可点的图片占位，点击交给宿主（与文件链接
 * 同一条通路）读回本机再打开图片查看器。无论如何都不用 alt 文本冒充图片。
 */
function MarkdownImage(props: { token: Tokens.Image; ctx: RenderContext }): JSX.Element {
  const { token, ctx } = props;
  const href = token.href.trim();
  const label = token.text.length > 0 ? decodeEntities(token.text) : fileLinkBasename(href) || href;
  const action = imageAction(href, ctx);
  // 远程图要求域名配在小程序的业务域名白名单里，加载失败时退回占位，不留一块空白。
  const [broken, setBroken] = useState(false);
  if (REMOTE_IMAGE.test(href) && !broken) {
    return (
      <Image
        className={styles.image}
        src={href}
        mode='widthFix'
        onError={() => setBroken(true)}
        onClick={action}
      />
    );
  }
  if (action === undefined) {
    return (
      <Text className={styles.imageAlt} style={{ color: color_text_sub }} selectable userSelect>
        {label}
      </Text>
    );
  }
  return (
    <View className={styles.imageChip} style={{ backgroundColor: color_card_surface }} onClick={action}>
      <Icon name='image' className={styles.imageChipGlyph} style={{ color: color_primary }} />
      <Text className={styles.imageChipText} style={{ color: color_primary }}>
        {label}
      </Text>
    </View>
  );
}

function renderInline(tokens: Token[] | undefined, ctx: RenderContext): React.ReactNode[] {
  if (!tokens) return [];
  return tokens.map((token, index) => <InlineToken key={index} token={token} ctx={ctx} />);
}

/**
 * 一段纯文本里的字面量自动链接（语法树层）。
 *
 * 词法层只在 inline 解析之前接管得了一部分；剩下的文本节点要再跑一次正则替换，
 * 两层叠起来才等于安卓 GfmAutolink 的口径。
 */
function AutolinkedText(props: { text: string; ctx: RenderContext }): React.ReactNode {
  const { text, ctx } = props;
  const matches = text.length === 0 ? [] : findTransformAutolinks(text);
  if (matches.length === 0) {
    return <HighlightedText text={text} query={ctx.findQuery} active={ctx.findActive} />;
  }
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  matches.forEach((match, index) => {
    if (match.start > cursor) {
      parts.push(
        <HighlightedText
          key={'t' + index}
          text={text.slice(cursor, match.start)}
          query={ctx.findQuery}
          active={ctx.findActive}
        />,
      );
    }
    parts.push(
      <Text
        key={'a' + index}
        className={styles.link}
        style={{ color: color_primary }}
        onClick={() => void showExternalLink(match.href)}
      >
        <HighlightedText text={match.text} query={ctx.findQuery} active={ctx.findActive} />
      </Text>,
    );
    cursor = match.end;
  });
  if (cursor < text.length) {
    parts.push(
      <HighlightedText key='tail' text={text.slice(cursor)} query={ctx.findQuery} active={ctx.findActive} />,
    );
  }
  return <>{parts}</>;
}

function InlineToken(props: { token: Token; ctx: RenderContext }): React.ReactNode {
  const { token, ctx } = props;
  switch (token.type) {
    case 'text': {
      const textToken = token as Tokens.Text;
      // 转义文本会带子 token，有子 token 就继续往下走，没有就按纯文本处理（顺带做查找高亮）。
      if (textToken.tokens && textToken.tokens.length > 0) {
        return <>{renderInline(textToken.tokens, ctx)}</>;
      }
      // 文本取 raw 再解一次字符引用：marked 的 `text` 是给 HTML 渲染用的转义结果，
      // 源里的 `&amp;` 在它那里会变成 `&amp;amp;`，解一层只能回到 `&amp;`。
      return <AutolinkedText text={decodeEntities(textToken.raw)} ctx={ctx} />;
    }
    case 'escape': {
      const escape = token as Tokens.Escape;
      // 反斜杠转义：raw 是 `\*`，去掉反斜杠就是要显示的那个字符。
      return <HighlightedText text={escape.raw.slice(1)} query={ctx.findQuery} active={ctx.findActive} />;
    }
    case 'dshAutolink': {
      // 词法层认出来的字面量自动链接（www./http(s):///邮箱）。
      const autolink = token as unknown as AutolinkToken;
      return (
        <Text
          className={styles.link}
          style={{ color: color_primary }}
          onClick={() => void showExternalLink(autolink.href)}
        >
          <HighlightedText text={autolink.text} query={ctx.findQuery} active={ctx.findActive} />
        </Text>
      );
    }
    case 'strong':
      return <Text className={styles.strong}>{renderInline((token as Tokens.Strong).tokens, ctx)}</Text>;
    case 'em':
      return <Text className={styles.em}>{renderInline((token as Tokens.Em).tokens, ctx)}</Text>;
    case 'del':
      return (
        <Text className={styles.del} style={{ color: color_text_sub }}>
          {renderInline((token as Tokens.Del).tokens, ctx)}
        </Text>
      );
    case 'codespan': {
      const codespan = token as Tokens.Codespan;
      /*
       * 行内代码若指向文件就地变成可点的提及，判定顺序与 Android 一致：
       * 先查本轮产物的提及词表（模型写 `markdown.tsx` 这种裸文件名时只有词表认得出它
       * 在哪个目录），词表没有再看 token 自己是不是「目录 + 扩展名」这种明确路径。
       */
      // 词表与路径判定都用还原后的文本：`a&amp;b.ts` 这种名字转义过就再也匹配不上。
      const codeText = decodeEntities(codespan.text);
      const mention = ctx.mentions.length === 0 ? undefined : resolveMention(codeText, ctx.mentions);
      const openFile = ctx.onOpenFile;
      const openFileLink = ctx.onOpenFileLink;
      const fileTarget =
        mention !== undefined || openFileLink === undefined ? undefined : parseInlineCodeFileLink(codeText);
      const onOpen =
        mention !== undefined && openFile !== undefined
          ? () => openFile(mention)
          : fileTarget !== undefined && openFileLink !== undefined
            ? () => openFileLink(fileTarget)
            : undefined;
      // 窄空格把底色从字形两侧推开一点，否则背景紧贴字形很难看（同 Android）。
      const padded = '\u2009' + decodeEntities(codespan.text) + '\u2009';
      return (
        <Text
          className={styles.inlineCode + (onOpen === undefined ? '' : ' ' + styles.link)}
          style={onOpen === undefined ? INLINE_CODE_STYLE : INLINE_CODE_LINK_STYLE}
          onClick={onOpen}
        >
          <HighlightedText text={padded} query={ctx.findQuery} active={ctx.findActive} />
        </Text>
      );
    }
    case 'link': {
      const link = token as Tokens.Link;
      // 与 Android 同口径：文件地址（dsh-resource://、file://、绝对/相对路径）读回本机预览；
      // 其余是浏览器地址，小程序开不了外链，改成弹出完整地址 + 一键复制（见 showExternalLink）。
      const target = parseFileLink(link.href);
      const onOpen = target === undefined ? undefined : ctx.onOpenFileLink;
      /*
       * 不是文件、协议也不在白名单里的地址（javascript:、data: 这类）渲染成纯文本、不可点：
       * 对齐 Android 的 isSafeExternalUrl。少了这道闸，一条 `[看这里](javascript:…)` 会画成
       * 正常链接，点一下还把脚本原文塞进用户剪贴板。
       */
      if (target === undefined && !isSafeExternalUrl(link.href)) {
        return <>{renderInline(link.tokens, ctx)}</>;
      }
      return (
        <Text
          className={styles.link}
          style={{ color: color_primary }}
          onClick={() => {
            if (target !== undefined && onOpen !== undefined) onOpen(target);
            else void showExternalLink(link.href);
          }}
        >
          {renderInline(link.tokens, ctx)}
        </Text>
      );
    }
    case 'image': {
      const image = token as Tokens.Image;
      /*
       * 行内位置（表格单元格、强调/链接内部）塞不进 Image 组件——段落顶层的图片已经被
       * InlineFlow 提出去单独成块了，走到这里的都是这些嵌套场景。按 Android 的
       * 兜底分支渲染成弱化的斜体 alt，是图片文件时仍可点开查看器。
       */
      const action = imageAction(image.href, ctx);
      const label = decodeEntities(image.text) || image.href;
      return (
        <Text
          className={action === undefined ? styles.imageAlt : styles.imageAlt + ' ' + styles.link}
          style={{ color: action === undefined ? color_text_sub : color_primary }}
          onClick={action}
        >
          {label}
        </Text>
      );
    }
    case 'br':
      // 直接吐换行符：外层段落是 pre-wrap，换行语义天然成立，不必再套一层节点。
      return '\n';
    case 'html': {
      const html = token as Tokens.HTML;
      if (/^<br/i.test(html.text)) return '\n';
      const stripped = stripHtml(html.text);
      if (!stripped) return null;
      return <HighlightedText text={stripped} query={ctx.findQuery} active={ctx.findActive} />;
    }
    default:
      return null;
  }
}

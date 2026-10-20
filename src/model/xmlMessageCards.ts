/**
 * 用户消息里的「圈选元素 XML」投影成键值卡片（对齐 Android model/XmlMessageCards.kt、
 * Mac XMLMessageCards.swift 与 Chrome 插件 features/chat/user-xml-cards.js，同一套判定与投影）。
 *
 * Chrome 插件把圈选的元素序列化成纯属性的 XML，发送时拼成：
 *
 *   <selected_page_elements url="…" title="…">
 *   <element i="1" tag="button" css="#submit" text="提交" />
 *   </selected_page_elements>
 *
 *   [指令] 用户原话
 *
 * 直接铺在气泡里既难读又占地方，所以每个元素画成一张卡，属性一行一条；XML 之后的原话
 * （remainder）仍按普通气泡显示。
 *
 * 手写扫描：属性顺序必须保住（圈选顺序有含义），且 picker 只转义 & < "，双引号里的 > 与 '
 * 都是值本身。读不下去就返回 undefined —— 宁可退回原文气泡，也不猜着画一张看不懂的卡。
 *
 * 名字字符不用 \p{L}/\p{N}：安卓微信的小程序 JS 引擎不支持 Unicode 属性转义（见
 * config/expandUnicodePropertyLoader.cjs）。这里 ASCII 按 XML 规则判，非 ASCII 码点一律放行，
 * 圈选产出的标签/属性名本来都是 ASCII。
 *
 * 只是呈现：复制与会话内查找仍用原始消息文本。
 */

export interface XmlCardAttribute {
  name: string;
  value: string;
}

export interface XmlCard {
  /** 在实际显示的卡片里的 1 起序号。 */
  position: number;
  tag: string;
  attributes: XmlCardAttribute[];
  /** 元素携带的文本；没有时为 undefined。 */
  text?: string;
}

export interface XmlMessageCards {
  /** 根标签名，详情弹层的标题。 */
  rootTag: string;
  cards: XmlCard[];
  /** XML 之后的文字（picker 的指令尾巴），已去掉首尾空白；空串表示没有。 */
  remainder: string;
}

/** 超过上限一律当普通文本。圈选一批最多 20 个元素、十来个属性，只有大段粘贴会触发。 */
export const XML_CARD_MAX_CHARS = 20000;
export const XML_CARD_MAX_ELEMENTS = 200;
export const XML_CARD_MAX_ATTRS = 64;
export const XML_CARD_MAX_DEPTH = 32;
/** 转写里内联展示的卡片数，多出来的进「查看全部」弹层（与 Android / Mac / 插件同一口径）。 */
export const XML_CARD_INLINE_LIMIT = 5;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntity(body: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)) return NAMED_ENTITIES[body];
  if (!body.startsWith('#')) return undefined;
  const hex = body.startsWith('#x') || body.startsWith('#X');
  const digits = body.slice(hex ? 2 : 1);
  if (digits.length === 0 || !(hex ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/).test(digits)) return undefined;
  const value = Number.parseInt(digits, hex ? 16 : 10);
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return undefined;
  // 代理区码点不是合法标量，构造会抛异常。
  if (value >= 0xd800 && value <= 0xdfff) return undefined;
  return String.fromCodePoint(value);
}

/** 解开 XML 字符引用；认不出的引用按字面量留下，不因此判定解析失败。 */
function decodeEntities(raw: string): string {
  if (!raw.includes('&')) return raw;
  let out = '';
  let i = 0;
  while (i < raw.length) {
    if (raw[i] !== '&') {
      out += raw[i];
      i += 1;
      continue;
    }
    const semi = raw.indexOf(';', i + 1);
    // 引用体太长或没有分号：按字面量留下。
    if (semi < 0 || semi - i > 12) {
      out += raw[i];
      i += 1;
      continue;
    }
    const decoded = decodeEntity(raw.slice(i + 1, semi));
    if (decoded === undefined) {
      out += raw[i];
      i += 1;
      continue;
    }
    out += decoded;
    i = semi + 1;
  }
  return out;
}

function isAsciiLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

function isNameStart(ch: string): boolean {
  return isAsciiLetter(ch) || ch === '_' || ch === ':' || ch.codePointAt(0)! >= 0x80;
}

function isNameChar(ch: string): boolean {
  return isNameStart(ch) || (ch >= '0' && ch <= '9') || ch === '.' || ch === '-';
}

interface Node {
  tag: string;
  attributes: XmlCardAttribute[];
  children: Node[];
  text?: string;
}

/** 按码点扫描（与插件的 Array.from 同口径）。 */
class Scanner {
  readonly chars: string[];
  index = 0;
  private elements = 0;

  constructor(text: string) {
    this.chars = Array.from(text);
  }

  private peek(offset = 0): string | undefined {
    return this.chars[this.index + offset];
  }

  skipWhitespace(): void {
    while (this.index < this.chars.length && /\s/.test(this.chars[this.index])) this.index += 1;
  }

  private consume(char: string): boolean {
    if (this.chars[this.index] !== char) return false;
    this.index += 1;
    return true;
  }

  private hasPrefix(marker: string): boolean {
    for (let i = 0; i < marker.length; i += 1) {
      if (this.chars[this.index + i] !== marker[i]) return false;
    }
    return true;
  }

  private advance(count: number): void {
    this.index = Math.min(this.chars.length, this.index + count);
  }

  private skipUntil(marker: string): boolean {
    while (this.index + marker.length <= this.chars.length) {
      if (this.hasPrefix(marker)) {
        this.advance(marker.length);
        return true;
      }
      this.index += 1;
    }
    return false;
  }

  private parseName(): string | undefined {
    const first = this.peek();
    if (first === undefined || !isNameStart(first)) return undefined;
    const start = this.index;
    this.index += 1;
    while (this.index < this.chars.length && isNameChar(this.chars[this.index])) this.index += 1;
    return this.chars.slice(start, this.index).join('');
  }

  /** 引号内的值一路读到闭合引号：里面的 > 与 ' 都属于值本身。 */
  private parseQuotedValue(): string | undefined {
    const quote = this.peek();
    if (quote !== '"' && quote !== "'") return undefined;
    this.index += 1;
    const start = this.index;
    while (this.index < this.chars.length && this.chars[this.index] !== quote) this.index += 1;
    if (this.index >= this.chars.length) return undefined;
    const raw = this.chars.slice(start, this.index).join('');
    this.index += 1;
    return decodeEntities(raw);
  }

  parseNode(depth: number): Node | undefined {
    if (depth >= XML_CARD_MAX_DEPTH || !this.consume('<')) return undefined;
    const tag = this.parseName();
    if (tag === undefined) return undefined;

    const attributes: XmlCardAttribute[] = [];
    let selfClosing = false;
    for (;;) {
      this.skipWhitespace();
      if (this.hasPrefix('/>')) {
        this.advance(2);
        selfClosing = true;
        break;
      }
      if (this.consume('>')) break;
      const name = this.parseName();
      if (name === undefined) return undefined;
      this.skipWhitespace();
      if (!this.consume('=')) return undefined;
      this.skipWhitespace();
      const value = this.parseQuotedValue();
      if (value === undefined) return undefined;
      if (attributes.length >= XML_CARD_MAX_ATTRS) return undefined;
      attributes.push({ name, value });
    }

    this.elements += 1;
    if (this.elements > XML_CARD_MAX_ELEMENTS) return undefined;

    const node: Node = { tag, attributes, children: [] };
    if (selfClosing) return node;

    const textParts: string[] = [];
    for (;;) {
      if (this.index >= this.chars.length) return undefined;
      if (this.peek() === '<') {
        if (this.hasPrefix('<!--')) {
          if (!this.skipUntil('-->')) return undefined;
          continue;
        }
        if (this.hasPrefix('<?')) {
          if (!this.skipUntil('?>')) return undefined;
          continue;
        }
        // DOCTYPE 与 CDATA 承载的标记没法忠实地画成键值行，整段放弃解析。
        if (this.hasPrefix('<!')) return undefined;
        if (this.hasPrefix('</')) {
          this.advance(2);
          this.skipWhitespace();
          const close = this.parseName();
          if (close === undefined || close !== tag) return undefined;
          this.skipWhitespace();
          if (!this.consume('>')) return undefined;
          break;
        }
        const child = this.parseNode(depth + 1);
        if (child === undefined) return undefined;
        node.children.push(child);
        continue;
      }
      const start = this.index;
      while (this.index < this.chars.length && this.chars[this.index] !== '<') this.index += 1;
      const chunk = this.chars.slice(start, this.index).join('').trim();
      if (chunk.length > 0) textParts.push(decodeEntities(chunk));
    }
    if (textParts.length > 0) node.text = textParts.join(' ');
    return node;
  }
}

function flatten(node: Node, out: Node[]): void {
  out.push(node);
  for (const child of node.children) flatten(child, out);
}

/** 把一段消息文本读成卡片投影；不是 XML（或读不动）时返回 undefined，调用方照旧画气泡。 */
export function parseXmlMessageCards(text: string): XmlMessageCards | undefined {
  if (text.length === 0 || Array.from(text).length > XML_CARD_MAX_CHARS) return undefined;
  // 便宜的先决判断：绝大多数消息是散文，不该为一次注定失败的扫描付代价。
  const first = /\S/.exec(text);
  if (first === null || first[0] !== '<') return undefined;

  const scanner = new Scanner(text);
  scanner.skipWhitespace();
  const root = scanner.parseNode(0);
  if (root === undefined) return undefined;
  scanner.skipWhitespace();
  const remainder = scanner.chars.slice(scanner.index).join('').trim();

  const nodes: Node[] = [];
  flatten(root, nodes);
  // 一个属性都没有就只是散文（或一个光秃秃的标签），气泡读起来更好。
  const shown = nodes.filter((node) => node.attributes.length > 0 || node.text !== undefined);
  if (shown.length === 0 || !shown.some((node) => node.attributes.length > 0)) return undefined;

  return {
    rootTag: root.tag,
    cards: shown.map((node, offset) => ({
      position: offset + 1,
      tag: node.tag,
      attributes: node.attributes.slice(),
      ...(node.text === undefined ? {} : { text: node.text }),
    })),
    remainder,
  };
}

/** 卡片的纯文本形态，给详情弹层的复制键用：与读者看到的是同一批行、同一顺序。 */
export function xmlCardsPlainText(cards: XmlCard[], textLabel: string): string {
  const lines: string[] = [];
  for (const card of cards) {
    lines.push('#' + card.position + ' ' + card.tag);
    for (const attribute of card.attributes) lines.push(attribute.name + ': ' + attribute.value);
    if (card.text !== undefined) lines.push(textLabel + ': ' + card.text);
    lines.push('');
  }
  return lines.join('\n').trim();
}

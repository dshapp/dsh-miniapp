/**
 * GFM 字面量自动链接（autolink literal）识别——纯函数版，与安卓端逐条对齐。
 *
 * 对应安卓 ui/component/GfmAutolink.kt：
 * - isSafeExternalUrl        ← GfmAutolink.isSafeExternalUrl
 * - matchAutolinkAt          ← tryAt / tryEmail / tryProtocol / tryWww / parseDomain / parsePath / isTrail
 * - findTokenizerAutolinks   ← GfmAutolinkContentParser.gateAllows（词法层的整块前向扫描）
 * - findTransformAutolinks   ← GfmAutolinkPostProcessor：urlPattern / emailPattern +
 *                              replaceUrl / replaceEmail / previous / isCorrectDomain / splitUrl / replaceInText
 * - findAutolinks            ← 上面两层叠加后的最终效果（安卓靠 install() 把两者挂到同一个 Parser 上）
 *
 * 为什么要两层：Web 端（micromark + mdast）本身就是两套机制配合。
 * 1. 词法层 tokenizer 在 inline 解析阶段接管，能吃下正则边界搞不定的场景
 *    （CJK 紧贴 URL、路径里的 *、括号不平衡）；
 * 2. 语法树层 transform 用正则在剩余文本节点上补一刀，捡回 tokenizer 因为
 *    方括号未闭合等原因没有接管的部分（例如 [x@y.com]）。
 * 少任何一层都会与 Web/安卓的 golden 语料产生差异，所以这里原样保留两层与它们的先后顺序。
 *
 * 说明：GFM 的字面量自动链接只认 www.、http://、https:// 和邮箱三类。
 * ftp://、xmpp:、以及不带 www. 的裸域名都不成链接——这是上游规则本身的取舍，不是这里漏实现。
 */

/** 一处自动链接命中：[start, end) 是在入参字符串里的 UTF-16 下标区间。 */
export interface AutolinkMatch {
  start: number;
  end: number;
  /** 跳转地址，已按需要补上 http:// 或 mailto: 前缀。 */
  href: string;
  /** 可见文本，等于 text.slice(start, end)，渲染时直接用它避免再切一次。 */
  text: string;
}

/** 越界统一返回这个哨兵，让所有字符判定都能安全地对"没有字符"求值。 */
const NULL = -1;

/**
 * http/https/mailto 之外一律不渲染为可点击链接（对齐 Web 端 sanitizeUrl）：
 * 自动链接的地址来自用户文本，javascript:、data: 这类协议一旦可点就是注入面。
 */
export function isSafeExternalUrl(destination: string): boolean {
  const colon = destination.indexOf(':');
  if (colon <= 0) return false;
  const scheme = destination.slice(0, colon).toLowerCase();
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto';
}

// ---------------------------------------------------------------- 字符判定

function code(s: string, i: number): number {
  if (i < 0 || i >= s.length) return NULL;
  return s.codePointAt(i) as number;
}

function prevCode(s: string, i: number): number {
  if (i <= 0) return NULL;
  return s.codePointAt(i - 1) as number;
}

/** 码点占几个 UTF-16 单元：所有游标都按单元推进，代理对必须一次跨两格。 */
function cpLength(c: number): number {
  return c > 0xffff ? 2 : 1;
}

function isAsciiAlpha(c: number): boolean {
  return c !== NULL && ((c >= 65 && c <= 90) || (c >= 97 && c <= 122));
}

function isAsciiAlnum(c: number): boolean {
  return c !== NULL && ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122));
}

function isAsciiControl(c: number): boolean {
  return c !== NULL && (c < 32 || c === 127);
}

/** 邮箱本地部分允许的字符集（GFM 放宽版的 atext）。 */
function isGfmAtext(c: number): boolean {
  return c === 43 || c === 45 || c === 46 || c === 95 || isAsciiAlnum(c);
}

function isMdLineEndingOrSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13;
}

/**
 * JS 正则 \s 的等价集合。上游是逐个字符判定的，所以这里也显式列举，
 * 免得依赖引擎对 \s 的解释（各端 \s 覆盖范围并不一致）。
 */
function isUnicodeWhitespace(c: number): boolean {
  if (c === NULL) return false;
  if (
    c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 32 ||
    c === 0xa0 || c === 0x1680 || c === 0x2028 || c === 0x2029 ||
    c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff
  ) {
    return true;
  }
  return c >= 0x2000 && c <= 0x200a;
}

/**
 * \p{P}|\p{S}（Unicode 标点 + 符号）在 BMP 上的区间表，十六进制，闭区间。
 *
 * 为什么烘焙成表而不是写 /[\p{P}\p{S}]/u：小程序宿主的 JS 引擎版本不受控，
 * Unicode 属性转义既可能不支持（正则字面量会在解析期直接抛 SyntaxError 炸掉整个包），
 * 也可能因为引擎自带的 Unicode 版本不同而与安卓/Web 判定分叉。
 * 表是生成物，口径固定，任何引擎上结果都一样。
 */
const UNICODE_PUNCTUATION_RANGES =
  '21-2f 3a-40 5b-60 7b-7e a1-a9 ab-ac ae-b1 b4 b6-b8 bb bf d7 ' +
  'f7 2c2-2c5 2d2-2df 2e5-2eb 2ed 2ef-2ff 375 37e 384-385 387 3f6 482 ' +
  '55a-55f 589-58a 58d-58f 5be 5c0 5c3 5c6 5f3-5f4 606-60f 61b 61d-61f 66a-66d ' +
  '6d4 6de 6e9 6fd-6fe 700-70d 7f6-7f9 7fe-7ff 830-83e 85e 888 964-965 970 ' +
  '9f2-9f3 9fa-9fb 9fd a76 af0-af1 b70 bf3-bfa c77 c7f c84 d4f d79 ' +
  'df4 e3f e4f e5a-e5b f01-f17 f1a-f1f f34 f36 f38 f3a-f3d f85 fbe-fc5 ' +
  'fc7-fcc fce-fda 104a-104f 109e-109f 10fb 1360-1368 1390-1399 1400 166d-166e 169b-169c 16eb-16ed 1735-1736 ' +
  '17d4-17d6 17d8-17db 1800-180a 1940 1944-1945 19de-19ff 1a1e-1a1f 1aa0-1aa6 1aa8-1aad 1b4e-1b4f 1b5a-1b6a 1b74-1b7f ' +
  '1bfc-1bff 1c3b-1c3f 1c7e-1c7f 1cc0-1cc7 1cd3 1fbd 1fbf-1fc1 1fcd-1fcf 1fdd-1fdf 1fed-1fef 1ffd-1ffe 2010-2027 ' +
  '2030-205e 207a-207e 208a-208e 20a0-20c1 2100-2101 2103-2106 2108-2109 2114 2116-2118 211e-2123 2125 2127 ' +
  '2129 212e 213a-213b 2140-2144 214a-214d 214f 218a-218b 2190-2429 2440-244a 249c-24e9 2500-2775 2794-2b73 ' +
  '2b76-2bff 2ce5-2cea 2cf9-2cfc 2cfe-2cff 2d70 2e00-2e2e 2e30-2e5d 2e80-2e99 2e9b-2ef3 2f00-2fd5 2ff0-2fff 3001-3004 ' +
  '3008-3020 3030 3036-3037 303d-303f 309b-309c 30a0 30fb 3190-3191 3196-319f 31c0-31e5 31ef 3200-321e ' +
  '322a-3247 3250 3260-327f 328a-32b0 32c0-33ff 4dc0-4dff a490-a4c6 a4fe-a4ff a60d-a60f a673 a67e a6f2-a6f7 ' +
  'a700-a716 a720-a721 a789-a78a a828-a82b a836-a839 a874-a877 a8ce-a8cf a8f8-a8fa a8fc a92e-a92f a95f a9c1-a9cd ' +
  'a9de-a9df aa5c-aa5f aa77-aa79 aade-aadf aaf0-aaf1 ab5b ab6a-ab6b abeb fb29 fbb2-fbd2 fd3e-fd4f fd90-fd91 ' +
  'fdc8-fdcf fdfc-fdff fe10-fe19 fe30-fe52 fe54-fe66 fe68-fe6b ff01-ff0f ff1a-ff20 ff3b-ff40 ff5b-ff65 ffe0-ffe6 ffe8-ffee ' +
  'fffc-fffd';

/** 区间表展平成 [lo0, hi0, lo1, hi1, ...]，查表走二分。 */
const punctuationBounds: number[] = (() => {
  const bounds: number[] = [];
  for (const token of UNICODE_PUNCTUATION_RANGES.split(' ')) {
    const dash = token.indexOf('-');
    if (dash < 0) {
      const only = parseInt(token, 16);
      bounds.push(only, only);
    } else {
      bounds.push(parseInt(token.slice(0, dash), 16), parseInt(token.slice(dash + 1), 16));
    }
  }
  return bounds;
})();

/**
 * 上游用 String.fromCharCode(code) 做判定，超出 BMP 的码点会被截断成低 16 位，
 * 这里照样只看低 16 位——不是笔误，是为了让增补平面字符的分支走向和上游一致。
 */
function isUnicodePunctuation(c: number): boolean {
  if (c === NULL) return false;
  const ch = c & 0xffff;
  let lo = 0;
  let hi = (punctuationBounds.length >> 1) - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ch < punctuationBounds[mid * 2]) hi = mid - 1;
    else if (ch > punctuationBounds[mid * 2 + 1]) lo = mid + 1;
    else return true;
  }
  return false;
}

// ---------------------------------------------------------------- 词法层

/** 无条件属于"尾随标点"的字符：出现在 URL 末尾时应该被剥出链接之外。 */
const TRAIL_ALWAYS = [33, 34, 39, 41, 42, 44, 46, 58, 59, 63, 95, 126];

/** 路径里需要单独判定的字符：可能是内容，也可能是尾随标点，取决于它后面还有什么。 */
const PATH_SPECIAL = [33, 34, 38, 39, 41, 42, 44, 46, 58, 59, 60, 63, 93, 95, 126];

function inSet(set: number[], c: number): boolean {
  for (let i = 0; i < set.length; i++) if (set[i] === c) return true;
  return false;
}

/**
 * 域名收尾时的下划线限制：域名最后两段里出现 _ 就整体不成链接
 * （下划线不是合法域名字符，带 _ 的多半是变量名/文件名而不是网址）。
 * seen 为假表示压根没吃到域名字符，同样不成链接。
 */
function boundaryAfterTrail(
  after: number,
  underscoreSecondLast: boolean,
  underscoreLast: boolean,
  seen: boolean,
): number {
  return underscoreSecondLast || underscoreLast || !seen ? NULL : after;
}

/**
 * 判断从 start 起是否已经进入"尾随标点 + 边界"：句末的 . , ! ? 等不该算进链接，
 * 但只有在它们后面直到空白/结尾都是标点时才剥，否则 a.com/x.y 的点就被误伤了。
 */
function isTrail(s: string, start: number): boolean {
  let j = start;
  for (;;) {
    const c = code(s, j);
    if (inSet(TRAIL_ALWAYS, c)) {
      j++;
      continue;
    }
    // & 开头只有构成完整 HTML 实体（&amp; 这样以分号收尾）时才算尾随，
    // 因为实体是渲染产物而不是地址的一部分。
    if (c === 38) {
      j++;
      if (!isAsciiAlpha(code(s, j))) return false;
      for (;;) {
        const inner = code(s, j);
        if (inner === 59) {
          j++;
          break;
        }
        if (isAsciiAlpha(inner)) {
          j++;
          continue;
        }
        return false;
      }
      continue;
    }
    // ] 只有在后面紧跟 (、[、空白或结尾时才算尾随：这样 [text](url) 这类
    // Markdown 结构里的收尾方括号不会被吞进链接。
    if (c === 93) {
      j++;
      const next = code(s, j);
      if (next === NULL || next === 40 || next === 91 || isMdLineEndingOrSpace(next) || isUnicodeWhitespace(next)) {
        return true;
      }
      continue;
    }
    if (c === 60) return true;
    if (c === NULL || isMdLineEndingOrSpace(c) || isUnicodeWhitespace(c)) return true;
    return false;
  }
}

/** 吃掉域名部分，返回域名结束下标；NULL 表示这段不构成合法域名。 */
function parseDomain(s: string, start: number): number {
  let j = start;
  let seen = false;
  let underscoreLast = false;
  let underscoreSecondLast = false;
  for (;;) {
    const c = code(s, j);
    if (c === 46 || c === 95) {
      if (isTrail(s, j)) {
        return boundaryAfterTrail(j, underscoreSecondLast, underscoreLast, seen);
      }
      if (c === 95) {
        underscoreLast = true;
      } else {
        // 遇到 . 才把"上一段是否以 _ 结尾"往前挪一格，于是只有最后两段受 _ 限制。
        underscoreSecondLast = underscoreLast;
        underscoreLast = false;
      }
      j++;
      continue;
    }
    // 连字符之外的 Unicode 标点都终止域名；中日韩汉字不是标点，所以中文域名能继续吃下去。
    if (
      c === NULL || isMdLineEndingOrSpace(c) || isUnicodeWhitespace(c) ||
      (c !== 45 && isUnicodePunctuation(c))
    ) {
      return boundaryAfterTrail(j, underscoreSecondLast, underscoreLast, seen);
    }
    seen = true;
    j += cpLength(c);
  }
}

/** 吃掉路径部分：括号按对配平，右括号多出来的那个留在链接外面。 */
function parsePath(s: string, start: number): number {
  let j = start;
  let open = 0;
  let close = 0;
  for (;;) {
    const c = code(s, j);
    if (c === 40) {
      open++;
      j++;
      continue;
    }
    // 右括号只要还有没配对的左括号就一定属于链接，这样 https://x/a_(b) 不会在 ) 前截断。
    if (c === 41 && close < open) {
      close++;
      j++;
      continue;
    }
    if (inSet(PATH_SPECIAL, c)) {
      if (isTrail(s, j)) return j;
      if (c === 41) close++;
      j++;
      continue;
    }
    if (c === NULL || isMdLineEndingOrSpace(c) || isUnicodeWhitespace(c)) return j;
    j += cpLength(c);
  }
}

interface RawMatch {
  href: string;
  text: string;
  end: number;
}

function tryEmail(s: string, start: number): RawMatch | null {
  const prev = prevCode(s, start);
  // 前一个字符还是 atext 说明我们站在词的中间；前一个是 / 则更像路径片段
  // （x/a@b.com 这种），两种都不该起链接。
  if (!isGfmAtext(code(s, start)) || isGfmAtext(prev) || prev === 47) return null;
  let j = start;
  for (;;) {
    const c = code(s, j);
    if (isGfmAtext(c)) {
      j += cpLength(c);
      continue;
    }
    if (c === 64) {
      j++;
      break;
    }
    return null;
  }
  let data = false;
  let dot = false;
  for (;;) {
    const c = code(s, j);
    if (c === 46) {
      // 点后面必须还有字母数字，否则这个点是句号而不是域名分隔符。
      if (isAsciiAlnum(code(s, j + 1))) {
        j++;
        dot = true;
        continue;
      }
      break;
    }
    if (c === 45 || c === 95 || isAsciiAlnum(c)) {
      data = true;
      j += cpLength(c);
      continue;
    }
    break;
  }
  // 必须有内容、有点号，且以字母收尾：顶级域名不会是数字或连字符。
  if (!(data && dot && isAsciiAlpha(prevCode(s, j)))) return null;
  const value = s.slice(start, j);
  return { href: 'mailto:' + value, text: value, end: j };
}

function tryProtocol(s: string, start: number): RawMatch | null {
  // 紧跟在字母后面（xhttps://…）不算协议开头。
  if (isAsciiAlpha(prevCode(s, start))) return null;
  let j = start;
  let buffer = '';
  const first = code(s, j);
  if (first === NULL) return null;
  buffer += String.fromCodePoint(first);
  j += cpLength(first);
  for (;;) {
    const c = code(s, j);
    if (isAsciiAlpha(c) && buffer.length < 5) {
      buffer += String.fromCodePoint(c);
      j += cpLength(c);
      continue;
    }
    if (c === 58) {
      // 只放行 http/https：ftp://、file:// 等一律留作纯文本。
      const protocol = buffer.toLowerCase();
      if (protocol === 'http' || protocol === 'https') {
        j++;
        break;
      }
    }
    return null;
  }
  // 协议后必须恰好是两个斜杠。
  let seen = false;
  for (;;) {
    const c = code(s, j);
    if (c === 47) {
      j++;
      if (seen) break;
      seen = true;
      continue;
    }
    return null;
  }
  const c = code(s, j);
  if (
    c === NULL || isAsciiControl(c) || isMdLineEndingOrSpace(c) ||
    isUnicodeWhitespace(c) || isUnicodePunctuation(c)
  ) {
    return null;
  }
  const domainEnd = parseDomain(s, j);
  if (domainEnd === NULL) return null;
  const end = parsePath(s, domainEnd);
  const value = s.slice(start, end);
  return { href: value, text: value, end };
}

function tryWww(s: string, start: number): RawMatch | null {
  const first = code(s, start);
  if (first !== 87 && first !== 119) return null;
  const prev = prevCode(s, start);
  // www. 没有协议做锚点，所以对前一个字符更严：只允许行首、空白，以及
  // 常见的强调/括号包裹字符，避免 abcwww.x.com 这种词中间被切出链接。
  const prevOk =
    prev === NULL || prev === 40 || prev === 42 || prev === 95 ||
    prev === 91 || prev === 93 || prev === 126 || isMdLineEndingOrSpace(prev);
  if (!prevOk) return null;
  let j = start;
  let size = 0;
  for (;;) {
    const c = code(s, j);
    if ((c === 87 || c === 119) && size < 3) {
      size++;
      j++;
      continue;
    }
    if (c === 46 && size === 3) {
      j++;
      break;
    }
    return null;
  }
  if (code(s, j) === NULL) return null;
  // 域名从 www 本身开始重新解析，这样 _ 限制作用在整个域名上。
  const domainEnd = parseDomain(s, start);
  if (domainEnd === NULL) return null;
  const end = parsePath(s, domainEnd);
  const value = s.slice(start, end);
  return { href: 'http://' + value, text: value, end };
}

/**
 * 词法层在单个位置上的尝试（对应安卓 tryAt）：h/w 开头要先试邮箱再试 URL，
 * 因为 http 与 www 本身也可能是邮箱的本地部分（http@x.com）。
 */
export function matchAutolinkAt(s: string, index: number): AutolinkMatch | null {
  const cp = code(s, index);
  let raw: RawMatch | null = null;
  if (cp === 72 || cp === 104) raw = tryEmail(s, index) ?? tryProtocol(s, index);
  else if (cp === 87 || cp === 119) raw = tryEmail(s, index) ?? tryWww(s, index);
  else if (isGfmAtext(cp)) raw = tryEmail(s, index);
  if (!raw) return null;
  return { start: index, end: raw.end, href: raw.href, text: raw.text };
}

/** 反斜杠能转义的字符集合，决定 \x 要跳过一格还是两格。 */
function isEscapable(c: number): boolean {
  return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
}

/**
 * 词法层对整段文本的一次前向扫描（对应安卓 gateAllows 里的循环）。
 *
 * 为什么要跳过反斜杠转义和成对反引号：它们在 Markdown 里分别是转义和行内代码，
 * 里面的内容不参与链接识别。为什么要数方括号：未闭合的 [ 之后 micromark 不启用
 * 字面量自动链接（那段文本可能最终变成链接标签），这部分交给语法树层再兜一次。
 */
export function findTokenizerAutolinks(s: string): AutolinkMatch[] {
  const out: AutolinkMatch[] = [];
  let i = 0;
  let depth = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i) as number;
    if (cp === 92) {
      const next = code(s, i + 1);
      i += next !== NULL && isEscapable(next) ? 2 : 1;
      continue;
    }
    if (cp === 96) {
      let runLength = 0;
      while (i + runLength < s.length && s[i + runLength] === '\u0060') runLength++;
      let k = i + runLength;
      let closing = -1;
      while (k < s.length) {
        if (s[k] === '\u0060') {
          let m = 0;
          while (k + m < s.length && s[k + m] === '\u0060') m++;
          // 只有同样长度的反引号串才是闭合标记，长度不等的继续往后找。
          if (m === runLength) {
            closing = k + m;
            break;
          }
          k += m;
        } else {
          k++;
        }
      }
      i = closing >= 0 ? closing : i + runLength;
      continue;
    }
    if (cp === 91) {
      depth++;
      i++;
      continue;
    }
    if (cp === 93) {
      if (depth > 0) depth--;
      i++;
      continue;
    }
    if (depth === 0) {
      const match = matchAutolinkAt(s, i);
      if (match) {
        out.push(match);
        i = match.end;
        continue;
      }
    }
    i += cpLength(cp);
  }
  return out;
}

// ---------------------------------------------------------------- 语法树层

const urlPattern = /(https?:\/\/|www(?=\.))([-.\w]+)([^ \t\r\n]*)/gi;
const emailPattern = /([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/g;
const trailPattern = /[!"&'),.:;<>?\]}]+$/;
const alnumAnywhere = /[a-zA-Z\d]/;

/**
 * 匹配点前面必须是文本开头、空白或标点：正则本身不做词边界判断，
 * 这一步防止 xwww.a.com、a@b 的 @ 前半截被从词中间切出来。
 * 邮箱额外禁掉 /，因为 x/a@b.com 是路径而不是邮箱。
 */
function previous(value: string, index: number, email: boolean): boolean {
  if (index === 0) return true;
  const c = value.charCodeAt(index - 1);
  if (email && c === 47) return false;
  return isUnicodeWhitespace(c) || isUnicodePunctuation(c);
}

/** 域名至少两段，且最后两段不能含 _、必须含字母数字——排除 a._b 这类非域名串。 */
function isCorrectDomain(domain: string): boolean {
  const parts = domain.split('.');
  if (parts.length < 2) return false;
  const last = parts[parts.length - 1];
  if (last.length > 0 && (last.indexOf('_') >= 0 || !alnumAnywhere.test(last))) return false;
  const secondLast = parts[parts.length - 2];
  if (secondLast.length > 0 && (secondLast.indexOf('_') >= 0 || !alnumAnywhere.test(secondLast))) return false;
  return true;
}

/**
 * 把 URL 尾巴上的标点切出去，但左括号还有富余时要把右括号抢回来：
 * https://x/a(b). 的句点该剥掉，https://x/a(b) 的右括号则属于地址。
 */
function splitUrl(url: string): { core: string; trail: string } {
  const matched = trailPattern.exec(url);
  if (!matched) return { core: url, trail: '' };
  let core = url.slice(0, matched.index);
  let trail = matched[0];
  let closeIndex = trail.indexOf(')');
  let open = 0;
  let close = 0;
  for (let i = 0; i < core.length; i++) {
    if (core[i] === '(') open++;
    else if (core[i] === ')') close++;
  }
  while (closeIndex !== -1 && open > close) {
    core += trail.slice(0, closeIndex + 1);
    trail = trail.slice(closeIndex + 1);
    closeIndex = trail.indexOf(')');
    close++;
  }
  return { core, trail };
}

/** 一次正则替换的产物：链接本体 + 匹配串里没进链接的尾巴长度。 */
interface Replacement {
  /** 相对匹配起点的链接长度。 */
  length: number;
  href: string;
}

function replaceUrl(text: string, matched: RegExpExecArray): Replacement | null {
  let protocol = matched[1] ?? '';
  let domain = matched[2] ?? '';
  const path = matched[3] ?? '';
  let prefix = '';
  if (!previous(text, matched.index, false)) return null;
  // www 开头没有协议，整段都算域名，跳转时补 http://。
  if (protocol.length > 0 && (protocol[0] === 'w' || protocol[0] === 'W')) {
    domain = protocol + domain;
    protocol = '';
    prefix = 'http://';
  }
  if (!isCorrectDomain(domain)) return null;
  const { core } = splitUrl(domain + path);
  if (core.length === 0) return null;
  return { length: protocol.length + core.length, href: prefix + protocol + core };
}

/** 域名以 -、_ 或数字收尾时不认：这类串多半是版本号/标识符而不是邮箱域。 */
function endsWithBadLabelCharacter(label: string): boolean {
  if (label.length === 0) return false;
  const c = label.charCodeAt(label.length - 1);
  return c === 45 || c === 95 || (c >= 48 && c <= 57);
}

function replaceEmail(text: string, matched: RegExpExecArray): Replacement | null {
  const atext = matched[1] ?? '';
  const label = matched[2] ?? '';
  if (!previous(text, matched.index, true) || endsWithBadLabelCharacter(label)) return null;
  return { length: matched[0].length, href: 'mailto:' + atext + '@' + label };
}

/** 一段没有被链接接管的文本（相对 base 的绝对下标区间）。 */
interface TextPiece {
  start: number;
  end: number;
}

/**
 * 对应安卓 replaceInText：在一个文本节点上跑一趟正则替换。
 * 被拒绝的匹配只把搜索起点后移一格（而不是跳过整个匹配），这样
 * 紧挨着的下一个候选还有机会命中。
 */
function replacePass(
  literal: string,
  base: number,
  pattern: RegExp,
  replacer: (text: string, matched: RegExpExecArray) => Replacement | null,
  links: AutolinkMatch[],
  pieces: TextPiece[],
): void {
  pattern.lastIndex = 0;
  let start = 0;
  let matched = pattern.exec(literal);
  while (matched) {
    const position = matched.index;
    const replacement = replacer(literal, matched);
    if (!replacement) {
      pattern.lastIndex = position + 1;
      matched = pattern.exec(literal);
      continue;
    }
    if (start !== position) pieces.push({ start: base + start, end: base + position });
    const linkEnd = position + replacement.length;
    links.push({
      start: base + position,
      end: base + linkEnd,
      href: replacement.href,
      text: literal.slice(position, linkEnd),
    });
    const matchEnd = position + matched[0].length;
    // 被剥掉的尾随标点在安卓那边是独立的 Text 节点，这里同样单独成段，
    // 好让下一趟（邮箱）把它当成新文本节点的开头来判定前置字符。
    if (linkEnd < matchEnd) pieces.push({ start: base + linkEnd, end: base + matchEnd });
    start = matchEnd;
    pattern.lastIndex = start;
    matched = pattern.exec(literal);
  }
  if (start < literal.length) pieces.push({ start: base + start, end: base + literal.length });
}

/**
 * 语法树层对一段纯文本的处理（对应安卓 GfmAutolinkPostProcessor）：
 * 先跑 URL 一趟，再只在剩余文本上跑邮箱一趟——顺序不能换，
 * 否则 https://a.com/x@y.com 里的邮箱会把 URL 切开。
 */
export function findTransformAutolinks(text: string, base = 0): AutolinkMatch[] {
  const urlLinks: AutolinkMatch[] = [];
  const urlPieces: TextPiece[] = [];
  replacePass(text, base, urlPattern, replaceUrl, urlLinks, urlPieces);
  const emailLinks: AutolinkMatch[] = [];
  for (const piece of urlPieces) {
    replacePass(text.slice(piece.start - base, piece.end - base), piece.start, emailPattern, replaceEmail, emailLinks, []);
  }
  return urlLinks.concat(emailLinks).sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------- 两层叠加

/**
 * 找出一段纯文本里所有的 GFM 字面量自动链接，按出现顺序返回、互不重叠。
 *
 * 词法层先扫一遍拿走它能接管的部分，剩下的文本段再交给语法树层——这正是
 * 安卓/Web 端两层机制作用在同一段文本上的净效果。语法树层按"剩余段"分别处理，
 * 因为在安卓那边它们就是被链接节点切开的独立 Text 节点，前置字符判定以段首为准。
 */
export function findAutolinks(text: string): AutolinkMatch[] {
  const tokenized = findTokenizerAutolinks(text);
  const out: AutolinkMatch[] = [];
  let cursor = 0;
  for (const match of tokenized) {
    if (match.start > cursor) {
      for (const extra of findTransformAutolinks(text.slice(cursor, match.start), cursor)) out.push(extra);
    }
    out.push(match);
    cursor = match.end;
  }
  if (cursor < text.length) {
    for (const extra of findTransformAutolinks(text.slice(cursor), cursor)) out.push(extra);
  }
  return out;
}

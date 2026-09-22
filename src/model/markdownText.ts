/**
 * Markdown 渲染层的两条纯文本口径（抽出来是为了能在 node 里直接测；
 * `markdown.tsx` 带 JSX，测试进程加载不了）。
 */

/** marked 只会写出这几个具名实体；其余具名实体是作者自己写的，保持原样。 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

function safeFromCodePoint(code: number, fallback: string): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

/**
 * 把 marked 写进 token 的 HTML 实体还原成字符。
 *
 * marked 的 lexer 面向 HTML 输出：`inlineText` / `codespan` / `escape` 里的 & < > " '
 * 都被它转义成实体。安卓走 commonmark 的 AST，拿到的是原字符；小程序把 token.text 直接塞进
 * Taro 的 `<Text>`（微信 `<text>` 的 decode 默认是 false），不还原就会把
 * `don&#39;t` / `&quot;hi&quot;` / `a &lt; b` 原样印在屏幕上——凡是正文里出现
 * 撇号、引号、`&`、`<` 的句子都会中招。
 */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 ? safeFromCodePoint(code, whole) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? safeFromCodePoint(code, whole) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/**
 * 可以交给系统打开的外部地址（对齐 Android `isSafeExternalUrl`）。
 *
 * 只放行 http/https/mailto：其余 scheme（javascript:、data:、intent: …）要么打不开，
 * 要么本身就是一段可执行内容，不该表现成一条可点的链接。
 */
export function isSafeExternalUrl(href: string): boolean {
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(href.trim());
  if (scheme === null) return false;
  const name = scheme[1].toLowerCase();
  return name === 'http' || name === 'https' || name === 'mailto';
}

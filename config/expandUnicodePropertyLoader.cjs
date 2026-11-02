/**
 * webpack loader：把 marked 里的 Unicode 属性转义（\p{P} \p{S} \p{L} \p{N}）在构建期展开成
 * 显式码点区间。
 *
 * 为什么需要：marked 12 在**模块加载时**就用 `new RegExp('…[\\p{P}\\p{S}]…', 'u')` 拼出强调
 * 定界符的正则。安卓微信的小程序 JS 引擎不认 Unicode 属性转义，加载 marked 直接抛
 * `SyntaxError: Invalid property name in character class`。marked 只有会话页会用到，于是
 * 会话页模块初始化失败，Taro 生产包的 PageWrapper 又把渲染期异常静默吞成一个空 root——
 * 真机上点进任何会话都是一整页空白，开发者工具（新版 Chromium）却一切正常。
 *
 * 字符串里的 `\\p{P}\\p{S}` 是运行时才拼进正则的，babel 的 regexpu 碰不到，只能在源码层替换。
 * 展开结果用 Node 自带的完整 ICU 现算，与 \p{…} 逐码点等价；替换后若源码里还残留 \p{，
 * 构建直接失败，免得 marked 升级后悄悄回归成真机白屏。
 */
'use strict';

const cache = new Map();

function hex(cp) {
  return cp.toString(16).toUpperCase().padStart(4, '0');
}

/** 一个码点在正则源码里的转义写法（配合 u 标志）。 */
function escapeCodePoint(cp) {
  return cp <= 0xffff ? '\\u' + hex(cp) : '\\u{' + hex(cp) + '}';
}

/**
 * 把若干个 \p{X} 的并集展开成字符类内部的区间串（不含两侧方括号），
 * 返回的是「正则源码」文本，每个转义只带一个反斜杠。
 */
function classBody(properties) {
  const key = properties.join(',');
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const test = new RegExp('[' + properties.map(name => '\\p{' + name + '}').join('') + ']', 'u');
  const parts = [];
  let start = -1;
  for (let cp = 0; cp <= 0x110000; cp += 1) {
    const inside = cp < 0x110000 && !(cp >= 0xd800 && cp <= 0xdfff) && test.test(String.fromCodePoint(cp));
    if (inside && start < 0) start = cp;
    if (!inside && start >= 0) {
      const end = cp - 1;
      parts.push(start === end ? escapeCodePoint(start) : escapeCodePoint(start) + '-' + escapeCodePoint(end));
      start = -1;
    }
  }
  const body = parts.join('');
  cache.set(key, body);
  return body;
}

/** 正则源码 -> 能原样放进 JS 单引号字符串字面量的文本（反斜杠翻倍）。 */
function asStringLiteralBody(regexSource) {
  return regexSource.replace(/\\/g, '\\\\');
}

/**
 * 对 marked 源码做替换；导出给单测直接调用。
 * - 字符串 '\\p{P}\\p{S}'（_punctuation，运行时拼进 new RegExp(…, 'u')）；
 * - 正则字面量 /[\p{L}\p{N}]/u（emStrong 里判前一个字符）。
 */
function expandMarkedSource(source) {
  let out = source.replace(/(['"])\\\\p\{P\}\\\\p\{S\}\1/g, (_match, quote) =>
    quote + asStringLiteralBody(classBody(['P', 'S'])) + quote,
  );
  out = out.replace(/\/\[\\p\{L\}\\p\{N\}\]\/u/g, () => '/[' + classBody(['L', 'N']) + ']/u');
  // 整行注释里提到 \p{…} 不算（marked 自己的注释就有）；代码里残留一个都不放过。
  const code = out.replace(/^[ \t]*\/\/.*$/gm, '');
  const leftover = code.search(/\\\\?p\{/);
  if (leftover >= 0) {
    throw new Error(
      'expandUnicodePropertyLoader: marked 源码里还有未展开的 Unicode 属性转义（真机会白屏）：'
        + JSON.stringify(code.slice(Math.max(0, leftover - 40), leftover + 40)),
    );
  }
  return out;
}

module.exports = function expandUnicodePropertyLoader(source) {
  return expandMarkedSource(source);
};
module.exports.expandMarkedSource = expandMarkedSource;
module.exports.classBody = classBody;

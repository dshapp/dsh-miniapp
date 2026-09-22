# T-markdown-ui：Markdown 渲染管线 / 主题与文案 / 前轮「[~] 结论」复核

- 审计时间：2026-09-22（工作树在审计期间被并发修改过，见「审计基线」）
- 权威参考：`/Users/user/dshapp/dsh-androidapp/app/src/main/java/ai/deepseek/dshphone/`（Kotlin + Compose）
- 待审计：`/Users/user/dshapp/dsh-miniapp/src/`（Taro + React + TS）
- 本轮范围：Markdown/GFM 自动链接管线、Theme/Strings、以及 `docs/DIFF-ANDROID.md` 末尾 40 条 `[~]` 结论的复核
- 本轮**只读**，未修改任何源码。

## 审计基线（重要）

审计过程中 `src/i18n/strings.ts` 被并发改写（读到的 348 行版本在 11:13 变成 361 行版本，`fmt()` 从
只认 %d/%s 换成了支持 %% 与 %02d 的版本）。本报告中所有关于 `fmt()` 的结论已按**改写后**的版本重新核对。
其余被引用文件在审计窗口内 mtime 未变：`src/ui/markdown.tsx`(2026-09-20 23:00)、`src/const.ts`(09-21 02:39)、
`src/ui/cards.tsx`(09-21 02:14)、`src/ui/connectionBanner.tsx`(09-21 03:22)、`src/ui/changedFilesCard.tsx`(09-21 02:47)、
`src/ui/messageRow.tsx`(09-21 15:00)。复核本报告时请先比对 mtime。

方法论说明：对 GFM 自动链接，本轮没有停留在"读代码猜差异"，而是把安卓侧自带的 golden 语料
（`app/src/test/resources/gfm-autolink-golden.json`，10531 条，来自 Web 端 micromark+mdast 的真实输出）
原样喂给小程序实际使用的 `marked@12.0.2`，按与 `GfmAutolinkTest.kt#collect` 相同的收集口径（跳过 image、
记录 link 的 destination + 直属 Text）逐条比对，得到可复现的定量结论。复现脚本思路见 MD-02 附录。

---

## 结论摘要

| 严重度 | 条数 |
| --- | --- |
| P0 | 3 |
| P1 | 6 |
| P2 | 20 |
| 反驳前轮 `[~]` 结论 | 7（2 条"平台限制"站不住脚、2 条"刻意增强"实为与安卓冲突、3 条"等价/档位"实不等价） |

**最重要的 5 条**

1. **MD-01（P0）**：`marked` 的 lexer 会把 `& < > " '` 转成 HTML 实体（`inlineText`/`codespan`/`escape` 内部调 `escape()`），
   而小程序把 token 的 `text` **直接塞进 Taro `<Text>`**（无 HTML 解析；微信 `<text>` 的 `decode` 默认 false）。
   结果：任何带英文撇号/引号/尖括号/`&` 的回复都会在界面上显示成 `don&#39;t` / `&quot;hi&quot;` / `a &lt; b`。
   在 golden 语料上跑一遍，**10531 条里有 2262 条（21.5%）可见文本被污染**。安卓侧 commonmark 输出的是解码后的真字符。
2. **MD-02（P0）**：GFM 自动链接与权威口径**不等价**。安卓用 645 行手工移植 micromark tokenizer + mdast transform 并用
   10531 条 golden 断言"0 差异"；小程序直接用 `marked` 的 `url`/`autolink` 规则。同一语料下
   **1449 条不一致（13.76%）= 587 条误报 + 479 条漏报 + 383 条边界不同**，包含 `ftp://` 被链接化、
   `xhttps://ex.com` 被链接化、`x/a@b.com` 被链接化、IDN 域名（`https://例子.测试/路径`）漏链、嵌套括号被截断等。
3. **TH-01（P0）**：`src/const.ts` 导出的是**写死的浅色**十六进制值，而 `markdown.tsx`/`cards.tsx`/`messageRow.tsx`/
   `changedFilesCard.tsx` 把它们当**行内 style** 用。行内样式覆盖 `.dsh-theme-dark` 的 CSS 变量，
   所以**深色主题下整块 Markdown 正文仍是 `#1f2328` 近黑字**，铺在 `#121417` 的深色页面上 ≈ 不可读。
4. **MD-04（P1）**：安卓的行内代码会按本轮产物词表解析成可点的文件提及
   （`Markdown.kt:581-606` → `TurnDeliverables.resolveMention`）；小程序 `MarkdownView` **完全没有 mentions 入口**，
   改成在助手消息末尾另挂一条 `MentionStrip`（`messageRow.tsx:247-274`）。既是【缺失】又是【多余】。
5. **MD-05（P1）**：安卓对链接做了协议白名单（`GfmAutolink.isSafeExternalUrl`，只放行 http/https/mailto，
   其余**退化为纯文本、不可点**）；小程序对任何 `link` token 都渲染成主色可点，非文件链接一律复制 href，
   所以 `[x](javascript:alert(1))`、`[x](data:text/html,…)` 在小程序里是可点的高亮链接并会把它复制进剪贴板。

---

## 逐条发现

### 任务一：Markdown 与自动链接

---

#### MD-01　marked 的 HTML 实体转义被原样画到屏幕上

- **严重度**：P0（功能性错误，用户可见的乱码，命中率极高）
- **安卓证据**：
  - `ui/component/Markdown.kt:98-100`：`Parser.builder()` + commonmark，commonmark 按 CommonMark 规范在解析期就把
    `&amp;`/`&#65;` 这类实体**解码成真字符**，`MdText.literal` 拿到的是 `&`、`A`。
  - `ui/component/Markdown.kt:579`：`is MdText -> appendRun(current.literal)` —— 直接追加解码后的字面量。
  - `ui/component/Markdown.kt:598`：行内代码 `"\u2009" + current.literal + "\u2009"`，同样是原字符。
- **小程序证据**：
  - `src/ui/markdown.tsx:415`：`<HighlightedText text={textToken.text} …/>` —— 直接画 marked 的 `text`。
  - `src/ui/markdown.tsx:419`：`escape` token 同样直接画。
  - `src/ui/markdown.tsx:440`：`const padded = '\u2009' + codespan.text + '\u2009'` —— 直接画 codespan 的 `text`。
  - `node_modules/marked/lib/marked.cjs:895-910`（`inlineText`）：`text = escape$1(cap[0])`；
    `:793-808`（`codespan`）：`text = escape$1(text, true)`；`:626-633`（`escape`）：`text: escape$1(cap[1])`。
  - 全仓无任何反向解码：`grep -rn "unescape|&amp;" src/` 只命中 `attachmentImage.tsx` 的 `decodeAttachmentRef`（同名不同义）。
- **差异说明**：marked 的设计前提是"lexer 出转义文本 → renderer 拼 HTML 字符串 → 浏览器解码"。小程序跳过了
  renderer 直接画 token，于是转义**没有对应的解码环节**。实测（`marked.lexer` 原始输出）：

  | 源文本 | 安卓显示 | 小程序显示 |
  | --- | --- | --- |
  | `don't stop` | `don't stop` | `don&#39;t stop` |
  | `he said "hi"` | `he said "hi"` | `he said &quot;hi&quot;` |
  | `a < b > c` | `a < b > c` | `a &lt; b &gt; c` |
  | `a & b` | `a & b` | `a &amp; b` |
  | 行内代码 `code & <tag>` | `code & <tag>` | `code &amp; &lt;tag&gt;` |
  | `x &amp; y`（源码就写实体） | `x & y`（commonmark 解码） | `x &amp; y`（原样） |

  表格单元格、标题、引用、任务项正文全部同样受影响（已逐个 token 类型验证）。
  微信 `<text>` 组件的 `decode` 属性默认 `false`，H5 侧 React 也会把文本当纯文本，所以两端都漏。
  代码**块**（fenced/indented）不受影响：marked 的 `fences`/`blockCode` 不调 `escape`。
- **量化**：用 golden 语料跑，10531 条中 **2262 条**（21.5%）的可见文本出现了源文本里没有的
  `&amp;`/`&lt;`/`&gt;`/`&quot;`/`&#39;`。
- **建议改法**：在 `markdown.tsx` 加一个 `unescapeEntities()`，对 `text`/`escape`/`codespan` 三类 token 的
  `text` 统一反解（注意 `&amp;` 必须**最后**替换，否则 `&amp;lt;` 会被二次解码）；
  或者改用自定义 renderer 拿未转义值，或直接换 `micromark`/`mdast` 与 Web 端同源。
  最稳的是前者 + 一条 golden 断言（源文本 → 可见文本恒等，除 Markdown 标记本身）。

---

#### MD-02　GFM 字面量自动链接与安卓/Web 口径不等价（1449/10531 差异）

- **严重度**：P0（协议/渲染口径不兼容；安卓侧有 0 差异的硬断言）
- **安卓证据**：
  - `ui/component/GfmAutolink.kt:18-29`（类注释）：明确声明"与 Web 端逐字符一致（10531 条 golden 用例 0 差异）"。
  - `ui/component/GfmAutolink.kt:111-149` `isTrail`、`:151-179` `parseDomain`、`:181-206` `parsePath`、
    `:208-246` `tryEmail`、`:248-291` `tryProtocol`、`:293-321` `tryWww`、`:338-453` transform 层、
    `:565-628` `gateAllows`（未闭合方括号门禁）。
  - `app/src/test/java/.../GfmAutolinkTest.kt:76-118` `matchesWebGfmAutolinkLiteral`：断言 `linkMismatches == 0`。
- **小程序证据**：
  - `src/ui/markdown.tsx:4,17`：`import { marked } from 'marked'` + `marked.use({ gfm: true })`；全仓无任何自动链接扩展。
  - `node_modules/marked/lib/marked.cjs:857-893`（`url` tokenizer）+ `_backpedal` 正则；`:830-855`（`autolink`）。
  - `package.json`：`"marked": "^12.0.2"`（实际安装 12.0.2）。
- **差异说明**：把 golden 语料的 10531 条 source 喂给 `marked.lexer`，按与 `GfmAutolinkTest.kt#collect` 相同口径
  收集 (href, 直属文本)，结果：

  ```
  total 10531   一致 9082   不一致 1449 (13.76%)
    误报 fp  = 587   （安卓/Web 不认，marked 认）
    漏报 fn  = 479   （安卓/Web 认，marked 不认）
    边界 diff= 383   （都认但切分不同）
  ```

  按规则归类（每类附实测样例，got = 小程序，want = 安卓/Web）：

  | # | 规则 | 样例 source | got | want |
  | --- | --- | --- | --- | --- |
  | a | **前置字符边界**：安卓 `tryProtocol` 要求前一字符不是 ASCII 字母（`GfmAutolink.kt:249`）；marked 的 `url` 正则无此约束 | `see xhttps://ex.com` | `https://ex.com` | 无 |
  | b | **邮箱前不能是 `/`**：`GfmAutolink.kt:210` `prev == 47` 拒绝；`:347-352` `previous(…, email=true)` 同理 | `x/a@b.com` | `mailto:a@b.com` | 无 |
  | c | **协议白名单**：安卓 `tryProtocol` 只认 http/https（`GfmAutolink.kt:264`）；marked 的 `url` 正则含 `ftp` | `ftp://x.com` | `ftp://x.com` | 无 |
  | d | **域名末段校验**：`endsWithBadLabelCharacter`（`GfmAutolink.kt:414-418`）拒绝以数字/`-`/`_` 结尾的标签 | `1@2.3` | `mailto:1@2.3` | 无 |
  | e | **下划线域名限制**：`isCorrectDomain`（`:354-368`）最后两段不得含 `_`；`parseDomain` 的 underscoreLast/underscoreSecondLast（`:156-178`）同理 | `see a@b.com_` | `mailto:a@b.co`（还把域名截断了） | 无 |
  | f | **IDN / 非 ASCII 域名**：安卓 `parseDomain` 只按"空白或 Unicode 标点"断句，不限制 ASCII | `https://例子.测试/路径` | 无（marked 的域名段是 ASCII 字母数字与连字符） | `https://例子.测试/路径` |
  | g | **括号配对**：`parsePath`（`:181-206`）维护 open/close 计数，`splitUrl`（`:370-385`）把配对上的 `)` 收回链接 | `https://ex.com/path_(a(b)c)` | `…/path_(a(b)c`（丢尾括号） | `…/path_(a(b)c)` |
  | h | **实体结尾（`&…;`）**：`isTrail` 的 `c == 38` 分支（`:120-135`）把完整实体判为 trail | `see foo.www.ex.com&x;` | `http://www.ex.com` | `http://www.ex.com&x` |
  | i | **裸 `&` / `>` 结尾** | `see foo.www.ex.com&` | `…ex.com&` | `…ex.com` |
  | j | **`]` 之后的终止判定**：`isTrail` 的 `c == 93` 分支（`:137-144`） | `see https://ex.com](x)` | `https://ex.com](x)` | `https://ex.com` |
  | k | **`www.` 退化形**：transform 在 `www.` 后无内容时仍产出 `http://www` | `see www.` | 无 | `http://www` |
  | l | **URL 里的 `&amp;`**：安卓不解实体再匹配，链接文本保留 `&amp;` | `https://ex.com/path?a=1&amp;b=2` | `…a=1&b=2` | `…a=1&amp;b=2` |

  另外：安卓的"未闭合方括号门禁"（`gateAllows`，`GfmAutolink.kt:565-628`）在小程序侧完全没有对应物；
  marked 用的是 `state.inLink` 一个布尔（`marked.cjs:1578`），语义不同（golden 中 `[a](b[c) https://ex.com` 一类
  用例即由此产生分歧）。
- **建议改法**：三选一，按成本递增：
  (1) 把 `GfmAutolink.kt` 的 tokenizer + transform 逐函数移植成 TS（它本来就是从 JS 移植过去的，回移很直），
      做成 marked 的自定义 inline extension，并**关掉 marked 自带的 url/autolink**；
  (2) 直接依赖 Web 端同款 `micromark-extension-gfm-autolink-literal` + `mdast-util-gfm-autolink-literal`；
  (3) 至少先补最刺眼的四条：协议白名单去掉 ftp、前置 ASCII 字母边界、邮箱前 `/` 拒绝、括号配对。
  无论哪条，都应把 `gfm-autolink-golden.json` 拷进小程序仓库跑同一份断言。
- **复现方式**：加载 golden JSON，对每条 source 跑 `marked.lexer`，按 `GfmAutolinkTest.kt#collect` 的口径
  （跳过 image；link 记 (href, 直属 text 子节点拼接)；递归 blockquote/list/table）收集，与 `cases[i][1]` 比较。

---

#### MD-03　`![alt](shot.png)` 图片语法：安卓能点开系统查看器，小程序只剩 alt 文本

- **严重度**：P1
- **安卓证据**：`ui/component/Markdown.kt:652-670`。`is Image ->` 先 `FileLink.parse(current.destination)`，
  若解析成功且 `ImageFileType.isImage(file.path)`，就 `pushLink(LinkAnnotation.Clickable("image-link"…))`，
  点击回调 `scope.onOpenLink`（最终走 `SystemImageViewer`）。注释明确写着"绝不用文本（alt）去冒充图片"。
  只有**非图片目的地**时才退化为斜体 + muted 的 alt 文本。
- **小程序证据**：`src/ui/markdown.tsx:470-478`。`case 'image'` 无条件返回
  `<Text className={styles.imageAlt} …>{image.text || image.href}</Text>`，既不 `parseFileLink`，也不 `onOpenFileLink`。
  注释写的理由是"小程序里图片加载受业务域名限制"——但这里根本不需要加载远端图片：
  和 `link` 分支一样走 `ctx.onOpenFileLink` → `workspaceFiles/readBytes` 落盘 → `Taro.previewImage` 即可，
  这条链路小程序**已经实现了**（`src/pages/chat/index.tsx:135` 的 `Strings.imageOpenFailed` 即其失败分支）。
- **差异说明**：【缺失】。模型写 `![截图](docs/shot.png)` 时，安卓能点开看图，小程序只显示斜体"截图"。
  附带一条【多余】：alt 为空时小程序回落到显示 `href`（原始路径串），安卓此时渲染为空（无子节点）。
- **建议改法**：`case 'image'` 复用 `link` 分支逻辑 —— `parseFileLink(image.href)` + 图片扩展名判断，
  命中则渲染成可点的斜体链接并调 `ctx.onOpenFileLink`；未命中保持斜体 alt，且 alt 为空时不回落到 href。

---

#### MD-04　行内代码的"产物提及"解析缺失；`MentionStrip` 是小程序自创

- **严重度**：P1
- **安卓证据**：
  - `ui/component/Markdown.kt:156-166`：`MarkdownText(… fileMentions: List<String>, onOpenFile: (String)->Unit …)`。
  - `ui/component/Markdown.kt:581-606`：行内代码先查本轮产物词表
    `TurnDeliverables.resolveMention(current.literal, scope.mentions)`，命中就 `pushLink(LinkAnnotation.Clickable("mention"))`
    并**就地染成主色**；没命中才退到 `FileLink.parseInlineCode` 猜路径。
  - `ui/component/MessageRow.kt:283-284,314-321`：`store.closingMentions(...)` → `fileMentions = mentions` 传进去。
  - `model/Format.kt:389-393`：`resolveMention` = 全路径精确匹配优先，其次 basename 唯一匹配。
- **小程序证据**：
  - `src/ui/markdown.tsx:160-170`：`MarkdownViewProps` 只有 `text/findQuery/findActive/compact/onOpenFileLink`，
    **没有 `fileMentions`/`onOpenFile`**。
  - `src/ui/markdown.tsx:431-450`：`codespan` 只调 `parseInlineCodeFileLink`，没有词表分支。
  - `src/ui/messageRow.tsx:247-274` `MentionStrip`：把 mentions 收成正文**下方**一行 `@basename` 链接；
    注释自认"同事的 MarkdownView 接口没有传 mention 的口子……等 MarkdownView 支持按行内渲染 mention 时，删掉这条即可"。
  - `src/model/format.ts:388-393`：`resolveMention` 已经移植好了，但 `grep -rn "resolveMention" src/` 显示**无人调用**。
- **差异说明**：同时构成【缺失】（行内 mention 不可点、不染色）与【多余】（正文外多一条安卓没有的提及条）。
  语义差别不止是位置：安卓的 basename 唯一匹配意味着行内代码 `shot.png` 能解析到 `docs/shot.png`；
  小程序的 `parseInlineCodeFileLink` 要求"有目录段 + 像样扩展名"（`fileLink.ts:109`），
  所以纯 basename 的行内代码在小程序里永远不可点。
- **建议改法**：给 `MarkdownViewProps` 加 `fileMentions?: string[]` 与 `onOpenFile?: (p: string) => void`，
  在 `codespan` 分支按安卓顺序（词表 → `parseInlineCodeFileLink`）分派，然后删掉 `MentionStrip`。
  `resolveMention` 已经现成。

---

#### MD-05　链接协议白名单缺失：`javascript:` / `data:` 链接在小程序里可点并进剪贴板

- **严重度**：P1
- **安卓证据**：
  - `ui/component/GfmAutolink.kt:34-42` `isSafeExternalUrl`：只放行 http/https/mailto。
  - `ui/component/Markdown.kt:626-651`：文件链接 → 内置预览；`isSafeExternalUrl` → `LinkAnnotation.Url`；
    `else -> walk(current.firstChild)` —— **未知或危险协议按纯文本渲染，既不染色也不可点**，注释写明"对齐 Web 端 sanitizeUrl 返回空串"。
  - `app/src/test/java/.../GfmAutolinkTest.kt:151-160` `onlySafeProtocolsAreTappable`：显式断言
    `javascript:alert(1)`、`data:text/html,x` 为 false。
- **小程序证据**：`src/ui/markdown.tsx:451-469`。`case 'link'` 无条件返回
  `<Text className={styles.link} style={{ color: color_primary }} onClick={…}>`，回调里
  `if (target !== undefined && onOpen !== undefined) onOpen(target); else void copyToClipboard(link.href);`。
  没有任何 scheme 校验；`parseFileLink('javascript:alert(1)')` 会在 `fileLink.ts:83-86` 因非 Windows 盘符而返回
  `undefined`，于是落到 `copyToClipboard('javascript:alert(1)')`。
- **差异说明**：【BUG】。三层差异：(1) 危险协议在安卓上不是链接、在小程序上是主色下划线链接；
  (2) 点击后安卓无任何行为、小程序把它写进系统剪贴板；(3) 安卓对 http/https/mailto 会 `ACTION_VIEW` 打开系统应用，
  小程序只能复制——这一条是真平台限制，可接受，但**不应该顺带把不安全协议也变成"可点"**。
- **建议改法**：在 `case 'link'` 里补 `isSafeExternalUrl(href)`（照抄 `GfmAutolink.kt:35-42`）：
  文件 → 预览；安全协议 → 复制（并提示）；其余 → 渲染成普通文本（去掉 `styles.link` 与 `onClick`）。

---

#### MD-06　BOM（U+FEFF）未剥离

- **严重度**：P2
- **安卓证据**：`ui/component/Markdown.kt:107-111`：定义 `BOM` 常量，`parseMarkdown` 首行
  `if (raw.startsWith(BOM)) raw.substring(1)`，注释"micromark 在 preprocess 阶段会摘掉文档开头这一个字符"。
  `GfmAutolinkTest.kt:33-34` 的 `parse()` 也复制了这一步。
- **小程序证据**：`src/ui/markdown.tsx:26-49` `lex()` 直接 `marked.lexer(text)`，无 BOM 处理。
  实测：BOM 开头的文档会产出一个只含 U+FEFF 的 text token，零宽字符留在正文里。
- **差异说明**：【缺失】。影响面小，但 golden 语料里确实有 BOM 用例。
- **建议改法**：`lex()` 入口加 `if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)`。

---

#### MD-07　表格列宽公式的 clamp 顺序不同，窄表/宽表都对不上

- **严重度**：P2
- **安卓证据**：`ui/component/Markdown.kt:505-513`：
  `(longest.coerceAtMost(26) * 7.6f).dp.coerceIn(48.dp, 200.dp) + 20.dp` —— **先钳位、后加 20**，值域 [68, 220]dp。
  且 `val overflow = total >= available; val widths = if (overflow) raw else raw.map { it * (available / total) }`
  —— **不溢出时把列宽按比例放大铺满整行**。
- **小程序证据**：`src/ui/markdown.tsx:89-97` `columnWidth`：
  `Math.min(200, Math.max(48, Math.min(longest, 26) * 7.6 + 20))` —— **先加 20、后钳位**，值域 [48, 200]。
  `src/ui/markdown.tsx:358-380` `TableView`：恒定 `<ScrollView scrollX>` + `width: totalWidth`，**没有铺满分支**。
- **差异说明**：【BUG（数值）】。两个端点：longest=1 → 安卓 68dp / 小程序 48px；longest=26 → 安卓 217.6dp / 小程序 200px。
  再叠加"窄表不铺满"，一张两列小表在安卓上是通栏的，在小程序上缩在左侧一小块。
- **建议改法**：公式改成 `Math.min(200, Math.max(48, Math.min(longest,26)*7.6)) + 20`；
  并在 `TableView` 里量测容器宽度（`Taro.createSelectorQuery`）或用等比例分配实现"不溢出时铺满"。

---

#### MD-08　表格：短行不补空单元格、表头恒画、分隔线权重不同

- **严重度**：P2
- **安卓证据**：`ui/component/Markdown.kt:521-528`：`if (header.isNotEmpty())` 才画表头行 + 一条全浓度分隔线；
  body 行 `if (index > 0) HorizontalDivider(color = line.copy(alpha = 0.5f))`（**首个 body 行之前不画线**，线色减半）。
  `:540-552` `TableRowView` 按 `widths.forEachIndexed` 遍历**列数**，缺失单元格补空串。
- **小程序证据**：`src/ui/markdown.tsx:366-377`：表头行无条件渲染；每个 body 行都带
  `borderTopWidth: 1 … borderTopColor: color_border`（**首行也画，且与表头线同浓度**）。
  `:390-398` `renderTableRow` 按 `cells.map` 遍历**该行实际单元格数**。
- **差异说明**：【P2 细节】。`cells.map` 这一条在 GFM 下通常无害（marked 会把行补齐/截断到表头列数），
  但 `columns = Math.max(header.length, ...rows.map(r => r.length))`（`markdown.tsx:360`）说明作者自己预期过行长不齐；
  一旦发生，小程序的行会比表短一截而安卓会补空。**待确认**：需构造一条 marked 不补齐的用例才能定性，
  确认方法是用 `marked.lexer` 打印一个"行比表头长/短"的表格看 `rows[i].length`。
- **建议改法**：`renderTableRow` 改成按 `widths.length` 遍历；body 首行不画上边线，其余行线色减半；表头为空时不渲染表头行。

---

#### MD-09　代码块复制按钮形态与文案与安卓不同

- **严重度**：P2
- **安卓证据**：`ui/component/Markdown.kt:324-341`：28dp 圆形点击区，图标 `Icons.Default.ContentCopy` /
  复制后 1.5s 内换成 `Icons.Default.Check`，`contentDescription = Strings.copyAction`，**没有可见文字**。
- **小程序证据**：`src/ui/markdown.tsx:314-318`：`<Text>{copied ? Strings.copied : Strings.copy}</Text>`
  —— 一个带文字的胶囊（`markdown.module.scss:119-131`，`min-width: 44px`）。`Strings.copied` 是小程序自加的键（见 I18-02）。
- **差异说明**：【P2 多余/不一致】。1.5s 复位时长是对齐的（`markdown.tsx:302` vs `Markdown.kt:331`）。
- **建议改法**：改成图标按钮（图标表里 `copy` 与 `check` 都已有），`ariaLabel` 用 `Strings.copyAction`。

---

#### MD-10　`compact` 语义被扩大：安卓只改块间距，小程序连字号一起改；正文基准字号也不同

- **严重度**：P2
- **安卓证据**：`ui/component/Markdown.kt:235-245` `gapBefore(previous, node, compact)` —— `compact` **只**影响块间距；
  正文字号恒为 `bodyStyle()`（`:182-188`，`bodyLarge` = 16sp）。
  `MarkdownText` 的公开签名（`:156-167`）**没有 compact 参数**；只有内部 `ListBlock`/`QuoteBlock` 传 `compact = true`。
  `ui/screen/Sheets.kt:673`：`MarkdownText(it)` —— 后台任务详情用的是普通排版。
- **小程序证据**：`src/ui/markdown.tsx:160-184`：`MarkdownViewProps.compact` 是公开 prop，命中时给根节点加
  `styles.rootCompact`；`src/ui/markdown.module.scss:17-20`：`.rootCompact { font-size: 14px; line-height: 22px; }`。
  `src/ui/sheets.tsx:905`：`<MarkdownView text={item.detail} compact />`。
- **差异说明**：【多余 + 行为差异】。安卓在这个位置是 16sp 正文，小程序是 14px。
  另外正文基准字号本身也不一致：安卓 `bodyLarge` = **16sp**，小程序 `.root` = **15px**（`markdown.module.scss:11`）。
- **建议改法**：`.rootCompact` 只收块间距（已由 `gapBefore` 的 compact 分支负责），去掉字号覆盖；
  `sheets.tsx:905` 去掉 `compact`；`.root` 字号改 16px。

---

#### MD-11　HTML 块里的 `<br>` 处理方向相反

- **严重度**：P2
- **安卓证据**：`ui/component/Markdown.kt:559-560` `strippedHtml`：只做"删掉所有标签 + trim"，`<br>` 不产生换行。
  行内 `HtmlInline` 才有 `<br` → 换行的特判（`:674`）。
- **小程序证据**：`src/ui/markdown.tsx:65-67` `stripHtml`：先把 `<br>` 变成换行再删其余标签；
  这个函数**同时**被块级 `html`（`:258`）与行内 `html`（`:485`）使用。
- **差异说明**：【P2 不一致】。块级 HTML `<p>a<br>b</p>` 在安卓上是 `ab`，小程序上是两行。行内分支反倒是对齐的。
- **建议改法**：块级分支改用"只删标签"的版本，行内分支保留现状。

---

#### MD-12　任务项标记的空白要求不同

- **严重度**：P2
- **安卓证据**：`ui/component/Markdown.kt:105`：`taskMarker` 要求方括号后跟**一个或多个任意空白**（`\s+`）。
- **小程序证据**：靠 marked 的 list tokenizer，其规则要求**恰好一个半角空格**，产出 `item.task/item.checked`，
  `src/ui/markdown.tsx:337-342` 直接消费。
- **差异说明**：【P2】`- [x]<TAB>做完` 在安卓上是勾选项、在小程序上是普通列表项且正文带 `[x]`。
- **建议改法**：在 `ListBlock` 里对 `item.task === false` 的项再跑一次兜底正则，或接受该差异并记录。

---

#### MD-13　`lexCache` 是小程序自加的全局缓存，流式场景会抖动

- **严重度**：P2
- **安卓证据**：`ui/component/Markdown.kt:168`：`val doc = remember(text) { parseMarkdown(text) }` —— 组合级缓存，随节点销毁。
- **小程序证据**：`src/ui/markdown.tsx:23-49`：模块级 `Map<string, TokensList>`，`LEX_CACHE_LIMIT = 64`，按**完整文本**做 key。
- **差异说明**：【多余】。流式输出时每帧文本都不同 → 每帧新增一个 key → 64 条大 token 树常驻并不断淘汰，
  命中率约等于 0 却付出内存代价；而且是跨会话全局的，切会话不释放。不影响正确性，故 P2。
- **建议改法**：删掉（改 `useMemo`），或至少在流式态跳过写缓存。

---

#### MD-14　`try/catch` 降级分支是小程序自加（多余但合理，无需改）

- **严重度**：P2（等价性说明）
- **安卓证据**：`ui/component/Markdown.kt:110-112`：`markdownParser.parse(text)` 无 try/catch。
- **小程序证据**：`src/ui/markdown.tsx:30-42`：`catch` 后伪造一个 paragraph token。
- **差异说明**：【多余但合理】。不改变正常路径语义。无需改。

---

### 任务二：主题与文案

---

#### TH-01　行内样式写死浅色，深色主题在 Markdown / 卡片 / 消息行 / 改动卡上完全失效

- **严重度**：P0
- **安卓证据**：
  - `ui/theme/Theme.kt:46-67`：`LightScheme`/`DarkScheme` + API31+ 的 `dynamicLight/DarkColorScheme`；
    所有组件颜色都从 `MaterialTheme.colorScheme.*` 读，**没有任何一处写死 hex 正文色**。
  - `ui/component/Markdown.kt:229/232/565-567`：`surfaceVariant`/`outlineVariant`/`primary`/`onSurfaceVariant` 全走主题。
- **小程序证据**：
  - `src/const.ts:5-15`：`color_primary='#1c64f2'`、`color_text='#1f2328'`、`color_bg='#f5f6f8'`、
    `color_card='#ffffff'`、`color_border='#e5e7eb'`…… 全是**浅色常量**。
  - `src/styles/theme.scss:10-24`：深色覆盖走的是 `--dsh-color-*` **CSS 自定义属性**。
  - `src/ui/markdown.module.scss:3-6`（注释）："颜色统一由组件从 `src/const.ts` 取常量后走 style 传入" ——
    整张样式表**一个颜色都没有**。
  - 使用点（全是 `style={{...}}` 行内样式，优先级高于任何类选择器与 CSS 变量）：
    `src/ui/markdown.tsx:62`（行内代码底色+字色）、`:108`（标题色）、`:179`（**整块正文 color**）、`:191`、
    `:241-244`（引用底色/竖条/正文）、`:255`（分割线）、`:261`、`:309-315`（代码卡底色/描边/语言标签/复制字）、
    `:321`（代码正文）、`:365-373`（表格描边/表头底/行线）、`:427`（删除线色）、`:462`（链接色）、`:474`（图片 alt 色）。
    另有 `src/ui/cards.tsx:3,377-388,418`、`src/ui/changedFilesCard.tsx:3,87,98-99,108-119,149,161`、
    `src/ui/messageRow.tsx:146,240,266`（`color_primary`/`color_text_sub`）。
    `grep -rln "from '../const'" src/` 命中 4 个 tsx 文件、共 55 处颜色使用。
- **差异说明**：【P0 BUG】。`src/state/theme.ts` 把 `dsh-theme-dark` 挂在页面根上只能改 `var(--dsh-*)`；
  行内 `style` 的层叠优先级最高，**不受该 class 影响**。所以深色主题下：
  - Markdown 正文 `#1f2328`（近黑）铺在 `--dsh-color-bg: #121417` 的深底上 → 基本不可读；
  - 代码卡底色 `#f5f6f8`、表格描边/分割线 `#e5e7eb` 变成深色页面上的亮色色块；
  - 改动文件卡的 diff 上下文行用 `color_text` → 同样近黑不可读（`changedFilesCard.tsx:161`）。
  这也说明 `DIFF-ANDROID.md:252` 宣称"颜色从 Sass 编译期变量改成 `--dsh-*` CSS 自定义属性"的迁移**没有覆盖这 4 个文件**。
- **建议改法**：删掉 `const.ts` 的 `color_*` 导出（或改成 `'var(--dsh-color-text)'` 之类的字符串常量），
  把这 55 处改成类名 + `var(--dsh-*)`；`markdown.module.scss` 恢复写颜色。
  可加一条 lint：`src/ui/**/*.tsx` 里禁止出现 6 位 hex 与 `color_` 导入。

---

#### TH-02　深色 primary 与安卓不一致；浅色一致（并说明"逐 token 对齐"的可行性边界）

- **严重度**：P2
- **安卓证据**：`ui/theme/Theme.kt:46-47`：`LightScheme = lightColorScheme(primary = Color(0xFF1C64F2))`，
  `DarkScheme = darkColorScheme(primary = Color(0xFF7FA8FF))`。
- **小程序证据**：`src/styles/vars.scss:10`：`--dsh-color-primary: #1c64f2`（一致）；
  `src/styles/theme.scss:11`：`--dsh-color-primary: #7aa2f7`（安卓是 `#7FA8FF`）。
- **差异说明**：【P2】。同时要指出一个更大的口径问题：安卓在 **API 31+ 一律用系统动态取色**（`Theme.kt:61-65`），
  `LightScheme/DarkScheme` 只是 API 30 及以下的回退。所以"逐个 token 对齐 Theme.kt"这件事对 primary 之外的
  token（surface / surfaceVariant / outline / errorContainer / primaryContainer …）**在安卓侧根本没有固定值**，
  只能比语义层级、不能比 hex。本报告如实记录这一点，避免后续审计在这上面空转。
- **建议改法**：深色 primary 改 `#7fa8ff`；在 `theme.scss` 顶部注明"安卓 API31+ 走动态取色，本表对齐的是回退方案"。

---

#### TH-03　改动文件卡 / diff 的增删色与安卓不同

- **严重度**：P2
- **安卓证据**：`ui/component/ChangedFilesCard.kt:32-33`：`AddedTint = Color(0xFF2E7D32)`、`DeletedTint = Color(0xFFC62828)`；
  `ui/component/Cards.kt:334-336`（工具 diff 块）：`+` → `Color(0xFF2E7D32)`、`-` → `colorScheme.error`、`@@` → `colorScheme.primary`。
- **小程序证据**：`src/ui/changedFilesCard.tsx:98-99,113-114,161` 用 `color_good = '#16a34a'` / `color_bad = '#dc2626'`（`const.ts:6-7`）；
  `src/ui/cards.tsx:270-275` `diffLineClass` → `cards.module.scss` 的 `.diffAdd/.diffDel/.diffHunk`。
- **差异说明**：【P2】`#2E7D32` vs `#16a34a`、`#C62828` vs `#dc2626`，肉眼可分辨的绿/红偏移。
- **建议改法**：统一到安卓值，或在 `vars.scss` 增加 `--dsh-color-diff-add/-del` 两个专用 token。

---

#### I18-01　`workflowStatusRunning` 中文不一致（267 键中唯一的文案差异）

- **严重度**：P1（用户可见文案）
- **安卓证据**：`i18n/Strings.kt:289`：`pick("Running", "运行中")`。注释（`:288`）指明这是
  "web `workflowRun` 字典的 status.* 五个词（Mac `localizedStatusWord`）"，即有跨端统一口径。
- **小程序证据**：`src/i18n/strings.ts:310`：`workflowStatusRunning: ['Running', '进行中']`。
- **差异说明**：【BUG（文案）】。这是 267 个键逐字比对后**唯一**的文案差异；同组另外四个词（已完成/失败/已取消/已中断）都一致。
- **建议改法**：改成 `'运行中'`。

---

#### I18-02　18 个安卓没有的键（多余），其中 2 个顶替了安卓既有键

- **严重度**：P2（`connectionFailed` 因顶替 `offlineBannerTitle` 升级为 P1，见 UI-01）
- **证据**：脚本比对 `i18n/Strings.kt`（267 键）与 `src/i18n/strings.ts`（285 键）：
  **安卓有而小程序缺：0 个**。小程序多出 18 个：
  `connectionFailed, copied, copyFailed, serversEmpty, commands, attachFile, restored, connection,
  connectionStateLabel, sendFailed, backToParent, restoreConfirm, preview, noPreview, loadMore,
  statusLoading, moveWorkspaceBefore, listEnd`。
- **差异说明**：大多数是小程序特有交互的读屏标签/toast（合理）。两个例外：
  - `connectionFailed`（"连不上主机"）与安卓 `offlineBannerTitle`（"无法连接到电脑"）**语义重复但文案不同**，
    且实际顶替了后者的位置 → 见 UI-01；
  - `statusLoading`（"加载中…"）顶替了安卓改动卡里的 `CircularProgressIndicator` → 见 UI-03。
- **建议改法**：`connectionFailed` 删除并改用 `offlineBannerTitle`；其余保留，但在 `strings.ts` 用注释分区标出"小程序特有"。

---

#### I18-03　`fmt()` 的 `%%` 与 `%02d`（审计窗口内被并发修复，复核通过）

- **严重度**：P2（记录用；当前版本已对齐）
- **安卓证据**：`i18n/Strings.kt:343-344`：`String.format(Locale.ROOT, template, *args)`，
  天然支持 `%%`（→ `%`）与 `%02d`（补零）。用到它们的模板：`contextAria = "上下文已用 %d%%"`（`:203`）、
  `durationMinutes = "%d分%02d秒"`（`:269`）。
- **小程序证据**：
  - 旧版本（审计开始时读到的 348 行版）：`fmt` 只认 `%d`/`%s` —— `%%` 不折叠、`%02d` 完全不匹配，
    `formatDuration`（`src/model/format.ts:14`）会输出 "2分%02d秒"。
  - 当前版本 `src/i18n/strings.ts:352-361`：正则已扩到 `%%` 与带宽度/补零的 `%0Nd`，并实现了补位分支。
- **复核结论**：**当前等价**。另需注意 `contextAria` 两端都不走 `fmt` 而是 `split('%d%%')`
  （`Sheets.kt:299` vs `sheets.tsx:418`），本来就绕开了 `fmt`，等价。
- **建议**：补单测固定 "2分05秒" 与 "上下文已用 42%"，防止回退。

---

### 任务二附带：本轮范围内其余组件的逐函数核对

---

#### UI-01　连接提示条：失败态用了 `connectionFailed` 而非 `offlineBannerTitle`；重连态文案与安卓相反

- **严重度**：P1
- **安卓证据**：`ui/component/ConnectionBanner.kt:147-154` `offlineBanner()`：`title = Strings.offlineBannerTitle`（"无法连接到电脑"）。
  `:136-143` `connectingBanner()`：`title = Strings.statusConnecting`（"连接中…"），
  且 `:124` 明确把 `WsConnectionState.RECONNECTING` 也映射到这里，`:122-123` 注释说明这是**刻意**的
  ——"给'连接中'的中性提示条……否则用户会以为已经没救了，去做多余的操作"。
  `Strings.reconnecting` 在安卓只用于列表页的状态点（`ui/screen/SessionListScreen.kt:469`），**不用于提示条**。
  `offlineBannerTitle` 同时还是列表页空态的标题（`SessionListScreen.kt:909`），两处必须是同一句话。
- **小程序证据**：`src/ui/connectionBanner.tsx:26-38` `toneLabel`：
  `'reconnecting' → Strings.reconnecting`（"重连中…"）、`'failed' → Strings.connectionFailed`（"连不上主机"）。
  而 `src/pages/index/index.tsx:475` 的空态用的仍是 `Strings.offlineBannerTitle` —— **同一故障在横幅和空态里成了两句话**。
- **差异说明**：【BUG（文案）】。另有两条 P2 附带差异：
  (a) 安卓横幅带图标（`Icons.Default.Sync` / `Icons.Default.WarningAmber`，`ConnectionBanner.kt:137,148`），
      小程序画的是一个纯色圆点（`connectionBanner.tsx:81` `styles.dot`）；
  (b) 安卓整条胶囊都是重试点击区（`ConnectionBanner.kt:197` `Modifier.clickable(enabled = info.canRetry …)`），
      小程序只有右侧"重试"小块可点（`connectionBanner.tsx:83-87`）；
  (c) 安卓的"已滑走"按状态 key 记忆、恢复健康时才清（`:78-82`），小程序在 `props.detail` 变化时也会重置
      （`connectionBanner.tsx:56-61` 的依赖数组含 `props.detail`），持续离线且 detail 抖动时会把用户滑掉的横幅重新弹回来。
- **建议改法**：`'failed' → Strings.offlineBannerTitle`、`'reconnecting' → Strings.statusConnecting`、删除 `connectionFailed` 键；
  圆点换成 `refresh-cw` / `triangle-alert` 图标；整条胶囊可点；`useEffect` 依赖去掉 `props.detail`。

---

#### UI-02　`NoticeRow` 丢掉了按节点类型区分的图标，5 种通知行退化成 3 个图标

- **严重度**：P1
- **安卓证据**：`ui/component/MessageRow.kt:73-79` —— 图标由**调用方按节点类型**给：
  `TurnError → Icons.Default.Warning`（error 色）、`Compaction → Icons.Default.UnfoldLess`、
  `ModelRetry → Icons.Default.Refresh`（`Color(0xFFE08600)`）、`TurnMaxTokens → Icons.Default.ErrorOutline`（`0xFFE08600`）、
  `Command → Icons.AutoMirrored.Filled.KeyboardArrowRight`（默认 `DshChrome.label`）。
  `ui/component/Cards.kt:187-198` `NoticeRow(icon, text, tint, detailed)` 原样透传。
- **小程序证据**：`src/ui/cards.tsx:390-401` `noticeIcon(tone)` —— 图标**只由 tone 决定**：
  `info→'info'`、`warning→'triangle-alert'`、`error→'x'`、`success→'check'`。
  `src/ui/messageRow.tsx:770-778` 的实际调用：
  `turnError→tone="error"`、`compaction→"info"`、`modelRetry→"warning"`、`maxTokens→"warning"`、`command→"info"`。
- **差异说明**：【缺失】。落地效果：

  | 节点 | 安卓图标 | 小程序图标 |
  | --- | --- | --- |
  | TurnError | Warning（警告三角） | x（叉） |
  | Compaction | UnfoldLess（折叠） | info |
  | ModelRetry | Refresh（环形箭头） | triangle-alert |
  | TurnMaxTokens | ErrorOutline | triangle-alert |
  | Command | KeyboardArrowRight（右尖括号） | info |

  "上下文已压缩"和"/命令"共用一个 info、"模型重试"和"达到长度上限"共用一个 triangle-alert，信息量被抹平。
  色值也不同：安卓 ModelRetry/MaxTokens 用 `Color(0xFFE08600)`，小程序 `color_warning = #d97706`。
- **建议改法**：给 `NoticeRow` 增加 `icon?: LucideIconName`（tone 只管颜色），在 `messageRow.tsx:770-778` 逐个指定：
  `triangle-alert / chevrons-down-up / refresh-cw / circle-alert / chevron-right`
  （`refresh-cw`、`chevron-right`、`circle-alert`、`triangle-alert` 已在图标子集里，只需补 `chevrons-down-up`）。

---

#### UI-03　改动文件卡：展开箭头方向反了、读数反馈时序不同、`oversized` 尾注缺失

- **严重度**：P2
- **安卓证据**：
  - `ui/component/ChangedFilesCard.kt:105-109`：展开时 `Icons.Default.ExpandLess`（**向上**），
    收起时 `Icons.Default.ExpandMore`（**向下**）。
  - `:186-197`：**点了立刻开对话框**，`diff == null` 时在对话框里画 `CircularProgressIndicator`。
  - `:240`：`if (file.oversized) Text(Strings.changedFilesOversized …)` —— diff 正文**末尾**还要再标一次。
  - `:73`：头部图标 `Icons.Default.FolderOpen`。
- **小程序证据**：
  - `src/ui/changedFilesCard.tsx:126`：`expanded ? 'chevron-down' : 'chevron-right'` —— 展开向下、收起向右，**两个状态都不同**。
  - `:72-91`：先 `setPendingPath` 在行下面插一行 `Strings.statusLoading` 文字，`loadDiff` 完成后才 `openCardDetail`。
  - `:139-171` `DiffBody(props: { diff })` —— 没有 `file` 参数，**丢了末尾的 oversized 尾注**。
  - `:96`：头部图标 `'folder-tree'`。
- **差异说明**：【P2 ×3 + 1 缺失】。箭头方向是纯错（`chevron-up` 已在图标子集里）；
  "先转圈再开弹层"与安卓"先开弹层再转圈"在慢网络下体感差异明显；`oversized` 尾注是【缺失】。
  注：`DIFF-ANDROID.md:282` 声称"读数时行上转圈"，实际落地是一行 `Strings.statusLoading` 文字，不是转圈。
- **建议改法**：箭头改 `expanded ? 'chevron-up' : 'chevron-down'`；`openCardDetail` 先开、内容用一个自己 `loadDiff` 的子组件；
  `DiffBody` 接 `file` 并补尾注。

---

#### UI-04　工具行状态图标：安卓换首图标，小程序加尾图标

- **严重度**：P2
- **安卓证据**：`ui/component/Cards.kt:400-421`：`ERROR → Icons.Default.Warning`、`STOPPED → Icons.Default.PauseCircle`，
  否则 `toolVariantIcon(variant)`；`RUNNING` 时 `CardRow` 的**首图标位**换成 `CircularProgressIndicator`（`Cards.kt:70-78`）。
  行尾只有可选的 `suffix` 文本，**没有状态图标**。
- **小程序证据**：`src/ui/cards.tsx:201`：首图标恒为 `toolVariantIcon(model.variant)`；
  `:206`：行尾额外画一个 `stateIcon(model.state)`（`loader-circle/check/x/square`，`:32-43`）。
- **差异说明**：【多余 + 缺失】。小程序每一行都多一个尾部图标（安卓没有），同时失败/暂停时首图标不变（安卓会变）。
- **建议改法**：按安卓改 —— 首图标按 state 分派、running 用 `loader-circle` spin、去掉尾部 stateIcon。

---

#### UI-05　工具变体图标语义映射偏离（`edit→剪刀`、`code→拼图`）

- **严重度**：P2
- **安卓证据**：`ui/component/Cards.kt:369-377`：`BASH→Terminal, READ→Article, SEARCH→Search,
  WRITE→NoteAdd, EDIT→Edit（铅笔）, CODE→Code（尖括号）, OTHERS→Build（扳手）`。
- **小程序证据**：`src/ui/cards.tsx:54-71`：`bash→terminal, read→file-text, search→search,
  write→file-pen, edit→scissors（剪刀）, code→puzzle（拼图）, others→wrench`。
- **差异说明**：【P2】前 4 个与最后 1 个语义相当；`edit→剪刀`、`code→拼图` 不相当。
  关键证据：`src/ui/lucideIcons.ts` 的图标子集里**已经收录了 `pencil`**（构建脚本 `scripts/build-icons.mjs` 可随时加 `code`），
  所以这不是"图标表里没有"的限制。同时构成对 `DIFF-ANDROID.md:369` C-71 的反驳（见 RB-01）。
- **建议改法**：`edit → 'pencil'`，`code → 'code'`（补进图标子集后重跑 `build-icons.mjs`）。

---

#### UI-06　`ThinkCard` 详情：安卓是纯文本，小程序按 Markdown 渲染

- **严重度**：P2
- **安卓证据**：`ui/component/Cards.kt:167-171`：`CardDetailDialog(…) { SelectionText(text) }`；
  `SelectionText`（`:175-183`）就是一个 `Text`，**不过 Markdown 解析**。
  对照：`ui/screen/Sheets.kt:673,804` 才用 `MarkdownText` —— 说明作者是**有意**区分的。
- **小程序证据**：`src/ui/cards.tsx:111`：`content: <MarkdownView text={text} findQuery={…} findActive={…} />`。
- **差异说明**：【多余/行为差异】。推理文本常含未闭合的 `**`、裸 `#`、代码围栏片段，按 Markdown 渲染会
  把这些标记吃掉或误排版，与安卓"原样看思考过程"的口径冲突；且叠加 MD-01 会在思考全文里塞满实体乱码。
  同理 `ContextRow`（`messageRow.tsx:374-376`）与 `NoticeRow`（`cards.tsx:413`）用的是纯 `Text`，这两处是对的。
- **建议改法**：`ThinkCard` 的 `content` 换成纯 `<Text …userSelect>{text}</Text>`。

---

#### UI-07　图片结果的附带文本取法不同（待确认）

- **严重度**：P2（**待确认**）
- **安卓证据**：`ui/component/Cards.kt:268-269`：`val text = imageTexts(result.content) ?: toolResultText(result);
  if (text.isNotEmpty()) MonospaceBlock(text)`。
- **小程序证据**：`src/ui/cards.tsx:320-322`：
  `result.content.some(block => block.kind === 'text') ? <MonospaceBlock text={toolResultText(result)} /> : null`
  —— 没有调用 `imageTexts`（该函数在 `src/model/imageCards.ts` 里存在且已导出）。
- **差异说明**：**待确认**。若 `imageTexts` 与 `toolResultText` 在"有 text 块"时返回相同内容则等价；
  若 `imageTexts` 只取与图片相邻的那一段，则两端内容不同。
  确认方法：比对 `model/ImageBlocks.kt#imageTexts` 与 `src/model/imageCards.ts#imageTexts` 的实现，
  或构造 content = [text, image, text] 的工具结果看两端输出。
- **建议改法**：确认后统一为 `imageTexts(content) ?? toolResultText(result)` 再判空。

---

#### UI-08　`projectUserRefs`：wire 形式缺少"前置空白"边界检查

- **严重度**：P2
- **安卓证据**：`ui/component/UserRefProjection.kt:30-42`：主循环第一行就是
  `if (text[index] != '@' || (index > 0 && !text[index - 1].isWhitespace())) { index += 1; continue }`
  —— **wire 形式 `@[标题](dsh-session:…)` 与标题匹配共用同一个前置边界**。
- **小程序证据**：`src/model/userRefs.ts:13,57-68`：`WIRE_RE` 直接全局 `exec`，**没有前置字符检查**；
  只有标题匹配那一路（`:74`）检查了 `before`。
- **差异说明**：【P2 BUG】`见a@[标题](dsh-session:xxx)` 在安卓上是纯文本，在小程序上会被折成一个可点的会话引用。低频但真实不一致。
- **建议改法**：`WIRE_RE.exec` 命中后加"前一字符必须是空白或位于行首"的判断再 push。

---

#### UI-09　`splitHighlight` / `appendFindHighlighted` 等价（无需改）

- **严重度**：等价
- **证据**：`ui/component/FindHighlight.kt:41-58` vs `src/ui/findHighlight.tsx:18-38`：
  `trim()` → 空则整段返回、大小写不敏感、`while (start <= length)`、不重叠推进、末尾补尾巴 —— 逐行同构。
  一点理论差异：安卓用 Kotlin `indexOf(ignoreCase = true)`（区域无关），小程序用 `toLowerCase()`
  （对土耳其语 I 等有差异）—— 界面语言只有中/英，**实际等价**。

---

#### UI-10　`EmptyState` 多一个 action 按钮槽位

- **严重度**：P2
- **安卓证据**：`ui/component/EmptyState.kt:20-38`：只有 icon / title / description，无按钮。
- **小程序证据**：`src/ui/emptyState.tsx:9-28`：多 `actionText / onAction`。
- **差异说明**：【多余】。仅当调用方真的传了才出现；是否造成安卓没有的按钮需逐调用点核对（属前轮 A 区范围，本轮未核）。低风险。

---

#### UI-11　`SystemImageViewer` 的小程序对应物（等价 / 待确认一处）

- **严重度**：等价（含一处待确认）
- **证据**：`ui/component/SystemImageViewer.kt:34-80`（缓存落盘 → FileProvider → `ACTION_VIEW`，保留最近 8 个文件）
  对应小程序的 `workspaceFiles/readBytes` 分片落盘 + `Taro.previewImage`（`DIFF-ANDROID.md:260` B-D30，已做）。
  `stagedImageFileName`（`:92-102`：basename + 路径哈希 + 扩展名，防 `a/shot.png` 与 `b/shot.png` 互相覆盖）
  这条**去重规则**在小程序侧是否有等价实现，本轮未核 —— **待确认**，
  确认方法：看 `pages/chat/index.tsx` 落盘时的文件名构造是否带路径哈希。

---

## 任务三：对 `DIFF-ANDROID.md` 末尾 40 条 `[~]` 的复核与反驳

> 只列**结论站不住脚**的 7 条。其余 33 条本轮未发现反证（不等于全部正确，只是本轮范围内没有反证）。

---

#### RB-01　C-71"图标语义映射相近（等价）"——不成立

- **原结论**：`DIFF-ANDROID.md:369`，归入"三、逐条核对后确认等价"。
- **反驳证据**：`Cards.kt:374` `EDIT -> Icons.Default.Edit`（铅笔）对上 `cards.tsx:66` `'scissors'`（剪刀）；
  `Cards.kt:375` `CODE -> Icons.Default.Code`（尖括号）对上 `cards.tsx:68` `'puzzle'`（拼图）。
  更关键的是 `src/ui/lucideIcons.ts` 的子集里**已经收录了 `pencil`**，
  且图标子集由 `scripts/build-icons.mjs` 生成（`DIFF-ANDROID.md:270` 自己写了"补了 bell/book-open/camera/list/move-right 并重跑"），
  所以"没有更贴的图标可用"这个隐含前提不成立。
- **改判**：不是【等价】，是【P2 不一致】。见 UI-05。

---

#### RB-02　C-16"占用入口显示百分比数字（安卓画 canvas 弧，小程序难稳定画 arc）"——理由站不住脚，且定性错误

- **原结论**：`DIFF-ANDROID.md:358`，归入"二、小程序端的刻意增强"。
- **反驳证据**：
  - 安卓侧确有弧：`ui/screen/ComposerBar.kt:373-374` `ContextRing(occupancy.percent)`、
    `:597-609` `androidx.compose.foundation.Canvas(Modifier.size(18.dp)) { drawArc(…) }`。这部分描述属实。
  - 但"小程序难稳定画 arc"不成立：微信 `<canvas type="2d">` 提供标准 Canvas 2D 上下文，
    `ctx.arc()` 自基础库 2.9.0 起就是稳定 API，Taro 也直接透出 `Canvas` 组件。
    仓库里**根本没有尝试过**：`grep -rn "Canvas" src/` 在 `sheets.tsx` 只命中 occupancy 的纯文本行，无任何 canvas 用法。
  - 定性也不对：把一个**图形指示**换成**数字**是视觉降级，不是"增强"。
- **改判**：不是【刻意增强】，是【P2 缺失】。修法：18px 的 `<Canvas type='2d'>` + `arc`，
  或用 `--dsh-color-primary` 的两段遮罩实现环形。
  **待确认**：低端机上 18px canvas 的绘制抖动需真机实测（开发者工具 + 一台安卓真机跑一次即可）。

---

#### RB-03　C-42"主机没发 deliverables 时从工具参数兜底推断产物（刻意增强，与安卓不冲突）"——与安卓冲突

- **原结论**：`DIFF-ANDROID.md:362`。
- **反驳证据**：安卓的产物提及口径是**严格词表**：`model/Format.kt:389-393` `resolveMention` 只在
  `paths.contains(value)` 或 basename 唯一匹配时返回；`Markdown.kt:582-584` 注释明确
  "先看本轮产物词表（Web 的 fileMentions 口径）"。安卓唯一的"猜"发生在**词表命中失败之后**，
  且限定为 `FileLink.parseInlineCode`（`FileLink.kt:96-125`，注释写死"Web 端只认词表、不猜路径…… 所以这里在**明确无歧义**时才认"）。
  也就是说安卓的兜底作用域是"**单个行内代码 token 是否像路径**"，不是"从工具参数反推本轮产物清单"。
  从工具参数推断会让"产物"一栏出现主机没承认的文件 —— 这是**口径冲突**，不是增强。
- **改判**：不是【刻意增强】，是【多余（与安卓冲突）】。
  **待确认**：需要看 `src/state/sessionStore.ts` 里 deliverables 推断的具体实现才能定严重度（本轮该文件不在范围内）。
  建议要么去掉，要么在 UI 上把"推断产物"与"主机确认产物"区分开。

---

#### RB-04　C-02"键盘/安全区：无法像 Android 那样用 imePadding() 精确控制（平台限制）"——理由不完整

- **原结论**：`DIFF-ANDROID.md:351`，归入"一、平台限制"。
- **反驳证据**：`grep -rn "onKeyboardHeightChange" src/` **无命中**；仓库只用了
  `src/ui/composerBar.tsx:894` 的 `adjustPosition`（`Textarea` 自带的粗粒度上推）与 `src/framework/hook.ts:57` 的 `safeArea`。
  微信提供 `wx.onKeyboardHeightChange`（回调带精确键盘高度与动画时长），Taro 亦透出；
  用它给容器加 `padding-bottom` 就是 `imePadding()` 的等价物。"无法精确控制"是"没做"，不是"做不到"。
- **改判**：不是【平台限制】，是【P2 缺失】。
  **待确认**：`adjustPosition` 与手写 padding 会互相打架，改法需先关掉 `adjustPosition`，建议真机验证后再定。

---

#### RB-05　A-32"ScrollView 没有虚拟化（平台限制）"——表述不准确

- **原结论**：`DIFF-ANDROID.md:350`，归入"一、平台限制"。
- **反驳证据**：Taro 官方提供 `VirtualList`（`@tarojs/components-advanced`），微信原生亦有
  `recycle-view` 自定义组件与 Skyline 下的虚拟滚动能力。
  `package.json` 的依赖列表里没有 `@tarojs/components-advanced`，说明**没有评估过**这条路。
- **改判**：不是【平台限制】，是【P2 待办（性能）】。严重度低（分页已缓解），
  但归档进"平台限制"会阻止后续优化。**待确认**：是否值得改取决于实际会话条数量级，需产品侧给数。

---

#### RB-06　"三、逐条核对后确认等价"这一档遗漏了整条 Markdown 管线——档位本身站不住脚

- **原结论**：`DIFF-ANDROID.md:367-370` 列了 16 条"确认等价"；四个审计区（A/B/C/D）**没有任何一条覆盖
  `Markdown.kt` / `GfmAutolink.kt` 的语法支持面与自动链接口径**（`docs/audit/B-chat-transcript.md` 的 45 条里
  与 Markdown 相关的只有渲染位置 D15/D16、图片 D14、查找高亮 D6）。
- **反驳证据**：本报告 MD-01（2262/10531 文本污染）与 MD-02（1449/10531 链接口径差异）都是**可定量复现**的不等价，
  而安卓侧自带断言这两件事必须 0 差异（`GfmAutolinkTest.kt:118`）。前轮把 Markdown 当成"用了 marked，GFM 都支持"一笔带过。
- **改判**：Markdown 管线不属于"已确认等价"，应作为独立条目进入待办，并把
  `app/src/test/resources/gfm-autolink-golden.json` 引入小程序侧回归。

---

#### RB-07　D-25 / C-10 "原生控件差异：`wx.showModal` / `showActionSheet` 功能等价"——需要补一条限制说明

- **原结论**：`DIFF-ANDROID.md:348`，归入"一、平台限制 · 原生控件差异……功能等价"。
- **反驳证据（部分）**：
  - `wx.showActionSheet` **无法显示"当前已选中"的勾**，而安卓的权限/排序类 DropdownMenu 会标出当前项
    （前轮自己在第四批里为设置页补了"选中勾"，说明这个能力差异是被认识到的）。
    因此凡是用 ActionSheet 替代"单选菜单"的地方（C-10 权限下拉、A-02 视图选项），
    **当前选中项不可见**，与安卓不等价。
  - `wx.showModal` 的 `editable` 输入框没有"脚注/说明文字"槽位 —— 这一点仓库自己已经承认并绕过
    （`src/pages/pairing/index.tsx:106` 与 `pairing/index.module.scss:110` 的注释："showModal 装不下脚注"）。
- **改判**：不是无条件【功能等价】，而是【P2 缺失（选中态不可见）】+ 已知的布局限制。
  **待确认**：需逐个 `wx.showActionSheet` 调用点核对是否为"单选菜单"语义（本轮 C 区不在范围内，未逐点核）。
  修法：单选语义的菜单改用自绘底部弹层（仓库已有 `sheets.tsx` 的弹层外壳），在选中项后画勾。

---

## 已核对确认等价的清单（避免后续重复审计）

| # | 主题 | 安卓 | 小程序 | 结论 |
| --- | --- | --- | --- | --- |
| E-01 | 块间距 `gapBefore` 数值表 | `Markdown.kt:235-245` | `markdown.tsx:115-142` | 等价（heading 10/18/15、hr 14、code/table/quote 10、list 6/8、para 6/10、default 8、compact ×0.55 下限 4）。唯一细节：紧列表项在安卓是 Paragraph(10)、marked 是 text(default 8) |
| E-02 | 层级项目符号 | `Markdown.kt:355-359` | `markdown.tsx:70-75` | 等价（三种字形、depth%3、深度传递口径一致） |
| E-03 | 有序列表起始序号 | `Markdown.kt:281` `markerStartNumber ?: 1` | `markdown.tsx:332,345` | 等价 |
| E-04 | CJK 视觉宽度 | `Markdown.kt:455-458` | `markdown.tsx:78-87` | 等价（0x2E80-0xD7A3 / 0xF900-0xFAFF / 0xFF00-0xFF60 记 2） |
| E-05 | 单换行保留为换行 | `Markdown.kt:671-673` SoftLineBreak | `markdown.module.scss:23-27` `white-space: pre-wrap` | 等价（形式不同，语义一致） |
| E-06 | 硬换行 | `Markdown.kt:673` HardLineBreak | `markdown.tsx:479-481` `case 'br'` | 等价 |
| E-07 | 行内 `<br>` | `Markdown.kt:674` | `markdown.tsx:484` | 等价 |
| E-08 | 代码块语言取首词并小写 | `Markdown.kt:275` + `:317` | `markdown.tsx:307` | 等价（安卓按空格切、小程序按空白切，仅 tab 分隔时有别） |
| E-09 | 代码块去尾换行 | `Markdown.kt:274` `trimEnd` | `markdown.tsx:236` | 近等价（安卓去掉全部尾换行、小程序只去一个；marked 的 `code.text` 本身已去尾） |
| E-10 | 行内代码窄空格内衬 | `Markdown.kt:597-598` | `markdown.tsx:439-440` | 等价（U+2009 两侧各一个） |
| E-11 | 标题字号/字重/5-6 级降色 | `Markdown.kt:191-218` | `markdown.module.scss:29-63` + `markdown.tsx:107-109` | 等价（21/19/17/16/15/15；700/700/600/600/600/600；≥5 级用 sub 色） |
| E-12 | 引用块形态 | `Markdown.kt:427-448` | `markdown.tsx:238-249` + scss `:186-204` | 等价（3px 竖条 + 底色 + 正文降档色 + compact 递归） |
| E-13 | 表格单元格对齐 | `Markdown.kt:480-484` | `markdown.tsx:100-104` | 等价 |
| E-14 | 列表/JSON/diff/read 的截断上限 | `Cards.kt:250(200)/:299(400)/:328(400)` | `cards.tsx:27-29` | 等价（200/400/400） |
| E-15 | JSON 树：对象键排序、深度 0 默认展开 | `Cards.kt:205,228` | `cards.tsx:441,466-468` | 等价 |
| E-16 | 工具卡子调用深度上限 8 | `Cards.kt:425,447` | `cards.tsx:128,179,212` | 等价 |
| E-17 | `FileLink.parse` 全套 | `model/FileLink.kt:65-207` | `src/model/fileLink.ts:68-159` | 等价（逐函数同构：`fileAddress`/行号锚点/`?` 拒绝/resource 的 session+absolute+UNC+盘符/`file:` 归一/`+` 保护后解码） |
| E-18 | `FileLink.parseInlineCode` | `FileLink.kt:106-125` | `fileLink.ts:99-116` | 等价（空白拒绝、`//` 拒绝、需目录段 + ≤8 位字母数字扩展名） |
| E-19 | 查找高亮切分算法 | `FindHighlight.kt:41-58` | `findHighlight.tsx:18-38` | 等价 |
| E-20 | `projectUserRefs` 标题最长优先 + 前后空白边界 | `UserRefProjection.kt:26,43-46` | `userRefs.ts:70-81` | 等价（wire 分支例外，见 UI-08） |
| E-21 | `dsh-session:` base64url 解码 | `UserRefProjection.kt:80-87` | `userRefs.ts:23-44` | 等价（自写 base64url 解码，非法字符返回空） |
| E-22 | i18n 键集合完整性 | `Strings.kt` 267 键 | `strings.ts` 285 键 | 等价（**0 缺失**；18 个多余见 I18-02） |
| E-23 | i18n 双语文案逐字 | `Strings.kt` | `strings.ts` | 等价（267 键中 266 键逐字一致；唯一例外 `workflowStatusRunning`，见 I18-01） |
| E-24 | i18n 占位符形状/数量/顺序 | `Strings.kt` 29 个含占位符的键 | `strings.ts` | 等价（逐键比对占位符序列完全一致） |
| E-25 | `fmt()` 行为 | `Strings.kt:343-344` | `strings.ts:352-361`（当前版本） | 等价（见 I18-03 的版本说明） |
| E-26 | `Dimens` 13 项 | `Theme.kt:17-32` | `const.ts:18-33` | 等价 |
| E-27 | `CHANGED_FILES_SHOWN = 3` 与展开文案计数 | `ChangedFilesCard.kt:30,96-116` | `changedFilesCard.tsx:16,70,124-133` | 等价 |
| E-28 | hunk 头格式 | `ChangedFilesCard.kt:221` | `changedFilesCard.tsx:154` | 等价 |
| E-29 | `diffText` 摊平规则 | `Cards.kt:344-350` | `cards.tsx:256-267` | 等价（str → arr 的 patch/text → 标量兜底） |
| E-30 | 连接条"上滑 24dp 关闭""仅 failed 给重试""底层异常只进日志" | `ConnectionBanner.kt:104,152,65` | `connectionBanner.tsx:41,67,60` | 等价（文案/图标/点击区不等价，见 UI-01） |
| E-31 | 脚注 / 定义列表 / 标题锚 | commonmark 只装 Tables + Strikethrough（`Markdown.kt:99`） | marked 核心同样不支持 | 等价（两端都不支持） |
| E-32 | Setext 标题 / 引用嵌套 / 链接引用定义 | commonmark 支持 | marked 支持；`def` token 被 `renderBlock` 的 default 分支静默跳过 = 不渲染（正确） | 等价 |
| E-33 | 单波浪线删除线 `~x~` | commonmark `StrikethroughExtension`（是否要求双波浪线未核） | marked GFM 允许单波浪线 | **待确认**：跑一条 `~x~` 用例即可定性 |

---

## 本轮未覆盖 / 明确留给后续的点

1. `markdown.module.scss` 与 `findHighlight.module.scss` 的高亮配色是否与 `DshFind` 三色（`#FFFF00` / `#FF9632` / `#33FF9632`）一致
   （前轮 B-D6 已改，本轮未复核）。
2. `model/ImageBlocks.kt#imageTexts` vs `src/model/imageCards.ts#imageTexts`（UI-07 的定性）。
3. `SystemImageViewer.stagedImageFileName` 的"路径哈希防同名覆盖"在小程序落盘侧是否有等价实现（UI-11）。
4. `ComposerBar.kt` 的补全触发条件 vs `src/state/composer.ts`（C-35"中间补全"的定性，本轮不在范围内）。
5. `state/sessionStore.ts` 的 deliverables 推断实现（RB-03 的严重度定级）。
6. 所有 `wx.showActionSheet` 调用点是否为单选语义（RB-07 的逐点核对）。

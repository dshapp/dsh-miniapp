# V-BC 验收报告：DIFF-ANDROID 的 B 区 / C 区 [x] 条目复核

- 验收对象：`docs/DIFF-ANDROID.md` 中 B 区（聊天页/转写，45 条，全部标 [x]）与 C 区（输入区/弹层，76 条中标 [x] 的 51 条），共 **96 条**。
- 明细依据：`docs/audit/B-chat-transcript.md`、`docs/audit/C-composer-sheets.md`。
- 方法：逐条读明细 → 打开安卓源码确认当前安卓行为（行号按内容重新定位）→ 打开当前小程序源码确认现状 → 判定。**只读验收，未修改任何源码。**
- 判定口径：
  - ✅ 已落地且与安卓一致（含「明细文档明确认定等价/可保留」且现状确实等价的条目）；
  - ⚠️ 部分落地（只做了一半 / 关键分支漏改 / 实现有效性存疑）；
  - ❌ 未落地或方向错（现状与安卓仍不同，且明细曾给出明确改法）；
  - ❓ 无法判定。
- 路径约定：小程序路径相对 `/Users/user/dshapp/dsh-miniapp`；安卓路径统一省略前缀 `/Users/user/dshapp/dsh-androidapp/app/src/main/java/ai/deepseek/dshphone/`。

---

## 摘要

| 判定 | 条数 | 占比 |
| --- | --- | --- |
| ✅ 已落地且一致 | 83 | 86.5% |
| ⚠️ 部分落地 | 8 | 8.3% |
| ❌ 未落地 / 改错 | 5 | 5.2% |
| ❓ 无法判定 | 0 | 0% |
| **合计** | **96** | |

分区：B 区 45 条 = ✅35 / ⚠️5 / ❌5；C 区 51 条 = ✅48 / ⚠️3 / ❌0。

### ❌ 未落地（5 条，全部集中在 B 区 Markdown / 正文交互）

| 编号 | 一句话 |
| --- | --- |
| D36 | 助手正文 / 思考卡 / 工具详情仍无法选中复制，`userSelect` 只加在用户气泡与上下文详情两处。 |
| D37 | @提及仍是正文下方独立 `MentionStrip`，`MarkdownView` 至今没有 `fileMentions` 入参。 |
| D38 | Markdown 图片语法仍原样退化成 alt 文本，连「可点打开图片查看器」都没做。 |
| D39 | 外部链接点击仍只复制地址，不跳转。 |
| D40 | 行内代码仍只认路径形状，不认 mention 词表（随 D37 一起没动）。 |

### ⚠️ 部分落地（8 条）

| 编号 | 一句话 |
| --- | --- |
| D2 | 「更多」菜单是改了，但改成了 上下文/模型/Fork —— 这三项安卓根本不在菜单里，安卓的 查找/面板 反而被挪出菜单。 |
| D12 | 相邻图片分组 + compact 缩略已落地，但多图是 `flex-wrap` 换行，安卓是 `horizontalScroll` 横滑。 |
| D16 | 思考卡已改全屏详情 + 复制，但正文仍用 `MarkdownView` 渲染，安卓是纯文本 `SelectionText`。 |
| D28 | 悬浮胶囊/全局挂载/idle 不画/仅 failed 给重试都对了，但 failed 文案没换成 `offlineBannerTitle`，reconnecting 也没并成安卓的中性「连接中…」。 |
| D35 | `Icon` 已支持 `ariaLabel`，但转写页脚的复制/分支、回到底部按钮仍无标签（`messageRow.tsx` 里 0 处 ariaLabel）。 |
| C-12 | 加了 `presetPickerEnabled` 门控，但输入区的预设入口本身没删 —— 安卓 ComposerBar 压根没有这个入口。 |
| C-63 | 换题滚动复位逻辑写了，但走的是「给 ScrollView 的 ref 直接赋 `scrollTop`」，Taro 小程序端通常不生效（需受控 `scrollTop` prop），实际是否复位需真机验证。 |
| C-70 | `ariaLabel` 只补到了加号/回形针/弹层关闭等少数几个；发送、停止、队列 编辑/插队/撤回、目标菜单、附件移除、提问上一题/下一题都还没有。 |

---

## 一、B 区逐条验收（45 条）

| 编号 | 标题 | 判定 | 证据 | 建议 |
|---|---|---|---|---|
| D1 | 轮次导航：顶栏下拉菜单 vs 常驻右侧轨道 | ✅ | 安卓 `ui/screen/ChatScreen.kt:324-374`（顶栏图标 + DropdownMenu，`enabled = !turnRail.isNullOrEmpty()`、行 `enabled = railBusyTurn == null`）；小程序轨道默认收起 `pages/chat/index.tsx:102`，顶栏 `list` 图标开关且空表置灰 `pages/chat/index.tsx:483-488`，忙时整列 `railRowBusy` `pages/chat/index.tsx:569` + `index.module.scss:243-246`（opacity .5 + pointer-events:none），`jumpToTurn` 早退 `:295` | 形态仍是侧栏而非下拉菜单，但明细给出的「至少可折叠/默认收起/忙时统一置灰/复刻 enabled」四项全部满足，可结案 |
| D2 | 顶栏入口与「更多」菜单项集合不同 | ⚠️ | 安卓更多菜单只有 findInChat + panel（`ChatScreen.kt:377-394`）；小程序更多菜单是 `[context, model, fork]`（`pages/chat/index.tsx:338`），查找/面板/轮次被提为顶栏一级按钮（`:483-500`） | 现状=菜单集合与安卓完全不相交；期望=菜单收敛为 查找 + 面板。建议把 context/model/fork 去掉（输入区已有模型与上下文入口，Fork 安卓只在行长按菜单与页脚），或在总表把本条改标为「刻意调整」 |
| D3 | 子会话「返回父会话」入口为小程序独有 | ✅ | 安卓仅 `ui/screen/ComposerBar.kt:176,244` 一行 takeover；小程序输入区已删除该行（`ui/composerBar.tsx:849` 注释占位），只保留聊天页顶部子会话条（`pages/chat/index.tsx:505-516`） | 重复渲染已消除；mini 独有的 `backToParent`（`pages/chat/index.tsx:510-514`）为刻意保留（C-40 还专门修好了它的 parentAvailable），建议在总表注明「安卓侧待补」 |
| D4 | 查找态上一条/下一条无禁用态 | ✅ | 安卓 `ChatScreen.kt:309-315` `canStep`；小程序 `pages/chat/index.tsx:199` `canStepFind` + `:453-464` 套 `styles.actionOff`（`index.module.scss:238-240` opacity .35）且点击前判空 | — |
| D5 | 查找时查询变化不自动滚到第一条命中 | ✅ | 安卓 `ChatScreen.kt:218-223`；小程序 `pages/chat/index.tsx:203-210`（`setActiveHit(0)` + `scrollToNodeId(chatNodeId(visibleNodes[0]))`） | — |
| D6 | 查找命中行整行底色取色不同 | ✅ | 安卓 `ui/component/FindHighlight.kt:25` `activeRow = 0x33FF9632`；小程序 `pages/chat/index.module.scss:139-142` `rgba(255,150,50,0.2)`（alpha 0x33≈0.2，同色） | — |
| D7 | 查找清除按钮不保持焦点/键盘 | ✅ | 安卓 `ChatScreen.kt:317-321` 清文字 + `findFocus.requestFocus()`；小程序 `pages/chat/index.tsx:465-477`（清空后 `setFindFocused(false)` → `setTimeout(...true)` 重新受控聚焦） | — |
| D8 | 跟尾判定：canScrollForward vs onScroll 近似 | ✅ | 安卓 `ChatScreen.kt:179-187`；小程序 `pages/chat/index.tsx:217-222` `scrollToBottom` 每次 `current + 100000`，跟尾 effect `:255-258` 依赖 `nodes` 引用，而 `state/sessionStore.ts:2446` 每次重建都生成新数组 → 流式只长高也会持续贴底；`onScroll` `:526-537` 贴底恢复跟尾 | — |
| D9 | 「加载更早」不自动触发，仅手动按钮 | ✅ | 安卓顶部哨兵 `ChatScreen.kt:432-445`；小程序 `pages/chat/index.tsx:536`（`scrollTop <= 8 && hasMore && !loadingHistory → loadEarlier()`），按钮兜底仍在 `:353-360` | — |
| D10 | 用户气泡配色：主题容器色 vs 固定品牌色 | ✅ | 安卓 `ui/component/MessageRow.kt:147,152` primaryContainer/onPrimaryContainer；小程序 `ui/messageRow.module.scss:32,39` `var(--dsh-color-primary-container)` / `--dsh-color-on-primary-container`，深浅色分别定义于 `styles/theme.scss:12-13` 与 `styles/vars.scss:12-13` | — |
| D11 | 图片附件失败态：失败占位 vs 永久骨架 | ✅ | 安卓 `MessageRow.kt:218-227`（loaded 后 `Strings.imageUnavailable`）；小程序 `ui/attachmentImage.tsx:41,62,75-81` 失败态 + `i18n/strings.ts:210` `imageUnavailable` | — |
| D12 | 多图相册分组与横滑缺失、尺寸不同 | ⚠️ | 安卓 `MessageRow.kt:244-268`：`compact = refs.size > 1` 且多图用 `Modifier.horizontalScroll`；小程序已按相邻块分组（`ui/messageRow.tsx:189-204`）、compact 缩略（`ui/attachmentImage.tsx:113-126`），但容器是 `ui/messageRow.module.scss:71-77` `flex-wrap: wrap`，不是横滑 | 现状=多图换行堆叠；期望=一行横滑。建议 `.gallery` 改 `ScrollView scrollX` 或 `flex-wrap:nowrap; overflow-x:auto`（尺寸 112 vs 120dp 可忽略） |
| D13 | 工具卡完全丢失 subCalls 子调用树 | ✅ | 安卓 `ui/component/Cards.kt:425-428,447-448`（`depth < 8` 递归）；小程序 `ui/cards.tsx:128` `MAX_TOOL_DEPTH = 8`、行内递归 `:212-227`、详情弹层里逐层列出 `:178-193` | — |
| D14 | 工具结果/read_image 的图片完全不渲染 | ✅ | 安卓 `Cards.kt` ToolResultView 取 `imageReferences ?: lenientImageRefs`、`model/ImageBlocks.kt` readImageCard；小程序 `model/imageCards.ts` + `ui/cards.tsx:145,208-210`（ToolImageCard）与 `:304-326`（结果图片分支优先于 JsonTree），`ui/messageRow.tsx:759-767` 已把 `resolveImage/onOpenImage` 贯通 | — |
| D15 | 工具详情：全屏弹层+复制 vs 就地展开且无复制 | ✅ | 安卓 `Cards.kt:104-150` CardDetailDialog；小程序 `ui/cardDetail.tsx:35-66`（左上关闭、右上复制、全屏）+ `ui/cards.tsx:156-200` ToolCard 行点击直接 `openCardDetail`，宿主挂在 `app.tsx` | — |
| D16 | 思考卡：全屏弹层+复制 vs 就地 Markdown 展开 | ⚠️ | 安卓 `Cards.kt:151-172`：`CardDetailDialog(..., text, ...) { SelectionText(text) }`（纯文本可选中）；小程序 `ui/cards.tsx:106-113` 已改全屏详情且带 `copyText`，但正文是 `<MarkdownView text={text} .../>` | 现状=reasoning 仍按 Markdown 解析，可能改变原意且不可选中；期望=纯文本渲染。建议把 content 换成 `<Text userSelect>` 或 `MonospaceBlock` |
| D17 | 上下文行丢失 ContextForm 图标与 notice 摘要 | ✅ | 安卓 `MessageRow.kt:334-356`（`contextCollapsedSummary ?? provenanceLabel ?? contextInjected` + 六种 form 图标）；小程序 `model/contextPresentation.ts` + `ui/messageRow.tsx:341-379`（list/book-open/camera/bell/move-right/history 一一对应，兜底 recall→history） | — |
| D18 | TurnError 通知行不可点、无全文/复制弹层 | ✅ | 安卓 `MessageRow.kt:73-75` `detailed = true` → `Cards.kt:185-198`；小程序 `ui/messageRow.tsx:770` `<NoticeRow tone="error" ... detailed />` + `ui/cards.tsx:404-421`（detailed 时 `openCardDetail` 带 copyText） | — |
| D19 | TurnProcess 展开态未落 store，过程行无法展开 | ✅ | 安卓 `MessageRow.kt:419-432` + SessionStore 折叠过滤；小程序 `pages/chat/index.tsx:399-400` 注入 `expandedProcessStore`/`setTurnProcessExpanded`，`state/sessionStore.ts:2630-2639` 写集合后 `rebuildNodes()`，`:2445,2459-2462` 折叠过滤据此放行 | — |
| D20 | 轮次页脚多出 TPS/TTFT 两个胶囊 | ✅ | 安卓 `MessageRow.kt:476-481` 两个 StatPill；小程序 `ui/messageRow.tsx:696-707` 只剩 token 与用时两枚，TPS/TTFT 回到 `TimePanel`（`:610-636`） | — |
| D21 | 用量/用时明细：弹窗 vs 就地面板 | ✅ | 安卓 `MessageRow.kt:491-520` StatDialog；小程序仍是就地面板 `ui/messageRow.tsx:710-711` | 明细文档结论为「功能等价、有意移植、可不改」，字段与顺序逐条一致（`:564-636` vs `MessageRow.kt:493-519`），按等价结案 |
| D22 | turnTail 的分支传参：seq vs turn | ✅ | 安卓 `MessageRow.kt:470` `onFork(data.seq)`；小程序 `ui/messageRow.tsx:692` `onFork(data.seq)`，聊天页 `pages/chat/index.tsx:389` → `forkAtSeq`（`:287-291` 直接 `forkSession(sessionId, seq)`，不再经 turnRail 反查） | — |
| D23 | 改动文件卡位置：页脚行之上 vs 之下 | ✅ | 安卓 `MessageRow.kt:448-451` 卡片在 Row 之前；小程序 `ui/messageRow.tsx:673-681` ChangedFilesCard 在 `.tail` 行之前 | — |
| D24 | 逐文件比较：AlertDialog vs 就地展开 | ✅ | 安卓 `ui/component/ChangedFilesCard.kt:159-198` ChangedFileDiffDialog；小程序 `ui/changedFilesCard.tsx:72-91` 点行读 diff → `openCardDetail`（标题 `file.display`），读数期间行下转圈文案 `:118-120`，失败在弹层给文案 `:83-89` | — |
| D25 | 改动卡的加载/超时配色与文案样式 | ✅ | 安卓 `ChangedFilesCard.kt:209-214` coarse 用 `colorScheme.error`、`:105-109` 展开带 ExpandMore/Less；小程序 `ui/changedFilesCard.tsx:149` coarse 改 `color_bad`、`:126` 展开带 `chevron-down/right` | 增删色值仍是 `#16a34a/#dc2626` vs 安卓 `0xFF2E7D32/0xFFC62828`，语义一致，不构成问题 |
| D26 | 失败轮次原因不本地化（AUTH/兜底） | ✅ | 安卓 `model/TurnFailureMessage.kt:19-23`；小程序 `model/turnFailure.ts:14-19` 逐行同构 + `i18n/strings.ts:218,220` 两条文案，调用点 `state/sessionStore.ts:1897-1905` | 小差：mini 在 `error.message` 缺失时会先退到 `reason.message`（`sessionStore.ts:1898`），安卓直接落本地化兜底；影响极小，可择机收敛 |
| D27 | 缺少 lastErrorMessage 全局 Snackbar | ✅ | 安卓 `ChatScreen.kt:242-246`；小程序 `pages/chat/index.tsx:116-121`（订阅 `lastErrorStore` → `toast` → 清空） | — |
| D28 | 连接横幅：形态、显示条件、idle 映射 | ⚠️ | 安卓 `ui/component/ConnectionBanner.kt:117-132,147-154`：idle→null、connecting/reconnecting→`Strings.statusConnecting` 中性且不给重试、failed→`Strings.offlineBannerTitle`（`i18n/Strings.kt:223`「无法连接到电脑」）+ 重试；小程序 `state/connection.ts:49-61` `connectionBannerTone`（idle/connected→undefined）✅、`ui/connectionBanner.tsx:63,67` 仅 failed 可重试 ✅、悬浮胶囊 + 上滑 dismiss `:68-88` ✅、全局挂载 `app.tsx:56-60` ✅ —— 但 `ui/connectionBanner.tsx:33` failed 用 `Strings.connectionFailed`（「连不上主机」），`:31` reconnecting 用 `Strings.reconnecting`（「重连中…」） | 现状=文案两处与安卓不同，`offlineBannerTitle` 在 `i18n/strings.ts:85` 已存在却没被用；期望=failed→`Strings.offlineBannerTitle`，reconnecting→`Strings.statusConnecting`（与 connecting 合并成一条中性提示） |
| D29 | 连接横幅把原始异常当详情展示 | ✅ | 安卓 `ConnectionBanner.kt:156-222` 胶囊内只有结论；小程序 `ui/connectionBanner.tsx:56-61`（detail 只进 `console.warn`，正文只渲染 `toneLabel`） | — |
| D30 | 图片类文件链接被当文本预览 | ✅ | 安卓 `ChatScreen.kt:90-107`（`ImageFileType.isImage` → SystemImageViewer）；小程序 `pages/chat/index.tsx:128-140`（`isImageFile` → `workspaceImageTempPath` → `Taro.previewImage`，失败 `Strings.imageOpenFailed`），扩展名表 `model/imageFileType.ts:7-9` | — |
| D31 | 文件预览分页：底部哨兵自动加载 vs 手动按钮 | ✅ | 安卓 `ui/screen/Sheets.kt:930-936`；小程序 `ui/sheets.tsx:687-690` `autoLoad` 接 Sheet 的 `onReachBottom`（`:699`，壳层 `:113-114` `lowerThreshold=80` + `onScrollToLower`），按钮保留作兜底 `:736-738` | — |
| D32 | 文件预览缺少复制入口 | ✅ | 安卓 `Sheets.kt:898` CardDetailDialog 顶栏复制；小程序 `ui/sheets.tsx:693-696,704-709` 正文上方「复制」行（`wx/Taro.setClipboardData`） | — |
| D33 | 独立 preview 页面是死路由 | ✅ | `src/pages/` 下已无 `preview`（现为 archived/chat/index/new/pairing/settings），`src/route.ts` 无 PREVIEW 登记 | — |
| D34 | 已归档列表：无搜索/分组/不可用态，恢复文案不同 | ✅ | 安卓 `ui/screen/ArchivedSessionsScreen.kt`；小程序已从弹层改为独立页 `pages/archived/index.tsx`：搜索 `:134-138`、按工作区分组 `:100`（`Strings.ungrouped` 兜底）、三种空态 `:87-94`（unavailable/noArchived/searchNoResults）、行内 `Strings.unarchiveSession` + `aria-label = fmt(unarchiveSessionNamed, title)` `:114-117`；列表页入口 `pages/index/index.tsx:493` | — |
| D35 | 无障碍：图标无 contentDescription/aria | ⚠️ | `ui/icon.tsx:21-34` 已支持 `ariaLabel`（无标签时 `aria-hidden`）；聊天页 5 处已补（`pages/chat/index.tsx:456,462,469,486,492`）—— 但 `ui/messageRow.tsx` 全文 0 处 `ariaLabel`：页脚复制 `:684-688`、分支 `:692-694` 对应安卓 `MessageRow.kt:464` `Strings.copyAction` 与 `:472` `Strings.messageBranch`；回到底部 `pages/chat/index.tsx:591` 对应安卓 `ChatScreen.kt:571` `Strings.scrollToBottom` | 补 `ariaLabel={Strings.copyAction}` / `Strings.messageBranch` / `Strings.scrollToBottom` 三处即可闭环 |
| D36 | 正文文本选择缺失 | ❌ | 安卓 `MessageRow.kt:141,309-313` 与 `Cards.kt:174-183` 均用 SelectionContainer/SelectionText；小程序全仓仅两处 `userSelect`：`ui/messageRow.tsx:139`（用户气泡）与 `:374`（上下文详情），`ui/markdown.tsx`/`ui/cards.tsx`/`ui/cardDetail.tsx` 全无 | 现状=助手正文、思考卡、工具详情仍不可长按选中；期望=统一可选。建议在 `markdown.tsx` 的正文 `<Text>` 与 `cards.tsx` 的 `MonospaceText` 上加 `userSelect`（注意 `ui/messageRow.tsx:208` 的注释「MarkdownView 内部的 Text 已经能选」与代码不符，属误注释） |
| D37 | @提及：正文下方独立链接条 vs 正文内联 | ❌ | 安卓 `MessageRow.kt:283,314-321` 把 `mentions` 传进 `MarkdownText` 做正文内联链接；小程序 `ui/markdown.tsx:172-184` 的 `MarkdownView` 仍无 `fileMentions` 入参，`ui/messageRow.tsx:242` 仍另起 `MentionStrip`（`:254-274`，只显示 basename） | 现状=提及与正文脱节、丢目录；期望=正文内联高亮可点。建议给 `MarkdownView` 增加 `mentions` 并在 `renderInline` 的 text/codespan 分支做 `resolveMention`，strip 降级为兜底 |
| D38 | Markdown 图片语法退化为 alt 文本 | ❌ | 安卓 Markdown 有 Image 分支 + 图片走系统查看器；小程序 `ui/markdown.tsx:470-478` 仍是 `<Text>{image.text || image.href}</Text>` | 现状=纯文本；期望（明细建议）=至少把图片路径做成可点链接，复用 D30 的 `onOpenFileLink` → `Taro.previewImage` |
| D39 | 外部链接点击：复制地址 vs 系统浏览器 | ❌ | 安卓 `ui/component/Markdown.kt` 给安全外链加 LinkAnnotation 交系统打开；小程序 `ui/markdown.tsx:455-468` 非文件链接仍 `copyToClipboard(link.href)` | 现状=点外链不跳转且无任何提示；期望=至少复制后 toast 告知，或走 `web-view` 页。属产品/平台决策项，建议在总表改标为「平台限制」而非 [x] |
| D40 | 行内代码的 mention 词表解析缺失 | ❌ | 安卓 Markdown 行内代码先查 `TurnDeliverables.resolveMention`；小程序 `ui/markdown.tsx:431-450` 仍只有 `parseInlineCodeFileLink`（路径形状判定） | 与 D37 同源，修 D37 时一并处理 |
| D41 | encodeContentBlock 丢失 tool-result 嵌套 content | ✅ | 安卓 `model/ChatNode.kt:51-70`；小程序 `model/chatNode.ts:60-68` 已补 `content: block.content.map(encodeContentBlock)` | — |
| D42 | 长按行菜单：DropdownMenu vs 系统 ActionSheet | ✅ | 安卓 `ChatScreen.kt:480-503`；小程序 `pages/chat/index.tsx:316-333`（copy 非空才给、否则只 forkHere），明细结论为「功能等价、可保留」 | — |
| D43 | 转写列宽上限（columnMaxWidth）未生效 | ✅ | 安卓 `ChatScreen.kt:421-427` `widthIn(max = Dimens.columnMaxWidth)`（`ui/theme/Theme.kt:18` = 760.dp）；小程序 `pages/chat/index.module.scss:112-115` `.transcriptInner { max-width:760px; margin:0 auto }`，外层 `pages/chat/index.tsx:540` 已套用 | — |
| D44 | 会话页进场不清未读失败红点 | ✅ | 安卓 `ChatScreen.kt:122-128` + `state/StreamCoordinator.kt` 的 sessionIsOnScreen；小程序 `state/appModel.ts:514-515`（`open()` 里 `store.markErrorSeen()`）与 `:217-218`（`sessionIsOnScreen: id => this.selectedSessionId === id`），消费点 `state/streamCoordinator.ts:752-753` | — |
| D45 | 转写行整行点击为空操作、缺少复制触觉 | ✅ | 安卓 `ChatScreen.kt:459-462,489`；小程序 `pages/chat/index.tsx:369-377` 长按弹菜单前 `wx.vibrateShort({type:'light'})` | 安卓的震动点在「复制之后」，mini 在「菜单弹出时」，体感等价 |

---

## 二、C 区逐条验收（51 条 [x]）

| 编号 | 标题 | 判定 | 证据 | 建议 |
|---|---|---|---|---|
| C-01 | 输入区外层内边距与纵向间距不同 | ✅ | 安卓 `ui/screen/ComposerBar.kt:209-219` `padding(horizontal=16, vertical=8) + spacedBy(8.dp)`；小程序 `ui/composerBar.module.scss:6-13` `gap: 8px; padding: 8px 16px` | — |
| C-05 | 附件入口形态：菜单 vs 两个独立图标 | ✅ | 安卓 `ComposerBar.kt:304-325` 回形针 + DropdownMenu(pickPhoto/pickFile)；小程序 `ui/composerBar.tsx:920-928` 单个 paperclip → `showChoice([pickPhoto, pickFile])` | — |
| C-09 | 控制行是否随正文横向滚动不同 | ✅ | 安卓 `ComposerBar.kt:280-330` 加号/附件在 Row 内、`:326-330` 只有权限段 `weight(1f).horizontalScroll`；小程序 `ui/composerBar.tsx:905-947` 加号与回形针在 `actionScroll` 之外 | — |
| C-11 | 计划模式入口：只有「关闭」vs「关闭 + 开启」 | ✅ | 安卓 `ComposerBar.kt:357-372` 仅 `planModeTarget == true` 给可关 chip；小程序 `ui/composerBar.tsx:936-941` 同条件，已删除「点一下开启」 | — |
| C-12 | 预设（Agent 模式）入口：安卓输入区无，小程序有 | ⚠️ | 安卓控制行只有 权限/计划/模型（`ComposerBar.kt:326-371`），预设在 `ui/screen/NewSessionScreen.kt`；小程序 `ui/composerBar.tsx:942-944` 仍渲染预设入口，只是加了 `presetPickerEnabled` 门控（`:495`） | 现状=门控已补、入口未删；期望=输入区不出现预设入口。建议删除 `:942-944` 与 `openPresetPicker`（`:781-790`），或在总表把本条标为「刻意增强」 |
| C-13 | 压缩上下文入口：安卓 UI 无，小程序有三处 | ✅ | 安卓 `state/PhoneModel.kt` 有 `compactContext` 但 `ui/` 无调用点；小程序全仓 `compactContext` 仅剩定义 `state/appModel.ts:914`，输入区与上下文弹层均无按钮（`ui/composerBar.tsx:792-795` openContext 只开弹层；`ui/sheets.tsx:466-511` 无按钮） | — |
| C-14 | 模型切换：完整思考强度 Sheet vs 扁平 ActionSheet | ✅ | 安卓 `ComposerBar.kt:371` → ModelPickerSheet；小程序 `ui/composerBar.tsx:751-757` 优先走注入的 `onOpenModel`，聊天页在 `pages/chat/index.tsx:599,611` 接到完整 `ModelPickerSheet`（含思考强度页签） | — |
| C-15 | 模型目录为空时的反馈不同 | ✅ | 小程序 `ui/composerBar.tsx:772-777` 区分 `status === 'loading'` → `Strings.statusLoading`，否则 `modelDirectory.error ?? Strings.operationFailed`；弹层侧 `ui/sheets.tsx:575-578` 同样区分 loading/error | — |
| C-17 | 运行中主键语义：排队图标 vs「加入队列」文案 | ✅ | 安卓 `ComposerBar.kt:395-408` 始终 Send 图标；小程序 `ui/composerBar.tsx:961-969` 只画 send 图标，`Strings.enqueue` 已从代码中移除 | — |
| C-18 | 停止键出现条件不同（是否计入附件） | ✅ | 安卓 `ComposerBar.kt:376` `running && draft.text.isBlank()`；小程序 `ui/composerBar.tsx:807` `running && draft.trim().length === 0`（不再看 attachments） | — |
| C-19 | 小程序多出「插队发送」按钮 + 长按发送插话 | ✅ | 安卓插队只在队列行（`ComposerBar.kt:836-849`）；小程序 `ui/composerBar.tsx` 已无 `showSteer`/`onLongPress`，steer 仅存在于 QueueStrip（`:389,417-429,832`） | `i18n/strings.ts:179` `queueSteer` 已无引用，可作为死字符串清理 |
| C-21 | 发送震动反馈缺失 | ✅ | 安卓 `ComposerBar.kt:183`；小程序 `ui/composerBar.tsx:677-682` `wx.vibrateShort({type:'light'})` | — |
| C-23 | 待办条展开箭头方向不同 | ✅ | 安卓 `ComposerBar.kt:669-672` ExpandLess/ExpandMore；小程序 `ui/composerBar.tsx:295` `expanded ? 'chevron-up' : 'chevron-down'` | — |
| C-25 | 目标条数据源：安卓过滤 complete，小程序不过滤 | ✅ | 安卓 `state/SessionStore.kt` `activeGoal = goal?.takeIf { phase != "complete" }`；小程序 `ui/composerBar.tsx:819` `goal === undefined \|\| goal.phase === 'complete' ? null : <GoalBar…>` | — |
| C-26 | 目标菜单项未按 phase 收口 | ✅ | 安卓 `model/GoalPhaseAction.kt:15-19`；小程序 `model/format.ts:470-474` 同映射，菜单按它增删项 `ui/composerBar.tsx:338-346`（phaseAction 为空时不渲染暂停/恢复，索引同步偏移） | — |
| C-28 | 队列行分隔线位置不同 | ✅ | 安卓 `ComposerBar.kt:856` `if (index < size-1)`；小程序 `ui/composerBar.module.scss:179-182` `.queueRow:last-child { border-bottom:none }` | — |
| C-30 | 队列按钮的 busy 解锁机制不同 | ✅ | 安卓协程 finally 解锁；小程序 `ui/composerBar.tsx:395-401` `Promise.resolve(action()).finally(...)`，固定 1.2s setTimeout 已删除 | — |
| C-31 | 队列动作失败提示口径不同 | ✅ | 安卓 `state/PhoneModel.kt:831-853`；小程序 `state/appModel.ts:785-800` 逐行同构（steer 的 `steer-unavailable`/`queue-item-not-found` 静默收敛，其余用传入文案），调用点 `ui/composerBar.tsx:831-833` 分别传 `queueEditFailed/SteerFailed/RemoveFailed` | — |
| C-32 | 命令候选来源：主机 commands/list vs 静态内置 4 条 | ✅ | 小程序 `ui/composerBar.tsx:587` 先 `model.loadCommands`，`:154-175` `hostCommandSuggestions`（带 `input.hint` 与 `wantsArgs`），仅 `commands === undefined` 时才回落内置表（`:157`），主机给空表就是空候选（`:158`） | — |
| C-33 | @ 引用候选缺少「会话引用」 | ✅ | 安卓 `PhoneModel.kt:1100-1109` files take(8) + sessions take(5)；小程序 `ui/composerBar.tsx:565-580` 同口径，`state/appModel.ts:940-942` → `transport/rpcMethods.ts:515` | — |
| C-34 | 技能候选的触发方式不同（$ 触发 vs 混在 / 里） | ✅ | 安卓技能混在 COMMAND 分支；小程序 `ui/composerBar.tsx:589-592` 的 / 分支现在同时返回 `hostCommandSuggestions + skillSuggestions`（安卓口径已补），`$` 触发（`state/composer.ts:37`）作为额外能力保留 | 保留 `$` 属刻意增强，建议在总表注明 |
| C-37 | 弹层手势：系统 ModalBottomSheet vs 自绘固定面板 | ✅ | 小程序 `ui/sheets.tsx:79-101` 补了下拉关闭（`SWIPE_CLOSE_DP = 72`），把手 `:103` 仍在 | — |
| C-38 | 弹层标题：安卓多数无标题，小程序统一有标题 | ✅ | 安卓上下文/会话面板无标题；小程序 `ui/sheets.tsx:218`（面板）与 `:467`（上下文）已不传 title，模型弹层有 efforts 时 `hideHeader`（`:567`），提问弹层 `hideHeader`（`:892`），文件预览 title=basename（`:692`，对齐安卓 CardDetailDialog） | — |
| C-39 | 会话面板：子智能体行的图标/箭头位置不同 | ✅ | 安卓 `ui/screen/Sheets.kt:497-516` trailing；小程序 `ui/sheets.tsx:258-266` 图标已移到行尾 | — |
| C-40 | 子会话 parentAvailable 传错 | ✅ | 安卓 `Sheets.kt:499-505` `openSubagent(..., true)`；小程序 `ui/sheets.tsx:205-210` 第二参改为 `true`（带注释） | — |
| C-41 | 会话面板：产物点击行为不同 | ✅ | 安卓 `Sheets.kt:519-527` 行点击 = `openOnHost`；小程序 `ui/sheets.tsx:275` 行点击仍是内置预览，但新增次级入口 `:283-293`（`onOpenOnHost` → `pages/chat/index.tsx:608` `model.openOnHost`） | 主点击落点与安卓仍不同，属明细给出的第二方案（保留预览 + 补次级入口），按等价结案 |
| C-43 | 会话面板：后台任务行布局不同 | ✅ | 安卓 `Sheets.kt:478-493` trailing = 转圈 + status；小程序 `ui/sheets.tsx:241-248` 左标题/说明、右 `rowTrailingGroup`（转圈 + status） | — |
| C-45 | 上下文弹层：占用抬头呈现不同 | ✅ | 安卓 `Sheets.kt:296-321` 按 `%d%%` 拆 contextAria + 右侧 ~used/window；小程序 `ui/sheets.tsx:418-420,472-479` 同做法，圆环与「已用」前缀已删 | — |
| C-46 | 上下文弹层：无投影时的空态不同 | ✅ | 小程序 `ui/sheets.tsx:469` `occupancy === undefined ? null : …`，不再把「占用」当空态 | — |
| C-47 | 上下文弹层：缓存命中率口径不同 | ✅ | 安卓 `model/SessionUsageReading.kt:61-74`；小程序 `model/format.ts:113-125` `sessionCacheHitPercent` 逐行同构，会话面板在 `ui/sheets.tsx:457` 使用它，单轮 `cacheHitPercent` 仅留给 `ui/messageRow.tsx:572` | — |
| C-48 | 上下文弹层：压缩按钮（小程序多） | ✅ | `ui/sheets.tsx:466-511` 已无任何按钮，正文止于 detailRows | — |
| C-49 | 模型弹层：loading/选择中状态不同 | ✅ | 安卓 `Sheets.kt:72-83` selecting 时 `alpha(0.5f)`；小程序 `ui/sheets.tsx:581,606` `modelListBusy`（`sheets.module.scss:587-589` opacity .5） | 安卓还会 `userScrollEnabled = !selecting`，mini 未禁滚；加载态用文案而非转圈。均为次要差异 |
| C-51 | 思考强度项：小程序多一行 description | ✅ | 安卓 `Sheets.kt:116-134` 只有名称 + 勾；小程序 `ui/sheets.tsx:607-615` 已去掉 description | — |
| C-52 | 模型弹层标题重复（小程序） | ✅ | `ui/sheets.tsx:567` `hideHeader={hasEfforts}`，有页签时不再画「模型」标题 | — |
| C-53 | 归档弹层：安卓是独立页面，无对应弹层 | ✅ | `ui/sheets.tsx` 已无 ArchivedSheet（全仓仅 `pages/archived/index.tsx:22` 注释提及旧实现），改为独立页 `pages/archived/index.tsx`，入口 `pages/index/index.tsx:493` | — |
| C-54 | 文件预览：分页加载方式不同 | ✅ | 小程序 `ui/sheets.tsx:687-690,699` 底部哨兵自动续页，按钮保留兜底 `:736-738` | — |
| C-55 | 文件预览：缺复制能力与关闭方式不同 | ✅ | `ui/sheets.tsx:693-696,704-709` 已补复制入口 | — |
| C-56 | 文件预览：正文与路径显示不同 | ✅ | 安卓 `Sheets.kt:898,915` 只有 basename 标题 + 正文；小程序 `ui/sheets.tsx:692,723` 正文前已不再多画一行完整 path | — |
| C-57 | 文件预览：加载/空/失败态基本对应 | ✅ | 小程序 `ui/sheets.tsx:710-739`：首屏失败 `fileUnavailable` + 原因 + 重试、空 `fileEmpty`、未回 `fileLoading`、续加载 `statusLoading` + 失败重试，与安卓 `Sheets.kt:899-916` 一一对应 | — |
| C-58 | 审批弹层：结构一致，缺震动 | ✅ | 安卓 `Sheets.kt:581,589` LongPress 触感；小程序 `ui/sheets.tsx:761-767` `wx.vibrateShort({type:'medium'})` | — |
| C-59 | 提问弹层：header 重复显示 | ✅ | 安卓 `Sheets.kt:638-654` 无标题、header 只作 kicker；小程序 `ui/sheets.tsx:892` `hideHeader`，kicker 只画一次 `:895-897` | — |
| C-60 | 提问弹层：多选项选中态完全不可见 | ✅ | 安卓 `Sheets.kt:695-702` Checkbox/RadioButton 反映 picked；小程序 `ui/sheets.tsx:918` `multi ? (picked ? 'square-check' : 'square') : picked ? 'circle-dot' : 'circle'` | — |
| C-61 | 提问弹层：detail 未渲染 Markdown | ✅ | 安卓 `Sheets.kt:673` MarkdownText；小程序 `ui/sheets.tsx:903-907` `<MarkdownView text={item.detail} compact />` | — |
| C-62 | 提问弹层：自填输入框形态不同 | ✅ | 小程序 `ui/sheets.tsx:932-939` 已补 `disabled={busy}`（明细的唯一建议项） | 安卓还有 `maxLines = 4`（`Sheets.kt:705-718`），mini 未限行，影响极小 |
| C-63 | 提问弹层：换题时滚动不复位 | ⚠️ | 安卓 `Sheets.kt:622` `LaunchedEffect(flow.index) { scroll.scrollTo(0) }`；小程序 `ui/sheets.tsx:854-857` 依赖 `bodyRef.current.scrollTop = 0`，而 `bodyRef` 来自 `<ScrollView ref={...}>`（`:115-117`）——Taro 小程序端 ScrollView 的 ref 节点并不提供可写的 `scrollTop` 滚动能力，且代码用 `typeof body.scrollTop === 'number'` 做守卫，属性不存在时整段静默跳过 | 现状=复位很可能从未执行；期望=真的滚回顶部。建议改为受控 `scrollTop` prop（用 state，换题时先 `setTop(1)` 再 `setTop(0)` 触发变化）或 `scroll-into-view`，并在真机确认一次 |
| C-64 | 提问弹层：右上角关闭的两个 X 语义不同 | ✅ | 安卓 `Sheets.kt:655-664` 唯一关闭 = `cancelQuestion`；小程序 `ui/sheets.tsx:881-888` `cancelAll` 同时接到 Sheet 的 `onClose`（`:892`）与 body 内的 X（`:900`） | — |
| C-65 | 计划评审：正文未渲染 Markdown | ✅ | 安卓 `Sheets.kt:804`；小程序 `ui/sheets.tsx:812-814` `<MarkdownView text={review.plan} />` | — |
| C-69 | 小程序多导出未使用的 planReviewSubmitAnswer | ✅ | 全仓 grep `planReviewSubmitAnswer` 无结果，已删除 | — |
| C-70 | 无障碍标签：安卓有 contentDescription，小程序 Icon 无 | ⚠️ | `ui/icon.tsx:21-34` 已支持 `ariaLabel`；但 `ui/composerBar.tsx` 仅 2 处（`:905` 加号、`:923` 回形针），发送 `:968`、停止 `:958`、队列 编辑/插队/撤回 `:422,424,430`、目标菜单 `:374`、附件移除 `:872` 全无标签；`ui/sheets.tsx` 4 处，提问「上一题/下一题」`:946-962` 无标签。安卓对应处均有 contentDescription（`ComposerBar.kt:385,403,832,843,854`；`Sheets.kt:663,748,761`） | 按安卓清单补齐：Send/Stop/queueEdit/queueSteer/queueRemove/上一题/下一题/移除附件/目标菜单 |
| C-72 | token 胶囊主色写死不随主题 | ✅ | `ui/composerBar.module.scss:257-264` `background: color-mix(in srgb, var(--dsh-color-primary) 14%, transparent)`（安卓 `ComposerBar.kt:449-450` 是 primary + alpha 0.12） | — |
| C-76 | 主机无 commands/list / skillList 时的退化 | ✅ | `ui/composerBar.tsx:154-158`：`commands === undefined`（调用失败）才回落内置表，`commands.length === 0`（主机说没有命令）返回空表，不再插「幽灵命令」；技能失败 `.catch(() => [])`（`:588,610`） | — |

---

## 三、给下一轮的动作清单

1. **先修 B 区 Markdown 一簇（D36/D37/D38/D39/D40）**：这 5 条是唯一整组未落地的，且彼此同源——给 `MarkdownView` 加 `mentions` 入参与 `userSelect`，顺带把 image 分支接到 D30 已建好的图片查看链路，一次改动可收敛 4~5 条。
2. **D28 文案两处**：`ui/connectionBanner.tsx:31,33` 换成 `Strings.offlineBannerTitle` / `Strings.statusConnecting`（键都已存在）。
3. **C-63 真机验证或改受控 scrollTop**：当前实现大概率无效。
4. **无障碍补齐（D35 + C-70）**：一次性把 messageRow 与 composerBar 的纯图标按钮补 `ariaLabel`。
5. **总表口径修正**：D2、C-12 建议要么按安卓删干净，要么把标记从 `[x]` 改为 `[~]`（刻意调整）；D39 建议归入「平台限制」。

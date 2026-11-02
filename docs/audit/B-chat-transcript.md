# B 区审计：聊天页与转写渲染（小程序 vs 安卓）

- 工作区：/Users/user/dshapp/dsh-miniapp（Taro4 + React18 + TS 微信小程序）
- 参考实现：/Users/user/dshapp/dsh-androidapp（Kotlin + Jetpack Compose）
- 审计范围：安卓 ui/screen/ChatScreen.kt、ui/component/{MessageRow,Markdown,GfmAutolink,Cards,ChangedFilesCard,ConnectionBanner,FindHighlight,SystemImageViewer}.kt、model/{ChatNode,ContextPresentation,SessionUsageReading,GoalPhaseAction,TurnFailureMessage,TurnChanges,ToolRow}.kt、state/{TurnCardState,TurnChangesStore}.kt；小程序 src/pages/chat/index.tsx、src/ui/{messageRow,markdown,cards,changedFilesCard,connectionBanner,findHighlight}.tsx、src/pages/preview/index.tsx、src/model/{chatNode,toolRow,turnChanges,fileLink}.ts、src/state/sessionStore.ts
- 方法：两边源码逐文件对照，所有结论均带文件:行。无法确认处标注「不确定」。
- 说明：ComposerBar、Sheets、会话列表、设置等属于其他审计员区域，本报告只在它们直接决定聊天页/转写体验时引用，不做完整覆盖。

---

## 差异总览

共 45 条差异：影响大 7 条、中 23 条、小 15 条。

| 编号 | 标题 | 类型 | 影响 |
|---|---|---|---|
| D1 | 轮次导航：顶栏下拉菜单 vs 常驻右侧轨道 | 交互不同/视觉不同 | 大 |
| D2 | 顶栏入口与「更多」菜单项集合不同 | 交互不同 | 中 |
| D3 | 子会话「返回父会话」入口为小程序独有 | 行为不同（额外） | 中 |
| D4 | 查找态上一条/下一条无禁用态 | 视觉不同 | 小 |
| D5 | 查找时查询变化不自动滚到第一条命中 | 行为不同 | 中 |
| D6 | 查找命中行整行底色取色不同 | 视觉不同 | 小 |
| D7 | 查找清除按钮不保持焦点/键盘 | 交互不同 | 小 |
| D8 | 跟尾判定：canScrollForward vs onScroll 近似 | 行为不同 | 中 |
| D9 | 「加载更早」不自动触发，仅手动按钮 | 交互不同 | 中 |
| D10 | 用户气泡配色：主题容器色 vs 固定品牌色 | 视觉不同 | 中 |
| D11 | 图片附件失败态：失败占位 vs 永久骨架 | 缺失（错误态） | 中 |
| D12 | 多图相册分组与横滑缺失、尺寸不同 | 视觉不同/缺失 | 中 |
| D13 | 工具卡完全丢失 subCalls 子调用树 | 缺失 | 大 |
| D14 | 工具结果/read_image 的图片完全不渲染 | 缺失 | 大 |
| D15 | 工具详情：全屏弹层+复制 vs 就地展开且无复制 | 交互不同/缺失 | 中 |
| D16 | 思考卡：全屏弹层+复制 vs 就地 Markdown 展开 | 交互不同 | 中 |
| D17 | 上下文行丢失 ContextForm 图标与 notice 摘要 | 缺失/文案不同 | 中 |
| D18 | TurnError 通知行不可点、无全文/复制弹层 | 交互不同/缺失 | 中 |
| D19 | TurnProcess 展开态未落 store，过程行无法展开 | 行为不同（功能缺失） | 大 |
| D20 | 轮次页脚多出 TPS/TTFT 两个胶囊 | 视觉不同（额外） | 小 |
| D21 | 用量/用时明细：弹窗 vs 就地面板 | 交互不同 | 小 |
| D22 | turnTail 的分支传参：seq vs turn | 行为不同 | 小 |
| D23 | 改动文件卡位置：页脚行之上 vs 之下 | 视觉不同 | 小 |
| D24 | 逐文件比较：AlertDialog vs 就地展开 | 交互不同 | 中 |
| D25 | 改动卡的加载/超时配色与文案样式 | 视觉不同 | 小 |
| D26 | 失败轮次原因不本地化（AUTH/兜底） | 文案不同/缺失 | 大 |
| D27 | 缺少 lastErrorMessage 全局 Snackbar | 缺失（错误态） | 中 |
| D28 | 连接横幅：形态、显示条件、idle 映射 | 视觉不同/行为不同 | 大 |
| D29 | 连接横幅把原始异常当详情展示 | 行为不同 | 小 |
| D30 | 图片类文件链接被当文本预览，不走图片查看器 | 行为不同 | 大 |
| D31 | 文件预览分页：底部哨兵自动加载 vs 手动按钮 | 交互不同 | 中 |
| D32 | 文件预览缺少复制入口 | 缺失 | 小 |
| D33 | 独立 preview 页面是死路由 | 缺失（死代码） | 小 |
| D34 | 已归档列表：无搜索/分组/不可用态，恢复文案不同 | 缺失/文案不同 | 中 |
| D35 | 无障碍：图标无 contentDescription/aria | 缺失（无障碍） | 中 |
| D36 | 正文文本选择缺失（仅气泡/上下文详情可选） | 行为不同 | 中 |
| D37 | @提及：正文下方独立链接条 vs 正文内联 | 视觉不同/行为不同 | 中 |
| D38 | Markdown 图片语法退化为 alt 文本 | 行为不同 | 中 |
| D39 | 外部链接点击：复制地址 vs 系统浏览器 | 行为不同 | 中 |
| D40 | 行内代码的 mention 词表解析缺失 | 缺失 | 小 |
| D41 | encodeContentBlock 丢失 tool-result 嵌套 content | 行为不同 | 中 |
| D42 | 长按行菜单：DropdownMenu vs 系统 ActionSheet | 交互不同 | 小 |
| D43 | 转写列宽上限（columnMaxWidth）未在小程序生效 | 视觉不同 | 小 |
| D44 | 会话页进场不清未读失败红点（需交叉确认） | 行为不同 | 中 |
| D45 | 转写行整行点击为空操作、缺少 Android 的复制反馈触觉 | 交互不同 | 小 |

---

## 一、页面结构与导航

### D1 轮次导航：顶栏下拉菜单 vs 常驻右侧轨道
- 差异类型：交互不同/视觉不同
- 影响：大
- 安卓依据：ui/screen/ChatScreen.kt:324-374：顶栏一个 FormatListNumbered 图标按钮（enabled = !(store?.turnRail.isNullOrEmpty())，ChatScreen.kt:325-328），点开 DropdownMenu 逐行列出轮次；每行 enabled = railBusyTurn == null（:353），忙时整列禁用；前导图标 Schedule/Check/RadioButtonUnchecked（:341-351）；点击后 animateScrollToItem(index)（:366）。
- 小程序现状：src/pages/chat/index.tsx:482-499：右侧常驻 ScrollView（宽度 132px，见 index.module.scss 的 .rail），每行 onClick={() => jumpToTurn(item)}；jumpToTurn 只在 railBusy !== undefined 时 early return（:259），没有禁用视觉；能否显示由更多菜单里的「轮次」开关控制（:300/:312）。
- 影响与建议：安卓是「需要时展开」的菜单，占比小、忙时统一置灰；小程序常驻 132px 侧栏挤压正文宽度，且忙时其他行看起来仍可点。建议改为顶栏下拉菜单（或至少忙时对所有行统一置灰、可折叠、默认收起），并复刻 enabled 语义。

### D2 顶栏入口与「更多」菜单项集合不同
- 差异类型：交互不同
- 影响：中
- 安卓依据：ChatScreen.kt:375-395：更多菜单只有两项——findInChat + panel（图标 Search/Info）；上下文、模型选择等在 ComposerBar 内，无「Fork 当前会话」入口。
- 小程序现状：src/pages/chat/index.tsx:297-321：更多菜单为 [findInChat, panel, ✓ 轮次, context, model, fork] 六项；同时顶栏把 search 与 panel 直接铺成图标/文字按钮（:418-420）。
- 影响与建议：小程序把「查找」做成一级按钮（安卓要两步），又额外塞入上下文/模型/Fork。功能不缺失，但信息架构与安卓不同、与 ComposerBar 的入口重复。建议按安卓收敛更多菜单，或在文档中确认这是产品有意调整。

### D3 子会话「返回父会话」入口为小程序独有
- 差异类型：行为不同（额外）
- 影响：中
- 安卓依据：安卓只在 ComposerBar 里显示一行 takeover 文案（ui/screen/ComposerBar.kt:175-178 计算、:244 渲染 InfoLine(Icons.Default.Group, takeover, ...)），Strings.kt 中没有任何「返回父会话」文案；SessionStore.parentAvailable 被赋值（state/SessionStore.kt:151/316-318）但 UI 未消费。
- 小程序现状：src/pages/chat/index.tsx:425-436：转写上方常驻 subagentBar，右侧在 parentAvailable 时给出 Strings.backToParent（i18n/strings.ts:178）并可跳父会话；同一文案在 ComposerBar 又渲染一次（src/ui/composerBar.tsx:712-714/818、1537/1584、2303/2350）。
- 影响与建议：小程序在子会话里做了安卓没有的「返回父会话」，同时把 takeover 文案显示两遍。建议去掉重复的 takeover 行（保留顶部 bar），并在安卓侧确认是否需要补同款入口。

### D4 查找态上一条/下一条无禁用态
- 差异类型：视觉不同
- 影响：小
- 安卓依据：ChatScreen.kt:308-315：val canStep = findQuery.isNotBlank() && visibleNodes.isNotEmpty()，两个 IconButton(enabled = canStep)，无命中时置灰但保留槽位（注释明确「数字宽度变化时按钮不左右挪」）。
- 小程序现状：src/pages/chat/index.tsx:408-409：两个 Icon 永远渲染、永远可点；stepFind 内部在无命中时 return（:228）。
- 影响与建议：无命中时看起来可以点却没有反应。建议加禁用样式。

### D5 查找时查询变化不自动滚到第一条命中
- 差异类型：行为不同
- 影响：中
- 安卓依据：ChatScreen.kt:217-223：LaunchedEffect(findQuery, finding) 里 activeHit = 0，并在有结果时 listState.scrollToItem(earlierRow)（回到顶部第一条命中）。
- 小程序现状：src/pages/chat/index.tsx:168-171：只 setActiveHit(0)，没有滚动；滚动只发生在用户点上下一条时（:226-233）。
- 影响与建议：边打边找时当前命中可能在屏外，用户看不到高亮。建议查询变化后滚到第 1 条命中（或至少滚到该行）。

### D6 查找命中行整行底色取色不同
- 差异类型：视觉不同
- 影响：小
- 安卓依据：ui/component/FindHighlight.kt:25-26：activeRow = Color(0x33FF9632)（橙色淡铺，与当前命中字 0xFFFF9632 同色系）；ChatScreen.kt:454-458 用它铺整行。
- 小程序现状：src/pages/chat/index.module.scss 的 .rowActive { background: rgba(10,132,255,0.1) }（蓝色）。
- 影响与建议：逐字命中块是橙底（findHighlight.module.scss 的 .hit/.active 与安卓一致），整行底色却是蓝色，视觉不统一。建议改成与当前命中一致的橙色淡铺。

### D7 查找清除按钮不保持焦点/键盘
- 差异类型：交互不同
- 影响：小
- 安卓依据：ChatScreen.kt:316-321：清除只清文字并 findFocus.requestFocus()（注释「退出查找交给返回键，二者不混用」）；另 BackHandler(enabled = finding)（:131）退出查找；:282 回车 clearFocus。
- 小程序现状：src/pages/chat/index.tsx:410-412：清除只 setFindQuery("") + setActiveHit(0)；输入框靠 focus 属性（:398），无重新聚焦；没有硬件返回键处理（小程序返回即离页）。
- 影响与建议：清空后键盘可能收起。建议清除后重新 focus。返回键差异属平台限制，需产品确认。

### D8 跟尾判定：canScrollForward vs onScroll 近似
- 差异类型：行为不同
- 影响：中
- 安卓依据：ChatScreen.kt:173-203：LaunchedEffect 收集 snapshotFlow { listState.canScrollForward }，只要「底下还有没露出的内容」就贴回底部，因此流式回复期间单行高度增长也能覆盖；并用 interactionSource 的 Drag Start/Stop 判定跟尾开关。
- 小程序现状：src/pages/chat/index.tsx:214-218：只有 nodes 或 queue 变化才 scrollToBottom()；onScroll（:451-461）用 scrollHeight - scrollTop - viewportHeight <= 24 判定贴底、deltaY < 0 && !bottom 关跟尾；onScrollToLower 恢复跟尾。
- 影响与建议：Mini 的跟尾只在「节点数/队列变化」时触发，流式正文只增长不新增节点时会停止跟随（安卓注释明确指出这正是旧写法的问题）。建议改为「滚动事件里只要仍贴底就继续跟」，或在每个流式增量后检查是否贴底。

### D9 「加载更早」不自动触发，仅手动按钮
- 差异类型：交互不同
- 影响：中
- 安卓依据：ChatScreen.kt:432-445：顶部哨兵 item(key="earlier") 内 LaunchedEffect(store.firstSeq, store.loadingHistory) { if (settledInitialScroll) model.loadEarlier(store) }——滚到最上面自动拉更早历史；只有 loadingHistory 时才换成 spinner，平时是可点按钮。
- 小程序现状：src/pages/chat/index.tsx:324-331：只渲染一个 onClick={() => void store.loadEarlier()} 的按钮，没有哨兵/自动加载。
- 影响与建议：小程序必须手动点。建议补哨兵自动加载（同时保留按钮兜底）。

### D43 转写列宽上限（columnMaxWidth）未在小程序生效
- 差异类型：视觉不同
- 影响：小
- 安卓依据：ChatScreen.kt:421-428：LazyColumn .widthIn(max = Dimens.columnMaxWidth)（ui/theme/Theme.kt:18 = 760.dp）并 align(Alignment.TopCenter)，宽屏限宽居中。
- 小程序现状：src/pages/chat/index.module.scss 的 .transcript { flex:1; padding: 12px 12px 24px }，未使用 DIMENS.columnMaxWidth（src/const.ts:19 有该常量但聊天页未引用）。
- 影响与建议：平板/大屏一行过长。建议给转写容器加 max-width 居中。

### D45 转写行整行点击为空操作、缺少 Android 的复制反馈触觉
- 差异类型：交互不同
- 影响：小
- 安卓依据：ChatScreen.kt:459-462：整行 combinedClickable(onClick = {}, onLongClick = { rowMenu = true })；复制/查找跳转都会 haptics.performHapticFeedback(...)（:358、:488）。
- 小程序现状：src/pages/chat/index.tsx:340：只有 onLongPress={() => showRowMenu(node)}，没有触觉反馈（Taro 微信端可用 wx.vibrateShort）。
- 影响与建议：可选补触觉；点击空操作本身与安卓一致。

---

## 二、转写行与卡片

### D10 用户气泡配色：主题容器色 vs 固定品牌色
- 差异类型：视觉不同
- 影响：中
- 安卓依据：ui/component/MessageRow.kt:115-128：气泡 background(MaterialTheme.colorScheme.primaryContainer)、文字 onPrimaryContainer（随主题/深色模式）。
- 小程序现状：src/ui/messageRow.tsx:200-211：style={{ backgroundColor: color_primary }}（src/const.ts:5 #1c64f2）+ 白字（messageRow.module.scss 的 .bubbleText { color:#ffffff }）。
- 影响与建议：小程序不随主题走、且是深蓝实色，与安卓浅色容器差异明显。建议改成主题容器色体系。

### D11 图片附件失败态：失败占位 vs 永久骨架
- 差异类型：缺失（错误态）
- 影响：中
- 安卓依据：MessageRow.kt:161-204：bitmap 取不到且 loaded 后显示 Strings.imageUnavailable 文本（:193-199），未加载前才转圈（:201)；i18n/Strings.kt 有 imageUnavailable。
- 小程序现状：src/ui/messageRow.tsx:115-144：resolve 失败或返回 undefined 时 setLocalPath(undefined)，渲染骨架（loader-circle）永远不结束，没有失败文案；src/i18n/strings.ts 中也没有 imageUnavailable 键（grep 无结果）。
- 影响与建议：附件取不到时用户只看到一直转圈。建议补失败态与本地化文案。

### D12 多图相册分组与横滑缺失、尺寸不同
- 差异类型：视觉不同/缺失
- 影响：中
- 安卓依据：MessageRow.kt:219-243 ImageGallery：连续图片合一组，compact = refs.size > 1 时横滑、单张 IMAGE_MAX 280x220、多张 IMAGE_COMPACT 120x120（:207-213）；AssistantRow 按相邻图片块分组（:266-280）。
- 小程序现状：src/ui/messageRow.tsx:189-197（用户气泡逐张纵向排）、:257-267（助手逐张渲染）；messageRow.module.scss 的 .attachmentImage { width: 200px }、骨架 180x120，无横滑、无 compact 分组。
- 影响与建议：连续多图在小程序里纵向堆叠、占屏很高。建议按相邻块分组并做缩略横滑。

### D13 工具卡完全丢失 subCalls 子调用树
- 差异类型：缺失
- 影响：大
- 安卓依据：Cards.kt 的 ToolCard 递归渲染 data.subCalls（缩进 depth < 8），详情弹层里也逐层列出（见 ChatNode.kt:103 的 subagentCount 以及 Cards.kt 中嵌套 ToolCard 的分支）；数据层 state/SessionStore.kt 只把根调用挂成节点，子调用只能通过卡片递归看到。
- 小程序现状：数据层已经建好 subCalls（src/state/sessionStore.ts:2387-2400、src/model/chatNode.ts:202），但 src/ui/cards.tsx:123-175 的 ToolCard 只渲染本行的 args/result，没有任何 subCalls 渲染。
- 影响与建议：run_code 里派发的嵌套工具调用（子智能体调度等）在小程序里完全不可见。建议在 ToolCard 里递归渲染 subCalls（缩进/层级上限与安卓一致），并在详情区一并列出。

### D14 工具结果/read_image 的图片完全不渲染
- 差异类型：缺失
- 影响：大
- 安卓依据：Cards.kt:262-272：ToolResultView 先取 imageReferences(result.content) ?: lenientImageRefs(...)，有图就渲染 AttachmentImage 列表 + 文本（:264-271）；model/ImageBlocks.kt:167-180 的 readImageCard 还专门给 read_image 做「路径标签 + 图片 + 模型看到的文本」卡片。
- 小程序现状：src/ui/cards.tsx:215-266 的 ToolResultView 按 resultView.card 分派 terminal/read/search/web/diff，其余（含图片）一律 JsonTree（:264-265）；src/ui/messageRow.tsx:757 调 ToolCard 时没有传任何图片解析依赖（ToolCard 也没有该 prop）。
- 影响与建议：read_image、带 image 块的工具结果在小程序里看不到图，只剩 JSON。建议补图片分支并把 resolveImage/onOpenImage 贯通到 ToolCard/ToolResultView。

### D15 工具详情：全屏弹层+复制 vs 就地展开且无复制
- 差异类型：交互不同/缺失
- 影响：中
- 安卓依据：Cards.kt:104-150 CardDetailDialog（全屏 Dialog、TopAppBar 右上角复制按钮、关闭按钮）；ToolCard 点击行打开它。
- 小程序现状：src/ui/cards.tsx:143-173 ToolCard 点击行就地展开；onOpenDetail 是可选项（:129/:156-160），但聊天页 messageRow.tsx:757 从未传入 → 连「最大化」入口都没有；展开内容里没有复制按钮。
- 影响与建议：工具详情无法一键复制（Android 有）。建议至少在展开面板里补复制按钮；若要贴近安卓再补全屏详情。

### D16 思考卡：全屏弹层+复制 vs 就地 Markdown 展开
- 差异类型：交互不同
- 影响：中
- 安卓依据：Cards.kt:152-172 ThinkCard：点开 CardDetailDialog(..., text, ...)，正文用 SelectionText（纯文本可选中）+ 复制按钮；ThinkCard 摘要取首个非空行，空则 Strings.thinking。
- 小程序现状：src/ui/cards.tsx:91-121 ThinkCard 就地展开，用 MarkdownView 渲染思考文本（reasoning 被当 Markdown 解析），无复制。
- 影响与建议：思考文本一般不是 Markdown，按 Markdown 渲染可能改变原意；且无法复制。建议改纯文本渲染并补复制。

### D17 上下文行丢失 ContextForm 图标与 notice 摘要
- 差异类型：缺失/文案不同
- 影响：中
- 安卓依据：MessageRow.kt:310-331：摘要 contextCollapsedSummary(node.source) ?: node.provenanceLabel ?: Strings.contextInjected（:314-316）；图标按 ContextForm.from(source) 分派 INSTRUCTIONS/CATALOG/SNAPSHOT/NOTICE/RELAY/RECALL 六种（:317-325，model/ContextPresentation.kt）；点开是 CardDetailDialog。
- 小程序现状：src/ui/messageRow.tsx:361-379：summary = node.provenanceLabel ?? Strings.contextInjected（:368），没有 contextCollapsedSummary；图标只有 recall -> rotate-ccw / 其他 plus 两种（:370）。数据层 src/state/sessionStore.ts:516-543 的 contextProvenance 也只产出 role/label，无 form/summary。
- 影响与建议：notice 类上下文会显示插件/来源名而不是人能读的摘要，图标区分度也不足。建议移植 ContextPresentation（form 归类 + collapsed summary）。

### D18 TurnError 通知行不可点、无全文/复制弹层
- 差异类型：交互不同/缺失
- 影响：中
- 安卓依据：MessageRow.kt:67-69：ChatNode.TurnError -> NoticeRow(Icons.Default.Warning, node.data.message, error, detailed = true)；Cards.kt:185-198：detailed 为真时整行可点，点开 CardDetailDialog（可选中文本 + 复制）。
- 小程序现状：src/ui/messageRow.tsx:758-759：<NoticeRow tone="error" text={node.data.message} />；src/ui/cards.tsx:297-306 的 NoticeRow 是纯静态行，无 onClick/无弹层。
- 影响与建议：长错误信息在小程序里被单行省略且无法复制。建议给错误通知行补可点全屏详情 + 复制。

### D19 TurnProcess 展开态未落 store，过程行无法展开
- 差异类型：行为不同（功能缺失）
- 影响：大
- 安卓依据：MessageRow.kt:393-407：expanded = store.isTurnProcessExpanded(spec)，点击 store.setTurnProcessExpanded(spec, !expanded)；state/SessionStore.kt:1339-1365 的 applyTurnProcessFolding 按 expandedProcessKeys 决定是否把该轮的思考/工具行 removeAll { isFoldedProcessRow(it) }（:1350），展开后这些行才出现在转写里。
- 小程序现状：src/ui/messageRow.tsx:504-538：const [expanded, setExpanded] = useState(false)（:511），点击只切换本地 state（:525），展开区只重复计数行（:527-535）；src/state/sessionStore.ts:2575-2585 的 isTurnProcessExpanded/setTurnProcessExpanded 全仓无调用者（grep 只命中定义），而折叠过滤 isFoldedProcessRow 仍在生效（sessionStore.ts:2419）。
- 影响与建议：小程序里一轮的思考/工具行被永久折叠且无法展开，点「过程」只看到重复的计数文案。这是本区最严重的行为差距之一。建议把展开态接回 store（并保持重建后不丢失），或用本地 state 同步驱动 store 的展开集合。

### D20 轮次页脚多出 TPS/TTFT 两个胶囊
- 差异类型：视觉不同（额外）
- 影响：小
- 安卓依据：MessageRow.kt:451-456：页脚只有两个 StatPill——总 token（compactTokenCount(turnTotalTokens)，图标 DataUsage）与用时（formatDuration(runMs)，图标 Schedule），外加结束时刻文本；TPS/TTFT 只在点击用时后的 StatDialog 里出现（:481-495）。
- 小程序现状：src/ui/messageRow.tsx:656-703：页脚额外渲染 zap + TPS 胶囊（:690-695）和 play + TTFT 胶囊（:696-701），即最多 4 个读数胶囊（注释亦确认「时长之外的三个读数也各给一个胶囊」）。
- 影响与建议：窄屏下四个胶囊更容易换行。建议与安卓对齐为两个胶囊。

### D21 用量/用时明细：弹窗 vs 就地面板
- 差异类型：交互不同
- 影响：小
- 安卓依据：MessageRow.kt:466-495 StatDialog（AlertDialog，标题 + 完成按钮）；总量在标题栏。
- 小程序现状：src/ui/messageRow.tsx:550-623 UsagePanel/TimePanel 就地展开在页脚下方（:704-705）。
- 影响与建议：功能等价，属有意移植（注释已说明「避免在滚动容器里叠浮层」）。可不改，但需产品确认。

### D22 turnTail 的分支传参：seq vs turn
- 差异类型：行为不同
- 影响：小
- 安卓依据：MessageRow.kt:445：onFork(data.seq)；ChatScreen onFork = { seq -> model.fork(sessionId, seq) }（ChatScreen.kt:472-474）。
- 小程序现状：src/ui/messageRow.tsx:674：onFork(data.turn)；聊天页 onFork={turn => forkAtTurn(turn)}（chat/index.tsx:350），再由 turnRail 反查 seq（:252-255），查不到时退回 store.lastSeq。
- 影响与建议：轮次尚未进 turnRail（例如临时窗口）时会 fork 到错误位置。建议直接传 data.seq。

### D23 改动文件卡位置：页脚行之上 vs 之下
- 差异类型：视觉不同
- 影响：小
- 安卓依据：MessageRow.kt:423-425：Column { store?.let { ChangedFilesCard(...) }; Row { 复制/分支/胶囊… } }，卡片在页脚行上方。
- 小程序现状：src/ui/messageRow.tsx:662-713：先渲染 .tail 行（:663-703）与统计面板，最后才是 ChangedFilesCard（:706-712），卡片在页脚下方。
- 影响与建议：顺序不一致，读者对「本轮产出」的位置预期不同。建议对齐。

### D24 逐文件比较：AlertDialog vs 就地展开
- 差异类型：交互不同
- 影响：中
- 安卓依据：ChangedFilesCard.kt:159-198：点文件行 reviewing = file → ChangedFileDiffDialog（AlertDialog，标题为 file.display，完成按钮，正文 heightIn(max=420.dp) 纵向滚动）；未读到 diff 时显示 spinner（:187-191）。
- 小程序现状：src/ui/changedFilesCard.tsx:73-84：点行 setOpenPath(file.path) 就地展开；loadDiff 失败时 diffError = Strings.changedFilesUnavailable（:83），未读到显示「加载中…」文本（:116-117）。
- 影响与建议：小程序多了失败文案（安卓是无限 spinner），交互形态不同。功能可用，建议保留就地展开但统一失败/加载态语义。

### D25 改动卡的加载/超时配色与文案样式
- 差异类型：视觉不同
- 影响：小
- 安卓依据：ChangedFilesCard.kt:209-214：coarse 用 MaterialTheme.colorScheme.error；新增/删除行用 AddedTint(0xFF2E7D32)/DeletedTint(0xFFC62828)（:32-33、:152-153、:227-231）；展开全部带 ExpandMore/ExpandLess 图标（:105-109）。
- 小程序现状：src/ui/changedFilesCard.tsx:124-126：coarse 用 color_warning（#d97706）；新增/删除用 color_good #16a34a / color_bad #dc2626（:107-108、:140）；展开全部只有文字无图标（:155-163）。
- 影响与建议：色彩语义不一致（超时用警示黄 vs 错误红）。建议对齐。

---

## 三、错误/失败态与文案

### D26 失败轮次原因不本地化（AUTH/兜底）
- 差异类型：文案不同/缺失
- 影响：大
- 安卓依据：model/TurnFailureMessage.kt:19-23 turnFailureMessage：failure.code == "AUTH" -> Strings.turnFailureAuthInvalid（i18n/Strings.kt:327「API 密钥无效 / API key is invalid」），否则 failure.message，为空回退 Strings.turnFailureFallback（Strings.kt:329「智能体因错误中止 / The agent stopped with an error.」）；state/SessionStore.kt:943 用它写 TurnError 文案。
- 小程序现状：src/state/sessionStore.ts:1864-1871：message = str(failure.message) ?? str(reason.message) ?? "Turn failed"——AUTH 不替换、兜底是硬编码英文 "Turn failed"（:1866）；src/i18n/strings.ts 没有 turnFailureAuthInvalid/turnFailureFallback 键。
- 影响与建议：中文界面会出现 provider 英文原文，且兜底永远是英文。建议移植 turnFailureMessage 并补两条文案。

### D27 缺少 lastErrorMessage 全局 Snackbar
- 差异类型：缺失（错误态）
- 影响：中
- 安卓依据：ChatScreen.kt:241-246：LaunchedEffect(model.lastErrorMessage) → snackbarHost.showSnackbar(message) 并清空；Scaffold(snackbarHost = ...)（:399）。
- 小程序现状：src/state/appModel.ts:96 有 lastErrorStore，写入点遍布（:254…:942），但全仓只有 src/pages/new/index.tsx:34 读取它；聊天页 chat/index.tsx 没有任何 toast/snackbar 消费者（grep lastErrorStore 在 chat 页无命中）。
- 影响与建议：聊天页里 fork 失败、分页失败等操作错误可能静默无反馈。建议聊天页订阅 lastErrorStore 并 toast（安卓同口径）。

### D28 连接横幅：形态、显示条件、idle 映射
- 差异类型：视觉不同/行为不同
- 影响：大
- 安卓依据：ui/component/ConnectionBanner.kt:117-132：Connection.Idle -> null（首配/拆连不打扰）；reconnecting/connecting → 中性「连接中…」且不给重试（:124-126、:136-143）；Failed → offlineBannerTitle + 重试（:147-154）；Connected/Connecting/Idle → null。形态是悬浮胶囊（statusBarsPadding、widthIn(max=320.dp)、圆角 50%、阴影，:162-193），上滑可滑掉（DISMISS_DP=24.dp，:100-104、:174-189），挂在整个 App 的顶层（ui/App.kt:136-139）。
- 小程序现状：src/ui/connectionBanner.tsx:41-55：通栏内联条（connectionBanner.module.scss 的 .banner { display:flex; padding:8px 16px }），无胶囊/阴影/滑走手势；聊天页无条件渲染（chat/index.tsx:438-442），connected 时也显示绿色「已连接」；toneLabel 把 connected/connecting/reconnecting/failed 全画出来（:22-33）；isRetryable = failed || reconnecting（:42），reconnecting 也显示重试（安卓不给）。更关键：src/state/connection.ts:22-35 把 connectionTone({kind:"idle"}) -> "failed"，于是未连接/空闲状态会显示红色「连不上主机」（connectionFailed），与安卓 Idle → 不显示相反。
- 影响与建议：小程序在任何页面顶部常驻一条（含「已连接」绿条），空闲时还误报「连不上主机」。建议：idle 不显示；仅 connecting/reconnecting/failed 显示；failed 用 offlineBannerTitle 文案；改成悬浮胶囊并支持上滑 dismiss；全局挂载（而非只在列表/聊天页各画一次）。

### D29 连接横幅把原始异常当详情展示
- 差异类型：行为不同
- 影响：小
- 安卓依据：ConnectionBanner.kt:156-222：胶囊里只有图标 + 一句本地化结论（+ 重试），没有 detail 文本；注释明确「连不上时那句说明由列表页空状态去讲，提示条只负责把状态本身和一次重试摆到眼前」（:58-61），底层异常只进日志（:65）。
- 小程序现状：src/state/connection.ts:37-41 connectionSummary 返回 connection.message，而该 message 来自 describe(error)（appModel.ts:71-76，即原始异常/接口 detail）；connectionBanner.tsx:47 直接渲染 detail。
- 影响与建议：中文界面可能冒出英文底层异常。建议只用本地化结论，异常进日志/开发者信息。

### D44 会话页进场不清未读失败红点（需交叉确认）
- 差异类型：行为不同
- 影响：中
- 安卓依据：ChatScreen.kt:122-128：DisposableEffect(sessionId) { model.visibleSessionId = sessionId; model.markErrorSeen(sessionId) }；另 state/StreamCoordinator.kt:408/495 只有在 sessionIsOnScreen 时才 markErrorSeen（注释：否则后台会话一出错就被标成已读，红点永不会亮）。
- 小程序现状：chat/index.tsx:111-118 进场只 model.open(sessionId)，没有 markErrorSeen；src/state/streamCoordinator.ts:724-743 的 applyLiveEvent 在 apply 后无条件 store.markErrorSeen()（:742），没有 on-screen 判定。
- 影响与建议：mini 只在收到实时帧时清红点，打开一条「已失败但未再变动」的会话可能仍显示未读；同时无条件清已读会让后台错误也不亮红点（需与 A 区列表审计交叉确认 unreadError 的实际数据来源）。建议移植 sessionIsOnScreen 判定并在进场时显式 markErrorSeen。

---

## 四、文件链接与预览

### D30 图片类文件链接被当文本预览，不走图片查看器
- 差异类型：行为不同
- 影响：大
- 安卓依据：ChatScreen.kt:84-107：文件链接先判 ImageFileType.isImage(path)——图片走 SystemImageViewer.stageFile/open（ACTION_VIEW + content://），失败才 snackbar(Strings.imageOpenFailed)；非图片才进 FilePreviewSheet；ui/component/SystemImageViewer.kt 定义临时文件名与打开。
- 小程序现状：chat/index.tsx:348-349：onOpenFile 与 onOpenFileLink 一律 setPreview({path, sessionId}) → FilePreviewSheet（sheets.tsx:620-715，纯文本按行分页）；全仓 grep 无 ImageFileType/isImage（mini 没有图片类型判定）。
- 影响与建议：点击一个 .png/.jpg 链接会用文本方式打开二进制内容。建议按扩展名分流：图片走 Taro.previewImage / 图片查看，文本才走 FilePreviewSheet。

### D31 文件预览分页：底部哨兵自动加载 vs 手动按钮
- 差异类型：交互不同
- 影响：中
- 安卓依据：ui/screen/Sheets.kt:855-937：首屏 LaunchedEffect(path) { loadNextPage() }；正文底部 !eof -> LaunchedEffect(nextOffset) { loadNextPage() }（:933-934）自动续页；加载中在底部转圈。
- 小程序现状：src/ui/sheets.tsx:697-710：加载中显示「加载中…」文本；未 EOF 时渲染一个「加载更多」onClick（:706-709），不会自动续页。
- 影响与建议：小程序要多点一次。建议补底部哨兵自动加载。

### D32 文件预览缺少复制入口
- 差异类型：缺失
- 影响：小
- 安卓依据：Sheets.kt:898：FilePreviewSheet 用 CardDetailDialog(..., text, ...) 传入 copyText → 顶栏出现复制按钮（Cards.kt:129-134）。
- 小程序现状：src/ui/sheets.tsx:675-714：Sheet 只有标题/关闭；正文里没有复制动作（独立 preview 页有复制，见 src/pages/preview/index.tsx:137，但聊天页用的不是它）。
- 影响与建议：聊天页内预览无法一键复制全文。建议在 Sheet 头部补复制。

### D33 独立 preview 页面是死路由
- 差异类型：缺失（死代码）
- 影响：小
- 安卓依据：安卓没有独立的文件预览页，只有 FilePreviewSheet（Sheets.kt:855）与 ArchivedSessionsScreen.kt。
- 小程序现状：src/route.ts:9 注册 PREVIEW: "pages/preview/index"（注释「工作区文件预览」），但全仓无任何 openPage(pageRoutes.PREVIEW)（grep 只命中注册与路由常量）；src/pages/preview/index.tsx 同时承担文件预览与归档列表两个 ?archived=1 分支。
- 影响与建议：该页当前不可达，且归档入口实际走 ArchivedSheet（chat/index.tsx:528）。建议删除死页面或明确其用途，避免两套实现长期漂移。

### D34 已归档列表：无搜索/分组/不可用态，恢复文案不同
- 差异类型：缺失/文案不同
- 影响：中
- 安卓依据：ui/screen/ArchivedSessionsScreen.kt：独立全屏页，带搜索框（:98-117，占位 searchArchivedSessions）、按工作区分组（:170 的 ungrouped 兜底）、三种空态（:154-161：unavailableArchivedSessions / noArchived / searchNoResults）、每行 unarchiveSession + contentDescription = fmt(unarchiveSessionNamed, title)（:209-213）。
- 小程序现状：src/ui/sheets.tsx:565-610 ArchivedSheet：只是一个 Sheet 列表，无搜索、无分组、无「记录不可用」态；空态只有 noArchived（:588-589）；行内文案是 Strings.restore「恢复/已恢复」（i18n/strings.ts:79）而非「取消归档」；无 aria 描述。
- 影响与建议：会话多时归档列表难找。建议至少补搜索与不可用态，并统一「取消归档」用语。

---

## 五、Markdown 渲染与文本交互

### D35 无障碍：图标无 contentDescription/aria
- 差异类型：缺失（无障碍）
- 影响：中
- 安卓依据：关键图标均有描述，例如查找上一个/下一个 Strings.findPrevious/findNext（ChatScreen.kt:311/314）、关闭 Strings.close（:319）、回到底部 Strings.scrollToBottom（:569）、复制 Strings.copyAction（MessageRow.kt:439）、分支 Strings.messageBranch（:447）、归档取消 unarchiveSessionNamed（ArchivedSessionsScreen.kt:213）。
- 小程序现状：src/ui/icon.tsx:13-29：Icon 只是 <Text> 字形，没有 aria-label/可访问名；查找、清除、回到底部、复制、分支等图标都未提供替代文本。
- 影响与建议：读屏用户无法识别这些操作。建议给可交互图标补 aria-label（Taro 微信端可用 aria-label 属性）。

### D36 正文文本选择缺失（仅气泡/上下文详情可选）
- 差异类型：行为不同
- 影响：中
- 安卓依据：MessageRow.kt:116-129（用户气泡 SelectionContainer）、:284-297（助手正文 SelectionContainer + MarkdownText）；卡片详情 Cards.kt:174-183 的 SelectionText 也是可选中。
- 小程序现状：只有用户气泡（messageRow.tsx:205 userSelect）与上下文详情（:374 userSelect）可选中；助手正文 MarkdownView、工具详情、思考卡都没有 userSelect（markdown.tsx 的 Text 未设置），也没有 user-select 样式。
- 影响与建议：助手回答无法长按选中复制。建议给正文 Text 统一加 userSelect。

### D37 @提及：正文下方独立链接条 vs 正文内联
- 差异类型：视觉不同/行为不同
- 影响：中
- 安卓依据：MessageRow.kt:256-259 取 store.closingMentions(...)，:289-296 把 fileMentions 交给 MarkdownText；Markdown.kt 的 inlineText 在行内代码/文本里用 TurnDeliverables.resolveMention 把命中词渲染成可点链接（正文内联高亮）。
- 小程序现状：messageRow.tsx:274 在正文之后另起 MentionStrip（:286-306），渲染去重后的 @basename 链接；MarkdownView 的 props（markdown.tsx:160-170）没有 fileMentions 口子（代码注释亦承认「MarkdownView 接口没有传 mention 的口子」）。
- 影响与建议：提及与正文脱节、只显示 basename（丢目录），且正文里的 mention 不高亮不可点。建议给 MarkdownView 加 mentions 解析（并保留 strip 作为兜底）。

### D38 Markdown 图片语法退化为 alt 文本
- 差异类型：行为不同
- 影响：中
- 安卓依据：Markdown.kt 的行内渲染对 Image 有专门分支（GfmAutolink.kt 负责 autolink；Markdown 里图片/链接的安全 URL 处理在 GfmAutolink.isSafeExternalUrl，:34-42）；图片类型文件走系统查看器（ChatScreen.kt:84-107）。
- 小程序现状：src/ui/markdown.tsx:470-478：case "image" 只渲染 image.text || image.href 的 Text（注释：「小程序里图片加载受业务域名限制，这里退化成 alt 文本」）。
- 影响与建议：这是平台约束（业务域名白名单）。建议至少把图片路径做成可点链接（交给 D30 的图片查看分支），而不是纯文本。

### D39 外部链接点击：复制地址 vs 系统浏览器
- 差异类型：行为不同
- 影响：中
- 安卓依据：Markdown.kt 对安全外链（http/https/mailto，GfmAutolink.kt:34-42）加 LinkAnnotation，点击交给系统浏览器；ChatScreen.kt:470-471 的 onOpenLink 只处理工作区文件，其余由系统处理。
- 小程序现状：markdown.tsx:451-469：parseFileLink(link.href) 为 undefined（外部地址）时 void copyToClipboard(link.href)——只复制地址，不打开。
- 影响与建议：小程序里点外链不会跳转。可在小程序内用 wx.setClipboardData + 提示，或用 web-view 页/复制后引导；需产品决定，但当前行为与安卓不同。

### D40 行内代码的 mention 词表解析缺失
- 差异类型：缺失
- 影响：小
- 安卓依据：Markdown.kt 行内代码先查 TurnDeliverables.resolveMention(literal, scope.mentions)，命中交付物就渲染成文件链接（参数 fileMentions 在 MarkdownText 签名里，:159）。
- 小程序现状：markdown.tsx:431-450 的 codespan 只用 parseInlineCodeFileLink（路径形状判定），不认识 mentions 词表；mention 改由 D37 的独立链接条承担。
- 影响与建议：与 D37 同源，修 D37 后此项自动收敛。

---

## 六、数据模型/序列化

### D41 encodeContentBlock 丢失 tool-result 嵌套 content
- 差异类型：行为不同
- 影响：中
- 安卓依据：model/ChatNode.kt:51-70 encodeContentBlock：tool-result 分支 put("content", buildJsonArray { block.content.forEach { add(encodeContentBlock(it)) } })，并注释「漏了 content 等于把嵌套工具结果整段丢掉」。
- 小程序现状：src/model/chatNode.ts:61-62：case "tool-result": return { type:"tool-result", toolCallId, isError }——没有 content。
- 影响与建议：toolResultText/resultFirstLine（chatNode.ts:400-420）对嵌套非文本块会少掉整段内容（复制文本、结果首行都会不完整）。建议补齐 content 编码。

### D42 长按行菜单：DropdownMenu vs 系统 ActionSheet
- 差异类型：交互不同
- 影响：小
- 安卓依据：ChatScreen.kt:479-502：行内 DropdownMenu，复制（chatNodeSearchText，非空才给）+ 从此处分支；复制后触觉反馈。
- 小程序现状：chat/index.tsx:280-297：wx.showActionSheet，itemList [copy, forkHere]（不可复制时只 [forkHere]），复制走 wx.setClipboardData。
- 影响与建议：系统 ActionSheet 与锚定菜单观感不同但功能等价；可保留。

---

## 七、已核对为「基本一致」的点（不作为差异）

- 转写节点构成与渲染条件：chatNodeRendersRow / TurnTail 的 rendersRow 门控两边一致（安卓 MessageRow.kt:74-75，小程序 messageRow.tsx:768-778）。
- 查找筛选口径：两边都按 chatNodeSearchText 大小写不敏感过滤（安卓 ChatScreen.kt:139-146，小程序 chat/index.tsx:152-158）。
- 逐字高亮配色：#ffff00 / #ff9632 与安卓 DshFind.match/activeMatch 完全一致（findHighlight.module.scss vs FindHighlight.kt:20-23）。
- 列表项上限：JSON 200 / read 400 / diff 400（安卓 Cards.kt:250/299/328，小程序 cards.tsx:24-26）。
- ToolRow 变体与摘要键：TOOL_VARIANTS / KEYED_ROW_TOOLS / SUMMARY_KEYS 逐条一致（model/ToolRow.kt:30-65 vs src/model/toolRow.ts:18-56）。
- 改动卡 CHANGED_FILES_SHOWN = 3、二进制/过大/无变化文案键一致。
- 轮次轨道预览裁剪常量 50/120 与裁剪算法一致（Format.kt:267-285 vs format.ts:209-229）。
- TurnProcess 折叠算法（含折叠时隐去答案步骤 reasoning）两边都有（SessionStore.kt:1339-1365 vs sessionStore.ts:2410-2431）。
- 用户气泡 82% 宽度、bubbleRadius=18、messageTopInset 语义一致。
- 空会话/历史错误/加载三态文案与条件基本一致（ChatScreen.kt:527-555 vs chat/index.tsx:384-387/464-479）。

---

## 八、不确定项（需进一步确认）

1. D44 的未读红点数据源：streamCoordinator.ts:742 无条件 markErrorSeen 是否真的导致后台错误不亮红点，取决于 appModel 如何发布 erroredSessions（appModel.ts:360/424）以及列表页读哪份数据——属 A 区，需交叉确认。
2. 悬浮 banner 的全局性与页面级 banner 的重复：小程序在列表页（pages/index/index.tsx:396）与聊天页各挂一条 ConnectionBanner；Android 是 App 级单条。是否会出现「已连接绿条常驻」的体感差异，需真机验证（代码上 mini 无条件渲染，倾向会）。
3. Markdown 深色模式：markdown.module.scss 未逐条核对深色主题变量，仅确认结构差异；视觉色值需在真机/DOM 下比对。
4. 小程序 Input 的 focus 属性行为：每次重渲染是否稳定保持键盘，未在真机验证（D7 据此只列为小影响）。
5. 图片文件链接分流：Taro.previewImage 需要本地临时路径；工作区文件要先下载，mini 目前没有相应链路（grep 无 downloadFile 用于预览），实现成本待评估。

---

## 九、最重要的 5 条（按优先级）

1. D13 工具卡 subCalls 子调用树完全缺失——run_code 派发的嵌套工具调用/子智能体调度在小程序不可见。
2. D14 工具结果与 read_image 的图片完全不渲染——read_image 等结果退化成 JSON，用户看不到图。
3. D19 TurnProcess 展开态未接 store，过程行永久折叠不可展开——点击只重复计数文案，思考/工具行永远出不来。
4. D28 连接横幅形态/显示条件/idle 误报——小程序常驻通栏（含「已连接」绿条），空闲态误显示「连不上主机」，且不可滑走、非全局。
5. D26 失败轮次原因不本地化——AUTH 不替换、兜底硬编码英文 "Turn failed"，中文界面会出现英文原文。

紧随其后值得优先处理：D30 图片文件链接被当文本预览、D11 图片附件失败态缺失、D27 聊天页缺少操作错误提示、D1 轮次轨道形态、D8 流式跟尾策略。

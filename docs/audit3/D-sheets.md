# D 区（底部弹层 / 对话框）审计（第三轮）

> 口径：安卓为权威。本文只依据两端**当前源码**逐行比对，历史审计文档（docs/DIFF-ANDROID*.md、docs/audit/C-composer-sheets.md 等）只作线索，不作为结论；下文所有差异均已回源码验证。
> 覆盖：Sheets.kt 的全部弹层（模型选择 / 上下文明细 / 会话面板 / 审批 / 提问 / 计划评审 / 文件预览）、Cards.kt 的 `CardDetailDialog`、ChatScreen.kt 的三个内联 DropdownMenu（轮次 / 更多 / 行长按）、ComposerBar.kt 的目标与队列编辑对话框，以及小程序端 `src/ui/sheets.tsx(+sheets.module.scss)`、`src/ui/cards.tsx`、`src/ui/cardDetail.tsx(+module.scss)`、`src/ui/composerBar.tsx`、`src/pages/chat/index.tsx` 中对应的弹层部分。

## 概览

| 编号 | 差异一句话 | 安卓位置 | 小程序位置 | 优先级 | 建议 |
| --- | --- | --- | --- | --- | --- |
| D-01 | 文件预览：安卓是全屏 CardDetailDialog（顶栏关闭/图标/文件名/复制），小程序是底部 Sheet | Sheets.kt:898、Cards.kt:115-149 | sheets.tsx:710 | P1 | 复用 `openCardDetail` 改成全屏壳 |
| D-02 | 提问/计划评审：底部操作区与头部随正文一起滚动，安卓头部与底部固定 | Sheets.kt:666-677、721-777、799-839 | sheets.tsx:122-131、895-978 | P1 | Sheet 支持固定 footer/header 插槽 |
| D-03 | 上下文明细：「Token 用量」section 行的总值被丢掉，安卓在标题右侧渲染总值 | Sheets.kt:266、405 | sheets.tsx:466、512-514 | P1 | section 行右侧也渲染 value |
| D-04 | 会话面板/上下文弹层多出一条「空标题栏 + 关闭 ×」，安卓两弹层都没有标题栏 | Sheets.kt:286、460 | sheets.tsx:116-121、229、478 | P2 | 无标题时隐藏 header 或传 hideHeader |
| D-05 | 弹层最大高度：安卓每层各有 dp 上限（560/600/640/620/640），小程序统一 78vh/66vh | Sheets.kt:59、290、464、638、793 | sheets.module.scss:18-27、62-65 | P2 | 按层给 max-height 变量 |
| D-06 | 模型加载态：安卓 160dp 居中转圈，小程序一行文字 | Sheets.kt:72-76 | sheets.tsx:586-588 | P2 | 换回 spinner |
| D-07 | 模型弹层多出错误文案与 failures 明细行，安卓两者都不渲染 | Sheets.kt:84-135（无） | sheets.tsx:589、607-612 | P2 | 与安卓一致或明确标注为增强 |
| D-08 | 模型分页签：安卓 TabRow 下划线页签，小程序胶囊按钮 | Sheets.kt:60-64 | sheets.tsx:580-583 | P2 | 换成等宽下划线页签 |
| D-09 | 切换模型中：安卓整列 alpha0.5 且禁滚，小程序只降透明度、仍可滚 | Sheets.kt:78-83 | sheets.tsx:592 | P2 | 加滚动锁 |
| D-10 | 模型分组标题/行高与安卓 ListItem 口径不同 | Sheets.kt:87-92、97-112 | sheets.module.scss:295-320 | P2 | 对齐 padding 16/8 与行高 |
| D-11 | 上下文占用条 4dp→6px、图例色块 8dp→10px | Sheets.kt:327-332、373-377 | sheets.module.scss:199-226 | P2 | 条 4px、块 8px |
| D-12 | 上下文百分比/用量字号与颜色：安卓用 titleSmall，小程序 15px/12px faint | Sheets.kt:310-320 | sheets.module.scss:182-197 | P2 | 用量行提到正文色 |
| D-13 | 会话面板产物行主点击 = 内嵌预览（安卓 = 在电脑上打开），且多一个 leading 图标 | Sheets.kt:522-527 | sheets.tsx:286-304 | P2 | 主点击改为 openOnHost |
| D-14 | 会话面板产物在近 5 轮找不到时走本地推断，安卓直接为空 | Sheets.kt:450-458 | sheets.tsx:210 | P2 | 去掉兜底 |
| D-15 | 待办图标与颜色映射不同（绿色/橙色 hex 不同） | ComposerBar.kt:701-712 | sheets.tsx:153-157、121-131 | P2 | 色值对齐 |
| D-16 | 审批标题放在 Sheet 头栏，安卓在正文第一行且无关闭键 | Sheets.kt:565-571 | sheets.tsx:784 | P2 | 标题回到正文 |
| D-17 | 审批按钮间距 10px vs 8dp；命令块换行策略不同 | Sheets.kt:578-598、577 | sheets.module.scss:407-431、394-405 | P2 | gap 8、命令横向滚动 |
| D-18 | 提问选项：安卓真实 Checkbox/RadioButton，小程序自绘方/圆图标；推荐标签位置不同 | Sheets.kt:675-703 | sheets.tsx:912-933 | P2 | 视觉对齐 + 推荐标签贴标签 |
| D-19 | 提问自定义输入：安卓 OutlinedTextField（浮动 label），小程序 Textarea（placeholder） | Sheets.kt:705-718 | sheets.tsx:935-942 | P2 | 加字段 label |
| D-20 | 提问底部主按钮禁用态只是换色，仍可点；安卓用 enabled=false | Sheets.kt:772-775 | sheets.tsx:972-977 | P2 | 真禁用态 |
| D-21 | 计划评审标题/输入框/按钮：结构与安卓同，但底部按钮同样随滚动 | Sheets.kt:794-839 | sheets.tsx:822-843 | P2 | 同 D-02 |
| D-22 | 文件预览复制入口：安卓顶栏图标（总是有），小程序正文行（有正文才出现） | Sheets.kt:898、Cards.kt:129-135 | sheets.tsx:715-720 | P2 | 复制放回顶栏 |
| D-23 | 文件预览续页：安卓底部哨兵自动取，小程序滚动触底 + 显式「加载更多」按钮 | Sheets.kt:930-936 | sheets.tsx:698-701、745-750 | P2 | 保留按钮可，但与安卓口径说明 |
| D-24 | 文件预览正文：安卓等宽块横向滚动不换行，小程序自动换行 | Cards.kt:353-366 | sheets.module.scss:350-358 | P2 | 二选一，注明 |
| D-25 | CardDetailDialog 基本对齐；section 容器底色用 page bg 而安卓是 surfaceVariant | Cards.kt:481 | cards.module.scss:113-117 | P2 | 用卡片/次级底色 |
| D-26 | 目标菜单：安卓锚定 DropdownMenu，小程序系统 ActionSheet；清除项无红色 | ComposerBar.kt:736-762 | composerBar.tsx:354 | P2 | 自绘锚定菜单；无红色需说明限制 |
| D-27 | 目标/队列编辑：安卓 AlertDialog + OutlinedTextField，小程序 wx.showModal | ComposerBar.kt:766-780、860-872 | composerBar.tsx:359-369、410-419 | P2 | 平台等价，注意单行/多行差异 |
| D-28 | 队列行：安卓固定 44dp 行高、16dp 图标，小程序 padding 5px、13px 图标、时钟图标不同 | ComposerBar.kt:811-856 | composerBar.tsx:422-443、171-206 | P2 | 行高与图标对齐 |
| D-29 | 行长按菜单/更多菜单：安卓 DropdownMenu（带图标），小程序 ActionSheet（无图标） | ChatScreen.kt:459-503、377-394 | chat/index.tsx:312-351 | P2 | 平台限制，注明 |
| D-30 | 轮次菜单：安卓是顶栏 DropdownMenu；小程序是常驻右侧 132px 内联轨道栏 | ChatScreen.kt:324-374 | chat/index.tsx:561-582、index.module.scss:141-186 | P1（跨区，可能属 B/C） | 收敛为弹出菜单或再讨论 |

## 逐条详情

### D-01 文件预览的弹层形态：全屏详情对话框 vs 底部弹层（P1）

* **证据**
  * 安卓 `ui/screen/Sheets.kt:898`：`CardDetailDialog(Icons.Default.Description, pathBasename(path).ifEmpty { path }, text, onDismiss) {` —— 文件预览走的是 `ui/component/Cards.kt:115-149` 的 `Dialog(properties = DialogProperties(usePlatformDefaultWidth = false)) + Surface(fillMaxSize) + Scaffold(TopAppBar)`，即**全屏**弹层：左上关闭、标题带 Description 图标、右上复制、正文 `padding(Dimens.columnInset)` 可滚。
  * 小程序 `src/ui/sheets.tsx:710`：`<Sheet open={props.open} title={title} onClose={props.onClose} onReachBottom={autoLoad}>` —— 走的是底部 `Sheet`（`sheets.module.scss:18-27` 的 78vh 底部面板 + 遮罩）。
  * 小程序其实已有全屏壳 `src/ui/cardDetail.tsx:36-69`（`CardDetailHost`，fixed 全屏 + NavBar），只是文件预览没走它。
* **差异**：同一操作在安卓全屏铺满，在小程序只占屏幕下半部，且顶部是底部弹层的拖拽把手而非安卓的 TopAppBar；用户拿到的可读面积与「返回/关闭」语义都不同。
* **建议**：把 `FilePreviewSheet` 改为使用 `openCardDetail`（图标用 `file-text`、标题 basename、copyText=text），或至少让 `Sheet` 支持一个 `fullscreen` 变体。目标结构 = `CardDetailDialog`：全屏 + 左上关闭 + 标题（图标+文件名）+ 右上复制 + 正文 16px 内边距可滚。
* **风险/不确定**：改全屏后要处理与 `CardDetailHost` 的 z-index（1000 > 900）互斥，避免文件预览打开时下面还压着别的 Sheet。

### D-02 提问 / 计划评审的头部与底部操作区未固定（P1）

* **证据**
  * 安卓 `Sheets.kt:638`：`Column(Modifier.fillMaxWidth().heightIn(max = 620.dp))` → `641-664` 头部 Row（问题 header/正文 + 关闭键）在滚动区**之外**；`666-719` 只有中段 `Column(Modifier.weight(1f, fill = false).verticalScroll(scroll)...)` 滚动；`721-777` 底部 `Column`（校验文案 + 上一题/进度/下一题 + 跳过 + 提交）同样在滚动区**之外**，所以永远钉在底部。
  * 计划评审同理：`Sheets.kt:793-804` 标题固定，`799-804` 只有计划正文 `weight(1f).verticalScroll`，`805-839` 的反馈输入框与「讨论/拒绝/批准」固定在底部。
  * 小程序 `sheets.tsx:122-131`：`<ScrollView ... className={styles.sheetBody}>{props.children}</ScrollView>` —— Sheet 把**所有** children（含 `895-978` 的 `questionHeader`、`947-978` 的 `questionFooter`、以及 PlanReview 的 `822-843` 按钮行）塞进同一个 ScrollView。
* **差异**：题目/选项较长时，小程序里「上一题/下一题/跳过/提交」会被滚出屏幕，头部也会滚走；安卓这两个区域固定，正文独立滚动。
* **建议**：给 `Sheet` 增加 `header` / `footer` 插槽（header、footer 固定，只有中间 body 进 ScrollView），QuestionSheet/PlanReviewSheet 用插槽承载头部与底部按钮；目标结构对齐 `Sheets.kt:638-778` 的三段式。
* **风险/不确定**：需在开发者工具/真机确认固定 footer 后，键盘弹起时 Textarea 不会被 footer 遮挡（当前所有内容同滚时反而不容易遮）。

### D-03 上下文明细丢失「Token 用量」section 的总值（P1）

* **证据**
  * 安卓 `Sheets.kt:266`：`rows.add(ContextDetailRow(Strings.statsUsageTitle, tokenCount(usage.total), section = true))`，而 `DetailRow`（`Sheets.kt:388-407`）无论 section 与否都渲染 `Spacer(weight(1f)); Text(row.value, style = bodyMedium)`（`:404-405`）——所以安卓标题行右侧显示总量。
  * 小程序 `sheets.tsx:466`：`detailRows.push({ label: Strings.statsUsageTitle, value: tokenCount(saturatingAdd(billed, output)), section: true });`，但渲染 `sheets.tsx:512-514`：`row.section === true ? <Text className={styles.detailSection}>{row.label}</Text> : <DetailRow .../>` —— section 分支**只渲染 label，丢掉 value**。
* **差异**：小程序「Token 用量」标题右侧没有总量读数；安卓有。属于内容缺失而非纯样式。
* **建议**：section 行渲染为 `label + value` 两端对齐（可复用 `DetailRow` 并给 label 加粗），对齐 `Sheets.kt:396-405`。
* **风险/不确定**：无。

### D-04 无标题弹层多出「空标题栏 + 关闭 ×」（P2）

* **证据**
  * 安卓上下文弹层 `Sheets.kt:286` `ModalBottomSheet(onDismissRequest = onDismiss)` 内直接是 `Column(...)`，没有标题、没有关闭键；会话面板 `Sheets.kt:460` 同样无标题。
  * 小程序 `sheets.tsx:116-121`：`{props.hideHeader === true ? null : (<View className={styles.sheetHeader}><Text className={styles.sheetTitle}>{props.title ?? ''}</Text><Icon name='x' .../></View>)}`。`SessionPanelSheet`（`sheets.tsx:229`）与 `ContextSheet`（`sheets.tsx:478`）都没传 `title`、也没 `hideHeader`，于是渲染出一条空白标题行 + 关闭 ×（`sheets.module.scss:38-44`，带 border-bottom）。
* **差异**：小程序这两个弹层顶部比安卓多约一行（10+~20+10 px）的空白栏与一个安卓不存在的关闭键，压缩了正文高度。
* **建议**：无 title 时自动 `hideHeader`（或这两个调用显式传 `hideHeader`）；关闭统一靠遮罩/下拉，与安卓 ModalBottomSheet 一致。
* **风险/不确定**：小程序没有系统 back 手势，保留 × 对可发现性有好处——若产品选择保留，建议至少把空标题栏去掉只留 ×。

### D-05 弹层最大高度不按层设定（P2）

* **证据**
  * 安卓逐层设上限：模型 `Sheets.kt:59` `heightIn(max = 560.dp)`；上下文 `:290` `max = 600.dp`；会话面板 `:464` `max = 640.dp`；提问 `:638` `max = 620.dp`；计划评审 `:793` `max = 640.dp`。
  * 小程序统一 `sheets.module.scss:20` `.sheet { max-height: 78vh }` + `:64` `.sheetBody { max-height: 66vh }`。
* **差异**：同一套高度对所有弹层生效，短内容弹层（审批）与长列表弹层（模型）没有区分；在矮屏上 78vh 可能比安卓 560dp 更高或更低。
* **建议**：给 `Sheet` 增加 `maxHeight`（或按 sheet 类型）属性，按安卓的 560/600/620/640 上限逐层设置。
* **风险/不确定**：安卓 dp 与小程序 vh 不是同一坐标系，需真机核对目标数值换算。

### D-06 模型加载态：转圈 vs 一行文字（P2）

* **证据**
  * 安卓 `Sheets.kt:72-76`：`if (directory.status == LOADING && directory.current == null) { Box(Modifier.fillMaxWidth().height(160.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }`。
  * 小程序 `sheets.tsx:586-588`：`directory.status === 'loading' && directory.current === undefined ? <Text className={styles.empty}>{Strings.statusLoading}</Text> : null`（`.empty` 是 24px 上下留白的居中文案，`sheets.module.scss:133-139`）。
* **差异**：加载中安卓是 160dp 高容器里的 spinner，小程序只有一行「加载中…」文字，视觉与占位都不同。
* **建议**：改为与安卓一致的居中 `loading` 转圈 + 160px 高度占位。
* **风险/不确定**：无。

### D-07 模型弹层多渲染错误与 failures 行（P2）

* **证据**
  * 安卓 `Sheets.kt:84-135` 只遍历 `directory.groups`（并按 tab 渲染 efforts）；`directory.error` 与 `directory.failures`（Models.kt:120）在 `ModelPickerSheet` 中**均无渲染分支**。
  * 小程序 `sheets.tsx:589`：`directory.status === 'error' ? <Text className={styles.errorText}>...` ；`sheets.tsx:607-612` 额外遍历 `directory.failures` 渲染 `failure.name + failure.message`。
* **差异**：小程序模型弹层比安卓多两类内容行。
* **建议**：要么与安卓口径一致（不渲染），要么在文档/注释中登记为「小程序增强」，避免后续再把差异当成 bug 反复修。若保留 failures，建议复用安卓的错误色与行结构而不是 `modelRow`。
* **风险/不确定**：`directory.failures` 可能对排查下游 provider 很有用，取舍需产品确认。

### D-08 模型页签：TabRow vs 胶囊按钮（P2）

* **证据**
  * 安卓 `Sheets.kt:60-64`：`TabRow(selectedTabIndex = tab) { Tab(tab == 0, ...) ; Tab(tab == 1, ...) }` —— Material 下划线页签、等宽铺满。
  * 小程序 `sheets.tsx:580-583`：`<View className={styles.tabRow}><Text className={styles.tab + ...}>...` + `sheets.module.scss:275-293`（`padding 6px 12px; border-radius: 14px` 的胶囊，选中填主色）。
* **差异**：页签形态与选中指示器完全不同。
* **建议**：若要与安卓视觉一致，用等宽两栏 + 底部 2px 下划线指示器；保留胶囊则登记为设计差异。
* **风险/不确定**：无。

### D-09 切换模型中列表仍可滚动（P2）

* **证据**
  * 安卓 `Sheets.kt:78-83`：`LazyColumn(Modifier.fillMaxWidth().alpha(if (selecting) 0.5f else 1f), userScrollEnabled = !selecting)`，且 `ListItem(clickable(enabled = !selecting))`。
  * 小程序 `sheets.tsx:592`：`<View className={selecting ? styles.modelListBusy : ''}>`，`sheets.module.scss:587-589` 只有 `opacity: 0.5`；滚动未锁（点击在 `pickModel/pickEffort` 里用 `if (selecting) return` 兜住）。
* **差异**：小程序在切换模型请求途中列表仍能滚动，安卓整列锁定。
* **建议**：selecting 期间给列表容器加滚动锁（小程序 ScrollView 需用 `scroll-y={!selecting}` / `enable-flex` 之类受控属性，或加 `pointer-events` 兜底）。
* **风险/不确定**：Taro ScrollView 没有直接禁用滚动的属性，可能需要在外层盖一层透明遮罩来拦截手势——需开发者工具验证。

### D-10 模型分组标题与行高（P2）

* **证据**
  * 安卓 `Sheets.kt:87-92` 分组名 `padding(horizontal = 16.dp, vertical = 8.dp)`、`labelLarge`、`onSurfaceVariant`；`97-112` 每行 `ListItem`（M3 默认高度约 56dp）。
  * 小程序 `sheets.module.scss:295-301` `.modelGroupTitle { padding: 10px 0 4px; font-size: 12px }`；`303-309` `.modelRow { min-height: 44px }`。
* **差异**：分组标题上下间距与字号、行高都不同（44px vs ~56dp）。
* **建议**：分组名按 16px 水平（body 已有 16px 内边距则 8px 上下）、行高提到 ~52-56px。
* **风险/不确定**：无。

### D-11 上下文占用条/图例尺寸（P2）

* **证据**
  * 安卓 `Sheets.kt:327-332`：`Row(Modifier.fillMaxWidth().height(4.dp).clip(CircleShape)...)`；图例色块 `Sheets.kt:373-377` `Modifier.size(8.dp).clip(RoundedCornerShape(2.dp))`。
  * 小程序 `sheets.module.scss:199-208` `.barTrack { height: 6px; border-radius: 3px }`；`:221-226` `.legendSwatch { width: 10px; height: 10px }`。
* **差异**：占用条 4dp→6px、色块 8dp→10px。
* **建议**：条改 4px（`border-radius: 2px`），色块改 8px。
* **风险/不确定**：无。

### D-12 上下文百分比/用量文字样式（P2）

* **证据**
  * 安卓 `Sheets.kt:307-320`：前后文案 `bodyMedium onSurfaceVariant`、百分比 `titleSmall`、右侧 `"~used / window"` 也是 `titleSmall`（正文色，非次级灰）。
  * 小程序 `sheets.module.scss:182-197`：`occupancyLine 13px`、`occupancyPercent 15px/600`、`occupancySub 12px 且 color: var(--dsh-color-text-faint)`。
* **差异**：右侧用量在安卓是 titleSmall 正文色（显眼），小程序是 12px 最浅灰。
* **建议**：`occupancySub` 提到 14px、用 `--dsh-color-text`（或与百分比同级）。
* **风险/不确定**：无。

### D-13 会话面板「产物」行主点击语义不同（P2）

* **证据**
  * 安卓 `Sheets.kt:519-528`：`ListItem(modifier = Modifier.clickable { model.openOnHost(file.path) }, headlineContent = { Text(pathBasename(file.path), maxLines = 1) }, supportingContent = file.description?...)` —— 整行点击 = **在电脑上打开**，无 leading 图标、无次级按钮。
  * 小程序 `sheets.tsx:286-304`：行 `onClick={() => props.onOpenFile(file.path)}`（打开内置预览），另加 `294-304` 的 `maximize-2` 次级图标调 `onOpenOnHost`；且 `287` 多一个 `file-text` leading 图标。
* **差异**：主点击目标相反（预览 vs 电脑打开），并多出图标与次级入口。
* **建议**：安卓口径为主时，整行改 `onOpenOnHost`；若确实需要内嵌预览，把它放到次级图标，且去掉 leading 图标以对齐 ListItem 结构。
* **风险/不确定**：小程序没有系统文件查看器，`openOnHost` 需要主机侧配合；若产品更看重站内可读，需在文档登记。

### D-14 会话面板产物兜底推断（P2）

* **证据**
  * 安卓 `Sheets.kt:450-458`：只在 `turn downTo maxOf(turn-5,0)` 里找 `store.presentedFiles(candidate)`，找不到就 `found = emptyList()`。
  * 小程序 `sheets.tsx:210`：`return turnDeliverablesFor(store.nodes);` —— 投影里没有 deliverables 时退回「从工具调用参数推断产物」。
* **差异**：小程序会显示安卓根本不显示的产物行。
* **建议**：去掉 `turnDeliverablesFor` 兜底，或仅在没有 sessionStats 时按安卓口径返回空。
* **风险/不确定**：该兜底可能对应某些早期协议缺失场景，删除前确认主机端已推 deliverables。

### D-15 待办图标与颜色映射（P2）

* **证据**
  * 安卓 `ComposerBar.kt:701-712`：`todoIcon` = `CheckCircle / Autorenew / RadioButtonUnchecked`；`todoColor` = `0xFF2E7D32`（绿）/ primary / `0xFFE08600`（橙）；`Sheets.kt:471-475` 的 `ListItem(leadingContent = { Icon(todoIcon(...), tint = todoColor(...)) })`。
  * 小程序 `sheets.tsx:153-157`：`check / refresh-cw(旋转) / circle`；`sheets.module.scss:121-131`：`--dsh-color-good(#16a34a) / primary / --dsh-color-warning(#d97706)`。
* **差异**：绿色与橙色 hex 与安卓不同（#16a34a vs #2E7D32，#d97706 vs #E08600）。
* **建议**：在 `vars.scss` 的语义色里为 todo 单独对齐安卓色值，或直接使用同一组语义 token。
* **风险/不确定**：同一组色也被 ComposerBar 的待办带复用，改动要两边一起。

### D-16 审批标题位置（P2）

* **证据**
  * 安卓 `Sheets.kt:565-576`：`Text(Strings.approvalTitle, style = titleMedium)` 是正文第一行；弹层无标题栏、无关闭 ×。
  * 小程序 `sheets.tsx:784`：`<Sheet open={props.open} title={Strings.approvalTitle} onClose={props.onClose}>` —— 标题进入 Sheet 头栏，正文从「理由」开始。
* **差异**：标题层级/位置与关闭键存在与否不同。
* **建议**：去掉 `title`、`hideHeader`，正文第一行放 `approvalTitle`（titleMedium），与安卓一致。
* **风险/不确定**：关闭键移除后仅靠遮罩关闭，需确认可接受（同 D-04）。

### D-17 审批按钮间距与命令块（P2）

* **证据**
  * 安卓 `Sheets.kt:578-598`：`Row(horizontalArrangement = Arrangement.spacedBy(8.dp))`，Button/OutlinedButton 各 `weight(1f)`；命令用 `MonospaceBlock`（`Cards.kt:353-366`，`horizontalScroll` 不换行）。
  * 小程序 `sheets.module.scss:407-411` `.buttonRow { gap: 10px }`；`394-405` `.monoBlock { white-space: pre-wrap; word-break: break-all }`。
* **差异**：按钮间距 8dp↔10px；长命令行两端换行策略不同（安卓横向滚动，小程序强制换行）。
* **建议**：gap 改 8px；命令块若要贴近安卓可 `white-space: pre; overflow-x: auto`（小程序可用 `scroll-view scroll-x`）。
* **风险/不确定**：小程序 Text 横向滚动需要外包 `ScrollView scrollX`，纯 CSS 的 `overflow-x` 在部分端不生效。

### D-18 提问选项控件与推荐标签（P2）

* **证据**
  * 安卓 `Sheets.kt:674-703`：`ListItem(leadingContent = { if (item.multiSelect == true) Checkbox(checked = picked, onCheckedChange = null) else RadioButton(selected = picked, onClick = null) }, headlineContent = { Row(...) { Text(display.label); if (display.recommended) Text(Strings.questionRecommended, labelSmall) } }, supportingContent = option.description...)`。
  * 小程序 `sheets.tsx:912-933`：leading 是自绘 `Icon name={multi ? (picked ? 'square-check' : 'square') : picked ? 'circle-dot' : 'circle'}`；推荐标签 `930` 放在整行**最右**（`optionTag`），且没有 supporting/headline 的层级区分。
* **差异**：安卓是真实 M3 Checkbox/RadioButton 且推荐标签紧跟选项文字；小程序用 Lucide 图标表示选中，推荐标签被推到行尾。
* **建议**：推荐标签移到 `optionLabel` 同一行紧跟其后；选中控件在视觉上更接近系统勾选（可用带边框的方块/圆圈 + 选中填充），目标对齐 `Sheets.kt:695-702`。
* **风险/不确定**：无。

### D-19 提问自定义输入框（P2）

* **证据**
  * 安卓 `Sheets.kt:705-718`：`OutlinedTextField(value = draft.custom, ..., label = { Text(if (item.options.isNullOrEmpty()) Strings.questionCustomPlaceholder else Strings.answerCustom) }, enabled = !busy, maxLines = 4)` —— 浮动 label 常驻。
  * 小程序 `sheets.tsx:935-942`：`<Textarea className={styles.input} value={draft.custom} placeholder={...} maxlength={-1} .../>` —— 只有 placeholder，输入后消失；`sheets.module.scss:521-531` `min-height: 40px` 无 maxLines 上限。
* **差异**：标签常驻 vs 消失；高度上限不同（安卓最多 4 行）。
* **建议**：加一个字段标题（label）置于 Textarea 上方，并把最大高度限制到约 4 行。
* **风险/不确定**：无。

### D-20 提问底部主按钮的禁用态（P2）

* **证据**
  * 安卓 `Sheets.kt:772-775`：`Button(onClick = { advance(flow.continueFlow()) }, enabled = !busy && draft.answered) { ... }` —— 未作答时是真正的 disabled（M3 置灰）。
  * 小程序 `sheets.tsx:972-977`：`className={canContinue ? styles.primaryButton : styles.neutralButton}` + 点击里 `if (!busy && canContinue) advance(...)` —— 未作答时只是换成具备完整边框/文字的 `neutralButton`（`sheets.module.scss:433-441`），视觉上仍像可点。
* **差异**：禁用态的可感知程度不同。
* **建议**：给 `neutralButton`（或新增 `disabledButton`）整体降透明度并去掉主色/边框强调。
* **风险/不确定**：无。

### D-21 计划评审（P2，与 D-02 同源）

* **证据**
  * 安卓 `Sheets.kt:794-839`：header `Text(questionPlanHeader)` 固定，正文 `Column(weight(1f).verticalScroll)` 内 `MarkdownText(review.plan)`，底部 `Column(padding(16.dp), spacedBy(8.dp))` 固定：`OutlinedTextField(notes, label = questionPlanFeedbackPlaceholder, maxLines = 4)` + `Row(spacedBy(8.dp)) { TextButton(讨论) ; OutlinedButton(拒绝, weight1) ; Button(批准, weight1) }`。
  * 小程序 `sheets.tsx:822-843`：`<Sheet open title={Strings.questionPlanHeader} ...>` 内全部内容进同一个 ScrollView：`planBody` + `Textarea` + `buttonRow`。
* **差异**：与 D-02 相同（底部按钮随正文滚动）；另外输入框形态（label vs placeholder）与安卓 OutlinedTextField 不同。
* **建议**：同 D-02 用固定 footer 插槽；输入框按 D-19 加 label。
* **风险/不确定**：计划正文可能很长，固定 footer 后正文滚动区会变矮，需评估。

### D-22 文件预览的复制入口（P2）

* **证据**
  * 安卓 `Sheets.kt:898` 把 `text` 作为 `copyText` 传给 `CardDetailDialog`，`Cards.kt:129-135` `actions = { if (copyText != null) IconButton(...) { Icon(ContentCopy, Strings.copy) } }` —— 复制是顶栏右上图标按钮（即使 text 为空也存在）。
  * 小程序 `sheets.tsx:715-720`：`{text.length === 0 ? null : (<View className={styles.fileCopyRow} onClick={copyContent}><Icon name='copy' .../><Text>{Strings.copyAction}</Text></View>)}` —— 复制是正文顶部一行「图标 + 复制」文字，且**只在已有正文时出现**。
* **差异**：位置（顶栏 vs 正文行）、是否带文字、空正文时是否可复制。
* **建议**：随 D-01 改为全屏壳后把复制放回顶栏（`NavIconButton name='copy'`），并允许空正文时也显示。
* **风险/不确定**：无。

### D-23 文件预览续页方式与「加载更多」按钮（P2）

* **证据**
  * 安卓 `Sheets.kt:930-936`：`// 底部哨兵：滚到这里就取下一页。 !eof -> LaunchedEffect(nextOffset) { loadNextPage() }`，没有「加载更多」按钮。
  * 小程序 `sheets.tsx:698-701`（`autoLoad` 由 `Sheet` 的 `onScrollToLower` 触发）+ `745-750` 额外渲染 `<View className={styles.fileMore}><Text>{Strings.loadMore}</Text></View>`。
* **差异**：安卓是哨兵自动取下一页；小程序是触底自动取 + 显式按钮兜底。
* **建议**：保留触底自动取；「加载更多」按钮是安卓没有的元素，若要严格对齐可去掉（注意内容不足一屏时哨兵不会触发的问题），或明确登记为增强。
* **风险/不确定**：安卓的 `LaunchedEffect(nextOffset)` 在 `verticalScroll` 中一经组合即执行，实际可能连续取页；小程序是懒取。行为节奏不同，需真机对比确认期望。

### D-24 文件预览正文换行策略（P2）

* **证据**
  * 安卓 `Cards.kt:353-366` `MonospaceBlock`：`Text(..., Modifier.fillMaxWidth().horizontalScroll(scroll), fontFamily = FontFamily.Monospace)` —— 不换行、可横向滚。
  * 小程序 `sheets.module.scss:350-358` `.fileText { white-space: pre-wrap; word-break: break-all; }` —— 强制换行。
* **差异**：长行阅读方式不同。
* **建议**：若要与安卓一致，用 `ScrollView scrollX` 包裹等宽文本；否则登记为差异。
* **风险/不确定**：无。

### D-25 CardDetailDialog 外壳（P2）

* **证据**
  * 安卓 `Cards.kt:115-149`：全屏 `Dialog` + `Scaffold(TopAppBar(图标 18dp + 标题, 左关闭, 右复制))` + 正文 `padding(Dimens.columnInset)` 可滚；section 卡身 `Cards.kt:478-483` 用 `surfaceVariant + RoundedCornerShape(Dimens.cardRadius) + padding(10.dp)`。
  * 小程序 `cardDetail.tsx:36-69`：fixed 全屏 `overlay` + `NavBar mode='flow'`（左 ×、标题图标+文字、右复制）+ `ScrollView padding 16`。结构基本对齐。差异在 `cards.module.scss:113-117` `.sectionBody { background: var(--dsh-color-bg) }`（页面底色）而安卓用 `surfaceVariant`（卡片/次级底色）。
* **差异**：section 容器底色不同；其余基本一致。
* **建议**：`sectionBody` 改用次级底色 token（如新增 `--dsh-color-surface-variant`），与安卓 `surfaceVariant` 对应。
* **风险/不确定**：小程序主题变量集是否有对应 token 需确认（当前只有 `--dsh-color-bg/card/border`）。

### D-26 目标菜单（P2）

* **证据**
  * 安卓 `ComposerBar.kt:736-762`：`Box { IconButton(MoreHoriz) ; DropdownMenu(menu) { ...goalEdit...; DropdownMenuItem(text = { Text(Strings.goalClear, color = MaterialTheme.colorScheme.error) }) } }` —— 锚定在目标条按钮旁的弹出菜单，清空项红色。
  * 小程序 `composerBar.tsx:354-376`：`wx.showActionSheet({ itemList: items, success: res => {...} })` —— 系统底部动作面板；没有任何 `itemColor`，清空项无红色。
* **差异**：弹出位置/形态（锚定 menu vs 底部 ActionSheet）与危险项配色。
* **建议**：小程序无法用 showActionSheet 单独染红一项（`itemColor` 对所有项生效），若要严格对齐需自绘锚定菜单；否则在注释登记该平台限制。
* **风险/不确定**：wx.showActionSheet 的 `itemColor` 是否能按项设置——不能，属平台限制，不是「做不到」而是「需自绘」。

### D-27 目标/队列编辑对话框（P2）

* **证据**
  * 安卓 `ComposerBar.kt:766-780`（目标）：`AlertDialog(title = goalEdit, text = OutlinedTextField(objectiveDraft, label = goalObjective), confirmButton = TextButton(提交), dismissButton = TextButton(取消))`；`860-872`（队列）：`AlertDialog(text = OutlinedTextField(editDraft, ...), confirm 提交, dismiss 取消)`。
  * 小程序 `composerBar.tsx:359-369`（目标）：`wx.showModal({ title: goalEdit, content: goal.objective, editable: true, placeholderText: goalObjective, confirmText: submit, cancelText: cancel, success: modal => ... })`；`410-419`（队列）：`wx.showModal({ title: queueEdit, content: queuedItemText(item), editable: true, confirmText, cancelText })`。
* **差异**：安卓是可多行、有浮动 label 的 `OutlinedTextField`；`wx.showModal` 的 editable 是系统单行输入框，长文本无法多行编辑。结构/按钮语义基本等价。
* **建议**：接受为平台等价；但若目标/队列文本可能较长，建议自绘一个带 `Textarea` 的弹层，与安卓的 `OutlinedTextField` 对齐。
* **风险/不确定**：`wx.showModal` editable 在部分基础库的行数与字符上限不同，需真机验证。

### D-28 队列条行高与图标（P2）

* **证据**
  * 安卓 `ComposerBar.kt:811-856`：每行 `Row(Modifier.fillMaxWidth().height(Dimens.stripRowHeight /*=44.dp，Theme.kt:29*/), horizontalArrangement = spacedBy(Dimens.stripSpacing /*8.dp*/))`；`Icon(Icons.Default.Schedule, size 16.dp)`；编辑/插队/撤回都是 `IconButton(Modifier.size(32.dp))` + 16dp 图标。
  * 小程序 `composerBar.tsx:422-443` + `composerBar.module.scss:171-206`：`.queueRow { padding: 5px 0; gap: 8px }`（无固定行高）；`.queueGlyph { font-size: 13px }` 且 `427` 用的是 Lucide `history`（安卓是 `Schedule` 时钟）；`.queueAction { font-size: 14px }`（点击热区只有 padding 0 6px）。
* **差异**：行高缺失、图标语义/尺寸不同、点击热区小于安卓 32dp。
* **建议**：`.queueRow { min-height: 44px }`，图标 16px 并改用与安卓同义的时钟图标，操作按钮给足 32px 热区。
* **风险/不确定**：无。

### D-29 行长按菜单与「更多」菜单（P2）

* **证据**
  * 安卓 `ChatScreen.kt:459-503`：行 `combinedClickable(onLongClick = { rowMenu = true })` + `DropdownMenu` 两项「复制（带 ContentCopy 图标）/ 在此分叉（带 CallSplit 图标）」；`377-394`「更多」`DropdownMenu` 两项带 `Search / Info` leadingIcon。
  * 小程序 `pages/chat/index.tsx:312-329`：`onLongPress` → `wx.showActionSheet({ itemList: copyable ? [copy, forkHere] : [forkHere] })`；`331-351`「更多」→ `wx.showActionSheet({ itemList: [findInChat, panel] })` —— 无 leading 图标。
* **差异**：菜单形态（锚定下拉 vs 底部面板）与图标缺失。
* **建议**：平台限制（小程序无原生锚定菜单、showActionSheet 无图标）；如产品重视，可用页面内绝对定位自绘 popover。
* **风险/不确定**：另有触觉差异：安卓复制成功给 `HapticFeedbackType.LongPress`（ChatScreen.kt:489），小程序在长按时给 `vibrateShort({type:'light'})`（index.tsx:373）、复制本身无反馈——可在复制成功回调补一次轻震。

### D-30 轮次菜单 vs 右侧内联轨道栏（P1，跨区）

* **证据**
  * 安卓 `ChatScreen.kt:324-374`：顶栏 `IconButton(FormatListNumbered)` + `DropdownMenu(turnMenu)`，每项 leading 为 `Schedule / Check / RadioButtonUnchecked`、文案 `"turn · preview"`、`enabled = railBusyTurn == null`；点击后滚动并置 `railActiveTurn`。
  * 小程序 `pages/chat/index.tsx:561-582`：常驻 `<ScrollView scrollY className={styles.rail} id='chat-rail'>`，`index.module.scss:141-150` `.rail { width: 132px; height: 100%; border-left: 1px solid ... }`，`152-186` 行为 `turn · preview`、`railRowBusy { opacity: .5; pointer-events: none }`；「回到底部」按钮 `index.tsx:588` 还会因 rail 展开把 right 从 12px 挪到 144px。
* **差异**：安卓是点开即走的浮层菜单（不占布局）；小程序是一个常驻 132px 的右侧栏，开启后会压缩转写区宽度、并把回底按钮左移。
* **建议**：与安卓口径一致改为弹出式菜单（顶栏按钮 + 自绘 popover），或在产品上明确接受侧栏形态；因为会改变主内容宽度，建议优先收敛，并注意 `.rail` 与底部弹层的 z-index/遮挡关系。
* **风险/不确定**：该行为横跨顶栏（可能属 B/C 区），若 B/C 已单独审计，此条可作为交叉引用而非重复修复。

---

## 平台能力说明（针对「做不到」的核实）

* **底部弹层**：小程序没有 Android `ModalBottomSheet`（系统遮罩 + 拖拽 + 惯性关闭）。当前 `Sheet` 用 fixed 遮罩 + 72px 位移阈值自绘（`sheets.tsx:97-113`，常量名 `SWIPE_CLOSE_DP` 但实际与 `clientY` 像素直接比较）。可用 API：`movable-view`/`movable-area`、或 `catchtouchmove` + 手势计算；也可以引入 NutUI 的 `Popup`（项目已依赖 NutUI）获得动画与遮罩行为。并非做不到。
* **全屏对话框**：小程序已有 `cardDetail.tsx` 的全屏 fixed 覆盖实现，文件预览改全屏无平台障碍。
* **锚定下拉菜单**：小程序无原生 anchored popover；可自绘绝对定位面板（`position: absolute` + 点击遮罩关闭）。wx.showActionSheet 是系统底部面板，二者形态不同。
* **危险项红色**：`wx.showActionSheet` 的 `itemColor` 对整列生效，无法只染「清除」一项；需自绘。
* **多行编辑弹窗**：`wx.showModal editable` 为单行输入，安卓 `OutlinedTextField` 可多行；需自绘 Textarea 弹层。

## 不确定项（需真机 / 开发者工具验证）

1. `Sheet` 的下拉关闭阈值按 `clientY` 像素比较 72（注释写 DP），在 2x/3x 屏上实际触发距离与安卓不一致；且 `onTouchStart/onTouchEnd` 挂在整块面板上，正文滚动到顶部再下拉时是否会被误判为关闭——需真机手势验证。
2. 固定 footer 后，弹层内 `Textarea` 唤起键盘时是否被遮挡（D-02/D-21）。
3. `wx.showModal editable` 的行数/长度上限与 `content` 作为初始值的实际行为（D-27）。
4. 安卓文件预览哨兵 `LaunchedEffect(nextOffset)` 在 `verticalScroll` 下可能连续自动取页（组合即执行），与小程序「触底才取」的节奏差异需真机对照（D-23）。
5. D-30 的轮次轨道栏归属区域（B/C/D）需与其它审计口对齐后再决定归属，此报告仅记录差异事实。

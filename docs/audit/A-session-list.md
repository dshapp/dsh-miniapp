# A 区差异审计报告：会话列表页与归档页

- 审计对象：小程序端 /Users/user/dshapp/dsh-miniapp
- 参考实现：安卓端 /Users/user/dshapp/dsh-androidapp
- 审计范围：会话列表页、归档页及其支撑的 state/model 文件（见文末“扫描清单”）
- 审计方式：只读源码逐行对照（未修改任何源码）
- 快照时间：2026-09-21 00:39 CST

> 重要说明（快照漂移）：审计过程中工作区内有**并发修改**在进行（例如 src/pages/index/index.tsx、src/pages/archived/、src/model/archivedSessions.ts、src/model/format.ts、src/ui/onboarding.tsx 等都发生过变化，mtime 在 23:39–00:35 之间）。本报告以我最后读取到的版本为准，列出的是**当前仍存在的差异**；同时附上“已对齐项”清单，避免重复返工。若后续文件继续变动，请以行号附近的代码语义为准。
>
> 快照摘要（sha256 前 12 位）：
> index.tsx b3c76d3d264e / index.module.scss 23630316416c / archived/index.tsx d0fb3667b838 /
> state/stores.ts e516878c0ab8 / state/store.ts 71105eec5bc1 / state/cache.ts eb7f4dffad95 /
> state/search.ts 5a0cfdf9d33d / ui/emptyState.tsx aec9def8a1dd / ui/onboarding.tsx 9e1e761028b7 /
> route.ts 578ba4919427 / model/archivedSessions.ts 62bf56fd68e7 / model/format.ts 3b90cd9bab9a /
> i18n/strings.ts 2deb7a3a2f44

---

## 一、差异总览

| 编号 | 差异标题 | 类型 | 影响 |
| --- | --- | --- | --- |
| A-01 | 分组换位：长按拖拽 vs 长按弹窗选落点 | 交互手势不同 | 中 |
| A-02 | 视图选项菜单：DropdownMenu（分区+勾选/图标） vs ActionSheet（✓ 文本） | 视觉/交互不同 | 中 |
| A-03 | 分组拖拽的无障碍提示 reorderGroups 未使用 | 无障碍缺失 | 小 |
| A-04 | 状态排序把“待审批/待回答”挤进同一档 | 行为不同 | 大 |
| A-05 | 运行中的子智能体未计入父会话的“运行中”档 | 行为不同 | 中 |
| A-06 | statusOrder 错误档位未与“未读完成”口径对齐 | 行为不同 | 小 |
| A-07 | 空态判定用原始名册长度，而非过滤后的可见口径 | 行为不同/边界 | 大 |
| A-08 | 连接提示条：已连接时仍常驻、不可滑消、非全局、展示 detail | 视觉/交互不同 | 中 |
| A-09 | 连接中空态：居中转圈 vs 底部文字 | 视觉不同 | 小 |
| A-10 | 刷新态额外显示“连接中…”页脚 | 行为/文案不同 | 小 |
| A-11 | 触底自动翻页（安卓只有按钮） | 行为不同 | 小 |
| A-12 | 行标题不取实时标题（安卓优先 live title） | 行为不同 | 中 |
| A-13 | 未读错误图标的显示条件多了一个 completed 抑制 | 行为不同 | 小 |
| A-14 | 行尾等待徽标缺少 APPROVAL 兜底 | 行为不同/边界 | 小 |
| A-15 | 长按行菜单：DropdownMenu vs ActionSheet；无触觉反馈 | 交互不同 | 小 |
| A-16 | 重命名弹层：AlertDialog 预填实时标题 vs wx.showModal | 交互/行为不同 | 中 |
| A-17 | 搜索清除按钮始终显示、清除后不回到输入框 | 行为不同 | 小 |
| A-18 | 搜索态系统返回键不退出搜索 | 交互手势不同 | 小 |
| A-19 | 底部归档入口用 fixed 定位，可能遮挡末行 | 视觉/边界 | 小 |
| A-20 | 连接状态点缺无障碍标签 | 无障碍缺失 | 小 |
| A-21 | 归档页取消归档失败无任何用户提示 | 缺失/错误态 | 大 |
| A-22 | unavailableArchivedSessions 中英文案不一致 | 文案不同 | 小 |
| A-23 | 归档页没有全局连接提示条 | 缺失 | 中 |
| A-24 | 归档行取消归档的 aria-label 在 Taro Text 上是否生效不确定 | 无障碍/不确定 | 小 |
| A-25 | 顶部栏整体随页面滚动（安卓顶栏固定） | 视觉/交互不同 | 中 |
| A-26 | 归档页搜索无结果图标/空态结构差异 | 视觉不同 | 小 |
| A-27 | 未配对引导页结构差异（无顶部 AppBar、图标/按钮样式） | 视觉不同 | 小 |
| A-28 | 深链配对 / 通知点击打开会话缺失 | 缺失 | 中 |
| A-29 | 配对页承载方式：全局覆盖层 vs 独立页 | 结构不同 | 小 |
| A-30 | 空白会话复用未校验 Agent 预设有效性 | 缺失 | 中 |
| A-31 | 列表搜索无结果态与“没有会话”态的判定口径 | 视觉/行为 | 小 |
| A-32 | 归档页用 ScrollView + 手写行，安卓用 LazyColumn/ListItem | 结构/性能 | 小 |

**统计：共 32 条。**

- 影响大：3 条（A-04、A-07、A-21）
- 影响中：10 条（A-01、A-02、A-05、A-08、A-12、A-16、A-23、A-25、A-28、A-30）
- 影响小：19 条（A-03、A-06、A-09、A-10、A-11、A-13、A-14、A-15、A-17、A-18、A-19、A-20、A-22、A-24、A-26、A-27、A-29、A-31、A-32）

---

## 二、逐条差异

### A-01 分组换位：长按拖拽 vs 长按弹窗选落点

- **安卓端依据**：SessionListScreen.kt:663-705（GroupHeader，detectDragGesturesAfterLongPress）、531-657（GroupDragState：拖动预览、贴边自动滚动、震动）、246-260（自动滚动循环）。长按表头立即进入拖拽，边拖边预览新顺序，松手 moveWorkspace(workspaceId, before)。
- **小程序端现状**：index.tsx:241-255 showGroupMenu，长按表头弹出 wx.showActionSheet，itemList = [Strings.moveWorkspaceBefore + Strings.listEnd, ...其他工作区标题]；index.tsx:322-332 表头绑定 onLongPress={() => showGroupMenu(group)}。语义仍是“挪到某工作区之前/末尾”，与主机 workspace/insertBefore 一致。
- **差异类型**：交互手势不同（小程序注释已声明为刻意替换：原生拖拽体验差）。
- **影响与建议**：中。安卓可在一次拖拽中连续换位并实时预览；小程序需两次操作（长按→选目标），且没有可视插入落点反馈。建议：保留弹窗方案但增加“移动中/成功后”的轻提示，并在弹层首行明确“移到末尾”的语义（当前中文拼接为“把这个工作区移到末尾”，英文为“Move this workspace to the end”，可读但略生硬）。

### A-02 视图选项菜单：DropdownMenu vs ActionSheet

- **安卓端依据**：SessionListScreen.kt:332-356，DropdownMenu + MenuSectionLabel(Strings.groupBy) / MenuSectionLabel(Strings.orderBy)，每个 ChoiceItem 用图标、选中项以 Icons.Default.Check 替代图标。
- **小程序端现状**：index.tsx:257-277 showViewMenu，wx.showActionSheet 单列表，仅用 '✓ ' 文本前缀表示选中，无分区标题、无图标。
- **差异类型**：视觉/交互不同。
- **影响与建议**：中。信息层级丢失（“分组”和“排序”混在一起）。建议：ActionSheet 无法分组时，可在文案里加前缀（如“分组：按工作区”）以补回层级；或改用自定义 Popup。

### A-03 reorderGroups 无障碍提示未使用

- **安卓端依据**：SessionListScreen.kt:731-735，拖动中的抓手 Icon(Icons.Default.DragIndicator, Strings.reorderGroups, ...)。
- **小程序端现状**：i18n/strings.ts:227 定义了 reorderGroups，但全仓 grep -rn reorderGroups src/ 仅命中定义处，未被任何 UI 引用。
- **差异类型**：无障碍缺失 / 死文案。
- **影响与建议**：小。建议：在分组长按弹层标题或首行加入该提示，或删除未用文案。

### A-04 状态排序把“待审批/待回答”挤进同一档

- **安卓端依据**：state/SessionStatusRank.kt:12-39，档位 RUNNING(0) / FAILED_UNREAD(1) / DONE_UNREAD(2) / **APPROVAL(3) / QUESTION(4)** / DRAFT(5) / IDLE(6)；state/Stores.kt:335-341 注释明确说“把‘等我批准’和‘等我回答’挤进同一档”是旧实现的缺陷。
- **小程序端现状**：state/stores.ts:334-350 statusOrder，rank 只有 0..5：running→0 / errored→1 / completed→2 / awaiting→3（审批、提问、计划评审全部同档）/ drafts→4 / else→5。
- **差异类型**：行为不同。
- **影响与建议**：大。当一条会话待审批、另一条待回答时，小程序只能按 updatedAt 决定先后，用户无法判断先处理哪个；安卓保证“待审批”整体排在“待回答”之前。建议：把 rank 拆成与 SessionStatusRank 对齐的 7 档（awaitingKinds 已带 approval/planReview/question，可直接取 kind；planReview 与 question 同档）。

### A-05 运行中的子智能体未计入父会话的“运行中”档

- **安卓端依据**：state/Stores.kt:76-95（runningSubagentRoots：把在跑子智能体的祖先链都标成运行中）、342-360（isRunning = summary.running || runningSubagentRoots.contains(sessionId)）。
- **小程序端现状**：state/stores.ts:340 只有 if (summary.running) return 0;；全仓 grep -rn runningSubagent src/ 无任何结果。
- **差异类型**：行为不同（缺失）。
- **影响与建议**：中。父会话自身已停、子智能体还在跑时，安卓把它排到“运行中”最上面，小程序会沉到下面。建议：在 statusOrder 前从名册计算在跑 subagent 的祖先链（与安卓同口径，沿 origin=="subagent" 向上）。

### A-06 statusOrder 错误档位未与“未读完成”口径对齐

- **安卓端依据**：state/SessionStatusRank.kt:50-67，FAILED_UNREAD 需要 isUnread && didFail，DONE_UNREAD 需要 isUnread；isUnread = completedSessionIds.contains。
- **小程序端现状**：state/stores.ts:341-342，erroredIds.has(id)→1、completed.has(id)→2，错误档不要求“未读完成”。
- **差异类型**：行为不同。
- **影响与建议**：小。对“已读但失败”的会话，安卓会按后续档位排，小程序仍钉在第 1 档。建议：把错误档条件改为 completed.has(id) && erroredIds.has(id)。

### A-07 空态判定用原始名册长度，而非过滤后的可见口径

- **安卓端依据**：SessionListScreen.kt:429 listEmpty = listed.isEmpty()（listed 已在 128-137 行按“非空白 / 非 subagent / 非归档”过滤）；StatusOverlay 896-920 用它决定离线态、连接中态、无会话态。
- **小程序端现状**：index.tsx:354 const isEmpty = listState.length === 0;——listState 是**未过滤**的原始名册（含空白、subagent、已归档）；404-413 的空态都基于这个 isEmpty。而可见名册是 listed（128-131 行已过滤）。
- **差异类型**：行为不同 / 边界情况。
- **影响与建议**：大。典型场景：账号里所有会话都已归档（或只剩空白/subagent 行）时，小程序列表一片空白且**不给任何空态说明**，安卓会显示“还没有会话”/离线态。建议：改用 listed.length === 0。

### A-08 连接提示条：已连接时仍常驻、不可滑消、非全局、展示 detail

- **安卓端依据**：ui/component/ConnectionBanner.kt:118-131，bannerInfo 对 Connection.Connected/Idle 返回 null（已连接**不显示**）；67-98 挂在 App.kt:136-139 的 NavHost 之上，**全局覆盖任何页面**；156-221 支持**上滑关闭**、失败时整条可点重试、只放一句结论不放 detail。
- **小程序端现状**：ui/connectionBanner.tsx:41-58 是一条**常驻通栏**（toneLabel('connected') → Strings.statusConnected），index.tsx:396-400 无条件渲染；无滑动关闭；只挂在 index 与 chat 两页；connectionSummary（state/connection.ts:37-41）会把 connection.message 作为 detail 展示。
- **差异类型**：视觉/交互不同（且已连接时多出一条绿色条）。
- **影响与建议**：中。建议：connected 时不渲染；失败/重连时再显示；补上滑关闭手势；或至少把 detail 收敛为 offlineBannerTitle/Body 这类用户可读文案。

### A-09 连接中空态：居中转圈 vs 底部文字

- **安卓端依据**：SessionListScreen.kt:910-911 connection is Connection.Connecting && listEmpty → CircularProgressIndicator(Modifier.align(Alignment.Center))。
- **小程序端现状**：index.tsx:407 {isEmpty && connectionIsPending ? <View className={styles.footer}>{Strings.statusConnecting}</View> : null}（底部一行文字）。
- **差异类型**：视觉不同。
- **影响与建议**：小。建议改为居中 loading 态，和安卓一致。

### A-10 刷新态额外显示“连接中…”页脚

- **安卓端依据**：SessionListScreen.kt:368-372 只用 PullToRefreshBox(isRefreshing = model.refreshing) 的原生下拉指示器，不额外加文案。
- **小程序端现状**：index.tsx:414 {refreshing ? <View className={styles.footer}>{Strings.statusConnecting}</View> : null}——刷新（非连接）时显示“连接中…”，语义错误。
- **差异类型**：行为/文案不同。
- **影响与建议**：小。建议删掉，或用“正在刷新…”之类的准确文案。

### A-11 触底自动翻页（安卓只有按钮）

- **安卓端依据**：SessionListScreen.kt:403-420，只在还有更多时渲染 TextButton(Strings.showMore)，没有触底自动加载。
- **小程序端现状**：index.tsx:283-293 useReachBottom 会自动把所有分组的页码 +1；同时 338-348 仍保留“再显示 N 个”按钮。
- **差异类型**：行为不同（小程序多出自动加载）。
- **影响与建议**：小。属体验增强，建议保留，但在报告中标为“与安卓不一致”，避免验收时误判。

### A-12 行标题不取实时标题

- **安卓端依据**：SessionListScreen.kt:460-461 titleOf(model, summary) = sessionDisplayTitle(summary, model.sessions[summary.sessionId]?.title)——优先用会话详情 store 的实时标题。
- **小程序端现状**：index.tsx:449 {sessionDisplayTitle(summary, undefined)}——只读 summary.projections['title'] / cwd / sessionId，不读 model.store(id)?.title（该能力存在，chat 页在用）。
- **差异类型**：行为不同。
- **影响与建议**：中。会话被重命名但投影未及时到达时，安卓列表立刻显示新名，小程序仍显示旧名/目录名。建议：renderRow 传入 model.store(summary.sessionId)?.title。

### A-13 未读错误图标的显示条件多了一个 completed 抑制

- **安卓端依据**：SessionListScreen.kt:829-830 store?.unreadError == true → Icon(Icons.Default.Error, ...)，无 completed 判断。
- **小程序端现状**：index.tsx:430 erroredIds.has(...) && !completedIds.has(...)。
- **差异类型**：行为不同。
- **影响与建议**：小。建议与安卓统一（去掉 !completedIds），或明确这是产品意图并写注释。

### A-14 行尾等待徽标缺少 APPROVAL 兜底

- **安卓端依据**：SessionListScreen.kt:841-843 if (awaitingUserSessionIds.contains(id)) awaitingUserKinds[id] ?: SessionAwaitingKind.APPROVAL else null。
- **小程序端现状**：index.tsx:426 const awaiting = awaitingKinds.get(summary.sessionId);，然后 433-440 交给 resolveSessionRowTrailing(awaiting, ...)；若 id 在 awaitingUserSessionIds 但 kinds 表缺条目，则不显示徽标。
- **差异类型**：行为不同（边界）。
- **影响与建议**：小。建议补 awaitingKinds.get(id) ?? (awaitingUserSessionIds.has(id) ? 'approval' : undefined)。

### A-15 长按行菜单：DropdownMenu vs ActionSheet；无触觉反馈

- **安卓端依据**：SessionListScreen.kt:779-819，combinedClickable(onLongClick = { 触觉反馈; menu = true }) + DropdownMenu（Fork / Pin-Unpin / Rename / Archive，均带 leading icon）。
- **小程序端现状**：index.tsx:207-239 wx.showActionSheet，四项同序同文案但无图标；onLongPress（444-446）无触觉反馈（未调用 wx.vibrateShort）。
- **差异类型**：交互/视觉不同。
- **影响与建议**：小。建议长按时加轻震（wx.vibrateShort({ type: 'light' })），补齐触觉反馈。

### A-16 重命名弹层：AlertDialog 预填实时标题 vs wx.showModal

- **安卓端依据**：SessionListScreen.kt:444-457，AlertDialog + OutlinedTextField(renameText, ...)，renameText = titleOf(model, summary)（实时标题优先），Submit/Cancel 双按钮。
- **小程序端现状**：index.tsx:223-231，wx.showModal({ title: Strings.rename, content: sessionDisplayTitle(summary, undefined), editable: true })，只有系统“确定/取消”。
- **差异类型**：交互/行为不同。
- **影响与建议**：中。内容非实时标题（与 A-12 同源）；另外 content 在部分基础库版本里是“提示正文”而非输入框初值，可能导致用户看到标题但输入框是空的。建议：传入 placeholderText/确认 content 与 editable 的实际表现，并优先用实时标题。

### A-17 搜索清除按钮始终显示、清除后不回到输入框

- **安卓端依据**：SessionListScreen.kt:320-327，仅 query.isNotEmpty() 时显示 Close；清除时 findFocus.requestFocus() 保持焦点。
- **小程序端现状**：index.tsx:380 无条件渲染 x；点击仅 setQuery('')（未重新聚焦，虽然 Input 带 focus 属性，但清空后光标行为依赖基础库）。
- **差异类型**：行为不同。
- **影响与建议**：小。建议空查询时不渲染 x，清除后显式聚焦。

### A-18 搜索态系统返回键不退出搜索

- **安卓端依据**：SessionListScreen.kt:112-113 BackHandler(enabled = finding) { exitFind() }——返回键先退出搜索而不是退出列表页。
- **小程序端现状**：index.tsx 无对应返回拦截（仅有 371 行的 chevron-left 手动退出）；微信导航栏返回会直接离开当前页。
- **差异类型**：交互手势不同。
- **影响与建议**：小。小程序无法拦截系统返回，属平台限制；建议靠 chevron-left 的显著样式弥补。

### A-19 底部归档入口用 fixed 定位，可能遮挡末行

- **安卓端依据**：SessionListScreen.kt:365-441，列表区 PullToRefreshBox(Modifier.weight(1f)) + 底部 ListItem 处在同一 Column 布局中，**不重叠**。
- **小程序端现状**：index.tsx:416-421 底部 archiveEntry；index.module.scss:166-178 使用 position: fixed; bottom: 0，而 .page 只有 padding-bottom: 24px（scss:8）。条目高约 48px + safe-area，末行可能被压住。
- **差异类型**：视觉/边界。
- **影响与建议**：小。建议给页面底部留出与条目等高的 padding（含 env(safe-area-inset-bottom)）。

### A-20 连接状态点缺无障碍标签

- **安卓端依据**：SessionListScreen.kt:479-488，ConnectionDot 有 semantics { contentDescription = "状态: label" }。
- **小程序端现状**：index.tsx:384-387 statusDot 是无标签 View，只有颜色传达状态。
- **差异类型**：无障碍缺失。
- **影响与建议**：小。建议加 aria-label（Taro 对 View 的 aria 支持需实测）或文字化状态。

### A-21 归档页取消归档失败无任何用户提示

- **安卓端依据**：ArchivedSessionsScreen.kt:78-82，LaunchedEffect(model.lastErrorMessage) → snackbarHost.showSnackbar(message) 并清空；页面 148 行挂了 SnackbarHost。
- **小程序端现状**：pages/archived/index.tsx:70-72 restore 只 void model.unarchiveSession(sessionId)；整页没有消费 model.lastErrorStore（全仓 consumer 只有 pages/new/index.tsx:34）。旧主机（0.1.6 之前无 workspace/unarchiveSession）失败时表现为“点了没反应”。
- **差异类型**：缺失 / 错误态。
- **影响与建议**：大。建议归档页订阅 lastErrorStore，失败时 toast(...) 或页面内提示，并在成功后清空；行内“恢复中”反馈已由 unarchivingIdsStore 覆盖（见已对齐项）。

### A-22 unavailableArchivedSessions 中英文案不一致

- **安卓端依据**：i18n/Strings.kt:172-173 pick("No archived session here can be restored.", "这里没有可恢复的已归档会话。")。
- **小程序端现状**：i18n/strings.ts:191 unavailableArchivedSessions: ['Archived sessions are no longer available', '已归档的会话已不存在']。
- **差异类型**：文案不同。
- **影响与建议**：小。建议对齐安卓文案（中英都要改）。

### A-23 归档页没有全局连接提示条

- **安卓端依据**：App.kt:136-139 全局 ConnectionBanner 覆盖所有 NavHost 页面，归档页同样可见。
- **小程序端现状**：ConnectionBanner 只在 index.tsx:396 与 chat/index.tsx:438 出现；pages/archived/index.tsx 未引入。
- **差异类型**：缺失。
- **影响与建议**：中。建议抽成页面壳/公共布局，或至少在归档页补一条。

### A-24 归档行取消归档 aria-label 生效性不确定

- **安卓端依据**：ArchivedSessionsScreen.kt:209-216，TextButton 内 Modifier.semantics { contentDescription = fmt(Strings.unarchiveSessionNamed, title) }。
- **小程序端现状**：pages/archived/index.tsx:107-113，<Text aria-label={fmt(Strings.unarchiveSessionNamed, title)} ...>。
- **差异类型**：无障碍；**不确定**：Taro Text 对 aria-label 的编译/运行时支持未经实测，不能确认读屏会读到。
- **影响与建议**：小。建议在真机读屏验证后决定是否需要额外处理。

### A-25 顶部栏整体随页面滚动（安卓顶栏固定）

- **安卓端依据**：SessionListScreen.kt:266-363，标题栏在 Scaffold(topBar=...) 中固定；滚动只发生在 LazyColumn。
- **小程序端现状**：index.tsx:368-394 的 topBar 与 pages/archived/index.tsx:124-147 的 topBar 都是普通 View；index.module.scss:11-18 / archived/index.module.scss:9-16 均无 position: sticky/fixed。页面滚动时顶栏会滚走。
- **差异类型**：视觉/交互不同。
- **影响与建议**：中。建议给顶栏加 position: sticky; top: 0; z-index 或改用微信自定义导航栏。

### A-26 归档页搜索无结果图标/空态结构差异

- **安卓端依据**：ArchivedSessionsScreen.kt:159-160 EmptyStateColumn(Icons.Default.SearchOff, Strings.searchNoResults, query)。
- **小程序端现状**：pages/archived/index.tsx:87-89 EmptyState name='search-x' ...。
- **差异类型**：视觉不同（图标语义接近）。
- **影响与建议**：小。可接受，记录备查。

### A-27 未配对引导页结构差异

- **安卓端依据**：OnboardingScreen.kt:17-41，Scaffold + CenterAlignedTopAppBar(title = Strings.appName)，图标 56dp primary，Button(scanQR) + TextButton(pastePairing)。
- **小程序端现状**：ui/onboarding.tsx:18-31，无顶部 AppBar（依赖原生导航栏标题），qr-code 字形 + 标题 + 正文 + 主按钮(scanQR) + 次文字(pastePairing)；两者都跳 PAIRING 页（index.tsx:361）。
- **差异类型**：视觉不同。
- **影响与建议**：小。功能等价；如需像素级对齐，补一个页内标题区。

### A-28 深链配对 / 通知点击打开会话缺失

- **安卓端依据**：App.kt:37-47（LaunchRequest.deepLink → 新增配对并连接）、49-68（launch.openSessionId → 等连接落定后 navigate("chat/$sessionId")）。
- **小程序端现状**：src/app.ts 只有 useLaunch(() => getAppModel().connectCurrent())；全仓 grep -rn openSessionId|deepLink src/ 无结果。
- **差异类型**：缺失。
- **影响与建议**：中。小程序无系统通知，且扫码入口在应用内，深链能力受限；建议确认这是平台约束后，在文档中明确“不支持外部跳转唤起”，避免验收误判。

### A-29 配对页承载方式：全局覆盖层 vs 独立页

- **安卓端依据**：App.kt:125-134，scanning 状态把 PairingScreen 覆盖在任意页面之上。
- **小程序端现状**：route.ts:1-9 把 PAIRING 登记为独立页面，index.tsx:361 用 openPage(pageRoutes.PAIRING) 跳转。
- **差异类型**：结构不同。
- **影响与建议**：小。功能等价，返回栈语义不同（小程序会压栈）。

### A-30 空白会话复用未校验 Agent 预设有效性

- **安卓端依据**：model/BlankSessionReuse.kt:16-49，reusableBlankSession 需同时满足 canResumeBlankSession(summary, agentPresets)（预设已被删除/损坏时**不复用**，避免“打不开的死胡同”）、recordedAgentPreset 优先平铺字段再退回投影。
- **小程序端现状**：state/appModel.ts:918-945 createSession 的复用扫描只判断 blank && cwd === workspace.path && workspace.sessionIds.includes(...) && !archived.has(...)，**不检查** agentPreset / 预设目录有效性；全仓无 canResumeBlankSession / recordedAgentPreset / reusableBlankSession。
- **差异类型**：缺失。
- **影响与建议**：中。留在已删除/损坏预设下的空白会话会被复用，进入新建页后发消息会持续以 presets: preset "…" not found 失败。建议移植 canResumeBlankSession 逻辑（目录未回来时放行）。

### A-31 列表搜索空态与“没有会话”空态判定口径

- **安卓端依据**：SessionListScreen.kt:912-918，搜索空态用合并后的命中 searchEmpty，无会话态用 listEmpty。
- **小程序端现状**：index.tsx:408-409 searching && searchRows.sessions.length === 0；411-413 !searching && isEmpty && connected。搜索侧口径一致；无会话侧受 A-07 影响。
- **差异类型**：视觉/行为（由 A-07 派生）。
- **影响与建议**：小。随 A-07 一并修。

### A-32 归档页用 ScrollView + 手写行，安卓用 LazyColumn/ListItem

- **安卓端依据**：ArchivedSessionsScreen.kt:162-174 LazyColumn + items(visibleRows, key=...)，行是 ListItem。
- **小程序端现状**：pages/archived/index.tsx:148 <ScrollView scrollY>，行是手写 View（91-119）。列表很长时无虚拟化。
- **差异类型**：结构/性能。
- **影响与建议**：小。归档量通常不大，可接受；如量大建议改 FlatList/虚拟列表。

---

## 三、审计期间已对齐 / 无需修改的项（避免重复返工）

以下差异在我审计开始时存在，但在并发修改后已对齐安卓口径，**当前快照下不再是差异**：

1. **归档会话未从主列表过滤**：index.tsx:27 引入 listSessionsVisible，128-131 行用两个 store 的归档集合并集过滤 → 与 Android model/ArchivedSessions.kt:20-25 对齐。
2. **归档页曾是 preview 页的一种模式**：现已有独立 pages/archived/index.tsx 与 route.ts ARCHIVED 路由 → 与 Android App.kt:87-94 对齐。
3. **归档页缺搜索/三种空态/工作区名/恢复进度/取消归档文案**：pages/archived/index.tsx:52-120 已实现并按 archivedSessionRows 倒序（最近归档在前）、filterArchivedSessions 本地过滤、unarchivingIdsStore 进度、Strings.unarchiveSession 文案 → 与 ArchivedSessionsScreen.kt:86-88/151-176/180-219 对齐。
4. **列表底部缺归档常驻入口**：index.tsx:416-421 已加 fixed 底部入口（文案 Strings.archivedSessions）→ 与 Android SessionListScreen.kt:433-440 对齐（残留问题见 A-19）。
5. **行首缺置顶图钉**：index.tsx:57 已加 pinned 分支与 styles.glyphPinned → 与 Android SessionListScreen.kt:831-832 对齐。
6. **relativeTime 档位**：model/format.ts:453-467 已是 now/min/h/d/mo/y 六档 → 与 Android Format.kt:441-473 对齐。
7. **Agent 预设选择器开关**：appModel.ts:105 agentPresetPickerEnabledStore + rpcMethods.ts:522 解析 modeSelectionEnabled → 与 Android model/AgentPresetRoster.kt:15-21 对齐。
8. **statusOrder 中“运行中/错误/完成/待办/草稿/空闲”的相对次序**已大体存在（残留问题见 A-04/A-05/A-06）。

以下文件在当前快照下**未发现用户可感知差异**（或差异不落在本区域内）：

- src/state/store.ts：纯订阅基础设施，安卓对应 Compose 的 mutableStateOf，无 UI 语义可对照。
- src/state/cache.ts：会话窗口/名册本地缓存（stale-while-revalidate），与 Android state/SessionCache.kt 同职责；本区域页面不直接渲染其内容，未见用户可感知差异。**不确定**：未逐行比对淘汰策略/上限（MAX_CACHED_WINDOWS=24、MAX_CACHED_RECORDS=4000）是否与安卓一致。
- src/state/search.ts：SearchState 与安卓搜索状态同构；本区域内无差异。
- src/route.ts：仅路由登记，已含 ARCHIVED；与安卓导航目标一致。

---

## 四、不确定项（无法从源码确认）

1. **A-24**：Taro Text 的 aria-label 是否被微信小程序读屏识别，未做真机验证。
2. **A-16**：wx.showModal({ editable: true, content }) 在不同基础库版本中 content 究竟是输入框初值还是提示正文，会直接影响重命名体验。
3. **A-08 / A-21**：connection.message 与 lastErrorStore 的具体错误文本是否暴露内部异常，取决于上游 describe()（appModel.ts:70-74 会优先取 ApiException.detail）——安卓有 internal → operationFailed 的兜底，小程序我只是旁证，未展开上游全部错误路径。
4. **A-28**：小程序是否在 app.config/平台能力上完全不能接收深链或通知，属平台约束还是遗漏，需产品确认。
5. **文件快照漂移**：审计期间有并发修改，若行号与内容不一致，请以代码语义为准。

---

## 五、扫描清单（均已实际读取）

**安卓端**
- app/src/main/java/ai/deepseek/dshphone/ui/screen/SessionListScreen.kt
- app/src/main/java/ai/deepseek/dshphone/ui/screen/ArchivedSessionsScreen.kt
- app/src/main/java/ai/deepseek/dshphone/state/SessionStatusRank.kt
- app/src/main/java/ai/deepseek/dshphone/model/ArchivedSessions.kt
- app/src/main/java/ai/deepseek/dshphone/model/BlankSessionReuse.kt
- app/src/main/java/ai/deepseek/dshphone/model/AgentPresetRoster.kt
- app/src/main/java/ai/deepseek/dshphone/ui/App.kt
- app/src/main/java/ai/deepseek/dshphone/ui/screen/OnboardingScreen.kt
- （对照引用）state/Stores.kt、model/Format.kt、i18n/Strings.kt、ui/component/ConnectionBanner.kt、ui/component/EmptyState.kt、PhoneModel.kt

**小程序端**
- src/pages/index/index.tsx、src/pages/index/index.module.scss
- src/pages/archived/index.tsx、src/pages/archived/index.module.scss（并发修改新增）
- src/state/stores.ts、src/state/store.ts、src/state/cache.ts、src/state/search.ts
- src/ui/emptyState.tsx、src/ui/onboarding.tsx、src/ui/connectionBanner.tsx
- src/route.ts、src/model/archivedSessions.ts、src/model/format.ts、src/i18n/strings.ts
- （对照引用）src/state/appModel.ts、src/pages/preview/index.tsx、src/ui/sheets.tsx、src/pages/new/index.tsx、src/app.ts

---

## 六、统计口径

- **差异总条数：32**
- 按影响分布：
  - **大：3 条** — A-04（待审批/待回答未分档）、A-07（空态用原始名册，全归档时无提示）、A-21（取消归档失败无提示）
  - **中：10 条** — A-01、A-02、A-05、A-08、A-12、A-16、A-23、A-25、A-28、A-30
  - **小：19 条** — A-03、A-06、A-09、A-10、A-11、A-13、A-14、A-15、A-17、A-18、A-19、A-20、A-22、A-24、A-26、A-27、A-29、A-31、A-32

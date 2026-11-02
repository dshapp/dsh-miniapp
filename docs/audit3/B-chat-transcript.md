# 区域 B：会话页 + 转写渲染 审计（第三轮）

> 权威口径：安卓 /Users/user/dshapp/dsh-androidapp（Kotlin + Compose）。
> 被审对象：小程序 /Users/user/dshapp/dsh-miniapp（Taro 4 + React 18 + TS + Sass CSS Modules）。
> 只读源码，未改任何文件。所有位置均为本次审计当时读到的**当前**源码行号。
>
> 注意：审计过程中该工作区被并发的另一路编辑改动过（轮次轨道从“右侧 132px 常驻栏”被重写成
> “顶栏唤出的浮层菜单”）。本报告以**重读后的当前状态**为准；涉及被改动文件的条目都已复核。

---

## 概览

| 编号 | 差异一句话 | 安卓位置 | 小程序位置 | 优先级 | 建议 |
|---|---|---|---|---|---|
| B-01 | 跟尾只认“节点/队列变化”，流式回复只长高时不跟到底；安卓改看 canScrollForward | ChatScreen.kt:179-187 | chat/index.tsx:250-254 | P0 | 监听转写容器高度变化（ResizeObserver/scrollHeight 轮询）也触发贴底 |
| B-02 | 每帧 onScroll 写 setState 决定跟尾，惯性滑行期间状态竞争；安卓按手势生命周期 + 最终落点判定 | ChatScreen.kt:189-203 | chat/index.tsx:528-539 | P1 | 只在真正停在底部（onScrollToLower 或 onTouchEnd+延时）恢复 followTail |
| B-03 | “更早”加载指示从 18dp 转圈降级为文案 | ChatScreen.kt:439-441 | chat/index.tsx:359-361 + index.module.scss:73-77 | P2 | 用 loader-circle 旋转图标，字号 18px |
| B-04 | 初始落位用 scrollTop += 100000 的魔法增量，非真实内容底部 | ChatScreen.kt:165-171, 409-411 | chat/index.tsx:213-218 | P1 | 用 boundingClientRect/scrollOffset 读真实 scrollHeight 后定位 |
| B-05 | 列表项间空隙用 .row{margin-bottom}，非父容器 gap；末行多占 4px、首行无 | ChatScreen.kt:429 | chat/index.module.scss:79-82 | P2 | 父容器 gap:4px 或 .row + .row { margin-top:4px } |
| B-06 | 查找清除按钮靠 focus 属性 true→false→true 回焦，微信下可能不二次触发 | ChatScreen.kt:317-320 | chat/index.tsx:480-491 | P1 | 用递增 key 重挂 Input，或受控 focus 状态 |
| B-07 | 轮次轨道：安卓为顶栏锚定 DropdownMenu；小程序为通高右侧浮层抽屉（260px，top:0 bottom:0） | ChatScreen.kt:324-374 | chat/index.tsx:569-597 + index.module.scss:148-168 | P1 | 收成顶栏右下拉卡片（top≈顶栏底、max-height≈60vh、圆角+阴影） |
| B-08 | 轨道忙碌态只在整列变淡，未给“忙碌项”独立图标语义；安卓 busy→Schedule | ChatScreen.kt:341-351 | chat/index.tsx:587-591 | P2 | 忙碌项保留 loader 可接受；如需严格对齐换 clock 图标 |
| B-09 | 轨道勾/圆用字符字号 11px 当尺寸；安卓 Modifier.size(18.dp) | ChatScreen.kt:349 | chat/index.module.scss:183-188 | P2 | .railGlyph 改 width:18px; font-size:16px; line-height:18px |
| B-10 | 助手 text 块留白：两端均为 8+4+8，已对齐（核对通过） | MessageRow.kt:307-313, 285-288 | messageRow.module.scss:140-142 | — | 无需改动 |
| B-11 | 过程折叠展开后思考/工具行的插回位置依赖 store 过滤顺序 | MessageRow.kt:285-331 | messageRow.tsx:204-245 | P2 | 需运行时验证过滤后节点顺序（需真机/开发者工具验证） |
| B-12 | 图片只有 max-width，不读附件声明宽高、单张无 max-height；安卓按 280x220 / 120x120 收口 | MessageRow.kt:194-204, 233-238 | messageRow.module.scss:59-68 | P1 | 单张补 max-height:220px；缩略 112→120；解析声明 width/height |
| B-13 | 取图占位骨架：小程序 180x120 固定；安卓 60% 宽 x120 高 | MessageRow.kt:210-229 | messageRow.module.scss:90-98 | P2 | 骨架改 width:60%; height:120px |
| B-14 | 取图失败态形态不同：小程序“图标+文案”胶囊；安卓在 60%x120 区域内居中纯文字 | MessageRow.kt:210-228 | messageRow.module.scss:111-130 | P2 | 失败态与骨架同尺寸，避免行高跳变 |
| B-15 | 列表/引用的 compact 传播：两端一致（核对通过） | Markdown.kt:362-447 | markdown.tsx:271, 376 | — | 无需改动 |
| B-16 | 有序序号槽 18px right；安卓 20dp End | Markdown.kt:397-403 | markdown.module.scss:212-218 | P2 | 序号槽 20px、符号槽 14px 居中 |
| B-17 | 无序符号槽 18px right；安卓 width(14.dp) 居中 | Markdown.kt:404-410 | markdown.module.scss:212-218 | P2 | 同上 |
| B-18 | 任务框用 square-check/square 14px；安卓 CheckCircle/RadioButtonUnchecked 16dp | Markdown.kt:388-396 | markdown.tsx:364-369 + markdown.module.scss:220-225 | P2 | 改 circle-check/circle，16px |
| B-19 | 引用块底色被内联 color_bg 覆盖成页面底色；安卓 surfaceVariant@0.34 | Markdown.kt:427-447, 229 | markdown.tsx:267 + markdown.module.scss:235-243 | P1 | 删内联 backgroundColor，保留 scss 的 surface-variant |
| B-20 | 代码块头部无底色（只有下边框）；安卓头部 surfaceVariant@0.5 | Markdown.kt:309-313 | markdown.module.scss:150-157 | P2 | 头部补 surfaceVariant 半透明底 |
| B-21 | 表头底色是页面底色、行分隔线语义不同；安卓表头 surfaceVariant@0.55、行间 divider@0.5 | Markdown.kt:499-529, 533-554 | markdown.tsx:393 + markdown.module.scss:280-293 | P1 | 表头改 surfaceVariant；正文首行不加 border-top |
| B-22 | 表格固定总宽+横滑，不按可用宽铺满；安卓不溢出时等比拉伸 | Markdown.kt:503-519 | markdown.tsx:388-408 | P2 | 读容器宽，不溢出时按比例铺满 |
| B-23 | hr 用 border 色 1px；安卓 outlineVariant@0.7 的 HorizontalDivider | Markdown.kt:284, 232 | markdown.tsx:281 + markdown.module.scss:297-300 | P2 | 改用 outline 系色 |
| B-24 | 行内码 13px + 底色 color_bg；安卓 0.92em + surfaceVariant@0.85 | Markdown.kt:590-596 | markdown.tsx:32-35 + markdown.module.scss:94-97 | P2 | 底色改 surfaceVariant 系、字号 0.92em |
| B-25 | 链接下划线：两端一致（核对通过） | Markdown.kt:568 | markdown.module.scss:90-92 | — | 无需改动 |
| B-26 | 改动文件卡片底色 rgba(127,127,127,.08)；安卓 surfaceVariant@0.35 | ChangedFilesCard.kt:60-66 | changedFilesCard.module.scss:1-6 | P2 | 统一走主题变量 surface-variant 0.35 |
| B-27 | 改动卡片汇总行字号/图标偏小、用 margin 而非 gap | ChangedFilesCard.kt:72-90 | changedFilesCard.module.scss:15-31 | P2 | 字号 12px、图标 15px、flex gap:6px |
| B-28 | .more 未设 display:flex，图标与文字不并排居中 | ChangedFilesCard.kt:96-117 | changedFilesCard.module.scss:72-84 | P2 | .more 补 display:flex; justify-content:center; gap:4px |
| B-29 | 文件比较弹窗为全屏 CardDetailHost；安卓是 AlertDialog 高 420dp 滚动 | ChangedFilesCard.kt:174-208 | changedFilesCard.tsx:72-91 | P2 | 可接受；如需贴近给 DiffBody max-height:420px |
| B-30 | 摘要未到时都不占位（一致）；仅 loading 呈现方式不同 | ChangedFilesCard.kt:56, 188-191 | changedFilesCard.tsx:118-120 | P2 | 可选：loading 改行内占位 |
| B-31 | 行长按菜单用 wx.showActionSheet；安卓 DropdownMenu 就地弹出 | ChatScreen.kt:480-503 | chat/index.tsx:314-331 | P2 | 平台限制，记录不要求改 |
| B-32 | 安卓有 BackHandler 先退查找；小程序无系统返回拦截 | ChatScreen.kt:131 | chat/index.tsx:446 | P1 | 小程序无 onBackPress（仅 H5）；接受差异或补偿复位（需真机验证） |
| B-33 | 查找态 FAB 条件一致（核对通过） | ChatScreen.kt:559-572 | chat/index.tsx:600-604 | — | 无需改动 |
| B-34 | 用量/用时明细：安卓 AlertDialog；小程序就地展开面板 | MessageRow.kt:491-520 | messageRow.tsx:688-689 | P2 | 有意的平台适配，保留 |
| B-35 | 过程折叠：安卓点开详情；小程序就地展开列表 | MessageRow.kt:418-432 | messageRow.tsx:512-521 | P2 | 有意的平台适配，保留 |
| B-36 | 系统提示等宽详情：两端一致（核对通过） | MessageRow.kt:359-368 | messageRow.tsx:354-361 | — | 无需改动 |
| B-37 | 通知行图标/色调：五个分支语义基本对应 | MessageRow.kt:73-79 | messageRow.tsx:749-758 + cards.tsx:388-412 | P2 | 逐项核对图标名即可 |
| B-38 | CardRow 图标 14px 为字号、无固定盒宽高；安卓 size(14.dp) | Cards.kt:54-91 | cards.module.scss:13-28 | P2 | 图标改 width/height/line-height 14px |
| B-39 | CardRow suffix 色阶：两端一致（核对通过） | Cards.kt:92-99 | cards.module.scss:40-45 | — | 无需改动 |
| B-40 | 工具卡行尾多画一枚状态图标；安卓只有行首变体图标+running 转圈 | Cards.kt:406-421, 70-78 | cards.tsx:217 + cards.module.scss:47-53 | P1 | 去掉行尾 stateGlyph，running 交给行首 |
| B-41 | 工具变体图标命名：语义基本对应 | Cards.kt:369-377 | cards.tsx:54-73 | P2 | 仅确认 write 的 file-pen 与 NoteAdd 差异 |
| B-42 | ToolImageCard padding：6px 0 2px 22px；安卓 start=22,top=4,bottom=4 | Cards.kt:462-472 | cards.module.scss:344-354 | P2 | 统一 padding:4px 0 4px 22px |
| B-43 | 子调用缩进 + 左边框 + margin，视觉缩进 24px；安卓仅 padding(start=18) | Cards.kt:425-431 | cards.module.scss:337-342 | P2 | 去掉 border-left/margin-left |
| B-44 | read 行号 text-align:right；安卓左对齐 | Cards.kt:299-314 | cards.module.scss:190-214 | P2 | readNumber 改左对齐 |
| B-45 | 工具结果字面量折行（pre-wrap/break-all）；安卓不折行可横滑 | Cards.kt:353-366 | cards.module.scss:139-146 | P1 | monoText 改 white-space:pre + overflow-x:auto |
| B-46 | diff 三色：两端一致（核对通过） | Cards.kt:325-342 | cards.module.scss:232-246 | — | 无需改动 |
| B-47 | terminal 退出码 chip：assist chip vs 自绘无描边 | Cards.kt:277-290 | cards.module.scss:165-183 | P2 | 可接受；可加描边/12px |
| B-48 | JSON 树缩进带左边框；安卓只有 padding(start=12) | Cards.kt:248-253 | cards.module.scss:292-295 | P2 | 去掉 border-left 或注明增强 |
| B-49 | JSON 树默认展开/冒号/上限：两端一致（核对通过） | Cards.kt:202-224 | cards.tsx:486-509 | — | 无需改动 |
| B-50 | 查找计数文案：两端一致（核对通过） | ChatScreen.kt:300-307 | chat/index.tsx:463-466 | — | 无需改动 |
| B-51 | 清除与禁用条件：两端一致（核对通过） | ChatScreen.kt:309, 317 | chat/index.tsx:195, 480 | — | 无需改动 |
| B-52 | 查找占位：placeholder 行为等价（核对通过） | ChatScreen.kt:260-287 | navBar.tsx:146-165 | — | 无需改动 |
| B-53 | activeHit 复位：安卓在 onValueChange 也置 0；小程序仅 effect | ChatScreen.kt:218-223, 273 | chat/index.tsx:199-206, 454 | P2 | onInput 里同步 setActiveHit(0) |
| B-54 | 自动加载更早触发条件缺 historyLoaded/settledInitial | ChatScreen.kt:432-446 | chat/index.tsx:537-538 | P2 | 条件补 historyLoaded && settledInitial.current |
| B-55 | 贴底判定为平台近似（24px 容差） | ChatScreen.kt:152-158 | chat/index.tsx:47-48, 531-532 | — | 无需改动 |

---

## 逐条详情（仅展开需要改动/需确认的条目；已对齐项见概览）

### B-01 流式回复只长高时不跟尾（P0）

证据

安卓 ChatScreen.kt:179-187：

    LaunchedEffect(listState, followTail, settledInitialScroll) {
        if (!followTail || !settledInitialScroll) return@LaunchedEffect
        snapshotFlow { listState.canScrollForward }.collect { canForward ->
            if (!canForward || !followTail || listState.isScrollInProgress) return@collect
            val last = listState.layoutInfo.totalItemsCount - 1
            if (last >= 0) listState.scrollToItem(last, scrollOffset = Int.MAX_VALUE)
        }
    }

源码注释明确写着：不能拿节点数量当信号，流式回复期间行数不变、变的是最后一行高度。

小程序 chat/index.tsx:250-254：

    React.useEffect(() => {
      if (!followTail || !settledInitial.current) return;
      scrollToBottom();
    }, [nodes, queue, followTail, scrollToBottom]);

差异：安卓监听“是否还有内容可往下滚”（canScrollForward，覆盖行数增加与单行变高两种情形）；
小程序只监听 nodes/queue 引用变化。流式增量若只更新已有节点的 step.blocks 内容而不新增节点，
则不会触发；即使触发了，scrollTop 目标也只是 current + 100000，而 ScrollView 长高后 scrollTop
不变，微信不会自动跟随。

建议：给 transcriptInner 挂 ResizeObserver（微信内可用 Taro.createSelectorQuery 轮询），
一旦 scrollHeight 增大且 followTail 为真就 scrollToBottom()；手在拖时不抢（沿用现有
isScrollInProgress 近似：onTouchStart 置 dragRef.current=true，onTouchEnd 清）。
目标行为与安卓一致：只要底下还有内容就贴回底部。

风险/不确定：微信高频 setData 下 scrollHeight 抖动，防抖阈值需真机验证（建议 16~50ms）。

---

### B-02 跟尾状态每帧 setState（P1）

证据

安卓 ChatScreen.kt:189-203：DragInteraction.Start → followTail=false；
DragInteraction.Stop/Cancel → 等惯性停（snapshotFlow { isScrollInProgress }.first { !it }）
→ if (!canScrollForward) followTail = true。

小程序 chat/index.tsx:528-539 的 onScroll 末尾：

    if (detail.deltaY < 0 && !bottom) setFollowTail(false);
    else if (bottom) setFollowTail(true);

差异：安卓以“手势生命周期 + 最终落点”为准；小程序每帧 onScroll 都可能写 atBottom/followTail，
高频 setState 带来滚动卡顿与状态竞争，惯性滑行期间也可能被 deltaY<0 命中。

建议：改为记录最近一次 onScroll 时间戳，在 onScrollToLower（或 onTouchEnd + 150ms）读一次
distance 再决定是否恢复 followTail。

风险/不确定：微信 onScrollToLower 在快速滚动时可能不触发；需真机验证。

---

### B-03 “更早”加载指示降级（P2）

证据

安卓 ChatScreen.kt:439-441：store.loadingHistory 时画 CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)。

小程序 chat/index.tsx:359-361 用 Text(Strings.statusLoading) 文字；index.module.scss:73-77
样式里其实已经给了 .earlierLoading { font-size:18px } —— 说明是图标丢了、只剩字号。

建议：改回 Icon name='loader-circle' spin，字号 18px。

---

### B-04 初始落位用魔法增量（P1）

证据

安卓 ChatScreen.kt:165-171 与 409-411 都用
listState.scrollToItem(..., scrollOffset = Int.MAX_VALUE)；注释说明末行可能比屏幕高，
给到上限会钳到真实内容底部，而不是把末行顶到视口上沿。

小程序 chat/index.tsx:213-218：

    const scrollToBottom = React.useCallback((): void => {
      setFollowTail(true);
      setScrollTop(current => current + 100000);
    }, []);

差异：连续调用会让 scrollTop 无限膨胀；超出范围虽可能被钳到底部，但缺少“重新落位”的参照，
从顶部跳回底部时行为不确定。

建议：落位统一读真实值——createSelectorQuery 取 #chat-scroll 的 boundingClientRect 与
scrollOffset，再 setScrollTop(scrollHeight - viewportHeight)；或至少改成固定的大值常量并
在每次落位前先归零。

风险/不确定：微信 scrollTop 超范围钳制行为需真机确认。

---

### B-05 行间距用 margin-bottom（P2）

证据

安卓 ChatScreen.kt:429：verticalArrangement = Arrangement.spacedBy(Dimens.rowSpacing)，
4dp 项间空隙，首项顶部无空隙（由 contentPadding vertical=12 负责）。

小程序 chat/index.module.scss:79-82：.row { margin-bottom: 4px; }，末行底部多 4px。

建议：父容器用 gap:4px；微信对 WXSS gap 支持有限时用 .row + .row { margin-top:4px }。

风险/不确定：微信 flex gap 支持度需开发者工具/真机验证。

---

### B-06 查找清除后的回焦（P1）

证据

安卓 ChatScreen.kt:317-320：清除只清文字并 findFocus.requestFocus()，退出查找交给返回键。

小程序 chat/index.tsx:480-491：setFindQuery(''); setActiveHit(0); setFindFocused(false);
setTimeout(() => setFindFocused(true), 0)，随后 NavSearchInput 的 focus 属性从 true→false→true。

差异：微信小程序 Input 的 focus 属性在同一次渲染批次内 true→false→true 可能被合并，
导致不回焦（键盘收起、无法继续输入）。

建议：NavSearchInput 增加一个 focusKey（递增数字），把 key 挂到 Input 上强制重挂；
或在 navBar.tsx:146-165 内部维护 focus 的边沿触发。

风险/不确定：微信基础库对 focus 的合并行为需真机验证。

---

### B-07 轮次轨道形态（P1，跨区已知项）

证据

安卓 ChatScreen.kt:324-374：Box { IconButton(onClick = { turnMenu = true }); DropdownMenu(turnMenu, ...) }，
锚在按钮下方、选中即关（onClick = { turnMenu = false; ... }），菜单项 leadingIcon 18dp。

小程序 chat/index.tsx:569-597 与 index.module.scss:148-168：

    .railOverlay { position:absolute; top:0; right:0; bottom:0; z-index:50;
                   display:flex; flex-direction:row; justify-content:flex-end; }
    .rail { width:260px; max-width:78vw; height:100%; ... }

差异：这是通高侧抽屉，从转写区顶一直盖到底，不是“锚定在按钮下方的菜单卡片”。
（并发编辑已把此前 132px 常驻栏改成浮层，方向正确，但空间形态仍偏离安卓。）

建议：.railOverlay 自身 pointer-events:none、仅内部卡片可点；.rail 改
position:absolute; top:8px; right:8px; height:auto; max-height:60vh; border-radius:12px;
box-shadow:0 8px 24px rgba(0,0,0,.16)。若要贴按钮下沿，用 navMetrics().totalHeight 定位。

风险/不确定：小程序无锚定定位，只能近似；需真机看视觉。

---

### B-08 / B-09 轨道忙碌图标与尺寸（P2）

证据

安卓 ChatScreen.kt:341-351：busy→Icons.Default.Schedule、active→Icons.Default.Check、
else→RadioButtonUnchecked，且 Modifier.size(18.dp)。

小程序 chat/index.tsx:587-591：busy→loader-circle(spin)、active→check、else→circle；
尺寸在 index.module.scss:183-188：.railGlyph { width:14px; font-size:11px; }。

建议：.railGlyph 改 width:18px; font-size:16px; line-height:18px。busy 的 loader 可接受；
若严格对齐安卓，换成 clock / history 字形。

---

### B-12 图片不读声明尺寸、单张无 max-height（P1）

证据

安卓 MessageRow.kt:194-204：

    .widthIn(max = if (compact) IMAGE_COMPACT_MAX_WIDTH else IMAGE_MAX_WIDTH)
    .heightIn(max = if (compact) IMAGE_COMPACT_MAX_HEIGHT else IMAGE_MAX_HEIGHT)

MessageRow.kt:232-238：IMAGE_MAX_WIDTH=280.dp、IMAGE_MAX_HEIGHT=220.dp、
COMPACT=120.dp/120.dp。

小程序 messageRow.module.scss:59-68：

    .attachmentImage { max-width: 260px; border-radius: 10px; }
    .attachmentImageCompact { max-width: 112px; max-height: 112px; }

差异：单张（非 compact）只有 max-width，没有 max-height；attachmentImage.tsx:92-97 用
mode="widthFix"，竖图（例如 1080x2400）会按宽度等比拉到极高，把一条消息撑成数屏。
尺寸上限也与安卓不同（260 vs 280、112 vs 120）。

建议：.attachmentImage 补 max-height:220px；compact 上限改 120px。若要更贴近安卓，
在 attachmentImage.tsx 里解析 width/height（对齐 Android ImageAttachmentRef 的
width/height，见 ImageBlocks.kt:68-69）并写内联 max-width/max-height，甚至用
aspectFit 固定最大盒 280x220。

风险/不确定：widthFix + max-height 的实际缩放行为需真机验证（可能被拉伸变形）。

---

### B-13 / B-14 图片占位与失败态（P2）

证据

安卓 MessageRow.kt:210-229：未取回时 Box(Modifier.fillMaxWidth(0.6f).height(120.dp)) 居中；
loaded 为真画 imageUnavailable（labelSmall、onSurfaceVariant），否则画 20dp 转圈。

小程序 messageRow.module.scss:90-98 .imageSkeleton 固定 180x120；:111-130 .imageFailed
是“图标 + 文案”的胶囊。

建议：骨架改 width:60%; height:120px；失败态与骨架同尺寸并居中，避免行高跳变。

---

### B-19 引用块底色错误（P1）

证据

安卓 Markdown.kt:427-447：.background(blockSurface())，blockSurface() 定义在
Markdown.kt:229 = surfaceVariant.copy(alpha = 0.34f)。

小程序 markdown.tsx:267：

    <View className={styles.quote} style={{ backgroundColor: color_bg }}>
      <View className={styles.quoteBar} style={{ backgroundColor: color_primary }} />

而 markdown.module.scss:235-243 里 .quote 已经写了 background: var(--dsh-color-surface-variant)，
被行内 style 覆盖成了页面底色 color_bg（const.ts:18）。

建议：删除内联 backgroundColor: color_bg，保留 scss；透明度用
color-mix(in srgb, var(--dsh-color-surface-variant) 34%, transparent) 或新增 rgba 变量。

---

### B-20 代码块头部无底色（P2）

证据

安卓 Markdown.kt:309-313：头部 Row 有
background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
与 padding(start=12, end=4, top=2, bottom=2)，随后 HorizontalDivider(color = line)。

小程序 markdown.module.scss:150-157：.codeHeader 只有 padding:2px 4px 2px 12px 与
border-bottom；无底色。padding 数值与安卓一致。

建议：头部补 background: color-mix(in srgb, var(--dsh-color-surface-variant) 50%, transparent)。

---

### B-21 表格表头底色与行分隔线（P1）

证据

安卓 Markdown.kt:499-529：headerBackground = surfaceVariant.copy(alpha = 0.55f)；
表头与正文之间 HorizontalDivider(color = line)；正文行之间
HorizontalDivider(color = line.copy(alpha = 0.5f))。单元格 padding 见 Markdown.kt:543-548
（horizontal=10, vertical=8），表头 SemiBold。

小程序 markdown.tsx:393：表头行 style={{ backgroundColor: color_bg }}（页面底色）；
markdown.module.scss:280-293 里 .tableHeadCell/.tableCell 都是 8px 10px、13px/19px ✔；
但 markdown.tsx:396-404 对每一行（含第一行正文）都加 borderTopWidth:1 —— 与表头分隔线重复。

建议：表头底色改 surface-variant 系；正文行仅在 index > 0 时加 border-top。

---

### B-22 表格宽度铺满策略（P2）

证据

安卓 Markdown.kt:503-519：BoxWithConstraints 取 available；overflow = total >= available；
不溢出时 widths = raw.map { it * (available / total) } 等比铺满；溢出才 horizontalScroll。

小程序 markdown.tsx:388-408：固定像素总宽 totalWidth + 横向 ScrollView，不读容器宽。

建议：用 createSelectorQuery 读外层宽度；不溢出时给表格 width:100%、单元格 flex:1
并保留 min-width:48px 的下限。

风险/不确定：小程序 Text + flex 宽度组合需真机验证。

---

### B-23 / B-24 hr 与行内码底色（P2）

证据

安卓 Markdown.kt:232 hairline() = outlineVariant.copy(alpha = 0.7f)，ThematicBreak
用 HorizontalDivider(color = hairline())（Markdown.kt:284）；行内码样式在
Markdown.kt:590-596（fontSize = 0.92.em、background = surfaceVariant.copy(alpha = 0.85f)、
letterSpacing = 0.sp）。

小程序 markdown.tsx:281 hr 用 color_border；markdown.module.scss:297-300 .hr{height:1px}。
行内码 markdown.tsx:32-35 INLINE_CODE_STYLE={ backgroundColor: color_bg, color: color_text }，
markdown.module.scss:94-97 .inlineCode{font-size:13px}。

建议：hr 改用 outline 系变量；行内码底色改 surfaceVariant 系；字号改 0.92em。

---

### B-26 / B-27 / B-28 改动文件卡片（P2）

证据

安卓 ChangedFilesCard.kt:60-66：background(surfaceVariant.copy(alpha = 0.35f), RoundedCornerShape(8.dp))
.padding(10.dp) + spacedBy(6.dp)。:67-91 汇总行：icon size(15.dp)、标题 labelLarge、
+N/−N labelMedium。:96-117 展开行为 Row(center, padding(vertical = 2.dp))。
:126-157 文件行 spacedBy(6.dp)、路径 bodySmall mono。

小程序 changedFilesCard.module.scss：:1-6 背景 rgba(127,127,127,0.08)、padding 10px、圆角 8px；
:15-18 .glyph 13px + margin-right:6px；:20-24 .title 12px/600；:26-31 .added/.deleted 11px +
margin-left:6px；:33-38 .row 无 gap；:72-75 .more 无 display:flex。

建议：背景统一 surface-variant@0.35；.row 用 flex gap:6px；.more 补
display:flex; justify-content:center; gap:4px；汇总字号 12px、图标 15px。

---

### B-32 无系统返回键退出查找（P1）

证据

安卓 ChatScreen.kt:130-131：BackHandler(enabled = finding) { exitFind() }。

小程序 chat/index.tsx:446 只有顶栏返回键分派 if (finding) exitFind() else back()；
全文件没有任何 onBackPress / useBackPress / 返回拦截。

建议：微信小程序不提供 onBackPress（仅 H5 端 Taro.useBackPress 可用）。可接受的补偿：
自定义导航栏已关掉系统返回按钮，但仍可能被系统手势返回；至少在注释中写明该平台差异，
并保证 exitFind 在页面隐藏时复位。

风险/不确定：需真机/开发者工具验证微信是否存在可用的返回拦截能力。

---

### B-38 CardRow 图标尺寸（P2）

证据

安卓 Cards.kt:70-78：running 时 CircularProgressIndicator(Modifier.size(Dimens.iconSlot),
strokeWidth = 1.5.dp)，否则 Icon(..., Modifier.size(Dimens.iconSlot))；iconSlot = 14.dp
（Theme.kt:26）。行 min-height chromeRowHeight = 24.dp（Cards.kt:54-57），摘要 labelMedium
（Cards.kt:84-91）。

小程序 cards.module.scss:13-28：.row min-height:24px ✔；.rowGlyph{width:14px; font-size:14px;
line-height:20px}（用字号当尺寸，字体图标会有基线漂移）。

建议：图标盒改 width:14px; height:14px; line-height:14px; display:flex 对齐。

---

### B-40 工具卡行尾多一枚状态图标（P1）

证据

安卓 Cards.kt:406-421：icon 按 state 选（ERROR→Warning、STOPPED→PauseCircle、否则变体图标），
CardRow(..., running = rowModel.state == ToolRowState.RUNNING)，行尾只有 suffix
（Cards.kt:92-99）。running 的表达在 Cards.kt:70-78：行首位置画转圈。

小程序 cards.tsx:211-218：

    <View className={styles.row} onClick={openDetail}>
      <Icon name={toolVariantIcon(model.variant)} className={styles.rowGlyph} />
      <HighlightedText ... />
      {suffix}
      <Icon name={stateIcon(model.state).name} spin={...} className={styles.stateGlyph + ' ' + tint} />
    </View>

差异：小程序每个工具行右侧多一枚 check/x/square/loader 状态图标，行首同时还是变体图标；
安卓只有行首变体（或错误/暂停态图标）+ running 转圈。

建议：删除行尾 stateGlyph；running 时把行首图标换成 loader-circle（或保留变体图标 + 行首
转圈），与安卓一致。

---

### B-42 / B-43 / B-44 / B-48 缩进与等宽细节（P2）

证据

- ToolImageCard：安卓 Cards.kt:465-466 padding(start = 22.dp, top = 4.dp, bottom = 4.dp)；
  小程序 cards.module.scss:348 padding:6px 0 2px 22px。
- 子调用缩进：安卓 Cards.kt:427 Box(Modifier.padding(start = 18.dp))（无边框）；
  小程序 cards.module.scss:337-342 .subCall{padding-left:18px; border-left:2px solid ...;
  margin-left:6px}，视觉缩进实为 24px。
- read 行号：安卓 Cards.kt:299-314 行号 Text width(40.dp) 左对齐、outline 色；
  小程序 cards.module.scss:190-214 .readNumber{width:40px; text-align:right}。
- JSON 树：安卓 Cards.kt:248-253 Column(Modifier.padding(start = 12.dp))（无竖线）；
  小程序 cards.module.scss:292-295 .jsonChildren{padding-left:12px; border-left:1px solid ...}。

建议：按安卓逐项收口；若刻意保留边框/右对齐作为视觉增强，请在源码注释注明，
避免下一轮被当成缺陷。

---

### B-45 工具结果折行 vs 安卓横滑（P1）

证据

安卓 Cards.kt:353-366 MonospaceBlock：

    Text(text, modifier = Modifier.fillMaxWidth().horizontalScroll(scroll),
         style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, color = tint)

小程序 cards.module.scss:139-146：

    .monoText { font-family: ...; font-size: 12px; line-height: 18px;
                white-space: pre-wrap; word-break: break-all; color: var(--dsh-color-text); }

对照：Markdown 代码块小程序已经做对（markdown.module.scss:187-194 .codeText{white-space:pre}
+ ScrollView scrollX，对齐 Markdown.kt:344-351）。

差异：工具结果（terminal / read / diff / json 标量）在安卓不折行、可横滑；
小程序强制折行，窄屏下长行会把行高撑爆、可读性差。

建议：.monoText 改 white-space:pre; word-break:normal; overflow-x:auto；
.monoBlock 允许横向滚动（或直接复用 CodeBlock 的 ScrollView 结构）。

---

### B-53 activeHit 复位时机（P2）

证据

安卓 ChatScreen.kt:273：onValueChange = { findQuery = it; activeHit = 0 }，
另有 LaunchedEffect(findQuery, finding) { activeHit = 0; ... }（ChatScreen.kt:218-223）。

小程序 chat/index.tsx:454 的 onInput={setFindQuery} 不同步复位，仅靠
chat/index.tsx:199-206 的 effect。

建议：onInput 里一并 setActiveHit(0)（当前 effect 已覆盖，优先级低，属一致性收口）。

---

### B-54 自动加载更早的触发条件（P2）

证据

安卓 ChatScreen.kt:432-446：哨兵仅在 store.hasMore && store.historyLoaded &&
visibleNodes.isNotEmpty() 时渲染，且 LaunchedEffect 内 if (settledInitialScroll) model.loadEarlier(store)。

小程序 chat/index.tsx:537-538：

    if (detail.scrollTop <= 8 && store.hasMore && !loadingHistory) void store.loadEarlier();

缺少 historyLoaded 与 settledInitial.current 判断。

建议：条件补 historyLoaded && settledInitial.current，避免基线未到就拉历史。

---

## 未确认项（需真机/开发者工具验证）

1. B-01 ResizeObserver / scrollHeight 轮询在微信高频 setData 下的抖动与开销。
2. B-04 scrollTop 超范围钳制行为。
3. B-06 微信 Input 的 focus 属性是否会被同一渲染批次合并。
4. B-07 浮层菜单的锚定视觉与点外关闭手感。
5. B-12 widthFix + max-height 的缩放是否正确（是否变形）。
6. B-22 小程序 Text + flex 在表格铺满上的表现。
7. B-32 微信小程序是否存在可用的系统返回拦截（onBackPress 仅 H5）。
8. B-05 微信 WXSS 对 flex gap 的支持度。

---

## 已对齐（本轮核对通过，勿改）

B-10（助手 text 块留白两端 20px）、B-15（列表/引用 compact 传播）、B-25（链接下划线）、
B-33（查找态 FAB 条件）、B-36（系统提示等宽详情）、B-39（CardRow suffix 色阶）、
B-46（diff 三色）、B-49（JSON 树默认展开/冒号/子项上限）、B-50（查找计数文案）、
B-51（清除与禁用条件）、B-52（查找占位）、B-55（贴底容差为平台近似）。

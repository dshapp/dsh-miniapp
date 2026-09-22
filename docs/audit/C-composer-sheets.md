# C 区审计报告：输入区与弹层（小程序 vs 安卓）

- 审计范围（用户指定）
  - 安卓：ui/screen/ComposerBar.kt、ui/screen/Sheets.kt、model/QuestionFlow.kt
  - 小程序：src/ui/composerBar.tsx、src/ui/sheets.tsx、src/state/composer.ts、src/model/questionFlow.ts
- 方法：逐文件实读两边源码，引用「文件:行 + 关键代码/文案」；为确认外部行为，另行只读查证了少量被这两个区域直接调用的支撑文件（安卓 state/PhoneModel.kt、state/SessionStore.kt、model/Frames.kt、model/GoalPhaseAction.kt、model/SessionUsageReading.kt、model/Models.kt、i18n/Strings.kt；小程序 src/state/appModel.ts、src/state/sessionStore.ts、src/model/types.ts、src/model/format.ts、src/i18n/strings.ts、src/pages/chat/index.tsx、src/ui/composerBar.module.scss、src/ui/sheets.module.scss）。未修改任何源码。
- 路径约定：小程序路径相对工作区根；安卓路径统一省略前缀 /Users/user/dshapp/dsh-androidapp/app/src/main/java/ai/deepseek/dshphone/。
- 类型标签：缺失 / 行为不同 / 文案不同 / 视觉不同 / 交互手势不同。凡证据不足的另标「不确定」。

---

## 一、输入区外壳与整体布局

### C-01 输入区外层内边距与纵向间距不同
- 安卓依据：ui/screen/ComposerBar.kt:209-219 — Surface(color = background, modifier = Modifier.imePadding().navigationBarsPadding()) + Column(...padding(horizontal = Dimens.columnInset, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp))。
- 小程序现状：src/ui/composerBar.tsx:724 — View className={styles.root} style={{ paddingBottom: (8 + safeBottom) + 'px' }}；src/ui/composerBar.module.scss:6-12 — gap: 6px; padding: 8px 16px。
- 类型：视觉不同
- 影响与建议：行间距 8dp→6px、底部安全区由 js 兜底；观感略紧但可用。影响小，可保留。

### C-02 键盘/安全区处理方式不同
- 安卓依据：ui/screen/ComposerBar.kt:212 — Modifier.imePadding().navigationBarsPadding()。
- 小程序现状：src/ui/composerBar.tsx:802 — adjustPosition；:724 仅 useSafeBottom()。
- 类型：行为不同
- 影响与建议：小程序靠 Textarea 自带 adjustPosition 顶起，弹层内的输入框（计划评审/提问）不受此影响。属平台差异，影响小；建议在真机回归一次「弹层内输入框被键盘遮挡」的情况。

---

## 二、输入卡片与正文

### C-03 触发 token 高亮：内联胶囊 vs 独立 token 条
- 安卓依据：ui/screen/ComposerBar.kt:443-513（BasicComposerField 用 VisualTransformation 着色 + drawBehind 画圆角胶囊底，ComposerBar.kt:552-572 drawTokenPill），正文里 @引用 / $技能 / /命令 直接带底色。
- 小程序现状：src/ui/composerBar.tsx:761-771 在输入框上方另起一条 tokenStrip，胶囊显示整段 token 原文、点按 removeToken 摘除；src/state/composer.ts:49-67 triggerRanges 计算区间。
- 类型：视觉不同（附交互不同）
- 影响与建议：小程序无法在 Textarea 内画底纹，属已知移植取舍（composerBar.tsx:27-38 注释）。功能等价，但正文与胶囊分离后用户可能看不出 token 在正文中的位置。影响中；若要收敛，可考虑改用 span 或富文本编辑能力，或至少让 token 条与正文同一视觉块。

### C-04 占位符 / 最大行数 / 自动聚焦一致
- 安卓依据：ComposerBar.kt:487-493 placeholder Strings.composerPlaceholder，ComposerBar.kt:504 maxLines = 6，ComposerBar.kt:471-481 autoFocus 带重试。
- 小程序现状：composerBar.tsx:798 placeholder={Strings.composerPlaceholder}，composerBar.tsx:721 textareaHeight = Math.min(Math.max(lineCount, 1), 6) * 22 + 16，composerBar.tsx:799 focus={focused}。
- 类型：无差异（说明）
- 影响与建议：文本一致，行数上限一致。无需改动。

---

## 三、输入卡片控制行：按钮与入口

### C-05 附件入口形态：菜单 vs 两个独立图标
- 安卓依据：ComposerBar.kt:303-325 — 一个回形针 IconButton 打开 DropdownMenu，两项 Strings.pickPhoto / Strings.pickFile（Strings.kt:92-93 = Photo/照片、File/文件）。
- 小程序现状：composerBar.tsx:829-830 — 直接摆 image（选照片）与 paperclip（选文件）两个图标，无菜单、无文字标签。
- 类型：交互手势不同 + 文案不同
- 影响与建议：小程序少了菜单这一层，但多占一个图标位、且无「照片/文件」文字提示。影响中；建议至少在图标上加可访问名称。

### C-06 附件选择来源不同
- 安卓依据：ComposerBar.kt:119-132 — PickMultipleVisualMedia(4)（相册多选 4 张）与 OpenMultipleDocuments() + arrayOf("*/*")（系统文档任意类型）。
- 小程序现状：composerBar.tsx:605-620 wx.chooseMedia({count:4, mediaType:['image'], sourceType:['album','camera']})；composerBar.tsx:622-636 wx.chooseMessageFile({count:4, type:'file'})。
- 类型：行为不同
- 影响与建议：小程序「文件」入口只能从微信聊天记录里挑文件，无法浏览本机文件系统；相机入口是安卓没有的额外能力。影响中。建议说明来源，或确认是否存在本机文件选择能力（不确定微信是否提供）。

### C-07 附件渲染：纯 chip vs 带缩略图
- 安卓依据：ComposerBar.kt:931-956 AttachmentStrip 用 InputChip：leading Image/InsertDriveFile 图标 + 文件名 + trailing Close。
- 小程序现状：composerBar.tsx:773-789 + 369-392 AttachmentThumb：图片附件显示真实缩略图，缺预览则骨架「…」，文件附件 file-text 图标，再跟文件名与 x。
- 类型：视觉不同（小程序多）
- 影响与建议：小程序体验更好。注意 AttachmentThumb 会向宿主要一次本地路径（composerBar.tsx:376-387），失败时停在骨架，属可接受错误态。

### C-08 +（加号）启动器分支一致，候选来源不同
- 安卓依据：ComposerBar.kt:280-302 — 草稿空落 /，非空则 launchCommandLauncher()（ComposerBar.kt:165-173）。
- 小程序现状：composerBar.tsx:814-828 同样逻辑，launchCommandLauncher（composerBar.tsx:520-525）只列 BUILTIN_COMMANDS。
- 类型：行为不同（候选集，见 C-32）
- 影响与建议：分支逻辑一致；差异归入 C-32。影响小。

### C-09 控制行是否随正文横向滚动不同
- 安卓依据：ComposerBar.kt:279-410 — 加号、附件菜单固定在 Row；只有权限/计划/模型那一段在 .weight(1f).horizontalScroll(...) 里（ComposerBar.kt:326-372）。
- 小程序现状：composerBar.tsx:812-850 — actionScroll 里依次放加号、图片、回形针、权限、计划、预设、模型、压缩；上下文环/发送键在滚动区外。
- 类型：交互手势不同
- 影响与建议：小程序把 + 与附件图标也放进可滚动区，窄屏时可能被滑出视野。影响中；建议把 +/附件移出滚动容器。

### C-10 权限切换：DropdownMenu vs ActionSheet（含分页/勾选）
- 安卓依据：ComposerBar.kt:334-355 — DropdownMenu 列 store.permissions.selectableOptions，点 danger-full-access 触发确认弹窗（ComposerBar.kt:417-432）；未选项无勾选标记。
- 小程序现状：composerBar.tsx:638-660 + 86-106 showChoice — wx.showActionSheet，每页最多 6 项、超出用 Strings.showMore（strings.ts:226），当前项加对勾前缀，点当前项直接 return；full-access 走 wx.showModal。
- 类型：交互手势不同 + 视觉不同（小程序多勾选/分页）
- 影响与建议：功能等价且更明确。注意分页为代码自实现（注释称微信 itemList 上限 6），平台真实上限未核实（不确定）。影响小。

### C-11 计划模式入口：只有「关闭」vs 「关闭 + 开启」
- 安卓依据：ComposerBar.kt:356-370 — 仅当 store?.planModeTarget == true 才显示 chip，点击 model.setPlanMode(false)；false/null 时无入口（进入计划模式靠 /plan 命令）。
- 小程序现状：composerBar.tsx:834-843 — planTarget === true 显示可关 chip；planTarget === false 额外显示一个「计划」文字按钮，点击 setPlanMode(true)。
- 类型：行为不同（小程序多）
- 影响与建议：小程序提供显式开启入口，属易用性增强但与安卓不一致。若严格对齐需删除，或反向推动安卓补齐。影响中。

### C-12 预设（Agent 模式）入口：安卓输入区无，小程序输入区有
- 安卓依据：ComposerBar.kt:279-410 控制行只有权限、计划、模型；预设入口在 ui/screen/NewSessionScreen.kt:99-106（且受 model.agentPresetPickerEnabled 门控）。预设名只在上下文弹层出现（Sheets.kt:246-250）。
- 小程序现状：composerBar.tsx:844-846 presets.length > 0 ? Text onClick={openPresetPicker} : null，openPresetPicker（684-693）列出全部预设并加对勾；未消费 pickerEnabled/modeSelectionEnabled（源码内无引用）。
- 类型：行为不同（小程序多）+ 门控缺失
- 影响与建议：把安卓「新建会话页」的能力搬到了输入区；主机关闭 Agent 模式选择时小程序仍给入口。影响中；建议删除或补门控。

### C-13 压缩上下文入口：安卓 UI 无，小程序有三处
- 安卓依据：PhoneModel.kt:1240 fun compactContext = runCommand("/compact", sessionId)，但 grep compactContext ui/ 无任何调用点 —— 安卓 UI 没有「压缩上下文」按钮，只能靠输入 /compact。上下文弹层正文结束于统计行（Sheets.kt:355-362），无按钮。
- 小程序现状：输入区 composerBar.tsx:848 常驻「压缩上下文」文字按钮；上下文弹层底部再给一个按钮（sheets.tsx:437-441）；openContext 兜底也把 compact 作为唯一动作（composerBar.tsx:695-702）。
- 类型：行为不同（小程序多）
- 影响与建议：对齐安卓需删除；若保留建议只留上下文弹层内一处。影响中。

### C-14 模型切换：完整思考强度 Sheet vs 扁平 ActionSheet
- 安卓依据：ComposerBar.kt:371 TextAction(...model...) → ComposerBar.kt:415 打开 ModelPickerSheet（Sheets.kt:45-139）：有 reasoning efforts 时给「模型 / 思考强度」两个 Tab（Sheets.kt:60-64），可选项、分组标题、选中勾。
- 小程序现状：composerBar.tsx:662-682 openModelPicker 用 showChoice 拉平所有 group.name + ' · ' + entry.name，只加对勾；没有思考强度。完整 ModelPickerSheet（sheets.tsx:459-554）只在会话页「更多」菜单里打开（pages/chat/index.tsx:303,314,527）。
- 类型：行为不同（重要）
- 影响与建议：从输入区无法切思考强度，必须绕到「更多 → 模型」。影响大；建议输入区直接打开 ModelPickerSheet。

### C-15 模型目录为空时的反馈不同
- 安卓依据：Sheets.kt:72-76 加载中显示 CircularProgressIndicator；无数据时仍弹出 sheet（空列表）。
- 小程序现状：composerBar.tsx:677-680 if (items.length === 0) { toast(modelDirectory.error ?? Strings.model, 'none'); return; } — 只弹一句「模型」。
- 类型：行为不同 + 文案不同
- 影响与建议：toast 退化成「模型」没有信息量。影响中；建议区分加载中/加载失败。

### C-16 上下文占用入口：圆环 arc vs 文字徽标
- 安卓依据：ComposerBar.kt:373-375, 595-618 ContextRing：18dp Canvas 画 track 圆 + 进度弧，点击开 ContextSheet。
- 小程序现状：composerBar.tsx:851-855 + composerBar.module.scss:393-407 .contextRing 30px 圆 + 9px 百分比文字，点击走 props.onOpenContext，未注入时降级为 compact 单动作（composerBar.tsx:695-702）。
- 类型：视觉不同
- 影响与建议：小程序显示百分比数字可读性更好；未注入时会把「上下文明细」替换成 compact，语义偏差。影响小～中。

---

## 四、发送 / 停止 / 插话

### C-17 运行中主键语义：排队图标 vs 「加入队列」文案
- 安卓依据：ComposerBar.kt:395-408 始终画 Icons.AutoMirrored.Filled.Send（注释 ComposerBar.kt:396-397：回合在跑时发送就是排队）。
- 小程序现状：composerBar.tsx:866-882 — running 时发送键渲染文字 Strings.enqueue（strings.ts:166 = Add to queue/加入队列），否则渲染 send 图标。
- 类型：文案不同 + 视觉不同
- 影响与建议：小程序更明确；安卓没有 enqueue 字符串。属有意增强，影响小。

### C-18 停止键出现条件不同（是否计入附件）
- 安卓依据：ComposerBar.kt:376-393 — if (store?.running == true && draft.text.isBlank()) 显示 Stop（不看 attachments）。
- 小程序现状：composerBar.tsx:716 showStop = running && draft.trim().length === 0 && attachments.length === 0。
- 类型：行为不同
- 影响与建议：运行中「草稿空但有附件」时安卓显示停止键（此时实际发不出附件），小程序显示发送键（可把附件排队）。小程序语义更合理。影响中；建议确认产品预期后统一。

### C-19 小程序多出「插队发送」按钮 + 长按发送插话（安卓完全无）
- 安卓依据：ComposerBar.kt:398 发送键只调 send()（ComposerBar.kt:181-207 → model.submit → sessionPrompt(..., "queue", ...)，PhoneModel.kt:762-764）。安卓虽有 PhoneModel.kt:784-805 steer() 与 :812 submitSteer()，但 ui/ 下无调用点 —— 插队只能通过队列行上的发送图标（ComposerBar.kt:836-849）。
- 小程序现状：composerBar.tsx:717 showSteer = running && !showStop && draft.trim().length > 0；856-858 渲染 Strings.queueSteer（strings.ts:170 = Send now/插队发送）按钮调 steer()；872-874 发送键 onLongPress 也调 steer()。
- 类型：交互手势不同 + 行为不同（小程序多）
- 影响与建议：明确的功能分叉：小程序在输入区即可插话，安卓不行。影响大；建议与安卓/Mac 对齐（删掉输入区 steer，或同步给安卓）。

### C-20 只读子智能体时发送键状态不同
- 安卓依据：ComposerBar.kt:179 sendDisabled 不含只读判断；ComposerBar.kt:185-187 只在 send() 内 if (address.mode != SubagentMode.CONTINUABLE) return，按钮仍高亮、点了静默无效。
- 小程序现状：composerBar.tsx:718 readOnlySubagent；868-870 发送键加 sendDisabled 类并 if (!sendDisabled && !readOnlySubagent) 拦点击；876-880 文案/图标置灰（sendLabelOff）。
- 类型：视觉不同 + 行为不同
- 影响与建议：小程序禁用态明确，优于安卓静默失败。影响小；建议反向同步安卓。

### C-21 发送震动反馈缺失
- 安卓依据：ComposerBar.kt:183 haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)。
- 小程序现状：composerBar.tsx:569-594 send() 无 wx.vibrateShort。
- 类型：缺失（反馈）
- 影响与建议：感官差异。影响小；可补 wx.vibrateShort。

### C-22 发送失败反馈不同
- 安卓依据：PhoneModel.kt:761-774 — accepted=false 时仅 retirePendingSubmission，不设任何错误；异常路径写 store.historyError（PhoneModel.kt:776-778），由 ComposerBar.kt:246-248 InfoLine 显示。
- 小程序现状：composerBar.tsx:587-592 if (!accepted) { toast(Strings.sendFailed, 'none'); return; }（strings.ts:168）；异常路径同样落 historyError（appModel.ts:646-649）。
- 类型：行为不同 / 文案不同
- 影响与建议：小程序对「主机没收下」有显式 toast，安卓静默。影响中；建议保留小程序反馈。

---

## 五、待办 / 目标 / 队列

### C-23 待办条展开箭头方向不同
- 安卓依据：ComposerBar.kt:669-672 if (expanded) ExpandLess else ExpandMore（上下箭头）。
- 小程序现状：composerBar.tsx:238 Icon name={expanded ? 'chevron-down' : 'chevron-right'}（下/右箭头）。
- 类型：视觉不同
- 影响与建议：折叠态用向右箭头，与安卓向下语义不同。影响小；建议折叠态改 chevron-down 或统一约定。

### C-24 待办分组/图标/配色一致
- 安卓依据：ComposerBar.kt:639-712 done→CheckCircle 绿、pending→RadioButtonUnchecked 橙、active→Autorenew 主色，组间「·」。
- 小程序现状：composerBar.tsx:215-268 同顺序、同配色（.todoDone/.todoPending/.todoActive），active 图标 refresh-cw spin。
- 类型：无差异（说明）
- 影响与建议：组序（完成→待办→进行中）一致，无需改。

### C-25 目标条数据源：安卓过滤 complete，小程序不过滤
- 安卓依据：ComposerBar.kt:717-719 val goal = store?.goalBarGoal ?: return；state/SessionStore.kt:256 val activeGoal get() = goal?.takeIf { it.phase != "complete" }；:266 goalBarGoal get() = activeGoal（注释明确「完成态的目标不能画出来」）。
- 小程序现状：composerBar.tsx:411 const goal = useStore(store.goalStore)；728-734 直接 GoalBar goal={goal}，用的是 store.goal 原值（sessionStore.ts:763-767），未走 activeGoal（sessionStore.ts:986-989）。
- 类型：行为不同（重要）
- 影响与建议：目标已 complete 时小程序仍画目标条，而条上暂停/编辑/清除都经 goalRef（= activeGoal），对 complete 会静默失效（appModel.ts:711-743）。影响大；建议改用 store.activeGoal。

### C-26 目标菜单项未按 phase 收口
- 安卓依据：ComposerBar.kt:742-752 只对 goalPhaseAction(goal.phase) 非空才渲染暂停/恢复项；model/GoalPhaseAction.kt:15-19："active" -> PAUSE, "paused" -> RESUME, else -> null（blocked/complete 都不给）。
- 小程序现状：composerBar.tsx:278-301 openMenu 无条件 itemList[0] = goal.phase === 'paused' ? Strings.goalResume : Strings.goalPause；appModel.ts:721-729 非 paused 一律发 goalPause。
- 类型：行为不同（重要）
- 影响与建议：blocked（以及被 C-25 带出来的 complete）上会给出「暂停目标」，主机必回 GOAL_INVALID_TRANSITION。影响大；建议照抄 goalPhaseAction 映射，null 就不渲染该项。

### C-27 目标编辑弹窗形态不同
- 安卓依据：ComposerBar.kt:765-781 AlertDialog + OutlinedTextField(objectiveDraft, ..., label = Text(Strings.goalObjective))，按钮 Strings.submit/Strings.cancel。
- 小程序现状：composerBar.tsx:283-295 wx.showModal({title: goalEdit, content: goal.objective, editable: true, placeholderText: goalObjective, ...})。
- 类型：交互手势不同
- 影响与建议：等价，仅宿主弹窗样式差异。影响小。

### C-28 队列行分隔线位置不同
- 安卓依据：ComposerBar.kt:856 if (index < queued.size - 1) HorizontalDivider()（仅行间）。
- 小程序现状：composerBar.module.scss:170-176 .queueRow { border-bottom: 1px solid ... }（每一行都有，含最后一行）。
- 类型：视觉不同
- 影响与建议：最后一行多一条贴住输入卡片的线。影响小；可加 .queueRow:last-child { border-bottom: none }。

### C-29 队列编辑弹窗形态不同
- 安卓依据：ComposerBar.kt:859-873 AlertDialog（标题 Strings.queueEdit）+ OutlinedTextField(editDraft, ...)；确认 Strings.submit。
- 小程序现状：composerBar.tsx:332-343 wx.showModal({title: queueEdit, content: queuedItemText(item), editable: true, confirmText: submit, cancelText: cancel})。
- 类型：交互手势不同
- 影响与建议：等价。影响小。

### C-30 队列按钮的 busy 解锁机制不同
- 安卓依据：ComposerBar.kt:799-808 busy 集合在协程 finally 里移除 —— 主机回声（或失败）后才解锁。
- 小程序现状：composerBar.tsx:324-331 run() 立即 setBusy，然后 setTimeout(..., 1200) 固定 1.2s 后解锁。
- 类型：行为不同
- 影响与建议：主机超过 1.2s 未回声仍可能连点；或已回、按钮多锁一会儿。影响中；建议改为动作完成后再解锁。

### C-31 队列动作失败提示口径不同
- 安卓依据：PhoneModel.kt:831-865 queueMutation(..., failure) 只在「用户还能做点什么」时弹提示（queueEditFailed/queueRemoveFailed/queueSteerFailed，Strings.kt:150-152），对 steer-unavailable/queue-item-not-found 静默。
- 小程序现状：appModel.ts:693-699 queueMutation 任何异常一律 lastErrorStore.set(describe(error))；输入区不针对队列动作弹 toast。
- 类型：行为不同 / 文案不同
- 影响与建议：小程序既不区分竞态、也不给显式文案，错误只进全局错误存储。影响中；建议对齐安卓三条文案与「竞态静默」规则。

---

## 六、候选建议与触发 token

### C-32 命令候选来源：主机 commands/list vs 静态内置 4 条
- 安卓依据：PhoneModel.kt:1111-1119 COMMAND 分支 client.commandsList(sessionId) 过滤后 take(8)，带 input?.hint 与 wantsArgs = it.input != null。
- 小程序现状：composerBar.tsx:73-78 BUILTIN_COMMANDS = [compact, plan, permission, goal]；126-139 builtinCommandSuggestions 只在此静态表里过滤、slice(0,8)。rpcMethods.ts:395 commandsList 存在但在 src/ 下无任何调用点（grep 确认）。
- 类型：缺失（重要）
- 影响与建议：主机自带命令（含部署自定义命令）在小程序里无法补全，只能手打。影响大；建议接入 commandsList，主机无该 RPC 时再退回静态表。

### C-33 @ 引用候选缺少「会话引用」
- 安卓依据：PhoneModel.kt:1100-1109 REFERENCE 分支 = fileReferencesList take(8) 再加 sessionReferenceCandidates take(5)，插入 mention 后带空格，标题 it.label。
- 小程序现状：composerBar.tsx:489-497 只 model.loadFileReferences，files.slice(0, 8)；appModel.ts:826-828 仅封装 fileReferencesList；rpcMethods.ts:484 sessionReferenceCandidates 无调用点。
- 类型：缺失
- 影响与建议：无法通过 @ 引用另一个会话。影响中；建议补齐 sessionReferenceCandidates。

### C-34 技能候选的触发方式不同（$ 触发 vs 混在 / 里）
- 安卓依据：PhoneModel.kt:60-77 TriggerToken.parse 只识别 @ 与行首 /，没有 $；技能在 COMMAND 分支里以 $name 形式插入（PhoneModel.kt:1120-1122），即用户打 / 时会同时看到命令与技能。
- 小程序现状：src/state/composer.ts:29-40 activeTrigger 明确支持 head === '$' -> kind: 'skill'；composerBar.tsx:498-510 skillList 单独成候选、slice(0,5)；/ 分支不含技能。
- 类型：行为不同（双向）
- 影响与建议：小程序更符合直觉（$ 触发技能），安卓相反。影响中；需产品拍板，若以小程序为准需同步安卓 TriggerToken 增加 $。

### C-35 触发 token 的定位方式不同（末尾 vs 光标）
- 安卓依据：PhoneModel.kt:64-75 parse(draft) 取 indexOfLast 空白之后的整段，隐含「token 在草稿末尾」；ComposerBar.kt:141-157 用整段草稿解析。
- 小程序现状：composer.ts:29-40 activeTrigger(text, cursor) 从光标向左退到空白，可在正文中间补全；composerBar.tsx:476-482 用 activeTrigger(text, caret)。
- 类型：行为不同
- 影响与建议：小程序支持中间补全，安卓只能末尾补全。影响中；属增强，注意与 pickSuggestion 的区间替换（composerBar.tsx:527-543）保持配套。

### C-36 候选条渲染一致
- 安卓依据：ComposerBar.kt:878-926：max 208dp、标题不压缩、hint 在名称后、subtitle 占满剩余并省略。
- 小程序现状：composerBar.tsx:745-755 + composerBar.module.scss:204-237 .suggestionPanel { max-height: 208px }，结构同为 title/hint/subtitle。
- 类型：无差异（说明）
- 影响与建议：一致，无需改。

---

## 七、底部弹层外壳与各弹层（Sheets）

### C-37 弹层手势：系统 ModalBottomSheet vs 自绘固定面板
- 安卓依据：Sheets.kt:58,286,460,557,636,792 全部用 ModalBottomSheet(onDismissRequest = onDismiss)（系统提供遮罩 + 下拉手势 + 拖拽把手）。
- 小程序现状：sheets.tsx:63-77 Sheet：position: fixed 遮罩，点遮罩 onClose，面板内 stopPropagation；有自绘 handle（sheets.tsx:68），但不支持下拉关闭。
- 类型：交互手势不同
- 影响与建议：下拉关闭缺失、遮罩点击即关。影响中；建议补下滑关闭或缩小遮罩点击区域。

### C-38 弹层标题：安卓多数无标题，小程序统一有标题
- 安卓依据：Sheets.kt:58-71（模型弹层仅在无 efforts 时显示「模型」标题，有 efforts 时用 TabRow 顶替）、Sheets.kt:286（上下文弹层无标题）、Sheets.kt:460（会话面板无标题）。
- 小程序现状：sheets.tsx:391 上下文 title={Strings.context}；:167 会话面板 title={Strings.panel}；:498 模型 title={Strings.model}；:587 归档 title={Strings.archived}；:676 文件预览 title=文件名；:738 审批 title={Strings.approvalTitle}。
- 类型：视觉不同
- 影响与建议：小程序标题栏 + 关闭按钮更清晰。影响小；注意 C-52 的标题重复。

### C-39 会话面板：子智能体行的图标/箭头位置不同
- 安卓依据：Sheets.kt:497-516 ListItem(headline = label ?: sessionId, trailing = if (entry.running) CircularProgressIndicator(14dp) else KeyboardArrowRight)，无 leading。
- 小程序现状：sheets.tsx:204-207 —— 前置图标 entry.running ? 'loader-circle' spin : 'chevron-right'，无尾部。
- 类型：视觉不同
- 影响与建议：语义等价。影响小。

### C-40 子会话 parentAvailable 传错，子会话里「返回父会话」不出现
- 安卓依据：Sheets.kt:499-505 model.openSubagent(sessionId, entry, true)；PhoneModel.kt:1049-1068 store.configureSubagent(address, parentAvailable)。
- 小程序现状：sheets.tsx:153-164 直接 child.configureSubagent({...}, false) —— 第二参写死 false；sessionStore.ts:1076-1079 this.parentAvailable = address === undefined ? false : parentAvailable；会话页据此决定是否显示返回父会话（pages/chat/index.tsx:88,431）。并且 loadSubagents 返回的 parentAvailable（types.ts:333）在面板里被忽略。
- 类型：行为不同（重要）
- 影响与建议：从会话面板进入子智能体后，小程序缺少「返回父会话」入口。影响大；建议传面板拿到的 parentAvailable（或按安卓写 true）。

### C-41 会话面板：产物点击行为不同（电脑打开 vs 内置预览）
- 安卓依据：Sheets.kt:519-527 modifier = Modifier.clickable { model.openOnHost(file.path) }；PhoneModel.kt:1038-1042 api?.hostOpenPath(path)（在电脑上打开）。
- 小程序现状：sheets.tsx:212-224 onClick={() => props.onOpenFile(file.path)}，会话页把它接成内置 FilePreviewSheet（pages/chat/index.tsx:524,529-534）。
- 类型：行为不同
- 影响与建议：同一行点下去两端落到不同地方。影响中；建议统一，若保留预览可补「在电脑上打开」次级入口（小程序已有 Strings.openOnDesktop，strings.ts:141）。

### C-42 会话面板：产物兜底推断（小程序多）
- 安卓依据：Sheets.kt:450-458 只从 store.presentedFiles(candidate) 近 5 轮找，找不到就是空列表。
- 小程序现状：sheets.tsx:141-151 找完 5 轮后若为空，再 turnDeliverablesFor(store.nodes) 从工具参数推断产物。
- 类型：行为不同（小程序多）
- 影响与建议：主机未发 deliverables 事件时仍能列出产物，属增强。影响小。

### C-43 会话面板：后台任务行布局不同
- 安卓依据：Sheets.kt:478-493 ListItem(headline = job.label, supporting = job.detail, trailing = Row { if (job.isLive) CircularProgressIndicator(14dp); Text(job.status.wire) })。
- 小程序现状：sheets.tsx:187-196 前置 jobIsLive(job) ? 'loader-circle' spin : 'circle'，中间 label/detail，尾部 job.status。
- 类型：视觉不同
- 影响与建议：状态语义一致（Models.kt:377 wire = name.lowercase() 与小程序 JobStatus 字面量同为 running/stopping/…，types.ts:306-316）。影响小。

### C-44 会话面板：空态处理一致
- 安卓依据：Sheets.kt:468,478,495,519 每段都 takeIf { isNotEmpty }，空则整段不出现；无整体空态。
- 小程序现状：sheets.tsx:168,184,200,212,227 同样按段隐藏。
- 类型：无差异（说明）
- 影响与建议：一致。

### C-45 上下文弹层：占用抬头呈现不同
- 安卓依据：Sheets.kt:296-321 把 Strings.contextAria 按 %d%% 拆前后两段夹住百分比，右侧 ~used / window；没有环形。
- 小程序现状：sheets.tsx:396-406 64px 圆环（sheets.module.scss:150-173）显示百分比 + fmt(contextAria, percent) + Strings.contextUsed + 已用 ~used / window；sheets.tsx:346 按 percent>=90/70 上 warning/bad 边框色。
- 类型：视觉不同 + 文案不同（小程序多「已用」前缀与颜色阈值）
- 影响与建议：小程序信息更丰富。影响小。

### C-46 上下文弹层：无投影时的空态不同
- 安卓依据：Sheets.kt:296-354 val occupancy = store?.contextOccupancy; if (occupancy != null) { ... } —— 为 null 时什么都不画。
- 小程序现状：sheets.tsx:392-393 Text className={styles.empty}>{Strings.contextOccupancy}，即显示「占用 / Occupancy」两个字。
- 类型：视觉不同 / 文案不同
- 影响与建议：显示一个名词当空态很突兀。影响小；建议改成「暂无占用数据」或直接不显示。

### C-47 上下文弹层：缓存命中率口径不同
- 安卓依据：Sheets.kt:265-271 SessionUsageReading(store.tokenUsage)?.takeIf { it.hasTokens }... sessionCacheHitPercent(usage.cacheRead, usage.billed)；model/SessionUsageReading.kt:53-77「最多 6 位小数、部分命中不许读成整 100」，即 99.94→99.94、全命中→100。
- 小程序现状：sheets.tsx:381 const hit = cacheHitPercent(usage)；model/format.ts:67-77 是单轮口径（固定 1 位小数、cacheRead < prompt 时夹到 99.9）。
- 类型：行为不同 / 文案不同（重要）
- 影响与建议：会话级读数会被四舍五入：99.94% 显示成 99.9%，100% 也显示成 99.9%。影响大（数字误导）；建议小程序补 sessionCacheHitPercent 并在会话面板用它，cacheHitPercent 只留给单轮用量卡（src/ui/messageRow.tsx:559）。

### C-48 上下文弹层：压缩按钮（小程序多）
- 安卓依据：Sheets.kt:355-362 details 之后弹层结束，无任何按钮。
- 小程序现状：sheets.tsx:437-441 底部 neutralButton 调 model.compactContext 并关弹层。
- 类型：行为不同（小程序多）
- 影响与建议：与 C-13 同源。影响小。

### C-49 模型弹层：loading/选择中状态不同
- 安卓依据：Sheets.kt:72-83 — 加载中 CircularProgressIndicator；selecting 时整列 alpha(0.5f) 且 userScrollEnabled = !selecting。
- 小程序现状：sheets.tsx:506-508 加载中显示文案 Strings.statusLoading（strings.ts:193）；475,477-482 只在 pickModel 里 if (selecting) return，没有变暗/禁滚。
- 类型：视觉不同
- 影响与建议：切换模型期间没有任何视觉反馈，列表仍可滚。影响中；建议补半透明/禁用态。

### C-50 模型弹层：失败项（小程序多）
- 安卓依据：Sheets.kt:84-114 只遍历 directory.groups；directory.failures（model/Models.kt:120）未渲染。
- 小程序现状：sheets.tsx:527-532 额外渲染 directory.failures（名称 + message）；:509 还渲染 status==='error' 的 errorText。
- 类型：行为不同（小程序多）
- 影响与建议：小程序能解释「某些 provider 拉不到」。影响小（增强，可保留）。

### C-51 思考强度项：小程序多一行 description
- 安卓依据：Sheets.kt:116-134 effort 行只有 entry.name + 选中勾。
- 小程序现状：sheets.tsx:538-549 额外渲染 effort.description（rowDetail）。
- 类型：视觉不同（小程序多）
- 影响与建议：信息更全。影响小。

### C-52 模型弹层标题重复（小程序）
- 安卓依据：Sheets.kt:60-71 — 有 efforts 时用 TabRow（「模型 / 思考强度」）且不再单独显示「模型」标题。
- 小程序现状：sheets.tsx:498 Sheet title={Strings.model} 与 :500-503 的 tab 行「模型 / 思考强度」同时存在 → 「模型」出现两次。
- 类型：视觉不同
- 影响与建议：影响小；有 efforts 时可把 Sheet 标题去掉或留空。

### C-53 归档弹层：安卓是独立页面，无对应弹层
- 安卓依据：ui/screen/ArchivedSessionsScreen.kt:124,157,209-213（页面标题 Strings.archivedSessions、空态 Strings.noArchived、行内 Strings.unarchiveSession 恢复按钮）。
- 小程序现状：sheets.tsx:565-610 ArchivedSheet：标题 Strings.archived、空态 Strings.noArchived、每行 archiveTitle + Strings.restore。
- 类型：行为不同（结构不同）
- 影响与建议：ui/screen/Sheets.kt 内无归档弹层，属跨区域对照。影响小；恢复文案（Restore/恢复 vs unarchiveSession）建议对照安卓归档页统一（不确定具体英文差异）。

### C-54 文件预览：分页加载方式不同（自动哨兵 vs 手动按钮）
- 安卓依据：Sheets.kt:930-936「底部哨兵：滚到这里就取下一页」!eof -> LaunchedEffect(nextOffset) { loadNextPage() }。
- 小程序现状：sheets.tsx:706-710 必须点「加载更多」（Strings.loadMore，strings.ts:192）才 loadNextPage(false)。
- 类型：交互手势不同
- 影响与建议：阅读长文件成本更高（反复点）。影响中；建议加滚动到底自动加载。

### C-55 文件预览：缺复制能力与关闭方式不同
- 安卓依据：Sheets.kt:854-856, 898 用 CardDetailDialog（ui/component 封装：标题文件名、右上角复制、左上角关闭，见 Sheets.kt:849-853 注释）。
- 小程序现状：sheets.tsx:676-714 只有 Sheet 标题 + 自绘关闭，无复制按钮。
- 类型：缺失
- 影响与建议：无法一键复制文件内容。影响中；建议补复制（wx.setClipboardData）。

### C-56 文件预览：正文与路径显示不同
- 安卓依据：Sheets.kt:898 标题为 pathBasename(path)，正文 MonospaceBlock(text)（Sheets.kt:915），不额外显示完整路径。
- 小程序现状：sheets.tsx:673 标题 = basename，:681 正文前额外一行完整 path（filePath），正文 fileText（等宽 pre-wrap）。
- 类型：视觉不同
- 影响与建议：小程序多显示路径便于定位。影响小。

### C-57 文件预览：加载/空/失败态基本对应
- 安卓依据：Sheets.kt:899-916 首屏失败 → fileUnavailable + 原因 + Strings.retry；未回 → fileLoading；空 → fileEmpty；正文续加载用 spinner。
- 小程序现状：sheets.tsx:682-696 首屏失败/空/加载同文案；:697-705 续加载用 Strings.statusLoading、失败给 errorText + 重试。
- 类型：文案不同（小）
- 影响与建议：语义一致，仅「续加载」文案一处不同。影响小。

### C-58 审批弹层：结构一致，缺震动
- 安卓依据：Sheets.kt:544-601：标题 Strings.approvalTitle、理由或 fmt(Strings.approvalEscalation, toolName)、toolName、command?.let { MonospaceBlock(it) }、Approve once / Deny（Strings.kt:229-230），点击时 haptics.performHapticFeedback(LongPress)（:581,:589）。
- 小程序现状：sheets.tsx:720-756 同结构同文案；respond 无震动。
- 类型：缺失（反馈）
- 影响与建议：仅触感差异。影响小。

### C-59 提问弹层：header 重复显示
- 安卓依据：Sheets.kt:638-654 弹层没有标题（注释 Sheets.kt:639-640：不再重复「提问」标题），header 只作为 labelMedium kicker 出现一次。
- 小程序现状：sheets.tsx:836 Sheet open title={item.header ?? ''}（Sheet header 显示一次），:839-841 body 里 Text className={styles.questionKicker}>{item.header} 再显示一次。
- 类型：视觉不同（重要）
- 影响与建议：有 header 的题会看到两遍同样文字；无 header 时 Sheet 头部留一条空白标题栏。影响大；建议 title 留空或去掉 body 的 kicker。

### C-60 提问弹层：多选项选中态完全不可见
- 安卓依据：Sheets.kt:695-702 leadingContent = { if (item.multiSelect == true) Checkbox(checked = picked, onCheckedChange = null) else RadioButton(selected = picked, onClick = null) } —— 勾选态真实反映 picked。
- 小程序现状：sheets.tsx:858-859 const multi = item.multiSelect === true; Icon name={multi ? 'square-check' : picked ? 'circle-dot' : 'circle'} —— 多选永远画 square-check，不区分 picked。
- 类型：行为不同 / 视觉不同（重要）
- 影响与建议：多选题用户无法判断自己选了哪些、也看不到取消选中。影响大；建议 multi ? (picked ? 'square-check' : 'square') : ...。

### C-61 提问弹层：detail 未渲染 Markdown
- 安卓依据：Sheets.kt:673 item.detail?...let { MarkdownText(it) }。
- 小程序现状：sheets.tsx:851 Text className={styles.detailText}>{item.detail}（纯文本，sheets.module.scss:509-515 仅 pre-wrap）。
- 类型：缺失
- 影响与建议：detail 里的 Markdown 语法会原样显示。影响中；建议接入小程序已有的 Markdown 渲染能力。

### C-62 提问弹层：自填输入框形态不同
- 安卓依据：Sheets.kt:705-718 OutlinedTextField(..., maxLines = 4, enabled = !busy, label = if (item.options.isNullOrEmpty()) questionCustomPlaceholder else answerCustom)。
- 小程序现状：sheets.tsx:871-877 Textarea ... placeholder={...} maxlength={-1}，无 maxLines、无 disabled。
- 类型：视觉不同
- 影响与建议：等价。影响小；建议补 disabled={busy}。

### C-63 提问弹层：换题时滚动不复位
- 安卓依据：Sheets.kt:622 LaunchedEffect(flow.index) { scroll.scrollTo(0) }。
- 小程序现状：sheets.tsx:801-914 无换题滚动复位逻辑（Sheet body 的 ScrollView 由 sheets.tsx:73 承载）。
- 类型：行为不同
- 影响与建议：长题切到下一题会停在上一题的滚动位置。影响小；建议 scrollTop 复位。

### C-64 提问弹层：右上角关闭的两个 X 语义不同
- 安卓依据：Sheets.kt:655-664 唯一的关闭按钮执行 model.cancelQuestion(question)（放弃整组问题，contentDescription = Strings.questionCancel）。
- 小程序现状：sheets.tsx:836 Sheet open title=... onClose={props.onClose} —— Sheet 头部 X 只调 props.onClose（会话页 = store.setQuestion(undefined)，pages/chat/index.tsx:539），不通知主机；body 内 :844-848 的 X 才 model.cancelQuestion。
- 类型：行为不同
- 影响与建议：点头部 X 会让问题在本地消失而主机仍处待答状态；两个 X 外观相同、行为不同，易误用。影响中；建议头部 X 也走 cancelQuestion，或去掉其中一个。

### C-65 计划评审：正文未渲染 Markdown
- 安卓依据：Sheets.kt:804 Column(...) { MarkdownText(review.plan) }。
- 小程序现状：sheets.tsx:777 Text className={styles.planBody}>{review.plan}（sheets.module.scss:564-572 仅 pre-wrap）。
- 类型：缺失
- 影响与建议：计划正文的 Markdown（标题/列表/代码块）以原文显示。影响中；同 C-61。

### C-66 计划评审：按钮与文案一致
- 安卓依据：Sheets.kt:812-838：questionPlanDiscuss（去聊天里说，cancelQuestion）、questionPlanDecline（修改，reviseAnswer(notes)）、questionPlanApprove/WithNotes（submitAnswer(notes)）；Strings.kt:281-286。
- 小程序现状：sheets.tsx:785-795 同三按钮、同条件（notes.trim().length === 0 ? approve : approveWithNotes）；questionFlow.ts:46-58 的 planReviewApprove/ReviseAnswer 与安卓 Frames.kt:71-80 逐字段一致。
- 类型：无差异（说明）
- 影响与建议：一致，无需改。

### C-67 提问弹层：验证文案与位置一致
- 安卓依据：Sheets.kt:725-735 UNANSWERED/INCOMPLETE 在按钮行上方、colorScheme.error；Strings.kt:276-278。
- 小程序现状：sheets.tsx:879-880 同位置同文案（key 与安卓同名）。
- 类型：无差异（说明）
- 影响与建议：一致。

---

## 八、QuestionFlow 纯逻辑对照

### C-68 questionFlow 逐函数等价
- 安卓依据：model/QuestionFlow.kt:11-133（answered/completed、choose/chooseSettlingBatch/setCustom/skip/continueFlow/validateForSubmission/answers、isFirst/isLast/previous/next）。
- 小程序现状：src/model/questionFlow.ts:91-224 同名同语义函数集合，逐条核对：
  - answered = selected.isNotEmpty() || custom.isNotBlank() ↔ questionDraftAnswered（selected.length>0 || custom.trim().length>0）；
  - choose 单选重置 custom、多选 toggle、非末题顺势前进（QuestionFlow.kt:50-63 ↔ questionFlow.ts:146-163）；
  - chooseSettlingBatch 仅「末题且单选」落地（QuestionFlow.kt:70-75 ↔ questionFlow.ts:165-170）；
  - skip 末题走提交校验（QuestionFlow.kt:90-96 ↔ questionFlow.ts:186-193）；
  - validateForSubmission 跳到第一道未完成题（QuestionFlow.kt:109-116 ↔ questionFlow.ts:206-210）；
  - answers（skipped→空、单选有 custom 时清空 selected、多选保留 selected）（QuestionFlow.kt:119-132 ↔ questionFlow.ts:213-223）。
- 类型：无差异（说明）
- 影响与建议：逻辑层无差异，问题都在 UI 层（C-59～C-65）。无需修改。

### C-69 小程序多导出未使用的 planReviewSubmitAnswer
- 安卓依据：安卓无对应独立函数（Frames.kt:71-74 submitAnswer 在 PlanReviewFlow 上）。
- 小程序现状：questionFlow.ts:56-58 planReviewSubmitAnswer 定义后未被 sheets.tsx 导入使用（sheets.tsx:27-29 只导入 approve/revise）。
- 类型：行为不同（代码层面，无用户可见影响）
- 影响与建议：不影响用户；后续计划评审若改走该函数可消除重复分支（sheets.tsx:766-774）。影响小。

---

## 九、无障碍、反馈与主题

### C-70 无障碍标签：安卓有 contentDescription，小程序 Icon 无
- 安卓依据：ComposerBar.kt:385,403（Stop/Send）、:832,843,854（队列 edit/steer/remove）、:655-663,742-764（提问关闭/上一题/下一题）；Sheets.kt:663,748,761 等。
- 小程序现状：src/ui/icon.tsx:13-29 Icon 只渲染 Text 私有区字形，无 aria-label/role；调用处（如 composerBar.tsx:860-881、sheets.tsx:844-848）也没有可访问名。
- 类型：缺失（无障碍）
- 影响与建议：读屏用户无法识别这些纯图标按钮。影响中；建议给 Icon 增加 ariaLabel。微信端读屏实际暴露行为未验证（不确定）。

### C-71 图标语义映射不同（信息行与状态图标）
- 安卓依据：ComposerBar.kt:244 子智能体用 Icons.Default.Group；:245 拒绝用 WarningAmber；:247 历史错误用 ErrorOutline；:653 待办标题用 Checklist。
- 小程序现状：composerBar.tsx:757 name='users'；:758 'triangle-alert'；:759 'circle-alert'；:227 'square-check'。
- 类型：视觉不同
- 影响与建议：语义相近，无功能差异。影响小。

### C-72 token 胶囊主色写死不随主题
- 安卓依据：ComposerBar.kt:449-450 token 文字 MaterialTheme.colorScheme.primary、底 primary.copy(alpha = 0.12f)。
- 小程序现状：composerBar.module.scss:251-262 background: rgba(28, 100, 242, 0.12)、color: dsh.$color-primary。
- 类型：视觉不同
- 影响与建议：底色写死为固定蓝，换主题时可能与 primary 不一致。影响小；建议改用主题变量 + alpha。

---

## 十、边界情况

### C-73 空会话 / 未打开会话的输入区
- 安卓依据：ComposerBar.kt:85,175-179,221-223,373-376 大量 store?.xxx 判空（store 为 null 时所有条与环形隐藏，仍能输入与发送）。
- 小程序现状：composerBar.tsx:401 const store = React.useMemo(() => model.ensureSession(sessionId), ...) —— 幂等建 store，必然非 undefined；各 Store 初始为空。
- 类型：行为不同（实现层面）；用户可感知差异：不确定
- 影响与建议：小程序靠空 Store 达到同样「不显示」，结论应等价；未发现可感知差异。

### C-74 失败轮次 / historyError 展示一致
- 安卓依据：ComposerBar.kt:246-248 store?.historyError?.message?.let { InfoLine(ErrorOutline, it, error) }。
- 小程序现状：composerBar.tsx:759 {historyError === undefined ? null : InfoLine name='circle-alert' text={historyError.message} tone='bad' }。
- 类型：无差异（说明）
- 影响与建议：一致。

### C-75 多工作区 / 子智能体
- 安卓依据：输入区本身不出现工作区概念（工作区在新建会话页与列表）；子智能体仅通过 subagentAddress 决定 takeover 文案与发送目标（ComposerBar.kt:176-178,184-195）。
- 小程序现状：同（composerBar.tsx:712-718, 569-581）。
- 类型：无差异（说明）
- 影响与建议：多工作区在 C 区不涉及；子智能体差异集中在 C-40。

### C-76 主机无 commands/list / skillList 时的退化
- 安卓依据：PhoneModel.kt:1113-1114 runCatching { ... }.getOrDefault(emptyList())，失败即空候选。
- 小程序现状：composerBar.tsx:488-517 异步取文件/技能失败 .catch(() => [])，而命令永远有 4 条静态兜底。
- 类型：行为不同
- 影响与建议：无主机命令时仍有 4 条内置候选，可能是「幽灵命令」（部署不支持 /goal、/permission 时会插入并发送失败）。影响中；建议以主机命令表为准，仅在拉取失败时兜底。

---

## 十一、不确定项（未臆测）

1. wx.showActionSheet 的 itemList 真实上限是否确为 6、以及「再显示 N 个」的分页体验：代码注释如此声明（composerBar.tsx:80-81），未在微信真机验证。不确定。
2. wx.chooseMessageFile 是否只能取聊天文件、是否存在其他本机文件选择能力：未验证。不确定。
3. 小程序 Icon（纯 Text 字形）在微信读屏下的实际可访问性暴露：未验证。不确定。
4. 安卓 ArchivedSessionsScreen 的具体按钮文案（unarchiveSession）与小程序 Strings.restore（Restore/恢复）是否完全一致：未逐字比对，仅确认结构不同。不确定。
5. 小程序 setup 中 modeSelectionEnabled/pickerEnabled 是否在别处（如新建会话页）已被消费并影响输入区：本报告只确认输入区预设入口未消费该字段。不确定。

---

## 十二、汇总

- 条目总数：76 条（C-01～C-76）。
- 真实差异：67 条；另 9 条为确认一致项（C-04、C-24、C-36、C-44、C-66、C-67、C-68、C-74、C-75）。

| 影响 | 条数 | 编号 |
| --- | --- | --- |
| 大 | 8 | C-14、C-25、C-26、C-32、C-40、C-47、C-59、C-60 |
| 中 | 27 | C-03、C-05、C-06、C-09、C-10、C-11、C-12、C-13、C-15、C-18、C-19、C-22、C-30、C-31、C-33、C-34、C-35、C-37、C-41、C-49、C-54、C-55、C-61、C-64、C-65、C-70、C-76 |
| 小 | 32 | C-01、C-02、C-07、C-08、C-16、C-17、C-20、C-21、C-23、C-27、C-28、C-29、C-38、C-39、C-42、C-43、C-45、C-46、C-48、C-50、C-51、C-52、C-53、C-56、C-57、C-58、C-62、C-63、C-69、C-71、C-72、C-73 |

### 最重要的 5 条

1. C-60 多选题选中态完全不可见（sheets.tsx:859 多选恒画 square-check）——用户无法确认选了哪些、也无法取消，直接破坏提问交互。
2. C-59 提问弹层 header 重复显示（sheets.tsx:836 的 Sheet title + :839-841 kicker）——每道带 header 的题都会出现两遍同样文字，无 header 时留空标题栏。
3. C-25/C-26 目标条收口错误（composerBar.tsx:411,728 用 store.goal 未过滤 complete；:278-301 无条件给暂停/恢复）——完成态目标仍显示、blocked/complete 上点暂停必被主机拒绝，条上动作静默失效。
4. C-32 命令候选只剩 4 条静态内置（composerBar.tsx:73-78；commandsList 无调用点）——主机自带命令无法补全，且可能插入部署不认识的 /goal、/permission。
5. C-47 会话级缓存命中率用错口径（sheets.tsx:381 用单轮 cacheHitPercent）——99.94%/100% 都会被显示成 99.9%，数字误导。

附加高危：C-14 输入区模型切换丢失「思考强度」页签（composerBar.tsx:662-682 拉平 action sheet），以及 C-40 子会话 parentAvailable 写死 false（sheets.tsx:156-159）导致子会话缺少「返回父会话」。

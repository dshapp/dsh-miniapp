# 区域 C：输入区（待办条 / 目标条 / 队列 / 权限 / 计划 / 模型 / 附件 / 发送停止键）审计（第三轮）

> 口径：以安卓仓 `/Users/user/dshapp/dsh-androidapp` 当前源码为正确一方；小程序仓 `/Users/user/dshapp/dsh-miniapp` 当前源码为被审对象。
> 方法：逐行读两边当前源码（安卓 ComposerBar.kt 1018 行全读、GoalPhaseAction.kt、QuestionFlow.kt / SessionStore.kt / PhoneModel.kt 相关段；小程序 composerBar.tsx 963 行全读、composerBar.module.scss、state/composer.ts、state/sessionStore.ts 相关段）。docs/ 下历史审计只作线索，不采信其结论。
> 本轮未修改任何源码。

## 概览

| 编号 | 差异一句话 | 安卓位置 | 小程序位置 | 优先级 | 建议 |
| --- | --- | --- | --- | --- | --- |
| C-01 | 新建会话页没有注入 ModelPickerSheet / ContextSheet，模型入口退化为扁平 ActionSheet（无思考强度页签），上下文环点击完全无效 | `ComposerBar.kt:371,415,373-375,416` | `pages/new/index.tsx:105-124`（未传 onOpenModel/onOpenContext）；`ui/composerBar.tsx:752-780,782-785` | P1 | 把 `ModelPickerSheet`/`ContextSheet` 挂到 new 页并注入两个回调；或让 ComposerBar 自带弹层（“未注入即自带”），与安卓一致 |
| C-02 | 子智能体 takeover 提示从输入区消失（安卓在输入卡片正上方一行；小程序挪到聊天页顶部，脱离输入区） | `ComposerBar.kt:176-178,244` | `ui/composerBar.tsx:837`（注释占位）；`pages/chat/index.tsx:505-516` | P1 | 恢复输入区内那行 `InfoLine(Group, takeover)`；页面顶部条可保留为导航入口 |
| C-03 | 命令候选在主机 commands/list 拉取失败时回落静态内置 4 条命令，安卓永不显示内置表 | `PhoneModel.kt:1113-1122`（失败→emptyList） | `ui/composerBar.tsx:79-84,154-158,139-152` | P1 | 删除 `BUILTIN_COMMANDS` 与 `builtinCommandSuggestions`；失败与空表一律返回 `[]` |
| C-04 | 发送键形态不同：安卓是裸 Send 图标（无底色，禁用时变 outline 色）；小程序是主色填充圆钮、白色图标 | `ComposerBar.kt:395-408` | `ui/composerBar.module.scss:442-463`；`ui/composerBar.tsx:948-958` | P1 | 去掉 `.sendButton` 的填充圆底与白字，改为 36px 命中区内的 20px 图标，启用 primary / 禁用 outline |
| C-05 | 上下文占用环被换成“边框圆 + 百分比文字”，没有进度弧；尺寸 30px vs 安卓 32dp 命中区/18dp 弧 | `ComposerBar.kt:596-618` | `ui/composerBar.module.scss:400-414`；`ui/composerBar.tsx:936-940` | P1 | 用 canvas 2d 或 `conic-gradient` 画 18px、2px stroke 的进度弧，外层 32px 命中区；删掉 9px 百分比文字（安卓无文字） |
| C-06 | 目标条 / 队列条没有落地 `stripRowHeight=44dp` 行高（安卓目标条 min 44dp、队列条固定 44dp） | `ComposerBar.kt:726`（goal），`ComposerBar.kt:815`（queue），`Theme.kt:29` | `ui/composerBar.module.scss:137-142,171-177` | P1 | 目标条加 `min-height: 44px`；队列行改为 `height: 44px`（或统一的 `--dsh-strip-row-height`） |
| C-07 | 只读子智能体时小程序把发送键置灰并拦截点击；安卓不置灰（按钮看起来可用，点了才静默返回） | `ComposerBar.kt:179,395-408`（sendDisabled 不含子会话模式） | `ui/composerBar.tsx:796,950-956` | P2 | 按安卓去掉 `readOnlySubagent` 的置灰/拦截（或反过来先改安卓，需产品确认；当前以安卓为准） |
| C-08 | 停止键尺寸：安卓 36dp 按钮内 24dp error 圆（4dp padding）承载 Stop；小程序 34px 红圆 + 14px 白色方块 | `ComposerBar.kt:377-393` | `ui/composerBar.module.scss:426-440`；`ui/composerBar.tsx:941-947` | P2 | 命中区 36px、可见红圆 24px、内部字形约 16px |
| C-09 | 输入卡片垂直内边距 6px（安卓 8dp）；字段与操作行之间缺安卓 `spacedBy(4.dp)`；卡片底色用 `--dsh-color-card`（安卓 `surfaceVariant`） | `ComposerBar.kt:253-258` | `ui/composerBar.module.scss:335-341` | P2 | 卡片 `padding: 8px 12px` + 行间 `gap: 4px`；补一个 surfaceVariant 语义变量映射卡片底色 |
| C-10 | 待办条头部内边距 4px（安卓垂直 6dp），各图标/字号系统性偏小（16dp→14px、18dp→12px、14sp→13px） | `ComposerBar.kt:645-673` | `ui/composerBar.module.scss:60-96`；`ui/composerBar.tsx:288-303` | P2 | 头部 `padding: 6px 0`；图标 16/12/18px，头部文字 14px、计数 12px |
| C-11 | 待办条图标字形不同：安卓 Checklist / CheckCircle / RadioButtonUnchecked / Autorenew；小程序 square-check / check / circle / refresh-cw | `ComposerBar.kt:653,656-658`，`todoIcon:701-705` | `ui/composerBar.tsx:290,284-286,322-326` | P2 | 换用与安卓语义一致的字形（checklist、check-circle、circle、autorenew） |
| C-12 | 队列行图标不同：安卓 Icons.Default.Schedule；小程序 history；操作图标 16dp vs 14px，命中区 32dp vs 约 26px | `ComposerBar.kt:819,824-854` | `ui/composerBar.tsx:427-438`；`ui/composerBar.module.scss:184-206` | P2 | 改 clock 字形；队列操作图标 16px、命中区 32px |
| C-13 | 目标条图标 paused 用 pause（安卓 PauseCircleOutline），文本/更多按钮尺寸偏小，更多按钮无 32dp 命中区 | `ComposerBar.kt:730-739` | `ui/composerBar.tsx:379-381`；`ui/composerBar.module.scss:144-162` | P2 | paused 用 pause-circle；图标 16px、文字 labelLarge 14px、更多按钮 32px/18px |
| C-14 | 候选面板多了一圈边框（安卓只有 surface 底 + 12dp 圆角，无边框），底色语义 surface vs card | `ComposerBar.kt:878-885` | `ui/composerBar.module.scss:210-215` | P2 | 去掉 1px 边框；底色改用与安卓 surface 对应的变量 |
| C-15 | InfoLine 图标 12px（安卓 14dp），且小程序加了 2px 垂直内边距；Android 限 2 行省略，小程序不限制 | `ComposerBar.kt:620-631` | `ui/composerBar.module.scss:23-39`；`ui/composerBar.tsx:263-272` | P2 | 图标 14px、去 `padding: 2px 0`、文本 `max-lines: 2` + ellipsis |
| C-16 | 权限 / 模型 / 计划 / 目标菜单均改为底部 ActionSheet（安卓是锚定在控件下方的 DropdownMenu），且权限项加了 “✓ ” 当前项标记（安卓无标记） | `ComposerBar.kt:340-354,736-740` | `ui/composerBar.tsx:354-375,728-750,752-780` | P2 | 平台取舍可保留，但权限项去掉勾选标记，并考虑用自定义 popup/`nut-popup` 复刻锚定下拉；ActionSheet 分页（>6 项）是平台差异，属额外行为 |
| C-17 | 计划 chip 细节：内边距 3px 8px（安卓 8dp/4dp）、圆角 12px（安卓 CircleShape）、文字 12px（安卓 labelLarge 14sp）、底色 14% vs 安卓 0x22=13.3% | `ComposerBar.kt:356-370` | `ui/composerBar.module.scss:386-398` | P2 | 文字 14px、垂直内边距 4px、圆角 = 高度一半（胶囊）、底色 13% |
| C-18 | 警告 / 待办配色用的 hex 与安卓硬编码不同：安卓固定 `0xFFE08600`（计划、待办 pending、rejection、权限 warn），小程序用 `--dsh-color-warning:#d97706`；待办完成绿安卓 `0xFF2E7D32` vs 小程序 `#16a34a` | `ComposerBar.kt:245,338,360,367-368,657,709` | `ui/composerBar.module.scss:98-108,382-398`；`styles/vars.scss:14-17` | P2 | 增加 `--dsh-color-warn-android:#e08600` 与 `--dsh-color-todo-done:#2e7d32`，或在设计上统一（需产品确认不覆盖安卓口径） |
| C-19 | 输入卡片正文行高 22px（安卓 bodyLarge 24sp）、textarea 高度按 `行数*22+16`（安卓自适应到 6 行）；首行高度 38px vs 约 40dp | `ComposerBar.kt:482-512` | `ui/composerBar.module.scss:343-350`；`ui/composerBar.tsx:799` | P2 | 行高改 24px，高度公式 `行数*24+16`，上限 6 行 |
| C-20 | 加号/回形针图标 17px（安卓加号默认 24dp、回形针 18dp），且缺少 32dp 命中区 | `ComposerBar.kt:299-307` | `ui/composerBar.module.scss:370-374`；`ui/composerBar.tsx:894-917` | P2 | 加号 24px、回形针 18px，各自 32px 命中区 |
| C-21 | 补全触发口径：安卓只认草稿末尾的 token（且草稿以空格/换行结尾时不触发），小程序按光标位置在正文中间也触发；小程序额外增加 `$技能` 触发（安卓只有 @ 与 /） | `PhoneModel.kt:64-75`；`ComposerBar.kt:141-157` | `state/composer.ts:29-40`；`ui/composerBar.tsx:549-600` | P2 | 若以安卓为准：补全只在光标位于草稿末尾且末词为 token 时开启；`$` 触发如确属增强需在产品口径中登记 |
| C-22 | 上下文占用 / 计划状态靠 1s `setInterval` 轮询投影，安卓是状态直读（切换计划模式后 chip 最多延迟 1s 出现） | `SessionStore.kt:245-263`；`ComposerBar.kt:356,373` | `ui/composerBar.tsx:519-530` | P2 | 把 plan/contextPressure 做成可订阅 Store（或每次投影帧后主动刷新），去掉轮询延迟 |
| C-23 | 附件入口：小程序相册选图带 `camera` 来源（安卓 PickMultipleVisualMedia 只有相册）；相册选图附件名恒为 `image`（安卓取 DISPLAY_NAME） | `ComposerBar.kt:119-125,960-968` | `ui/composerBar.tsx:695-710` | P2 | 相册源按安卓去掉 camera；图片名从临时路径取 basename 或让主机侧命名 |
| C-24 | 附件 chip 尺寸不同：小程序自绘 20px 缩略图 + 12px 文字 + 11px 移除键；安卓是 InputChip（16dp 前置图标 + 14dp 关闭键 + 默认高度 32dp，无缩略图） | `ComposerBar.kt:931-956` | `ui/composerBar.module.scss:283-331`；`ui/composerBar.tsx:446-470,853-870` | P2 | 若要贴安卓：chip 高度约 32px、前置图标 16px、关闭 14px；缩略图可保留为增强（需登记） |
| C-25 | token 胶囊条是小程序额外多出的一整行（安卓把 token 底色画在正文里）；点击整颗摘除也是安卓没有的交互 | `ComposerBar.kt:448-512,552-572` | `ui/composerBar.tsx:841-851`；`ui/composerBar.module.scss:247-269` | P2 | 平台取舍；如需收敛可用 WeChat `<editor>` 富文本（可 setContents 带样式 span）尝试内联高亮，或至少压缩为紧贴正文的窄条 |

## 逐条详情

### C-01 新建会话页缺少弹层注入，模型入口退化、上下文环点击无效（P1）

* **证据**
  * 安卓 `ui/screen/ComposerBar.kt:371`：`TextAction(store?.modelDirectory?.current?.model ?: Strings.model) { modelPicker = true }`；`ComposerBar.kt:415`：`if (modelPicker) ModelPickerSheet(model, sessionId) { modelPicker = false }`；`ComposerBar.kt:373-375`：`store?.contextOccupancy?.let { occupancy -> ContextRing(occupancy.percent) { contextSheet = true } }`；`ComposerBar.kt:416`：`if (contextSheet) ContextSheet(model, sessionId) { contextSheet = false }`。两处弹层都定义在 ComposerBar 内部，任何使用它的页面（含 `NewSessionScreen.kt:82`）都自动获得完整能力。
  * 小程序 `ui/composerBar.tsx:752-780`：`openModelPicker` 先 `if (props.onOpenModel !== undefined) { props.onOpenModel(); return; }`，否则把目录拉平成 `group.name + ' · ' + entry.name` 交给 `showChoice`（无思考强度页签）。`ui/composerBar.tsx:782-785`：`openContext = () => { props.onOpenContext?.(); }`——未注入时**什么都不发生**。
  * 小程序 `pages/chat/index.tsx:595-600` 传了 `onOpenContext`/`onOpenModel`；但 `pages/new/index.tsx:105-124` 只传了 `sessionId/autoFocus/header/onSubmitted`，页面里也没有挂 `ModelPickerSheet`/`ContextSheet`（全文 grep 无命中）。安卓 `NewSessionScreen.kt:82-114` 复用同一个 ComposerBar，弹层自然可用。
* **差异** 新建会话页点“模型”得到的是没有思考强度页签的扁平动作单；占用环（只要 `occupancy !== undefined` 就会渲染，见 `ui/composerBar.tsx:936`）点下去无任何反应。安卓两处都是完整 Sheet。
* **建议** 在 `pages/new/index.tsx` 挂 `<ModelPickerSheet open…/>`、`<ContextSheet open…/>` 并注入回调；更稳的做法是让 ComposerBar 在 `props.onOpenModel === undefined` 时自渲染这两个弹层（安卓就是这种“弹层随输入区”的结构），彻底消除宿主漏注入。
* **风险/不确定** 需在微信开发者工具里确认 new 页点模型确实弹出扁平单、点占用环无反应（新建会话可能尚未产生 contextPressure 投影，环可能不显示，但模型入口一定可见）。

### C-02 子智能体 takeover 提示从输入区消失（P1）

* **证据**
  * 安卓 `ComposerBar.kt:176-178`：`val takeover = store?.subagentAddress?.let { if (it.mode == SubagentMode.CONTINUABLE) Strings.subagentComposer else Strings.subagentReadOnly }`；`ComposerBar.kt:244`：`takeover?.let { InfoLine(Icons.Default.Group, it, MaterialTheme.colorScheme.onSurfaceVariant) }`——位置在候选面板之后、附件条之前，**属于输入区的一部分**。
  * 小程序 `ui/composerBar.tsx:837`：`{/* 子会话的 takeover 文案已经由聊天页顶部的子会话条显示，这里不再重复一遍（D3）。 */}`；实际渲染在 `pages/chat/index.tsx:505-516`（`styles.subagentBar`，位于转写区上方、页面顶部）。
* **差异** 文案内容一致，但**位置**从“贴着输入框的一行”变成“页面顶端常驻条”；安卓只在输入区出现一次。结果：键盘弹起时安卓的提示紧跟输入框，小程序的提示可能被滚走的转写顶到远处；且 new 页/任何没有 `subagentAddress` 的场景二者都无（此点等价）。
* **建议** 恢复输入区内的 `InfoLine(name='users', text=takeover, tone='sub')`（Android 用 Group 图标），页面顶部条保留为导航入口（“返回父会话”是安卓没有的增强，需登记）。
* **风险/不确定** 无；位置差异肉眼可验。

### C-03 命令候选失败时回落静态内置表（P1）

* **证据**
  * 安卓 `state/PhoneModel.kt:1111-1122`：`val commands = runCatching { client.commandsList(sessionId) }.getOrDefault(emptyList())`，随后 `commands.filter { … }.take(8)`；失败与空表都无法产生任何候选，全仓不存在内置命令表。
  * 小程序 `ui/composerBar.tsx:79-84` 定义 `BUILTIN_COMMANDS = [compact, plan, permission, goal]`；`ui/composerBar.tsx:158`：`if (commands === undefined) return builtinCommandSuggestions(query, leading);`；调用点 `ui/composerBar.tsx:588`：`const commands = await model.loadCommands(sessionId).catch(() => undefined);` `state/appModel.ts:1066-1068` 直接透传 `commandsList`。
* **差异** 主机没有 commands/list（老版本）或该 RPC 抛错时，小程序会插入主机可能根本不认识的 `/permission`、`/goal` 等“幽灵命令”；安卓此时什么也不显示。
* **建议** 删除 `BUILTIN_COMMANDS`、`builtinCommandSuggestions` 与 `hostCommandSuggestions` 中的 `undefined` 分支，让 `commands === undefined || commands.length === 0` 都返回 `[]`（保留技能候选）。
* **风险/不确定** 需确认目标主机版本都有 commands/list；若产品明确要“无表也能补全”，应记入增强清单而非默认行为。

### C-04 发送键形态：填充主色圆钮 vs 裸图标（P1）

* **证据**
  * 安卓 `ComposerBar.kt:395-408`：`IconButton(onClick = { send() }, enabled = !sendDisabled, modifier = Modifier.size(36.dp)) { Icon(Icons.AutoMirrored.Filled.Send, Strings.send, Modifier.size(20.dp), tint = if (sendDisabled) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.primary) }`——**没有任何 background**，就是 36dp 框里一颗 20dp 主色/禁用 outline 的图标。
  * 小程序 `ui/composerBar.module.scss:442-458`：`.sendButton { min-width:34px; height:34px; padding:0 10px; border-radius:17px; background: var(--dsh-color-primary); … }`、`.sendDisabled { background: var(--dsh-color-border); }`；`ui/composerBar.module.scss:460-463`：`.sendLabel { font-size:15px; color:#ffffff; }`；`ui/composerBar.tsx:948-958` 用 `styles.sendButton/sendDisabled/sendLabel`。
* **差异** 安卓是“无底色图标按钮”，小程序是“实心主色胶囊/圆钮 + 白图标”。这是输入区最显眼的一处形态差异；同时禁用态由“图标变 outline 色”变成“底色变灰、图标仍白”。
* **建议** 去掉 `.sendButton` 的 `background/border-radius/padding`，改为 `width:36px;height:36px` 居中；图标 20px，`color: var(--dsh-color-primary)`，禁用态 `color: var(--dsh-color-text-faint)`、不设底色。
* **风险/不确定** 无；纯 CSS。

### C-05 上下文占用环：文字百分比 vs 进度弧（P1）

* **证据**
  * 安卓 `ComposerBar.kt:596-618`：`Box(Modifier.size(32.dp).clip(CircleShape).clickable(onClick)) { Canvas(Modifier.size(18.dp)) { drawCircle(track, style = Stroke(2.dp)); drawArc(progress, startAngle=-90f, sweepAngle=360f*percent/100, …) } }`——32dp 命中区、18dp 弧、2dp 描边、**无任何文字**；track=outlineVariant，progress=onSurfaceVariant。
  * 小程序 `ui/composerBar.module.scss:400-414`：`.contextRing { width:30px;height:30px;border-radius:15px;border:2px solid var(--dsh-color-text-sub); … } .contextRingText { font-size:9px; … }`；`ui/composerBar.tsx:936-940` 渲染 `{occupancy + '%'}`。
* **差异** 小程序画的是“整圈实线边框 + 中间 9px 百分比文字”，完全丢失安卓的进度比例信息（整圈看起来永远 100%）；尺寸也差 2px。
* **建议** 目标数值：外层 `32px` 命中区，内部 `18px` 环、`2px` 描边，`startAngle=-90deg`，`sweepAngle=3.6*percent`。实现手段：WeChat `<canvas type="2d">`（基础库 2.9.0+ 已可用）画 track+arc；或 CSS `background: conic-gradient(...)` 加遮罩（兼容性需按基础库版本验证）。删掉百分比文字（安卓没有）。
* **风险/不确定** `conic-gradient` 在部分微信 WebView/旧基础库不稳定；canvas 2d 在滚动列表中需注意节点查询时机。需真机/开发者工具验证。

### C-06 目标条 / 队列条缺 stripRowHeight（P1）

* **证据**
  * 安卓 `ui/theme/Theme.kt:29-31`：`val stripRowHeight = 44.dp; val stripSpacing = 8.dp`；`ComposerBar.kt:723-729`：`Row(Modifier.fillMaxWidth().heightIn(min = Dimens.stripRowHeight), … horizontalArrangement = Arrangement.spacedBy(Dimens.stripSpacing))`；`ComposerBar.kt:812-818`：`Row(Modifier.fillMaxWidth().height(Dimens.stripRowHeight), … Arrangement.spacedBy(Dimens.stripSpacing))`。
  * 小程序 `ui/composerBar.module.scss:137-142`：`.goalBar { gap:8px; padding:4px 0; }`（无 min-height）；`ui/composerBar.module.scss:171-177`：`.queueRow { gap:8px; padding:5px 0; border-bottom:1px solid …; }`（无 44px）。
* **差异** 安卓两类行都锁定 44dp 高，小程序只有内容高度（约 22–28px）。这会让控制行整体高度和垂直节奏明显矮于安卓，触控行也偏窄。
* **建议** 增加统一变量 `--dsh-strip-row-height: 44px`：`.goalBar { min-height:44px; }`、`.queueRow { height:44px; }`；待办头部安卓没有 44dp 约束（只 `padding(vertical=6.dp)`），不要误加。
* **风险/不确定** 44px 行高在小屏 + 多条队列时更占空间，但这是安卓口径。

### C-07 只读子智能体的发送键禁用态（P2）

* **证据**
  * 安卓 `ComposerBar.kt:179`：`val sendDisabled = (draft.text.isBlank() && attachments.isEmpty()) || rejection != null`——不含子会话模式；`ComposerBar.kt:399`：`enabled = !sendDisabled`；`ComposerBar.kt:184-187`：`send()` 里 `if (address.mode != SubagentMode.CONTINUABLE) return`。所以只读子会话下按钮外观仍是可用（primary），点了才静默无效。
  * 小程序 `ui/composerBar.tsx:796`：`const readOnlySubagent = subagentAddress !== undefined && subagentAddress.mode !== 'continuable';`；`ui/composerBar.tsx:950-956`：`className={styles.sendButton + (sendDisabled || readOnlySubagent ? ' ' + styles.sendDisabled : '')}` 且 `onClick` 里 `if (!sendDisabled && !readOnlySubagent) void send();`；图标用 `styles.sendLabelOff`（12px、text-faint）。
* **差异** 小程序把只读子会话的发送键置灰并阻止点击；安卓保持可用外观但不产生动作。
* **建议** 以安卓为准：不做 `readOnlySubagent` 的特殊样式与拦截（保留 `send()` 内部早退即可）。若认为禁用更好，需作为“分歧·小程序更优”登记，而不是静默保留。
* **风险/不确定** 无。

### C-08 停止键尺寸（P2）

* **证据**
  * 安卓 `ComposerBar.kt:376-393`：`IconButton(modifier = Modifier.size(36.dp)) { Icon(Icons.Default.Stop, Strings.stop, Modifier.size(24.dp).clip(CircleShape).background(error).padding(4.dp), tint = onError) }`→ 36dp 命中区，红色可见圆直径 24dp，内部白色方块约 16dp。
  * 小程序 `ui/composerBar.module.scss:426-440`：`.stopButton { width:34px;height:34px;border-radius:17px;background: var(--dsh-color-bad); … } .stopGlyph { font-size:14px; color:#ffffff; }`。
* **差异** 红圆安卓 24dp、小程序 34px（大一圈）；命中区 36dp vs 34px；图标 16dp vs 14px。
* **建议** `.stopButton { width:36px;height:36px; background:transparent; }` + 内层 24px 红圆承载 16px 白方块。
* **风险/不确定** 无。

### C-09 输入卡片内边距 / 行间距 / 底色（P2）

* **证据**
  * 安卓 `ComposerBar.kt:253-258`：`Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(22.dp)).padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp))`；字段自身 `ComposerBar.kt:482-486` `Box(Modifier.padding(horizontal=4.dp, vertical=8.dp))`。
  * 小程序 `ui/composerBar.module.scss:335-341`：`.card { display:flex; flex-direction:column; padding:6px 12px; border-radius:22px; background: var(--dsh-color-card); }`；字段 `ui/composerBar.module.scss:343-350` `padding:8px 4px`。
* **差异** 卡片垂直内边距 6px vs 8dp；安卓字段与操作行之间有 `spacedBy(4.dp)`，小程序没有（仅靠 textarea 的 8px 下内边距）；底色安卓 surfaceVariant，小程序 card（浅色下 card=#ffffff，安卓 surfaceVariant 是带色调的浅灰，见 `styles/vars.scss:22` / `styles/theme.scss:22`）。
* **建议** `.card { padding: 8px 12px; gap: 4px; }`；新增 `--dsh-color-surface-variant` 并让卡片用它（浅/深主题各一档，避免卡片与页面底色的明暗关系与安卓相反）。
* **风险/不确定** 需对比真机截图确认 surfaceVariant 与 card 的实际观感差异。

### C-10 待办条头部与图标尺寸（P2）

* **证据**
  * 安卓 `ComposerBar.kt:645-652`：头部 Row `.padding(vertical = 6.dp)`、`spacedBy(8.dp)`；`ComposerBar.kt:653` Checklist 16dp；`ComposerBar.kt:656-658` 分组图标 12dp；`ComposerBar.kt:667` 头部文本 `bodyMedium`（M3 默认 14sp）；`ComposerBar.kt:669-672` 箭头 18dp。
  * 小程序 `ui/composerBar.module.scss:60-96`：`.stripHeader { padding:4px 0; gap:8px; } .stripGlyph { font-size:14px; } .stripDot { font-size:11px; } .stripCount { font-size:11px; } .stripTitle { font-size:13px; } .stripChevron { font-size:12px; }`。
* **差异** 垂直内边距 4 vs 6；图标 14/11/12 vs 16/12/18；字号 13 vs 14。
* **建议** `padding:6px 0`；Checklist 16px、分组图标 12px、箭头 18px、头部文字 14px、计数 12px。
* **风险/不确定** 无。

### C-11 待办条图标字形（P2）

* **证据**
  * 安卓 `ComposerBar.kt:653`：`Icon(Icons.Default.Checklist, null, Modifier.size(16.dp))`；`ComposerBar.kt:656-658`：`CheckCircle / RadioButtonUnchecked / Autorenew`；`ComposerBar.kt:701-705`：`todoIcon` 映射同名字形。
  * 小程序 `ui/composerBar.tsx:290`：`<Icon name='square-check' …/>`；`ui/composerBar.tsx:284-286`：`'check' / 'circle' / 'refresh-cw'`；`ui/composerBar.tsx:322-326`：`todoStatusIcon`。
* **差异** 头部图标用“方框打勾”而非“清单”，完成态用单勾而非 check-circle，进行态 refresh-cw 与 Autorenew 语义近但字形不同。
* **建议** 换用与安卓一致的语义字形（lucide：`list-checks`、`circle-check`、`circle`、`refresh-cw`），并在 `lucideIcons.ts` 补齐缺的字形。
* **风险/不确定** 需确认图标子集是否已含这些字形。

### C-12 队列行图标与操作键尺寸（P2）

* **证据**
  * 安卓 `ComposerBar.kt:819-820`：`Icon(Icons.Default.Schedule, null, Modifier.size(16.dp), onSurfaceVariant)`；`ComposerBar.kt:824-854`：编辑/插队/撤回三个 `IconButton(modifier = Modifier.size(32.dp))`，图标 `Schedule/Edit/Send/Close` 各 16dp；禁用插队 tint `outline.copy(alpha=0.6f)`。
  * 小程序 `ui/composerBar.tsx:427-438`：`<Icon name='history' …/>`、`'pencil'`、`'send'`、`'x'`；`ui/composerBar.module.scss:184-206`：`.queueGlyph{font-size:13px} .queueAction{font-size:14px; padding:0 6px} .queueActionOff{color:text-faint}`。
* **差异** 时钟字形不同（Schedule vs history），行首图标 16dp vs 13px，操作图标 16dp vs 14px，命中区 32dp vs 约 26px；禁用色 text-faint vs outline@60%。
* **建议** 行首改 `clock`；操作图标 16px + 32px 命中区；禁用色对齐 outline-60%（可加 `--dsh-color-outline-60`）。
* **风险/不确定** 无。

### C-13 目标条图标与尺寸（P2）

* **证据**
  * 安卓 `ComposerBar.kt:723-739`：`heightIn(min=44.dp)`、`spacedBy(8.dp)`；`Icon(if (goal.phase == "paused") Icons.Default.PauseCircleOutline else Icons.Default.Flag, null, Modifier.size(16.dp))`；文本 `labelLarge`；`IconButton(Modifier.size(32.dp)) { Icon(Icons.Default.MoreHoriz, null, Modifier.size(18.dp)) }`。
  * 小程序 `ui/composerBar.tsx:379`：`<Icon name={goal.phase === 'paused' ? 'pause' : 'flag'} …/>`；`ui/composerBar.module.scss:144-162`：`.goalGlyph{font-size:13px} .goalText{font-size:13px} .goalMore{font-size:16px; padding:0 4px}`。
* **差异** paused 图标是“暂停条”而非“圆内暂停”；图标 13 vs 16px；文字 13 vs 14；更多键 16px/无 32dp 命中区 vs 18dp/32dp。
* **建议** paused 用 `pause-circle`；图标 16px、文字 14px、更多键 32px 命中区内 18px 图标（与 C-06 的 44px 行高一起做）。
* **风险/不确定** 无。

### C-14 候选面板边框与底色语义（P2）

* **证据**
  * 安卓 `ComposerBar.kt:878-885`：`Column(Modifier.fillMaxWidth().heightIn(max = 208.dp).background(MaterialTheme.colorScheme.surface, RoundedCornerShape(12.dp)).verticalScrollSafe())`——**无边框**。
  * 小程序 `ui/composerBar.module.scss:210-215`：`.suggestionPanel { max-height:208px; background: var(--dsh-color-card); border-radius: var(--dsh-radius-card); border:1px solid var(--dsh-color-border); }`。
* **差异** 多一圈 1px 边框；底色用 card（白）而非安卓 surface。行内边距 10px 16px / gap 8px 与安卓 `padding(horizontal=16.dp, vertical=10.dp)` + `spacedBy(8.dp)` 一致（这部分已对齐）。
* **建议** 去掉边框；底色改用与安卓 surface 对应的变量。
* **风险/不确定** 无。

### C-15 InfoLine 尺寸与行数（P2）

* **证据**
  * 安卓 `ComposerBar.kt:620-631`：`Row(Modifier.fillMaxWidth(), spacedBy(6.dp))`；`Icon(icon, null, Modifier.size(14.dp), tint)`；`Text(text, style = labelMedium, color = tint, maxLines = 2, overflow = Ellipsis)`；无垂直内边距。
  * 小程序 `ui/composerBar.module.scss:23-39`：`.infoLine { gap:6px; padding:2px 0; } .infoGlyph { font-size:12px; } .infoText { font-size:12px; line-height:1.4; }`；`ui/composerBar.tsx:263-272` 无行数限制。
* **差异** 图标 12 vs 14；多了 2px 垂直内边距；缺少 2 行省略。
* **建议** 图标 14px、去 `padding:2px 0`、文本加 `display:-webkit-box; -webkit-line-clamp:2; overflow:hidden`（Taro 下确认 WXSS 生效）。
* **风险/不确定** `-webkit-line-clamp` 在小程序 WebView 可用性需验证。

### C-16 菜单形态与权限勾选（P2）

* **证据**
  * 安卓：权限 `ComposerBar.kt:340-354` `DropdownMenu` 锚定在 `TextAction` 所在 `Box` 内，`DropdownMenuItem(text = { Text(permissionTitle(option.value, option.name)) })`——**无勾选**；模型 `ComposerBar.kt:736-740` 目标菜单同为锚定 `DropdownMenu`。
  * 小程序：权限 `ui/composerBar.tsx:728-750` 走 `showChoice` → `wx.showActionSheet`，label 前缀 `(option.value === currentValue ? '✓ ' : '')`；目标 `ui/composerBar.tsx:354-375`、附件 `ui/composerBar.tsx:913-916`、模型兜底 `ui/composerBar.tsx:779` 都是 ActionSheet；`ACTION_SHEET_PAGE = 6`（`ui/composerBar.tsx:87-112`）超出分页。
* **差异** 弹层形态从锚定下拉变底部动作单（可接受的平台取舍），但权限项多出安卓没有的 “✓ ” 当前项标记；ActionSheet 的 6 项分页是安卓没有的行为。
* **建议** 去掉权限项的 `'✓ '` 前缀以贴安卓；若想复刻锚定下拉，可用 `nut-popup`/自绘常驻列表。分页作为平台限制登记，并写明 wx.showActionSheet 的 6 项上限。
* **风险/不确定** 微信 `wx.showActionSheet` 的 itemList 上限确实为 6（官方文档），分页逻辑正确，只是与安卓不同。

### C-17 计划 chip 细节（P2）

* **证据**
  * 安卓 `ComposerBar.kt:356-370`：`Row(Modifier.clip(CircleShape).background(Color(0x22E08600)).clickable { setPlanMode(false) }.padding(horizontal=8.dp, vertical=4.dp), spacedBy(3.dp))`；`Text(Strings.planMode, style = labelLarge, color = Color(0xFFE08600))`；`Icon(Icons.Default.Close, null, Modifier.size(12.dp), Color(0xFFE08600))`。
  * 小程序 `ui/composerBar.module.scss:386-398`：`.planChip { gap:3px; padding:3px 8px; border-radius:12px; background: rgba(224,134,0,0.14); } .planChipText { font-size:12px; color: var(--dsh-color-warning); }`。
* **差异** 垂直内边距 3 vs 4；圆角 12px vs 全胶囊；文字 12 vs 14(labelLarge)；底色 alpha 0.14 vs 0x22≈0.133；文字色 warning(#d97706) vs 0xFFE08600。
* **建议** `padding:4px 8px; border-radius:999px; font-size:14px;` 底色 13%。
* **风险/不确定** 无。

### C-18 颜色值不对齐（P2）

* **证据**
  * 安卓硬编码 `Color(0xFFE08600)`：rejection InfoLine `ComposerBar.kt:245`、权限 warn `ComposerBar.kt:338`、计划 chip `ComposerBar.kt:360,367-368`；待办 pending/active/done `ComposerBar.kt:656-658,708-712`（done = `0xFF2E7D32`）。
  * 小程序 `ui/composerBar.module.scss:98-108`：`.todoDone{color:var(--dsh-color-good)} .todoActive{color:var(--dsh-color-primary)} .todoPending{color:var(--dsh-color-warning)}`；`styles/vars.scss:14-16`：good=#16a34a、warning=#d97706。
* **差异** 橙色 `#e08600` vs `#d97706`；完成绿 `#2e7d32` vs `#16a34a`。
* **建议** 新增 `--dsh-color-warn-android: #e08600`、`--dsh-color-todo-done: #2e7d32`（深色主题另给），把输入区这几处换成它们。若设计明确要统一到现有语义色，应在产品口径里登记为“刻意调整”。
* **风险/不确定** 安卓用的是硬编码色，不随动态取色变化；小程序用主题变量在深浅主题下更一致，需权衡。

### C-19 正文行高与 textarea 高度（P2）

* **证据**
  * 安卓 `ComposerBar.kt:504-507`：`maxLines = 6`，`textStyle = MaterialTheme.typography.bodyLarge`（M3 默认 16sp/行高 24sp）；字段 Box `padding(vertical = 8.dp)`。
  * 小程序 `ui/composerBar.module.scss:343-350`：`.textarea { padding:8px 4px; font-size:16px; line-height:22px; }`；`ui/composerBar.tsx:799`：`const textareaHeight = Math.min(Math.max(lineCount, 1), 6) * 22 + 16;`。
* **差异** 行高 22 vs 24；单行高度 38 vs 约 40dp；6 行上限一致。
* **建议** `line-height:24px`，公式 `行数*24 + 16`。
* **风险/不确定** 行高变化会影响 `onLineChange` 的换行阈值，需真机确认。

### C-20 加号 / 回形针尺寸（P2）

* **证据**
  * 安卓 `ComposerBar.kt:280-302`：`IconButton(modifier = Modifier.size(32.dp)) { Icon(Icons.Default.Add, null, tint = onSurfaceVariant) }`（Add 默认 24dp）；`ComposerBar.kt:303-307`：`IconButton(Modifier.size(32.dp)) { Icon(Icons.Default.AttachFile, null, Modifier.size(18.dp), onSurfaceVariant) }`。
  * 小程序 `ui/composerBar.tsx:894-917` 两个图标共用 `styles.launcher`；`ui/composerBar.module.scss:370-374`：`.launcher { font-size:17px; padding:2px 4px; }`。
* **差异** 加号 17px vs 24dp（差距明显），回形针 17 vs 18；两者都没有 32dp 命中区。
* **建议** 加号 24px、回形针 18px，各自 `width/height:32px` 居中。
* **风险/不确定** 无。

### C-21 补全触发口径与 `$` 触发器（P2）

* **证据**
  * 安卓 `state/PhoneModel.kt:64-75`：`TriggerToken.parse(draft)` 在 `draft.isEmpty() || draft.endsWith(" ") || draft.endsWith("\n")` 时返回 null，且只取最后一个空白后的词（`lastBreak + 1`），命令还要求 `start == 0`；Kind 只有 REFERENCE/COMMAND（无 skill）。`ComposerBar.kt:141-157` 每次 value 变化用整个 `value` 解析。
  * 小程序 `state/composer.ts:29-40`：`activeTrigger(text, cursor)` 以光标为准向左找空白，`/` 仅 `start === 0`，`$` 返回 `{ kind: 'skill' }`；`ui/composerBar.tsx:549-600` 按 cursor 触发并可对正文中间位置弹出候选。
* **差异** 光标在正文中间时小程序会弹候选，安卓只在草稿末尾弹；小程序 `$` 单独触发技能候选，安卓技能只混在 `/` 的 COMMAND 分支（`PhoneModel.kt:1120-1122`）。
* **建议** 若严格对齐安卓：仅当光标位于草稿末尾（且末词为 token）才展示候选；`$` 触发作为增强登记（或删除）。注意 `ComposerBar.kt:519-535 composerTokens` 里安卓确实把 `$` 画成胶囊，但**候选**不认 `$`，两者不同。
* **风险/不确定** 光标中间补全可能是产品想要的体验；需与产品确认是“增强”还是“偏差”。

### C-22 投影状态轮询（P2）

* **证据**
  * 安卓 `state/SessionStore.kt:245-263`：`contextOccupancy` / `planModeTarget` 直接读 `projections`，Compose 组合时自动重组；`ComposerBar.kt:356,373` 直接消费。
  * 小程序 `ui/composerBar.tsx:519-530`：注释明确“直接订阅 nodesStore 会被每个流式增量带着重绘整块输入区，所以按秒轮询”，`setInterval(readProjections, 1000)`。
* **差异** 计划 chip 的显隐、占用环数值最多延迟 1s；安卓是即时。切换 `/plan` 后 Android 立即出现可关 chip，小程序可能滞后约 1s。
* **建议** 给 `plan`/`contextPressure` 投影单独建 Store 或在解码投影帧时发布轻量更新，让组件只订阅这两项，兼顾性能与即时性。
* **风险/不确定** 需要评估是否会引起流式增量重绘。

### C-23 附件选择来源与命名（P2）

* **证据**
  * 安卓 `ComposerBar.kt:119-125`：`PickMultipleVisualMedia(4)` + `PickVisualMedia.ImageOnly`（相册，无相机）；文件名 `ComposerBar.kt:960-968,1012-1018` 取 `OpenableColumns.DISPLAY_NAME`，取不到退回 `uri.lastPathSegment`。
  * 小程序 `ui/composerBar.tsx:695-710`：`wx.chooseMedia({ count:4, mediaType:['image'], sourceType:['album','camera'] })`，随后 `makeImageAttachment(file.tempFilePath, 'image')`——名字写死为 `image`。
* **差异** 多了相机来源；相册图附件名恒为 `image`，多张图在附件条上无法区分（安卓用真实文件名）。文件选择 `wx.chooseMessageFile`（只能从聊天文件里选）本身是平台限制，安卓是系统文档选择器。
* **建议** 相册按安卓去掉 `camera`（若要保留需登记）；`makeImageAttachment` 用 `pathBasename(tempFilePath)` 或临时生成 `image-<n>` 命名。
* **风险/不确定** 小程序无法直接打开系统任意文件，只能 `chooseMessageFile`，此为平台限制（可用 API 仅此一个）。

### C-24 附件 chip 形态（P2）

* **证据**
  * 安卓 `ComposerBar.kt:931-956`：`Row(horizontalScroll, spacedBy(8.dp))`，每项 `InputChip(selected=false, label = Text(name, maxLines=1, Ellipsis), avatar = Icon(Image/InsertDriveFile, size 16.dp), trailingIcon = Icon(Close, size 14.dp))`——M3 默认高度 32dp、胶囊圆角、无缩略图。
  * 小程序 `ui/composerBar.module.scss:283-310`：`.chip { gap:5px; max-width:220px; padding:3px 8px; border-radius:14px; background:card; border:1px solid border; } .chipText{max-width:150px;font-size:12px} .chipRemove{font-size:11px}`；`ui/composerBar.tsx:446-470` 图片渲染 20px 真缩略图（`thumb`），文件用 `file-text` 13px。
* **差异** chip 高约 26px vs 32dp；前置 20px 缩略图 vs 16dp 图标；文字 12 vs 14；关闭 11 vs 14。
* **建议** 若要贴安卓：chip 高度约 32px、前置 16px 图标、关闭 14px、文字 14px。真缩略图是体验增强，可保留但应登记。
* **风险/不确定** 无。

### C-25 token 胶囊条为额外一行（P2）

* **证据**
  * 安卓 `ComposerBar.kt:448-512`：`BasicComposerField` 内用 `VisualTransformation` 给 token 上色、`drawBehind` 调 `drawTokenPill`（`ComposerBar.kt:552-572`）把胶囊画在正文文字下方；没有独立行。
  * 小程序 `ui/composerBar.tsx:841-851`：在输入卡片**上方**单独渲染 `ScrollView scrollX / tokenStrip`，胶囊显示整段 token，点击 `removeToken` 摘除；`ui/composerBar.module.scss:247-269`（圆角 10px、主色 14% 底、12px 主色文字）。
* **差异** 输入区多出一整行（仅当有 token 时），且“点胶囊整段摘除”是安卓没有的交互；胶囊底色 14% vs 安卓 0.12。
* **建议** 平台取舍可接受，但要压缩占位（例如与附件条共用一行、或做成卡片内顶部窄条）。可用 API：WeChat `<editor>` 富文本编辑器支持 `setContents`/格式化段落，可尝试内联高亮 token；`<textarea>` 本身不支持富文本。底色若保留请改 12% 对齐安卓。
* **风险/不确定** `<editor>` 与现有受控 cursor/输入法回灌逻辑能否兼容需真机验证。

## 附：本轮确认“文档已改且源码确实落地”的项（避免与遗留问题混淆）

* C-01（外层 `gap:8px; padding:8px 16px`）与安卓 `spacedBy(8.dp)+padding(16,8)` 一致——`ui/composerBar.module.scss:6-13`，确认已落地。
* C-23 待办折叠箭头 `expanded ? 'chevron-up' : 'chevron-down'` 与安卓 `ExpandLess/ExpandMore` 一致——`ui/composerBar.tsx:302`。
* C-12 预设入口确实已从输入区移除（`ui/composerBar.tsx:931-933` 仅剩注释），历史文档 `audit2/V-BC.md` 的“仍渲染预设入口”已过期。
* C-25 目标条过滤 `phase === 'complete'` 已落地——`ui/composerBar.tsx:807`。
* 队列分隔线只在行间画（`ui/composerBar.module.scss:179-182` `.queueRow:last-child`）、busy 用 Promise.finally 解锁（`ui/composerBar.tsx:402-408`）均与安卓一致。

## 需真机 / 开发者工具验证清单

1. C-01：新建会话页点“模型”是否走扁平 ActionSheet、占用环是否可点（确定性最高的一条，建议优先验）。
2. C-05：canvas 2d 或 conic-gradient 画 18px 弧在小程序基础库/真机的可用性与性能。
3. C-21：光标停在正文中间时是否弹候选（安卓不会）。
4. C-19：行高 22→24 后 `onLineChange` 与 6 行上限的行为。
5. C-15：`-webkit-line-clamp` 在 WXSS 组件样式中的生效情况。

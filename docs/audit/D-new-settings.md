# D 区代码差异审计报告：新建会话 / 设置 / 配对 / 引导

- 审计对象：小程序端 \`/Users/user/dshapp/dsh-miniapp\`（Taro4 + React18 + TS）
- 参考实现：安卓端 \`/Users/user/dshapp/dsh-androidapp\`（Kotlin + Jetpack Compose）
- 审计范围：新建会话、设置、配对、引导四个界面，以及其状态层、i18n、主题与常量
- 审计方式：只读源码、逐条比对；未修改任何源码（本文件除外）
- 报告规则：只写「实际读到的代码」；无法从源码确认的一律标「不确定」

## 路径前缀约定

为避免每条都写绝对路径，正文用两个前缀：

- \`A-\` = \`/Users/user/dshapp/dsh-androidapp/app/src/main/java/ai/deepseek/dshphone/\`
- \`W-\` = \`/Users/user/dshapp/dsh-miniapp/\`（文件即相对仓库根，例如 \`W-src/pages/new/index.tsx\`）

例如 \`A-ui/screen/NewSessionScreen.kt:99\` 指安卓端 \`.../ui/screen/NewSessionScreen.kt\` 第 99 行。

---

## 一、差异总览

- 差异总条数：**46 条**
- 影响分布：**大 8 条 / 中 15 条 / 小 23 条**
- 分布依据：见文末「附：影响分布统计」。

---

## 二、新建会话页（NewSessionScreen.kt ↔ pages/new/index.tsx）

### D-01 失败态文案口径不同（大）

- 安卓依据：\`A-ui/screen/NewSessionScreen.kt:126-136\`，创建失败时显示真实错误：
  \`\`\`kotlin
  Text(model.lastErrorMessage ?: Strings.noWorkspace, ...)
  \`\`\`
- 小程序现状：\`W-src/pages/new/index.tsx:71-73\`，失败时恒显示通用兜底：
  \`\`\`tsx
  ) : sessionId === undefined ? (
    <Text className={styles.message}>{Strings.operationFailed}</Text>
  \`\`\`
- 差异类型：文案不同 / 错误态不同
- 影响与建议：用户看不到主机返回的具体原因（例如「不指定工作区」与「会话已消失」在安卓是两句话，在小程序都是「操作失败，请重试」），排障与自我纠正能力下降。建议小程序暴露 \`model.lastErrorStore\` 的具体文案，并在无工作区时回退 \`Strings.noWorkspace\`。

### D-02 失败态操作入口不同（中）

- 安卓依据：\`A-ui/screen/NewSessionScreen.kt:137-140\`，两个按钮：\`Strings.workspace\`（打开工作区选择弹层）与 \`Strings.retry\`。
- 小程序现状：\`W-src/pages/new/index.tsx:74-79\`，两个按钮：\`Strings.retry\` 与 \`Strings.close\`（返回）。
- 差异类型：行为不同 / 操作入口不同
- 影响与建议：安卓在失败时仍能就地换工作区重试；小程序失败态没有「工作区」入口，用户只能重试或退出。建议补上工作区选择入口（或把已选工作区胶囊在失败态也渲染出来）。

### D-03 预设胶囊缺少主机关闭开关（大）

- 安卓依据：\`A-ui/screen/NewSessionScreen.kt:97-105\`，仅当主机允许时才给入口：
  \`\`\`kotlin
  // 主机关闭 Agent 模式选择时不给入口：新会话统一走部署默认模式
  if (model.agentPresetPickerEnabled) { AssistChip(...) }
  \`\`\`
  该字段定义于 \`A-state/PhoneModel.kt:199\`，由 roster 写入 \`A-state/PhoneModel.kt:1215\`。
- 小程序现状：\`W-src/pages/new/index.tsx:95-97\`，无条件渲染预设胶囊：
  \`\`\`tsx
  <Text className={styles.chip} onClick={() => setPickingPreset(true)}>
    {Strings.preset}: {presetTitle}
  \`\`\`
  全仓库检索 \`agentPresetPicker\` 在 \`W-src\` 下 **0 命中**（无对应字段）。
- 差异类型：缺失 / 行为不同
- 影响与建议：主机关闭 Agent 模式选择时，安卓不显示入口；小程序仍显示并允许选择、还会向主机发 \`agentPresets/select\`。建议在 \`appModel\` 中保留 \`pickerEnabled\`，并同样以它控制预设胶囊与弹层的渲染。

### D-04 工作区 / 预设胶囊文案不同（小）

- 安卓依据：\`A-ui/screen/NewSessionScreen.kt:92-103\`，胶囊只显示名字，并带前导图标（\`Icons.Default.Folder\` / \`Icons.Default.Layers\`）：
  \`\`\`kotlin
  AssistChip(onClick = { picking = true },
    label = { Text(workspaceTitle, maxLines = 1, ...) },
    leadingIcon = { Icon(Icons.Default.Folder, null, Modifier.size(16.dp)) })
  \`\`\`
- 小程序现状：\`W-src/pages/new/index.tsx:91-98\`，文案是「标签: 值」，无图标：
  \`\`\`tsx
  {Strings.workspace}: {workspaceTitle}
  {Strings.preset}: {presetTitle}
  \`\`\`
- 差异类型：文案不同 / 视觉不同
- 影响与建议：小程序胶囊更长、更占横向空间，且缺少安卓的语义图标。建议对齐为「仅值 + 前导图标」，或至少英文场景下与安卓一致。

### D-05 弹层选中态表达不同（小）

- 安卓依据：\`A-ui/screen/NewSessionScreen.kt:156-160 / 176-179 / 208-212\`，选中项尾部画 \`Icons.Default.Check\`（primary 色）。
- 小程序现状：\`W-src/pages/new/index.module.scss:110-113\` 的 \`.selected\` 只改颜色与字重；\`W-src/pages/new/index.tsx:117 / 127 / 147\` 靠拼接 class 表达选中，无勾选图标。
- 差异类型：视觉不同
- 影响与建议：色觉障碍用户较难识别当前选中项。建议对齐安卓补勾选图标。

### D-06 「不指定工作区」重复点击会重建会话（小）

- 安卓依据：\`A-ui/screen/NewSessionScreen.kt:151-154\`，只有当当前不是「无工作区」时才重开：
  \`\`\`kotlin
  picking = false
  if (workspaceId != null) scope.launch { prepare(null) }
  \`\`\`
- 小程序现状：\`W-src/pages/new/index.tsx:113-120\`，无条件调用 \`prepare(undefined)\`：
  \`\`\`tsx
  onClick={() => { setPicking(false); void prepare(undefined); }}
  \`\`\`
- 差异类型：行为不同
- 影响与建议：在已经是「不指定工作区」时再点一次，会再走一次创建流程（可能命中空白会话复用，但仍有网络/状态抖动）。建议加与安卓相同的守卫。

### D-07 工作区行重复点击会重建会话（小）

- 安卓依据：\`A-ui/screen/NewSessionScreen.kt:165-170\`，仅当工作区不同才重开：
  \`\`\`kotlin
  if (workspace.workspaceId != workspaceId) { scope.launch { prepare(workspace.workspaceId) } }
  \`\`\`
- 小程序现状：\`W-src/pages/new/index.tsx:121-132\`，无条件 \`prepare(item.workspaceId)\`。
- 差异类型：行为不同
- 影响与建议：重复点同一工作区会重新创建/切换会话。建议对齐守卫。

### D-08 预设行重复点击会重复下发选择（小）

- 安卓依据：\`A-ui/screen/NewSessionScreen.kt:193-203\`，\`if (!selected)\` 才执行 \`selectAgentPreset\`。
- 小程序现状：\`W-src/pages/new/index.tsx:142-153\` / \`:161-168\`，无条件调用 \`choosePresetFor(entry.id)\` → \`model.selectAgentPreset\`。
- 差异类型：行为不同
- 影响与建议：多一次主机调用。建议加 \`!selected\` 守卫。

### D-09 页面标题不同（中）

- 安卓依据：\`A-ui/screen/NewSessionScreen.kt:68-77\`，标题位留空（\`title = {}\`），只有返回图标，且图标 contentDescription 用 \`Strings.close\`。
- 小程序现状：\`W-src/pages/new/index.tsx:34-36\` 显式设置导航标题：
  \`\`\`tsx
  React.useEffect(() => { setNavTitle(Strings.newSession); }, [settingsValue.locale]);
  \`\`\`
- 差异类型：文案不同 / 视觉不同
- 影响与建议：安卓刻意不放大标题（注释见 \`A-ui/screen/NewSessionScreen.kt:69\`），小程序会显示「新建会话 / New Session」。是否算问题取决于产品口径；若要 1:1 对齐，应去掉标题。

### D-10 加载态表现不同（小）

- 安卓依据：\`A-ui/screen/NewSessionScreen.kt:124-125\`，\`preparing -> CircularProgressIndicator()\`。
- 小程序现状：\`W-src/pages/new/index.tsx:69-70\`，显示文本 \`Strings.statusLoading\`（「加载中…」）。
- 差异类型：视觉不同
- 影响与建议：转圈与文字都算合理，但两边不一致；如要求一致需二选一。

### D-11 会话就绪后正文内容不同（小）

- 安卓依据：\`A-ui/screen/NewSessionScreen.kt:124-142\`，\`when\` 只处理 \`preparing\` 与 \`sessionId == null\`；\`sessionId != null\` 时正文 **不画任何东西**（空 Box），只有底部输入区。
- 小程序现状：\`W-src/pages/new/index.tsx:81-83\`，就绪时居中显示占位：
  \`\`\`tsx
  ) : (
    <Text className={styles.message}>{Strings.newSessionPlaceholder}</Text>
  )
  \`\`\`
- 差异类型：视觉不同
- 影响与建议：小程序会多出一句居中的「新会话 / New session」。功能无碍，视觉不一致。

### D-12 发出第一条消息后的去向不同（大）

- 安卓依据：\`A-ui/App.kt:102-112\`，\`onCreated\` 直接进入会话页，并把 \`new\` 从回退栈移除：
  \`\`\`kotlin
  onCreated = { navController.navigate("chat/$it") { popUpTo("new") { inclusive = true } } }
  \`\`\`
- 小程序现状：\`W-src/pages/new/index.tsx:100-105\`，只是返回上一页：
  \`\`\`tsx
  onSubmitted={(_created: SessionId) => { model.rememberNewSessionWorkspace(workspaceId); back(); }}
  \`\`\`
- 差异类型：行为不同 / 交互流程不同
- 影响与建议：安卓发完第一条消息后直接停在对话里；小程序回到会话列表，用户还要再找刚建的会话点进去。建议改为打开会话页（\`openPage(pageRoutes.CHAT, { sessionId })\` 并替换当前页）。

### D-13 页面每次显示都重新 prepare（中，含不确定）

- 安卓依据：\`A-ui/screen/NewSessionScreen.kt:55-60\`，用 \`LaunchedEffect(Unit)\`，每次进入组合只跑一次。
- 小程序现状：\`W-src/pages/new/index.tsx:38-42\`，\`useDidShow(() => { ...; void prepare(model.defaultNewSessionWorkspaceId()); })\` —— 每次页面显示都会跑。
- 差异类型：行为不同
- 影响与建议：正常情况下两页都是叶子页，差别不明显；但如果将来从本页再压一层子页返回，小程序会重新建会话。**不确定**当前是否存在这样的入口。建议与安卓保持一致（只首次 prepare），或明确这是有意设计。

### D-14 工作区/预设弹层高度不同（小）

- 安卓依据：\`A-ui/screen/NewSessionScreen.kt:148 / 189\`，\`heightIn(max = 480.dp)\`。
- 小程序现状：\`W-src/pages/new/index.module.scss:84\`，\`max-height: 60vh\`。
- 差异类型：视觉不同
- 影响与建议：大屏手机上可见行数不同。低优先。

### D-15 弹层行内文案层级不同（小）

- 安卓依据：\`A-ui/screen/NewSessionScreen.kt:163-174\`，工作区行 \`headlineContent = title\` + \`supportingContent = path\`；预设行 \`headline = agentPresetMenuLabel\` + \`supporting = description\`。
- 小程序现状：\`W-src/pages/new/index.tsx:121-132 / 141-154\`，同样是主标题 + 次要路径/描述，结构基本一致；差别在样式类名与间距（\`sheetTitle\` / \`sheetPath\`）。
- 差异类型：视觉不同（轻微）
- 影响与建议：信息结构已对齐，属可忽略的间距差异。

---

## 三、设置页（SettingsScreen.kt ↔ pages/settings/index.tsx）

### D-16 设置页缺少标题栏（中）

- 安卓依据：\`A-ui/screen/SettingsScreen.kt:55-68\`，\`TopAppBar(title = { Text(Strings.settings) })\` + 返回图标 + 右上角加号。
- 小程序现状：\`W-src/pages/settings/index.tsx\` 全文件 **没有** \`setNavTitle\`（\`W-src\` 内 \`setNavTitle\` 仅出现在 preview/index/new/chat）。导航栏沿用上一页设置的标题（从列表页进入时是电脑名，见 \`W-src/pages/index/index.tsx:114-116\`）或全局默认「DeepSeek Harness」（\`W-src/app.config.ts:5-11\`）。
- 差异类型：文案不同 / 视觉不同
- 影响与建议：进设置页后导航栏标题不是「设置」，用户容易失去位置感。建议 \`setNavTitle(Strings.settings)\`。

### D-17 「新增服务」入口位置与形态不同（中）

- 安卓依据：\`A-ui/screen/SettingsScreen.kt:63-67\`，收在标题栏右上角图标：
  \`\`\`kotlin
  actions = { IconButton(onClick = onScan) { Icon(Icons.Default.Add, Strings.addServer) } }
  \`\`\`
- 小程序现状：\`W-src/pages/settings/index.tsx:144-155\`，是页面最底部一整行卡片：
  \`\`\`tsx
  <View className={styles.card}><View className={styles.row} onClick={...}>
    <Text className={styles.label}>{Strings.addServer}</Text><Icon name='chevron-right' .../>
  \`\`\`
- 差异类型：交互手势不同 / 页面结构不同
- 影响与建议：入口位置从「顶部图标」变成「底部行」，需要滚动到底才能看到。建议放到导航栏（小程序可用自定义导航或页面顶部按钮）。

### D-18 「新增服务」多点一次 toast（小）

- 安卓依据：\`A-ui/screen/SettingsScreen.kt:64-66\`，点击直接打开配对，无 toast。
- 小程序现状：\`W-src/pages/settings/index.tsx:147-150\`，先 \`toast(Strings.addServer)\` 再跳转：
  \`\`\`tsx
  onClick={() => { toast(Strings.addServer); openPage(pageRoutes.PAIRING); }}
  \`\`\`
- 差异类型：行为不同
- 影响与建议：多一个无信息量的「添加新服务」提示。建议删除该 toast。

### D-19 语言 / 主题选择的选中指示缺失（中）

- 安卓依据：\`A-ui/screen/SettingsScreen.kt:137-167\`，\`DropdownMenu\` + \`ChoiceItem\`，选中项 \`leadingIcon = { Icon(Icons.Default.Check, null) }\`（\`:229-234\`）。
- 小程序现状：\`W-src/pages/settings/index.tsx:73-91\`，用 \`wx.showActionSheet\`（系统动作面板），面板里不显示当前选中项，仅靠行尾 \`styles.value\` 文本回显（\`:132-141\`）。
- 差异类型：交互不同 / 视觉不同
- 影响与建议：在弹层打开时用户看不到当前语言/主题是哪一项。建议改用自绘弹层加勾选，或在动作面板项文案里带上标记。

### D-20 删掉最后一台机器后的行为不同（中）

- 安卓依据：\`A-ui/screen/SettingsScreen.kt:50-51\`，空列表自动退回根页（由引导页接手）：
  \`\`\`kotlin
  val empty = model.profiles.profiles.isEmpty()
  LaunchedEffect(empty) { if (empty) onBack() }
  \`\`\`
- 小程序现状：\`W-src/pages/settings/index.tsx:99\` 只在卡片里显示空态文案，不自动返回：
  \`\`\`tsx
  {profiles.length === 0 ? <Text className={styles.footer}>{Strings.serversEmpty}</Text> : null}
  \`\`\`
- 差异类型：行为不同 / 空态不同
- 影响与建议：小程序停在空设置页，需用户手动返回才能看到引导页。虽然 \`W-src/pages/settings/index.tsx:40-41\` 的注释声称与安卓同义，但代码并未实现自动返回。建议补 \`back()\`（或保留空态但明确产品意图）。

### D-21 「最近连接」时间格式不同（中）

- 安卓依据：\`A-ui/screen/SettingsScreen.kt:126-130\`，固定格式 \`yyyy-MM-dd HH:mm\`。
- 小程序现状：\`W-src/pages/settings/index.tsx:124\`：
  \`\`\`tsx
  <Text className={styles.value}>{new Date(current.lastConnectedAt).toLocaleString()}</Text>
  \`\`\`
- 差异类型：文案不同 / 格式不同
- 影响与建议：\`toLocaleString\` 输出随系统区域变化（可能带秒、AM/PM），与列表页/安卓口径不一致。建议统一为 \`yyyy-MM-dd HH:mm\`。

### D-22 重连状态点颜色不同（中）

- 安卓依据：\`A-ui/screen/SessionListScreen.kt:465-475\`，\`connectionTone\` 中 \`RECONNECTING\` 与 \`Connecting\` 都是琥珀 \`Color(0xFFE08600)\`。
- 小程序现状：\`W-src/state/connection.ts:22-35\` 返回 \`'reconnecting'\`；\`W-src/pages/settings/index.tsx:27-31\` 的 \`dotClass\` 只对 \`'connecting'\` 给黄色，其余落 \`dotBad\`（红 \`#dc2626\`，见 \`W-src/pages/settings/index.module.scss:73-75\`）。
- 差异类型：视觉不同 / 行为不同
- 影响与建议：小程序把「重连中」显示成「连接失败」的红色，语义偏负面。建议 \`'reconnecting'\` 也走黄色。

### D-23 服务列表分组标题仅小程序有（小）

- 安卓依据：\`A-ui/screen/SettingsScreen.kt:78-122\`，机器列表直接从列表第一项开始，没有 \`Strings.servers\` 段落标题（全仓库检索 \`Strings.servers\` 在安卓 **0 命中**）。
- 小程序现状：\`W-src/pages/settings/index.tsx:97\`：
  \`\`\`tsx
  <Text className={styles.sectionTitle}>{Strings.servers}</Text>
  \`\`\`
- 差异类型：视觉不同
- 影响与建议：多一个「服务」小标题。属风格差异。

### D-24 移除确认按钮不是危险色（小）

- 安卓依据：\`A-ui/screen/SettingsScreen.kt:177-182\`，确认按钮显式标红：
  \`\`\`kotlin
  TextButton(onClick = {...}) { Text(Strings.remove, color = MaterialTheme.colorScheme.error) }
  \`\`\`
- 小程序现状：\`W-src/pages/settings/index.tsx:62-71\`，\`wx.showModal({ confirmText: Strings.remove })\`，未设 \`confirmColor\`（小程序该 API 支持 \`confirmColor\`，但代码未传）。
- 差异类型：视觉不同
- 影响与建议：破坏性动作缺少红色警示。建议传 \`confirmColor: '#dc2626'\`。

### D-25 重命名弹窗形态不同（小）

- 安卓依据：\`A-ui/screen/SettingsScreen.kt:186-199\`，\`AlertDialog\` + \`OutlinedTextField(nameDraft, singleLine = true)\`，名字预填（\`:107\` \`nameDraft = profile.name\`）。
- 小程序现状：\`W-src/pages/settings/index.tsx:49-60\`，\`wx.showModal({ editable: true, content: profile.name, placeholderText: Strings.serverName })\`。
- 差异类型：交互不同
- 影响与建议：功能等价（都预填、都能改名）。差异仅为原生控件外观，可接受。**不确定** \`content\` 在 editable 模式下是否始终作为输入初值（微信文档语义以外，需要真机验证）。

### D-26 深色/浅色主题设置实际未生效（大）

- 安卓依据：\`A-ui/theme/Theme.kt:53-67\`，\`DshTheme\` 根据 \`themeMode\` 解出 \`darkTheme\` 并套 M3 色板（API31+ 走动态取色）：
  \`\`\`kotlin
  val darkTheme = when (theme) { SYSTEM -> isSystemInDarkTheme(); LIGHT -> false; DARK -> true }
  \`\`\`
- 小程序现状：\`W-src/state/settings.ts:84-87\` 只把 \`themeMode\` 落盘；全仓库检索 \`dark\` / \`prefers-color-scheme\` 在 \`W-src\` 的 \`.scss\` 下 **0 命中**，\`W-src/styles/vars.scss\` 只有一套浅色变量（\`W-src/styles/vars.scss:5-18\`），\`W-src/app.scss:12-17\` 页面底色写死 \`#f5f6f8\`。
- 差异类型：缺失 / 行为不同
- 影响与建议：用户在设置里切「深色」，界面完全不变，属可感知的功能缺失。建议补一套深色变量 + \`prefers-color-scheme\`/运行时 \`data-theme\` 切换，并让 \`settings.themeMode\` 真正驱动。

### D-27 设置项还包含列表排序偏好（结构差异，小）

- 安卓依据：\`A-state/AppSettings.kt:22-73\`，\`SettingsStore\` 只有 \`locale\` 与 \`themeMode\`。
- 小程序现状：\`W-src/state/settings.ts:7-8 / 21 / 24-26 / 89-92\`，额外持久化 \`sortMode: 'recent' | 'manual' | 'pinned'\`（键 \`dsh.sort\`）。
- 差异类型：行为不同（结构）
- 影响与建议：安卓把列表排序/分组放在会话列表的「视图选项」里，小程序把它塞进 SettingsStore。功能上不冲突，但两边偏好体系不一致，后续对齐时需注意。属信息性差异。

---

## 四、配对页（PairingScreen.kt ↔ pages/pairing/index.tsx）

### D-28 页面形态不同：全屏弹窗 vs 独立页面（大）

- 安卓依据：\`A-ui/screen/PairingScreen.kt:75-90\`，是覆盖在 App 之上的全屏 \`Dialog\`，带 \`TopAppBar\`：标题 \`Strings.pairTitle\`（「配对」）、关闭图标、右上角切换按钮。
- 小程序现状：\`W-src/route.ts:7\` + \`W-src/pages/pairing/index.tsx:70-96\`，是独立页面；无标题（无 \`setNavTitle\`）、无关闭按钮、无右上角切换。
- 差异类型：页面结构不同 / 交互手势不同
- 影响与建议：小程序进入后只有系统返回键可退；安卓有明确标题与关闭。建议至少补导航标题 \`Strings.pairTitle\`。

### D-29 扫码 / 粘贴缺少模式切换（大）

- 安卓依据：\`A-ui/screen/PairingScreen.kt:84-88\`，标题栏按钮在两种模式间切换：
  \`\`\`kotlin
  TextButton(onClick = { manual = !manual }) { Text(if (manual) Strings.scanQR else Strings.pastePairing) }
  \`\`\`
  且 \`granted && !manual\` 时才渲染相机，否则渲染粘贴输入区（\`:97-122\`）。
- 小程序现状：\`W-src/pages/pairing/index.tsx:70-96\`，扫码按钮与粘贴输入框 **同时** 常驻，没有模式切换。
- 差异类型：交互不同 / 页面结构不同
- 影响与建议：小程序信息密度更高但流程更直白；若要对齐安卓，需要加模式切换。请产品确认是否保留现状。

### D-30 扫码提示的呈现方式不同（中）

- 安卓依据：\`A-ui/screen/PairingScreen.kt:59-64\`，进入时弹一次 Toast：
  \`\`\`kotlin
  // 扫码提示改为进入时 toast 一次，避免常驻浮层被其它 UI 遮挡。
  Toast.makeText(context, Strings.scanHint, Toast.LENGTH_SHORT).show()
  \`\`\`
- 小程序现状：\`W-src/pages/pairing/index.tsx:72\`，页面顶部常驻提示文本：
  \`\`\`tsx
  <Text className={styles.tip}>{Strings.scanHint}</Text>
  \`\`\`
- 差异类型：视觉不同 / 交互不同
- 影响与建议：安卓有意不要常驻浮层；小程序是常驻文案。视觉不一致。

### D-31 相机权限与「无可用相机」降级缺失（大）

- 安卓依据：\`A-ui/screen/PairingScreen.kt:45-57\` 主动申请 \`Manifest.permission.CAMERA\`；未授权时 \`:108-112\` 显示 \`Strings.scanUnavailable\`（「此设备没有可用相机，请改为粘贴配对串。」）。
- 小程序现状：\`W-src/pages/pairing/index.tsx:59-68\` 用 \`wx.scanCode\`，没有权限/无相机分支；\`fail\` 回调里注释「什么都不做」：
  \`\`\`ts
  fail: () => { /* 用户取消扫码不是错误 */ },
  \`\`\`
  （\`W-src/app.config.ts:12-16\` 只声明了 \`scope.camera\` 描述，无降级文案）
- 差异类型：缺失 / 边界情况不同
- 影响与建议：若用户拒绝相机权限，小程序点击「扫描二维码」会静默失败，没有任何反馈，也没有引导去粘贴。建议在 \`fail\` 里区分「取消」与「失败」并提示（或至少依赖已有的粘贴区并给出说明）。安卓文案 \`scanUnavailable\` 在小程序 i18n 中缺失，见 D-43。

### D-32 电脑名确认缺少说明脚注（小）

- 安卓依据：\`A-ui/screen/PairingScreen.kt:129-146\`，命名对话框里带 \`Strings.serverNameFooter\`（「给这台电脑标个名字，只在本机显示。」，\`:135\`）。
- 小程序现状：\`W-src/pages/pairing/index.tsx:29-56\`，\`wx.showModal\` 只有输入框，无脚注；\`W-src/i18n/strings.ts:56-59\` 定义了 \`serverNameFooter\` 但在 \`W-src\` 内无任何引用。
- 差异类型：缺失 / 文案不同
- 影响与建议：用户不知道改名的影响范围。建议在弹层前/后补一句说明。

### D-33 密钥生成失败用了「配对码无效」文案（小）

- 安卓依据：\`A-state/ServerProfileStore.kt:103-110\`，\`add()\` 内部同步生成设备密钥（\`Noise.generateKeyPair()\`），没有「生成失败」这条路径。
- 小程序现状：\`W-src/pages/pairing/index.tsx:40-46\`，\`generateDeviceKey()\` 抛错时设：
  \`\`\`ts
  catch { setError(Strings.pairInvalid); return; }
  \`\`\`
- 差异类型：文案不同 / 错误态不同
- 影响与建议：把「设备密钥生成失败」说成「这不是配对码」，会误导用户反复重扫。建议改用 \`Strings.operationFailed\` 或专门的文案。

### D-34 配对成功后的连接行为不同（大）

- 安卓依据：\`A-ui/App.kt:128-133\`，入库后 **立即** 连接新机器：
  \`\`\`kotlin
  onPaired = { name, payload -> val profile = model.profiles.add(name, payload); scanning = false; if (profile != null) model.connect(profile) }
  \`\`\`
- 小程序现状：\`W-src/pages/pairing/index.tsx:47-53\`，入库后只 toast + 返回，**没有** \`connectProfile\`：
  \`\`\`ts
  const profile = profileStore.add(name, text, privateKey);
  ...
  toast(Strings.statusConnected, 'success');
  back();
  \`\`\`
  而 \`W-src/state/appModel.ts:303-308\` 的 \`onForeground\` 只有在 \`coordinator === undefined\` 时才 \`connectCurrent()\`，否则只 \`coordinator.onForeground()\`。
- 差异类型：行为不同
- 影响与建议：从「已连着一台、再添加第二台」的场景看，返回后不会自动切到新机器（需用户再去设置里手动点一次）；安卓会立刻切过去。建议对齐：\`void getAppModel().connectProfile(profile)\`。

### D-35 配对成功多一次 toast（小）

- 安卓依据：\`A-ui/screen/PairingScreen.kt:128-146\` + \`A-ui/App.kt:126-134\`，配对成功后直接关闭弹窗并连接，没有成功 toast。
- 小程序现状：\`W-src/pages/pairing/index.tsx:52\`，\`toast(Strings.statusConnected, 'success')\`。
- 差异类型：行为不同 / 视觉不同
- 影响与建议：多一次「已连接」提示。若 D-34 修好，这个 toast 反而更准确；否则是在还没连上时报「已连接」。建议与 D-34 一起决定。

### D-36 粘贴框占位文案不同（小）

- 安卓依据：\`A-ui/screen/PairingScreen.kt:101-107\`，输入框 \`label = { Text(Strings.pastePairing) }\`（「手动输入配对串」）。
- 小程序现状：\`W-src/pages/pairing/index.tsx:77-87\`，\`label\` 文本用 \`Strings.pastePairing\`，但输入框占位硬编码：
  \`\`\`tsx
  <Textarea ... placeholder='dshm://...' maxlength={-1} ... />
  \`\`\`
- 差异类型：文案不同（轻微）
- 影响与建议：占位符不可本地化，但展示的是协议示例，属可接受。

### D-37 扫码竞态处理不同（小）

- 安卓依据：\`A-ui/screen/PairingScreen.kt:180 / 208-224\`，用 \`settled\` 标志 + \`STRATEGY_KEEP_ONLY_LATEST\`，命中一次后忽略后续帧。
- 小程序现状：\`W-src/pages/pairing/index.tsx:59-68\`，\`wx.scanCode\` 一次性返回，天然无竞态。
- 差异类型：实现不同（用户不可感知）
- 影响与建议：无需改动，仅记录。

---

## 五、引导页（OnboardingScreen.kt ↔ ui/onboarding.tsx）

### D-38 引导页缺少顶部标题栏（中）

- 安卓依据：\`A-ui/screen/OnboardingScreen.kt:18\`：
  \`\`\`kotlin
  Scaffold(topBar = { CenterAlignedTopAppBar(title = { Text(Strings.appName) }) })
  \`\`\`
- 小程序现状：\`W-src/ui/onboarding.tsx:18-31\` 本身没有标题栏；它作为组件渲染在列表页里（\`W-src/pages/index/index.tsx:348-354\` 提前 return，不渲染列表页 \`topBar\`）。导航栏标题由列表页的 \`setNavTitle(profileName ?? Strings.appName)\` 决定（\`W-src/pages/index/index.tsx:114-116\`），无配对时即 \`Strings.appName\`。
- 差异类型：视觉不同
- 影响与建议：两者最终都显示 App 名，位置/样式不同（安卓居中标题栏 vs 小程序原生导航栏）。基本等价，低优先。

### D-39 图标与排版度量不同（小）

- 安卓依据：\`A-ui/screen/OnboardingScreen.kt:27-40\`：图标 \`56.dp\`，间距 \`16/8/24.dp\`，正文 \`bodyMedium\`，主按钮 \`Button\` 常显。
- 小程序现状：\`W-src/ui/onboarding.module.scss:14-17\` 图标 \`52px\`；\`W-src/ui/onboarding.module.scss:4-12\` \`.page\` \`padding: 72px 32px\` + \`gap: 10px\`。
- 差异类型：视觉不同
- 影响与建议：观感接近，尺寸不一致。低优先。

### D-40 引导页两个入口都跳到采购配对页（等价，记录）

- 安卓依据：\`A-ui/screen/OnboardingScreen.kt:38-39\`，\`Button(onScan)\` 与 \`TextButton(onClick = onScan)\` 都走同一个 \`onScan\`。
- 小程序现状：\`W-src/ui/onboarding.tsx:24-29\`，\`onClick={props.onPair}\` 两处都调 \`onPair\`（\`W-src/pages/index/index.tsx:351\` 打开配对页，配对页内同时提供扫码与粘贴）。
- 差异类型：无差异
- 影响与建议：行为一致。

---

## 六、状态层 / 存储 / i18n / 无障碍 / 常量

### D-41 系统语言回退方向相反（中）

- 安卓依据：\`A-i18n/Strings.kt:27-30\`，只有 \`en\` 才算英文，其余一律中文：
  \`\`\`kotlin
  return if (tag == "en") AppLocale.EN else AppLocale.ZH
  \`\`\`
- 小程序现状：\`W-src/state/settings.ts:28-36\`，只有以 \`zh\` 开头才算中文，其余一律英文：
  \`\`\`ts
  return language.startsWith('zh') ? 'zh' : 'en';
  \`\`\`
- 差异类型：行为不同
- 影响与建议：法语/日语等设备上，安卓显示中文、小程序显示英文。若产品要「中文优先回退」，小程序需要改成 \`language.startsWith('zh') ? 'zh' : (language.startsWith('en') ? 'en' : 'zh')\`。

### D-42 运行期系统语言变化未刷新（小）

- 安卓依据：\`A-state/AppSettings.kt:34-37\` 提供 \`refreshSystemLocale()\`，注释说明在 Activity 重建时调用（\`A-state/AppSettings.kt:20\` 也强调读取发生在任何组合之前）。
- 小程序现状：\`W-src/state/settings.ts:94-97\` 定义了 \`refreshSystemLocale()\`，但全仓库检索只有定义、**没有任何调用点**（\`W-src/app.tsx:17-27\` 的 \`useLaunch/useDidShow/useDidHide\` 均未调用）。
- 差异类型：缺失 / 行为不同
- 影响与建议：用户在系统里切换语言后回到小程序，语言不会跟随。建议在 \`useDidShow\`（\`W-src/app.tsx:21-23\`）里补调用。

### D-43 mini 缺失 16 个安卓文案键（中）

全量对比两张文案表（各 267 键），安卓独有、小程序没有的键：

- \`scanUnavailable\`（本区直接相关：配对无相机降级，见 D-31）
- \`imageUnavailable\` / \`imageOpenFailed\`
- \`accessRead\` / \`accessWrite\` / \`accessFull\`
- \`copyAction\` / \`messageBranch\`
- \`notifyApproval\` / \`notifyQuestion\` / \`notifyDone\` / \`notifyFailed\`
- \`turnFailureAuthInvalid\` / \`turnFailureFallback\`
- \`notifyServiceRunning\` / \`notifyServiceDescription\`

- 安卓依据：\`A-i18n/Strings.kt:42 / 139 / 140-142 / 235 / 251 / 252 / 322-333\`。
- 小程序现状：\`W-src/i18n/strings.ts\` 的 \`TABLE\` 中不存在同名键。
- 差异类型：缺失
- 影响与建议：其中 \`scanUnavailable\` 属于本区（D-31）；其余多属会话/通知区域，需由对应负责人处理。本报告只登记，避免遗漏。

### D-44 三处文案措辞不一致（小）

- \`scanHint\`：安卓 \`A-i18n/Strings.kt:41\` = 「请扫描DSH匹配二维码」；小程序 \`W-src/i18n/strings.ts:31\` = 「请扫描 DSH 配对二维码」（多了空格，「匹配」→「配对」）。
- \`newSessionPlaceholder\` 英文：安卓 \`A-i18n/Strings.kt:245\` = \`"New Session"\`；小程序 \`W-src/i18n/strings.ts:84\` = \`"New session"\`（大小写不同）。
- \`unavailableArchivedSessions\`（归档区，登记备查）：安卓 \`A-i18n/Strings.kt:172-173\` = 「这里没有可恢复的已归档会话。」；小程序 \`W-src/i18n/strings.ts\` = 「已归档的会话已不存在」（英文也不同）。
- 差异类型：文案不同
- 影响与建议：统一措辞。

### D-45 图标缺少无障碍标签（中）

- 安卓依据：多处 \`contentDescription\`：\`A-ui/screen/SettingsScreen.kt:108 / 113 / 65\`（重命名/移除/添加）、\`A-ui/screen/PairingScreen.kt:82\`（关闭）、\`A-ui/screen/SessionListScreen.kt:481-487\`（\`ConnectionDot\` 用 \`semantics { contentDescription = "状态: ..." }\`）。
- 小程序现状：\`W-src/ui/icon.tsx:20-28\` 只渲染一个私有区字形 \`<Text>\`，没有 \`aria-label\`/\`role\`；设置页 \`W-src/pages/settings/index.tsx:108-112\`、配对页、引导页的图标按钮都只有 \`onClick\`。
- 差异类型：无障碍缺失
- 影响与建议：读屏用户无法识别「重命名/移除」按钮。建议为 \`Icon\` 增加可选 \`ariaLabel\` 并在这些按钮上使用。

### D-46 度量常量集不完整（信息性，小）

- 安卓依据：\`A-ui/theme/Theme.kt:17-32\` \`Dimens\` 共 13 项（含 \`messageTopInset\`、\`chromeRowHeight\`、\`iconSlot\`、\`listRowPadding\`、\`stripRowHeight\`、\`stripIconSlot\`、\`stripSpacing\`）。
- 小程序现状：\`W-src/const.ts:18-25\` \`DIMENS\` 只有 6 项（\`columnMaxWidth\`、\`columnInset\`、\`rowSpacing\`、\`cardRadius\`、\`cardPadding\`、\`bubbleRadius\`）。
- 差异类型：缺失（常量层）
- 影响与建议：本区四页未直接用到缺的那几项，但会影响其它区域的视觉对齐。**不确定**是否有其它文件另有一套常量；此处仅登记。

### D-47 配对资料存储未加密（中，非 UI）

- 安卓依据：\`A-state/ServerProfileStore.kt:59-68\`，优先 \`EncryptedSharedPreferences\`（AES256_GCM MasterKey），失败才退回明文。
- 小程序现状：\`W-src/state/profileStore.ts:186-190\`，\`commit\` 直接 \`writeStorage(PROFILES_KEY, JSON.stringify(...))\`，即普通 \`wx\` 存储。
- 差异类型：实现差异 / 安全差异（用户不可直接感知）
- 影响与建议：小程序没有 Android Keystore，源码注释已说明（\`W-src/state/profileStore.ts:5-9\`）。属平台能力限制，记录备查，不建议在本轮 UI 对齐中处理。

---

## 附：影响分布统计

| 编号 | 标题 | 影响 |
| --- | --- | --- |
| D-01 | 失败态文案口径不同 | 大 |
| D-02 | 失败态操作入口不同 | 中 |
| D-03 | 预设胶囊缺少主机关闭开关 | 大 |
| D-04 | 工作区/预设胶囊文案不同 | 小 |
| D-05 | 弹层选中态表达不同 | 小 |
| D-06 | 「不指定工作区」重复点击会重建会话 | 小 |
| D-07 | 工作区行重复点击会重建会话 | 小 |
| D-08 | 预设行重复点击会重复下发选择 | 小 |
| D-09 | 页面标题不同 | 中 |
| D-10 | 加载态表现不同 | 小 |
| D-11 | 会话就绪后正文内容不同 | 小 |
| D-12 | 发出第一条消息后的去向不同 | 大 |
| D-13 | 页面每次显示都重新 prepare | 中 |
| D-14 | 工作区/预设弹层高度不同 | 小 |
| D-15 | 弹层行内文案层级不同 | 小 |
| D-16 | 设置页缺少标题栏 | 中 |
| D-17 | 「新增服务」入口位置与形态不同 | 中 |
| D-18 | 「新增服务」多点一次 toast | 小 |
| D-19 | 语言/主题选择的选中指示缺失 | 中 |
| D-20 | 删掉最后一台机器后的行为不同 | 中 |
| D-21 | 「最近连接」时间格式不同 | 中 |
| D-22 | 重连状态点颜色不同 | 中 |
| D-23 | 服务列表分组标题仅小程序有 | 小 |
| D-24 | 移除确认按钮不是危险色 | 小 |
| D-25 | 重命名弹窗形态不同 | 小 |
| D-26 | 深色/浅色主题设置实际未生效 | 大 |
| D-27 | 设置项还包含列表排序偏好 | 小 |
| D-28 | 页面形态：全屏弹窗 vs 独立页面 | 大 |
| D-29 | 扫码/粘贴缺少模式切换 | 大 |
| D-30 | 扫码提示的呈现方式不同 | 中 |
| D-31 | 相机权限与「无可用相机」降级缺失 | 大 |
| D-32 | 电脑名确认缺少说明脚注 | 小 |
| D-33 | 密钥生成失败用了「配对码无效」文案 | 小 |
| D-34 | 配对成功后的连接行为不同 | 大 |
| D-35 | 配对成功多一次 toast | 小 |
| D-36 | 粘贴框占位文案不同 | 小 |
| D-37 | 扫码竞态处理不同 | 小 |
| D-38 | 引导页缺少顶部标题栏 | 中 |
| D-39 | 图标与排版度量不同 | 小 |
| D-40 | 引导页两个入口都跳配对页（无差异） | — |
| D-41 | 系统语言回退方向相反 | 中 |
| D-42 | 运行期系统语言变化未刷新 | 小 |
| D-43 | mini 缺失 16 个安卓文案键 | 中 |
| D-44 | 三处文案措辞不一致 | 小 |
| D-45 | 图标缺少无障碍标签 | 中 |
| D-46 | 度量常量集不完整 | 小 |
| D-47 | 配对资料存储未加密 | 中 |

**统计（不含 D-40「无差异」记录）**

- 总条数：46 条（D-01 ~ D-39、D-41 ~ D-47）
- 大：8 条 —— D-01、D-03、D-12、D-26、D-28、D-29、D-31、D-34
- 中：15 条 —— D-02、D-09、D-13、D-16、D-17、D-19、D-20、D-21、D-22、D-30、D-38、D-41、D-43、D-45、D-47
- 小：23 条 —— D-04、D-05、D-06、D-07、D-08、D-10、D-11、D-14、D-15、D-18、D-23、D-24、D-25、D-27、D-32、D-33、D-35、D-36、D-37、D-39、D-42、D-44、D-46

核对：8 + 15 + 23 = 46。✔

---

## 附：最重要的 5 条（建议优先修）

1. **D-26 深色/浅色主题设置实际未生效**：设置能选、存储有值，但没有任何样式消费它，用户切了等于没切。
2. **D-03 预设胶囊缺少主机关闭开关**：主机明确关闭 Agent 模式选择时，小程序仍放行并下发 \`agentPresets/select\`，违背主机契约。
3. **D-29 配对页缺少扫码/粘贴模式切换**：安卓两种模式互斥且可切换，小程序同屏常驻，交互模型不同。
4. **D-31 相机权限与「无可用相机」降级缺失**：拒绝权限后点「扫描」完全静默，用户无任何指引。
5. **D-12 发出第一条消息后不进入会话页**：安卓发完直接停在对话里，小程序退回列表，主流程体验断裂。

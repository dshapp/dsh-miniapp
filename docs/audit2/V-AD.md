# A 区 / D 区 [x] 条目验收报告

- 验收对象：`docs/DIFF-ANDROID.md` 中 **A 区（会话列表/归档，32 条）** 与 **D 区（新建/设置/配对/引导/i18n，47 条）** 里所有标 `[x]` 的条目，共 **64 条**（A 23 条 + D 41 条）。
- 明细来源：`docs/audit/A-session-list.md`、`docs/audit/D-new-settings.md`。
- 方法：逐条读明细拿安卓 file:line → 读当前安卓源码确认权威行为 → 读当前小程序源码确认实现 → 判定。**未修改任何源码。**
- 安卓路径前缀 `A-` = `/Users/user/dshapp/dsh-androidapp/app/src/main/java/ai/deepseek/dshphone/`；小程序路径相对 `/Users/user/dshapp/dsh-miniapp/`。
- 快照时间：2026-09-21（本次验收）。

## 摘要

| 判定 | 计数 |
| --- | --- |
| ✅ 已落地且一致 | 61 |
| ⚠️ 部分落地 | 3 |
| ❌ 未落地 / 改错 | 0 |
| ❓ 无法判定 | 0 |
| **合计** | **64** |

### ❌ 列表

无。

### ⚠️ 列表（3 条）

1. **D-01 失败态文案口径**：真实错误已显示，但**兜底文案改错了方向**——小程序回退 `Strings.operationFailed`，安卓回退 `Strings.noWorkspace`（`src/pages/new/index.tsx:78` vs `A-ui/screen/NewSessionScreen.kt:132`）。
2. **D-09 页面标题**：只删了运行时 `setNavTitle`，**页面配置里仍写死中文标题**，导航栏照样显示「新建会话」且不再随语言切换（`src/pages/new/index.config.ts:2` vs `A-ui/screen/NewSessionScreen.kt:72` 的 `title = {}`）。
3. **D-39 引导页度量**：图标已从 52px 改到 56px，但**间距只改了一半**——flex `gap:16px` 与逐元素 `margin-top` 叠加后实际是 24/16/40，安卓是 16/8/24；`.page` 内边距仍是 `72px 32px`（安卓 `32.dp`）（`src/ui/onboarding.module.scss:4-36` vs `A-ui/screen/OnboardingScreen.kt:23-39`）。

### 另外记录的三处「已落地但仍有残留偏差」（不计入 ⚠️，见逐条表备注）

- **A-04**：档位已按 `SessionStatusRank` 拆成 0..6，但「在 `awaitingUserSessionIds` 里、kinds 表却缺条目」这一兜底，安卓按 APPROVAL(3) 排，小程序落到 4（`src/state/stores.ts:379-380` vs `A-state/Stores.kt:351-355`）。行尾徽标侧（A-14）已有同款兜底，两处口径没对齐。
- **A-07**：`isEmpty` 已改用过滤后的 `listed`，但安卓 `StatusOverlay` 是互斥 `when`，小程序是四个独立条件；`searching + listed 为空 + 连接失败` 时会同时画「离线空态」和「搜索无结果空态」（`src/pages/index/index.tsx:474-488` vs `A-ui/screen/SessionListScreen.kt:905-919`）。
- **A-03 / A-20**：读屏标签已写进源码，但分组表头用的是 Taro 的 `ariaLabel`（`node_modules/@tarojs/components/types/View.d.ts:55-58` 标注 `@supported qq`），微信端是否真的暴露给读屏仍需真机验证（与审计里 A-24 的不确定项同源）。

---

## 逐条验收表

### A 区（会话列表 / 归档）

| 编号 | 标题 | 判定 | 证据（安卓 / 小程序） | 建议 |
| --- | --- | --- | --- | --- |
| A-03 | reorderGroups 无障碍提示未使用 | ✅ | `A-ui/screen/SessionListScreen.kt:731-734`（拖动中抓手 contentDescription=reorderGroups） / `src/pages/index/index.tsx:374` 分组表头 `ariaLabel={Strings.reorderGroups}`，`src/i18n/strings.ts:255` 不再是死文案 | 备注：Taro `View.ariaLabel` 文档标注仅 QQ 小程序支持，微信端建议真机读屏验证；若无效可改用可见文案或 `aria-label` |
| A-04 | 状态排序把「待审批/待回答」挤进同一档 | ✅ | `A-state/SessionStatusRank.kt:12-38`、`A-state/Stores.kt:342-360` / `src/state/stores.ts:365-387`（running0 / failed1 / done2 / approval3 / question4 / draft5 / idle6） | 残留：kinds 缺条目时安卓兜底 APPROVAL(3)，小程序落 4；建议 `stores.ts:379` 改成「在 awaiting 集合里 → kinds ?? 'approval'」 |
| A-05 | 运行中子智能体未计入父会话「运行中」 | ✅ | `A-state/Stores.kt:83-99` computeRunningSubagentRoots / `src/state/stores.ts:341-363` `runningSubagentRoots()`，`:375` 参与 rank 0 | — |
| A-06 | 错误档未与「未读完成」口径对齐 | ✅ | `A-state/SessionStatusRank.kt:57-58`（isUnread → didFail ? FAILED_UNREAD : DONE_UNREAD） / `src/state/stores.ts:378` `completed.has(id) ? (errored ? 1 : 2)` | — |
| A-07 | 空态判定用原始名册长度 | ✅ | `A-ui/screen/SessionListScreen.kt:429` `listEmpty = listed.isEmpty()` / `src/pages/index/index.tsx:405` `isEmpty = listed.length === 0`（listed 见 :175-178 过滤归档/空白/subagent） | 残留：安卓 StatusOverlay 是互斥 when，小程序 :474-488 四个条件并列，搜索态 + 空名册 + 失败时会叠两个空态；建议给失败/连接中分支补 `!searching` |
| A-08 | 连接提示条：已连接常驻/不可滑消/非全局/展示 detail | ✅ | `A-ui/component/ConnectionBanner.kt:118-131`、`A-ui/App.kt:136-139` / `src/ui/connectionBanner.tsx:51-88`（connected/undefined 不画、上滑 dismiss、failed 才给重试、detail 只进 `console.warn`）+ `src/app.tsx:56-60` 全局挂载；`src/state/connection.ts:49-61` `connectionBannerTone` | — |
| A-09 | 连接中空态：居中转圈 | ✅ | `A-ui/screen/SessionListScreen.kt:910-911` / `src/pages/index/index.tsx:478-482` + `index.module.scss:197-207` `.centered` 居中 loader | — |
| A-10 | 刷新态多显示「连接中…」页脚 | ✅ | `A-ui/screen/SessionListScreen.kt:368-372`（只用原生下拉指示器） / `src/pages/index/index.tsx` 全文已无 `refreshing` 页脚（grep 无命中） | — |
| A-12 | 行标题不取实时标题 | ✅ | `A-ui/screen/SessionListScreen.kt:460-461` `titleOf = sessionDisplayTitle(summary, model.sessions[id]?.title)` / `src/pages/index/index.tsx:54-63` `SessionRow` 订阅 `titleStore` 后走 `sessionListTitle`（`src/model/format.ts:153-157`） | — |
| A-13 | 未读错误图标多一个 completed 抑制 | ✅ | `A-ui/screen/SessionListScreen.kt:829-830`（只看 unreadError） / `src/pages/index/index.tsx:503-509` 只传 `erroredIds.has(id)`，`!completedIds` 已删 | — |
| A-14 | 行尾等待徽标缺 APPROVAL 兜底 | ✅ | `A-ui/screen/SessionListScreen.kt:841-843` / `src/pages/index/index.tsx:502` `awaitingKinds.get(id) ?? (awaitingUserIds.has(id) ? 'approval' : undefined)` | 备注：安卓以集合为权威（不在集合里就不显示），小程序以 kinds 为先；极端不一致时行为略有出入 |
| A-15 | 长按行菜单无触觉反馈 | ✅ | `A-ui/screen/SessionListScreen.kt:782-785` `performHapticFeedback(LongPress)` / `src/pages/index/index.tsx:68-76` `wx.vibrateShort({type:'light'})` 后再弹 ActionSheet（菜单形态差异属 A-15 已记录的平台替换） | — |
| A-16 | 重命名弹层不预填实时标题 | ✅ | `A-ui/screen/SessionListScreen.kt:380/409/444-457` `renameText = titleOf(...)` / `src/pages/index/index.tsx:271-279` `content: model.sessionTitle(id)`，`src/state/appModel.ts:1094-1099` 走 `sessionDisplayTitle(summary, store?.title)` | 备注：`wx.showModal` 的 `content` 在 editable 下是否恒为初值仍是审计里的不确定项，需真机确认 |
| A-17 | 搜索清除按钮常显 / 清除后不回输入框 | ✅ | `A-ui/screen/SessionListScreen.kt:320-327`（仅非空显示 + requestFocus） / `src/pages/index/index.tsx:431-446` 空查询画占位、清除后 `setSearchFocused(false)→true` 重新聚焦 | — |
| A-19 | 底部归档入口 fixed 可能遮挡末行 | ✅ | `A-ui/screen/SessionListScreen.kt:365-441`（weight + 底部 ListItem 不重叠） / `src/pages/index/index.module.scss:9` `padding-bottom:72px`，入口 `:174-185` 高约 48px + 安全区 | — |
| A-20 | 连接状态点缺无障碍标签 | ✅ | `A-ui/screen/SessionListScreen.kt:479-487` `contentDescription = "状态: label"` / `src/pages/index/index.tsx:450-454` `aria-label={Strings.connectionStateLabel}`，`src/i18n/strings.ts:100` | 备注：安卓标签带当前状态文字，小程序是固定「连接状态」，读屏听不到具体状态；可考虑拼上 tone 文案 |
| A-21 | 归档页取消归档失败无提示 | ✅ | `A-ui/screen/ArchivedSessionsScreen.kt:78-82/148` Snackbar / `src/pages/archived/index.tsx:71-77` 失败 `toast(model.lastErrorStore.get() ?? Strings.operationFailed)`，`src/state/appModel.ts:587-602` 返回布尔 | 备注：安卓消费后会清空 `lastErrorMessage`，小程序只读不清，可能复用上一次错误文本 |
| A-22 | unavailableArchivedSessions 中英文案不一致 | ✅ | `A-i18n/Strings.kt:172-173` / `src/i18n/strings.ts:200` 两端逐字一致（"No archived session here can be restored." / 「这里没有可恢复的已归档会话。」） | — |
| A-23 | 归档页没有全局连接提示条 | ✅ | `A-ui/App.kt:136-139` / `src/app.tsx:56-60` 横幅挂在 App 根容器，归档页（`src/pages/archived/index.tsx`）自动被覆盖 | — |
| A-25 | 顶栏随页面滚动 | ✅ | `A-ui/screen/SessionListScreen.kt:266-363` Scaffold topBar 固定 / `src/pages/index/index.module.scss:12-16` 与 `src/pages/archived/index.module.scss:11-15` 均 `position:sticky; top:0; z-index:20` | — |
| A-26 | 归档页搜索无结果图标 | ✅ | `A-ui/screen/ArchivedSessionsScreen.kt:159-160` `Icons.Default.SearchOff` / `src/pages/archived/index.tsx:94` `EmptyState name='search-x'`（lucide 无 search-off，语义等同） | — |
| A-27 | 未配对引导页结构差异 | ✅ | `A-ui/screen/OnboardingScreen.kt:18` CenterAlignedTopAppBar(appName) / `src/ui/onboarding.tsx:18-31` 无页内标题栏，但 `src/pages/index/index.tsx:168-170` 的 `setNavTitle(profileName ?? Strings.appName)` 在未配对时即 appName，由微信原生导航栏承担 | 备注：等价而非像素级对齐；度量问题另见 D-39（⚠️） |
| A-30 | 空白会话复用未校验预设有效性 | ✅ | `A-model/BlankSessionReuse.kt:16-49` / `src/model/blankSessionReuse.ts:28-52` 逐函数对齐，`src/state/appModel.ts:987-1002` `createSession` 调用并传入 `agentPresetsStore` | 备注：小程序 archived 只取 `workspaceStore.archivedSessionIds`，未并入 `sessionListStore` 那一份；与列表页 :175-178 的并集口径略有出入 |

### D 区（新建 / 设置 / 配对 / 引导 / i18n）

| 编号 | 标题 | 判定 | 证据（安卓 / 小程序） | 建议 |
| --- | --- | --- | --- | --- |
| D-01 | 失败态文案口径不同 | ⚠️ | `A-ui/screen/NewSessionScreen.kt:131-136` `model.lastErrorMessage ?: Strings.noWorkspace` / `src/pages/new/index.tsx:78` `lastError ?? Strings.operationFailed` | 已落地的一半：真实错误文案已接 `lastErrorStore`。差的一半：兜底应为 `Strings.noWorkspace`，把 `operationFailed` 换掉 |
| D-02 | 失败态操作入口不同 | ✅ | `A-ui/screen/NewSessionScreen.kt:137-140`（工作区 + 重试） / `src/pages/new/index.tsx:79-85` 工作区 + 重试 + 关闭 | 备注：小程序多一个「关闭」，属额外入口，不影响安卓口径 |
| D-03 | 预设胶囊缺少主机关闭开关 | ✅ | `A-ui/screen/NewSessionScreen.kt:99-105` `if (model.agentPresetPickerEnabled)` / `src/pages/new/index.tsx:27,106-111,162` `pickerEnabled` 同时约束胶囊与弹层；`src/state/appModel.ts:107,894` 由 `modeSelectionEnabled` 写入 | — |
| D-04 | 工作区/预设胶囊文案不同 | ✅ | `A-ui/screen/NewSessionScreen.kt:92-104`（仅值 + 前导图标） / `src/pages/new/index.tsx:100-111` 改成 `folder-tree`/`puzzle` 图标 + 纯值，`「工作区: 」`前缀已删 | — |
| D-05 | 弹层选中态表达不同 | ✅ | `A-ui/screen/NewSessionScreen.kt:156-160/175-179/208-212` 尾部 Check / `src/pages/new/index.tsx:140,154,178` 选中行画 `Icon name='check'` | — |
| D-06 | 「不指定工作区」重复点击会重建会话 | ✅ | `A-ui/screen/NewSessionScreen.kt:151-154` / `src/pages/new/index.tsx:131-135` `if (workspaceId !== undefined) void prepare(undefined)` | — |
| D-07 | 工作区行重复点击会重建会话 | ✅ | `A-ui/screen/NewSessionScreen.kt:165-170` / `src/pages/new/index.tsx:146-149` `if (item.workspaceId !== workspaceId)` | — |
| D-08 | 预设行重复点击重复下发 | ✅ | `A-ui/screen/NewSessionScreen.kt:193-203` `if (!selected)` / `src/pages/new/index.tsx:170-173` `if (entry.id !== presetId)` | — |
| D-09 | 页面标题不同 | ⚠️ | `A-ui/screen/NewSessionScreen.kt:70-77` `title = {}`（刻意留空） / `src/pages/new/index.tsx` 已删 `setNavTitle`，但 `src/pages/new/index.config.ts:2` 仍 `navigationBarTitleText: '新建会话'` | 已落地的一半：运行时不再设标题。差的一半：导航栏仍显示写死的中文「新建会话」，英文环境也不变；若要 1:1 对齐应把页面配置标题置空（或至少本地化） |
| D-10 | 加载态表现不同 | ✅ | `A-ui/screen/NewSessionScreen.kt:124-125` CircularProgressIndicator / `src/pages/new/index.tsx:69-73` `Icon name='loader-circle' spin` | — |
| D-11 | 会话就绪后正文内容不同 | ✅ | `A-ui/screen/NewSessionScreen.kt:124-142`（就绪时空 Box） / `src/pages/new/index.tsx:87-91` 就绪返回 `null`，占位文案已删 | — |
| D-12 | 发出第一条消息后的去向不同 | ✅ | `A-ui/App.kt:102-112` navigate(chat) + popUpTo("new"){inclusive} / `src/pages/new/index.tsx:114-121` `openPage(pageRoutes.CHAT,{sessionId:created}, true)`；`src/framework/page.ts:10-18` 第三参即 `redirectTo`（替换当前页） | — |
| D-13 | 页面每次显示都重新 prepare | ✅ | `A-ui/screen/NewSessionScreen.kt:55-60` `LaunchedEffect(Unit)` / `src/pages/new/index.tsx:37-42` 已从 `useDidShow` 换成空依赖 `useEffect` | — |
| D-14 | 工作区/预设弹层高度不同 | ✅ | `A-ui/screen/NewSessionScreen.kt:148/189` `heightIn(max = 480.dp)` / `src/pages/new/index.module.scss:84` `max-height: 480px` | — |
| D-16 | 设置页缺少标题栏 | ✅ | `A-ui/screen/SettingsScreen.kt:55-56` `TopAppBar(title = Strings.settings)` / `src/pages/settings/index.tsx:63-65` `setNavTitle(Strings.settings)`（随 locale 重跑） | — |
| D-17 | 「新增服务」入口位置与形态 | ✅ | `A-ui/screen/SettingsScreen.kt:63-67`（标题栏右上角加号） / `src/pages/settings/index.tsx:135-140` 移到页首第一张卡片（不再需要滚到底） | 备注：形态仍是整行而非导航栏图标，属小程序无自定义导航栏的等价替换 |
| D-18 | 「新增服务」多点一次 toast | ✅ | `A-ui/screen/SettingsScreen.kt:64-66` 无 toast / `src/pages/settings/index.tsx:136` 只 `openPage(pageRoutes.PAIRING)` | — |
| D-19 | 语言/主题选择的选中指示缺失 | ✅ | `A-ui/screen/SettingsScreen.kt:137-167`+`:229-234`（选中项 Check） / `src/pages/settings/index.tsx:99-127` ActionSheet 文案带 `'✓ '` 前缀 | — |
| D-20 | 删掉最后一台机器后的行为 | ✅ | `A-ui/screen/SettingsScreen.kt:50-51` `LaunchedEffect(empty){ onBack() }` / `src/pages/settings/index.tsx:69-71` `if (profiles.length === 0) back()`，列表页 `src/pages/index/index.tsx:409-415` 接手引导页 | — |
| D-21 | 「最近连接」时间格式不同 | ✅ | `A-ui/screen/SettingsScreen.kt:126-130` `yyyy-MM-dd HH:mm` / `src/pages/settings/index.tsx:40-45,181` 自写 `formatTimestamp` 同格式，`toLocaleString` 已删 | — |
| D-22 | 重连状态点颜色不同 | ✅ | `A-ui/screen/SessionListScreen.kt:465-474`（RECONNECTING/Connecting 同为琥珀） / `src/pages/settings/index.tsx:26-32` `'connecting' || 'reconnecting'` → `dotPending`；`src/state/appModel.ts:252` 确实会产出 `kind:'reconnecting'` | — |
| D-23 | 服务列表分组标题仅小程序有 | ✅ | `A-ui/screen/SettingsScreen.kt:78-134`（机器列表无段标题，只有 currentServer / appearance） / `src/pages/settings/index.tsx` 已无 `Strings.servers` 段标题（全仓仅 `serversEmpty` 在用，:143） | — |
| D-24 | 移除确认按钮不是危险色 | ✅ | `A-ui/screen/SettingsScreen.kt:177-182` `color = colorScheme.error` / `src/pages/settings/index.tsx:86-97` `confirmColor: '#dc2626'` | — |
| D-26 | 深色/浅色主题实际未生效 | ✅ | `A-ui/theme/Theme.kt:53-67` / `src/state/theme.ts:28-48`（解析 + 导航栏配色）、`src/styles/theme.scss:10-24`（深色 `--dsh-*` 覆盖）、`src/styles/vars.scss`（浅色默认）、`src/app.tsx:53` 挂 `dsh-theme-dark`、`src/framework/hook.ts:73-76`；`settings.chooseThemeMode` → `applyTheme`（`src/state/settings.ts:82-86`） | — |
| D-27 | 设置项还包含列表排序偏好 | ✅ | `A-state/AppSettings.kt:22-62`（只有 locale/themeMode） / `src/state/settings.ts:15-19` 只剩 `locale`+`themeMode`，`dsh.sort` 已删；列表排序改存在列表页（`src/pages/index/index.tsx:30-31` `dsh.listGroupBy`/`dsh.listOrderBy`） | — |
| D-28 | 配对页形态：全屏弹窗 vs 独立页 | ✅ | `A-ui/screen/PairingScreen.kt:75-90`（Dialog + TopAppBar 标题/关闭/切换） / `src/pages/pairing/index.tsx:25-29` `setNavTitle(Strings.pairTitle)`，模式切换见 :91-104 | 备注：仍无页内关闭键，依赖微信原生返回；结构差异是已记录的平台差异 |
| D-29 | 扫码/粘贴缺少模式切换 | ✅ | `A-ui/screen/PairingScreen.kt:84-88,97-122`（manual 互斥） / `src/pages/pairing/index.tsx:23,91-144` `scanning` 状态互斥渲染扫码卡片或粘贴卡片 | — |
| D-30 | 扫码提示的呈现方式不同 | ✅ | `A-ui/screen/PairingScreen.kt:59-64` 进入 toast 一次 / `src/pages/pairing/index.tsx:25-29` `toast(Strings.scanHint)`，常驻 `.tip` 文本已删 | — |
| D-31 | 相机权限与「无可用相机」降级缺失 | ✅ | `A-ui/screen/PairingScreen.kt:45-57,108-112` `Strings.scanUnavailable` / `src/pages/pairing/index.tsx:79-86` 区分 cancel 与失败，失败设 `Strings.scanUnavailable`，:117-121 给「去粘贴」入口；文案 `src/i18n/strings.ts:32` 与安卓逐字一致 | — |
| D-32 | 电脑名确认缺少说明脚注 | ✅ | `A-ui/screen/PairingScreen.kt:129-146` `Strings.serverNameFooter` / `src/pages/pairing/index.tsx:106-108` 页面上给出脚注（showModal 放不下），`src/i18n/strings.ts:57` 不再是死文案 | — |
| D-33 | 密钥生成失败用了「配对码无效」文案 | ✅ | `A-state/ServerProfileStore.kt:103-110`（无此失败路径） / `src/pages/pairing/index.tsx:53-57` 改为 `Strings.operationFailed` | — |
| D-34 | 配对成功后的连接行为不同 | ✅ | `A-ui/App.kt:128-133` add 后立即 connect / `src/pages/pairing/index.tsx:59-68` `profileStore.add(...)` 后 `getAppModel().connectCurrent()`；`src/state/profileStore.ts:236` add 已把新资料设为 `currentId` | — |
| D-35 | 配对成功多一次 toast | ✅ | `A-ui/screen/PairingScreen.kt:128-146` 无成功 toast / `src/pages/pairing/index.tsx:64-68` `toast(Strings.statusConnected)` 已删（注释说明原因） | — |
| D-38 | 引导页缺少顶部标题栏 | ✅ | `A-ui/screen/OnboardingScreen.kt:18` CenterAlignedTopAppBar(appName) / 小程序由原生导航栏承担：`src/pages/index/index.tsx:168-170` 未配对时 `setNavTitle(Strings.appName)` | 备注：等价实现，源码未新增页内标题栏；如需 1:1 需补页内标题区 |
| D-39 | 图标与排版度量不同 | ⚠️ | `A-ui/screen/OnboardingScreen.kt:23-39`：容器 `padding(32.dp)`、图标 56dp、间距 16/8/24 / `src/ui/onboarding.module.scss:15-17` 图标已改 56px ✅；但 `:4-12` `.page{padding:72px 32px; gap:16px}` 叠加 `.title{margin-top:8px}`(:21)、`.primary{margin-top:24px}`(:35) 后实际间距是 24/16/40 | 已落地的一半：图标尺寸。差的一半：间距被 flex `gap` 叠加成两倍量级；建议去掉 `gap`、只保留逐元素 margin（16/8/24），并把 `.page` 纵向内边距对到 32px |
| D-41 | 系统语言回退方向相反 | ✅ | `A-i18n/Strings.kt:27-30`（只有 en 算英文，其余中文） / `src/state/settings.ts:24-34` `language.startsWith('en') ? 'en' : 'zh'`，异常也回退 `zh` | — |
| D-42 | 运行期系统语言变化未刷新 | ✅ | `A-state/AppSettings.kt:34-37` / `src/app.tsx:31-37` `useDidShow` 里调用 `settings.refreshSystemLocale()`；实现见 `src/state/settings.ts:88-91` | — |
| D-43 | mini 缺失 16 个安卓文案键 | ✅ | `A-i18n/Strings.kt:41-42,139-142,235,251-252,322-333` / `src/i18n/strings.ts` 全部补齐：scanUnavailable:32、imageUnavailable:210、imageOpenFailed:212、accessRead/Write/Full:214-216、copyAction:146、messageBranch:148、notifyApproval/Question/Done/Failed:222-225、turnFailureAuthInvalid:218、turnFailureFallback:220、notifyServiceRunning:226、notifyServiceDescription:227（16/16） | — |
| D-44 | 三处文案措辞不一致 | ✅ | `scanHint`：`A-i18n/Strings.kt:41` = `src/i18n/strings.ts:31`（「请扫描DSH匹配二维码」逐字一致）；`newSessionPlaceholder`：`A-…:245` `"New Session"` = `strings.ts:88`；`unavailableArchivedSessions`：`A-…:172-173` = `strings.ts:200` | — |
| D-45 | 图标缺少无障碍标签 | ✅ | `A-ui/screen/SettingsScreen.kt:65,108,113`、`A-ui/screen/PairingScreen.kt:82` / `src/ui/icon.tsx:20-32` 新增 `ariaLabel`（缺省 `aria-hidden`）；`src/pages/settings/index.tsx:137,161,167` 新增/重命名/移除均带标签；配对页改为纯文字按钮无图标 | 备注：与 A-03/A-20/A-24 同源，微信读屏实际暴露仍需真机验证 |
| D-46 | 度量常量集不完整 | ✅ | `A-ui/theme/Theme.kt:17-32`（13 项） / `src/const.ts:18-33` 13 项逐一对齐（含 messageTopInset / chromeRowHeight / iconSlot / listRowPadding / stripRowHeight / stripIconSlot / stripSpacing） | — |

---

## 验收方法备注

- 每条都实际打开了双侧源码文件（安卓 8 个 screen/state/theme/i18n 文件，小程序 20+ 个页面/状态/样式文件），并对「改动是否被后续改动覆盖」做了针对性检查：例如 D-09 的 `setNavTitle` 虽已删除，但页面配置里的标题仍然生效，因而判为部分落地。
- 三条 ⚠️ 都属于「改了一半」而非「改错方向」，无需回滚，补齐即可。
- 本次验收未发现 ❌（未落地/改反）的条目；标 `[~]` 的条目不在本次范围内。

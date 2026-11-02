# App 外壳 / 新建会话 / 设置 / 配对 / 引导页 / 自定义标题栏 审计（第三轮）

- 小程序：`/Users/user/dshapp/dsh-miniapp`
- 安卓（权威口径）：`/Users/user/dshapp/dsh-androidapp`
- 方法：只读两边**当前**源码逐行比对；历史文档（`docs/DIFF-ANDROID*.md`、`docs/audit/D-new-settings.md`、`docs/CUSTOM-NAVBAR.md`）仅作线索，结论一律回源码复核。
- 覆盖：Android `ui/App.kt`、`ui/screen/NewSessionScreen.kt`、`SettingsScreen.kt`、`PairingScreen.kt`、`OnboardingScreen.kt`、`MainActivity.kt`；小程序 `src/app.tsx`、`app.config.ts`、`route.ts`、`pages/new|settings|pairing/index.tsx(+scss)`、`ui/onboarding.tsx(+scss)`、`ui/navBar.tsx(+scss)`、`framework/navbar.ts`、`model/navBarMetrics.ts`。

## 概览

| 编号 | 差异一句话 | 安卓位置 | 小程序位置 | 优先级 | 建议 |
| --- | --- | --- | --- | --- | --- |
| E-01 | 设置页「移除配对」图标用 x（关闭语义），安卓是 Delete 垃圾桶；且点击会冒泡到整行、把该机切成当前连接（修正历史文档「已对齐」的说法） | `SettingsScreen.kt:111-118` | `pages/settings/index.tsx:166-171` | P1 | 补 trash 图标并替换；图标按钮的 `onClick` 加 `event.stopPropagation()` |
| E-02 | 重命名弹层用 wx.showModal，没有预填初始名（content 是只读正文），空串会被静默丢弃 | `SettingsScreen.kt:186-199` | `pages/settings/index.tsx:70-81` | P1 | 自绘弹层，输入框 value 预填 profile.name |
| E-03 | 移除确认弹层用 wx.showModal，取消按钮文案与颜色由微信系统语言决定 | `SettingsScreen.kt:172-185` | `pages/settings/index.tsx:83-94` | P1 | 自绘弹层，取消用 Strings.cancel |
| E-04 | 配对命名弹层同样用 wx.showModal，Mac 自报名被当成只读正文、输入框是空的 | `PairingScreen.kt:128-146` | `pages/pairing/index.tsx:39-46` | P1 | 自绘输入弹层，初值 suggestedName |
| E-05 | 设置页机型行高 52px（约 26dp），安卓 ListItem 56dp；勾槽 22px 对安卓 24dp | `SettingsScreen.kt:86-92` | `pages/settings/index.module.scss:25-42` | P2 | 行 min-height:56px、padding 0 16px；勾槽 24px |
| E-06 | 机型行多一行 proxy 地址（安卓没有 supportingContent，只有机型名） | `SettingsScreen.kt:80-121` | `pages/settings/index.tsx:155-158` | P1 | 删 .address 保持单行；或标注为刻意增强 |
| E-07 | 编辑/删除图标热区约 27x27px，安卓 IconButton 最小 48dp | `SettingsScreen.kt:107-118` | `pages/settings/index.module.scss:96-104` | P1 | 图标按钮给 44x44 最小热区 |
| E-08 | 设置页逐行画全宽分隔线，安卓连续 ListItem 无分隔线 | `SettingsScreen.kt:78-122` | `pages/settings/index.module.scss:33-35` | P2 | 去掉或改缩进分隔线 |
| E-09 | 配对页「电脑名称」脚注常驻页顶，安卓只在命名弹层里 | `PairingScreen.kt:133-136` | `pages/pairing/index.tsx:107-110` | P2 | 随命名弹层一起移入 |
| E-10 | 配对页无「相机不可用」前置态：安卓未授权即显示 scanUnavailable，小程序只在点击扫码失败后才提示 | `PairingScreen.kt:108-112,55-64` | `pages/pairing/index.tsx:74-87,112-124` | P1 | 进入扫码态先 wx.getSetting 检查 scope.camera，被拒直接进粘贴态（API 可用，不是平台限制） |
| E-11 | 新建会话失败视图多出安卓没有的「关闭」动作 | `NewSessionScreen.kt:126-141` | `pages/new/index.tsx:88-97` | P2 | 删掉第三个动作 |
| E-12 | 工作区/预设胶囊图标用 folder-tree / puzzle，安卓是 Folder / Layers；max-width 200px 偏窄 | `NewSessionScreen.kt:95,103` | `pages/new/index.tsx:112,119` + `index.module.scss:62` | P2 | 换语义更近的图标（需补子集）；宽度提到约 160dp |
| E-13 | 新建会话失败态正文与按钮行间距 12px、按钮为描边胶囊，安卓是 8dp + TextButton | `NewSessionScreen.kt:126-141` | `pages/new/index.module.scss:12-40` | P2 | gap 8px；.action 去边框底色改纯文字 |
| E-14 | 引导页图标 qr-code（描边）对安卓 QrCodeScanner（实心+扫描线）；标题 17px 对 headlineSmall | `OnboardingScreen.kt:27-38` | `ui/onboarding.tsx:26-35` + `onboarding.module.scss:24-42` | P2 | 标题可提到约 20px；图标可接受 |
| E-15 | 自绘标题栏默认画底部分隔线；安卓 TopAppBar 默认无分隔线（设置/配对/列表等页都多一条） | `SettingsScreen.kt:53-69`、`NewSessionScreen.kt:68-77` | `ui/navBar.tsx:41-42,62` + `navBar.module.scss:38-40` | P2 | 默认不画；或统一显式传 divider={false} |
| E-16 | 顶栏图标按钮 40px、标题 18px/500，安卓 IconButton 48dp、titleLarge 约 22sp | 全部 TopAppBar | `ui/navBar.module.scss:69-78,98-118` | P2 | 热区提到 44px；标题可提到 20px |
| E-17 | 设置页分区标题 12px + letter-spacing 0.04em、下内边距 6px，安卓 labelLarge 14sp 无字距、4dp | `Sheets.kt:410-417` | `pages/settings/index.module.scss:11-16` | P2 | 去 letter-spacing，字号 13px，下内边距 4px |
| E-18 | 连接横幅 tone 只读 connectionStore，不读 socketStateStore；重连与失败竞争时文案可能与安卓相反 | `ConnectionBanner.kt:118-132` | `state/connection.ts:49-61` + `app.tsx:60-64` | P1 | tone 叠一层 socketState==='reconnecting' -> 'connecting' |
| E-19 | 引导页两个入口都进配对页（安卓也两个都 onScan），等价，仅记录 | `OnboardingScreen.kt:38-39` | `ui/onboarding.tsx:30-35` | — | 无 |

## 逐条详情

### E-01 设置页「移除配对」图标语义 + 点击冒泡（P1）

* **证据**
  * 安卓 `ui/screen/SettingsScreen.kt:107-118`：
```kotlin
    IconButton(onClick = { renaming = profile }) {
        Icon(Icons.Default.Edit, Strings.serverRename, Modifier.size(18.dp))
    }
    IconButton(onClick = { removing = profile }) {
        Icon(Icons.Default.Delete, Strings.serverRemove, Modifier.size(18.dp), MaterialTheme.colorScheme.error)
    }
```
    整个 `ListItem` 本身不可点，没有「点行切换当前机」这回事。
  * 小程序 `src/pages/settings/index.tsx:149-172`：
```tsx
    <View
      className={styles.row + (index < profiles.length - 1 ? ' ' + styles.rowDivider : '')}
      onClick={() => getAppModel().connectProfile(profile)}
    >
      ...
      <Icon name='pencil' className={styles.iconButton} ariaLabel={Strings.serverRename}
        onClick={() => renameProfile(profile)} />
      <Icon name='x' className={styles.iconButton + ' ' + styles.iconDanger}
        ariaLabel={Strings.remove} onClick={() => removeProfile(profile)} />
    </View>
```
  * `src/ui/lucideIcons.ts:9-76` 的码点表里没有 `trash` / `trash-2`，只有 `x`、`ban` 等。
* **差异**
  1. 图标语义：`x` 是「关闭/清除」，安卓是明确的垃圾桶；`ariaLabel` 用 `Strings.remove`（移除），安卓是 `Strings.serverRemove`（移除配对）。
  2. **点击冒泡**：`Icon` 只挂 `onClick`，没有 `event.stopPropagation()`。仓库里 `src/pages/archived/index.tsx:112` 已经证明 Taro 的事件对象有 `stopPropagation`。于是在设置页点「移除」会**先**触发整行的 `connectProfile(profile)`，把该机切成当前连接，然后才弹移除确认框；即便用户取消，当前机也已经被换掉。安卓不存在这条路径。
* **建议**
  1. 走 `scripts/build-icons.mjs` 给子集补垃圾桶图标并替换；`ariaLabel` 改 `Strings.serverRemove`。
  2. 两个图标按钮的 onClick 都加 `event => { event.stopPropagation(); removeProfile(profile); }`（编辑同理），与 `archived/index.tsx:112` 同写法。
* **风险/不确定**：扩图标要重建 `src/styles/lucide.scss` 的 woff2 子集，漏掉会显示豆腐块，**需构建验证**。冒泡修复后需回归「点行切换机器」仍然生效。

### E-02 / E-03 / E-04 三个系统弹层替身（P1）

* **证据**
  * 安卓重命名 `SettingsScreen.kt:186-199`：`AlertDialog` + `OutlinedTextField(nameDraft, singleLine = true)` + 确认 `Strings.submit` + 取消 `Strings.cancel`；点击编辑时先 `nameDraft = profile.name`（`SettingsScreen.kt:107`）。
  * 安卓移除 `SettingsScreen.kt:172-185`：标题 `serverRemove`、正文 `profile.name + " · " + serverRemoveMessage`、确认 `remove`（error 色）、取消 `cancel`。
  * 安卓配对命名 `PairingScreen.kt:128-146`：`OutlinedTextField(name)` + `serverNameFooter`，确认 `connect`、取消 `cancel`；`name` 在 `handle` 里预填 `PairingPayload.suggestedName(text)`（`PairingScreen.kt:71`）。
  * 小程序 `pages/settings/index.tsx:70-81`：
```tsx
    wx.showModal({
      title: Strings.serverRename,
      content: profile.name,          // content 是只读正文，不是输入框初值
      editable: true,
      placeholderText: Strings.serverName,
      success: res => { if (res.confirm) profileStore.rename(profile.id, res.content ?? ''); },
    });
```
  * 小程序 `pages/settings/index.tsx:83-94`：`content: name + ' · ' + serverRemoveMessage`、`confirmText: Strings.remove`、`confirmColor: '#dc2626'`，没有 `cancelText`。
  * 小程序 `pages/pairing/index.tsx:39-46`：`content: suggested`、`editable: true`、`placeholderText: Strings.serverName`。
* **差异**
  1. `wx.showModal` 的 `content` 在 `editable:true` 下是**只读正文**，输入框是空的（只有 placeholder）。安卓明确预填「当前名 / Mac 自报名」。小程序 `rename` 对空串直接 return（`profileStore.ts:240-248`），配对则兜底成 `Strings.appName`。用户必须重打全名。
  2. 小程序重命名弹层没有字段标签，安卓是带 `OutlinedTextField` 的结构化对话框。
  3. 移除弹层确认文案与安卓一致（`remove`），但取消文案由微信系统语言决定，与界面语言 `Strings.cancel` 可能不一致。
  4. `confirmColor: '#dc2626'` 是硬编码十六进制，绕开 `--dsh-color-bad`，与 `src/styles/vars.scss:6` 的约定冲突（深色弹窗里问题不大）。
* **建议**：三处改用仓库已有的自绘弹层壳（`src/ui/sheets.tsx` + `sheets.module.scss:5-65` 的 `backdrop`/`sheet`）：
  - 设置页重命名：输入框 value 预填 `profile.name`，确认 `Strings.submit`、取消 `Strings.cancel`。
  - 设置页移除：标题/正文/确认色与安卓一字不差。
  - 配对命名：value 预填 `suggestedName`，下方常驻 `serverNameFooter`，确认 `connect`。
  这样 E-09 的脚注也一起回到命名弹层里。
* **风险/不确定**：自绘弹层要自己管键盘与 `adjustPosition`，命名弹层弹出时要确保没有残留的相机/遮罩。**需真机验证输入法不遮弹层。**

### E-05 设置页行高与勾槽尺寸（P2）

* **证据**
  * 安卓 `SettingsScreen.kt:86-92`：`leadingContent = { Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) { ... } }`；整行是 M3 `ListItem`（单行最小 56dp）。
  * 小程序 `pages/settings/index.module.scss:25-42`：`.row { min-height: 52px; padding: 0 14px; gap: 10px; }`、`.check { width: 22px; }`。
  * 编译产物 `dist/pages/settings/index.wxss` 里对应 `min-height:104rpx`、`width:44rpx`（`rpx = px * 2`）。
* **差异**：52px 约合 26dp 级别，低于安卓 `ListItem` 的 56dp；勾槽 22px 低于安卓 24dp。
* **建议**：`.row { min-height: 56px; padding: 0 16px; gap: 12px; }`、`.check { width: 24px; font-size: 18px; }`；顺带删掉未使用的 `.checkPlaceholder`（`index.module.scss:44-47`）。
* **风险/不确定**：px 与 dp 的映射随机型 `rpx` 基准变化，需在 iPhone X 与安卓模拟器各看一次。

### E-06 设置页多一行 proxy 地址（P1）

* **证据**
  * 安卓 `SettingsScreen.kt:80-121` 的机型行只有 `headlineContent = { Text(profile.name) }`、`leadingContent`（勾）、`trailingContent`（状态点 + 编辑 + 删除），**没有** supportingContent。
  * 小程序 `pages/settings/index.tsx:155-158`：
```tsx
    <View className={styles.identity}>
      <Text className={styles.name}>{profile.name}</Text>
      <Text className={styles.address}>{profile.proxyHost + ':' + profile.proxyPort}</Text>
    </View>
```
  * 注释 `pages/settings/index.module.scss:68` 自述这是小程序侧增强（「机器名认不出是哪台中转」）。
* **差异**：多一行地址，行高与整页纵向节奏与安卓不同；安卓当前设置页完全不显示地址。
* **建议**：以安卓为准时删掉 `.address` 与对应 `<Text>`；若产品确认保留，在概览里标注为「已确认的刻意差异」。
* **风险/不确定**：无。

### E-07 设置页图标按钮热区（P1）

* **证据**
  * 安卓 `SettingsScreen.kt:107-118`：两个 `IconButton`（M3 默认 48dp 最小触摸目标），内部图标 18dp。
  * 小程序 `pages/settings/index.module.scss:96-104`：`.iconButton { padding: 6px 8px; font-size: 15px; }`，约 15px 字形 + 12px 横 + 12px 纵。
* **差异**：触摸目标约 27x27px，远小于安卓 48dp，也小于通用的 44dp 建议值。
* **建议**：`.iconButton { display:inline-flex; align-items:center; justify-content:center; width:44px; height:44px; padding:0; font-size:18px; }`，并确认 `.row` 行高能容纳。
* **风险/不确定**：与 E-05 一起改，避免行高被撑破。

### E-08 设置页行分隔线（P2）

* **证据**
  * 小程序 `pages/settings/index.tsx:151` 给除最后一行外的每行加 `styles.rowDivider`；`index.module.scss:33-35` 是一条全宽 1px `border-bottom`。
  * 安卓 `SettingsScreen.kt:78-122` 是连续的 `ListItem`，没有 `HorizontalDivider`。
* **差异**：小程序多出逐行分隔线。可读性更好，但与安卓口径不同。
* **建议**：保留则标注为刻意差异；要 1:1 就去掉。
* **风险/不确定**：无。

### E-09 配对页脚注位置（P2）

* **证据**
  * 安卓 `PairingScreen.kt:133-136`：`serverNameFooter` 在命名 `AlertDialog` 的正文里。
  * 小程序 `pages/pairing/index.tsx:107-110`：`<Text className={styles.footerNote}>{Strings.serverNameFooter}</Text>` 常驻 `.body` 顶部；`index.module.scss:96-101` 注释自述「安卓在对话框里，小程序放在页面上」。
* **差异**：文案一致、位置不同；扫码/粘贴两态都会看到本应属于命名步骤的说明。
* **建议**：随 E-02/E-04 的自绘命名弹层移回去。
* **风险/不确定**：无。

### E-10 配对页缺「相机不可用」前置态（P1）

* **证据**
  * 安卓 `PairingScreen.kt:45-57` 进页面即申请相机权限；`:108-112` 未授权时在手动输入列显示 `scanUnavailable`；`:60-64` 只在 `granted && !manual` 时 toast 一次 `scanHint`。
  * 小程序 `pages/pairing/index.tsx:74-87`：`scan` 调 `wx.scanCode`，`fail` 里区分 cancel 与其它错误，其它错误 `setError(Strings.scanUnavailable)`；`:117` 把 error 渲染在卡片里（所以文案路径存在，只是要等用户点一次）。
  * 小程序 `app.config.ts:16-20` 已声明 `scope.camera`。
* **差异**：安卓是「进页面就知道没有相机，直接给粘贴入口」；小程序要等用户点扫码、被拒/失败后才提示。
* **建议**：进入扫码态时先 `wx.getSetting()` 读 `authSetting['scope.camera']`：已明确拒绝就直接切粘贴态并显示 `scanUnavailable`；未决则照常。`wx.getSetting`/`wx.authorize` 都是可用 API，**这不是平台限制**。
* **风险/不确定**：`wx.scanCode` 在开发者工具里不走真机相机，**需真机验证**。

### E-11 新建会话失败视图多「关闭」（P2）

* **证据**
  * 安卓 `NewSessionScreen.kt:126-141`：失败态是 `Text(lastErrorMessage ?: noWorkspace)` + 一行两个 `TextButton`：`workspace`、`retry`。顶栏已有返回键。
  * 小程序 `pages/new/index.tsx:88-97`：三个动作 `workspace` / `retry` / `close`。
* **差异**：多一个「关闭」。
* **建议**：删掉 `pages/new/index.tsx:95` 那一行。
* **风险/不确定**：无。

### E-12 工作区/预设胶囊图标与宽度（P2）

* **证据**
  * 安卓 `NewSessionScreen.kt:92-105`：工作区 `AssistChip(leadingIcon = Icon(Icons.Default.Folder, null, Modifier.size(16.dp)))`，预设 `Icons.Default.Layers`，标签 `maxLines = 1, overflow = Ellipsis`。
  * 小程序 `pages/new/index.tsx:112,119`：`name='folder-tree'` / `name='puzzle'`；`index.module.scss:62`：`.chip { max-width: 200px; }`。
* **差异**：图标语义不同（folder-tree/puzzle 对 Folder/Layers）；200px 上限偏窄，长工作区名更早省略。
* **建议**：换图标（需扩 `lucideIcons.ts` 子集）或至少把 `max-width` 提到约 160dp（≈320px）。若扩图标，用 `scripts/build-icons.mjs` 重建。
* **风险/不确定**：扩子集需重新编译 woff2 并验证不出现豆腐块。

### E-13 新建会话失败态间距与按钮形态（P2）

* **证据**
  * 安卓 `NewSessionScreen.kt:126-141`：`Column(Modifier.padding(32.dp), CenterHorizontally, spacedBy(8.dp))`，按钮行再 `spacedBy(8.dp)`，按钮是 `TextButton`（纯文字）。
  * 小程序 `pages/new/index.module.scss:12-40`：`.body { padding: 32px; }`（无 gap）、`.actions { gap: 12px; margin-top: 12px; }`、`.action { padding: 8px 18px; border-radius: 18px; border: 1px solid ...; background: #ffffff; }`。
* **差异**：文案与按钮行间距 12px（安卓 8dp）、按钮之间 12px（安卓 8dp）；按钮是有边框底色的胶囊，安卓是纯文字 `TextButton`。
* **建议**：`.body { gap: 8px; }`、`.actions { gap: 8px; margin-top: 0; }`；`.action` 去边框与底色，改 `color: var(--dsh-color-primary)`。
* **风险/不确定**：无。

### E-14 引导页视觉（P2）

* **证据**
  * 安卓 `OnboardingScreen.kt:27-38`：`Icon(Icons.Default.QrCodeScanner, null, Modifier.size(56.dp), MaterialTheme.colorScheme.primary)`；标题 `headlineSmall`；正文 `bodyMedium` center；`Button(scanQR)` + `TextButton(pastePairing)`；间距 16/8/24，内边距 32dp。
  * 小程序 `ui/onboarding.tsx:26-35`：`Icon name='qr-code'` + 标题 + 正文 + `View.primary` + `Text.secondary`；`onboarding.module.scss:24-65`：`.glyph { font-size:56px; }`、标题 17px/600、正文 13px center、`.primary` 高 44px 圆角 22px、`.secondary` 14px。
* **差异**：图标形状不同（描边对实心）；标题字号偏小；spacing 与 padding 与安卓一致（16/8/24、32）。
* **建议**：标题可提到约 20px；图标可接受（`qr-code` 与扫码语义相符）。若扩子集，换成更接近的实心 QR 图标。
* **风险/不确定**：Material3 的确切 sp 值随设备 fontScale，WXSS 无法精确复刻，**需开发者工具目测**。

### E-15 标题栏分隔线默认值（P2）

* **证据**
  * 小程序 `ui/navBar.tsx:41-42` 注释自述「安卓 TopAppBar 默认无分隔线，滚动时才有；这里默认画」；`navBar.module.scss:38-40` 是 `border-bottom: 1px solid var(--dsh-color-border)`。
  * 只有 `pages/new/index.tsx:75` 与 `ui/onboarding.tsx:25` 传了 `divider={false}`；列表/聊天/归档/设置/配对/卡片详情全用默认值 → 都画线。
* **差异**：安卓 M3 `TopAppBar` 默认 `containerColor = surface`、没有 border；小程序在多数页面顶部多一条 1px 线。
* **建议**：把 `divider` 默认改成不画（或反转判断），需要时显式开启。
* **风险/不确定**：M3 `TopAppBar` 是否在个别版本内置 divider 取决于依赖版本，**如需精确口径要查 gradle 锁定的 Material3 版本**。

### E-16 顶栏按钮与标题尺寸（P2）

* **证据**
  * 小程序 `ui/navBar.module.scss:98-118`：`.iconButton { width:40px; height:40px; }`、`.icon { font-size:20px; }`；`:69-78`：`.title { font-size:18px; font-weight:500; }`。
  * 安卓 `SettingsScreen.kt:55-68`、`NewSessionScreen.kt:71-77`、`PairingScreen.kt:79-90` 都用默认 `IconButton`（48dp）与默认标题样式（`titleLarge` 约 22sp）。
* **差异**：图标热区与图标字号偏小；标题字号偏小、字重偏重。小程序 `@ui/navBar.tsx:91-94` 注释已给出「栏高 32-44px 撑不下 48dp」的约束。
* **建议**：图标按钮给 `min-width:44px; min-height:44px` 但保留 `max-height:100%`；标题可提到 20px。若坚持与胶囊中线对齐，热区只能到 44px 左右。
* **风险/不确定**：`.row` 高度由 JS 写死（`navBar.tsx:69-70`），加高会被 `max-height` 压回，**需实测**。

### E-17 设置页分区标题（P2）

* **证据**
  * 小程序 `pages/settings/index.module.scss:11-16`：`.sectionTitle { padding:16px 16px 6px; font-size:12px; letter-spacing:0.04em; }`。
  * 安卓 `Sheets.kt:410-417`：`Modifier.padding(start=16.dp, top=16.dp, bottom=4.dp)` + `labelLarge` + `onSurfaceVariant`，无 letterSpacing。
* **差异**：字号偏小、多 0.04em 字距、下内边距 6px 对 4dp。
* **建议**：去 `letter-spacing`；字号可提到 13px；下内边距改 4px。
* **风险/不确定**：无。

### E-18 连接横幅漏读 socket 重连态（P1）

* **证据**
  * 安卓 `ui/component/ConnectionBanner.kt:118-132`：
```kotlin
    if (model.socketState == WsConnectionState.RECONNECTING || connection is Connection.Connecting) {
        return connectingBanner()          // 文案 statusConnecting
    }
    return when (connection) {
        is Connection.Failed -> offlineBanner()
        ...
    }
```
    即渲染时**同时**读 `socketState` 与 `connection`，重连优先于失败。
  * 小程序 `src/state/connection.ts:49-61` 的 `connectionBannerTone` 只 switch `connection.kind`；`src/app.tsx:60-64` 也只传 `connectionBannerTone(connection)`，全程不读 `socketStateStore`。
  * `src/state/appModel.ts:289-300` 把 `socketStateStore` 写入，并在非 connected 时把 `connectionStore` 覆盖成 `{kind:'reconnecting'}`；但 `refresh/runConnect` 的失败分支（`appModel.ts:357,385`）会把 `connectionStore` 置成 `failed`，两者只靠「后写者赢」。
* **差异**：安卓是「渲染时取并集、重连优先」；小程序是「单值竞争」。当 HTTP 刷新刚失败而 WebSocket 正在自愈时，两端文案可能相反（安卓「连接中…」，小程序「无法连接到电脑」）。
* **建议**：在 `app.tsx` 计算 tone 时叠一层：
```tsx
  const socket = useStore(socketStateStore);
  tone={socket === 'reconnecting' ? 'connecting' : connectionBannerTone(connection)}
```
  或把 socket 作为参数传进 `connectionBannerTone`。
* **风险/不确定**：`socketStateStore` 已是现成导出（`connection.ts:20`），改动很小；文案切换需真机断网观察。

## 附：与本区历史文档的对照（仅作线索）

| 历史条目 | 历史结论 | 本轮回源码结论 |
| --- | --- | --- |
| `audit/D` D-16 设置页缺标题栏 | 待修 | 已落地：`pages/settings/index.tsx:132-142` 有 `NavTitle(Strings.settings)` |
| `audit/D` D-18 新增服务入口位置 | 待修 | 已落地：右上角加号 `pages/settings/index.tsx:135-141`，对齐 `SettingsScreen.kt:63-67` |
| `audit/D` D-29 配对页模式切换 | 待修 | 已落地：`pages/pairing/index.tsx:95-105` 标题栏 `NavTextButton` |
| `audit/D` D-31/D-33 无相机 / 密钥失败文案 | 待修 | 文案已补（`index.tsx:84,56`），但**没有**无相机前置态（E-10） |
| `audit/D` D-34 配对成功后连接行为 | 待修 | 已落地：`index.tsx:59-68` `connectCurrent()`（不 toast） |
| `audit/D` D-38 引导页缺顶栏 | 待修 | 已落地：`ui/onboarding.tsx:25` 的 `centerTitle` 等价物 |
| `audit/D` 移除后自动返回 | 上一轮记「已对齐」 | 代码确实有 `[profiles.length]` 依赖，能工作；但同页 E-01 的冒泡问题历史文档完全没提，说明该结论不完整 |
| `CUSTOM-NAVBAR.md` 全部 | 自述已对齐 | 大体成立，但 E-15/E-16 的尺寸与分隔线仍是差异 |
| `DIFF-ANDROID-R2.md` 回补清单 | 自述已改 | 本区四条（引导页间距、新建会话兜底文案等）已落地 |

## 不确定 / 需验证清单

1. E-01：点击「移除/编辑」是否真的先冒泡触发整行 `connectProfile`——**需微信开发者工具实际点击复现**（Taro 事件冒泡行为）。
2. E-10：无相机 / 拒绝权限时的实际表现——**需真机**。
3. E-01/E-12：补图标需重建 lucide 字体子集，**需 build:weapp 验证**不出现豆腐块。
4. E-05/E-14/E-16：px 与 dp 的换算依赖机型 rpx 基准，**需在 iPhone X 与安卓模拟器各目测一次**。
5. E-15：安卓 TopAppBar 是否在个别版本带内置分隔线——需查本仓 gradle 锁定的 Material3 版本。

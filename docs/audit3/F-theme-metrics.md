# 区域 F：主题、颜色、字体、尺寸度量、图标、安全区与全局布局 审计（第三轮）

> 口径：以安卓仓 `/Users/user/dshapp/dsh-androidapp` 当前源码为正确一方；小程序仓 `/Users/user/dshapp/dsh-miniapp`。
> 本文所有结论均回源码逐行核对；历史文档只当线索，未采信其"已对齐"的自述。
>
> **两条贯穿全文的前提（影响判读，逐条仍按源码差异给出）**
> 1. 安卓 `DshTheme` 在 API 31+ 上走 `dynamicLightColorScheme/dynamicDarkColorScheme`（见 F-01 证据）。即：安卓真机的实际色板由壁纸/系统取色决定，只有 `primary` 在回退方案里被钉死。因此"miniapp 硬编码色板 == 安卓实际色"在动态取色机型上本就不可达；但对 API<31（回退方案）和安卓自己写死的语义色，仍可逐 hex 对齐，本文按此口径给差异。
> 2. 安卓用 `sp/dp`，小程序样式用 `px`。两端都把 `px` 当 `dp` 用（`DIMENS` 注释、`max-width:760px`、`padding:8px 16px` 与 `8.dp/16.dp` 一一对应），所以本文按 1px≈1dp 对比；实际渲染会受小程序 `px` 与系统字体缩放影响，标"需真机验证"处除外。

## 概览

| 编号 | 差异一句话 | 安卓位置 | 小程序位置 | 优先级 | 建议 |
| --- | --- | --- | --- | --- | --- |
| F-01 | 深色主题主色不同：#7FA8FF vs #7aa2f7 | `ui/theme/Theme.kt:47` | `src/styles/theme.scss:11` | P2 | 深色 primary 改为 `#7fa8ff` |
| F-02 | 语义色 good/bad/warning 与安卓写死的绿/红/橙不是同一个 hex | `ComposerBar.kt:245,656,709` / `ChangedFilesCard.kt:32-33` | `src/styles/vars.scss:14-16` | P1 | 按语义逐项对齐（`#2E7D32/#C62828/#E08600`） |
| F-03 | 深色下把语义色整组换成另一套，安卓这些色不随主题 | `ComposerBar.kt:709-711` | `src/styles/theme.scss:14-16` | P2 | 深色与浅色共用同一组语义色，或明确记录为增强 |
| F-04 | 中性色板不是 M3 取色结果（正文/次级/描边/底/卡片/边框全不同） | `ui/theme/Theme.kt:46-47` | `src/styles/vars.scss:18-23` | P2 | 至少对齐 M3 基线回退值；动态取色差异单列说明 |
| F-05 | `DshChrome.label / labelSubtle` 被 text-sub / text-faint 顶替 | `ui/theme/Theme.kt:38-44` | `src/ui/cards.module.scss:47-53` | P2 | 卡片行图标/摘要改用 outline 档 |
| F-06 | 空态图标色写死 `#c8ccd4`，不跟主题 | `EmptyState.kt:28` | `src/ui/emptyState.module.scss:15` | P2 | 改 `var(--dsh-color-text-faint)` 或新 outline 变量 |
| F-07 | 连接横幅底色/内容色写死 rgba，与 surfaceVariant/errorContainer 不一类 | `ConnectionBanner.kt:139-140,150-151` | `src/ui/connectionBanner.module.scss:26-32` | P2 | 用主题变量，不写死 rgba |
| F-08 | 计划芯片/会话徽标底色与文字色基色不一致 | `ComposerBar.kt:360,367` / `SessionListScreen.kt:870,873` | `src/ui/composerBar.module.scss` / `src/pages/index/index.module.scss:120-127` | P2 | 统一到 `#e08600` + 14% alpha |
| F-09 | `DIMENS` 13 项只用了 1 项，其余在 scss 里另写数值 | `ui/theme/Theme.kt:17-32` | `src/const.ts:24-39`、`src/ui/messageRow.tsx:135` | P1 | 让 scss 常量真正引用镜像值，或删掉假镜像 |
| F-10 | 转写水平内边距 12px，安卓 columnInset 16dp | `ChatScreen.kt:428` | `src/pages/chat/index.module.scss:52` | P1 | 水平 padding 改 16px |
| F-11 | 转写行间距 10px，安卓 rowSpacing 4dp | `ChatScreen.kt:429` | `src/pages/chat/index.module.scss:80` | P1 | row 间距改 4px |
| F-12 | 卡片行最小高 28px，安卓 chromeRowHeight 24dp | `Cards.kt:57` | `src/ui/cards.module.scss:18`、`src/ui/messageRow.module.scss:164` | P1 | min-height 改 24px |
| F-13 | 卡片行图标槽 18px/字号 13px，安卓 iconSlot 14dp | `Cards.kt:72,77` | `src/ui/cards.module.scss:22-28` | P1 | 槽宽 14px，字形按 14px 定 |
| F-14 | 目标条/队列条没有 44px 最小行高 | `ComposerBar.kt:726,815` | `src/ui/composerBar.module.scss:137-142,171-177` | P1 | 加 `min-height:44px` |
| F-15 | 气泡/正文顶部留白 6px，安卓 messageTopInset 8dp | `MessageRow.kt:107,312` | `src/ui/messageRow.module.scss:16,141` | P2 | 改 8px |
| F-16 | 正文/气泡字号 15px，安卓 bodyLarge 16sp | `Markdown.kt:182` / `MessageRow.kt:151` | `src/ui/markdown.module.scss:11`、`src/ui/messageRow.module.scss:37` | P2 | 正文改 16px |
| F-17 | 卡片摘要 13px/行高 18，安卓 labelMedium 12sp/16 | `Cards.kt:86` | `src/ui/cards.module.scss:32` | P2 | 改 12px/16px |
| F-18 | 顶栏标题 18px，安卓 TopAppBar titleLarge 22sp | `ChatScreen.kt:289` | `src/ui/navBar.module.scss:72` | P2 | 标题改 22px |
| F-19 | 空态内外边距/字号不同；历史错误态缺 CloudOff 图标 | `EmptyState.kt:24-33` / `ChatScreen.kt:544` | `src/ui/emptyState.module.scss:9-25`、`src/pages/chat/index.tsx:548-554` | P2 | padding 32px、标题 16px、描述 14px、错误态补 40px 图标 |
| F-20 | 引导页标题 17px，安卓 headlineSmall 24sp | `OnboardingScreen.kt:29` | `src/ui/onboarding.module.scss:31` | P2 | 标题改 24px |
| F-21 | 图标体系/尺寸：Material 显式 dp vs Lucide 字号；顶栏/横幅尺寸不同 | `ChatScreen.kt:293` / `ConnectionBanner.kt:202` | `src/ui/icon.module.scss:5-12`、`src/ui/navBar.module.scss:114-118` | P2 | 顶栏图标 24px；横幅仍用状态图标而非小圆点 |
| F-22 | 底部安全区/键盘：安卓由系统 inset 驱动，小程序只挂载时算一次 | `ComposerBar.kt:212` | `src/framework/hook.ts:52-65`、`src/ui/composerBar.tsx:802` | P1 | 统一 `env(safe-area-inset-bottom)` 并监听 resize |
| F-23 | 深色 class 挂在内层 View，`page` 背景仍是浅色 | `MainActivity.kt:34` / `Theme.kt:67` | `src/app.tsx:57`、`src/app.scss:13`、`src/styles/vars.scss:9` | P1 | 同步 page 底色/背景，别只靠内层 class |
| F-24 | 冷启动/H5 写死浅色底、全局 line-height/font-size 覆写 | `Theme.kt:61-66` | `src/app.config.ts:11-14`、`src/index.html:15-29` | P2 | 背景交给运行期主题；移除 `!important` 全局覆写 |
| F-25 | 平台限制：小程序读不到系统取色/动态色板 | `Theme.kt:61-66` | `src/state/theme.ts:19-26` | P2 | 明确记录；可给多套预设色板弥补 |
| F-26 | 代码块复制控件形态不同（圆形图标按钮 vs 文字胶囊） | `Markdown.kt:324-341` | `src/ui/markdown.module.scss:167-179` | P2 | 对齐 28px 圆 + 14px 图标 + 无文字 |
| F-27 | 引用块底/色条：底不是 surfaceVariant，条不透明、左内距 11 | `Markdown.kt:428-442` | `src/ui/markdown.module.scss:234-252` | P2 | 底改 surfaceVariant 34%，条 primary 45% 宽 3px 左内距 14px |

## 逐条详情

### F-01 深色主题主色不同

* **证据（安卓）** `app/src/main/java/ai/deepseek/dshphone/ui/theme/Theme.kt:46-47`
  ```kotlin
  private val LightScheme = lightColorScheme(primary = Color(0xFF1C64F2))
  private val DarkScheme = darkColorScheme(primary = Color(0xFF7FA8FF))
  ```
  浅色主色 `#1C64F2`（小程序 `vars.scss:10` 的 `#1c64f2` 完全一致）；深色主色是 `#7FA8FF`。
* **证据（小程序）** `src/styles/theme.scss:11`：`--dsh-color-primary: #7aa2f7;`
* **差异** 深色主色 `#7aa2f7` ≠ 安卓回退深色 `#7FA8FF`（R/G/B 都不等：122,162,247 vs 127,168,255）。注意安卓在 API31+ 上被动态取色覆盖，此差异在动态色机型上表现为"都不是对方那支蓝"。
* **建议** `theme.scss` 深色 primary 改 `#7fa8ff`；同时保留注释说明动态取色机型无法逐值对齐。
* **风险/不确定** 需在 API<31 安卓机或关掉动态取色的模拟器上验证回退色板；API31+ 无法复现。

### F-02 语义色与安卓写死的绿/红/橙不是同一个 hex

* **证据（安卓）** 多处写死同一语义色：
  - `ui/screen/ComposerBar.kt:708-711`：`"completed" -> Color(0xFF2E7D32)`、`else -> Color(0xFFE08600)`；`:656-657` 同值。
  - `ui/component/ChangedFilesCard.kt:32-33`：`AddedTint = Color(0xFF2E7D32)`、`DeletedTint = Color(0xFFC62828)`。
  - `ui/component/Cards.kt:402-403`：失败 run_code / STOPPED 用 `Color(0xFFE08600)`。
  - `ui/component/MessageRow.kt:77-78`：模型重试/长度上限 `Color(0xFFE08600)`。
  - `ui/screen/SessionListScreen.kt:469-471`：重连/连接中 `0xFFE08600`，已连接 `0xFF2E9E4F`。
* **证据（小程序）** `src/styles/vars.scss:14-16`
  ```scss
  --dsh-color-good: #16a34a;
  --dsh-color-bad: #dc2626;
  --dsh-color-warning: #d97706;
  ```
* **差异** 语义名一一对应、取值全不等：绿 `#16a34a` vs `#2E7D32`（已连接处安卓还有 `#2E9E4F`）；红 `#dc2626` vs `#C62828`；橙 `#d97706` vs `#E08600`。这会让"改动 +N/−N""待办完成/进行中""计划模式""模型重试"等同一语义在两端不同色。
* **建议** 把 `--dsh-color-good/bad/warning` 对齐为 `#2E7D32/#C62828/#E08600`（已连接单列一个变量或沿用 good），工具失败/停止沿用 warning。
* **风险/不确定** 安卓这几处是硬编码、不随深浅主题；若产品希望深色下提亮，需产品确认后再偏离。

### F-03 深色下语义色整组换色，安卓不随主题

* **证据（安卓）** `ComposerBar.kt:709-711` 等写死值没有 `isSystemInDarkTheme` 分支，浅/深色同值。
* **证据（小程序）** `src/styles/theme.scss:14-16`
  ```scss
  --dsh-color-good: #4ade80;
  --dsh-color-bad: #f87171;
  --dsh-color-warning: #fbbf24;
  ```
* **差异** 深色下语义色换成了另一组（更亮），与安卓固定 `#2E7D32/#C62828/#E08600` 不同；叠加 F-02 后深浅两端都不同。
* **建议** 与 F-02 一起处理：深浅共用同一组语义色；若确需深色提亮，作为"刻意增强"记录并给出对比度依据。
* **风险/不确定** 安卓在深色下直接用 `#2E7D32` 的对比度是否合规，需真机确认；这不改变"两端不一致"的结论。

### F-04 中性色板不是 M3 取色结果

* **证据（安卓）** `ui/theme/Theme.kt:46` 只覆盖 `primary`，其余角色取 Material3 默认：
  - 浅色：`onSurface/onBackground #1C1B1F`、`onSurfaceVariant #49454F`、`outline #79747E`、`outlineVariant #CAC4D0`、`surface/background #FFFBFE`、`surfaceVariant #E7E0EC`、`error #B3261E`。
  - 深色（`darkColorScheme` 默认）：`surface #1C1B1F`、`onSurface #E6E1E5`、`outline #938F99` 等；API31+ 则由动态取色整体替换。
* **证据（小程序）** `src/styles/vars.scss:18-23`：`text #1f2328`、`text-sub #6b7280`、`text-faint #9ca3af`、`bg #f5f6f8`、`card #ffffff`、`border #e5e7eb`。
* **差异** 小程序整套中性色是 Tailwind 味的一套，与安卓回退方案（M3 基线）逐项不同：`#1f2328≠#1C1B1F`、`#6b7280≠#49454F`、`#9ca3af≠#79747E`、`#f5f6f8≠#FFFBFE`、`#ffffff≠#FFFBFE`、`#e5e7eb≠#CAC4D0`。
* **建议** 若要求与安卓回退方案一致，按上表替换浅色中性色；深色同理按 `darkColorScheme` 基线。若保留现有灰阶，需在文档里写明"仅覆盖回退方案不覆盖动态取色"。
* **风险/不确定** 动态取色机型（API31+）上安卓用的是系统色，任何硬编码都无法逐值对齐；这一条本质是"回退方案不一致"。

### F-05 DshChrome.label / labelSubtle 被顶替

* **证据（安卓）** `ui/theme/Theme.kt:38-44`
  ```kotlin
  object DshChrome {
      val label: Color @Composable get() = MaterialTheme.colorScheme.outline
      val labelSubtle: Color @Composable get() = MaterialTheme.colorScheme.outline.copy(alpha = 0.7f)
  }
  ```
  用于卡片行图标与摘要（`Cards.kt:86-96` 的 `tint = DshChrome.label`、suffix 用 `DshChrome.labelSubtle`）。
* **证据（小程序）** `src/ui/cards.module.scss:47-53` 的 `.stateGlyph` 与 `.rowSuffix`（`color: var(--dsh-color-text-faint)`）、`src/ui/messageRow.module.scss:190-195`。
* **差异** 安卓卡片摘要/图标用 `outline`（浅 `#79747E`），小程序用 `text-sub #6b7280`；尾部附注安卓用 `outline*0.7`，小程序用 `text-faint #9ca3af`。既不是同一个 RGBA 也不是同一种取色规则。
* **建议** 增加 `--dsh-color-outline`/`--dsh-color-outline-subtle`，卡片行图标/摘要取前者，suffix 取后者。
* **风险/不确定** `outline*0.7` 在深色下的实际观感需真机对比。

### F-06 空态图标写死颜色

* **证据（安卓）** `ui/component/EmptyState.kt:28`：`Icon(icon, null, Modifier.size(40.dp), MaterialTheme.colorScheme.outline)`
* **证据（小程序）** `src/ui/emptyState.module.scss:13-16`：`.glyph { font-size: 40px; color: #c8ccd4; }`
* **差异** 小程序 `#c8ccd4` 是硬编码浅灰，深色主题下不变、也不跟 M3 outline；安卓跟随主题。
* **建议** 换成主题变量（新 outline 或 `--dsh-color-text-faint`），并在 `theme.scss` 提供深色值。
* **风险/不确定** 无。

### F-07 连接横幅配色

* **证据（安卓）** `ui/component/ConnectionBanner.kt:136-154,190-193`
  ```kotlin
  connectingBanner: container = MaterialTheme.colorScheme.surfaceVariant,
                    content  = MaterialTheme.colorScheme.onSurfaceVariant
  offlineBanner:     container = MaterialTheme.colorScheme.errorContainer,
                    content   = MaterialTheme.colorScheme.onErrorContainer
  ```
* **证据（小程序）** `src/ui/connectionBanner.module.scss:22-32`
  ```scss
  .pending { background: rgba(224, 134, 0, 0.16); }
  .bad     { background: rgba(220, 38, 38, 0.16); }
  ```
  且 `src/ui/connectionBanner.tsx:22-25` 把 `connecting` 和 `failed` 都映射到 `pending`，只有 `failed` 用 `bad`。
* **差异** 安卓"连接中"是中性 surfaceVariant（灰），小程序是 16% 琥珀色；安卓"连不上"是 errorContainer，小程序是 16% 红。颜色族与容器色都不同。
* **建议** 用主题变量表达 `surfaceVariant/onSurfaceVariant` 与 `errorContainer/onErrorContainer`；连接中不要用警告橙。
* **风险/不确定** 无。

### F-08 计划芯片 / 会话徽标底色与文字色基色

* **证据（安卓）** `ComposerBar.kt:360,367`：`.background(Color(0x22E08600))`、`color = Color(0xFFE08600)`；`SessionListScreen.kt:870,873`：`background(Color(0x22E08600), CircleShape)`、`color = Color(0xFFE08600)`。
* **证据（小程序）** 计划芯片 `src/ui/composerBar.module.scss:345-353`（`background: rgba(224,134,0,0.14)`）；会话列表徽标 `src/pages/index/index.module.scss:120-127`（`background: rgba(217,119,6,0.14)`、`color: var(--dsh-color-warning)`）。
* **差异** 计划芯片底 `rgba(224,134,0,0.14)`≈0x24 与安卓 0x22 接近，但文字走 `--dsh-color-warning #d97706` ≠ `#E08600`；会话列表徽标连基色都换成了 `#d97706`。
* **建议** 底色统一 `rgba(224,134,0,0.14)`，文字统一 `#E08600`（或 F-02 的新 warning 变量）。
* **风险/不确定** 无。

### F-09 DIMENS 只落地了 1 项

* **证据（安卓）** `ui/theme/Theme.kt:17-32` 的 `Dimens` 被各处引用：`columnInset`4 处、`rowSpacing`2、`messageTopInset`2、`cardRadius`1、`chromeRowHeight`1、`iconSlot`2、`stripRowHeight`2、`stripSpacing`2、`columnMaxWidth/bubbleRadius`各 1。`cardPadding`、`listRowPadding`、`stripIconSlot` 在安卓也未使用。
* **证据（小程序）** `src/const.ts:23-39` 注释写"对应 Android ui/theme/Theme.kt 的 Dimens（13 项，逐一对齐）"，但全仓只有 `src/ui/messageRow.tsx:135` 用了 `DIMENS.bubbleRadius`；`columnMaxWidth` 在 `src/pages/chat/index.module.scss:59` 另写 `760px`；`rowSpacing/chromeRowHeight/iconSlot/messageTopInset/stripRowHeight/columnInset` 全部在 scss 里另写（见 F-10~F-15）。
* **差异** "逐一对齐"的镜像常量实际是死代码；真正生效的 scss 数值已和安卓漂移。
* **建议** 要么让 scss 用 `var(--dsh-*)` 消费这些常量，要么删掉假镜像并在每处注明安卓对应值；至少把 F-10~F-15 的数值改回一致。
* **风险/不确定** 无。

### F-10 转写水平内边距 12px vs 16dp

* **证据（安卓）** `ui/screen/ChatScreen.kt:428`：`contentPadding = PaddingValues(horizontal = Dimens.columnInset, vertical = 12.dp)`（`columnInset=16.dp`，`Theme.kt:19`）。
* **证据（小程序）** `src/pages/chat/index.module.scss:48-54`
  ```scss
  .transcript { flex: 1; min-width: 0; height: 100%; padding: 12px 12px 24px; box-sizing: border-box; }
  ```
* **差异** 水平 12px vs 16px（左/右都窄 4px）；底部 24px vs 安卓 `vertical=12` 的对称 12dp。
* **建议** `.transcript` 改 `padding: 12px 16px;`（底部如需给输入区留白，另用一层 `padding-bottom` 明确注释）。
* **风险/不确定** 底部 24px 可能是有意为隐藏的输入区留白，需产品确认；水平 12→16 是明确偏差。

### F-11 转写行间距 10px vs 4dp

* **证据（安卓）** `ui/screen/ChatScreen.kt:429`：`verticalArrangement = Arrangement.spacedBy(Dimens.rowSpacing)`（`rowSpacing=4.dp`）；行内还有 `MessageRow.kt:107` 的 `padding(top = messageTopInset)`。
* **证据（小程序）** `src/pages/chat/index.module.scss:79-82`：`.row { margin-bottom: 10px; border-radius: 8px; }`
* **差异** 行间空隙 10px vs 4px，转写整体更"散"；再叠加 F-15 的 6 vs 8 顶部留白，行距节奏两端不同。
* **建议** `.row` 的 `margin-bottom` 改 4px，行内留白由 `MessageRow` 内部按 `messageTopInset` 给。
* **风险/不确定** 小程序没有 `Arrangement.spacedBy`，用 margin 等价实现；注意避免和卡片内部 `gap` 重复累加。

### F-12 卡片行最小高 28px vs 24dp

* **证据（安卓）** `ui/component/Cards.kt:54-58`
  ```kotlin
  Row(modifier = modifier.fillMaxWidth().heightIn(min = Dimens.chromeRowHeight), ...)
  ```
  （`chromeRowHeight=24.dp`，`Theme.kt:24`）
* **证据（小程序）** `src/ui/cards.module.scss:13-20`：`.row { gap: 6px; min-height: 28px; padding: 2px 0; }`；`src/ui/messageRow.module.scss:159-166` 同为 `min-height: 28px; padding: 2px 0`。
* **差异** 最小高 28px（若按 content-box 计算，加 padding 实际 32px）vs 24dp；卡片行更松。
* **建议** `min-height` 改 24px，或去掉 `padding: 2px 0` 让内容盒严格 24px。
* **风险/不确定** 小程序 `box-sizing` 默认 `content-box`，`min-height` 与 padding 的关系需在开发者工具里量一次。

### F-13 卡片行图标槽 18px/13px vs 14dp

* **证据（安卓）** `ui/component/Cards.kt:70-78`：`CircularProgressIndicator(Modifier.size(Dimens.iconSlot))` / `Icon(..., Modifier.size(Dimens.iconSlot))`（`iconSlot=14.dp`）。
* **证据（小程序）** `src/ui/cards.module.scss:22-28`：`.rowGlyph { width: 18px; font-size: 13px; line-height: 18px; }`；`src/ui/messageRow.module.scss:172-178` 同。
* **差异** 图标槽 18px vs 14dp，字形 13px vs 14dp；图标比安卓小、槽位比安卓宽，行首缩进和视觉重心都不同。
* **建议** 槽宽对齐 14px，`font-size` 按 Lucide 字形的实际墨迹调到 ≈14px（Lucide 在 1em 下有内边距，通常需略大于目标 dp，需在开发者工具量后再定）。
* **风险/不确定** Lucide 字体墨迹与 Material `ImageVector` 的"14dp"含义不同（字体字形自带 24 网格留白），不能只改 `font-size` 就断言等大；需真机/开发者工具比对。

### F-14 目标条/队列条没有 44px 最小行高

* **证据（安卓）** `ui/screen/ComposerBar.kt:723-729`：`Row(Modifier.fillMaxWidth().heightIn(min = Dimens.stripRowHeight), ...)`；`:815` 队列行 `.height(Dimens.stripRowHeight)`（`stripRowHeight=44.dp`）。
* **证据（小程序）** `src/ui/composerBar.module.scss:137-142`：`.goalBar { display:flex; align-items:center; gap:8px; padding: 4px 0; }`；`:171-177`：`.queueRow { ... padding: 5px 0; border-bottom: 1px solid ... }`（无 min-height）。
* **差异** 安卓两条 strip 都有 44dp 行高（稳定触控/对齐），小程序按内容高度，通常 26-30px，明显更矮。
* **建议** 两条都加 `min-height: 44px`（或统一 `height: 44px`）。
* **风险/不确定** 小程序里 strip 位于输入区上方，加高会挤压正文，需在窄屏验证。

### F-15 气泡/正文顶部留白 6px vs 8dp

* **证据（安卓）** `ui/component/MessageRow.kt:104-107`：用户气泡外层 `.padding(top = Dimens.messageTopInset)`（8dp）；`:312`：助手正文 `.padding(vertical = Dimens.messageTopInset)`。
* **证据（小程序）** `src/ui/messageRow.module.scss:12-18`：`.userRow { ... padding-top: 6px; }`；`:140-142`：`.mdBlock { padding: 6px 0; }`。
* **差异** 顶部留白 6px vs 8dp（助手正文上/下都是 6 vs 8）。
* **建议** 两处改 8px。
* **风险/不确定** 无。

### F-16 正文/气泡字号 15px vs 16sp

* **证据（安卓）** `ui/component/Markdown.kt:180-188`：`bodyStyle() = MaterialTheme.typography.bodyLarge.copy(lineHeight = 25.sp, ...)`，`bodyLarge` 默认 `fontSize=16sp`；`MessageRow.kt:151` 气泡 `style = MaterialTheme.typography.bodyLarge`。
* **证据（小程序）** `src/ui/markdown.module.scss:7-14`：`.root { font-size: 15px; line-height: 25px; }`；`src/ui/messageRow.module.scss:35-42`：`.bubbleText { font-size: 15px; line-height: 23px; }`。
* **差异** 正文/气泡 15px vs 16sp；气泡行高 23px vs 安卓 `bodyLarge` 默认行高（安卓正文被改成 25sp，气泡未改，约 24sp）。行高 `root` 的 25px 与安卓 25sp 一致，但字号小 1。
* **建议** `.root`/`.bubbleText` 改 16px；气泡行高按安卓 `bodyLarge` 默认行高取 24px（或与正文统一 25px，需与产品确认）。
* **风险/不确定** `sp` 随系统字体缩放、`px` 不随，实际差值会随用户字号设置变化；见 F-25/F-22。

### F-17 卡片摘要 13px/18 vs 12sp/16

* **证据（安卓）** `ui/component/Cards.kt:84-91`：摘要 `style = MaterialTheme.typography.labelMedium`（M3 默认 12sp / 16sp 行高）。
* **证据（小程序）** `src/ui/cards.module.scss:30-37`：`.rowTitle { font-size: 13px; line-height: 18px; }`。
* **差异** 13px/18px vs 12sp/16sp，字号与行高都大一号。
* **建议** 改 `12px/16px`；行内 suffix 已经是 11px/16px（与 `labelSmall` 一致，保持不变）。
* **风险/不确定** 无。

### F-18 顶栏标题 18px vs 22sp

* **证据（安卓）** `ui/screen/ChatScreen.kt:254,289`：`TopAppBar(title = { ... Text(title, maxLines = 1, ...) })` 未指定 `style`，M3 `TopAppBar` 默认用 `titleLarge`（22sp）。`SessionListScreen.kt:287-297` 同。
* **证据（小程序）** `src/ui/navBar.module.scss:68-78`：`.title { font-size: 18px; font-weight: 500; ... }`；`:133-138` `.label { font-size: 13px; }`（安卓 find 计数用 `labelLarge`（14sp），`ChatScreen.kt:304`）。
* **差异** 标题 18px vs 22sp；`NavLabel` 13px vs 14sp。另外安卓 `TopAppBar` 默认不画底部分隔线（滚动才有），小程序 `NavBar` 默认 `divider`（`navBar.tsx:42`）。
* **建议** 标题改 22px（或显式在两端都用同一 `titleLarge` 值并记录）；`NavLabel` 改 14px；分隔线默认关掉，滚动时再现。
* **风险/不确定** 顶栏高度由小程序胶囊公式决定（`src/model/navBarMetrics.ts`），字号改大后垂直居中需真机确认。

### F-19 空态尺寸与缺图标

* **证据（安卓）** `ui/component/EmptyState.kt:20-38`：`.padding(32.dp)`、`Arrangement.spacedBy(8.dp)`、图标 `40.dp` outline、标题 `titleMedium`（16sp）、描述 `bodyMedium`（14sp）。历史加载失败态 `ChatScreen.kt:544-552`：`Icon(Icons.Default.CloudOff, null, Modifier.size(40.dp), outline)` + `titleMedium` 标题 + `bodyMedium` 原因 + `TextButton(retry)`。
* **证据（小程序）** `src/ui/emptyState.module.scss:4-29`：`.empty { padding: 64px 32px; gap: 8px; }`、`.title { font-size: 15px; }`、`.description { font-size: 13px; }`。会话页 `src/pages/chat/index.tsx:548-554`：只画 `emptyTitle`/`emptyBody`/`retry`，**没有图标**。
* **差异** 垂直 padding 64px vs 32px；标题 15px vs 16sp；描述 13px vs 14sp；历史错误态安卓有一枚 40dp CloudOff，小程序完全没有。
* **建议** `.empty` 改 `padding: 32px`；标题 16px、描述 14px；`chat/index.tsx` 的错误分支补 `<Icon name='cloud-off' className={styles.loadingGlyph} />`（Lucide 子集里已有 `cloud-off`，见 `lucideIcons.ts:26`），图标 40px。
* **风险/不确定** 无。

### F-20 引导页标题 17px vs 24sp

* **证据（安卓）** `ui/screen/OnboardingScreen.kt:18-39`：`Icon(..., Modifier.size(56.dp), primary)`、`Spacer(16)`、`Text(onboardingTitle, style = MaterialTheme.typography.headlineSmall)`（24sp）、`Spacer(8)`、描述 `bodyMedium`（14sp）、`Spacer(24)`、`Button`（M3 默认最小高 40dp）。
* **证据（小程序）** `src/ui/onboarding.module.scss:24-59`：`.glyph { font-size: 56px; }`、`.title { margin-top:16px; font-size:17px; font-weight:600; }`、`.body { margin-top:8px; font-size:13px; }`、`.primary { height: 44px; }`。
* **差异** 标题 17px vs 24sp（差 7px，最显眼）；描述 13px vs 14sp；按钮 44px vs 40dp。图标 56px 与间距 16/8/24 对齐。
* **建议** 标题 `font-size:24px`，描述 14px，按钮高度 40px。
* **风险/不确定** 标题改 24px 后中文单行是否溢出需真机确认（文案见 `strings.ts:22`）。

### F-21 图标体系与尺寸

* **证据（安卓）** Material `ImageVector` + 显式 dp：
  - 顶栏 `IconButton`（M3 默认触摸区 48dp）内图标 24dp：`ChatScreen.kt:292-296,310-321`；`SessionListScreen.kt:311-318`。
  - 连接横幅图标 `:202`：`Icon(info.icon, null, Modifier.size(13.dp))`。
  - 空态 40dp（`EmptyState.kt:28`）、会话行状态图标 16dp（`SessionListScreen.kt:826-835`）。
* **证据（小程序）** Lucide 字体字形：`src/ui/icon.module.scss:5-12` 基类只设 `font-family/line-height/vertical-align`，**没有字号/盒尺寸**，尺寸完全由调用方 `className` 决定；`src/ui/navBar.module.scss:98-118`：`.iconButton { width:40px; height:40px; border-radius:20px; }`、`.icon { font-size:20px; }`；`src/ui/connectionBanner.module.scss:34-40`：横幅把安卓的状态图标换成了 `8px` 圆点。
* **差异** 同一交互控件的图标尺寸不同：顶栏 20px vs 24dp、触摸区 40px vs 48dp；横幅从"状态图标 13dp"变成"8px 色点"；会话行状态图标小程序 14px（`index.module.scss:90-96`）vs 安卓 16dp。另外字体字形自带 24 网格留白，`font-size:20px` 的墨迹明显小于 20dp 的 Material 图标。
* **建议** 顶栏图标 `font-size` 提到 ≈24px（并按实际墨迹微调）与触摸区 48px；横幅恢复状态图标（Lucide `refresh-cw`/`triangle-alert`）13px 级别；会话行状态图标 16px。
* **风险/不确定** Lucide 与 Material 图标"同尺寸不同墨迹"，改 `font-size` 后必须真机比对；顶栏 48px 触摸区在小程序标题栏里可能顶破，需按 F-18 的高度公式复核。

### F-22 底部安全区与键盘

* **证据（安卓）** `ui/screen/ComposerBar.kt:210-218`
  ```kotlin
  Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.imePadding().navigationBarsPadding()) {
      Column(Modifier.fillMaxWidth().padding(horizontal = Dimens.columnInset, vertical = 8.dp), ...)
  }
  ```
  键盘（ime inset）与导航栏 inset 都由系统在布局期实时给出。
* **证据（小程序）** `src/framework/hook.ts:52-65`：`useSafeBottom` 用 `wx.getSystemInfoSync()` 算 `windowHeight - safeArea.bottom`，`useMemo(..., [])` **只在挂载时算一次**（旋屏、折叠、键盘弹出都不会更新）；`src/ui/composerBar.tsx:802`：`style={{ paddingBottom: (8 + safeBottom) + 'px' }}`；键盘避让只靠 `Textarea` 的 `adjustPosition`（`composerBar.tsx:883`）。另有两处独立机制：`src/pages/index/index.module.scss:157` 与 `src/pages/new/index.module.scss:88` 用 `env(safe-area-inset-bottom)`；`src/app.scss:54-55` 定义的 `.dsh-safe-bottom` **全仓无人引用**。
* **差异** 安卓 inset 是实时的、含键盘；小程序底部安全区只算一次且不含键盘，键盘高度完全交给 `adjustPosition` 的页面位移，输入区与转写的相对位置在键盘弹起时可能与安卓不同（安卓输入区被 imePadding 抬高、转写区同时收缩）。
* **建议** 统一安全区口径：优先用 `env(safe-area-inset-bottom)`（WXSS 支持时）并在 `onResize`/旋屏时重算；删除或真正使用 `.dsh-safe-bottom`；键盘态若出现遮挡，用 `wx.onKeyboardHeightChange` 补 paddingTop/滚动，对标 `imePadding`。
* **风险/不确定** `env(safe-area-inset-bottom)` 在微信各基础库的支持度、`adjustPosition` 在自定义导航栏 + `height:100vh` 页面下的实际表现都需真机/开发者工具验证。小程序没有与 Compose `imePadding` 等价的声明式 API，只有 `onKeyboardHeightChange` 这类事件，属于平台能力差异。

### F-23 深色主题作用域与 page 背景

* **证据（安卓）** `MainActivity.kt:34`：`enableEdgeToEdge()`；`ui/theme/Theme.kt:61-67`：`MaterialTheme(colorScheme = scheme, content = content)` 包住整棵界面，Scaffold/各页背景都从 `colorScheme.background` 取。
* **证据（小程序）** `src/app.tsx:55-70`：主题 class 挂在内层 `<View className={themeClass}>`；`src/styles/vars.scss:9`：变量定义在 `page` 选择器；`src/app.scss:13`：`page { background-color: var(--dsh-color-bg); }`。于是深色下 `.dsh-theme-dark` 只覆盖该 View 的子树，`page` 自身的 `background-color` 仍解析 `page` 上的浅色 `#f5f6f8`。`src/state/theme.ts` 也确认"小程序没法给 page 元素加 class"（`framework/hook.ts:70-71`）。
* **差异** 安卓在真实边界内没有浅色残留；小程序只要某页没把 `.page` 铺满（或出现下拉回弹/键盘顶起留白）就会露出浅色 `page` 底。`theme.scss:3-4` 还写着"theme.ts 把选择同步成 page 上的 data-theme 属性"，但 `state/theme.ts:32-48` 只做 `themeStore.set + setNavigationBarColor/setBackgroundColor`，**没有设置任何 page 属性/class**，注释与实现不符。
* **建议** 用 `Taro.setBackgroundColor` 已经覆盖窗口底（现有），但 `page` 的 CSS 底仍应改为不写死或跟随变量；或给每个页面根的 `.page` 显式加主题 class，确保不留浅色边。同步修正 `theme.scss` 的过时注释。
* **风险/不确定** `setBackgroundColor` 只改窗口回弹区、不改 `page` 元素本身，实际是否会露出浅色需在开发者工具/真机滚到顶/底验证。

### F-24 冷启动与 H5 写死浅色

* **证据（安卓）** 主题由 `DshTheme` 在组合期决定，窗口/状态栏颜色跟着 `colorScheme` 走（`Theme.kt:54-67`；无写死浅色的 `themes.xml` 之外配置）。
* **证据（小程序）** `src/app.config.ts:10-14`：`navigationBarBackgroundColor: '#ffffff'`、`backgroundColor: '#f5f6f8'`、`navigationBarTextStyle: 'black'` 编译期写死；`src/index.html:15-29`：`html { font-size: 24px !important; background-color: #f5f6f8; }`、`body { line-height: 1 !important; }`、`.taro_page { background-color: #f5f6f8 !important; }`。
* **差异** 深色偏好下冷启动首帧/下拉背景/H5 宿主页仍是浅色；全局 `line-height:1 !important` 会压掉未显式设行高的文本的默认行距，`html font-size:24px` 若被 `rem` 使用会改变尺寸基线。
* **建议** `app.config` 的窗口底色改成中性/透明并由 `applyTheme` 立即改写；`index.html` 移除 `!important` 全局覆写，或改成按 `prefers-color-scheme` 切换（H5 预览用）。
* **风险/不确定** `app.config` 是编译期产物，无法运行时改；深色首帧只能靠启动即调 `setBackgroundColor`。

### F-25 平台限制：动态取色

* **证据（安卓）** `ui/theme/Theme.kt:61-66`
  ```kotlin
  val scheme = when {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
          if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
      darkTheme -> DarkScheme
      else -> LightScheme
  }
  ```
* **证据（小程序）** `src/state/theme.ts:19-30` 只能读 `wx.getSystemInfoSync().theme`（light/dark）来解析"跟随系统"，没有"读系统取色板"的能力；色板是 `vars.scss/theme.scss` 固定值。
* **差异** 安卓 API31+ 的实际颜色由壁纸/系统动态生成（primary/container/surface/outline/error 全变），小程序无法获取该色板；因此 F-01/F-04 在动态色机型上不是"改个 hex 能修"的问题。
* **建议** 明确记录为平台限制。可用 API：`wx.getSystemInfoSync().theme`（已用）只能判深浅；小程序的 `themeLocation`/`darkmode`（`app.json` 支持两套主题文件）也只能在编译期给两套固定色，依然拿不到壁纸取色。若要"接近"安卓，可在设置页提供多套预设色板让用户选。
* **风险/不确定** 安卓动态取色的具体色值随设备变化，无法在审计里给出固定目标值。

### F-26 代码块复制控件形态

* **证据（安卓）** `ui/component/Markdown.kt:324-341`：`Box(Modifier.size(28.dp).clip(CircleShape).clickable{...})` 内 `Icon(if (copied) Check else ContentCopy, ..., Modifier.size(14.dp))`，无文字；顶栏 `padding(start=12, end=4, top=2, bottom=2)`。
* **证据（小程序）** `src/ui/markdown.module.scss:167-179`：`.codeCopy { min-width: 44px; height: 26px; padding: 0 8px; border-radius: 13px; }`、`.codeCopyText { font-size: 12px; }`；`src/ui/markdown.tsx` 里复制按钮渲染的是文字（"复制"/已复制）。
* **差异** 安卓是 28dp 圆 + 14dp 图标；小程序是 44×26 圆角胶囊 + 12px 文字。占位宽度与语义（图标 vs 文本）都不同。
* **建议** 改为 `width:28px; height:28px; border-radius:50%`，内容用 `<Icon name='copy'|'check' className={styles.codeCopyGlyph} />`（14px）。
* **风险/不确定** 小程序 `Icon` 是 `Text` 字形，圆形居中的墨迹偏差需实测。

### F-27 引用块底与色条

* **证据（安卓）** `ui/component/Markdown.kt:425-442`：`.background(blockSurface())`（`blockSurface = surfaceVariant.copy(alpha=0.34f)`，`:228-229`），色条 `MaterialTheme.colorScheme.primary.copy(alpha = 0.45f)`、宽 `3.dp`、圆角 `1.5.dp`，内边距 `start=14, end=12, top=9, bottom=9`。
* **证据（小程序）** `src/ui/markdown.module.scss:234-252` + `src/ui/markdown.tsx:265-272`：`quote { border-radius: 8px; background: color_bg(#f5f6f8) }`、`quoteBar { width: 3px; background: color_primary（全不透明） }`、`quoteBody { padding: 9px 12px 9px 11px; }`。
* **差异** 底色安卓是 surfaceVariant 34%（`#E7E0EC` 系），小程序用正文底色 `#f5f6f8`；色条安卓 45% 透明度 + 圆角，小程序全不透明直角；左内距 14 vs 11。
* **建议** 底色改 surfaceVariant 34%，色条加 `opacity: .45` 与 `border-radius: 1.5px`，`padding-left: 14px`。
* **风险/不确定** 无。

## 补充观察（不是差异，但会影响后续审计判读）

1. **小程序颜色全部走 `var(--dsh-*)`**：`src/const.ts:11-21` 已把行内样式改成变量引用，我没有发现"行内写死 hex 导致深色不生效"的残留；深色不生效的点集中在 `emptyState.module.scss:15`、`connectionBanner.module.scss:26-32`、`index.module.scss:123` 这几处写死 scss。
2. **`--dsh-color-todo` 是死变量**：`const.ts:15`、`vars.scss:17`、`theme.scss:17` 定义后全仓无人使用；安卓的待办三态分别用 `#2E7D32`（完成）/ `primary`（进行中）/ `#E08600`（待处理）（`ComposerBar.kt:708-712`），小程序也走 good/primary/warning。建议删掉或补上一处真正引用。
3. **`.dsh-mono`/`.dsh-clamp-2`/`.dsh-ellipsis`**（`app.scss:35-51`）与安卓 `FontFamily.Monospace`（`Markdown.kt:222`）、单行省略等价，未发现不一致。
4. **`NutUI` 主题变量**（`app.scss:6-11`）在仓内没有任何 `@nutui/...` 组件被 import（grep 只命中 scss 里的 `@use variables`）；这些 `--nutui-color-primary*` 覆盖目前是死配置，深色下也不会切。若后续引入 NutUI 组件需同时补深色值。
5. **度量镜像的"13 项逐一对齐"注释不准确**：安卓 `Dimens` 本身有 3 项（`cardPadding`、`listRowPadding`、`stripIconSlot`）在安卓源码里也无人使用；小程序 `DIMENS` 则 12/13 项无人使用。见 F-09。
6. **语音输入/键盘行为**：安卓 `BasicComposerField` 用 `focusRequester + keyboard?.show()` 处理新建会话弹层的自动聚焦（`ComposerBar.kt:469-481`）；小程序 `Textarea` 用 `focus` 属性 + `autoFocus`（`composerBar.tsx:880,496`），焦点/键盘时序是否一致需真机验证（未在本轮判定为差异）。
7. **px vs rpx**：小程序全量用 `px`，在 750 设计宽度下不做等比缩放。安卓 `dp` 随屏幕密度保持物理尺寸一致；小程序 `px` 是 CSS 像素，在不同 DPR 上逻辑尺寸接近但并非同一套换算。若目标是"跨机型一致"，应评估改用 `rpx` 或 `Taro.pxTransform`；本轮按 1px≈1dp 口径比对，未把该系统的整体差异拆成多条。

# 自定义标题栏：把小程序端的顶栏对齐安卓端

- 小程序：`/Users/user/dshapp/dsh-miniapp`
- 参考实现：`/Users/user/dshapp/dsh-androidapp`（Kotlin + Jetpack Compose，**权威口径**）
- 方法来源：[小程序自定义导航栏，兼容适配所有机型](https://juejin.cn/post/6844904136866021389)

## 为什么必须自己画

微信自带的 `navigationBar` 只能做两件事：显示一个**编译期写死**的标题、显示一个返回箭头。
安卓端的 `TopAppBar` 在同一条栏上还要摆下这些东西：

| 页面 | 安卓 TopAppBar | 原来的小程序 |
| --- | --- | --- |
| 会话列表 | 连接状态点（进设置）+ 机器名 + 搜索 / 视图 / 新建；搜索态整条变搜索栏 | 微信导航栏（写死"DeepSeek Harness"）**下面**再画一条自绘顶栏 —— 两条栏叠着 |
| 会话 | 返回 + 会话名 + 轮次 / 更多；查找态带"第几条/共几条"与上一条/下一条 | 同上，两条栏叠着；会话名靠 `setNavigationBarTitle` 写进上面那条，自绘那条再写一遍 |
| 已归档 | 返回 + 标题 + 搜索 | 同上，两条栏叠着 |
| 设置 | 返回 + "设置" + 右上角加号 | 加号画不进导航栏，被迫放到页面第一行当一张卡片 |
| 新建会话 | 空标题 + 返回 | 完全靠微信那条；标题只能留空，因为写死中文会在英文界面上露馅 |
| 配对 | 关闭 + "配对" + 「扫码 / 手动输入」文字按钮 | 切换被迫做成页面里的一排分段控件 |
| 引导页 | `CenterAlignedTopAppBar(appName)` | 没有顶栏 |

所以这一轮做的事是：**全局 `navigationStyle: "custom"`，顶栏全部由页面自己画**，
微信那边只剩右上角一颗去不掉的胶囊。

## 高度怎么算

公式照小程序官方（也是上面那篇文章）的口径，实现在
[src/model/navBarMetrics.ts](../src/model/navBarMetrics.ts)：

```
状态栏到胶囊的间距 = 胶囊距上边界 - 状态栏高度      // wx.getMenuButtonBoundingClientRect().top - statusBarHeight
标题栏内容高       = 该间距 * 2 + 胶囊高度          // 胶囊上下间距相等，所以 *2
导航栏总高         = 状态栏高度 + 标题栏内容高
```

这么算出来的条子，**垂直中线恰好与胶囊重合**——返回键、标题、动作按钮因此天然与胶囊
同一水平线，换任何机型都不会错位。这条性质被单测钉住
（[scripts/test/navBarMetrics.test.ts](../scripts/test/navBarMetrics.test.ts) 的
「标题栏内容区的中线压在胶囊中线上」，对 iPhone X / 老 iPhone / 安卓三组实测参数都成立）。

分层：

| 文件 | 职责 |
| --- | --- |
| [src/model/navBarMetrics.ts](../src/model/navBarMetrics.ts) | 纯公式 + 兜底，不碰任何平台 API，可单测 |
| [src/framework/navbar.ts](../src/framework/navbar.ts) | 读 `wx.getSystemInfoSync` / `wx.getMenuButtonBoundingClientRect`，算一次并缓存 |
| [src/ui/navBar.tsx](../src/ui/navBar.tsx) | 组件，对齐安卓 `TopAppBar` 的三槽位 |

`measureNavBar()` 在 `app.tsx` 的 `useLaunch` 里跑（官方建议的时机）：那时胶囊已经就位、
页面还没开画，所有页面读到同一份度量，不会"首页算一套、二级页算另一套"。

### 兜底

`wx.getMenuButtonBoundingClientRect()` 在极少数机型/极早的时机返回全 0。真按 0 去算会得到
一条 0 高的导航栏，整页内容直接顶进状态栏。所以宽或高为 0 就判定"没测出来"，改用微信各端
实测常见值：胶囊 87×32、右边距 7，iOS 上下各 4、其它平台各 8。另外间距可能算出负数
（胶囊被画进状态栏里），一律夹到 0 以上。

## 组件：对齐 TopAppBar 的三槽位

```kotlin
TopAppBar(navigationIcon = {...}, title = {...}, actions = {...})   // Android
```
```tsx
<NavBar left={...} title={...} actions={...} />                     // 小程序
```

| 安卓 | 小程序 |
| --- | --- |
| `IconButton` | `NavIconButton`（禁用只变淡、保留槽位，数字宽度变化时按钮不左右挪） |
| `TextButton` | `NavTextButton` |
| `Text`（标题） | `NavTitle`（一行、超长省略、左对齐） |
| actions 里的 `Text` | `NavLabel`（会话页的「第几条/共几条」） |
| 标题位里的 `BasicTextField` | `NavSearchInput`（一行、无边框、无背景） |
| `CenterAlignedTopAppBar` | `<NavBar centerTitle>` |

三种定位：`sticky`（普通滚动页，随页面置顶）、`flow`（页面自己是 flex 列，如会话页）、
`fixed`（盖在内容之上）。

### 两处平台差异（真做不到，不是偷懒）

1. **右上角那颗胶囊去不掉。** 所以动作区的右边界收到胶囊左侧（`rightInset = 胶囊宽 + 两侧间距`），
   安卓端"按钮贴右边界"在这里变成"按钮贴胶囊左边"。单测里钉了这一条：让位之后动作区右边界
   落在胶囊左沿之外，还多留一份 `menuRight` 的呼吸位。
2. **下拉菜单仍然是 `wx.showActionSheet`。** 安卓的 `DropdownMenu` 锚在按钮下方，小程序
   没有这个能力（见 README「小程序端的有意取舍」）。

## 逐页落点

| 页面 | 左 | 标题 | 右 | 对齐的安卓代码 |
| --- | --- | --- | --- | --- |
| [index](../src/pages/index/index.tsx) | 连接状态点 → 设置 / 搜索态是返回 | 机器名 / 搜索态是输入框 | 搜索 · 视图 · 新建 / 搜索态只剩清除 | `SessionListScreen.kt:266` |
| [chat](../src/pages/chat/index.tsx) | 返回（查找态退出查找） | 会话名 / 查找态是输入框 | 轮次 · 更多 / 查找态是计数 · 上一条 · 下一条 · 清除 | `ChatScreen.kt:252` |
| [archived](../src/pages/archived/index.tsx) | 返回 | 已归档会话 / 搜索态是输入框 | 搜索 / 搜索态只剩清除 | `ArchivedSessionsScreen.kt:90` |
| [settings](../src/pages/settings/index.tsx) | 返回 | 设置 | 加号（新增服务） | `SettingsScreen.kt:53` |
| [new](../src/pages/new/index.tsx) | 返回 | 空 | 空 | `NewSessionScreen.kt:68` |
| [pairing](../src/pages/pairing/index.tsx) | 关闭 | 配对 | 「扫码 / 手动输入」文字按钮 | `PairingScreen.kt:77` |
| [onboarding](../src/ui/onboarding.tsx) | — | 居中的 appName | — | `OnboardingScreen.kt:18` |
| [cardDetail](../src/ui/cardDetail.tsx) | 关闭 | 图标 + 标题 | 复制 | `Cards.kt:107` |

顺带修掉的两处"因为画不出顶栏而被迫改形"的地方：

- 设置页的「新增服务」从页面第一行的卡片回到右上角加号；
- 配对页的「扫码 / 手动输入」从页面里的一排分段控件回到标题栏的文字按钮。

## 全局层

- **连接提示胶囊**（[connectionBanner.tsx](../src/ui/connectionBanner.tsx)）：顶栏自己吃掉了
  状态栏，这条悬浮胶囊要自己再让一次，`top = statusBarHeight + 2`，对齐安卓的
  `.statusBarsPadding().padding(vertical = 2.dp)`。
- **卡片详情全屏弹层**（[cardDetail.tsx](../src/ui/cardDetail.tsx)）：微信的胶囊照样盖在弹层
  之上，所以它的顶栏也走同一个 `NavBar`，右上角的复制按钮跟页面一样让开胶囊——否则点不到。
- **各页 `index.config.ts`** 里的 `navigationBarTitleText` 全部删掉：全局 custom 之后它不再
  生效，留着只会让人以为标题还归微信管。`framework/page.ts` 的 `setNavTitle` 一并删除。

## 图标

顺手把顶栏图标换成与安卓一一对应的那几个（都走 lucide 字体子集，见 README「图标」）：

| 安卓 | 小程序（原） | 小程序（现） |
| --- | --- | --- |
| `Icons.AutoMirrored.Filled.ArrowBack` | `chevron-left` | `arrow-left` |
| `Icons.Default.FilterList` | `menu` | `list-filter` |
| `Icons.Default.FormatListNumbered` | `list` | `list-ordered` |
| `Icons.Default.MoreVert` | `ellipsis`（横向） | `ellipsis-vertical` |

## 验证

- `npm run lint`：零错误；`npm test`：135 通过（其中 9 条是本轮新增的导航栏公式用例）；
  `npm run build:weapp`：编译通过。
- 微信开发者工具（iPhone X 模拟器）逐页实拍：会话列表（含搜索态与带清除按钮的搜索态）、
  会话页（含查找态：`1/3` + 上一条 + 下一条 + 清除，四件东西全部落在胶囊左边）、
  轮次抽屉、设置、新建会话、配对、已归档。每页的返回键/标题/动作都与胶囊在同一水平线上。
- **未验证**：真机（尤其是安卓机与非刘海 iPhone）。公式对机型的适配由单测的三组参数覆盖，
  但真机上的胶囊实测值仍应复核一次。

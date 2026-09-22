# 与安卓端的一致性：第三轮（全量 UI / 交互布局）

- 小程序：`/Users/user/dshapp/dsh-miniapp`
- 安卓（权威口径）：`/Users/user/dshapp/dsh-androidapp`
- 前两轮见 [DIFF-ANDROID.md](./DIFF-ANDROID.md) / [DIFF-ANDROID-R2.md](./DIFF-ANDROID-R2.md)，
  自定义标题栏见 [CUSTOM-NAVBAR.md](./CUSTOM-NAVBAR.md)。
- 本轮目标：把**所有 UI 与交互布局**重新对齐安卓，不再接受"文档自述已改完"。

## 为什么还要第三轮

前两轮存在两类问题，本轮开头做了验证：

1. 历史总表里标 `[x]` 的条目有**没落地**或只落地一半的（R2 已发现一次）；
2. 大量 `[~]` 被归为"平台限制 / 刻意增强"，其中一部分其实是**没做**（R2 末尾已点名
   上下文占用圆环、列表虚拟化、键盘高度跟随）。

所以本轮不采信旧结论，重新按六个区**逐条回两边当前源码取证**，报告在 `docs/audit3/`：

| 报告 | 范围 | 条目 |
| --- | --- | --- |
| [A-session-list.md](./audit3/A-session-list.md) | 会话列表 / 已归档 / 连接提示条 | 14 |
| [B-chat-transcript.md](./audit3/B-chat-transcript.md) | 会话页 / 转写 / 卡片 / Markdown / 查找 / 改动卡 / 图片 | 见报告 |
| [C-composer.md](./audit3/C-composer.md) | 输入区 / 待办 / 目标 / 队列 / 权限 / 附件 / 发送停止键 | 25 |
| [D-sheets.md](./audit3/D-sheets.md) | 所有底部弹层与对话框 | 30 |
| [E-shell-settings.md](./audit3/E-shell-settings.md) | App 外壳 / 新建 / 设置 / 配对 / 引导 / 标题栏 | 19 |
| [F-theme-metrics.md](./audit3/F-theme-metrics.md) | 主题 / 颜色 / 字体 / 尺寸度量 / 图标 / 安全区 | 27 |

## 修复批次（按依赖排序）

| 批次 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 主题与度量底座：语义色改回安卓硬编码值、补 M3 表面/描边/容器色、字号/行高/内边距/卡片行高、深色作用域、安全区重算 | 已完成 |
| 2 | 会话列表 + 已归档：行/表头/箭头/图标尺寸、透明 ListItem 与页面底色、归档入口 56dp、两行行高 72dp、空态垂直居中 | 已完成 |
| 3 | 聊天页与转写：转写内边距 16px / 行距 4px、卡片行 24dp、Markdown 字号与引用/表头/代码块、历史失败态图标、轮次菜单改顶栏下拉卡片、跟尾与初始落位 | 已完成 |
| 4 | 输入区：new 页弹层注入、takeover 提示归位、删内置命令、发送/停止键形态、占用环进度弧、strip 行高与一批图标/字号 | 已完成 |
| 5 | 弹层：文件预览改全屏、提问/计划评审固定头尾、上下文明细补 value、无标题弹层去空标题栏、逐层高度上限 | 已完成 |
| 6 | 外壳页：移除配对图标与冒泡、三处 showModal 改自绘、机型行去地址、相机不可用态、连接 tone 重连优先 | 已完成 |
| 7 | 图标子集补字形（trash-2 / folder / layers / list-checks / circle-check / clock / pause-circle） | 已完成 |
| 8 | 锚定菜单收口：`ui/actionMenu.tsx`（leading 图标 + 危险项染色 + 选中对勾 + 边界收敛）与 `ui/editDialog.tsx`（多行 Textarea + 常驻 label），替换全部 `wx.showActionSheet` / 可编辑 `wx.showModal` | 已完成 |
| 9 | 逐页真机/开发者工具实拍复核 + **修复 App 层全局 UI 从未生效的架构缺陷**（深色主题 / 连接横幅 / 卡片详情层） | 已完成 |

批内文件严格分区（并行改动互不重叠），每批完成即跑 `npm run lint` 与 `npm test`。

## 本轮落地清单（按区）

- **主题/度量（F）**：语义色对齐安卓硬编码 `#2E7D32/#C62828/#E08600`；补 `surfaceVariant / onSurfaceVariant / outline / *-container / connecting / online`；深色主色 `#7FA8FF`；成对补齐深色值；App 根容器铺主题底色；安全区改可订阅重算。
- **会话列表（A）**：页面取表面色、行透明无分隔线；行标题 16px、图标 16px、分组表头 14px/10px 对称、箭头 20px；归档入口 56dp；归档行 72dp。
- **转写（B）**：内边距 16px、行距 4px（父容器 gap）；卡片行 24dp/图标 14dp；Markdown 正文 16px、引用/表头/代码块头用表面色、行内码 0.92em、任务标记 16px 圆；工具卡去行尾重复状态图标、结果不折行可横滑、read 行号左对齐、子调用/JSON 去左边框；图片单张 280×220、缩略 120×120、骨架/失败态同尺寸；历史失败态补 40px 图标；轮次导航改顶栏下拉卡片；跟尾改按内容高度轮询、初始落位读真实底部、查找清除用重挂保焦点。
- **输入区（C）**：`new` 页模型/上下文弹层由 ComposerBar 自带（不再退化）；takeover 提示回到输入区；删内置命令回落；发送键裸图标 36/20、停止键 36/24、占用环 18px 进度弧 + 32px 命中区；目标/队列条 44px；待办头部与图标/字号、计划 chip、InfoLine 等一批细节。
- **弹层（D）**：文件预览走全屏详情层；提问/计划评审头皮固定、只正文滚动；上下文明细补 Token 总量；无标题弹层去空标题栏；模型页签/加载态/禁滚/逐层高度上限；审批标题回正文；选项自绘勾选与推荐标签。
- **外壳（E）**：移除配对改垃圾桶图标并阻断冒泡（不再误切连接）；重命名/移除/配对命名改自绘弹层并预填初值；机型行去 proxy 地址；图标热区 44px；配对页相机不可用前置态；连接 tone 重连优先。

## 批次 9：App 层全局 UI 从未生效（架构缺陷，已修）

批次 9 在开发者工具里逐页实拍时，通过 `automation_page_action --action getData` 检查真实
WXML 数据与截图发现三样东西**在任何页面上都不存在**：

| 挂在 `app.tsx` 的东西 | 症状 | 影响 |
| --- | --- | --- |
| `dsh-theme-dark` class | 存了 `dsh.theme=dark`、截图仍是浅色 | 深色主题整体失效 |
| `ui/connectionBanner.tsx` | `.connectionBanner` 节点查不到 | 断连提示条从不显示 |
| `ui/cardDetail.tsx` 的 `CardDetailHost` | `.cardDetail` 节点查不到 | 卡片详情弹层从不打开 |

**根因**（读 `@tarojs/plugin-framework-react/dist/runtime.js` 求证）：小程序端每个页面是
独立的 `comp` 自定义组件，页面数据只从**该页面自己的 React 根节点**往下序列化；`AppWrapper`
是把各页面当 `children` 传给 `App` 的（`h(App, props, elements.slice())`），所以 App 返回的
节点处在「页面之外」的祖先位置，**不会进任何页面的 WXML**。在 App 里挂全局 UI 等于死代码。

**修法**：新增 `src/ui/pageShell.tsx`，把「主题 class + 连接横幅 + 卡片详情宿主」下沉到每个
页面自己的根节点上（6 个页面全部用 `<PageShell>` 包住原来的 `styles.page`，页面布局一行未改）。
`app.tsx` 改为只做生命周期 + Context，并且**必须继续把 `props.children` 渲染出去**——Taro 靠它挂载页面，
返回 `null` 会让所有页面变成空白（本轮踩过并已修正）。横幅与详情层都是 `position: fixed`，多包一层不影响流内布局。

**实拍复核（开发者工具，深色主题）**：会话列表 / 设置 / 已归档 / 会话转写四页均渲染正常，
深色主题已生效；切回 `dsh.theme=light` 也正常（浅色截图确认）。

修复过程中还踩到一个连带问题并已修正：Taro 的 `AppWrapper` 把各页面当 `children` 传给 App，
所以 `app.tsx` **必须把 `props.children` 渲染出去**，一旦返回 `null`（或只返回 Provider 不含 children）
所有页面都会变成空白。现在的写法是 `<AppContext.Provider>{props.children}</AppContext.Provider>`。

### 同批次顺带修掉的两个静默缺陷

1. **「跟随系统」主题一直是假的** `app.config.ts` 缺 `darkmode: true`。微信规定只有配置了它，
   `wx.getAppBaseInfo().theme` 才会返回 `light/dark`，否则恒为 `undefined`——于是设置页选「跟随系统」
   永远解析成浅色。已补 `darkmode: true` + 必填的 `themeLocation: 'theme.json'`（新增 `src/theme.json`，
   经 `config/index.ts` 的 `copy` 原样进 `dist`）。实测 `getAppBaseInfo().theme` 从 `undefined` 变为真实值。
2. **`permission['scope.camera']` 是非法配置** `app.json` 的 `permission` 只接受位置类 scope，
   相机不在其中，基础库会报 `invalid app.json permission["scope.camera"]`。相机授权由 `wx.scanCode`
   首次调用时按需弹出，已移除该段配置。

### 顺带清理：废弃 API 警告

`wx.getSystemInfoSync` 已被官方标记废弃（一页能刷多条警告）。新增
`src/framework/systemInfo.ts` 统一收口：优先用拆分后的 `wx.getWindowInfo` / `wx.getDeviceInfo` /
`wx.getAppBaseInfo`，三个都取不到时才退回 `getSystemInfoSync`。7 处调用点
（`ui/actionMenu.tsx`、`framework/hook.ts`、`framework/navbar.ts`、`state/settings.ts`、
`state/theme.ts`、`pages/chat/index.tsx`、`pages/index/index.tsx`）全部改走它。
（注意 `theme` 字段只在 `darkmode: true` 时由 `getAppBaseInfo` 返回，见上。）

## 验证结果

- `npm run lint`（tsc --noEmit）：0 错误
- `npm test`：145/145 通过
- `npm run build:weapp`：编译成功（仅 webpack 体积提示）
- wxss 校验：6 个页面 `index.wxss` + `app.wxss` 全部通过 `wcsc` 真机编译器（无一错误）
- 逐页实拍（开发者工具，深色主题）：**6 个页面全部渲染正常**——会话列表（深/浅两态）、
  新建会话、设置、已归档会话、配对、会话转写。
- 三个「原先死掉」的全局 UI 逐一实测回来：深色主题（深/浅两态截图）、
  卡片详情全屏弹层（点会话里的可点卡片行，弹出 `cardDetail` 顶栏 + 正文）、
  连接横幅（临时强制 failed 态截图到红色「无法连接到电脑 / 重试」胶囊，验证后已还原）。
  另确认自绘锚定菜单（置顶/重命名/归档，带 Lucide glyph）正常弹出。
- `dist/theme.json` 已随包生成；`wx.getAppBaseInfo().theme` 实测返回真实深浅值（配置前恒为 undefined）。

## 锚定菜单与编辑弹层（批次 8）

安卓的 `DropdownMenu`（锚在触发控件下、带 leading 图标、危险项染色、选中项对勾）与
`AlertDialog + OutlinedTextField`（多行、常驻 label）此前被降级成 `wx.showActionSheet` /
可编辑 `wx.showModal`——形态、位置、图标、染红与多行编辑全都对不上。批次 8 新增两个组件后
全部收口，源码里已无 `wx.showActionSheet`：

| 位置 | 安卓口径 | 现状 |
| --- | --- | --- |
| 会话列表行长按（`SessionListScreen`） | DropdownMenu：Fork / Pin / Rename / Archive | `ui/actionMenu.tsx`，带 git-fork / pin / pencil / archive |
| 会话列表视图选项（A-14） | DropdownMenu + leadingIcon Check | 锚定菜单，选中项画 `check` |
| 分组长按移动工作区 | DropdownMenu 列表 | 锚定菜单，工作区带 folder 图标 |
| 会话列表重命名 | AlertDialog + OutlinedTextField | `ui/editDialog.tsx` 预填当前名 |
| 会话行长按 / 顶栏「更多」（D-29） | 复制(ContentCopy) / 在此分叉(CallSplit)；查找(Search) / 面板(Info) | 锚定菜单，四枚 leading 图标齐 |
| 目标菜单（D-26） | DropdownMenu：暂停/恢复 + 编辑 + 清空(error 色) | 锚定菜单，清空项染 `--dsh-color-bad` |
| 目标/队列编辑（D-27） | AlertDialog + 多行 OutlinedTextField | `ui/editDialog.tsx` 多行 Textarea + 常驻 label |
| 权限选择 | DropdownMenu（无勾选，危险档强调） | 锚定菜单，超过 6 项不再分页 |
| 附件选择 | DropdownMenu：Image / InsertDriveFile | 锚定菜单，两枚 leading 图标齐 |
| 设置语言/主题 | DropdownMenu + leadingIcon Check | 锚定菜单，选中项画 `check` |

## 明确保留的差异（平台能力，已写清可用 API）

- **动态取色**：安卓 API 31+ 用 `dynamicColorScheme` 读壁纸取色，小程序只有
  `wx.getSystemInfoSync().theme` 判深浅，拿不到取色板；对齐目标是安卓**非动态**的
  M3 基线 + 主色 `#1C64F2`（两端在 API<31 上一致）。
- **锚定下拉菜单**：Material `DropdownMenu` 由 `ui/actionMenu.tsx` 自绘复刻（锚在触发控件下、
  leading 图标、危险项染色、选中项对勾、超出屏边自动翻转）。**已无 `wx.showActionSheet`**；
  与安卓的差异只剩"没有系统级涟漪动画/无退出转场"，形态与位置已一致。
- **系统返回键 / 深链 / 通知 / Keystore**：小程序无对应能力（前两轮已记录）。
- **Textarea 键盘遮挡**：`ui/editDialog.tsx` 用 `adjustPosition` 让系统上推，而不是 Compose 的
  `imePadding` 精确避让；窄屏 + 长文本时仍可能盖住按钮，需真机确认。
- **px 与 dp**：本轮按 1px≈1dp 比对；小程序全量用 px 不做等比缩放。

## 验证

- `npm run lint`（tsc --noEmit）
- `npm test`（node --test，移植自安卓单测的回归闸）
- `npm run build:weapp`
- 微信开发者工具逐页实拍（列表/搜索态、会话/查找态、输入区各弹层、设置/新建/配对/引导）

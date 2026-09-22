# 区域 A：会话列表 / 已归档 / 连接提示条 审计（第三轮）

> 口径：安卓 `dsh-androidapp` 当前源码为正确一方，小程序 `dsh-miniapp` 当前源码为被审对象。
> 说明：本区的审计子代理超时未落盘，本文件由主代理根据**自己逐行读过两边源码**的结果补写，
> 每条都给了双侧 file:line；历史文档只作线索。

## 概览

| 编号 | 差异一句话 | 安卓位置 | 小程序位置 | 优先级 | 建议 |
| --- | --- | --- | --- | --- | --- |
| A-01 | 列表行有分隔线且行底为白卡、页面为灰底；安卓是 Scaffold 表面底 + 透明 ListItem、无分隔线 | SessionListScreen.kt:266、:779 | index.module.scss:4-10、:71-79 | P1 | 页面取 card 色，行去白底与 border |
| A-02 | 分组表头下内边距 6px（安卓垂直 10dp 对称）、标题 13px 且用 text-faint | SessionListScreen.kt:719 | index.module.scss:44-64 | P1 | padding 10px 16px；14px + outline 色 |
| A-03 | 折叠箭头 12px（安卓 ExpandMore 20dp）、用 chevron 而非 expand 语义 | SessionListScreen.kt:755-760 | index.module.scss:66-69 | P1 | 20px + outline |
| A-04 | 行标题 15px（安卓 ListItem headline bodyLarge 16sp） | SessionListScreen.kt:787-789 | index.module.scss:81-88 | P1 | 16px |
| A-05 | 行首状态图标 18px/14px（安卓 16dp，且默认 outline 色） | SessionListScreen.kt:822-837 | index.module.scss:90-112 | P1 | 16px + outline |
| A-06 | 行尾相对时间/通知色用 text-faint（安卓 outline） | SessionListScreen.kt:856-860、:885-894 | index.module.scss:114-133 | P2 | 改用 outline |
| A-07 | 「再显示 N 个」无 Android TextButton 的 start=12dp 内边距、字号 13px | SessionListScreen.kt:413-419 | index.module.scss:135-139 | P2 | padding-left 12px、14px |
| A-08 | 底部归档入口行高随内容（约 44px）；安卓是 56dp ListItem + 顶部 HorizontalDivider | SessionListScreen.kt:435-440 | index.module.scss:148-170 | P1 | min-height 56px |
| A-09 | 归档入口图标 16px（安卓默认 24dp）、标题 15px（安卓 16sp） | SessionListScreen.kt:436-440 | index.module.scss:162-170 | P2 | 24px / 16px |
| A-10 | 已归档行：36-40px 高、15px 标题（安卓两行 ListItem 72dp、16sp、meta 用 onSurfaceVariant） | ArchivedSessionsScreen.kt:181-220 | archived/index.module.scss:25-57 | P1 | min-height 72px、16px |
| A-11 | 已归档恢复中指示 14px（安卓 CircularProgressIndicator 16dp） | ArchivedSessionsScreen.kt:205-208 | archived/index.module.scss:66-70 | P2 | 16px |
| A-12 | 空态图标与文案色已随 F 区统一（outline + 32px/16px/14px） | EmptyState.kt | emptyState.module.scss | — | 已在本轮 F 修复中落地 |
| A-13 | 「连接中空态」用居中转圈是等价实现，但转圈色用 text-faint | SessionListScreen.kt:910-911 | index.module.scss:172-183 | P2 | 可保留 |
| A-14 | 视图/权限菜单仍是系统 ActionSheet，无法标出当前选中项（安卓 DropdownMenu） | SessionListScreen.kt:336-355 | pages/index/index.tsx:302-322 | P2 | 平台取舍，注明 |

## 已核实等价 / 已落地

- 分组/排序/搜索/归档过滤/空白与 subagent 会话过滤、空态四选一互斥、连接状态点进设置、
  搜索态标题位变输入框与清除按钮、长按菜单项集合（Fork/置顶/重命名/归档）、长按轻震、
  触底自动翻页（增强）、状态点 aria-label：均与安卓等价或一致。

## 真机 / 开发者工具待验

- px 与 dp 的换算（本轮按 1px≈1dp 比对）、Lucide 字形墨迹与 Material 图标的等大关系、
  `min-height` 在 content-box 下与 padding 的叠加、`env(safe-area-inset-bottom)` 支持度。

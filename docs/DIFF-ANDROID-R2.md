# 与安卓端的差异：第二轮（非 UI 层 + 验收复查）

- 小程序：`/Users/user/dshapp/dsh-miniapp`
- 参考实现：`/Users/user/dshapp/dsh-androidapp`（Kotlin + Jetpack Compose，**权威口径**）
- 第一轮见 [DIFF-ANDROID.md](./DIFF-ANDROID.md)：只覆盖四个 UI 区（列表 / 转写 / 输入区 / 设置），
  且结论全部是自述"已改完"。本轮做两件第一轮没做的事：
  1. **审计第一轮没碰过的层**：传输、模型、状态、Markdown 管线、主题与文案；
  2. **验收第一轮的 `[x]`**：逐条回到源码确认那些"已改完"是不是真的落地了。

## 本轮的审计与验收报告

| 报告 | 范围 | 结论 |
| --- | --- | --- |
| [audit2/T-transport.md](./audit2/T-transport.md) | net/：Noise、Mux、RPC、ApiClient | P0×3 / P1×5 / P2×15；RPC 方法集合 37 条两侧一致、Noise 握手全等价 |
| [audit2/T-model.md](./audit2/T-model.md) | model/ 全 18 文件 | P1×2 / P2×13；另证实 4 个"看似缺失"的模块只是落位不同 |
| [audit2/T-state.md](./audit2/T-state.md) | state/：SessionStore、PhoneModel、协调器 | P0×3 / P1×14 / P2×19 |
| [audit2/T-tests.md](./audit2/T-tests.md) | 安卓 35 个单测当行为规格逐条核对 | 通过 25 / 不通过 7 / 部分 1 / 不适用 2 |
| [audit2/T-markdown-ui.md](./audit2/T-markdown-ui.md) | Markdown、GFM 自动链接、主题、i18n | P0×3 / P1×6 / P2×20；另反驳第一轮 7 条 `[~]` 结论 |
| [audit2/V-AD.md](./audit2/V-AD.md) | 验收 A/D 区 64 条 `[x]` | ✅61 / ⚠️3 / ❌0 |
| [audit2/V-BC.md](./audit2/V-BC.md) | 验收 B/C 区 96 条 `[x]` | ✅83 / ⚠️8 / ❌5 |

结论：第一轮的 UI 改动大体可信（160 条里 144 条真实落地），但**非 UI 层从未被审计过**，
本轮在那里找出 8 条 P0。

## P0：不改就是坏的

| 编号 | 问题 | 后果 | 落点 |
| --- | --- | --- | --- |
| P0-1 | `fmt()` 不认 `%02d` | 任何 ≥1 分钟的轮次用时读作 `2m %02ds` | [strings.ts](../src/i18n/strings.ts) |
| P0-2 | 保活探活帧发 `{"type":"ping"}` | 主机只认 cancel/open，每次回前台都被 `close(1008)` 拆掉整条连接 | [mux.ts](../src/transport/tunnel/mux.ts) |
| P0-3 | 订阅不幂等（`Set.add` 返回值当布尔） | 对已开流重复发 `open`，主机抛错并断开 | [mux.ts](../src/transport/tunnel/mux.ts) |
| P0-4 | 附件上传用 multipart | 主机只收 `application/octet-stream`，附件必然上传失败 | [transport.ts](../src/transport/tunnel/transport.ts) |
| P0-5 | 分片搬运 `offset += chunk.bytes` | `bytes` 是整份文件长度，>2 MiB 的图片被静默截断 | [chunkedCopy.ts](../src/model/chunkedCopy.ts) |
| P0-6 | 离开会话页就 `unfollow` | 后台会话停止更新，未读失败红点永远不亮 | [appModel.ts](../src/state/appModel.ts) |
| P0-7 | 空 `callId` 的 `tool/result` 接不回调用 | 真调用永远"没有结果"，旁边多一条 orphan 行且互相覆盖 | [sessionStore.ts](../src/state/sessionStore.ts) |
| P0-8 | Markdown 正文不还原 HTML 实体 | `don&#39;t` / `a &lt; b` 直接印在屏幕上（语料实测 21.5% 受影响） | [markdownText.ts](../src/model/markdownText.ts) |
| P0-9 | 主题色常量写死浅色十六进制 | 55 处行内样式盖过深色变量，深色主题下正文不可读 | [const.ts](../src/const.ts) |
| P0-10 | GFM 自动链接用 marked 自带口径 | 对着安卓黄金语料 13.8% 不一致，中文域名完全不成链 | [gfmAutolink.ts](../src/model/gfmAutolink.ts) |

## 本轮改了什么

### 传输层

- **探活帧**改成 `{"type":"cancel","streamId":"wake-probe"}`（主机对未知 streamId 的 cancel 是 no-op），
  发送失败时主动废掉这一代连接，让 runLoop 走重连。
- **订阅幂等**：这一代连接上已经开过的流不再重发 `open`；参数变了才走 cancel + open。
- **附件上传**改成裸字节 + `application/octet-stream`，会话与文件名只走查询串。
- **连接泄漏**：WebSocket 升级失败时关掉已经建立的隧道流（平台 5 分钟只给 20 条 TCP）。
- **onClose 认代次**而不是认那个还没赋值的 socket 变量，避免"升级刚完成就断开"时不再重连。
- **一次性配对码用掉即弃**：RPC 与 mux 共用一份，重连不再重发。
- **HTTP 读超时 60s**：请求在这条连接上串行化，一次丢响应会把整条 RPC 通道永久堵死。
- **失败日志**：四类失败（DNS / 握手 / 升级 / 配额）留一行可区分的日志；顺带删掉生产代码里的调试输出。

### 状态层

- **不再在离开会话页时 unfollow**（安卓只在会话消失 / 切换服务 / teardown 三处退订）。
- **实时 `turn/end` 失败当场发失败事实**（新增 `liveTurnFailureMessage`），不再只押在另一条流的 `api-session/error` 上。
- **快照落定后补一次 `markErrorSeen`**：重放会把失败位重新抬起来，正看着的会话不该留红点。
- **未读红点改成可订阅的量**（`unreadErrorStore`）：只订阅失败位的话，"已读"改的是另一个变量，红点消不掉。
- **等待档位不再被二次覆盖**：协调器按 `pendingInteractionKind` 标一次就够，再标一次会把"计划待审"降成普通提问。
- **`seedFromCache` 铺 `hasMore`**：短会话在快照回来前不再一直显示"加载更早"、过程行不折叠。
- **`open()` 先喂首页裁切点**（`seedHistoryCursor`），且**不再 `markEngaged`**（那是"真的发过东西"的标记，
  点开就打会破坏空白会话复用）。
- **刷新代次保护**：下拉 / 回前台 / 重连可能同时在飞，晚回来的旧基线不再盖新的。
- **下拉刷新**加重入保护，并把当前会话的窗口一起对齐。
- **重连 resync** 清空当前会话窗口等快照，不拿没有游标的分页抢跑。
- **会话被删 / 归档**时清掉改动记录与磁盘窗口；被删时报 `sessionGone` 并清选中（归档不报，会话还在主机上）。
- **改动汇总**：404 记 unavailable 不再重发、在飞请求去重、逐文件比较补 `catch`。
- **失败文案**收敛成人话：底层异常只进日志，界面上给 `offlineBannerTitle` / `operationFailed`。
- **空清单不覆盖缓存**，且落盘的是合并后的名册而不是裸 `list.items`。
- **子调用保留 `error` 与 `meta`**。

### 模型层

- `fmt()` 支持 `%02d` 与 `%%`（本端文案用到的 `String.format` 子集）。
- 时长 / 速率格式化加**非有限闸**：NaN / Infinity 读作 0，不再印出 `NaN分NaN秒`。
- `fileLink`：剥离 `#L24` / `#L24-L30` 行号锚点、拒绝非行号片段与查询串；`absolute` 作用域支持 UNC 与盘符段。
- `isImageFile`：先取文件名再找扩展名（`.png` 这种隐藏文件不算图片，目录里的点不干扰）。
- `producedPath`：补齐 `replace_all` / `new_str` / `insert_line` 三处类型校验，畸形调用不再算作产出。
- `todoSummary` / `askSummary`：元素不是对象时整体回退，而不是安静地读成 `0/0`。
- `turnTotalTokens` 走饱和加法。
- `turnDeliverablesFor`：只认根调用、成功收尾的写入（失败的写入与嵌套子调用不再冒充产物）。
- `sessionDisplayTitle`：空白会话一律读作"新会话"，与列表行一致。
- 新增 `chunkedCopy.ts`（分片搬运，含总长上限、越限停止、停滞判定）与 `markdownText.ts`（实体还原、外链白名单）。

### 渲染与主题

- **HTML 实体还原**：marked 的 token 面向 HTML 输出，渲染进 Taro `<Text>` 前必须解回字符。
- **外链协议白名单**：只放行 http/https/mailto，`javascript:` / `data:` 渲染成纯文本不可点。
- **主题色常量指向 `var(--dsh-*)`**，深色主题对行内样式生效。
- **通知行图标按节点类型分派**（失败 / 压缩 / 模型重试 / 长度上限 / 命令各一个，对齐安卓 when 分支）。
- **工具图标**：edit → 铅笔、code → 尖括号（原来是剪刀与拼图，语义是另一回事）。
- **改动卡展开箭头**方向改对（收起朝下、展开朝上）。
- 正文可选中、提及内联、Markdown 图片可点、思考卡详情改纯文本（见第一轮 B 区 D36–D40 的重做）。
- `workflowStatusRunning` 中文改回"运行中"。

### 验收发现的回补

- 新建会话失败兜底文案改用 `noWorkspace`（与安卓同键）。
- 新建会话页导航标题不再写死中文。
- 引导页间距按安卓的 16/8/24 重排，内边距 32。
- 列表空态四选一互斥，不再叠两层。
- 等待档位缺 kind 时兜底按"审批"排档。
- 连接横幅失败/重连文案对齐安卓；输入区删掉安卓没有的预设入口；提问弹层换题滚动复位改受控写法；
  发送/停止/队列/提问等按钮补读屏标签。

## 测试基建（本轮新增）

小程序仓过去**没有任何测试**，而安卓侧有 35 个单测钉住行为口径。本轮把其中的纯逻辑部分移植成
可运行的 node 测试：

```bash
npm test        # node --test，零新增依赖（Node 自带类型擦除 + scripts/test/loader.mjs 补扩展名）
```

| 文件 | 对应的安卓单测 |
| --- | --- |
| [format.test.ts](../scripts/test/format.test.ts) | NumberFormatTest / RelativeTimeTest / PlaceholderFormatTest |
| [nonFinite.test.ts](../scripts/test/nonFinite.test.ts) | NonFiniteReadingsTest |
| [fileLink.test.ts](../scripts/test/fileLink.test.ts) | FileLinkTest |
| [imageFileType.test.ts](../scripts/test/imageFileType.test.ts) | model/ImageFileTypeTest |
| [toolRow.test.ts](../scripts/test/toolRow.test.ts) | ToolRowMalformedArgsTest / ProducedPathValidationTest |
| [sessionRoster.test.ts](../scripts/test/sessionRoster.test.ts) | ArchivedSessionsTest / BlankSessionReuseTest |
| [sessionStore.test.ts](../scripts/test/sessionStore.test.ts) | ContextCollapsedSummaryTest / TurnFailureMessageTest / GoalBarGoalTest / ToolResultLinkageTest |
| [unreadError.test.ts](../scripts/test/unreadError.test.ts) | UnreadErrorGateTest |
| [turnFailure.test.ts](../scripts/test/turnFailure.test.ts) | LiveTurnFailureSignalTest |
| [protocol016.test.ts](../scripts/test/protocol016.test.ts) | Protocol016Test |
| [imageProtocol.test.ts](../scripts/test/imageProtocol.test.ts) | ImageProtocolTest |
| [contentBlock.test.ts](../scripts/test/contentBlock.test.ts) | ContentBlockRoundTripTest |
| [chunkedCopy.test.ts](../scripts/test/chunkedCopy.test.ts) | state/WorkspaceFileChunkedCopyTest |
| [sessionTitle.test.ts](../scripts/test/sessionTitle.test.ts) | Format.kt 的两个 sessionDisplayTitle 重载 + 产物推断两道闸 |
| [statusOrder.test.ts](../scripts/test/statusOrder.test.ts) | StatusOrderRankTest |
| [gfmAutolink.test.ts](../scripts/test/gfmAutolink.test.ts) | ui/component/GfmAutolinkTest + 10531 条黄金语料 |
| [markdownLexerAutolink.test.ts](../scripts/test/markdownLexerAutolink.test.ts) | 同一份语料，但跑的是渲染层真正用的 marked 实例（验接线） |
| [markdownText.test.ts](../scripts/test/markdownText.test.ts) | Markdown.kt 的字符引用还原与 isSafeExternalUrl |

移植时发现的不一致**全部是小程序侧的缺陷**，已在上面逐条修掉；这些测试现在是防回归的闸。

### GFM 自动链接（单独一条，量最大）

安卓有 645 行的 `GfmAutolink.kt` 与一份 10531 条的黄金语料；小程序原来直接用 marked 自带的
autolink，对着同一份语料有 **13.8% 不一致**（587 误报 + 479 漏报 + 383 边界差）：中文域名完全
不成链、`ftp://` 与 `x/a@b.com` 被误链接、带括号的 URL 被截断。

本轮把它整份移植成 [gfmAutolink.ts](../src/model/gfmAutolink.ts)（纯函数），并按安卓的**两层**机制
接进渲染：

1. **词法层**（[markdownLexer.ts](../src/model/markdownLexer.ts)）：关掉 marked 自带的 `url` tokenizer，
   注册一个 inline 扩展在强调/链接解析之前接管——micromark 把字面量自动链接当词法构造，比强调
   更早定型，否则 `https://ex.com/a*b*c` 会被 `*b*` 切成强调；`emStrong` 也要在这一种场景下让位。
2. **语法树层**：剩下的纯文本节点再跑一次正则替换。

`\p{P}|\p{S}` 换成了烘焙好的 BMP 区间表：小程序宿主引擎版本不受控，Unicode 属性转义在老引擎上
是**解析期** SyntaxError（会炸整包），测试里用引擎自带的属性转义对 0..0xFFFF 全量反查这张表防止它过期。

两份回归都绿：[gfmAutolink.test.ts](../scripts/test/gfmAutolink.test.ts) 测纯函数，
[markdownLexerAutolink.test.ts](../scripts/test/markdownLexerAutolink.test.ts) 测**接线**
（真正那个 marked 实例跑完整语料），10531/10531 一致。

## 仍未做的

- **上下文占用圆环**（C-16）、**列表虚拟化**（A-32）、**键盘高度精确跟随**（C-02）：
  第一轮记为"平台限制"，第二轮的审计给出了反驳（canvas 2d 的 arc、Taro VirtualList、
  `wx.onKeyboardHeightChange` 都是可用的），定性应从"做不到"改成"没做"。
- **`wx.showActionSheet` 不显示当前选中项**：权限下拉与视图选项菜单因此不能像安卓那样标出当前值，
  需要改成自绘弹层才能等价。

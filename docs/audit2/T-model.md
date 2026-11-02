# T-model：数据模型与纯逻辑层 二轮审计（Android 权威 → 微信小程序）

审计对象
- 权威参考：`/Users/user/dshapp/dsh-androidapp/app/src/main/java/ai/deepseek/dshphone/model/` 全 18 个文件（外加 `net/Json.kt`、`net/RpcMethods.kt`、`state/SessionStore.kt` 中与节点构建/排序/产物索引相关的段落，以及 `app/src/test/` 下的 NumberFormatTest / PlaceholderFormatTest / RelativeTimeTest / NonFiniteReadingsTest / ProducedPathValidationTest / ToolRowMalformedArgsTest 等钉桩单测）。
- 待审计：`/Users/user/dshapp/dsh-miniapp/src/model/*.ts`（16 个文件）+ `src/const.ts`，并按需追到 `src/transport/rpcMethods.ts`、`src/state/sessionStore.ts`、`src/state/appModel.ts`、`src/i18n/strings.ts` 的对应实现（小程序把若干安卓 model 文件的逻辑放在了这些地方）。
- 本轮只审计、未改动任何源码。

⚠️ 重要前提：**审计期间工作区被并行修改**
本次审计跨越 2026-09-22 11:00–11:19。期间 `src/model/fileLink.ts`(11:14)、`src/model/imageFileType.ts`(11:13)、`src/i18n/strings.ts`(11:13)、`src/model/format.ts`(11:16)、`src/model/toolRow.ts`(11:17) 被其他进程改写，其中 6 处正是本轮先发现的缺陷（见附录 A），在我落笔前已被修好。
下文正文中的所有行号以 **2026-09-22 11:18 的快照** 为准（`format.ts` md5 `473535cce0529a0fc3da8b23428cc468`，`toolRow.ts` md5 `d2425e84e0189d8594644311fbf4b26a`）。因文件仍在变动，复核时请以引用的**符号名/代码片段**定位，行号仅作参考。

---

## 结论摘要

计数（按当前快照）：**P0 = 0，P1 = 2，P2 = 13，另有 6 条在审计窗口内被并行修复（原为 1×P0 + 2×P1 + 3×P2，见附录 A）。**

最重要的 5 条：
1. **M-01（P1）产物（Deliverables）兜底是小程序独有的，且推断口径比安卓宽**：安卓只认主机 `deliverables/presented` 事件，找不到就不画这一节；小程序额外从工具参数反推，且不校验 `result.isError` 与 `parentCallId`，会把"失败的 write/edit"和"run_code 内嵌套调用"都列成本轮产物。
2. **M-02（P1）`sessionDisplayTitle(summary, liveTitle)` 少了"空白会话 → 新会话"这一档**：聊天页标题对新建空白会话显示目录名/sessionId，安卓显示"新会话"；摘要缺失时安卓回退 `untitledSession`（"未命名会话"），小程序直接把 sessionId 摆出来（该文案在 i18n 里存在却没被用）。
3. **M-03（P2）`JobView.status` 未知值语义相反**：小程序把任意字符串强转成 `JobStatus` 并保留该行；安卓的 `@Serializable enum` 解码失败会丢掉整条 job。协议向前扩展时两端画面会分叉。
4. **M-04（P2）`AgentPresetEntry.trust` 缺省值取反**：安卓缺省 `"user"`，小程序 `rpcMethods.ts` 缺省 `'system'`；缺 `trust` 字段的自定义预设在小程序里会被当系统预设做名称本地化，并丢掉菜单上的"· 自定义"后缀。
5. **M-05（P2）`session/attachment` 解码丢字段且失败不报错**：安卓严格解 `SessionAttachmentValue`（含 bytes/width/height/originalDimensions），解不出就抛 `attachment unavailable`；小程序把三个数值字段写死 0，且 `data` 缺失时静默返回空串。

---

## 逐条发现

### M-01【多余 + 错误】产物兜底 `turnDeliverablesFor` 安卓没有，且忽略 isError / parentCallId — P1

- Android 证据：
  - `ui/screen/Sheets.kt:450-458` —— 会话面板的产物只有一条来源：`store.presentedFiles(candidate)`，从当前轮往前最多 6 轮，找不到就是空列表（不画这一节）。
  - `state/SessionStore.kt:1522-1534` —— 从工具参数推断产出路径的那条路径（`producedPathsByTurn`）明确限定：`data.parentCallId == null`（只认根调用）且 `result != null && !result.isError`（只认成功结果），并按 **轮** 去重。
  - `model/Format.kt:330-342`（`TurnDeliverables.presented`）只解析主机 `deliverables/presented` 事件。
- 小程序证据：
  - `src/model/format.ts:403-413`（`turnDeliverablesFor`）：倒序扫最近 6 个 `turnTail`，命中条件仅 `node.kind === 'tool' && node.data.result !== undefined`（**不看 isError、不看 parentCallId**），跨轮全局按 path 去重。
  - `src/ui/sheets.tsx:199`：`store.presentedFiles` 全空时 `return turnDeliverablesFor(store.nodes)`——这一步安卓没有。
  - 对照：`src/state/sessionStore.ts:2666-2690` 的 `producedPathsByTurn` 索引**是**对齐安卓的（有 parentCallId/isError 双重闸），说明两套口径在小程序内部自相矛盾。
- 差异说明：主机没发 `deliverables/presented` 时，安卓的会话面板不显示"产物"，小程序会显示一段安卓永远不会出现的清单；而且这段清单会包含失败的写入（`isError`）与嵌套子调用（`parentCallId != null`）的路径，用户会看到"根本没写成的文件"。
- 建议改法：优先删除 `ui/sheets.tsx:199` 的兜底，回到"只认主机事件"；若产品上确实要保留兜底，至少在 `turnDeliverablesFor` 内补 `node.data.result.isError === false && node.data.parentCallId === undefined`，并改成按轮去重（与 `SessionStore.kt:1529` 的 `seenPaths[turn]` 一致）。

### M-02【错误】`sessionDisplayTitle(summary, liveTitle)` 缺 blank 分支，聊天页标题与安卓不一致 — P1

- Android 证据：
  - `model/Format.kt:138-142`：双参重载第一句就是 `if (summary.blank) return Strings.newSessionPlaceholder`，其后才是 liveTitle → 投影标题 → cwd basename → sessionId。
  - `ui/screen/ChatScreen.kt:249`：`summary?.let { sessionDisplayTitle(it, store?.title) } ?: Strings.untitledSession`。
  - `ui/screen/ArchivedSessionsScreen.kt:188`：`sessionDisplayTitle(summary, null)`（同样带 blank 判定）。
- 小程序证据：
  - `src/model/format.ts:150-160`：双参 `sessionDisplayTitle` **没有** blank 判定；blank 判定被单独放进 `sessionListTitle`（`format.ts:162-166`），而 `sessionListTitle` 只被会话列表用（`src/pages/index/index.tsx:63`）。
  - `src/state/appModel.ts:1094-1099`（`sessionTitle`）：摘要缺失时 `return store?.title ?? sessionId`，命中时 `sessionDisplayTitle(summary, store?.title)`。
  - 调用点：`src/pages/chat/index.tsx:145`、`:152`、`:482`（导航栏与页内标题）；`src/pages/archived/index.tsx:99` 同样用的是无 blank 判定的双参版本。
  - `src/i18n/strings.ts:87` 有 `untitledSession`（"未命名会话"），但全项目无人使用。
- 差异说明：①进入一条刚创建的空白会话，安卓标题是"新会话"，小程序显示 cwd 目录名（cwd 为空时显示 sessionId）；②会话摘要还没同步到时，安卓显示"未命名会话"，小程序把原始 sessionId 当标题；③归档页同理。
- 建议改法：把 blank 判定收回 `sessionDisplayTitle`（与安卓重载语义一致），`sessionListTitle` 改为薄封装；`appModel.sessionTitle` 的兜底改成 `store?.title ?? Strings.untitledSession`。

### M-03【错误】`JobView.status` 未知值：小程序保留、安卓丢弃 — P2

- Android 证据：`model/Models.kt:369-378`（`@Serializable enum JobStatus`，只认 5 个 `@SerialName`），`model/Frames.kt:279`、`:295` 用 `it.decodeOrNull<JobView>()` —— 状态值不在枚举内时整条 JobView 解码失败被丢掉。
- 小程序证据：`src/model/frames.ts:419-432`，`const status = (str(jget(value,'status')) ?? 'running') as JobStatus` —— 任何字符串都被当成合法状态保留。
- 差异说明：主机新增一种 job 状态（或发来畸形值）时，小程序多出一行状态词是原始英文串、`jobIsLive` 为 false 的"僵尸任务"，安卓则完全不显示。属于协议演进时的两端分叉。
- 建议改法：加一张白名单集合，命中才保留，否则 `return undefined`（与安卓同丢弃）；或明确决定"更宽松"并在注释里写清与安卓的差异。

### M-04【错误】`AgentPresetEntry.trust` 缺省值与安卓相反 — P2

- Android 证据：`model/Models.kt:303-311`，`val trust: String = "user"`（缺字段按"用户预设"处理）。消费点：`model/Format.kt:400-415`（`trust == "system"` 才做名称本地化；`trust == "user"` 才加 "· 自定义" 后缀）。
- 小程序证据：`src/transport/rpcMethods.ts:543`，`trust: str(jget(preset,'trust')) ?? 'system'`；消费点 `src/model/format.ts:419-438` 与安卓一致。
- 差异说明：主机（或 0.1.5 老主机）不发 `trust` 时，同一条预设在安卓是"自定义预设、显示作者给的 name"，在小程序会被当成系统预设——若它的 id 恰好是 `standard/code/minimal/cordis`，名字还会被替换成内置本地化文案，并且菜单里少了"· 自定义"。
- 建议改法：默认值改 `'user'`。

### M-05【错误/缺失】`session/attachment` 解码丢字段、失败不报错 — P2

- Android 证据：`net/RpcMethods.kt:219-221` —— `decodeOrNull<SessionAttachmentValue>() ?: throw internalError("attachment unavailable")`；`model/Models.kt:209-221` 的 `ImageAttachmentRef` 含 `bytes/width/height/name/originalDimensions`。
- 小程序证据：`src/transport/rpcMethods.ts:278-296` —— `bytes: 0, width: 0, height: 0` 写死，无 `originalDimensions`，`data: str(...) ?? ''`（取不到就空串，不抛）。
- 差异说明：①尺寸/字节数字段全丢，任何依赖它们的展示（例如"原始尺寸"提示、按比例占位）都无从实现；②主机返回体异常时安卓走错误路径，小程序拿到一张空 base64 继续往下走，错误被吞掉。
- 建议改法：按 `ImageAttachmentRef` 完整解码（可复用 `model/imageCards.ts` 的 `decodeImageRef`），`data` 缺失时抛 `internalError('attachment unavailable')`。

### M-06【错误】`recordedAgentPreset` / `canResumeBlankSession` 的空串语义与安卓相反 — P2

- Android 证据：`model/BlankSessionReuse.kt:32-33`（`summary.agentPreset ?: projections…`，**不**过滤空串）、`:45-50`（`entry.broken == null` 才算可用，空串视为"已损坏"）。
- 小程序证据：`src/model/blankSessionReuse.ts:13-17`（两处都要求 `length > 0`）、`:33`（`broken === undefined || broken === null || broken.length === 0` 都算健康）。
- 差异说明：`agentPreset: ""` 时，安卓判为"记了一个目录里不存在的预设"→ 不复用该空白会话；小程序判为"没记预设"→ 复用。`broken: ""` 时安卓判损坏、小程序判健康。两处方向相反，结果是"安卓新建一条会话、小程序复用一条打不开的会话"。
- 建议改法：与安卓对齐（`agentPreset` 不过滤空串；`broken` 仅 `undefined/null` 算健康），或在两端同时改口径。

### M-07【错误】`projectUserRefs` 的 wire 形态缺左边界判定 — P2

- Android 证据：`ui/component/UserRefProjection.kt:30-42` —— 只有当 `@` 位于串首或前一个字符是空白时，才尝试解析 `@[标题](dsh-session:…)`（边界判定在 `wireMentionAt` 之前）。
- 小程序证据：`src/model/userRefs.ts:13`（`WIRE_RE` 全局匹配，无左边界）、`:59-68`（直接把每个匹配都收成 range）；标题匹配分支（`:74-75`）倒是有 `before/after` 边界判定。
- 差异说明：`foo@[标题](dsh-session:…)` 在安卓是纯文本，在小程序会被折叠成一枚可点击的会话引用。正文里贴代码/URL 时可能误伤。
- 建议改法：给 `WIRE_RE` 加左边界（`(?<=^|\s)` 在小程序引擎的支持度待确认，可改为匹配后手工校验 `text[start-1]`）。

### M-08【错误/待确认】`wireSessionId` 不接受带 padding 的 base64url — P2

- Android 证据：`ui/component/UserRefProjection.kt:80-87` —— `Base64.decode(..., URL_SAFE or NO_PADDING)`，解码端对 `=` 容忍。
- 小程序证据：`src/model/userRefs.ts:23-44` —— 自实现 base64url，字母表里没有 `=`，遇到即 `return undefined`，整条引用退回纯文本。
- 差异说明：主机若发出带 padding 的 `dsh-session:` URI，小程序会把引用显示成原始 markdown 文本。
- 待确认：主机（`dsh-session` URI 生成处）是否保证无 padding。确认方法：在 host 仓里搜 `dsh-session:` 的编码点，或抓一条真实的排队中消息 wire 内容看是否含 `=`。
- 建议改法：解码前先 `replace(/=+$/,'')`，对非字母表字符按"跳过"而非"整体失败"。

### M-09【错误/待确认】`formatExactTokens` 依赖 `Number.prototype.toLocaleString('en-US')` — P2

- Android 证据：`model/Format.kt:104` —— `String.format(Locale.ROOT, "%,d", value)`；`test/NumberFormatTest.kt:54-57` 钉死 `"1,234,567"`，并显式把设备 Locale 钉成德语来防漂移。
- 小程序证据：`src/model/format.ts:75-77` —— `value.toLocaleString('en-US')`。
- 差异说明：`toLocaleString(locale)` 的分组行为依赖运行时是否带 Intl；微信小程序在部分机型/基础库上 Intl 支持不完整（可能忽略 locale 参数、直接返回无分组数字），一旦如此，token 读数就与安卓/Web 不一致。另外若传入非整数（`1234.5`）会输出 `"1,234.5"`，安卓的 `%,d` 会先截断成整数。
- 待确认：在微信开发者工具 + 真机 console 跑 `(1234567).toLocaleString('en-US')`，看是否为 `1,234,567`。
- 建议改法：自己写三位分组（`String(Math.trunc(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')`），去掉 Intl 依赖。

### M-10【错误】`turnTotalTokens` 没有走饱和加法 — P2

- Android 证据：`model/Format.kt:85-91`（三次 `saturatingAdding`）+ `model/SessionUsageReading.kt:43-50`（实现）；注释写明"直接相加会回绕成负数，token 药丸与明细卡双双消失"。
- 小程序证据：`src/model/format.ts:56-59` —— 直接 `+`；而 `saturatingAdd`（`format.ts:88-94`）只在 `src/ui/sheets.tsx:453-455` 的会话级读数里用了。
- 差异说明：JS 是双精度，不会回绕成负数，所以安卓要防的崩塌在小程序不会发生；但超过 `2^31-1` 时两端**显示值不同**（安卓顶到 2147483647 → "2147M"，小程序给真实和 → 例如 "4295M"）。属于极端值下的口径分叉，不是 bug 但不一致。
- 建议改法：为了三端一致，`turnTotalTokens` 也走 `saturatingAdd`；或在注释里写明"JS 侧刻意不饱和"。

### M-11【错误/待确认】`commands/execute` 缺 `commandId` 时的回退方向相反 — P2

- Android 证据：`net/RpcMethods.kt:324-335` —— 只有 `value is JsonNull` 才当"没认出命令"；否则 `decodeOrNull<CommandExecutionValue>()`，而 `commandId` 有默认值 `""`（`model/Models.kt:341-345`），所以 `{}` 仍算"命令已执行"。
- 小程序证据：`src/transport/rpcMethods.ts:447-449` —— `commandId === undefined` 直接 `return undefined`；调用方 `src/state/appModel.ts:678-697` 把 undefined 当作"主机没认出这条命令"，于是**把 `/xxx` 当普通消息发给模型**。
- 差异说明：若主机在某些命令上回 `{ result: … }` 而不带 `commandId`，安卓静默成功、小程序会把斜杠命令原文发进会话。
- 待确认：主机 `commands/execute` 是否恒带 `commandId`。确认方法：查 host `dsh-commands` 插件的返回体定义，或抓一次真实执行的响应。
- 建议改法：与安卓一致——只有响应为 `null` 才回退，其余按 `commandId ?? ''` 处理。

### M-12【缺失】`WorkspaceFileBytesValue.offset` 字段缺失 — P2

- Android 证据：`model/Models.kt:275-283`（`offset` 是值的一部分）。
- 小程序证据：`src/model/types.ts:242-248` 没有 `offset`；`src/transport/rpcMethods.ts:378-397` 也不解析。
- 差异说明：当前分片读图只用 `data/eof`，行为无差；但主机若在某次分片里返回与请求不同的 `offset`（seek 被夹取），小程序无从发现，会把窗口拼错。属健壮性缺口。
- 建议改法：补上字段并在分片循环里校验。

### M-13【多余】`decodeProjectionsBlock` 支持"扁平形状"，安卓只认 values 容器 — P2

- Android 证据：`model/Models.kt:11-15`（`SessionProjectionsBlock(asOfSeq, values)`，kotlinx 严格按字段解）；`model/Frames.kt:368`、`:281-283` 都直接 `decodeOrNull`。
- 小程序证据：`src/model/frames.ts:385-403` —— 额外支持"键直接挂在对象上、每键是 `{value}` 壳"的旧 Mock 形状。
- 差异说明：小程序更宽松。风险在于：真实投影值里若恰好带 `value` 字段且外层没有 `values` 容器，会被脱掉一层壳（自注释里也承认这点）。目前主机形状固定为 values 容器，实际不触发。
- 建议改法：保留可以，但建议加一条只在"离线缓存/Mock"路径启用的开关，避免线上数据被误脱壳。

### M-14【多余】`decodeSessionEvent`/`decodeHistoryEntry` 比安卓宽松 — P2

- Android 证据：`model/Models.kt:234-252` —— `SessionEvent.seq: Int` 无默认值（缺 `seq` 解码即失败，整条记录被 `mapNotNull` 丢掉）；`HistoryEntry(event, view)` 要求有 `event` 键（`model/Frames.kt:366`、`:373`）。
- 小程序证据：`src/model/frames.ts:439-458` —— 只要求 `type`，`seq/time` 缺失填 0；`decodeHistoryEntry` 还接受"裸 event 对象"（`jget(value,'event') ?? value`）。
- 差异说明：畸形/半截记录在小程序会以 `seq=0` 混进转写（排序锚点 0 会让它排到最前），安卓直接丢弃。同理 `session/list` 里一条坏 item：安卓是 `decodeOrNull<SessionListValue>()` 整份失败退化成空列表，小程序逐条过滤（这点小程序更好）。
- 建议改法：`decodeSessionEvent` 要求 `seq` 可解，缺失返回 undefined，避免 seq=0 的幽灵行。

### M-15【多余】`fileExtension` 会剥离 `?`/`#`，安卓不剥 — P2

- Android 证据：`model/ImageFileType.kt:17-22` —— 只取最后一段路径名再找最后一个点，不处理查询串/片段。
- 小程序证据：`src/model/imageFileType.ts:12-20` —— 先 `split('?')[0].split('#')[0]`。
- 差异说明：`a.png#L3` 在小程序判为图片、安卓判为非图片（扩展名 `png#L3`）。考虑到 `fileLink` 侧已经会先切掉 `#L…`，实际影响极小；方向上小程序更宽松、并不致错。
- 建议改法：可保留；若要严格对齐，把 `?`/`#` 的处理交给调用方（`parseFileLink`）。

### M-16【缺失】`ImageFileType.mimeTypeOf` 无对应实现（结论：可接受） — P2

- Android 证据：`model/ImageFileType.kt:27-40`，消费点 `ui/component/SystemImageViewer.kt:59`（`Intent.setDataAndType` 必须要 MIME）。
- 小程序证据：`src/model/imageFileType.ts` 只有 `fileExtension`/`isImageFile`；打开图片走 `Taro.previewImage`（`src/pages/chat/index.tsx:133-139`、`:401`），不需要 MIME。
- 差异说明：平台差异导致的合理缺失，不需要补。列在此处是为了避免下一轮重复标记。

### M-17【错误/待确认】`json.bool` 不接受字符串布尔，安卓的 `booleanOrNull` 接受 — P2

- Android 证据：`net/Json.kt:46-47` —— `(this as? JsonPrimitive)?.booleanOrNull`，kotlinx 的 `booleanOrNull` 对 `"true"`/`"false"` 这样的**字符串** primitive 也会返回布尔值。
- 小程序证据：`src/model/json.ts:56-58` —— `typeof value === 'boolean'` 才认。
- 差异说明：若主机（或 bridge）把布尔序列化成字符串，安卓读到 true、小程序读到 undefined，进而落到各处默认值（`hasMore=false`、`isError=false`、`modeSelectionEnabled=true` 等）。当前主机发的是真布尔，不触发。
- 待确认：kotlinx `booleanOrNull` 对带引号字符串的确切行为（跑一条 JVM 单测最快）；以及 bridge 是否会改写类型。
- 建议改法：确认后若确有差异，在 `bool()` 里补一条 `'true'/'false'` 字符串解析。

---

## 已核对确认等价的清单（无需再审）

| 安卓文件/符号 | 小程序对应物 | 结论 |
| --- | --- | --- |
| `Frames.kt` QueuedInboxItem / decodeQueuedItem / QueuedInboxMessage / decodeInbox / rowsFromInbox | `model/frames.ts:17-101` | 等价（`text` 改成自由函数 `queuedItemText`；placement 推导、rpcId 来源一致） |
| `Frames.kt` decodeRemoteEventFrame（ready/emit/waterfall/cancel/unknown） | `frames.ts:116-135` | 等价，分支与字段默认值逐条一致 |
| `Frames.kt` decodeWorkspaceFrame（baseline/upsert/remove/order/archived） | `frames.ts:149-184` | 等价 |
| `Frames.kt` decodeControlFrame（baseline/queue/jobs/projection） | `frames.ts:210-261` | 等价（projections 缺省块同为 `asOfSeq:0, values:{}`） |
| `Frames.kt` decodeAssistantStreamFrame / decodeAssistantBaseline（start/chunk/end + outcome.kind=="committed"） | `frames.ts:281-331` | 等价 |
| `Frames.kt` decodeFollowFrame（snapshot / assistant-stream / 其余当事件） | `frames.ts:346-368` | 等价（宽松度差异见 M-14） |
| `Frames.kt` ApprovalRequested / ApprovalOutcome / AskUserQuestion* / QuestionIntent / QuestionAnswer | `model/questionFlow.ts:6-35` | 等价（仅文件归属不同） |
| `Frames.kt` PlanReviewFlow.route / approveAnswer / reviseAnswer | `questionFlow.ts:46-71` | 等价 |
| `Frames.kt` PlanReviewFlow.submitAnswer | `src/ui/sheets.tsx:805-806`（notes 为空走 approve，否则 revise） | 等价（内联实现） |
| `Frames.kt` pendingInteractionKind | `questionFlow.ts:74-83` | 等价 |
| `QuestionFlow.kt` 全部（draft/answered/completed/choose/chooseSettlingBatch/setCustom/skip/continueFlow/validateForSubmission/answers） | `questionFlow.ts:87-220` | 等价，逐分支核对（含单选清空 custom、跳过后仍走提交校验、answers 的 custom 互斥编码） |
| `ChatNode.kt` ContentBlock/decode/encode（含 tool-result 嵌套 content 编码） | `model/chatNode.ts:11-72` | 等价 |
| `ChatNode.kt` AssistantBlock/toAssistantBlock/hasVisibleContent/isVisible | `chatNode.ts:83-180` | 等价 |
| `ChatNode.kt` nodeId / anchorSeq（含 +0.05 / +0.1 / -0.001 偏移）/ rendersRow / turnNumber / chatNodeSearchText | `chatNode.ts:325-403` | 等价，逐 case 核对 |
| `ChatNode.kt` toolResultText / resultFirstLine / firstLine | `chatNode.ts:406-426`、`json.ts:99-102` | 等价 |
| `ChatNode.kt` TurnProcessSpec.key/covers、isSubagentDelegationTool | `chatNode.ts:5-7,122-128` | 等价（key 由 data class 换成字符串） |
| `SessionStore.kt:1354-1372` 节点排序（compareBy(anchor, nodeId)） | `state/sessionStore.ts:253-257,2442-2458`（`keyedCompare`） | 等价（JS sort 稳定、字符串按 UTF-16 比较） |
| `SessionStore.kt:1396-1488` 轮次过程折叠（Accumulator/isAnswer/inlineReasoning/external anchor/isFoldedProcessRow） | `sessionStore.ts:2477-2613` | 等价，逐字段核对 |
| `SessionStore.kt:1332-1352` 嵌套工具调用（按 startSeq 排序、visited/depth<64 防环） | `sessionStore.ts:2413-2440` | 等价 |
| `SessionStore.kt:1508-1548` indexRows 的 producedPathsByTurn（根调用 + 非错误 + 按轮去重） | `sessionStore.ts:2655-2701` | 等价（兜底那条见 M-01） |
| `Format.kt` formatDuration / formatStatsDuration / formatLatencySeconds / formatTokensPerSecond（含 NaN/Inf 闸） | `format.ts:21-48`（`nonNegative`） | 等价（附录 A-2 修复后） |
| `Format.kt` formatTokens / tokenCount / compactTokenCount / cacheHitPercent | `format.ts:64-86,127-137` | 等价（K/M 档、<100 时一位小数、夹到 99.9 的规则一致） |
| `SessionUsageReading.kt` sessionCacheHitPercent + formatFixed | `format.ts:96-125` | 等价（0→6 位小数递进、部分命中不读成 100 的规则一致，实测 9994/10000→"99.9"、99999999/1e8→"99.999999" 两端一致） |
| `SessionUsageReading.kt` billed/total/hasTokens + saturatingAdding | `src/ui/sheets.tsx:447-463` + `format.ts:88-94` | 等价（内联实现，见下方备注） |
| `Format.kt` pathBasename / sessionWorkspaceName / sessionSearchName / sessionMatchesSearch / mergeSessionSearchResults / SESSION_SEARCH_RESULT_LIMIT | `format.ts:141-215` | 等价 |
| `Format.kt` SessionAwaitingKind.badge / SessionRowTrailing.resolve | `format.ts:229-256` | 等价 |
| `Format.kt` TurnRailPreview.clip / mergeTurnRailItems / TurnRailItem | `format.ts:272-323` | 等价（limit*2 预取、`\s+` 归一、limit-1 截断 + 省略号一致） |
| `Format.kt` PlanModeToggle | `format.ts:327-332` | 等价 |
| `Format.kt` TurnDeliverables.presented / resolveMention | `format.ts:338-351,397-401` | 等价 |
| `Format.kt` producedPath（write/edit/str_replace_editor 三类参数校验） | `format.ts:357-395`（校验段 366-390） | 等价（附录 A-4 修复后） |
| `Format.kt` agentPresetDisplayText / agentPresetMenuLabel | `format.ts:428-447` | 等价 |
| `Format.kt` splitRecommended + 正则 | `format.ts:449-461` | 等价（全/半角括号 × 中英文 × 忽略大小写） |
| `Format.kt` relativeTime 六档桶 / clockTime / formatBytes / subagentSessionIds | `format.ts:485-516` | 等价（对照 RelativeTimeTest 的 now/5min/3h/2d/4mo/1y 与中文档全部一致） |
| `GoalPhaseAction.kt` | `format.ts:470-475`（`goalPhaseAction`） | 等价（active→pause、paused→resume、其余不给） |
| `WorkflowLabels.kt` workflowStatusLabel | `src/ui/messageRow.tsx:431-442` | 等价（文案键一一对应，位置在 UI 层） |
| `AgentPresetRoster.kt`（presets + pickerEnabled） | `transport/rpcMethods.ts:552` + `state/appModel.ts:894` + `pages/new/index.tsx:27,106,162` | 等价（`modeSelectionEnabled` 缺省 true，关掉就不给选择器入口） |
| `TurnFailureMessage.kt` turnFailureMessage | `model/turnFailure.ts:14-19` | 等价 |
| `TurnFailureMessage.kt` liveTurnFailureMessage（只看 turn/end + reason.kind=="error"） | `state/sessionStore.ts:1887-1915` | 等价（内联实现） |
| `TurnFailureMessage.kt` turnFailureNotificationBody | 小程序无本地通知通道 | 合理缺失 |
| `ArchivedSessions.kt` listSessionsVisible / archivedSessionRows / filterArchivedSessions | `model/archivedSessions.ts:24-72` | 等价（含 `asReversed` 的倒序语义） |
| `ContextPresentation.kt` ContextForm.from / fieldsReadable / contextCollapsedSummary 及四个 readable 判定 | `model/contextPresentation.ts:10-102` | 等价，逐字段核对（description/text 必须是字符串；retained/omitted/truncated 必须可读） |
| `ImageBlocks.kt` IMAGE_MEDIA_TYPES / IMAGE_ENVELOPE / positiveInteger / decodeImageRef / imageReferences / lenientImageRefs / imageTexts / fullyRendered / readImageCard | `model/imageCards.ts:18-179` | 等价，逐分支核对（含 name 非法即整体回落、metaPath 优先、嵌套调用回退 file_path） |
| `TurnChanges.kt` TurnChangesSummary.decode / ChangedFileDiff.decode / ChangedFileHunk | `model/turnChanges.ts:38-112` | 等价（缺字段丢条目、kind 白名单、coarse 默认 false 一致） |
| `ToolRow.kt` classifyTool / SUMMARY_KEYS / KEYED_ROW_TOOLS / deriveSummary / deriveFilePath / relativizeToCwd / toolRowModel / todoSummary / askSummary / planSummary | `model/toolRow.ts:18-243` | 等价（附录 A-5 修复后；ASK_ABORTED→stopped、terminal 失败升级为 error、others 前缀拼名等逐条一致） |
| `FileLink.kt` parse / parseInlineCode / fileAddress / parseResource / fileUrlPath / decode | `model/fileLink.ts:29-159` | 等价（附录 A-3 修复后，含 `#L24`/`#L24-L30` 校验、UNC、盘符段） |
| `Models.kt` 其余数据类（SessionSummary / SessionProjectionsBlock / 模型目录 / 权限 / 附件上限 / 工作区 / 命令 / skills / 目标 / 子智能体 / SessionAddress） | `model/types.ts` 全文 | 字段逐个核对，除 M-12 外无缺字段；`CommandInputDescriptor` 在小程序是 `input?: JsonElement` + `commandInputHint()`（`ui/composerBar.tsx:165-181`），`wantsArgs = input != null` 与安卓 `PhoneModel.kt:1118` 一致 → 等价 |
| `Models.kt` ModelDirectoryState 的五个转移（beginLoading/beginSelecting/receive×2/applyProjectedSelection/fail + generation 闸） | `types.ts:88-144` | 等价，逐句核对 |
| `Models.kt` PermissionSelection.merge / currentOption / selectableOptions | `types.ts:172-186` | 等价（小程序多一层 `?? []` 容错，无行为差） |
| `net/Json.kt` str/text/int/dbl/arr/obj/jsonScalarText/prettyJson | `model/json.ts` | 等价（`bool` 见 M-17；`jsonPrimitiveText` 两端皆为未使用的死代码，安卓对 JsonNull 返回 "null"、小程序返回 ""，无消费点） |
| `const.ts`（颜色 + DIMENS 13 项 + DEFAULT_TITLE） | — | 无安卓 model 对应物（对应 `ui/theme/Theme.kt`），不属本轮范围，未发现与 model 层冲突 |

备注：`SessionUsageReading.kt` 在小程序没有独立模块，`billed/total/hasTokens` 的判定内联在 `ui/sheets.tsx:447-463`。语义等价，但缺少复用点与可测点——安卓那侧是靠 JVM 单测钉住的（`SessionCacheHitPercentTest`）。建议后续抽成 `model/sessionUsage.ts`，不算缺陷。

---

## 附录 A：审计窗口内被并行修复的问题（2026-09-22 11:13–11:17）

这些是本轮先发现、随后被其他进程改好的，记录在此以免下一轮重复排查；建议复核确认没有回归。

| 编号 | 原问题 | 原严重度 | 修复后现状 |
| --- | --- | --- | --- |
| A-1 | `fmt()` 只认 `%d`/`%s`，`durationMinutes`（`'%dm %02ds'`/`'%d分%02d秒'`）里的 `%02d` 原样留在界面上——超过 1 分钟的轮次用时显示为 `"2分%02d秒"`（实测）。安卓 `i18n/Strings.kt:343` 用 `String.format(Locale.ROOT, …)`，`test/PlaceholderFormatTest.kt:45,51` 钉死 `"07"`/`"2m 07s"`。 | P0 | `src/i18n/strings.ts:352-361` 已支持 `%%`、`%0<width>d`、`%<width>s` |
| A-2 | `format.ts` 缺 `nonNegative`：`formatStatsDuration(NaN)`→`"NaN分NaN秒"`、`formatStatsDuration(Infinity)`→`"Infinity分NaN秒"`、`formatLatencySeconds(NaN)`/`formatTokensPerSecond(NaN)`→`"NaN"`、`formatDuration(NaN)`→`"NaN秒"`（实测）。安卓 `Format.kt:40-75` 有显式 isFinite 闸，`test/NonFiniteReadingsTest.kt` 专门钉住。 | P1 | `format.ts:17-19` 新增 `nonNegative`，四个读数函数全部接入 |
| A-3 | `fileLink.ts` 缺 `fileAddress`：不切 `#L24`/`#L24-L30` 行号锚点、不拒查询串，导致带行号的文件链接拿 `Foo.kt#L24` 去 `workspaceFiles/read`（主机只会回 not-found）；行内代码路径同样因扩展名含 `#` 而完全不识别；`absolute` 作用域也没有 UNC/盘符段处理。对照 `FileLink.kt:135-141,149-180`。 | P1 | `fileLink.ts:26-52,119-148` 已补齐（含 `DRIVE_SEGMENT`、UNC 分支） |
| A-4 | `producedPath` 漏三处参数校验：`edit` 的 `replace_all` 非布尔、`str_replace` 的 `new_str` 非字符串、`insert` 的 `insert_line` 用 `Math.trunc` 把 `1.5` 截成 1（安卓 `Format.kt:352-384` + `test/ProducedPathValidationTest.kt` 三条断言）。 | P2 | `format.ts:366-390` 三处校验齐了 |
| A-5 | `todoSummary`/`askSummary` 对畸形元素是"过滤"而非"整体回退"，会把 `{"todos":["a"]}` 读成 `0/0 已完成`；安卓 `ToolRow.kt:93-101` 的 `objectList` 元素级校验失败即整体返回 null（`test/ToolRowMalformedArgsTest.kt`）。 | P2 | `toolRow.ts:192-197,223-227` 已补 `length !== rawLength → undefined` |
| A-6 | `imageFileType.ts` 直接在全路径上找最后一个点：`/tmp/.png` 被判成图片、目录名带点的路径判定也不对；安卓 `ImageFileType.kt:17-22` 先取文件名再判 `dot <= 0`。 | P2 | `imageFileType.ts:12-20` 已抽出 `fileExtension` 并先取文件名 |

## 附录 B：复核方法速查

- 数值读数：把 `app/src/test/java/ai/deepseek/dshphone/{NumberFormatTest,NonFiniteReadingsTest,RelativeTimeTest,PlaceholderFormatTest,SessionCacheHitPercentTest}.kt` 的断言逐条搬成小程序侧单测（目前小程序仓无测试目录，这是下一轮最值得补的基建）。
- 参数校验：`ProducedPathValidationTest.kt` 与 `ToolRowMalformedArgsTest.kt` 的用例可直接复用。
- 文件链接：安卓 `FileLinkTest.kt` 是 Web `file-address` 用例的移植，可照搬。
- 协议解码：`Protocol016Test.kt` 覆盖 0.1.5/0.1.6 两代形状，适合验证 M-03/M-13/M-14。

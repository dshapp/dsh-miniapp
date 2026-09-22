# T 轮审计：把 Android 的 35 个单元测试当作行为规格逐条核对小程序实现

> 审计对象：`/Users/user/dshapp/dsh-miniapp/src/`（微信小程序 / Taro + React + TS）
> 权威口径：`/Users/user/dshapp/dsh-androidapp/app/src/test/java/ai/deepseek/dshphone/`（35 个测试文件 + `test/resources/gfm-autolink-golden.json`）
> 方法：逐个测试读懂「输入 -> 期望输出」的规格，在小程序侧找到对应实现，人工推演同样输入下的输出；GFM 语料一项用 Node 直接跑 `marked` 对着 golden 实测。
> **代码快照：2026-09-22 11:18（CST）**。审计过程中 `src/model/{format,fileLink,imageFileType,toolRow}.ts` 与 `src/i18n/strings.ts` 被并发修改过，本报告所有结论均已在上述时刻重新复核；早期读到的旧版本结论（NonFinite/turnTotalTokens/producedPath/ToolRow 畸形参数/FileLink 行锚点）在当前快照下已经通过，已归入「等价/通过」清单并附注。

---

## 结论摘要

| 严重度 | 条数 |
| --- | --- |
| P0（功能性错误 / 协议不兼容） | 2 |
| P1（用户可感知的行为差异） | 3 |
| P2（细节 / 文案 / 健壮性） | 9 |

35 个测试的判定分布：**通过 25 · 不通过 7 · 部分不通过 1 · 无对应实现（架构不适用）2**。

最重要的 5 条：

1. **T-01 / P0** —— 保活探活帧发的是 `{"type":"ping"}`，主机 `parseRemoteStreamClientMessage` 只认 `cancel`/`open`，会 `close(1008)` 把一条健康连接整代拆掉。Android 发的是空 `cancel`。（`MuxProbeFrameTest`）
2. **T-02 / P0** —— 工作区图片分片搬运用 `offset += chunk.bytes` 推进，而 `bytes` 是主机给的**文件总长度**、不是本片长度；任何大于一个窗口（2 MiB）的图片只会落下第一片，文件被静默截断。（`WorkspaceFileChunkedCopyTest`）
3. **T-03 / P1** —— `tool/result` 在 `callId` 为空时既接不回那条以 `seq-<seq>` 落键的调用，孤儿行又都挤在 `tool-call:` 这一把空键上互相覆盖。（`ToolResultLinkageTest`）
4. **T-04 / P1** —— `seedFromCache` 没有把缓存窗口自己的 `hasMore` 铺到 store 上，短会话冷启动时「加载更早」一直亮着、过程行不折叠。（`SeedFromCacheHasMoreTest`）
5. **T-05 / P1** —— 链接识别用的是 `marked` 自带的 GFM autolink，对着 Web golden 实测 **1451 / 10531（13.8%）不一致**；其中「中文域名 URL 完全不成链接」「`ftp://`/`x/a@b.com` 被误链接」对中文用户直接可见。（`GfmAutolinkTest`）

---

## 总表：35 个测试逐条判定

| 测试名 | 规格要点 | 小程序对应实现(file:line) | 判定 | 差异细节 |
| --- | --- | --- | --- | --- |
| MuxProbeFrameTest | 探活帧必须是主机接受的上行帧（空 `cancel`） | [mux.ts:82-84](src/transport/tunnel/mux.ts#L82-L84) | **不通过 P0** | 发 `{"type":"ping"}`，主机 1008 断连 → T-01 |
| WorkspaceFileChunkedCopyTest | 按片顺序拼接、按**解码后长度**推进 offset、超限前置拒绝、空片视为 stall | [appModel.ts:1070-1092](src/state/appModel.ts#L1070-L1092) | **不通过 P0** | `offset += chunk.bytes`（总长度）；无 stall 判定；超限判定在写盘之后 → T-02、T-13 |
| ToolResultLinkageTest | 空 callId 的结果接到「最近一条没有结果的调用」；接不上才起唯一 `orphan-<seq>` | [sessionStore.ts:1760-1780](src/state/sessionStore.ts#L1760-L1780) | **不通过 P1** | 直接用空串拼键；孤儿 id 也是空串 → T-03 |
| SeedFromCacheHasMoreTest | 缓存窗口的 `hasMore` 要随窗口一起铺上 | [sessionStore.ts:1219-1223](src/state/sessionStore.ts#L1219-L1223) | **不通过 P1** | 只 `eventWindow.replace`，没写 `this.hasMore` → T-04 |
| GfmAutolinkTest | 链接识别与 Web micromark 逐字符一致（golden 10531 条） | [markdown.tsx:17](src/ui/markdown.tsx#L17)（`marked` GFM） | **不通过 P1** | 实测 1451 条不一致 → T-05 |
| WorkflowStatusLabelTest | 状态词随界面语言；`RUNNING` 中文是「运行中」 | [strings.ts:310](src/i18n/strings.ts#L310)、[messageRow.tsx:431-444](src/ui/messageRow.tsx#L431-L444) | **不通过 P2** | 中文写成「进行中」 → T-06 |
| LiveTurnFailureSignalTest | 实时帧上的 `turn/end(error)` 当场发失败事实；卡片正文保留主机原因 | [streamCoordinator.ts:734-755](src/state/streamCoordinator.ts#L734-L755) | **不通过 P2** | 实时帧不发 `failed`；无 `turnFailureNotificationBody` → T-07 |
| TurnChangesStoreRetryTest | 传输失败不缓存（可重试）；404 记 unavailable 不再重试 | [appModel.ts:436-458](src/state/appModel.ts#L436-L458) | **部分不通过 P2** | 传输失败不锁定 ✅；404 不记 unavailable ❌；`loadDiff` 不捕获异常 → T-08 |
| ImageFileTypeTest | 扩展名判图（basename 内、`.png` 不算）+ `mimeTypeOf` 映射 | [imageFileType.ts:12-23](src/model/imageFileType.ts#L12-L23) | 通过（`isImage` 部分） | `mimeTypeOf` 无对应实现，见 T-11 |
| NumberFormatTest | 读数固定 `.` 小数点、`,` 千分位，不跟设备区域 | [format.ts:40-93](src/model/format.ts#L40-L93) | 通过 | `formatExactTokens` 走 `toLocaleString('en-US')`，依赖 Intl，见 T-10 |
| PlaceholderFormatTest | `%d`/`%02d`/`%s` 只出 ASCII 数字 | [strings.ts:352-356](src/i18n/strings.ts#L352-L356) | 通过 | JS 模板替换无本地化数字问题 |
| RelativeTimeTest | 六档桶 now/min/h/d/mo(30d)/y(365d)，未来时间夹到 0 | [format.ts:473-488](src/model/format.ts#L473-L488) | 通过 | 中英两套词表逐条一致 |
| NonFiniteReadingsTest | NaN/±∞ 读作 0 | [format.ts:17-48](src/model/format.ts#L17-L48) | 通过 | 本轮审计期间刚补上 `nonNegative`，复核已通过 |
| TurnTotalTokensTest | 四桶饱和相加 | [format.ts:56-62](src/model/format.ts#L56-L62) | 通过 | 已改用 `saturatingAdd` |
| SessionCacheHitPercentTest | 整数优先、只在会读成 100 时加小数；billed 饱和相加 | [format.ts:113-125](src/model/format.ts#L113-L125)、[sheets.tsx:453-457](src/ui/sheets.tsx#L453-L457) | 通过 | 七个断言逐条推演一致 |
| StatusOrderRankTest | 7 档：running/失败未读/完成未读/审批/提问/草稿/空闲 | [stores.ts:365-387](src/state/stores.ts#L365-L387) | 通过 | 审批(3) 与提问/计划评审(4) 已分档；`runningSubagentRoots` 齐备 |
| UnreadErrorGateTest | 只有屏上的会话才 `markErrorSeen` | [streamCoordinator.ts:752-753](src/state/streamCoordinator.ts#L752-L753)、[appModel.ts:218](src/state/appModel.ts#L218) | 通过 | 实时帧这一路通过；快照那一路缺一次，见 T-09 |
| ToolRowMalformedArgsTest | 畸形 `todos`/`answers` 整体回退、不抛 | [toolRow.ts:187-235](src/model/toolRow.ts#L187-L235) | 通过 | 已补元素级 `length !== rawLength` 闸 |
| ProducedPathValidationTest | `replace_all` 必布尔、`new_str` 必字符串、`insert_line` 必整数 | [format.ts:357-395](src/model/format.ts#L357-L395) | 通过 | 三处校验已补齐 |
| ContextCollapsedSummaryTest | 只有字段可读的 `notice` 才有折叠摘要 | [contextPresentation.ts:35-52](src/model/contextPresentation.ts#L35-L52) | 通过 | `null`/未声明/字段读不出全部落 undefined |
| GoalBarGoalTest | 完成态目标不画条；画出来的都能解析 goalRef | [sessionStore.ts:997-1005](src/state/sessionStore.ts#L997-L1005)、[composerBar.tsx:819](src/ui/composerBar.tsx#L819) | 通过（等价） | 无 `goalBarGoal` 命名，条上就地判 `phase === 'complete'` |
| GoalPhaseActionTest | pause 仅 active、resume 仅 paused，blocked 不给 | [format.ts:456-460](src/model/format.ts#L456-L460) | 通过 | 五条分支逐条一致 |
| BlankSessionReuseTest | 预设缺失/损坏的空白会话不复用；目录为空一律放行；投影兜底 | [blankSessionReuse.ts:13-52](src/model/blankSessionReuse.ts#L13-L52) | 通过 | 七条断言逐条一致 |
| ArchivedSessionsTest | 归档页倒序、跳过无摘要；搜索标题/工作区名；主列表滤掉归档/空白/subagent | [archivedSessions.ts:24-72](src/model/archivedSessions.ts#L24-L72) | 通过 | 十条断言逐条一致 |
| FileLinkTest | 资源地址/百分号/行号锚点/file URL/纯路径/行内代码/外部地址 | [fileLink.ts:46-148](src/model/fileLink.ts#L46-L148) | 通过 | `fileAddress` 与 `DRIVE_SEGMENT` 已补，40+ 条断言复核一致 |
| ImageProtocolTest | 宽松/严格图片引用、信封闸、根/嵌套路径口径、ptc-dispatch 挂子调用 | [imageCards.ts:45-179](src/model/imageCards.ts#L45-L179)、[sessionStore.ts:1782-1836](src/state/sessionStore.ts#L1782-L1836)、[sessionStore.ts:2413-2440](src/state/sessionStore.ts#L2413-L2440) | 通过 | 含 `width:"1080"`、`name:7`、`bytes:0` 等回落路径 |
| ContentBlockRoundTripTest | tool-result 的嵌套 content 不能丢 | [chatNode.ts:51-72](src/model/chatNode.ts#L51-L72) | 通过 | 深层嵌套与三种普通块都能来回 |
| TurnFailureMessageTest | `code == "AUTH"` 换本地化说法；缺 message 落本地化兜底 | [turnFailure.ts:14-19](src/model/turnFailure.ts#L14-L19)、[sessionStore.ts:1895-1913](src/state/sessionStore.ts#L1895-L1913) | 通过 | 文案值与 Android `Strings.kt:327/329` 一致 |
| AgentPresetRosterTest | `modeSelectionEnabled` 关掉就收起选择器，缺字段默认 true | [rpcMethods.ts:552](src/transport/rpcMethods.ts#L552)、[appModel.ts:894](src/state/appModel.ts#L894)、[new/index.tsx:106](src/pages/new/index.tsx#L106) | 通过（等价） | 无 `AgentPresetRoster` 类型，策略直接进 store |
| StagedImageFileNameTest | 同名不同目录不撞、扩展名保留、无分隔符、长度有界 | [appModel.ts:1071-1074](src/state/appModel.ts#L1071-L1074)、[appModel.ts:1116-1120](src/state/appModel.ts#L1116-L1120) | 通过（等价） | 用 `img-<djb2 hash>.<ext>`，不保留可读词干；扩展名取法有瑕疵，见 T-12 |
| NoiseFrameEofTest | 帧边界上的干净 EOF 才算正常结束，截断/超时必须向上抛 | [queue.ts:36-43](src/transport/tunnel/queue.ts#L36-L43)、[stream.ts:26-30](src/transport/tunnel/stream.ts#L26-L30)、[stream.ts:83-96](src/transport/tunnel/stream.ts#L83-L96) | 通过（等价） | `readExactly` 短读一律抛；`pump` 把异常经 `plaintext.end(error)` 传上去，不会伪装成干净关闭 |
| Protocol016Test | inbox 投影/placement 推导、权限目录合并、changes 汇总与 diff、归档集合 | [frames.ts:31-101](src/model/frames.ts#L31-L101)、[frames.ts:210-247](src/model/frames.ts#L210-L247)、[types.ts:172-186](src/model/types.ts#L172-L186)、[turnChanges.ts:38-112](src/model/turnChanges.ts#L38-L112) | 通过 | 逐条推演一致；`catalog` 为空数组的边角见 T-14 |
| TurnCardStateTest | 本轮失败过就不补发「已完成」卡 | 小程序缺失 | 无对应实现 | 微信小程序没有本地通知；`handleAttention` 对 `sessionCompleted` 直接 break（[appModel.ts:401-404](src/state/appModel.ts#L401-L404)），不存在「完成卡盖掉失败卡」这个面 |
| AttachmentStagingTest | 暂存落盘名带附件 id、清洗分隔符、有长度上限 | 小程序缺失 | 无对应实现 | 不落盘：`chooseImage`/`chooseMessageFile` 的 tempFilePath 直接读成 base64（[composerBar.tsx:204-210](src/ui/composerBar.tsx#L204-L210)），不存在同名覆盖这个面；附带一条命名瑕疵见 T-15 |

---

## 逐条发现

### T-01 · 探活帧用 `{"type":"ping"}`，主机会 close(1008) 拆掉整条连接 —— **P0**

**Android 证据**
- `app/src/test/java/ai/deepseek/dshphone/MuxProbeFrameTest.kt:26-41`：把主机 `parseRemoteStreamClientMessage` 的口径原样搬进测试——只接受 `{type:"cancel",streamId}`（键恰好这两个、id 非空）与 `{type:"open",streamId,endpoint,payload}`（键恰好四个）。
- `MuxProbeFrameTest.kt:45-60`：`probeFrameIsAHostAcceptedUplinkFrame` + `probeFrameIsACancelThatCannotHitARealStream`。
- 实现：`app/src/main/java/ai/deepseek/dshphone/net/MuxStream.kt:57`（`PROBE_STREAM_ID = "wake-probe"`）、`:147`（`probeFrame() = {"type":"cancel","streamId":"wake-probe"}`）、`:150-153`。

**小程序证据**
- [src/transport/tunnel/mux.ts:82-84](src/transport/tunnel/mux.ts#L82-L84)：`probeNow() { this.socket?.sendText(JSON.stringify({ type: 'ping' })); }`
- 调用链：[src/state/streamCoordinator.ts:291-292](src/state/streamCoordinator.ts#L291-L292) ← [src/state/streamCoordinator.ts:308](src/state/streamCoordinator.ts#L308) ← [src/transport/types.ts:43](src/transport/types.ts#L43)。
- 对照：同文件 [mux.ts:104-106](src/transport/tunnel/mux.ts#L104-L106) 的 `sendCancel` 已经是合法形状，说明不是能力问题，是探活那一句写错了。

**差异说明**
把 Android 测试里的主机校验函数套到 `{"type":"ping"}` 上：`obj["type"] != "cancel"` → `hostAcceptsCancel` 假；`!= "open"` → `hostAcceptsOpen` 假。主机侧 `throw` → socket 的 message 处理器 catch → `close(1008, "invalid Remote stream request")`。后果不是「探活没生效」，而是**每次回前台探活都把一条健康连接拆掉**：连接进重连退避，非 CONNECTED 转换会清空待审批/待回答，而 follow 的 snapshot 并不重送。

**建议改法**
`probeNow()` 改发 `JSON.stringify({ type: 'cancel', streamId: 'wake-probe' })`（主机对未知 streamId 的 cancel 是 `streams.get(id)?.abort()` 的 no-op，不会打断在跑的流）。并在 `mux.ts` 顶部加一条常量与注释说明「上行帧只有 cancel/open 两种」。

---

### T-02 · 工作区图片分片搬运按「文件总长度」推进 offset，>2 MiB 的图片被截断 —— **P0**

**Android 证据**
- `app/src/test/java/ai/deepseek/dshphone/state/WorkspaceFileChunkedCopyTest.kt:29-45`：`concatenatesEveryChunkInOrder` 里每片 `bytes = 12` 固定不变，而三片内容是 `"aaaa"/"bbbb"/"cc"`，断言 `assertEquals(calls - 1, offset / 4)`——**offset 按解码后片长推进，`bytes` 是文件总长度**。
- `WorkspaceFileChunkedCopyTest.kt:48-66`：`bytes = raw.size`（总长），每片只给 3 字节。
- `WorkspaceFileChunkedCopyTest.kt:68-82`：`window("aaaa", offset, eof=false, bytes=999)` + `limit=4` 必须在**写盘之前**抛 `too large`。
- `WorkspaceFileChunkedCopyTest.kt:100-113`：`eof=false` 却拿到空片必须抛 `stalled`，不能死循环。
- 实现：`app/src/main/java/ai/deepseek/dshphone/state/PhoneModel.kt:112-131`——`if (written == 0L && window.bytes > limit) throw "file is too large to open"`；`offset += chunk.size`；`if (window.eof) break`；`if (chunk.isEmpty()) throw "file read stalled"`。

**小程序证据**
- [src/state/appModel.ts:1076-1091](src/state/appModel.ts#L1076-L1091)：
  ```
  let offset = 0;
  for (;;) {
    const chunk = await workspaceFileReadBytes(transport, sessionId, path, offset, IMAGE_CHUNK_BYTES);
    if (chunk.data.length > 0) { ...write/append... }
    offset += chunk.bytes;                       // ← 用的是总长度字段
    if (chunk.eof || chunk.bytes === 0) break;   // ← stall 被当成正常结束
    if (offset > IMAGE_MAX_BYTES) throw new Error('image too large');  // ← 写盘之后才判
  }
  ```
- `bytes` 的来源：[src/transport/rpcMethods.ts:390-396](src/transport/rpcMethods.ts#L390-L396) 原样透传主机的 `bytes`；类型注释 [src/model/types.ts:241-248](src/model/types.ts#L241-L248) 也没写清它是总长还是片长；Android 同名字段见 `model/Models.kt:276-283`（且 Android 另有 `offset` 字段，小程序连解都没解）。

**差异说明**
- **截断（主症状）**：文件 5 MiB 时，第一次读回 2 MiB（`eof=false`、`bytes=5242880`），`offset` 直接跳到 5242880；第二次从文件尾读，拿回空数据 + `eof=true` → 循环结束。落盘文件只有前 2 MiB，`Taro.previewImage` 打开是坏图。小于一个窗口的图片因为第一片就 `eof=true` 而侥幸正确，所以这个 bug 只在大图上暴露。
- **stall 被吞**：`chunk.bytes === 0` 当成正常收尾 `break`，而 Android 把「`eof=false` 且片为空」判成 `stalled` 异常。小程序这里既不报错也不重试，得到一个 0 字节的图片文件。
- **超限闸位置**：Android 在第一片就用主机声明的总长度拒绝（`0` 字节落盘）；小程序先写再判，且判的是累计 offset，超限时磁盘上已经留了一份半截文件（不会被删）。

**建议改法**
1. 明确 `bytes` 语义并在类型上写死；按 Android 口径改成「解码后片长推进」：小程序侧可用 base64 长度换算片长（`Math.floor(b64.length / 4) * 3 - padding`），或让 `workspaceFileReadBytes` 额外返回主机的 `offset` 字段、直接用 `chunk.offset + 片长`。
2. 首片就判 `chunk.bytes > IMAGE_MAX_BYTES` 并在写盘前抛。
3. `eof === false && 片长 === 0` 抛 `stalled`，不要 `break`。
4. 失败路径删掉半截临时文件。

---

### T-03 · 空 callId 的 `tool/result` 既接不回调用，孤儿行又互相覆盖 —— **P1**

**Android 证据**
- `ToolResultLinkageTest.kt:28-56`：`tool/call`（`callId: ""`, seq 10）必须落成 `seq-10`；随后空 `toolCallId` 的 `tool/result` 必须接到它上面，`store.nodes` 里只能有 **1** 条 Tool 行。
- `ToolResultLinkageTest.kt:59-75`：没有可接的调用时，孤儿必须拿到唯一 id `orphan-11`。
- 实现：`state/SessionStore.kt:834-844`（空 id 时挑「最近一条还没有结果的工具调用」）、`:855`（`val orphanId = wrappedCallId.ifEmpty { "orphan-" + event.seq }`）；调用端落键见 `SessionStore.applyToolCall`（与小程序同款 `seq-<seq>`）。

**小程序证据**
- 调用端一致：[src/state/sessionStore.ts:1722-1734](src/state/sessionStore.ts#L1722-L1734) —— `const callId = rawId.length === 0 ? 'seq-' + event.seq : rawId;`
- 结果端缺两处兜底：[src/state/sessionStore.ts:1760-1780](src/state/sessionStore.ts#L1760-L1780)
  ```
  const key = 'tool-call:' + wrappedCallId;   // wrappedCallId === '' 时就是 'tool-call:'
  ...
  const orphan = newToolChatData({ callId: wrappedCallId, name: 'orphan-result', ... });
  this.contexts.set(key, { kind: 'tool', data: orphan });
  ```

**复现输入 / 期望 vs 实际**

输入（按序喂给 `SessionStore('s1')`）：
```
tool/call  seq=10 {"callId":"","name":"read","arguments":"{}","turn":1,"step":1}
tool/result seq=11 {"turn":1,"step":1,"message":{"source":{"kind":"tool","callId":""},
  "content":[{"type":"tool-result","toolCallId":"","content":[{"type":"text","text":"ok"}],"isError":false}]}}
```
- 期望（Android）：`nodes` 里 1 条 Tool 行，`toolCall("seq-10").result.content[0].text === "ok"`。
- 实际（小程序）：`contexts` 里有 `tool-call:seq-10`（永远「没有结果」的 `read` 行）和 `tool-call:`（名为 `orphan-result` 的重复行）两条 → **2 条 Tool 行**，转写里真正的调用永远转圈，旁边多一条看不懂的 `orphan-result`。
- 第二组输入（只有孤儿结果）：期望 `toolCall("orphan-11") !== undefined`；实际 id 是空串，且**每一条这样的结果都覆盖同一把 `tool-call:` 键**，只剩最后一条可见。

**建议改法**
照抄 Android `SessionStore.kt:834-856`：`wrappedCallId` 为空时，先在 `this.contexts` 里挑 `kind === 'tool' && data.result === undefined` 中 `startSeq` 最大的那把键接上去；一条都挑不到时用 `'orphan-' + event.seq` 作为 callId 与键后缀。

---

### T-04 · `seedFromCache` 不铺 `hasMore` —— **P1**

**Android 证据**
- `SeedFromCacheHasMoreTest.kt:37-47`：`seeded(false).hasMore` 必须为 false，`seeded(true).hasMore` 为 true。
- `SeedFromCacheHasMoreTest.kt:50-53`：铺底稿不设 `historyLoaded`。
- 实现：`state/SessionStore.kt:443-450` —— `eventWindow.replace(...)` 之后紧接着 `hasMore = eventWindow.hasMore`，注释写明理由。

**小程序证据**
- [src/state/sessionStore.ts:1219-1223](src/state/sessionStore.ts#L1219-L1223)：只有 `eventWindow.replace({ events, hasMore })` + `replayHistory()`，**没有** `this.hasMore = this.eventWindow.hasMore`。
- 对照同文件两处都写了：[sessionStore.ts:1167](src/state/sessionStore.ts#L1167)、[sessionStore.ts:1200](src/state/sessionStore.ts#L1200)。
- store 侧 `hasMore` 的默认值：[sessionStore.ts:616](src/state/sessionStore.ts#L616) `hasMoreStore = new Store<boolean>(true)`，getter/setter 见 [:667-672](src/state/sessionStore.ts#L667-L672) —— 与窗口内部的 `get hasMore()`（[:301](src/state/sessionStore.ts#L301)）是两个不同的量。

**复现输入 / 期望 vs 实际**
- 输入：`store.seedFromCache({ hasMore: false, records: [user/message seq=1] })`
- 期望：`store.hasMore === false`、`store.historyLoaded === false`
- 实际：`store.hasMore === true`（默认值没被覆盖），`historyLoaded === false` ✅

**用户可见后果**（与 Android 注释同一条）：`rebuildTurnProcessSpecs` 在 [sessionStore.ts:2485](src/state/sessionStore.ts#L2485) 处 `if (this.hasMore) return;` 直接短路 → 冷启动点开一条完整的短会话，思考/工具过程行不折叠；同时 [:2889](src/state/sessionStore.ts#L2889) 的「还能加载更早」为真，底部一直亮着「加载更早」，直到 follow 快照回来才纠正。

**建议改法**
在 [sessionStore.ts:1221](src/state/sessionStore.ts#L1221) 之后加 `this.hasMore = this.eventWindow.hasMore;`。

---

### T-05 · GFM 自动链接与 Web 端 1451/10531 不一致 —— **P1**

**Android 证据**
- `ui/component/GfmAutolinkTest.kt:79-119`：对着 `app/src/test/resources/gfm-autolink-golden.json`（10531 条，Web micromark + mdast `gfm-autolink-literal` 产出）断言 `linkMismatches == 0`。
- `GfmAutolinkTest.kt:121-133` / `:140-147`：日常 URL/邮箱、以及「中文标点不终止 URL」。
- 实现：`ui/component/GfmAutolink.kt`（645 行，手写的 GFM autolink literal 移植）。

**小程序证据**
- [src/ui/markdown.tsx:4-17](src/ui/markdown.tsx#L4-L17)：`import { marked } from 'marked'` + `marked.use({ gfm: true })`；`package.json` 依赖 `"marked": "^12.0.2"`。没有任何与 `GfmAutolink.kt` 对应的移植代码（全仓 grep `autolink` 无命中）。

**实测（本次审计用 Node 直接跑，脚本 `/tmp/gfmcheck2.cjs`）**
```
total=10531  linkMismatch=1451  buckets={"different":383,"missed":481,"spurious":587}
```
代表性样本（actual = marked，expected = Web golden）：

| 源文本 | marked（小程序） | Web golden | 性质 |
| --- | --- | --- | --- |
| `https://例子.测试/路径` | 不成链接 | `https://例子.测试/路径` | **漏认**（`marked` 的 url 正则域名段只允许 `[a-zA-Z0-9\-]`） |
| `ftp://x.com` | `ftp://x.com` | 无链接 | 误认（GFM literal 不收 ftp） |
| `x/a@b.com` | `mailto:a@b.com` | 无链接 | 误认（前导 `/` 使邮箱无效） |
| `1@2.3` | `mailto:1@2.3` | 无链接 | 误认 |
| `see a@b.com_` | `mailto:a@b.co` | 无链接 | 误认 + 地址被截 |
| `https://ex.com/path_(a(b)c)` | `…/path_(a(b)c` | `…/path_(a(b)c)` | 括号平衡口径不同，地址被截断 |
| `see www.` / `www. https://ex.com` | 漏掉 `http://www` | 有 `http://www` | 漏认 |

两个点名用例实测 **通过**：
- `看这个 https://example.com/a_b(c) 和 www.ex.com, 联系 a@b.com.` → `[["https://example.com/a_b(c)",…],["http://www.ex.com","www.ex.com"],["mailto:a@b.com","a@b.com"]]` ✅
- `www.ex.com：test` → `[["http://www.ex.com：test","www.ex.com：test"]]` ✅

**差异说明**
「中文域名 URL 整条不成链接」是本条里最可能被中文用户撞上的一项（模型贴出的中文域名链接点不动）；`ftp://` 与 `x/a@b.com` 这类误认会把不是链接的文本染成可点样式。注意小程序的 link 行为是「非文件链接一律复制地址」（[markdown.tsx:461-464](src/ui/markdown.tsx#L461-L464)），所以误认的后果是「多了一个会复制奇怪字符串的可点区域」，不是安全问题。

**关于 `onlySafeProtocolsAreTappable`（`GfmAutolinkTest.kt:149-159`）**：小程序没有 `isSafeExternalUrl` 这道闸，但它压根不打开外部链接（`javascript:`/`data:` 只会被复制到剪贴板），**语义等价、不单列为缺陷**。

**建议改法**
两条路二选一：(a) 把 `GfmAutolink.kt` 的识别规则移植成一个 marked extension（`tokenizer.extensions` 里覆盖 `url`/`autolink`），用同一份 golden 建回归测试；(b) 若只想止血，至少补域名段的非 ASCII 支持与 `ftp`/前导字符两条规则。无论哪条，都应把 golden json 复制进小程序仓库并加一个 Node 测试，否则这块永远没法确认对齐。

---

### T-06 · 工作流状态词中文写成「进行中」，安卓是「运行中」 —— **P2**

**Android 证据**
- `WorkflowStatusLabelTest.kt:26-33`：`assertEquals("运行中", workflowStatusLabel(WorkflowRunStatus.RUNNING))`。
- 实现/词表：`model/WorkflowLabels.kt:12-18`；`i18n/Strings.kt:289` —— `pick("Running", "运行中")`。

**小程序证据**
- [src/i18n/strings.ts:310](src/i18n/strings.ts#L310)：`workflowStatusRunning: ['Running', '进行中'],`
- 取词处：[src/ui/messageRow.tsx:431-444](src/ui/messageRow.tsx#L431-L444)（结构与 Android 完全一致）。
- 其余四个词一致：`Strings.kt:290-293` 对 [strings.ts:311-314](src/i18n/strings.ts#L311-L314) —— 已完成/失败/已取消/已中断全部相同。

**差异说明** 五个状态词里只有 RUNNING 一条中文对不上（英文 "Running" 一致）。Android 测试对这条是硬断言，同一台主机上手机与桌面的同一张工作流卡片尾标会不一样。

**建议改法** 把 [strings.ts:310](src/i18n/strings.ts#L310) 的中文改成 `'运行中'`。

---

### T-07 · 实时帧上的一轮失败不发失败事实；也没有「保留主机原因」的通知正文 —— **P2**

**Android 证据**
- `LiveTurnFailureSignalTest.kt:96-112`：`coordinator.applyLiveEvent(sessionId, turn/end(reason.kind="error"))` 之后，`AttentionSignal.Failed` 必须恰好有 1 条，且 message 是**本地化后的** "API 密钥无效"（不是 provider 原文）。
- `LiveTurnFailureSignalTest.kt:114-128`：`turnFailureNotificationBody("401 …")` 保留主机原因；只有空白才退到本地化兜底。
- `LiveTurnFailureSignalTest.kt:130-145`：非 error 收尾不得冒出失败信号。
- 实现：`state/StreamCoordinator.kt:467-472`（折叠之前就 `liveTurnFailureMessage(event)?.let { attentionHandler(Failed(...)) }`）；`model/TurnFailureMessage.kt:33-38`、`:46-47`。

**小程序证据**
- [src/state/streamCoordinator.ts:734-755](src/state/streamCoordinator.ts#L734-L755)：`applyLiveEvent` 只做 `setRunning` / `recordActivity` / 补洞 / `apply` / `markErrorSeen`，**没有任何 `attentionHandler({kind:'failed'})`**。
- 唯一的失败信号来源是 `$events` 那条流：[src/state/streamCoordinator.ts:485-491](src/state/streamCoordinator.ts#L485-L491)，且直接用 `args[1]` 的原始 message，没有过 `turnFailureMessage` 的 AUTH 本地化。
- `turnFailureNotificationBody`：全仓无此符号（grep 0 命中）；消费端 [src/state/appModel.ts:398-400](src/state/appModel.ts#L398-L400) 只是 `this.lastErrorStore.set(signal.message)`。

**差异说明**
- 小程序没有系统通知，所以「失败卡被完成卡盖掉」这个面不存在；但「有没有失败事实」仍然被押在 `api-session/error` 这条独立流的送达与顺序上，而 `turn/end` 才是这一轮结束的权威记录。
- 更实际的一条：`api-session/error` 的正文是 provider 原话（"401 Unauthorized: …"），在中文界面里原样弹出；同一条失败在转写里（走 [sessionStore.ts:1902](src/state/sessionStore.ts#L1902) 的 `turnFailureMessage`）显示的却是「API 密钥无效」。**同一次失败在两个地方两种说法**。

**建议改法**
1. 在 [streamCoordinator.ts:738](src/state/streamCoordinator.ts#L738) 附近（折叠之前）加：`turn/end` 且 `reason.kind === 'error'` 时 `this.deps.attentionHandler({ kind:'failed', sessionId, message: turnFailureMessage(reason) })`。
2. `api-session/error` 那一路的 message 也过一次 AUTH 归一（或至少共用同一个兜底文案 `Strings.turnFailureFallback`）。
3. 需要通知正文时补一个 `turnFailureNotificationBody(message)`：`message.trim() || Strings.turnFailureFallback`。

---

### T-08 · 改动汇总的 404 不记 unavailable（每次重绘都重新请求）；`loadDiff` 不捕获传输异常 —— **P2**

**Android 证据**
- `TurnChangesStoreRetryTest.kt:40-48`：传输失败**不**留值、**不**锁定 unavailable。
- `TurnChangesStoreRetryTest.kt:63-69`：`fetch` 成功返回 null（404）必须记成 unavailable，不再重试。
- `TurnChangesStoreRetryTest.kt:71-82`：diff 同一条规矩。
- 实现：`state/TurnChangesStore.kt:70-80`、`:92-103`（`runCatching{}.getOrElse { return@launch }` 只让成功分支写缓存；`fetched == null` 才 `unavailable.add`）。

**小程序证据**
- [src/state/appModel.ts:436-448](src/state/appModel.ts#L436-L448)：`catch` 里只 `lastErrorStore.set` 并 `return undefined`——**传输失败不锁定 ✅**；但 `summary === undefined`（404）时同样什么都不写，下次重绘还会再请求一遍 —— **404 不锁定 ❌**。
- [src/state/appModel.ts:451-458](src/state/appModel.ts#L451-L458)：`loadTurnChangesDiff` **完全没有 try/catch**，传输异常直接抛给调用方（[src/ui/changedFilesCard.tsx](src/ui/changedFilesCard.tsx) / [src/ui/messageRow.tsx:45](src/ui/messageRow.tsx#L45) 一侧）。
- 小程序没有 `unavailable` / `isUnavailable` 概念（grep 0 命中），也没有 `loading` 去重集合——并发两次渲染会发两次同样的请求。

**差异说明** 行为方向与 Android 相反的一半是「合法的空读取不缓存」：会话销毁后主机对每条记录回 404，而卡片每次重绘都会再问一次，等于把一条必然失败的 RPC 挂在渲染路径上。`loadDiff` 未捕获异常则可能在 UI 层冒出未处理的 rejection。

**建议改法** 给 `turnChangesSummaries`/`turnChangesDiffs` 各配一个 `unavailable: Set<string>` 与 `loading: Set<string>`：成功且非 undefined 写缓存；成功且 undefined 写 unavailable；抛异常什么都不写。`loadTurnChangesDiff` 补 try/catch，与 summary 同一口径。

---

### T-09 · follow 快照落定之后缺一次 `markErrorSeen()` —— **P2**

**Android 证据**
- `state/StreamCoordinator.kt:405-408`：快照分支里 `store.applyAssistantStreamBaseline(...)` 之后紧跟 `if (sessionIsOnScreen(sessionId)) store.markErrorSeen()`，注释写明「快照的重放会把失败位重新抬起来，所以已读要在窗口落定之后再标一次（对齐 Mac `openHistoryIfNeeded` 里那句 defer）」。
- `UnreadErrorGateTest.kt:88-103` 钉的是实时帧那一路（小程序已通过，见总表）。

**小程序证据**
- [src/state/streamCoordinator.ts:642-673](src/state/streamCoordinator.ts#L642-L673)：`case 'snapshot'` 分支里 `loadHistory` / `subscribe` / 落盘 / `applyAssistantStreamBaseline` 都有，**唯独没有 `markErrorSeen()`**。
- 进场那次在 [src/state/appModel.ts:514-515](src/state/appModel.ts#L514-L515)，发生在快照回来**之前**。

**差异说明（待确认强度：高）**
时序是：点开会话 → `markErrorSeen()`（此刻 store 还是空的，`lastErroredTurn === undefined`，于是 `seenErroredTurn = undefined`）→ 快照回来 → `replayHistory` 把上一轮的失败重放出来，`lastErroredTurn = N` → `unreadError`（[sessionStore.ts:889-891](src/state/sessionStore.ts#L889-L891)）变成 true。结果：**用户正看着的那条会话，列表行的红点反而亮着**，直到下一条实时帧才被 [streamCoordinator.ts:753](src/state/streamCoordinator.ts#L753) 抹掉。
确认方法：打开一条最后一轮以 error 收尾的会话，返回列表看该行是否带未读失败红点。

**建议改法** 在 [streamCoordinator.ts:664](src/state/streamCoordinator.ts#L664) 之后加 `if (this.deps.sessionIsOnScreen?.(sessionId) !== false) store.markErrorSeen();`，与实时帧那一路同一条判定。

---

### T-10 · `formatExactTokens` 依赖 `toLocaleString`，在小程序运行时不保证是 `,` 千分位 —— **P2（待确认）**

**Android 证据**
- `NumberFormatTest.kt:25-39`：把默认 Locale 钉成德语再断言；`:54-57` `assertEquals("1,234,567", formatExactTokens(1_234_567))`。
- 实现：`model/Format.kt:27` `FIXED_LOCALE = Locale.ROOT`、`:104` `String.format(FIXED_LOCALE, "%,d", value)` —— **显式钉死区域**。

**小程序证据**
- [src/model/format.ts:75-77](src/model/format.ts#L75-L77)：`return value.toLocaleString('en-US');`
- 同文件其余读数（`toFixed`、手写定点 [formatFixed](src/model/format.ts#L96-L102)）都是区域无关的，只有这一处走 Intl。

**差异说明**
`Number.prototype.toLocaleString(locale)` 只有在运行时带 Intl 时才真正尊重 `'en-US'`；不带 Intl 的 JS 引擎按规范可以忽略 locale 参数、退回宿主默认格式。微信小程序在 iOS/Android/PC 上跑在不同的 JS 引擎（且小游戏/Skyline 下裁剪情况不同），不能假定 Intl 一定在。一旦退化，德语环境会得到 `1.234.567`——正是这个测试要抓的漂移。

**确认方法** 在真机（尤其 iOS）控制台执行 `typeof Intl` 与 `(1234567).toLocaleString('en-US')`，两端都看一遍。

**建议改法** 不依赖 Intl，手写分组：`String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')`（注意负数与非整数输入的处理，与 Android `%,d` 对齐）。

---

### T-11 · `ImageFileType.mimeTypeOf` 无对应实现；输入区的扩展名→MIME 表比安卓少 6 种 —— **P2**

**Android 证据**
- `model/ImageFileTypeTest.kt:41-49`：`mapsMimeTypes` 断言 png/jpg/jpeg/svg/tiff/heic 六条映射。
- 实现：`model/ImageFileType.kt:27-40`，13 种扩展名全覆盖，兜底 `image/*`；消费者是 `ui/component/SystemImageViewer.kt:59`（`setDataAndType(uri, mimeTypeOf(path))`）。

**小程序证据**
- 没有 `mimeTypeOf` 对应物（grep `mime` 只命中 [imageCards.ts:18](src/model/imageCards.ts#L18) 的媒体类型白名单与下面这张表）。
- [src/ui/composerBar.tsx:212-231](src/ui/composerBar.tsx#L212-L231) 的 `IMAGE_EXTENSIONS` 只有 7 条：png/jpg/jpeg/gif/webp/bmp/heic —— 少了 **svg、avif、ico、tif、tiff、heif**。

**差异说明**
- `mimeTypeOf` 本身在小程序确实用不上：`Taro.previewImage` 按文件内容识别，不需要 Intent MIME → **这一半属于「架构不适用」，不需要补**。
- 但输入区那张表是另一回事：[composerBar.tsx:245-250](src/ui/composerBar.tsx#L245-L250) 用 `imageMediaTypeOf(path) !== undefined` 决定「这件附件当图片上传还是当文件上传」。选一张 `.tiff`/`.avif`/`.heif` 图片时会被当成普通文件走 `{ kind:'file' }` 分支，绕开主机的图片上限校验，与 [isImageFile](src/model/imageFileType.ts#L22-L23) 的 13 种口径自相矛盾。

**建议改法** 把 `IMAGE_EXTENSIONS`（composerBar）与 `IMAGE_EXTENSIONS`（imageFileType）合并成一份，并按 `ImageFileType.kt:27-40` 补齐 MIME 映射；`makeFileAttachment` 用同一份判定。

---

### T-12 · 图片临时文件的扩展名取自整条路径而不是 basename —— **P2**

**Android 证据**
- `ui/component/StagedImageFileNameTest.kt:34-39`：扩展名必须留下；`:41-51`：无分隔符/无 `..`；`:61-64`：长度 ≤ 64。
- 实现：`ui/component/SystemImageViewer.kt:92-102`，扩展名走 `ImageFileType.extensionOf`（**先取 basename 再找点**，见 `ImageFileType.kt:17-22`）。

**小程序证据**
- [src/state/appModel.ts:1071-1074](src/state/appModel.ts#L1071-L1074)：
  ```
  const clean = path.split('?')[0] ?? path;
  const dot = clean.lastIndexOf('.');          // ← 在整条路径上找点
  const ext = dot < 0 ? '' : clean.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  ```
- 同仓已经有正确写法：[src/model/imageFileType.ts:12-20](src/model/imageFileType.ts#L12-L20) 的 `fileExtension` 先切 basename、且拒绝 `dot <= 0`。

**差异说明** `/w/v1.2/README` 这类路径（目录名里带点、文件名没扩展名）会算出 `ext = "2README"`，落成 `img-<hash>.2readme`；`/w/x/.png` 会被当成有扩展名。测试里的六条断言（唯一性/扩展名/无分隔符/长度）仍然满足，所以**不判为不通过**，但与刚统一过的 `fileExtension` 口径不一致，属于会互相漂移的重复实现。

**建议改法** 直接复用 `fileExtension(path)`（[imageFileType.ts:12](src/model/imageFileType.ts#L12)），删掉 appModel 里的这三行。

---

### T-13 · 分片搬运缺「声明总长度就超限」的前置闸与 stall 判定 —— **P2**（T-02 的同一处代码，拆开以便分别修）

**Android 证据** `WorkspaceFileChunkedCopyTest.kt:68-82`（超限时 `out.size() == 0`）、`:100-113`（空片 + `eof=false` 抛 `stalled`）；实现 `state/PhoneModel.kt:116-118`、`:128`。

**小程序证据** [src/state/appModel.ts:1080-1086](src/state/appModel.ts#L1080-L1086)：先写盘后判 `offset > IMAGE_MAX_BYTES`；`chunk.bytes === 0` 走 `break` 而不是抛错。

**差异说明** 见 T-02 的「stall 被吞」「超限闸位置」两段。失败时 `catch` 吞掉异常返回 undefined（[appModel.ts:1089-1091](src/state/appModel.ts#L1089-L1091)），磁盘上留下的半截文件不会被清理，下次同路径命中同一个文件名还会被 `writeFileSync` 覆盖——只是第一次的失败体验已经发生。

**建议改法** 与 T-02 一并改：首片 `chunk.bytes > IMAGE_MAX_BYTES` 即抛；`!eof && 片长 === 0` 抛 stalled；`catch` 里 `wx.getFileSystemManager().unlinkSync(filePath)`（忽略失败）。

---

### T-14 · `permissionSelectionMerge`：目录拉回空数组时不回退内联 options —— **P2（待确认）**

**Android 证据** `Protocol016Test.kt:82-91`：`merge(narrowed, catalog)` 用目录填充；`merge(legacy, null)` 回退内联的 2 条；`merge(null, listOf())` 为 null。

**小程序证据**
- [src/model/types.ts:172-178](src/model/types.ts#L172-L178)：`options: catalog ?? projection.options ?? []` —— `??` 只挡 null/undefined，**空数组会胜出**。
- 目录写入点 [src/state/appModel.ts:466-469](src/state/appModel.ts#L466-L469)（`permissionCatalog` 成功即落库）。

**差异说明** 只有在「0.1.5 主机内联了 options，同时 `permissionPresets/catalog` 存在但返回空列表」这一种组合下才会表现为「权限选择器空了」。Android 侧 `PermissionSelection.merge` 的空列表语义需要看 Kotlin 实现才能断言是否一致，测试没覆盖到这个组合。

**确认方法** 读 `model/Models.kt` / `PermissionSelection.merge` 的 Kotlin 实现，看它是 `catalog?.takeIf { it.isNotEmpty() }` 还是直接 `catalog ?:`。若 Android 也允许空目录覆盖，则本条改判「等价」。

**建议改法（若确认不一致）** 改成 `const merged = catalog !== undefined && catalog.length > 0 ? catalog : (projection.options ?? []);`

---

### T-15 · 相册附件的文件名被硬编码成 `image`（无扩展名） —— **P2**

**Android 证据** `AttachmentStagingTest.kt:56-60`：`keepsTheReadableOriginalName` —— 暂存名要认得出来源，且「扩展名要保留，**主机按名字识别类型**」。

**小程序证据**
- [src/ui/composerBar.tsx:700-703](src/ui/composerBar.tsx#L700-L703)：`makeImageAttachment(file.tempFilePath, 'image')` —— 名字写死 `'image'`。
- 对照 `chooseMessageFile` 那条路径保留了真实名：[composerBar.tsx:716-719](src/ui/composerBar.tsx#L716-L719)。

**差异说明** 相册选图时 `PhoneAttachment.name` 恒为 `"image"`（没有 `.png`/`.jpg`）。图片这条路同时显式带了 `mediaType`（[composerBar.tsx:239](src/ui/composerBar.tsx#L239)），所以主机大概率不靠名字判型；但附件在转写里的显示名会全是 "image"，多张图无法区分。属于可感知的小瑕疵，不是协议错误。

**建议改法** 用 `pathBasename(file.tempFilePath)` 或 `'image-' + index + '.' + (extensionOf(tempFilePath) ?? 'jpg')` 作为名字。

---

## 已核对确认等价的清单（避免后续重复审计）

下列条目已逐函数/逐断言推演，**语义与安卓一致，不需要改**（形式不同的已注明）：

| 主题 | Android | 小程序 | 说明 |
| --- | --- | --- | --- |
| 非有限读数归零 | `Format.kt:40-75` `nonNegative` | [format.ts:17-48](src/model/format.ts#L17-L48) | NaN/±∞ → 0；`formatStatsDuration(NaN)`→「0秒」、`formatTokensPerSecond(NaN)`→"0.0" |
| 固定小数点/千分位 | `Format.kt:27,57-67,93-102,480-482` | [format.ts:40-73](src/model/format.ts#L40-L73)、[:477-480](src/model/format.ts#L477-L480) | `toFixed` 天然区域无关；`12.2K`/`1.5 MB`/`512 KB` 逐条一致（`formatExactTokens` 例外见 T-10） |
| 占位符填充 | `Strings.kt` `fmt` | [strings.ts:352-356](src/i18n/strings.ts#L352-L356) | 支持 `%d`/`%02d`/`%s`/`%%`；JS 无本地化数字问题 |
| 相对时间六档桶 | `Format.kt:441-470` | [format.ts:473-488](src/model/format.ts#L473-L488) | now/min/h/d/mo(30d)/y(365d)；未来时间戳夹 0；中英词表一致 |
| 单轮 token 饱和相加 | `Format.kt:85-91` | [format.ts:56-62](src/model/format.ts#L56-L62) | 含 `Int.MIN` 负向饱和 |
| 会话级缓存命中率 | `SessionUsageReading.kt:61-84` | [format.ts:113-125](src/model/format.ts#L113-L125) | 50/99.96/99.9/100/undefined/67 六条逐条一致 |
| billed 饱和 + hasTokens | `SessionUsageReading.kt:26-32` | [sheets.tsx:453-457](src/ui/sheets.tsx#L453-L457) | 用 `saturatingAdd` 串联，溢出不回绕、Token 行不消失 |
| 单轮命中率忽略纯 output | `Format.kt:110-119` | [format.ts:127-137](src/model/format.ts#L127-L137) | `cacheReadTokens` 缺席 → undefined，不除零 |
| 状态排序 7 档 | `SessionStatusRank.kt:12-67` | [stores.ts:365-387](src/state/stores.ts#L365-L387) | 审批 3 / 提问+计划评审 4 / 草稿 5 分开；`runningSubagentRoots` 见 [stores.ts:341-363](src/state/stores.ts#L341-L363) |
| 未读失败门（实时帧） | `StreamCoordinator.kt:489-495` | [streamCoordinator.ts:752-753](src/state/streamCoordinator.ts#L752-L753) + [appModel.ts:218](src/state/appModel.ts#L218) | 屏外不标已读、屏上标 |
| 工具行畸形参数回退 | `ToolRow.kt:94-101,199-226` | [toolRow.ts:192-235](src/model/toolRow.ts#L192-L235) | 元素级校验（`length !== rawLength` 整体回退），不抛、不读成 0/0 |
| 产出文件参数校验 | `Format.kt:345-387` | [format.ts:357-395](src/model/format.ts#L357-L395) | `replace_all` 必布尔、`new_str` 必字符串、`insert_line` 必非负整数 |
| 上下文形态与折叠摘要 | `ContextPresentation.kt:26-52` | [contextPresentation.ts:35-52](src/model/contextPresentation.ts#L35-L52) | 六种 form 的字段可读性校验逐条一致 |
| 目标条折叠 + 三个动作 | `SessionStore.kt:275-277` | [sessionStore.ts:997-1005](src/state/sessionStore.ts#L997-L1005) + [composerBar.tsx:819](src/ui/composerBar.tsx#L819) | 形式不同（条上就地判 complete），语义一致 |
| 目标 pause/resume 落点 | `GoalPhaseAction.kt:15-19` | [format.ts:456-460](src/model/format.ts#L456-L460) | blocked/complete/未知都不给动作 |
| 空白会话复用闸 | `BlankSessionReuse.kt:16-50` | [blankSessionReuse.ts:13-52](src/model/blankSessionReuse.ts#L13-L52) | 含「目录为空一律放行」「投影兜底」 |
| 归档三函数 | `ArchivedSessions.kt:20-59` | [archivedSessions.ts:24-72](src/model/archivedSessions.ts#L24-L72) | 倒序、跳过无摘要、标题/工作区名搜索、主列表三重过滤 |
| 文件链接解析 | `FileLink.kt:65-207` | [fileLink.ts:46-148](src/model/fileLink.ts#L46-L148) | 行号锚点 `#L24`/`#L24-L30`、`?` 查询串、`absolute` 盘符段/UNC、百分号与 `+`、行内代码 token 判形 |
| 图片扩展名判定 | `ImageFileType.kt:17-24` | [imageFileType.ts:12-23](src/model/imageFileType.ts#L12-L23) | basename 内取扩展名、`.png`/`a.`/`archive.png.zip` 都不算图片、大小写不敏感 |
| 图片块协议 | `ImageBlocks.kt:37-180` | [imageCards.ts:34-179](src/model/imageCards.ts#L34-L179) | 宽松/严格两套、信封正则逐字符相同、`fullyRendered`、根/嵌套路径口径 |
| ptc-dispatch 挂子调用 | `SessionStore.kt:868-900` | [sessionStore.ts:1782-1836](src/state/sessionStore.ts#L1782-L1836) + [:2413-2440](src/state/sessionStore.ts#L2413-L2440) | `parentCallId` 建树、按 `startSeq` 排序、深度 64 上限 |
| 内容块编解码往返 | `ChatNode.kt` encode/decode | [chatNode.ts:19-72](src/model/chatNode.ts#L19-L72) | tool-result 的嵌套 `content` 完整保留 |
| 一轮失败取词 | `TurnFailureMessage.kt:19-23` | [turnFailure.ts:14-19](src/model/turnFailure.ts#L14-L19) + [sessionStore.ts:1895-1913](src/state/sessionStore.ts#L1895-L1913) | AUTH → 本地化；缺 message → 本地化兜底；文案值两端相同 |
| 预设选择策略 | `AgentPresetRoster.kt:20-21` | [rpcMethods.ts:552](src/transport/rpcMethods.ts#L552) + [appModel.ts:894](src/state/appModel.ts#L894) + [new/index.tsx:106](src/pages/new/index.tsx#L106) | 缺字段默认 true；关掉时不给入口 |
| 临时图片命名 | `SystemImageViewer.kt:92-102` | [appModel.ts:1071-1074](src/state/appModel.ts#L1071-L1074) + [:1116-1120](src/state/appModel.ts#L1116-L1120) | 哈希保证唯一、扩展名保留、无分隔符、长度远低于 64（扩展名取法瑕疵见 T-12） |
| 帧流 EOF 语义 | `readFrameAtBoundary` | [queue.ts:36-43](src/transport/tunnel/queue.ts#L36-L43) + [stream.ts:26-30,83-96](src/transport/tunnel/stream.ts#L83-L96) | 短读一律抛、异常经 `plaintext.end(error)` 上传，截断不会伪装成干净关闭 |
| 0.1.6 协议解码 | `Protocol016Test.kt` 全部 | [frames.ts:31-101](src/model/frames.ts#L31-L101)、[:210-247](src/model/frames.ts#L210-L247)、[types.ts:172-186](src/model/types.ts#L172-L186)、[turnChanges.ts:38-112](src/model/turnChanges.ts#L38-L112) | inbox 双列表 + placement 推导、0.1.5 queue 双版本兼容、权限窄投影/内联回退/`custom` 不可选、汇总拒 `turn<1`、畸形文件行丢弃、diff 三种 kind + 未知拒绝 |
| 外部协议不可点 | `GfmAutolink.isSafeExternalUrl` | [markdown.tsx:455-464](src/ui/markdown.tsx#L455-L464) | 小程序根本不打开外部链接（一律复制地址），`javascript:`/`data:` 无法被触发 |
| 完成卡去重/失败抑制 | `TurnCardState.kt` | —— | 小程序无本地通知，该面不存在（[appModel.ts:401-404](src/state/appModel.ts#L401-L404)） |
| 附件暂存落盘名 | `stagedAttachmentFileName` | —— | 小程序不落盘，直接读 tempFilePath 为 base64（[composerBar.tsx:204-210](src/ui/composerBar.tsx#L204-L210)），同名覆盖这个面不存在 |

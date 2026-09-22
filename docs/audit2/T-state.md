# T-state：状态管理层差异审计（第二轮·补漏）

- 待审计实现：`/Users/user/dshapp/dsh-miniapp`（Taro4 + React18 + TS 微信小程序）
- 权威参考实现：`/Users/user/dshapp/dsh-androidapp`（Kotlin + Jetpack Compose）
- 本轮范围：**状态管理层**。Android `state/*.kt`（SessionStore / PhoneModel / Stores / StreamCoordinator / SessionCache / SessionEventWindow / SessionStatusRank / TurnCardState / TurnChangesStore / AppSettings / ServerProfileStore）↔ 小程序 `src/state/*.ts`（sessionStore / appModel / stores / streamCoordinator / cache / composer / connection / profileStore / search / settings / store / theme）。
- 方式：两侧逐文件、逐函数实读对照（不是看大纲）；另实读 Android 单测 `UnreadErrorGateTest / SeedFromCacheHasMoreTest / SessionCacheHitPercentTest / StatusOrderRankTest / LiveTurnFailureSignalTest / ToolResultLinkageTest / TurnFailureMessageTest / TurnChangesStoreRetryTest / TurnCardStateTest`，把每个测试钉住的行为在小程序侧逐条核对。
- 只审计，未修改任何源码（本报告文件除外）。
- 不重复第一轮 UI 层审计（`docs/audit/A~D`、`docs/DIFF-ANDROID.md`）的结论；凡与其有交集处均显式注明"根因在状态层"。

## 路径前缀约定

| 前缀 | 展开 |
| --- | --- |
| `A-` | `/Users/user/dshapp/dsh-androidapp/app/src/main/java/ai/deepseek/dshphone/` |
| `AT-` | `/Users/user/dshapp/dsh-androidapp/app/src/test/java/ai/deepseek/dshphone/` |
| `W-` | `/Users/user/dshapp/dsh-miniapp/`（即 `W-src/state/appModel.ts`） |

---

## 结论摘要

| 严重度 | 条数 | 编号 |
| --- | --- | --- |
| **P0**（功能性错误 / 协议不兼容） | 3 | S-01 ~ S-03 |
| **P1**（用户可感知的行为差异） | 14 | S-04 ~ S-17 |
| **P2**（细节 / 健壮性 / 可维护性） | 19 | S-18 ~ S-36 |
| 已核对确认等价 | 29 项 | 见文末简表 |

分类统计：【BUG】19 条、【缺失】11 条、【多余】6 条。

### 最重要的 5 条

1. **S-01（P0）退出会话页就 `unfollow`，后台会话彻底停更。** 小程序在聊天页卸载时调 `close()→coordinator.unfollow()`；Android 从不在离开页面时退订（`unfollow` 只在会话被主机移除、或助手流断链重开时调用）。后果：一条打开过又退回列表的会话，之后跑挂了 **列表行的未读失败红点根本不会亮**（`turn/end` 只走 session/follow 流），`running`/窗口也不再更新——`AT-UnreadErrorGateTest` 钉住的整套语义在小程序端被架空。
2. **S-02（P0）`tool/result` 的空 `callId` 兜底两端都缺。** 调用侧空 id 落成 `seq-<seq>`，结果侧却拿空串直接拼 key，既接不回那条调用（调用行永远"没有结果"），多条孤儿结果还会挤在 `tool-call:` 同一把键上互相覆盖。Android 对这条约定有专门单测 `AT-ToolResultLinkageTest`。
3. **S-03（P0）实时帧上的"一轮失败"完全不发失败事实。** Android 在 `applyLiveEvent` 折叠之前读 `liveTurnFailureMessage(event)` 发 `AttentionSignal.Failed`；小程序整个仓库没有 `liveTurnFailureMessage`/`turnFailureNotificationBody`，失败只剩 `$events` 的 `api-session/error` 一条路（`AT-LiveTurnFailureSignalTest` 正是为此存在）。
4. **S-06（P1）缺 `seedFromSummary`。** 懒建的会话窗口不从名册摘要铺 `running/blank/cwd/agentPreset` 与首屏裁切点；`seedHistoryCursor` 在小程序里**定义了但没有任何调用点**。后果与 Android 注释里写明的一致：队列条"插队发送"常灰、转写先闪空态。
5. **S-04（P1）`seedFromCache` 不把 `hasMore` 落到 store。** Android 在 `replace` 后紧跟 `hasMore = eventWindow.hasMore`，并有专门回归测试 `AT-SeedFromCacheHasMoreTest`；小程序漏了这一行，冷启动底稿会被当成"还有更早"，过程行折叠被短路、"加载更早"误亮。

---

## 逐条发现

### P0

#### S-01 退出会话页即 `unfollow`：后台会话的未读失败红点永不亮、窗口停更（P0｜BUG＋多余）

- Android 证据：
  - `A-state/StreamCoordinator.kt:160-164` `unfollow()` 的**全部**调用点是 `:156`（`refollow`）、`:248`（`api-session/removed`）、`:459`（`reopenAssistantStream`）——`A-state/PhoneModel.kt` 全文没有任何"离开页面就退订"的动作（`:500-534 open()` 只登记 follow）。
  - `A-state/StreamCoordinator.kt:463-497`（尤其 `:489-495` 注释）："手机不丢帧（窗口要靠实时帧保持最新）…少了这一问，任何一条已登记 follow 的后台会话一出错就立刻被标成已读，列表行的红点永远不会亮"。
  - `AT-UnreadErrorGateTest.kt:88-95` 明确断言：会话不在屏时的失败必须留成未读。
- 小程序证据：`W-src/state/appModel.ts:522-526` `close()` 第一件事就是 `this.coordinator?.unfollow(sessionId)`；`W-src/pages/chat/index.tsx:143-149` 在 effect 的 cleanup（退页/切会话）里调 `model.close(sessionId)`。
- 差异说明：Android 的"未读失败红点"前提是 **follow 一直在**：`turn/end`（失败位的唯一来源）只经由 session/follow 流送达。小程序退页即退订，等于把所有后台会话的事件源切断——红点不亮、`running` 不更新、回到会话时也没有"窗口已是最新"的前提（只能靠 `resetWindow`+新快照重来，见 S-13）。同时 `sessionIsOnScreen` 这道闸在小程序里几乎无用武之地（不在屏的会话压根收不到帧）。
- 建议改法：删掉 `close()` 里的 `unfollow`（只保留 `pendingApproval/pendingQuestion` 的摘除，与 `SessionStore.close()` 的注释一致）；只在 `api-session/removed`、归档、`teardown` 与 `reopenAssistantStream` 时退订。若确实担心小程序的多路下行配额，应改成"保留 N 条最近会话的 follow"并在报告里显式记账，而不是一律退订。

#### S-02 `tool/result` 空 `callId`：既不回接调用，也不生成唯一孤儿 id（P0｜BUG）

- Android 证据：`A-state/SessionStore.kt:830-865`。`:834-842` 当 `wrappedCallId` 为空串时，挑"最近一条还没有结果的工具调用"接上去；`:853` 一条都接不上时 `orphanId = "orphan-" + event.seq`（唯一 id）。注释 `:830-833`/`:851-852` 写明两条理由。测试：`AT-ToolResultLinkageTest.kt:28-56`（空 id 结果必须接到 `seq-10` 那条调用上，且只有 1 个 tool 节点）、`:58-75`（无可接调用时必须拿到唯一 `orphan-11`）。
- 小程序证据：`W-src/state/sessionStore.ts:1737-1780`。`:1749` `wrappedCallId = wrappers.length > 0 ? wrappers[0].toolCallId : callIdFromSource`；`:1760` `const key = 'tool-call:' + wrappedCallId`——空串时 key 恒为 `'tool-call:'`；`:1769-1779` 孤儿行直接用 `callId: wrappedCallId`（空串），没有 `orphan-<seq>`。对照 `:1717-1734` 调用侧确实有 `'seq-' + event.seq` 兜底（`:1723`），两端口径不一致。
- 差异说明：主机在某些路径上会发空 `callId`（Android 与 Mac 都为此专门兜底）。此时小程序会：① 真正的调用行永远停在"运行中/没有结果"；② 多条空 id 结果全部落在同一把键上，只剩最后一条可见；③ 转写多出一条 `orphan-result` 重复行。属转写数据错误。
- 建议改法：照抄 Android 两处兜底——空 `wrappedCallId` 时在 `contexts` 里选 `kind==='tool' && result===undefined` 中 `startSeq` 最大的那条键；接不上则 `callId = 'orphan-' + event.seq` 并以该 id 建键。
- 待确认：主机 0.1.6 是否仍会发空 `callId`（抓一次 `tool/result` 帧即可）。即便概率低，也应保留兜底：Android/Mac 两端都以单测钉住它。

#### S-03 实时 `turn/end` 失败不发失败事实（`liveTurnFailureMessage` 整条缺失）（P0｜缺失）

- Android 证据：`A-state/StreamCoordinator.kt:469-472`——"失败 peek 搭在这一帧上，所以要在下面折叠/丢帧之前发出"，`liveTurnFailureMessage(event)?.let { attentionHandler(AttentionSignal.Failed(sessionId, it)) }`；实现在 `A-model/TurnFailureMessage.kt:33-38`（只认 `turn/end` 且 `reason.kind=="error"`），通知正文在 `:46-47`。测试 `AT-LiveTurnFailureSignalTest.kt:96-112`（必须发出 1 条失败事实，且文案是本地化后的 AUTH 说法）、`:114-128`（正文保留主机原因）、`:131-145`（正常收尾不得冒失败）。
- 小程序证据：`W-src/state/streamCoordinator.ts:734-755` `applyLiveEvent` 只做 `setRunning / recordActivity / 补洞 / apply`，没有任何失败事实；全仓库 grep `liveTurnFailureMessage`、`turnFailureNotificationBody` 命中数为 **0**（`W-src/model/turnFailure.ts` 只移植了 `turnFailureMessage`，19 行）。
- 差异说明：失败提示因此完全押在 `$events` 的 `api-session/error`（`W-src/state/streamCoordinator.ts:485-492`）上——那是另一条流，送达与顺序都不保证；主机若只在 `turn/end` 里交代原因，小程序端就什么提示都没有（`lastErrorStore` 的消费方见 `W-src/pages/chat/index.tsx:116`、`W-src/pages/new/index.tsx:33`）。
- 建议改法：在 `W-src/model/turnFailure.ts` 补 `liveTurnFailureMessage(event)` 与 `turnFailureNotificationBody(message)`，并在 `applyLiveEvent` 的 `setRunning/recordActivity` 之后、补洞分支**之前**调用 `attentionHandler({kind:'failed', ...})`（顺序必须与 Android 一致，否则被补洞吞掉）。

### P1

#### S-04 `seedFromCache` 不把 `hasMore` 落到 store（P1｜BUG）

- Android 证据：`A-state/SessionStore.kt:443-450`，`:446-448` 注释 +`hasMore = eventWindow.hasMore`："底稿自己知道是不是最后一页…留着默认的 true，一份完整历史的短会话在 follow 快照回来之前会一直显示「加载更早」并且过程行不折叠"。测试 `AT-SeedFromCacheHasMoreTest.kt:38-47`。
- 小程序证据：`W-src/state/sessionStore.ts:1219-1223`：`eventWindow.replace({events, hasMore})` 之后直接 `replayHistory()`，**没有** `this.hasMore = this.eventWindow.hasMore`（`hasMore` 是独立的 `hasMoreStore`，默认 `true`，见 `:616`）；唯一调用点 `W-src/state/appModel.ts:509` 也没有补写。
- 差异说明：冷启动点开会话时，`rebuildTurnProcessSpecs`（`W-src/state/sessionStore.ts:2483-2485`）因 `hasMore===true` 直接短路 → 过程行（思考/工具）不折叠；`canLoadEarlier`（`:2888-2890`）同时误亮。
- 建议改法：`replace` 后补 `this.hasMore = this.eventWindow.hasMore;`，并补一条与 Android 同名的回归用例。

#### S-05 follow 快照落定后缺 `markErrorSeen`：正在看的会话仍留未读失败（P1｜缺失）

- Android 证据：`A-state/StreamCoordinator.kt:406-408`："快照的重放会把失败位重新抬起来，所以已读要在窗口落定之后再标一次"，`if (sessionIsOnScreen(sessionId)) store.markErrorSeen()`。
- 小程序证据：`W-src/state/streamCoordinator.ts:642-673` 的 snapshot 分支：`loadHistory → subscribe → 落盘 → applyAssistantStreamBaseline → assistantExpectations`，**没有** `markErrorSeen`。
- 差异说明：`W-src/state/appModel.ts:515` 在 `open()` 里同步标了一次已读，但那时新建的 store 还没有失败位（`lastErroredTurn`/`seenErroredTurn` 都是 undefined，`W-src/state/sessionStore.ts:1097-1099` 于是是空操作）；随后快照重放才把 `lastTurnErrored=true、lastErroredTurn=N` 抬起来，`seenErroredTurn` 仍是 undefined → 用户**正在看的**这条会话反而留着未读失败（配合 S-08 红点也不会消）。
- 建议改法：snapshot 分支末尾补 `if (this.deps.sessionIsOnScreen?.(sessionId) !== false) store.markErrorSeen();`。

#### S-06 缺 `seedFromSummary`：新建窗口不铺 running/blank/cwd/预设/首屏裁切点（P1｜缺失）

- Android 证据：`A-state/PhoneModel.kt:472-480`（`store()` 懒建时 `seedFromSummary(store)`）、`:482-498`（`blank` 只往下压、`running`、`cwd`、`agentPreset`、`seedHistoryCursor(projections.asOfSeq)`，注释写明不铺的两个后果）、`:520-522`（`open()` 里对既有 store 再喂一次裁切点）。
- 小程序证据：`W-src/state/appModel.ts:410-420` `ensureSession` 只设 `setPermissionCatalog / setHistoryPageLoader / 订阅`；`:505-519` `open()` 也没有任何摘要铺底；`W-src/state/sessionStore.ts:1092-1095` `seedHistoryCursor` **定义了但全仓无调用点**（grep 命中 1 处即定义本身）。
- 差异说明：与 Android 注释逐条对应——① 后台帧懒建的 store `running` 默认 false，队列条"插队发送"一直禁用；② `cwd/agentPreset` 在投影到达前为空；③ `historyCursor` 退化成 -1（`W-src/state/sessionStore.ts:961-963`），`loadPage` 直接 return（`:2897-2898`），转写只能干等 snapshot——这在 follow 建不起来时就是永久空态（见 S-13）。
- 建议改法：在 `ensureSession` 里补一个 `seedFromSummary(store)`（照 Android 逐字段），并在 `open()` 里对既有 store 再喂一次 `seedHistoryCursor(summary.projections?.asOfSeq)`。

#### S-07 `handleAttention` 二次标记把 `planReview` 覆盖成 `question`（P1｜BUG＋多余）

- Android 证据：`A-state/StreamCoordinator.kt:291-301`（提问帧 → `store.setQuestion` → `syncAwaitingUser`）与 `:314-317`（`syncAwaitingUser` 用 `pendingInteractionKind` 决定档位）；`A-model/Frames.kt:102-112` 计划评审 → `SessionAwaitingKind.PLAN_REVIEW`；`A-model/Format.kt:219-228` 三档各自的徽标文案。Android 的 `attentionHandler` 只是通知出口（`A-state/PhoneModel.kt:331`），**不写** awaiting 档位。
- 小程序证据：`W-src/state/streamCoordinator.ts:526-529` 先 `syncAwaitingUser`（`:549-553`，正确得出 `planReview`），随后 `attentionHandler` → `W-src/state/appModel.ts:392-397` 又调 `markAwaitingUser(sessionId, 'question')`（那行三元表达式两个分支都是 `'question'`），`W-src/state/stores.ts:423-430` 直接覆盖 kind。
- 差异说明：计划评审会话的行尾徽标退化成"等待回答"（排序档位相同，均为 4，所以只有文案错）。审批分支同值覆盖，无害但同样多余。
- 建议改法：删掉 `handleAttention` 里的两次 `markAwaitingUser`——awaiting 档位的唯一写入口应是 coordinator 的 `syncAwaitingUser`（它才知道 planReview）。

#### S-08 `erroredSessionIds` 不随 `markErrorSeen` 重算：红点读过不消（P1｜BUG）

- Android 证据：`A-state/PhoneModel.kt:265-274`（`markErrorSeen` 只改 store 内部位）；红点由界面直接读 `SessionStore.unreadError`（`A-state/SessionStore.kt:163-167`）在每次重组时求值，没有中间快照。
- 小程序证据：`W-src/state/appModel.ts:417` 只订阅 `store.lastTurnErroredStore` 一个 Store；`:478-484` `publishErroredSessions` 仅在该订阅回调里跑；`W-src/state/sessionStore.ts:886-891、1097-1099` `lastErroredTurn/seenErroredTurn` 是**私有裸字段**，`markErrorSeen` 不触发任何 Store 通知。消费方 `W-src/pages/index/index.tsx:128、180、206、503`。
- 差异说明：`markErrorSeen()`（打开会话、屏上实时失败）改变了 `unreadError` 的真值，但 `erroredSessionIdsStore` 的快照不会更新——列表行的红点与"未读失败"排序档位要一直等到 `lastTurnErrored` 下一次翻转（下一轮 `turn/start`）才纠正。
- 建议改法：把 `markErrorSeen()` 改成会发通知的写入（例如 `unreadErrorStore`，或在 `markErrorSeen` 末尾 `lastTurnErroredStore.emit()`），并让 `publishErroredSessions` 订阅它。

#### S-09 `refreshInternal` 缺代次保护：旧基线会盖掉新基线（P1｜缺失）

- Android 证据：`A-state/PhoneModel.kt:348-377`：`sessionListRefreshGeneration++`（`:350-351`）、请求回来后 `if (generation != sessionListRefreshGeneration) return`（`:358` 成功路径、`:371` 失败路径）。
- 小程序证据：`W-src/state/appModel.ts:373-385`：只有 `beginBaselinePull/endBaselinePull` 的 token 配对，没有任何刷新代次；而调用点有 5 处并发来源（`:299 runConnect`、`:331 refresh`、`:223 remoteEventHandler`、`:237 resyncHandler`、`:563/574/594/1005` 各业务动作）。
- 差异说明：`beginBaselinePull` 的 token 只保证"后发拉取不被先发收尾抹掉"，不保证**先发的应答不落库**：先发的 `sessionList` 晚到时 `endBaselinePull` 的 token 已换代 → 它自己 return（还算安全），但**先发拉取若先拿到 token 再晚返回**，`pullRecordingToken` 相等的窗口里仍可能把过期清单整体 `replaceSessions`。并发下拉刷新 + 远端事件刷新是常见场景。
- 建议改法：照搬一个 `sessionListRefreshGeneration`，成功/失败两条路径都先比代次。

#### S-10 失败文案把底层异常原文端给用户（P1｜BUG）

- Android 证据：`A-state/PhoneModel.kt:370-376`——列表刷新失败时 `connection = Connection.Failed(Strings.offlineBannerTitle)`，原始异常只写日志（`:374`）；`:1380-1400` `describe()` 明确只在 `code != "internal"` 时用主机 detail，否则 `Strings.operationFailed`。
- 小程序证据：`W-src/state/appModel.ts:74-78` `describe()` 无条件返回 `error.detail || error.code`（含 `internal` 的 `EOFException`/`chacha20poly1305: authentication failed` 这类原文）；`:306-310` 连接失败时 `connectionStore.set({kind:'failed', message: describe(error)})` 且 `lastErrorStore` 同步写入。`Strings.offlineBannerTitle` 在小程序里只用于空态（`W-src/pages/index/index.tsx:475`）。
- 差异说明：横幅/提示会出现传输层英文异常。第一轮 UI 审计的 B-29/D-01 描述的是表现，**根因在这里**：`describe()` 少了 Android 的 `code != "internal"` 闸门，且连接失败根本不该用异常文案。
- 建议改法：`describe()` 加闸门（internal → `Strings.operationFailed`）；`runConnect` 的 catch 改用 `Strings.offlineBannerTitle`，原文只 `console.warn`。

#### S-11 会话被移除/归档时缺三件清理（P1｜缺失）

- Android 证据：`A-state/PhoneModel.kt:411-422` `handleSessionRemoved`：`turnChanges.closeAll(sessionId)`（`:415`）、`cache.removeWindow(sessionId)`（`:417`）、当前会话被删时 `selectedSessionId = null; lastErrorMessage = Strings.sessionGone`（`:418-421`）；`:435-443` `handleSessionsArchived` 同样 `turnChanges.closeAll` + `removeWindow`（并显式说明不写 `lastErrorMessage`）。
- 小程序证据：`W-src/state/appModel.ts:225-228`（`sessionRemovedHandler` 只 `sessions.delete` + `listStore.remove`）、`:229-235`（归档只写两个 store）、`:613-625` `archiveSession` 同样不清缓存；`W-src/state/cache.ts:78-84` `removeWindow` **无任何调用点**；`turnChangesSummaries/Diffs` 只在 `teardown`（`:369-370`）整表清空；`Strings.sessionGone` 在 `W-src/i18n/strings.ts:229` 有定义但全仓未使用。
- 差异说明：① 磁盘上留着已删/已归档会话的窗口，下次冷启动会画出幽灵内容；② 改动汇总缓存跨会话生命周期残留；③ 正在看的会话被主机删掉时，小程序既不退出也不给"该会话已在主机上消失"。
- 建议改法：把三件清理补进两个 handler（并在 `archiveSession` 里复用同一函数）。

#### S-12 改动汇总/比较的重试策略缺失（P1｜BUG）

- Android 证据：`A-state/TurnChangesStore.kt:52-104`：`loading/loadingDiffs` 在飞去重（`:71、:94`）；`runCatching{fetch()}.getOrElse{ return@launch }`——**传输失败不写任何缓存**（`:74、:97`）；只有 `fetch` 成功返回 null（404）才记 `unavailable`（`:75、:98`）；`closeAll` 按会话清理（`:43-50`）。测试 `AT-TurnChangesStoreRetryTest.kt:40-82` 四条全部钉这套语义。
- 小程序证据：`W-src/state/appModel.ts:436-448` `loadTurnChanges`：只缓存成功值，**404（`summary===undefined`）不记不可用**（每次重绘都会再发一次），无在飞去重，且把传输失败写进 `lastErrorStore`（Android 只静默）；`:451-458` `loadTurnChangesDiff` 更是**没有 try/catch**，异常直接抛给调用方（`W-src/ui/messageRow.tsx:677-678` 的 `loadDiff`）。
- 差异说明：404 不落 `unavailable` → 每次滚动重绘都重复请求同一个已消失的记录；`loadDiff` 抛出可能导致未捕获的 Promise 拒绝（小程序端会打断卡片的加载态）。
- 建议改法：把 `turnChangesSummaries` 拆成 `values / unavailable / loading` 三份（照 Android 三集合），404 记 unavailable、异常不写缓存、在飞去重；`loadDiff` 补 catch；`closeAll(sessionId)` 与 S-11 一起接上。

#### S-13 `open()` 无条件 `resetWindow`，且没有"follow 未覆盖才补分页"的判定（P1｜BUG）

- Android 证据：`A-state/PhoneModel.kt:500-534`：`open()` **不清窗口**（`:296` 注释还专门解释"teardown 会清掉会话窗口，正在看的转写会变成空白"因此要避免）；`:523-532` 首屏只拉一份：`following = coordinator?.follow(...) == true`，只有 follow 建不起来且 `!store.historyLoaded` 才补 `loadHistory`。
- 小程序证据：`W-src/state/appModel.ts:505-520`：`store.open(sessionId)` → `W-src/state/sessionStore.ts:1064-1069` 无条件 `resetWindow()`（清 nodes/lastSeq/subscribedLastSeq/historyLoaded、`hasMore=true`）；随后 `follow` 的返回值被丢弃，也没有任何"follow 没覆盖就补分页"的兜底。
- 差异说明：① 每次进会话都把内存窗口丢掉，与 `SessionStore.close()` 自己的注释"窗口留着以便再点开时秒开"（`:1071`）自相矛盾；② 若 `follow` 因 mux 未建立而没送 snapshot，转写会永久停在空态（没有分页兜底，且 `historyCursor` 已被重置为 -1，`loadPage` 直接 return）。
- 建议改法：`open()` 只在 `sessionId` 真的换了时重置窗口；用 `follow()` 的返回值决定是否补一次 `loadPage(false)`（对齐 Android 的 `following` 判定）。

#### S-14 重连后不重置/不重取当前会话窗口（P1｜缺失）

- Android 证据：`A-state/PhoneModel.kt:445-453` `resyncAfterReconnect`：`refreshInternal()` → 当前会话 `store.resetWindow()` → `loadHistory(store)`（注释说明重连后每条流会重开、这里清空窗口即可）。挂载点 `A-state/StreamCoordinator.kt:171-172`。
- 小程序证据：`W-src/state/appModel.ts:236-238` `resyncHandler` 只有 `void this.refreshInternal()`。
- 差异说明：重连后当前会话的窗口保持旧内容，是否会被新 snapshot 整体替换取决于 mux 是否真的重开了那条 follow（`W-src/transport/tunnel/mux.ts` 的重订阅行为）；在"unfollow 过 / 快照未重发"的组合下窗口会带着断点残留。
- 建议改法：照 Android 补 `resetWindow + 重取`；若确认 mux 每代连接都会重发 snapshot，可只保留 `resetWindow`。
- 待确认：`TunnelMux` 重连时是否自动重放全部订阅并重发 snapshot（读 `W-src/transport/tunnel/mux.ts` 的重连分支即可确认）。

#### S-15 `pullToRefresh` 无重入保护、不对齐当前会话窗口（P1｜BUG）

- Android 证据：`A-state/PhoneModel.kt:384-395`：`if (refreshing) return`（`:385`）、刷新后 `selectedSessionId?.let { sessions[it]?.let { loadHistory(it) } }`（`:390`）。
- 小程序证据：`W-src/state/appModel.ts:339-346`：直接 `refreshingStore.set(true)` → `refresh()`，无重入判断，也不动当前会话窗口。
- 差异说明：连续下拉会叠多次 `session/list`（叠加 S-09 的无代次保护后更容易把旧清单落库）；下拉刷新在聊天页不会把转写对齐到最新。
- 建议改法：补 `if (this.refreshingStore.get()) return;`，并在刷新后对当前会话跑一次首屏重取。

#### S-16 `open()` 多做了 `markEngaged`：刚打开的空白会话被标成非空白（P1｜多余）

- Android 证据：`A-state/PhoneModel.kt:500-534` `open()` 里**没有** `markEngaged`；它只在真的发出内容后调用——`:735`（命令执行成功）与 `:771`（`sessionPrompt` 被接受）。`A-state/Stores.kt:267-272` `markEngaged` 会把行的 `blank` 压成 false。
- 小程序证据：`W-src/state/appModel.ts:517` `sessionListStore.markEngaged(sessionId)` 出现在 `open()` 里（`send` 里也有，`:690、:729`）。
- 差异说明：只"点开看一眼"的空白会话会立刻失去 `blank` 标记 → ① 下次新建会话不再复用它（`reusableBlankSession`，`W-src/model/blankSessionReuse.ts`，对应 `AT-BlankSessionReuseTest` 的语义），每次新建都真的开一条新会话；② 列表的空白会话口径与安卓不一致。
- 建议改法：删掉 `open()` 里的 `markEngaged`。

#### S-17 roster 缓存：空清单会覆盖上次缓存；存的是裸 items 而非合并快照（P1｜BUG）

- Android 证据：`A-state/SessionCache.kt:49-54` `saveRoster`：`if (items.isEmpty()) return`（空表绝不落盘）；`A-state/PhoneModel.kt:359-363`：落盘的是 `listStore.sessions`（基线 + 往返期间重放的增量），注释说明"比裸的 value.items 更接近用户此刻看到的那一份"。
- 小程序证据：`W-src/state/cache.ts:52-56`：无空表判断，`writeStorage(...)` 直接写（`items.slice(0, 4000)`）；`W-src/state/appModel.ts:378-379`：`endBaselinePull(list.items, token)` 之后 `sessionCache.saveRoster(list.items)`（裸 items）。
- 差异说明：主机短暂返回空清单（刚启动、切工作区、权限收紧）会把本机缓存清空 → 下次冷启动白屏；同时缓存里缺少拉取期间重放的增量（标题投影等）。
- 建议改法：`saveRoster` 前置 `if (items.length === 0) return;`；调用点改传 `sessionListStore.sessions`。

### P2

#### S-18 `tool/ptc-dispatch` 子调用结束丢掉 `error`/`meta`（P2｜缺失）
- Android：`A-state/SessionStore.kt:905-912`（`error = data["error"]?.let{ ToolError(name, code) }`、`meta = data["meta"]`）。
- 小程序：`W-src/state/sessionStore.ts:1829-1834` 只有 `seq/time/content/isError`。
- 影响：PTC 子调用失败时卡片拿不到错误名/码与 meta（父调用路径 `:1750-1758` 是完整的，只有子调用漏）。建议补两字段（`decodeToolError(data.error)` 已存在）。

#### S-19 awaiting 档位兜底方向相反（P2｜BUG）
- Android：`A-state/Stores.kt:349-355` — 集合是权威，`awaitingUserKinds[id] ?: SessionAwaitingKind.APPROVAL`（没有名字按**批准**排档，与行上徽标兜底同口径）。
- 小程序：`W-src/state/stores.ts:379-380` — `kind==='approval'→3`，否则 `awaiting.has(id)→4`（没有名字落到**提问**档）。
- 影响：当前两个集合总是同步写入（`:423-438`），实际不可达；但兜底方向与安卓相反，一旦将来出现只进集合不写 kind 的路径，排序就会错。建议改成 `awaiting.has(id) ? (kind==='approval'||kind===undefined ? 3 : 4) : ...`，与 Android 一致。

#### S-20 `llm/adapters-updated` / `settings/document-updated` 不重拉模型目录（P2｜缺失）
- Android：`A-state/PhoneModel.kt:404-406` — 这两个事件会对**所有**已打开会话 `loadModels(it)`。
- 小程序：`W-src/state/appModel.ts:220-224` 的 `remoteEventHandler` 只处理 `permission-presets/catalog-changed` 与"其余一律刷列表"，无 `loadModels`（`loadModels` 仅由 UI 挂载触发：`W-src/ui/composerBar.tsx:512`、`W-src/ui/sheets.tsx:534`）。
- 影响：主机改了适配器/设置后，已打开的模型选择器保持旧目录直到组件重挂。建议补上。

#### S-21 任意远端事件都全量刷新会话列表（P2｜多余）
- Android：`A-state/PhoneModel.kt:397-409` 只有 `connection/reset` 才 `refreshInternal()`；预设/目录各自按事件精准重拉。
- 小程序：`W-src/state/appModel.ts:220-224` 对**任何**未识别事件 `void this.refreshInternal()`，而 `refreshInternal` 内部还额外 `void this.loadAgentPresets()`（`:384`）。
- 影响：高频主机事件会连带引发大量 `session/list` + `agentPresets/list` 往返（隧道配额敏感），并放大 S-09 的乱序落库风险。建议按事件名分派。

#### S-22 `teardown` 不重置连接态/工作区/选中会话（P2｜缺失）
- Android：`A-state/PhoneModel.kt:455-466` — 还会 `selectedSessionId = null`、`workspaceStore = WorkspaceStore()`、`connection = Connection.Idle`。
- 小程序：`W-src/state/appModel.ts:360-371` 只清 coordinator/transport/sessions/imageCache/catalog/changes 缓存。
- 影响：切换电脑时上一台的工作区分组与选中会话残留到新连接的第一帧之后。建议补齐三项。

#### S-23 `loadWindow` 不丢弃空记录窗口（P2｜BUG）
- Android：`A-state/SessionCache.kt:57-62` — `takeIf { it.records.isNotEmpty() }`，空记录等于没有缓存。
- 小程序：`W-src/state/cache.ts:58-68` 只校验 `Array.isArray(parsed.records)`，空数组也算命中（随后 `seedFromCache` 的 `records.length===0` 才挡住，见 `W-src/state/sessionStore.ts:1220`）。
- 影响：目前被下游挡住，属冗余风险。建议与安卓一致地在读取处过滤。

#### S-24 `saveWindow`/`saveRoster` 的上限口径不同（P2｜BUG）
- Android：`A-state/SessionCache.kt:64-70` — `records.size > MAX_CACHED_RECORDS(4000)` 时**整份跳过不写**；roster 无条数上限。
- 小程序：`W-src/state/cache.ts:70-76` — 取尾部 4000 条写入（`records.slice(-4000)`）；`:52-56` 给 roster 也套了 4000 上限。
- 影响：小程序会缓存一个"被截断的尾窗口"，冷启动底稿可能与 `hasMore` 口径不符（叠加 S-04 更明显）。建议与安卓一致（超限跳过）。

#### S-25 `clear()` 不删 roster 与索引键（P2｜BUG）
- Android：`A-state/SessionCache.kt:76-78` `root.deleteRecursively()`（含 `roster.json`）。
- 小程序：`W-src/state/cache.ts:86-94` 只遍历 `windowKeys()` 删窗口键，`roster`/`windowIndex` 两个键留下。
- 影响：两端目前都没有 `clear()` 的调用点（Android grep 亦为 0），属潜在雷。建议顺手补全。

#### S-26 `sanitize` 缺 120 字上限（P2｜健壮性）
- Android：`A-state/SessionCache.kt:102-103` `.take(120)`。小程序：`W-src/state/cache.ts:15-17` 无长度截断。
- 影响：超长 sessionId/profileId 会生成超长存储键（wx 存储键长度限制未知）。建议补 `.slice(0,120)`。
- 待确认：微信 `setStorageSync` 的键长上限。

#### S-27 `replayHistory` 清空 `changesSeqByTurn`（P2｜BUG，方向与安卓相反）
- Android：`A-state/SessionStore.kt:500-523` `replayHistory` **不清** 公告坐标；清理只发生在 `rebuildProjections`（`:1237`），而后者总与一次重放配对。
- 小程序：`W-src/state/sessionStore.ts:1283-1284` 在**每次** `replayHistory` 里清空。
- 影响：一次由乱序/压缩事件触发的全量重放，会把"已滑出窗口的那些轮次"的改动文件卡坐标一并丢掉（卡片消失）。建议改成只在 `rebuildProjections` 里清。

#### S-28 `applyWorkspaceChanges` 只接受更大的 seq（P2｜多余）
- Android：`A-state/SessionStore.kt:1630-1635` `changesSeqByTurn[turn] = event.seq`（后来的公告一律取代）。
- 小程序：`W-src/state/sessionStore.ts:2860-2866` 增加了 `event.seq > previous` 的守卫。
- 影响：有序重放下等价；仅在"主机重发一条更旧的公告"时行为不同（小程序保留新的）。属更保守的加固，建议保留但记账。

#### S-29 `retryHistory` 不走 `refollow`（P2｜BUG＋死代码）
- Android：`A-state/PhoneModel.kt:563-572` — 重试优先 `coordinator.refollow(sessionId)`（"snapshot 就是基线；再叠一次分页只会把同一段历史拉两遍"），只有 coordinator 没了才退回分页。
- 小程序：`W-src/state/sessionStore.ts:2922-2926` 直接 `loadPage(false)`；`W-src/state/streamCoordinator.ts:333-337` 的 `refollow` **无任何调用点**。
- 影响：基线取不回时多拉一遍历史，且失败的那条 follow 不会被撤换（错误态可能一直挂着）。建议把 `refollow` 接到重试入口。

#### S-30 `recentWorkspaceId` 忽略 `workspace.createdAt`（P2｜BUG）
- Android：`A-state/PhoneModel.kt:638-671` — 逐工作区取"其下会话 `updatedAt` 最大值"，没有会话时退回解析后的 `createdAt`，并列时取主机顺序靠前者。
- 小程序：`W-src/state/appModel.ts:1027-1039` — 只遍历会话挑最新那条所属的工作区，全无会话时退回 `workspaces[0]`，完全不读 `createdAt`（`byId` 变量还被 `void byId` 丢弃）。
- 影响：全新（没有任何会话）的工作区永远不会成为新建会话页的默认项。建议照安卓重写。

#### S-31 失败原因额外读 `reason.message`（P2｜多余）
- Android：`A-model/TurnFailureMessage.kt:19-23` 只读 `reason.error.{code,message}`，缺失即本地化兜底。
- 小程序：`W-src/state/sessionStore.ts:1897-1906` 先取 `failure.message ?? reason.message` 再喂给 `turnFailureMessage`。
- 影响：主机把原因放在 `reason.message` 时小程序会显示它，安卓显示兜底文案（`AT-TurnFailureMessageTest.kt:53-59` 钉的是"缺 message → 本地化兜底"，小程序在 `reason.message` 也缺失时同样满足）。属更宽容的解析，建议保留并记账。

#### S-32 `TurnCardState` 无对应物（P2｜缺失·平台限制）
- Android：`A-state/TurnCardState.kt:12-60`（`running/failedDuringRun/deliveredDone` 三集合 + 守卫顺序），测试 `AT-TurnCardStateTest.kt` 六条。
- 小程序：无任何对应文件；`W-src/state/appModel.ts:157-160` 明确"小程序没有系统通知，跑完了只能在列表行上体现"，`AttentionSignal.sessionCompleted` 分支空实现（`:401-404`）。
- 影响：当前无通知，因此"失败卡被完成卡顶掉"的风险不存在；但 `listStore.onCompleted`（`W-src/state/stores.ts:465-484`）已经在产出完成边沿。一旦接入订阅消息/服务通知，必须先把三集合守卫补上。

#### S-33 `composer.isCommandLine`/`commandName` 与发送口径不同且未被使用（P2｜多余·死代码）
- Android：`A-state/PhoneModel.kt:708` 唯一的命令口径 `^/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])`。
- 小程序：发送路径一致（`W-src/state/appModel.ts:1109-1113`），但 `W-src/state/composer.ts:188-196` 另有一套 `^\/(\S+)(?=\s|$)`（大写、路径都算命令），且全仓无调用点。
- 影响：现在无影响；留着两套口径容易被后来者误用。建议删掉或改为复用同一常量。

#### S-34 搜索失败把 `hits` 置成空数组（P2｜BUG）
- Android：`A-state/PhoneModel.kt:929-933` — `searchHits = result.getOrNull()`（失败是 **null**），`searchContentUnavailable = result.isFailure`。
- 小程序：`W-src/state/appModel.ts:552-555` — 失败写 `hits: []`。
- 影响：`undefined`（"没问过/不可用"）与 `[]`（"问过且没命中"）在页面里是两种态（`W-src/state/search.ts:11-16` 的注释也这么定义）；写 `[]` 会让"内容搜索不可用"同时显示成"0 条命中"。建议改回不写 hits。

#### S-35 `runningSubagentRoots` 无缓存（P2｜等价·性能）
- Android：`A-state/Stores.kt:69-84`（`runningSubagentRootsCache`，`sessions` 一变即作废，`:30-32`）。
- 小程序：`W-src/state/stores.ts:341-363` 每次调用全量重算；`setSessions`（`:122-125`）只作废投影账本。
- 影响：语义等价；`statusOrder` 每次排序都会重算一遍 O(n) 父链。会话数大时可考虑加同一处缓存。

#### S-36 状态档位未抽成纯函数、无对应单测（P2｜可维护性）
- Android：`A-state/SessionStatusRank.kt:12-67`（枚举 + `sessionStatusRank` 纯函数，注释说明"只有纯函数能在 JVM 单测里逐档钉住"），测试 `AT-StatusOrderRankTest.kt` 六条。
- 小程序：`W-src/state/stores.ts:373-383` 内联在 `statusOrder` 里的 `rank` 闭包（档位数值与安卓一致，已逐档核对）；仓库内无对应测试（`grep sessionStatusRank` 仅命中注释）。
- 建议：抽成 `src/model/sessionStatusRank.ts` 并照 `StatusOrderRankTest` 补 6 条用例（含"子智能体在跑 → 父会话进 RUNNING 档"）。

---

## 已核对确认等价的清单（无需再审）

| # | 主题 | Android | 小程序 | 结论 |
| --- | --- | --- | --- | --- |
| E-01 | 事件窗口去重/排序/合并/截断/实时插入 | `A-state/SessionEventWindow.kt:9-104` | `W-src/state/sessionStore.ts:292-412`（`SessionEventWindow` 内联在同文件） | 等价（二分插入点、`preferred` 让位规则、`revision` 自增逐条一致） |
| E-02 | 同 seq 记录的优先级 | `SessionEventWindow.kt:99-103` | `sessionStore.ts:278-284` | 等价 |
| E-03 | 事件分派分支表（含 `ptc-dispatch`/`code-dispatch` 双名、未知面板兜底） | `A-state/SessionStore.kt:532-562` | `sessionStore.ts:1311-1393` | 等价（逐 case 对照，无缺无多） |
| E-04 | 全量重放触发条件 | `SessionStore.kt:360-366` | `sessionStore.ts:1123-1135` | 等价 |
| E-05 | 流式增量：block-start/text-delta/reasoning-delta/tool-call-delta/block-end/usage + `MAX_BLOCK_INDEX=1024` | `SessionStore.kt:677-736` | `sessionStore.ts:1560-1650`、`:92` | 等价（累加、槽位校验、`firstVisibleSeq`/`firstTokenTime` 时机一致） |
| E-06 | 压缩 stream 记录展开（`dt` 数量校验、三种 chunk 类型、`time0` 累加） | `SessionStore.kt:1711-1757` | `sessionStore.ts:546-592` | 等价 |
| E-07 | 实时 chunk 的伪 seq（`durableCursor+1-1/(n+1)`） | `SessionStore.kt:495-498` | `sessionStore.ts:1272-1275` | 等价 |
| E-08 | 助手侧信道连续性闸门（start/chunk/end 的 index 期望、漏帧重开 follow） | `A-state/StreamCoordinator.kt:423-461` | `W-src/state/streamCoordinator.ts:688-732` | 等价 |
| E-09 | 轮次尾：usage 汇总/TTFT/解码 TPS/routes/closingText/runMs | `SessionStore.kt:988-1049` | `sessionStore.ts:1931-1998` | 等价（`sumNullable`、`billed && hasStart` 闸门一致） |
| E-10 | 轮次过程折叠（spec 生成条件、`covers`、key、折叠时隐 reasoning） | `SessionStore.kt:1362-1495`、`A-model/ChatNode.kt:96-110` | `sessionStore.ts:2450-2613`、`W-src/model/chatNode.ts:122-128` | 等价 |
| E-11 | 行索引：producedPaths 去重、closing step、prompt/response 锚点、deliverablesRevision | `SessionStore.kt:1497-1550` | `sessionStore.ts:2641-2719` | 等价 |
| E-12 | 节点 id 与排序锚点（含 `+0.05/+0.1/-0.001` 偏移） | `A-model/ChatNode.kt:314-336` | `W-src/model/chatNode.ts:325-364` | 等价 |
| E-13 | 投影只进不退 + 版本账本裁剪（`MAX_PROJECTION_VERSIONS=32`） | `SessionStore.kt:1205-1240`、`:1670` | `sessionStore.ts:2200-2255`、`:91` | 等价 |
| E-14 | 投影解码分支（title/blank/todos/goal/tokenUsage/sessionStats/imageLimits/permissions/inbox/agentPreset/modelSelection/turnOutline） | `SessionStore.kt:1242-1290` | `sessionStore.ts:2257-2345` | 等价 |
| E-15 | 权限投影 + 目录合并 | `A-model/Models.kt:196-199` | `W-src/model/types.ts:172-178` | 等价（`projection==null → null`；`rebuildProjections` 里置 undefined 与 Android 调 `refreshPermissions` 结果相同） |
| E-16 | 对齐/截断（`align`：窗口截断、投影历史裁剪、清队列/任务/审批/提问、两次写 lastSeq） | `SessionStore.kt:457-479` | `sessionStore.ts:1230-1256` | 等价 |
| E-17 | 补洞（`MAX_REPAIR_BUFFER=10000`、target/cursor 判定、失败与放弃分支） | `SessionStore.kt:368-410`、`:1669` | `sessionStore.ts:1137-1183`、`:90` | 等价 |
| E-18 | `historyCursor`/`repairCursor`/`followAddress`/`contextOccupancy`/`planModeTarget`/`goalBarGoal` 折叠 | `SessionStore.kt:230-277` | `sessionStore.ts:961-1005` | 等价 |
| E-19 | 分页口径（首屏 15 / 往上翻 30 / 跳转循环上限 20 页 / 无权威游标就不发） | `A-state/PhoneModel.kt:536-598`、`:1371-1378` | `sessionStore.ts:95-96、2892-2948` | 等价（实现位置从 PhoneModel 挪进 SessionStore，语义一致） |
| E-20 | follow 默认窗口 15 与订阅参数（address/maxMessages/assistantStream） | `StreamCoordinator.kt:57-63、125-151` | `streamCoordinator.ts:162-330` | 等价 |
| E-21 | `$events` 分支（added/removed/status/activity/error + 其余转 remoteEventHandler） | `StreamCoordinator.kt:234-271` | `streamCoordinator.ts:444-496` | 等价 |
| E-22 | waterfall（approval/user-questions 的解码、挂载、`syncAwaitingUser`、retire） | `StreamCoordinator.kt:273-317` | `streamCoordinator.ts:498-553` | 等价（档位覆盖问题见 S-07，不在本层） |
| E-23 | 断链清理 `dropStaleInteractions` | `StreamCoordinator.kt:178-186` | `streamCoordinator.ts:367-375` | 等价 |
| E-24 | control 流（baseline/queue/jobs/projection、inbox 镜像、`hydrateControlState` 的 0.1.5/0.1.6 二选一） | `StreamCoordinator.kt:342-385` | `streamCoordinator.ts:585-636` | 等价 |
| E-25 | `sessionActivityTimestamp`（只有 `source.kind=="user"` 的 `user/message` 推进活跃时间） | `StreamCoordinator.kt:519-523` | `streamCoordinator.ts:151-156` | 等价 |
| E-26 | 名册：baseline 录制/重放（token 配对）、upsert 合并规则、recordActivity 只进不退、setRunning、投影账本重建 | `A-state/Stores.kt:139-310` | `W-src/state/stores.ts:136-301` | 等价 |
| E-27 | 完成边沿（`previousRunning` 落盘键、`reconcileCompleted`、`syncCompletedNotifications`、`clearCompleted`） | `Stores.kt:119-137、402-431` | `stores.ts:47-53、127-134、452-484` | 等价（键名 `running_session_ids` ↔ `dsh.runningSessionIds`，本机键无兼容要求） |
| E-28 | 置顶/手动排序/子集换位、工作区注册表（upsert/remove/applyOrder/moveWorkspace 的 id 锚点与"没动就不发请求"） | `Stores.kt:312-381、441-497` | `stores.ts:303-332、389-413、490-566` | 等价 |
| E-29 | 偏好与配对：locale/theme 默认值与解析规则、`dsh_settings`↔`dsh.locale/dsh.theme`、配对串解析（`dshm://`、端口默认 443、32 字节校验、重扫保留设备私钥、`markConnected` 清配对码）、`sessionCacheHitPercent`（含饱和相加） | `A-state/AppSettings.kt:22-72`、`A-state/ServerProfileStore.kt:57-193`、`A-model/SessionUsageReading.kt:14-77` | `W-src/state/settings.ts:21-101`、`W-src/state/profileStore.ts:34-267`、`W-src/model/format.ts:60-105` | 等价（`AT-SessionCacheHitPercentTest` 六条断言逐条满足；加密存储缺失属平台限制，已在 profileStore 注释记账） |

---

## 附：与 Android 单测的逐条核对结果

| Android 测试 | 钉住的行为 | 小程序结论 |
| --- | --- | --- |
| `UnreadErrorGateTest` | 不在屏的会话失败必须留未读；在屏的要标已读 | coordinator 那一问是对的（`streamCoordinator.ts:753`），但 **S-01**（退页即 unfollow，后台压根收不到帧）+ **S-05**（快照后不标已读）+ **S-08**（红点快照不重算）合起来使这条语义整体失效 |
| `SeedFromCacheHasMoreTest` | 缓存窗口的 `hasMore` 要落到 store；铺底不算 loaded | `historyLoaded` 正确（`:1220`），`hasMore` **不满足** → S-04 |
| `ToolResultLinkageTest` | 空 callId 结果接回 `seq-<seq>`；孤儿结果拿唯一 `orphan-<seq>` | 两条都 **不满足** → S-02 |
| `LiveTurnFailureSignalTest` | 实时失败必须当场发失败事实，文案本地化 | **不满足**（整条缺失）→ S-03；`turnFailureMessage` 的 AUTH/兜底本身已对齐 |
| `TurnFailureMessageTest` | AUTH → 本地化；缺 message → 本地化兜底 | 满足（`W-src/model/turnFailure.ts:14-19`），另有更宽容的 `reason.message` 兜底 → S-31 |
| `StatusOrderRankTest` | 六档顺序 + 子智能体抬父会话 | 满足（`stores.ts:365-387`）；兜底方向差异见 S-19，缺测试见 S-36 |
| `TurnChangesStoreRetryTest` | 传输失败不落缓存、404 记不可用、可重试 | 404 分支 **不满足**（不记不可用，反复重试）→ S-12 |
| `TurnCardStateTest` | 失败压完成卡、一轮一张、forget 清干净 | 无对应实现（无系统通知）→ S-32 |
| `SessionCacheHitPercentTest` | 会话级命中率取位规则 + 饱和相加 | 满足（`W-src/model/format.ts:60-105`） |

## 附：审计覆盖的文件

- Android：`state/SessionStore.kt`(1758 全文)、`state/PhoneModel.kt`(1414 全文)、`state/Stores.kt`(498)、`state/StreamCoordinator.kt`(523)、`state/SessionCache.kt`(109)、`state/SessionEventWindow.kt`(104)、`state/SessionStatusRank.kt`(67)、`state/TurnCardState.kt`(61)、`state/TurnChangesStore.kt`(104)、`state/AppSettings.kt`(73)、`state/ServerProfileStore.kt`(193)；另按需读 `model/{TurnFailureMessage,ChatNode,Models,Format,Frames,SessionUsageReading}.kt` 相关段。
- 小程序：`src/state/sessionStore.ts`(2957 全文)、`src/state/appModel.ts`(1181 全文)、`src/state/streamCoordinator.ts`(756 全文)、`src/state/stores.ts`(569)、`src/state/cache.ts`(129)、`src/state/composer.ts`(196)、`src/state/connection.ts`(67)、`src/state/profileStore.ts`(269)、`src/state/search.ts`(18)、`src/state/settings.ts`(103)、`src/state/store.ts`(99)、`src/state/theme.ts`(60)；另按需读 `src/model/{turnFailure,chatNode,types,format,frames,questionFlow}.ts` 与 `src/pages/{chat,index}/index.tsx`、`src/app.tsx` 的挂载点。

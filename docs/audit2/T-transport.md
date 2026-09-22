# T 区差异审计报告：网络 / 传输层（第二轮，查漏补错）

- 审计对象：小程序端 `/Users/user/dshapp/dsh-miniapp/src/transport/**`、`src/model/json.ts`、`src/framework/req.ts`
- 权威参考：安卓端 `/Users/user/dshapp/dsh-androidapp/app/src/main/java/ai/deepseek/dshphone/net/*.kt`
- 交叉验证：主机真实实现（只读）`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-api-gateway/`、`.../dsh-client-file-upload/`
- 安卓单测对照：`app/src/test/java/ai/deepseek/dshphone/{MuxProbeFrameTest,NoiseFrameEofTest,Protocol016Test}.kt`
- 审计方式：逐文件、逐函数、逐常量对照阅读；**未修改任何源码**
- 快照时间：2026-09-21

> 说明：本轮只覆盖网络/传输层，且刻意避开上一轮 UI 四区（docs/audit/A~D、DIFF-ANDROID.md）的结论。
> 凡引用主机代码的地方，都给出了 `node_modules` 内的真实文件行号，可复核。

---

## 结论摘要

| 严重度 | 条数 | 编号 |
| --- | --- | --- |
| P0（协议不兼容 / 功能性错误） | 3 | T-01、T-02、T-03 |
| P1（用户可感知的行为差异） | 5 | T-04、T-05、T-06、T-07、T-08 |
| P2（细节 / 健壮性 / 文案） | 15 | T-09 ~ T-23 |
| 已核对等价 | 24 项 | 见文末简表 |

### 最重要的 5 条

1. **T-01（P0）探活帧发的是 `{"type":"ping"}`**，主机 `parseRemoteStreamClientMessage` 只认 `cancel`/`open`，其余一律 `close(1008)`。
   结果：**每次回到前台都会把一条健康的 mux 连接拆掉**，随后退避重连 + `dropStaleInteractions()` 清空待审批/待回答。
   这正是安卓 `MuxProbeFrameTest` 专门钉死、并且已经修掉的那个 bug，小程序侧原样复刻了旧行为。
2. **T-02（P0）`subscribe()` 用 `Set.prototype.add` 的返回值当布尔判据**——JS 里 `Set.add` 返回 Set（恒真），
   所以对**已经打开的流再次 subscribe 会再发一条 `open`**；主机对重复 streamId 直接 `throw` 并 `close(1008)`。
   `AppModel.open()` 每次进会话页都会 `follow()`，一旦同一 sessionId 被 follow 两次（同会话二次入栈/重入），整条 mux 连接被拆。
3. **T-03（P0）附件上传用 `multipart/form-data`**，而主机这条路由硬性要求 `application/octet-stream`，否则 **HTTP 415**。
   安卓发的是裸字节。结论：小程序端的文件上传（非图片附件）应当是**必然失败**的。
4. **T-04（P1）隧道内 HTTP 没有任何读超时**。安卓 OkHttp 是 `readTimeout 60s / writeTimeout 60s`。
   小程序的 `TunnelHttpClient` 把请求串行化在一条 Promise 链上，一个永不返回的响应会**永久堵死整条 RPC 通道**，且没有任何路径能把它拆掉。
5. **T-05（P1）一次性配对码没有"用掉即弃"**：安卓 `MobileTarget.consumePairingToken()` 用 `AtomicReference.getAndSet(null)` 保证全进程只发一次，
   小程序的 `TunnelTransport`/`TunnelMux` 在**每一次拨号、每一次重连**都把同一个 token 塞进 Noise message-1 的 payload。

---

## 逐条发现

### T-01　探活帧用 `{"type":"ping"}`，主机会 close(1008) 拆掉整代连接
- **严重度**：P0（协议不兼容）
- **类型**：【错误/BUG】
- **安卓证据**：
  - `net/MuxStream.kt:56-57`　`PROBE_STREAM_ID = "wake-probe"`
  - `net/MuxStream.kt:135-147`　`probeFrame()` 返回 `{"type":"cancel","streamId":"wake-probe"}`，注释明确写了"之前这里是 `{"type":"ping"}`：主机只接受 cancel/open，其余一律 throw……于是每次回前台都会拆掉一条健康连接"
  - `net/MuxStream.kt:149-156`　`probeNow()` 发 `probeFrame()`，发送失败则 `ws.cancel()`
  - `app/src/test/java/ai/deepseek/dshphone/MuxProbeFrameTest.kt:26-60`　两条断言把主机口径搬进了单测
- **小程序证据**：
  - `src/transport/tunnel/mux.ts:82-84`
    ```ts
    probeNow(): void {
      this.socket?.sendText(JSON.stringify({ type: 'ping' }));
    }
    ```
  - 调用链：`src/state/streamCoordinator.ts:303-310`（`onForeground` → `connection.probeNow()`）→ `src/state/appModel.ts` 的前台回调
- **主机侧交叉验证**（权威）：
  - `@deepseek-ai/dsh-api-gateway/lib/types/stream-protocol.js:155-168`：只接受 `type==='cancel'` 且键恰好 `{type,streamId}`，或 `type==='open'` 且键恰好 `{type,streamId,endpoint,payload}`；其余 `throw new Error('api gateway: invalid Remote stream client message')`
  - `@deepseek-ai/dsh-api-gateway/lib/types/stream-server.js:96-107`：`catch { this.socket.close(1008, 'invalid Remote stream request'); }`
- **差异说明**：每次 App 回到前台 → 发 ping → 主机判定非法帧 → 1008 关闭 → 小程序进 `reconnecting` 退避重连；
  且 `streamCoordinator` 的 `foldSocketState` 在非 connected 转换上会清掉待审批/待回答（与安卓 `dropStaleInteractions` 同口径），而 follow 的 snapshot 不会重送。
  探活的本意是"确认这一代连接还活着"，实际效果变成"每次前台必杀一代连接"。
- **建议改法**：把 `probeNow` 改成发一条打不着任何真实流的空 cancel：
  `JSON.stringify({ type: 'cancel', streamId: 'wake-probe' })`（主机对未知 streamId 的 cancel 是 `streams.get(id)?.abort`，no-op）。
  并补一条与 `MuxProbeFrameTest` 等价的单测（`scripts/test/` 下已有 node --test 基建）。

---

### T-02　`subscribe()` 把 `Set.add()` 的返回值当布尔用，导致重复 `open`，主机 1008 断连
- **严重度**：P0（协议不兼容）
- **类型**：【错误/BUG】
- **安卓证据**：`net/MuxStream.kt:98-120`
  ```kotlin
  if (generationOpen) {
      action = when {
          existing != null && existing != subscription -> 2   // cancel + open
          openedStreamIds.add(streamId) -> 1                  // Kotlin: add() 返回 Boolean，已存在时为 false
          else -> 0                                           // 已开：什么都不发
      }
  }
  ```
  Kotlin 的 `MutableSet.add` 在元素已存在时返回 **false** ⇒ 重复 subscribe 是**真幂等**，一条帧都不发。
- **小程序证据**：`src/transport/tunnel/mux.ts:62-70`
  ```ts
  const changed = existing !== undefined && (existing.endpoint !== endpoint || JSON.stringify(existing.args) !== JSON.stringify(args));
  if (changed) this.sendCancel(streamId);
  if (changed || this.openedStreamIds.add(streamId)) this.sendOpen(subscription);   // ← Set.add 返回 Set，恒为真值
  ```
  JS 的 `Set.prototype.add` 返回 **Set 自身**（truthy），所以第二个条件永远成立 ⇒ **每次 subscribe 都会发一条 `open`**。
- **主机侧交叉验证**：`@deepseek-ai/dsh-api-gateway/lib/types/stream-server.js:115-122`
  ```js
  if (this.streams.has(message.streamId)) {
      throw new Error(`api gateway: duplicate Remote stream id ${JSON.stringify(message.streamId)}`);
  }
  ```
  抛出后被 `run()` 的 `catch` 接住 → `close(1008, 'invalid Remote stream request')`（同上，stream-server.js:96-107）。
- **触发路径**：`src/state/appModel.ts:504-520` `open(sessionId)` → `coordinator.follow(...)` → `src/state/streamCoordinator.ts:318-330` → `mux.subscribe(followStreamId(sessionId), 'session/follow', args)`。
  `src/pages/chat/index.tsx:142-149` 是 mount/unmount 成对的，但 Taro/小程序 `navigateTo` 不会卸载上一页：
  从会话 A 的页面再打开同一 sessionId（会话引用跳转、重复入栈）就会出现**同一 streamId 的第二次 follow**；
  另外任何将来把 `follow()` 放进 `useDidShow` 的改动都会立刻踩中。
- **差异说明**：安卓是"已开就不发"，小程序是"每次都发"；主机把重复 open 视为协议错误并拆连接。
  即使不拆连接，也会造成 baseline 重放。
- **建议改法**：
  ```ts
  const alreadyOpen = this.openedStreamIds.has(streamId);
  if (changed && alreadyOpen) this.sendCancel(streamId);
  if (changed || !alreadyOpen) { this.openedStreamIds.add(streamId); this.sendOpen(subscription); }
  ```
  另注意：安卓的 `existing != subscription` 是 data class 全字段比较（含 endpoint 与 args），小程序的 `changed` 用 `JSON.stringify` 比 args，键序不同会误判"变了"——顺带一起收敛为稳定序列化。

---

### T-03　附件上传拼 `multipart/form-data`，主机只接受 `application/octet-stream`（415）
- **严重度**：P0（功能性错误：上传必失败）
- **类型**：【错误/BUG】
- **安卓证据**：`net/ApiClient.kt:139-160`
  ```kotlin
  val url = ".../api/session/uploadFileBinary".toHttpUrl().newBuilder()
      .addQueryParameter("sessionId", sessionId).addQueryParameter("name", name).build()
  val body: RequestBody = file.asRequestBody("application/octet-stream".toMediaType())  // 裸字节
  ```
- **小程序证据**：`src/transport/tunnel/transport.ts:153-183`
  ```ts
  const head = '--' + boundary + '\r\n' + 'Content-Disposition: form-data; name="file"; filename="…"\r\n' +
               'Content-Type: application/octet-stream\r\n\r\n';
  …
  headers: { 'content-type': 'multipart/form-data; boundary=' + boundary },
  ```
- **主机侧交叉验证**：`@deepseek-ai/dsh-client-file-upload/lib/index.js:13-18`
  ```js
  if (request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase() !== "application/octet-stream")
      return new Response("content type must be application/octet-stream", { status: 415 });
  ```
  紧接着 `url.searchParams.get("sessionId")`／`get("name")`（index.js:19-23），即**文件名只从 query 取**，multipart 的 `filename=` 根本不会被读。
  body 是 `requestBodyChunks(request.body)` 直接流式落盘（index.js:56-68），所以即便 415 被绕过，multipart 的分隔符也会被当成文件内容写进去。
- **差异说明**：小程序注释里写的"字段名与直连保持一致（`file`）"对应的是浏览器 `wx.uploadFile` 时代的假设，与主机当前这条 raw-byte 路由不符。
  当前实现走到 `transport.ts:179-181` 会抛 `ApiException{code:'http', message:'content type must be application/octet-stream'}`。
- **待确认**：若中间的 mobile bridge 会把 multipart 拆开再转发裸字节，则现象可能被掩盖。
  **确认方法**：①读 bridge 侧 `/api/session/uploadFileBinary` 的转发实现（本工作区内无 bridge 源码）；
  ②真机上传一次非图片附件，抓 `transport.ts:178` 的 `responseText` 是否为 `content type must be application/octet-stream`。
- **建议改法**：与安卓对齐——`headers: { 'content-type': 'application/octet-stream' }`，body 直接是 `bytes`，
  文件名继续靠 query 的 `name` 传（已经在传了，`transport.ts:163`），删掉 boundary/head/tail 三段。

---

### T-04　隧道内 HTTP 没有读/写超时，一次丢响应会永久堵死 RPC 通道
- **严重度**：P1
- **类型**：【缺失】
- **安卓证据**：`net/ApiClient.kt:45-52`
  ```kotlin
  .connectTimeout(15, TimeUnit.SECONDS)
  .readTimeout(60, TimeUnit.SECONDS)
  .writeTimeout(60, TimeUnit.SECONDS)
  .pingInterval(20, TimeUnit.SECONDS)
  ```
- **小程序证据**：
  - `src/transport/tunnel/transport.ts:24`　只有 `DIAL_TIMEOUT_MS = 15_000`（对应 connectTimeout）
  - `src/transport/tunnel/http.ts:38-46`　`request()` 把每次调用挂在 `this.tail` 上串行
  - `src/transport/tunnel/http.ts:74-90` / `queue.ts:36-59, 85-90`　`readLine()/readExactly()` 只在 `push`/`end` 时被唤醒，**没有定时器**
- **差异说明**：只要响应丢了（主机不回、bridge 吞包、WSS 半死但未触发 onClose），`readResponse` 会永远挂着；
  `this.tail` 又保证后续所有请求排在它后面 ⇒ 整条 RPC 通道静默死锁，UI 上表现为所有操作转圈不返回，且不会触发 `invalidate()` 重拨。
  安卓在 60s 后抛 `SocketTimeoutException` → `internalError` → 用户看到失败并可重试。
- **建议改法**：给 `TunnelHttpClient.perform` 套一个 `Promise.race` 超时（建议同样 60s），超时即 `throw` 并让 `TunnelTransport` 走 `invalidate()`；
  或在 `ByteQueue.readExactly/readLine` 上支持 deadline。

---

### T-05　一次性配对码没有"用掉即弃"，每次拨号都重发
- **严重度**：P1
- **类型**：【错误/BUG】
- **安卓证据**：`net/MobileTunnel.kt:30-42`
  ```kotlin
  private val token = AtomicReference(pairingToken)
  fun consumePairingToken(): ByteArray = token.getAndSet(null) ?: ByteArray(0)
  ```
  `net/MobileTunnel.kt:79`　`handshake.writeMessage1(target.consumePairingToken())`
  ——一个 `MobileTarget` 被 `NoiseSocketFactory` 的所有连接共享（`ApiClient.kt:50`），所以**整个进程里只有第一条连接带 token**。
  `state/ServerProfileStore.kt:138` 再在落盘层把 token 清掉。
- **小程序证据**：
  - `src/transport/tunnel/transport.ts:66`（字段）、`:242`（每次 `dial()` 都传）、`:207`（转交给 mux）
  - `src/transport/tunnel/mux.ts:38, 127`（每一代连接的 `runLoop` 都传）
  - `src/transport/tunnel/stream.ts:129`　`const payload = options.payload ?? options.pairingToken ?? new Uint8Array(0);`
  - `src/state/appModel.ts:192-199`　构造 `TunnelTransport` 时把 token 固化进 options，**内部再也不会置空**
  - 对照：`src/state/profileStore.ts:260` 的 `markConnected` 只清了**持久化**副本，内存里的 transport/mux 不受影响
- **差异说明**：一次配对里至少会有 2 条连接（RPC 一条 + mux 一条）加上每次 mux 重连，都会重放同一个一次性码。
  语义上"一次性"被破坏；若 bridge 对已消费的 token 做重放拒绝，第二条连接（通常正是 mux）就会握手失败，表现为"能发请求但没有实时流"。
- **待确认**：bridge 对重复 token 的处理（忽略 / 拒绝）。
  **确认方法**：读 bridge 的设备登记逻辑；或在已配对设备上强制重连 mux，观察是否只有首条连接成功。
- **建议改法**：在 `TunnelTransport` 内部持一个"一次性消费"的 token 盒子（`take(): Uint8Array | undefined`），
  `dial()` 与 `openMux()` 共用同一个盒子，取走即置 undefined，语义与 `AtomicReference.getAndSet(null)` 对齐。

---

### T-06　WebSocket 升级失败时泄漏已建立的隧道连接（吃掉平台配额）
- **严重度**：P1
- **类型**：【错误/BUG】
- **安卓证据**：`net/MuxStream.kt:239-246`
  ```kotlin
  val ws = client.newWebSocket(request, listener)
  closed.await()
  ws.cancel()            // 无论成功失败，连接都由 OkHttp 回收
  ```
- **小程序证据**：`src/transport/tunnel/mux.ts:114-141`
  ```ts
  const stream: TunnelStream = await dialTunnel({...});      // TCP/WSS 已建立
  socket = await TunnelWebSocket.connect({ stream, ... });    // 这里抛错（101 不符 / accept 不匹配 / 读失败）
  } catch (error) {
    this.scheduleReconnect(error);                            // ← stream 从未 close()
    return;
  }
  ```
- **差异说明**：`dialTunnel` 成功之后、`TunnelWebSocket.connect` 失败之前的那条隧道连接不会被关闭。
  文件头注释自己写了"平台每 5 分钟只给 20 条 TCPSocket"（`socket.ts:1-17`、`mux.ts:23-28`），
  而升级失败正是会反复发生的场景（bridge 尚未就绪 / 路由错）——每失败一次漏一条连接，很快撞配额，
  然后 `QUOTA_BACKOFF_MS` 把重连拖到 65s，RPC 那条也建不出来。
- **建议改法**：`catch` 里 `try { stream.close() } catch {}`；把 `stream` 提升到 try 外层的 `let`，或用 `try/finally` 保证失败路径关闭。
  同一处还有一个小隐患：`onClose: () => this.handleClosed(socket)` 捕获的是尚未赋值的 `let socket`，
  若 WS 在 `connect` 返回前就关闭会命中 TDZ（`ReferenceError`）。

---

### T-07　探活发送失败时不废掉这一代连接
- **严重度**：P1
- **类型**：【缺失】
- **安卓证据**：`net/MuxStream.kt:149-156`
  ```kotlin
  if (!ws.send(probeFrame())) {
      Log.w(TAG, "wake probe failed; failing the generation")
      ws.cancel()      // 主动让 runLoop 进重连
  }
  ```
- **小程序证据**：`src/transport/tunnel/mux.ts:82-84`（无返回值检查）、
  `src/transport/tunnel/websocket.ts:85-88` `sendText` 无返回值、
  `src/transport/tunnel/wsSocket.ts:120-128` `write` 失败只走 `fail` 回调（且 `closed` 时静默 return）
- **差异说明**：探活的另一半价值是"发不出去就说明这代连接死了，立刻重连"。小程序端探活失败是静默的，
  连接会一直停在"看起来是 connected"的状态直到底层超时（可能很久），期间所有实时帧都收不到，但 UI 不显示 reconnecting。
- **建议改法**：`sendText` 返回 boolean（或在 `wsSocket.write` 的 `fail` 里回调上层），`probeNow` 失败时调用 `this.socket?.close()` 触发 `handleClosed` → `scheduleReconnect`。

---

### T-08　mux 连接失败没有任何日志，无法定位 DNS / 握手 / 升级 三类失败
- **严重度**：P1（可诊断性；线上排障直接失明）
- **类型**：【缺失】
- **安卓证据**：`net/MuxStream.kt:224-233`
  ```kotlin
  Log.w(TAG, "mux generation failed: ${t.javaClass.simpleName}: ${t.message}" + (response?.let { " (http ${it.code})" } ?: ""))
  ```
  （注释专门说明"以前只打 message，DNS 失败和握手被掐看起来一模一样"）
  另有 `MuxStream.kt:192` 的 `mux generation opened (http …)`。
- **小程序证据**：`src/transport/tunnel/mux.ts:138-141, 190-205`——`error` 只被用来做 `/quota|created too much/i` 的正则匹配，然后丢弃；全程无日志。
  反倒是**正常路径**上留了两处调试输出（见 T-16）。
- **差异说明**：现场只会看到"一直在重连"，无法区分 WSS 域名未配置、Noise 握手失败（AEAD）、101 升级被拒、配额耗尽。
- **建议改法**：在 `scheduleReconnect` 里打一条含错误类名/消息与本代持续时长的日志，和安卓保持同样的信息量。

---

### T-09　`close()` 不等价于安卓的 `invalidate()`：关闭后仍会自动重连到旧目标
- **严重度**：P2
- **类型**：【缺失】
- **安卓证据**：`net/ApiClient.kt:54-59`
  ```kotlin
  @Volatile private var invalidated = false
  fun invalidate() { invalidated = true; http.dispatcher.cancelAll() }
  ```
  `ApiClient.kt:69`、`:117`：`if (invalidated) throw internalError("client has been invalidated")`
- **小程序证据**：`src/transport/tunnel/transport.ts:215-232`
  `close()` 只是 `this.channel = undefined` + 关流；`client()`（`:222-225`）在 `channel === undefined` 时**又会重新 `dial()`**。
- **差异说明**：解绑/切换配对后，任何仍持有旧 `TunnelTransport` 引用的调用都会**重新拨号连回旧 Mac**，并占用 TCPSocket 配额；
  在途请求也不会被取消（安卓 `cancelAll`）。
- **建议改法**：加 `private invalidated = false`，`close()` 时置位，`call/getJson/uploadFile/openMux` 入口直接抛 `internalError('client has been invalidated')`。

---

### T-10　只把 `status === 200` 当成功，安卓接受整个 2xx
- **严重度**：P2
- **类型**：【错误/BUG（边界）】
- **安卓证据**：`net/ApiClient.kt:87`、`:127`　`if (!response.isSuccessful)`（OkHttp 的 200..299）
- **小程序证据**：`src/transport/tunnel/transport.ts:116`、`:139`、`:179`　`if (response.status !== 200)`
- **差异说明**：主机当前对这些路由都回 200，所以暂不暴露；但 `204/201` 之类会被当成错误抛出。属于宽松度回退。
- **建议改法**：改成 `status < 200 || status >= 300`；`getJson` 里保留 404 的特判在前。

---

### T-11　传输/HTTP 失败的 `RpcError.code` 与安卓不同（`http`/`transport` vs `internal`）
- **严重度**：P2
- **类型**：【错误/BUG（契约文案）】
- **安卓证据**：`net/ApiClient.kt:88-90`（`RpcError("internal", payload…)`）、`:97`（`internalError(...)`）、`net/Rpc.kt:24`
- **小程序证据**：`src/transport/tunnel/transport.ts:117`（`code:'http'`）、`:250-253`（`code:'transport'`）
- **差异说明**：目前的调用方只按业务码分支（`appModel.ts:795-797` 取 `code` 末段比对 `steer-unavailable` 等），
  展示层用的是 `detail || code`（`appModel.ts:75`），所以用户可见文案基本一致；但契约上与安卓不一致，将来任何按 `internal` 分支的逻辑会失配。
- **建议改法**：统一用 `internal`，把 `http`/`transport` 降级为 message 前缀。

---

### T-12　`rpcId` 缺失时不校验（安卓强制相等）
- **严重度**：P2
- **类型**：【多余的宽松】
- **安卓证据**：`net/ApiClient.kt:101`　`if (envelope.rpcId != rpcId) throw internalError("rpcId mismatch")`（`ServerResponse.rpcId` 默认 `""`，缺字段=不匹配=抛）
- **小程序证据**：`src/transport/envelope.ts:43-44`　`if (rpcId !== undefined && rpcId !== expectedRpcId) throw …`
- **差异说明**：小程序容忍"没有 rpcId 的响应"。隧道内 HTTP 是严格串行的，串号概率低，但这条宽松度是单向放开、与安卓不一致。
- **建议改法**：与安卓一致地要求 `rpcId` 存在且相等，或在注释里写明为什么要更宽松。

---

### T-13　mux 的 `error` 帧丢掉了 `details`
- **严重度**：P2
- **类型**：【缺失】
- **安卓证据**：`net/MuxStream.kt:211-219`　`frame["error"]?.decodeOrNull<RpcError>()`，`RpcError` 含 `details: JsonElement?`（`net/Rpc.kt:11-16`）
- **小程序证据**：`src/transport/tunnel/mux.ts:162-173`　只取 `code`/`message`，没有 `details`（而 `src/transport/types.ts:6` 的 `RpcError` 是有 `details` 字段的）
- **差异说明**：主机的 server 帧契约里 `error` 必带 `details`（`stream-protocol.js:186-196` 要求键恰好 `{code,message,details}`），
  丢掉后任何依赖 details 的错误分支（如 `session/not-found` 带 sessionId）都拿不到上下文。
- **建议改法**：`details: jget(error,'details')` 一并带上，与 `envelope.ts:51` 的 `call()` 路径保持一致（那边是带的）。

---

### T-14　`write(空数组)` 会多发一个空 Noise 帧
- **严重度**：P2
- **类型**：【多余】
- **安卓证据**：`net/MobileTunnel.kt:206-218`　`while (written < length)`，`length == 0` 时**一帧都不发**，只 `flush()`
- **小程序证据**：`src/transport/tunnel/stream.ts:68-75`
  ```ts
  if (bytes.length === 0) writeFrame(this.stream, this.transport.encrypt(new Uint8Array(0)));
  ```
- **差异说明**：多出一个 16 字节 tag 的空帧，并多消耗一个 nonce。对端解出 0 字节明文后 `ByteQueue.push` 会忽略（`queue.ts:16-21`），
  因此不致错，但与安卓的线上字节流不一致，也和"nonce 计数对齐"的直觉相违。
- **建议改法**：删掉这一行（`TunnelStream.write` 的空写应当是 no-op）。

---

### T-15　客户端不主动发 WebSocket ping（安卓 OkHttp 20s 一次）
- **严重度**：P2
- **类型**：【缺失】
- **安卓证据**：`net/ApiClient.kt:49`　`.pingInterval(20, TimeUnit.SECONDS)`（OkHttp 在无 pong 时会 fail 掉连接）
- **小程序证据**：`src/transport/tunnel/websocket.ts:132-136`　只被动回 pong，全文件无主动 ping
- **主机侧交叉验证**：`@deepseek-ai/dsh-api-gateway/lib/types/stream-server.js:58-78`　主机自己有心跳并在 `MAX_MISSED_HEARTBEATS` 后 `terminate()`——
  因此**服务端方向**的探活是有的，小程序也会回 pong，所以不是致命缺失。
- **差异说明**：缺的是**客户端侧的半死链检测**；在主机心跳超时之前（取决于 `heartbeatIntervalMs × MAX_MISSED_HEARTBEATS`），小程序会一直以为自己是 connected。
- **建议改法**：可选。若要对齐，加一个 20s 的 `setInterval` 发 `OPCODE_PING`，超过 N 次没有 pong 就 `close()`。

---

### T-16　生产代码里残留逐请求的 `console.log` 调试输出
- **严重度**：P2
- **类型**：【多余】
- **安卓证据**：`net/MuxStream.kt:192, 227-231` 用 `Log.i/Log.w` + TAG，且只在连接生命周期事件上打；`ApiClient/MobileTunnel/Noise` 无逐请求日志。
- **小程序证据**：
  - `src/transport/tunnel/http.ts:86`　`console.log('hdbg status=' + …)`（每个响应头一条）
  - `src/transport/tunnel/http.ts:88`　`console.log('hdbg body=' + body.length)`（每个响应体一条）
  - `src/transport/tunnel/stream.ts:91`　`console.log('sdbg raw=' + …)`
  - 配套的 `TunnelStream.rawBytes`（`stream.ts:49-50, 87`）也只服务于这条调试输出
- **差异说明**：属于开发期遗留（前缀 `hdbg`/`sdbg`）。会话内容不落日志，但请求节奏与体积会暴露在控制台，且刷屏影响排障。
- **建议改法**：删掉或收敛到一个可开关的 debug 标志后面。

---

### T-17　`commands/execute` 缺 `commandId` 时被当成"主机不认识这条命令"
- **严重度**：P2
- **类型**：【错误/BUG（边界）】
- **安卓证据**：`net/RpcMethods.kt:324-335`
  ```kotlin
  if (value is JsonNull) return null            // 只有 null 才是"没认出"
  return value.decodeOrNull<CommandExecutionValue>()
  ```
  `model/Models.kt:342-345`　`commandId: String = ""`（缺字段也能解出对象）
- **小程序证据**：`src/transport/rpcMethods.ts:437-457`
  ```ts
  if (value === null) return undefined;
  const commandId = str(jget(value, 'commandId'));
  if (commandId === undefined) return undefined;   // ← 多出来的判定
  ```
- **差异说明**：若主机返回了对象但省略了 `commandId`（例如只带 `result`），安卓会把 `result`（含错误文案）交给 UI，小程序则显示"未知命令"。
- **建议改法**：`commandId: str(...) ?? ''`，只在 `value === null` 时返回 undefined。

---

### T-18　`workspace/insertBefore` 返回空列表时抛错（安卓返回空列表）
- **严重度**：P2
- **类型**：【错误/BUG（边界）】
- **安卓证据**：`net/RpcMethods.kt:268-278` + `model/Models.kt:299`
  `WorkspaceOrderValue(val workspaceIds: List<WorkspaceId> = emptyList())` ⇒ `decodeOrNull` 对 `{}` 也成功，只有解码彻底失败才抛。
- **小程序证据**：`src/transport/rpcMethods.ts:359-365`　`if (workspaceIds.length === 0) throw internalError('workspace/insertBefore returned no value');`
- **差异说明**：唯一工作区被拖动时主机若回空数组，小程序会弹错误 toast，安卓静默。
- **建议改法**：只在 `value` 不是对象时抛，空列表照常返回。

---

### T-19　`session/attachment` 的 `bytes/width/height` 被硬编码成 0
- **严重度**：P2
- **类型**：【缺失】
- **安卓证据**：`net/RpcMethods.kt:219-221` → `model/Models.kt:209-218` `ImageAttachmentRef(bytes, width, height, originalDimensions)` 全部从 wire 解出
- **小程序证据**：`src/transport/rpcMethods.ts:283-295`
  ```ts
  bytes: 0, width: 0, height: 0,     // 恒为 0
  ```
  另外 `originalDimensions` 整个字段缺失
- **差异说明**：当前 UI 侧未使用这三个值（`src/state/composer.ts:133-135` 用的是本地选图的 bytes），所以暂不可见；
  但任何按原始尺寸预排版/校验大小的逻辑都会拿到 0。
- **建议改法**：照 `workspaceFileReadBytes`（`rpcMethods.ts:390-396`）的写法解出真实数字。

---

### T-20　X25519 不校验全零共享密钥（BouncyCastle 会抛）
- **严重度**：P2（安全健壮性）
- **类型**：【缺失】
- **安卓证据**：`net/Noise.kt:39-45`　`X25519Agreement.calculateAgreement`——BC 对小阶点/全零输出会抛 `IllegalStateException`，握手随即失败
- **小程序证据**：`src/transport/tunnel/crypto/x25519.ts:58-111`　纯计算，无 all-zero 检查；`noise.ts:117,119,130,131` 直接把结果喂给 `mixKey`
- **差异说明**：恶意 bridge 送小阶点时，安卓会拒绝握手，小程序会用一把可预测的链密钥继续。实际攻击面有限（bridgeKey 来自扫码），但这是一处真实的强度差。
- **建议改法**：`x25519()` 结果若为全零则抛错（RFC 7748 §6.1 的推荐做法）。

---

### T-21　`bool()` 比安卓严格：字符串 `"true"` 读不出来
- **严重度**：P2
- **类型**：【错误/BUG（宽松度回退）】
- **安卓证据**：`net/Json.kt:46-47`　`(this as? JsonPrimitive)?.booleanOrNull`——kotlinx 的 `booleanOrNull` 不看 `isString`，`"true"` 也能读成 `true`
- **小程序证据**：`src/model/json.ts:56-58`　`typeof value === 'boolean' ? value : undefined`
- **差异说明**：Json.kt 的设计意图写在文件头"宽松、忽略未知字段"，`text`/`int`/`dbl` 三个取值器小程序都做了字符串兜底（`json.ts:32-54`），
  唯独 `bool` 没有，形成不一致。若主机某个字段发字符串布尔，小程序会取默认值。
- **建议改法**：`if (value === 'true') return true; if (value === 'false') return false;`
- **顺带**：`int()`（`json.ts:38-45`）不做 32 位截断，安卓是 `longOrNull?.toInt()`（会回绕）。安卓那侧才是"错"的，小程序保持现状即可，记录以免后续被当差异回改。

---

### T-22　`ByteQueue` 只支持一个等待者，并发读会静默挂死
- **严重度**：P2（潜在）
- **类型**：【错误/BUG（潜在）】
- **安卓证据**：`net/MobileTunnel.kt:162-196`　`NoiseInputStream` 是阻塞流，多读者由 socket 语义自然串行
- **小程序证据**：`src/transport/tunnel/queue.ts:72-90`　`private waiter: (() => void) | undefined`，第二个等待者会覆盖第一个，被覆盖的 Promise 永不 resolve
- **差异说明**：当前调用方是安全的（`TunnelHttpClient` 用 `tail` 串行化，`TunnelWebSocket.pump` 是独占读者，`TunnelStream.pump` 独占 raw 队列），
  所以现在**不会**触发；但这是一个"改一行就炸"的隐式约束，且没有断言保护。
- **建议改法**：改成 `waiters: Array<() => void>`，或在已有 waiter 时直接抛 `Error('concurrent read')`。

---

### T-23　无 Content-Length / 非 chunked 响应"读到关闭为止"，会把截断当成正常结束
- **严重度**：P2
- **类型**：【错误/BUG（边界）】
- **安卓证据**：`NoiseFrameEofTest.kt:15-24, 62-90` 的立论——"帧读到一半的截断、读超时、连接重置都是 IOException，不能当成正常结束"；
  `net/MobileTunnel.kt:145-159` 的 `readFrameAtBoundary` 就是为此写的；OkHttp 侧对无长度响应也会区分 `onFailure`/`onClosed`。
- **小程序证据**：`src/transport/tunnel/http.ts:104-113`
  ```ts
  for (;;) { try { chunks.push(await this.stream.readExactly(1)); } catch { break; } }
  return concat(...chunks);            // 任何失败都被当成"body 到此为止"
  ```
- **差异说明**：隧道层本身是**更保守**的（`queue.ts:39` 对任何 `end` 都抛错，见"已核对等价"第 6 条），
  唯独这条兜底路径把 truncation/超时/重置全部吞成"读完了"，与 NoiseFrameEofTest 要钉的语义相反。
  当前主机对 RPC 都带 Content-Length，所以走不到；但这正是那条测试警告的形状。
  附带性能问题：一字节一个 Promise。
- **建议改法**：区分"`ByteQueue` 干净结束（`end()` 无 reason）"与"带 reason 的失败"，后者原样抛；并改成按可用块读取。

---

## 已核对确认等价的清单（无需再审）

| # | 项目 | 安卓 | 小程序 | 结论 |
| --- | --- | --- | --- | --- |
| 1 | 前导头 magic/version/长度 | MobileTunnel.kt:22-28, 69-76（`DSHC`+ver1+32B，共 37） | stream.ts:14-18, 33-43 | 等价 |
| 2 | Noise 协议名与 h 初始化 | Noise.kt:26, 134-141（名≤32 补零，mixHash(prologue) → mixHash(rs)） | noise.ts:18, 102-110 | 等价 |
| 3 | message-1 token 顺序 e,es,s,ss,payload | Noise.kt:143-150 | noise.ts:112-121 | 等价 |
| 4 | message-2 token 顺序 e,ee,se,payload | Noise.kt:152-161 | noise.ts:123-134 | 等价 |
| 5 | split 方向（send=first, receive=second）、HKDF 两输出 | Noise.kt:64-70, 163-166 | sha.ts:196-202, noise.ts:140-145 | 等价 |
| 6 | nonce：12 字节，高 4 零，低 8 小端递增，每次调用自增 | Noise.kt:98-106 | noise.ts:49-59 | 等价（Long vs BigInt，字节相同） |
| 7 | 传输帧 `[u16 BE len][密文]`、明文上限 65519、按上限切分 | MobileTunnel.kt:27, 124-129, 206-218 | stream.ts:14, 21-23, 68-75 | 等价（空写差异见 T-14） |
| 8 | AEAD：ChaCha20-Poly1305，tag 16，AD=空（传输）/h（握手） | Noise.kt:78-96, 110-114, 178-188 | chacha.ts:120-173, noise.ts:39-47, 63-73, 162-172 | 等价（实现独立，RFC 8439 口径一致） |
| 9 | 截断/认证失败必须向上抛（不得伪装成 EOF） | MobileTunnel.kt:145-159 + NoiseFrameEofTest | queue.ts:36-59 + stream.ts:83-96（任何 end 都抛） | 等价（小程序更保守；例外见 T-23） |
| 10 | mux 路径 `/api/remote.mux` | MuxStream.kt:51, 186 | mux.ts:133（主机 stream-protocol.js:3 佐证） | 等价 |
| 11 | 上行 open 帧形状 `{type,streamId,endpoint,payload:{args}}` | MuxStream.kt:158-166 | mux.ts:95-102 | 等价（键恰好四个，符合主机 exactKeys） |
| 12 | 上行 cancel 帧形状 `{type,streamId}` | MuxStream.kt:168-174 | mux.ts:104-106 | 等价 |
| 13 | 下行 item/error/end 分发与缺 streamId 兜空串 | MuxStream.kt:204-222 | mux.ts:153-180 | 等价（details 见 T-13） |
| 14 | 每代连接重开全部订阅、先 open 再 emit Opened 再置 connected | MuxStream.kt:191-202 | mux.ts:146-150 | 等价（顺序一致） |
| 15 | 退避：base 500ms、cap 10s、稳定 30s 归零、抖动 [cap/2, cap] | MuxStream.kt:52-54, 248-254 | mux.ts:20-22, 190-205 | 等价（配额 65s 分支是小程序独有，见"多余但合理"） |
| 16 | 连接态只有 connected/reconnecting 且去重 | MuxStream.kt:21-22, 176-181 | types.ts:30, mux.ts:108-112 | 等价 |
| 17 | RPC 信封 `{type:'client-request',rpcId,method,payload:{args}}` | ApiClient.kt:71-76 | envelope.ts:26-32 | 等价（rpcId 生成方式不同但均全局唯一） |
| 18 | 响应解包 `result.ok/value/error`，失败抛 ApiException | ApiClient.kt:99-105, Rpc.kt:11-31 | envelope.ts:35-54, types.ts:6-23 | 等价 |
| 19 | URL 拼装 `POST /api/<method>`、Host 用占位名 `mobile.dsh` | ApiClient.kt:41-43, 61-64 | transport.ts:104, mux.ts:209, http.ts:56-58 | 等价 |
| 20 | `getJson`：404 → 无结果、其余非 2xx 抛、query 逐项编码 | ApiClient.kt:115-137 | transport.ts:123-144 | 等价（2xx 口径见 T-10） |
| 21 | `$events/result` 三种 outcome 形状（result/next/rejected） | ApiClient.kt:162-191 | transport.ts:185-198 | 等价（含"失败吞成 false"） |
| 22 | 全部 RPC 方法名与参数包法（含 `request` 包裹与否） | RpcMethods.kt 全文 | rpcMethods.ts 全文 | 等价：两侧方法集合**完全相同**（37 条，逐条比对无缺无多） |
| 23 | `session/list` 的 `_request.projections:['title','agentPreset']` | RpcMethods.kt:98-109 | rpcMethods.ts:72-83 | 等价 |
| 24 | Protocol016Test 覆盖的解码口径（inbox placement、0.1.5 queue 兼容、权限目录合并与 custom 不可选、changes summary/diff 校验、archivedSessionIds） | Protocol016Test.kt:21-137 | frames.ts:31-101、model/types.ts:185、turnChanges.ts:38-112、rpcMethods.ts:299-313 | 等价（逐条断言核对通过） |

### 多余但合理（不建议改）
- `mux.ts:23-28, 197-200` 撞 TCPSocket 配额时退到 65s；`transport.ts:26-58, 95` 只读方法重试 5 次。
  安卓没有这两条，但它们针对的是小程序平台特有限制（每 5 分钟 20 条连接、开发者工具会损坏字节流），已在注释里说明依据。
- `transport.ts:83` 的 `baseUrl = 'http://host:port'` 与安卓的 `http://mobile.dsh` 不同：小程序这边只用于设置页展示真实目标，不参与请求拼装。

### 测试覆盖缺口（建议补）
- `MuxProbeFrameTest` 无对应用例 ⇒ T-01 无回归保护；建议在 `scripts/test/` 加一条"探活帧必须被主机的 cancel/open 校验接受"。
- `NoiseFrameEofTest` 无对应用例 ⇒ T-23 与 `ByteQueue` 的 EOF 语义无保护。
- `Protocol016Test` 的解码口径虽已实现（表 24），但小程序侧无单测；建议照搬其断言。
- 主机对"重复 streamId"的 1008 行为（T-02）也值得加一条纯函数级的 `subscribe` 幂等性测试。

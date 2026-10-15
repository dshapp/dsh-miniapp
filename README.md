# dsh-miniapp

DeepSeek Harness 的**微信小程序客户端**。业务逻辑与数据契约完整对齐同仓库的 Android 客户端
（`../dsh-androidapp`，Jetpack Compose），脚手架、目录结构、UI 风格与代码约定对齐
`~/Code/teacher/miniapp`。

技术栈：Taro 4 + React 18 + TypeScript + Sass CSS Modules + NutUI（`@nutui/nutui-react-taro`）。
图标统一用 Lucide（[lucide-icons/lucide](https://github.com/lucide-icons/lucide)），见下文「图标」。

## 快速开始

```bash
npm install
npm run dev:weapp      # 开发（dist/ 下产出，用微信开发者工具打开项目根目录）
npm run build:weapp    # 生产构建
npm run lint           # 类型检查（tsc --noEmit --skipLibCheck）
npm test               # 单元测试（node --test；口径移植自安卓单测，零新增依赖）
```

微信开发者工具里导入本目录（`project.config.json` 已把 `miniprogramRoot` 指到 `dist/`）。
AppID 已写死在 `.env` 的 `TARO_APP_ID`。

## 目录结构

```
src/
  app.tsx / app.config.ts / app.scss   小程序入口
  route.ts                             页面路由表（MAIN_ROUTE / ROUTES）
  const.ts                             颜色与尺寸常量（SCSS 侧见 styles/vars.scss）
  i18n/strings.ts                      全量文案（中英双语表）
  model/                               纯数据层：wire 类型、帧解码、渲染模型
    types.ts                           主机协议类型 + 模型目录状态机
    frames.ts                          各类流帧的解码器
    chatNode.ts                        转写节点判别联合 + 编解码
    toolRow.ts / questionFlow.ts       工具行分类、审批/提问/计划评审状态机
    format.ts                          时间、token、会话标题等展示格式化
  transport/                           传输层（可替换）
    types.ts                           RpcTransport 接口（本地直连 / Mock / 中继）
    envelope.ts                        RPC 信封编解码
    rpcMethods.ts                      全部主机 RPC 方法
    local.ts                           本地直连 DSH Web Server 的实现
    mock.ts                            全功能 Mock（离线可跑通全流程）
  state/                               编排层与可观察状态
    appModel.ts                        进程级 AppModel（唯一传输 + 唯一流协调器）
    streamCoordinator.ts               多路复用 WebSocket 的订阅与重同步
    sessionStore.ts                    单个会话的事件窗口、投影与节点物化
    stores.ts / cache.ts               会话清单、工作区、离线缓存
    settings.ts / profileStore.ts      设置与已配对电脑
    composer.ts                        输入区纯逻辑（触发器、草稿、附件校验）
  ui/                                  可复用组件
    markdown.tsx / messageRow.tsx      转写渲染
    cards.tsx / sheets.tsx             卡片与底部弹层
    composerBar.tsx                    输入区
    findHighlight.tsx / emptyState.tsx / connectionBanner.tsx
    icon.tsx / lucideIcons.ts          Lucide 图标组件与图标表（生成物）
  styles/lucide.scss                   图标字体子集（生成物，base64 woff2）
  pages/                               index(会话列表) / chat(会话) / new(新建)
                                       settings(设置) / pairing(配对) / archived(已归档)
  framework/navbar.ts                  自定义标题栏的度量（读胶囊与状态栏，算一次并缓存）
  model/navBarMetrics.ts               标题栏高度公式与兜底（纯函数，有单测）
  ui/navBar.tsx                        自定义标题栏组件（对齐 Android TopAppBar 三槽位）
scripts/build-icons.mjs                从 lucide 拉取图标、生成图标表与字体子集
```

## 与安卓端的对齐

安卓端（`../dsh-androidapp`）是 UI 交互与文案的**权威口径**。逐条差异（含双侧 file:line
依据、当前状态）维护在：

- [docs/DIFF-ANDROID.md](docs/DIFF-ANDROID.md)：第一轮，A 会话列表 / B 聊天转写 / C 输入区与弹层 /
  D 新建、设置、配对、引导，四区总表与进度复选框；
- `docs/audit/*.md`：第一轮的四份原始审计报告（每条都有安卓与小程序两侧的代码位置）；
- [docs/DIFF-ANDROID-R2.md](docs/DIFF-ANDROID-R2.md)：第二轮，覆盖第一轮没碰过的传输 / 模型 /
  状态 / Markdown / 主题层，并对第一轮的 160 条 `[x]` 逐条验收；本轮在非 UI 层找出 9 条 P0；
- `docs/audit2/*.md`：第二轮的五份审计报告与两份验收报告；
- [docs/CUSTOM-NAVBAR.md](docs/CUSTOM-NAVBAR.md)：自定义标题栏那一轮。微信自带的
  `navigationBar` 只能显示一个编译期写死的标题，装不下安卓 `TopAppBar` 上的搜索框与动作按钮，
  以前只能在它下面再画一条自绘顶栏（两条栏叠着）。全局改成 `navigationStyle: "custom"` 之后，
  七处顶栏（六个页面 + 引导页 + 全屏详情弹层）全部由 `ui/navBar.tsx` 画，逐条对齐安卓；
- [docs/DIFF-ANDROID-R3.md](docs/DIFF-ANDROID-R3.md)：**全量 UI / 交互布局**复查那一轮。
  不再采信旧总表的"已改完"，按六个区重新回两边**当前源码**逐条取证（报告在 `docs/audit3/`），
  然后分九批修完：主题与度量底座、会话列表/归档、转写与卡片、输入区、弹层、外壳页、图标子集、
  锚定菜单与编辑弹层、逐页实拍复核。语义色改回安卓硬编码值，补 M3 表面/描边/容器色，
  统一字号/行高/内边距/行高常量，轮次导航改顶栏下拉卡片，文件预览改全屏详情层。
  第 9 批在开发者工具实拍时查出一个架构级缺陷并修复：**Taro 小程序端不渲染 App 组件的 JSX**，
  导致深色主题 class、全局连接横幅、卡片详情弹层从未生效——已下沉到新增的 `ui/pageShell.tsx`，
  由每个页面自己包一层；同时补上 `darkmode: true`（否则"跟随系统"恒为浅色）。
- [docs/DSH-0.2.0-ADAPTATION.md](docs/DSH-0.2.0-ADAPTATION.md)：跟进 dsh 0.2.0-rc.2 的 web 新行为
  （照安卓 `017cbf1` / Mac `c710a29`）：搜索只认会话自己的标题、模型搜索、限时提问
  （`userQuestions/attachWait` / `userQuestions/answer`）、question-reply 节点、时长单元制、「自动化任务」触发卡。
- [docs/DSH-0.2.1-ADAPTATION.md](docs/DSH-0.2.1-ADAPTATION.md)：跟进 dsh 0.2.1-alpha.2（照安卓 `2b296b4` / Mac `f670941`）：
  external 子智能体、显式新建不复用空白会话、`workingDirectory` 投影、目标 activation、PTC `error.reason` 等。

**改动前请先跑 `npm test`**：`scripts/test/` 下的用例逐条移植自安卓的单元测试，
是两端行为口径的回归闸（读数格式化、文件链接、图片协议、0.1.6 / 0.1.7 协议解码、未读红点、
分片搬运等）。

对齐时遵循的几条约定：

- 主题色、圆角等一律走 `--dsh-*` CSS 自定义属性（`styles/vars.scss` + `styles/theme.scss`），
  深色主题由 `app.tsx` 最外层的 `dsh-theme-dark` 类驱动；
- 卡片详情（思考卡/工具卡/触发通知/后台任务/改动比较）统一走全屏详情弹层
  （`ui/cardDetail.tsx`，挂在 App 顶层），对齐安卓的 `CardDetailDialog`；
- 平台确实做不到的（小程序无法把外链交给系统浏览器、没有 Android Keystore、没有
  `LazyColumn` 的 layoutInfo）在总表里标为「平台限制」并写清原因，不做无意义改写。

## 图标

全端图标只用 Lucide（<https://github.com/lucide-icons/lucide>，ISC License），不再用 Emoji 或自造字符：

- `ui/icon.tsx` 的 `<Icon name="check" spin />` 是唯一的图标出口；`name` 的类型
  `LucideIconName` 由 `ui/lucideIcons.ts` 推导，写错名字编译期就报错。
- 小程序画不了内联 SVG，所以走图标字体：`scripts/build-icons.mjs` 从 lucide 官方
  `lucide-static` 发行包取 `codepoints.json` 与 `lucide.ttf`，用 `fontTools` 裁出只含
  项目用到的五十来个字形的 woff2 子集（约 10KB），base64 内联进 `styles/lucide.scss`。
- 图标天然跟着 `font-size` 与 `color` 走，所以各处的排版/配色沿用原有 CSS，只把字符换成
  `lucideIcon(name)`；颜色不再写进组件。
- 新增图标：把名字加进 `scripts/build-icons.mjs` 的 `ICONS`，跑一次
  `node scripts/build-icons.mjs`（需要 `python3 -m pip install fonttools brotli` 与一次联网），
  `ui/lucideIcons.ts` 与 `styles/lucide.scss` 会一起更新。
- 例外：`wx.showActionSheet` 的原生菜单项只能给字符串，几处 `'✓ '` 前缀是系统菜单的
  选中标记，不是页面图标，保持原样。

## 与 Android 端的一致性

协议、状态机、状态迁移、文案语义都逐条对齐 Android 客户端，包括这些容易被忽略的细节：

- 会话行**没有左滑动作**：Fork / 置顶 / 重命名 / 归档都走长按菜单。
- 归档列表可就地恢复（`workspace/unarchiveSession`，Android 0.1.6 的归档页同样带恢复）。
- `/command` 行首命令走主机命令通道（`commands/execute`），不是普通提示词。
- 删除落在 `@`/`/`/`$` 触发器 token 中间时整块删。
- 空白会话（`blank`）与 `origin=subagent` 的会话不进列表。

## 小程序端的有意取舍

| Android | 小程序 |
|---|---|
| 前台服务 + 系统通知 | 无（应用内角标 + 回前台重连并重新拉取） |
| Android Keystore 保护私钥 | 普通 `wx` 存储 |
| 拖拽调整分组顺序 | 长按分组后选择落点（同样的 `workspace/insertBefore` 语义） |
| Material 下拉菜单 | `wx.showActionSheet` |
| TopAppBar 的动作按钮贴屏幕右边界 | 右上角永远有微信的胶囊，动作区只能收到胶囊左侧（见 [docs/CUSTOM-NAVBAR.md](docs/CUSTOM-NAVBAR.md)） |
| 重命名对话框 | `wx.showModal({ editable: true })` |
| 弹出对话框 | 就地展开卡片 / 底部弹层 |
| Material 深色配色 | 设置里的主题偏好已持久化，但配色表尚未接到深色一套（当前始终浅色） |

## 传输层：直连 DSH Web Server

小程序现在只说 HTTP，因此与主机之间走的是 `dsh web` 的 HTTP/WS 面，不经配对与 Noise：

- 一元调用：`POST /api/<method>`，信封 `{type:"client-request", rpcId, method, payload:{args}}`，
  应答 `{type:"server-response", rpcId, result:{ok, value|error}}`；
- 流：`WS /api/remote.mux`，每条流都以一条完整基线开场（`$events`、`workspace/follow`、
  `session/control`、每会话 `session/follow`）。

### 认证：把浏览器的那张票搬进来

`dsh web` 的 `/api` 受两道门保护：Host/Origin 围栏（403）与绑定权属的 `dsh-auth-*`
Cookie（401）。Cookie 名是 `dsh-auth-` + base64url(sha256(authority))，值是 HMAC 签名，
小程序**无法自己签发**，所以要把现成的凭据粘进设置页的「Host / Cookie」一行，三种输入都认：

1. 带 `?token=` 的启动 URL（`dsh web` 启动时打印的那条）：`resolveAuth()` 打一次
   `GET /?token=…`，从 `Set-Cookie` 里抠出会话 Cookie 存进 `dsh.authCookie`；
2. 浏览器里那条 `dsh-auth-…=…` Cookie（从 Application → Cookies 复制）：原样当请求头发；
3. 裸 token：同 1 的换取路径，地址用设置里的服务地址。

解析在 `transport/directAuth.ts`（cookie / launch / none 三态归一），换取失败不阻断连接，
请求会以 401 落回连接失败并提示改粘 Cookie。`baseUrl` 的 authority 必须与 Cookie 绑定的
authority 一致（Host/Origin 围栏会回 403）。
没有配对资料时 `AppModel.connectCurrent()` 直接走 `connectDirect()`，不会再停在 idle——
这是「打开就报连不上」的直接原因。

### 直连目前的边界

1. `dsh web` 默认只监听 `127.0.0.1`，真机连不到本机地址——需要主机侧监听局域网地址，
   或走下面的 TCP 隧道；
2. 没有 TLS/WSS 监听端口，正式环境要求 https 校验。

## 传输层：TCP 隧道（已实现）

与 Android 端同一条路：`wx.createTCPSocket` 连 `dsh-proxy`，握手 `Noise_IK_25519_ChaChaPoly_SHA256`，
隧道里跑明文 HTTP/1.1 与 WebSocket。实现全在 `src/transport/tunnel/`，页面与状态层完全不用知道
底下是隧道还是直连——两者都只是 `RpcTransport` 的一个实现。

| 文件 | 职责 |
| --- | --- |
| `crypto/` | 纯 TS 的 SHA-256/SHA-1/HMAC、ChaCha20-Poly1305、X25519（运行时没有 Web Crypto） |
| `noise.ts` | Noise_IK 发起方握手 + 传输态 CipherState |
| `socket.ts` `queue.ts` | `wx.createTCPSocket` 之上的字节流与缓冲 |
| `stream.ts` | 37 字节前导、握手、`[u16 len][body]` 分帧与解密泵 |
| `http.ts` `websocket.ts` | 隧道内的 HTTP/1.1 客户端与 WebSocket 帧（隧道里不能用 `wx.request`/`wx.connectSocket`） |
| `mux.ts` | `/api/remote.mux` 多路复用，按 `LocalMux` 的 JSON 协议 |
| `transport.ts` | `RpcTransport` 实现（连接复用、上传、事件回执） |
| `random.ts` | 随机源：`wx.getRandomValues` 播一次种，之后用 ChaCha20 做不定长 CSPRNG |

协议细节照 [dsh-mobile-bridge/PROTOCOL.md](../dsh-mobile-bridge/PROTOCOL.md)：37 字节明文前导
`DSHC ‖ ver(1) ‖ bridgeKey(32)`（同时作为 Noise prologue）；握手与传输帧都是 `[u16 BE len][body]`，
明文上限 65519；首包 payload 是 32 字节一次性配对码（已配对则空）；解密后的流直接交给桥接的
`node:http`，所以 keep-alive 与 `Upgrade` 都照常。

平台限制（实测）：**禁止连接 1024 以下的端口**，所以 proxy 默认的 `:443` 小程序永远连不上，
监听要挑 ≥1024 且不在黑名单里的端口（`8000-8100`、`8443`、`8888`、`9200`、`27017` 等已被禁，
8787 可用）；只允许同局域网的非本机 IP 或已配置的服务器域名；每 5 分钟最多建 20 条，
所以连接必须长活复用（每个 transport 只维持一条 RPC 隧道 + 一条 WS 隧道）。

真机走通需要：proxy 监听 LAN 地址（如 `--listen 0.0.0.0:8787`）、服务端域名加进小程序的
request 合法域名，然后在设置页把传输方式切到「加密隧道」并先完成配对。开发者工具里还需
详情 → 本地设置勾选「不校验合法域名」（`project.config.json` 的 `urlCheck: false`）。

## 离线可跑通

`settings.transport = 'mock'` 时使用 `transport/mock.ts`：内存会话（`sess-demo-alpha` /
`sess-demo-beta` / `sess-demo-gamma`）、两个工作区、命令与技能目录、带延迟的流式事件。
不需要任何后端即可完整走查会话列表 → 会话 → 输入 → 审批/提问 → 设置。

Mock 的事件类型、字段名与投影容器一律照主机口径写（`user/message`、`assistant/message`、
`tool/call`、`tool/result`、`turn/end`、`{asOfSeq, values}`），四条流同样以基线开场，
所以离线走查走的是与真实主机完全同一套解析分支。

## 验证状态

- `npm run lint`（`tsc --noEmit --skipLibCheck`）：**零错误**。
- 自定义标题栏：全局 `navigationStyle: "custom"`，七处顶栏（六页 + 引导页 + 全屏详情弹层）
  由 `ui/navBar.tsx` 统一画，高度按「状态栏 + (胶囊间距 × 2 + 胶囊高)」推，中线与胶囊重合；
  开发者工具逐页实拍已验收，真机未验证。详见 [docs/CUSTOM-NAVBAR.md](docs/CUSTOM-NAVBAR.md)。
- `npm test`（`node --test`）：**全绿**。用例逐条移植自安卓单测，覆盖读数格式化与非有限输入、
  占位符、相对时间、文件链接地址、图片扩展名、工具行畸形参数、本轮产出文件校验、归档与空白会话复用、
  失败轮次文案、目标条、工具结果配对、未读红点、0.1.6 / 0.1.7 协议解码（含 multipart 二进制应答）、
  对话区可见性与轮次触发、job/follow 输出折叠与任务分段、模式说明分节、图片块协议、
  内容块编解码、分片搬运。
- `npm run build:weapp`：**编译通过**，`dist/pages` 下六个页面齐全
  （index / chat / new / settings / pairing / archived；文件预览已并入聊天页的底部弹层，
  不再有独立的 preview 页）。
- 适配 dsh 0.1.7-alpha.2（向下兼容 0.1.6）：工具结果按 `toolCallId`/`isError` 解 v4 的 `role:'tool'` 消息；
  `compact-checkpoint` 不进转写；后台任务改订阅每会话的 `job/list` 流、可 `job/kill`；子代理目录改读
  `session/projections` 的 `subagentCatalog`（`subagents/list` 已删，mode 多了 `unknown`）；预设按 id 判内置、
  `code`→`ptc`；`workspaceFiles/readBytes` 改 `options.range` 且应答为 multipart 二进制（传输层还原成 base64）；
  归档遇 `workspace/session-active` 先确认再 `stopActivity`；置顶改主机侧 `workspace/pinSession`。
  这些 RPC/流的参数形状已对本机 0.1.7 主机逐条实测。
- 补齐 0.1.7 web 新功能（对照 Mac 端 `267bcde`）：
  - 对话区：不再显示 system prompt 与普通上下文注入；唤醒本轮的非人类消息（定时任务、后台任务、goal、
    webhook、插件……）按 inbox 认领判定，画成一条触发通知；隐藏 `/permission` 命令行。
  - 历史分页：`session/page` / `session/follow` 改用 `turnWindow`（`maxMessages` 500、至少两个轮次起点）。
  - 后台任务：会话面板分「进行中 / 已结束」两段，已结束可折叠、可清空（本端隐藏）；任务详情显示状态、
    类型、用时、退出码（非 0 标红）、信号，停止带确认，实时输出走 `job/follow`（只留 128K 尾部）。
  - 首次使用（无工作区、无会话）新建会话时调 `workspace/initializeDefault` 建默认工作区。
  - 会话列表折叠的分组仍露出运行中的会话；新建页预设选择里内置模式带「模式说明」弹层。
  以上参数形状对照本机 0.1.7-alpha.2 主机的 zod schema 核对过；UI 尚未在开发者工具里连真主机逐项实拍。
- 微信开发者工具 + 本机 `dsh web`（0.1.6）实测：会话列表带真实标题与工作区分组、
  聊天页转写与用量、`workspace/changes` 改动卡与逐文件 diff、权限目录、归档恢复、
  `@` 文件链接都读的是主机真数据。
- `transport = mock` 实测：列表、转写（含工具调用折叠）、改动卡、输入区控件齐全。
- `npm run verify:tunnel`：**pass=14 fail=0**。三层都验，且第 2、3 层是拿本机真实的桥接
  实现当对端、跑真 socket 的：
  1. crypto 对 RFC 向量（SHA-256/SHA-1/HMAC RFC 4231、ChaCha20-Poly1305 RFC 8439、
     X25519 RFC 7748）；
  2. 本项目 Noise_IK 发起方 ↔ `dsh-mobile-bridge` 的 IK 响应方，双向传输、篡改拒绝；
  3. 隧道端到端：Noise + HTTP/1.1 + WebSocket，含 keep-alive 复用与 WS 分片重组。
  脚本找不到 `dsh-mobile-bridge` 时只跑第 1 层，并明确打印 SKIPPED，不假装验过。
- 微信开发者工具内实测（真 `wx.createTCPSocket`，非 Node 桩）：对本机桥接协议服务完成
  Noise 握手（约 16-21ms）、`POST /api/session/list` 返回 200、WS `101` 升级成功并收到
  `{type:"item",streamId:"events"}`；桥接侧日志确认前导 `DSHC` v1、bridgeKey 匹配、
  首连 payload 32 字节（配对码）而后连为 0。
- 通道选择与设备密钥：设置页支持 直连 / 加密隧道 / 离线 三选一，隧道未配对时给出提示；
  设备私钥改用 `wx.getRandomValues` 的对象式接口取真随机数（旧实现同步读返回值，会静默
  退化成 `Math.random`，已删除）。
- 真机与正式环境**尚未验证**：需要在主机侧监听 LAN 地址并配置合法域名，见上一节。

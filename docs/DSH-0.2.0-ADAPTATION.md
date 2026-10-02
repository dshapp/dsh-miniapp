# 小程序端 DSH 0.2.0-rc.2 适配清单

依据：Mac 端会话 `session-6b7acb1c-5cb9-43eb-8c90-b8bac35dd7fd`（`dsh-macapp` 提交 `c710a29 feat: 适配 dsh 0.2.0-rc.2`），
以及照它移植的安卓端提交 `dsh-androidapp 017cbf1`（安卓是小程序的权威口径）。

0.2.0 相对 0.1.7-rc.2 的 wire 面没有破坏性变化，只新增了 `userQuestions/answer`、`userQuestions/attachWait`
两个端点和 `userQuestions` 会话投影。所以小程序要做的是**跟进 web 的新行为**。Mac 那次桌面专属的部分这里不做：
dsh 版本固定、更新检查走 `next`、识别 Desktop 载体安装的 dsh 命令行（手机不装 dsh）。

## 一、改动

| # | web 0.2.0 行为 | 小程序改法 |
| - | -------------- | ---------- |
| 1 | 会话搜索只匹配会话自己的标题（`titleOf`），不再回落到目录名或 sessionId；没有标题的行显示「未命名 / Untitled」 | `model/format.ts` 新增 `sessionStoredTitle`（实时标题 → 投影标题，去首尾空白）。会话搜索（`deriveSessionSearchResults`）、归档页筛选、重命名预填（`AppModel.sessionStoredTitle`）都改用它。`sessionDisplayTitle` 的兜底从「cwd 目录名 → sessionId」改为 `Strings.sessionUntitled`。`sessionName` / `sessionSearchName` 删除，`untitledSession` 改名 `sessionUntitled` |
| 2 | 模型选择（#4787）：供应商顺序为 DeepSeek 账号 → DeepSeek 官方 → 其余按目录顺序；超过 4 个模型才出搜索框；用 `rankByName` 排序（前缀命中 → 对齐得分 → 目录顺序）；空分组隐藏 | 新增 `model/modelSearch.ts`（`orderModelProviders` / `visibleModelGroups` / `rankByName`），打分 DP 逐行照抄 web `ui-primitives/rank-by-name.ts`。`ModelPickerSheet` 增加搜索框、清除按钮和「没有匹配的模型」，每次打开都清空查询 |
| 3 | 限时提问（#5178）：请求带 `wait:{callId, timed:true}`。客户端先用 `userQuestions/attachWait` 认领，按主机给的 `remainingMs` 倒计时；到点用 `rejected` + `code:"ASK_TIMED_OUT"` 回执，agent 拿到 pending 结果后继续工作 | `QuestionRequested` 增加 `callId / continued / deadline / held` 字段。`StreamCoordinator` 认领时订阅 `question-wait:<eventId>`，倒计时由 coordinator 负责，弹层不在屏上、甚至离开会话页也会按时超时。认领失败时撤掉这条订阅。`RemoteEventOutcome.rejected` 增加 `code`，隧道传输层带上它。本端应答后调用 `retireLocally`，自己撤掉认领和倒计时，因为应答方收不到自己那份撤回帧 |
| 4 | 用户开始作答或点「慢慢回答」后不再计时，一直等到提交或取消 | 弹层内的选择、跳过、继续、自填都会调用 `holdQuestion`；翻页不会。状态行有三种：「N 秒后继续工作 · 慢慢回答」「会一直等你回答」「已继续工作，仍可回答」。草稿按 `questionIdentity` 记住，倒计时开始或按住时不会被清掉 |
| 5 | 超时后问题变成 continued，仍可回答：迟到的回答走 `userQuestions/answer`；关闭弹层只是收起，可以重新打开 | `SessionStore` 解码 `userQuestions` 投影，派生出 `continuedQuestionsStore`（排除已在 inbox 排队的回答和本端已经回答过的）和 `presentedQuestionStore`（有实时问题先显示它，否则显示第一个没被收起的 continued 问题）。会话页弹层改为订阅 `presentedQuestionStore`。头部 X 对 continued 问题只做收起；遮罩或下滑会调 `dismissQuestion`。收起后输入框上方出现「问题 · 回答」条，点「回答」重新打开。回答失败（如 `REPLY_QUEUED`）时进 `lastError` |
| 6 | 迟到的回答在对话里显示为 `question-reply` 节点 | `source.kind == "user-question-reply"` 的消息总会生成 `turnTrigger`，即使它没唤醒本轮。`model/turnTrigger.ts` 的 `questionReplyPairs` 解析 `answer_to_pending_question` JSON，`messageRow.tsx` 直接列出「问题 / 回答：…」，跳过的题显示「已跳过」，图标是新增的 Lucide `reply` |
| 7 | 定时触发卡（#5137）：标题「定时任务」改为「自动化任务」，图标从闹钟改为时钟 | 文案改为 `Automation task / 自动化任务`，图标 `timer` 改为 `clock` |
| 8 | 时长文案改为单元制（`formatRunDuration`） | `formatDuration` 输出「5s / 2m 5s / 1h 0m 3s」和「5秒 / 2分5秒 / 1小时0分3秒」，不补零。旧模板 `durationSeconds / durationMinutes` 删除 |

确认不用改的：

- **agentPresets 解除 gating**：小程序本来就没有这层限制。
- **Work details 默认值**：小程序没有这个设置，固定把已完成的轮次折叠成摘要，相当于 standard。
- **LLM replay 改用 requested model**：小程序不显示 response model。
- **RunningStatus 计时行**：Mac 加上后又按用户要求去掉了，安卓和小程序都不加。
- **`productAnalytics`**：可选埋点，不接。
- **web 工具行上的 ask 摘要（`ask.pending` / `ask.closed`、从工具行重开/回看）**：Mac 和安卓都没跟，小程序同样不跟。pending 结果的工具行摘要保持为空，入口统一放在输入框上方。

## 二、验证

- `npm run lint`、`npm test` 通过，共 184 个用例。新增 `scripts/test/dsh020.test.ts`（11 个），覆盖：
  时长单元制、触发卡文案与图标、`rankByName`、供应商排序与空组隐藏、question-reply 解析（不唤醒本轮也要画）、
  continued 问题的收起 / 已回答 / 已排队过滤与实时优先、答案 payload 形状与问题身份，
  以及 coordinator 的限时流程：认领、按 `remainingMs` 计时、`ASK_TIMED_OUT` 回执、按住后不超时、阻塞式提问不认领。
  旧用例里的标题兜底与时长读数改为新口径。
- `npm run build:weapp` 通过。
- 端到端：微信开发者工具模拟器 → 本机 TLS proxy（`127.0.0.1:8787`）→ 打过补丁的 mobile bridge → 隔离的 dsh 0.2.0-rc.2 主机，
  模拟模型调用限时 `ask_user_question`，期限 25 秒。以下都实测通过：
  - 5 个 Mock 模型 + 2 个 DeepSeek 模型时出现搜索框，DeepSeek 分组排在 Mock 前面。输入 `flash` 后显示
    DeepSeek-V41-Flash、Flash Lite、Mock Flash，前缀命中的 Flash Lite 排在 Mock Flash 前面。输入 `zzq` 显示「没有匹配的模型。」
  - 倒计时显示「17 秒后继续工作 · 慢慢回答」。不碰它，到点后弹层变成「已继续工作，仍可回答」，模型拿到 `pending:true`。
  - 点「慢慢回答」后显示「会一直等你回答」。过了 30 秒以上仍在等，之后选 Postgres，工具直接拿到 `{"answers":[…Postgres]}`。
  - 收起 continued 问题后，输入框上方出现「用哪种数据库？ · 回答」。迟到回答经 `userQuestions/answer` 送出，
    对话里显示「回答先前等待中的问题 / 用哪种数据库？ / 回答：Postgres」，模型收到了这条回答。
  - 轮次页脚时长显示为「25秒 / 0秒」。

## 三、自测中看到、但不属于本次改动的现象

- 第一次打开会话时，经 bridge 的 follow 快照迟迟不落（转圈一分多钟），之后有一次转写退回到快照时的 seq（停在
  「等待回答」）。退出会话再进来就恢复了。疑似与重连后先回灌本地缓存窗口、而 follow 订阅幂等不再重发基线有关，
  需要单独排查。
- `dsh-mobile-bridge` v0.3.5 打不开 `$events`（`wireStream.open` 仍是旧签名，详见安卓
  `docs/DSH-0.2.0-ADAPTATION.md` 第四节）。不修的话，经 bridge 连接的小程序**收不到任何 waterfall**，
  也就看不到审批和提问。本次自测用的是 `/tmp/dsh-bridge-patched`。

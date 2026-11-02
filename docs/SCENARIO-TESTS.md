# 场景测试：审批 / 提问 / 计划 / 待办 / 会话排队

- 小程序：`/Users/user/dshapp/dsh-miniapp`（微信开发者工具模拟器实测，连真主机）
- 安卓（权威口径）：`/Users/user/dshapp/dsh-androidapp`
- 模型层口径单测：`scripts/test/scenarioFlows.test.ts`（本轮新增 10 条）

## 一、本轮修的三个输入区问题

| 问题 | 根因 | 修法 |
| --- | --- | --- |
| 回形针图标过大 | 与加号同字号时字形占满 em 框，视觉反而更大 | 新增 `.attachLauncher` 14px（对齐安卓 Add 24dp / AttachFile 18dp 的 0.75 比例），实测 22x18 对 25x21 |
| 新建会话页点「切换模型」没反应 | ① `showChoice` 给 `wx.showActionSheet` 塞了 7 项，超微信 6 项硬上限被静默拒掉；② 该页没传 `onOpenModel`，走的是扁平候选回落，与安卓不一致 | ① 翻页页宽改成 5 候选 + 1 个「下一个」；② ComposerBar 自带 `ModelPickerSheet`（宿主没注入 `onOpenModel` 就开自己的），聊天页与新建页行为一致 |
| 发送键 / 终止键样式不对 | 发送键画了蓝底圆形（安卓没有底色）；终止键一整块 34px 红圆 | 发送键改裸图标 34px 命中 + 20px primary 字形（禁用/只读回落 text-faint）；终止键改 36px 命中区 + 24px error 圆 + 12px 白方块 |

三处均已构建进 `dist/` 并在开发者工具里逐页实拍核对。

## 二、场景验收（小程序连真主机）

### 会话排队

- 构造：回合运行中（60s 工具调用）从输入区再发一条消息。
- 结果：消息进队列，队列条出现（时钟图标 + 正文 + 编辑/插队/移除三个动作），占用环继续走；
  回合结束后按序送出，代理逐条收到并回复，无丢失、无并发冲突。

### 提问

- 触发：让代理调用 `ask_user_question`。
- 结果：底部弹层逐题呈现（标题 / 单选项 / 自定义回答 / 跳过 / 提交），选「选项 A」提交后
  主机收到答案并继续，转写里出现「1/1 已回答 ✓」。与安卓 QuestionSheet 同构。

### 计划

- 触发：输入 `/plan` 开计划模式（出现「计划 ×」chip，可点 × 关闭），再发一个任务。
- 结果：命令行进转写、系统公告「switched to plan mode」、代理按计划模式先探索；
  计划评审（exit_plan_mode）的弹层路由与应答编码由 `routePlanReview` /
  `planReviewApproveAnswer` / `planReviewReviseAnswer` 口径保证。

### ToDoList

- 触发：让代理用 `todo_write` 建三项并把第 1 项标完成、第 2 项进行中。
- 结果：底部待办条先显示计数「✓1 · ○1 · ○1 待办二」，点开逐项列出（完成 ✓ / 进行中旋转
  / 待办空心），与安卓 TodoStrip 的收起/展开两态一致。

### 审批（未走通端到端，见下「已知限制」）

- 前置：会话权限预设需要低于 `danger-full-access`，主机才会发 `approval/request`。
- 本轮尝试从「完全访问」切「只读」：小程序侧正确发出 `/permission read-only` 命令 RPC
  （与安卓同一条 `commandsExecute` 路径），但主机投影未更新，审批帧没有产生。

## 三、模型层场景单测（scripts/test/scenarioFlows.test.ts）

| 场景 | 覆盖口径 |
| --- | --- |
| 会话排队 | `inbox` 投影摊行的 queued / steering / context 三段顺序、rpcId 提取、非法投影安全回落 |
| 审批 | `pendingInteractionKind` 审批优先于提问 |
| 计划评审 | `routePlanReview` 的单题/单选/intent 约束；同意与「要求修改」两种应答编码 |
| 提问草稿 | 答完/跳过判定；多题逐题推进、最后一题直接提交、多选不自选下一题 |
| 待办 | `todos` 投影落到 store 的状态与顺序 |
| 权限 | `permissionTitle` 对三种预设的映射与未知值回落 |

## 已知限制

1. **审批场景未走通端到端**：测试会话预设是 `danger-full-access`，主机不发
   `approval/request`。切「只读」走的 `/permission read-only` 命令 RPC 与安卓同一条路径，
   发出后主机投影未更新（标签仍「完全访问」），需主机侧复核预设切换是否生效。
2. **`wx.showActionSheet` 不受自动化控制**：原生面板截不到、点不到，本轮用
   `automation_wx_api` mock `success({tapIndex})` 驱动；权限/更多菜单改自绘 `ActionMenu`
   （`src/ui/actionMenu.tsx`）后这层盲区消失。
3. **开发者工具 `compile_wxss` 诊断对本项目恒报错**（连 `.a{color:red}` 都报 code 10041），
   与产物无关：`dist/common.wxss` / `app-origin.wxss` 括号配平、无 `:not()` 与裸 `px`，
   逐文件 `compile_wxml` 全过。模拟器那次「Compile .wxml failed」红屏是并行改动窗口的
   中间态，不是本轮修复引入的。

## 验证

- `npm run lint`（tsc --noEmit）：0 错误
- `npm test`：145/145 通过（含本轮新增 10 条场景口径）
- `npm run build:weapp`：编译成功（仅 webpack 体积提示）
- 开发者工具实拍：输入区三处修复、排队条、提问弹层、待办条、计划 chip 均已逐一核过

# 场景测试（第二轮）：提问 / 审批 / 计划模式 / 目标 / 消息排队

- 小程序：`/Users/user/dshapp/dsh-miniapp`（微信开发者工具模拟器实测，连真主机 `dsh web` 127.0.0.1:3080）
- 安卓（权威口径）：`/Users/user/dshapp/dsh-androidapp`
- 测试会话：`session-01de50dc-…`，权限预设在新建会话页选成**只读**（这是上一轮审批走不通的根因）

## 一、场景验收结果

| 场景 | 结果 | 实测要点 |
| --- | --- | --- |
| 提问 | ✅ | 底部弹层：kicker/题干/单选圈/描述/自定义回答/跳过/提交；未作答时提交是真禁用态；单题单选点选即提交（末题直接交，符合 QuestionFlow 口径）；转写出现「1/1 已回答」，主机收到答案继续 |
| 审批 | ✅ **本轮打通**（上一轮未走通） | read-only 沙箱拒绝 → 代理带 `sandbox_permissions` 重试 → `approval/request` 弹层（标题「审批」/ 理由 / toolName / bash 命令块）；「本次允许」放行并真的写成文件，「拒绝」后代理按规则终止不再绕路 |
| 计划模式 | ✅ | `/plan` 斜杠候选面板 → 命令行进转写 → 「计划 ×」chip；任务触发 `exit_plan_mode` 评审弹层（计划待审 / Markdown 正文独立滚动 / 修改意见 / 三键）；填备注后主按钮切「提交修改」，主机侧收到 `The user chose to keep planning; their feedback: …`；再次批准后 chip 消失 |
| 目标 | ✅ | `create_goal` 后目标条出现（旗帜图标 + objective + 更多）；菜单「暂停/编辑/清除」，暂停后图标转 pause-circle、菜单项转「恢复目标」；编辑弹层预填并落库；清除后目标条消失 |
| 消息排队 | ✅ | 回合运行中连发两条 → 队列条两行（时钟 + 正文 + 编辑/插队/移除）；编辑生效；插队后该条移出队列条、以 steering 气泡出现在转写尾部，并在**本回合内**被消费；剩下一条在**下一回合**按序消费，编辑后的内容原样送达，无丢失无乱序 |

## 二、本轮修掉的问题

| # | 严重度 | 问题 | 修法 |
| --- | --- | --- | --- |
| 1 | **高** | 深色主题下「没有显式设色」的文字全部隐形（最明显是改动文件卡片的标题与文件名，黑字铺黑底）。根因：`page { color: var(--dsh-color-text) }` 在 `page` 元素上解析，而 `.dsh-theme-dark` 只能挂在页面内容最外层 View，够不到 page，于是永远取浅色值 | `.dsh-app-root` 补 `color: var(--dsh-color-text)`（与既有的 `background` 同一处理），继承色回到主题作用域内 |
| 2 | **中** | 提问弹层遮罩点击 / 下滑手势会 `cancelQuestion`（把整组问题拒答、事件被 settle，再也答不了）；安卓的 `onDismiss` 只本地关闭，只有头部 X 才拒答；小程序自己的审批与计划评审弹层也只本地关闭，三者不自洽 | `Sheet` 的 `onClose` 改回 `props.onClose`，`cancelAll` 只留给头部 X |
| 3 | 中 | 队列条显示条件用的是含 steering/context 的原始数组，只剩 steering 时会渲染一个 0 行空容器，被输入区 `gap: 8px` 撑出一条空白缝；安卓用的是已过滤的 `store.queued` | 先算 `queuedItems`，条件判断与传参共用同一份 |
| 4 | 中 | 计划 chip / 占用环靠 1s `setInterval` 轮询投影，开关最多延迟 1s，期间重复点会重复下发 `/plan off` | 新增 `derivedProjectionStore`（只在 `plan`/`contextPressure` 落值时 +1），组件订阅它再读 getter，去掉轮询 |
| 5 | 低 | 计划评审的「修改」被染成红色（`.outlineButton` 硬编码 `--dsh-color-bad`），语义被抬成「拒绝」；安卓那颗是默认配色的 OutlinedButton，error 色只用于审批的「拒绝」 | 拆出中性的 `.outlineButtonNeutral`（主色文字）给计划评审 |
| 6 | 低 | 「跳过」「去聊天里说」是灰字，安卓 TextButton 默认主色 | `.textButton` 文字色改主色 |
| 7 | 低 | 队列行的编辑/移除在飞行中不置灰，安卓整行 `enabled = id !in busy`；尤其编辑：busy 期间能打开弹层、填完提交却被静默丢弃 | 整行按 `inFlight` 置灰并拦截点击 |
| 8 | 低 | 计划评审三颗按钮提交中不置灰 | 加 `.buttonOff` 置灰（逻辑早退本来就有，补的是视觉反馈） |
| 9 | 低 | 提问项解码比安卓宽松：缺 `question`、选项缺 `label` 时兜底成空串，畸形帧会弹出「无标题」或少一个选项的题；安卓 kotlinx 必填字段缺失即整条丢弃 | `decodeAskUserQuestionItem` 改成必填口径 |
| 10 | 低 | 会话行等待徽标先读 kinds 表再兜底，安卓（以及本端 `statusOrder`）都是先用 `awaitingUserIds` 做闸门 | 改成 ids 做闸门、kinds 只决定文案 |
| 11 | 低 | `setPlanMode` 硬编码 `/plan` / `/plan off`，`planModeLine` 常量闲置，两处口径会漂移 | 改调 `planModeLine(on)` |

## 三、核对为「一致，不改」的项

- **没有「新建目标」入口**：安卓的 `createGoal` 与 `goalNew` 文案在 `ui/` 目录零引用，目标条只在已有目标时出现——两端同为「有 RPC、有文案、无入口」。按权威口径判定一致；要补须两端同补。
- **提问进度是 `%d / %d`**，不是「1/1 已回答」；后者是转写里工具行的摘要，两处不是一回事。
- **审批只有「本次允许 / 拒绝」两个动作**，没有「取消」键；`ApprovalOutcome` 的 wire 串逐值相同。
- **弹层关闭后问题不会自动重开**（两端 `onDismiss` 都是 `setQuestion(null)`）；但重连/重新水合后会从事件窗口恢复——本轮已实测恢复成功。
- **目标菜单多了前导图标**、**多一条 `goalMenu` 无障碍文案**、**命令块折行而非横滚**：已登记的移植取舍，保留。
- **无系统通知**：微信小程序平台能力缺口，不可对齐。

## 四、验证

- `npm run lint`（tsc --noEmit）：0 错误
- `npm test`：145/145 通过
- `npm run build:weapp`：编译成功（仅 webpack 体积提示）
- 开发者工具实拍回归：改动文件卡片文件名可读、计划 chip 即时出现、「跳过」主色、遮罩收起后会话仍「待回答」且重连后问题恢复、作答与清除目标均正常

## 五、遗留

1. 弹层被本地关掉后，同一次会话内没有「重新打开待答问题」的入口（两端一致，属共同缺口，需先在安卓侧确立口径）。
2. `wx.showActionSheet` 已被自绘 `ActionMenu` 取代；注意自动化 `tap` 不带 `detail.x/y`，会让菜单落到右上角兜底位置——这是**自动化假象**，用 `--action trigger --type tap --detail '{"x":…,"y":…}'` 复现真实点击时锚定正确。

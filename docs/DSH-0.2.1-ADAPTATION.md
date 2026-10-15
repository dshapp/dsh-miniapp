# DSH 0.2.1-alpha.2 适配

跟进 dsh 0.2.1-alpha.2（此前停在 0.2.0-rc.2），参照安卓 `2b296b4`、Chrome 扩展 `a95a5ef`、Mac `f670941`
与 deepseek-harness 0.2.1-alpha.2 源码。只做小程序端用得到的协议差异；插件 / 自动化 / 宿主设置等管理页不在本轮范围。

| 差异 | 主机侧依据 | 小程序处理 |
|---|---|---|
| 子智能体多了 `external` 模式（外部执行器，无本地会话） | `subagent/projection-types.ts` | `decodeSubagentMode` 认 `external`，不再落成 `unknown`；会话面板里这一行不可点，尾部标「外部任务」 |
| 显式新建会话不再复用空白会话 | web `navigation.ts` `startSession` → `connectBlank(…, false)` | `createSession(workspaceId, reuseBlank = false)`；只有新建页里切换工作区才复用该工作区的空白会话（同 Mac） |
| 有效工作目录 | `working-directory`：`workingDirectory` 投影 + `working-directory/change` 事件 | `SessionStore.workingDirectoryStore`，投影与事件按 seq 取新；聊天页的 cwd 改为 `workingDirectory ?? cwd` |
| `agentPresets/list` 删掉 `modeSelectionEnabled` | `dsh-agent-presets` | 有未损坏的预设才给预设选择入口（同安卓） |
| 目标 activation（进程内，不进投影） | `goals/get` 的 `activation`、`goal/activation-changed` | active 且 `disarmed`（重启后恢复、不会自己续跑）的目标按已暂停画、菜单给「恢复」；目标版本或运行态变化时重读 |
| PTC 子调用 `error.reason`、结算事件带 `arguments` | `core/tools/src/types.ts` `PtcDispatchEventData` | 工具失败摘要优先显示 `reason`；start 不在窗口里时用结算事件的参数 |
| 工作流只在崩溃 / 分叉截断时判中断 | web `workflow-definition.ts` `turnAbandoned` | turn/end 的 reason 是 `interrupted` / `forked` 才把没写 run-end 的工作流判为中断 |
| 流式 tool-call 的 id 在首条 delta 上 | assistant stream | block-start 开槽没有 id 时由 delta 补上 |

验证：`npm run lint`、`npm test`（新增 `scripts/test/dsh021.test.ts`）、`npm run build:weapp`。
未连 0.2.1 真主机在开发者工具里逐项实拍。

未移植：准备中的工具行（参数流式时先画工具行）、轮次页脚的完成 / 停止 / 失败状态与仅成功轮显示用时、
每个工具调用记下派发时的目录、宿主设置 / 插件 / 自动化管理页。

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

## 第二轮补齐

| 项 | 处理 |
|---|---|
| 准备中的工具行 | 流式步骤里写参数的调用先占一行（只读参数头 8K 抠路径 / description），write/edit 带内容 KB；tool/call 落定后让位 |
| 轮次结局 | 页脚：停止（aborted）/ 失败（error）只交代结局，成功轮才有用时（含以工具收尾的轮）；折叠头后缀「已完成，用时 X」 |
| 派发时的工作目录 | 每个调用记下派发那一刻的目录（不晚于该 seq 的目录变更或投影版本），路径按它相对化 |
| 运行中底部状态 | 最新一轮里未出结果的工具 → 动作类别 + 本轮自 turn/start 起的用时，每秒刷新 |
| 管理页 | 设置页「DSH」区进入：插件管理（官方/已安装、开关、精确目标安装更新与按 requestId 恢复、移除、模块开关）、自动化任务（列表搜索、改名称/内容、删除、投递历史，「新建」开预填新会话）、宿主设置（provider 凭证引用状态、预设 YAML 只读） |

模拟器核对：用开发者工具注入事件（未配对，桩传输），逐项截图核对了工具变更行与详情、折叠与展开、文件卡片、
停止结局、准备中行、底部状态每秒走时、外部子代理「外部任务」、插件与自动化页、新建预填。

第三轮补齐（对齐安卓）：自动化规则的时间规则编辑（at/every/daily/weekly/cron）、插件精确版本豁免的审阅/开启/撤销、
宿主 provider 模型目录编辑（只写 models 子树，恢复继承只 unset，冲突不重试）；未配对时打开会话页改为提示先配对。
设置页宿主设置区用内存态配对资料（不写模拟器存储）在模拟器里截图核对过。

入口放在设置页而非安卓的会话列表视图菜单（会话列表页有他人进行中的改动）。未连真主机配对实测。

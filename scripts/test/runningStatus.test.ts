/**
 * 输入框上方的运行状态条与执行中卡片的呼吸相位：
 * 工作类别映射对照 Mac ToolRowModel.liveActivity，文案与用时对照 Mac RunningStatusRow，
 * 相位对照扩展 a268f45 的 syncBreathePhase。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveActivityKey } from '../../src/model/toolRow';
import { runningStatusText } from '../../src/model/format';
import { BREATHE_PERIOD_MS, breatheDelayMs } from '../../src/model/breathe';
import { SessionStore } from '../../src/state/sessionStore';
import { chatNodeRendersRow } from '../../src/model/chatNode';
import { Strings, setLocale } from '../../src/i18n/strings';

test('工作类别：按工具 wire 名归类（Mac liveActivity）', () => {
  const cases: Array<[string | undefined, string]> = [
    [undefined, 'activityThinking'],
    ['read', 'activityRead'],
    ['read_image', 'activityReadImage'],
    ['grep', 'activitySearch'],
    ['glob', 'activitySearch'],
    ['lsp_inspect', 'activitySearch'],
    ['write', 'activityWrite'],
    ['edit', 'activityEdit'],
    ['apply_patch', 'activityEdit'],
    ['bash', 'activityCommands'],
    ['pwsh', 'activityCommands'],
    ['exec_command', 'activityCommands'],
    ['write_stdin', 'activityCommands'],
    ['terminal_send', 'activityCommands'],
    ['run_code', 'activityCode'],
    ['web_search', 'activityWebSearch'],
    ['web_fetch', 'activityWebFetch'],
    ['todo_write', 'activityPlan'],
    ['create_goal', 'activityPlan'],
    ['update_goal', 'activityPlan'],
    ['get_goal', 'activityPlan'],
    ['ask_user_question', 'activityQuestions'],
    ['request_user_input', 'activityQuestions'],
    ['subagent', 'activitySubagents'],
    ['subagent_wait', 'activitySubagents'],
    ['mcp__chrome__click', 'activityTools'],
    ['subagents', 'activityTools'],
  ];
  for (const [name, key] of cases) assert.equal(liveActivityKey(name), key, String(name));
});

test('工作类别文案（中英）', () => {
  setLocale('zh');
  assert.deepEqual(
    ['read', 'grep', 'bash', 'web_fetch', 'ask_user_question', 'subagent_wait', 'other', undefined].map(name => Strings[liveActivityKey(name)]),
    ['正在读取文件', '正在搜索代码', '正在运行命令', '正在访问网页', '等待你的操作', '正在协调子智能体', '正在调用工具', '正在分析请求'],
  );
  setLocale('en');
  assert.deepEqual(
    ['read_image', 'edit', 'run_code', 'todo_write', undefined].map(name => Strings[liveActivityKey(name)]),
    ['Reading images', 'Editing files', 'Running code', 'Updating the plan', 'Analyzing the request'],
  );
});

test('状态条文案：类别 · 用时（单元制、下限 1 秒），拿不到 turn/start 不给用时', () => {
  setLocale('zh');
  assert.equal(runningStatusText('正在运行命令', 10_000, 75_000), '正在运行命令 · 1分5秒');
  assert.equal(runningStatusText('正在运行命令', 10_000, 10_200), '正在运行命令 · 1秒');
  // 本机时钟比主机慢：差值为负也按下限 1 秒，不出现 0 秒。
  assert.equal(runningStatusText('正在分析请求', 10_000, 9_000), '正在分析请求 · 1秒');
  assert.equal(runningStatusText('正在运行命令', 0, 3_725_000), '正在运行命令 · 1小时2分5秒');
  assert.equal(runningStatusText('正在分析请求', undefined, 99_000), '正在分析请求');
  setLocale('en');
  assert.equal(runningStatusText('Running commands', 10_000, 75_000), 'Running commands · 1m 5s');
});

test('状态条：发出即亮（正在分析请求、无用时），开轮后带 turn/start，轮次结束隐藏', () => {
  const store = new SessionStore('s1');
  assert.equal(store.runningStatus, undefined);
  store.beginPendingSubmission('r1', 'transcript', 'hi');
  assert.deepEqual(store.runningStatus, { toolName: undefined, startedAt: undefined });
  store.retirePendingSubmission('r1');
  assert.equal(store.runningStatus, undefined);
  // 运行中排队的消息不单独点亮（轮次本来就在跑，状态由轮次给）。
  store.beginPendingSubmission('r2', 'queued', 'later');
  assert.equal(store.runningStatus, undefined);
  store.retirePendingSubmission('r2');
  store.apply({ type: 'turn/start', seq: 1, time: 5000, data: { turn: 1 } } as never, undefined);
  assert.deepEqual(store.runningStatus, { toolName: undefined, startedAt: 5000 });
  store.apply({ type: 'tool/call', seq: 2, time: 6000, data: { callId: 'c1', name: 'grep', arguments: '{}', turn: 1, step: 1 } } as never, undefined);
  assert.equal(store.runningStatus?.toolName, 'grep');
  store.apply({ type: 'turn/end', seq: 3, time: 9000, data: { turn: 1, reason: { kind: 'completed' } } } as never, undefined);
  assert.equal(store.runningStatus, undefined);
});

test('首个 token 之前：没有 block 的助手步骤不占行（运行提示只在状态条上）', () => {
  const store = new SessionStore('s1');
  store.apply({ type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } } as never, undefined);
  store.apply({ type: 'step/start', seq: 2, time: 1100, data: { step: 1 } } as never, undefined);
  store.applyAssistantStreamFrame({ kind: 'start', attemptId: 'a1', turn: 1, step: 1 } as never);
  store.applyAssistantStreamFrame({ kind: 'chunk', attemptId: 'a1', time: 1200, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } } as never);
  // 步骤已开、块还空着：记录里没有这一行（不画转圈、不留空行）……
  assert.equal(store.nodes.some(node => node.kind === 'assistant'), false);
  // ……此时状态条照常亮：轮次在跑、还没有工具 → 「正在分析请求」+ 用时。
  assert.deepEqual(store.runningStatus, { toolName: undefined, startedAt: 1000 });
  store.applyAssistantStreamFrame({ kind: 'chunk', attemptId: 'a1', time: 1300, chunk: { type: 'reasoning-delta', index: 0, text: '想' } } as never);
  assert.equal(store.nodes.filter(node => node.kind === 'assistant' && chatNodeRendersRow(node)).length, 1);
});

test('呼吸相位：负 delay 对齐全局时钟，多张卡片同相位', () => {
  assert.equal(BREATHE_PERIOD_MS, 1600);
  assert.equal(breatheDelayMs(0), 0);
  assert.equal(breatheDelayMs(1600 * 1000), 0);
  assert.equal(breatheDelayMs(1_700_000_000_400), -((1_700_000_000_400) % 1600));
  // 在 s 时刻带 delay d 开播，t 时刻的相位是 (t - s - d) mod 周期；s + d 恰为周期整数倍，
  // 相位就只取决于 t：不同时刻开始播放的两张卡同起同落。
  const a = 1_700_000_000_123;
  const b = a + 937;
  assert.equal((a + breatheDelayMs(a)) % 1600, 0);
  assert.equal((b + breatheDelayMs(b)) % 1600, 0);
  assert.equal(breatheDelayMs(NaN), 0);
});

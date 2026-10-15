/**
 * dsh 0.2.1-alpha.2 协议差异（对照 Android 2b296b4 / Mac f670941 / 扩展 a95a5ef）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../../src/state/sessionStore';
import { decodeSubagentMode } from '../../src/transport/rpcMethods';
import { goalPhaseAction } from '../../src/model/format';
import { decodeToolError, resultFirstLine } from '../../src/model/chatNode';
import { preparingArguments, toolRowModel } from '../../src/model/toolRow';
import {
  automationDraft,
  automationDraftError,
  automationTiming,
  decodeAutomations,
  decodeBundle,
  incompatiblePairs,
  providerSettingsRows,
  savedExemptions,
  scheduleExpected,
  validManagementCron,
} from '../../src/model/management';

const ev = (type: string, seq: number, data: unknown) => ({ type, seq, time: seq, data }) as never;

test('external 子代理不再落成 unknown', () => {
  assert.equal(decodeSubagentMode('external'), 'external');
  assert.equal(decodeSubagentMode('bogus'), 'unknown');
});

test('workingDirectory 投影与 working-directory/change 事件谁新听谁的', () => {
  const store = new SessionStore('s1');
  store.applyProjection({ sessionId: 's1', key: 'workingDirectory', value: '/repo', seq: 3 });
  assert.equal(store.workingDirectoryStore.get(), '/repo');
  store.apply(ev('working-directory/change', 5, { cwd: '/repo/pkg' }), undefined);
  assert.equal(store.workingDirectoryStore.get(), '/repo/pkg');
  store.apply(ev('working-directory/change', 4, { cwd: '/stale' }), undefined);
  assert.equal(store.workingDirectoryStore.get(), '/repo/pkg');
});

test('disarmed 的 active 目标只给恢复；activation 对不上当前版本时不算', () => {
  assert.equal(goalPhaseAction('active', true), 'resume');
  assert.equal(goalPhaseAction('active'), 'pause');
  const store = new SessionStore('s1');
  store.applyProjection({ sessionId: 's1', key: 'goal', value: { goal: { id: 'g1', revision: 2, phase: 'active', objective: 'x' } }, seq: 1 });
  store.setGoalActivation({ id: 'g1', revision: 1, activation: 'disarmed' });
  assert.equal(store.goalDisarmed, false);
  store.setGoalActivation({ id: 'g1', revision: 2, activation: 'disarmed' });
  assert.equal(store.goalDisarmed, true);
});

test('工具失败优先显示 error.reason', () => {
  const error = decodeToolError({ name: 'ToolError', code: 'EIO', reason: 'disk full\nretry later' });
  assert.equal(resultFirstLine({ seq: 1, time: 1, content: [], isError: true, error }), 'disk full');
});

test('参数流式生成时先画「准备中」的工具行，tool/call 落定后让位', () => {
  const store = new SessionStore('s1');
  store.apply(ev('turn/start', 1, { turn: 1 }), undefined);
  store.applyAssistantStreamFrame({ kind: 'start', attemptId: 'a1', revision: 1, startedAfterSeq: 1, turn: 1, step: 1 });
  const chunk = (index: number, value: unknown) =>
    store.applyAssistantStreamFrame({ kind: 'chunk', attemptId: 'a1', revision: 1, index, time: 2, chunk: value as never });
  chunk(0, { type: 'block-start', index: 0, blockType: 'tool-call' });
  chunk(1, { type: 'tool-call-delta', index: 0, id: 'c1', name: 'write', argumentsDelta: '{"file_path":"/repo/a.ts","content":"x' });
  const tools = store.nodes.filter(node => node.kind === 'tool');
  assert.equal(tools.length, 1);
  const data = tools[0].kind === 'tool' ? tools[0].data : undefined;
  assert.equal(data?.preparing, true);
  const row = data === undefined ? undefined : toolRowModel(data, '/repo');
  assert.deepEqual([row?.state, row?.summary, row?.summarySuffix], ['preparing', 'a.ts', '1 KB']);
  store.apply(ev('tool/call', 3, { callId: 'c1', name: 'write', arguments: '{}', turn: 1, step: 1 }), undefined);
  const after = store.nodes.filter(node => node.kind === 'tool');
  assert.deepEqual(after.map(node => (node.kind === 'tool' ? node.data.preparing === true : null)), [false]);
});

test('半截路径不当摘要', () => {
  assert.equal(preparingArguments('read', '{"file_path":"/repo/sr').summary, '');
  assert.equal(preparingArguments('bash', '{"description":"Run tests","command":"np').summary, 'Run tests');
});

test('轮次页脚：停止/失败只交代结局，成功轮（哪怕以工具收尾）才有用时', () => {
  const tail = (reason: string) => {
    const store = new SessionStore('s1');
    store.apply(ev('turn/start', 1, { turn: 1 }), undefined);
    store.apply(ev('tool/call', 2, { callId: 'c1', name: 'bash', arguments: '{}', turn: 1, step: 1 }), undefined);
    store.apply({ type: 'turn/end', seq: 3, time: 4000, data: { turn: 1, reason: { kind: reason } } } as never, undefined);
    const node = store.nodes.find(item => item.kind === 'turnTail');
    return node?.kind === 'turnTail' ? node.data : undefined;
  };
  assert.deepEqual([tail('aborted')?.outcome, tail('aborted')?.runMs], ['stopped', undefined]);
  assert.equal(tail('error')?.outcome, 'failed');
  assert.deepEqual([tail('completed')?.outcome, tail('completed')?.runMs], ['completed', 3999]);
});

test('工具调用按派发时的工作目录解析路径，之后换目录不改写历史行', () => {
  const store = new SessionStore('s1');
  store.apply(ev('working-directory/change', 1, { cwd: '/repo' }), undefined);
  store.apply(ev('tool/call', 2, { callId: 'c1', name: 'read', arguments: '{"file_path":"/repo/a.ts"}', turn: 1, step: 1 }), undefined);
  store.apply(ev('working-directory/change', 3, { cwd: '/repo/pkg' }), undefined);
  store.apply(ev('tool/call', 4, { callId: 'c2', name: 'read', arguments: '{"file_path":"/repo/pkg/b.ts"}', turn: 1, step: 1 }), undefined);
  const rows = store.nodes.flatMap(node => (node.kind === 'tool' ? [toolRowModel(node.data, store.workingDirectoryStore.get()).summary] : []));
  assert.deepEqual(rows, ['a.ts', 'b.ts']);
});

test('运行中底部状态：当前未出结果的工具与本轮 turn/start 时刻，结束后消失', () => {
  const store = new SessionStore('s1');
  store.apply({ type: 'turn/start', seq: 1, time: 5000, data: { turn: 1 } } as never, undefined);
  assert.deepEqual(store.runningStatus, { toolName: undefined, startedAt: 5000 });
  store.apply(ev('tool/call', 2, { callId: 'c1', name: 'bash', arguments: '{}', turn: 1, step: 1 }), undefined);
  assert.equal(store.runningStatus?.toolName, 'bash');
  store.apply({ type: 'turn/end', seq: 3, time: 9000, data: { turn: 1, reason: { kind: 'completed' } } } as never, undefined);
  assert.equal(store.runningStatus, undefined);
});

test('管理页口径：bundle 安装目标、ScheduleRecord expected、凭证引用', () => {
  const missing = decodeBundle({ name: 'web', official: true, availability: 'missing', installTarget: { spec: 'npm:web@1.0.0', version: '1.0.0' } });
  assert.deepEqual([missing.missing, missing.installSpec, missing.removable], [true, 'npm:web@1.0.0', false]);
  assert.equal(decodeBundle({ name: 'x', installTarget: { spec: 'npm:x' } }).installSpec, undefined);
  const record = { id: 'r1', kind: 'daily', title: 't', prompt: 'p', scheduledAt: '2026-10-16T01:00:00Z', time: '09:00:00', timeZone: 'Asia/Shanghai', status: 'active', sessionId: 's1' };
  assert.deepEqual(Object.keys(scheduleExpected(record)), ['id', 'kind', 'title', 'prompt', 'scheduledAt', 'time', 'timeZone']);
  const rows = providerSettingsRows(
    [{ provider: 'open-ai', settingsNs: 'llm', settingsPath: ['providers', 'openai'] }, { provider: 'deepseek-account', settingsNs: 'llm' }],
    { namespaces: [{ ns: 'llm', value: { providers: { openai: { apiKeyEnv: 'MY_KEY' } } } }] },
  );
  assert.deepEqual(rows.map(row => [row.credentialRef, row.derivedRef]), [['MY_KEY', false], [undefined, false]]);
});

test('自动化规则的时间规则编辑：校验与 change 形状对齐安卓 AutomationDraft', () => {
  const [entry] = decodeAutomations([{ id: 'r1', sessionId: 's1', kind: 'daily', title: 't', prompt: 'p', status: 'active', scheduledAt: '2026-10-16T01:00:00Z', time: '09:00:00', timeZone: 'Asia/Shanghai' }]);
  const draft = automationDraft(entry);
  assert.equal(automationTiming(draft), undefined);
  const weekly = { ...draft, timingChanged: true, kind: 'weekly', weekdays: '5,1' };
  assert.equal(automationDraftError(weekly), undefined);
  assert.deepEqual(automationTiming(weekly), { kind: 'weekly', weekly: { time_zone: 'Asia/Shanghai', time: '09:00:00', weekdays: [1, 5] } });
  assert.equal(automationDraftError({ ...weekly, weekdays: '1,1' }), 'weekdays');
  assert.equal(automationDraftError({ ...weekly, kind: 'every', seconds: '30' }), 'interval');
  assert.deepEqual(automationTiming({ ...weekly, kind: 'every', seconds: '120' }), { kind: 'every', every_seconds: 120 });
  assert.equal(automationDraftError({ ...weekly, kind: 'at', at: '2026-10-16 09:00' }), 'UTC timestamp');
  assert.equal(validManagementCron('*/15 9-17 * * 1-5'), true);
  assert.equal(validManagementCron('0 25 * * *'), false);
});

test('插件精确版本豁免：不兼容组合去重、已保存豁免摊平', () => {
  const bundle = decodeBundle({ name: 'x', error: { incompatible: [{ name: 'x', version: '1.0.0', runtimeVersion: '0.2.1' }] } });
  const result = { error: { incompatible: [{ name: 'x', version: '1.0.0', runtimeVersion: '0.2.1' }, { name: 'y', version: '2.0.0', runtimeVersion: '0.2.1' }] } };
  assert.deepEqual(incompatiblePairs(result, [bundle]).map(pair => pair.name), ['x', 'y']);
  assert.deepEqual(savedExemptions({ exemptions: { 'x@1.0.0': ['0.2.1', '0.2.2'] } }).length, 2);
});

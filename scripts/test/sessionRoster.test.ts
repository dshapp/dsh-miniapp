/**
 * 归档页 / 主列表 / 空白会话复用的三个纯口径：
 * 逐条对照安卓 ArchivedSessionsTest 与 BlankSessionReuseTest。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { archivedSessionRows, filterArchivedSessions, listSessionsVisible } from '../../src/model/archivedSessions';
import { reusableBlankSession } from '../../src/model/blankSessionReuse';
import type { AgentPresetEntry, SessionSummary, WorkspaceView } from '../../src/model/types';

function summary(id: string, extra: Partial<SessionSummary> & { title?: string } = {}): SessionSummary {
  const { title, ...rest } = extra;
  return {
    sessionId: id,
    updatedAt: 0,
    running: false,
    blank: false,
    ...rest,
    projections: title === undefined ? rest.projections : { values: { title } },
  } as SessionSummary;
}

const byId = (list: SessionSummary[]) => new Map(list.map(item => [item.sessionId, item]));
const ids = (rows: SessionSummary[]) => rows.map(row => row.sessionId);

// —— 归档页的行推导 ————————————————————————————————————————

test('归档集合按归档先后写入，页面反过来渲染', () => {
  const roster = byId(['a', 'b', 'c'].map(id => summary(id)));
  assert.deepEqual(ids(archivedSessionRows(['a', 'b', 'c'], roster)), ['c', 'b', 'a']);
});

test('摘要已不存在的归档条目不产生行', () => {
  assert.deepEqual(ids(archivedSessionRows(['kept', 'gone'], byId([summary('kept')]))), ['kept']);
});

test('归档集合为空时没有行', () => {
  assert.equal(archivedSessionRows([], new Map()).length, 0);
});

// —— 归档页搜索 ——————————————————————————————————————————

test('空查询返回全部行', () => {
  const rows = [summary('a', { title: 'Alpha' }), summary('b', { title: 'Beta' })];
  assert.deepEqual(ids(filterArchivedSessions(rows, new Map(), '   ')), ['a', 'b']);
});

test('标题子串匹配不区分大小写', () => {
  const rows = [summary('a', { title: 'Fix The Parser' }), summary('b', { title: 'Other' })];
  assert.deepEqual(ids(filterArchivedSessions(rows, new Map(), 'parser')), ['a']);
});

test('工作区名也参与匹配', () => {
  const rows = [summary('a', { title: 'One', cwd: '/work/alpha' }), summary('b', { title: 'Two' })];
  assert.deepEqual(ids(filterArchivedSessions(rows, new Map(), 'ALPHA')), ['a']);
});

test('工作区标题优先于 cwd 目录名', () => {
  const rows = [summary('a', { title: 'One', cwd: '/work/alpha' })];
  const titles = new Map([['a', 'Renamed Workspace']]);
  assert.deepEqual(ids(filterArchivedSessions(rows, titles, 'renamed')), ['a']);
  assert.equal(filterArchivedSessions(rows, titles, 'alpha').length, 0);
});

test('查不到就是空', () => {
  assert.equal(filterArchivedSessions([summary('a', { title: 'Alpha' })], new Map(), 'zzz').length, 0);
});

// —— 主列表口径 ————————————————————————————————————————————

test('主列表滤掉归档、空白与 subagent 三种行', () => {
  const sessions = [
    summary('kept', { title: 'Kept' }),
    summary('archived', { title: 'Archived' }),
    summary('blank', { blank: true }),
    summary('subagent', { origin: 'subagent' }),
  ];
  assert.deepEqual(ids(listSessionsVisible(sessions, new Set(['archived']))), ['kept']);
});

test('fork 出来的会话照常列出', () => {
  assert.deepEqual(ids(listSessionsVisible([summary('forked', { title: 'Fork' })], new Set())), ['forked']);
});

test('归档不是删除：主列表消失、归档页出现', () => {
  const sessions = [summary('kept', { title: 'Kept' }), summary('archived', { title: 'Archived' })];
  assert.deepEqual(ids(listSessionsVisible(sessions, new Set(['archived']))), ['kept']);
  assert.deepEqual(ids(archivedSessionRows(['archived'], byId(sessions))), ['archived']);
});

// —— 空白会话复用 ————————————————————————————————————————

const workspace: WorkspaceView = {
  workspaceId: 'ws1', path: '/tmp/proj', title: 'proj', sessionIds: ['s1'], createdAt: '', updatedAt: '',
};
const blank = (preset?: string): SessionSummary =>
  summary('s1', { blank: true, cwd: '/tmp/proj', agentPreset: preset });
const liveCatalog: AgentPresetEntry[] = [{ id: 'standard', trust: 'system', isDefault: true }];

test('预设已不在目录里的空白会话不复用', () => {
  assert.equal(reusableBlankSession([blank('plugin-that-was-removed')], workspace, new Set(), liveCatalog), undefined);
});

test('已损坏的预设同样不复用', () => {
  const catalog: AgentPresetEntry[] = [{ id: 'cordis', trust: 'system', isDefault: false, broken: 'plugin failed to load' }];
  assert.equal(reusableBlankSession([blank('cordis')], workspace, new Set(), catalog), undefined);
});

test('预设还在就复用', () => {
  assert.equal(reusableBlankSession([blank('standard')], workspace, new Set(), liveCatalog)?.sessionId, 's1');
});

test('目录还没回来时不拒任何会话', () => {
  assert.equal(reusableBlankSession([blank('standard')], workspace, new Set(), [])?.sessionId, 's1');
});

test('投影里记着的预设同样要过闸', () => {
  const projected = summary('s1', { blank: true, cwd: '/tmp/proj' });
  projected.projections = { values: { agentPreset: 'plugin-that-was-removed' } };
  assert.equal(reusableBlankSession([projected], workspace, new Set(), liveCatalog), undefined);
});

test('不属于该工作区的会话不复用', () => {
  const other: WorkspaceView = { ...workspace, workspaceId: 'ws2', path: '/tmp/other' };
  assert.equal(reusableBlankSession([blank('standard')], other, new Set(), liveCatalog), undefined);
});

test('已归档的空白会话不复用', () => {
  assert.equal(reusableBlankSession([blank('standard')], workspace, new Set(['s1']), liveCatalog), undefined);
});

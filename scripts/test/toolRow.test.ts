/**
 * 工具行摘要与「本轮产出文件」的参数校验：
 * 逐条对照安卓 ToolRowMalformedArgsTest 与 ProducedPathValidationTest。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { askSummary, todoSummary } from '../../src/model/toolRow';
import { producedPath } from '../../src/model/format';
import { Strings, fmt, setLocale } from '../../src/i18n/strings';
import type { ToolChatData } from '../../src/model/chatNode';

test('畸形 todos 回退而不是读成 0/0', () => {
  for (const raw of ['{"todos":["a"]}', '{"todos":[null]}', '{"todos":[1,2]}', '{"todos":[["nested"]]}']) {
    assert.equal(todoSummary(raw), undefined, raw);
  }
});

test('正常 todos 照常读', () => {
  setLocale('en');
  const result = todoSummary('{"todos":[{"status":"completed","content":"a"},{"status":"in_progress","content":"b"}]}');
  assert.equal(result?.[0], fmt(Strings.todoCompleted, 1, 2) + ' · b');
});

test('畸形 answers 回退', () => {
  const data = {
    callId: 'c1', name: 'ask_user_question', argsRaw: '', turn: 1, step: 1, startSeq: 1, time: 0,
    result: { seq: 2, time: 1, content: [{ kind: 'text', text: '{"answers":["a"]}' }], isError: false },
  } as unknown as ToolChatData;
  assert.equal(askSummary(data), undefined);
});

// —— 本轮产出文件的参数校验 ————————————————————————————

test('edit 的 replace_all 必须是布尔', () => {
  const base = '{"file_path":"a.ts","old_string":"x","new_string":"y"}';
  assert.equal(producedPath('edit', base), 'a.ts');
  assert.equal(producedPath('edit', base.slice(0, -1) + ',"replace_all":true}'), 'a.ts');
  assert.equal(producedPath('edit', base.slice(0, -1) + ',"replace_all":false}'), 'a.ts');
  assert.equal(producedPath('edit', base.slice(0, -1) + ',"replace_all":"true"}'), undefined);
});

test('str_replace 的 new_str 必须是字符串', () => {
  const head = '{"path":"a.ts","command":"str_replace","old_str":"x"';
  assert.equal(producedPath('str_replace_editor', head + '}'), 'a.ts');
  assert.equal(producedPath('str_replace_editor', head + ',"new_str":"y"}'), 'a.ts');
  assert.equal(producedPath('str_replace_editor', head + ',"new_str":3}'), undefined);
});

test('insert 的行号必须是非负整数', () => {
  const head = '{"path":"a.ts","command":"insert","new_str":"y"';
  assert.equal(producedPath('str_replace_editor', head + ',"insert_line":0}'), 'a.ts');
  assert.equal(producedPath('str_replace_editor', head + ',"insert_line":7}'), 'a.ts');
  assert.equal(producedPath('str_replace_editor', head + ',"insert_line":1.5}'), undefined);
  assert.equal(producedPath('str_replace_editor', head + ',"insert_line":-1}'), undefined);
});

/**
 * 0.1.7 小体验（对照 Mac 267bcde）：内置预设模式说明的归属与分节。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { localizedGuideText, parseGuideSections, presetGuideFor } from '../../src/model/presetGuide';
import { setLocale } from '../../src/i18n/strings';

test('只有四个内置预设有模式说明；自带 name 的同名预设算用户预设', () => {
  for (const id of ['standard', 'ptc', 'minimal', 'cordis']) {
    assert.notEqual(presetGuideFor({ id, isDefault: false }), undefined, id);
  }
  assert.equal(presetGuideFor({ id: 'standard', isDefault: false, name: 'Mine' }), undefined);
  assert.equal(presetGuideFor({ id: 'custom', isDefault: false }), undefined);
});

test('说明按 ### 分节、空行分段；用法页的示例任务以 > 开头', () => {
  setLocale('zh');
  const guide = presetGuideFor({ id: 'standard', isDefault: false })!;
  const explanation = parseGuideSections(localizedGuideText(guide.explanation));
  assert.deepEqual(explanation.map(section => section.title), ['工作方式', '什么时候选']);
  const usage = parseGuideSections(localizedGuideText(guide.usage));
  assert.equal(usage.length, 2);
  assert.equal(usage[0].lines[0].startsWith('> '), true);
  setLocale('en');
  assert.equal(parseGuideSections(localizedGuideText(guide.explanation))[0].title, 'How it works');
  setLocale('zh');
});

test('空文本没有分节', () => {
  assert.deepEqual(parseGuideSections(''), []);
});

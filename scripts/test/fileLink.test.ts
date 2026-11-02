/**
 * 文件链接地址翻译：逐条对照安卓 FileLinkTest（用例来自 DSH Web 的 file-address 测试）。
 *
 * 手机端认的地址语法必须和网页端正向一致，否则同一段 Markdown 在两端点出两个结果。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFileLink, parseInlineCodeFileLink } from '../../src/model/fileLink';

const path = (destination: string): string | undefined => parseFileLink(destination)?.path;
const session = (destination: string): string | undefined => parseFileLink(destination)?.sessionId;

test('资源地址', () => {
  assert.equal(path('dsh-resource://file/session/s/src/a.ts'), 'src/a.ts');
  assert.equal(session('dsh-resource://file/session/s/src/a.ts'), 's');
  // 地址里的空路径段就是绝对路径（Web 用双斜杠表达 /etc/hosts）。
  assert.equal(path('dsh-resource://file/session/s//etc/hosts'), '/etc/hosts');
  assert.equal(path('dsh-resource://file/session/s/D:/x.ts'), 'D:/x.ts');
  assert.equal(path('dsh-resource://file/session/s/./src/a.ts'), './src/a.ts');
  assert.equal(path('dsh-resource://file/absolute/home/me/notes.md'), '/home/me/notes.md');
  assert.equal(session('dsh-resource://file/absolute/home/me/notes.md'), undefined);
  // 盘符段不能再补一个前导斜杠。
  assert.equal(path('dsh-resource://file/absolute/C:/work/x.ts'), 'C:/work/x.ts');
  // 开头多出的空段是 UNC，拼回双斜杠。
  assert.equal(path('dsh-resource://file/absolute//C:/work/x.ts'), '//C:/work/x.ts');
  assert.equal(path('dsh-resource://file/absolute//server/share/a.txt'), '//server/share/a.txt');
  // 别的资源类型不是文件。
  assert.equal(path('dsh-resource://terminal/session/s/1'), undefined);
  assert.equal(path('dsh-resource://file/session/s'), undefined);
  assert.equal(path('dsh-resource://file/session/s/'), undefined);
  assert.equal(path('dsh-resource://file/session//a.txt'), undefined);
});

test('百分号编码', () => {
  assert.equal(path('dsh-resource://file/session/s%201/w/a%20b%23c%3F.txt'), 'w/a b#c?.txt');
  assert.equal(session('dsh-resource://file/session/s%201/w/a%20b%23c%3F.txt'), 's 1');
  // 加号是文件名里的加号，不是空格。
  assert.equal(path('dsh-resource://file/session/s/w/a+b.txt'), 'w/a+b.txt');
  assert.equal(path('dsh-resource://file/session/s/w/a%2Bb.txt'), 'w/a+b.txt');
  // 坏转义原样保留。
  assert.equal(path('dsh-resource://file/session/s/w/a%zz.txt'), 'w/a%zz.txt');
});

test('行号锚点', () => {
  assert.equal(path('src/main/Foo.kt#L24'), 'src/main/Foo.kt');
  assert.equal(path('src/main/Foo.kt#L24-L30'), 'src/main/Foo.kt');
  assert.equal(path('/etc/hosts#L1'), '/etc/hosts');
  assert.equal(path('dsh-resource://file/session/s/src/a.ts#L24'), 'src/a.ts');
  assert.equal(path('file:///w/a.txt#L3'), '/w/a.txt');
  assert.equal(parseInlineCodeFileLink('src/main/Foo.kt#L24')?.path, 'src/main/Foo.kt');
  // 不是行号锚点的片段：整条链接不算文件。
  assert.equal(path('docs/a.md#section'), undefined);
  assert.equal(path('docs/a.md#'), undefined);
  assert.equal(path('docs/a.md#L0'), undefined);
  assert.equal(path('docs/a.md#L9-L2'), undefined);
  // 查询串同理。
  assert.equal(path('docs/a.md?plain=1'), undefined);
});

test('file:// 地址', () => {
  assert.equal(path('file:///Users/me/a.txt'), '/Users/me/a.txt');
  assert.equal(path('file://host/Users/me/a.txt'), '/Users/me/a.txt');
  assert.equal(path('file:///w/a%20b.txt'), '/w/a b.txt');
  assert.equal(path('file://host'), undefined);
});

test('普通路径', () => {
  assert.equal(path('/etc/hosts'), '/etc/hosts');
  assert.equal(path('src/main/Foo.kt'), 'src/main/Foo.kt');
  assert.equal(path('docs/readme.md'), 'docs/readme.md');
  assert.equal(path('C:\\work\\x.ts'), 'C:/work/x.ts');
});

test('行内代码 token', () => {
  assert.equal(parseInlineCodeFileLink('src/main/Foo.kt')?.path, 'src/main/Foo.kt');
  assert.equal(parseInlineCodeFileLink('docs/readme.md')?.path, 'docs/readme.md');
  assert.equal(parseInlineCodeFileLink('/etc/hosts')?.path, '/etc/hosts');
  assert.equal(parseInlineCodeFileLink('dsh-resource://file/session/s/src/a.ts')?.path, 'src/a.ts');
  assert.equal(parseInlineCodeFileLink('file:///w/a.txt')?.path, '/w/a.txt');
  for (const token of ['npm run build', 'session/list', 'and/or', 'a/b', 'README', '//example.com/a.md',
    'https://example.com/a.md', 'app/src/test/', 'foo.', '.hidden/x']) {
    assert.equal(parseInlineCodeFileLink(token), undefined, token);
  }
});

test('外部地址与页内锚点', () => {
  for (const destination of ['', '   ', '#section', 'https://example.com/a', 'http://example.com/a',
    'mailto:someone@example.com', 'tel:+123', 'data:text/plain,hello']) {
    assert.equal(path(destination), undefined, destination);
  }
});

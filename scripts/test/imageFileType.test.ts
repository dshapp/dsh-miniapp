/** 图片扩展名判定：逐条对照安卓 model/ImageFileTypeTest。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isImageDestination, isImageFile } from '../../src/model/imageFileType';

test('识别 web 的整组图片扩展名', () => {
  const images = [
    'a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.svg', 'a.webp', 'a.avif',
    'a.bmp', 'a.ico', 'a.tif', 'a.tiff', 'a.heic', 'a.heif',
  ];
  for (const name of images) {
    assert.equal(isImageFile(name), true, name);
    assert.equal(isImageFile('/tmp/dir/' + name), true, name);
    assert.equal(isImageFile('app/assets/' + name), true, name);
  }
});

test('非图片交给文本预览', () => {
  const others = [
    'a.txt', 'a.kt', 'a.md', 'a.json', 'a.pdf', 'a.mp4', 'a.zip',
    'image', 'a.', '.png', 'archive.png.zip', 'a.PNGX',
  ];
  for (const name of others) {
    assert.equal(isImageFile(name), false, name);
  }
});

test('大小写不敏感', () => {
  assert.equal(isImageFile('Screenshot.PNG'), true);
  assert.equal(isImageFile('Photo.JPEG'), true);
});

test('认 Windows 分隔符', () => {
  assert.equal(isImageFile('C:\\work\\shot.png'), true);
  assert.equal(isImageFile('docs/diagram.svg'), true);
});

test('目录里的点不影响无扩展名文件', () => {
  assert.equal(isImageFile('/tmp/v1.2/README'), false);
  assert.equal(isImageFile('/tmp/a.png/file'), false);
});

test('图片语法的落点：无扩展名的附件对象也当图片（对齐安卓 isImageDestination）', () => {
  // 回归：![…](</Users/u/.dsh/attachments/v1/objects/80/80523a84…>) 只剩 alt 文字。
  assert.equal(isImageDestination('/Users/u/.dsh/attachments/v1/objects/80/80523a84ba40b9b6'), true);
  assert.equal(isImageDestination('/tmp/v1.2/shot'), true);
  assert.equal(isImageDestination('/tmp/shot.PNG'), true);
  assert.equal(isImageDestination('/tmp/notes.txt'), false);
  assert.equal(isImageDestination('/tmp/archive.png.zip'), false);
  // 普通文件链接的分流不变。
  assert.equal(isImageFile('/Users/u/.dsh/attachments/v1/objects/80/80523a84ba40b9b6'), false);
});

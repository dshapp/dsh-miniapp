/** 原生图片预览的同组地址：按显示顺序、跳过未取到的、被点的那张必在。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { previewUrls } from '../../src/model/imagePreview';

test('同组已取到的图按显示顺序进预览', () => {
  assert.deepEqual(previewUrls(['wxfile://a', undefined, 'wxfile://c'], 'wxfile://c'), ['wxfile://a', 'wxfile://c']);
});

test('被点的那张还没登记进组时补在末尾', () => {
  assert.deepEqual(previewUrls([undefined, 'wxfile://b'], 'wxfile://x'), ['wxfile://b', 'wxfile://x']);
  assert.deepEqual(previewUrls([], 'wxfile://x'), ['wxfile://x']);
});

test('同一张图出现两次只留一份，空串跳过', () => {
  assert.deepEqual(previewUrls(['wxfile://a', '', 'wxfile://a'], 'wxfile://a'), ['wxfile://a']);
});

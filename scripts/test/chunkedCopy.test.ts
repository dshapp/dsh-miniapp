/**
 * 工作区文件分片搬运：逐条对照安卓 state/WorkspaceFileChunkedCopyTest。
 *
 * 这一步错了会丢字节（图片打不开）、死转（eof 为假却给空片），或者把整份文件攥在内存里。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { base64ByteLength, copyWorkspaceFileChunked } from '../../src/model/chunkedCopy';

const encode = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

/** 收集写出的片，还原成完整正文。 */
function sink() {
  const parts: string[] = [];
  return {
    parts,
    write(data: string, first: boolean) {
      if (first) parts.length = 0;
      parts.push(data);
    },
    text(): string {
      return parts.map(part => Buffer.from(part, 'base64').toString('utf8')).join('');
    },
    bytes(): number {
      return parts.reduce((total, part) => total + Buffer.from(part, 'base64').length, 0);
    },
  };
}

test('按顺序拼接每一片', async () => {
  const parts = ['aaaa', 'bbbb', 'cc'];
  const out = sink();
  let calls = 0;
  const written = await copyWorkspaceFileChunked({
    chunkBytes: 4,
    limit: Number.MAX_SAFE_INTEGER,
    write: out.write,
    fetch: async (offset) => {
      calls += 1;
      // 游标必须按已写字节推进，而不是按整份文件的长度。
      assert.equal(offset, (calls - 1) * 4);
      const index = calls - 1;
      return { bytes: 12, data: encode(parts[index]), eof: index === parts.length - 1 };
    },
  });
  assert.equal(written, 10);
  assert.equal(calls, 3);
  assert.equal(out.text(), 'aaaabbbbcc');
});

test('任意字节边界都不损坏数据', async () => {
  const raw = Buffer.from('中文图片.png', 'utf8');
  const out = sink();
  const written = await copyWorkspaceFileChunked({
    chunkBytes: 3,
    limit: Number.MAX_SAFE_INTEGER,
    write: out.write,
    fetch: async (offset) => {
      const end = Math.min(offset + 3, raw.length);
      return { bytes: raw.length, data: raw.subarray(offset, end).toString('base64'), eof: end >= raw.length };
    },
  });
  assert.equal(written, raw.length);
  assert.equal(out.bytes(), raw.length);
  assert.equal(out.text(), '中文图片.png');
});

test('声明的总长就超限时一片都不写', async () => {
  const out = sink();
  await assert.rejects(
    copyWorkspaceFileChunked({
      chunkBytes: 4, limit: 4, write: out.write,
      fetch: async () => ({ bytes: 999, data: encode('aaaa'), eof: false }),
    }),
    /too large/,
  );
  assert.equal(out.parts.length, 0);
});

test('越过上限就停下', async () => {
  const out = sink();
  await assert.rejects(
    copyWorkspaceFileChunked({
      chunkBytes: 4, limit: 6, write: out.write,
      fetch: async (offset) => ({ bytes: 8, data: encode('aaaa'), eof: offset >= 8 }),
    }),
    /too large/,
  );
  assert.ok(out.bytes() <= 8);
});

test('主机不推进时报错而不是空转', async () => {
  const out = sink();
  await assert.rejects(
    copyWorkspaceFileChunked({
      chunkBytes: 4, limit: Number.MAX_SAFE_INTEGER, write: out.write,
      fetch: async () => ({ bytes: 10, data: '', eof: false }),
    }),
    /stalled/,
  );
});

test('base64 长度不解码也能算准', () => {
  for (const text of ['', 'a', 'ab', 'abc', 'abcd', '中文图片.png', 'x'.repeat(1000)]) {
    const encoded = Buffer.from(text, 'utf8').toString('base64');
    assert.equal(base64ByteLength(encoded), Buffer.byteLength(text, 'utf8'), JSON.stringify(text));
  }
  // 折行的 base64（主机可能按 MIME 折行）同样要算准。
  const raw = Buffer.from('x'.repeat(300), 'utf8').toString('base64');
  const wrapped = raw.replace(/(.{76})/g, '$1\n');
  assert.equal(base64ByteLength(wrapped), 300);
});

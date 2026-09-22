/**
 * 工作区文件的分片搬运（对齐 Android `PhoneModel.copyWorkspaceFileChunked`）。
 *
 * 图片要先落地再交给系统查看器，这一步错了会：
 *  1) 把整份文件一次攥在内存里（低端机 OOM）；
 *  2) 丢字节或重复字节（图片打不开或花屏）；
 *  3) `eof` 为假却拿到空片时一直空转。
 *
 * 只做字节搬运、不碰网络：`fetch` 与 `write` 都由调用方注入，因此可以在 node 里直接测。
 */

/** `workspaceFiles/readBytes` 的一窗应答。 */
export interface WorkspaceFileChunk {
  /** **整份文件**的长度，不是这一片的长度——推进游标只能用这一片实际拿到的字节数。 */
  bytes: number;
  /** 这一片的 base64 正文。 */
  data: string;
  eof: boolean;
}

export interface ChunkedCopyOptions {
  /** 每次向主机要多少字节（主机 readBytes 默认上限 2 MiB）。 */
  chunkBytes: number;
  /** 文件大小上限；超过就放弃，调用方负责删掉半截文件。 */
  limit: number;
  fetch: (offset: number, length: number) => Promise<WorkspaceFileChunk>;
  /** 落盘一片 base64；`first` 为真表示这是第一片（覆盖写），否则追加写。 */
  write: (data: string, first: boolean) => void;
}

/** base64 字符串解出来有多少字节；不真的解码，只按长度与结尾的 `=` 计算。 */
export function base64ByteLength(data: string): number {
  let length = 0;
  let padding = 0;
  for (let i = 0; i < data.length; i += 1) {
    const ch = data[i];
    // 主机可能按 MIME 折行，空白不计入长度。
    if (ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t') continue;
    if (ch === '=') padding += 1;
    else length += 1;
  }
  if (length === 0) return 0;
  return Math.max(0, Math.floor(((length + padding) * 3) / 4) - padding);
}

/**
 * 逐片读回并写出，返回实际写了多少字节。
 *
 * 三条退出规则，任何一条不满足就抛错，交给调用方去提示：
 *  · 第一片带回的 `bytes`（整份文件的长度）就超过 `limit`，直接放弃，不白下一遍；
 *  · 累计写入超过 `limit`，停在超限那一刻；
 *  · `eof` 为假却给回空片，说明主机没有推进，再循环就是死转。
 */
export async function copyWorkspaceFileChunked(options: ChunkedCopyOptions): Promise<number> {
  let offset = 0;
  let written = 0;
  for (;;) {
    const window = await options.fetch(offset, options.chunkBytes);
    if (written === 0 && window.bytes > options.limit) throw new Error('file is too large to open');
    const size = base64ByteLength(window.data);
    if (size > 0) {
      options.write(window.data, written === 0);
      written += size;
    }
    if (written > options.limit) throw new Error('file is too large to open');
    if (window.eof) break;
    if (size === 0) throw new Error('file read stalled');
    // 游标按**这一片**的字节数推进：`window.bytes` 是整份文件的长度，
    // 拿它推进等于第一片之后直接跳到文件末尾，后面的片全都读不回来（图片被静默截断）。
    offset += size;
  }
  return written;
}

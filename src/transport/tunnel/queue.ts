/**
 * 一个可按「读满 N 字节 / 读一行」消费的字节队列。
 *
 * TCP 到达的是任意切分的 chunk，HTTP 与 WebSocket 都需要"等我够 N 个字节"。
 * [end] 之后所有等待中的读都会失败，避免连接断开时调用方永久挂起。
 */

import { bytesToUtf8, concat } from './crypto/bytes';

export class ByteQueue {
  private buffer: Uint8Array = new Uint8Array(0);
  private ended = false;
  private failure: Error | undefined;
  private waiter: (() => void) | undefined;

  push(chunk: Uint8Array): void {
    if (this.ended) return;
    if (chunk.length === 0) return;
    this.buffer = this.buffer.length === 0 ? chunk : concat(this.buffer, chunk);
    this.notify();
  }

  /** 关闭队列；原因会作为后续所有读的异常抛出。 */
  end(reason?: Error): void {
    if (this.ended) return;
    this.ended = true;
    this.failure = reason;
    this.notify();
  }

  get closed(): boolean {
    return this.ended;
  }

  /** 读满 [count] 字节。 */
  async readExactly(count: number): Promise<Uint8Array> {
    if (count === 0) return new Uint8Array(0);
    while (this.buffer.length < count) {
      if (this.ended) throw this.failure ?? new Error('connection closed');
      await this.waitForData();
    }
    return this.take(count);
  }

  /** 读到换行（不含 CRLF），用于 HTTP 头与 WebSocket 之外的文本协议。 */
  async readLine(): Promise<string> {
    for (;;) {
      const index = this.indexOfNewline();
      if (index >= 0) {
        const raw = this.take(index + 1);
        let end = raw.length;
        if (end > 0 && raw[end - 1] === 0x0a) end -= 1;
        if (end > 0 && raw[end - 1] === 0x0d) end -= 1;
        return bytesToUtf8(raw.slice(0, end));
      }
      if (this.ended) throw this.failure ?? new Error('connection closed');
      await this.waitForData();
    }
  }

  private indexOfNewline(): number {
    for (let i = 0; i < this.buffer.length; i += 1) if (this.buffer[i] === 0x0a) return i;
    return -1;
  }

  private take(count: number): Uint8Array {
    const out = this.buffer.slice(0, count);
    this.buffer = this.buffer.slice(count);
    return out;
  }

  private notify(): void {
    const waiter = this.waiter;
    this.waiter = undefined;
    if (waiter !== undefined) waiter();
  }

  /**
   * 等下一次数据到达。
   *
   * 这里**不能**因为「当前缓冲非空」就直接返回：调用方要的是「够 N 字节」，
   * 缓冲非空但不够时立刻返回会让 readExactly 在微任务里空转，socket 的 I/O 回调
   * 永远排不上队（真机上表现为握手卡死）。所以只有 [push] / [end] 才唤醒。
   */
  private waitForData(): Promise<void> {
    if (this.ended) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiter = resolve;
    });
  }
}

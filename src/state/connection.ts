import { Store } from './store';
import type { ConnectionTone } from '../ui/connectionBanner';

/**
 * 与主机的连接态。
 *
 * 与 Android 的 PhoneModel.Connection 同构，单独一个 Store 是因为列表页、设置页、
 * 聊天页都要读它，而 AppModel 还持有别的状态；拆开之后每个页面只订阅自己关心的那一份。
 */
export type Connection =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'connected'; profileId?: string }
  | { kind: 'failed'; message: string }
  | { kind: 'reconnecting'; message?: string };

export const connectionStore = new Store<Connection>({ kind: 'idle' });

/** WebSocket 层的连接态：与 HTTP 层分开，因为它自己会重连。 */
export type SocketState = 'connected' | 'reconnecting' | undefined;

export const socketStateStore = new Store<SocketState>(undefined);

/**
 * 连接态 → 横幅色调。`idle` 返回 undefined：还没连过（首配、主动断开）不该被判成故障
 * 报「连不上主机」——空闲不是错误（对齐 Android ConnectionBanner 的 Connection.Idle → null）。
 */
export function connectionTone(connection: Connection): ConnectionTone {
  switch (connection.kind) {
    case 'connected':
      return 'connected';
    case 'connecting':
      return 'connecting';
    case 'failed':
      return 'failed';
    case 'reconnecting':
      return 'reconnecting';
    // 空闲在状态点上是红的（对齐 Android connectionTone 的 Connection.Idle → error），
    // 但在横幅上不画——「还没连」不是故障。横幅用的是 connectionBannerTone。
    case 'idle':
      return 'failed';
  }
}

/**
 * 横幅专属的连接态：已连接与空闲都不画（对齐 Android ConnectionBanner.kt 的 when）。
 *
 * 与 connectionTone 分开是因为同一个 Connection 在两处的口径不同：状态点把空闲当红色，
 * 横幅却要保持安静。
 *
 * 重连优先于失败（对齐 Android ConnectionBanner.kt:124-126：安卓在渲染横幅时同时读
 * `socketState` 与 `connection`，`RECONNECTING || Connecting` 一律先给「连接中」）。
 * 小程序的 HTTP 刷新失败与 WebSocket 自愈是两条独立的写路径，只读 connectionStore 会
 * 出现「HTTP 刚报失败、socket 正在重连」被画成「连不上」的相反结论——所以这里在
 * connection 之外再叠一层 socketState，重连中一律按连接中处理。
 *
 * `socketState` 默认现取 socketStateStore：socket 状态变化时 appModel 也会同步改写
 * connectionStore，订阅 connectionStore 的调用方（app.tsx）照样会重绘，无需改签名。
 */
export function connectionBannerTone(
  connection: Connection,
  socketState: SocketState = socketStateStore.get(),
): ConnectionTone | undefined {
  if (socketState === 'reconnecting' || connection.kind === 'connecting') return 'connecting';
  switch (connection.kind) {
    case 'failed':
      return 'failed';
    case 'reconnecting':
      return 'reconnecting';
    case 'connected':
    case 'idle':
      return undefined;
  }
}

export function connectionSummary(connection: Connection): string | undefined {
  if (connection.kind === 'failed') return connection.message;
  if (connection.kind === 'reconnecting') return connection.message;
  return undefined;
}

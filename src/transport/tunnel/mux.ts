/**
 * 隧道上的多路下行连接。
 *
 * 语义与 [../local.ts] 的 `LocalMux` 完全一致（同一条 `/api/remote.mux` 协议、同样的
 * open/cancel/item/error/end 帧），差别只在底层：WS 帧跑在 Noise 隧道里，所以升级要独占
 * 一条隧道连接，并且重连时整条隧道（TCP + Noise 握手）都要重来。
 *
 * 退避 + 抖动与直连一致：稳定 30s 后退避归零，否则翻倍封顶 10s。
 */

import { jget, parseJson, str, type JsonValue } from '../../model/json';
import type { MuxConnection, MuxEvent, WsConnectionState } from '../types';
import { createRandomSource } from './random';
import { dialTunnel, type TunnelStream } from './stream';
import type { SocketFactory } from './socket';
import { WeappWssSocketFactory } from './wsSocket';
import { TunnelWebSocket } from './websocket';
import type { KeyPair } from './noise';

const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 10_000;
const STABLE_GENERATION_MS = 30_000;
/**
 * 平台每 5 分钟只给 20 条 TCPSocket（创建即计数）。重连一旦撞上配额，按
 * 10s 上限退避也还有 30 次/5 分钟，反而会把配额永久占死，连 RPC 那条
 * 都建不出来。撞配额时退到一分钟以上，把窗口让给一次真正能成的连接。
 */
const QUOTA_BACKOFF_MS = 65_000;
const DIAL_TIMEOUT_MS = 15_000;

/**
 * 探活用的一次性 streamId：不会被任何真实流占用，主机对未知 streamId 的 cancel 就是 no-op。
 *
 * 帧必须是主机认识的上行形状。之前这里发的是 `{"type":"ping"}`：主机只接受
 * `{type:"cancel",streamId}` 与 `{type:"open",streamId,endpoint,payload}`，其余一律抛错，
 * socket 处理器 catch 后 `close(1008)`。于是每次回前台都会拆掉一条健康连接——退避重连期间
 * 非 connected 的状态切换还会清空待审批/待回答，而 snapshot 不会重送。
 * （对齐 Android MuxStream.probeFrame，并由 MuxProbeFrameTest 钉住。）
 */
const PROBE_STREAM_ID = 'wake-probe';

interface Subscription { streamId: string; endpoint: string; args: JsonValue }

export interface TunnelMuxOptions {
  host: string;
  port: number;
  bridgeKey: Uint8Array;
  deviceKey: KeyPair;
  pairingToken?: Uint8Array;
  factory?: SocketFactory;
}

export class TunnelMux implements MuxConnection {
  private readonly subscriptions = new Map<string, Subscription>();
  private openedStreamIds = new Set<string>();
  private socket: TunnelWebSocket | null = null;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backoff = BACKOFF_BASE_MS;
  private openedAt = 0;
  /** 第几代连接：onClose 靠它判断自己属不属于当前这一代。 */
  private generation = 0;
  /** 一次性配对码，只随第一次握手发出去。 */
  private pairingToken?: Uint8Array;
  private lastState?: WsConnectionState;
  private readonly factory: SocketFactory;

  constructor(
    private readonly options: TunnelMuxOptions,
    private readonly onEvent: (event: MuxEvent) => void,
    private readonly onState?: (state: WsConnectionState) => void,
  ) {
    this.factory = options.factory ?? new WeappWssSocketFactory();
    this.pairingToken = options.pairingToken;
    this.runLoop();
  }

  subscribe(streamId: string, endpoint: string, args: JsonValue = {}): void {
    const existing = this.subscriptions.get(streamId);
    const subscription: Subscription = { streamId, endpoint, args };
    this.subscriptions.set(streamId, subscription);
    if (this.socket === null) return;
    const changed = existing !== undefined && (existing.endpoint !== endpoint || JSON.stringify(existing.args) !== JSON.stringify(args));
    if (changed) {
      this.openedStreamIds.add(streamId);
      this.sendCancel(streamId);
      this.sendOpen(subscription);
      return;
    }
    // 幂等：这一代连接上已经开过的流不再发第二条 open。`Set.add` 返回的是 Set 本身
    // （恒真），拿它当「新加入」的判据等于每次订阅都重发 open；主机对重复 streamId
    // 直接抛错并 `close(1008)`，整条下行就此断掉（对齐 Android `openedStreamIds.add`
    // 的 Boolean 语义）。
    if (this.openedStreamIds.has(streamId)) return;
    this.openedStreamIds.add(streamId);
    this.sendOpen(subscription);
  }

  unsubscribe(streamId: string): void {
    this.subscriptions.delete(streamId);
    this.openedStreamIds.delete(streamId);
    this.sendCancel(streamId);
  }

  isSubscribed(streamId: string): boolean {
    return this.subscriptions.has(streamId);
  }

  private consumePairingToken(): Uint8Array | undefined {
    const token = this.pairingToken;
    this.pairingToken = undefined;
    return token;
  }

  /** 探活帧的正文；单独抽出来便于钉住它符合主机 parseRemoteStreamClientMessage 的口径。 */
  probeFrame(): string {
    return JSON.stringify({ type: 'cancel', streamId: PROBE_STREAM_ID });
  }

  /** 立刻探活当前这一代连接（回到前台时用）。 */
  probeNow(): void {
    const socket = this.socket;
    if (socket === null) return;
    if (!socket.sendText(this.probeFrame())) {
      // 发不出去说明这一代已经死了：主动废掉，让 runLoop 走重连，而不是对着死 socket 干等。
      console.warn('[mux] wake probe failed; failing the generation');
      socket.close();
      this.handleClosed(this.generation);
    }
  }

  close(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
    this.generation += 1;
    this.openedStreamIds.clear();
  }

  private sendOpen(subscription: Subscription): void {
    this.socket?.sendText(JSON.stringify({
      type: 'open',
      streamId: subscription.streamId,
      endpoint: subscription.endpoint,
      payload: { args: subscription.args },
    }));
  }

  private sendCancel(streamId: string): void {
    this.socket?.sendText(JSON.stringify({ type: 'cancel', streamId }));
  }

  private emitState(state: WsConnectionState): void {
    if (this.lastState === state) return;
    this.lastState = state;
    this.onState?.(state);
  }

  private async runLoop(): Promise<void> {
    if (this.stopped) return;
    this.openedAt = Date.now();
    let socket: TunnelWebSocket;
    // 隧道流先于 WebSocket 建立：升级这一步失败时必须把它关掉，否则每次失败都留下一条
    // 挂着的 TCP 连接，而平台每 5 分钟只给 20 条（创建即计数）。
    let stream: TunnelStream | undefined;
    try {
      // 同步随机源：Noise 握手与之后每一帧的 WS 掩码都从这里取，用量不限。
      const pool = await createRandomSource();
      stream = await dialTunnel({
        factory: this.factory,
        address: this.options.host,
        port: this.options.port,
        bridgeKey: this.options.bridgeKey,
        deviceKey: this.options.deviceKey,
        // 一次性配对码用掉即弃：重连不再重发（对齐 Android consumePairingToken）。
        pairingToken: this.consumePairingToken(),
        random: pool,
        connectTimeoutMs: DIAL_TIMEOUT_MS,
      });
      // onClose 认「第几代连接」而不是那个还没赋值的 socket 变量：升级刚完成就断开时，
      // 闭包读到的 socket 还是 undefined，handleClosed 会把它当成「不是当前这一代」
      // 静默返回，重连就此不再发生。
      const generation = this.generation;
      socket = await TunnelWebSocket.connect({
        stream,
        path: '/api/remote.mux',
        host: MOBILE_HOST,
        random: pool,
        handlers: { onText: (text) => this.handleFrame(text), onClose: () => this.handleClosed(generation) },
      });
    } catch (error) {
      stream?.close();
      // 四类失败（DNS / Noise 握手 / WS 升级 / 平台配额）在界面上长得一模一样，
      // 不留一行日志就只能靠猜（对齐 Android onFailure 的异常类名 + http code）。
      console.warn('[mux] generation failed:', error instanceof Error ? `${error.name}: ${error.message}` : error);
      this.scheduleReconnect(error);
      return;
    }
    if (this.stopped) {
      socket.close();
      return;
    }
    this.socket = socket;
    this.openedStreamIds = new Set(this.subscriptions.keys());
    for (const subscription of this.subscriptions.values()) this.sendOpen(subscription);
    this.onEvent({ kind: 'opened' });
    this.emitState('connected');
  }

  private handleFrame(text: string): void {
    if (text.length === 0) return;
    const frame = parseJson(text);
    if (frame === undefined) return;
    const streamId = str(jget(frame, 'streamId')) ?? '';
    switch (str(jget(frame, 'type'))) {
      case 'item':
        this.onEvent({ kind: 'item', streamId, value: jget(frame, 'value') ?? null });
        break;
      case 'error': {
        const error = jget(frame, 'error');
        this.onEvent({
          kind: 'failure',
          streamId,
          error: {
            code: str(jget(error, 'code')) ?? 'internal',
            message: str(jget(error, 'message')) ?? 'stream failed',
          },
        });
        break;
      }
      case 'end':
        this.onEvent({ kind: 'end', streamId });
        break;
      default:
        break;
    }
  }

  private handleClosed(generation: number): void {
    if (this.generation !== generation) return;
    this.generation += 1;
    this.socket = null;
    this.openedStreamIds.clear();
    if (this.stopped) return;
    this.scheduleReconnect();
  }

  private scheduleReconnect(error?: unknown): void {
    if (this.stopped || this.timer !== null) return;
    const message = error instanceof Error ? error.message : '';
    const quota = /quota|created too much/i.test(message);
    const lasted = Date.now() - this.openedAt;
    if (lasted >= STABLE_GENERATION_MS) this.backoff = BACKOFF_BASE_MS;
    this.emitState('reconnecting');
    const delay = quota
      ? QUOTA_BACKOFF_MS
      : Math.min(this.backoff, BACKOFF_CAP_MS) / 2 + Math.random() * (Math.min(this.backoff, BACKOFF_CAP_MS) / 2);
    if (!quota) this.backoff = Math.min(this.backoff * 2, BACKOFF_CAP_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runLoop();
    }, delay);
  }
}

/** 隧道里 Host 头用占位名（与 Android 的 `mobile.dsh` 一致），桥接不按它路由。 */
export const MOBILE_HOST = 'mobile.dsh';

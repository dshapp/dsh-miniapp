import type { HistoryEntry, SessionSummary } from '../model/types';
import { readStorage, writeStorage } from './store';

/** 一份可以立刻画出来、随后交给远端覆盖的会话窗口。 */
export interface CachedWindow {
  /** 快照当时的权威尾序号；落盘时还不知道就留 -1，读回后不 subscribe 即可。 */
  cursor: number;
  hasMore: boolean;
  records: HistoryEntry[];
}

const MAX_CACHED_WINDOWS = 24;
const MAX_CACHED_RECORDS = 4000;

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function key(profileId: string, suffix: string): string {
  return `dsh.cache.${sanitize(profileId)}.${suffix}`;
}

/**
 * 会话清单与历史窗口的本地缓存，用来做 stale-while-revalidate：
 * 冷启动先把上次的样子画出来，同时照常连远端，基线回来整体替换。
 *
 * 权威性永远在远端——这里存的任何东西都只是「先看着」，不参与任何序号/去重判定。
 *
 * 与 Android 的 SessionCache 相比这里不分文件而分 wx 存储键，但同样按主机（profile）
 * 隔离：两台主机的会话 id 不能互相顶替。
 */
class SessionCache {
  private profileId = 'default';

  /** 换主机时切命名空间；已写入的数据保留，换回来还能用。 */
  setProfile(profileId: string): void {
    this.profileId = profileId.length > 0 ? profileId : 'default';
  }

  loadRoster(): SessionSummary[] {
    const raw = readStorage(key(this.profileId, 'roster'));
    if (raw === undefined) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed as SessionSummary[];
    } catch {
      return [];
    }
  }

  saveRoster(items: SessionSummary[]): void {
    // 空清单不写：一次失败的刷新、或者刚 teardown 完的空状态，会把上一份能用的底稿抹掉，
    // 下次冷启动就只剩一片空白（对齐 Android `if (items.isEmpty()) return`）。
    if (items.length === 0) return;
    // 记录数上限比窗口更严：清单只是「先看着」，太大反而拖慢冷启动。
    const clipped = items.slice(0, MAX_CACHED_RECORDS);
    writeStorage(key(this.profileId, 'roster'), JSON.stringify(clipped));
  }

  loadWindow(sessionId: string): CachedWindow | undefined {
    const raw = readStorage(key(this.profileId, `w_${sanitize(sessionId)}`));
    if (raw === undefined) return undefined;
    try {
      const parsed = JSON.parse(raw) as CachedWindow;
      if (!Array.isArray(parsed.records)) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  saveWindow(sessionId: string, window: CachedWindow): void {
    const clipped = window.records.slice(-MAX_CACHED_RECORDS);
    const suffix = `w_${sanitize(sessionId)}`;
    writeStorage(key(this.profileId, suffix), JSON.stringify({ ...window, records: clipped } satisfies CachedWindow));
    this.touchWindowIndex(suffix);
    this.pruneWindows();
  }

  removeWindow(sessionId: string): void {
    try {
      wx.removeStorageSync(key(this.profileId, `w_${sanitize(sessionId)}`));
    } catch {
      // 删不掉不影响主流程。
    }
  }

  clear(): void {
    for (const suffix of this.windowKeys()) {
      try {
        wx.removeStorageSync(key(this.profileId, suffix));
      } catch {
        // 同上。
      }
    }
  }

  /** 超出窗口上限时按写入时间淘汰最旧的几个。 */
  private pruneWindows(): void {
    const keys = this.windowKeys();
    if (keys.length <= MAX_CACHED_WINDOWS) return;
    const excess = keys.length - MAX_CACHED_WINDOWS;
    for (const suffix of keys.slice(0, excess)) {
      try {
        wx.removeStorageSync(key(this.profileId, suffix));
      } catch {
        // 同上。
      }
    }
  }

  /** wx 没有枚举带前缀键的 API，这里用本地维护的索引补偿。 */
  private windowKeys(): string[] {
    const raw = readStorage(key(this.profileId, 'windowIndex'));
    if (raw === undefined) return [];
    // 索引里可能有已被外部删掉的键，读的时候顺手剔掉，免得淘汰逻辑空转。
    return raw
      .split('\n')
      .filter(item => item.length > 0)
      .filter(item => readStorage(key(this.profileId, item)) !== undefined);
  }

  private touchWindowIndex(suffix: string): void {
    const keys = this.windowKeys().filter(item => item !== suffix);
    keys.push(suffix);
    writeStorage(key(this.profileId, 'windowIndex'), keys.join('\n'));
  }

}

export const sessionCache = new SessionCache();

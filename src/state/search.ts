import { Store } from './store';
import type { SessionSearchItem } from '../model/types';

/**
 * 主机内容命中（session/search）的快照；本地标题/工作区名匹配在页面里即时算。
 *
 * `query` 是这份命中对应的查询词：与当前输入不一致就视为还在等（pending），页面丢弃旧命中。
 * 主机失败（例如 open_at: never 的部署拒绝 session/search）落成空命中，页面只显示本地命中，
 * 不做任何「不可用」提示（对齐 web）。
 */
export interface SearchState {
  query: string;
  items: SessionSearchItem[];
  hasMore: boolean;
}

export const searchStore = new Store<SearchState>({ query: '', items: [], hasMore: false });

import { Store } from './store';
import type { SessionSearchItem } from '../model/types';

/**
 * 会话搜索的对外快照。
 *
 * 命中分两路：本地标题/工作区名即时匹配（在页面里算），主机内容命中（这里）。
 * 主机的内容检索是可选能力（open_at: never 的部署直接拒绝 session/search），
 * 所以「不可用」必须与「没有命中」分开表达，否则页面只能把失败画成空结果。
 */
export interface SearchState {
  /** 这份命中对应的查询词；与当前输入不一致时页面丢弃它。 */
  query: string;
  hits?: SessionSearchItem[];
  contentUnavailable: boolean;
}

export const searchStore = new Store<SearchState>({ query: '', contentUnavailable: false });

/**
 * 模型选择的排序与搜索（dsh 0.2.0 #4787，对齐 Android model/ModelSearch.kt）。
 *
 * - 供应商顺序：web `orderModelProviders`（ui-model-selection/provider-order.ts）；
 * - 搜索排名：web `rankByName`（ui-primitives/rank-by-name.ts），打分 DP 逐行照抄。
 */
import type { ModelProviderGroup } from './types';

/** 目录里模型超过这个数才出搜索框（web `ModelSelect` 的 `choices.length > 4`）。 */
export const MODEL_SEARCH_THRESHOLD = 4;

function providerRank(id: string): number {
  return id === 'deepseek-account' ? 0 : id === 'deepseek-official' ? 1 : 2;
}

/** DeepSeek 账号第一、DeepSeek 官方第二，其余保持目录原顺序（稳定排序）。 */
export function orderModelProviders<T extends { readonly id: string }>(groups: readonly T[]): T[] {
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => providerRank(a.group.id) - providerRank(b.group.id) || a.index - b.index)
    .map(entry => entry.group);
}

/** 目录里一共有多少个模型（决定要不要出搜索框）。 */
export function modelChoiceCount(groups: readonly ModelProviderGroup[]): number {
  return groups.reduce((sum, group) => sum + group.models.length, 0);
}

/**
 * 模型面板要画的分组：供应商排好序，每组的模型按查询词排名，空组隐藏。
 * 查询为空时组内顺序不变（仍然去掉没有模型的组）。
 */
export function visibleModelGroups(groups: readonly ModelProviderGroup[], query: string): ModelProviderGroup[] {
  const trimmed = query.trim();
  const visible: ModelProviderGroup[] = [];
  for (const group of orderModelProviders(groups)) {
    const models = rankByName(group.models, trimmed, entry => entry.name);
    if (models.length > 0) visible.push(models === group.models ? group : { ...group, models: [...models] });
  }
  return visible;
}

/** 词首（开头、`-`、`_` 之后）加权。 */
function boundaryBonus(name: string, index: number): number {
  return index === 0 || name.charAt(index - 1) === '-' || name.charAt(index - 1) === '_' ? 8 : 0;
}

/**
 * 有序子序列的最强对齐得分，O(name × query)：词首与连续命中加分，跳过与前导字符扣分。
 * 查询不是名字的子序列时返回 undefined。
 */
function alignmentScore(name: string, query: string): number | undefined {
  if (query.length > name.length) return undefined;
  const noMatch = Number.NEGATIVE_INFINITY;
  let previous = new Array<number>(name.length).fill(noMatch);
  for (let index = 0; index < name.length; index++) {
    if (name.charAt(index) === query.charAt(0)) previous[index] = 1 + boundaryBonus(name, index) - index;
  }
  for (let queryIndex = 1; queryIndex < query.length; queryIndex++) {
    const current = new Array<number>(name.length).fill(noMatch);
    // 一遍扫完上一行：`left` 是前一个字符处的分（连续命中），`leftLeft` 是前两个（最早的跳跃命中）。
    let left = noMatch;
    let leftLeft = noMatch;
    let bestGapped = noMatch;
    for (let index = 0; index < previous.length; index++) {
      const prior = previous[index];
      if (leftLeft !== noMatch) bestGapped = Math.max(bestGapped, leftLeft + index - 2);
      if (name.charAt(index) === query.charAt(queryIndex)) {
        const bonus = 1 + boundaryBonus(name, index);
        let score = noMatch;
        if (left !== noMatch) score = left + bonus + 4;
        if (bestGapped !== noMatch) score = Math.max(score, bestGapped + bonus + 1 - index);
        current[index] = score;
      }
      leftLeft = left;
      left = prior;
    }
    previous = current;
  }
  let best = noMatch;
  for (const score of previous) best = Math.max(best, score);
  return best === noMatch ? undefined : best;
}

/**
 * web `rankByName`：名字里按顺序含有查询词全部字符（大小写不敏感）的才保留；前缀命中在前，
 * 再按对齐得分，最后按原顺序。查询为空时原样返回输入。
 */
export function rankByName<T>(items: readonly T[], rawQuery: string, name: (item: T) => string): readonly T[] {
  const query = rawQuery.toLowerCase();
  if (query === '') return items;
  const ranked: { item: T; index: number; prefix: boolean; score: number }[] = [];
  items.forEach((item, index) => {
    const lower = name(item).toLowerCase();
    const score = alignmentScore(lower, query);
    if (score !== undefined) ranked.push({ item, index, prefix: lower.startsWith(query), score });
  });
  ranked.sort((a, b) => Number(b.prefix) - Number(a.prefix) || b.score - a.score || a.index - b.index);
  return ranked.map(match => match.item);
}

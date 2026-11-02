import { jget, str, type JsonElement } from './json';
import type { AgentPresetEntry, SessionId, SessionSummary, WorkspaceView } from './types';

/**
 * 新建会话页要复用的那条空白会话（对齐 Android model/BlankSessionReuse.kt 与 Mac
 * `materializePendingConversation`）。
 *
 * 同一工作区、同一 cwd、没被归档、且主机还认得出的空白会话可以接着用：用户再次进入
 * 新建会话不该每来一次就多留一条幽灵空白。
 */

/** 会话创建时记下的 Agent 预设：平铺字段优先，其次才是投影里的那份。 */
export function recordedAgentPreset(summary: SessionSummary): string | undefined {
  if (summary.agentPreset !== undefined && summary.agentPreset.length > 0) return summary.agentPreset;
  const projected = str(jget(summary.projections?.values as JsonElement, 'agentPreset'));
  return projected !== undefined && projected.length > 0 ? projected : undefined;
}

/**
 * 这条空白会话主机还认不认（Mac `canResume`）。
 *
 * 会话把自己创建时的 Agent 预设记在头上，主机每次 resume 都按那个**确切**的 id 解析，
 * 没有「退回部署默认值」这一步。所以一条留在已删除/已损坏预设下的空白会话是永久打不开
 * 的：每次 session/follow、session/prompt 都会以 `agent-presets: preset "…" not found` 失败。
 *
 * 目录还没回来时一律放行：错放一条只多留一条空白，错拒一条赔的是用户那条消息。
 */
export function canResumeBlankSession(summary: SessionSummary, agentPresets: AgentPresetEntry[]): boolean {
  const preset = recordedAgentPreset(summary);
  if (preset === undefined || agentPresets.length === 0) return true;
  const entry = agentPresets.find(item => item.id === preset);
  if (entry === undefined) return false;
  return entry.broken === undefined || entry.broken === null || entry.broken.length === 0;
}

/** 该工作区下可复用的空白会话；没有就是 undefined（主机新建一条）。 */
export function reusableBlankSession(
  sessions: SessionSummary[],
  workspace: WorkspaceView | undefined,
  archived: Set<SessionId>,
  agentPresets: AgentPresetEntry[],
): SessionSummary | undefined {
  if (workspace === undefined) return undefined;
  const memberIds = new Set(workspace.sessionIds);
  return sessions.find(summary =>
    summary.blank &&
    summary.cwd === workspace.path &&
    memberIds.has(summary.sessionId) &&
    !archived.has(summary.sessionId) &&
    canResumeBlankSession(summary, agentPresets),
  );
}

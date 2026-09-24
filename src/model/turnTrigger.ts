/**
 * 轮次触发通知的标题与字形（web `turnTriggerDetails`，与 Mac `TurnTriggerNode.presentation` 同表）。
 * 按消息来源 `source.kind` 分派；认不出的来源用通用的「收到执行请求」。
 */
import type { StringKey } from '../i18n/strings';
import type { LucideIconName } from '../ui/lucideIcons';
import { jget, str, type JsonElement } from './json';

export interface TurnTriggerPresentation {
  title: StringKey;
  icon: LucideIconName;
}

export function turnTriggerPresentation(source: JsonElement | undefined): TurnTriggerPresentation {
  switch (str(jget(source, 'kind'))) {
    case 'goal':
      return { title: 'turnTriggerGoal', icon: 'flag' };
    case 'agent-message':
      return { title: 'turnTriggerAgent', icon: 'send' };
    case 'team-message':
      return { title: 'turnTriggerTeam', icon: 'users' };
    case 'subagent-settled':
      return { title: 'turnTriggerSubagent', icon: 'circle-check' };
    case 'webhook':
      return str(jget(source, 'provider')) === 'github'
        ? { title: 'turnTriggerGitHub', icon: 'git-fork' }
        : { title: 'turnTriggerWebhook', icon: 'zap' };
    case 'schedule':
      return { title: 'turnTriggerSchedule', icon: 'timer' };
    case 'tool-jobs':
      return { title: 'turnTriggerJob', icon: 'list' };
    case 'cordis-host-runner':
      return { title: 'turnTriggerPlugin', icon: 'puzzle' };
    default:
      return { title: 'turnTriggerRequest', icon: 'file-text' };
  }
}

/**
 * 轮次触发通知的标题与字形（web `turnTriggerDetails`，与 Mac `TurnTriggerNode.presentation` 同表）。
 * 按消息来源 `source.kind` 分派；认不出的来源用通用的「收到执行请求」。
 */
import type { StringKey } from '../i18n/strings';
import type { LucideIconName } from '../ui/lucideIcons';
import { arr, jget, str, type JsonElement } from './json';
import type { ContentBlock } from './chatNode';
import type { QuestionReplyPair } from './questionFlow';

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
      // 0.2.0（#5137）：「定时任务」改「自动化任务」，字形从闹钟换成时钟。
      return { title: 'turnTriggerSchedule', icon: 'clock' };
    case 'tool-jobs':
      return { title: 'turnTriggerJob', icon: 'list' };
    case 'cordis-host-runner':
      return { title: 'turnTriggerPlugin', icon: 'puzzle' };
    case 'user-question-reply':
      return { title: 'questionReplyLabel', icon: 'reply' };
    default:
      return { title: 'turnTriggerRequest', icon: 'file-text' };
  }
}

/** 自动化任务一次投递里的一条提醒（`reminders_json` 的一项）。 */
export interface ScheduleReminder {
  scheduleId: string;
  occurrenceAt: string;
  prompt: string;
}

/**
 * 自动化任务触发消息里投递的提醒（对齐 Mac `TurnTriggerNode.scheduleReminders`）：
 * 正文里以 `reminders_json:` 开头的那一行是 JSON 数组；别的触发或解析失败返回空数组。
 */
export function scheduleReminders(content: ContentBlock[], source: JsonElement | undefined): ScheduleReminder[] {
  if (str(jget(source, 'kind')) !== 'schedule') return [];
  const prefix = 'reminders_json:';
  for (const block of content) {
    if (block.kind !== 'text') continue;
    for (const line of block.text.split('\n')) {
      if (!line.startsWith(prefix)) continue;
      let list: JsonElement[] | undefined;
      try {
        list = arr(JSON.parse(line.slice(prefix.length)) as JsonElement);
      } catch {
        return [];
      }
      return (list ?? []).flatMap(item => {
        const prompt = str(jget(item, 'reminder_prompt'));
        if (prompt === undefined) return [];
        return [{
          scheduleId: str(jget(item, 'schedule_id')) ?? '',
          occurrenceAt: str(jget(item, 'occurrence_at')) ?? '',
          prompt,
        }];
      });
    }
  }
  return [];
}

/**
 * 迟到的 `ask_user_question` 回答（0.2.0 web `question-reply` 节点）：从消息正文那份
 * `answer_to_pending_question` JSON 里读出「问题 → 答案」；别的消息返回 undefined
 *（对齐 Android TurnTriggerNode.questionReply / Mac QuestionReplyContent）。
 */
export function questionReplyPairs(
  content: ContentBlock[],
  source: JsonElement | undefined,
): QuestionReplyPair[] | undefined {
  if (str(jget(source, 'kind')) !== 'user-question-reply') return undefined;
  const text = content.find((block): block is Extract<ContentBlock, { kind: 'text' }> => block.kind === 'text')?.text;
  if (text === undefined) return undefined;
  let json: JsonElement;
  try {
    json = JSON.parse(text) as JsonElement;
  } catch {
    return undefined;
  }
  const questions = arr(jget(json, 'questions'));
  if (questions === undefined) return undefined;
  const answers = arr(jget(json, 'answers')) ?? [];
  return questions.map(question => {
    const id = str(jget(question, 'id'));
    const answer = answers.find(entry => str(jget(entry, 'id')) === id);
    const values = (arr(jget(answer, 'selected')) ?? [])
      .map(item => str(item))
      .filter((item): item is string => item !== undefined);
    const custom = str(jget(answer, 'custom'));
    if (custom !== undefined && custom.length > 0) values.push(custom);
    return { question: str(jget(question, 'question')) ?? '', answers: values };
  });
}

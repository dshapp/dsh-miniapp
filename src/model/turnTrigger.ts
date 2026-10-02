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

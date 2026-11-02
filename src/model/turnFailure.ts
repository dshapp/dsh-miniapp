import { Strings } from '../i18n/strings';
import { jget, str, type JsonElement } from './json';

/**
 * 一轮以 error 收尾时要显示的原因（对齐 Android model/TurnFailureMessage.kt 与 Mac
 * `turnFailureMessage` / web `failureMessage`）。
 *
 * 主机把 401/403 归纳成 `code == "AUTH"`，随它一起来的 message 是 provider 的原话
 * （"401 Unauthorized: ..."）。那句话对用户既没有可操作性、也不会随界面语言变，所以展示前
 * 换成本地化固定说法；照抄 provider 只会让中文界面里冒出一段英文。
 *
 * 没有 message 时同样落到本地化兜底，而不是硬编码的英文串。
 */
export function turnFailureMessage(reason: JsonElement | undefined): string {
  const failure = jget(reason, 'error');
  if (str(jget(failure, 'code')) === 'AUTH') return Strings.turnFailureAuthInvalid;
  const message = str(jget(failure, 'message'));
  return message !== undefined && message.length > 0 ? message : Strings.turnFailureFallback;
}

/**
 * 一条实时帧要是「失败收尾」，当场读出要展示的原因，否则 undefined。
 *
 * 与 Mac `liveTurnFailureMessage` / Android 同一口径：只看 `turn/end`，且
 * `reason.kind == "error"`。失败事实必须能搭在**这一帧**上发出，而不是等另一条流的
 * `api-session/error`——帧里的 `turn/end` 是这一轮结束的权威记录，用户切走的那条会话
 * 正是靠它才留下提示；只押在另一条流上，等于把「有没有提示」交给它的送达与顺序。
 */
export function liveTurnFailureMessage(event: { type: string; data?: JsonElement }): string | undefined {
  if (event.type !== 'turn/end') return undefined;
  const reason = jget(event.data, 'reason');
  if (str(jget(reason, 'kind')) !== 'error') return undefined;
  return turnFailureMessage(reason);
}

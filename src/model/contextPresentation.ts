import { arr, bool, int, jget, str, type JsonElement } from './json';

/**
 * 一条上下文注入消息按其 `source.form` 实际能渲染成的形态（对齐 Android
 * model/ContextPresentation.kt / Mac `ContextPresentation.renderedForm`）。
 *
 * 声明的 form 只有在它需要的字段可读时才成立；否则退回 undefined，调用方就按
 * 「没有 form」画默认图标。
 */
export type ContextForm = 'instructions' | 'catalog' | 'snapshot' | 'notice' | 'relay' | 'recall';

const CONTEXT_FORMS: ContextForm[] = ['instructions', 'catalog', 'snapshot', 'notice', 'relay', 'recall'];

function fieldsReadable(form: ContextForm, source: JsonElement | undefined): boolean {
  switch (form) {
    case 'instructions':
      return instructionChangesReadable(source);
    case 'catalog':
      return catalogEntriesReadable(source);
    case 'snapshot':
      return snapshotSectionsReadable(source);
    case 'notice': {
      const summary = str(jget(source, 'summary'));
      return summary !== undefined && summary.length > 0;
    }
    case 'relay': {
      const senderSessionId = str(jget(source, 'senderSessionId'));
      return senderSessionId !== undefined && senderSessionId.length > 0;
    }
    case 'recall':
      return recalledSessionsReadable(source);
  }
}

export function contextForm(source: JsonElement | undefined): ContextForm | undefined {
  const declared = str(jget(source, 'form'));
  if (declared === undefined) return undefined;
  const form = CONTEXT_FORMS.find(candidate => candidate === declared);
  if (form === undefined) return undefined;
  return fieldsReadable(form, source) ? form : undefined;
}

/**
 * 折叠时那一行摘要：只有 `notice` 自带一句人能读的话（对齐 Mac
 * `ContextPresentation.collapsedSummary`）。其余 form 返回 undefined，
 * 调用方落回 `provenanceLabel`。
 */
export function contextCollapsedSummary(source: JsonElement | undefined): string | undefined {
  if (contextForm(source) !== 'notice') return undefined;
  const summary = str(jget(source, 'summary'));
  return summary !== undefined && summary.length > 0 ? summary : undefined;
}

function instructionChangesReadable(source: JsonElement | undefined): boolean {
  const list = arr(jget(source, 'changes'));
  if (list === undefined) return false;
  const paths = new Set<string>();
  for (const item of list) {
    const path = str(jget(item, 'path'));
    if (path === undefined || path.length === 0) return false;
    const action = str(jget(item, 'action'));
    if (action !== 'set' && action !== 'replace' && action !== 'remove') return false;
    paths.add(path);
  }
  return paths.size > 0;
}

function catalogEntriesReadable(source: JsonElement | undefined): boolean {
  const list = arr(jget(source, 'entries'));
  if (list === undefined) return false;
  for (const item of list) {
    const name = str(jget(item, 'name'));
    if (name === undefined || name.length === 0) return false;
    // description 必须存在且是字符串（可以为空），与 Mac 的 stringValue 口径一致。
    if (typeof jget(item, 'description') !== 'string') return false;
  }
  return list.length > 0;
}

function snapshotSectionsReadable(source: JsonElement | undefined): boolean {
  const list = arr(jget(source, 'sections'));
  if (list === undefined) return false;
  for (const item of list) {
    const name = str(jget(item, 'name'));
    if (name === undefined || name.length === 0) return false;
    if (typeof jget(item, 'text') !== 'string') return false;
  }
  return list.length > 0;
}

function recalledSessionsReadable(source: JsonElement | undefined): boolean {
  const list = arr(jget(source, 'references'));
  if (list === undefined) return false;
  for (const item of list) {
    const label = str(jget(item, 'label'));
    if (label === undefined || label.length === 0) return false;
    if (int(jget(item, 'retainedMessages')) === undefined) return false;
    if (int(jget(item, 'omittedMessages')) === undefined) return false;
    if (bool(jget(item, 'truncated')) === undefined) return false;
  }
  return list.length > 0;
}

import React from 'react';
import Taro from '@tarojs/taro';
import { Input, Text, Textarea, View } from '@tarojs/components';
import { Strings, fmt } from '../../i18n/strings';
import { back, openPage, pageRoutes } from '../../framework/page';
import { getAppModel } from '../../state/appModel';
import { arr, bool, isObject, jget, str, type JsonObject } from '../../model/json';
import { automationEditError, type ManagedAutomation } from '../../model/management';
import { scheduleCatalog, scheduleDelete, scheduleHistory, scheduleUpdate } from '../../transport/rpcMethods';
import { NavBar, NavIconButton, NavTitle } from '../../ui/navBar';
import { PageShell } from '../../ui/pageShell';
import { managementError, useManagementRefresh } from '../../ui/management';
import styles from '../../ui/management.module.scss';

interface Draft { entry: ManagedAutomation; title: string; prompt: string }
interface History { entry: ManagedAutomation; records: JsonObject[]; nextBefore?: string; pruned: boolean }

async function confirm(content: string): Promise<boolean> {
  const result = await Taro.showModal({ content, confirmText: Strings.managementConfirm, cancelText: Strings.cancel });
  return result.confirm;
}

/**
 * 自动化任务页（对齐安卓 AutomationsScreen，范围收窄）：列出已有规则、改名称与内容（时间规则保持原样）、
 * 删除、看投递历史。没有 schedule/create：「新建」开一个预填好开头的新会话，让智能体去建。
 */
export default function AutomationsPage(): JSX.Element {
  const model = getAppModel();
  const [entries, setEntries] = React.useState<ManagedAutomation[]>([]);
  const [factsReady, setFactsReady] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [notice, setNotice] = React.useState<string | undefined>(undefined);
  const [query, setQuery] = React.useState('');
  const [draft, setDraft] = React.useState<Draft | undefined>(undefined);
  const [history, setHistory] = React.useState<History | undefined>(undefined);

  const refresh = React.useCallback(async () => {
    try {
      // 只换目录，不动编辑中的草稿与它的 expected。
      setEntries(await scheduleCatalog(model.managementTransport()));
      setFactsReady(true);
    } catch (reason) {
      setFactsReady(false);
      setError(managementError(reason));
    }
  }, [model]);
  useManagementRefresh('schedule/changed', () => void refresh());

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (reason) {
      setError(managementError(reason));
    } finally {
      setBusy(false);
    }
  };

  const isActive = (entry: ManagedAutomation): boolean => entries.some(item => item.key === entry.key && item.active);

  const save = (): void => {
    const current = draft;
    if (current === undefined || !factsReady || automationEditError(current.title, current.prompt) !== undefined || !isActive(current.entry)) return;
    void run(async () => {
      const outcome = await scheduleUpdate(model.managementTransport(), current.entry, current.title, current.prompt);
      if (isObject(jget(outcome, 'record'))) {
        setDraft(undefined);
        setNotice(Strings.automationsSaved);
      } else {
        setNotice(str(jget(outcome, 'code')) ?? str(jget(outcome, 'message')) ?? JSON.stringify(outcome));
      }
      await refresh();
    });
  };

  const remove = async (entry: ManagedAutomation): Promise<void> => {
    if (busy || !factsReady || !isActive(entry)) return;
    if (!(await confirm(fmt(Strings.automationsDeleteConfirm, entry.title)))) return;
    await run(async () => {
      const outcome = await scheduleDelete(model.managementTransport(), entry);
      setNotice(bool(jget(outcome, 'deleted')) === true ? Strings.automationsDeleted : str(jget(outcome, 'code')) ?? JSON.stringify(outcome));
      await refresh();
    });
  };

  const loadHistory = (entry: ManagedAutomation, more: boolean): void => {
    const before = more ? history?.nextBefore : undefined;
    if (more && before === undefined) return;
    void run(async () => {
      const outcome = await scheduleHistory(model.managementTransport(), entry, before);
      const code = str(jget(outcome, 'code'));
      if (code !== undefined) {
        setError(code);
        return;
      }
      const fresh = (arr(jget(outcome, 'records')) ?? []).filter(isObject);
      const previous = more && history !== undefined ? history.records : [];
      const seen = new Set<string>();
      const records = [...previous, ...fresh].filter(record => {
        const id = str(record.messageId) ?? '';
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      setHistory({ entry, records, nextBefore: str(jget(outcome, 'nextBefore')), pruned: bool(jget(outcome, 'earlierRecordsPruned')) === true });
    });
  };

  const goBack = async (): Promise<void> => {
    if (draft !== undefined) {
      if (await confirm(Strings.automationsDiscard)) setDraft(undefined);
    } else if (history !== undefined) setHistory(undefined);
    else back();
  };

  const action = (text: string, enabled: boolean, onClick: () => void, danger = false): JSX.Element => (
    <Text
      className={(danger ? styles.actionDanger : styles.action) + (enabled ? '' : ' ' + styles.actionOff)}
      onClick={enabled ? onClick : undefined}
    >
      {text}
    </Text>
  );

  const needle = query.trim().toLowerCase();
  const visible = entries
    .filter(entry =>
      needle.length === 0 ||
      entry.title.toLowerCase().includes(needle) ||
      entry.sessionId.toLowerCase().includes(needle) ||
      entry.prompt.toLowerCase().includes(needle),
    )
    .sort((a, b) => Number(b.active) - Number(a.active) || (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''));

  let body: JSX.Element;
  if (draft !== undefined) {
    const invalid = automationEditError(draft.title, draft.prompt);
    const active = isActive(draft.entry);
    body = (
      <View className={styles.card}>
        <Text className={styles.meta}>{draft.entry.sessionId}</Text>
        <Text className={styles.label}>{Strings.automationsFieldTitle}</Text>
        <Input className={styles.input} value={draft.title} disabled={busy} onInput={event => setDraft({ ...draft, title: event.detail.value })} />
        <Text className={styles.label}>{Strings.automationsFieldPrompt}</Text>
        <Textarea
          className={styles.textarea}
          value={draft.prompt}
          disabled={busy}
          maxlength={-1}
          autoHeight
          onInput={event => setDraft({ ...draft, prompt: event.detail.value })}
        />
        <Text className={styles.hint}>{Strings.automationsTimingKept}</Text>
        {invalid === undefined ? null : <Text className={styles.danger}>{fmt(Strings.automationsInvalid, invalid)}</Text>}
        {active ? null : <Text className={styles.danger}>{Strings.automationsInactive}</Text>}
        <View className={styles.actions}>
          {action(Strings.automationsSave, !busy && factsReady && invalid === undefined && active, save)}
          {action(Strings.cancel, !busy, () => void goBack())}
        </View>
      </View>
    );
  } else if (history !== undefined) {
    body = (
      <View>
        <Text className={styles.hint}>{Strings.automationsDeliveryHint}</Text>
        {history.records.length === 0 && !busy ? <Text className={styles.hint}>{Strings.managementEmpty}</Text> : null}
        {history.records.map(record => (
          <View key={str(record.messageId) ?? ''} className={styles.card}>
            <Text className={styles.meta} selectable userSelect>{'messageId: ' + (str(record.messageId) ?? '')}</Text>
            <Text className={styles.meta}>{fmt(Strings.automationsScheduledAt, str(record.scheduledAt) ?? '')}</Text>
            <Text className={styles.meta}>{fmt(Strings.automationsDeliveredAt, str(record.deliveredAt) ?? '')}</Text>
            <Text className={styles.detail} selectable userSelect>{str(record.prompt) ?? Strings.automationsLegacyReceipt}</Text>
          </View>
        ))}
        {history.pruned ? <Text className={styles.hint}>{Strings.automationsPruned}</Text> : null}
        <View className={styles.card}>
          <View className={styles.actions}>
            {history.nextBefore === undefined ? null : action(Strings.automationsMore, !busy, () => loadHistory(history.entry, true))}
            {action(Strings.managementRefresh, !busy, () => loadHistory(history.entry, false))}
          </View>
        </View>
      </View>
    );
  } else {
    body = (
      <View>
        <View className={styles.card}>
          <Input className={styles.input} value={query} placeholder={Strings.automationsSearch} onInput={event => setQuery(event.detail.value)} />
        </View>
        {visible.length === 0 ? <Text className={styles.hint}>{Strings.managementEmpty}</Text> : null}
        {visible.map(entry => (
          <View key={entry.key} className={styles.card}>
            <Text className={styles.title}>{entry.title}</Text>
            <Text className={styles.meta}>{entry.sessionId}</Text>
            <Text className={styles.meta}>{fmt(Strings.automationsStatus, entry.status, entry.kind)}</Text>
            {entry.scheduledAt === undefined ? null : <Text className={styles.meta}>{fmt(Strings.automationsNext, entry.scheduledAt)}</Text>}
            {entry.prompt.length === 0 ? null : <Text className={styles.detail}>{entry.prompt}</Text>}
            {entry.lastDeliveredAt === undefined ? null : (
              <Text className={styles.meta}>{fmt(Strings.automationsLastDelivery, entry.lastDeliveredAt)}</Text>
            )}
            <View className={styles.actions}>
              {entry.active
                ? action(Strings.automationsEdit, !busy && factsReady, () => {
                    setNotice(undefined);
                    setDraft({ entry, title: entry.title, prompt: entry.prompt });
                  })
                : null}
              {entry.active ? action(Strings.automationsDelete, !busy && factsReady, () => void remove(entry), true) : null}
              {action(Strings.automationsHistory, !busy, () => loadHistory(entry, false))}
            </View>
          </View>
        ))}
      </View>
    );
  }

  return (
    <PageShell>
      <View className={styles.page}>
        <NavBar
          left={<NavIconButton name='arrow-left' onClick={() => void goBack()} />}
          title={<NavTitle text={history !== undefined ? history.entry.title : Strings.automationsTitle} />}
          actions={
            <React.Fragment>
              {/* 「新建」：任务由会话里的智能体创建，这里只开一个预填好开头的新会话（对齐安卓 onNewTask）。 */}
              <NavIconButton
                name='plus'
                ariaLabel={Strings.automationsNew}
                onClick={() => openPage(pageRoutes.NEW, { prefill: Strings.automationsNewPrompt })}
              />
              <NavIconButton name='refresh-cw' ariaLabel={Strings.managementRefresh} spin={busy} onClick={() => void refresh()} />
            </React.Fragment>
          }
        />
        <Text className={styles.hint}>{Strings.automationsScopeHint}</Text>
        {factsReady ? null : <Text className={styles.hint}>{Strings.managementFactsUnavailable}</Text>}
        {error === undefined ? null : <Text className={styles.error}>{error}</Text>}
        {notice === undefined ? null : <Text className={styles.hint}>{notice}</Text>}
        {body}
      </View>
    </PageShell>
  );
}

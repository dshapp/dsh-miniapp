import React from 'react';
import { Input, Text, View } from '@tarojs/components';
import { Strings, fmt } from '../i18n/strings';
import { getAppModel } from '../state/appModel';
import { useStore } from '../state/store';
import { bool, jget, str } from '../model/json';
import { agentPresetDisplayText } from '../model/format';
import {
  catalogDraftError,
  catalogModelDraft,
  catalogMutation,
  openCatalogDraft,
  providerSettingsRows,
  resetCatalogDraft,
  schemaNodeAt,
  type CatalogModelDraft,
  type ProviderCatalogDraft,
  type ProviderSettingsRow,
} from '../model/management';
import {
  agentPresetRead,
  credentialsDescribe,
  llmListConfigurableProviders,
  settingsDescribe,
  settingsMutate,
} from '../transport/rpcMethods';
import { openCardDetail } from './cardDetail';
import { managementError, useManagementRefresh } from './management';
import styles from './management.module.scss';

/** 一家 provider 的凭证读数：引用名 · 是否配置 · 来源 · 引用归属（对齐安卓 SettingsScreen 的那一行）。 */
function credentialLine(row: ProviderSettingsRow): string {
  if (row.credentialRef === undefined) return Strings.hostCredentialAccount;
  const state =
    row.configured === undefined ? Strings.hostCredentialUnknown : row.configured ? Strings.hostCredentialConfigured : Strings.hostCredentialMissing;
  const source = row.source === undefined ? '' : ' · ' + row.source;
  return row.credentialRef + ' · ' + state + source + ' · ' + (row.derivedRef ? Strings.hostCredentialDerived : Strings.hostCredentialNamed);
}

/**
 * 设置页里的宿主设置区（对齐安卓 SettingsScreen 0.2.1 的「模型与凭证」「Agent 预设 YAML」，收窄为只读）：
 * 每家 provider 的凭证引用状态、预设 YAML 原文。凭证写入与模型目录编辑不在手机上做。
 */
export function HostSettingsSection(props: { rowClass: string; labelClass: string; valueClass: string; cardClass: string; sectionClass: string }): JSX.Element {
  const model = getAppModel();
  const presets = useStore(model.agentPresetsStore);
  const [rows, setRows] = React.useState<ProviderSettingsRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [writable, setWritable] = React.useState(false);
  const [draft, setDraft] = React.useState<ProviderCatalogDraft | undefined>(undefined);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | undefined>(undefined);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const transport = model.managementTransport();
      const [describe, providers] = await Promise.all([settingsDescribe(transport), llmListConfigurableProviders(transport)]);
      const next = providerSettingsRows(providers, describe);
      const refs = next.map(row => row.credentialRef).filter((ref): ref is string => ref !== undefined);
      if (refs.length > 0) {
        const info = await credentialsDescribe(transport, refs);
        for (const row of next) {
          if (row.credentialRef === undefined) continue;
          const entry = jget(info, row.credentialRef);
          row.configured = bool(jget(entry, 'configured'));
          row.source = str(jget(entry, 'source'));
        }
      }
      // 草稿的 expectedRevision 定格在打开那一刻，刷新只换列表事实。
      setRows(next);
      setWritable(bool(jget(describe, 'writable')) === true);
      setError(undefined);
    } catch (reason) {
      setWritable(false);
      setError(managementError(reason));
    } finally {
      setLoading(false);
    }
    void model.loadAgentPresets();
  }, [model]);
  useManagementRefresh('settings/document-updated', () => void refresh());

  const openPreset = async (id: string, title: string): Promise<void> => {
    let content: string;
    try {
      content = (await agentPresetRead(model.managementTransport(), id)) ?? '';
    } catch (reason) {
      content = managementError(reason);
    }
    openCardDetail({
      icon: 'file-text',
      title: title + ' · YAML',
      copyText: content,
      content: <Text className={styles.mono} selectable userSelect>{content}</Text>,
    });
  };

  // 草稿所属的 provider 还在、还支持编辑、主机可写，才放开编辑（对齐安卓 catalogWritable）。
  const catalogWritable =
    draft !== undefined && writable && !saving && rows.some(row => row.provider === draft.row.provider && row.catalogSupported);
  const editRow = (index: number, patch: Partial<CatalogModelDraft>): void => {
    if (!catalogWritable || draft === undefined) return;
    setDraft({ ...draft, rows: draft.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)), owned: true, touched: true });
    setSaveError(undefined);
  };
  const saveCatalog = async (): Promise<void> => {
    if (!catalogWritable || draft === undefined) return;
    try {
      const mutation = catalogMutation(draft);
      if (mutation === undefined) {
        setDraft(undefined);
        return;
      }
      setSaving(true);
      setSaveError(undefined);
      await settingsMutate(model.managementTransport(), mutation);
      setDraft(undefined);
      await refresh();
    } catch (reason) {
      // 冲突不重试也不自动套到新事实上：草稿保留，交给用户处理。
      setSaveError(managementError(reason));
    } finally {
      setSaving(false);
    }
  };
  const fields = draft === undefined ? undefined : schemaNodeAt(draft.namespace.schema, [...draft.row.settingsPath, 'models', '0'])?.dict;
  const hasField = (key: string): boolean => fields !== undefined && fields !== null && typeof fields === 'object' && key in fields;
  const draftError = draft === undefined ? undefined : catalogDraftError(draft);
  const textAction = (text: string, enabled: boolean, onClick: () => void, danger = false): JSX.Element => (
    <Text className={(danger ? styles.actionDanger : styles.action) + (enabled ? '' : ' ' + styles.actionOff)} onClick={enabled ? onClick : undefined}>
      {text}
    </Text>
  );

  return (
    <View>
      <Text className={props.sectionClass}>{Strings.hostSettingsTitle}</Text>
      <Text className={styles.hint}>{loading ? Strings.hostSettingsLoading : writable ? Strings.hostSettingsCredentialsReadOnly : Strings.hostSettingsReadOnly}</Text>
      {error === undefined ? null : <Text className={styles.error}>{error}</Text>}
      {rows.length === 0 ? null : (
        <View className={styles.card}>
          {rows.map(row => (
            <View key={row.provider} className={styles.item}>
              <Text className={styles.title}>{row.displayName.length > 0 ? row.displayName : row.provider}</Text>
              {row.error === undefined ? null : <Text className={styles.danger}>{row.error}</Text>}
              <Text className={styles.meta}>{credentialLine(row)}</Text>
              {row.catalogSupported && writable ? (
                <View className={styles.actions}>
                  {textAction(Strings.hostCatalogEdit, !saving, () => {
                    setSaveError(undefined);
                    try {
                      setDraft(openCatalogDraft(row));
                    } catch (reason) {
                      setSaveError(managementError(reason));
                    }
                  })}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      )}
      {draft === undefined ? (
        saveError === undefined ? null : <Text className={styles.error}>{saveError}</Text>
      ) : (
        <View className={styles.card}>
          <Text className={styles.title}>{(draft.row.displayName || draft.row.provider) + ' · ' + Strings.hostCatalogTitle}</Text>
          <Text className={styles.meta}>{fmt(Strings.hostCatalogRevision, String(draft.namespace.revision ?? 0))}</Text>
          <Text className={styles.meta}>{draft.owned ? Strings.hostCatalogOwned : Strings.hostCatalogInherited}</Text>
          {catalogWritable || saving ? null : <Text className={styles.danger}>{Strings.hostCatalogReadOnly}</Text>}
          {draft.rows.map((row, index) => (
            <View key={index} className={styles.item}>
              <Text className={styles.label}>{Strings.hostCatalogModelId}</Text>
              <Input className={styles.input} value={row.id} disabled={!catalogWritable} onInput={event => editRow(index, { id: event.detail.value })} />
              {hasField('name') ? (
                <View>
                  <Text className={styles.label}>{Strings.hostCatalogName}</Text>
                  <Input className={styles.input} value={row.name} disabled={!catalogWritable} onInput={event => editRow(index, { name: event.detail.value })} />
                </View>
              ) : null}
              {hasField('contextWindow') ? (
                <View>
                  <Text className={styles.label}>{Strings.hostCatalogContextWindow}</Text>
                  <Input className={styles.input} type='number' value={row.contextWindow} disabled={!catalogWritable} onInput={event => editRow(index, { contextWindow: event.detail.value })} />
                </View>
              ) : null}
              {hasField('maxTokens') ? (
                <View>
                  <Text className={styles.label}>{Strings.hostCatalogMaxTokens}</Text>
                  <Input className={styles.input} type='number' value={row.maxTokens} disabled={!catalogWritable} onInput={event => editRow(index, { maxTokens: event.detail.value })} />
                </View>
              ) : null}
              <View className={styles.actions}>
                {textAction(Strings.hostCatalogRemove, catalogWritable, () => {
                  setDraft({ ...draft, rows: draft.rows.filter((_, i) => i !== index), owned: true, touched: true });
                }, true)}
              </View>
            </View>
          ))}
          <View className={styles.actions}>
            {textAction(Strings.hostCatalogAdd, catalogWritable, () =>
              setDraft({ ...draft, rows: [...draft.rows, catalogModelDraft({})], owned: true, touched: true }),
            )}
            {textAction(Strings.hostCatalogReset, catalogWritable && draft.owned, () => {
              setDraft(resetCatalogDraft(draft));
              setSaveError(undefined);
            })}
          </View>
          {(saveError ?? draftError) === undefined ? null : <Text className={styles.danger}>{saveError ?? draftError}</Text>}
          <View className={styles.actions}>
            {textAction(Strings.cancel, !saving, () => {
              setDraft(undefined);
              setSaveError(undefined);
            })}
            {textAction(saving ? Strings.hostCatalogSaving : Strings.automationsSave, catalogWritable && draft.touched && draftError === undefined, () => void saveCatalog())}
          </View>
        </View>
      )}
      {presets.length === 0 ? null : (
        <View>
          <Text className={props.sectionClass}>{Strings.hostPresetsTitle}</Text>
          <View className={props.cardClass}>
            {presets.map(preset => {
              const name = agentPresetDisplayText(preset).name;
              return (
                <View key={preset.id} className={props.rowClass} onClick={() => void openPreset(preset.id, name)}>
                  <Text className={props.labelClass}>{name}</Text>
                  <Text className={props.valueClass}>{preset.broken !== undefined && preset.broken.length > 0 ? preset.broken : 'YAML'}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

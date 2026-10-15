import React from 'react';
import { Text, View } from '@tarojs/components';
import { Strings } from '../i18n/strings';
import { getAppModel } from '../state/appModel';
import { useStore } from '../state/store';
import { bool, jget, str } from '../model/json';
import { agentPresetDisplayText } from '../model/format';
import { providerSettingsRows, type ProviderSettingsRow } from '../model/management';
import {
  agentPresetRead,
  credentialsDescribe,
  llmListConfigurableProviders,
  settingsDescribe,
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
      setRows(next);
      setError(undefined);
    } catch (reason) {
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

  return (
    <View>
      <Text className={props.sectionClass}>{Strings.hostSettingsTitle}</Text>
      <Text className={styles.hint}>{loading ? Strings.hostSettingsLoading : Strings.hostSettingsReadOnly}</Text>
      {error === undefined ? null : <Text className={styles.error}>{error}</Text>}
      {rows.length === 0 ? null : (
        <View className={styles.card}>
          {rows.map(row => (
            <View key={row.provider} className={styles.item}>
              <Text className={styles.title}>{row.displayName.length > 0 ? row.displayName : row.provider}</Text>
              {row.error === undefined ? null : <Text className={styles.danger}>{row.error}</Text>}
              <Text className={styles.meta}>{credentialLine(row)}</Text>
            </View>
          ))}
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

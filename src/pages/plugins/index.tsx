import React from 'react';
import Taro from '@tarojs/taro';
import { Switch, Text, View } from '@tarojs/components';
import { Strings, fmt } from '../../i18n/strings';
import { back } from '../../framework/page';
import { getAppModel } from '../../state/appModel';
import { arr, encodeJson, isObject, jget, str, type JsonObject, type JsonValue } from '../../model/json';
import { incompatiblePairs, savedExemptions, type ManagedBundle } from '../../model/management';
import {
  pluginCancelInstall,
  pluginInstallBundle,
  pluginListBundles,
  pluginListPlugins,
  pluginListVersionExemptions,
  pluginRemoveBundle,
  pluginSetVersionExemption,
  pluginSetBundleEnabled,
  pluginSetPluginEnabled,
  pluginWaitForInstall,
} from '../../transport/rpcMethods';
import { NavBar, NavIconButton, NavTitle } from '../../ui/navBar';
import { PageShell } from '../../ui/pageShell';
import { managementError, useManagementRefresh } from '../../ui/management';
import styles from '../../ui/management.module.scss';

/** 进行中的安装：requestId 一直留到拿到确定结果，恢复只等这一个 id，绝不重装（对齐安卓 PluginManagementState）。 */
interface PendingInstall { requestId: string; spec: string; unknown: boolean }

function newRequestId(): string {
  return 'mini-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

async function confirm(content: string): Promise<boolean> {
  const result = await Taro.showModal({ content, confirmText: Strings.managementConfirm, cancelText: Strings.cancel });
  return result.confirm;
}

/**
 * 插件管理页（对齐安卓 PluginManagerScreen，范围收窄）：官方 / 已安装两组 bundle，开关、按主机给的
 * 精确目标安装或更新、移除；详情里逐个模块开关。版本豁免审阅本端不提供。
 */
export default function PluginsPage(): JSX.Element {
  const model = getAppModel();
  const [bundles, setBundles] = React.useState<ManagedBundle[]>([]);
  const [plugins, setPlugins] = React.useState<JsonObject[]>([]);
  const [exemptions, setExemptions] = React.useState<JsonValue | undefined>(undefined);
  /** 最近一次变更 / 安装的结果：里面可能报出不兼容的版本组合。 */
  const [lastResult, setLastResult] = React.useState<JsonValue | undefined>(undefined);
  const [factsReady, setFactsReady] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [notice, setNotice] = React.useState<string | undefined>(undefined);
  const [pending, setPending] = React.useState<PendingInstall | undefined>(undefined);
  const [detail, setDetail] = React.useState<string | undefined>(undefined);

  const refresh = React.useCallback(async () => {
    try {
      const transport = model.managementTransport();
      const [nextBundles, nextPlugins, nextExemptions] = await Promise.all([
        pluginListBundles(transport),
        pluginListPlugins(transport),
        pluginListVersionExemptions(transport),
      ]);
      setBundles(nextBundles);
      setPlugins(nextPlugins);
      setExemptions(nextExemptions);
      setFactsReady(true);
    } catch (reason) {
      setFactsReady(false);
      setError(managementError(reason));
    }
  }, [model]);
  useManagementRefresh('plugin-manager/changed', () => void refresh());

  const locked = busy || pending !== undefined || !factsReady;

  const noteOutcome = (outcome: JsonValue): void => {
    setLastResult(outcome);
    const status = str(jget(outcome, 'application')) ?? str(jget(outcome, 'status'));
    setNotice(status ?? Strings.managementDone);
  };

  const change = async (action: () => Promise<JsonValue>): Promise<void> => {
    if (locked) return;
    setBusy(true);
    setError(undefined);
    try {
      noteOutcome(await action());
      await refresh();
    } catch (reason) {
      setFactsReady(false);
      setError(managementError(reason));
    } finally {
      setBusy(false);
    }
  };

  const install = async (bundle: ManagedBundle): Promise<void> => {
    const spec = bundle.installSpec;
    if (spec === undefined || locked) return;
    if (!(await confirm(fmt(Strings.pluginsInstallConfirm, bundle.name + ' ' + (bundle.installVersion ?? ''))))) return;
    const requestId = newRequestId();
    setPending({ requestId, spec, unknown: false });
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const outcome = await pluginInstallBundle(model.managementTransport(), spec, requestId, bundle.missing ? true : bundle.enabled);
      noteOutcome(outcome);
      setPending(undefined);
      await refresh();
    } catch (reason) {
      // 结果不确定：留着原 requestId，交给「恢复结果」。
      setError(managementError(reason));
    } finally {
      setBusy(false);
    }
  };

  const recover = async (): Promise<void> => {
    if (pending === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const outcome = await pluginWaitForInstall(model.managementTransport(), pending.requestId);
      // null 既不证明成功也不证明取消：保留 id，要用户核对后手动关闭。
      if (outcome === null) setPending({ ...pending, unknown: true });
      else {
        noteOutcome(outcome);
        setPending(undefined);
      }
      await refresh();
    } catch (reason) {
      setError(managementError(reason));
    } finally {
      setBusy(false);
    }
  };

  const cancelInstall = async (): Promise<void> => {
    if (pending === undefined) return;
    try {
      const outcome = await pluginCancelInstall(model.managementTransport(), pending.requestId);
      noteOutcome(outcome);
      if (str(jget(outcome, 'status')) === 'cancelled') setPending(undefined);
      await refresh();
    } catch (reason) {
      setError(managementError(reason));
    }
  };

  const remove = async (bundle: ManagedBundle): Promise<void> => {
    if (locked || !(await confirm(fmt(Strings.pluginsRemoveConfirm, bundle.name)))) return;
    await change(() => pluginRemoveBundle(model.managementTransport(), bundle.name));
  };

  /** 审阅一组精确版本豁免：弹窗里写明组合与风险，确认即视为接受风险（安卓是勾选 + 确认）。 */
  const reviewExemption = async (name: string, version: string, runtimeVersion: string): Promise<void> => {
    if (locked) return;
    const content = name + '@' + version + ' / ' + runtimeVersion + '\n' + Strings.pluginsRisk;
    const result = await Taro.showModal({ title: Strings.pluginsExemption, content, confirmText: Strings.pluginsAcceptRisk, cancelText: Strings.cancel });
    if (!result.confirm) return;
    await change(() => pluginSetVersionExemption(model.managementTransport(), name + '@' + version, runtimeVersion, true));
  };

  const selected = detail === undefined ? undefined : bundles.find(bundle => bundle.name === detail);
  const pairs = incompatiblePairs(lastResult, bundles);
  const saved = savedExemptions(exemptions);
  const warnings = (arr(isObject(exemptions) ? exemptions.warnings : undefined) ?? []).filter((item): item is string => typeof item === 'string');
  const action = (text: string, enabled: boolean, onClick: () => void, danger = false): JSX.Element => (
    <Text
      className={(danger ? styles.actionDanger : styles.action) + (enabled ? '' : ' ' + styles.actionOff)}
      onClick={enabled ? onClick : undefined}
    >
      {text}
    </Text>
  );

  const bundleCard = (bundle: ManagedBundle): JSX.Element => (
    <View key={bundle.name} className={styles.card}>
      <View className={styles.titleRow}>
        <Text className={styles.title}>{bundle.name}</Text>
        <Switch
          checked={bundle.enabled}
          disabled={locked || bundle.readOnlyReason !== undefined || bundle.missing}
          onChange={event => void change(() => pluginSetBundleEnabled(model.managementTransport(), bundle.name, event.detail.value))}
        />
      </View>
      {bundle.version ?? bundle.installVersion ? <Text className={styles.meta}>{bundle.version ?? bundle.installVersion}</Text> : null}
      {bundle.description === undefined ? null : <Text className={styles.detail}>{bundle.description}</Text>}
      {bundle.readOnlyReason === undefined ? null : <Text className={styles.danger}>{bundle.readOnlyReason}</Text>}
      {bundle.raw.error === undefined ? null : <Text className={styles.danger}>{encodeJson(bundle.raw.error)}</Text>}
      <View className={styles.actions}>
        {action(Strings.pluginsDetails, true, () => setDetail(bundle.name))}
        {bundle.installSpec !== undefined && (bundle.missing || bundle.updateAvailable)
          ? action(bundle.missing ? Strings.pluginsInstall : Strings.pluginsUpdate, !locked && bundle.readOnlyReason === undefined, () => void install(bundle))
          : null}
        {bundle.removable ? action(Strings.pluginsRemove, !locked, () => void remove(bundle), true) : null}
      </View>
    </View>
  );

  const official = bundles.filter(bundle => bundle.official);
  const installed = bundles.filter(bundle => !bundle.official && bundle.installed);

  return (
    <PageShell>
      <View className={styles.page}>
        <NavBar
          left={<NavIconButton name='arrow-left' onClick={() => (selected !== undefined ? setDetail(undefined) : back())} />}
          title={<NavTitle text={selected?.name ?? Strings.pluginsTitle} />}
          actions={<NavIconButton name='refresh-cw' ariaLabel={Strings.managementRefresh} spin={busy} onClick={() => void refresh()} />}
        />
        <Text className={styles.hint}>{Strings.pluginsBoundary}</Text>
        {factsReady ? null : <Text className={styles.hint}>{Strings.managementFactsUnavailable}</Text>}
        {error === undefined ? null : <Text className={styles.error}>{error}</Text>}
        {notice === undefined ? null : <Text className={styles.hint}>{notice}</Text>}
        {pending === undefined ? null : (
          <View className={styles.card}>
            <Text className={styles.detail}>{fmt(Strings.pluginsInstallPending, pending.requestId)}</Text>
            <Text className={styles.meta}>{pending.spec}</Text>
            {pending.unknown ? <Text className={styles.danger}>{Strings.pluginsUnknownResult}</Text> : null}
            <View className={styles.actions}>
              {action(Strings.pluginsRecover, !busy, () => void recover())}
              {action(Strings.pluginsCancelInstall, true, () => void cancelInstall(), true)}
              {pending.unknown ? action(Strings.pluginsDismiss, factsReady && !busy, () => setPending(undefined)) : null}
            </View>
          </View>
        )}
        {selected !== undefined ? (
          <View>
            <Text className={styles.sectionTitle}>{Strings.pluginsModules}</Text>
            {selected.rows.length === 0 ? <Text className={styles.hint}>{Strings.managementEmpty}</Text> : null}
            {selected.rows.map((row, index) => {
              const entryId = str(row.entryId);
              const plugin = entryId === undefined ? undefined : plugins.find(item => str(item.entryId) === entryId);
              const readOnly = plugin === undefined ? undefined : str(plugin.readOnlyReason);
              return (
                <View key={(entryId ?? '') + ':' + index} className={styles.card}>
                  <View className={styles.titleRow}>
                    <Text className={styles.title}>{str(row.moduleName) ?? str(row.rowId) ?? ''}</Text>
                    {plugin === undefined ? null : (
                      <Switch
                        checked={plugin.enabled === true}
                        disabled={locked || readOnly !== undefined || str(plugin.patchId) === undefined}
                        onChange={event => void change(() => pluginSetPluginEnabled(model.managementTransport(), entryId as string, event.detail.value))}
                      />
                    )}
                  </View>
                  {plugin === undefined ? null : <Text className={styles.meta}>{str(plugin.fiberPhase) ?? ''}</Text>}
                  {readOnly === undefined ? null : <Text className={styles.danger}>{readOnly}</Text>}
                </View>
              );
            })}
            <View className={styles.card}>
              <Text className={styles.mono} selectable userSelect>{JSON.stringify(selected.raw, null, 2)}</Text>
            </View>
          </View>
        ) : (
          <View>
            {[
              [Strings.pluginsOfficial, official] as const,
              [Strings.pluginsInstalled, installed] as const,
            ].map(([label, list]) => (
              <View key={label}>
                <Text className={styles.sectionTitle}>{label}</Text>
                {list.length === 0 ? <Text className={styles.hint}>{Strings.managementEmpty}</Text> : list.map(bundleCard)}
              </View>
            ))}
            {pairs.length === 0 ? null : (
              <View className={styles.card}>
                {pairs.map(pair => (
                  <Text
                    key={pair.name + '@' + pair.version + '/' + pair.runtimeVersion}
                    className={styles.action + (locked ? ' ' + styles.actionOff : '')}
                    onClick={() => void reviewExemption(pair.name, pair.version, pair.runtimeVersion)}
                  >
                    {fmt(Strings.pluginsReviewExemption, pair.name + '@' + pair.version + ' / ' + pair.runtimeVersion)}
                  </Text>
                ))}
              </View>
            )}
            <Text className={styles.sectionTitle}>{Strings.pluginsSavedExemptions}</Text>
            {saved.length === 0 ? <Text className={styles.hint}>{Strings.managementEmpty}</Text> : null}
            {saved.map(item => (
              <View key={item.packageVersion + '/' + item.runtimeVersion} className={styles.card}>
                <View className={styles.titleRow}>
                  <Text className={styles.title}>{item.packageVersion + ' / ' + item.runtimeVersion}</Text>
                  {action(Strings.pluginsRevoke, !locked, () =>
                    void change(() => pluginSetVersionExemption(model.managementTransport(), item.packageVersion, item.runtimeVersion, false)),
                  true)}
                </View>
              </View>
            ))}
            {warnings.map(warning => (
              <Text key={warning} className={styles.hint}>{warning}</Text>
            ))}
          </View>
        )}
      </View>
    </PageShell>
  );
}

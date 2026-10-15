import React from 'react';
import { Input, Text, View } from '@tarojs/components';
import { Strings } from '../../i18n/strings';
import { back, openPage, pageRoutes } from '../../framework/page';
import { getAppModel } from '../../state/appModel';
import { connectionStore, connectionTone } from '../../state/connection';
import { profileStore, type ServerProfile } from '../../state/profileStore';
import { settings, type AppThemeMode } from '../../state/settings';
import type { AppLocale } from '../../i18n/strings';
import { useStore, useSubscribed } from '../../state/store';
import { ActionMenu, anchorFromEvent } from '../../ui/actionMenu';
import type { ActionMenuAnchor, ActionMenuItem } from '../../ui/actionMenu';
import { Icon } from '../../ui/icon';
import { NavBar, NavIconButton, NavTitle } from '../../ui/navBar';
import { PageShell } from '../../ui/pageShell';
import styles from './index.module.scss';

function languageLabel(locale: AppLocale | null): string {
  if (locale === 'en') return Strings.languageEnglish;
  if (locale === 'zh') return Strings.languageChinese;
  return Strings.languageSystem;
}

function themeLabel(mode: AppThemeMode): string {
  if (mode === 'light') return Strings.themeLight;
  if (mode === 'dark') return Strings.themeDark;
  return Strings.themeSystem;
}

function dotClass(tone: ReturnType<typeof connectionTone>): string {
  if (tone === 'connected') return styles.dot + ' ' + styles.dotOk;
  // reconnecting 与 connecting 同色（对齐 Android connectionTone 的琥珀）：
  // 「正在重连」不是故障，用红色会让人以为已经断了。
  if (tone === 'connecting' || tone === 'reconnecting') return styles.dot + ' ' + styles.dotPending;
  return styles.dot + ' ' + styles.dotBad;
}

/**
 * 设置页：列表页左上角状态点的落点。
 *
 * 与 Android 的 SettingsScreen 同一口径：一页之内看全已配对的机器、切换/重命名/移除，
 * 再往下是外观区（语言、主题）。手机端只有加密隧道一条路，所以这里没有传输方式、
 * 服务地址、Cookie 之类的开关——连接参数全部来自配对资料。
 *
 * 新增服务走标题栏那一行（与 Android 收在右上角加号里同义）；移除最后一台机器后
 * 这页没有内容可展示，退回列表页由引导页接手。
 */
export default function SettingsPage(): JSX.Element {
  const connection = useStore(connectionStore);
  const settingsValue = useSubscribed(settings);
  const profilesState = useSubscribed(profileStore);
  const profiles = profilesState.profiles;
  // 重命名/移除各要一个自绘弹层（对齐 Android SettingsScreen 的两个 AlertDialog：重命名
  // 是带预填当前名的 OutlinedTextField，移除是二次确认）。原来用 wx.showModal——它在
  // editable 下 content 是只读正文、预填不了初始名，取消按钮文案也由微信系统语言决定。
  const [renameDraft, setRenameDraft] = React.useState<{ profile: ServerProfile; text: string } | undefined>(undefined);
  const [removing, setRemoving] = React.useState<ServerProfile | undefined>(undefined);

  // 删掉最后一台机器后没有内容可展示了：退回上一页由引导页接手（对齐 Android
  // SettingsScreen 的 LaunchedEffect(empty) { if (empty) onBack() }）。
  React.useEffect(() => {
    if (profiles.length === 0) back();
  }, [profiles.length]);

  const renameProfile = React.useCallback((profile: ServerProfile) => {
    // 打开弹层时就把当前名预填进输入框（对齐 Android SettingsScreen.kt:107 的
    // `nameDraft = profile.name; renaming = profile`）。
    setRenameDraft({ profile, text: profile.name });
  }, []);

  const removeProfile = React.useCallback((profile: ServerProfile) => {
    setRemoving(profile);
  }, []);

  const submitRename = (): void => {
    if (renameDraft === undefined) return;
    // 空名由 profileStore.rename 自己挡掉（与 Android 直接调 rename 同口径）。
    profileStore.rename(renameDraft.profile.id, renameDraft.text);
    setRenameDraft(undefined);
  };

  const confirmRemove = (): void => {
    if (removing === undefined) return;
    profileStore.remove(removing.id);
    setRemoving(undefined);
  };

  // 语言/主题两个选择菜单改自绘锚定浮层（对齐 Android SettingsScreen 的 DropdownMenu +
  // leadingIcon Check）；系统动作面板只能把勾塞进文案，也锚不到触发行上。
  const [localeMenu, setLocaleMenu] = React.useState<ActionMenuAnchor | undefined>(undefined);
  const [themeMenu, setThemeMenu] = React.useState<ActionMenuAnchor | undefined>(undefined);

  const localeMenuItems = React.useMemo((): ActionMenuItem[] => [
    { key: 'system', label: Strings.languageSystem, checked: settingsValue.locale === null },
    { key: 'en', label: Strings.languageEnglish, checked: settingsValue.locale === 'en' },
    { key: 'zh', label: Strings.languageChinese, checked: settingsValue.locale === 'zh' },
  ], [settingsValue.locale]);

  const themeMenuItems = React.useMemo((): ActionMenuItem[] => [
    { key: 'system', label: Strings.themeSystem, checked: settingsValue.themeMode === 'system' },
    { key: 'light', label: Strings.themeLight, checked: settingsValue.themeMode === 'light' },
    { key: 'dark', label: Strings.themeDark, checked: settingsValue.themeMode === 'dark' },
  ], [settingsValue.themeMode]);

  const selectLocale = React.useCallback((key: string): void => {
    setLocaleMenu(undefined);
    const next: AppLocale | null = key === 'system' ? null : (key as AppLocale);
    settings.chooseLocale(next);
  }, []);

  const selectTheme = React.useCallback((key: string): void => {
    setThemeMenu(undefined);
    settings.chooseThemeMode(key as AppThemeMode);
  }, []);

  return (
    <PageShell>
      <View className={styles.page}>
        {/* 顶栏对齐 Android SettingsScreen 的 TopAppBar：返回 + 「设置」+ 右上角加号。
            加号原本因为画不出自定义导航栏而被放在页首第一行，现在回到它该在的位置。 */}
        <NavBar
          left={<NavIconButton name='arrow-left' onClick={() => back()} />}
          title={<NavTitle text={Strings.settings} />}
          actions={
            <NavIconButton
              name='plus'
              ariaLabel={Strings.addServer}
              onClick={() => openPage(pageRoutes.PAIRING)}
            />
          }
        />

        {/* 首个卡片没有分区标题垫在上面，自己留出与顶栏的间距，不然会贴着标题栏。 */}
        <View className={styles.card + ' ' + styles.cardLead}>
          {profiles.length === 0 ? <Text className={styles.footer}>{Strings.serversEmpty}</Text> : null}
          {profiles.map(profile => {
            const isCurrent = profile.id === profilesState.currentId;
            return (
              <View
                key={profile.id}
                className={styles.row}
                onClick={() => getAppModel().connectProfile(profile)}
              >
                {/* 勾贴最左边；没选中的行占同样宽度的空位，机器名才不会错位
                    （对齐 Android SettingsScreen.kt:86-92 的 leadingContent）。 */}
                <View className={styles.check}>{isCurrent ? <Icon name='check' /> : null}</View>
                {/* 只有机型名一行，不摊 proxy 地址（对齐 Android SettingsScreen.kt:80-121
                    的 headlineContent——那行 ListItem 没有 supportingContent）。 */}
                <Text className={styles.name}>{profile.name}</Text>
                {isCurrent ? <View className={dotClass(connectionTone(connection))} /> : null}
                <Icon
                  name='pencil'
                  className={styles.iconButton}
                  ariaLabel={Strings.serverRename}
                  // 图标按钮必须吃掉冒泡：整行 onClick 是「切换当前连接」，不拦就会在弹
                  // 对话框之前先把这台机切成当前连接（对齐 Android 的 IconButton 与
                  // clickable ListItem 各自独立，没有这条路径）。
                  onClick={event => { event.stopPropagation(); renameProfile(profile); }}
                />
                <Icon
                  // 对齐安卓的 Icons.Default.Delete（垃圾桶）；字形已补进图标子集。
                  name='trash-2'
                  className={styles.iconButton + ' ' + styles.iconDanger}
                  // 文案对齐安卓的 Strings.serverRemove（原来错用了通用的 Strings.remove）。
                  ariaLabel={Strings.serverRemove}
                  onClick={event => { event.stopPropagation(); removeProfile(profile); }}
                />
              </View>
            );
          })}
        </View>

        {/* 主机管理入口：安卓放在会话列表的视图菜单里，小程序收在设置页。 */}
        <Text className={styles.sectionTitle}>DSH</Text>
        <View className={styles.card}>
          <View className={styles.row} onClick={() => openPage(pageRoutes.PLUGINS)}>
            <Text className={styles.label}>{Strings.pluginsTitle}</Text>
            <Icon name='chevron-right' className={styles.chevron} />
          </View>
        </View>

        <Text className={styles.sectionTitle}>{Strings.appearance}</Text>
        <View className={styles.card}>
          <View className={styles.row} onClick={event => setLocaleMenu(anchorFromEvent(event))}>
            <Text className={styles.label}>{Strings.language}</Text>
            <Text className={styles.value}>{languageLabel(settingsValue.locale)}</Text>
            <Icon name='chevron-right' className={styles.chevron} />
          </View>
          <View className={styles.row} onClick={event => setThemeMenu(anchorFromEvent(event))}>
            <Text className={styles.label}>{Strings.theme}</Text>
            <Text className={styles.value}>{themeLabel(settingsValue.themeMode)}</Text>
            <Icon name='chevron-right' className={styles.chevron} />
          </View>
        </View>

        {/* 重命名弹层（对齐 Android SettingsScreen.kt:186-199 AlertDialog）：
            OutlinedTextField 单行输入 + 提交（Strings.submit）+ 取消（Strings.cancel）。
            自绘而不是 wx.showModal：只有自绘才能把当前名预填进输入框。 */}
        {renameDraft === undefined ? null : (
          <>
            <View className={styles.modalMask} onClick={() => setRenameDraft(undefined)} />
            <View className={styles.dialog}>
              <Text className={styles.dialogTitle}>{Strings.serverRename}</Text>
              <Input
                className={styles.dialogInput}
                value={renameDraft.text}
                focus
                placeholder={Strings.serverName}
                onInput={event => setRenameDraft(current => (current === undefined ? current : { ...current, text: event.detail.value }))}
              />
              <View className={styles.dialogActions}>
                <Text className={styles.dialogCancel} onClick={() => setRenameDraft(undefined)}>{Strings.cancel}</Text>
                <Text className={styles.dialogConfirm} onClick={submitRename}>{Strings.submit}</Text>
              </View>
            </View>
          </>
        )}

        <ActionMenu anchor={localeMenu} items={localeMenuItems} onSelect={selectLocale} onClose={() => setLocaleMenu(undefined)} width={200} />
        <ActionMenu anchor={themeMenu} items={themeMenuItems} onSelect={selectTheme} onClose={() => setThemeMenu(undefined)} width={200} />

        {/* 移除确认弹层（对齐 Android SettingsScreen.kt:172-185 AlertDialog）：正文
            `name · serverRemoveMessage`，确认 Remove（error 色）、取消 Cancel。 */}
        {removing === undefined ? null : (
          <>
            <View className={styles.modalMask} onClick={() => setRemoving(undefined)} />
            <View className={styles.dialog}>
              <Text className={styles.dialogTitle}>{Strings.serverRemove}</Text>
              <Text className={styles.dialogText}>{removing.name + ' · ' + Strings.serverRemoveMessage}</Text>
              <View className={styles.dialogActions}>
                <Text className={styles.dialogCancel} onClick={() => setRemoving(undefined)}>{Strings.cancel}</Text>
                <Text className={styles.dialogDanger} onClick={confirmRemove}>{Strings.remove}</Text>
              </View>
            </View>
          </>
        )}

      </View>
    </PageShell>
  );
}

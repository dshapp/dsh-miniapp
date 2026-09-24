import React from 'react';
import { Text, View } from '@tarojs/components';
import { Icon } from '../../ui/icon';
import { Strings } from '../../i18n/strings';
import { back, openPage, pageRoutes } from '../../framework/page';
import { ComposerBar } from '../../ui/composerBar';
import { NavBar, NavIconButton } from '../../ui/navBar';
import { getAppModel } from '../../state/appModel';
import { useStore } from '../../state/store';
import { agentPresetDisplayText, agentPresetMenuLabel } from '../../model/format';
import type { SessionId, WorkspaceId } from '../../model/types';
import type { AgentPresetEntry } from '../../model/types';
import { PageShell } from '../../ui/pageShell';
import { PresetGuideSheet } from '../../ui/presetGuide';
import { presetGuideFor } from '../../model/presetGuide';
import styles from './index.module.scss';

/**
 * 新建会话页。
 *
 * 做成整页而不是弹层：这页唯一的内容就是输入框，键盘一定会顶起来，而小程序的原生键盘
 * 在自定义弹层里定位不可靠；整页跟会话页走同一套布局，输入框自然被顶到键盘之上。
 *
 * 页面不放标题、大图标和工作区路径：新建会话页的任务就是让人马上开口，工作区与预设
 * 各留一颗胶囊贴在输入框上方就够了。
 */
export default function NewSessionPage(): JSX.Element {
  const model = getAppModel();
  const workspaces = useStore(model.workspaceStore.workspacesStore);
  const presets = useStore(model.agentPresetsStore);
  const pickerEnabled = useStore(model.agentPresetPickerEnabledStore);
  const [workspaceId, setWorkspaceId] = React.useState<WorkspaceId | undefined>(undefined);
  const [sessionId, setSessionId] = React.useState<SessionId | undefined>(undefined);
  const [preparing, setPreparing] = React.useState(true);
  const [picking, setPicking] = React.useState(false);
  const [pickingPreset, setPickingPreset] = React.useState(false);
  const [guidePreset, setGuidePreset] = React.useState<AgentPresetEntry | undefined>(undefined);
  const lastError = useStore(model.lastErrorStore);

  // 只在进入组合时跑一次（对齐 Android LaunchedEffect(Unit)）：每次页面重新显示都
  // prepare 会在从子页返回时又建一个会话。
  React.useEffect(() => {
    // 进页面就按「上次真正开出新会话的那个工作区」把会话开好；取不到才退回最近更新的那个。
    void model.loadAgentPresets();
    // 首次使用（没有任何工作区与会话）时向主机要默认工作区。
    void model.resolveNewSessionWorkspaceId().then(id => prepare(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prepare = React.useCallback(async (id?: WorkspaceId) => {
    setPreparing(true);
    setWorkspaceId(id);
    const created = await model.createSession(id);
    setSessionId(created);
    setPreparing(false);
  }, [model]);

  const workspaceTitle = workspaces.find(item => item.workspaceId === workspaceId)?.title ?? Strings.noWorkspace;
  const presetId = sessionId === undefined ? undefined : model.store(sessionId)?.agentPreset;
  const presetTitle = presetId === undefined
    ? Strings.preset
    : presets.find(entry => entry.id === presetId) !== undefined
      ? agentPresetDisplayText(presets.find(entry => entry.id === presetId) as AgentPresetEntry).name
      : presetId;

  /**
   * 工作区选择弹层。
   *
   * 换工作区要重新开一个会话：主机的会话在创建时就绑死了 cwd，改工作区改的是「在哪新建」，
   * 不是给当前这个空白会话换目录，所以这里换一次就重建一次（与 Android 的 prepare 一致）。
   */
  return (
    <PageShell>
      <View className={styles.page}>
        {/* 标题位留空：这页不需要一个「新建会话」的大标题，只需要一条回得去的路
            （对齐 Android NewSessionScreen 的 `TopAppBar(title = {}, navigationIcon = 返回)`）。
            原来这条路由微信的原生导航栏提供，改成自定义导航栏后必须自己画，
            否则这页就没有返回键了。 */}
        <NavBar
          mode='flow'
          divider={false}
          background='page'
          left={<NavIconButton name='arrow-left' ariaLabel={Strings.close} onClick={() => back()} />}
        />
        <View className={styles.body}>
          {preparing ? (
            // Android 用转圈；小程序原来只有「加载中…」文字。
            <View className={styles.spinner}>
              <Icon name='loader-circle' spin={true} />
            </View>
          ) : sessionId === undefined ? (
            // 失败原因取模型层最近一次错误（对齐 Android NewSessionScreen：显示
            // model.lastErrorMessage，并给「换工作区」与「重试」两条路）。
            <React.Fragment>
              <Text className={styles.message}>{lastError ?? Strings.noWorkspace}</Text>
              {/* 只有「换工作区 / 重试」两个纯文字动作（对齐 Android NewSessionScreen.kt:137-140
                  的 TextButton 行）；返回走顶栏，不在这里再给一个「关闭」。 */}
              <View className={styles.actions}>
                <Text className={styles.action} onClick={() => setPicking(true)}>{Strings.workspace}</Text>
                <Text className={styles.action} onClick={() => void prepare(workspaceId)}>
                  {Strings.retry}
                </Text>
              </View>
            </React.Fragment>
          ) : (
            // 会话就绪后正文留空（对齐 Android NewSessionScreen：sessionId != null 时不画
            // 任何东西，只留底部输入区）。
            null
          )}
        </View>

        {sessionId === undefined ? null : (
          <ComposerBar
            sessionId={sessionId}
            autoFocus
            header={
              <View className={styles.chips}>
                {/* 图标对齐安卓 AssistChip 的 Icons.Default.Folder / Icons.Default.Layers；
                    长度上限已在 index.module.scss 里放宽到 320px（≈160dp）。 */}
                <View className={styles.chip} onClick={() => setPicking(true)}>
                  <Icon name='folder' className={styles.chipIcon} />
                  <Text className={styles.chipText}>{workspaceTitle}</Text>
                </View>
                {/* 主机关闭 Agent 模式选择时不给入口：新会话统一走部署默认模式
                    （对齐 Android NewSessionScreen 的 agentPresetPickerEnabled）。 */}
                {pickerEnabled ? (
                  <View className={styles.chip} onClick={() => setPickingPreset(true)}>
                    <Icon name='layers' className={styles.chipIcon} />
                    <Text className={styles.chipText}>{presetTitle}</Text>
                  </View>
                ) : null}
              </View>
            }
            onSubmitted={(created: SessionId) => {
              // 只有真的发出了第一条消息才算「在这个工作区新建过会话」，
              // 光是翻一下工作区不该改掉下次的默认值。
              model.rememberNewSessionWorkspace(workspaceId);
              // 发出第一条消息后这页就没用了：换成会话页，返回键直接回到列表
              // （对齐 Android App.kt 的 onCreated → navigate(chat) + popUpTo(new)）。
              openPage(pageRoutes.CHAT, { sessionId: created }, true);
            }}
          />
        )}

        {picking ? (
          <React.Fragment>
            <View className={styles.sheetMask} onClick={() => setPicking(false)} />
            <View className={styles.sheet}>
              <View
                className={styles.sheetRow}
                onClick={() => {
                  setPicking(false);
                  // 已经是「不指定工作区」就别再走一次创建流程（对齐 Android NewSessionScreen）。
                  if (workspaceId !== undefined) void prepare(undefined);
                }}
              >
                <Text className={workspaceId === undefined ? styles.sheetTitle + ' ' + styles.selected : styles.sheetTitle}>
                  {Strings.noWorkspace}
                </Text>
                {workspaceId === undefined ? <Icon name='check' className={styles.sheetCheck} /> : null}
              </View>
              {workspaces.map(item => (
                <View
                  key={item.workspaceId}
                  className={styles.sheetRow}
                  onClick={() => {
                    setPicking(false);
                    if (item.workspaceId !== workspaceId) void prepare(item.workspaceId);
                  }}
                >
                  <Text className={item.workspaceId === workspaceId ? styles.sheetTitle + ' ' + styles.selected : styles.sheetTitle}>
                    {item.title}
                  </Text>
                  {item.workspaceId === workspaceId ? <Icon name='check' className={styles.sheetCheck} /> : null}
                  <Text className={styles.sheetPath}>{item.path}</Text>
                </View>
              ))}
            </View>
          </React.Fragment>
        ) : null}

        {pickingPreset && pickerEnabled ? (
          <React.Fragment>
            <View className={styles.sheetMask} onClick={() => setPickingPreset(false)} />
            <View className={styles.sheet}>
              {presets.map(entry => (
                <View
                  key={entry.id}
                  className={styles.sheetRow}
                  onClick={() => {
                    setPickingPreset(false);
                    if (entry.id !== presetId) choosePresetFor(entry.id);
                  }}
                >
                  <Text className={entry.id === presetId ? styles.sheetTitle + ' ' + styles.selected : styles.sheetTitle}>
                    {agentPresetMenuLabel(entry)}
                  </Text>
                  {entry.id === presetId ? <Icon name='check' className={styles.sheetCheck} /> : null}
                  {entry.description !== undefined && entry.description.length > 0 ? (
                    <Text className={styles.sheetPath}>{entry.description}</Text>
                  ) : null}
                  {/* 内置模式带说明入口（对齐 web / Mac 预设旁的 ⓘ）；点它不选中这一行。 */}
                  {presetGuideFor(entry) === undefined ? null : (
                    <View
                      className={styles.sheetGuide}
                      onClick={event => {
                        event.stopPropagation();
                        setPickingPreset(false);
                        setGuidePreset(entry);
                      }}
                    >
                      <Icon name='info' className={styles.sheetGuideIcon} />
                      <Text className={styles.sheetGuideText}>{Strings.presetGuideExplanation}</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </React.Fragment>
        ) : null}
        <PresetGuideSheet
          open={guidePreset !== undefined}
          title={guidePreset === undefined ? '' : agentPresetDisplayText(guidePreset).name}
          guide={guidePreset === undefined ? undefined : presetGuideFor(guidePreset)}
          onClose={() => setGuidePreset(undefined)}
        />
      </View>
    </PageShell>
  );

  function choosePresetFor(id: string): void {
    const target = sessionId;
    if (target === undefined) return;
    void model.selectAgentPreset(id, target).then(ok => {
      const store = model.store(target);
      if (ok && store !== undefined) store.agentPreset = id;
    });
  }
}

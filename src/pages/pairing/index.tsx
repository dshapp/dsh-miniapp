import React from 'react';
import { Input, Text, Textarea, View } from '@tarojs/components';
import { useReady } from '@tarojs/taro';
import { Strings } from '../../i18n/strings';
import { back } from '../../framework/page';
import { takePairingEntry } from '../../framework/pairingEntry';
import { scanQrCode } from '../../framework/scan';
import { getAppModel } from '../../state/appModel';
import { toast } from '../../framework/req';
import { PairingPayload, encodeKey, profileStore } from '../../state/profileStore';
import { generateDeviceKey } from '../../transport/tunnel/device';
import { Icon } from '../../ui/icon';
import { NavBar, NavIconButton, NavTextButton, NavTitle } from '../../ui/navBar';
import { PageShell } from '../../ui/pageShell';
import styles from './index.module.scss';

/**
 * `wx.getSetting` 的最小形状。
 *
 * global.d.ts 只声明了真正常用到的那几条 wx API，没列出的走索引签名兜底、返回值是
 * unknown。这里就地收窄成函数类型，不去动全局声明面（不在本区文件清单内）。
 */
type WxGetSetting = (options: {
  success?: (res: { authSetting: Record<string, boolean | undefined> }) => void;
  fail?: (error: unknown) => void;
}) => void;

const getSetting = wx.getSetting as WxGetSetting;

/**
 * 扫码配对。
 *
 * 与 Android 的 PairingScreen 同一流程：扫码或粘贴 dshm:// 配对串 -> 校验 -> 确认电脑名 -> 入库。
 * 相机走 wx.scanCode（不需要 CameraX 那样的权限管理，但进入扫码态前会先读一次授权）；
 * 电脑名用自绘对话框而不是 wx.showModal——后者在 editable 下预填不进输入框。
 */
export default function PairingPage(): JSX.Element {
  // 引导页带来的进入意图（见 framework/pairingEntry.ts），首帧同步取出：
  // - payload：引导页已经就地扫到的配对串，进来直接校验并弹命名框，不再让用户点一次扫码；
  // - mode='paste'：直接进粘贴态、焦点给输入框（引导页点了「手动输入配对串」，或相机不可用）。
  const [entry] = React.useState(() => takePairingEntry());
  const initialPayload = entry.payload;
  const [pasted, setPasted] = React.useState('');
  const [error, setError] = React.useState<string | undefined>(
    entry.cameraUnavailable === true ? Strings.scanUnavailable : undefined,
  );
  // 扫码与粘贴互斥，一个屏幕只摆一种（对齐 Android PairingScreen 的 mode 切换）：
  // 同屏常驻会让两种输入互相抢注意力，也看不出当前该做什么。
  const [scanning, setScanning] = React.useState(entry.mode !== 'paste');
  // 带着扫码结果进来时，「请扫描二维码」的提示已经没意义了，第一次进扫码态不弹。
  const skipHint = React.useRef(initialPayload !== undefined);
  // 命名弹层：text 是输入框初值（Mac 自报名），payload 是待入库的配对串。
  // 对齐 Android PairingScreen.kt:71 的 `name = PairingPayload.suggestedName(text)`。
  const [naming, setNaming] = React.useState<{ text: string; payload: string } | undefined>(undefined);
  // 点了「连接」之后：生成设备密钥、入库、发起连接，再回列表页（列表页接着显示加载态）。
  // 这段期间盖一层加载遮罩，既让用户知道在处理，也挡住重复点击。
  const [confirming, setConfirming] = React.useState(false);
  // 粘贴态要把焦点直接给配对串输入框（引导页点「手动输入配对串」就是来输入的）。
  // 等页面 onReady 再给：navigateTo 的转场动画没走完就 focus，真机上键盘常常拉不起来。
  const [ready, setReady] = React.useState(false);
  useReady(() => setReady(true));

  React.useEffect(() => {
    if (!scanning) return undefined;
    let cancelled = false;
    // 进入扫码态先读相机授权，明确被拒就不要再让用户去点扫码了：直接切粘贴态并显示
    // 「相机不可用」（对齐 Android PairingScreen.kt:45-57 进页面即申请权限、
    // :108-112 未授权时显示 scanUnavailable）。权限未决时照常扫码，由 wx.scanCode
    // 自己触发授权弹窗。
    getSetting({
      success: res => {
        if (cancelled) return;
        const camera = res.authSetting['scope.camera'];
        if (camera === false) {
          setScanning(false);
          setError(Strings.scanUnavailable);
          return;
        }
        // 扫码提示进入时弹一次（对齐 Android：常驻浮层会被别的 UI 挡住）。
        showHint();
      },
      fail: () => {
        // 读不到授权设置（旧基础库/开发者工具）时别把扫码入口一起挡掉。
        if (!cancelled) showHint();
      },
    });
    function showHint(): void {
      if (skipHint.current) {
        skipHint.current = false;
        return;
      }
      toast(Strings.scanHint);
    }
    return () => { cancelled = true; };
  }, [scanning]);

  const handle = React.useCallback((text: string) => {
    const scanned = PairingPayload.parse(text);
    if (scanned === undefined) {
      setError(Strings.pairInvalid);
      return;
    }
    setError(undefined);
    // 校验通过先弹命名框，初值就是 Mac 自报名（对齐 Android 的 pending 流程）。
    setNaming({ text: PairingPayload.suggestedName(text), payload: text });
  }, []);

  const confirmPair = (): void => {
    if (naming === undefined || confirming) return;
    const { payload, text } = naming;
    setNaming(undefined);
    setConfirming(true);
    const name = text.trim() || Strings.appName;
    void (async () => {
      // 设备私钥必须用密码学安全随机数生成（同步的 wx.getRandomValues 拿不到字节）。
      let privateKey: string | undefined;
      try {
        const identity = await generateDeviceKey();
        privateKey = encodeKey(identity.privateKey);
      } catch {
        // 生成设备密钥失败和「配对串不对」是两回事（对齐 Android 没有这条路径，
        // 这里用通用失败文案，免得用户以为要重扫）。
        setConfirming(false);
        setError(Strings.operationFailed);
        return;
      }
      const profile = profileStore.add(name, payload, privateKey);
      if (profile === undefined) {
        setConfirming(false);
        setError(Strings.pairInvalid);
        return;
      }
      // 配对成功后立刻连上新机器：add() 已把它设为 currentId，connectCurrent()
      // 会照现有资料重建传输（对齐 Android App.kt 的 onPaired → model.connect）。
      // 不弹「已连接」——连接是异步的，此刻报成功是假信息（Android 也没有这个 toast）。
      getAppModel().connectCurrent();
      back();
    })();
  };

  // 引导页已经扫到了：直接校验 + 弹命名框；不对就留在扫码态显示错误，可以重扫。
  React.useEffect(() => {
    if (initialPayload !== undefined) handle(initialPayload);
  }, [initialPayload, handle]);

  const scan = React.useCallback(() => {
    scanQrCode(outcome => {
      // 用户主动取消不是错误；相机不可用/没有权限才要说清（对齐 Android
      // PairingScreen 的 Strings.scanUnavailable），否则就是一次静默失败。
      if (outcome.kind === 'scanned') handle(outcome.text);
      else if (outcome.kind === 'unavailable') setError(Strings.scanUnavailable);
    });
  }, [handle]);

  return (
    <PageShell>
      <View className={styles.page}>
        {/* 顶栏对齐 Android PairingScreen 的 TopAppBar：关闭 + 「配对」+ 一颗切换模式的
            文字按钮。文字按钮显示的是「要切去的那一边」（安卓：manual 时显示"扫码"），
            所以扫码态显示「手动输入配对串」。原来这个切换是页面里的一排分段控件，
            现在回到标题栏，两端就长一样了。 */}
        <NavBar
          mode='flow'
          left={<NavIconButton name='x' ariaLabel={Strings.cancel} onClick={() => back()} />}
          title={<NavTitle text={Strings.pairTitle} />}
          actions={
            <NavTextButton
              text={scanning ? Strings.pastePairing : Strings.scanQR}
              onClick={() => { setScanning(current => !current); setError(undefined); }}
            />
          }
        />

        <View className={styles.body}>
        {scanning ? (
          <View className={styles.card}>
            <View className={styles.secondary} onClick={scan}>
              <Text className={styles.secondaryText}>{Strings.scanQR}</Text>
            </View>
            {error === undefined ? null : <Text className={styles.error}>{error}</Text>}
            {/* 没有可用相机时别把用户困在扫码模式里：给一条去粘贴的路。 */}
            {error === undefined ? null : (
              <View className={styles.primary} onClick={() => { setScanning(false); setError(undefined); }}>
                <Text className={styles.primaryText}>{Strings.pastePairing}</Text>
              </View>
            )}
          </View>
        ) : (
          <View className={styles.card}>
            <Text className={styles.label}>{Strings.pastePairing}</Text>
            <Textarea
              className={styles.textarea}
              value={pasted}
              placeholder='dshm://...'
              maxlength={-1}
              // 命名弹层 / 加载遮罩打开时让出焦点，免得和弹层里的输入框抢键盘。
              focus={ready && naming === undefined && !confirming}
              onInput={event => {
                setPasted(event.detail.value);
                setError(undefined);
              }}
            />
            {error === undefined ? null : <Text className={styles.error}>{error}</Text>}
            <View
              className={styles.primary + (pasted.trim().length === 0 ? ' ' + styles.primaryDisabled : '')}
              onClick={() => pasted.trim().length > 0 && handle(pasted)}
            >
              <Text className={styles.primaryText}>{Strings.connect}</Text>
            </View>
          </View>
        )}
        </View>

        {/* 确认电脑名弹层（对齐 Android PairingScreen.kt:128-146 的 AlertDialog）：
            输入框初值是 Mac 自报名，下方常驻 serverNameFooter，确认 Connect、取消 Cancel。
            自绘而不是 wx.showModal：只有自绘才能把 suggestedName 预填进输入框，脚注也才
            有地方放（showModal 只有一行只读正文）。 */}
        {naming === undefined ? null : (
          <>
            <View className={styles.modalMask} onClick={() => setNaming(undefined)} />
            <View className={styles.dialog}>
              <Text className={styles.dialogTitle}>{Strings.serverName}</Text>
              <Input
                className={styles.dialogInput}
                value={naming.text}
                focus
                placeholder={Strings.serverName}
                onInput={event => setNaming(current => (current === undefined ? current : { ...current, text: event.detail.value }))}
              />
              {/* 说明「名字只在本机显示」（对齐 Android serverNameFooter）。 */}
              <Text className={styles.dialogHint}>{Strings.serverNameFooter}</Text>
              <View className={styles.dialogActions}>
                <Text className={styles.dialogCancel} onClick={() => setNaming(undefined)}>{Strings.cancel}</Text>
                <Text className={styles.dialogConfirm} onClick={confirmPair}>{Strings.connect}</Text>
              </View>
            </View>
          </>
        )}

        {confirming ? (
          <View className={styles.loadingMask} catchMove>
            <View className={styles.loadingBox}>
              <Icon name='loader-circle' spin className={styles.loadingGlyph} />
              <Text className={styles.loadingText}>{Strings.statusConnecting}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </PageShell>
  );
}

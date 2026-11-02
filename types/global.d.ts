declare namespace NodeJS {
  interface ProcessEnv {
    TARO_ENV: 'weapp' | 'h5' | 'swan' | 'alipay' | 'tt' | 'qq' | 'jd' | 'rn';
    NODE_ENV: 'development' | 'production';
    TARO_APP_ID: string;
    TARO_APP_NAME: string;
    TARO_APP_API: string;
  }
}

declare module '*.module.scss' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.scss';
declare module '*.css';
declare module '*.png';
declare module '*.jpg';
declare module '*.svg';

declare const definePageConfig: (config: Record<string, unknown>) => Record<string, unknown>;
declare const defineAppConfig: (config: Record<string, unknown>) => Record<string, unknown>;

/**
 * 微信原生 API 的最小声明面。
 *
 * 这里只写小程序端真正会调到的那些：Taro 的封装在本地存储、扫码、选文件这些
 * 平台上返回类型不够稳，直接用 wx 反而更直白。没列出的 API 走索引签名兜底，
 * 但返回值一定是 unknown，逼着调用处自己收窄。
 */
interface WxSystemInfo {
  language?: string;
  platform?: string;
  system?: string;
  windowWidth?: number;
  windowHeight?: number;
  safeArea?: { top: number; bottom: number; height: number };
  statusBarHeight?: number;
}

interface WxScanCodeResult {
  result: string;
  scanType?: string;
  errMsg: string;
}

interface WxChooseMediaResult {
  tempFiles: { tempFilePath: string; size: number; fileType?: string }[];
  type?: string;
  errMsg: string;
}

interface WxChooseMessageFileResult {
  tempFiles: { path: string; name?: string; size?: number }[];
  errMsg: string;
}

interface WxWritableFileSystemManager {
  writeFile(options: {
    filePath: string;
    data: string | ArrayBuffer;
    encoding?: string;
    success?: () => void;
    fail?: (error: unknown) => void;
  }): void;
  mkdir(options: { dirPath: string; recursive?: boolean; success?: () => void; fail?: (error: unknown) => void }): void;
  readFileSync(filePath: string, encoding?: string): string;
  writeFileSync(filePath: string, data: string | ArrayBuffer, encoding?: string): void;
  appendFileSync(filePath: string, data: string | ArrayBuffer, encoding?: string): void;
  accessSync(path: string): void;
}

interface WxFileSystemManager extends WxWritableFileSystemManager {
  readFile(options: { filePath: string; encoding?: string; success?: (res: { data: unknown }) => void; fail?: (error: unknown) => void }): void;
  unlink(options: { filePath: string; success?: () => void; fail?: (error: unknown) => void }): void;
  /** 同步删除；搬运半途失败时要立刻清掉那半截文件。 */
  unlinkSync(filePath: string): void;
}

interface WxApi {
  setStorageSync(key: string, data: unknown): void;
  getStorageSync(key: string): unknown;
  removeStorageSync(key: string): void;
  getStorageInfoSync(): { currentSize: number; limitSize: number };
  getSystemInfoSync(): WxSystemInfo;
  getWindowInfo?(): WxSystemInfo;
  getRandomValues(options: { length: number }): { randomValues: ArrayBuffer };
  env: { USER_DATA_PATH: string };
  getFileSystemManager(): WxFileSystemManager;
  scanCode(options: { onlyFromCamera?: boolean; scanType?: string[]; success?: (res: WxScanCodeResult) => void; fail?: (error: unknown) => void }): void;
  setClipboardData(options: { data: string; success?: () => void; fail?: (error: unknown) => void }): void;
  getClipboardData(options: { success?: (res: { data: string }) => void; fail?: (error: unknown) => void }): void;
  vibrateShort(options?: { type?: string; success?: () => void; fail?: (error: unknown) => void }): void;
  chooseMedia(options: {
    count?: number;
    mediaType?: string[];
    sourceType?: string[];
    sizeType?: string[];
    success?: (res: WxChooseMediaResult) => void;
    fail?: (error: unknown) => void;
  }): void;
  chooseMessageFile(options: {
    count?: number;
    type?: string;
    extension?: string[];
    success?: (res: WxChooseMessageFileResult) => void;
    fail?: (error: unknown) => void;
  }): void;
  showToast(options: { title: string; icon?: string; duration?: number }): void;
  showModal(options: {
    title?: string;
    content?: string;
    showCancel?: boolean;
    confirmText?: string;
    cancelText?: string;
    /** 破坏性动作把确认键标红（微信原生支持，例如「移除」）。 */
    confirmColor?: string;
    /** 带输入框的模态（微信 2.17.1+）：电脑名就在这一步问。 */
    editable?: boolean;
    placeholderText?: string;
    success?: (res: { confirm: boolean; cancel: boolean; content?: string }) => void;
    fail?: (error: unknown) => void;
  }): void;
  showActionSheet(options: { itemList: string[]; success?: (res: { tapIndex: number }) => void; fail?: (error: unknown) => void }): void;
  setKeepScreenOn(options: { keepScreenOn: boolean }): void;
  [key: string]: unknown;
}

declare const wx: WxApi;

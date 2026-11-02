import { getLocale, setLocale, type AppLocale } from '../i18n/strings';
import { getSystemInfo } from '../framework/systemInfo';
import { applyTheme } from './theme';
import { readStorage, writeStorage } from './store';

/** 主题偏好：跟随系统 / 强制浅色 / 强制深色。 */
export type AppThemeMode = 'system' | 'light' | 'dark';

/**
 * 本机偏好。
 *
 * 与 Android 的 SettingsStore 同口径：这里只有语言、主题、列表排序这类「跟连哪台
 * 电脑无关」的偏好。连接参数不在这里——手机端只有加密隧道一条路，需要的
 * proxyHost/port/bridgeKey/devicePrivateKey 全部来自配对资料（state/profileStore.ts）。
 */
export interface AppSettings {
  /** null 表示跟随系统。 */
  locale: AppLocale | null;
  themeMode: AppThemeMode;
}

const LOCALE_KEY = 'dsh.locale';
const THEME_KEY = 'dsh.theme';

function resolveSystemLocale(): AppLocale {
  try {
    const info = getSystemInfo();
    const language = (info.language ?? '').toLowerCase();
    // 与 Android Strings.locale 同口径：只有明确是英文才走 EN，其余一律中文。
    // 反过来的「非 zh 一律 en」会把德语/法语等系统语言全部读成英文。
    return language.startsWith('en') ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

export function resolveLocale(preference: AppLocale | null): AppLocale {
  return preference ?? resolveSystemLocale();
}

function readInitial(): AppSettings {
  const locale = readStorage(LOCALE_KEY);
  const themeMode = readStorage(THEME_KEY);
  return {
    locale: locale === 'zh' || locale === 'en' ? locale : null,
    themeMode: themeMode === 'light' || themeMode === 'dark' ? themeMode : 'system',
  };
}

class SettingsStore {
  private state: AppSettings = readInitial();

  constructor() {
    // 首帧之前就把语言定下来，之后所有 Strings 都读这份。
    setLocale(resolveLocale(this.state.locale));
    // 主题同理：进页面前先定好，避免首帧闪一下浅色。
    applyTheme(this.state.themeMode);
  }

  get = (): AppSettings => this.state;

  private commit(next: AppSettings): void {
    this.state = next;
    for (const listener of Array.from(this.listeners)) listener();
  }

  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  chooseLocale(value: AppLocale | null): void {
    writeStorage(LOCALE_KEY, value ?? '');
    if (value === null) wx.removeStorageSync(LOCALE_KEY);
    setLocale(resolveLocale(value));
    this.commit({ ...this.state, locale: value });
  }

  chooseThemeMode(value: AppThemeMode): void {
    writeStorage(THEME_KEY, value);
    applyTheme(value);
    this.commit({ ...this.state, themeMode: value });
  }

  /** 系统语言在运行期变了：跟随系统时重新解析一次。 */
  refreshSystemLocale(): void {
    if (this.state.locale === null) setLocale(resolveLocale(null));
  }

  /** 系统主题在运行期变了：跟随系统时重新解析一次。 */
  refreshSystemTheme(): void {
    if (this.state.themeMode === 'system') applyTheme('system');
  }

  get locale(): AppLocale {
    return getLocale();
  }
}

export const settings = new SettingsStore();

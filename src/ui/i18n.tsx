/**
 * 这个文件管界面语言：有哪几种，怎么查句子，怎么记住。
 * 每句话的中英文原文不在这里，在三张 `i18nMessages.*.ts` 翻译表里。
 * 不显然的决定：匈牙利语留着数据，但不让选。
 * 2026-09-07 定（W16 04A 第二节 D-3）。
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { englishMessages } from "./i18nMessages.en";
import { hungarianMessages } from "./i18nMessages.hu";
import {
  chineseMessages,
  type TranslationKey,
  type TranslationTable,
} from "./i18nMessages.zh";

export type { TranslationKey } from "./i18nMessages.zh";

/** 程序认得的三种语言代码：简体中文、英文、匈牙利语。 */
export const LEDGER_LANGUAGES = ["zh-CN", "en", "hu"] as const;
/** 上面三种语言代码之一。 */
export type LedgerLanguage = (typeof LEDGER_LANGUAGES)[number];

/**
 * 设置页语言下拉里能选的语言：只有中文和英文。
 * 匈牙利语的代码和译文都留着，只是不放进下拉。
 * 想加回来，在这里加一项就行。
 *
 * 为什么撤下：匈牙利语只翻了界面的一小部分。
 * 选了它却满屏中文，比没有这个选项更糟。
 * 2026-09-07 定（W16 04A 第二节 D-3）。
 */
export const SELECTABLE_LEDGER_LANGUAGES = ["zh-CN", "en"] as const;
type SelectableLedgerLanguage =
  (typeof SELECTABLE_LEDGER_LANGUAGES)[number];

/** 默认语言，简体中文。读不到偏好或偏好不能用时都回到它。 */
export const DEFAULT_LEDGER_LANGUAGE: LedgerLanguage = "zh-CN";
/** 浏览器里记住语言偏好用的键名。 */
export const LANGUAGE_PREFERENCE_STORAGE_KEY =
  "local-first-trading-ledger.ui-language";

/**
 * 三种语言各自的翻译表，按语言代码放在一起。
 * 导出它，是让 `src/checks/__tests__/englishInterface.test.ts` 能直接读表。
 * 英文少一条、混进汉字、拼句少一段，那个检查都要能变红。
 * 2026-09-07 定（W16 04A 第二节 D-2）。
 */
export const LEDGER_TRANSLATION_TABLES: Record<
  LedgerLanguage,
  TranslationTable
> = {
  "zh-CN": chineseMessages,
  en: englishMessages,
  hu: hungarianMessages,
};

/**
 * 这个函数回答：某种语言下，这个翻译键显示哪句话？
 * 那种语言没有这一条，就退回中文那句。
 * 举例：匈牙利语缺某一条 → 答中文那句，开发时控制台会提醒。
 * 不会出错。
 */
export function translate(
  language: LedgerLanguage,
  key: TranslationKey,
): string {
  const translated = LEDGER_TRANSLATION_TABLES[language][key];
  if (translated !== undefined) return translated;

  if (process.env.NODE_ENV !== "production") {
    console.warn(`Missing ${language} translation for "${key}"; using Chinese.`);
  }
  return chineseMessages[key];
}

/**
 * 这个函数用默认语言（中文）查一句话。
 * 给拿不到界面语言的地方用，比如 `core` 里写错误说明。
 * 举例：查 `shared.confirmDelete.confirm` → 答「再次点击确认」。不会出错。
 */
export function translateDefault(key: TranslationKey): string {
  return translate(DEFAULT_LEDGER_LANGUAGE, key);
}

/**
 * 这个函数回答：浏览器里记住的界面语言是哪种？
 * 记的是能选的语言就用它；别的一律当默认语言。
 * 举例：浏览器里存着 `hu` → 答 `zh-CN`；存着 `en` → 答 `en`。
 * 读不到存储时也答默认语言，不抛错。
 */
export function readLanguagePreference(
  storage: Pick<Storage, "getItem"> | undefined = getBrowserStorage(),
): LedgerLanguage {
  if (!storage) return DEFAULT_LEDGER_LANGUAGE;
  try {
    const value = storage.getItem(LANGUAGE_PREFERENCE_STORAGE_KEY);
    // 为什么 `hu` 也当默认：设置页已经选不到它了。
    // 不回落，用户就会卡在一种改不回来的语言里。
    // 2026-09-07 定（W16 04A 第二节 D-3c）。
    return isLedgerLanguage(value) && isSelectableLedgerLanguage(value)
      ? value
      : DEFAULT_LEDGER_LANGUAGE;
  } catch {
    return DEFAULT_LEDGER_LANGUAGE;
  }
}

/**
 * 这个函数把选好的界面语言记进浏览器。
 * 浏览器不让存时什么都不做，不抛错。
 */
export function writeLanguagePreference(
  language: LedgerLanguage,
  storage: Pick<Storage, "setItem"> | undefined = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(LANGUAGE_PREFERENCE_STORAGE_KEY, language);
  } catch {
    // 存不进去也没关系：这次打开期间，内存里的语言照样能用。
  }
}

/** 查一句话用的那个函数的形状：给翻译键，答这句话。 */
export type Translate = (key: TranslationKey) => string;

type LanguageContextValue = Readonly<{
  language: LedgerLanguage;
  setLanguage: (language: LedgerLanguage) => void;
  t: Translate;
}>;

const defaultLanguageContext: LanguageContextValue = {
  language: DEFAULT_LEDGER_LANGUAGE,
  setLanguage: () => undefined,
  t: (key) => translate(DEFAULT_LEDGER_LANGUAGE, key),
};

const LanguageContext = createContext<LanguageContextValue>(
  defaultLanguageContext,
);

/**
 * 这个组件把界面语言提供给它里面的整棵页面。
 * 开机先用中文，读到浏览器里的偏好后再换过去。
 * 用户在设置页换语言时，它换掉显示并记进浏览器。
 * 测试可以传一个假的存储进来。
 */
export function LanguageProvider({
  children,
  storage,
}: Readonly<{
  children: ReactNode;
  storage?: Pick<Storage, "getItem" | "setItem">;
}>) {
  const [language, setLanguageState] = useState<LedgerLanguage>(
    DEFAULT_LEDGER_LANGUAGE,
  );

  useEffect(() => {
    setLanguageState(readLanguagePreference(storage));
  }, [storage]);

  const setLanguage = useCallback(
    (nextLanguage: LedgerLanguage) => {
      setLanguageState(nextLanguage);
      writeLanguagePreference(nextLanguage, storage);
    },
    [storage],
  );
  const t = useCallback(
    (key: TranslationKey) => translate(language, key),
    [language],
  );
  const value = useMemo(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t],
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

/**
 * 这个 hook 让组件拿到当前语言、换语言的函数和查句子的 `t`。
 * 在语言提供组件外面用，拿到的是中文、换语言不起作用。
 * 不会出错。
 */
export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

function isLedgerLanguage(value: unknown): value is LedgerLanguage {
  return LEDGER_LANGUAGES.some((language) => language === value);
}

function isSelectableLedgerLanguage(
  value: unknown,
): value is SelectableLedgerLanguage {
  return SELECTABLE_LEDGER_LANGUAGES.some((language) => language === value);
}

function getBrowserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

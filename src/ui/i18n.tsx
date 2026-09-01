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

export const LEDGER_LANGUAGES = ["zh-CN", "en", "hu"] as const;
export type LedgerLanguage = (typeof LEDGER_LANGUAGES)[number];

export const DEFAULT_LEDGER_LANGUAGE: LedgerLanguage = "zh-CN";
export const LANGUAGE_PREFERENCE_STORAGE_KEY =
  "local-first-trading-ledger.ui-language";

const chineseMessages = {
  "settings.language.heading": "界面语言",
  "settings.language.description": "语言偏好只保存在这台浏览器中，不写入账本文件。",
  "settings.language.label": "选择界面语言",
  "settings.language.optionChinese": "中文",
  "settings.language.optionEnglish": "English",
  "settings.language.optionHungarian": "Magyar",
} as const;

export type TranslationKey = keyof typeof chineseMessages;
type TranslationTable = Partial<Record<TranslationKey, string>>;

const englishMessages: TranslationTable = {
  "settings.language.heading": "Interface language",
  "settings.language.description":
    "The language preference is stored only in this browser and is never written to the ledger file.",
  "settings.language.label": "Select interface language",
  "settings.language.optionChinese": "Chinese",
  "settings.language.optionEnglish": "English",
  "settings.language.optionHungarian": "Hungarian",
};

const hungarianMessages: TranslationTable = {
  "settings.language.heading": "Felület nyelve",
  "settings.language.description":
    "A nyelvi beállítást csak ez a böngésző tárolja; az nem kerül a főkönyvi fájlba.",
  "settings.language.label": "A felület nyelvének kiválasztása",
  "settings.language.optionChinese": "Kínai",
  "settings.language.optionEnglish": "Angol",
  "settings.language.optionHungarian": "Magyar",
};

const translations: Record<LedgerLanguage, TranslationTable> = {
  "zh-CN": chineseMessages,
  en: englishMessages,
  hu: hungarianMessages,
};

export function translate(
  language: LedgerLanguage,
  key: TranslationKey,
): string {
  const translated = translations[language][key];
  if (translated !== undefined) return translated;

  if (process.env.NODE_ENV !== "production") {
    console.warn(`Missing ${language} translation for "${key}"; using Chinese.`);
  }
  return chineseMessages[key];
}

export function readLanguagePreference(
  storage: Pick<Storage, "getItem"> | undefined = getBrowserStorage(),
): LedgerLanguage {
  if (!storage) return DEFAULT_LEDGER_LANGUAGE;
  try {
    const value = storage.getItem(LANGUAGE_PREFERENCE_STORAGE_KEY);
    return isLedgerLanguage(value) ? value : DEFAULT_LEDGER_LANGUAGE;
  } catch {
    return DEFAULT_LEDGER_LANGUAGE;
  }
}

export function writeLanguagePreference(
  language: LedgerLanguage,
  storage: Pick<Storage, "setItem"> | undefined = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(LANGUAGE_PREFERENCE_STORAGE_KEY, language);
  } catch {
    // The in-memory preference remains usable when browser storage is blocked.
  }
}

type LanguageContextValue = Readonly<{
  language: LedgerLanguage;
  setLanguage: (language: LedgerLanguage) => void;
  t: (key: TranslationKey) => string;
}>;

const defaultLanguageContext: LanguageContextValue = {
  language: DEFAULT_LEDGER_LANGUAGE,
  setLanguage: () => undefined,
  t: (key) => translate(DEFAULT_LEDGER_LANGUAGE, key),
};

const LanguageContext = createContext<LanguageContextValue>(
  defaultLanguageContext,
);

export function LanguageProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [language, setLanguageState] = useState<LedgerLanguage>(
    DEFAULT_LEDGER_LANGUAGE,
  );

  useEffect(() => {
    setLanguageState(readLanguagePreference());
  }, []);

  const setLanguage = useCallback((nextLanguage: LedgerLanguage) => {
    setLanguageState(nextLanguage);
    writeLanguagePreference(nextLanguage);
  }, []);
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

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

function isLedgerLanguage(value: unknown): value is LedgerLanguage {
  return LEDGER_LANGUAGES.some((language) => language === value);
}

function getBrowserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

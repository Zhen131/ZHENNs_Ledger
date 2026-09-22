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

import { getLedgerDateKey } from "@/core/shared";
import { englishMessages } from "./i18nMessages.en";
import { hungarianMessages } from "./i18nMessages.hu";
import {
  chineseMessages,
  type TranslationKey,
  type TranslationTable,
} from "./i18nMessages.zh";

export type { TranslationKey } from "./i18nMessages.zh";

export const LEDGER_LANGUAGES = ["zh-CN", "en", "hu"] as const;
export type LedgerLanguage = (typeof LEDGER_LANGUAGES)[number];

/**
 * The languages the settings page offers. Hungarian stays a supported language
 * code with its translations intact, but it is withdrawn from the picker while
 * it covers only a fraction of the interface: a language you can select and
 * then find rendered almost entirely in Chinese is worse than one you cannot
 * select at all (04A D-3). Putting it back is one entry in this list.
 */
export const SELECTABLE_LEDGER_LANGUAGES = ["zh-CN", "en"] as const;
export type SelectableLedgerLanguage =
  (typeof SELECTABLE_LEDGER_LANGUAGES)[number];

export const DEFAULT_LEDGER_LANGUAGE: LedgerLanguage = "zh-CN";
export const LANGUAGE_PREFERENCE_STORAGE_KEY =
  "local-first-trading-ledger.ui-language";

/**
 * Exported so the guards in `src/test-support` can read the tables as data
 * rather than re-parsing this file: an English entry that goes missing, gains a
 * Chinese character, or drops one segment of a joined sentence has to be able
 * to turn a test red (04A D-2).
 */
export const LEDGER_TRANSLATION_TABLES: Record<
  LedgerLanguage,
  TranslationTable
> = {
  "zh-CN": chineseMessages,
  en: englishMessages,
  hu: hungarianMessages,
};

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

export function translateDefault(key: TranslationKey): string {
  return translate(DEFAULT_LEDGER_LANGUAGE, key);
}

export function formatLedgerDate(value: string): string {
  return getLedgerDateKey(value);
}

export function readLanguagePreference(
  storage: Pick<Storage, "getItem"> | undefined = getBrowserStorage(),
): LedgerLanguage {
  if (!storage) return DEFAULT_LEDGER_LANGUAGE;
  try {
    const value = storage.getItem(LANGUAGE_PREFERENCE_STORAGE_KEY);
    // A browser that stored a language since withdrawn from the picker reads
    // back as the default, so nobody is stranded in a language the settings
    // page can no longer change away from (04A D-3c).
    return isLedgerLanguage(value) && isSelectableLedgerLanguage(value)
      ? value
      : DEFAULT_LEDGER_LANGUAGE;
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

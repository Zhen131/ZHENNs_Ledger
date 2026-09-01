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

export const LEDGER_LANGUAGES = ["zh-CN", "en", "hu"] as const;
export type LedgerLanguage = (typeof LEDGER_LANGUAGES)[number];

export const DEFAULT_LEDGER_LANGUAGE: LedgerLanguage = "zh-CN";
export const LANGUAGE_PREFERENCE_STORAGE_KEY =
  "local-first-trading-ledger.ui-language";

const chineseMessages = {
  "home.workspace.ariaLabel": "首页工作区",
  "home.empty.heading": "还没有交易记录",
  "home.empty.description":
    "记录第一笔交易后，持仓、盈亏和图表会由同一份账本自动推导。",
  "home.empty.action": "记录第一笔交易",
  "home.metrics.totalAssets": "当前总资产",
  "home.metrics.remainingCostBasis": "剩余持仓成本",
  "home.metrics.unrealizedPnl": "未实现盈亏",
  "home.metrics.realizedPnl": "已实现盈亏",
  "home.metrics.unavailable": "不可完整计算",
  "home.metrics.excluded": "未计入",
  "home.trend.heading": "资产趋势",
  "home.trend.description":
    "总资产逐日重放现金与可得行情；成本线仍只读取交易。",
  "home.trend.priceSource": "价格来源",
  "home.trend.priceModeAriaLabel": "估值价格模式",
  "home.trend.priceModeAuto": "自动选择",
  "home.trend.priceModeManual": "优先手动",
  "home.trend.range": "范围",
  "home.trend.rangeAriaLabel": "持仓历史范围",
  "home.trend.range1d": "1 日",
  "home.trend.range7d": "7 日",
  "home.trend.range30d": "30 日",
  "home.trend.range365d": "365 日",
  "home.trend.rangeAll": "全部",
  "home.quickTrade.heading": "记一笔交易",
  "home.quickTrade.description": "新增真实买入或卖出事实",
  "home.missingPrices.action": "更新缺价资产",
  "shared.i18n.fallbackExample": "中文回退文案",
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
  "home.workspace.ariaLabel": "Home workspace",
  "home.empty.heading": "No transactions recorded",
  "home.empty.description":
    "After the first transaction is recorded, holdings, profit and loss, and charts are derived automatically from the same ledger.",
  "home.empty.action": "Record the first transaction",
  "home.metrics.totalAssets": "Current total assets",
  "home.metrics.remainingCostBasis": "Remaining cost basis",
  "home.metrics.unrealizedPnl": "Unrealized profit and loss",
  "home.metrics.realizedPnl": "Realized profit and loss",
  "home.metrics.unavailable": "Cannot calculate completely",
  "home.metrics.excluded": "Excluded",
  "home.trend.heading": "Asset trend",
  "home.trend.description":
    "Total assets replay cash and available prices by day; the cost line still reads transactions only.",
  "home.trend.priceSource": "Price source",
  "home.trend.priceModeAriaLabel": "Valuation price mode",
  "home.trend.priceModeAuto": "Automatic selection",
  "home.trend.priceModeManual": "Manual price first",
  "home.trend.range": "Range",
  "home.trend.rangeAriaLabel": "Holdings history range",
  "home.trend.range1d": "1 d",
  "home.trend.range7d": "7 d",
  "home.trend.range30d": "30 d",
  "home.trend.range365d": "365 d",
  "home.trend.rangeAll": "All",
  "home.quickTrade.heading": "Record transaction",
  "home.quickTrade.description": "Add a real buy or sell fact",
  "home.missingPrices.action": "Update assets without prices",
  "settings.language.heading": "Interface language",
  "settings.language.description":
    "The language preference is stored only in this browser and is never written to the ledger file.",
  "settings.language.label": "Select interface language",
  "settings.language.optionChinese": "Chinese",
  "settings.language.optionEnglish": "English",
  "settings.language.optionHungarian": "Hungarian",
};

const hungarianMessages: TranslationTable = {
  "home.workspace.ariaLabel": "Kezdőlap munkaterület",
  "home.empty.heading": "Még nincsenek rögzített tranzakciók",
  "home.empty.description":
    "Az első tranzakció rögzítése után a pozíciók, az eredmény és a diagramok automatikusan ugyanabból a főkönyvből származnak.",
  "home.empty.action": "Az első tranzakció rögzítése",
  "home.metrics.totalAssets": "Jelenlegi összvagyon",
  "home.metrics.remainingCostBasis": "Fennmaradó bekerülési érték",
  "home.metrics.unrealizedPnl": "Nem realizált eredmény",
  "home.metrics.realizedPnl": "Realizált eredmény",
  "home.metrics.unavailable": "Nem számítható ki teljesen",
  "home.metrics.excluded": "Nincs beleszámítva",
  "home.trend.heading": "A vagyon alakulása",
  "home.trend.description":
    "A teljes vagyon napi bontásban használja a készpénzt és az elérhető árakat; a költségvonal továbbra is csak a tranzakciókat olvassa.",
  "home.trend.priceSource": "Árforrás",
  "home.trend.priceModeAriaLabel": "Az értékelési ár módja",
  "home.trend.priceModeAuto": "Automatikus kiválasztás",
  "home.trend.priceModeManual": "Kézi ár elsőbbsége",
  "home.trend.range": "Időtartam",
  "home.trend.rangeAriaLabel": "A pozíciótörténet időtartama",
  "home.trend.range1d": "1 d",
  "home.trend.range7d": "7 d",
  "home.trend.range30d": "30 d",
  "home.trend.range365d": "365 d",
  "home.trend.rangeAll": "Összes",
  "home.quickTrade.heading": "Tranzakció rögzítése",
  "home.quickTrade.description": "Valós vételi vagy eladási tény hozzáadása",
  "home.missingPrices.action": "Ár nélküli eszközök frissítése",
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

export function formatLedgerDate(value: string): string {
  return getLedgerDateKey(value);
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

function getBrowserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

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
  "home.metrics.excludedSeparator": "：",
  "home.metrics.joinSeparator": "、",
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
  "home.missingPrices.separator": "：",
  "home.missingPrices.joinSeparator": "、",
  "transfer.workspace.ariaLabel": "导入与导出工作区",
  "transfer.heading": "导入与导出",
  "transfer.description.file":
    "当前 .lftl 是加密正式账本；这里导入或导出的备份文件始终是另一份明文 JSON。",
  "transfer.description.indexedDb":
    "这里导入或导出的备份文件是明文 JSON，不等同于浏览器中的本地账本记录。",
  "transfer.privacyWarning":
    "⚠ 明文备份包含完整资产、交易、价格和手续费规则。请核对浏览器实际下载位置；同步目录可能自动上传文件，不再需要时请安全删除。",
  "transfer.export.heading": "导出明文账本",
  "transfer.export.description":
    "导出不会修改当前账本；下载是否落盘仍以浏览器下载列表为准。",
  "transfer.import.heading": "预检并完整替换",
  "transfer.import.description":
    "先只读预检；只有通过当前文件授权、预检凭据和复读验证后才会写入，不会合并账本。",
  "shared.shell.navigationAriaLabel": "账本主导航",
  "shared.shell.home": "首页",
  "shared.shell.record": "记账",
  "shared.shell.transactions": "交易",
  "shared.shell.transfer": "导入与导出",
  "shared.shell.settings": "设置",
  "shared.shell.lock": "锁定账本",
  "shared.shell.workspaceLabel": "加密账本工作区",
  "record.workspace.ariaLabel": "记账工作区",
  "record.heading": "记录现金、交易、资产转入转出与价格",
  "record.description":
    "先选择现金、资产转移或某项本地资产；切换时会卸载另一张表单，不保留过期确认。",
  "record.readOnlyNotice": "暂不可录入：当前账本只读或文件操作尚未完成，请查看顶部文件状态。",
  "record.target.label": "记账对象",
  "record.target.cash": "现金 USDT",
  "record.target.assetTransfer": "资产转入转出",
  "record.trade.headingPrefix": "新增 ",
  "record.trade.headingSuffix": " 交易",
  "record.trade.description": "金额默认由数量 × 均价自动计算；手动改写后保持手动模式。",
  "record.price.heading": "更新当前价格",
  "record.price.description": "手动价格只用于估值；资产与日期会在认证保存后保留。",
  "cash.negativeConfirmation.defaultConfirm": "确认并保存",
  "cash.negativeConfirmation.description":
    "这次操作会让 USDT 现金为负。负余额可以保存，但表示账本中的现金来源尚不完整。",
  "cash.negativeConfirmation.currentBalance": "当前余额",
  "cash.negativeConfirmation.change": "本次变化",
  "cash.negativeConfirmation.nextBalance": "保存后余额",
  "cash.negativeConfirmation.deficit": "现金缺口",
  "cash.negativeConfirmation.validity":
    "确认只对当前账本版本有效；若期间发生其他保存，本次确认会失效且不会写入。",
  "cash.negativeConfirmation.cancel": "取消",
  "portfolio.overview.heading": "当前持仓",
  "portfolio.overview.description":
    "按当前市值展示前五。本表所有数字都只描述现在还持有的部分；持仓均价与剩余持仓成本均已包含手续费。",
  "portfolio.overview.showAll": "查看全部持仓",
  "portfolio.overview.empty": "暂无非零资产；现金 USDT 仍显示为 0。",
  "portfolio.overview.tableAriaLabel": "前五持仓",
  "portfolio.overview.column.asset": "币种",
  "portfolio.overview.column.latestPrice": "当前价格",
  "portfolio.overview.column.averageCost": "持仓均价",
  "portfolio.overview.column.priceChange": "相对均价涨跌",
  "portfolio.overview.column.unrealizedPnl": "未实现盈亏",
  "portfolio.overview.column.quantity": "持仓量",
  "portfolio.overview.column.costBasis": "剩余持仓成本",
  "portfolio.overview.column.marketValue": "当前市值",
  "portfolio.overview.cash": "现金 USDT",
  "portfolio.overview.balance": "余额",
  "portfolio.overview.missingPrice": "缺少合法价格",
  "portfolio.overview.unreliable": "不可可靠计算",
  "portfolio.overview.unavailable": "不可计算",
  "portfolio.overview.incomplete": "不可完整计算",
  "portfolio.overview.excludedPrefix": "未参与排名：",
  "portfolio.overview.excludedSuffix": " 缺少合法当前价格。",
  "portfolio.overview.joinSeparator": "、",
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

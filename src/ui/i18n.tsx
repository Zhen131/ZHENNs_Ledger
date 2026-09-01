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
  "shared.confirmDelete.confirm": "再次点击确认",
  "trades.delete.undoPrefix": "撤回",
  "trades.delete.countdownPrefix": "撤回 · ",
  "trades.delete.secondsSuffix": " 秒",
  "trades.delete.savingSuffix": "正在保存",
  "trades.delete.saving": "正在保存…",
  "trades.delete.armed": "再次点击删除",
  "trades.delete.idle": "删除",
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
  "portfolio.details.ariaLabel": "完整持仓详情",
  "portfolio.details.derived": "实时派生，不单独存储",
  "portfolio.details.description": "累计买入流出是历史上买入一共支出的现金，不与本表其他任何列相减。",
  "portfolio.details.closeAriaLabel": "关闭完整持仓详情",
  "portfolio.details.tableAriaLabel": "完整持仓与现金明细",
  "portfolio.details.column.asset": "资产",
  "portfolio.details.column.quantity": "持仓数量",
  "portfolio.details.column.exchangeQuantity": "交易所数量",
  "portfolio.details.column.coldWalletQuantity": "冷钱包数量",
  "portfolio.details.column.coldWalletEarnQuantity": "冷钱包理财数量",
  "portfolio.details.column.averageCost": "持仓均价",
  "portfolio.details.column.costBasis": "剩余持仓成本",
  "portfolio.details.column.realizedPnl": "已实现盈亏",
  "portfolio.details.column.latestPrice": "当前价格",
  "portfolio.details.column.marketValue": "当前市值",
  "portfolio.details.column.unrealizedPnl": "未实现盈亏",
  "portfolio.details.column.buyOutflow": "累计买入流出",
  "portfolio.details.cash": "现金 USDT",
  "portfolio.details.dash": "—",
  "portfolio.details.noPrice": "未输入价格",
  "portfolio.details.unreliable": "不可可靠计算",
  "portfolio.details.missingPrice": "缺少合法价格",
  "portfolio.details.incomplete": "不可完整计算",
  "portfolio.details.joinSeparator": "；",
  "charts.allocation.headingPrefix": "当前 ",
  "charts.allocation.headingSuffix": " 资产分配",
  "charts.allocation.ariaPrefix": "当前 ",
  "charts.allocation.ariaSuffix": " 资产分配饼图",
  "charts.allocation.geometryPrefix": "几何分配 ",
  "charts.allocation.geometryMiddle": " 项；净总资产",
  "charts.allocation.missingDescription": "非零持仓缺少合法价格，当前不绘制误导性空饼。缺价资产：",
  "charts.allocation.emptyPrefix": "当前没有可绘制的正资产扇区；净总资产为",
  "charts.allocation.cashDeficit": "现金缺口",
  "charts.allocation.cashDeficitSuffix": "；负现金不绘制为正扇区。",
  "charts.allocation.unvaluedPrefix": "未估值资产：",
  "charts.allocation.excludedPrefix": "非 USD/USDT 旧资产已排除：",
  "charts.allocation.joinSeparator": "、",
  "charts.allocation.period": "。",
  "charts.trend.range1d": "1日",
  "charts.trend.range7d": "7日",
  "charts.trend.range30d": "30日",
  "charts.trend.range365d": "365日",
  "charts.trend.rangeAll": "全部",
  "charts.trend.heading": "总资产 / 剩余持仓成本",
  "charts.trend.description": "日级阶梯线；总资产逐日重放当时的 USDT 现金与可得行情。成本线仍只来自交易。",
  "charts.trend.rangeAriaLabel": "持仓历史范围",
  "charts.trend.ariaLabel": "总资产与剩余持仓成本阶梯线图",
  "charts.trend.pointSummaryMiddle": " 个显示点；",
  "charts.trend.pointSummarySuffix": " 个点具备完整市场价格",
  "charts.trend.missingPrefix": "，",
  "charts.trend.missingSuffix": " 个市值点因缺价断开",
  "charts.trend.period": "。",
  "charts.trend.unreliableSuffix": " 个成本点因异币手续费无法换算而断开；市值线和交易热力图仍按各自事实显示。",
  "charts.trend.singleDay": "无可靠日内变化，边界点仅用于显示。",
  "charts.heatmap.overview.heading": "最近 365 天交易活跃",
  "charts.heatmap.overview.descriptionPrefix": "一周一列、星期为行；共",
  "charts.heatmap.overview.daysSuffix": "个自然日",
  "charts.heatmap.overview.tradesSuffix": "笔交易。",
  "charts.heatmap.overview.clearSelection": "清除日期筛选",
  "charts.heatmap.overview.ariaLabel": "最近 365 天交易活跃热力图",
  "charts.heatmap.overview.levels": "活跃等级：无交易 / 低 / 较低 / 较高 / 最高。",
  "charts.heatmap.overview.selectedPrefix": "当前筛选",
  "charts.heatmap.overview.selectedSuffix": "的交易，再点同一天可取消。",
  "charts.heatmap.overview.idleHint": "点击日期格可筛选交易列表。",
  "charts.heatmap.home.heading": "最近 365 天交易活动",
  "charts.heatmap.home.viewAll": "查看全部交易",
  "charts.heatmap.home.gridAriaLabel": "最近 365 天交易活动日格",
  "charts.heatmap.home.emptyDay": "当天无交易",
  "charts.heatmap.tooltip.totalPrefix": "共",
  "charts.heatmap.tooltip.tradesSuffix": "笔",
  "charts.heatmap.tooltip.buyPrefix": "买入",
  "charts.heatmap.tooltip.sellPrefix": "卖出",
  "charts.heatmap.tooltip.buy": "买入",
  "charts.heatmap.tooltip.sell": "卖出",
  "charts.heatmap.tooltip.remainingPrefix": "另有",
  "charts.heatmap.tooltip.remainingSuffix": "笔交易",
  "shared.i18n.fallbackExample": "中文回退文案",
  "settings.language.heading": "界面语言",
  "settings.language.description": "语言偏好只保存在这台浏览器中，不写入账本文件。",
  "settings.language.label": "选择界面语言",
  "settings.language.optionChinese": "中文",
  "settings.language.optionEnglish": "English",
  "settings.language.optionHungarian": "Magyar",
  "settings.workspace.ariaLabel": "设置工作区",
  "settings.heading": "账本设置",
  "settings.description": "配置只作用于当前账本；历史经济规则通过新版本替换，不原地改写。",
  "settings.tabs.ariaLabel": "设置分类",
  "settings.tabs.market": "本地资产与行情",
  "settings.tabs.fees": "手续费规则",
  "settings.tabs.danger": "危险操作",
  "settings.period": "。",
  "settings.clear.error.confirmationPrefix": "请输入完整确认文本",
  "settings.clear.error.failed": "清空未完成；当前文件与页面状态以顶部错误提示为准",
  "settings.clear.success.file": "当前账本内容已清空，.lftl 文件仍然存在",
  "settings.clear.success.browser": "当前浏览器账本已清空",
  "settings.clear.disabled.notAllowed": "当前文件状态不允许清空",
  "settings.clear.disabled.readOnly": "当前账本处于只读保护，不能清空",
  "settings.clear.disabled.switching": "文件切换尚未完成，暂不能清空",
  "settings.clear.disabled.operating": "当前文件操作完成前暂不能清空",
  "settings.clear.open": "打开清空账本操作",
  "settings.clear.unavailablePrefix": "暂不可用",
  "settings.clear.confirmation.ariaLabel": "清空账本确认",
  "settings.clear.confirmation.heading": "这会清空当前账本内容",
  "settings.clear.confirmation.descriptionPrefix": "自定义资产、交易、价格和手续费规则都会清空；不会删除",
  "settings.clear.confirmation.file": "当前 .lftl 文件",
  "settings.clear.confirmation.browser": "浏览器或应用本身",
  "settings.clear.confirmation.descriptionSuffix": "，也不会增加“删除账本文件”能力。",
  "settings.clear.confirmation.backupAdvice": "建议先到“导入与导出”导出一份明文备份并安全保管。",
  "settings.clear.confirmation.inputPrefix": "输入",
  "settings.clear.confirmation.inputSuffix": "以确认",
  "settings.clear.confirmation.inputAriaLabel": "输入清空确认文本",
  "settings.clear.confirmation.clearing": "正在清空并复读验证，请勿关闭页面。",
  "settings.clear.confirmation.confirm": "确认清空账本内容",
  "settings.clear.confirmation.cancel": "取消",
  "prices.field.asset": "价格资产",
  "prices.field.price": "价格",
  "prices.field.currentPrice": "当前价格",
  "prices.field.currency": "计价货币",
  "prices.field.currencyAriaPrefix": "价格计价货币",
  "prices.field.date": "价格日期",
  "prices.field.source": "价格来源",
  "prices.field.binanceProvenance": "Binance 来源证据",
  "prices.field.note": "价格备注",
  "prices.field.optional": "可选",
  "prices.validation.assetNotFound": "请选择账本中已有的资产",
  "prices.validation.invalidDecimal": "当前价格必须是有效数字",
  "prices.validation.positive": "当前价格必须大于 0",
  "prices.validation.currencyMismatch": "计价货币与资产设置不一致",
  "prices.validation.invalidSource": "价格来源不受支持",
  "prices.validation.invalidBinanceProvenance": "Binance 价格来源证据无效",
  "prices.validation.futureFact": "价格日期不能晚于今天",
  "prices.validation.unsupportedCurrency": "当前仅支持 USD/USDT 估值",
  "prices.validation.newFactRequiresUsdt": "旧 USD 账本只兼容读取；请新建 USDT 账本后再录入",
  "prices.validation.invalidInputSuffix": "不能为空或格式不正确",
  "prices.status.certifiedSaved": "价格已认证保存",
  "prices.status.unsaved": "价格仍在内存中，但尚未保存；请重试保存",
  "prices.status.serviceError": "系统暂时无法生成价格记录，请稍后重试",
  "prices.status.ledgerNotWritable": "账本当前不可写，请稍后重试",
  "prices.status.unchanged": "账本未发生变化，请检查输入",
  "prices.status.added": "价格已加入账本",
  "prices.status.saving": "正在保存…",
  "prices.action.save": "保存价格",
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

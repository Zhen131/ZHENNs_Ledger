/**
 * 这个文件是账本领域词的中英对照表（术语表）。
 * 它只存数据；英文译文在 `i18nMessages.en.ts`，检查在 `src/checks/__tests__/englishInterface.test.ts`。
 * 不显然的决定：一个中文词只许有一种英文说法。
 * 2026-09-07 定（W16 04A 第二节 D-4）。
 */
/**
 * 术语表里的一条：一个中文词，钉死的英文说法，定没定，备注。
 *
 * 为什么钉死：同一个词翻成三种说法，读者会以为是三个概念。
 *
 * 检查怎么对：
 * 1. 先拿长词去对中文句子；长词占掉的字，短词不能再用。
 *    所以「交易所」先占字，标签不会被要求再写 transaction。
 * 2. 剩下的每个词，英文句子里必须有钉死的说法。
 *    不分大小写；多个空格算一个；末词可带规则结尾，见 `inflections`。
 */
export type GlossaryTerm = Readonly<{
  /** 中文词，和它在句子里出现的样子一样。 */
  chinese: string;
  /** 带这个词的英文句子都必须用的那一种说法。 */
  english: string;
  /**
   * confirmed 是定了；unconfirmed 是先统一用着，还要产品负责人拍板。
   * 没定的原因写在 `note` 里。
   */
  status: "confirmed" | "unconfirmed";
  /** 这个词为什么进术语表，或者它的说法为什么还没定。 */
  note: string;
  /**
   * 也算数的不规则英文变形。
   * 检查已经认 s、es、ed、d、ing 这些规则结尾。
   * 这里只放词根会变的，比如 undo 变成 undone。
   */
  inflections?: readonly string[];
}>;

/** 整张术语表。检查按中文词长短排序后逐条对。 */
export const TRANSLATION_GLOSSARY: readonly GlossaryTerm[] = [
  {
    chinese: "账本文件",
    english: "ledger file",
    status: "confirmed",
    note: "The .lftl file on disk, as opposed to the ledger it carries.",
  },
  {
    chinese: "账本",
    english: "ledger",
    status: "confirmed",
    note: "The product's central noun; every other reading would rename the product.",
  },
  {
    chinese: "交易所",
    english: "exchange",
    status: "confirmed",
    note: "A custody location, not a transaction; listed so it consumes its characters before 交易.",
  },
  {
    chinese: "交易对",
    english: "trading pair",
    status: "confirmed",
    note: "A Binance market symbol, not a ledger transaction; listed so it consumes its characters before 交易.",
  },
  {
    chinese: "交易",
    english: "transaction",
    status: "confirmed",
    note: "Matches the wording the pre-existing English messages already used.",
  },
  {
    chinese: "现金回放",
    english: "cash replay",
    status: "confirmed",
    note: "The day-by-day cash reconstruction; a distinct mechanism from a cash balance.",
  },
  {
    chinese: "现金",
    english: "cash",
    status: "confirmed",
    note: "The USDT cash side of the ledger.",
  },
  {
    chinese: "剩余持仓成本",
    english: "remaining cost basis",
    status: "confirmed",
    note: "Already pinned by the pre-existing English for home.metrics.remainingCostBasis.",
  },
  {
    chinese: "持仓均价",
    english: "average cost basis",
    status: "confirmed",
    note: "Fee-inclusive average cost of what is still held; 'cost basis' is the accounting term and already carries the acquisition costs.",
  },
  {
    chinese: "持仓",
    english: "holdings",
    status: "confirmed",
    note: "Already pinned by the pre-existing English for home.trend.rangeAriaLabel.",
  },
  {
    chinese: "已实现盈亏",
    english: "realized profit and loss",
    status: "confirmed",
    note: "Already pinned by the pre-existing English for home.metrics.realizedPnl.",
  },
  {
    chinese: "未实现盈亏",
    english: "unrealized profit and loss",
    status: "confirmed",
    note: "Already pinned by the pre-existing English for home.metrics.unrealizedPnl.",
  },
  {
    chinese: "盈亏",
    english: "profit and loss",
    status: "confirmed",
    note: "Spelled out rather than 'P&L' so the thesis reads the same as the interface.",
  },
  {
    chinese: "手续费规则",
    english: "fee rule",
    status: "confirmed",
    note: "The configured rule, as opposed to a fee actually charged.",
  },
  {
    chinese: "手续费",
    english: "fee",
    status: "confirmed",
    note: "Trading fees; the ledger has no other kind of fee.",
  },
  {
    chinese: "资产转移",
    english: "asset transfer",
    status: "confirmed",
    note: "Moving an asset between places; never a buy or a sell.",
  },
  {
    chinese: "资产",
    english: "asset",
    status: "confirmed",
    note: "Already pinned by the pre-existing English for home.trend.heading.",
  },
  {
    chinese: "币种",
    english: "currency",
    status: "confirmed",
    note: "Which currency a fee or a valuation is denominated in; four of its five uses read this way.",
  },
  {
    chinese: "事实",
    english: "fact",
    status: "confirmed",
    note: "The ledger's record-level noun, already pinned by home.quickTrade.description.",
  },
  {
    chinese: "快照",
    english: "snapshot",
    status: "confirmed",
    note: "A price recorded at a moment, stored as its own record.",
  },
  {
    chinese: "备份",
    english: "backup",
    status: "confirmed",
    note: "The plaintext JSON export, never the encrypted ledger file.",
  },
  {
    chinese: "明文",
    english: "plaintext",
    status: "confirmed",
    note: "The safety warnings turn on this word, so it must never soften to 'plain'.",
  },
  {
    chinese: "预检",
    english: "preflight",
    status: "confirmed",
    note: "The read-only inspection that runs before an import writes anything.",
  },
  {
    chinese: "复读验证",
    english: "read-back verification",
    status: "confirmed",
    note: "Reading the write back to prove it landed; no settled English term exists for it.",
  },
  {
    chinese: "估值",
    english: "valuation",
    status: "confirmed",
    note: "Already pinned by the pre-existing English for home.trend.priceModeAriaLabel.",
  },
  {
    chinese: "价格",
    english: "price",
    status: "confirmed",
    note: "Already pinned by the pre-existing English for home.trend.priceSource.",
  },
  {
    chinese: "总资产",
    english: "total assets",
    status: "confirmed",
    note: "Already pinned by the pre-existing English for home.metrics.totalAssets.",
  },
  {
    chinese: "时区",
    english: "time zone",
    status: "confirmed",
    note: "Two words, matching the IANA wording the forms already show.",
  },
  {
    chinese: "时刻",
    english: "moment",
    status: "confirmed",
    note: "The exact instant a fact happened, as distinct from its date.",
  },
  {
    chinese: "只读",
    english: "read-only",
    status: "confirmed",
    note: "The protection state that blocks writing; hyphenated so it reads as one state.",
  },
  {
    chinese: "冷钱包",
    english: "cold wallet",
    status: "confirmed",
    note: "A custody location; 'cold storage' would read as a different place.",
  },
  {
    chinese: "平台",
    english: "platform",
    status: "confirmed",
    note: "Where a transaction happened; kept distinct from 交易所, which is a custody location.",
  },
  {
    chinese: "余额",
    english: "balance",
    status: "confirmed",
    note: "The cash balance the negative-cash confirmations turn on.",
  },
  {
    chinese: "数量",
    english: "quantity",
    status: "confirmed",
    note: "How much of an asset; never 'amount', which is reserved for money.",
    inflections: ["quantities"],
  },
  {
    chinese: "金额",
    english: "amount",
    status: "confirmed",
    note: "A sum of money; never 'quantity', which is reserved for asset units.",
  },
  {
    chinese: "日期",
    english: "date",
    status: "confirmed",
    note: "The calendar day of a fact, as distinct from its 时刻.",
  },
  {
    chinese: "来源",
    english: "source",
    status: "confirmed",
    note: "Already pinned by the pre-existing English for home.trend.priceSource.",
  },
  {
    chinese: "浏览器",
    english: "browser",
    status: "confirmed",
    note: "Already pinned by the pre-existing English for settings.language.description.",
  },
  {
    chinese: "会话",
    english: "session",
    status: "confirmed",
    note: "One unlocked working period over a ledger file.",
  },
  {
    chinese: "密码",
    english: "password",
    status: "confirmed",
    note: "What unlocks a ledger file; kept apart from any key or credential wording.",
  },
  {
    chinese: "导入",
    english: "import",
    status: "confirmed",
    note: "Reading a backup in; the counterpart of 导出.",
  },
  {
    chinese: "导出",
    english: "export",
    status: "confirmed",
    note: "Writing a backup out; the counterpart of 导入.",
  },
  {
    chinese: "清空",
    english: "clear",
    status: "confirmed",
    note: "Emptying the ledger's contents; never 'delete', which removes a record.",
  },
  {
    chinese: "撤回",
    english: "undo",
    status: "confirmed",
    note: "Taking back a deletion inside its countdown.",
    inflections: ["undone", "undoes"],
  },
  {
    chinese: "未来",
    english: "future",
    status: "confirmed",
    note: "A fact dated after today, which the ledger quarantines.",
  },
  {
    chinese: "手动",
    english: "manual",
    status: "confirmed",
    note: "Already pinned by the pre-existing English for home.trend.priceModeManual.",
  },
];

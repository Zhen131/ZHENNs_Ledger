/**
 * The Chinese-to-English glossary for the ledger's domain vocabulary.
 *
 * The interface repeats a small set of accounting and trading words. When the
 * same Chinese word reaches English as three different phrasings, a reader
 * assumes three different concepts, so every entry below pins exactly one
 * English wording for one Chinese word. `translationGlossary.test.ts` reads
 * this table as data and turns red when an English message drops the pinned
 * wording, which is why this file holds data rather than prose.
 *
 * Matching rule (the guard implements exactly this):
 *   1. Terms are matched against the Chinese message longest term first. The
 *      characters a longer term consumes are not offered to a shorter one, so
 *      "交易所" consumes its characters before "交易" is considered and an
 *      "exchange" label is never asked to also say "transaction".
 *   2. For every term that survives step 1, the English message must contain
 *      the pinned wording, compared case-insensitively, with runs of spaces in
 *      the pinned wording matching any run of whitespace, and with an optional
 *      plural "s"/"es" allowed on its final word.
 */
export type GlossaryTerm = Readonly<{
  /** The Chinese word as it appears inside a message value. */
  chinese: string;
  /** The single English wording every message carrying that word must use. */
  english: string;
  /**
   * "confirmed" means the wording is settled. "unconfirmed" means it was
   * applied consistently so the interface stays coherent, but the product
   * owner should still rule on it; the reason is recorded in `note`.
   */
  status: "confirmed" | "unconfirmed";
  /** Why this word is in the glossary, or why its wording is still open. */
  note: string;
  /**
   * Irregular English forms that also satisfy this term. The guard already
   * accepts the regular "s"/"es"/"ed"/"d"/"ing" endings, so this is only for
   * words whose stem changes, such as "undo" becoming "undone".
   */
  inflections?: readonly string[];
}>;

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
    english: "average holding cost",
    status: "unconfirmed",
    note: "Fee-inclusive average cost of what is still held; 'average cost' alone reads as a market average.",
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
    status: "unconfirmed",
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

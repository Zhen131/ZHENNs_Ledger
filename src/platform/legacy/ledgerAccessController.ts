/**
 * 这个文件管一件事。
 * 查看浏览器里有没有退役的旧账本时，答案长什么样。
 * 它不管怎么去查，那在 indexedDbStorageAdapter.ts 和 app 区的进账本前检查。
 * 不显然的决定：旧账本只看在不在，不开、不改、不删。2026-11-06 定（W24 06 第二节第 2、4 条）。
 */

/**
 * 查看旧账本时可能报的三种错误代码。
 * 包括读不了、格式不认识、外壳坏了。
 */
export const LEDGER_ACCESS_ERROR_CODES = {
  READ_FAILED: "LEDGER_ACCESS_READ_FAILED",
  UNSUPPORTED_FORMAT: "LEDGER_ACCESS_UNSUPPORTED_FORMAT",
  INVALID_ENVELOPE: "LEDGER_ACCESS_INVALID_ENVELOPE",
} as const;

/** 上面那张表里任意一个错误代码。 */
export type LedgerAccessErrorCode =
  (typeof LEDGER_ACCESS_ERROR_CODES)[keyof typeof LEDGER_ACCESS_ERROR_CODES];

/** 查看的结果：要新建、要输密码，或者出错。 */
export type LedgerAccessInspection =
  | { status: "setup-required" }
  | { status: "unlock-required" }
  | { status: "error"; code: LedgerAccessErrorCode };

/**
 * 这个类型说明「查看旧账本」的那一方能做什么。
 * 只能查看。
 * 现在的程序对浏览器里的旧账本只看在不在。
 * 不打开、不升级、不写、不删。
 *
 * 为什么这样：2026-07～08 那套浏览器存账的老办法已经退役。
 * 2026-11-06 定（W24 06 第二节第 2、4 条；W24 09B 第一节）。
 */
export interface LedgerAccessController {
  inspect(): Promise<LedgerAccessInspection>;
}

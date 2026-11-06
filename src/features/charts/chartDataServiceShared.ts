/**
 * 这个文件放三张图共用的一个小函数：默认计价单位。
 * 各张图的数据在旁边的 `chartDataService*.ts`。
 * 没有特别的决定。
 */
import type { LedgerData } from "@/core/models";

/**
 * 这个函数回答：一个价格都没有时，图上写 USD 还是 USDT？
 * 有任何一种币用 USDT 计价就写 USDT，否则写 USD。
 * 举例：BTC 用 USDT 计价 → 答 USDT。
 * 不会出错。
 */
export function getDefaultValuationCurrency(
  ledgerData: LedgerData,
): "USD" | "USDT" {
  return ledgerData.assets.some((asset) => asset.quoteCurrency === "USDT")
    ? "USDT"
    : "USD";
}

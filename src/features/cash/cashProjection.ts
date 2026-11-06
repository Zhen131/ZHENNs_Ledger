/**
 * 这个文件管一件事：改一笔现金记录前后，USDT 余额会怎么变。
 * 它不管按顺序过账的细节，那在 core 的 `cashReplay`；也不管弹确认框，那在 `NegativeCashConfirmationDialog.tsx`。
 * 不显然的决定：余额会变负时要人再点一次确认；2026-08-19 定（W14 01A 第二节）。
 */
import type { DecimalString, LedgerData } from "@/core/models";
import { replayUsdtCash } from "@/core/calculations";
import { absolute, isNegative, subtract } from "@/core/shared";

/**
 * 改动前后的现金对比：原来多少、变了多少、改完多少。
 * 余额为负时还有缺口多少，以及要不要再确认一次。
 */
export type CashMutationProjection = Readonly<{
  currentBalance: DecimalString;
  delta: DecimalString;
  nextBalance: DecimalString;
  deficit: DecimalString;
  requiresNegativeBalanceConfirmation: boolean;
}>;

/**
 * 这个函数回答：账本从改前变成改后，到今天 USDT 余额会怎么变？
 * 两本账都从第一笔到最后一笔按顺序过一遍，再相减。
 * 举例：改前余额 100，删掉一笔 300 的入金 → 答改后 -200。
 * 这时缺口 200，要再确认一次。
 * 不会出错。
 */
export function projectLedgerCashMutation(
  currentLedger: Pick<LedgerData, "trades" | "cashEvents">,
  nextLedger: Pick<LedgerData, "trades" | "cashEvents">,
  todayKey: string,
): CashMutationProjection {
  const currentBalance = replayUsdtCash(currentLedger, {
    asOf: todayKey,
  }).balance;
  const nextBalance = replayUsdtCash(nextLedger, { asOf: todayKey }).balance;
  const negative = isNegative(nextBalance);

  return {
    currentBalance,
    delta: subtract(nextBalance, currentBalance),
    nextBalance,
    deficit: negative ? absolute(nextBalance) : "0",
    requiresNegativeBalanceConfirmation: negative,
  };
}

import type { DecimalString, LedgerData } from "@/core/models";
import { replayUsdtCash } from "@/core/calculations";
import { absolute, isNegative, subtract } from "@/core/shared";

export type CashMutationProjection = Readonly<{
  currentBalance: DecimalString;
  delta: DecimalString;
  nextBalance: DecimalString;
  deficit: DecimalString;
  requiresNegativeBalanceConfirmation: boolean;
}>;

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

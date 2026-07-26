import type { LedgerData } from "../models";
import { replayPositions } from "../calculators/positionReplay";

export const TRADE_REMOVAL_ERROR_CODES = {
  NOT_FOUND: "TRADE_REMOVAL_NOT_FOUND",
  BREAKS_LEDGER_TIMELINE: "TRADE_REMOVAL_BREAKS_LEDGER_TIMELINE",
} as const;

export type TradeRemovalResult =
  | {
      ok: true;
      tradeId: string;
    }
  | {
      ok: false;
      error: {
        code:
          | "TRADE_REMOVAL_NOT_FOUND"
          | "TRADE_REMOVAL_BREAKS_LEDGER_TIMELINE";
        message: string;
      };
    };

/**
 * 删除交易前重放候选账本的完整交易时间线，包括被界面隔离的未来事实。
 *
 * reducer 只负责不可变更新；会影响后续卖出时间线的业务判断放在 service。
 */
export function validateTradeRemoval(
  tradeId: string,
  ledgerData: LedgerData,
): TradeRemovalResult {
  if (!ledgerData.trades.some((trade) => trade.id === tradeId)) {
    return {
      ok: false,
      error: {
        code: TRADE_REMOVAL_ERROR_CODES.NOT_FOUND,
        message: `Trade not found: ${tradeId}`,
      },
    };
  }

  const candidateLedger: LedgerData = {
    ...ledgerData,
    trades: ledgerData.trades.filter((trade) => trade.id !== tradeId),
  };

  try {
    replayPositions(candidateLedger.trades);
  } catch {
    return {
      ok: false,
      error: {
        code: TRADE_REMOVAL_ERROR_CODES.BREAKS_LEDGER_TIMELINE,
        message:
          "Deleting this trade would make a later trade invalid or break position calculation",
      },
    };
  }

  return { ok: true, tradeId };
}

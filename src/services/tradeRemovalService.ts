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
 * Replays the candidate ledger's complete trade timeline before deletion, including future facts isolated by the UI.
 *
 * The reducer only performs immutable updates; domain checks affecting later sells belong in the service.
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

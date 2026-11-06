/**
 * 这个文件管一件事：删一笔买卖前，先看账还算不算得通。
 * 真正从账本里删掉不在这里，在 core 的改账那段代码里。
 * 不显然的决定：检查时连今天以后的买卖也算进去；为什么，这是猜的，要核。
 */
import type { LedgerData } from "@/core/models";
import { replayPositions } from "@/core/calculations";

/** 删一笔买卖失败的两种原因：找不到，或删后账算不通。 */
export const TRADE_REMOVAL_ERROR_CODES = {
  NOT_FOUND: "TRADE_REMOVAL_NOT_FOUND",
  BREAKS_LEDGER_TIMELINE: "TRADE_REMOVAL_BREAKS_LEDGER_TIMELINE",
} as const;

type TradeRemovalResult =
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
 * 这个函数回答：这笔买卖能不能删？
 * 把它拿掉后，从第一笔到最后一笔按顺序过一遍。
 * 买卖和转账都过。
 * 今天以后的记录也一起过，不只看界面上显示的。
 * 举例：先买 0.1 BTC，后卖 0.04 BTC。
 * 想删那笔买入 → 答不能删，因为后面的卖出就卖空了。
 * 为什么要先检查：删完才发现算不通，账本就坏了。
 * 这是猜的，要核。
 * 什么时候出错：不抛错，返回 `ok:false` 和原因代码。
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
    replayPositions(candidateLedger.trades, candidateLedger.assetTransfers);
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

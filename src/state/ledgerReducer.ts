import type { LedgerData, PriceSnapshot, Trade } from "../models";
import { createInitialLedgerData } from "./initialLedgerData";

export type LedgerAction =
  | {
      type: "trade/add";
      trade: Trade;
    }
  | {
      type: "trade/delete";
      tradeId: string;
    }
  | {
      type: "priceSnapshot/add";
      priceSnapshot: PriceSnapshot;
    }
  | {
      type: "ledger/replace";
      ledgerData: LedgerData;
    }
  | {
      type: "ledger/reset";
    };

export function ledgerReducer(
  state: LedgerData,
  action: LedgerAction,
): LedgerData {
  switch (action.type) {
    case "trade/add":
      return {
        ...state,
        trades: [...state.trades, action.trade],
      };
    case "trade/delete": {
      const nextTrades = state.trades.filter(
        (trade) => trade.id !== action.tradeId,
      );

      if (nextTrades.length === state.trades.length) {
        return state;
      }

      return {
        ...state,
        trades: nextTrades,
      };
    }
    case "priceSnapshot/add":
      return {
        ...state,
        priceSnapshots: [...state.priceSnapshots, action.priceSnapshot],
      };
    case "ledger/replace":
      return action.ledgerData;
    case "ledger/reset":
      return createInitialLedgerData();
  }
}

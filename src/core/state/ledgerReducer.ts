import type { FeeRule, LedgerData, PriceSnapshot, Trade } from "@/core/models";
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
      type: "priceSnapshot/delete";
      priceSnapshotId: string;
    }
  | {
      type: "feeRule/add";
      feeRule: FeeRule;
    }
  | {
      type: "feeRule/deactivate";
      feeRuleId: string;
      deactivatedAt: string;
    }
  | {
      type: "feeRule/replace";
      feeRuleId: string;
      replacement: FeeRule;
      deactivatedAt: string;
    }
  | {
      type: "futureFacts/deleteAll";
      todayKey: string;
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
    case "priceSnapshot/delete": {
      const nextPriceSnapshots = state.priceSnapshots.filter(
        (snapshot) => snapshot.id !== action.priceSnapshotId,
      );

      return nextPriceSnapshots.length === state.priceSnapshots.length
        ? state
        : { ...state, priceSnapshots: nextPriceSnapshots };
    }
    case "feeRule/add":
      return state.feeRules.some(({ id }) => id === action.feeRule.id)
        ? state
        : { ...state, feeRules: [...state.feeRules, action.feeRule] };
    case "feeRule/deactivate": {
      const index = state.feeRules.findIndex(
        ({ id }) => id === action.feeRuleId,
      );
      const rule = state.feeRules[index];
      if (!rule || rule.status !== "active") {
        return state;
      }
      const nextRules = state.feeRules.slice();
      nextRules[index] = {
        ...rule,
        status: "inactive",
        updatedAt: action.deactivatedAt,
        deactivatedAt: action.deactivatedAt,
      };
      return { ...state, feeRules: nextRules };
    }
    case "feeRule/replace": {
      const index = state.feeRules.findIndex(
        ({ id }) => id === action.feeRuleId,
      );
      const previous = state.feeRules[index];
      if (
        !previous ||
        previous.status !== "active" ||
        state.feeRules.some(({ id }) => id === action.replacement.id) ||
        action.replacement.status !== "active" ||
        action.replacement.replacesFeeRuleId !== previous.id ||
        action.replacement.platform !== previous.platform ||
        action.replacement.assetSymbol !== previous.assetSymbol
      ) {
        return state;
      }
      const nextRules = state.feeRules.slice();
      nextRules[index] = {
        ...previous,
        status: "inactive",
        updatedAt: action.deactivatedAt,
        deactivatedAt: action.deactivatedAt,
      };
      nextRules.push(action.replacement);
      return { ...state, feeRules: nextRules };
    }
    case "futureFacts/deleteAll": {
      const nextTrades = state.trades.filter(
        (trade) => trade.occurredAt.slice(0, 10) <= action.todayKey,
      );
      const nextPriceSnapshots = state.priceSnapshots.filter(
        (snapshot) => snapshot.recordedAt.slice(0, 10) <= action.todayKey,
      );

      if (
        nextTrades.length === state.trades.length &&
        nextPriceSnapshots.length === state.priceSnapshots.length
      ) {
        return state;
      }

      return {
        ...state,
        trades: nextTrades,
        priceSnapshots: nextPriceSnapshots,
      };
    }
    case "ledger/replace":
      return action.ledgerData;
    case "ledger/reset":
      return createInitialLedgerData();
  }
}

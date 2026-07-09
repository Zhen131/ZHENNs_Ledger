import type { LedgerData, Trade } from "../models";

export type LedgerAction = {
  type: "trade/add";
  trade: Trade;
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
  }
}

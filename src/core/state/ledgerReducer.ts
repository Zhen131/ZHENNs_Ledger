/**
 * 这个文件管账本怎么改。
 * 收到一张改账的单子，就给出改完的新账本。
 * 它不检查单子里的东西对不对，那在 validation 区；也不存文件。
 * 不显然的决定：没改到任何东西时原样返回旧账本。这是猜的，日志里没写，要核。
 */

import type {
  Asset,
  AssetTransfer,
  CashEvent,
  FeeRule,
  LedgerData,
  PriceSnapshot,
  Trade,
} from "@/core/models";
import { createInitialLedgerData } from "./initialLedgerData";

/**
 * 改账本的一张单子。
 * 有加、删、改记录，停用和替换手续费规则。
 * 还有删掉未来的记录、整本替换、清空。
 */
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
      type: "cashEvent/add";
      cashEvent: CashEvent;
    }
  | {
      type: "cashEvent/delete";
      cashEventId: string;
    }
  | {
      type: "assetTransfer/add";
      assetTransfer: AssetTransfer;
    }
  | {
      type: "assetTransfer/delete";
      assetTransferId: string;
    }
  | {
      type: "asset/add";
      asset: Asset;
    }
  | {
      type: "asset/update";
      asset: Asset;
    }
  | {
      type: "asset/remove";
      assetSymbol: string;
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

/**
 * 这个函数回答：旧账本按这张单子改完，变成什么样？
 * 它不动旧账本，总是给出一份新的；没改到东西就原样返回旧的。
 * 举例：旧账本 2 笔买卖，单子是删掉第 1 笔 → 答剩 1 笔的新账本。
 * 举例：要删的编号不存在 → 答原来那本，一点没变。
 *
 * 为什么删未来记录只看前 10 位：哪一天按当地日期算。
 * 2026-09-07 定（W16 03A 第二节 D-3a）。
 * 不抛错。
 */
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
    case "cashEvent/add":
      return {
        ...state,
        cashEvents: [...state.cashEvents, action.cashEvent],
      };
    case "cashEvent/delete": {
      const nextCashEvents = state.cashEvents.filter(
        (cashEvent) => cashEvent.id !== action.cashEventId,
      );
      return nextCashEvents.length === state.cashEvents.length
        ? state
        : { ...state, cashEvents: nextCashEvents };
    }
    case "assetTransfer/add":
      return {
        ...state,
        assetTransfers: [...state.assetTransfers, action.assetTransfer],
      };
    case "assetTransfer/delete": {
      const nextAssetTransfers = state.assetTransfers.filter(
        (assetTransfer) => assetTransfer.id !== action.assetTransferId,
      );
      return nextAssetTransfers.length === state.assetTransfers.length
        ? state
        : { ...state, assetTransfers: nextAssetTransfers };
    }
    case "asset/add":
      return state.assets.some(
        ({ id, symbol }) =>
          id === action.asset.id || symbol === action.asset.symbol,
      )
        ? state
        : { ...state, assets: [...state.assets, action.asset] };
    case "asset/update": {
      const index = state.assets.findIndex(
        ({ id }) => id === action.asset.id,
      );
      if (index < 0) {
        return state;
      }
      const nextAssets = state.assets.slice();
      nextAssets[index] = action.asset;
      return { ...state, assets: nextAssets };
    }
    case "asset/remove": {
      const nextAssets = state.assets.filter(
        ({ symbol }) => symbol !== action.assetSymbol,
      );
      return nextAssets.length === state.assets.length
        ? state
        : { ...state, assets: nextAssets };
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
      const nextCashEvents = state.cashEvents.filter(
        (cashEvent) => cashEvent.occurredAt.slice(0, 10) <= action.todayKey,
      );
      const nextAssetTransfers = state.assetTransfers.filter(
        (assetTransfer) =>
          assetTransfer.occurredAt.slice(0, 10) <= action.todayKey,
      );

      if (
        nextTrades.length === state.trades.length &&
        nextPriceSnapshots.length === state.priceSnapshots.length &&
        nextCashEvents.length === state.cashEvents.length &&
        nextAssetTransfers.length === state.assetTransfers.length
      ) {
        return state;
      }

      return {
        ...state,
        trades: nextTrades,
        cashEvents: nextCashEvents,
        assetTransfers: nextAssetTransfers,
        priceSnapshots: nextPriceSnapshots,
      };
    }
    case "ledger/replace":
      return action.ledgerData;
    case "ledger/reset":
      return createInitialLedgerData();
  }
}

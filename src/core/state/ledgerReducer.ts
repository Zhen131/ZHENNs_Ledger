/**
 * 这个文件是改账柜台：递一张单子进来，返回改完的账本。旧账本不动。
 * 它不查买卖合不合规矩（例如卖的比手里多），那在 `core/validation` 区；
 * 它也不存文件，要不要存由 `app/persistence` 区决定。
 * 不显然的决定：没改到东西时原样返回同一本账本。2026-07-09 提交 614ac4a 起这样做。
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

/** 这张单子在账本最后加一笔买卖。 */
type AddTradeAction = { type: "trade/add"; trade: Trade };

/** 这张单子按编号删一笔买卖。 */
type DeleteTradeAction = { type: "trade/delete"; tradeId: string };

/** 这张单子在账本最后加一条现金记录（入金、出金等）。 */
type AddCashEventAction = { type: "cashEvent/add"; cashEvent: CashEvent };

/** 这张单子按编号删一条现金记录。 */
type DeleteCashEventAction = { type: "cashEvent/delete"; cashEventId: string };

/** 这张单子在账本最后加一笔资产转移。 */
type AddAssetTransferAction = {
  type: "assetTransfer/add";
  assetTransfer: AssetTransfer;
};

/** 这张单子按编号删一笔资产转移。 */
type DeleteAssetTransferAction = {
  type: "assetTransfer/delete";
  assetTransferId: string;
};

/** 这张单子加一个资产；编号或代码已经有了，账本就不变。 */
type AddAssetAction = { type: "asset/add"; asset: Asset };

/** 这张单子按编号换掉一个资产；找不到这个编号，账本就不变。 */
type UpdateAssetAction = { type: "asset/update"; asset: Asset };

/** 这张单子按代码（例如 BTC）删资产，代码相同的都删掉。 */
type RemoveAssetAction = { type: "asset/remove"; assetSymbol: string };

/** 这张单子在账本最后加一条记下来的价格。 */
type AddPriceSnapshotAction = {
  type: "priceSnapshot/add";
  priceSnapshot: PriceSnapshot;
};

/** 这张单子按编号删一条记下来的价格。 */
type DeletePriceSnapshotAction = {
  type: "priceSnapshot/delete";
  priceSnapshotId: string;
};

/** 这张单子加一条手续费规则；编号已经有了，账本就不变。 */
type AddFeeRuleAction = { type: "feeRule/add"; feeRule: FeeRule };

/** 这张单子停用一条在用的手续费规则，规则留在账本里不删；找不到或已停用，账本就不变。 */
type DeactivateFeeRuleAction = {
  type: "feeRule/deactivate";
  feeRuleId: string;
  deactivatedAt: string;
};

/** 这张单子换手续费规则：旧的停用，新的加在最后；有一条对不上（例如平台不同），账本就不变。 */
type ReplaceFeeRuleAction = {
  type: "feeRule/replace";
  feeRuleId: string;
  replacement: FeeRule;
  deactivatedAt: string;
};

/** 这张单子删掉日期晚于今天的记录。买卖、现金记录、资产转移、价格四类都删。 */
type DeleteAllFutureFactsAction = {
  type: "futureFacts/deleteAll";
  todayKey: string;
};

/** 这张单子换掉整本账本：直接用单子里带来的那一本，不复制。 */
type ReplaceLedgerAction = { type: "ledger/replace"; ledgerData: LedgerData };

/** 这张单子清空整本账本，回到新建时的样子。 */
type ResetLedgerAction = { type: "ledger/reset" };

/**
 * 改账本的一张单子，是下面 17 种之一。
 * 界面增删改记录、打开或导入账本时，都造一张单子递给 `ledgerReducer`。
 */
export type LedgerAction =
  | AddTradeAction
  | DeleteTradeAction
  | AddCashEventAction
  | DeleteCashEventAction
  | AddAssetTransferAction
  | DeleteAssetTransferAction
  | AddAssetAction
  | UpdateAssetAction
  | RemoveAssetAction
  | AddPriceSnapshotAction
  | DeletePriceSnapshotAction
  | AddFeeRuleAction
  | DeactivateFeeRuleAction
  | ReplaceFeeRuleAction
  | DeleteAllFutureFactsAction
  | ReplaceLedgerAction
  | ResetLedgerAction;

/** 能按条件删的那几类记录。买卖、现金记录、资产转移、资产、价格都在里面。 */
type RemovableListKey =
  | "trades"
  | "cashEvents"
  | "assetTransfers"
  | "assets"
  | "priceSnapshots";

/**
 * 这个函数回答：删掉某类里符合条件的记录，账本变成什么样？
 * 删到了，就给一本新账本，只换掉这一类。别的类还是原来那几个。
 * 一条也没删到，就原样返回传进来的那一本，不造新的。
 * 举例：买卖里没有编号 t9，按编号删 t9 → 答原来那一本。
 *
 * 为什么没删到不造新的：保存时看到同一本，就不存文件。
 * 当初为什么这样定，日志里没写，这是猜的，要核。
 */
function removeMatching<Key extends RemovableListKey>(
  state: LedgerData,
  key: Key,
  shouldRemove: (item: LedgerData[Key][number]) => boolean,
): LedgerData {
  const list: readonly LedgerData[Key][number][] = state[key];
  const kept = list.filter((item) => !shouldRemove(item));
  if (kept.length === list.length) {
    return state;
  }
  return { ...state, [key]: kept };
}

/**
 * 这个函数回答：一条手续费规则停用以后长什么样？
 * 它抄一份新规则，状态改成停用。更新时间和停用时间都写成停用那一刻。
 * 举例：规则 fee-v1 在 2026-08-11 停用 → 答一份新规则，状态 inactive。
 * 原来那条规则不动。不会出错。
 */
function deactivateRule(rule: FeeRule, deactivatedAt: string): FeeRule {
  return {
    ...rule,
    status: "inactive",
    updatedAt: deactivatedAt,
    deactivatedAt,
  };
}

/**
 * 这个函数回答：旧账本按这张单子改完，变成什么样？
 * 改到了就给一本新账本；旧账本一个字不动。
 * 举例：加「买 0.1 BTC，成交 6500 USDT，手续费 5」→ 答多一笔的新账本。
 * 举例：删一笔不存在的买卖 → 答原来那一本，是同一个对象。
 *
 * 为什么没改到要返回同一本：保存时看到同一本，就不存文件。
 * 当初为什么这样定，日志里没写，这是猜的，要核。
 *
 * 为什么删未来记录只看日期前 10 位：哪一天按当地日期算，2026-09-07 定（W16 03A 第二节 D-3a）。
 *
 * 不会抛错。TypeScript 编译时只让这 17 种单子进来。
 * 万一运行时递进来别的单子，它返回 `undefined`，这是沿用的旧行为。
 * 现在没有调用方靠这一点。
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
    case "trade/delete":
      return removeMatching(
        state,
        "trades",
        (trade) => trade.id === action.tradeId,
      );
    case "cashEvent/add":
      return {
        ...state,
        cashEvents: [...state.cashEvents, action.cashEvent],
      };
    case "cashEvent/delete":
      return removeMatching(
        state,
        "cashEvents",
        (cashEvent) => cashEvent.id === action.cashEventId,
      );
    case "assetTransfer/add":
      return {
        ...state,
        assetTransfers: [...state.assetTransfers, action.assetTransfer],
      };
    case "assetTransfer/delete":
      return removeMatching(
        state,
        "assetTransfers",
        (assetTransfer) => assetTransfer.id === action.assetTransferId,
      );
    case "asset/add": {
      const alreadyThere = state.assets.some(
        ({ id, symbol }) =>
          id === action.asset.id || symbol === action.asset.symbol,
      );
      if (alreadyThere) {
        return state;
      }
      return { ...state, assets: [...state.assets, action.asset] };
    }
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
    case "asset/remove":
      return removeMatching(
        state,
        "assets",
        ({ symbol }) => symbol === action.assetSymbol,
      );
    case "priceSnapshot/add":
      return {
        ...state,
        priceSnapshots: [...state.priceSnapshots, action.priceSnapshot],
      };
    case "priceSnapshot/delete":
      return removeMatching(
        state,
        "priceSnapshots",
        (snapshot) => snapshot.id === action.priceSnapshotId,
      );
    case "feeRule/add": {
      const alreadyThere = state.feeRules.some(
        ({ id }) => id === action.feeRule.id,
      );
      if (alreadyThere) {
        return state;
      }
      return { ...state, feeRules: [...state.feeRules, action.feeRule] };
    }
    case "feeRule/deactivate": {
      const index = state.feeRules.findIndex(
        ({ id }) => id === action.feeRuleId,
      );
      const rule = state.feeRules[index];
      if (!rule || rule.status !== "active") {
        return state;
      }
      const nextRules = state.feeRules.slice();
      nextRules[index] = deactivateRule(rule, action.deactivatedAt);
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
      nextRules[index] = deactivateRule(previous, action.deactivatedAt);
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

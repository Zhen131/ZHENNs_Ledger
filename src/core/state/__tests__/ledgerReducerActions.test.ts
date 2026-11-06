import { describe, expect, test } from "vitest";

import { createInitialLedgerData } from "../initialLedgerData";
import { ledgerReducer, type LedgerAction } from "../ledgerReducer";
import {
  createAsset,
  createPriceSnapshot,
  createSimpleTrade,
} from "@/test-support";
import type {
  AssetTransfer,
  CashEvent,
  FeeRule,
  LedgerData,
} from "@/core/models";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function run(state: LedgerData, action: LedgerAction): LedgerData {
  return ledgerReducer(deepFreeze(state), deepFreeze(action));
}

function cashEvent(id: string, occurredAt: string): CashEvent {
  return {
    id,
    occurredAt,
    timePrecision: occurredAt.length > 10 ? "minute" : "day",
    type: "deposit",
    currency: "USDT",
    amount: "100",
    createdAt: "2026-08-18T08:00:00.000Z",
    updatedAt: "2026-08-18T08:00:00.000Z",
  };
}

function transfer(id: string, occurredAt: string): AssetTransfer {
  return {
    id,
    occurredAt,
    timePrecision: occurredAt.length > 10 ? "minute" : "day",
    assetSymbol: "BTC",
    quantity: "1",
    category: "external-in",
    reason: "deposit",
    unitPrice: "1",
    toLocation: "exchange",
    createdAt: "2026-08-18T08:00:00.000Z",
    updatedAt: "2026-08-18T08:00:00.000Z",
  };
}

function feeRule(id: string, overrides: Partial<FeeRule> = {}): FeeRule {
  return {
    id,
    name: `rule ${id}`,
    platform: "OKX",
    assetSymbol: "BTC",
    status: "active",
    type: "fixed",
    amount: "5",
    currency: "USDT",
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  } as FeeRule;
}

function filledLedger(): LedgerData {
  return {
    ...createInitialLedgerData(),
    trades: [
      createSimpleTrade("t1", "buy", "BTC", "0.1", "2026-08-01"),
      createSimpleTrade("t2", "sell", "BTC", "0.04", "2026-08-02"),
    ],
    cashEvents: [cashEvent("c1", "2026-08-01"), cashEvent("c2", "2026-08-02")],
    assetTransfers: [
      transfer("x1", "2026-08-01"),
      transfer("x2", "2026-08-02"),
    ],
    priceSnapshots: [
      createPriceSnapshot("p1", "BTC", "65000", "2026-08-01"),
      createPriceSnapshot("p2", "BTC", "66000", "2026-08-02"),
    ],
    feeRules: [feeRule("fee-v1"), feeRule("fee-other", { platform: "Binance" })],
  };
}

type ArrayKey = Exclude<keyof LedgerData, "schemaVersion">;
const ARRAY_KEYS: readonly ArrayKey[] = [
  "assets",
  "trades",
  "cashEvents",
  "assetTransfers",
  "priceSnapshots",
  "feeRules",
];

function expectOnlyChanged(
  state: LedgerData,
  next: LedgerData,
  changed: readonly ArrayKey[],
): void {
  expect(next).not.toBe(state);
  expect(Object.keys(next)).toEqual(Object.keys(state));
  expect(next.schemaVersion).toBe(state.schemaVersion);
  for (const key of ARRAY_KEYS) {
    if (changed.includes(key)) {
      expect(next[key]).not.toBe(state[key]);
    } else {
      expect(next[key]).toBe(state[key]);
    }
  }
}

describe("ledgerReducer trade actions", () => {
  test("trade/add appends the trade object and keeps the old trades", () => {
    const state = filledLedger();
    const trade = createSimpleTrade("t3", "buy", "ETH", "1", "2026-08-03");
    const next = run(state, { type: "trade/add", trade });

    expectOnlyChanged(state, next, ["trades"]);
    expect(next.trades).toHaveLength(3);
    expect(next.trades[0]).toBe(state.trades[0]);
    expect(next.trades[1]).toBe(state.trades[1]);
    expect(next.trades[2]).toBe(trade);
  });

  test("trade/delete removes the matching trade and keeps the rest", () => {
    const state = filledLedger();
    const next = run(state, { type: "trade/delete", tradeId: "t1" });

    expectOnlyChanged(state, next, ["trades"]);
    expect(next.trades).toHaveLength(1);
    expect(next.trades[0]).toBe(state.trades[1]);
  });

  test("trade/delete returns the same ledger when no trade matches", () => {
    const state = filledLedger();
    expect(run(state, { type: "trade/delete", tradeId: "missing" })).toBe(state);
  });
});

describe("ledgerReducer cash event actions", () => {
  test("cashEvent/add appends the cash event object", () => {
    const state = filledLedger();
    const event = cashEvent("c3", "2026-08-03");
    const next = run(state, { type: "cashEvent/add", cashEvent: event });

    expectOnlyChanged(state, next, ["cashEvents"]);
    expect(next.cashEvents).toHaveLength(3);
    expect(next.cashEvents[0]).toBe(state.cashEvents[0]);
    expect(next.cashEvents[2]).toBe(event);
  });

  test("cashEvent/delete removes the matching cash event", () => {
    const state = filledLedger();
    const next = run(state, { type: "cashEvent/delete", cashEventId: "c2" });

    expectOnlyChanged(state, next, ["cashEvents"]);
    expect(next.cashEvents).toHaveLength(1);
    expect(next.cashEvents[0]).toBe(state.cashEvents[0]);
  });

  test("cashEvent/delete returns the same ledger when no cash event matches", () => {
    const state = filledLedger();
    expect(
      run(state, { type: "cashEvent/delete", cashEventId: "missing" }),
    ).toBe(state);
  });
});

describe("ledgerReducer asset transfer actions", () => {
  test("assetTransfer/add appends the transfer object", () => {
    const state = filledLedger();
    const item = transfer("x3", "2026-08-03");
    const next = run(state, { type: "assetTransfer/add", assetTransfer: item });

    expectOnlyChanged(state, next, ["assetTransfers"]);
    expect(next.assetTransfers).toHaveLength(3);
    expect(next.assetTransfers[1]).toBe(state.assetTransfers[1]);
    expect(next.assetTransfers[2]).toBe(item);
  });

  test("assetTransfer/delete removes the matching transfer", () => {
    const state = filledLedger();
    const next = run(state, {
      type: "assetTransfer/delete",
      assetTransferId: "x1",
    });

    expectOnlyChanged(state, next, ["assetTransfers"]);
    expect(next.assetTransfers).toHaveLength(1);
    expect(next.assetTransfers[0]).toBe(state.assetTransfers[1]);
  });

  test("assetTransfer/delete returns the same ledger when no transfer matches", () => {
    const state = filledLedger();
    expect(
      run(state, { type: "assetTransfer/delete", assetTransferId: "missing" }),
    ).toBe(state);
  });
});

describe("ledgerReducer asset actions", () => {
  test("asset/add appends a new asset", () => {
    const state = filledLedger();
    const asset = createAsset("SOL", "Solana");
    const next = run(state, { type: "asset/add", asset });

    expectOnlyChanged(state, next, ["assets"]);
    expect(next.assets).toHaveLength(state.assets.length + 1);
    state.assets.forEach((item, index) => {
      expect(next.assets[index]).toBe(item);
    });
    expect(next.assets[state.assets.length]).toBe(asset);
  });

  test("asset/add returns the same ledger when the asset id already exists", () => {
    const state = filledLedger();
    const asset = { ...createAsset("SOL", "Solana"), id: state.assets[0].id };
    expect(run(state, { type: "asset/add", asset })).toBe(state);
  });

  test("asset/add returns the same ledger when the asset symbol already exists", () => {
    const state = filledLedger();
    const asset = { ...createAsset("BTC", "Other"), id: "asset-btc-other" };
    expect(run(state, { type: "asset/add", asset })).toBe(state);
  });

  test("asset/update swaps only the asset with the same id", () => {
    const state = filledLedger();
    const asset = { ...state.assets[1], name: "Renamed" };
    const next = run(state, { type: "asset/update", asset });

    expectOnlyChanged(state, next, ["assets"]);
    expect(next.assets).toHaveLength(state.assets.length);
    state.assets.forEach((item, index) => {
      if (index === 1) {
        expect(next.assets[index]).toBe(asset);
      } else {
        expect(next.assets[index]).toBe(item);
      }
    });
  });

  test("asset/update returns the same ledger when the asset id is missing", () => {
    const state = filledLedger();
    const asset = createAsset("DOGE", "Dogecoin");
    expect(run(state, { type: "asset/update", asset })).toBe(state);
  });

  test("asset/remove removes the asset with the given symbol", () => {
    const state = filledLedger();
    const symbol = state.assets[0].symbol;
    const next = run(state, { type: "asset/remove", assetSymbol: symbol });

    expectOnlyChanged(state, next, ["assets"]);
    expect(next.assets).toEqual(state.assets.slice(1));
    next.assets.forEach((item, index) => {
      expect(item).toBe(state.assets[index + 1]);
    });
  });

  test("asset/remove returns the same ledger when no asset has the symbol", () => {
    const state = filledLedger();
    expect(run(state, { type: "asset/remove", assetSymbol: "NOPE" })).toBe(
      state,
    );
  });
});

describe("ledgerReducer price actions", () => {
  test("priceSnapshot/add appends the price object", () => {
    const state = filledLedger();
    const price = createPriceSnapshot("p3", "ETH", "3000", "2026-08-03");
    const next = run(state, { type: "priceSnapshot/add", priceSnapshot: price });

    expectOnlyChanged(state, next, ["priceSnapshots"]);
    expect(next.priceSnapshots).toHaveLength(3);
    expect(next.priceSnapshots[0]).toBe(state.priceSnapshots[0]);
    expect(next.priceSnapshots[2]).toBe(price);
  });

  test("priceSnapshot/delete removes the matching price", () => {
    const state = filledLedger();
    const next = run(state, {
      type: "priceSnapshot/delete",
      priceSnapshotId: "p1",
    });

    expectOnlyChanged(state, next, ["priceSnapshots"]);
    expect(next.priceSnapshots).toHaveLength(1);
    expect(next.priceSnapshots[0]).toBe(state.priceSnapshots[1]);
  });

  test("priceSnapshot/delete returns the same ledger when no price matches", () => {
    const state = filledLedger();
    expect(
      run(state, { type: "priceSnapshot/delete", priceSnapshotId: "missing" }),
    ).toBe(state);
  });
});

describe("ledgerReducer fee rule add and deactivate", () => {
  test("feeRule/add appends a rule with a new id", () => {
    const state = filledLedger();
    const rule = feeRule("fee-new");
    const next = run(state, { type: "feeRule/add", feeRule: rule });

    expectOnlyChanged(state, next, ["feeRules"]);
    expect(next.feeRules).toHaveLength(3);
    expect(next.feeRules[0]).toBe(state.feeRules[0]);
    expect(next.feeRules[1]).toBe(state.feeRules[1]);
    expect(next.feeRules[2]).toBe(rule);
  });

  test("feeRule/add returns the same ledger when the rule id already exists", () => {
    const state = filledLedger();
    const rule = feeRule("fee-v1", { name: "duplicate" });
    expect(run(state, { type: "feeRule/add", feeRule: rule })).toBe(state);
  });

  test("feeRule/deactivate marks an active rule inactive in a new rule object", () => {
    const state = filledLedger();
    const next = run(state, {
      type: "feeRule/deactivate",
      feeRuleId: "fee-v1",
      deactivatedAt: "2026-08-11T00:00:00.000Z",
    });

    expectOnlyChanged(state, next, ["feeRules"]);
    expect(next.feeRules).toHaveLength(2);
    expect(next.feeRules[0]).not.toBe(state.feeRules[0]);
    expect(next.feeRules[0]).toEqual({
      ...state.feeRules[0],
      status: "inactive",
      updatedAt: "2026-08-11T00:00:00.000Z",
      deactivatedAt: "2026-08-11T00:00:00.000Z",
    });
    expect(next.feeRules[1]).toBe(state.feeRules[1]);
  });

  test("feeRule/deactivate returns the same ledger when the rule id is missing", () => {
    const state = filledLedger();
    expect(
      run(state, {
        type: "feeRule/deactivate",
        feeRuleId: "missing",
        deactivatedAt: "2026-08-11T00:00:00.000Z",
      }),
    ).toBe(state);
  });

  test("feeRule/deactivate returns the same ledger when the rule is already inactive", () => {
    const state = {
      ...filledLedger(),
      feeRules: [feeRule("fee-v1", { status: "inactive" })],
    };
    expect(
      run(state, {
        type: "feeRule/deactivate",
        feeRuleId: "fee-v1",
        deactivatedAt: "2026-08-11T00:00:00.000Z",
      }),
    ).toBe(state);
  });
});

describe("ledgerReducer fee rule replace", () => {
  const DEACTIVATED_AT = "2026-08-11T00:00:00.000Z";

  function validReplacement(overrides: Partial<FeeRule> = {}): FeeRule {
    return feeRule("fee-v2", {
      amount: "6",
      replacesFeeRuleId: "fee-v1",
      ...overrides,
    } as Partial<FeeRule>);
  }

  function replace(
    state: LedgerData,
    replacement: FeeRule,
    feeRuleId = "fee-v1",
  ): LedgerData {
    return run(state, {
      type: "feeRule/replace",
      feeRuleId,
      replacement,
      deactivatedAt: DEACTIVATED_AT,
    });
  }

  test("feeRule/replace deactivates the old rule and appends the replacement", () => {
    const state = filledLedger();
    const replacement = validReplacement();
    const next = replace(state, replacement);

    expectOnlyChanged(state, next, ["feeRules"]);
    expect(next.feeRules).toHaveLength(3);
    expect(next.feeRules[0]).not.toBe(state.feeRules[0]);
    expect(next.feeRules[0]).toEqual({
      ...state.feeRules[0],
      status: "inactive",
      updatedAt: DEACTIVATED_AT,
      deactivatedAt: DEACTIVATED_AT,
    });
    expect(next.feeRules[1]).toBe(state.feeRules[1]);
    expect(next.feeRules[2]).toBe(replacement);
  });

  test("feeRule/replace returns the same ledger when the old rule is missing", () => {
    const state = filledLedger();
    expect(replace(state, validReplacement(), "missing")).toBe(state);
  });

  test("feeRule/replace returns the same ledger when the old rule is inactive", () => {
    const state = {
      ...filledLedger(),
      feeRules: [feeRule("fee-v1", { status: "inactive" })],
    };
    expect(replace(state, validReplacement())).toBe(state);
  });

  test("feeRule/replace returns the same ledger when the replacement id already exists", () => {
    const state = filledLedger();
    expect(replace(state, validReplacement({ id: "fee-other" }))).toBe(state);
  });

  test("feeRule/replace returns the same ledger when the replacement is not active", () => {
    const state = filledLedger();
    expect(replace(state, validReplacement({ status: "inactive" }))).toBe(
      state,
    );
  });

  test("feeRule/replace returns the same ledger when the replacement points at another rule", () => {
    const state = filledLedger();
    expect(
      replace(state, validReplacement({ replacesFeeRuleId: "fee-other" })),
    ).toBe(state);
  });

  test("feeRule/replace returns the same ledger when the platform differs", () => {
    const state = filledLedger();
    expect(replace(state, validReplacement({ platform: "Binance" }))).toBe(
      state,
    );
  });

  test("feeRule/replace returns the same ledger when the asset symbol differs", () => {
    const state = filledLedger();
    expect(replace(state, validReplacement({ assetSymbol: "ETH" }))).toBe(
      state,
    );
  });
});

describe("ledgerReducer futureFacts/deleteAll", () => {
  const TODAY = "2026-08-20";

  function ledgerWithToday(): LedgerData {
    return {
      ...createInitialLedgerData(),
      trades: [
        createSimpleTrade("t-past", "buy", "BTC", "1", "2026-08-19"),
        createSimpleTrade("t-today", "buy", "BTC", "1", "2026-08-20T23:59"),
      ],
      cashEvents: [cashEvent("c-today", "2026-08-20")],
      assetTransfers: [transfer("x-today", "2026-08-20T08:30")],
      priceSnapshots: [
        createPriceSnapshot("p-today", "BTC", "65000", "2026-08-20"),
      ],
    };
  }

  test("futureFacts/deleteAll returns the same ledger when nothing is after today", () => {
    const state = ledgerWithToday();
    expect(
      run(state, { type: "futureFacts/deleteAll", todayKey: TODAY }),
    ).toBe(state);
  });

  test("futureFacts/deleteAll removes future records from all four lists", () => {
    const base = ledgerWithToday();
    const state = {
      ...base,
      trades: [
        ...base.trades,
        createSimpleTrade("t-future", "buy", "BTC", "1", "2026-08-21T00:00"),
      ],
      cashEvents: [...base.cashEvents, cashEvent("c-future", "2026-08-22")],
      assetTransfers: [
        ...base.assetTransfers,
        transfer("x-future", "2026-08-21"),
      ],
      priceSnapshots: [
        ...base.priceSnapshots,
        createPriceSnapshot("p-future", "BTC", "70000", "2026-08-21T09:30"),
      ],
    };
    const next = run(state, { type: "futureFacts/deleteAll", todayKey: TODAY });

    expectOnlyChanged(state, next, [
      "trades",
      "cashEvents",
      "assetTransfers",
      "priceSnapshots",
    ]);
    expect(next.trades.map(({ id }) => id)).toEqual(["t-past", "t-today"]);
    expect(next.trades[0]).toBe(state.trades[0]);
    expect(next.trades[1]).toBe(state.trades[1]);
    expect(next.cashEvents.map(({ id }) => id)).toEqual(["c-today"]);
    expect(next.assetTransfers.map(({ id }) => id)).toEqual(["x-today"]);
    expect(next.priceSnapshots.map(({ id }) => id)).toEqual(["p-today"]);
  });

  test("futureFacts/deleteAll replaces all four lists even when only one list had future records", () => {
    const base = ledgerWithToday();
    const state = {
      ...base,
      trades: [
        ...base.trades,
        createSimpleTrade("t-future", "buy", "BTC", "1", "2026-08-30"),
      ],
    };
    const next = run(state, { type: "futureFacts/deleteAll", todayKey: TODAY });

    expectOnlyChanged(state, next, [
      "trades",
      "cashEvents",
      "assetTransfers",
      "priceSnapshots",
    ]);
    expect(next.trades.map(({ id }) => id)).toEqual(["t-past", "t-today"]);
    expect(next.cashEvents).toEqual(state.cashEvents);
    expect(next.assetTransfers).toEqual(state.assetTransfers);
    expect(next.priceSnapshots).toEqual(state.priceSnapshots);
    expect(next.cashEvents[0]).toBe(state.cashEvents[0]);
  });

  test("futureFacts/deleteAll replaces empty lists too when another list had future records", () => {
    const state = {
      ...createInitialLedgerData(),
      priceSnapshots: [
        createPriceSnapshot("p-future", "BTC", "70000", "2026-08-21"),
      ],
    };
    const next = run(state, { type: "futureFacts/deleteAll", todayKey: TODAY });

    expectOnlyChanged(state, next, [
      "trades",
      "cashEvents",
      "assetTransfers",
      "priceSnapshots",
    ]);
    expect(next.priceSnapshots).toEqual([]);
    expect(next.trades).toEqual([]);
  });
});

describe("ledgerReducer whole-ledger actions", () => {
  test("ledger/replace returns the ledger object carried by the action", () => {
    const state = filledLedger();
    const ledgerData = createInitialLedgerData();
    const next = run(state, { type: "ledger/replace", ledgerData });

    expect(next).toBe(ledgerData);
    expect(next).not.toBe(state);
  });

  test("ledger/reset returns a brand new initial ledger", () => {
    const state = filledLedger();
    const next = run(state, { type: "ledger/reset" });

    expect(next).toEqual(createInitialLedgerData());
    expect(next).not.toBe(state);
    for (const key of ARRAY_KEYS) {
      expect(next[key]).not.toBe(state[key]);
    }
    next.assets.forEach((asset, index) => {
      expect(asset).not.toBe(state.assets[index]);
    });
  });
});

import { expect, test } from "vitest";

import {
  createInitialLedgerData,
  initialLedgerData,
} from "./initialLedgerData";
import { ledgerReducer } from "./ledgerReducer";
import { createBuiltInAssets } from "../data/builtInAssets";
import { createPriceSnapshot, createSimpleTrade } from "../test/fixtures";

test("creates an in-memory ledger with built-in assets", () => {
  expect(createInitialLedgerData()).toEqual({
    schemaVersion: 1,
    assets: createBuiltInAssets(),
    trades: [],
    priceSnapshots: [],
    feeRules: [],
  });
});

test("creates independent array references for each initial ledger", () => {
  const firstLedger = createInitialLedgerData();
  const secondLedger = createInitialLedgerData();

  expect(firstLedger).not.toBe(secondLedger);
  expect(firstLedger.assets).not.toBe(secondLedger.assets);
  for (const [index, asset] of firstLedger.assets.entries()) {
    expect(asset).not.toBe(secondLedger.assets[index]);
  }
  expect(firstLedger.trades).not.toBe(secondLedger.trades);
  expect(firstLedger.priceSnapshots).not.toBe(secondLedger.priceSnapshots);
  expect(firstLedger.feeRules).not.toBe(secondLedger.feeRules);
});

test("exports a default empty initial ledger value", () => {
  expect(initialLedgerData).toEqual(createInitialLedgerData());
});

test("adds a trade without mutating the previous ledger", () => {
  const previousLedger = createInitialLedgerData();
  const trade = createSimpleTrade("trade-001", "buy", "BTC", "1");

  const nextLedger = ledgerReducer(previousLedger, {
    type: "trade/add",
    trade,
  });

  expect(nextLedger).not.toBe(previousLedger);
  expect(nextLedger.trades).toEqual([trade]);
  expect(nextLedger.trades).not.toBe(previousLedger.trades);
  expect(previousLedger.trades).toEqual([]);
});

test("does not validate trade business rules inside the reducer", () => {
  const previousLedger = createInitialLedgerData();
  const impossibleSell = createSimpleTrade(
    "trade-impossible-sell",
    "sell",
    "BTC",
    "999",
  );

  const nextLedger = ledgerReducer(previousLedger, {
    type: "trade/add",
    trade: impossibleSell,
  });

  expect(nextLedger.trades).toEqual([impossibleSell]);
});

test("deletes a trade by id without mutating the previous ledger", () => {
  const tradeToKeep = createSimpleTrade("trade-keep", "buy", "BTC", "1");
  const tradeToDelete = createSimpleTrade("trade-delete", "buy", "ETH", "2");
  const previousLedger = {
    ...createInitialLedgerData(),
    trades: [tradeToKeep, tradeToDelete],
  };

  const nextLedger = ledgerReducer(previousLedger, {
    type: "trade/delete",
    tradeId: tradeToDelete.id,
  });

  expect(nextLedger).not.toBe(previousLedger);
  expect(nextLedger.trades).toEqual([tradeToKeep]);
  expect(previousLedger.trades).toEqual([tradeToKeep, tradeToDelete]);
});

test("keeps the same ledger reference when deleting a missing trade id", () => {
  const existingTrade = createSimpleTrade("trade-existing", "buy", "BTC", "1");
  const previousLedger = {
    ...createInitialLedgerData(),
    trades: [existingTrade],
  };

  const nextLedger = ledgerReducer(previousLedger, {
    type: "trade/delete",
    tradeId: "missing-trade",
  });

  expect(nextLedger).toBe(previousLedger);
});

test("adds a price snapshot without mutating the previous ledger", () => {
  const previousLedger = createInitialLedgerData();
  const priceSnapshot = createPriceSnapshot(
    "price-001",
    "BTC",
    "70000",
    "2026-07-16",
  );

  const nextLedger = ledgerReducer(previousLedger, {
    type: "priceSnapshot/add",
    priceSnapshot,
  });

  expect(nextLedger).not.toBe(previousLedger);
  expect(nextLedger.priceSnapshots).toEqual([priceSnapshot]);
  expect(nextLedger.priceSnapshots).not.toBe(previousLedger.priceSnapshots);
  expect(previousLedger.priceSnapshots).toEqual([]);
});

test("atomically replaces the complete ledger after external validation", () => {
  const previousLedger = createInitialLedgerData();
  const replacement = {
    ...createInitialLedgerData(),
    trades: [
      createSimpleTrade("trade-hydrated", "buy", "ETH", "2"),
    ],
    priceSnapshots: [
      createPriceSnapshot(
        "price-hydrated",
        "ETH",
        "2500",
        "2026-07-16",
      ),
    ],
  };

  const nextLedger = ledgerReducer(previousLedger, {
    type: "ledger/replace",
    ledgerData: replacement,
  });

  expect(nextLedger).toBe(replacement);
  expect(previousLedger).toEqual(createInitialLedgerData());
});

test("resets user data and restores independent built-in assets", () => {
  const existingTrade = createSimpleTrade("trade-existing", "buy", "BTC", "1");
  const existingPrice = createPriceSnapshot(
    "price-existing",
    "BTC",
    "70000",
    "2026-07-13",
  );
  const previousLedger = {
    ...createInitialLedgerData(),
    assets: [
      {
        ...createBuiltInAssets()[0],
        name: "Changed Bitcoin",
      },
    ],
    trades: [existingTrade],
    priceSnapshots: [existingPrice],
    feeRules: [
      {
        id: "fee-existing",
        name: "Existing fee",
        platform: "Existing platform",
        type: "percentage" as const,
        rate: "0.001",
        currency: "USD",
        createdAt: "2026-07-13T00:00:00Z",
        updatedAt: "2026-07-13T00:00:00Z",
      },
    ],
  };

  const nextLedger = ledgerReducer(previousLedger, {
    type: "ledger/reset",
  });

  expect(nextLedger).toEqual(createInitialLedgerData());
  expect(nextLedger).not.toBe(previousLedger);
  expect(nextLedger.assets).toEqual(createBuiltInAssets());
  expect(nextLedger.assets).not.toBe(previousLedger.assets);
  expect(nextLedger.assets[0]).not.toBe(previousLedger.assets[0]);
  expect(nextLedger.trades).not.toBe(previousLedger.trades);
  expect(nextLedger.priceSnapshots).not.toBe(previousLedger.priceSnapshots);
  expect(nextLedger.feeRules).not.toBe(previousLedger.feeRules);
});

test("creates independent built-in assets across consecutive resets", () => {
  const firstReset = ledgerReducer(createInitialLedgerData(), {
    type: "ledger/reset",
  });
  const secondReset = ledgerReducer(firstReset, {
    type: "ledger/reset",
  });

  expect(firstReset.assets).toEqual(secondReset.assets);
  expect(firstReset.assets).not.toBe(secondReset.assets);
  for (const [index, asset] of firstReset.assets.entries()) {
    expect(asset).not.toBe(secondReset.assets[index]);
  }
});

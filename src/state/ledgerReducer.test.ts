import { expect, test } from "vitest";

import {
  createInitialLedgerData,
  initialLedgerData,
} from "./initialLedgerData";
import { ledgerReducer } from "./ledgerReducer";
import { createSimpleTrade } from "../test/fixtures";

test("creates an empty in-memory ledger", () => {
  expect(createInitialLedgerData()).toEqual({
    schemaVersion: 1,
    assets: [],
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

test("resets the ledger to a new empty initial state", () => {
  const existingTrade = createSimpleTrade("trade-existing", "buy", "BTC", "1");
  const previousLedger = {
    ...createInitialLedgerData(),
    trades: [existingTrade],
  };

  const nextLedger = ledgerReducer(previousLedger, {
    type: "ledger/reset",
  });

  expect(nextLedger).toEqual(createInitialLedgerData());
  expect(nextLedger).not.toBe(previousLedger);
  expect(nextLedger.trades).not.toBe(previousLedger.trades);
});

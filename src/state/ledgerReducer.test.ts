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

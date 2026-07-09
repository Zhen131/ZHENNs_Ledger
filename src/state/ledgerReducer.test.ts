import { expect, test } from "vitest";

import {
  createInitialLedgerData,
  initialLedgerData,
} from "./initialLedgerData";

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

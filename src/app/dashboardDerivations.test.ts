import { describe, expect, it } from "vitest";

import type {
  AssetTransfer,
  CashEvent,
  LedgerData,
  PriceSnapshot,
  Trade,
} from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { createPriceSnapshot, createUsdtSimpleTrade } from "@/test-support";
import {
  buildDashboardDerivations,
  updateDashboardDerivationsForAppend,
  type DashboardDerivationOptions,
} from "./dashboardDerivations";

const OPTIONS: DashboardDerivationOptions = {
  todayKey: "2026-08-20",
  valuationPriceMode: "auto",
  chartRange: "all",
};
const CREATED_AT = "2026-08-19T12:00:00.000Z";

describe("updateDashboardDerivationsForAppend", () => {
  it.each<{
    name: string;
    append: (ledger: LedgerData) => LedgerData;
    expectedCashReplay: "unchanged" | "appended" | "full-fallback";
    expectedPositionReplay: "unchanged" | "affected-asset";
  }>([
    {
      name: "trade",
      append: (ledger) => appendTrade(ledger, currentTrade()),
      expectedCashReplay: "appended",
      expectedPositionReplay: "affected-asset",
    },
    {
      name: "cash event",
      append: (ledger) => appendCashEvent(ledger, currentCashEvent()),
      expectedCashReplay: "appended",
      expectedPositionReplay: "unchanged",
    },
    {
      name: "asset transfer",
      append: (ledger) => appendAssetTransfer(ledger, currentTransfer()),
      expectedCashReplay: "unchanged",
      expectedPositionReplay: "affected-asset",
    },
    {
      name: "price snapshot",
      append: (ledger) => appendPriceSnapshot(ledger, currentPrice()),
      expectedCashReplay: "unchanged",
      expectedPositionReplay: "unchanged",
    },
  ])(
    "matches a full recomputation after appending one $name",
    ({ append, expectedCashReplay, expectedPositionReplay }) => {
      const previousLedger = createBaseLedger();
      const previousValues = buildDashboardDerivations(previousLedger, OPTIONS);
      const nextLedger = append(previousLedger);

      const update = updateDashboardDerivationsForAppend(
        previousValues,
        previousLedger,
        nextLedger,
        OPTIONS,
      );

      expect(update.mode).toBe("incremental");
      expect(update.cashReplay).toBe(expectedCashReplay);
      expect(update.positionReplay).toBe(expectedPositionReplay);
      expect(update.values).toEqual(buildDashboardDerivations(nextLedger, OPTIONS));
    },
  );

  it("falls back to ordered cash replay for a historically inserted trade", () => {
    const previousLedger = createBaseLedger();
    const previousValues = buildDashboardDerivations(previousLedger, OPTIONS);
    const historical = createUsdtSimpleTrade(
      "historical-trade",
      "buy",
      "BTC",
      "1",
      "2026-08-17",
    );
    const nextLedger = appendTrade(previousLedger, {
      ...historical,
      createdAt: "2026-08-17T12:00:00.000Z",
      updatedAt: "2026-08-17T12:00:00.000Z",
    });

    const update = updateDashboardDerivationsForAppend(
      previousValues,
      previousLedger,
      nextLedger,
      OPTIONS,
    );

    expect(update.mode).toBe("incremental");
    expect(update.cashReplay).toBe("full-fallback");
    expect(update.positionReplay).toBe("affected-asset");
    expect(update.values).toEqual(buildDashboardDerivations(nextLedger, OPTIONS));
  });

  it("falls back to the full derivation for a newly active asset", () => {
    const previousLedger = createBaseLedger();
    const previousValues = buildDashboardDerivations(previousLedger, OPTIONS);
    const nextLedger = appendTrade(
      previousLedger,
      createUsdtSimpleTrade("new-eth-trade", "buy", "ETH", "1", "2026-08-19"),
    );

    const update = updateDashboardDerivationsForAppend(
      previousValues,
      previousLedger,
      nextLedger,
      OPTIONS,
    );

    expect(update.mode).toBe("full-fallback");
    expect(update.positionReplay).toBe("full-fallback");
    expect(update.values).toEqual(buildDashboardDerivations(nextLedger, OPTIONS));
  });

  it("falls back when the ledger change is not one appended fact", () => {
    const previousLedger = createBaseLedger();
    const previousValues = buildDashboardDerivations(previousLedger, OPTIONS);
    const nextLedger = structuredClone(previousLedger);
    nextLedger.trades[0] = { ...nextLedger.trades[0], quantity: "9" };

    const update = updateDashboardDerivationsForAppend(
      previousValues,
      previousLedger,
      nextLedger,
      OPTIONS,
    );

    expect(update.mode).toBe("full-fallback");
    expect(update.values).toEqual(buildDashboardDerivations(nextLedger, OPTIONS));
  });
});

function createBaseLedger(): LedgerData {
  const ledger = createInitialLedgerData();
  ledger.trades = [
    createUsdtSimpleTrade("base-btc-trade", "buy", "BTC", "2", "2026-08-18"),
  ];
  ledger.priceSnapshots = [
    createPriceSnapshot("base-btc-price", "BTC", "10", "2026-08-18"),
  ];
  return ledger;
}

function currentTrade(): Trade {
  return {
    ...createUsdtSimpleTrade("current-trade", "buy", "BTC", "1", "2026-08-19"),
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function currentCashEvent(): CashEvent {
  return {
    id: "current-cash",
    occurredAt: "2026-08-19",
    timePrecision: "day",
    type: "deposit",
    currency: "USDT",
    amount: "25",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function currentTransfer(): AssetTransfer {
  return {
    id: "current-transfer",
    occurredAt: "2026-08-19",
    timePrecision: "day",
    assetSymbol: "BTC",
    quantity: "1",
    category: "external-in",
    reason: "deposit",
    unitPrice: "8",
    toLocation: "cold-wallet",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function currentPrice(): PriceSnapshot {
  return {
    ...createPriceSnapshot("current-price", "BTC", "12", "2026-08-19"),
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function appendTrade(ledger: LedgerData, trade: Trade): LedgerData {
  return { ...ledger, trades: [...ledger.trades, trade] };
}

function appendCashEvent(ledger: LedgerData, cashEvent: CashEvent): LedgerData {
  return { ...ledger, cashEvents: [...ledger.cashEvents, cashEvent] };
}

function appendAssetTransfer(
  ledger: LedgerData,
  assetTransfer: AssetTransfer,
): LedgerData {
  return {
    ...ledger,
    assetTransfers: [...ledger.assetTransfers, assetTransfer],
  };
}

function appendPriceSnapshot(
  ledger: LedgerData,
  priceSnapshot: PriceSnapshot,
): LedgerData {
  return {
    ...ledger,
    priceSnapshots: [...ledger.priceSnapshots, priceSnapshot],
  };
}

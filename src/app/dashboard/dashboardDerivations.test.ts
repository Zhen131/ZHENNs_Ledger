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
  resolveDashboardDerivations,
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
  it.each(["1d", "7d", "30d", "365d", "all"] as const)(
    "matches a full recomputation for a current trade in the %s history range",
    (chartRange) => {
      const options = { ...OPTIONS, chartRange };
      const previousLedger = createBaseLedger();
      const previousValues = buildDashboardDerivations(
        previousLedger,
        options,
      );
      const nextLedger = appendTrade(previousLedger, {
        ...currentTrade(),
        occurredAt: OPTIONS.todayKey,
      });

      const update = updateDashboardDerivationsForAppend(
        previousValues,
        previousLedger,
        nextLedger,
        options,
      );

      expect(update.values).toEqual(
        buildDashboardDerivations(nextLedger, options),
      );
    },
  );

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

describe("resolveDashboardDerivations", () => {
  it("reuses one in-memory result for the same facts and query", () => {
    const ledger = createBaseLedger();
    const initial = resolveDashboardDerivations(null, ledger, OPTIONS, 1);
    const hit = resolveDashboardDerivations(initial.cache, ledger, OPTIONS, 1);

    expect(initial.mode).toBe("session-reset");
    expect(hit.mode).toBe("cache-hit");
    expect(hit.values).toBe(initial.values);
    expect(hit.cache).toBe(initial.cache);
  });

  it("keys view options without invalidating the fact generation", () => {
    const ledger = createBaseLedger();
    const initial = resolveDashboardDerivations(null, ledger, OPTIONS, 1);
    const otherRange = resolveDashboardDerivations(
      initial.cache,
      ledger,
      { ...OPTIONS, chartRange: "30d" },
      1,
    );

    expect(otherRange.mode).toBe("query-miss");
    expect(otherRange.cache.generation).toBe(initial.cache.generation);
    expect(otherRange.cache.entries.size).toBe(2);
  });

  it("invalidates the prior generation after adding one fact", () => {
    const ledger = createBaseLedger();
    const initial = resolveDashboardDerivations(null, ledger, OPTIONS, 1);
    const nextLedger = appendTrade(ledger, currentTrade());
    const added = resolveDashboardDerivations(
      initial.cache,
      nextLedger,
      OPTIONS,
      1,
    );

    expect(added.mode).toBe("fact-change-incremental");
    expect(added.cache.generation).toBe(initial.cache.generation + 1);
    expect(added.values).not.toBe(initial.values);
    expect(added.values).toEqual(buildDashboardDerivations(nextLedger, OPTIONS));
  });

  it("invalidates after deletion and again after undoing that deletion", () => {
    const base = createBaseLedger();
    const withAddedTrade = appendTrade(base, currentTrade());
    const initial = resolveDashboardDerivations(
      null,
      withAddedTrade,
      OPTIONS,
      1,
    );
    const deletedLedger = { ...withAddedTrade, trades: base.trades };
    const deleted = resolveDashboardDerivations(
      initial.cache,
      deletedLedger,
      OPTIONS,
      1,
    );
    const restoredLedger = appendTrade(deletedLedger, currentTrade());
    const restored = resolveDashboardDerivations(
      deleted.cache,
      restoredLedger,
      OPTIONS,
      1,
    );

    expect(deleted.mode).toBe("fact-change-full");
    expect(restored.mode).toBe("fact-change-incremental");
    expect(deleted.cache.generation).toBe(initial.cache.generation + 1);
    expect(restored.cache.generation).toBe(deleted.cache.generation + 1);
    expect(restored.values).not.toBe(deleted.values);
    expect(restored.values).toEqual(
      buildDashboardDerivations(restoredLedger, OPTIONS),
    );
  });

  it("drops every cached query when the ledger session changes", () => {
    const ledger = createBaseLedger();
    const initial = resolveDashboardDerivations(null, ledger, OPTIONS, 1);
    const alternateLedger = appendCashEvent(ledger, currentCashEvent());
    const switched = resolveDashboardDerivations(
      initial.cache,
      alternateLedger,
      OPTIONS,
      2,
    );

    expect(switched.mode).toBe("session-reset");
    expect(switched.cache.generation).toBe(initial.cache.generation + 1);
    expect(switched.cache.entries.size).toBe(1);
    expect(switched.values).not.toBe(initial.values);
    expect(switched.values).toEqual(
      buildDashboardDerivations(alternateLedger, OPTIONS),
    );
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

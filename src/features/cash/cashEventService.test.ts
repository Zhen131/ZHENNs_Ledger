import { describe, expect, it, vi } from "vitest";

import type { LedgerData } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { replayUsdtCash } from "@/core/calculations";
import {
  CASH_EVENT_SERVICE_ERROR_CODES,
  createValidatedCashEvent,
  type CashEventServiceDependencies,
} from "./cashEventService";

const NOW = "2026-08-18T08:00:00.000Z";

describe("createValidatedCashEvent", () => {
  it("creates all flow types and an evidence-preserving adjustment", () => {
    let ledger = createInitialLedgerData();
    for (const [index, draft] of [
      { type: "deposit", amountOrTarget: "1000" },
      { type: "withdrawal", amountOrTarget: "125.5" },
      { type: "external-expense", amountOrTarget: "24.5" },
    ].entries()) {
      const result = createValidatedCashEvent(
        { ...draft, occurredAt: `2026-08-0${index + 1}` },
        ledger,
        dependencies([`cash-${index + 1}`]),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      ledger = append(ledger, result.cashEvent);
    }
    expect(replayUsdtCash(ledger).balance).toBe("850");

    const adjustment = createValidatedCashEvent(
      {
        type: "balance-adjustment",
        occurredAt: "2026-08-04",
        amountOrTarget: "800",
        note: "  counted wallet  ",
      },
      ledger,
      dependencies(["cash-adjust"]),
    );
    expect(adjustment.ok).toBe(true);
    if (!adjustment.ok) return;
    expect(adjustment.cashEvent).toEqual({
      id: "cash-adjust",
      occurredAt: "2026-08-04",
      timePrecision: "day",
      type: "balance-adjustment",
      currency: "USDT",
      balanceBefore: "850",
      targetBalance: "800",
      adjustmentAmount: "-50",
      note: "counted wallet",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(adjustment.projection.nextBalance).toBe("800");
    expect(replayUsdtCash(ledger).balance).toBe("850");
  });

  it.each(["0", "-1", "01", "1e3", "+1", "-0"])(
    "rejects invalid flow amount %s with zero mutation",
    (amountOrTarget) => {
      const ledger = createInitialLedgerData();
      const snapshot = structuredClone(ledger);
      const result = createValidatedCashEvent(
        { type: "deposit", occurredAt: "2026-08-18", amountOrTarget },
        ledger,
        dependencies(["unused"]),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code: CASH_EVENT_SERVICE_ERROR_CODES.INVALID_AMOUNT },
      });
      expect(ledger).toEqual(snapshot);
    },
  );

  it("allows a negative adjustment target and marks the exact deficit", () => {
    const result = createValidatedCashEvent(
      {
        type: "balance-adjustment",
        occurredAt: "2026-08-18",
        amountOrTarget: "-25",
      },
      createInitialLedgerData(),
      dependencies(["negative-adjust"]),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projection).toEqual({
        currentBalance: "0",
        delta: "-25",
        nextBalance: "-25",
        deficit: "25",
        requiresNegativeBalanceConfirmation: true,
      });
    }
  });

  it("rejects future facts before generating an ID", () => {
    const deps = dependencies(["unused"]);
    const result = createValidatedCashEvent(
      {
        type: "deposit",
        occurredAt: "2026-08-19",
        amountOrTarget: "1",
      },
      createInitialLedgerData(),
      deps,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: CASH_EVENT_SERVICE_ERROR_CODES.FUTURE_FACT },
    });
    expect(deps.generateId).not.toHaveBeenCalled();
    expect(deps.now).not.toHaveBeenCalled();
  });

  it("retries IDs across every collection and uses the third unique value", () => {
    const ledger = createInitialLedgerData();
    ledger.trades = [
      {
        id: "taken-trade",
        occurredAt: "2026-08-18",
        timePrecision: "day",
        type: "buy",
        assetSymbol: "BTC",
        quantity: "1",
        price: "1",
        totalValue: "1",
        currency: "USDT",
        fee: "0",
        feeCurrency: "USDT",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    const deps = dependencies([
      ledger.assets[0].id,
      "taken-trade",
      "cash-unique",
    ]);
    const result = createValidatedCashEvent(
      { type: "deposit", occurredAt: "2026-08-18", amountOrTarget: "2" },
      ledger,
      deps,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cashEvent.id).toBe("cash-unique");
    expect(deps.generateId).toHaveBeenCalledTimes(3);
    expect(deps.now).toHaveBeenCalledOnce();
  });

  it("returns exhaustion after three collisions without reading save time", () => {
    const ledger = createInitialLedgerData();
    const deps = dependencies(Array(3).fill(ledger.assets[0].id));
    const result = createValidatedCashEvent(
      { type: "deposit", occurredAt: "2026-08-18", amountOrTarget: "2" },
      ledger,
      deps,
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: CASH_EVENT_SERVICE_ERROR_CODES.ID_GENERATION_EXHAUSTED,
      },
    });
    expect(deps.generateId).toHaveBeenCalledTimes(3);
    expect(deps.now).not.toHaveBeenCalled();
  });
});

function append(
  ledger: LedgerData,
  cashEvent: LedgerData["cashEvents"][number],
): LedgerData {
  return { ...ledger, cashEvents: [...ledger.cashEvents, cashEvent] };
}

function dependencies(ids: string[]): CashEventServiceDependencies & {
  generateId: ReturnType<typeof vi.fn>;
  now: ReturnType<typeof vi.fn>;
  todayKey: ReturnType<typeof vi.fn>;
} {
  let index = 0;
  return {
    generateId: vi.fn(() => ids[index++] ?? "unexpected"),
    now: vi.fn(() => NOW),
    todayKey: vi.fn(() => "2026-08-18"),
  };
}

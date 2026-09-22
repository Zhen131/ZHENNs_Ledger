import {
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  vi,
} from "vitest";
import type { LedgerData } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade } from "@/test-support";
import { TransactionsWorkspace } from "./TransactionsWorkspace";

export const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-25T12:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalScrollIntoView) {
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      originalScrollIntoView,
    );
  } else {
    delete (HTMLElement.prototype as { scrollIntoView?: unknown })
      .scrollIntoView;
  }
});

export function createLedger(): LedgerData {
  const ledgerData = createInitialLedgerData();
  ledgerData.trades = [
    createUsdtSimpleTrade("btc-old", "buy", "BTC", "1", "2025-07-20"),
    createUsdtSimpleTrade("eth-recent", "buy", "ETH", "2", "2026-07-22"),
    createUsdtSimpleTrade("btc-today", "sell", "BTC", "0.5", "2026-07-25"),
    createUsdtSimpleTrade("ada-today", "buy", "ADA", "3", "2026-07-25"),
  ];
  return ledgerData;
}

export function createNegativeDeletionLedger(): LedgerData {
  const ledgerData = createInitialLedgerData();
  ledgerData.cashEvents = [
    {
      id: "cash-buffer",
      occurredAt: "2026-07-19",
      timePrecision: "day",
      type: "deposit",
      currency: "USDT",
      amount: "0.5",
      createdAt: "2026-07-19T12:00:00.000Z",
      updatedAt: "2026-07-19T12:00:00.000Z",
    },
  ];
  ledgerData.trades = [
    createUsdtSimpleTrade("cash-buy", "buy", "BTC", "1", "2026-07-20"),
    createUsdtSimpleTrade("cash-sell", "sell", "BTC", "1", "2026-07-21"),
  ];
  return ledgerData;
}

export function renderWorkspace({
  active = true,
  ledgerData = createLedger(),
  intent = null,
  mutationVersion = 0,
  persistedVersion = 0,
  persistenceStatus = "saved" as const,
  onDeleteTrade = vi.fn(() => "applied" as const),
  onDeleteCashEvent = vi.fn(() => "applied" as const),
}: {
  active?: boolean;
  ledgerData?: LedgerData;
  intent?: Parameters<typeof TransactionsWorkspace>[0]["intent"];
  mutationVersion?: number;
  persistedVersion?: number;
  persistenceStatus?: Parameters<
    typeof TransactionsWorkspace
  >[0]["persistenceStatus"];
  onDeleteTrade?: Parameters<
    typeof TransactionsWorkspace
  >[0]["onDeleteTrade"];
  onDeleteCashEvent?: Parameters<
    typeof TransactionsWorkspace
  >[0]["onDeleteCashEvent"];
} = {}) {
  return render(
    <TransactionsWorkspace
      active={active}
      intent={intent}
      isWritable
      ledgerData={ledgerData}
      ledgerEpoch={1}
      mutationVersion={mutationVersion}
      onDeleteCashEvent={onDeleteCashEvent}
      onDeleteTrade={onDeleteTrade}
      onIntentConsumed={vi.fn()}
      persistedVersion={persistedVersion}
      persistenceStatus={persistenceStatus}
      todayKey="2026-07-25"
    />,
  );
}

export function deleteButton(tradeName: string) {
  return screen.getByRole("button", { name: tradeName });
}

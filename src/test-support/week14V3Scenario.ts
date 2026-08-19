import type { CashEvent, LedgerData, Trade } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";

export const WEEK14_V3_TODAY = "2026-08-19";

export function createWeek14V3Scenario(): LedgerData {
  const ledger = createInitialLedgerData();
  ledger.assets.push({
    id: "asset-stage8-sol",
    symbol: "SOL",
    name: "Solana",
    quoteCurrency: "USDT",
    binanceMapping: {
      provider: "binance",
      symbol: "SOLUSDT",
      baseAsset: "SOL",
      quoteAsset: "USDT",
    },
    createdAt: "2026-08-09T08:00:00.000Z",
    updatedAt: "2026-08-09T08:00:00.000Z",
  });
  ledger.assets.push({
    id: "asset-stage8-knight",
    symbol: "KNIGHT",
    name: "KNIGHT",
    quoteCurrency: "USDT",
    binanceMapping: null,
    createdAt: "2026-08-09T08:01:00.000Z",
    updatedAt: "2026-08-09T08:01:00.000Z",
  });
  ledger.cashEvents = [
    cashFlow("cash-stage8-deposit", "deposit", "1000", "2026-08-10", 1),
    cashFlow("cash-stage8-withdrawal", "withdrawal", "100", "2026-08-11", 2),
    cashFlow("cash-stage8-expense", "external-expense", "50", "2026-08-12", 3),
    {
      id: "cash-stage8-adjustment",
      occurredAt: "2026-08-13",
      timePrecision: "day",
      type: "balance-adjustment",
      currency: "USDT",
      balanceBefore: "850",
      targetBalance: "800",
      adjustmentAmount: "-50",
      note: "Fictional Stage 8 balance calibration",
      createdAt: "2026-08-13T08:00:00.000Z",
      updatedAt: "2026-08-13T08:00:00.000Z",
    },
  ];
  ledger.trades = [
    trade({
      id: "trade-stage8-sol-buy",
      occurredAt: "2026-08-14",
      type: "buy",
      quantity: "10",
      price: "90",
      totalValue: "900",
      fee: "5",
    }),
    trade({
      id: "trade-stage8-sol-sell",
      occurredAt: "2026-08-15",
      type: "sell",
      quantity: "2",
      price: "100",
      totalValue: "200",
      fee: "2",
    }),
  ];
  ledger.priceSnapshots = [
    {
      id: "price-stage8-sol-manual",
      assetSymbol: "SOL",
      price: "75",
      currency: "USDT",
      recordedAt: "2026-08-15",
      source: "manual",
      note: "Fictional Stage 8 price",
      createdAt: "2026-08-15T09:00:00.000Z",
      updatedAt: "2026-08-15T09:00:00.000Z",
    },
  ];
  return ledger;
}

function cashFlow(
  id: string,
  type: "deposit" | "withdrawal" | "external-expense",
  amount: string,
  occurredAt: string,
  sequence: number,
): CashEvent {
  const createdAt = `${occurredAt}T08:0${sequence}:00.000Z`;
  return {
    id,
    occurredAt,
    timePrecision: "day",
    type,
    currency: "USDT",
    amount,
    note: `Fictional Stage 8 ${type}`,
    createdAt,
    updatedAt: createdAt,
  };
}

function trade(input: Readonly<{
  id: string;
  occurredAt: string;
  type: "buy" | "sell";
  quantity: string;
  price: string;
  totalValue: string;
  fee: string;
}>): Trade {
  const createdAt = `${input.occurredAt}T08:00:00.000Z`;
  return {
    ...input,
    timePrecision: "day",
    assetSymbol: "SOL",
    currency: "USDT",
    feeCurrency: "USDT",
    platform: "Fictional Exchange",
    createdAt,
    updatedAt: createdAt,
  };
}

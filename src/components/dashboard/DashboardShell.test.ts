import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Position, Trade } from "../../models";
import type { LedgerRepository } from "../../repositories/ledgerRepository";
import { getPositionsFromLedger } from "../../services/positionService";
import { createInitialLedgerData } from "../../state/initialLedgerData";
import { ledgerReducer } from "../../state/ledgerReducer";
import type { LedgerClock } from "../../utils/ledgerDate";
import { DashboardShell, TradeTable } from "./DashboardShell";

vi.mock("../../services/positionService", () => ({
  getPositionsFromLedger: vi.fn(),
  getValuedPositionsFromLedger: vi.fn(() => []),
}));

const getPositionsFromLedgerMock = vi.mocked(getPositionsFromLedger);
const staticRepository: LedgerRepository = {
  load: async () => null,
  save: async () => undefined,
  clear: async () => undefined,
};
const fixedClock: LedgerClock = {
  now: () => new Date("2026-07-25T12:00:00Z"),
};

const pricedPosition: Position = {
  assetSymbol: "SOL",
  quantity: "2.3456789",
  averageCost: "100",
  costBasis: "200",
  latestPrice: "120",
  marketValue: "240",
  realizedPnl: "0",
  unrealizedPnl: "40",
  currency: "USD",
};

const unpricedPosition: Position = {
  assetSymbol: "DOGE",
  quantity: "10",
  averageCost: "0.1",
  costBasis: "1",
  realizedPnl: "0",
  currency: "USD",
};

const buyTrade = Object.freeze({
  id: "trade-buy-sentinel",
  occurredAt: "2042-11-03T04:05:06Z",
  timePrecision: "second",
  type: "buy",
  assetSymbol: "XQZ-BUY",
  quantity: "123.45678901",
  price: "987.65432109",
  totalValue: "777.888999",
  currency: "XCU-BUY",
  fee: "0.123",
  feeCurrency: "XCU-BUY",
  createdAt: "2042-11-03T04:05:07Z",
  updatedAt: "2042-11-03T04:05:08Z",
}) satisfies Trade;

const sellTrade = Object.freeze({
  id: "trade-sell-sentinel",
  occurredAt: "2041-09-08T07:06:05Z",
  timePrecision: "second",
  type: "sell",
  assetSymbol: "QYX-SELL",
  quantity: "98.76543210",
  price: "12.34567890",
  totalValue: "444.555666",
  currency: "XCU-SELL",
  fee: "0.456",
  feeCurrency: "XCU-SELL",
  createdAt: "2041-09-08T07:06:06Z",
  updatedAt: "2041-09-08T07:06:07Z",
}) satisfies Trade;

describe("TradeTable", () => {
  it("renders a six-column empty state", () => {
    const html = renderToStaticMarkup(
      createElement(TradeTable, { trades: [] }),
    );

    expect(html).toContain(
      'colSpan="6">No trades yet. Added trades will appear here automatically.</td>',
    );
  });

  it("maps a formal buy trade to all six display columns", () => {
    const html = renderToStaticMarkup(
      createElement(TradeTable, { trades: [buyTrade] }),
    );

    expect(html).toContain(buyTrade.occurredAt);
    expect(html).toContain(">Buy<");
    expect(html).toContain(buyTrade.assetSymbol);
    expect(html).toContain(buyTrade.quantity);
    expect(html).toContain(buyTrade.price);
    expect(html).toContain(
      `${buyTrade.totalValue} ${buyTrade.currency}`,
    );
    expect(html).not.toContain(
      "No trades yet. Added trades will appear here automatically.",
    );
  });

  it("maps sell trades and preserves the frozen input order", () => {
    const trades: readonly Trade[] = Object.freeze([buyTrade, sellTrade]);

    const html = renderToStaticMarkup(createElement(TradeTable, { trades }));

    expect(html).toContain(">Sell<");
    expect(html.indexOf(buyTrade.assetSymbol)).toBeLessThan(
      html.indexOf(sellTrade.assetSymbol),
    );
    expect(trades).toEqual([buyTrade, sellTrade]);
  });

  it("renders trades returned by the reducer without claiming UI dispatch", () => {
    const nextLedger = ledgerReducer(createInitialLedgerData(), {
      type: "trade/add",
      trade: buyTrade,
    });

    const html = renderToStaticMarkup(
      createElement(TradeTable, { trades: nextLedger.trades }),
    );

    expect(html).toContain(buyTrade.assetSymbol);
    expect(html).toContain(buyTrade.totalValue);
  });

  it("keeps the delete action visible but disabled during a persistence operation", () => {
    const html = renderToStaticMarkup(
      createElement(TradeTable, {
        trades: [buyTrade],
        onDelete: vi.fn(),
        deleteDisabled: true,
      }),
    );

    expect(html).toContain('aria-label="Delete buy XQZ-BUY 2042-11-03T04:05:06Z"');
    expect(html).toContain("disabled");
  });
});

describe("DashboardShell ledger views", () => {
  beforeEach(() => {
    getPositionsFromLedgerMock.mockReset();
  });

  it("renders positions derived from the current ledger", () => {
    getPositionsFromLedgerMock.mockReturnValue([
      pricedPosition,
      unpricedPosition,
    ]);

    const html = renderToStaticMarkup(
      createElement(DashboardShell, {
        repository: staticRepository,
        clock: fixedClock,
      }),
    );

    expect(getPositionsFromLedgerMock).toHaveBeenCalledWith(
      createInitialLedgerData(),
      { mode: "auto", todayKey: "2026-07-25" },
    );
    expect(html).toContain("SOL");
    expect(html).toContain("2.3456789");
    expect(html).toContain("100 USD");
    expect(html).toContain("200 USD");
    expect(html).toContain("0 USD");
    expect(html).toContain("120 USD");
    expect(html).toContain("240 USD");
    expect(html).toContain("40 USD");
    expect(html).toContain("DOGE");
    expect(html).toContain("0.1 USD");
    expect(html).toContain("1 USD");
    expect(html).toContain("No price entered");
    expect(html.match(/>--</g)).toHaveLength(2);
    expect(html).toContain("Remaining cost basis (fees excluded)");
    expect(html).toContain("Realized profit and loss (fees excluded)");
  });

  it("renders an eight-column empty state when the ledger has no positions", () => {
    getPositionsFromLedgerMock.mockReturnValue([]);

    const html = renderToStaticMarkup(
      createElement(DashboardShell, {
        repository: staticRepository,
        clock: fixedClock,
      }),
    );

    expect(html).toContain(
      'colSpan="8">No positions yet. Added trades will be summarized here automatically.</td>',
    );
  });

  it("renders the initial trade empty state from the current ledger", () => {
    getPositionsFromLedgerMock.mockReturnValue([]);

    const html = renderToStaticMarkup(
      createElement(DashboardShell, {
        repository: staticRepository,
        clock: fixedClock,
      }),
    );

    expect(getPositionsFromLedgerMock).toHaveBeenCalledWith(
      createInitialLedgerData(),
      { mode: "auto", todayKey: "2026-07-25" },
    );
    expect(html).toContain(
      "No trades yet. Added trades will appear here automatically.",
    );
  });

  it("contains wide tables without forcing page-level horizontal overflow", () => {
    getPositionsFromLedgerMock.mockReturnValue([pricedPosition]);

    const html = renderToStaticMarkup(
      createElement(DashboardShell, {
        repository: staticRepository,
        clock: fixedClock,
      }),
    );

    expect(html).not.toContain("lg:w-60 lg:shrink-0");
    expect(html).toContain("max-w-7xl px-5");
    expect(html).toContain(
      'class="min-w-0 rounded-lg border border-slate-200',
    );
    expect(html).toContain("min-w-[960px]");
  });

  it("removes fake navigation and renders the three truthful chart summaries", () => {
    getPositionsFromLedgerMock.mockReturnValue([]);

    const html = renderToStaticMarkup(
      createElement(DashboardShell, {
        repository: staticRepository,
        clock: fixedClock,
      }),
    );

    expect(html).not.toContain("Browser-only MVP shell");
    expect(html).not.toContain(">Today<");
    expect(html).not.toContain(">This Month<");
    expect(html).not.toContain("Future asset net-worth and candlestick charts");
    expect(html).toContain("Current USD-equivalent position allocation");
    expect(html).toContain("Position market value / position cost basis");
    expect(html).toContain("Trading activity over the last 365 days");
  });
});

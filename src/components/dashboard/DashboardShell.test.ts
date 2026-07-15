import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Position, Trade } from "../../models";
import { getPositionsFromLedger } from "../../services/positionService";
import { createInitialLedgerData } from "../../state/initialLedgerData";
import { ledgerReducer } from "../../state/ledgerReducer";
import { DashboardShell, TradeTable } from "./DashboardShell";

vi.mock("../../services/positionService", () => ({
  getPositionsFromLedger: vi.fn(),
}));

const getPositionsFromLedgerMock = vi.mocked(getPositionsFromLedger);

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
      'colSpan="6">暂无交易。添加交易后，这里会自动显示。</td>',
    );
  });

  it("maps a formal buy trade to all six display columns", () => {
    const html = renderToStaticMarkup(
      createElement(TradeTable, { trades: [buyTrade] }),
    );

    expect(html).toContain(buyTrade.occurredAt);
    expect(html).toContain(">买入<");
    expect(html).toContain(buyTrade.assetSymbol);
    expect(html).toContain(buyTrade.quantity);
    expect(html).toContain(buyTrade.price);
    expect(html).toContain(
      `${buyTrade.totalValue} ${buyTrade.currency}`,
    );
    expect(html).not.toContain(
      "暂无交易。添加交易后，这里会自动显示。",
    );
  });

  it("maps sell trades and preserves the frozen input order", () => {
    const trades: readonly Trade[] = Object.freeze([buyTrade, sellTrade]);

    const html = renderToStaticMarkup(createElement(TradeTable, { trades }));

    expect(html).toContain(">卖出<");
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

    const html = renderToStaticMarkup(createElement(DashboardShell));

    expect(getPositionsFromLedgerMock).toHaveBeenCalledOnce();
    expect(getPositionsFromLedgerMock).toHaveBeenCalledWith(
      createInitialLedgerData(),
    );
    expect(html).toContain("SOL");
    expect(html).toContain("2.3456789");
    expect(html).toContain("100 USD");
    expect(html).toContain("120 USD");
    expect(html).toContain("240 USD");
    expect(html).toContain("40 USD");
    expect(html).toContain("DOGE");
    expect(html).toContain("0.1 USD");
    expect(html).toContain("未输入价格");
    expect(html.match(/>--</g)).toHaveLength(2);
  });

  it("renders a six-column empty state when the ledger has no positions", () => {
    getPositionsFromLedgerMock.mockReturnValue([]);

    const html = renderToStaticMarkup(createElement(DashboardShell));

    expect(html).toContain(
      'colSpan="6">暂无持仓。添加交易后，这里会自动汇总。</td>',
    );
  });

  it("renders the initial trade empty state from the current ledger", () => {
    getPositionsFromLedgerMock.mockReturnValue([]);

    const html = renderToStaticMarkup(createElement(DashboardShell));

    expect(getPositionsFromLedgerMock).toHaveBeenCalledWith(
      createInitialLedgerData(),
    );
    expect(html).toContain(
      "暂无交易。添加交易后，这里会自动显示。",
    );
  });
});

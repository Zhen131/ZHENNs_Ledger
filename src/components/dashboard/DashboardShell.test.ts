import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Position } from "../../models";
import { getPositionsFromLedger } from "../../services/positionService";
import { DashboardShell } from "./DashboardShell";

vi.mock("../../services/positionService", () => ({
  getPositionsFromLedger: vi.fn(),
}));

const getPositionsFromLedgerMock = vi.mocked(getPositionsFromLedger);

const pricedPosition: Position = {
  assetSymbol: "SOL",
  quantity: "2",
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

describe("DashboardShell asset summary", () => {
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
    expect(getPositionsFromLedgerMock).toHaveBeenCalledWith({
      schemaVersion: 1,
      assets: [],
      trades: [],
      priceSnapshots: [],
      feeRules: [],
    });
    expect(html).toContain("SOL");
    expect(html).toContain("2");
    expect(html).toContain("100 USD");
    expect(html).toContain("120 USD");
    expect(html).toContain("240 USD");
    expect(html).toContain("40 USD");
    expect(html).toContain("DOGE");
    expect(html).toContain("0.1 USD");
    expect(html).toContain("未输入价格");
    expect(html).toContain("--");
  });
});

// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LedgerData, Position, Trade } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { HoldingsDetails } from "./HoldingsDetails";
import {
  calculatePriceChangeRatio,
  getTopMarketValuePositions,
  HoldingsOverview,
} from "./HoldingsOverview";
import { buildLedgerPnlSummary } from "./pnlSummaryService";
import { getPositionsFromLedger } from "./positionService";

afterEach(cleanup);

function position(
  assetSymbol: string,
  marketValue?: string,
): Position {
  return {
    assetSymbol,
    quantity: "1",
    locationQuantities: {
      exchange: "0.4",
      "cold-wallet": "0.6",
      "cold-wallet-earn": "0",
    },
    averageCost: "1",
    costBasis: "1",
    ...(marketValue === undefined
      ? {}
      : {
          latestPrice: marketValue,
          marketValue,
          unrealizedPnl: "0",
        }),
    realizedPnl: "0",
    giftIncome: "0",
    currency: "USDT",
  };
}

const TODAY = "2026-08-09";
const TIMESTAMP = "2026-08-09T00:00:00Z";

function trade(
  overrides: Pick<
    Trade,
    | "id"
    | "occurredAt"
    | "type"
    | "quantity"
    | "price"
    | "totalValue"
    | "fee"
  >,
): Trade {
  return {
    timePrecision: "day",
    assetSymbol: "BTC",
    currency: "USDT",
    feeCurrency: "USDT",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

function fixedLedger(): LedgerData {
  const ledger = createInitialLedgerData();
  ledger.trades = [
    trade({
      id: "buy",
      occurredAt: "2026-08-01",
      type: "buy",
      quantity: "0.1",
      price: "65000",
      totalValue: "6500",
      fee: "5",
    }),
    trade({
      id: "sell",
      occurredAt: "2026-08-02",
      type: "sell",
      quantity: "0.04",
      price: "70000",
      totalValue: "2800",
      fee: "3",
    }),
  ];
  ledger.priceSnapshots = [
    {
      id: "btc-price",
      assetSymbol: "BTC",
      price: "80000",
      currency: "USDT",
      recordedAt: TODAY,
      source: "manual",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
  ];
  return ledger;
}

describe("holdings workspace views", () => {
  it("sorts top holdings with decimal comparison and does not mutate input", () => {
    const input = [
      position("BTC", "9"),
      position("ETH", "100000000000000000000"),
      position("ADA"),
      position("SOL", "10"),
    ];
    expect(getTopMarketValuePositions(input).map((item) => item.assetSymbol)).toEqual([
      "ETH",
      "SOL",
      "BTC",
    ]);
    expect(input.map((item) => item.assetSymbol)).toEqual([
      "BTC",
      "ETH",
      "ADA",
      "SOL",
    ]);
  });

  it("reports missing prices and exposes a named view-all action", async () => {
    const onShowAll = vi.fn();
    render(
      <HoldingsOverview
        buyOutflowByAsset={{
          BTC: { value: "9", missingReasons: [] },
        }}
        cashBalance="0"
        onShowAll={onShowAll}
        positions={[position("BTC", "9"), position("ADA")]}
      />,
    );
    expect(screen.getByText(/ADA 缺少合法当前价格/)).toBeTruthy();
    await userEvent.setup().click(
      screen.getByRole("button", { name: "查看全部持仓" }),
    );
    expect(onShowAll).toHaveBeenCalledOnce();
  });

  it("T3-01 renders all eight fixed-ledger columns with exact values", () => {
    const ledger = fixedLedger();
    const options = { todayKey: TODAY, mode: "auto" as const };
    const positions = getPositionsFromLedger(ledger, options);
    const summary = buildLedgerPnlSummary(ledger, options);

    render(
      <HoldingsOverview
        buyOutflowByAsset={summary.buyOutflowByAsset}
        cashBalance="123.4567"
        onShowAll={vi.fn()}
        positions={positions}
      />,
    );

    expect(
      screen.getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual([
      "币种",
      "当前价格",
      "持仓均价",
      "相对均价涨跌",
      "未实现盈亏",
      "持仓量",
      "剩余持仓成本",
      "当前市值",
    ]);

    const btc = screen.getByRole("row", { name: /BTC/ });
    const cells = btc.querySelectorAll("th, td");
    expect(cells).toHaveLength(8);
    expect(cells[0]?.textContent).toBe("BTC");
    expect(within(cells[1] as HTMLElement).getByTitle("80000").textContent).toBe(
      "80,000.00",
    );
    expect(within(cells[2] as HTMLElement).getByTitle("65050").textContent).toBe(
      "65,050.00",
    );
    expect(
      within(cells[3] as HTMLElement).getByTitle(
        "0.229823212913143735588009223674096848578",
      ).textContent,
    ).toBe("+22.98%");
    expect(within(cells[4] as HTMLElement).getByTitle("897").textContent).toBe(
      "897.00",
    );
    expect(within(cells[5] as HTMLElement).getByTitle("0.06").textContent).toBe(
      "0.06",
    );
    expect(within(cells[6] as HTMLElement).getByTitle("6505").textContent).toBe(
      "6,505.00",
    );
    expect(within(cells[7] as HTMLElement).getByTitle("4800").textContent).toBe(
      "4,800.00",
    );
    expect(cells[3]?.className).toContain("text-emerald-700");
    expect(cells[4]?.className).toContain("text-emerald-700");

    const cash = screen.getByRole("row", { name: /现金 USDT/ });
    expect(cash.querySelectorAll("th, td")).toHaveLength(2);
    expect(within(cash).getByTitle("123.4567").textContent).toBe("123.46");
    expect(cash.className).not.toMatch(/text-(?:emerald|red)-700/);
    expect(
      Array.from(cash.querySelectorAll("th, td")).map(
        (cell) => cell.className,
      ),
    ).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/text-(?:emerald|red)-700/),
      ]),
    );
  });

  it("T3-02 uses decimal price-change math, colors losses red, and handles zero average cost", () => {
    expect(
      calculatePriceChangeRatio({ averageCost: "20", latestPrice: "10" }),
    ).toBe("-0.5");
    expect(
      calculatePriceChangeRatio({ averageCost: "0", latestPrice: "10" }),
    ).toBeUndefined();

    const loss = {
      ...position("LOSS", "10"),
      averageCost: "20",
      latestPrice: "10",
      unrealizedPnl: "-10",
    };
    const zeroAverage = {
      ...position("ZERO", "9"),
      averageCost: "0",
      latestPrice: "9",
      unrealizedPnl: "9",
    };
    render(
      <HoldingsOverview
        buyOutflowByAsset={{}}
        cashBalance="0"
        onShowAll={vi.fn()}
        positions={[loss, zeroAverage]}
      />,
    );

    const lossCells = screen
      .getByRole("row", { name: /LOSS/ })
      .querySelectorAll("th, td");
    expect(within(lossCells[3] as HTMLElement).getByTitle("-0.5").textContent).toBe(
      "-50.00%",
    );
    expect(lossCells[3]?.className).toContain("text-red-700");
    expect(lossCells[4]?.className).toContain("text-red-700");

    const zeroCells = screen
      .getByRole("row", { name: /ZERO/ })
      .querySelectorAll("th, td");
    expect(zeroCells[3]?.textContent).toBe("不可计算");
  });

  it("T3-03 keeps lifetime spend distinct from remaining cost after a sale", () => {
    const ledger = fixedLedger();
    const options = { todayKey: TODAY, mode: "auto" as const };
    const positions = getPositionsFromLedger(ledger, options);
    const summary = buildLedgerPnlSummary(ledger, options);

    expect(summary.buyOutflowByAsset.BTC?.value).toBe("6505");
    expect(positions[0]?.costBasis).toBe("3903");
    expect(summary.buyOutflowByAsset.BTC?.value).not.toBe(
      positions[0]?.costBasis,
    );
  });

  it("T3-04 shows only the top five market values and leaves missing-price assets out", () => {
    const positions = [
      position("A", "10"),
      position("B", "70"),
      position("C", "20"),
      position("D", "60"),
      position("E", "30"),
      position("F", "50"),
      position("G", "40"),
      position("MISSING"),
    ];

    expect(
      getTopMarketValuePositions(positions).map((item) => item.assetSymbol),
    ).toEqual(["B", "D", "F", "G", "E"]);

    render(
      <HoldingsOverview
        buyOutflowByAsset={{}}
        cashBalance="0"
        onShowAll={vi.fn()}
        positions={positions}
      />,
    );

    expect(screen.getAllByRole("row")).toHaveLength(7);
    for (const assetSymbol of ["B", "D", "F", "G", "E"]) {
      expect(
        screen.getByRole("rowheader", { name: assetSymbol }),
      ).toBeTruthy();
    }
    expect(screen.queryByRole("rowheader", { name: "A" })).toBeNull();
    expect(screen.queryByRole("rowheader", { name: "C" })).toBeNull();
    expect(screen.queryByRole("rowheader", { name: "MISSING" })).toBeNull();
    expect(
      screen.getByText(/MISSING 缺少合法当前价格/),
    ).toBeTruthy();
  });

  it("withholds cost-derived values when fee accounting is unreliable", () => {
    const unreliable = {
      ...position("FEE", "10"),
      averageCost: "8",
      unrealizedPnl: undefined,
      feeAccountingIssues: [
        {
          code: "UNSUPPORTED_FEE_CURRENCY" as const,
          tradeId: "fictional-fee-trade",
          assetSymbol: "FEE",
          occurredAt: TODAY,
          fee: "1",
          feeCurrency: "BNB",
          tradeCurrency: "USDT",
        },
      ],
    };

    expect(calculatePriceChangeRatio(unreliable)).toBeUndefined();
    render(
      <HoldingsOverview
        buyOutflowByAsset={{}}
        cashBalance="0"
        onShowAll={vi.fn()}
        positions={[unreliable]}
      />,
    );

    const cells = screen
      .getByRole("row", { name: /FEE/ })
      .querySelectorAll("th, td");
    expect(cells[2]?.textContent).toBe("不可可靠计算");
    expect(cells[3]?.textContent).toBe("不可可靠计算");
    expect(cells[4]?.textContent).toBe("不可可靠计算");
    expect(cells[3]?.className).not.toMatch(/text-(?:emerald|red)-700/);
    expect(cells[4]?.className).not.toMatch(/text-(?:emerald|red)-700/);
  });

  it("closes details with Escape and its named close control", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <HoldingsDetails
        cashBalance="0"
        onClose={onClose}
        open
        positions={[position("BTC", "9")]}
      />,
    );
    expect(screen.getByRole("complementary", { name: "完整持仓详情" })).toBeTruthy();
    await userEvent.setup().keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();

    rerender(
      <HoldingsDetails
        cashBalance="0"
        onClose={onClose}
        open
        positions={[position("BTC", "9")]}
      />,
    );
    await userEvent.setup().click(
      screen.getByRole("button", { name: "关闭完整持仓详情" }),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("always renders all three custody-location columns and quantities", () => {
    render(
      <HoldingsDetails
        cashBalance="0"
        onClose={vi.fn()}
        open
        positions={[position("BTC", "9")]}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "交易所数量" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "冷钱包数量" })).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: "冷钱包理财数量" }),
    ).toBeTruthy();
    expect(screen.getAllByText("0.4")).toHaveLength(1);
    expect(screen.getAllByText("0.6")).toHaveLength(1);
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTitle("9").map((element) => element.textContent)).toEqual([
      "9.00",
      "9.00",
    ]);
  });

  it("closes details when the backdrop is pressed", () => {
    const onClose = vi.fn();
    const view = render(
      <HoldingsDetails cashBalance="0" onClose={onClose} open positions={[]} />,
    );

    const backdrop = view.container.firstElementChild;
    expect(backdrop).toBeTruthy();
    fireEvent.mouseDown(backdrop as Element);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

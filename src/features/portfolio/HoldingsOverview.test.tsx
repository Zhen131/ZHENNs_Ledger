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

import type { AssetTransfer, LedgerData, Position, Trade } from "@/core/models";
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

function fictionalTrade(
  assetSymbol: string,
  overrides: Pick<
    Trade,
    | "id"
    | "occurredAt"
    | "type"
    | "quantity"
    | "price"
    | "totalValue"
  >,
): Trade {
  return {
    ...overrides,
    timePrecision: "day",
    assetSymbol,
    currency: "USDT",
    fee: "0",
    feeCurrency: "USDT",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function fictionalTransfer(
  assetSymbol: string,
  overrides: Pick<
    AssetTransfer,
    "id" | "occurredAt" | "category" | "reason" | "quantity"
  > &
    Partial<
      Pick<AssetTransfer, "fromLocation" | "toLocation" | "unitPrice">
    >,
): AssetTransfer {
  return {
    ...overrides,
    timePrecision: "day",
    assetSymbol,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function fictionalPrice(
  assetSymbol: string,
  price: string,
): LedgerData["priceSnapshots"][number] {
  return {
    id: `${assetSymbol.toLowerCase()}-scenario-price`,
    assetSymbol,
    price,
    currency: "USDT",
    recordedAt: TODAY,
    source: "manual",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
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

    render(
      <HoldingsOverview
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
      "80 000.00",
    );
    expect(within(cells[2] as HTMLElement).getByTitle("65050").textContent).toBe(
      "65 050.00",
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
    expect(within(cells[6] as HTMLElement).getByTitle("3903").textContent).toBe(
      "3 903.00",
    );
    expect(within(cells[7] as HTMLElement).getByTitle("4800").textContent).toBe(
      "4 800.00",
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

  it("T-01 through T-05 self-check the BTC sale row and remove lifetime spend", () => {
    const ledger = createInitialLedgerData();
    ledger.trades = [
      fictionalTrade("BTC", {
        id: "btc-buy-one",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "0.10",
        price: "30000",
        totalValue: "3000",
      }),
      fictionalTrade("BTC", {
        id: "btc-buy-two",
        occurredAt: "2026-08-02",
        type: "buy",
        quantity: "0.05",
        price: "40000",
        totalValue: "2000",
      }),
      fictionalTrade("BTC", {
        id: "btc-sell",
        occurredAt: "2026-08-03",
        type: "sell",
        quantity: "0.05",
        price: "50000",
        totalValue: "2500",
      }),
    ];
    ledger.priceSnapshots = [fictionalPrice("BTC", "45000")];
    const options = { todayKey: TODAY, mode: "auto" as const };
    const positions = getPositionsFromLedger(ledger, options);
    const summary = buildLedgerPnlSummary(ledger, options);

    render(
      <HoldingsOverview
        cashBalance="0"
        onShowAll={vi.fn()}
        positions={positions}
      />,
    );

    expect(summary.buyOutflowByAsset.BTC?.value).toBe("5000");
    const row = screen.getByRole("row", { name: /BTC/ });
    const cells = row.querySelectorAll("th, td");
    expect(Array.from(cells, (cell) => cell.textContent)).toEqual([
      "BTC",
      "45 000.00 USDT",
      "33 333.33 USDT",
      "+35.00%",
      "1 166.67 USDT",
      "0.1",
      "3 333.33 USDT",
      "4 500.00 USDT",
    ]);
    expect(within(row).queryByTitle("5000")).toBeNull();
  });

  it("T-06 shows the remaining ETH cost after an external transfer", () => {
    const ledger = createInitialLedgerData();
    ledger.trades = [
      fictionalTrade("ETH", {
        id: "eth-buy",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "2",
        price: "2000",
        totalValue: "4000",
      }),
    ];
    ledger.assetTransfers = [
      fictionalTransfer("ETH", {
        id: "eth-external-out",
        occurredAt: "2026-08-02",
        category: "external-out",
        reason: "withdrawal",
        quantity: "1",
        fromLocation: "exchange",
      }),
    ];
    ledger.priceSnapshots = [fictionalPrice("ETH", "2400")];
    const positions = getPositionsFromLedger(ledger, {
      todayKey: TODAY,
      mode: "auto",
    });
    const eth = positions.find((item) => item.assetSymbol === "ETH");

    expect(eth?.realizedPnl).toBe("-2000");
    render(
      <HoldingsOverview
        cashBalance="0"
        onShowAll={vi.fn()}
        positions={positions}
      />,
    );
    const cells = screen
      .getByRole("row", { name: /ETH/ })
      .querySelectorAll("th, td");
    expect(cells[4]?.textContent).toBe("400.00 USDT");
    expect(cells[6]?.textContent).toBe("2 000.00 USDT");
    expect(cells[7]?.textContent).toBe("2 400.00 USDT");
  });

  it("T-07 keeps SOL gift cost separate from cumulative buy outflow", () => {
    const ledger = createInitialLedgerData();
    ledger.assets.push({
      id: "fictional-sol",
      symbol: "SOL",
      name: "Fictional Solana",
      quoteCurrency: "USDT",
      binanceMapping: null,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    ledger.assetTransfers = [
      fictionalTransfer("SOL", {
        id: "sol-gift",
        occurredAt: "2026-08-01",
        category: "gain",
        reason: "airdrop",
        quantity: "10",
        unitPrice: "20",
        toLocation: "exchange",
      }),
    ];
    ledger.trades = [
      fictionalTrade("SOL", {
        id: "sol-buy",
        occurredAt: "2026-08-02",
        type: "buy",
        quantity: "5",
        price: "24",
        totalValue: "120",
      }),
    ];
    ledger.priceSnapshots = [fictionalPrice("SOL", "18")];
    const options = { todayKey: TODAY, mode: "auto" as const };
    const positions = getPositionsFromLedger(ledger, options);
    const summary = buildLedgerPnlSummary(ledger, options);

    expect(summary.buyOutflowByAsset.SOL?.value).toBe("120");
    render(
      <HoldingsOverview
        cashBalance="0"
        onShowAll={vi.fn()}
        positions={positions}
      />,
    );
    const row = screen.getByRole("row", { name: /SOL/ });
    const cells = row.querySelectorAll("th, td");
    expect(cells[4]?.textContent).toBe("-50.00 USDT");
    expect(cells[6]?.textContent).toBe("320.00 USDT");
    expect(cells[7]?.textContent).toBe("270.00 USDT");
    expect(row.textContent).not.toContain("120.00");
  });

  it("T-09 preserves both current-price and ranking missing-price fallbacks", () => {
    const missingCurrentPrice: Position = {
      ...position("NO-LATEST", "9"),
      latestPrice: undefined,
    };
    render(
      <HoldingsOverview
        cashBalance="0"
        onShowAll={vi.fn()}
        positions={[missingCurrentPrice, position("NO-MARKET-VALUE")]}
      />,
    );

    const cells = screen
      .getByRole("row", { name: /NO-LATEST/ })
      .querySelectorAll("th, td");
    expect(cells[1]?.textContent).toBe("缺少合法价格");
    expect(
      screen.queryByRole("rowheader", { name: "NO-MARKET-VALUE" }),
    ).toBeNull();
    expect(
      screen.getByText(/NO-MARKET-VALUE 缺少合法当前价格/),
    ).toBeTruthy();
  });

  it("T-11 shows incomplete unrealized profit without replacing the cost", () => {
    const incomplete: Position = {
      ...position("INCOMPLETE", "10"),
      unrealizedPnl: undefined,
    };
    render(
      <HoldingsOverview
        cashBalance="0"
        onShowAll={vi.fn()}
        positions={[incomplete]}
      />,
    );

    const cells = screen
      .getByRole("row", { name: /INCOMPLETE/ })
      .querySelectorAll("th, td");
    expect(cells[4]?.textContent).toBe("不可完整计算");
    expect(cells[6]?.textContent).toBe("1.00 USDT");
  });

  it("T-20 keeps equal market values ordered by asset symbol", () => {
    expect(
      getTopMarketValuePositions([
        position("SOL", "10"),
        position("BTC", "10"),
        position("ETH", "10"),
      ]).map((item) => item.assetSymbol),
    ).toEqual(["BTC", "ETH", "SOL"]);
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
    expect(cells[6]?.textContent).toBe("不可可靠计算");
    expect(cells[3]?.className).not.toMatch(/text-(?:emerald|red)-700/);
    expect(cells[4]?.className).not.toMatch(/text-(?:emerald|red)-700/);
  });

  it("T-14 and T-15 show the separated cumulative buy outflow column and explanation", () => {
    render(
      <HoldingsDetails
        buyOutflowByAsset={{
          BTC: { value: "123.45", missingReasons: [] },
        }}
        cashBalance="0"
        onClose={vi.fn()}
        open
        positions={[position("BTC", "9")]}
      />,
    );

    const aside = screen.getByRole("complementary", {
      name: "完整持仓详情",
    });
    const header = within(aside).getByRole("columnheader", {
      name: "累计买入流出",
    });
    expect(header.className).toContain("border-l");
    expect(
      within(aside).getByText(
        "累计买入流出是历史上买入一共支出的现金，不与本表其他任何列相减。",
      ),
    ).toBeTruthy();
    const cells = within(
      within(aside).getByRole("row", { name: /BTC/ }),
    ).getAllByRole("cell");
    expect(cells).toHaveLength(12);
    expect(cells[11]?.textContent).toContain("123.45 USDT");
    expect(cells[11]?.className).toContain("lg:border-l");
  });

  it("T-16 distinguishes absent and incomplete cumulative buy outflow metrics", () => {
    render(
      <HoldingsDetails
        buyOutflowByAsset={{
          BTC: {
            value: undefined,
            missingReasons: ["虚构买入手续费无法换算", "虚构买入币种不受支持"],
          },
        }}
        cashBalance="0"
        onClose={vi.fn()}
        open
        positions={[position("BTC", "9"), position("ETH", "8")]}
      />,
    );

    const btcCells = within(
      screen.getByRole("row", { name: /BTC/ }),
    ).getAllByRole("cell");
    expect(btcCells[11]?.textContent).toContain("不可完整计算");
    expect(
      btcCells[11]?.querySelector("[title]")?.getAttribute("title"),
    ).toBe("虚构买入手续费无法换算；虚构买入币种不受支持");

    const ethCells = within(
      screen.getByRole("row", { name: /ETH/ }),
    ).getAllByRole("cell");
    expect(within(ethCells[11] as HTMLElement).getByTitle("0").textContent).toBe(
      "0.00",
    );
  });

  it("T-17 keeps cumulative buy outflow inapplicable for the cash row", () => {
    render(
      <HoldingsDetails
        buyOutflowByAsset={{}}
        cashBalance="100"
        onClose={vi.fn()}
        open
        positions={[]}
      />,
    );

    const cells = within(
      screen.getByRole("row", { name: /现金 USDT/ }),
    ).getAllByRole("cell");
    expect(cells).toHaveLength(12);
    expect(cells[11]?.textContent).toContain("—");
  });

  it("closes details with Escape and its named close control", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <HoldingsDetails
        buyOutflowByAsset={{}}
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
        buyOutflowByAsset={{}}
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
        buyOutflowByAsset={{}}
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
      <HoldingsDetails
        buyOutflowByAsset={{}}
        cashBalance="0"
        onClose={onClose}
        open
        positions={[]}
      />,
    );

    const backdrop = view.container.firstElementChild;
    expect(backdrop).toBeTruthy();
    fireEvent.mouseDown(backdrop as Element);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

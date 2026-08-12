// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { LedgerData } from "@/core/models";
import type { LedgerRepository } from "@/platform/persistence";
import { sampleTradeDrafts } from "@/test-support";
import { createInitialLedgerData } from "@/core/state";
import { isWithinTolerance } from "@/core/shared";
import type { LedgerClock } from "@/core/shared";
import { DashboardShell as DashboardShellRuntime } from "./DashboardShell";

const fixedClock: LedgerClock = {
  now: () => new Date("2026-07-25T12:00:00"),
};

function DashboardShell({
  repository,
}: {
  repository: LedgerRepository;
}) {
  return (
    <DashboardShellRuntime clock={fixedClock} repository={repository} />
  );
}

vi.mock("echarts/core", () => ({
  init: vi.fn(() => ({
    dispose: vi.fn(),
    off: vi.fn(),
    on: vi.fn(),
    resize: vi.fn(),
    setOption: vi.fn(),
  })),
  use: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

function createMemoryRepository(
  initialData: LedgerData | null = null,
): LedgerRepository {
  let storedData: LedgerData | null =
    initialData === null ? null : structuredClone(initialData);

  return {
    load: vi.fn(async () =>
      storedData === null ? null : structuredClone(storedData),
    ),
    save: vi.fn(async (ledgerData) => {
      storedData = structuredClone(ledgerData);
    }),
    clear: vi.fn(async () => {
      storedData = null;
    }),
  };
}

function getSection(title: string): HTMLElement {
  const section = screen.getByRole("heading", { name: title }).closest("section");

  if (!section) {
    throw new Error(`Section not found: ${title}`);
  }

  return section;
}

function getPositionRow(assetSymbol: string): HTMLTableRowElement {
  const assetCell = within(getSection("资产汇总")).getByText(assetSymbol);
  const row = assetCell.closest("tr");

  if (!row) {
    throw new Error(`Position row not found: ${assetSymbol}`);
  }

  return row;
}

function getPositionCellValue(
  assetSymbol: string,
  columnIndex: number,
): string {
  const cells = within(getPositionRow(assetSymbol)).getAllByRole("cell");
  const text = cells[columnIndex]?.textContent?.trim();

  if (!text) {
    throw new Error(
      `Position cell not found: ${assetSymbol} column ${columnIndex}`,
    );
  }

  return text;
}

function expectPositionDecimal(
  assetSymbol: string,
  columnIndex: number,
  expected: string,
) {
  const actual = getPositionCellValue(assetSymbol, columnIndex).replace(
    /\s+(?:USD|USDT)$/,
    "",
  );

  expect(isWithinTolerance(actual, expected, "0.0000000001")).toBe(true);
}

async function fillTradeForm(input: {
  type: "buy" | "sell";
  assetSymbol: string;
  quantity: string;
  price: string;
  totalValue: string;
  occurredAt: string;
  fee: string;
  expectedCashImpact?: string;
}) {
  const user = userEvent.setup();

  await user.selectOptions(
    screen.getByLabelText("类型", { selector: "select" }),
    input.type,
  );
  await user.selectOptions(
    screen.getByLabelText("资产", { selector: "select" }),
    input.assetSymbol,
  );

  const fields = [
    ["数量", input.quantity],
    ["成交均价", input.price],
    ["成交金额（不含手续费）", input.totalValue],
    ["日期", input.occurredAt],
    ["实际手续费", input.fee],
  ] as const;

  for (const [label, value] of fields) {
    const field = screen.getByLabelText(label);
    await user.clear(field);
    await user.type(field, value);
  }

  if (input.expectedCashImpact) {
    expect(screen.getByText(input.expectedCashImpact)).not.toBeNull();
  }

  await user.click(screen.getByRole("button", { name: "保存交易" }));
}

async function enterGoldenTrades() {
  for (const draft of sampleTradeDrafts) {
    await fillTradeForm({
      type: draft.type,
      assetSymbol: draft.assetSymbol,
      quantity: draft.quantity,
      price: draft.price,
      totalValue: draft.totalValue,
      occurredAt: draft.occurredAt,
      fee: draft.fee ?? "0",
    });

    await waitFor(() => {
      expect(screen.getByText("交易已认证保存")).not.toBeNull();
    });
  }
}

describe("DashboardShell golden UI acceptance", () => {
  it("shows the fixed fee-aware buy, partial sell, and price example through real forms", async () => {
    render(<DashboardShell repository={createMemoryRepository()} />);

    await waitFor(() => {
      expect(
        screen.queryByText("正在读取本地账本，完成前不会写入任何数据。"),
      ).toBeNull();
    });

    await fillTradeForm({
      type: "buy",
      assetSymbol: "BTC",
      quantity: "0.1",
      price: "65000",
      totalValue: "6500",
      occurredAt: "2026-07-20",
      fee: "5",
      expectedCashImpact: "买入总支出：6505 USDT",
    });
    await fillTradeForm({
      type: "sell",
      assetSymbol: "BTC",
      quantity: "0.04",
      price: "70000",
      totalValue: "2800",
      occurredAt: "2026-07-21",
      fee: "3",
      expectedCashImpact: "卖出净到账：2797 USDT",
    });

    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByLabelText("价格资产", { selector: "select" }),
      "BTC",
    );
    await user.type(screen.getByLabelText("当前价格"), "80000");
    await user.type(screen.getByLabelText("价格日期"), "2026-07-25");
    await user.click(screen.getByRole("button", { name: "保存价格" }));

    expectPositionDecimal("BTC", 1, "0.06");
    expectPositionDecimal("BTC", 2, "65050");
    expectPositionDecimal("BTC", 3, "3903");
    expectPositionDecimal("BTC", 4, "195");
    expectPositionDecimal("BTC", 6, "4800");
    expectPositionDecimal("BTC", 7, "897");

    const summary = getSection("净盈亏摘要");
    for (const value of ["6505", "2797", "3903", "195", "897"]) {
      expect(within(summary).getByText(`${value} USDT`)).not.toBeNull();
    }
    const trades = getSection("交易列表");
    expect(within(trades).getByText("6505 USDT")).not.toBeNull();
    expect(within(trades).getByText("2797 USDT")).not.toBeNull();
    expect(within(trades).getByText("5 USDT")).not.toBeNull();
    expect(within(trades).getByText("3 USDT")).not.toBeNull();
  });

  it("reads an old USD ledger while disabling all new fact entry points", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assets = ledgerData.assets.map((asset) => ({
      ...asset,
      quoteCurrency: "USD",
    }));
    ledgerData.trades = [
      {
        id: "old-usd-buy",
        occurredAt: "2026-07-20",
        timePrecision: "day",
        type: "buy",
        assetSymbol: "BTC",
        quantity: "1",
        price: "10",
        totalValue: "10",
        currency: "USD",
        fee: "0",
        feeCurrency: "USD",
        createdAt: "2026-07-20T00:00:00Z",
        updatedAt: "2026-07-20T00:00:00Z",
      },
    ];
    ledgerData.priceSnapshots = [
      {
        id: "old-usd-price",
        assetSymbol: "BTC",
        price: "12",
        currency: "USD",
        recordedAt: "2026-07-25",
        source: "manual",
        createdAt: "2026-07-25T00:00:00Z",
        updatedAt: "2026-07-25T00:00:00Z",
      },
    ];

    render(<DashboardShell repository={createMemoryRepository(ledgerData)} />);
    await waitFor(() => {
      expect(screen.getByText("旧 USD 账本兼容读取")).not.toBeNull();
    });

    expect(within(getSection("交易列表")).getAllByText("10 USD")).not.toHaveLength(0);
    expectPositionDecimal("BTC", 3, "10");
    expectPositionDecimal("BTC", 6, "12");
    expectPositionDecimal("BTC", 7, "2");
    for (const buttonName of [
      "保存交易",
      "保存价格",
      "刷新 Binance 价格",
    ]) {
      expect(
        (screen.getByRole("button", { name: buttonName }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    }
  });

  it("withholds fee-sensitive UI values for an old foreign-fee fact without hiding market value or heatmap counts", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      {
        id: "foreign-fee-buy",
        occurredAt: "2026-07-20",
        timePrecision: "day",
        type: "buy",
        assetSymbol: "BTC",
        quantity: "1",
        price: "10",
        totalValue: "10",
        currency: "USDT",
        fee: "1",
        feeCurrency: "BNB",
        createdAt: "2026-07-20T00:00:00Z",
        updatedAt: "2026-07-20T00:00:00Z",
      },
    ];
    ledgerData.priceSnapshots = [
      {
        id: "foreign-fee-price",
        assetSymbol: "BTC",
        price: "12",
        currency: "USDT",
        recordedAt: "2026-07-25",
        source: "manual",
        createdAt: "2026-07-25T00:00:00Z",
        updatedAt: "2026-07-25T00:00:00Z",
      },
    ];

    render(<DashboardShell repository={createMemoryRepository(ledgerData)} />);
    await waitFor(() => {
      expect(
        screen.queryByText("正在读取本地账本，完成前不会写入任何数据。"),
      ).toBeNull();
    });

    const tradeSection = getSection("交易列表");
    expect(
      within(tradeSection).getByText(
        "不可可靠计算：BNB 手续费未换算",
      ),
    ).not.toBeNull();
    const positionRow = getPositionRow("BTC");
    expect(within(positionRow).getAllByText("不可可靠计算")).toHaveLength(4);
    expect(within(positionRow).getAllByText("12 USDT")).toHaveLength(2);
    expect(within(getSection("净盈亏摘要")).getAllByText("不可完整计算")).toHaveLength(4);
    expect(screen.getByText(/个成本点因异币手续费无法换算而断开/)).not.toBeNull();
    expect(screen.getByText(/共 365 个自然日、1 笔交易/)).not.toBeNull();
  });

  it("runs golden, price, oversell, and deletion scenarios through the real forms", async () => {
    render(<DashboardShell repository={createMemoryRepository()} />);

    await waitFor(() => {
      expect(
        screen.queryByText("正在读取本地账本，完成前不会写入任何数据。"),
      ).toBeNull();
    });

    await enterGoldenTrades();

    const tradeSection = getSection("交易列表");
    expect(within(tradeSection).getAllByRole("row")).toHaveLength(6);

    expectPositionDecimal("BTC", 1, "0.24265306");
    expectPositionDecimal("BTC", 3, "11");
    expectPositionDecimal("BTC", 4, "0");
    expectPositionDecimal("ETH", 1, "0.400040");
    expectPositionDecimal("ETH", 3, "10");
    expectPositionDecimal("ETH", 4, "0");
    expectPositionDecimal("ADA", 1, "85.3244");
    expectPositionDecimal("ADA", 3, "21.297822152886115445");
    expectPositionDecimal("ADA", 4, "-0.702177847113884555");

    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByLabelText("价格资产", { selector: "select" }),
      "BTC",
    );
    await user.type(screen.getByLabelText("当前价格"), "70000");
    await user.type(screen.getByLabelText("价格日期"), "2026-04-15");
    await user.click(screen.getByRole("button", { name: "保存价格" }));

    expect(screen.getByText("价格已加入账本")).not.toBeNull();
    expectPositionDecimal("BTC", 5, "70000");
    expectPositionDecimal("BTC", 6, "11.4716");
    expectPositionDecimal("BTC", 7, "0.4716");
    expect(screen.getByText(/已估值 1 项，总市值 11.4716 USDT/)).not.toBeNull();
    expect(screen.getByText("未估值资产：ADA、ETH。")).not.toBeNull();
    expect(screen.getByText(/共 365 个自然日、5 笔交易/)).not.toBeNull();

    await fillTradeForm({
      type: "sell",
      assetSymbol: "ADA",
      quantity: "85.3245",
      price: "1",
      totalValue: "85.3245",
      occurredAt: "2026-04-15",
      fee: "0",
    });

    expect(
      screen.getByText("卖出数量超过该时间点的可用持仓"),
    ).not.toBeNull();
    expect(within(tradeSection).getAllByRole("row")).toHaveLength(6);
    expectPositionDecimal("ADA", 1, "85.3244");
    expectPositionDecimal("ADA", 3, "21.297822152886115445");
    expectPositionDecimal("ADA", 4, "-0.702177847113884555");

    const supportedBuyDeleteButton = within(tradeSection).getByRole("button", {
      name: "删除 买入 ADA 2026-04-09",
    });
    await user.click(supportedBuyDeleteButton);
    await user.click(supportedBuyDeleteButton);

    expect(
      within(tradeSection).getByText(
        "无法删除：这笔交易支撑了后续卖出，请先删除依赖它的后续卖出",
      ),
    ).not.toBeNull();
    expect(within(tradeSection).getAllByRole("row")).toHaveLength(6);

    const independentBuyDeleteButton = within(tradeSection).getByRole(
      "button",
      {
        name: "删除 买入 BTC 2026-04-02",
      },
    );
    await user.click(independentBuyDeleteButton);
    await user.click(independentBuyDeleteButton);

    expect(within(tradeSection).getAllByRole("row")).toHaveLength(5);
    expect(within(getSection("资产汇总")).queryByText("BTC")).toBeNull();
    expectPositionDecimal("ETH", 1, "0.400040");
    expectPositionDecimal("ETH", 3, "10");
    expectPositionDecimal("ADA", 1, "85.3244");
    expectPositionDecimal("ADA", 3, "21.297822152886115445");
    expectPositionDecimal("ADA", 4, "-0.702177847113884555");
  });
});

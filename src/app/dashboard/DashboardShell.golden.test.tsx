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
import {
  createLedgerSession,
  INDEXED_DB_LEDGER_CAPABILITIES,
  type LedgerRepository,
} from "@/platform/persistence";
import { sampleTradeDrafts } from "@/test-support";
import { createInitialLedgerData } from "@/core/state";
import { isWithinTolerance } from "@/core/shared";
import type { LedgerClock } from "@/core/shared";
import { DashboardShell as DashboardShellRuntime } from "./DashboardShell";
import {
  closeHoldingsDetails,
  deleteTradeAfterReview,
  goToPage,
  openActivityTable,
  openHoldingsDetails,
} from "./DashboardShell.testHelpers";

const fixedClock: LedgerClock = {
  now: () => new Date("2026-07-25T12:00:00"),
};

function DashboardShell({
  repository,
}: {
  repository: LedgerRepository;
}) {
  // The storage semantics are what the shell defaulted to when these cases
  // rendered it without a session: "indexeddb" with its capabilities.
  return (
    <DashboardShellRuntime
      clock={fixedClock}
      session={createLedgerSession({
        storageKind: "indexeddb",
        repository,
        capabilities: INDEXED_DB_LEDGER_CAPABILITIES,
      })}
    />
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

// The complete holdings table lists, per row: asset, quantity, three custody
// quantities, average cost, remaining cost, realized, latest price, market
// value, unrealized, and cumulative buy outflow. Each cell carries a
// small-screen label before its value, so only the value element is read.
const DETAIL_COLUMN = {
  quantity: 1,
  averageCost: 5,
  costBasis: 6,
  realizedPnl: 7,
  latestPrice: 8,
  marketValue: 9,
  unrealizedPnl: 10,
} as const;

function getHoldingsTable(): HTMLElement {
  return screen.getByRole("table", { name: "完整持仓与现金明细" });
}

function getPositionRow(assetSymbol: string): HTMLElement {
  const row = within(getHoldingsTable())
    .getAllByRole("row")
    .find(
      (candidate) =>
        within(candidate).queryAllByRole("cell")[0]?.lastElementChild
          ?.textContent === assetSymbol,
    );

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
  const text = cells[columnIndex]?.lastElementChild?.textContent?.trim();

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
  ).replaceAll(" ", "");

  expect(isWithinTolerance(actual, expected, "0.0000000001")).toBe(true);
}

function getHomeMetrics(): HTMLElement {
  const metrics = screen
    .getByRole("heading", { name: "当前总资产" })
    .closest<HTMLElement>("[data-home-row]");

  if (!metrics) {
    throw new Error("Home metrics not found");
  }

  return metrics;
}

async function expandActivityRow(index: number) {
  await userEvent.setup().click(
    within(screen.getByRole("table")).getAllByRole("button", {
      name: "详情",
    })[index],
  );
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

  if (screen.queryByRole("heading", { level: 1, name: "记账" }) === null) {
    await goToPage("记账");
  }
  const recordTarget = screen.queryByLabelText("记账对象", {
    selector: "select",
  });
  if (recordTarget) {
    await user.selectOptions(recordTarget, `trade:${input.assetSymbol}`);
  }
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
    expect(screen.getAllByTitle(input.expectedCashImpact)).not.toHaveLength(0);
  }

  await user.click(screen.getByRole("button", { name: "保存交易" }));
  const negativeCashDialog = screen.queryByRole("dialog", {
    name: "确认交易后的负现金",
  });
  if (negativeCashDialog) {
    await user.click(
      within(negativeCashDialog).getByRole("button", {
        name: "确认并保存",
      }),
    );
  }
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
  it("keeps the file status healthy after hydration without an error", async () => {
    render(<DashboardShell repository={createMemoryRepository()} />);

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "加密文件已连接",
      );
    });
    expect(screen.queryByText("文件需要处理")).toBeNull();
  });

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
      expectedCashImpact: "-6505",
    });
    await waitFor(() => {
      expect(screen.getByText("交易已认证保存")).not.toBeNull();
    });
    await fillTradeForm({
      type: "sell",
      assetSymbol: "BTC",
      quantity: "0.04",
      price: "70000",
      totalValue: "2800",
      occurredAt: "2026-07-21",
      fee: "3",
      expectedCashImpact: "2797",
    });
    await waitFor(() => {
      expect(screen.getByText("交易已认证保存")).not.toBeNull();
    });

    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByLabelText("价格资产", { selector: "select" }),
      "BTC",
    );
    await user.type(screen.getByLabelText("当前价格"), "80000");
    await user.clear(screen.getByLabelText("价格日期"));
    await user.type(screen.getByLabelText("价格日期"), "2026-07-25");
    await user.click(screen.getByRole("button", { name: "保存价格" }));

    await openHoldingsDetails();
    expectPositionDecimal("BTC", DETAIL_COLUMN.quantity, "0.06");
    expectPositionDecimal("BTC", DETAIL_COLUMN.averageCost, "65050");
    expectPositionDecimal("BTC", DETAIL_COLUMN.costBasis, "3903");
    expectPositionDecimal("BTC", DETAIL_COLUMN.realizedPnl, "195");
    expectPositionDecimal("BTC", DETAIL_COLUMN.marketValue, "4800");
    expectPositionDecimal("BTC", DETAIL_COLUMN.unrealizedPnl, "897");
    await closeHoldingsDetails();

    const summary = getHomeMetrics();
    for (const value of ["3903", "195", "897"]) {
      expect(within(summary).getByTitle(value)).not.toBeNull();
    }
    // The unified list shows each trade's cash impact in its expanded
    // details, one row at a time: the newer sell first, then the buy.
    const trades = await openActivityTable();
    await expandActivityRow(1);
    expect(within(trades).getAllByTitle("6505")).not.toHaveLength(0);
    expect(within(trades).getAllByTitle("5")).not.toHaveLength(0);
    await expandActivityRow(0);
    expect(within(trades).getAllByTitle("2797")).not.toHaveLength(0);
    expect(within(trades).getAllByTitle("3")).not.toHaveLength(0);
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

    expect(screen.getByText(/个成本点因异币手续费无法换算而断开/)).not.toBeNull();
    await openHoldingsDetails();
    const positionRow = getPositionRow("BTC");
    expect(within(positionRow).getAllByText("不可可靠计算")).toHaveLength(4);
    expect(within(positionRow).getAllByTitle("12")).toHaveLength(2);
    await closeHoldingsDetails();
    const tradeSection = await openActivityTable();
    await expandActivityRow(0);
    expect(
      within(tradeSection).getByText(
        "不可可靠计算：BNB 手续费未换算",
      ),
    ).not.toBeNull();
  });

  it("runs golden, price, oversell, and deletion scenarios through the real forms", async () => {
    render(<DashboardShell repository={createMemoryRepository()} />);

    await waitFor(() => {
      expect(
        screen.queryByText("正在读取本地账本，完成前不会写入任何数据。"),
      ).toBeNull();
    });

    await enterGoldenTrades();

    expect(within(await openActivityTable()).getAllByRole("row")).toHaveLength(6);

    await openHoldingsDetails();
    expectPositionDecimal("BTC", DETAIL_COLUMN.quantity, "2");
    expectPositionDecimal("BTC", DETAIL_COLUMN.costBasis, "20");
    expectPositionDecimal("BTC", DETAIL_COLUMN.realizedPnl, "0");
    expectPositionDecimal("ETH", DETAIL_COLUMN.quantity, "3");
    expectPositionDecimal("ETH", DETAIL_COLUMN.costBasis, "24");
    expectPositionDecimal("ETH", DETAIL_COLUMN.realizedPnl, "0");
    expectPositionDecimal("ADA", DETAIL_COLUMN.quantity, "15");
    expectPositionDecimal("ADA", DETAIL_COLUMN.costBasis, "30");
    expectPositionDecimal("ADA", DETAIL_COLUMN.realizedPnl, "30");
    await closeHoldingsDetails();

    const user = userEvent.setup();
    await goToPage("记账");
    await user.selectOptions(
      screen.getByLabelText("价格资产", { selector: "select" }),
      "BTC",
    );
    await user.type(screen.getByLabelText("当前价格"), "15");
    await user.clear(screen.getByLabelText("价格日期"));
    await user.type(screen.getByLabelText("价格日期"), "2026-01-06");
    await user.click(screen.getByRole("button", { name: "保存价格" }));

    await waitFor(() => {
      expect(screen.getByText("价格已认证保存")).not.toBeNull();
    });
    await openHoldingsDetails();
    expectPositionDecimal("BTC", DETAIL_COLUMN.latestPrice, "15");
    expectPositionDecimal("BTC", DETAIL_COLUMN.marketValue, "30");
    expectPositionDecimal("BTC", DETAIL_COLUMN.unrealizedPnl, "10");
    await closeHoldingsDetails();
    expect(
      screen
        .getAllByTitle("-14")
        .find((element) =>
          element.closest("p")?.textContent?.includes("几何分配"),
        )
        ?.closest("p")?.textContent,
    ).toContain(
      "几何分配 1 项；净总资产 -14.00 USDT",
    );
    expect(screen.getByTitle("44").closest("p")?.textContent).toBe(
      "现金缺口 44.00 USDT；负现金不绘制为正扇区。",
    );
    expect(screen.getByText("未估值资产：ADA、ETH。")).not.toBeNull();

    await fillTradeForm({
      type: "sell",
      assetSymbol: "ADA",
      quantity: "16",
      price: "1",
      totalValue: "16",
      occurredAt: "2026-01-06",
      fee: "0",
    });

    expect(
      screen.getByText("卖出数量超过该时间点的可用持仓"),
    ).not.toBeNull();
    const tradeSection = await openActivityTable();
    expect(within(tradeSection).getAllByRole("row")).toHaveLength(6);
    await openHoldingsDetails();
    expectPositionDecimal("ADA", DETAIL_COLUMN.quantity, "15");
    expectPositionDecimal("ADA", DETAIL_COLUMN.costBasis, "30");
    expectPositionDecimal("ADA", DETAIL_COLUMN.realizedPnl, "30");
    await closeHoldingsDetails();
    const activityTable = await openActivityTable();

    const supportedBuyDeleteButton = within(activityTable).getByRole("button", {
      name: "删除 买入 ADA 2026-01-04",
    });
    await user.click(supportedBuyDeleteButton);
    await user.click(supportedBuyDeleteButton);

    expect(
      screen.getByText(
        "无法删除：这笔交易支撑了后续卖出，请先删除依赖它的后续卖出",
      ),
    ).not.toBeNull();
    expect(within(activityTable).getAllByRole("row")).toHaveLength(6);

    deleteTradeAfterReview("删除 买入 BTC 2026-01-01");

    await waitFor(() => {
      expect(
        within(screen.getByRole("table")).getAllByRole("row"),
      ).toHaveLength(5);
    });
    await openHoldingsDetails();
    expect(within(getHoldingsTable()).queryByText("BTC")).toBeNull();
    expectPositionDecimal("ETH", DETAIL_COLUMN.quantity, "3");
    expectPositionDecimal("ETH", DETAIL_COLUMN.costBasis, "24");
    expectPositionDecimal("ADA", DETAIL_COLUMN.quantity, "15");
    expectPositionDecimal("ADA", DETAIL_COLUMN.costBasis, "30");
    expectPositionDecimal("ADA", DETAIL_COLUMN.realizedPnl, "30");
  });
});

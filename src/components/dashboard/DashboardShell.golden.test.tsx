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

import type { LedgerData } from "../../models";
import type { LedgerRepository } from "../../repositories/ledgerRepository";
import { sampleTradeDrafts } from "../../test/fixtures";
import { isWithinTolerance } from "../../utils/decimalMath";
import { DashboardShell } from "./DashboardShell";

afterEach(() => {
  cleanup();
});

function createMemoryRepository(): LedgerRepository {
  let storedData: LedgerData | null = null;

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
    /\s+USD$/,
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
    ["总金额", input.totalValue],
    ["日期", input.occurredAt],
    ["手续费", input.fee],
  ] as const;

  for (const [label, value] of fields) {
    const field = screen.getByLabelText(label);
    await user.clear(field);
    await user.type(field, value);
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

    expect(screen.getByText("交易已加入账本")).not.toBeNull();
  }
}

describe("DashboardShell golden UI acceptance", () => {
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

    expectPositionDecimal("BTC", 1, "0.00016388");
    expectPositionDecimal("BTC", 3, "11");
    expectPositionDecimal("BTC", 4, "0");
    expectPositionDecimal("ETH", 1, "0.004854");
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

    await user.click(
      within(tradeSection).getByRole("button", {
        name: "删除 买入 ADA 2026-04-09",
      }),
    );

    expect(
      within(tradeSection).getByText(
        "无法删除：这笔交易支撑了后续卖出，删除后持仓时间线会失效",
      ),
    ).not.toBeNull();
    expect(within(tradeSection).getAllByRole("row")).toHaveLength(6);

    await user.click(
      within(tradeSection).getByRole("button", {
        name: "删除 买入 BTC 2026-04-02",
      }),
    );

    expect(within(tradeSection).getAllByRole("row")).toHaveLength(5);
    expect(within(getSection("资产汇总")).queryByText("BTC")).toBeNull();
    expectPositionDecimal("ETH", 1, "0.004854");
    expectPositionDecimal("ETH", 3, "10");
    expectPositionDecimal("ADA", 1, "85.3244");
    expectPositionDecimal("ADA", 3, "21.297822152886115445");
    expectPositionDecimal("ADA", 4, "-0.702177847113884555");
  });
});

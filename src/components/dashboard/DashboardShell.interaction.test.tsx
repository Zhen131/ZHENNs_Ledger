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
import { createInitialLedgerData } from "../../state/initialLedgerData";
import { createSimpleTrade } from "../../test/fixtures";
import { DashboardShell } from "./DashboardShell";

afterEach(() => {
  cleanup();
});

function getSection(title: string): HTMLElement {
  const section = screen.getByRole("heading", { name: title }).closest("section");

  if (!section) {
    throw new Error(`Section not found: ${title}`);
  }

  return section;
}

function createMemoryRepository(
  initialData: LedgerData | null = null,
): LedgerRepository {
  let storedData =
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

async function renderDashboard(
  repository: LedgerRepository = createMemoryRepository(),
) {
  render(<DashboardShell repository={repository} />);

  await waitFor(() => {
    expect(
      screen.queryByText("正在读取本地账本，完成前不会写入任何数据。"),
    ).toBeNull();
  });
}

async function fillBuyTrade() {
  const user = userEvent.setup();

  await user.selectOptions(
    screen.getByLabelText("类型", { selector: "select" }),
    "buy",
  );
  await user.selectOptions(
    screen.getByLabelText("资产", { selector: "select" }),
    "BTC",
  );
  await user.type(screen.getByLabelText("数量"), "0.001");
  await user.type(screen.getByLabelText("成交均价"), "70000");
  await user.type(screen.getByLabelText("总金额"), "70");
  await user.type(screen.getByLabelText("日期"), "2026-07-14");

  return user;
}

async function createTrade(input: {
  type: "buy" | "sell";
  quantity: string;
  price: string;
  totalValue: string;
  occurredAt: string;
}) {
  const user = userEvent.setup();

  await user.selectOptions(
    screen.getByLabelText("类型", { selector: "select" }),
    input.type,
  );
  await user.type(screen.getByLabelText("数量"), input.quantity);
  await user.type(screen.getByLabelText("成交均价"), input.price);
  await user.type(screen.getByLabelText("总金额"), input.totalValue);

  const occurredAtInput = screen.getByLabelText("日期");
  if ((occurredAtInput as HTMLInputElement).value !== input.occurredAt) {
    await user.clear(occurredAtInput);
    await user.type(occurredAtInput, input.occurredAt);
  }

  await user.click(screen.getByRole("button", { name: "保存交易" }));
  return user;
}

describe("DashboardShell trade interactions", () => {
  it("creates a validated buy and updates both the trade list and positions", async () => {
    await renderDashboard();
    const user = await fillBuyTrade();

    await user.click(screen.getByRole("button", { name: "保存交易" }));

    expect(screen.getByText("交易已保存")).not.toBeNull();

    const tradeSection = getSection("交易列表");
    expect(within(tradeSection).getByText("BTC")).not.toBeNull();
    expect(within(tradeSection).getByText("买入")).not.toBeNull();
    expect(within(tradeSection).getByText("70 USD")).not.toBeNull();

    const positionSection = getSection("资产汇总");
    expect(within(positionSection).getByText("BTC")).not.toBeNull();
    expect(within(positionSection).getByText("0.001")).not.toBeNull();
    expect(within(positionSection).getByText("70000 USD")).not.toBeNull();
  });

  it("shows validator feedback and keeps the ledger unchanged for invalid input", async () => {
    await renderDashboard();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("数量"), "0.001");
    await user.type(screen.getByLabelText("成交均价"), "70000");
    await user.type(screen.getByLabelText("总金额"), "10");
    await user.type(screen.getByLabelText("日期"), "2026-07-14");
    await user.click(screen.getByRole("button", { name: "保存交易" }));

    expect(
      screen.getByText("总金额与数量 × 成交均价不一致"),
    ).not.toBeNull();
    expect(
      within(getSection("交易列表")).getByText(
        "暂无交易。添加交易后，这里会自动显示。",
      ),
    ).not.toBeNull();
    expect(
      within(getSection("资产汇总")).getByText(
        "暂无持仓。添加交易后，这里会自动汇总。",
      ),
    ).not.toBeNull();
  });

  it("blocks deletion when removing a buy would invalidate a later sell", async () => {
    await renderDashboard();

    await createTrade({
      type: "buy",
      quantity: "10",
      price: "1",
      totalValue: "10",
      occurredAt: "2026-07-14",
    });
    const user = await createTrade({
      type: "sell",
      quantity: "5",
      price: "1",
      totalValue: "5",
      occurredAt: "2026-07-15",
    });

    const tradeSection = getSection("交易列表");
    const rowsBefore = within(tradeSection).getAllByRole("row");
    expect(rowsBefore).toHaveLength(3);

    await user.click(
      within(tradeSection).getByRole("button", {
        name: "删除 买入 BTC 2026-07-14",
      }),
    );

    expect(
      within(tradeSection).getByText(
        "无法删除：这笔交易支撑了后续卖出，删除后持仓时间线会失效",
      ),
    ).not.toBeNull();
    expect(within(tradeSection).getAllByRole("row")).toHaveLength(3);
    expect(within(getSection("资产汇总")).getByText("5")).not.toBeNull();
  });

  it("saves a manual price and updates market value and unrealized PnL", async () => {
    await renderDashboard();
    const user = await fillBuyTrade();
    await user.click(screen.getByRole("button", { name: "保存交易" }));

    await user.type(screen.getByLabelText("当前价格"), "80000");
    await user.type(screen.getByLabelText("价格日期"), "2026-07-16");
    await user.click(screen.getByRole("button", { name: "保存价格" }));

    expect(screen.getByText("价格已保存")).not.toBeNull();

    const positionSection = getSection("资产汇总");
    expect(within(positionSection).getByText("80000 USD")).not.toBeNull();
    expect(within(positionSection).getByText("80 USD")).not.toBeNull();
    expect(within(positionSection).getByText("10 USD")).not.toBeNull();
  });

  it("hydrates saved LedgerData without overwriting it with initial state", async () => {
    const savedLedger = {
      ...createInitialLedgerData(),
      trades: [
        createSimpleTrade(
          "trade-hydrated",
          "buy",
          "ETH",
          "2",
          "2026-07-10",
        ),
      ],
    };
    const repository = createMemoryRepository(savedLedger);

    await renderDashboard(repository);

    const tradeSection = getSection("交易列表");
    expect(within(tradeSection).getByText("ETH")).not.toBeNull();
    expect(within(tradeSection).getByText("2")).not.toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
  });
});

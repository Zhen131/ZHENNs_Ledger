// @vitest-environment jsdom

import {
  act,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade } from "@/test-support";
import { deleteButton, renderWorkspace } from "./TransactionsWorkspace.testHelpers";

describe("TransactionsWorkspace unified cash activity", () => {
  it("filters USDT to cash facts, exposes adjustment fields, and protects cash deletion with the latest deficit", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.cashEvents = [
      {
        id: "cash-deposit",
        occurredAt: "2026-07-20",
        timePrecision: "day",
        type: "deposit",
        currency: "USDT",
        amount: "10",
        note: "虚构入金",
        createdAt: "2026-07-20T00:00:00Z",
        updatedAt: "2026-07-20T00:00:00Z",
      },
      {
        id: "cash-adjustment",
        occurredAt: "2026-07-21",
        timePrecision: "day",
        type: "balance-adjustment",
        currency: "USDT",
        balanceBefore: "9",
        targetBalance: "9",
        adjustmentAmount: "0",
        createdAt: "2026-07-21T00:00:00Z",
        updatedAt: "2026-07-21T00:00:00Z",
      },
    ];
    ledgerData.trades = [
      createUsdtSimpleTrade("btc-buy", "buy", "BTC", "1", "2026-07-20"),
    ];
    const onDeleteCashEvent = vi.fn(() => "applied" as const);
    renderWorkspace({ ledgerData, onDeleteCashEvent });
    const table = screen.getByRole("table");

    fireEvent.change(screen.getByLabelText("资产筛选"), {
      target: { value: "USDT" },
    });
    expect(within(table).queryByText("BTC")).toBeNull();
    expect(within(table).getByText("入金")).not.toBeNull();
    expect(within(table).getByText("余额校准")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("类型筛选"), {
      target: { value: "balance-adjustment" },
    });
    expect(within(table).queryByText("入金")).toBeNull();
    fireEvent.click(within(table).getByRole("button", { name: "详情" }));
    expect(within(table).getByText("校准前余额")).not.toBeNull();
    expect(within(table).getByText("目标余额")).not.toBeNull();
    expect(within(table).getByText("本次差额")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    const deleteLabel = "删除 入金 现金 USDT 2026-07-20";
    fireEvent.click(deleteButton(deleteLabel));
    fireEvent.click(deleteButton(deleteLabel));
    act(() => vi.advanceTimersByTime(5_000));

    const dialog = screen.getByRole("dialog", {
      name: "确认删除现金事实后的负现金",
    });
    expect(dialog.textContent).toContain("保存后余额-1.00 USDT");
    expect(dialog.textContent).toContain("现金缺口1.00 USDT");
    expect(onDeleteCashEvent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认并删除" }));
    expect(onDeleteCashEvent).toHaveBeenCalledOnce();
    expect(onDeleteCashEvent).toHaveBeenCalledWith("cash-deposit");
  });

  it("uses one responsive activity table without a fixed mobile minimum width", () => {
    renderWorkspace();
    const table = screen.getByRole("table");
    expect(table.className).toContain("block w-full");
    expect(table.className).toContain("sm:table");
    expect(table.className).not.toContain("min-w-[820px]");
  });
});

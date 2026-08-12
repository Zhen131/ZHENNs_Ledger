// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Trade } from "@/core/models";
import { createUsdtSimpleTrade } from "@/test-support";
import { TradeTable } from "./TradeTable";

afterEach(cleanup);

const trade: Trade = {
  ...createUsdtSimpleTrade("trade-detail", "buy", "BTC", "2", "2026-07-20"),
  price: "10",
  totalValue: "20",
  fee: "1",
  platform: "Binance",
  feeRuleId: "rule-btc",
  note: "long term",
};

function WorkspaceTable() {
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);
  return (
    <TradeTable
      deleteState={{
        armedTradeId: null,
        pendingTradeId: null,
        pendingPhase: null,
        remainingMs: 0,
      }}
      expandedTradeId={expandedTradeId}
      onArmDelete={vi.fn()}
      onCancelDelete={vi.fn()}
      onConfirmDelete={vi.fn()}
      onExpandedTradeIdChange={setExpandedTradeId}
      onUndoDelete={vi.fn()}
      todayKey="2026-07-25"
      trades={[trade]}
      variant="workspace"
    />
  );
}

describe("workspace TradeTable", () => {
  it("keeps the main row compact and expands factual details without an edit action", async () => {
    render(<WorkspaceTable />);
    const user = userEvent.setup();
    const table = screen.getByRole("table");

    expect(within(table).getByText("20 USDT")).not.toBeNull();
    expect(within(table).queryByText("Binance")).toBeNull();
    expect(screen.queryByRole("button", { name: /编辑/ })).toBeNull();

    const detailButton = screen.getByRole("button", { name: "详情" });
    await user.click(detailButton);
    expect(within(table).getByText("Binance")).not.toBeNull();
    expect(within(table).getByText("FeeRule rule-btc")).not.toBeNull();
    expect(within(table).getByText("21 USDT · 买入总支出")).not.toBeNull();
    expect(within(table).getByText("long term")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(table).queryByText("Binance")).toBeNull();
  });

  it("expands from the row and disables detail interaction for a countdown row", async () => {
    const onExpandedTradeIdChange = vi.fn();
    const view = render(
      <TradeTable
        deleteState={{
          armedTradeId: null,
          pendingTradeId: null,
          pendingPhase: null,
          remainingMs: 0,
        }}
        expandedTradeId={null}
        onArmDelete={vi.fn()}
        onCancelDelete={vi.fn()}
        onConfirmDelete={vi.fn()}
        onExpandedTradeIdChange={onExpandedTradeIdChange}
        onUndoDelete={vi.fn()}
        trades={[trade]}
        variant="workspace"
      />,
    );
    await userEvent.setup().click(screen.getByText("20 USDT").closest("tr")!);
    expect(onExpandedTradeIdChange).toHaveBeenCalledWith("trade-detail");

    view.rerender(
      <TradeTable
        deleteState={{
          armedTradeId: null,
          pendingTradeId: "trade-detail",
          pendingPhase: "countdown",
          remainingMs: 4_000,
        }}
        expandedTradeId={null}
        onArmDelete={vi.fn()}
        onCancelDelete={vi.fn()}
        onConfirmDelete={vi.fn()}
        onExpandedTradeIdChange={onExpandedTradeIdChange}
        onUndoDelete={vi.fn()}
        trades={[trade]}
        variant="workspace"
      />,
    );
    expect(screen.queryByRole("button", { name: "详情" })).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "撤回删除 买入 BTC 2026-07-20",
      }),
    ).not.toBeNull();
  });
});

// @vitest-environment jsdom

import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Trade } from "@/core/models";
import { createUsdtSimpleTrade } from "@/test-support";
import { TradeTable } from "./TradeTable";

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalScrollIntoView) {
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      originalScrollIntoView,
    );
  } else {
    delete (HTMLElement.prototype as { scrollIntoView?: unknown })
      .scrollIntoView;
  }
});

const trade: Trade = {
  ...createUsdtSimpleTrade("trade-detail", "buy", "BTC", "2", "2026-07-20"),
  price: "10",
  totalValue: "20",
  fee: "1",
  platform: "Binance",
  feeRuleId: "rule-btc",
  note: "long term",
};

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

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

  it("smoothly locates the first row and flashes every main row from that date twice", () => {
    vi.useFakeTimers();
    stubReducedMotion(false);
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const onLocateComplete = vi.fn();
    const trades = [
      createUsdtSimpleTrade("newer", "buy", "ETH", "1", "2026-07-21"),
      trade,
      createUsdtSimpleTrade("same-date", "sell", "BTC", "1", "2026-07-20"),
      createUsdtSimpleTrade("older", "buy", "ADA", "1", "2026-07-19"),
    ];

    render(
      <TradeTable
        locateRequest={{ date: "2026-07-20", requestId: 7 }}
        onLocateComplete={onLocateComplete}
        trades={trades}
        variant="workspace"
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    expect(
      (scrollIntoView.mock.instances[0] as HTMLElement).dataset.tradeId,
    ).toBe("trade-detail");

    act(() => document.dispatchEvent(new Event("scrollend")));
    const locatedRows = document.querySelectorAll(
      '[data-locate-highlight="flashing"]',
    );
    expect(locatedRows).toHaveLength(2);
    expect(
      Array.from(locatedRows).map((row) => row.getAttribute("data-trade-id")),
    ).toEqual(["trade-detail", "same-date"]);
    expect(document.querySelector('[data-trade-id="newer"]')?.getAttribute(
      "data-locate-highlight",
    )).toBeNull();

    act(() => vi.advanceTimersByTime(800));
    expect(document.querySelector("[data-locate-highlight]")).toBeNull();
    expect(onLocateComplete).toHaveBeenCalledWith(7, "found");
  });

  it("uses immediate positioning and a static group highlight for reduced motion", () => {
    vi.useFakeTimers();
    stubReducedMotion(true);
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const onLocateComplete = vi.fn();
    const sameDateTrade = createUsdtSimpleTrade(
      "same-date",
      "sell",
      "BTC",
      "1",
      "2026-07-20",
    );

    render(
      <TradeTable
        locateRequest={{ date: "2026-07-20", requestId: 8 }}
        onLocateComplete={onLocateComplete}
        trades={[trade, sameDateTrade]}
        variant="workspace"
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
    });
    expect(
      document.querySelectorAll('[data-locate-highlight="static"]'),
    ).toHaveLength(2);
    expect(
      document.querySelector(".ledger-trade-locate-flash"),
    ).toBeNull();

    act(() => vi.advanceTimersByTime(1_200));
    expect(document.querySelector("[data-locate-highlight]")).toBeNull();
    expect(onLocateComplete).toHaveBeenCalledWith(8, "found");
  });

  it("reports a missing location target without scrolling or highlighting", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const onLocateComplete = vi.fn();

    render(
      <TradeTable
        locateRequest={{ date: "2026-07-18", requestId: 9 }}
        onLocateComplete={onLocateComplete}
        trades={[trade]}
        variant="workspace"
      />,
    );

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelector("[data-locate-highlight]")).toBeNull();
    expect(onLocateComplete).toHaveBeenCalledWith(9, "missing");
  });

  it("cancels pending location timers when the request is cleared", () => {
    vi.useFakeTimers();
    stubReducedMotion(false);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    const onLocateComplete = vi.fn();
    const trades = [trade];
    const view = render(
      <TradeTable
        locateRequest={{ date: "2026-07-20", requestId: 10 }}
        onLocateComplete={onLocateComplete}
        trades={trades}
        variant="workspace"
      />,
    );
    act(() => document.dispatchEvent(new Event("scrollend")));
    expect(
      document.querySelector('[data-locate-highlight="flashing"]'),
    ).not.toBeNull();

    view.rerender(
      <TradeTable
        locateRequest={null}
        onLocateComplete={onLocateComplete}
        trades={trades}
        variant="workspace"
      />,
    );
    expect(document.querySelector("[data-locate-highlight]")).toBeNull();
    act(() => vi.advanceTimersByTime(1_000));
    expect(onLocateComplete).not.toHaveBeenCalled();
  });
});

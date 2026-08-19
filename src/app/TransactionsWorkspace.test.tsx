// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LedgerData } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade } from "@/test-support";
import { TransactionsWorkspace } from "./TransactionsWorkspace";

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-25T12:00:00Z"));
});

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

function createLedger(): LedgerData {
  const ledgerData = createInitialLedgerData();
  ledgerData.trades = [
    createUsdtSimpleTrade("btc-old", "buy", "BTC", "1", "2025-07-20"),
    createUsdtSimpleTrade("eth-recent", "buy", "ETH", "2", "2026-07-22"),
    createUsdtSimpleTrade("btc-today", "sell", "BTC", "0.5", "2026-07-25"),
    createUsdtSimpleTrade("ada-today", "buy", "ADA", "3", "2026-07-25"),
  ];
  return ledgerData;
}

function createNegativeDeletionLedger(): LedgerData {
  const ledgerData = createInitialLedgerData();
  ledgerData.cashEvents = [
    {
      id: "cash-buffer",
      occurredAt: "2026-07-19",
      timePrecision: "day",
      type: "deposit",
      currency: "USDT",
      amount: "0.5",
      createdAt: "2026-07-19T12:00:00.000Z",
      updatedAt: "2026-07-19T12:00:00.000Z",
    },
  ];
  ledgerData.trades = [
    createUsdtSimpleTrade("cash-buy", "buy", "BTC", "1", "2026-07-20"),
    createUsdtSimpleTrade("cash-sell", "sell", "BTC", "1", "2026-07-21"),
  ];
  return ledgerData;
}

function renderWorkspace({
  active = true,
  ledgerData = createLedger(),
  intent = null,
  mutationVersion = 0,
  persistedVersion = 0,
  persistenceStatus = "saved" as const,
  onDeleteTrade = vi.fn(() => "applied" as const),
  onDeleteCashEvent = vi.fn(() => "applied" as const),
}: {
  active?: boolean;
  ledgerData?: LedgerData;
  intent?: Parameters<typeof TransactionsWorkspace>[0]["intent"];
  mutationVersion?: number;
  persistedVersion?: number;
  persistenceStatus?: Parameters<
    typeof TransactionsWorkspace
  >[0]["persistenceStatus"];
  onDeleteTrade?: Parameters<
    typeof TransactionsWorkspace
  >[0]["onDeleteTrade"];
  onDeleteCashEvent?: Parameters<
    typeof TransactionsWorkspace
  >[0]["onDeleteCashEvent"];
} = {}) {
  return render(
    <TransactionsWorkspace
      active={active}
      intent={intent}
      isWritable
      ledgerData={ledgerData}
      ledgerEpoch={1}
      mutationVersion={mutationVersion}
      onDeleteCashEvent={onDeleteCashEvent}
      onDeleteTrade={onDeleteTrade}
      onIntentConsumed={vi.fn()}
      persistedVersion={persistedVersion}
      persistenceStatus={persistenceStatus}
      todayKey="2026-07-25"
    />,
  );
}

function deleteButton(tradeName: string) {
  return screen.getByRole("button", { name: tradeName });
}

describe("TransactionsWorkspace filters and intent", () => {
  it("combines session filters, sorts newest first stably, and clears without mutating the ledger", async () => {
    const ledgerData = createLedger();
    const original = structuredClone(ledgerData.trades);
    renderWorkspace({ ledgerData });
    const table = screen.getByRole("table");

    const initialRows = within(table).getAllByRole("row").slice(1);
    expect(initialRows[0]?.textContent).toContain("BTC");
    expect(initialRows[1]?.textContent).toContain("ADA");

    fireEvent.change(screen.getByLabelText("时间范围"), {
      target: { value: "7d" },
    });
    fireEvent.change(screen.getByLabelText("资产筛选"), {
      target: { value: "BTC" },
    });
    fireEvent.change(screen.getByLabelText("类型筛选"), {
      target: { value: "sell" },
    });
    expect(within(table).getByText("0.5 USDT")).not.toBeNull();
    expect(within(table).queryByText("ETH")).toBeNull();
    expect(
      screen.getByText(
        "时间：最近 7 天｜日期：全部｜资产：BTC｜类型：卖出",
      ),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(ledgerData.trades).toEqual(original);
  });

  it("consumes accurate date and trade intents, then resets after leaving", async () => {
    const ledgerData = createLedger();
    const onIntentConsumed = vi.fn();
    const view = render(
      <TransactionsWorkspace
        active
        intent={{
          page: "transactions",
          filterDate: "2026-07-22",
          expandTradeId: "eth-recent",
        }}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={0}
        onDeleteTrade={vi.fn(() => "applied" as const)}
        onIntentConsumed={onIntentConsumed}
        persistedVersion={0}
        persistenceStatus="saved"
        todayKey="2026-07-25"
      />,
    );

    expect(screen.getByText(/日期：2026-07-22/)).not.toBeNull();
    expect(within(screen.getByRole("table")).getByText("2")).not.toBeNull();
    expect(within(screen.getByRole("table")).queryByText("ADA")).toBeNull();
    expect(onIntentConsumed).toHaveBeenCalledOnce();

    view.rerender(
      <TransactionsWorkspace
        active={false}
        intent={null}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={0}
        onDeleteTrade={vi.fn(() => "applied" as const)}
        onIntentConsumed={onIntentConsumed}
        persistedVersion={0}
        persistenceStatus="saved"
        todayKey="2026-07-25"
      />,
    );
    view.rerender(
      <TransactionsWorkspace
        active
        intent={null}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={0}
        onDeleteTrade={vi.fn(() => "applied" as const)}
        onIntentConsumed={onIntentConsumed}
        persistedVersion={0}
        persistenceStatus="saved"
        todayKey="2026-07-25"
      />,
    );
    expect(screen.getByText(/日期：全部/)).not.toBeNull();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(5);
  });

  it("clears every filter, keeps the full list, and highlights every row on a located date", () => {
    const ledgerData = createLedger();
    const onIntentConsumed = vi.fn();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    const view = render(
      <TransactionsWorkspace
        active
        intent={null}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={0}
        onDeleteTrade={vi.fn(() => "applied" as const)}
        onIntentConsumed={onIntentConsumed}
        persistedVersion={0}
        persistenceStatus="saved"
        todayKey="2026-07-25"
      />,
    );

    fireEvent.change(screen.getByLabelText("时间范围"), {
      target: { value: "7d" },
    });
    fireEvent.change(screen.getByLabelText("资产筛选"), {
      target: { value: "ETH" },
    });
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);

    view.rerender(
      <TransactionsWorkspace
        active
        intent={{ page: "transactions", locateDate: "2026-07-25" }}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={0}
        onDeleteTrade={vi.fn(() => "applied" as const)}
        onIntentConsumed={onIntentConsumed}
        persistedVersion={0}
        persistenceStatus="saved"
        todayKey="2026-07-25"
      />,
    );

    expect(screen.getByText(/时间：全部｜日期：全部｜资产：全部｜类型：全部/)).not.toBeNull();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(5);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });

    act(() => document.dispatchEvent(new Event("scrollend")));
    const locatedRows = document.querySelectorAll(
      '[data-locate-highlight="flashing"]',
    );
    expect(locatedRows).toHaveLength(2);
    expect(
      Array.from(locatedRows).every(
        (row) => row.getAttribute("data-trade-date") === "2026-07-25",
      ),
    ).toBe(true);

    act(() => vi.advanceTimersByTime(800));
    expect(document.querySelector("[data-locate-highlight]")).toBeNull();
    expect(onIntentConsumed).toHaveBeenCalledOnce();
  });

  it("keeps the full list and reports a visible message when a located date disappears", () => {
    const ledgerData = createLedger();
    renderWorkspace({
      ledgerData,
      intent: {
        page: "transactions",
        locateDate: "2026-07-21",
      },
    });

    expect(
      screen.getByText("该日期的交易已发生变化，已显示完整交易列表"),
    ).not.toBeNull();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(5);
    expect(screen.getByText(/日期：全部/)).not.toBeNull();
  });
});

describe("TransactionsWorkspace delayed deletion", () => {
  it("does zero mutation through 4999ms and dispatches only after the 5000ms final review", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      createUsdtSimpleTrade("safe-buy", "buy", "BTC", "1", "2026-07-20"),
    ];
    const onDeleteTrade = vi.fn(() => "applied" as const);
    renderWorkspace({ ledgerData, onDeleteTrade });
    const buttonName = "删除 买入 BTC 2026-07-20";

    fireEvent.click(deleteButton(buttonName));
    expect(onDeleteTrade).not.toHaveBeenCalled();
    fireEvent.click(deleteButton(buttonName));
    expect(onDeleteTrade).not.toHaveBeenCalled();

    vi.advanceTimersByTime(4_999);
    expect(onDeleteTrade).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDeleteTrade).toHaveBeenCalledOnce();
    expect(onDeleteTrade).toHaveBeenCalledWith("safe-buy");
    expect(screen.queryByText("交易已删除")).toBeNull();
  });

  it("undo, page leave, visibility loss, and unmount all cancel with zero mutation", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      createUsdtSimpleTrade("safe-buy", "buy", "BTC", "1", "2026-07-20"),
    ];
    const onDeleteTrade = vi.fn(() => "applied" as const);
    const view = renderWorkspace({ ledgerData, onDeleteTrade });
    const buttonName = "删除 买入 BTC 2026-07-20";

    fireEvent.click(deleteButton(buttonName));
    fireEvent.click(deleteButton(buttonName));
    fireEvent.click(
      screen.getByRole("button", { name: `撤回${buttonName}` }),
    );
    act(() => vi.advanceTimersByTime(5_000));
    expect(onDeleteTrade).not.toHaveBeenCalled();

    fireEvent.click(deleteButton(buttonName));
    fireEvent.click(deleteButton(buttonName));
    view.rerender(
      <TransactionsWorkspace
        active={false}
        intent={null}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={0}
        onDeleteTrade={onDeleteTrade}
        onIntentConsumed={vi.fn()}
        persistedVersion={0}
        persistenceStatus="saved"
        todayKey="2026-07-25"
      />,
    );
    act(() => vi.advanceTimersByTime(5_000));
    expect(onDeleteTrade).not.toHaveBeenCalled();

    view.rerender(
      <TransactionsWorkspace
        active
        intent={null}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={0}
        onDeleteTrade={onDeleteTrade}
        onIntentConsumed={vi.fn()}
        persistedVersion={0}
        persistenceStatus="saved"
        todayKey="2026-07-25"
      />,
    );
    fireEvent.click(deleteButton(buttonName));
    fireEvent.click(deleteButton(buttonName));
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    fireEvent(document, new Event("visibilitychange"));
    act(() => vi.advanceTimersByTime(5_000));
    expect(onDeleteTrade).not.toHaveBeenCalled();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });

    fireEvent.click(deleteButton(buttonName));
    fireEvent.click(deleteButton(buttonName));
    view.unmount();
    act(() => vi.advanceTimersByTime(5_000));
    expect(onDeleteTrade).not.toHaveBeenCalled();
  });

  it("cancels the previous countdown before arming a second trade", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.cashEvents = [
      {
        id: "cash-cover",
        occurredAt: "2026-07-19",
        timePrecision: "day",
        type: "deposit",
        currency: "USDT",
        amount: "10",
        createdAt: "2026-07-19T12:00:00.000Z",
        updatedAt: "2026-07-19T12:00:00.000Z",
      },
    ];
    ledgerData.trades = [
      createUsdtSimpleTrade("safe-btc", "buy", "BTC", "1", "2026-07-20"),
      createUsdtSimpleTrade("safe-eth", "buy", "ETH", "1", "2026-07-21"),
    ];
    const onDeleteTrade = vi.fn(() => "applied" as const);
    renderWorkspace({ ledgerData, onDeleteTrade });
    const btcButton = "删除 买入 BTC 2026-07-20";
    const ethButton = "删除 买入 ETH 2026-07-21";

    fireEvent.click(deleteButton(btcButton));
    fireEvent.click(deleteButton(btcButton));
    expect(
      screen.getByRole("button", { name: `撤回${btcButton}` }),
    ).not.toBeNull();

    fireEvent.click(deleteButton(ethButton));
    expect(
      screen.queryByRole("button", { name: `撤回${btcButton}` }),
    ).toBeNull();
    expect(deleteButton(ethButton).textContent).toBe("再次点击删除");
    fireEvent.click(deleteButton(ethButton));
    act(() => vi.advanceTimersByTime(5_000));

    expect(onDeleteTrade).toHaveBeenCalledOnce();
    expect(onDeleteTrade).toHaveBeenCalledWith("safe-eth");
  });

  it("rejects dependent buys immediately and a newly unsafe timeline at final review", async () => {
    const buy = createUsdtSimpleTrade("supporting-buy", "buy", "BTC", "1", "2026-07-20");
    const sell = createUsdtSimpleTrade("dependent-sell", "sell", "BTC", "1", "2026-07-21");
    const dependentLedger = createInitialLedgerData();
    dependentLedger.trades = [buy, sell];
    const onDeleteTrade = vi.fn(() => "applied" as const);
    const view = renderWorkspace({ ledgerData: dependentLedger, onDeleteTrade });
    const buttonName = "删除 买入 BTC 2026-07-20";

    fireEvent.click(deleteButton(buttonName));
    fireEvent.click(deleteButton(buttonName));
    expect(
      screen.getByText(
        "无法删除：这笔交易支撑了后续卖出，请先删除依赖它的后续卖出",
      ),
    ).not.toBeNull();
    expect(onDeleteTrade).not.toHaveBeenCalled();

    const initiallySafe = createInitialLedgerData();
    initiallySafe.trades = [buy];
    view.rerender(
      <TransactionsWorkspace
        active
        intent={null}
        isWritable
        ledgerData={initiallySafe}
        ledgerEpoch={2}
        mutationVersion={0}
        onDeleteTrade={onDeleteTrade}
        onIntentConsumed={vi.fn()}
        persistedVersion={0}
        persistenceStatus="saved"
        todayKey="2026-07-25"
      />,
    );
    fireEvent.click(deleteButton(buttonName));
    fireEvent.click(deleteButton(buttonName));
    view.rerender(
      <TransactionsWorkspace
        active
        intent={null}
        isWritable
        ledgerData={dependentLedger}
        ledgerEpoch={2}
        mutationVersion={0}
        onDeleteTrade={onDeleteTrade}
        onIntentConsumed={vi.fn()}
        persistedVersion={0}
        persistenceStatus="saved"
        todayKey="2026-07-25"
      />,
    );
    act(() => vi.advanceTimersByTime(5_000));
    expect(onDeleteTrade).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "无法删除：这笔交易支撑了后续卖出，请先删除依赖它的后续卖出",
      ),
    ).not.toBeNull();
  });

  it("shows success only after authenticated persistence and keeps failure retryable", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      createUsdtSimpleTrade("safe-buy", "buy", "BTC", "1", "2026-07-20"),
    ];
    const onDeleteTrade = vi.fn(() => "applied" as const);
    const view = renderWorkspace({ ledgerData, onDeleteTrade });
    const buttonName = "删除 买入 BTC 2026-07-20";

    fireEvent.click(deleteButton(buttonName));
    fireEvent.click(deleteButton(buttonName));
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.queryByText("交易已删除")).toBeNull();

    view.rerender(
      <TransactionsWorkspace
        active
        intent={null}
        isWritable={false}
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={1}
        onDeleteTrade={onDeleteTrade}
        onIntentConsumed={vi.fn()}
        persistedVersion={0}
        persistenceStatus="error"
        todayKey="2026-07-25"
      />,
    );
    expect(
      screen.getByText("删除已应用到内存，但尚未保存；请重试保存"),
    ).not.toBeNull();
    expect(screen.queryByText("交易已删除")).toBeNull();

    view.rerender(
      <TransactionsWorkspace
        active
        intent={null}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={1}
        onDeleteTrade={onDeleteTrade}
        onIntentConsumed={vi.fn()}
        persistedVersion={1}
        persistenceStatus="saved"
        todayKey="2026-07-25"
      />,
    );
    expect(screen.getByText("交易已删除")).not.toBeNull();
    act(() => vi.advanceTimersByTime(3_999));
    expect(screen.getByText("交易已删除")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("交易已删除")).toBeNull();
  });

  it("requires a second confirmation when deleting a trade would make cash negative", () => {
    const ledgerData = createNegativeDeletionLedger();
    const onDeleteTrade = vi.fn(() => "applied" as const);
    renderWorkspace({ ledgerData, onDeleteTrade });
    const buttonName = "删除 卖出 BTC 2026-07-21";

    fireEvent.click(deleteButton(buttonName));
    fireEvent.click(deleteButton(buttonName));
    act(() => vi.advanceTimersByTime(5_000));

    const dialog = screen.getByRole("dialog", {
      name: "确认删除交易后的负现金",
    });
    expect(dialog.textContent).toContain("当前余额0.5 USDT");
    expect(dialog.textContent).toContain("本次变化-1 USDT");
    expect(dialog.textContent).toContain("保存后余额-0.5 USDT");
    expect(onDeleteTrade).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认并删除" }));
    expect(onDeleteTrade).toHaveBeenCalledOnce();
    expect(onDeleteTrade).toHaveBeenCalledWith("cash-sell");
  });

  it("invalidates the negative-cash deletion confirmation after a version change", () => {
    const ledgerData = createNegativeDeletionLedger();
    const onDeleteTrade = vi.fn(() => "applied" as const);
    const view = renderWorkspace({ ledgerData, onDeleteTrade });
    const buttonName = "删除 卖出 BTC 2026-07-21";

    fireEvent.click(deleteButton(buttonName));
    fireEvent.click(deleteButton(buttonName));
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByRole("dialog")).not.toBeNull();

    view.rerender(
      <TransactionsWorkspace
        active
        intent={null}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={1}
        onDeleteTrade={onDeleteTrade}
        onIntentConsumed={vi.fn()}
        persistedVersion={0}
        persistenceStatus="saving"
        todayKey="2026-07-25"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "确认并删除" }));

    expect(onDeleteTrade).not.toHaveBeenCalled();
    expect(screen.getByText(/旧确认已失效/)).not.toBeNull();
  });
});

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
    expect(dialog.textContent).toContain("保存后余额-1 USDT");
    expect(dialog.textContent).toContain("现金缺口1 USDT");
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

// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LedgerData } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade } from "@/test-support";
import { TransactionsWorkspace } from "./TransactionsWorkspace";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-25T12:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

function renderWorkspace({
  active = true,
  ledgerData = createLedger(),
  intent = null,
  mutationVersion = 0,
  persistedVersion = 0,
  persistenceStatus = "saved" as const,
  onDeleteTrade = vi.fn(() => "applied" as const),
} = {}) {
  return render(
    <TransactionsWorkspace
      active={active}
      intent={intent}
      isWritable
      ledgerData={ledgerData}
      ledgerEpoch={1}
      mutationVersion={mutationVersion}
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
  });
});

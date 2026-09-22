// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LedgerData } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import {
  ACTIVITY_PAGE_SIZE,
  buildLedgerActivityItems,
  getActivityPageCount,
  getActivityPageItems,
} from "@/features/activity";
import { createUsdtSimpleTrade } from "@/test-support";
import { TransactionsWorkspace } from "./TransactionsWorkspace";

const DAY_MS = 24 * 60 * 60 * 1_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-25T12:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function dateAt(index: number): string {
  return new Date(Date.UTC(2026, 6, 25) - index * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function tradeId(number: number): string {
  return `page-trade-${String(number).padStart(4, "0")}`;
}

function createPagedLedger(
  count = ACTIVITY_PAGE_SIZE * 2 + 3,
): LedgerData {
  const ledgerData = createInitialLedgerData();
  ledgerData.trades = Array.from({ length: count }, (_, index) =>
    createUsdtSimpleTrade(
      tradeId(index + 1),
      index % 2 === 0 ? "buy" : "sell",
      index % 2 === 0 ? "BTC" : "ETH",
      "1",
      dateAt(index),
    ),
  );
  return ledgerData;
}

function workspace(
  ledgerData: LedgerData,
  options: {
    intent?: Parameters<typeof TransactionsWorkspace>[0]["intent"];
    mutationVersion?: number;
  } = {},
) {
  return (
    <TransactionsWorkspace
      active
      intent={options.intent ?? null}
      isWritable
      ledgerData={ledgerData}
      ledgerEpoch={1}
      mutationVersion={options.mutationVersion ?? 0}
      onDeleteTrade={vi.fn(() => "applied" as const)}
      onIntentConsumed={vi.fn()}
      persistedVersion={0}
      persistenceStatus="saved"
      todayKey="2026-07-25"
    />
  );
}

function visibleSequences(): number[] {
  return Array.from(document.querySelectorAll("[data-activity-sequence]")).map(
    (node) => Number(node.textContent),
  );
}

function visibleSequenceFor(itemId: string): number | undefined {
  const row = document.querySelector(`[data-activity-id="${itemId}"]`);
  const sequence = row?.querySelector("[data-activity-sequence]");
  return sequence ? Number(sequence.textContent) : undefined;
}

function pageLabel(itemCount: number, page: number): string {
  return `共 ${itemCount} 条，第 ${page} / ${getActivityPageCount(itemCount)} 页`;
}

function nextPage() {
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
}

describe("TransactionsWorkspace activity pagination", () => {
  it("T2-01 renders exactly the named page-size constant when more items exist", () => {
    render(workspace(createPagedLedger()));

    expect(visibleSequences()).toHaveLength(ACTIVITY_PAGE_SIZE);
    expect(visibleSequences().at(-1)).toBe(ACTIVITY_PAGE_SIZE + 4);
  });

  it("T2-02 handles the first, middle, last, and short last pages", () => {
    const itemCount = ACTIVITY_PAGE_SIZE * 2 + 3;
    render(workspace(createPagedLedger(itemCount)));

    expect(screen.getByText(pageLabel(itemCount, 1))).not.toBeNull();
    nextPage();
    expect(screen.getByText(pageLabel(itemCount, 2))).not.toBeNull();
    expect(visibleSequences()).toEqual(
      Array.from({ length: ACTIVITY_PAGE_SIZE }, (_, index) =>
        ACTIVITY_PAGE_SIZE + 3 - index,
      ),
    );
    nextPage();
    expect(screen.getByText(pageLabel(itemCount, 3))).not.toBeNull();
    expect(visibleSequences()).toEqual(
      [3, 2, 1],
    );
  });

  it("T2-03 keeps the empty state and omits pagination", () => {
    render(workspace(createPagedLedger(0)));

    expect(screen.getByText("没有符合当前筛选的流水。")).not.toBeNull();
    expect(screen.queryByLabelText("流水分页")).toBeNull();
  });

  it("T2-04 renders a one-item result without an invalid page count", () => {
    render(workspace(createPagedLedger(1)));

    expect(screen.getByText("共 1 条，第 1 / 1 页")).not.toBeNull();
    expect(visibleSequences()).toEqual([1]);
    expect(screen.queryByText(/第 1 \/ 0 页/)).toBeNull();
  });

  it("T2-05 preserves the complete filtered order when every page is combined", () => {
    const ledgerData = createPagedLedger();
    const items = buildLedgerActivityItems(ledgerData);
    const collected = Array.from(
      { length: getActivityPageCount(items.length) },
      (_, index) => getActivityPageItems(items, index + 1),
    ).flat();

    expect(collected.map((item) => item.id)).toEqual(items.map((item) => item.id));
  });

  it("T2-06 returns to page one when each filter changes", () => {
    const itemCount = ACTIVITY_PAGE_SIZE * 2 + 3;
    render(workspace(createPagedLedger(itemCount)));

    const assertFilterResetsPage = (change: () => void) => {
      nextPage();
      expect(screen.getByText(pageLabel(itemCount, 2))).not.toBeNull();
      change();
      expect(visibleSequences().at(0)).toBe(itemCount);
    };

    assertFilterResetsPage(() =>
      fireEvent.change(screen.getByLabelText("时间范围"), {
        target: { value: "7d" },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    assertFilterResetsPage(() =>
      fireEvent.change(screen.getByLabelText("资产筛选"), {
        target: { value: "BTC" },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    assertFilterResetsPage(() =>
      fireEvent.change(screen.getByLabelText("类型筛选"), {
        target: { value: "buy" },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    assertFilterResetsPage(() =>
      fireEvent.change(screen.getByLabelText("准确日期"), {
        target: { value: dateAt(0) },
      }),
    );
  });

  it("T2-07 stays on the current page after a deletion leaves that page populated", () => {
    const before = createPagedLedger();
    const after = {
      ...before,
      trades: before.trades.filter((trade) => trade.id !== tradeId(ACTIVITY_PAGE_SIZE + 1)),
    };
    const view = render(workspace(before));

    nextPage();
    expect(screen.getByText(pageLabel(before.trades.length, 2))).not.toBeNull();
    view.rerender(workspace(after, { mutationVersion: 1 }));

    expect(screen.getByText(pageLabel(after.trades.length, 2))).not.toBeNull();
    expect(visibleSequences().at(0)).toBe(ACTIVITY_PAGE_SIZE + 2);
    expect(
      document.querySelector("[data-activity-id]")?.getAttribute("data-activity-id"),
    ).toBe(tradeId(ACTIVITY_PAGE_SIZE + 2));
  });

  it("T2-08 returns to the previous page when deletion empties a non-first page", () => {
    const before = createPagedLedger(ACTIVITY_PAGE_SIZE + 1);
    const after = {
      ...before,
      trades: before.trades.filter((trade) => trade.id !== tradeId(ACTIVITY_PAGE_SIZE + 1)),
    };
    const view = render(workspace(before));

    nextPage();
    expect(screen.getByText(pageLabel(before.trades.length, 2))).not.toBeNull();
    view.rerender(workspace(after, { mutationVersion: 1 }));

    expect(screen.getByText(pageLabel(after.trades.length, 1))).not.toBeNull();
  });

  it("T2-09 moves to the target date page before locating and highlighting it", () => {
    const ledgerData = createPagedLedger();
    const targetIndex = ACTIVITY_PAGE_SIZE * 2;
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    const view = render(workspace(ledgerData));

    view.rerender(
      workspace(ledgerData, {
        intent: { page: "transactions", locateDate: dateAt(targetIndex) },
      }),
    );

    expect(screen.getByText(pageLabel(ledgerData.trades.length, 3))).not.toBeNull();
    expect(visibleSequences()).toEqual([3, 2, 1]);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    act(() => document.dispatchEvent(new Event("scrollend")));
    expect(document.querySelector('[data-locate-highlight="flashing"]')).not.toBeNull();
  });

  it("T2-10 preserves the missing-location path", () => {
    const ledgerData = createPagedLedger();
    render(
      workspace(ledgerData, {
        intent: { page: "transactions", locateDate: "2000-01-01" },
      }),
    );

    expect(
      screen.getByText("该日期的交易已发生变化，已显示完整交易列表"),
    ).not.toBeNull();
  });

  it("T2-11 closes expanded details when the page changes", () => {
    render(workspace(createPagedLedger()));

    fireEvent.click(within(screen.getByRole("table")).getAllByRole("button", { name: "详情" })[0]!);
    expect(screen.getByText("事实 ID")).not.toBeNull();
    nextPage();

    expect(screen.queryByText("事实 ID")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    expect(screen.queryByText("事实 ID")).toBeNull();
  });

  it("T2-12 derives its page boundaries from the shared page-size constant", () => {
    const count = ACTIVITY_PAGE_SIZE + 1;
    const page = getActivityPageItems(Array.from({ length: count }, (_, index) => index), 2);

    expect(getActivityPageCount(count)).toBe(2);
    expect(page).toEqual([ACTIVITY_PAGE_SIZE]);
  });

  it("T-B1 assigns the first two page starts their full-ledger descending sequences", () => {
    render(workspace(createPagedLedger()));

    expect(visibleSequences().at(0)).toBe(ACTIVITY_PAGE_SIZE * 2 + 3);
    nextPage();
    expect(visibleSequences().at(0)).toBe(ACTIVITY_PAGE_SIZE + 3);
  });

  it("T-B2 makes the oldest item's sequence equal one", () => {
    const itemCount = ACTIVITY_PAGE_SIZE * 2 + 3;
    render(workspace(createPagedLedger(itemCount)));

    nextPage();
    nextPage();
    expect(screen.getByText(pageLabel(itemCount, 3))).not.toBeNull();
    expect(visibleSequences().at(-1)).toBe(1);
  });

  it("T-B3 preserves full-ledger sequences across filtering and pages", () => {
    const ledgerData = createPagedLedger();
    render(workspace(ledgerData));

    nextPage();
    fireEvent.change(screen.getByLabelText("资产筛选"), {
      target: { value: "BTC" },
    });
    expect(visibleSequences().at(0)).toBe(ACTIVITY_PAGE_SIZE * 2 + 3);
    nextPage();
    expect(visibleSequences().at(-1)).toBe(1);
  });

  it("T-B4 gives a new first item N+1 without renumbering existing items", () => {
    const before = createPagedLedger();
    const view = render(workspace(before));

    expect(visibleSequenceFor(tradeId(1))).toBe(ACTIVITY_PAGE_SIZE * 2 + 3);

    const after = {
      ...before,
      trades: [
        ...before.trades,
        createUsdtSimpleTrade(
          "page-trade-newest",
          "buy",
          "BTC",
          "1",
          "2026-07-26",
        ),
      ],
    };
    view.rerender(workspace(after, { mutationVersion: 1 }));

    expect(visibleSequenceFor("page-trade-newest")).toBe(
      ACTIVITY_PAGE_SIZE * 2 + 4,
    );
    expect(visibleSequenceFor(tradeId(1))).toBe(ACTIVITY_PAGE_SIZE * 2 + 3);
  });
});

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

function createPagedLedger(
  count = ACTIVITY_PAGE_SIZE * 2 + 3,
): LedgerData {
  const ledgerData = createInitialLedgerData();
  ledgerData.trades = Array.from({ length: count }, (_, index) =>
    createUsdtSimpleTrade(
      `page-trade-${String(index + 1).padStart(4, "0")}`,
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

function visibleActivityIds(): string[] {
  return Array.from(document.querySelectorAll("[data-activity-id]")).map(
    (node) => node.getAttribute("data-activity-id") ?? "",
  );
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
    expect(visibleSequences().at(-1)).toBe(ACTIVITY_PAGE_SIZE);
  });

  it("T2-02 handles the first, middle, last, and short last pages", () => {
    const itemCount = ACTIVITY_PAGE_SIZE * 2 + 3;
    render(workspace(createPagedLedger(itemCount)));

    expect(screen.getByText(pageLabel(itemCount, 1))).not.toBeNull();
    nextPage();
    expect(screen.getByText(pageLabel(itemCount, 2))).not.toBeNull();
    expect(visibleSequences()).toEqual(
      Array.from({ length: ACTIVITY_PAGE_SIZE }, (_, index) =>
        ACTIVITY_PAGE_SIZE + index + 1,
      ),
    );
    nextPage();
    expect(screen.getByText(pageLabel(itemCount, 3))).not.toBeNull();
    expect(visibleSequences()).toEqual(
      Array.from({ length: 3 }, (_, index) => ACTIVITY_PAGE_SIZE * 2 + index + 1),
    );
  });

  it("T2-03 keeps the empty state and omits pagination", () => {
    render(workspace(createPagedLedger(0)));

    expect(screen.getByText("没有符合当前筛选的流水。")).not.toBeNull();
    expect(screen.queryByLabelText("流水分页")).toBeNull();
  });

  it("T2-04 renders a one-item result without an invalid page count", () => {
    render(workspace(createPagedLedger(1)));

    expect(screen.getByText(pageLabel(1, 1))).not.toBeNull();
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
      expect(visibleSequences().at(0)).toBe(1);
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
      trades: before.trades.filter((trade) => trade.id !== "page-trade-0101"),
    };
    const view = render(workspace(before));

    nextPage();
    expect(screen.getByText(pageLabel(before.trades.length, 2))).not.toBeNull();
    view.rerender(workspace(after, { mutationVersion: 1 }));

    expect(screen.getByText(pageLabel(after.trades.length, 2))).not.toBeNull();
    expect(visibleSequences().at(0)).toBe(ACTIVITY_PAGE_SIZE + 1);
  });

  it("T2-08 returns to the previous page when deletion empties a non-first page", () => {
    const before = createPagedLedger(ACTIVITY_PAGE_SIZE + 1);
    const after = {
      ...before,
      trades: before.trades.filter((trade) => trade.id !== "page-trade-0101"),
    };
    const view = render(workspace(before));

    nextPage();
    expect(screen.getByText(pageLabel(before.trades.length, 2))).not.toBeNull();
    view.rerender(workspace(after, { mutationVersion: 1 }));

    expect(screen.getByText(pageLabel(after.trades.length, 1))).not.toBeNull();
  });

  it("T2-11 closes expanded details when the page changes", () => {
    render(workspace(createPagedLedger()));

    fireEvent.click(within(screen.getByRole("table")).getAllByRole("button", { name: "详情" })[0]!);
    expect(screen.getByText("事实 ID")).not.toBeNull();
    nextPage();

    expect(screen.queryByText("事实 ID")).toBeNull();
  });

  it("T2-12 derives its page boundaries from the shared page-size constant", () => {
    const count = ACTIVITY_PAGE_SIZE + 1;
    const page = getActivityPageItems(Array.from({ length: count }, (_, index) => index), 2);

    expect(getActivityPageCount(count)).toBe(2);
    expect(page).toEqual([ACTIVITY_PAGE_SIZE]);
  });

  it("T-B1 assigns the first two page starts their absolute position sequences", () => {
    render(workspace(createPagedLedger()));

    expect(visibleSequences().at(0)).toBe(1);
    nextPage();
    expect(visibleSequences().at(0)).toBe(ACTIVITY_PAGE_SIZE + 1);
  });

  it("T-B2 makes the final sequence equal the displayed filtered total", () => {
    const itemCount = ACTIVITY_PAGE_SIZE * 2 + 3;
    render(workspace(createPagedLedger(itemCount)));

    nextPage();
    nextPage();
    expect(screen.getByText(pageLabel(itemCount, 3))).not.toBeNull();
    expect(visibleSequences().at(-1)).toBe(itemCount);
  });

  it("T-B3 resets filtered sequences to one and ends them at the new total", () => {
    const ledgerData = createPagedLedger();
    render(workspace(ledgerData));

    nextPage();
    fireEvent.change(screen.getByLabelText("资产筛选"), {
      target: { value: "BTC" },
    });
    expect(visibleSequences().at(0)).toBe(1);
    nextPage();
    expect(visibleSequences().at(-1)).toBe(
      buildLedgerActivityItems(ledgerData).filter(
        (item) => item.kind === "trade" && item.trade.assetSymbol === "BTC",
      ).length,
    );
  });
});

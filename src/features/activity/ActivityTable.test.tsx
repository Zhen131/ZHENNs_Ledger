// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createUsdtSimpleTrade } from "@/test-support";
import type { LedgerClock } from "@/core/shared";
import {
  ActivityTable,
  formatOccurredAtForView,
  formatRecordedOccurredAt,
  type ActivityDeleteState,
} from "./ActivityTable";
import type { LedgerActivityItem } from "./activityService";

afterEach(cleanup);

const CASH_ITEM: LedgerActivityItem = {
  kind: "cash-event",
  id: "cash-deposit",
  occurredAt: "2026-08-19",
  cashEvent: {
    id: "cash-deposit",
    type: "deposit",
    amount: "1000",
    currency: "USDT",
    occurredAt: "2026-08-19",
    timePrecision: "day",
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
  },
};

const TRADE_ITEM: LedgerActivityItem = {
  kind: "trade",
  id: "trade-buy",
  occurredAt: "2026-08-18",
  trade: createUsdtSimpleTrade(
    "trade-buy",
    "buy",
    "BTC",
    "1234.56789",
    "2026-08-18",
  ),
};

const TIMED_TRADE_ITEM: LedgerActivityItem = {
  ...TRADE_ITEM,
  occurredAt: "2026-08-20T05:40:00+08:00",
  trade: {
    ...TRADE_ITEM.trade,
    occurredAt: "2026-08-20T05:40:00+08:00",
    occurredTimeZone: "Asia/Shanghai",
    timePrecision: "minute",
  },
};

function stubClock(timeZone: string): LedgerClock {
  return {
    now: () => new Date("2026-08-19T00:00:00Z"),
    timeZone: () => timeZone,
  };
}

function Harness({
  items = [CASH_ITEM, TRADE_ITEM],
  clock,
}: Readonly<{
  items?: readonly LedgerActivityItem[];
  clock?: LedgerClock;
}>) {
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [armedItemId, setArmedItemId] = useState<string | null>(null);
  const deleteState: ActivityDeleteState = {
    armedItemId,
    pendingItemId: null,
    pendingPhase: null,
    remainingMs: 0,
  };

  return (
    <ActivityTable
      clock={clock}
      deleteState={deleteState}
      expandedItemId={expandedItemId}
      items={items}
      locateRequest={null}
      onArmDelete={(item) => setArmedItemId(item.id)}
      onCancelDelete={() => setArmedItemId(null)}
      onConfirmDelete={vi.fn()}
      onExpandedItemIdChange={setExpandedItemId}
      onLocateComplete={vi.fn()}
      onUndoDelete={vi.fn()}
      sequenceByItemKey={new Map([
        ["cash-event:cash-deposit", 2],
        ["trade:trade-buy", 1],
      ])}
      todayKey="2026-08-19"
    />
  );
}

describe("ActivityTable keyboard controls", () => {
  it("keeps Enter and Space on the delete control instead of toggling the row", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const deleteButton = screen.getByRole("button", {
      name: "删除 入金 现金 USDT 2026-08-19",
    });
    const activityRow = deleteButton.closest("tr");

    deleteButton.focus();
    await user.keyboard("{Enter}");

    expect(deleteButton.textContent).toBe("再次点击删除");
    expect(activityRow?.getAttribute("aria-expanded")).toBe("false");

    await user.keyboard("{Escape}");
    expect(deleteButton.textContent).toBe("删除");

    await user.keyboard(" ");
    expect(deleteButton.textContent).toBe("再次点击删除");
    expect(activityRow?.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders trade quantities through LedgerNumber and a dash for cash events", () => {
    render(<Harness />);

    expect(screen.getByRole("columnheader", { name: "数量" })).not.toBeNull();
    const tradeRow = document.querySelector('[data-activity-id="trade-buy"]');
    const cashRow = document.querySelector('[data-activity-id="cash-deposit"]');
    const tradeQuantityCell = tradeRow?.querySelectorAll("td").item(4);
    const cashQuantityCell = cashRow?.querySelectorAll("td").item(4);

    expect(
      tradeQuantityCell?.querySelector('[title="1234.56789"]')?.textContent,
    ).toBe("1 234.5679");
    expect(cashQuantityCell?.textContent).toBe("数量—");
  });
});

describe("formatRecordedOccurredAt", () => {
  it("keeps a pure date exactly as stored", () => {
    expect(formatRecordedOccurredAt("2026-08-20")).toBe("2026-08-20");
  });

  it("shows the stored minute, offset, and known place without seconds", () => {
    expect(
      formatRecordedOccurredAt(
        "2026-08-20T05:40:00+08:00",
        "Asia/Shanghai",
      ),
    ).toBe("2026-08-20 05:40 (+08:00) · Asia/Shanghai");
  });

  it("omits seconds from a stored second-precision record", () => {
    expect(formatRecordedOccurredAt("2026-08-20T05:40:32.123Z")).toBe(
      "2026-08-20 05:40 (+00:00)",
    );
  });

  it("does not infer a place when the record has none", () => {
    expect(formatRecordedOccurredAt("2026-08-20T05:40:00+08:00")).toBe(
      "2026-08-20 05:40 (+08:00)",
    );
  });
});

describe("ActivityTable recorded-time display", () => {
  it("shows the formatted record time and keeps the raw time and place in details", async () => {
    render(<Harness items={[TIMED_TRADE_ITEM]} />);
    const user = userEvent.setup();

    expect(
      screen.getByText("2026-08-20 05:40 (+08:00) · Asia/Shanghai"),
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "详情" }));

    expect(screen.getByText("2026-08-20T05:40:00+08:00")).not.toBeNull();
    expect(screen.getByText("Asia/Shanghai")).not.toBeNull();
  });
});

describe("time zone view switch", () => {
  const BUDAPEST_CLOCK = stubClock("Europe/Budapest");

  it("shows a recorded moment in its own place by default", () => {
    render(<Harness clock={BUDAPEST_CLOCK} items={[TIMED_TRADE_ITEM]} />);

    const view = screen.getByLabelText("时间按哪儿显示") as HTMLSelectElement;
    expect(view.value).toBe("recorded");
    const row = document.querySelector('[data-activity-id="trade-buy"]');
    expect(row?.querySelectorAll("td").item(1)?.textContent).toContain(
      "2026-08-20 05:40 (+08:00) · Asia/Shanghai",
    );
  });

  it("shows the same moment on the reader's own clock after switching", async () => {
    render(<Harness clock={BUDAPEST_CLOCK} items={[TIMED_TRADE_ITEM]} />);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("时间按哪儿显示"), "current");

    // 2026-08-20 05:40+08:00 is 2026-08-19 21:40Z, which Budapest shows as
    // 23:40 on 2026-08-19 while it is two hours ahead of Greenwich.
    const row = document.querySelector('[data-activity-id="trade-buy"]');
    expect(row?.querySelectorAll("td").item(1)?.textContent).toContain(
      "2026-08-19 23:40 (+02:00) · Europe/Budapest",
    );
  });

  it("leaves the underlying fact untouched by the switch", async () => {
    const before = JSON.stringify(TIMED_TRADE_ITEM);
    render(<Harness clock={BUDAPEST_CLOCK} items={[TIMED_TRADE_ITEM]} />);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("时间按哪儿显示"), "current");

    expect(JSON.stringify(TIMED_TRADE_ITEM)).toBe(before);
    expect(TIMED_TRADE_ITEM.trade.occurredAt).toBe("2026-08-20T05:40:00+08:00");
    expect(TIMED_TRADE_ITEM.trade.occurredTimeZone).toBe("Asia/Shanghai");
  });

  it("shows a date-only fact identically in both views", async () => {
    render(<Harness clock={BUDAPEST_CLOCK} items={[CASH_ITEM]} />);
    const user = userEvent.setup();
    const cell = () =>
      document
        .querySelector('[data-activity-id="cash-deposit"]')
        ?.querySelectorAll("td")
        .item(1)?.textContent;

    const recorded = cell();
    await user.selectOptions(screen.getByLabelText("时间按哪儿显示"), "current");

    expect(recorded).toContain("2026-08-19");
    expect(cell()).toBe(recorded);
  });

  it("keeps the row order exactly as it was when the view changes", async () => {
    render(
      <Harness clock={BUDAPEST_CLOCK} items={[TIMED_TRADE_ITEM, CASH_ITEM]} />,
    );
    const user = userEvent.setup();
    const order = () =>
      [...document.querySelectorAll("[data-activity-id]")].map((row) =>
        row.getAttribute("data-activity-id"),
      );

    const before = order();
    await user.selectOptions(screen.getByLabelText("时间按哪儿显示"), "current");
    const after = order();
    await user.selectOptions(screen.getByLabelText("时间按哪儿显示"), "recorded");

    expect(before).toEqual(["trade-buy", "cash-deposit"]);
    expect(after).toEqual(before);
    expect(order()).toEqual(before);
  });
});

describe("formatOccurredAtForView", () => {
  it("returns a date-only value unchanged in the current-place view", () => {
    expect(
      formatOccurredAtForView("2026-08-20", undefined, "current", "Asia/Shanghai"),
    ).toBe("2026-08-20");
    expect(
      formatOccurredAtForView(
        "2026-08-20",
        "Europe/Budapest",
        "current",
        "Asia/Shanghai",
      ),
    ).toBe("2026-08-20");
  });

  it("converts a timed value to the current place", () => {
    // 2026-08-20 05:40+08:00 is 2026-08-19 21:40Z.
    expect(
      formatOccurredAtForView(
        "2026-08-20T05:40:00+08:00",
        "Asia/Shanghai",
        "current",
        "UTC",
      ),
    ).toBe("2026-08-19 21:40 (+00:00) · UTC");
  });

  it("falls back to the recorded rendering when the place is unusable", () => {
    expect(
      formatOccurredAtForView(
        "2026-08-20T05:40:00+08:00",
        "Asia/Shanghai",
        "current",
        "Not/AZone",
      ),
    ).toBe("2026-08-20 05:40 (+08:00) · Asia/Shanghai");
  });
});

// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createUsdtSimpleTrade } from "@/test-support";
import {
  ActivityTable,
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

function Harness({
  items = [CASH_ITEM, TRADE_ITEM],
}: Readonly<{ items?: readonly LedgerActivityItem[] }>) {
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

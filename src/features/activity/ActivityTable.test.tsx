// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityTable, type ActivityDeleteState } from "./ActivityTable";
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

function Harness() {
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
      items={[CASH_ITEM]}
      locateRequest={null}
      onArmDelete={(item) => setArmedItemId(item.id)}
      onCancelDelete={() => setArmedItemId(null)}
      onConfirmDelete={vi.fn()}
      onExpandedItemIdChange={setExpandedItemId}
      onLocateComplete={vi.fn()}
      onUndoDelete={vi.fn()}
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
});

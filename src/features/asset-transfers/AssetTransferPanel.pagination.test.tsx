// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LedgerData } from "@/core/models";
import type { LedgerClock } from "@/core/shared";
import { createInitialLedgerData } from "@/core/state";
import { ACTIVITY_PAGE_SIZE } from "@/features/activity";
import { AssetTransferPanel } from "./AssetTransferPanel";

const clock: LedgerClock = {
  now: () => new Date("2026-08-18T08:00:00.000Z"),
};

afterEach(() => cleanup());

describe("AssetTransferPanel pagination", () => {
  it("T-C5.1 renders one page of transfers with the newest transfer first", () => {
    renderPanel({ ledgerData: transferLedger(ACTIVITY_PAGE_SIZE + 3) });

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(ACTIVITY_PAGE_SIZE);
    expect(rows[0]?.textContent).toContain("transfer-0103");
    expect(screen.getByText("共 103 条，第 1 / 2 页")).not.toBeNull();
  });

  it("T-C5.2 preserves the complete reverse-order collection without duplicates", async () => {
    const ledgerData = transferLedger(ACTIVITY_PAGE_SIZE * 2 + 3);
    renderPanel({ ledgerData });
    const user = userEvent.setup();
    const renderedNotes: string[] = [];

    while (true) {
      for (const row of screen.getAllByRole("listitem")) {
        const note = row.textContent?.match(/transfer-\d{4}/)?.[0];
        expect(note).toBeDefined();
        renderedNotes.push(note as string);
      }
      const next = screen.getByRole("button", { name: "下一页" });
      if ((next as HTMLButtonElement).disabled) break;
      await user.click(next);
    }

    expect(renderedNotes).toEqual(
      [...ledgerData.assetTransfers]
        .reverse()
        .map((assetTransfer) => assetTransfer.note),
    );
    expect(new Set(renderedNotes).size).toBe(
      ledgerData.assetTransfers.length,
    );
  });

  it("T-C5.3 keeps the current page after deletion and clamps an emptied last page", async () => {
    let ledgerData = transferLedger(ACTIVITY_PAGE_SIZE + 2);
    const onDelete = vi.fn(() => "applied" as const);
    const view = renderPanel({ ledgerData, onDelete });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "下一页" }));
    await deleteTransfer(user, "transfer-0002");
    expect(onDelete).toHaveBeenLastCalledWith(
      "transfer-0002",
      expect.anything(),
    );

    ledgerData = withoutTransfer(ledgerData, "transfer-0002");
    view.rerender(
      panel({
        ledgerData,
        mutationVersion: 1,
        onDelete,
        persistedVersion: 1,
      }),
    );
    expect(screen.getByText("共 101 条，第 2 / 2 页")).not.toBeNull();

    await waitFor(() =>
      expect(
        within(rowWithNote("transfer-0001")).getByRole("button", {
          name: "删除",
        }) as HTMLButtonElement,
      ).toHaveProperty("disabled", false),
    );
    await deleteTransfer(user, "transfer-0001");
    ledgerData = withoutTransfer(ledgerData, "transfer-0001");
    view.rerender(
      panel({
        ledgerData,
        mutationVersion: 2,
        onDelete,
        persistedVersion: 2,
      }),
    );

    await waitFor(() =>
      expect(screen.getByText("共 100 条，第 1 / 1 页")).not.toBeNull(),
    );
  });

  it("T-C5.4 handles empty, single, full, and partial-page collections", async () => {
    const empty = renderPanel({ ledgerData: transferLedger(0) });
    expect(screen.getByText("暂无资产转移。")).not.toBeNull();
    expect(screen.queryByLabelText("资产转移事实分页")).toBeNull();
    empty.unmount();

    const single = renderPanel({ ledgerData: transferLedger(1) });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("共 1 条，第 1 / 1 页")).not.toBeNull();
    single.unmount();

    const full = renderPanel({ ledgerData: transferLedger(ACTIVITY_PAGE_SIZE) });
    expect(screen.getAllByRole("listitem")).toHaveLength(ACTIVITY_PAGE_SIZE);
    expect(screen.getByText("共 100 条，第 1 / 1 页")).not.toBeNull();
    full.unmount();

    renderPanel({ ledgerData: transferLedger(ACTIVITY_PAGE_SIZE + 1) });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("共 101 条，第 2 / 2 页")).not.toBeNull();
  });
});

async function deleteTransfer(
  user: ReturnType<typeof userEvent.setup>,
  note: string,
) {
  const row = rowWithNote(note);
  await user.click(within(row).getByRole("button", { name: "删除" }));
  await user.click(within(row).getByRole("button", { name: "确认删除" }));
}

function rowWithNote(note: string): HTMLElement {
  return screen
    .getAllByRole("listitem")
    .find((row) => row.textContent?.includes(note)) as HTMLElement;
}

function renderPanel(options: Parameters<typeof panel>[0] = {}) {
  return render(panel(options));
}

function panel({
  ledgerData = transferLedger(0),
  mutationVersion = 0,
  persistedVersion = 0,
  onDelete = vi.fn(() => "applied" as const),
}: {
  ledgerData?: LedgerData;
  mutationVersion?: number;
  persistedVersion?: number;
  onDelete?: Parameters<typeof AssetTransferPanel>[0]["onAssetTransferDeleted"];
} = {}) {
  return (
    <AssetTransferPanel
      clock={clock}
      isWritable
      ledgerData={ledgerData}
      ledgerEpoch={1}
      mutationVersion={mutationVersion}
      onAssetTransferCreated={vi.fn(() => "applied" as const)}
      onAssetTransferDeleted={onDelete}
      persistedVersion={persistedVersion}
      persistenceStatus="saved"
    />
  );
}

function transferLedger(count: number): LedgerData {
  const ledgerData = createInitialLedgerData();
  ledgerData.assetTransfers = Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const token = String(number).padStart(4, "0");
    return {
      id: `transfer-${token}`,
      occurredAt: "2026-08-18",
      timePrecision: "day" as const,
      assetSymbol: "BTC",
      quantity: "1",
      category: "external-in" as const,
      reason: "deposit" as const,
      unitPrice: "4",
      toLocation: "exchange" as const,
      note: `transfer-${token}`,
      createdAt: "2026-08-18T08:00:00.000Z",
      updatedAt: "2026-08-18T08:00:00.000Z",
    };
  });
  return ledgerData;
}

function withoutTransfer(ledgerData: LedgerData, id: string): LedgerData {
  return {
    ...ledgerData,
    assetTransfers: ledgerData.assetTransfers.filter(
      (assetTransfer) => assetTransfer.id !== id,
    ),
  };
}

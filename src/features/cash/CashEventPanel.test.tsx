// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LedgerData } from "@/core/models";
import type { LedgerClock } from "@/core/shared";
import { createInitialLedgerData } from "@/core/state";
import { CashEventPanel } from "./CashEventPanel";

const clock: LedgerClock = {
  now: () => new Date("2026-08-18T08:00:00.000Z"),
};

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "cash-new") });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CashEventPanel", () => {
  it("creates a positive cash fact without a second confirmation", async () => {
    const onCreate = vi.fn(() => "applied" as const);
    renderPanel({ onCreate });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("金额"), "1000");
    await user.click(screen.getByRole("button", { name: "保存现金事实" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "cash-new",
        type: "deposit",
        amount: "1000",
        currency: "USDT",
      }),
      expect.objectContaining({ todayKey: "2026-08-18" }),
    );
  });

  it("requires a keyboard-safe second confirmation before saving negative cash", async () => {
    const onCreate = vi.fn(() => "applied" as const);
    renderPanel({ onCreate });
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("现金类型"), "withdrawal");
    await user.type(screen.getByLabelText("金额"), "5");
    const trigger = screen.getByRole("button", { name: "保存现金事实" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "确认负现金余额" });
    expect(dialog.textContent).toContain("保存后余额");
    expect(dialog.textContent).toContain("-5 USDT");
    expect(onCreate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "确认并保存" }),
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(onCreate).not.toHaveBeenCalled();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "确认并保存" }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("invalidates a negative confirmation when the ledger version changes", async () => {
    const onCreate = vi.fn(() => "applied" as const);
    const view = renderPanel({ onCreate, mutationVersion: 0 });
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("现金类型"), "external-expense");
    await user.type(screen.getByLabelText("金额"), "3");
    await user.click(screen.getByRole("button", { name: "保存现金事实" }));
    expect(screen.getByRole("dialog")).not.toBeNull();

    view.rerender(panel({ onCreate, mutationVersion: 1 }));
    await user.click(screen.getByRole("button", { name: "确认并保存" }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/旧确认已失效/)).not.toBeNull();
  });

  it("persists adjustment before, target, and delta from the latest replay", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.cashEvents = [deposit("existing", "100")];
    const onCreate = vi.fn(() => "applied" as const);
    renderPanel({ ledgerData, onCreate });
    const user = userEvent.setup();

    await user.selectOptions(
      screen.getByLabelText("现金类型"),
      "balance-adjustment",
    );
    await user.type(screen.getByLabelText("目标余额"), "80");
    await user.click(screen.getByRole("button", { name: "保存现金事实" }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "balance-adjustment",
        balanceBefore: "100",
        targetBalance: "80",
        adjustmentAmount: "-20",
      }),
      expect.anything(),
    );
  });

  it("rechecks and confirms a deletion that would deepen a cash deficit", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.cashEvents = [deposit("supporting-deposit", "10")];
    ledgerData.trades = [
      {
        id: "buy",
        occurredAt: "2026-08-18",
        timePrecision: "day",
        type: "buy",
        assetSymbol: "BTC",
        quantity: "1",
        price: "15",
        totalValue: "15",
        currency: "USDT",
        fee: "0",
        feeCurrency: "USDT",
        createdAt: "2026-08-18T08:00:00.000Z",
        updatedAt: "2026-08-18T08:00:00.000Z",
      },
    ];
    const onDelete = vi.fn(() => "applied" as const);
    renderPanel({ ledgerData, onDelete });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(
      screen.getByRole("dialog", { name: "确认删除后的负现金" }).textContent,
    ).toContain("-15 USDT");
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认并删除" }));
    expect(onDelete).toHaveBeenCalledWith(
      "supporting-deposit",
      expect.objectContaining({ todayKey: "2026-08-18" }),
    );
  });
});

function renderPanel(options: Parameters<typeof panel>[0] = {}) {
  return render(panel(options));
}

function panel({
  ledgerData = createInitialLedgerData(),
  mutationVersion = 0,
  persistedVersion = 0,
  onCreate = vi.fn(() => "applied" as const),
  onDelete = vi.fn(() => "applied" as const),
}: {
  ledgerData?: LedgerData;
  mutationVersion?: number;
  persistedVersion?: number;
  onCreate?: Parameters<typeof CashEventPanel>[0]["onCashEventCreated"];
  onDelete?: Parameters<typeof CashEventPanel>[0]["onCashEventDeleted"];
} = {}) {
  return (
    <CashEventPanel
      clock={clock}
      isWritable
      ledgerData={ledgerData}
      ledgerEpoch={1}
      mutationVersion={mutationVersion}
      onCashEventCreated={onCreate}
      onCashEventDeleted={onDelete}
      persistedVersion={persistedVersion}
      persistenceStatus="saved"
    />
  );
}

function deposit(id: string, amount: string): LedgerData["cashEvents"][number] {
  return {
    id,
    occurredAt: "2026-08-18",
    timePrecision: "day",
    type: "deposit",
    currency: "USDT",
    amount,
    createdAt: "2026-08-18T08:00:00.000Z",
    updatedAt: "2026-08-18T08:00:00.000Z",
  };
}

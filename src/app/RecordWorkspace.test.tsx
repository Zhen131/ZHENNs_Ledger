// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LedgerClock } from "@/core/shared";
import { createInitialLedgerData } from "@/core/state";
import { RecordWorkspace } from "./RecordWorkspace";

const clock: LedgerClock = {
  now: () => new Date("2026-08-18T08:00:00.000Z"),
};

afterEach(cleanup);

describe("RecordWorkspace target routing", () => {
  it("lists cash first and mounts exactly one fact form at a time", async () => {
    renderWorkspace();
    const user = userEvent.setup();
    const target = screen.getByLabelText("记账对象") as HTMLSelectElement;

    expect(target.value).toBe("cash:USDT");
    expect(target.options[0]?.textContent).toBe("现金 USDT");
    expect(screen.getByLabelText("现金类型")).not.toBeNull();
    expect(screen.queryByLabelText("数量")).toBeNull();

    await user.selectOptions(target, "trade:BTC");

    expect(screen.queryByLabelText("现金类型")).toBeNull();
    expect(screen.getByLabelText("数量")).not.toBeNull();
    expect(screen.getByText("新增 BTC 交易")).not.toBeNull();

    await user.selectOptions(target, "cash:USDT");
    expect(screen.getByLabelText("现金类型")).not.toBeNull();
    expect(screen.queryByLabelText("数量")).toBeNull();
  });

  it("unmounts a pending cash confirmation when the record target changes", async () => {
    renderWorkspace();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("现金类型"), "withdrawal");
    await user.type(screen.getByLabelText("金额"), "1");
    await user.click(screen.getByRole("button", { name: "保存现金事实" }));
    expect(screen.getByRole("dialog")).not.toBeNull();

    await user.selectOptions(screen.getByLabelText("记账对象"), "trade:BTC");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("数量")).not.toBeNull();
  });
});

function renderWorkspace() {
  const ledgerData = createInitialLedgerData();
  return render(
    <RecordWorkspace
      active
      clock={clock}
      focusIntent={null}
      isWritable
      ledgerData={ledgerData}
      ledgerEpoch={1}
      marketDataPanel={null}
      mutationVersion={0}
      onCashEventCreated={vi.fn(() => "applied" as const)}
      onCashEventDeleted={vi.fn(() => "applied" as const)}
      onIntentConsumed={vi.fn()}
      onPriceDraftChange={vi.fn()}
      onPriceReset={vi.fn()}
      onPriceSnapshotCreated={vi.fn(() => "applied" as const)}
      onTradeCreated={vi.fn(() => "applied" as const)}
      onTradeDraftChange={vi.fn()}
      onTradeReset={vi.fn()}
      persistedVersion={0}
      persistenceStatus="saved"
      priceDraft={{
        assetSymbol: "BTC",
        price: "",
        recordedAt: "2026-08-18",
        note: "",
      }}
      tradeDraft={{
        type: "buy",
        assetSymbol: "BTC",
        quantity: "",
        price: "",
        totalValue: "",
        totalValueMode: "auto",
        occurredAt: "2026-08-18",
        fee: "0",
        feeCurrency: "USDT",
        platform: "",
        note: "",
        noteExpanded: false,
      }}
    />,
  );
}

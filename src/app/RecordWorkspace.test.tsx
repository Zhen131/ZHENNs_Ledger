// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as calculations from "@/core/calculations";
import type { LedgerClock } from "@/core/shared";
import { createInitialLedgerData } from "@/core/state";
import { RecordWorkspace } from "./RecordWorkspace";

const clock: LedgerClock = {
  now: () => new Date("2026-08-18T08:00:00.000Z"),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RecordWorkspace target routing", () => {
  it("lists cash first and mounts exactly one fact form at a time", async () => {
    renderWorkspace();
    const user = userEvent.setup();
    const target = screen.getByLabelText("记账对象") as HTMLSelectElement;

    expect(target.value).toBe("cash:USDT");
    expect(target.options[0]?.textContent).toBe("现金 USDT");
    expect(target.options[1]?.textContent).toBe("资产转入转出");
    expect(screen.getByLabelText("现金类型")).not.toBeNull();
    expect(screen.queryByLabelText("数量")).toBeNull();

    await user.selectOptions(target, "trade:BTC");

    expect(screen.queryByLabelText("现金类型")).toBeNull();
    expect(screen.getByLabelText("数量")).not.toBeNull();
    expect(screen.getByText("新增 BTC 交易")).not.toBeNull();

    await user.selectOptions(target, "asset-transfer");
    expect(screen.queryByLabelText("现金类型")).toBeNull();
    expect(screen.queryByText("新增 BTC 交易")).toBeNull();
    expect(screen.getByLabelText("转移类别")).not.toBeNull();
    expect(screen.getByLabelText("数量")).not.toBeNull();

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

  it("keeps form drafts below the dashboard boundary while switching targets", async () => {
    const onDraftStatusChange = vi.fn();
    renderWorkspace(onDraftStatusChange);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("记账对象"), "trade:BTC");
    await user.type(screen.getByLabelText("数量"), "2");
    await user.type(screen.getByLabelText("成交均价"), "30");
    expect(onDraftStatusChange).toHaveBeenLastCalledWith(true);

    await user.selectOptions(screen.getByLabelText("记账对象"), "cash:USDT");
    await user.selectOptions(screen.getByLabelText("记账对象"), "trade:BTC");

    expect((screen.getByLabelText("数量") as HTMLInputElement).value).toBe("2");
    expect((screen.getByLabelText("成交均价") as HTMLInputElement).value).toBe(
      "30",
    );
  });

  it("does not rerender its parent while a trade input is edited", async () => {
    const replaySpy = vi.spyOn(calculations, "replayUsdtCash");
    let parentRenderCount = 0;
    function DashboardBoundary() {
      parentRenderCount += 1;
      return <RecordWorkspace {...workspaceProps(vi.fn())} />;
    }
    render(<DashboardBoundary />);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("记账对象"), "trade:BTC");
    const renderCountBeforeTyping = parentRenderCount;
    replaySpy.mockClear();
    await user.type(screen.getByLabelText("成交均价"), "30");
    await user.clear(screen.getByLabelText("成交均价"));

    expect(parentRenderCount).toBe(renderCountBeforeTyping);
    expect(replaySpy).not.toHaveBeenCalled();
  });
});

function renderWorkspace(onDraftStatusChange = vi.fn()) {
  return render(<RecordWorkspace {...workspaceProps(onDraftStatusChange)} />);
}

function workspaceProps(onDraftStatusChange: (hasDrafts: boolean) => void) {
  const ledgerData = createInitialLedgerData();
  return {
    active: true,
    clock,
    focusIntent: null,
    isWritable: true,
    ledgerData,
    ledgerEpoch: 1,
    marketDataPanel: null,
    mutationVersion: 0,
    onCashEventCreated: vi.fn(() => "applied" as const),
    onCashEventDeleted: vi.fn(() => "applied" as const),
    onAssetTransferCreated: vi.fn(() => "applied" as const),
    onAssetTransferDeleted: vi.fn(() => "applied" as const),
    onDraftStatusChange,
    onIntentConsumed: vi.fn(),
    onPriceSnapshotCreated: vi.fn(() => "applied" as const),
    onTradeCreated: vi.fn(() => "applied" as const),
    persistedVersion: 0,
    persistenceStatus: "saved",
  } satisfies ComponentProps<typeof RecordWorkspace>;
}

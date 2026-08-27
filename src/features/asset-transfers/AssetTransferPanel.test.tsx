// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetTransfer, LedgerData } from "@/core/models";
import type { LedgerClock } from "@/core/shared";
import { createInitialLedgerData } from "@/core/state";
import { AssetTransferPanel } from "./AssetTransferPanel";

const clock: LedgerClock = {
  now: () => new Date("2026-08-18T08:00:00.000Z"),
};

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "transfer-new") });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AssetTransferPanel", () => {
  it("shows only the fields applicable to the selected category", async () => {
    renderPanel();
    const user = userEvent.setup();
    const category = screen.getByLabelText("转移类别");

    expect(screen.getByLabelText("来源位置")).not.toBeNull();
    expect(screen.getByLabelText("目的位置")).not.toBeNull();
    expect(screen.getByLabelText("链上手续费（资产计价，可选）")).not.toBeNull();
    expect(screen.queryByLabelText("到账单价（USDT）")).toBeNull();

    await user.selectOptions(category, "external-in");
    expect(screen.queryByLabelText("来源位置")).toBeNull();
    expect(screen.getByLabelText("目的位置")).not.toBeNull();
    expect(screen.getByLabelText("到账单价（USDT）")).not.toBeNull();
    expect(screen.queryByLabelText("链上手续费（资产计价，可选）")).toBeNull();

    await user.selectOptions(category, "external-out");
    expect(screen.getByLabelText("来源位置")).not.toBeNull();
    expect(screen.queryByLabelText("目的位置")).toBeNull();
    expect(screen.queryByLabelText("到账单价（USDT）")).toBeNull();
    expect(screen.getByLabelText("链上手续费（资产计价，可选）")).not.toBeNull();

    await user.selectOptions(category, "gain");
    expect(screen.queryByLabelText("来源位置")).toBeNull();
    expect(screen.getByLabelText("目的位置")).not.toBeNull();
    expect(screen.getByLabelText("到账单价（USDT）")).not.toBeNull();
    expect(screen.queryByLabelText("链上手续费（资产计价，可选）")).toBeNull();
  });

  it("constructs a category-specific object without hidden fields", async () => {
    const onCreate = vi.fn<
      Parameters<typeof AssetTransferPanel>[0]["onAssetTransferCreated"]
    >(() => "applied" as const);
    renderPanel({ onCreate });
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText("链上手续费（资产计价，可选）"),
      "0.1",
    );
    await user.selectOptions(screen.getByLabelText("转移类别"), "external-in");
    await user.type(screen.getByLabelText("数量"), "2");
    await user.type(screen.getByLabelText("到账单价（USDT）"), "4");
    await user.click(screen.getByRole("button", { name: "保存资产转入转出" }));

    expect(onCreate).toHaveBeenCalledOnce();
    const created = onCreate.mock.calls[0]?.[0] as AssetTransfer;
    expect(created).toMatchObject({
      id: "transfer-new",
      category: "external-in",
      reason: "deposit",
      assetSymbol: "BTC",
      quantity: "2",
      unitPrice: "4",
      toLocation: "cold-wallet",
    });
    expect(created).not.toHaveProperty("fromLocation");
    expect(created).not.toHaveProperty("networkFee");
  });

  it("T2-02/T2-03 keeps transfer input and saved decimal characters unchanged", async () => {
    const quantity = "0.036198180000000001";
    const unitPrice = "4.000000000000000001";
    const onCreate = vi.fn<
      Parameters<typeof AssetTransferPanel>[0]["onAssetTransferCreated"]
    >(() => "applied" as const);
    renderPanel({ onCreate });
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("转移类别"), "external-in");
    await user.type(screen.getByLabelText("数量"), quantity);
    await user.type(screen.getByLabelText("到账单价（USDT）"), unitPrice);

    expect((screen.getByLabelText("数量") as HTMLInputElement).value).toBe(quantity);
    expect((screen.getByLabelText("到账单价（USDT）") as HTMLInputElement).value)
      .toBe(unitPrice);

    await user.click(screen.getByRole("button", { name: "保存资产转入转出" }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ quantity, unitPrice }),
      expect.anything(),
    );
  });

  it("formats transfer quantities, asset fees, and arrival prices only in the fact list", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assetTransfers = [
      {
        ...savedTransfer(),
        quantity: "2.000000000000000001",
        unitPrice: "594.862375883946480045",
      },
      {
        id: "saved-external-out",
        occurredAt: "2026-08-18",
        timePrecision: "day",
        assetSymbol: "BTC",
        quantity: "0.6177",
        category: "external-out",
        reason: "withdrawal",
        networkFee: "0.000300000000000001",
        fromLocation: "exchange",
        createdAt: "2026-08-18T08:00:00.000Z",
        updatedAt: "2026-08-18T08:00:00.000Z",
      },
    ];

    renderPanel({ ledgerData });

    expect(screen.getByTitle("2.000000000000000001").textContent).toBe("2");
    expect(screen.getByTitle("594.862375883946480045").textContent).toBe("594.86");
    expect(screen.getByTitle("0.6177").textContent).toBe("0.6177");
    expect(screen.getByTitle("0.000300000000000001").textContent).toBe("0.0003");
  });

  it("renders Chinese field errors beside and linked to the invalid control", async () => {
    renderPanel();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("转移类别"), "gain");
    await user.type(screen.getByLabelText("数量"), "2");
    await user.click(screen.getByRole("button", { name: "保存资产转入转出" }));

    const unitPrice = screen.getByLabelText("到账单价（USDT）");
    expect(screen.getByText(/必须填写大于 0 的到账单价/)).not.toBeNull();
    expect(unitPrice.getAttribute("aria-describedby")).toBe(
      "asset-transfer-error-unitPrice",
    );
  });

  it("retains the draft until authenticated save and clears it only after persistence", async () => {
    const ledgerData = createInitialLedgerData();
    const onCreate = vi.fn(() => "applied" as const);
    const view = renderPanel({ ledgerData, onCreate });
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("转移类别"), "external-in");
    await user.type(screen.getByLabelText("数量"), "2");
    await user.type(screen.getByLabelText("到账单价（USDT）"), "4");
    await user.type(screen.getByLabelText("备注（可选）"), "test note");
    await user.click(screen.getByRole("button", { name: "保存资产转入转出" }));

    expect((screen.getByLabelText("数量") as HTMLInputElement).value).toBe("2");
    expect(screen.getByText("正在保存资产转移…")).not.toBeNull();

    view.rerender(
      panel({
        ledgerData,
        mutationVersion: 1,
        persistedVersion: 1,
        onCreate,
      }),
    );
    await waitFor(() => {
      expect((screen.getByLabelText("数量") as HTMLInputElement).value).toBe("");
      expect(screen.getByText("资产转移已认证保存")).not.toBeNull();
    });
    expect((screen.getByLabelText("到账单价（USDT）") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("备注（可选）") as HTMLInputElement).value).toBe("");
  });

  it("retains the draft and announces an authenticated-save failure", async () => {
    const ledgerData = createInitialLedgerData();
    const onCreate = vi.fn(() => "applied" as const);
    const view = renderPanel({ ledgerData, onCreate });
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("转移类别"), "external-in");
    await user.type(screen.getByLabelText("数量"), "3");
    await user.type(screen.getByLabelText("到账单价（USDT）"), "5");
    await user.click(screen.getByRole("button", { name: "保存资产转入转出" }));

    view.rerender(
      panel({
        ledgerData,
        mutationVersion: 1,
        persistedVersion: 0,
        persistenceStatus: "error",
        onCreate,
      }),
    );
    await waitFor(() => {
      expect(screen.getByText(/仍在内存中，但尚未保存/)).not.toBeNull();
    });
    expect((screen.getByLabelText("数量") as HTMLInputElement).value).toBe("3");
    expect((screen.getByLabelText("到账单价（USDT）") as HTMLInputElement).value).toBe("5");
  });

  it("has a logical keyboard order and submits from the keyboard", async () => {
    const onCreate = vi.fn(() => "applied" as const);
    renderPanel({ onCreate });
    const user = userEvent.setup();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("转移类别"));
    await user.selectOptions(document.activeElement as Element, "external-in");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("资产"));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("原因"));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("数量"));
    await user.type(document.activeElement as Element, "2");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("目的位置"));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("到账单价（USDT）"));
    await user.type(document.activeElement as Element, "4");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("日期"));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("备注（可选）"));
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "保存资产转入转出" }),
    );
    await user.keyboard("{Enter}");
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("requires two activations before deleting a named transfer", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assetTransfers = [savedTransfer()];
    const onDelete = vi.fn(() => "applied" as const);
    renderPanel({ ledgerData, onDelete });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(onDelete).toHaveBeenCalledWith(
      "saved-transfer",
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
  persistenceStatus = "saved",
  onCreate = vi.fn(() => "applied" as const),
  onDelete = vi.fn(() => "applied" as const),
}: {
  ledgerData?: LedgerData;
  mutationVersion?: number;
  persistedVersion?: number;
  persistenceStatus?: Parameters<typeof AssetTransferPanel>[0]["persistenceStatus"];
  onCreate?: Parameters<typeof AssetTransferPanel>[0]["onAssetTransferCreated"];
  onDelete?: Parameters<typeof AssetTransferPanel>[0]["onAssetTransferDeleted"];
} = {}) {
  return (
    <AssetTransferPanel
      clock={clock}
      isWritable
      ledgerData={ledgerData}
      ledgerEpoch={1}
      mutationVersion={mutationVersion}
      onAssetTransferCreated={onCreate}
      onAssetTransferDeleted={onDelete}
      persistedVersion={persistedVersion}
      persistenceStatus={persistenceStatus}
    />
  );
}

function savedTransfer(): AssetTransfer {
  return {
    id: "saved-transfer",
    occurredAt: "2026-08-17",
    timePrecision: "day",
    assetSymbol: "BTC",
    quantity: "2",
    category: "external-in",
    reason: "deposit",
    unitPrice: "4",
    toLocation: "exchange",
    createdAt: "2026-08-17T08:00:00.000Z",
    updatedAt: "2026-08-17T08:00:00.000Z",
  };
}

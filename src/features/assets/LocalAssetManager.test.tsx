// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Asset, LedgerData } from "@/core/models";
import type { LedgerClock } from "@/core/shared";
import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade } from "@/test-support";
import { LocalAssetManager } from "./LocalAssetManager";

const TIMESTAMP = "2026-08-18T08:00:00.000Z";
const clock: LedgerClock = {
  now: () => new Date(TIMESTAMP),
};

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "asset-new") });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LocalAssetManager", () => {
  it("creates a normalized local asset with zero fetch calls", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const onAssetCreated = vi.fn(() => "applied" as const);
    renderManager({ onAssetCreated });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("新增本地资产代码"), " sol ");
    await user.click(screen.getByRole("button", { name: "新增本地资产" }));

    expect(onAssetCreated).toHaveBeenCalledWith(
      {
        id: "asset-new",
        symbol: "SOL",
        name: "SOL",
        quoteCurrency: "USDT",
        binanceMapping: null,
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
      expect.objectContaining({ todayKey: "2026-08-18" }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows stable validation codes without mutating", async () => {
    const onAssetCreated = vi.fn(() => "applied" as const);
    renderManager({ onAssetCreated });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("新增本地资产代码"), "USDT");
    await user.click(screen.getByRole("button", { name: "新增本地资产" }));

    expect(screen.getByText(/ASSET_RESERVED_SYMBOL/)).not.toBeNull();
    expect(onAssetCreated).not.toHaveBeenCalled();
  });

  it("blocks deletion with every dependency path and never cascades", async () => {
    const ledgerData = ledgerWithSol();
    ledgerData.trades = [
      createUsdtSimpleTrade("trade-sol", "buy", "SOL", "1", "2026-08-18"),
    ];
    ledgerData.priceSnapshots = [
      {
        id: "price-sol",
        assetSymbol: "SOL",
        price: "150",
        currency: "USDT",
        recordedAt: "2026-08-18",
        source: "manual",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ];
    ledgerData.feeRules = [
      {
        id: "fee-sol",
        name: "SOL fee",
        platform: "Binance",
        assetSymbol: "SOL",
        status: "inactive",
        type: "fixed",
        amount: "1",
        currency: "USDT",
        deactivatedAt: TIMESTAMP,
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ];
    const onAssetDeleted = vi.fn(() => "applied" as const);
    renderManager({ ledgerData, onAssetDeleted });
    const user = userEvent.setup();
    const button = screen.getByRole("button", {
      name: "删除本地资产 SOL",
    });

    expect(screen.getByText("150 USDT · 手动")).not.toBeNull();
    await user.click(button);
    await user.click(button);

    const error = screen.getByText(/ASSET_DEPENDENCY_EXISTS/);
    expect(error.textContent).toContain("trades[0].assetSymbol");
    expect(error.textContent).toContain("priceSnapshots[0].assetSymbol");
    expect(error.textContent).toContain("feeRules[0].assetSymbol");
    expect(onAssetDeleted).not.toHaveBeenCalled();
  });

  it("deletes an empty mapped asset without treating the mapping as a dependency", async () => {
    const ledgerData = ledgerWithSol({
      provider: "binance",
      symbol: "SOLUSDT",
      baseAsset: "SOL",
      quoteAsset: "USDT",
    });
    const onAssetDeleted = vi.fn(() => "applied" as const);
    renderManager({ ledgerData, onAssetDeleted });
    const user = userEvent.setup();

    expect(screen.getByText("SOLUSDT")).not.toBeNull();
    const button = screen.getByRole("button", {
      name: "删除本地资产 SOL",
    });
    await user.click(button);
    await user.click(button);

    expect(onAssetDeleted).toHaveBeenCalledWith(
      "SOL",
      expect.objectContaining({ todayKey: "2026-08-18" }),
    );
  });
});

function renderManager({
  ledgerData = createInitialLedgerData(),
  onAssetCreated = vi.fn(() => "applied" as const),
  onAssetDeleted = vi.fn(() => "applied" as const),
}: {
  ledgerData?: LedgerData;
  onAssetCreated?: Parameters<typeof LocalAssetManager>[0]["onAssetCreated"];
  onAssetDeleted?: Parameters<typeof LocalAssetManager>[0]["onAssetDeleted"];
} = {}) {
  return render(
    <LocalAssetManager
      clock={clock}
      isWritable
      ledgerData={ledgerData}
      ledgerEpoch={1}
      mutationVersion={0}
      onAssetCreated={onAssetCreated}
      onAssetDeleted={onAssetDeleted}
      persistedVersion={0}
      persistenceStatus="saved"
    />,
  );
}

function ledgerWithSol(
  binanceMapping: Asset["binanceMapping"] = null,
): LedgerData {
  const ledgerData = createInitialLedgerData();
  ledgerData.assets.push({
    id: "asset-sol",
    symbol: "SOL",
    name: "SOL",
    quoteCurrency: "USDT",
    binanceMapping,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  });
  return ledgerData;
}

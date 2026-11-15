// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssetTransfer, LedgerData } from "@/core/models";
import type { LedgerClock } from "@/core/shared";
import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade as createSimpleTrade } from "@/test-support";
import { LanguageProvider, translate, type LedgerLanguage } from "@/ui";
import { AssetTransferPanel } from "../AssetTransferPanel";
import { validateAssetTransferRemoval } from "../assetTransferService";

/**
 * 04B scenario 4: transfer form errors, including the "unit price" and
 * "network fee" names spliced into a sentence, and the explanation when a
 * deletion would break the holding timeline, follow the interface language.
 */
const HAN = /[㐀-䶿一-鿿]/u;
const clock: LedgerClock = { now: () => new Date("2026-08-18T08:00:00.000Z") };

afterEach(() => {
  cleanup();
});

function memoryStorage(language: LedgerLanguage) {
  let value: string = language;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

function hanFreeLedger(): LedgerData {
  const ledgerData = createInitialLedgerData();
  ledgerData.assets = ledgerData.assets.map((asset) => ({
    ...asset,
    name: asset.symbol,
  }));
  return ledgerData;
}

function arrival(): AssetTransfer {
  return {
    id: "arrival",
    occurredAt: "2026-08-10",
    timePrecision: "day",
    assetSymbol: "BTC",
    quantity: "2",
    category: "external-in",
    reason: "deposit",
    unitPrice: "4",
    toLocation: "exchange",
    createdAt: "2026-08-10T08:00:00.000Z",
    updatedAt: "2026-08-10T08:00:00.000Z",
  };
}

function renderIn(language: LedgerLanguage, ledgerData = hanFreeLedger()) {
  const onCreate = vi.fn(() => "applied" as const);
  const onDelete = vi.fn(() => "applied" as const);
  render(
    <LanguageProvider storage={memoryStorage(language)}>
      <AssetTransferPanel
        clock={clock}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={0}
        onAssetTransferCreated={onCreate}
        onAssetTransferDeleted={onDelete}
        persistedVersion={0}
        persistenceStatus="saved"
      />
    </LanguageProvider>,
  );
  return { onCreate, onDelete };
}

const label = (key: Parameters<typeof translate>[1]) => translate("en", key);

describe("asset transfer errors follow the interface language", () => {
  it("names the unit price in English when it is not a positive number", async () => {
    const { onCreate } = renderIn("en");
    const user = userEvent.setup();
    await user.selectOptions(
      await screen.findByLabelText(label("assetTransfers.field.category")),
      "external-in",
    );
    await user.type(screen.getByLabelText(label("assetTransfers.field.quantity")), "2");
    await user.type(screen.getByLabelText(label("assetTransfers.field.unitPrice")), "0");
    await user.click(screen.getByRole("button", { name: label("assetTransfers.action.save") }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      label("assetTransfer.validation.unitPrice") +
        label("assetTransfer.validation.positiveDecimalSuffix"),
    );
    expect(document.body.textContent).not.toMatch(HAN);
  });

  it("names the network fee in English when it is not a positive number", async () => {
    const { onCreate } = renderIn("en");
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText(label("assetTransfers.field.quantity")),
      "1",
    );
    await user.type(screen.getByLabelText(label("assetTransfers.field.networkFee")), "0");
    await user.click(screen.getByRole("button", { name: label("assetTransfers.action.save") }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      label("assetTransfer.validation.networkFee") +
        label("assetTransfer.validation.positiveDecimalSuffix"),
    );
    expect(document.body.textContent).not.toMatch(HAN);
  });

  it("explains in English why a transfer the timeline depends on cannot be deleted", async () => {
    const ledgerData = hanFreeLedger();
    ledgerData.assetTransfers = [arrival()];
    ledgerData.trades = [
      createSimpleTrade("sell-after", "sell", "BTC", "2", "2026-08-12"),
    ];
    const { onDelete } = renderIn("en", ledgerData);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: label("assetTransfers.action.delete") }),
    );
    await user.click(
      screen.getByRole("button", { name: label("assetTransfers.action.confirmDelete") }),
    );

    expect(onDelete).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      label("assetTransfer.validation.removalBreaksTimeline"),
    );
    expect(document.body.textContent).not.toMatch(HAN);
  });

  it("gives the same English explanation to the dashboard's removal check", () => {
    const ledgerData = hanFreeLedger();
    ledgerData.assetTransfers = [arrival()];
    ledgerData.trades = [
      createSimpleTrade("sell-after", "sell", "BTC", "2", "2026-08-12"),
    ];
    const english = (key: Parameters<typeof translate>[1]) => translate("en", key);

    expect(validateAssetTransferRemoval("arrival", ledgerData, english)).toEqual({
      ok: false,
      error: expect.objectContaining({
        message: label("assetTransfer.validation.removalBreaksTimeline"),
      }),
    });
  });
});

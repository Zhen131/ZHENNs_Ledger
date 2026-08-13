// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PersistenceStatus,
  PriceWorkspaceDraft,
} from "@/app";
import type { LedgerClock } from "@/core/shared";
import { createInitialLedgerData } from "@/core/state";
import { PriceForm } from "./PriceForm";

afterEach(cleanup);

const clock: LedgerClock = {
  now: () => new Date("2026-07-25T12:00:00Z"),
};

const initialDraft: PriceWorkspaceDraft = {
  assetSymbol: "BTC",
  price: "",
  recordedAt: "2026-07-25",
  note: "",
};

function ControlledPriceForm({
  mutationVersion = 0,
  persistedVersion = 0,
  persistenceStatus = "saved",
  onPriceSnapshotCreated = vi.fn(() => "applied" as const),
}: Readonly<{
  mutationVersion?: number;
  persistedVersion?: number;
  persistenceStatus?: PersistenceStatus;
  onPriceSnapshotCreated?: Parameters<
    typeof PriceForm
  >[0]["onPriceSnapshotCreated"];
}>) {
  const [draft, setDraft] = useState(initialDraft);

  return (
    <>
      <PriceForm
        clock={clock}
        draft={draft}
        ledgerData={createInitialLedgerData()}
        ledgerEpoch={1}
        mutationVersion={mutationVersion}
        onDraftChange={setDraft}
        onPriceSnapshotCreated={onPriceSnapshotCreated}
        onReset={({ assetSymbol, recordedAt }) =>
          setDraft({
            ...initialDraft,
            assetSymbol,
            recordedAt,
          })
        }
        persistedVersion={persistedVersion}
        persistenceStatus={persistenceStatus}
      />
      <output data-testid="price-draft">{JSON.stringify(draft)}</output>
    </>
  );
}

describe("PriceForm", () => {
  it("shows the quote currency as a suffix and starts from today's date", () => {
    render(<ControlledPriceForm />);

    expect(
      (screen.getByLabelText("价格日期") as HTMLInputElement).value,
    ).toBe("2026-07-25");
    expect(screen.getByLabelText("价格计价货币 USDT").textContent).toBe(
      "USDT",
    );
    expect(screen.queryByLabelText("计价货币")).toBeNull();
  });

  it("retains a failed pending fact and remembers its date only after authenticated persistence", async () => {
    const onPriceSnapshotCreated = vi.fn(() => "applied" as const);
    const view = render(
      <ControlledPriceForm
        mutationVersion={8}
        onPriceSnapshotCreated={onPriceSnapshotCreated}
        persistedVersion={8}
        persistenceStatus="saved"
      />,
    );
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("当前价格"), "80000");
    await user.clear(screen.getByLabelText("价格日期"));
    await user.type(screen.getByLabelText("价格日期"), "2026-07-24");
    await user.type(screen.getByLabelText("价格备注"), "manual close");
    await user.click(screen.getByRole("button", { name: "保存价格" }));

    const pendingButton = screen.getByRole("button", { name: "正在保存…" });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);
    await user.click(pendingButton);
    expect(onPriceSnapshotCreated).toHaveBeenCalledOnce();
    expect(screen.getByTestId("price-draft").textContent).toContain(
      '"price":"80000"',
    );

    view.rerender(
      <ControlledPriceForm
        mutationVersion={9}
        onPriceSnapshotCreated={onPriceSnapshotCreated}
        persistedVersion={8}
        persistenceStatus="error"
      />,
    );
    expect(
      await screen.findByText("价格仍在内存中，但尚未保存；请重试保存"),
    ).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: "正在保存…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(onPriceSnapshotCreated).toHaveBeenCalledOnce();

    view.rerender(
      <ControlledPriceForm
        mutationVersion={9}
        onPriceSnapshotCreated={onPriceSnapshotCreated}
        persistedVersion={9}
        persistenceStatus="saved"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("价格已认证保存")).not.toBeNull();
      expect(screen.getByTestId("price-draft").textContent).toContain(
        '"price":""',
      );
    });
    const resetDraft = JSON.parse(
      screen.getByTestId("price-draft").textContent ?? "{}",
    ) as PriceWorkspaceDraft;
    expect(resetDraft).toEqual({
      assetSymbol: "BTC",
      price: "",
      recordedAt: "2026-07-24",
      note: "",
    });
  });
});

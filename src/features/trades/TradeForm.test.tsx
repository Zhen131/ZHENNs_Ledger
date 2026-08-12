// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PersistenceStatus,
  TradeWorkspaceDraft,
} from "@/app";
import type { LedgerData } from "@/core/models";
import type { LedgerClock } from "@/core/shared";
import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade } from "@/test-support";
import { TradeForm } from "./TradeForm";

afterEach(cleanup);

const clock: LedgerClock = {
  now: () => new Date("2026-07-25T12:00:00Z"),
};

function createLedger(): LedgerData {
  const ledgerData = createInitialLedgerData();
  ledgerData.trades = [
    createUsdtSimpleTrade("existing-btc", "buy", "BTC", "2", "2026-07-20"),
  ];
  ledgerData.feeRules = [
    {
      id: "binance-btc",
      name: "Binance BTC",
      platform: "Binance",
      assetSymbol: "BTC",
      status: "active",
      type: "percentage",
      rate: "0.001",
      currency: "USDT",
      createdAt: "2026-07-20T00:00:00Z",
      updatedAt: "2026-07-20T00:00:00Z",
    },
    {
      id: "binance-eth",
      name: "Binance ETH",
      platform: "Binance",
      assetSymbol: "ETH",
      status: "active",
      type: "percentage",
      rate: "0.001",
      currency: "USDT",
      createdAt: "2026-07-20T00:00:00Z",
      updatedAt: "2026-07-20T00:00:00Z",
    },
    {
      id: "okx-btc",
      name: "OKX BTC",
      platform: "OKX",
      assetSymbol: "BTC",
      status: "active",
      type: "fixed",
      amount: "1",
      currency: "USDT",
      createdAt: "2026-07-20T00:00:00Z",
      updatedAt: "2026-07-20T00:00:00Z",
    },
  ];
  return ledgerData;
}

const initialDraft: TradeWorkspaceDraft = {
  type: "buy",
  assetSymbol: "BTC",
  quantity: "",
  price: "",
  totalValue: "",
  totalValueMode: "auto",
  occurredAt: "2026-07-25",
  fee: "0",
  platform: "",
  note: "",
  noteExpanded: false,
};

function ControlledTradeForm({
  mutationVersion = 0,
  persistedVersion = 0,
  persistenceStatus = "saved",
  onTradeCreated = vi.fn(() => "applied" as const),
}: Readonly<{
  mutationVersion?: number;
  persistedVersion?: number;
  persistenceStatus?: PersistenceStatus;
  onTradeCreated?: Parameters<typeof TradeForm>[0]["onTradeCreated"];
}>) {
  const [draft, setDraft] = useState(initialDraft);

  return (
    <>
      <TradeForm
        clock={clock}
        draft={draft}
        ledgerData={createLedger()}
        ledgerEpoch={1}
        mutationVersion={mutationVersion}
        onDraftChange={setDraft}
        onReset={({ assetSymbol, platform }) =>
          setDraft({
            ...initialDraft,
            assetSymbol,
            platform,
          })
        }
        onTradeCreated={onTradeCreated}
        persistedVersion={persistedVersion}
        persistenceStatus={persistenceStatus}
      />
      <output data-testid="trade-draft">{JSON.stringify(draft)}</output>
    </>
  );
}

describe("TradeForm", () => {
  it("keeps a controlled draft while switching type and makes auto totals explicitly reversible", async () => {
    render(<ControlledTradeForm />);
    const user = userEvent.setup();
    const quantity = screen.getByLabelText("数量") as HTMLInputElement;
    const price = screen.getByLabelText("成交均价") as HTMLInputElement;
    const total = screen.getByLabelText(
      "成交金额（不含手续费）",
    ) as HTMLInputElement;

    expect((screen.getByLabelText("日期") as HTMLInputElement).value).toBe(
      "2026-07-25",
    );
    await user.type(quantity, "0.1");
    await user.type(price, "100");
    expect(total.value).toBe("10");
    expect(screen.getByText("自动")).not.toBeNull();

    await user.selectOptions(screen.getByLabelText("类型"), "sell");
    expect(quantity.value).toBe("0.1");
    expect(price.value).toBe("100");

    await user.clear(total);
    await user.type(total, "12");
    await user.clear(quantity);
    await user.type(quantity, "0.2");
    expect(total.value).toBe("12");
    expect(screen.getByText("手动")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "重新计算" }));
    expect(total.value).toBe("20");
    expect(screen.getByText("自动")).not.toBeNull();

    expect(screen.queryByLabelText("备注")).toBeNull();
    await user.click(screen.getByRole("button", { name: "＋ 添加备注" }));
    await user.type(screen.getByLabelText("备注"), "保留这段草稿");
    expect(screen.getByTestId("trade-draft").textContent).toContain(
      "保留这段草稿",
    );
  });

  it("deduplicates platform suggestions while preserving freehand input", async () => {
    render(<ControlledTradeForm />);
    const user = userEvent.setup();
    const suggestions = Array.from(
      document.querySelectorAll<HTMLDataListElement>(
        "#ledger-platform-suggestions option",
      ),
    ).map((option) => option.getAttribute("value"));

    expect(suggestions).toEqual(["Binance", "OKX"]);
    await user.type(screen.getByLabelText("数量"), "1");
    await user.type(screen.getByLabelText("成交均价"), "10");
    await user.type(
      screen.getByLabelText("平台（可选，精确匹配）"),
      "Desk OTC",
    );
    expect(screen.getByTestId("trade-draft").textContent).toContain(
      "Desk OTC",
    );
    expect(screen.getByText(/无精确匹配规则/)).not.toBeNull();
  });

  it("accepts one pending trade, retains its draft on failure, and resets only after authenticated persistence", async () => {
    const onTradeCreated = vi.fn(() => "applied" as const);
    const view = render(
      <ControlledTradeForm
        mutationVersion={4}
        onTradeCreated={onTradeCreated}
        persistedVersion={4}
        persistenceStatus="saved"
      />,
    );
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("类型"), "sell");
    await user.type(screen.getByLabelText("数量"), "0.5");
    await user.type(screen.getByLabelText("成交均价"), "10");
    await user.type(
      screen.getByLabelText("平台（可选，精确匹配）"),
      "Desk OTC",
    );
    await user.click(screen.getByRole("button", { name: "保存交易" }));

    const pendingButton = screen.getByRole("button", { name: "正在保存…" });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);
    await user.click(pendingButton);
    expect(onTradeCreated).toHaveBeenCalledOnce();
    expect(screen.getByTestId("trade-draft").textContent).toContain('"quantity":"0.5"');

    view.rerender(
      <ControlledTradeForm
        mutationVersion={5}
        onTradeCreated={onTradeCreated}
        persistedVersion={4}
        persistenceStatus="error"
      />,
    );
    expect(
      await screen.findByText("交易仍在内存中，但尚未保存；请重试保存"),
    ).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: "正在保存…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(onTradeCreated).toHaveBeenCalledOnce();

    view.rerender(
      <ControlledTradeForm
        mutationVersion={5}
        onTradeCreated={onTradeCreated}
        persistedVersion={5}
        persistenceStatus="saved"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("交易已认证保存")).not.toBeNull();
      expect(screen.getByTestId("trade-draft").textContent).toContain(
        '"quantity":""',
      );
    });
    const resetDraft = JSON.parse(
      screen.getByTestId("trade-draft").textContent ?? "{}",
    ) as TradeWorkspaceDraft;
    expect(resetDraft).toMatchObject({
      type: "buy",
      assetSymbol: "BTC",
      occurredAt: "2026-07-25",
      platform: "Desk OTC",
      totalValueMode: "auto",
      note: "",
    });
  });
});

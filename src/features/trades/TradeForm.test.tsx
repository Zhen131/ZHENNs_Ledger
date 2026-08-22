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
  feeCurrency: "USDT",
  platform: "",
  note: "",
  noteExpanded: false,
};

function ControlledTradeForm({
  ledgerData = createLedger(),
  mutationVersion = 0,
  persistedVersion = 0,
  persistenceStatus = "saved",
  onTradeCreated = vi.fn(() => "applied" as const),
}: Readonly<{
  ledgerData?: LedgerData;
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
        ledgerData={ledgerData}
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

  it("shows and persists a local-asset fee without deducting it from USDT cash", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.cashEvents = [cashDeposit("fee-cover", "100")];
    const onTradeCreated = vi.fn(() => "applied" as const);
    render(
      <ControlledTradeForm
        ledgerData={ledgerData}
        onTradeCreated={onTradeCreated}
      />,
    );
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("数量"), "1");
    await user.type(screen.getByLabelText("成交均价"), "10");
    await user.clear(screen.getByLabelText("实际手续费"));
    await user.type(screen.getByLabelText("实际手续费"), "0.1");
    await user.selectOptions(screen.getByLabelText("手续费币种"), "BTC");

    expect(screen.getByText("本次现金变化：-10 USDT")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "保存交易" }));

    expect(onTradeCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        fee: "0.1",
        feeCurrency: "BTC",
        totalValue: "10",
      }),
      expect.anything(),
    );
  });

  it("explains when a same-asset buy fee would consume the whole purchase", async () => {
    const onTradeCreated = vi.fn(() => "applied" as const);
    render(<ControlledTradeForm onTradeCreated={onTradeCreated} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("数量"), "1");
    await user.type(screen.getByLabelText("成交均价"), "10");
    await user.clear(screen.getByLabelText("实际手续费"));
    await user.type(screen.getByLabelText("实际手续费"), "1");
    await user.selectOptions(screen.getByLabelText("手续费币种"), "BTC");
    await user.click(screen.getByRole("button", { name: "保存交易" }));

    expect(
      screen.getByText(
        "以交易资产支付买入手续费时，手续费必须小于买入数量",
      ),
    ).not.toBeNull();
    expect(onTradeCreated).not.toHaveBeenCalled();
  });

  it("keeps a negative trade at zero mutation until keyboard-safe confirmation", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.cashEvents = [cashDeposit("small-cover", "5")];
    const onTradeCreated = vi.fn(() => "applied" as const);
    render(
      <ControlledTradeForm
        ledgerData={ledgerData}
        onTradeCreated={onTradeCreated}
      />,
    );
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("数量"), "1");
    await user.type(screen.getByLabelText("成交均价"), "10");
    const trigger = screen.getByRole("button", { name: "保存交易" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "确认交易后的负现金" });
    expect(dialog.textContent).toContain("保存后余额-5 USDT");
    expect(onTradeCreated).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "确认并保存" }),
    );

    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(onTradeCreated).not.toHaveBeenCalled();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "确认并保存" }));
    expect(onTradeCreated).toHaveBeenCalledOnce();
  });

  it("invalidates a negative-trade confirmation when the ledger version changes", async () => {
    const ledgerData = createInitialLedgerData();
    const onTradeCreated = vi.fn(() => "applied" as const);
    const view = render(
      <ControlledTradeForm
        ledgerData={ledgerData}
        mutationVersion={0}
        onTradeCreated={onTradeCreated}
      />,
    );
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("数量"), "1");
    await user.type(screen.getByLabelText("成交均价"), "10");
    await user.click(screen.getByRole("button", { name: "保存交易" }));
    expect(screen.getByRole("dialog")).not.toBeNull();

    view.rerender(
      <ControlledTradeForm
        ledgerData={ledgerData}
        mutationVersion={1}
        onTradeCreated={onTradeCreated}
        persistenceStatus="saving"
      />,
    );
    await user.click(screen.getByRole("button", { name: "确认并保存" }));

    expect(onTradeCreated).not.toHaveBeenCalled();
    expect(screen.getByText(/旧确认已失效/)).not.toBeNull();
  });
});

function cashDeposit(
  id: string,
  amount: string,
): LedgerData["cashEvents"][number] {
  return {
    id,
    occurredAt: "2026-07-20",
    timePrecision: "day",
    type: "deposit",
    currency: "USDT",
    amount,
    createdAt: "2026-07-20T12:00:00.000Z",
    updatedAt: "2026-07-20T12:00:00.000Z",
  };
}

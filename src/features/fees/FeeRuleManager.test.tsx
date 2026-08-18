// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FeeRule, LedgerData } from "@/core/models";
import type { LedgerClock } from "@/core/shared";
import { createInitialLedgerData } from "@/core/state";
import { FeeRuleManager } from "./FeeRuleManager";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const clock: LedgerClock = {
  now: () => new Date("2026-07-25T12:00:00Z"),
};

const rule: FeeRule = {
  id: "rule-old",
  name: "Binance BTC",
  platform: "Binance",
  assetSymbol: "BTC",
  status: "active",
  type: "percentage",
  rate: "0.001",
  currency: "USDT",
  createdAt: "2026-07-20T00:00:00Z",
  updatedAt: "2026-07-20T00:00:00Z",
};

function renderManager({
  feeRules = [] as FeeRule[],
  sourceLedgerData,
  onAction = vi.fn<
    Parameters<typeof FeeRuleManager>[0]["onAction"]
  >(() => "applied" as const),
  mutationVersion = 0,
  persistedVersion = 0,
  persistenceStatus = "saved" as const,
}: {
  feeRules?: FeeRule[];
  sourceLedgerData?: LedgerData;
  onAction?: Parameters<typeof FeeRuleManager>[0]["onAction"];
  mutationVersion?: number;
  persistedVersion?: number;
  persistenceStatus?: Parameters<
    typeof FeeRuleManager
  >[0]["persistenceStatus"];
} = {}) {
  const ledgerData = sourceLedgerData ?? createInitialLedgerData();
  ledgerData.feeRules = feeRules;
  return {
    ledgerData,
    onAction,
    ...render(
      <FeeRuleManager
        clock={clock}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={mutationVersion}
        onAction={onAction}
        persistedVersion={persistedVersion}
        persistenceStatus={persistenceStatus}
      />,
    ),
  };
}

describe("FeeRuleManager", () => {
  it("shows a conflict only for multiple active exact platform and asset rules", () => {
    const conflict = { ...rule, id: "rule-conflict", rate: "0.002" };
    const view = renderManager({ feeRules: [rule, conflict] });
    expect(screen.getByText("存在手续费规则冲突")).not.toBeNull();

    view.rerender(
      <FeeRuleManager
        clock={clock}
        isWritable
        ledgerData={{
          ...view.ledgerData,
          feeRules: [
            rule,
            {
              ...conflict,
              status: "inactive",
              deactivatedAt: "2026-07-24T00:00:00Z",
            },
          ],
        }}
        ledgerEpoch={1}
        mutationVersion={0}
        onAction={view.onAction}
        persistedVersion={0}
        persistenceStatus="saved"
      />,
    );
    expect(screen.queryByText("存在手续费规则冲突")).toBeNull();
  });

  it("creates a replacement action without mutating the historical rule", async () => {
    const original = structuredClone(rule);
    const { onAction } = renderManager({ feeRules: [rule] });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Binance BTC 新版本费率"), "0.002");
    await user.click(
      screen.getByRole("button", { name: "创建新版本并停用旧版" }),
    );

    expect(onAction).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "feeRule/replace",
        feeRuleId: "rule-old",
        replacement: expect.objectContaining({
          rate: "0.002",
          replacesFeeRuleId: "rule-old",
        }),
      }),
    );
    expect(rule).toEqual(original);
  });

  it("does not claim authenticated success until the pending version is saved", async () => {
    const onAction = vi.fn<
      Parameters<typeof FeeRuleManager>[0]["onAction"]
    >(() => "applied" as const);
    const view = renderManager({
      onAction,
      mutationVersion: 3,
      persistedVersion: 3,
      persistenceStatus: "saved",
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("规则名"), "Desk fixed");
    await user.type(screen.getByLabelText("平台（精确匹配）"), "Desk");
    await user.type(screen.getByLabelText("金额（USDT）"), "1");
    await user.click(screen.getByRole("button", { name: "新增手续费规则" }));
    expect(screen.getByText("手续费规则待保存")).not.toBeNull();
    expect(screen.queryByText("手续费规则已认证保存")).toBeNull();

    const ledgerData = createInitialLedgerData();
    view.rerender(
      <FeeRuleManager
        clock={clock}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mutationVersion={4}
        onAction={onAction}
        persistedVersion={4}
        persistenceStatus="saved"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("手续费规则已认证保存")).not.toBeNull();
    });
  });

  it("retries cross-collection and malformed IDs before creating a rule", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.cashEvents = [
      {
        id: "cash-collision",
        occurredAt: "2026-07-25",
        timePrecision: "day",
        type: "deposit",
        currency: "USDT",
        amount: "1",
        createdAt: "2026-07-25T00:00:00Z",
        updatedAt: "2026-07-25T00:00:00Z",
      },
    ];
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce("cash-collision")
      .mockReturnValueOnce(" invalid-id ")
      .mockReturnValueOnce("fee-new");
    vi.stubGlobal("crypto", { randomUUID });
    const onAction = vi.fn(() => "applied" as const);
    renderManager({ sourceLedgerData: ledgerData, onAction });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("规则名"), "Desk fixed");
    await user.type(screen.getByLabelText("平台（精确匹配）"), "Desk");
    await user.type(screen.getByLabelText("金额（USDT）"), "1");
    await user.click(screen.getByRole("button", { name: "新增手续费规则" }));

    expect(randomUUID).toHaveBeenCalledTimes(3);
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "feeRule/add",
        feeRule: expect.objectContaining({ id: "fee-new" }),
      }),
    );
  });

  it("fails closed after three fee-rule ID collisions", async () => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "asset-btc"),
    });
    const onAction = vi.fn(() => "applied" as const);
    renderManager({ onAction });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("规则名"), "Desk fixed");
    await user.type(screen.getByLabelText("平台（精确匹配）"), "Desk");
    await user.type(screen.getByLabelText("金额（USDT）"), "1");
    await user.click(screen.getByRole("button", { name: "新增手续费规则" }));

    expect(screen.getByText(/连续三次未能生成全局唯一/)).not.toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });
});

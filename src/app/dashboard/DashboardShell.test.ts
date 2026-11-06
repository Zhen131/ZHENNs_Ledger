import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Position } from "@/core/models";
import {
  createLedgerSession,
  type LedgerRepository,
} from "@/platform/persistence";
import { ALL_ENABLED_TEST_LEDGER_CAPABILITIES } from "@/test-support";
import {
  buildLedgerProjection,
  type LedgerProjection,
} from "@/features/portfolio";
import { createInitialLedgerData } from "@/core/state";
import type { LedgerClock } from "@/core/shared";
import { DashboardShell } from "./DashboardShell";

vi.mock("@/features/portfolio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/portfolio")>()),
  buildLedgerProjection: vi.fn(),
}));

const buildLedgerProjectionMock = vi.mocked(buildLedgerProjection);
const staticRepository: LedgerRepository = {
  load: async () => null,
  save: async () => undefined,
  clear: async () => undefined,
};
function staticSession() {
  return createLedgerSession({
    storageKind: "ledger-file",
    repository: staticRepository,
    capabilities: ALL_ENABLED_TEST_LEDGER_CAPABILITIES,
  });
}
const fixedClock: LedgerClock = {
  now: () => new Date("2026-07-25T12:00:00Z"),
};

const pricedPosition: Position = {
  assetSymbol: "SOL",
  quantity: "2.3456789",
  locationQuantities: {
    exchange: "1.3456789",
    "cold-wallet": "1",
    "cold-wallet-earn": "0",
  },
  averageCost: "100",
  costBasis: "200",
  latestPrice: "120",
  marketValue: "240",
  realizedPnl: "0",
  giftIncome: "0",
  unrealizedPnl: "40",
  currency: "USD",
};

const unpricedPosition: Position = {
  assetSymbol: "DOGE",
  quantity: "10",
  locationQuantities: {
    exchange: "10",
    "cold-wallet": "0",
    "cold-wallet-earn": "0",
  },
  averageCost: "0.1",
  costBasis: "1",
  realizedPnl: "0",
  giftIncome: "0",
  currency: "USD",
};

function projection(positions: readonly Position[] = []): LedgerProjection {
  return {
    cash: { currency: "USDT", balance: "0", deficit: "0", effects: [] },
    positions,
    valuation: {
      currency: "USDT",
      pricedAssetMarketValue: "0",
      totalAssetValue: "0",
      complete: true,
      missingPriceAssets: [],
      excludedCurrencyAssets: [],
      selectedPricesByAsset: {},
    },
    issues: [],
  };
}

describe("DashboardShell ledger views", () => {
  beforeEach(() => {
    buildLedgerProjectionMock.mockReset();
    buildLedgerProjectionMock.mockReturnValue(projection());
  });

  it("renders positions derived from the current ledger", () => {
    buildLedgerProjectionMock.mockReturnValue(
      projection([pricedPosition, unpricedPosition]),
    );

    renderToStaticMarkup(
      createElement(DashboardShell, {
        clock: fixedClock,
        session: staticSession(),
      }),
    );

    // How each position is displayed is asserted where it is displayed now:
    // HoldingsOverview.test.tsx T3-01 and T-09.
    expect(buildLedgerProjectionMock).toHaveBeenCalledWith(
      createInitialLedgerData(),
      { asOf: "2026-07-25", mode: "auto" },
    );
  });

  it("removes fake navigation and renders the three truthful chart summaries", () => {
    buildLedgerProjectionMock.mockReturnValue(projection());

    const html = renderToStaticMarkup(
      createElement(DashboardShell, {
        clock: fixedClock,
        session: staticSession(),
      }),
    );

    expect(html).not.toContain("Browser-only MVP shell");
    expect(html).not.toContain(">Today<");
    expect(html).not.toContain(">This Month<");
    expect(html).not.toContain("未来这里显示资产净值曲线和 K 线");
    expect(html).toContain("当前 USDT 资产分配");
    expect(html).toContain("总资产 / 剩余持仓成本");
    expect(html).toContain("最近 365 天交易活动");
  });
});

// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LedgerData } from "@/core/models";
import type { LedgerClock } from "@/core/shared";
import { createInitialLedgerData } from "@/core/state";
import {
  createLedgerSession,
  type LedgerRepository,
} from "@/platform/persistence";
import {
  ALL_ENABLED_TEST_LEDGER_CAPABILITIES,
  createAsset,
  createRepositoryBackedReadyDrivers,
} from "@/test-support";
import {
  LanguageProvider,
  translate,
  useLanguage,
  type LedgerLanguage,
} from "@/ui";

import { DashboardShell } from "../DashboardShell";
import {
  createMemoryRepository,
  createPriceSnapshot,
  createSimpleTrade,
} from "./DashboardShell.testHelpers";

/**
 * 04B scenarios 1, 2, 5 and 6 on the real dashboard shell: the allocation
 * chart names, the "not counted because" reasons, the read-failure notice and
 * the compatibility warnings follow the interface language, including when the
 * language changes while the same shell stays mounted. The ledger is fictional
 * and Han-free, so any Han character on the page is interface text.
 */
const HAN = /[㐀-䶿一-鿿]/u;

const chartOptions = vi.hoisted(() => [] as unknown[]);
vi.mock("echarts/core", () => ({
  init: vi.fn(() => ({
    dispose: vi.fn(),
    off: vi.fn(),
    on: vi.fn(),
    resize: vi.fn(),
    setOption: vi.fn((option: unknown) => {
      chartOptions.push(option);
    }),
  })),
  use: vi.fn(),
}));

afterEach(() => {
  cleanup();
  chartOptions.length = 0;
});

const clock: LedgerClock = { now: () => new Date("2026-07-25T12:00:00") };

let switchLanguage: (language: LedgerLanguage) => void = () => undefined;

function LanguageSwitch() {
  const { setLanguage } = useLanguage();
  switchLanguage = setLanguage;
  return null;
}

function memoryStorage(language: LedgerLanguage) {
  let value: string = language;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

/**
 * Cash 9996 USDT, BTC 7000, ETH 2000 and SOL 10 (under 2 %, so it is folded
 * into the "other" slice). DOGE has no price, so its unrealized result is
 * missing with a reason.
 */
function homeLedger(): LedgerData {
  const ledgerData = createInitialLedgerData();
  const known = new Set(ledgerData.assets.map(({ symbol }) => symbol));
  ledgerData.assets = [
    ...ledgerData.assets,
    ...["SOL", "DOGE"]
      .filter((symbol) => !known.has(symbol))
      .map((symbol) => createAsset(symbol, symbol)),
  ].map((asset) => ({ ...asset, name: asset.symbol, quoteCurrency: "USDT" }));
  ledgerData.cashEvents = [
    {
      id: "cash-start",
      occurredAt: "2026-07-01",
      timePrecision: "day",
      type: "deposit",
      currency: "USDT",
      amount: "10000",
      createdAt: "2026-07-01T12:00:00.000Z",
      updatedAt: "2026-07-01T12:00:00.000Z",
    },
  ];
  ledgerData.trades = ["BTC", "ETH", "SOL", "DOGE"].map((symbol) =>
    createSimpleTrade(`buy-${symbol}`, "buy", symbol, "1", "2026-07-10"),
  );
  ledgerData.priceSnapshots = [
    createPriceSnapshot("price-btc", "BTC", "7000", "2026-07-20"),
    createPriceSnapshot("price-eth", "ETH", "2000", "2026-07-20"),
    createPriceSnapshot("price-sol", "SOL", "10", "2026-07-20"),
  ];
  return ledgerData;
}

async function renderShell(
  language: LedgerLanguage,
  repository: LedgerRepository,
) {
  const drivers = createRepositoryBackedReadyDrivers(repository);
  const session = createLedgerSession({
    storageKind: "ledger-file",
    repository,
    capabilities: ALL_ENABLED_TEST_LEDGER_CAPABILITIES,
    readyClearDriver: drivers.readyClearDriver,
    readyImportDriver: drivers.readyImportDriver,
  });
  render(
    <LanguageProvider storage={memoryStorage(language)}>
      <LanguageSwitch />
      <DashboardShell clock={clock} session={session} />
    </LanguageProvider>,
  );
}

async function waitForHome(language: LedgerLanguage) {
  await screen.findByRole("button", {
    name: translate(language, "portfolio.overview.showAll"),
  });
}

function latestPieNames(): string[] {
  const pies = chartOptions
    .map((option) => JSON.parse(JSON.stringify(option)))
    .filter((option) =>
      option.series?.some?.((series: { type?: string }) => series.type === "pie"),
    );
  const latest = pies.at(-1);
  expect(latest).toBeDefined();
  return latest.series
    .filter((series: { type?: string }) => series.type === "pie")
    .flatMap((series: { data: { name: string }[] }) =>
      series.data.map(({ name }) => name),
    );
}

describe("home page on the English interface", () => {
  it("names the cash and other pie slices in the interface language", async () => {
    await renderShell("en", createMemoryRepository(homeLedger()));
    await waitForHome("en");

    await waitFor(() =>
      expect(latestPieNames()).toEqual(
        expect.arrayContaining([
          translate("en", "charts.series.cashUsdt"),
          translate("en", "charts.series.other"),
        ]),
      ),
    );
    expect(latestPieNames().join(" ")).not.toMatch(HAN);
    expect(document.body.textContent).not.toMatch(HAN);
  });

  it("keeps the Chinese slice names on the Chinese interface", async () => {
    await renderShell("zh-CN", createMemoryRepository(homeLedger()));
    await waitForHome("zh-CN");

    await waitFor(() =>
      expect(latestPieNames()).toEqual(
        expect.arrayContaining(["现金 USDT", "其他"]),
      ),
    );
  });

  it("follows a language change in the same shell", async () => {
    const repository = createMemoryRepository(homeLedger());
    await renderShell("zh-CN", repository);
    await waitForHome("zh-CN");
    await waitFor(() =>
      expect(latestPieNames()).toEqual(expect.arrayContaining(["现金 USDT"])),
    );
    const loadsBefore = vi.mocked(repository.load).mock.calls.length;

    act(() => switchLanguage("en"));
    await waitForHome("en");

    await waitFor(() =>
      expect(latestPieNames()).toEqual(
        expect.arrayContaining([
          translate("en", "charts.series.cashUsdt"),
          translate("en", "charts.series.other"),
        ]),
      ),
    );
    expect(document.body.textContent).toContain(
      "DOGE" + translate("en", "portfolio.issue.missingCurrentPrice"),
    );
    expect(document.body.textContent).not.toMatch(HAN);
    expect(vi.mocked(repository.load).mock.calls.length).toBe(loadsBefore);
  });

  it("explains missing amounts without Chinese on the card and in the details", async () => {
    const ledgerData = homeLedger();
    // A BTC fee on an ETH buy cannot be converted, so the ETH buy outflow in
    // the details table is missing, with the reason in its hover title.
    ledgerData.trades = ledgerData.trades.map((trade) =>
      trade.assetSymbol === "ETH"
        ? { ...trade, fee: "0.001", feeCurrency: "BTC" }
        : trade,
    );
    await renderShell("en", createMemoryRepository(ledgerData));
    await waitForHome("en");

    expect(document.body.textContent).toContain(
      "DOGE" + translate("en", "portfolio.issue.missingCurrentPrice"),
    );

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: translate("en", "shared.shell.home") }),
    );
    await user.click(
      screen.getByRole("button", {
        name: translate("en", "portfolio.overview.showAll"),
      }),
    );
    const feeReason =
      "buy-ETH" +
      translate("en", "portfolio.issue.feeConversionMiddle") +
      "BTC" +
      translate("en", "portfolio.issue.feeConversionSuffix") +
      "USDT";
    await screen.findByRole("table", {
      name: translate("en", "portfolio.details.tableAriaLabel"),
    });
    const titles = () =>
      [...document.querySelectorAll("[title]")].map(
        (element) => element.getAttribute("title") ?? "",
      );
    await waitFor(() =>
      expect(titles().some((title) => title.includes(feeReason))).toBe(true),
    );
    expect(titles().join(" ")).not.toMatch(HAN);
    expect(document.body.textContent).not.toMatch(HAN);
  });

  it("shows the compatibility warning for a future record without Chinese", async () => {
    const ledgerData = homeLedger();
    ledgerData.trades = [
      ...ledgerData.trades,
      createSimpleTrade("buy-later", "buy", "BTC", "1", "2026-07-30"),
    ];
    await renderShell("en", createMemoryRepository(ledgerData));
    await waitForHome("en");

    expect(document.body.textContent).toContain(
      translate("en", "policy.compat.futureTrade"),
    );
    expect(document.body.textContent).not.toMatch(HAN);
  });

  it("reports a failed read without Chinese", async () => {
    const repository = createMemoryRepository();
    vi.mocked(repository.load).mockRejectedValue(new Error("read failed"));
    await renderShell("en", repository);

    await screen.findByText(translate("en", "persistence.readFailed"));
    expect(document.body.textContent).not.toMatch(HAN);
  });
});

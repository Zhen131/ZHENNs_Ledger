// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createInitialLedgerData } from "@/core/state";
import {
  buildHoldingAllocation,
  buildHoldingHistory,
  buildTradeHeatmap,
} from "@/features/charts";
import {
  buildLedgerPnlSummary,
  getPositionsFromLedger,
} from "@/features/portfolio";
import {
  DEFAULT_LEDGER_LANGUAGE,
  LANGUAGE_PREFERENCE_STORAGE_KEY,
  LanguageProvider,
  formatLedgerDate,
  formatMoney,
  readLanguagePreference,
  translate,
  useLanguage,
} from "@/ui";
import { HomeWorkspace } from "./HomeWorkspace";
import { SettingsWorkspace } from "./SettingsWorkspace";

vi.mock("echarts/core", () => ({
  init: vi.fn(() => ({
    dispose: vi.fn(),
    off: vi.fn(),
    on: vi.fn(),
    resize: vi.fn(),
    setOption: vi.fn(),
  })),
  use: vi.fn(),
}));

const TODAY_KEY = "2026-09-01";
const ledgerData = createInitialLedgerData();
const positions = getPositionsFromLedger(ledgerData, {
  mode: "auto",
  todayKey: TODAY_KEY,
});
const pnlSummary = buildLedgerPnlSummary(ledgerData, {
  mode: "auto",
  todayKey: TODAY_KEY,
});
const allocation = buildHoldingAllocation(ledgerData, {
  mode: "auto",
  todayKey: TODAY_KEY,
});
const history = buildHoldingHistory(ledgerData, {
  mode: "auto",
  range: "30d",
  todayKey: TODAY_KEY,
});
const heatmap = buildTradeHeatmap(ledgerData, TODAY_KEY);

describe("Week 15 language mechanism contracts", () => {
  it("T-A1 renders the home workspace in Chinese by default", () => {
    render(<LanguageMechanismHarness />);

    expect(screen.getByRole("heading", { name: "资产趋势" })).toBeTruthy();
    expect(screen.getByLabelText("首页工作区")).toBeTruthy();
  });

  it("T-A2 switches the home workspace to English and Hungarian", async () => {
    const user = userEvent.setup();
    render(<LanguageMechanismHarness />);

    await user.selectOptions(screen.getByLabelText("选择界面语言"), "en");
    expect(screen.getByRole("heading", { name: "Asset trend" })).toBeTruthy();

    // Hungarian is withdrawn from the picker but not from the mechanism
    // (04A D-3), so the switch now goes through the same provider call the
    // picker made. The rendered Hungarian heading assertion is unchanged.
    await user.click(screen.getByRole("button", { name: "set hu" }));
    expect(
      screen.getByRole("heading", { name: "A vagyon alakulása" }),
    ).toBeTruthy();
  });

  it("T-A3 restores the persisted language after a refresh remount", async () => {
    const storage = createMemoryStorage();
    const first = render(
      <LanguageProvider storage={storage}>
        <LanguageControlProbe />
      </LanguageProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "set English" }));
    first.unmount();

    render(
      <LanguageProvider storage={storage}>
        <LanguageControlProbe />
      </LanguageProvider>,
    );

    await waitFor(() => expect(screen.getByText("language: en")).toBeTruthy());
  });

  it("T-A4 falls back to Chinese for missing English and Hungarian entries", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(translate("en", "shared.i18n.fallbackExample")).toBe(
      "中文回退文案",
    );
    expect(translate("hu", "shared.i18n.fallbackExample")).toBe(
      "中文回退文案",
    );
    expect(warning).toHaveBeenCalledTimes(2);
    warning.mockRestore();
  });

  it("T-A5 falls back to Chinese for invalid or unreadable storage", () => {
    expect(
      readLanguagePreference({ getItem: () => "not-a-language" }),
    ).toBe(DEFAULT_LEDGER_LANGUAGE);
    const unreadableStorage = {
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {
        throw new Error("storage blocked");
      },
    };
    expect(readLanguagePreference(unreadableStorage)).toBe(
      DEFAULT_LEDGER_LANGUAGE,
    );

    render(
      <LanguageProvider storage={unreadableStorage}>
        <LanguageControlProbe />
      </LanguageProvider>,
    );
    expect(screen.getByText("language: zh-CN")).toBeTruthy();
  });

  it("T-A6 keeps number representation identical in all three languages", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <InvariantProbe />
      </LanguageProvider>,
    );

    expect(screen.getByText("number: 1 234 567.89")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "set English" }));
    expect(screen.getByText("number: 1 234 567.89")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "set Hungarian" }));
    expect(screen.getByText("number: 1 234 567.89")).toBeTruthy();
  });

  it("T-A7 keeps ISO date representation identical in all three languages", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <InvariantProbe />
      </LanguageProvider>,
    );

    expect(screen.getByText("date: 2026-09-01")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "set English" }));
    expect(screen.getByText("date: 2026-09-01")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "set Hungarian" }));
    expect(screen.getByText("date: 2026-09-01")).toBeTruthy();
  });

  it("T-A8 leaves fictional .lftl bytes identical after switching language", async () => {
    const fixturePath = join(
      process.cwd(),
      "test-fixtures/golden/golden-ledger-file-format-v3-crypto-v1-ledger-schema-v4.lftl",
    );
    const before = Uint8Array.from(readFileSync(fixturePath));
    const user = userEvent.setup();
    render(<LanguageMechanismHarness />);

    await user.selectOptions(screen.getByLabelText("选择界面语言"), "en");

    const after = Uint8Array.from(readFileSync(fixturePath));
    expect(after).toEqual(before);
    expect(
      window.localStorage.getItem(LANGUAGE_PREFERENCE_STORAGE_KEY),
    ).toBe("en");
    expect(window.localStorage.length).toBe(1);
  });
});

function LanguageSwitchProbe({ language }: { language: "hu" }) {
  const { setLanguage } = useLanguage();
  return (
    <button onClick={() => setLanguage(language)} type="button">
      set {language}
    </button>
  );
}

function LanguageMechanismHarness() {
  return (
    <LanguageProvider>
      <LanguageSwitchProbe language="hu" />
      <HomeWorkspace
        active
        allocation={allocation}
        cashBalance="0"
        heatmap={heatmap}
        history={history}
        ledgerData={ledgerData}
        onNavigateToPrice={() => undefined}
        onNavigateToTrade={() => undefined}
        onNavigateToTransactions={() => undefined}
        onRangeChange={() => undefined}
        onValuationPriceModeChange={() => undefined}
        pnlSummary={pnlSummary}
        positions={positions}
        range="30d"
        valuationPriceMode="auto"
      />
      <SettingsWorkspace
        active
        canClearHydrationError={false}
        canClearReadyLedger
        feePanel={null}
        hydrationStatus="ready"
        isReadOnly={false}
        ledgerEpoch={0}
        marketPanel={null}
        onClear={async () => true}
        persistenceOperation="idle"
        repositorySwitchBlocked={false}
        storageKind="ledger-file"
      />
    </LanguageProvider>
  );
}

function LanguageControlProbe() {
  const { language, setLanguage } = useLanguage();
  return (
    <div>
      <p>language: {language}</p>
      <button onClick={() => setLanguage("en")} type="button">
        set English
      </button>
    </div>
  );
}

function InvariantProbe() {
  const { setLanguage } = useLanguage();
  return (
    <div>
      <p>number: {formatMoney("1234567.891")}</p>
      <p>date: {formatLedgerDate("2026-09-01T23:59:59Z")}</p>
      <button onClick={() => setLanguage("en")} type="button">
        set English
      </button>
      <button onClick={() => setLanguage("hu")} type="button">
        set Hungarian
      </button>
    </div>
  );
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

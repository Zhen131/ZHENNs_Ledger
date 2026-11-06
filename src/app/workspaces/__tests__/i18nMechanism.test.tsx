// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getLedgerDateKey } from "@/core/shared";
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
  LEDGER_LANGUAGES,
  LanguageProvider,
  SELECTABLE_LEDGER_LANGUAGES,
  formatMoney,
  readLanguagePreference,
  translate,
  useLanguage,
  writeLanguagePreference,
} from "@/ui";
import { HomeWorkspace } from "../HomeWorkspace";
import { SettingsWorkspace } from "../SettingsWorkspace";

afterEach(cleanup);

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

describe("language mechanism contracts", () => {
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
      <p>date: {getLedgerDateKey("2026-09-01T23:59:59Z")}</p>
      <button onClick={() => setLanguage("en")} type="button">
        set English
      </button>
      <button onClick={() => setLanguage("hu")} type="button">
        set Hungarian
      </button>
    </div>
  );
}

/**
 * Hungarian is withdrawn from the picker but not from the product: its code,
 * its translations, and its branch of `translate` all stay, so putting the
 * option back later is one list entry rather than a re-translation (04A D-3).
 * These tests pin both halves of that promise, including the one that only
 * shows up on a browser that already stored "hu".
 */
describe("withdrawing the Hungarian option", () => {
  it("keeps the language code and every Hungarian translation", () => {
    expect(LEDGER_LANGUAGES).toContain("hu");
    expect(translate("hu", "home.workspace.ariaLabel")).toBe(
      "Kezdőlap munkaterület",
    );
    expect(translate("hu", "settings.language.optionHungarian")).toBe("Magyar");
  });

  it("offers only Chinese and English in the settings picker", () => {
    expect([...SELECTABLE_LEDGER_LANGUAGES]).toEqual(["zh-CN", "en"]);

    render(
      <LanguageProvider storage={createMemoryStorage()}>
        <SettingsWorkspace
          active
          canClearHydrationError={false}
          canClearReadyLedger={false}
          feePanel={null}
          hydrationStatus="ready"
          isReadOnly={false}
          ledgerEpoch={0}
          marketPanel={null}
          onClear={async () => false}
          persistenceOperation="idle"
          repositorySwitchBlocked={false}
          storageKind="ledger-file"
        />
      </LanguageProvider>,
    );

    const picker = screen.getByRole("combobox", { name: "选择界面语言" });
    const values = Array.from(
      picker.querySelectorAll("option"),
      (option) => option.value,
    );
    expect(values).toEqual(["zh-CN", "en"]);
  });

  it("reads a stored Hungarian preference back as the default language", () => {
    const storage = createMemoryStorage("hu");

    expect(readLanguagePreference(storage)).toBe(DEFAULT_LEDGER_LANGUAGE);
    expect(storage.read()).toBe("hu");
  });

  it("renders the default language for a browser that stored Hungarian", () => {
    const storage = createMemoryStorage("hu");

    render(
      <LanguageProvider storage={storage}>
        <SettingsWorkspace
          active
          canClearHydrationError={false}
          canClearReadyLedger={false}
          feePanel={null}
          hydrationStatus="ready"
          isReadOnly={false}
          ledgerEpoch={0}
          marketPanel={null}
          onClear={async () => false}
          persistenceOperation="idle"
          repositorySwitchBlocked={false}
          storageKind="ledger-file"
        />
      </LanguageProvider>,
    );

    const picker = screen.getByRole("combobox", { name: "选择界面语言" });
    expect((picker as HTMLSelectElement).value).toBe(DEFAULT_LEDGER_LANGUAGE);
    expect(screen.getByText("账本设置")).toBeTruthy();
  });

  it("still writes and reads a selectable preference unchanged", () => {
    const storage = createMemoryStorage();

    writeLanguagePreference("en", storage);

    expect(storage.read()).toBe("en");
    expect(readLanguagePreference(storage)).toBe("en");
  });
});

function LanguageProbe() {
  const { language, setLanguage } = useLanguage();
  return (
    <button onClick={() => setLanguage("en")} type="button">
      {language}
    </button>
  );
}

describe("LanguageProvider", () => {
  it("changes the in-memory language and persists the browser preference", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <LanguageProbe />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: "zh-CN" }));

    expect(screen.getByRole("button", { name: "en" })).toBeTruthy();
    expect(window.localStorage.getItem(LANGUAGE_PREFERENCE_STORAGE_KEY)).toBe(
      "en",
    );
  });

  it("starts the next test in Chinese without leaked language state", () => {
    render(
      <LanguageProvider>
        <LanguageProbe />
      </LanguageProvider>,
    );

    expect(
      screen.getByRole("button", { name: DEFAULT_LEDGER_LANGUAGE }),
    ).toBeTruthy();
  });
});

function createMemoryStorage(initial?: string) {
  let value = initial;
  return {
    getItem: () => value ?? null,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    read: () => value,
  };
}

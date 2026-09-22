// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_LEDGER_LANGUAGE,
  LEDGER_LANGUAGES,
  LanguageProvider,
  SELECTABLE_LEDGER_LANGUAGES,
  readLanguagePreference,
  translate,
  writeLanguagePreference,
} from "@/ui";

import { SettingsWorkspace } from "./SettingsWorkspace";

/**
 * Hungarian is withdrawn from the picker but not from the product: its code,
 * its translations, and its branch of `translate` all stay, so putting the
 * option back later is one list entry rather than a re-translation (04A D-3).
 * These tests pin both halves of that promise, including the one that only
 * shows up on a browser that already stored "hu".
 */
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

afterEach(cleanup);

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
          storageKind="indexeddb"
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
          storageKind="indexeddb"
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

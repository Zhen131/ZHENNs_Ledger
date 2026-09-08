// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createInitialLedgerData } from "@/core/state";
import type { LedgerReadyClearDriver } from "@/platform/persistence";
import {
  claimReadyLedgerClearExecutionContextForDriver,
  createLedgerSession,
  createReadyLedgerClearAuthorizationForDriver,
  LEDGER_FILE_CAPABILITIES,
  READY_LEDGER_CLEAR_CONFIRMATION_TEXT,
} from "@/platform/persistence";
import {
  DEFAULT_LEDGER_LANGUAGE,
  LanguageProvider,
  translate,
  type LedgerLanguage,
} from "@/ui";

import {
  DashboardShell,
  createCompleteLedger,
  createMemoryRepository,
} from "./DashboardShell.testHelpers";
import { SettingsWorkspace } from "./SettingsWorkspace";

/**
 * Both "type this phrase to confirm" gates used to demand a Chinese sentence
 * even on the English interface, which is unusable to a reader without a
 * Chinese keyboard. The phrase now follows the language on screen (04A D-16a).
 *
 * The part worth guarding is the seam: the panel compares what was typed
 * against the phrase for the current language, and only then hands the
 * repository the one canonical value it has always accepted. Nothing about
 * what the repository accepts changed (04A D-16b), so the English phrase must
 * never reach it, and neither language's phrase may be accepted while the
 * other one is on screen (04A D-16c).
 */
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

afterEach(cleanup);

const CHINESE_SETTINGS_PHRASE = "清空账本";
const ENGLISH_SETTINGS_PHRASE = "clear ledger";
const CHINESE_DASHBOARD_PHRASE = "清空本地账本";
const ENGLISH_DASHBOARD_PHRASE = "Clear the local ledger";

function memoryStorage(initial?: string) {
  let value = initial;
  return {
    getItem: () => value ?? null,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

function renderSettingsIn(
  language: LedgerLanguage,
  onClear = vi.fn(async () => true),
) {
  render(
    <LanguageProvider storage={memoryStorage(language)}>
      <SettingsWorkspace
        active
        canClearHydrationError={false}
        canClearReadyLedger
        feePanel={null}
        hydrationStatus="ready"
        isReadOnly={false}
        ledgerEpoch={1}
        marketPanel={null}
        onClear={onClear}
        persistenceOperation="idle"
        repositorySwitchBlocked={false}
        storageKind="ledger-file"
      />
    </LanguageProvider>,
  );
  return onClear;
}

async function openSettingsClear(language: LedgerLanguage) {
  const user = userEvent.setup();
  // Deliberately not named `t`: the translation-key usage guard counts every
  // `t("literal")` call site, and a test alias is not interface reuse.
  const label = (key: Parameters<typeof translate>[1]) =>
    translate(language, key);
  await user.click(
    await screen.findByRole("tab", { name: label("settings.tabs.danger") }),
  );
  await user.click(
    screen.getByRole("button", { name: label("settings.clear.open") }),
  );
  return {
    user,
    confirm: () =>
      user.click(
        screen.getByRole("button", {
          name: label("settings.clear.confirmation.confirm"),
        }),
      ),
    input: screen.getByLabelText(
      label("settings.clear.confirmation.inputAriaLabel"),
    ),
  };
}

describe("the settings panel's typed clear phrase", () => {
  it("shows the phrase for the language on screen", async () => {
    renderSettingsIn(DEFAULT_LEDGER_LANGUAGE);
    await openSettingsClear(DEFAULT_LEDGER_LANGUAGE);
    expect(
      screen.getByText(`“${CHINESE_SETTINGS_PHRASE}”`, { exact: false }),
    ).toBeTruthy();
    cleanup();

    renderSettingsIn("en");
    await openSettingsClear("en");
    expect(
      screen.getByText(`“${ENGLISH_SETTINGS_PHRASE}”`, { exact: false }),
    ).toBeTruthy();
  });

  it("accepts the Chinese phrase on the Chinese interface", async () => {
    const onClear = renderSettingsIn(DEFAULT_LEDGER_LANGUAGE);
    const { user, confirm, input } = await openSettingsClear(
      DEFAULT_LEDGER_LANGUAGE,
    );

    await user.type(input, CHINESE_SETTINGS_PHRASE);
    await confirm();

    expect(onClear).toHaveBeenCalledWith("normal");
  });

  it("rejects a typo on the Chinese interface", async () => {
    const onClear = renderSettingsIn(DEFAULT_LEDGER_LANGUAGE);
    const { user, confirm, input } = await openSettingsClear(
      DEFAULT_LEDGER_LANGUAGE,
    );

    await user.type(input, "清空账");
    await confirm();

    expect(onClear).not.toHaveBeenCalled();
  });

  it("rejects the English phrase on the Chinese interface", async () => {
    const onClear = renderSettingsIn(DEFAULT_LEDGER_LANGUAGE);
    const { user, confirm, input } = await openSettingsClear(
      DEFAULT_LEDGER_LANGUAGE,
    );

    await user.type(input, ENGLISH_SETTINGS_PHRASE);
    await confirm();

    expect(onClear).not.toHaveBeenCalled();
  });

  it("accepts the English phrase on the English interface", async () => {
    const onClear = renderSettingsIn("en");
    const { user, confirm, input } = await openSettingsClear("en");

    await user.type(input, ENGLISH_SETTINGS_PHRASE);
    await confirm();

    expect(onClear).toHaveBeenCalledWith("normal");
  });

  it("rejects a typo on the English interface", async () => {
    const onClear = renderSettingsIn("en");
    const { user, confirm, input } = await openSettingsClear("en");

    await user.type(input, "clear ledge");
    await confirm();

    expect(onClear).not.toHaveBeenCalled();
  });

  it("rejects the Chinese phrase on the English interface", async () => {
    const onClear = renderSettingsIn("en");
    const { user, confirm, input } = await openSettingsClear("en");

    await user.type(input, CHINESE_SETTINGS_PHRASE);
    await confirm();

    expect(onClear).not.toHaveBeenCalled();
  });
});

describe("the data management panel's typed clear phrase", () => {
  async function renderDashboardIn(language: LedgerLanguage) {
    const repository = createMemoryRepository(createCompleteLedger());
    render(
      <LanguageProvider storage={memoryStorage(language)}>
        <DashboardShell repository={repository} />
      </LanguageProvider>,
    );
    await waitFor(() => {
      expect(
        screen.queryByText(translate(language, "dashboard.hydration.loading")),
      ).toBeNull();
    });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", {
        name: translate(language, "dashboard.dataManagement.clearLegacy"),
      }),
    );
    return {
      repository,
      user,
      confirm: () =>
        user.click(
          screen.getByRole("button", {
            name: translate(
              language,
              "dashboard.dataManagement.confirmClearLegacy",
            ),
          }),
        ),
      input: screen.getByLabelText(
        translate(language, "dashboard.dataManagement.confirmAriaLabel"),
      ),
    };
  }

  it("accepts the Chinese phrase and rejects a typo and the English phrase", async () => {
    const { repository, user, confirm, input } = await renderDashboardIn(
      DEFAULT_LEDGER_LANGUAGE,
    );

    await user.type(input, ENGLISH_DASHBOARD_PHRASE);
    await confirm();
    expect(repository.clear).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, "清空本地");
    await confirm();
    expect(repository.clear).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, CHINESE_DASHBOARD_PHRASE);
    await confirm();
    await waitFor(() => expect(repository.clear).toHaveBeenCalledOnce());
  });

  it("accepts the English phrase and rejects a typo and the Chinese phrase", async () => {
    const { repository, user, confirm, input } = await renderDashboardIn("en");

    await user.type(input, CHINESE_DASHBOARD_PHRASE);
    await confirm();
    expect(repository.clear).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, "Clear the local");
    await confirm();
    expect(repository.clear).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, ENGLISH_DASHBOARD_PHRASE);
    await confirm();
    await waitFor(() => expect(repository.clear).toHaveBeenCalledOnce());
  });
});

describe("what the repository is handed", () => {
  function createReadyClearSession() {
    const repository = createMemoryRepository(createCompleteLedger());
    const authorizeReadyClear = vi.fn((context) =>
      createReadyLedgerClearAuthorizationForDriver(context, {
        fileId: "phrase-file",
        verifiedRevisionId: "phrase-revision",
      }),
    );
    const readyClearDriver: LedgerReadyClearDriver = {
      authorizeReadyClear,
      clearReadyLedger: vi.fn(async (authorization, executionContext) => {
        if (
          !claimReadyLedgerClearExecutionContextForDriver(
            executionContext,
            authorization,
            readyClearDriver,
          )
        ) {
          throw new Error("invalid ready clear execution");
        }
      }),
    };
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_CAPABILITIES,
      readyClearDriver,
      createSessionId: () => "phrase-ready-clear",
    });
    return { authorizeReadyClear, repository, session };
  }

  it("hands the repository the canonical value, never the English phrase", async () => {
    const { authorizeReadyClear, session } = createReadyClearSession();
    render(
      <LanguageProvider storage={memoryStorage("en")}>
        <DashboardShell session={session} />
      </LanguageProvider>,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", {
        name: translate("en", "shared.shell.settings"),
      }),
    );
    await screen.findByRole("tab", {
      name: translate("en", "settings.tabs.market"),
    });
    await user.click(
      screen.getByRole("tab", {
        name: translate("en", "settings.tabs.danger"),
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: translate("en", "settings.clear.open"),
      }),
    );
    await user.type(
      screen.getByLabelText(
        translate("en", "settings.clear.confirmation.inputAriaLabel"),
      ),
      ENGLISH_SETTINGS_PHRASE,
    );
    await user.click(
      screen.getByRole("button", {
        name: translate("en", "settings.clear.confirmation.confirm"),
      }),
    );

    await waitFor(() => expect(authorizeReadyClear).toHaveBeenCalledOnce());
    expect(authorizeReadyClear).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationNonce: READY_LEDGER_CLEAR_CONFIRMATION_TEXT,
      }),
    );
    // The typed English phrase stops at the panel; it is not a value the
    // repository has ever accepted, and this batch did not make it one.
    expect(authorizeReadyClear).not.toHaveBeenCalledWith(
      expect.objectContaining({ confirmationNonce: ENGLISH_SETTINGS_PHRASE }),
    );
  });

  it("keeps the Chinese phrase and the canonical value from drifting apart", () => {
    expect(
      translate(
        DEFAULT_LEDGER_LANGUAGE,
        "dashboard.dataManagement.confirmPhrase",
      ),
    ).toBe(READY_LEDGER_CLEAR_CONFIRMATION_TEXT);
    expect(createInitialLedgerData().schemaVersion).toBe(5);
  });
});

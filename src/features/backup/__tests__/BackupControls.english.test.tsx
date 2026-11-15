// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LedgerData } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { DEFAULT_LEDGER_RESOURCE_LIMITS } from "@/core/validation";
import { createUsdtSimpleTrade as createSimpleTrade } from "@/test-support";
import { LanguageProvider, translate, type LedgerLanguage } from "@/ui";
import { BackupControls } from "../BackupControls";
import {
  createBackupEnvelope,
  serializeBackupEnvelope,
} from "../backupEnvelope";

/**
 * 04B scenarios 6 and 7: on the English interface the preflight report on the
 * page and the Markdown copied out of it carry no Chinese, for each kind of bad
 * backup the product owner named. Only fictional, Han-free user content is used
 * (04B section 3.4), so any Han character found is interface text.
 */
const HAN = /[㐀-䶿一-鿿]/u;
const FIXED_EXPORTED_AT = "2026-07-23T12:34:56.000Z";
const fixedClock = { now: () => new Date(FIXED_EXPORTED_AT) };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function memoryStorage(language: LedgerLanguage) {
  let value: string = language;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

function hanFreeLedger(): LedgerData {
  const ledgerData = createInitialLedgerData();
  ledgerData.assets = ledgerData.assets.map((asset) => ({
    ...asset,
    name: asset.symbol,
  }));
  return ledgerData;
}

function serializedEnvelope(ledgerData: LedgerData, todayKey = "2026-07-23") {
  const envelope = createBackupEnvelope(
    ledgerData,
    { appVersion: "0.1.0", exportedAt: FIXED_EXPORTED_AT },
    todayKey,
  );
  if (!envelope.ok) throw new Error("Fixture envelope must be valid");
  return serializeBackupEnvelope(envelope.value);
}

function fileOf(contents: string, name: string, size?: number): File {
  const file = new File([contents], name, { type: "application/json" });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: vi.fn(async () => contents),
  });
  if (size !== undefined) {
    Object.defineProperty(file, "size", { configurable: true, value: size });
  }
  return file;
}

const BAD_BACKUPS: Record<string, () => File> = {
  "JSON that cannot be read": () => fileOf("{ not json", "broken.json"),
  "a retired envelope version": () =>
    fileOf(
      JSON.stringify({
        backupFormatVersion: 2,
        appVersion: "0.1.0",
        exportedAt: FIXED_EXPORTED_AT,
        ledgerSchemaVersion: 4,
        ledgerData: {},
      }),
      "retired.json",
    ),
  "a wrong ledger structure": () => {
    const parsed = JSON.parse(serializedEnvelope(hanFreeLedger()));
    parsed.ledgerData.trades = [{ id: "broken-trade" }];
    return fileOf(JSON.stringify(parsed), "structure.json");
  },
  "a trade after today": () => {
    const ledgerData = hanFreeLedger();
    ledgerData.trades = [
      createSimpleTrade("future-buy", "buy", "BTC", "1", "2026-08-01"),
    ];
    return fileOf(serializedEnvelope(ledgerData, "2099-01-01"), "future.json");
  },
  "suspicious duplicate trades": () => {
    const ledgerData = hanFreeLedger();
    ledgerData.trades = [
      createSimpleTrade("dup-a", "buy", "BTC", "1", "2026-07-01"),
      createSimpleTrade("dup-b", "buy", "BTC", "1", "2026-07-01"),
    ];
    return fileOf(serializedEnvelope(ledgerData), "duplicates.json");
  },
};

function renderIn(language: LedgerLanguage) {
  render(
    <LanguageProvider storage={memoryStorage(language)}>
      <BackupControls
        clock={fixedClock}
        hydrationStatus="ready"
        isDirty={false}
        isReadOnly={false}
        ledgerData={hanFreeLedger()}
        onImport={vi.fn(async () => ({ ok: true }))}
        persistenceOperation="idle"
        persistenceStatus="idle"
      />
    </LanguageProvider>,
  );
}

async function selectFile(language: LedgerLanguage, file: File) {
  const user = userEvent.setup();
  // userEvent.setup() installs its own clipboard, so the spy goes in after it.
  const writeText = vi.fn(async (markdown: string) => {
    void markdown;
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  await user.upload(
    await screen.findByLabelText(
      translate(language, "backup.action.selectAriaLabel"),
    ),
    file,
  );
  return { user, writeText };
}

describe("backup preflight on the English interface", () => {
  it.each(Object.keys(BAD_BACKUPS))(
    "shows and copies a Han-free report for %s",
    async (scenario) => {
      renderIn("en");
      const { user, writeText } = await selectFile("en", BAD_BACKUPS[scenario]());

      const copy = await screen.findByRole("button", {
        name: translate("en", "backup.report.copy"),
      });
      expect(document.body.textContent).not.toMatch(HAN);

      await user.click(copy);
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      const markdown = writeText.mock.calls[0][0];
      expect(markdown).toContain(translate("en", "backup.markdown.title"));
      expect(markdown).not.toMatch(HAN);
    },
  );

  it("keeps the retired-version sentence instead of wrapping it", async () => {
    renderIn("en");
    await selectFile("en", BAD_BACKUPS["a retired envelope version"]());
    await screen.findByRole("button", {
      name: translate("en", "backup.report.copy"),
    });

    expect(document.body.textContent).toContain(
      translate("en", "backup.envelope.formatVersionPrefix") +
        "2" +
        translate("en", "backup.envelope.formatVersionSuffix"),
    );
    expect(document.body.textContent).not.toContain(
      translate("en", "backup.preflight.unsupportedVersion"),
    );
  });

  it("still writes the Chinese report on the Chinese interface", async () => {
    renderIn("zh-CN");
    const { user, writeText } = await selectFile(
      "zh-CN",
      BAD_BACKUPS["suspicious duplicate trades"](),
    );
    await user.click(
      await screen.findByRole("button", {
        name: translate("zh-CN", "backup.report.copy"),
      }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain(
      translate("zh-CN", "backup.markdown.title"),
    );
  });

  it("describes an oversized file without Chinese", async () => {
    renderIn("en");
    await selectFile(
      "en",
      fileOf("{}", "huge.json", DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes + 1),
    );

    await screen.findByText("LEDGER_RESOURCE_FILE_TOO_LARGE");
    expect(document.body.textContent).toContain(
      translate("en", "policy.resource.ledgerFileLabel") +
        translate("en", "policy.resource.overLimitMiddle"),
    );
    expect(document.body.textContent).not.toMatch(HAN);
  });
});

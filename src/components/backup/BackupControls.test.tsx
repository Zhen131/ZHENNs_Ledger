// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBackupEnvelope,
  parseBackupJson,
  serializeBackupEnvelope,
} from "../../backup/backupEnvelope";
import {
  confirmBackupImportSuspiciousGroups,
  createLedgerBackupImportEvidence,
  inspectLedgerBackupImportEvidence,
  preflightBackupJson,
  type BackupImportPreflightResult,
  type LedgerBackupImportEvidence,
} from "../../backup/backupImportPreflight";
import { createInitialLedgerData } from "../../state/initialLedgerData";
import { createSimpleTrade } from "../../test/fixtures";
import { DEFAULT_LEDGER_RESOURCE_LIMITS } from "../../validators";
import { BackupControls } from "./BackupControls";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const FIXED_EXPORTED_AT = "2026-07-23T12:34:56.000Z";
const FIXED_BACKUP_FILENAME =
  "local-first-trading-ledger-backup-v1-20260723-123456Z.json";
const fixedClock = {
  now: () => new Date(FIXED_EXPORTED_AT),
};

function byteLength(serialized: string): number {
  return new TextEncoder().encode(serialized).byteLength;
}

function padSerializedBackupToBytes(serialized: string, targetBytes: number): string {
  const currentBytes = byteLength(serialized);

  if (currentBytes > targetBytes) {
    throw new Error("Serialized fixture already exceeds target");
  }

  return `${serialized}${" ".repeat(targetBytes - currentBytes)}`;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function createBackupFile(name = "ledger.json") {
  const envelope = createBackupEnvelope(createInitialLedgerData(), {
    appVersion: "0.1.0",
    exportedAt: FIXED_EXPORTED_AT,
  });
  if (!envelope.ok) throw new Error("Fixture must be valid");
  const file = new File([serializeBackupEnvelope(envelope.value)], name, {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: vi.fn(async () => serializeBackupEnvelope(envelope.value)),
  });
  return file;
}

function createPermanentFixtureFile(name: string) {
  const serialized = readFileSync(
    `test-fixtures/w11-b-import/${name}`,
    "utf8",
  );
  const file = new File([serialized], name, {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: vi.fn(async () => serialized),
  });
  return { file, serialized };
}

function createPaddedBackupFile(serialized: string, name = "ledger.json") {
  const file = new File([serialized], name, { type: "application/json" });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: vi.fn(async () => serialized),
  });
  return file;
}

function createReadOnlyLedgerAtBackupBytes(targetBytes: number) {
  const ledgerData = {
    ...createInitialLedgerData(),
    trades: [
      {
        ...createSimpleTrade("boundary", "buy", "BTC", "1"),
        rawText: "",
      },
    ],
  };
  const envelope = createBackupEnvelope(ledgerData, {
    appVersion: "0.1.0",
    exportedAt: FIXED_EXPORTED_AT,
  });
  if (!envelope.ok) throw new Error("Fixture must be valid");

  const serialized = serializeBackupEnvelope(envelope.value);
  ledgerData.trades[0].rawText = "x".repeat(targetBytes - byteLength(serialized));
  return ledgerData;
}

function stubBlobConstructor() {
  const OriginalBlob = Blob;
  const blobConstructor = vi.fn();
  class SpyBlob extends OriginalBlob {
    constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
      blobConstructor(parts, options);
      super(parts, options);
    }
  }

  vi.stubGlobal("Blob", SpyBlob);
  return blobConstructor;
}

function stubBackupDownload() {
  const createObjectURL = vi.fn(() => "blob:backup");
  const revokeObjectURL = vi.fn();
  const blobConstructor = stubBlobConstructor();
  let filename = "";

  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function captureDownloadFilename(this: HTMLAnchorElement) {
      filename = this.download;
    },
  );

  return {
    blobConstructor,
    createObjectURL,
    getFilename: () => filename,
    revokeObjectURL,
  };
}

function getDownloadedEnvelope(blobConstructor: ReturnType<typeof vi.fn>) {
  const parts = blobConstructor.mock.calls[0]?.[0] as BlobPart[] | undefined;
  const serialized = parts?.[0];
  if (typeof serialized !== "string") {
    throw new Error("Expected serialized backup JSON in the download Blob");
  }
  const parsed = parseBackupJson(serialized);
  if (!parsed.ok) {
    throw new Error("Downloaded backup fixture must remain valid");
  }
  return parsed.value;
}

type FakeCFacts = {
  bytes: string;
  current: { revisionId: string; trades: number } | null;
  previous: { revisionId: string; trades: number } | null;
  revision: string;
  pageLedger: ReturnType<typeof createInitialLedgerData>;
  repositoryWrites: number;
  importPortCalls: number;
};

function createFakeCWriteSentinel() {
  const facts: FakeCFacts = {
    bytes: "encrypted-old-current",
    current: { revisionId: "revision-0", trades: 0 },
    previous: null,
    revision: "revision-0",
    pageLedger: createInitialLedgerData(),
    repositoryWrites: 0,
    importPortCalls: 0,
  };
  const before = structuredClone(facts);
  const onImport = vi.fn(async () => {
    facts.importPortCalls += 1;
    facts.repositoryWrites += 1;
    facts.bytes = "unexpected-new-bytes";
    facts.previous = facts.current;
    facts.current = { revisionId: "unexpected-revision", trades: 1 };
    facts.revision = "unexpected-revision";
    facts.pageLedger.trades = [
      createSimpleTrade("unexpected-page-trade", "buy", "BTC", "1"),
    ];
    return { ok: true };
  });

  return { before, facts, onImport };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function renderControls(
  overrides: Partial<ComponentProps<typeof BackupControls>> = {},
) {
  const onImport = vi.fn(async () => ({ ok: true }));
  const view = render(
    <BackupControls
      hydrationStatus="ready"
      isDirty={false}
      isReadOnly={false}
      ledgerData={createInitialLedgerData()}
      onImport={onImport}
      persistenceOperation="idle"
      persistenceStatus="idle"
      {...overrides}
    />,
  );
  return { onImport, ...view };
}

describe("BackupControls", () => {
  it.each(["loading", "ready", "error"] as const)(
    "keeps the plaintext backup risk visible while hydration is %s",
    (hydrationStatus) => {
      renderControls({ hydrationStatus });

      expect(
        screen.getByText(
          /Ledger backups are unencrypted plaintext. Anyone with file access may read all assets, trades, and prices/,
        ),
      ).not.toBeNull();
      expect(screen.getByText(/Export only requests a browser download/)).not.toBeNull();
      expect(screen.getByText(/synchronized folder.*may upload or synchronize it automatically/)).not.toBeNull();
    },
  );

  it("exports the current in-memory ledger rather than reading the repository", async () => {
    const download = stubBackupDownload();
    const ledgerData = {
      ...createInitialLedgerData(),
      trades: [createSimpleTrade("current-page", "buy", "BTC", "1")],
    };
    renderControls({ clock: fixedClock, ledgerData });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Export complete ledger backup" }));

    expect(download.createObjectURL).toHaveBeenCalledOnce();
    expect(download.revokeObjectURL).toHaveBeenCalledOnce();
    expect(download.getFilename()).toBe(FIXED_BACKUP_FILENAME);
    expect(
      getDownloadedEnvelope(download.blobConstructor).ledgerData.trades[0]?.id,
    ).toBe("current-page");
    const message = screen.getByText(/Backup download requested/).textContent;
    expect(message).toContain("unencrypted plaintext");
    expect(message).toContain("Verify the download and destination");
    expect(message).toContain("secure or delete the file");
  });

  it("exports all four collections and 300 historical rawText values without derived or session state", async () => {
    const source = parseBackupJson(
      readFileSync(
        "test-fixtures/w11-b-import/valid-300.backup.json",
        "utf8",
      ),
    );
    if (!source.ok) throw new Error("Permanent export fixture must be valid");
    const download = stubBackupDownload();
    renderControls({
      clock: fixedClock,
      ledgerData: source.value.ledgerData,
    });
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Export complete ledger backup" }),
    );

    const downloaded = getDownloadedEnvelope(download.blobConstructor);
    expect(downloaded.ledgerData).toEqual(source.value.ledgerData);
    expect(downloaded.ledgerData.trades).toHaveLength(300);
    expect(
      downloaded.ledgerData.trades.every(
        (trade, index) =>
          trade.rawText ===
          `Synthetic historical trade sentence ${index + 1}: buy a test asset; not real user data.`,
      ),
    ).toBe(true);
    expect(Object.keys(downloaded)).toEqual([
      "backupFormatVersion",
      "appVersion",
      "exportedAt",
      "ledgerSchemaVersion",
      "ledgerData",
    ]);
    expect(Object.keys(downloaded.ledgerData)).toEqual([
      "schemaVersion",
      "assets",
      "trades",
      "priceSnapshots",
      "feeRules",
    ]);
  });

  it("downloads the dirty in-memory ledger as a clearly labeled rescue backup", async () => {
    const download = stubBackupDownload();
    const ledgerData = {
      ...createInitialLedgerData(),
      trades: [createSimpleTrade("dirty-page", "buy", "BTC", "1")],
    };
    renderControls({
      clock: fixedClock,
      isDirty: true,
      ledgerData,
      persistenceStatus: "error",
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Export complete ledger backup" }));

    expect(download.createObjectURL).toHaveBeenCalledOnce();
    expect(download.getFilename()).toBe(FIXED_BACKUP_FILENAME);
    expect(
      getDownloadedEnvelope(download.blobConstructor).ledgerData.trades[0]?.id,
    ).toBe("dirty-page");
    const message = screen.getByText(/Rescue backup download requested/).textContent;
    expect(message).toContain("unencrypted plaintext");
    expect(message).toContain("may be newer than the last successful save");
    expect(message).toContain("destination");
  });

  it("creates one backup Blob when the serialized envelope is exactly 8 MiB", async () => {
    const createObjectURL = vi.fn(() => "blob:backup");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const blobConstructor = stubBlobConstructor();
    renderControls({
      isReadOnly: true,
      ledgerData: createReadOnlyLedgerAtBackupBytes(
        DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes,
      ),
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Export complete ledger backup" }));

    expect(blobConstructor).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
  });

  it("does not construct a Blob when the serialized envelope exceeds 8 MiB by one byte", async () => {
    const createObjectURL = vi.fn(() => "blob:backup");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const blobConstructor = stubBlobConstructor();
    renderControls({
      isReadOnly: true,
      ledgerData: createReadOnlyLedgerAtBackupBytes(
        DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes + 1,
      ),
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Export complete ledger backup" }));

    expect(blobConstructor).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Export failed: v1 cannot safely export this oversized ledger; no backup file was created.",
      ),
    ).not.toBeNull();
  });

  it("rejects a real legal backup that exceeds 8 MiB by one byte before File.text", async () => {
    renderControls();
    const envelope = createBackupEnvelope(createInitialLedgerData(), {
      appVersion: "0.1.0",
      exportedAt: FIXED_EXPORTED_AT,
    });
    if (!envelope.ok) throw new Error("Fixture must be valid");
    const exactLimit = padSerializedBackupToBytes(
      serializeBackupEnvelope(envelope.value),
      DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes,
    );
    const serialized = `${exactLimit} `;
    const file = createPaddedBackupFile(serialized);
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("Select ledger backup file"), file);

    expect(file.size).toBe(DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes + 1);
    expect(parseBackupJson(serialized)).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({ code: "LEDGER_RESOURCE_FILE_TOO_LARGE" }),
      ],
    });
    expect(file.text).not.toHaveBeenCalled();
    expect(screen.getByText("Import failed: the file exceeds the 8 MiB limit.")).not.toBeNull();
  });

  it("accepts a real legal backup whose content is exactly 8 MiB", async () => {
    renderControls();
    const envelope = createBackupEnvelope(createInitialLedgerData(), {
      appVersion: "0.1.0",
      exportedAt: FIXED_EXPORTED_AT,
    });
    if (!envelope.ok) throw new Error("Fixture must be valid");
    const serialized = padSerializedBackupToBytes(
      serializeBackupEnvelope(envelope.value),
      DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes,
    );
    const file = createPaddedBackupFile(serialized);
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("Select ledger backup file"), file);

    expect(file.size).toBe(DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes);
    expect(byteLength(serialized)).toBe(DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes);
    expect(parseBackupJson(serialized)).toEqual({
      ok: true,
      value: expect.any(Object),
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm backup restoration" })).not.toBeNull();
    });
    expect(file.text).toHaveBeenCalledOnce();
  });

  it("requires confirmation before replacing the ledger", async () => {
    const { onImport } = renderControls();
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("Select ledger backup file"), createBackupFile());
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm backup restoration" })).not.toBeNull();
    });
    expect(onImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm backup restoration" }));
    await waitFor(() => {
      expect(onImport).toHaveBeenCalledOnce();
      expect(screen.getByText("Backup restored and saved locally.")).not.toBeNull();
    });
  });

  it("binds the exact preflight identities and a live cancellation signal to the import call", async () => {
    const { file, serialized } =
      createPermanentFixtureFile("valid-300.backup.json");
    const expected = await preflightBackupJson(serialized, {
      todayKey: "2026-07-23",
      selectionGeneration: 1,
      requireHistoricalRawText: true,
    });
    const onImport = vi.fn<
      ComponentProps<typeof BackupControls>["onImport"]
    >(async () => ({ ok: true }));
    renderControls({
      canImportBackup: true,
      requiresHistoricalRawText: true,
      onImport,
    });
    const user = userEvent.setup();

    await user.upload(
      screen.getByLabelText("Select ledger backup file"),
      file,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Confirm backup restoration",
      }),
    );
    await waitFor(() => {
      expect(onImport).toHaveBeenCalledOnce();
    });

    const [candidate, , evidence, signal] =
      onImport.mock.calls[0] ?? [];
    expect(candidate).toEqual(expected.candidate);
    expect(evidence).toEqual({
      contentIdentity: expected.contentIdentity.value,
      candidateIdentity: expected.candidateIdentity,
      selectionGeneration: expected.selectionGeneration,
      hardErrorCount: 0,
      suspiciousGroupCount: 0,
      suspiciousGroupIdentity: expected.suspiciousGroupIdentity,
      confirmedSuspiciousGroupIdentity: null,
    });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it("keeps the invalid 147th trade outside the import callback even when C import capability is enabled", async () => {
    const { file } = createPermanentFixtureFile(
      "invalid-trade-147.backup.json",
    );
    const { before, facts, onImport } = createFakeCWriteSentinel();
    renderControls({
      canImportBackup: true,
      requiresHistoricalRawText: true,
      onImport,
    });
    const user = userEvent.setup();

    await user.upload(
      screen.getByLabelText("Select ledger backup file"),
      file,
    );

    await screen.findByText(/trades\[146\]\.quantity/);
    expect(
      screen.queryByRole("button", { name: "Confirm backup restoration" }),
    ).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    expect(facts).toEqual(before);
  });

  it.each(["cancel", "unmount"] as const)(
    "aborts the bound import signal on %s while a C import is pending",
    async (action) => {
      const fixture = createPermanentFixtureFile(
        "valid-300.backup.json",
      );
      const pending = createDeferred<{
        ok: false;
        code: "LEDGER_IMPORT_CANCELLED";
      }>();
      let capturedSignal: AbortSignal | undefined;
      let capturedEvidence:
        | LedgerBackupImportEvidence
        | undefined;
      const onImport = vi.fn<
        ComponentProps<typeof BackupControls>["onImport"]
      >(
        async (
          _candidate,
          _timeSnapshot,
          evidence,
          signal,
        ) => {
          capturedEvidence = evidence;
          capturedSignal = signal;
          return pending.promise;
        },
      );
      const view = renderControls({
        canImportBackup: true,
        requiresHistoricalRawText: true,
        onImport,
      });
      const user = userEvent.setup();

      await user.upload(
        screen.getByLabelText("Select ledger backup file"),
        fixture.file,
      );
      await user.click(
        await screen.findByRole("button", {
          name: "Confirm backup restoration",
        }),
      );
      await waitFor(() => {
        expect(onImport).toHaveBeenCalledOnce();
        expect(
          screen.getByText(
            /cancel attempts to restore and reread the complete pre-import C. If restoration cannot be confirmed, the session disables further writes/,
          ),
        ).not.toBeNull();
        expect(capturedSignal?.aborted).toBe(false);
        expect(capturedEvidence).toBeDefined();
        if (capturedEvidence) {
          expect(
            inspectLedgerBackupImportEvidence(
              capturedEvidence,
            ),
          ).not.toBeNull();
        }
      });

      if (action === "cancel") {
        await user.click(
          screen.getByRole("button", { name: "Cancel" }),
        );
      } else {
        view.unmount();
      }
      expect(capturedSignal?.aborted).toBe(true);
      if (capturedEvidence) {
        expect(
          inspectLedgerBackupImportEvidence(capturedEvidence),
        ).toBeNull();
      }

      await act(async () => {
        pending.resolve({
          ok: false,
          code: "LEDGER_IMPORT_CANCELLED",
        });
        await pending.promise;
      });
      expect(onImport).toHaveBeenCalledOnce();
    },
  );

  it.each([
    [
      "LEDGER_IMPORT_CANCELLED",
      "Import canceled; the current page was not replaced.",
    ],
    [
      "LEDGER_IMPORT_BASE_RESTORED",
      "Import did not complete. A reread confirmed C was restored to the complete pre-import version; the page did not change.",
    ],
    [
      "LEDGER_IMPORT_SOURCE_CHANGED",
      "C changed externally before import writing. Nothing was written; reopen C.",
    ],
    [
      "LEDGER_IMPORT_RECOVERY_BLOCKED",
      "The import result cannot be confirmed and C restoration cannot be proven. Writes are disabled for this session; lock immediately and preserve the file for recovery.",
    ],
    [
      "LEDGER_REPOSITORY_WRITE_FAILED",
      "Import failed and the page did not change. No further evidence confirms the underlying storage state; follow the error guidance.",
    ],
  ] as const)(
    "reports %s without overstating recovery evidence",
    async (code, expectedMessage) => {
      const onImport = vi.fn<
        ComponentProps<typeof BackupControls>["onImport"]
      >(async () => ({ ok: false, code }));
      renderControls({ onImport });
      const user = userEvent.setup();
      const file = createBackupFile();
      const beforeHash = sha256(await file.text());

      await user.upload(
        screen.getByLabelText("Select ledger backup file"),
        file,
      );
      await user.click(
        await screen.findByRole("button", {
          name: "Confirm backup restoration",
        }),
      );

      expect(await screen.findByText(expectedMessage)).not.toBeNull();
      expect(sha256(await file.text())).toBe(beforeHash);
    },
  );

  it("shows the complete backup candidate and lets the same file be selected after cancel", async () => {
    renderControls();
    const user = userEvent.setup();
    const input = screen.getByLabelText("Select ledger backup file");
    const file = createBackupFile();

    await user.upload(input, file);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm backup restoration" })).not.toBeNull();
    });
    expect(screen.getByText("App version")).not.toBeNull();
    expect(screen.getByText("Exported at")).not.toBeNull();
    expect(screen.getByText("Assets")).not.toBeNull();
    expect(screen.getByText("Trades")).not.toBeNull();
    expect(screen.getByText("Price snapshots")).not.toBeNull();
    expect(screen.getByText("Fee rules")).not.toBeNull();
    expect(screen.getByText(/selected source backup remains unencrypted plaintext/)).not.toBeNull();
    expect(screen.getByText(/This app does not move, delete, or upload it/)).not.toBeNull();
    expect(screen.getByText(/synchronized folder.*system may synchronize it automatically/)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Confirm backup restoration" })).toBeNull();

    await user.upload(input, file);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm backup restoration" })).not.toBeNull();
    });
  });

  it("lets the same file be selected after a successful import", async () => {
    const { onImport } = renderControls();
    const user = userEvent.setup();
    const input = screen.getByLabelText("Select ledger backup file");
    const file = createBackupFile();
    const beforeHash = sha256(await file.text());

    await user.upload(input, file);
    await user.click(
      await screen.findByRole("button", { name: "Confirm backup restoration" }),
    );
    await waitFor(() => {
      expect(onImport).toHaveBeenCalledOnce();
      expect(screen.getByText("Backup restored and saved locally.")).not.toBeNull();
    });
    expect(sha256(await file.text())).toBe(beforeHash);

    await user.upload(input, file);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm backup restoration" })).not.toBeNull();
    });
    expect(sha256(await file.text())).toBe(beforeHash);
  });

  it("shows structured parser errors and clears them on a new selection", async () => {
    renderControls();
    const invalidFile = new File(["{"], "invalid.json", {
      type: "application/json",
    });
    Object.defineProperty(invalidFile, "text", {
      configurable: true,
      value: vi.fn(async () => "{"),
    });
    const user = userEvent.setup();
    const input = screen.getByLabelText("Select ledger backup file");

    await user.upload(input, invalidFile);
    await waitFor(() => {
      expect(screen.getByText(/BACKUP_BAD_JSON/)).not.toBeNull();
      expect(screen.getByText(/Found 1 import errors/)).not.toBeNull();
    });

    await user.upload(input, createBackupFile("valid.json"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm backup restoration" })).not.toBeNull();
    });
    expect(screen.queryByText(/BACKUP_BAD_JSON/)).toBeNull();
  });

  it("ignores an earlier file read after the user selects a newer file", async () => {
    const { before, facts, onImport } = createFakeCWriteSentinel();
    renderControls({ canImportBackup: false, onImport });
    const firstRead = createDeferred<string>();
    const firstFile = createBackupFile("first.json");
    Object.defineProperty(firstFile, "text", {
      configurable: true,
      value: vi.fn(() => firstRead.promise),
    });
    const secondFile = createBackupFile("second.json");
    const user = userEvent.setup();
    const input = screen.getByLabelText("Select ledger backup file");

    await user.upload(input, firstFile);
    await user.upload(input, secondFile);
    await waitFor(() => {
      expect(screen.getByText("Historical B Import Preflight Report")).not.toBeNull();
    });
    await act(async () => {
      firstRead.resolve("{");
      await firstRead.promise;
    });

    expect(screen.queryByText("Import failed: backup file format or content is invalid.")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Confirm backup restoration" }),
    ).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    expect(facts).toEqual(before);
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a pending File.text %s after the user cancels",
    async (settlement) => {
      const { before, facts, onImport } = createFakeCWriteSentinel();
      renderControls({ canImportBackup: false, onImport });
      const read = createDeferred<string>();
      const file = createBackupFile("pending.json");
      Object.defineProperty(file, "text", {
        configurable: true,
        value: vi.fn(() => read.promise),
      });
      const user = userEvent.setup();

      await user.upload(screen.getByLabelText("Select ledger backup file"), file);
      expect(screen.getByText("Reading the backup file.")).not.toBeNull();
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      if (settlement === "resolve") {
        read.resolve("{");
      } else {
        read.reject(new Error("late read failure"));
      }
      await Promise.resolve();
      await Promise.resolve();

      expect(screen.queryByRole("button", { name: "Confirm backup restoration" })).toBeNull();
      expect(screen.queryByText("The backup file could not be read.")).toBeNull();
      expect(
        screen.queryByText("Import failed: backup file format or content is invalid."),
      ).toBeNull();
      expect(onImport).not.toHaveBeenCalled();
      expect(facts).toEqual(before);
    },
  );

  it.each(["resolve", "reject"] as const)(
    "ignores a pending File.text %s after unmount",
    async (settlement) => {
      const read = createDeferred<string>();
      const file = createBackupFile("pending-unmount.json");
      Object.defineProperty(file, "text", {
        configurable: true,
        value: vi.fn(() => read.promise),
      });
      const { before, facts, onImport } = createFakeCWriteSentinel();
      const view = renderControls({
        canImportBackup: false,
        onImport,
      });
      const user = userEvent.setup();

      await user.upload(screen.getByLabelText("Select ledger backup file"), file);
      view.unmount();

      if (settlement === "resolve") {
        read.resolve("{");
      } else {
        read.reject(new Error("late read failure"));
      }
      await Promise.resolve();
      await Promise.resolve();
      expect(onImport).not.toHaveBeenCalled();
      expect(facts).toEqual(before);
    },
  );

  it("opens strict read-only preflight for C while keeping import, repository and every fake C fact at zero writes", async () => {
    const { file, serialized } =
      createPermanentFixtureFile("valid-300.backup.json");
    const { before, facts, onImport } = createFakeCWriteSentinel();
    renderControls({ canImportBackup: false, onImport });
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("Select ledger backup file"), file);

    await waitFor(() => {
      expect(screen.getByText("Historical B Import Preflight Report")).not.toBeNull();
      expect(screen.getByText(/The current C exposes only read-only B preflight/)).not.toBeNull();
    });
    expect(screen.getByText("300")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm backup restoration" })).toBeNull();
    expect(screen.queryByRole("button", { name: "I reviewed every suspicious group" })).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    expect(facts).toEqual(before);
    expect(file.text).toHaveBeenCalledOnce();
    expect(serialized).toBe(
      readFileSync(
        "test-fixtures/w11-b-import/valid-300.backup.json",
        "utf8",
      ),
    );
  });

  it.each([
    "read-failure",
    "oversized",
    "bad-json",
    "hard-error",
    "business-error",
  ] as const)(
    "keeps import, repository, bytes, generations, revision and page data unchanged for C %s",
    async (scenario) => {
      const { before, facts, onImport } = createFakeCWriteSentinel();
      renderControls({ canImportBackup: false, onImport });
      const user = userEvent.setup();
      let file: File;

      if (scenario === "read-failure") {
        file = createBackupFile("read-failure.json");
        Object.defineProperty(file, "text", {
          configurable: true,
          value: vi.fn(async () => {
            throw new Error("read failed");
          }),
        });
      } else if (scenario === "oversized") {
        file = createPaddedBackupFile(
          "x".repeat(DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes + 1),
          "oversized.json",
        );
      } else if (scenario === "bad-json") {
        file = createPaddedBackupFile("{", "bad-json.json");
      } else if (scenario === "hard-error") {
        file = createPermanentFixtureFile(
          "invalid-trade-147.backup.json",
        ).file;
      } else {
        const parsed = JSON.parse(
          createPermanentFixtureFile(
            "valid-300.backup.json",
          ).serialized,
        );
        parsed.ledgerData.trades[0].occurredAt =
          "2099-01-01T00:00:00Z";
        file = createPaddedBackupFile(
          `${JSON.stringify(parsed, null, 2)}\n`,
          "future-business-error.json",
        );
      }

      await user.upload(
        screen.getByLabelText("Select ledger backup file"),
        file,
      );

      if (scenario === "read-failure") {
        await screen.findByText("The backup file could not be read.");
      } else if (scenario === "oversized") {
        expect(
          screen.getByText("Import failed: the file exceeds the 8 MiB limit."),
        ).not.toBeNull();
      } else if (scenario === "bad-json") {
        await screen.findByText(/BACKUP_BAD_JSON/);
      } else if (scenario === "hard-error") {
        await screen.findByText(/trades\[146\]\.quantity/);
      } else {
        await screen.findByText(/LEDGER_IMPORT_FUTURE_FACT/);
      }

      expect(
        screen.queryByRole("button", { name: "Confirm backup restoration" }),
      ).toBeNull();
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(
        screen.queryByText("Historical B Import Preflight Report"),
      ).toBeNull();
      expect(onImport).not.toHaveBeenCalled();
      expect(facts).toEqual(before);
    },
  );

  it("shows hard errors and duplicate warnings together for C but cannot forge a write through suspicion confirmation", async () => {
    const { file } = createPermanentFixtureFile(
      "preflight-errors-and-duplicates.backup.json",
    );
    const onImport = vi.fn(async () => ({ ok: true }));
    renderControls({ canImportBackup: false, onImport });
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("Select ledger backup file"), file);

    await waitFor(() => {
      expect(screen.getByText(/trades\[0\]\.quantity/)).not.toBeNull();
      expect(screen.getByText(/trades\[7\]\.rawText/)).not.toBeNull();
      expect(screen.getByText(/Highly suspicious/)).not.toBeNull();
      expect(screen.getByText("Suspicious")).not.toBeNull();
    });
    expect(screen.queryByRole("button", { name: "Confirm backup restoration" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "I reviewed every suspicious group" }),
    ).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("keeps the selected B byte-for-byte unchanged through preflight, report copy, suspicion confirmation and cancel", async () => {
    const { file, serialized } = createPermanentFixtureFile(
      "suspicions-only.backup.json",
    );
    const beforeHash = sha256(await file.text());
    const { before, facts, onImport } = createFakeCWriteSentinel();
    const writeText = vi.fn(async (markdown: string) => {
      void markdown;
    });
    renderControls({ canImportBackup: false, onImport });
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await user.upload(
      screen.getByLabelText("Select ledger backup file"),
      file,
    );
    await screen.findByRole("button", {
      name: "I reviewed every suspicious group",
    });
    expect(sha256(await file.text())).toBe(beforeHash);
    await user.click(
      screen.getByRole("button", { name: "Copy Markdown report" }),
    );
    await screen.findByText("Report copied.");
    expect(sha256(await file.text())).toBe(beforeHash);
    await user.click(
      screen.getByRole("button", { name: "I reviewed every suspicious group" }),
    );
    expect(screen.getByText(/Current suspicious groups confirmed/)).not.toBeNull();
    expect(sha256(await file.text())).toBe(beforeHash);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(sha256(await file.text())).toBe(beforeHash);
    expect(sha256(serialized)).toBe(beforeHash);
    expect(onImport).not.toHaveBeenCalled();
    expect(facts).toEqual(before);
  });

  it("binds one suspicion acknowledgement to the current C preflight without opening a write button", async () => {
    const { file } = createPermanentFixtureFile(
      "suspicions-only.backup.json",
    );
    const onImport = vi.fn(async () => ({ ok: true }));
    renderControls({ canImportBackup: false, onImport });
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("Select ledger backup file"), file);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "I reviewed every suspicious group" }),
      ).not.toBeNull();
    });
    await user.click(
      screen.getByRole("button", { name: "I reviewed every suspicious group" }),
    );

    expect(screen.getByText(/Current suspicious groups confirmed/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm backup restoration" })).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("renders only 50 details but copies the permanent 1000-item Markdown report with an honest 1001 truncation", async () => {
    const { file } = createPermanentFixtureFile(
      "report-1001.backup.json",
    );
    const writeText = vi.fn(async (markdown: string) => {
      void markdown;
    });
    renderControls({ canImportBackup: false });
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await user.upload(screen.getByLabelText("Select ledger backup file"), file);
    const detailList = await screen.findByRole("list", {
      name: "Preflight details (up to 50 items on the page)",
    });
    expect(within(detailList).getAllByRole("listitem")).toHaveLength(50);
    expect(screen.getByText(/1000 \/ 1001/)).not.toBeNull();
    expect(screen.getByText(/Details after item 1000 were truncated/)).not.toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Copy Markdown report" }),
    );
    await waitFor(() => {
      expect(screen.getByText("Report copied.")).not.toBeNull();
    });
    const markdown = writeText.mock.calls[0]?.[0];
    expect(markdown).toContain("Privacy notice");
    expect(markdown).toContain("`trades[999].quantity`");
    expect(markdown).not.toContain("`trades[1000].quantity`");
    expect(markdown).toContain("Total detail count: 1001");
  });

  it("does not claim a report was copied when the clipboard rejects", async () => {
    const { file } = createPermanentFixtureFile(
      "preflight-errors-and-duplicates.backup.json",
    );
    renderControls({ canImportBackup: false });
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error("clipboard denied");
        }),
      },
    });

    await user.upload(screen.getByLabelText("Select ledger backup file"), file);
    await screen.findByText("Historical B Import Preflight Report");
    await user.click(
      screen.getByRole("button", { name: "Copy Markdown report" }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Copy failed/)).not.toBeNull();
    });
    expect(screen.queryByText("Report copied.")).toBeNull();
  });

  it("invalidates a late preflight after cancel before it can revive a report or write action", async () => {
    const { file, serialized } =
      createPermanentFixtureFile("valid-300.backup.json");
    const eventualResult = await preflightBackupJson(serialized, {
      todayKey: "2026-07-31",
      selectionGeneration: 1,
      requireHistoricalRawText: true,
    });
    const eventualEvidence =
      createLedgerBackupImportEvidence(eventualResult);
    expect(eventualEvidence).not.toBeNull();
    const pending = createDeferred<BackupImportPreflightResult>();
    const preflight = vi.fn(() => pending.promise);
    const { before, facts, onImport } = createFakeCWriteSentinel();
    renderControls({
      canImportBackup: false,
      onImport,
      preflight,
    });
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText("Select ledger backup file"), file);
    await waitFor(() => {
      expect(preflight).toHaveBeenCalledOnce();
      expect(screen.getByText(/Running read-only preflight/)).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {
      pending.resolve(eventualResult);
      await pending.promise;
    });

    expect(screen.queryByText("Historical B Import Preflight Report")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm backup restoration" })).toBeNull();
    expect(createLedgerBackupImportEvidence(eventualResult)).toBeNull();
    expect(inspectLedgerBackupImportEvidence(eventualEvidence!)).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    expect(facts).toEqual(before);
  });

  it("invalidates an older preflight after a newer file selection", async () => {
    const first = createPermanentFixtureFile(
      "suspicions-only.backup.json",
    );
    const second = createPermanentFixtureFile("valid-300.backup.json");
    const firstResult = await preflightBackupJson(first.serialized, {
      todayKey: "2026-07-31",
      selectionGeneration: 1,
      requireHistoricalRawText: true,
    });
    const firstConfirmation =
      confirmBackupImportSuspiciousGroups(firstResult);
    const firstEvidence = createLedgerBackupImportEvidence(
      firstResult,
      firstConfirmation,
    );
    expect(firstEvidence).not.toBeNull();
    const pending = createDeferred<BackupImportPreflightResult>();
    const preflight = vi.fn(
      (
        text: string,
        options: Parameters<typeof preflightBackupJson>[1],
      ) =>
        text === first.serialized
          ? pending.promise
          : preflightBackupJson(text, options),
    );
    const { before, facts, onImport } = createFakeCWriteSentinel();
    renderControls({
      canImportBackup: false,
      onImport,
      preflight,
    });
    const user = userEvent.setup();
    const input = screen.getByLabelText("Select ledger backup file");

    await user.upload(input, first.file);
    await screen.findByText(/Running read-only preflight/);
    await user.upload(input, second.file);
    await waitFor(() => {
      expect(screen.getByText("300")).not.toBeNull();
    });
    await act(async () => {
      pending.resolve(firstResult);
      await pending.promise;
    });

    expect(screen.getByText("300")).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "I reviewed every suspicious group" }),
    ).toBeNull();
    expect(
      createLedgerBackupImportEvidence(
        firstResult,
        firstConfirmation,
      ),
    ).toBeNull();
    expect(inspectLedgerBackupImportEvidence(firstEvidence!)).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    expect(facts).toEqual(before);
  });

  it("invalidates a late preflight after unmount", async () => {
    const fixture = createPermanentFixtureFile("valid-300.backup.json");
    const eventualResult = await preflightBackupJson(fixture.serialized, {
      todayKey: "2026-07-31",
      selectionGeneration: 1,
      requireHistoricalRawText: true,
    });
    const eventualEvidence =
      createLedgerBackupImportEvidence(eventualResult);
    expect(eventualEvidence).not.toBeNull();
    const pending = createDeferred<BackupImportPreflightResult>();
    const { before, facts, onImport } = createFakeCWriteSentinel();
    const view = renderControls({
      canImportBackup: false,
      onImport,
      preflight: vi.fn(() => pending.promise),
    });
    const user = userEvent.setup();

    await user.upload(
      screen.getByLabelText("Select ledger backup file"),
      fixture.file,
    );
    await screen.findByText(/Running read-only preflight/);
    view.unmount();
    await act(async () => {
      pending.resolve(eventualResult);
      await pending.promise;
    });

    expect(createLedgerBackupImportEvidence(eventualResult)).toBeNull();
    expect(inspectLedgerBackupImportEvidence(eventualEvidence!)).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    expect(facts).toEqual(before);
  });

  it("invalidates a late clipboard success when a newer file is selected", async () => {
    const first = createPermanentFixtureFile(
      "preflight-errors-and-duplicates.backup.json",
    );
    const second = createPermanentFixtureFile("valid-300.backup.json");
    const clipboard = createDeferred<void>();
    const writeText = vi.fn((markdown: string) => {
      void markdown;
      return clipboard.promise;
    });
    const { before, facts, onImport } = createFakeCWriteSentinel();
    renderControls({ canImportBackup: false, onImport });
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const input = screen.getByLabelText("Select ledger backup file");

    await user.upload(input, first.file);
    await screen.findByText("Historical B Import Preflight Report");
    await user.click(
      screen.getByRole("button", { name: "Copy Markdown report" }),
    );
    expect(screen.getByText("Copying report.")).not.toBeNull();

    await user.upload(input, second.file);
    await waitFor(() => {
      expect(screen.getByText("300")).not.toBeNull();
    });
    await act(async () => {
      clipboard.resolve();
      await clipboard.promise;
    });

    expect(screen.queryByText("Report copied.")).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    expect(facts).toEqual(before);
  });

  it.each(["cancel", "unmount"] as const)(
    "invalidates a late clipboard success after %s",
    async (action) => {
      const fixture = createPermanentFixtureFile(
        "preflight-errors-and-duplicates.backup.json",
      );
      const clipboard = createDeferred<void>();
      const writeText = vi.fn((markdown: string) => {
        void markdown;
        return clipboard.promise;
      });
      const { before, facts, onImport } = createFakeCWriteSentinel();
      const view = renderControls({
        canImportBackup: false,
        onImport,
      });
      const user = userEvent.setup();
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });

      await user.upload(
        screen.getByLabelText("Select ledger backup file"),
        fixture.file,
      );
      await screen.findByText("Historical B Import Preflight Report");
      await user.click(
        screen.getByRole("button", { name: "Copy Markdown report" }),
      );
      expect(screen.getByText("Copying report.")).not.toBeNull();
      if (action === "cancel") {
        await user.click(screen.getByRole("button", { name: "Cancel" }));
      } else {
        view.unmount();
      }
      await act(async () => {
        clipboard.resolve();
        await clipboard.promise;
      });

      if (action === "cancel") {
        expect(screen.queryByText("Report copied.")).toBeNull();
      }
      expect(onImport).not.toHaveBeenCalled();
      expect(facts).toEqual(before);
    },
  );

  it.each(["reselect", "cancel", "unmount"] as const)(
    "invalidates a suspicion confirmation token after %s",
    async (action) => {
      const fixture = createPermanentFixtureFile(
        "suspicions-only.backup.json",
      );
      const { before, facts, onImport } = createFakeCWriteSentinel();
      const view = renderControls({
        canImportBackup: false,
        onImport,
      });
      const user = userEvent.setup();
      let input = screen.getByLabelText("Select ledger backup file");

      await user.upload(input, fixture.file);
      await screen.findByRole("button", {
        name: "I reviewed every suspicious group",
      });
      await user.click(
        screen.getByRole("button", { name: "I reviewed every suspicious group" }),
      );
      expect(screen.getByText(/Current suspicious groups confirmed/)).not.toBeNull();

      if (action === "cancel") {
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        input = screen.getByLabelText("Select ledger backup file");
      } else if (action === "unmount") {
        view.unmount();
        renderControls({ canImportBackup: false, onImport });
        input = screen.getByLabelText("Select ledger backup file");
      }
      await user.upload(input, fixture.file);

      expect(
        await screen.findByRole("button", {
          name: "I reviewed every suspicious group",
        }),
      ).not.toBeNull();
      expect(screen.queryByText(/Current suspicious groups confirmed/)).toBeNull();
      expect(onImport).not.toHaveBeenCalled();
      expect(facts).toEqual(before);
    },
  );

  it("reports a download driver exception without claiming the backup was started or safe", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => {
        throw new Error("object URL failed");
      }),
      revokeObjectURL: vi.fn(),
    });
    renderControls({ clock: fixedClock });
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Export complete ledger backup" }),
    );

    expect(screen.getByText(/download success is unknown/)).not.toBeNull();
    expect(screen.queryByText(/Backup download requested/)).toBeNull();
    expect(screen.queryByText(/saved safely/)).toBeNull();
  });

  it("states that a read-only rescue backup may not be importable", async () => {
    const download = stubBackupDownload();
    renderControls({ clock: fixedClock, isReadOnly: true });
    const user = userEvent.setup();

    expect(screen.getByRole("button", { name: "Export complete ledger backup" })).not.toBeNull();
    expect(screen.queryByLabelText("Select ledger backup file")).toBeNull();
    expect(
      screen.getByText(
        /oversized collections or strings may prevent re-import/,
      ),
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Export complete ledger backup" }));

    expect(download.createObjectURL).toHaveBeenCalledOnce();
    expect(download.getFilename()).toBe(FIXED_BACKUP_FILENAME);
    expect(
      getDownloadedEnvelope(download.blobConstructor).ledgerData,
    ).toEqual(createInitialLedgerData());
    const message = screen.getByText(
      /Read-only rescue backup download requested/,
    ).textContent;
    expect(message).toContain(
      "may not be re-importable by this version if collections or strings exceed limits",
    );
    expect(message).toContain("unencrypted plaintext");
    expect(message).toContain("destination");
  });

  it("shows recovery import but no export after hydration fails", () => {
    renderControls({ hydrationStatus: "error" });

    expect(screen.queryByRole("button", { name: "Export complete ledger backup" })).toBeNull();
    expect(screen.getByLabelText("Select ledger backup file")).not.toBeNull();
    expect(screen.getByText("A valid backup can restore the local ledger.")).not.toBeNull();
  });
});

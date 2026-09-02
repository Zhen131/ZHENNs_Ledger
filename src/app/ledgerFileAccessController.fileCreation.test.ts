import { describe, expect, it, vi } from "vitest";
import {
  LedgerFileHandleAdapter,
  type LedgerFilePickerProvider,
} from "@/platform/files";
import type { LedgerFileSessionCoordinator } from "@/platform/coordination";
import { createInitialLedgerData } from "@/core/state";
import {
  DefaultLedgerFileAccessController,
  LEDGER_FILE_ACCESS_ERROR_CODES,
} from "./ledgerFileAccessController";
import {
  MemoryFileHandle,
  PASSPHRASE,
  createConnectionAdapter,
  createController,
  createInspectableLedgerFile,
  createTestCoordinator,
  createTestLease,
} from "./ledgerFileAccessController.testHelpers";

describe("DefaultLedgerFileAccessController", () => {
  it("creates only the selected empty .lftl and returns a file-only session", async () => {
    const handle = new MemoryFileHandle("ledger.lftl");
    const { controller, provider } = createController(handle);

    const result = await controller.create(PASSPHRASE);

    expect(result.ok).toBe(true);
    expect(provider.showSaveFilePicker).toHaveBeenCalledOnce();
    expect(handle.writes).toBe(1);
    if (!result.ok) return;
    expect(result.session).toMatchObject({
      storageKind: "ledger-file",
      capabilities: {
        canClearReadyLedger: true,
        canClearHydrationError: false,
        canImportBackup: true,
      },
    });
    expect(result.session.readyImportPort).not.toBeNull();
    await expect(result.session.repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
    expect(controller).not.toHaveProperty("releaseActiveSession");
    expect(result.session).toHaveProperty("beginQuiesce");
    expect(result.session).toHaveProperty("lockAfterQuiesce");
  });

  it("does not overwrite a non-empty save-picker target", async () => {
    const handle = new MemoryFileHandle("ledger.lftl", "existing bytes");
    const lease = createTestLease("non-empty-create");
    const coordinator: LedgerFileSessionCoordinator = {
      acquire: vi.fn(async () => ({
        status: "acquired" as const,
        lease,
      })),
    };
    const { controller } = createController(
      handle,
      handle,
      coordinator,
    );

    await expect(controller.create(PASSPHRASE)).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.NON_EMPTY_CREATE_TARGET,
    });
    expect(handle.writes).toBe(0);
    expect(new TextDecoder().decode(handle.bytes)).toBe("existing bytes");
    expect(lease.release).toHaveBeenCalledOnce();
  });

  it("treats picker cancellation as normal and creates no file", async () => {
    const cancellation = Object.assign(new Error("cancelled"), {
      name: "AbortError",
    });
    const provider: LedgerFilePickerProvider = {
      showSaveFilePicker: vi.fn(async () => {
        throw cancellation;
      }),
      showOpenFilePicker: vi.fn(async () => {
        throw cancellation;
      }),
    };
    const connection = createConnectionAdapter();
    const controller = new DefaultLedgerFileAccessController(
      new LedgerFileHandleAdapter(provider),
      {},
      createTestCoordinator(),
      () => "unused-recovery",
      connection.adapter,
    );

    await expect(controller.create(PASSPHRASE)).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
    });
    await expect(controller.selectExisting()).resolves.toEqual({
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
    });
    expect(connection.adapter.write).not.toHaveBeenCalled();
    expect(connection.current()).toBeNull();
  });

  it("rejects a non-.lftl Open fallback before reading or publishing a connection", async () => {
    const handle = new MemoryFileHandle("not-a-ledger.json", "{}");
    const getFile = vi.spyOn(handle, "getFile");
    const connection = createConnectionAdapter();
    const { controller } = createController(
      new MemoryFileHandle("unused.lftl"),
      handle,
      createTestCoordinator(),
      () => "unused-recovery",
      connection.adapter,
    );

    await expect(controller.selectExisting()).resolves.toEqual({
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_EXTENSION,
    });
    expect(getFile).not.toHaveBeenCalled();
    expect(handle.writes).toBe(0);
    expect(connection.adapter.write).not.toHaveBeenCalled();
    expect(connection.current()).toBeNull();
    await expect(controller.unlockSelected(PASSPHRASE)).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION,
    });
  });

  it("rejects zero-byte and damaged open targets without creating an initial ledger", async () => {
    for (const handle of [
      new MemoryFileHandle("empty.lftl"),
      new MemoryFileHandle("damaged.lftl", "{bad json"),
    ]) {
      const { controller } = createController(
        new MemoryFileHandle("unused.lftl"),
        handle,
      );
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_FILE,
      });
      expect(handle.writes).toBe(0);
    }
  });

  it("rejects a V1 .lftl before password or connection-record publication", async () => {
    const handle = new MemoryFileHandle(
      "retired-v1.lftl",
      createInspectableLedgerFile(4, 1),
    );
    const before = handle.bytes.slice();
    const connection = createConnectionAdapter();
    const { controller } = createController(
      new MemoryFileHandle("unused.lftl"),
      handle,
      createTestCoordinator(),
      () => "recovery-test",
      connection.adapter,
    );

    await expect(controller.selectExisting()).resolves.toEqual({
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.UNSUPPORTED_FILE_VERSION,
    });
    expect(handle.bytes).toEqual(before);
    expect(handle.writes).toBe(0);
    expect(handle.remove).not.toHaveBeenCalled();
    expect(connection.adapter.write).not.toHaveBeenCalled();
    await expect(controller.unlockSelected(PASSPHRASE)).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION,
    });
  });

  it.each([2, 3] as const)(
    "rejects a V%i ledger schema before password, decryption, writes, or connection publication",
    async (ledgerSchemaVersion) => {
      const handle = new MemoryFileHandle(
        `retired-ledger-v${ledgerSchemaVersion}.lftl`,
        createInspectableLedgerFile(ledgerSchemaVersion),
      );
      const before = handle.bytes.slice();
      const connection = createConnectionAdapter();
      const { controller } = createController(
        new MemoryFileHandle("unused.lftl"),
        handle,
        createTestCoordinator(),
        () => "unused-recovery",
        connection.adapter,
      );

      await expect(controller.selectExisting()).resolves.toEqual({
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.UNSUPPORTED_LEDGER_SCHEMA,
      });
      expect(handle.bytes).toEqual(before);
      expect(handle.writes).toBe(0);
      expect(handle.remove).not.toHaveBeenCalled();
      expect(connection.adapter.write).not.toHaveBeenCalled();
      expect(connection.current()).toBeNull();
      await expect(controller.unlockSelected(PASSPHRASE)).resolves.toEqual({
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION,
      });
    },
  );
});

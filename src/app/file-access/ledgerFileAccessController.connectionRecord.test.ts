import { describe, expect, it, vi } from "vitest";
import {
  LedgerFileConnectionRecordError,
  type
  LedgerFileConnectionRecordV1,
} from "@/platform/files";
import { LEDGER_FILE_ACCESS_ERROR_CODES } from "./ledgerFileAccessController";
import {
  MemoryFileHandle,
  PASSPHRASE,
  createConnectionAdapter,
  createController,
  createDeferred,
  createExistingLedgerHandle,
  createTestCoordinator,
  createTestLease,
} from "./ledgerFileAccessController.testHelpers";

describe("DefaultLedgerFileAccessController", () => {
  it("fails closed when physical-entry comparison rejects", async () => {
    const original = await createExistingLedgerHandle("compare-fails");
    const replacement = new MemoryFileHandle(
      "compare-fails.lftl",
      original.bytes,
    );
    vi.spyOn(original, "isSameEntry").mockRejectedValue(
      new Error("identity unavailable"),
    );
    const connection = createConnectionAdapter({
      connectionFormatVersion: 1,
      handle: original,
      expectedFileId: "file-compare-fails",
    });
    const { controller } = createController(
      original,
      replacement,
      createTestCoordinator(),
      () => "recovery-test",
      connection.adapter,
    );
    original.permissionState = "denied";
    await controller.inspectRememberedConnection();
    const read = vi.spyOn(replacement, "getFile");

    await expect(
      controller.reselectRememberedConnection(),
    ).resolves.toEqual({
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.RECONNECT_FAILED,
    });
    expect(read).not.toHaveBeenCalled();
    expect(connection.adapter.write).not.toHaveBeenCalled();
  });

  it("rejects the same physical entry when its verified ledger identity differs", async () => {
    const original = await createExistingLedgerHandle("expected");
    const replacement = await createExistingLedgerHandle("other");
    vi.spyOn(original, "isSameEntry").mockResolvedValue(true);
    const connection = createConnectionAdapter({
      connectionFormatVersion: 1,
      handle: original,
      expectedFileId: "file-expected",
    });
    const { controller } = createController(
      original,
      replacement,
      createTestCoordinator(),
      () => "recovery-test",
      connection.adapter,
    );
    original.permissionState = "denied";
    await controller.inspectRememberedConnection();

    await expect(
      controller.reselectRememberedConnection(),
    ).resolves.toEqual({
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.WRONG_RECONNECT_FILE,
    });
    expect(connection.adapter.write).not.toHaveBeenCalled();
    expect(replacement.writes).toBe(0);
  });

  it("reports unreadable and corrupt remembered records without creating an empty ledger", async () => {
    const unreadable = await createExistingLedgerHandle("unreadable");
    vi.spyOn(unreadable, "getFile").mockRejectedValue(
      new Error("file moved"),
    );
    const unreadableConnection = createConnectionAdapter({
      connectionFormatVersion: 1,
      handle: unreadable,
      expectedFileId: "file-unreadable",
    });
    const { controller: unreadableController, provider } =
      createController(
        unreadable,
        unreadable,
        createTestCoordinator(),
        () => "recovery-test",
        unreadableConnection.adapter,
      );

    await expect(
      unreadableController.inspectRememberedConnection(),
    ).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.RECONNECT_FAILED,
    });
    expect(provider.showSaveFilePicker).not.toHaveBeenCalled();

    const corruptConnection = createConnectionAdapter();
    vi.mocked(corruptConnection.adapter.read).mockRejectedValueOnce(
      new LedgerFileConnectionRecordError("corrupt record"),
    );
    const { controller: corruptController } = createController(
      unreadable,
      unreadable,
      createTestCoordinator(),
      () => "recovery-test",
      corruptConnection.adapter,
    );
    await expect(
      corruptController.inspectRememberedConnection(),
    ).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.CONNECTION_INVALID,
    });
  });

  it("invalidates a late permission query and cannot publish it as a pending unlock", async () => {
    const handle = await createExistingLedgerHandle("late-permission");
    const permission =
      createDeferred<"granted" | "prompt" | "denied">();
    handle.queryPermission.mockImplementationOnce(
      () => permission.promise,
    );
    const connection = createConnectionAdapter({
      connectionFormatVersion: 1,
      handle,
      expectedFileId: "file-late-permission",
    });
    const { controller } = createController(
      handle,
      handle,
      createTestCoordinator(),
      () => "recovery-test",
      connection.adapter,
    );

    const reconnect = controller.inspectRememberedConnection();
    await vi.waitFor(() => {
      expect(handle.queryPermission).toHaveBeenCalledOnce();
    });
    controller.cancelPendingSelection();
    permission.resolve("granted");

    await expect(reconnect).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
    });
    await expect(
      controller.unlockSelected(PASSPHRASE),
    ).resolves.toMatchObject({
      status: "error",
      code: LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION,
    });
    expect(connection.adapter.write).not.toHaveBeenCalled();
  });

  it("does not publish a created session when the minimal connection record cannot commit", async () => {
    const handle = new MemoryFileHandle("connection-write-fails.lftl");
    const lease = createTestLease("connection-write-fails");
    const connection = createConnectionAdapter();
    vi.mocked(connection.adapter.write).mockRejectedValueOnce(
      new Error("connection write failed"),
    );
    const { controller } = createController(
      handle,
      handle,
      {
        acquire: vi.fn(async () => ({
          status: "acquired" as const,
          lease,
        })),
      },
      () => "recovery-test",
      connection.adapter,
    );

    await expect(controller.create(PASSPHRASE)).resolves.toMatchObject({
      status: "error",
      code: LEDGER_FILE_ACCESS_ERROR_CODES.CONNECTION_SAVE_FAILED,
    });
    expect(lease.release).toHaveBeenCalledOnce();
    expect(connection.current()).toBeNull();
  });

  it("persists the fileId from the authenticated create readback without a later unauthenticated identity read", async () => {
    const handle = new MemoryFileHandle("verified-create.lftl");
    const read = vi.spyOn(handle, "getFile");
    const connection = createConnectionAdapter();
    const { controller } = createController(
      handle,
      handle,
      createTestCoordinator(),
      () => "recovery-test",
      connection.adapter,
    );

    await expect(controller.create(PASSPHRASE)).resolves.toMatchObject({
      status: "unlocked",
      ok: true,
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(connection.current()).toMatchObject({
      handle,
      expectedFileId: "file-a",
    });
  });

  it("aborts a late connection-record commit after cancellation so it cannot replace the previous C", async () => {
    const oldHandle = new MemoryFileHandle("old.lftl");
    const newHandle = new MemoryFileHandle("new.lftl");
    const oldRecord: LedgerFileConnectionRecordV1 = {
      connectionFormatVersion: 1,
      handle: oldHandle,
      expectedFileId: "old-file",
    };
    const connection = createConnectionAdapter(oldRecord);
    const commit = createDeferred<void>();
    const originalWrite = connection.adapter.write;
    vi.mocked(connection.adapter.write).mockImplementationOnce(
      (record, signal) =>
        new Promise<void>((resolve, reject) => {
          const abort = () => reject(new Error("aborted"));
          signal?.addEventListener("abort", abort, { once: true });
          void commit.promise.then(async () => {
            signal?.removeEventListener("abort", abort);
            if (signal?.aborted) {
              return;
            }
            await originalWrite(record, signal);
            resolve();
          });
        }),
    );
    const lease = createTestLease("stale-connection-write");
    const { controller } = createController(
      newHandle,
      newHandle,
      {
        acquire: vi.fn(async () => ({
          status: "acquired" as const,
          lease,
        })),
      },
      () => "recovery-test",
      connection.adapter,
    );

    const creation = controller.create(PASSPHRASE);
    await vi.waitFor(() => {
      expect(connection.adapter.write).toHaveBeenCalledOnce();
    });
    controller.cancelPendingSelection();
    commit.resolve();

    await expect(creation).resolves.toMatchObject({
      status: "error",
      code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
    });
    expect(connection.current()).toBe(oldRecord);
    expect(lease.release).toHaveBeenCalledOnce();
  });
});

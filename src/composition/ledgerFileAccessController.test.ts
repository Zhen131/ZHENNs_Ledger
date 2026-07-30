import { describe, expect, it, vi } from "vitest";

import {
  LedgerFileHandleAdapter,
  type LedgerFileHandle,
  type LedgerFilePickerProvider,
  type LedgerFileWritable,
} from "../adapters/ledgerFileHandleAdapter";
import {
  LedgerFileConnectionRecordError,
  type
  LedgerFileConnectionAdapter,
  type
  LedgerFileConnectionRecordV1,
} from "../adapters/ledgerFileConnectionAdapter";
import type {
  LedgerFileSessionCoordinator,
  LedgerFileSessionLease,
} from "../coordination/ledgerFileSessionCoordinator";
import { bytesToBase64Url } from "../encryption/cryptoEncoding";
import type { LedgerFileV1 } from "../encryption/ledgerFileContract";
import { LedgerFileRepository } from "../repositories/ledgerFileRepository";
import {
  claimLedgerSessionPersistencePort,
} from "../repositories/ledgerRepository";
import { createInitialLedgerData } from "../state/initialLedgerData";
import { createSimpleTrade } from "../test/fixtures";
import {
  DefaultLedgerFileAccessController,
  LEDGER_FILE_ACCESS_ERROR_CODES,
} from "./ledgerFileAccessController";

const PASSPHRASE = "correct horse battery staple";

function createTestLease(
  sessionId = "controller-test-session",
): LedgerFileSessionLease {
  return {
    sessionId,
    runExclusiveWrite: (operation) => operation(),
    release: vi.fn(async () => undefined),
  };
}

function createTestCoordinator(): LedgerFileSessionCoordinator {
  let nextSession = 0;
  return {
    acquire: vi.fn(async () => {
      nextSession += 1;
      return {
        status: "acquired" as const,
        lease: createTestLease(`controller-test-${nextSession}`),
      };
    }),
  };
}

class MemoryFileHandle implements LedgerFileHandle {
  bytes: Uint8Array;
  writes = 0;
  permissionState: "granted" | "prompt" | "denied" = "granted";
  readonly queryPermission = vi.fn(async () => this.permissionState);
  readonly requestPermission = vi.fn(async () => this.permissionState);

  constructor(
    readonly name: string,
    initial = "",
  ) {
    this.bytes = new TextEncoder().encode(initial);
  }

  async getFile() {
    const snapshot = this.bytes.slice();
    return {
      size: snapshot.byteLength,
      arrayBuffer: async () => snapshot.buffer,
    };
  }

  async createWritable(): Promise<LedgerFileWritable> {
    let pending = this.bytes;
    return {
      write: async (data) => {
        this.writes += 1;
        pending = new TextEncoder().encode(data);
      },
      close: async () => {
        this.bytes = pending;
      },
      abort: async () => undefined,
    };
  }

  async isSameEntry(other: LedgerFileHandle): Promise<boolean> {
    return other === this;
  }
}

function createController(
  saveHandle: LedgerFileHandle,
  openHandle: LedgerFileHandle = saveHandle,
  coordinator: LedgerFileSessionCoordinator =
    createTestCoordinator(),
  createRecoveryId: () => string = () => "recovery-test",
  connectionAdapter?: LedgerFileConnectionAdapter,
) {
  const provider: LedgerFilePickerProvider = {
    showSaveFilePicker: vi.fn(async () => saveHandle),
    showOpenFilePicker: vi.fn(async () => [openHandle]),
  };
  return {
    provider,
    controller: new DefaultLedgerFileAccessController(
      new LedgerFileHandleAdapter(provider),
      {
        generateId: vi
          .fn()
          .mockReturnValueOnce("file-a")
          .mockReturnValueOnce("revision-a")
          .mockReturnValueOnce("revision-recovered"),
        now: () => new Date("2026-07-28T10:00:00.000Z"),
      },
      coordinator,
      createRecoveryId,
      connectionAdapter,
    ),
  };
}

function createConnectionAdapter(
  initial: LedgerFileConnectionRecordV1 | null = null,
) {
  let current = initial;
  const adapter: LedgerFileConnectionAdapter = {
    read: vi.fn(async () => current),
    write: vi.fn(async (record) => {
      current = record;
    }),
    clear: vi.fn(async () => {
      current = null;
    }),
  };
  return {
    adapter,
    current: () => current,
  };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function createExistingLedgerHandle(
  marker: string,
): Promise<MemoryFileHandle> {
  const handle = new MemoryFileHandle(`${marker}.lftl`);
  const ledger = {
    ...createInitialLedgerData(),
    trades: [
      createSimpleTrade(
        `trade-${marker}`,
        "buy",
        "BTC",
        "1",
      ),
    ],
  };
  await LedgerFileRepository.create(
    new LedgerFileHandleAdapter(),
    handle,
    PASSPHRASE,
    ledger,
    {
      generateId: vi
        .fn()
        .mockReturnValueOnce(`file-${marker}`)
        .mockReturnValueOnce(`revision-${marker}`),
      now: () => new Date("2026-07-28T10:00:00.000Z"),
      sessionLease: createTestLease("fixture-create"),
    },
  );
  handle.writes = 0;
  return handle;
}

async function createRecoverableLedgerHandle(): Promise<{
  handle: MemoryFileHandle;
  previousLedger: ReturnType<typeof createInitialLedgerData>;
}> {
  const handle = new MemoryFileHandle("recoverable.lftl");
  const previousLedger = {
    ...createInitialLedgerData(),
    trades: [
      createSimpleTrade(
        "trade-recovery-301",
        "buy",
        "BTC",
        "1",
      ),
    ],
  };
  const currentLedger = {
    ...previousLedger,
    trades: [
      ...previousLedger.trades,
      createSimpleTrade(
        "trade-damaged-302",
        "buy",
        "ADA",
        "2",
      ),
    ],
  };
  const repository = await LedgerFileRepository.create(
    new LedgerFileHandleAdapter(),
    handle,
    PASSPHRASE,
    previousLedger,
    {
      generateId: vi
        .fn<() => string>()
        .mockReturnValueOnce("file-recoverable")
        .mockReturnValueOnce("revision-301")
        .mockReturnValueOnce("revision-302"),
      now: vi
        .fn<() => Date>()
        .mockReturnValueOnce(
          new Date("2026-07-28T10:00:00.000Z"),
        )
        .mockReturnValueOnce(
          new Date("2026-07-28T10:01:00.000Z"),
        ),
      sessionLease: createTestLease("fixture-recovery"),
    },
  );
  await repository.save(currentLedger);
  const file = JSON.parse(
    new TextDecoder().decode(handle.bytes),
  ) as LedgerFileV1;
  handle.bytes = new TextEncoder().encode(
    JSON.stringify({
      ...file,
      current: {
        ...file.current,
        ciphertextBase64Url: bytesToBase64Url(
          new Uint8Array(32).fill(8),
        ),
      },
    }),
  );
  handle.writes = 0;
  return { handle, previousLedger };
}

function createDeferredSelectionController(
  openResults: Array<Promise<LedgerFileHandle[]>>,
  saveHandle = new MemoryFileHandle("created.lftl"),
) {
  const provider: LedgerFilePickerProvider = {
    showSaveFilePicker: vi.fn(async () => saveHandle),
    showOpenFilePicker: vi.fn(() => {
      const next = openResults.shift();
      if (!next) throw new Error("test picker sequence exhausted");
      return next;
    }),
  };
  return {
    controller: new DefaultLedgerFileAccessController(
      new LedgerFileHandleAdapter(provider),
      {
        generateId: vi
          .fn()
          .mockReturnValueOnce("file-created")
          .mockReturnValueOnce("revision-created"),
        now: () => new Date("2026-07-28T10:00:00.000Z"),
      },
      createTestCoordinator(),
    ),
    provider,
  };
}

async function expectSelectedTrade(
  controller: DefaultLedgerFileAccessController,
  tradeId: string,
): Promise<void> {
  const result = await controller.unlockSelected(PASSPHRASE);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  await expect(result.session.repository.load()).resolves.toMatchObject({
    trades: [expect.objectContaining({ id: tradeId })],
  });
}

describe("DefaultLedgerFileAccessController", () => {
  it("treats an empty connection store as no remembered C without querying permission", async () => {
    const handle = new MemoryFileHandle("empty-record.lftl");
    const connection = createConnectionAdapter();
    const { controller } = createController(
      handle,
      handle,
      createTestCoordinator(),
      () => "recovery-test",
      connection.adapter,
    );

    await expect(
      controller.inspectRememberedConnection(),
    ).resolves.toEqual({ status: "none", ok: true });
    expect(handle.queryPermission).not.toHaveBeenCalled();
    expect(connection.adapter.write).not.toHaveBeenCalled();
  });

  it("uses query-only granted reconnect and writes the record only after full unlock", async () => {
    const handle = await createExistingLedgerHandle("remembered");
    const record: LedgerFileConnectionRecordV1 = {
      connectionFormatVersion: 1,
      handle,
      expectedFileId: "file-remembered",
    };
    const connection = createConnectionAdapter(record);
    const { controller } = createController(
      handle,
      handle,
      createTestCoordinator(),
      () => "recovery-test",
      connection.adapter,
    );

    await expect(
      controller.inspectRememberedConnection(),
    ).resolves.toEqual({ status: "ready", ok: true });
    expect(handle.queryPermission).toHaveBeenCalledWith({
      mode: "readwrite",
    });
    expect(handle.requestPermission).not.toHaveBeenCalled();
    expect(connection.adapter.write).not.toHaveBeenCalled();

    const unlocked = await controller.unlockSelected(PASSPHRASE);
    expect(unlocked.status).toBe("unlocked");
    expect(connection.adapter.write).toHaveBeenCalledOnce();
    expect(connection.current()).toEqual(record);
  });

  it("does not request prompt permission until the explicit reconnect action and reports denied truthfully", async () => {
    const handle = await createExistingLedgerHandle("prompt");
    handle.permissionState = "prompt";
    const record: LedgerFileConnectionRecordV1 = {
      connectionFormatVersion: 1,
      handle,
      expectedFileId: "file-prompt",
    };
    const connection = createConnectionAdapter(record);
    const { controller } = createController(
      handle,
      handle,
      createTestCoordinator(),
      () => "recovery-test",
      connection.adapter,
    );

    await expect(
      controller.inspectRememberedConnection(),
    ).resolves.toEqual({
      status: "permission-prompt",
      ok: false,
    });
    expect(handle.requestPermission).not.toHaveBeenCalled();

    handle.permissionState = "denied";
    await expect(
      controller.requestRememberedPermission(),
    ).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.PERMISSION_DENIED,
    });
    expect(handle.requestPermission).toHaveBeenCalledOnce();
    expect(connection.adapter.write).not.toHaveBeenCalled();
  });

  it("rejects a same-fileId byte copy before reading or replacing the remembered connection", async () => {
    const original = await createExistingLedgerHandle("original");
    const copy = new MemoryFileHandle(
      "copy.lftl",
      new TextDecoder().decode(original.bytes),
    );
    const record: LedgerFileConnectionRecordV1 = {
      connectionFormatVersion: 1,
      handle: original,
      expectedFileId: "file-original",
    };
    const connection = createConnectionAdapter(record);
    const { controller } = createController(
      original,
      copy,
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
    expect(copy.queryPermission).not.toHaveBeenCalled();
    expect(copy.writes).toBe(0);
    expect(connection.adapter.write).not.toHaveBeenCalled();
    expect(connection.current()).toBe(record);
  });

  it("accepts a manually reselected handle only after physical identity and expected fileId both match", async () => {
    const original = await createExistingLedgerHandle("reselect");
    const replacement = new MemoryFileHandle(
      "reselect.lftl",
      new TextDecoder().decode(original.bytes),
    );
    vi.spyOn(original, "isSameEntry").mockResolvedValue(true);
    const connection = createConnectionAdapter({
      connectionFormatVersion: 1,
      handle: original,
      expectedFileId: "file-reselect",
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
    ).resolves.toEqual({ ok: true });
    expect(original.isSameEntry).toHaveBeenCalledWith(replacement);
    expect(replacement.queryPermission).toHaveBeenCalledWith({
      mode: "readwrite",
    });
    const unlocked = await controller.unlockSelected(PASSPHRASE);
    expect(unlocked.status).toBe("unlocked");
    expect(connection.current()).toMatchObject({
      handle: replacement,
      expectedFileId: "file-reselect",
    });
  });

  it("uses the explicit reselect action to request readwrite permission when the picked handle still prompts", async () => {
    const original = await createExistingLedgerHandle("reselect-prompt");
    const replacement = new MemoryFileHandle(
      "reselect-prompt.lftl",
      new TextDecoder().decode(original.bytes),
    );
    vi.spyOn(original, "isSameEntry").mockResolvedValue(true);
    replacement.queryPermission.mockResolvedValueOnce("prompt");
    replacement.requestPermission.mockResolvedValueOnce("granted");
    const connection = createConnectionAdapter({
      connectionFormatVersion: 1,
      handle: original,
      expectedFileId: "file-reselect-prompt",
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
    ).resolves.toEqual({ ok: true });
    expect(replacement.queryPermission).toHaveBeenCalledOnce();
    expect(replacement.requestPermission).toHaveBeenCalledWith({
      mode: "readwrite",
    });
  });

  it("invalidates a late permission request from a manual reselect before it can publish the picked file", async () => {
    const original = await createExistingLedgerHandle("late-reselect");
    const replacement = new MemoryFileHandle(
      "late-reselect.lftl",
      new TextDecoder().decode(original.bytes),
    );
    const permission =
      createDeferred<"granted" | "prompt" | "denied">();
    vi.spyOn(original, "isSameEntry").mockResolvedValue(true);
    replacement.queryPermission.mockResolvedValueOnce("prompt");
    replacement.requestPermission.mockImplementationOnce(
      () => permission.promise,
    );
    const connection = createConnectionAdapter({
      connectionFormatVersion: 1,
      handle: original,
      expectedFileId: "file-late-reselect",
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

    const reconnect = controller.reselectRememberedConnection();
    await vi.waitFor(() => {
      expect(replacement.requestPermission).toHaveBeenCalledOnce();
    });
    controller.cancelPendingSelection();
    permission.resolve("granted");

    await expect(reconnect).resolves.toEqual({
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
    });
    expect(connection.adapter.write).not.toHaveBeenCalled();
    await expect(
      controller.unlockSelected(PASSPHRASE),
    ).resolves.toMatchObject({
      status: "error",
      code: LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION,
    });
  });

  it("fails closed when physical-entry comparison rejects", async () => {
    const original = await createExistingLedgerHandle("compare-fails");
    const replacement = new MemoryFileHandle(
      "compare-fails.lftl",
      new TextDecoder().decode(original.bytes),
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
        canImportBackup: false,
      },
    });
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
    const controller = new DefaultLedgerFileAccessController(
      new LedgerFileHandleAdapter(provider),
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

  it("selects before asking for a password, keeps wrong-password attempts read-only, and unlocks the same file", async () => {
    const handle = new MemoryFileHandle("ledger.lftl");
    const setup = createController(handle);
    expect((await setup.controller.create(PASSPHRASE)).ok).toBe(true);
    handle.writes = 0;

    const open = createController(
      new MemoryFileHandle("unused.lftl"),
      handle,
    );
    await expect(open.controller.selectExisting()).resolves.toEqual({
      ok: true,
    });
    await expect(
      open.controller.unlockSelected("another valid passphrase"),
    ).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.UNLOCK_FAILED,
    });
    expect(handle.writes).toBe(0);

    const result = await open.controller.unlockSelected(PASSPHRASE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expect(result.session.repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
    expect(handle.writes).toBe(0);
  });

  it("requires a pending explicit selection before unlock", async () => {
    const { controller } = createController(
      new MemoryFileHandle("ledger.lftl"),
    );

    await expect(controller.unlockSelected(PASSPHRASE)).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION,
    });
  });

  it("keeps fast B selected when slow A resolves after B", async () => {
    const handleA = await createExistingLedgerHandle("a");
    const handleB = await createExistingLedgerHandle("b");
    const deferredA = createDeferred<LedgerFileHandle[]>();
    const deferredB = createDeferred<LedgerFileHandle[]>();
    const { controller } = createDeferredSelectionController([
      deferredA.promise,
      deferredB.promise,
    ]);

    const selectA = controller.selectExisting();
    const selectB = controller.selectExisting();
    deferredB.resolve([handleB]);
    await expect(selectB).resolves.toEqual({ ok: true });
    deferredA.resolve([handleA]);
    await selectA;

    await expectSelectedTrade(controller, "trade-b");
  });

  it("does not revive A when A resolves after cancellation", async () => {
    const handleA = await createExistingLedgerHandle("a");
    const deferredA = createDeferred<LedgerFileHandle[]>();
    const { controller } = createDeferredSelectionController([
      deferredA.promise,
    ]);

    const selectA = controller.selectExisting();
    controller.cancelPendingSelection();
    deferredA.resolve([handleA]);
    await selectA;

    await expect(controller.unlockSelected(PASSPHRASE)).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION,
    });
  });

  it("does not revive A after successfully creating new C", async () => {
    const handleA = await createExistingLedgerHandle("a");
    const deferredA = createDeferred<LedgerFileHandle[]>();
    const created = new MemoryFileHandle("created.lftl");
    const { controller } = createDeferredSelectionController(
      [deferredA.promise],
      created,
    );

    const selectA = controller.selectExisting();
    const createResult = await controller.create(PASSPHRASE);
    expect(createResult.ok).toBe(true);
    if (createResult.ok) {
      await expect(
        createResult.session.repository.load(),
      ).resolves.toEqual(createInitialLedgerData());
    }
    deferredA.resolve([handleA]);
    await selectA;

    await expect(controller.unlockSelected(PASSPHRASE)).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    });
  });

  it("does not let a stale A rejection clear a newer B selection", async () => {
    const handleB = await createExistingLedgerHandle("b");
    const deferredA = createDeferred<LedgerFileHandle[]>();
    const deferredB = createDeferred<LedgerFileHandle[]>();
    const { controller } = createDeferredSelectionController([
      deferredA.promise,
      deferredB.promise,
    ]);

    const selectA = controller.selectExisting();
    const selectB = controller.selectExisting();
    deferredB.resolve([handleB]);
    await expect(selectB).resolves.toEqual({ ok: true });
    deferredA.reject(new Error("old picker failed"));
    await selectA;

    await expectSelectedTrade(controller, "trade-b");
  });

  it(
    "keeps recovery opaque until one deduplicated confirmation publishes the verified previous ledger",
    async () => {
      const { handle, previousLedger } =
        await createRecoverableLedgerHandle();
      const lease = createTestLease("controller-recovery");
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
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: true,
      });

      await expect(
        controller.unlockSelected(PASSPHRASE),
      ).resolves.toEqual({
        status: "recovery-required",
        ok: false,
        recoveryId: "recovery-test",
      });
      expect(handle.writes).toBe(0);

      const first = controller.confirmRecovery("recovery-test");
      const second = controller.confirmRecovery("recovery-test");
      expect(second).toBe(first);
      const result = await first;
      expect(result.status).toBe("unlocked");
      if (result.status !== "unlocked") return;
      await expect(result.session.repository.load()).resolves.toEqual(
        previousLedger,
      );
      expect(handle.writes).toBe(1);

      const persistencePort = claimLedgerSessionPersistencePort(
        result.session,
        {},
      );
      const request =
        result.session.beginQuiesce("immediate-lock");
      const token = await persistencePort.completeQuiesce(
        request,
        Promise.resolve(),
      );
      await result.session.lockAfterQuiesce(token);
      await result.session.lockAfterQuiesce(token);
      expect(lease.release).toHaveBeenCalledOnce();
    },
    15_000,
  );

  it(
    "cancels recovery with zero writes, invalidates the id, and releases only the candidate lease",
    async () => {
      const { handle } = await createRecoverableLedgerHandle();
      const lease = createTestLease("controller-cancel-recovery");
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
      await controller.selectExisting();
      const unlock = await controller.unlockSelected(PASSPHRASE);
      expect(unlock.status).toBe("recovery-required");
      if (unlock.status !== "recovery-required") return;

      await controller.cancelRecovery(unlock.recoveryId);

      expect(handle.writes).toBe(0);
      expect(lease.release).toHaveBeenCalledOnce();
      await expect(
        controller.confirmRecovery(unlock.recoveryId),
      ).resolves.toEqual({
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_NOT_FOUND,
      });
    },
    15_000,
  );

  it(
    "does not publish a real recovery whose confirmation resolves after cancellation",
    async () => {
      const { handle } = await createRecoverableLedgerHandle();
      const lease = createTestLease("slow-recovery-cancel");
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
      await controller.selectExisting();
      const unlocked = await controller.unlockSelected(PASSPHRASE);
      expect(unlocked.status).toBe("recovery-required");
      if (unlocked.status !== "recovery-required") return;
      const readStarted = createDeferred<void>();
      const continueRead = createDeferred<void>();
      const originalGetFile = handle.getFile.bind(handle);
      vi.spyOn(handle, "getFile")
        .mockImplementationOnce(async () => {
          readStarted.resolve();
          await continueRead.promise;
          return originalGetFile();
        })
        .mockImplementation(originalGetFile);

      const confirmation = controller.confirmRecovery(
        unlocked.recoveryId,
      );
      await readStarted.promise;
      controller.cancelPendingSelection();
      await vi.waitFor(() => {
        expect(lease.release).toHaveBeenCalledOnce();
      });
      continueRead.resolve();

      await expect(confirmation).resolves.toEqual({
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
      });
      expect(handle.writes).toBe(0);
      expect(lease.release).toHaveBeenCalledOnce();
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: true,
      });
    },
    15_000,
  );

  it.each([
    [
      "in-use",
      LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    ],
    [
      "unsupported",
      LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_UNSUPPORTED,
    ],
    [
      "coordination-failed",
      LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_FAILED,
    ],
  ] as const)(
    "maps coordinator %s before publishing a writable session",
    async (status, code) => {
      const handle = await createExistingLedgerHandle(
        `coordination-${status}`,
      );
      const coordinator: LedgerFileSessionCoordinator = {
        acquire: vi.fn(async () => ({ status })),
      };
      const { controller } = createController(
        handle,
        handle,
        coordinator,
      );
      await controller.selectExisting();

      await expect(
        controller.unlockSelected(PASSPHRASE),
      ).resolves.toEqual({
        status: "error",
        ok: false,
        code,
      });
      expect(handle.writes).toBe(0);
    },
  );

  it("releases a newly acquired lease after a wrong-password failure and keeps the selection retryable", async () => {
    const handle = await createExistingLedgerHandle("lease-failure");
    const wrongPasswordLease = createTestLease("wrong-password");
    vi.mocked(wrongPasswordLease.release)
      .mockRejectedValueOnce(
        new Error("wrong-password release failed"),
      )
      .mockResolvedValueOnce(undefined);
    const leases = [
      wrongPasswordLease,
      createTestLease("correct-password"),
    ];
    const coordinator: LedgerFileSessionCoordinator = {
      acquire: vi.fn(async () => ({
        status: "acquired" as const,
        lease: leases.shift()!,
      })),
    };
    const { controller } = createController(
      handle,
      handle,
      coordinator,
    );
    await controller.selectExisting();

    await expect(
      controller.unlockSelected("another valid passphrase"),
    ).resolves.toMatchObject({
      status: "error",
      code: LEDGER_FILE_ACCESS_ERROR_CODES.UNLOCK_FAILED,
    });
    expect(
      coordinator.acquire,
    ).toHaveBeenCalledOnce();
    expect(wrongPasswordLease.release).toHaveBeenCalledOnce();

    await expect(
      controller.unlockSelected(PASSPHRASE),
    ).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    });
    expect(coordinator.acquire).toHaveBeenCalledOnce();
    controller.cancelPendingSelection();
    await vi.waitFor(() => {
      expect(wrongPasswordLease.release).toHaveBeenCalledTimes(2);
    });
    expect(wrongPasswordLease.release).toHaveBeenCalledTimes(2);

    await expect(controller.selectExisting()).resolves.toEqual({
      ok: true,
    });
    const result = await controller.unlockSelected(PASSPHRASE);
    expect(result.status).toBe("unlocked");
    expect(coordinator.acquire).toHaveBeenCalledTimes(2);
  });

  it("refuses to replace an active session with a different file", async () => {
    const firstHandle = new MemoryFileHandle("first.lftl");
    const differentHandle = await createExistingLedgerHandle("different");
    const firstLease = createTestLease("active-first");
    const coordinator: LedgerFileSessionCoordinator = {
      acquire: vi.fn(async () => ({
        status: "acquired" as const,
        lease: firstLease,
      })),
    };
    const provider: LedgerFilePickerProvider = {
      showSaveFilePicker: vi
        .fn()
        .mockResolvedValueOnce(firstHandle)
        .mockResolvedValueOnce(differentHandle),
      showOpenFilePicker: vi.fn(async () => [differentHandle]),
    };
    const controller = new DefaultLedgerFileAccessController(
      new LedgerFileHandleAdapter(provider),
      {
        generateId: vi
          .fn<() => string>()
          .mockReturnValueOnce("file-first")
          .mockReturnValueOnce("revision-first"),
        now: () => new Date("2026-07-28T10:00:00.000Z"),
      },
      coordinator,
    );

    await expect(controller.create(PASSPHRASE)).resolves.toMatchObject({
      status: "unlocked",
    });
    await expect(controller.create(PASSPHRASE)).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    });
    await expect(controller.selectExisting()).resolves.toEqual({
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    });
    await expect(controller.unlockSelected(PASSPHRASE)).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    });

    expect(provider.showSaveFilePicker).toHaveBeenCalledOnce();
    expect(provider.showOpenFilePicker).not.toHaveBeenCalled();
    expect(coordinator.acquire).toHaveBeenCalledOnce();
    expect(firstLease.release).not.toHaveBeenCalled();
  });

  it("retains an active lease after release failure, deduplicates concurrent release, and permits an explicit retry", async () => {
    const handle = new MemoryFileHandle("release-retry.lftl");
    const firstRelease = createDeferred<void>();
    const release = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstRelease.promise)
      .mockResolvedValueOnce(undefined);
    const lease: LedgerFileSessionLease = {
      sessionId: "release-retry",
      runExclusiveWrite: (operation) => operation(),
      release,
    };
    const coordinator: LedgerFileSessionCoordinator = {
      acquire: vi.fn(async () => ({
        status: "acquired" as const,
        lease,
      })),
    };
    const { controller, provider } = createController(
      handle,
      handle,
      coordinator,
    );
    const created = await controller.create(PASSPHRASE);
    expect(created.status).toBe("unlocked");
    if (created.status !== "unlocked") return;
    const persistencePort = claimLedgerSessionPersistencePort(
      created.session,
      {},
    );
    const request = created.session.beginQuiesce("immediate-lock");
    const token = await persistencePort.completeQuiesce(
      request,
      Promise.resolve(),
    );
    const releaseOne = created.session.lockAfterQuiesce(token);
    const releaseTwo = created.session.lockAfterQuiesce(token);
    expect(releaseTwo).toBe(releaseOne);
    expect(release).toHaveBeenCalledOnce();
    await expect(controller.create(PASSPHRASE)).resolves.toMatchObject({
      status: "error",
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    });
    await expect(controller.selectExisting()).resolves.toEqual({
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    });
    expect(provider.showSaveFilePicker).toHaveBeenCalledOnce();
    expect(provider.showOpenFilePicker).not.toHaveBeenCalled();

    const rejectedRelease = expect(releaseOne).rejects.toThrow(
      "release failed",
    );
    firstRelease.reject(new Error("release failed"));
    await rejectedRelease;
    await expect(controller.create(PASSPHRASE)).resolves.toMatchObject({
      status: "error",
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    });

    await expect(
      created.session.lockAfterQuiesce(token),
    ).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledTimes(2);
    await expect(controller.selectExisting()).resolves.toEqual({
      ok: true,
    });
  });

  it("retries unpublished migration release with the original lifecycle owner and token", async () => {
    const handle = new MemoryFileHandle(
      "migration-release-retry.lftl",
    );
    const release = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(
        new Error("migration release failed"),
      )
      .mockResolvedValueOnce(undefined);
    const lease: LedgerFileSessionLease = {
      sessionId: "migration-release-retry",
      runExclusiveWrite: (operation) => operation(),
      release,
    };
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
    const created = await controller.createFromLegacy(
      PASSPHRASE,
      createInitialLedgerData(),
    );
    expect(created.status).toBe("unlocked");
    if (created.status !== "unlocked") return;

    await expect(
      controller.releaseUnpublishedMigrationSession(
        created.session,
      ),
    ).rejects.toThrow("migration release failed");
    await expect(controller.selectExisting()).resolves.toEqual({
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    });

    await expect(
      controller.releaseUnpublishedMigrationSession(
        created.session,
      ),
    ).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledTimes(2);
    await expect(controller.selectExisting()).resolves.toEqual({
      ok: true,
    });
  });

  it(
    "retains a recovery candidate after cancellation release failure and retries one concurrent cancellation",
    async () => {
      const { handle } = await createRecoverableLedgerHandle();
      const firstRelease = createDeferred<void>();
      const release = vi
        .fn<() => Promise<void>>()
        .mockImplementationOnce(() => firstRelease.promise)
        .mockResolvedValueOnce(undefined);
      const lease: LedgerFileSessionLease = {
        sessionId: "recovery-release-retry",
        runExclusiveWrite: (operation) => operation(),
        release,
      };
      const coordinator: LedgerFileSessionCoordinator = {
        acquire: vi.fn(async () => ({
          status: "acquired" as const,
          lease,
        })),
      };
      const { controller, provider } = createController(
        handle,
        handle,
        coordinator,
      );
      await controller.selectExisting();
      const unlock = await controller.unlockSelected(PASSPHRASE);
      expect(unlock.status).toBe("recovery-required");
      if (unlock.status !== "recovery-required") return;

      const cancelOne = controller.cancelRecovery(unlock.recoveryId);
      const cancelTwo = controller.cancelRecovery(unlock.recoveryId);
      expect(cancelTwo).toBe(cancelOne);
      expect(release).toHaveBeenCalledOnce();
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      });
      expect(provider.showOpenFilePicker).toHaveBeenCalledOnce();

      const rejectedCancel = expect(cancelOne).rejects.toThrow(
        "candidate release failed",
      );
      firstRelease.reject(new Error("candidate release failed"));
      await rejectedCancel;
      await expect(
        controller.confirmRecovery(unlock.recoveryId),
      ).resolves.toEqual({
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_NOT_FOUND,
      });

      await expect(
        controller.cancelRecovery(unlock.recoveryId),
      ).resolves.toBeUndefined();
      expect(release).toHaveBeenCalledTimes(2);
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: true,
      });
    },
    15_000,
  );

  it(
    "releases exactly once when a create becomes stale after acquiring its lease",
    async () => {
      const handle = new MemoryFileHandle("stale-create.lftl");
      const readStarted = createDeferred<void>();
      const continueRead = createDeferred<void>();
      const originalGetFile = handle.getFile.bind(handle);
      vi.spyOn(handle, "getFile").mockImplementation(async () => {
        readStarted.resolve();
        await continueRead.promise;
        return originalGetFile();
      });
      const lease = createTestLease("stale-create");
      vi.mocked(lease.release)
        .mockRejectedValueOnce(new Error("stale create release failed"))
        .mockResolvedValueOnce(undefined);
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

      const creation = controller.create(PASSPHRASE);
      await readStarted.promise;
      controller.cancelPendingSelection();
      continueRead.resolve();

      await expect(creation).resolves.toEqual({
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
      });
      expect(lease.release).toHaveBeenCalledOnce();
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      });
      controller.cancelPendingSelection();
      await vi.waitFor(() => {
        expect(lease.release).toHaveBeenCalledTimes(2);
      });
      expect(lease.release).toHaveBeenCalledTimes(2);
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: true,
      });
    },
    15_000,
  );

  it(
    "releases exactly once when an open becomes stale after acquiring its lease",
    async () => {
      const handle = await createExistingLedgerHandle("stale-open");
      const lease = createTestLease("stale-open");
      vi.mocked(lease.release)
        .mockRejectedValueOnce(new Error("stale open release failed"))
        .mockResolvedValueOnce(undefined);
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
      await controller.selectExisting();
      const readStarted = createDeferred<void>();
      const continueRead = createDeferred<void>();
      const originalGetFile = handle.getFile.bind(handle);
      vi.spyOn(handle, "getFile").mockImplementation(async () => {
        readStarted.resolve();
        await continueRead.promise;
        return originalGetFile();
      });

      const unlocking = controller.unlockSelected(PASSPHRASE);
      await readStarted.promise;
      controller.cancelPendingSelection();
      continueRead.resolve();

      await expect(unlocking).resolves.toEqual({
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
      });
      expect(lease.release).toHaveBeenCalledOnce();
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      });
      controller.cancelPendingSelection();
      await vi.waitFor(() => {
        expect(lease.release).toHaveBeenCalledTimes(2);
      });
      expect(lease.release).toHaveBeenCalledTimes(2);
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: true,
      });
    },
    15_000,
  );

  it(
    "retains the lease when a stale recovery candidate cannot release on its first cancellation",
    async () => {
      const { handle } = await createRecoverableLedgerHandle();
      const lease = createTestLease("stale-recovery-open");
      vi.mocked(lease.release)
        .mockRejectedValueOnce(
          new Error("stale recovery release failed"),
        )
        .mockResolvedValueOnce(undefined);
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
      await controller.selectExisting();
      const readStarted = createDeferred<void>();
      const continueRead = createDeferred<void>();
      const originalGetFile = handle.getFile.bind(handle);
      vi.spyOn(handle, "getFile")
        .mockImplementationOnce(async () => {
          readStarted.resolve();
          await continueRead.promise;
          return originalGetFile();
        })
        .mockImplementation(originalGetFile);

      const unlocking = controller.unlockSelected(PASSPHRASE);
      await readStarted.promise;
      controller.cancelPendingSelection();
      continueRead.resolve();

      await expect(unlocking).resolves.toEqual({
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
      });
      expect(handle.writes).toBe(0);
      expect(lease.release).toHaveBeenCalledOnce();
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      });

      controller.cancelPendingSelection();
      await vi.waitFor(() => {
        expect(lease.release).toHaveBeenCalledTimes(2);
      });
      expect(lease.release).toHaveBeenCalledTimes(2);
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: true,
      });
    },
    15_000,
  );

  it(
    "retains every failed cleanup lease from concurrent stale operations and retries all before reopening access",
    async () => {
      const firstHandle = new MemoryFileHandle("stale-one.lftl");
      const secondHandle = new MemoryFileHandle("stale-two.lftl");
      const firstReadStarted = createDeferred<void>();
      const secondReadStarted = createDeferred<void>();
      const continueFirstRead = createDeferred<void>();
      const continueSecondRead = createDeferred<void>();
      const originalFirstGetFile = firstHandle.getFile.bind(firstHandle);
      const originalSecondGetFile =
        secondHandle.getFile.bind(secondHandle);
      vi.spyOn(firstHandle, "getFile")
        .mockImplementationOnce(async () => {
          firstReadStarted.resolve();
          await continueFirstRead.promise;
          return originalFirstGetFile();
        })
        .mockImplementation(originalFirstGetFile);
      vi.spyOn(secondHandle, "getFile")
        .mockImplementationOnce(async () => {
          secondReadStarted.resolve();
          await continueSecondRead.promise;
          return originalSecondGetFile();
        })
        .mockImplementation(originalSecondGetFile);
      const firstLease = createTestLease("stale-one");
      const secondLease = createTestLease("stale-two");
      vi.mocked(firstLease.release)
        .mockRejectedValueOnce(new Error("first cleanup failed"))
        .mockRejectedValueOnce(new Error("first retry failed"))
        .mockResolvedValueOnce(undefined);
      vi.mocked(secondLease.release)
        .mockRejectedValueOnce(new Error("second cleanup failed"))
        .mockResolvedValueOnce(undefined);
      const leases = [firstLease, secondLease];
      const coordinator: LedgerFileSessionCoordinator = {
        acquire: vi.fn(async () => ({
          status: "acquired" as const,
          lease: leases.shift()!,
        })),
      };
      const provider: LedgerFilePickerProvider = {
        showSaveFilePicker: vi
          .fn()
          .mockResolvedValueOnce(firstHandle)
          .mockResolvedValueOnce(secondHandle),
        showOpenFilePicker: vi.fn(async () => [firstHandle]),
      };
      const controller = new DefaultLedgerFileAccessController(
        new LedgerFileHandleAdapter(provider),
        {
          generateId: vi
            .fn<() => string>()
            .mockReturnValueOnce("file-stale-one")
            .mockReturnValueOnce("revision-stale-one")
            .mockReturnValueOnce("file-stale-two")
            .mockReturnValueOnce("revision-stale-two"),
          now: () => new Date("2026-07-28T10:00:00.000Z"),
        },
        coordinator,
      );

      const firstCreate = controller.create(PASSPHRASE);
      await firstReadStarted.promise;
      const secondCreate = controller.create(PASSPHRASE);
      await secondReadStarted.promise;
      controller.cancelPendingSelection();
      continueFirstRead.resolve();
      continueSecondRead.resolve();

      await expect(firstCreate).resolves.toMatchObject({
        status: "error",
        code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
      });
      await expect(secondCreate).resolves.toMatchObject({
        status: "error",
        code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
      });
      expect(firstLease.release).toHaveBeenCalledOnce();
      expect(secondLease.release).toHaveBeenCalledOnce();
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      });

      controller.cancelPendingSelection();
      await vi.waitFor(() => {
        expect(firstLease.release).toHaveBeenCalledTimes(2);
        expect(secondLease.release).toHaveBeenCalledTimes(2);
      });
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      });

      controller.cancelPendingSelection();
      await vi.waitFor(() => {
        expect(firstLease.release).toHaveBeenCalledTimes(3);
        expect(secondLease.release).toHaveBeenCalledTimes(2);
      });
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: true,
      });
    },
    15_000,
  );
});

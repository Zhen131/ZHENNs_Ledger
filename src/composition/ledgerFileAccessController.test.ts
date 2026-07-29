import { describe, expect, it, vi } from "vitest";

import {
  LedgerFileHandleAdapter,
  type LedgerFileHandle,
  type LedgerFilePickerProvider,
  type LedgerFileWritable,
} from "../adapters/ledgerFileHandleAdapter";
import { LedgerFileRepository } from "../repositories/ledgerFileRepository";
import { createInitialLedgerData } from "../state/initialLedgerData";
import { createSimpleTrade } from "../test/fixtures";
import {
  DefaultLedgerFileAccessController,
  LEDGER_FILE_ACCESS_ERROR_CODES,
} from "./ledgerFileAccessController";

const PASSPHRASE = "correct horse battery staple";

class MemoryFileHandle implements LedgerFileHandle {
  bytes: Uint8Array;
  writes = 0;

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
}

function createController(
  saveHandle: LedgerFileHandle,
  openHandle: LedgerFileHandle = saveHandle,
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
          .mockReturnValueOnce("revision-a"),
        now: () => new Date("2026-07-28T10:00:00.000Z"),
      },
    ),
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
    },
  );
  handle.writes = 0;
  return handle;
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
        canClear: false,
        canImportBackup: false,
      },
    });
    await expect(result.session.repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
  });

  it("does not overwrite a non-empty save-picker target", async () => {
    const handle = new MemoryFileHandle("ledger.lftl", "existing bytes");
    const { controller } = createController(handle);

    await expect(controller.create(PASSPHRASE)).resolves.toEqual({
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.NON_EMPTY_CREATE_TARGET,
    });
    expect(handle.writes).toBe(0);
    expect(new TextDecoder().decode(handle.bytes)).toBe("existing bytes");
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
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION,
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
});

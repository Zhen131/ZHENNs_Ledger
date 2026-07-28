import { describe, expect, it, vi } from "vitest";

import {
  LedgerFileHandleAdapter,
  type LedgerFileHandle,
  type LedgerFilePickerProvider,
  type LedgerFileWritable,
} from "../adapters/ledgerFileHandleAdapter";
import { createInitialLedgerData } from "../state/initialLedgerData";
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
});

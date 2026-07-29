import { describe, expect, it, vi } from "vitest";

import { MAX_LEDGER_FILE_V1_BYTES } from "../encryption/ledgerFileContract";
import {
  LedgerFileAdapterError,
  LedgerFileHandleAdapter,
  type LedgerFileHandle,
  type LedgerFilePickerProvider,
  type LedgerFileWritable,
} from "./ledgerFileHandleAdapter";

class AtomicFakeHandle implements LedgerFileHandle {
  bytes: Uint8Array;
  declaredSize?: number;
  arrayBufferError?: Error;
  writeError?: Error;
  closeError?: Error;
  readonly events: string[] = [];
  readonly getFile = vi.fn(async () => {
    this.events.push("getFile");
    const snapshot = this.bytes.slice();
    return {
      size: this.declaredSize ?? snapshot.byteLength,
      arrayBuffer: async () => {
        this.events.push("arrayBuffer");
        if (this.arrayBufferError) throw this.arrayBufferError;
        return snapshot.buffer;
      },
    };
  });
  readonly createWritable = vi.fn(async () => {
    this.events.push("createWritable");
    let pending: Uint8Array | null = null;
    const writable: LedgerFileWritable = {
      write: async (data) => {
        this.events.push("write");
        if (this.writeError) throw this.writeError;
        pending = new TextEncoder().encode(data);
      },
      close: async () => {
        this.events.push("close");
        if (this.closeError) throw this.closeError;
        if (pending) this.bytes = pending;
      },
      abort: vi.fn(async () => {
        this.events.push("abort");
        pending = null;
      }),
    };
    return writable;
  });

  constructor(
    readonly name: string,
    initial = "",
  ) {
    this.bytes = new TextEncoder().encode(initial);
  }
}

function createPickerProvider(
  saveHandle: LedgerFileHandle,
  openHandle: LedgerFileHandle,
): LedgerFilePickerProvider {
  return {
    showSaveFilePicker: vi.fn(async () => saveHandle),
    showOpenFilePicker: vi.fn(async () => [openHandle]),
  };
}

describe("LedgerFileHandleAdapter", () => {
  it("returns exactly the selected handle and uses the lowercase .lftl suggestion", async () => {
    const save = new AtomicFakeHandle("created.lftl");
    const open = new AtomicFakeHandle("EXISTING.LFTL", "{}");
    const provider = createPickerProvider(save, open);
    const adapter = new LedgerFileHandleAdapter(provider);

    await expect(adapter.pickNewLedgerFile()).resolves.toEqual({
      status: "selected",
      handle: save,
    });
    await expect(adapter.pickExistingLedgerFile()).resolves.toEqual({
      status: "selected",
      handle: open,
    });
    expect(provider.showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: "local-first-trading-ledger.lftl",
      }),
    );
  });

  it("treats picker cancellation as a no-side-effect result", async () => {
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
    const adapter = new LedgerFileHandleAdapter(provider);

    await expect(adapter.pickNewLedgerFile()).resolves.toEqual({
      status: "cancelled",
    });
    await expect(adapter.pickExistingLedgerFile()).resolves.toEqual({
      status: "cancelled",
    });
  });

  it.each(["ledger.json", "ledger.lftl.json", "ledger", "ledger.LFTLX"])(
    "rejects unsupported filename %s",
    async (name) => {
      const handle = new AtomicFakeHandle(name);
      const adapter = new LedgerFileHandleAdapter(
        createPickerProvider(handle, handle),
      );

      await expect(adapter.pickNewLedgerFile()).rejects.toMatchObject({
        stage: "extension",
      });
    },
  );

  it("allows only an empty create target and never opens a writable for a non-empty target", async () => {
    const adapter = new LedgerFileHandleAdapter();
    const empty = new AtomicFakeHandle("empty.lftl");
    const occupied = new AtomicFakeHandle("occupied.lftl", "old bytes");

    await expect(adapter.assertEmptyCreateTarget(empty)).resolves.toBeUndefined();
    await expect(
      adapter.assertEmptyCreateTarget(occupied),
    ).rejects.toMatchObject({ stage: "target" });
    expect(occupied.createWritable).not.toHaveBeenCalled();
  });

  it("rejects the declared 32 MiB overflow before arrayBuffer", async () => {
    const adapter = new LedgerFileHandleAdapter();
    const handle = new AtomicFakeHandle("large.lftl");
    handle.declaredSize = MAX_LEDGER_FILE_V1_BYTES + 1;

    await expect(adapter.read(handle)).rejects.toMatchObject({
      stage: "size",
    });
    expect(handle.events).toEqual(["getFile"]);
  });

  it(
    "accepts exactly 32 MiB for later parsing and rejects an actual byteLength one byte larger",
    async () => {
      const adapter = new LedgerFileHandleAdapter();
      const exact = new AtomicFakeHandle("exact.lftl");
      exact.bytes = new Uint8Array(MAX_LEDGER_FILE_V1_BYTES);
      await expect(adapter.read(exact)).resolves.toMatchObject({
        byteLength: MAX_LEDGER_FILE_V1_BYTES,
      });

      const overflow = new AtomicFakeHandle("overflow.lftl");
      overflow.declaredSize = MAX_LEDGER_FILE_V1_BYTES;
      overflow.bytes = new Uint8Array(MAX_LEDGER_FILE_V1_BYTES + 1);
      await expect(adapter.read(overflow)).rejects.toMatchObject({
        stage: "size",
      });
    },
    10_000,
  );

  it("rejects invalid UTF-8 rather than replacing bytes", async () => {
    const adapter = new LedgerFileHandleAdapter();
    const handle = new AtomicFakeHandle("invalid.lftl");
    handle.bytes = new Uint8Array([0xc3, 0x28]);

    await expect(adapter.read(handle)).rejects.toMatchObject({
      stage: "utf8",
    });
  });

  it("closes before reading back from the same bound handle", async () => {
    const adapter = new LedgerFileHandleAdapter();
    const handle = new AtomicFakeHandle("ledger.lftl", "old");

    await expect(
      adapter.writeAndReadBack(handle, "new"),
    ).resolves.toMatchObject({ text: "new", byteLength: 3 });
    expect(handle.events).toEqual([
      "createWritable",
      "write",
      "close",
      "getFile",
      "arrayBuffer",
    ]);
  });

  it.each([
    ["write", "writeError"],
    ["close", "closeError"],
  ] as const)(
    "keeps fake atomic old bytes when %s fails and reports the stage",
    async (stage, property) => {
      const adapter = new LedgerFileHandleAdapter();
      const handle = new AtomicFakeHandle("ledger.lftl", "old");
      handle[property] = new Error(`${stage} failed`);

      await expect(
        adapter.writeAndReadBack(handle, "new"),
      ).rejects.toEqual(
        expect.objectContaining<Partial<LedgerFileAdapterError>>({
          stage,
        }),
      );
      expect(new TextDecoder().decode(handle.bytes)).toBe("old");
      expect(handle.events).toContain("abort");
      expect(handle.events).not.toContain("getFile");
    },
  );

  it("distinguishes post-close readback failure from write success", async () => {
    const adapter = new LedgerFileHandleAdapter();
    const handle = new AtomicFakeHandle("ledger.lftl", "old");
    handle.arrayBufferError = new Error("readback failed");

    await expect(
      adapter.writeAndReadBack(handle, "new"),
    ).rejects.toMatchObject({ stage: "readback" });
    expect(new TextDecoder().decode(handle.bytes)).toBe("new");
    expect(handle.events.indexOf("close")).toBeLessThan(
      handle.events.indexOf("getFile"),
    );
  });
});

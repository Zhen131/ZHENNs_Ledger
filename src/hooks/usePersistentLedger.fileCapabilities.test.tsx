// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LedgerFileHandleAdapter,
  type LedgerFileHandle,
  type LedgerFileWritable,
} from "../adapters/ledgerFileHandleAdapter";
import { bytesToBase64Url } from "../encryption/cryptoEncoding";
import type { LedgerFileV1 } from "../encryption/ledgerFileContract";
import type { LedgerRepository } from "../repositories/ledgerRepository";
import { LedgerFileRepository } from "../repositories/ledgerFileRepository";
import { createInitialLedgerData } from "../state/initialLedgerData";
import { createSimpleTrade } from "../test/fixtures";
import type { LedgerClock } from "../utils/ledgerDate";
import { usePersistentLedger } from "./usePersistentLedger";

const PASSPHRASE = "correct horse battery staple";

const fixedClock: LedgerClock = {
  now: () => new Date("2026-07-28T12:00:00.000Z"),
};

afterEach(cleanup);

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

class ControlledLedgerHandle implements LedgerFileHandle {
  bytes = new Uint8Array();
  writeCount = 0;
  mutateAfterClose: ((serialized: string) => string) | null = null;
  private closeStarted: Deferred<void> | null = null;
  private closeRelease: Deferred<void> | null = null;

  constructor(readonly name = "hook-ledger.lftl") {}

  async getFile() {
    const snapshot = this.bytes.slice();
    return {
      size: snapshot.byteLength,
      arrayBuffer: async () => snapshot.buffer,
    };
  }

  async createWritable(): Promise<LedgerFileWritable> {
    let pending: Uint8Array | null = null;
    return {
      write: async (serialized) => {
        this.writeCount += 1;
        pending = new TextEncoder().encode(serialized);
      },
      close: async () => {
        const closeStarted = this.closeStarted;
        const closeRelease = this.closeRelease;
        this.closeStarted = null;
        this.closeRelease = null;
        closeStarted?.resolve();
        if (closeRelease) {
          await closeRelease.promise;
        }
        if (!pending) return;
        const serialized = new TextDecoder().decode(pending);
        const published = this.mutateAfterClose
          ? this.mutateAfterClose(serialized)
          : serialized;
        this.mutateAfterClose = null;
        this.bytes = new TextEncoder().encode(published);
      },
      abort: async () => {
        pending = null;
      },
    };
  }

  pauseNextClose(): {
    started: Promise<void>;
    release: () => void;
  } {
    const closeStarted = createDeferred<void>();
    const closeRelease = createDeferred<void>();
    this.closeStarted = closeStarted;
    this.closeRelease = closeRelease;
    return {
      started: closeStarted.promise,
      release: () => closeRelease.resolve(),
    };
  }
}

function replaceLedgerFileSalt(serialized: string): string {
  const file = JSON.parse(serialized) as LedgerFileV1;
  return JSON.stringify({
    ...file,
    crypto: {
      ...file.crypto,
      kdf: {
        ...file.crypto.kdf,
        saltBase64Url: bytesToBase64Url(new Uint8Array(16).fill(7)),
      },
    },
  });
}

describe("usePersistentLedger file session capabilities", () => {
  it("rejects clear and B import before invoking a file repository", async () => {
    const repository: LedgerRepository = {
      load: vi.fn(async () => createInitialLedgerData()),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    };
    const { result } = renderHook(() =>
      usePersistentLedger(repository, fixedClock, {
        canClear: false,
        canImportBackup: false,
      }),
    );

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });

    await act(async () => {
      await expect(result.current.clearLedger()).resolves.toEqual({
        ok: false,
        code: "LEDGER_REPOSITORY_CLEAR_FAILED",
      });
      await expect(
        result.current.replaceLedgerFromBackup(createInitialLedgerData()),
      ).resolves.toEqual({
        ok: false,
        code: "LEDGER_IMPORT_NOT_ALLOWED",
      });
    });

    expect(repository.clear).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("keeps a real ledger-file salt-drift save dirty and never publishes saved", async () => {
    const handle = new ControlledLedgerHandle();
    const generateId = vi
      .fn<() => string>()
      .mockReturnValueOnce("file-hook")
      .mockReturnValueOnce("revision-initial")
      .mockReturnValueOnce("revision-mutated");
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-07-28T10:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-07-28T10:01:00.000Z"));
    const repository = await LedgerFileRepository.create(
      new LedgerFileHandleAdapter(),
      handle,
      PASSPHRASE,
      createInitialLedgerData(),
      { generateId, now },
    );
    const close = handle.pauseNextClose();
    handle.mutateAfterClose = replaceLedgerFileSalt;
    const { result } = renderHook(() =>
      usePersistentLedger(repository, fixedClock, {
        canClear: false,
        canImportBackup: false,
      }),
    );

    await waitFor(() => {
      expect(result.current.hydrationStatus).toBe("ready");
    });
    act(() => {
      expect(
        result.current.applyLedgerAction({
          type: "trade/add",
          trade: createSimpleTrade(
            "hook-salt-drift",
            "buy",
            "BTC",
            "1",
          ),
        }),
      ).toBe("applied");
    });
    await act(async () => {
      await close.started;
    });

    expect(result.current.persistenceStatus).toBe("saving");
    expect(result.current.mutationVersion).toBe(1);
    expect(result.current.persistedVersion).toBe(0);
    expect(result.current.isDirty).toBe(true);

    act(() => {
      close.release();
    });
    await waitFor(() => {
      expect(result.current.persistenceStatus).toBe("error");
    });

    expect(result.current.persistenceError).toMatch(/尚未保存/);
    expect(result.current.mutationVersion).toBe(1);
    expect(result.current.persistedVersion).toBe(0);
    expect(result.current.isDirty).toBe(true);
    expect(
      result.current.ledgerData.trades.map((trade) => trade.id),
    ).toEqual(["hook-salt-drift"]);
    expect(handle.writeCount).toBe(2);
  });
});

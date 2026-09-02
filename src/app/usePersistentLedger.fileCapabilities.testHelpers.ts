import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import {
  type LedgerFileHandle,
  type LedgerFileWritable,
} from "@/platform/files";
import type { LedgerFileSessionLease } from "@/platform/coordination";
import { bytesToBase64Url } from "@/platform/encryption";
import {
  ledgerFileBytesToTestString,
  ledgerFileTestStringToBytes,
  readLedgerFileForTest,
  serializeLedgerFileForTest,
  applyLedgerFileWritableDataForTest,
} from "@/test-support";
import type { LedgerClock } from "@/core/shared";

export const PASSPHRASE = "correct horse battery staple";
export const HOOK_TEST_LEASE: LedgerFileSessionLease = {
  sessionId: "hook-file-capabilities",
  runExclusiveWrite: (operation) => operation(),
  release: async () => undefined,
};

export const fixedClock: LedgerClock = {
  now: () => new Date("2026-07-28T12:00:00.000Z"),
};

afterEach(cleanup);

export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export class ControlledLedgerHandle implements LedgerFileHandle {
  bytes: Uint8Array = new Uint8Array();
  writeCount = 0;
  mutateAfterClose: ((serialized: string) => string) | null = null;
  private failReadAfterClose = false;
  private failNextRead = false;
  private readFailureObserved: Deferred<void> | null = null;
  private closeStarted: Deferred<void> | null = null;
  private closeRelease: Deferred<void> | null = null;

  constructor(readonly name = "hook-ledger.lftl") {}

  async getFile() {
    if (this.failNextRead) {
      this.failNextRead = false;
      this.readFailureObserved?.resolve();
      this.readFailureObserved = null;
      throw new Error("readback failed");
    }
    const snapshot = this.bytes.slice();
    return {
      size: snapshot.byteLength,
      arrayBuffer: async () => snapshot.buffer,
    };
  }

  async createWritable(options?: {
    keepExistingData?: boolean;
  }): Promise<LedgerFileWritable> {
    let pending: Uint8Array | null = options?.keepExistingData
      ? Uint8Array.from(this.bytes)
      : null;
    let writeObserved = false;
    return {
      write: async (serialized) => {
        if (!writeObserved) {
          this.writeCount += 1;
          writeObserved = true;
        }
        pending = applyLedgerFileWritableDataForTest(
          pending ?? new Uint8Array(),
          serialized,
        );
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
        const serialized = ledgerFileBytesToTestString(pending);
        const published = this.mutateAfterClose
          ? this.mutateAfterClose(serialized)
          : serialized;
        this.mutateAfterClose = null;
        this.bytes = ledgerFileTestStringToBytes(published);
        if (this.failReadAfterClose) {
          this.failReadAfterClose = false;
          this.failNextRead = true;
        }
      },
      abort: async () => {
        pending = null;
      },
    };
  }

  async isSameEntry(other: LedgerFileHandle): Promise<boolean> {
    return other === this;
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

  failNextReadbackAfterClose(): Promise<void> {
    const observed = createDeferred<void>();
    this.failReadAfterClose = true;
    this.readFailureObserved = observed;
    return observed.promise;
  }
}

export class GatedHookSessionLease implements LedgerFileSessionLease {
  readonly sessionId = "hook-latest-save";
  operationCount = 0;
  private writeTail: Promise<void> = Promise.resolve();
  private nextGate:
    | {
        started: Deferred<void>;
        release: Deferred<void>;
      }
    | null = null;

  gateNextOperation(): {
    started: Promise<void>;
    release(): void;
  } {
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    this.nextGate = { started, release };
    return {
      started: started.promise,
      release: () => release.resolve(),
    };
  }

  runExclusiveWrite<T>(operation: () => Promise<T>): Promise<T> {
    this.operationCount += 1;
    const result = this.writeTail.then(async () => {
      const gate = this.nextGate;
      if (gate) {
        this.nextGate = null;
        gate.started.resolve();
        await gate.release.promise;
      }
      return operation();
    });
    this.writeTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async release(): Promise<void> {
    await this.writeTail;
  }
}

export function replaceLedgerFileSalt(serialized: string): string {
  const file = readLedgerFileForTest(serialized);
  return serializeLedgerFileForTest({
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

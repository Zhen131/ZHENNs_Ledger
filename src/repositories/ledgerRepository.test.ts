import { describe, expect, it, vi } from "vitest";

import type { StorageAdapter } from "../adapters/storageAdapter";
import type { StoredLedgerEnvelopeV2 } from "../encryption/cryptoEnvelope";
import type { EncryptionService } from "../encryption/encryptionService";
import {
  createNoopStoredLedgerEnvelope,
  NoopEncryptionService,
} from "../encryption/noopEncryptionService";
import type { LedgerData } from "../models";
import { createInitialLedgerData } from "../state/initialLedgerData";
import { sampleTrades } from "../test/fixtures";
import {
  DefaultLedgerRepository,
  LEDGER_REPOSITORY_ERROR_CODES,
} from "./ledgerRepository";

class MemoryStorageAdapter implements StorageAdapter {
  envelope: unknown | null = null;

  async read() {
    return this.envelope;
  }

  async write(envelope: StoredLedgerEnvelopeV2) {
    this.envelope = structuredClone(envelope);
  }

  async clear() {
    this.envelope = null;
  }
}

function createLedger(): LedgerData {
  return {
    ...createInitialLedgerData(),
    trades: structuredClone(sampleTrades),
  };
}

describe("DefaultLedgerRepository", () => {
  it("returns null for an empty adapter without invoking decryption", async () => {
    const storage = new MemoryStorageAdapter();
    const encryption: EncryptionService = {
      encrypt: vi.fn(async (value) =>
        createNoopStoredLedgerEnvelope(value),
      ),
      decrypt: vi.fn(async () => ""),
    };
    const repository = new DefaultLedgerRepository(storage, encryption);

    await expect(repository.load()).resolves.toBeNull();
    expect(encryption.decrypt).not.toHaveBeenCalled();
  });

  it("round-trips a validated ledger through serialization and Noop encryption", async () => {
    const storage = new MemoryStorageAdapter();
    const repository = new DefaultLedgerRepository(
      storage,
      new NoopEncryptionService(),
    );
    const ledgerData = createLedger();

    await repository.save(ledgerData);

    expect(storage.envelope).toEqual(
      createNoopStoredLedgerEnvelope(JSON.stringify(ledgerData)),
    );
    await expect(repository.load()).resolves.toEqual(ledgerData);
  });

  it("invokes encryption at the single repository boundary", async () => {
    const storage = new MemoryStorageAdapter();
    const noop = new NoopEncryptionService();
    const encryption: EncryptionService = {
      encrypt: vi.fn(async (value) =>
        createNoopStoredLedgerEnvelope(value),
      ),
      decrypt: vi.fn(async (envelope) => noop.decrypt(envelope)),
    };
    const repository = new DefaultLedgerRepository(storage, encryption);
    const ledgerData = createLedger();

    await repository.save(ledgerData);
    await repository.load();

    expect(encryption.encrypt).toHaveBeenCalledOnce();
    expect(encryption.decrypt).toHaveBeenCalledOnce();
    expect(encryption.encrypt).toHaveBeenCalledWith(
      JSON.stringify(ledgerData),
    );
    expect(encryption.decrypt).toHaveBeenCalledWith(storage.envelope);
  });

  it("rejects invalid ledger data before encryption or storage writes", async () => {
    const storage = new MemoryStorageAdapter();
    const encryption: EncryptionService = {
      encrypt: vi.fn(async (value) =>
        createNoopStoredLedgerEnvelope(value),
      ),
      decrypt: vi.fn(async () => ""),
    };
    const repository = new DefaultLedgerRepository(storage, encryption);
    const invalidLedger = {
      ...createInitialLedgerData(),
      schemaVersion: 2,
    } as unknown as LedgerData;

    await expect(repository.save(invalidLedger)).rejects.toMatchObject({
      code: LEDGER_REPOSITORY_ERROR_CODES.INVALID_LEDGER_DATA,
    });
    expect(encryption.encrypt).not.toHaveBeenCalled();
    expect(storage.envelope).toBeNull();
  });

  it.each([
    {
      name: "invalid envelope",
      envelope: {
        formatVersion: 2,
        encryptedPayload: "{}",
      },
    },
    {
      name: "invalid JSON",
      envelope: createNoopStoredLedgerEnvelope("{invalid"),
    },
    {
      name: "invalid LedgerData",
      envelope: createNoopStoredLedgerEnvelope(
        JSON.stringify({
          ...createInitialLedgerData(),
          trades: "not-an-array",
        }),
      ),
    },
  ])("rejects $name as invalid stored data", async ({ envelope }) => {
    const storage = new MemoryStorageAdapter();
    storage.envelope = envelope;
    const repository = new DefaultLedgerRepository(
      storage,
      new NoopEncryptionService(),
    );

    await expect(repository.load()).rejects.toMatchObject({
      code: LEDGER_REPOSITORY_ERROR_CODES.INVALID_STORED_DATA,
    });
  });

  it("maps adapter read, write, and clear failures to repository errors", async () => {
    const failure = new Error("low-level storage details");
    const storage: StorageAdapter = {
      read: vi.fn(async () => {
        throw failure;
      }),
      write: vi.fn(async () => {
        throw failure;
      }),
      clear: vi.fn(async () => {
        throw failure;
      }),
    };
    const repository = new DefaultLedgerRepository(
      storage,
      new NoopEncryptionService(),
    );

    await expect(repository.load()).rejects.toMatchObject({
      code: LEDGER_REPOSITORY_ERROR_CODES.READ_FAILED,
      message: "Could not read saved ledger data",
    });
    await expect(repository.save(createLedger())).rejects.toMatchObject({
      code: LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
      message: "Could not save ledger data",
    });
    await expect(repository.clear()).rejects.toMatchObject({
      code: LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED,
      message: "Could not clear saved ledger data",
    });
  });

  it("clears the saved ledger through the adapter contract", async () => {
    const storage = new MemoryStorageAdapter();
    const repository = new DefaultLedgerRepository(
      storage,
      new NoopEncryptionService(),
    );
    await repository.save(createLedger());

    await repository.clear();

    await expect(repository.load()).resolves.toBeNull();
  });
});

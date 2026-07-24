import { describe, expect, it, vi } from "vitest";

import type { StorageAdapter } from "../adapters/storageAdapter";
import {
  base64UrlToBytes,
  bytesToBase64Url,
} from "../encryption/cryptoEncoding";
import {
  type StoredLedgerEnvelopeV2,
  validateStoredLedgerEnvelopeV2,
} from "../encryption/cryptoEnvelope";
import { createNoopStoredLedgerEnvelope } from "../encryption/noopEncryptionService";
import { createInitialLedgerData } from "../state/initialLedgerData";
import {
  DefaultLedgerAccessController,
  LEDGER_ACCESS_ERROR_CODES,
} from "./ledgerAccessController";

const PASSPHRASE = "correct horse battery staple";

class MemoryStorageAdapter implements StorageAdapter {
  stored: unknown | null;
  readonly read = vi.fn(async () => this.stored);
  readonly write = vi.fn(async (value: StoredLedgerEnvelopeV2) => {
    this.stored = structuredClone(value);
  });
  readonly clear = vi.fn(async () => {
    this.stored = null;
  });

  constructor(initialValue: unknown | null = null) {
    this.stored = initialValue;
  }
}

describe("DefaultLedgerAccessController", () => {
  it("distinguishes empty, valid encrypted, unsupported, and invalid V2 records", async () => {
    const empty = new DefaultLedgerAccessController(
      new MemoryStorageAdapter(),
    );
    const valid = new DefaultLedgerAccessController(
      new MemoryStorageAdapter(createNoopStoredLedgerEnvelope("{}")),
    );
    const legacy = new DefaultLedgerAccessController(
      new MemoryStorageAdapter({
        formatVersion: 1,
        encryptedPayload: "{}",
      }),
    );
    const invalidV2 = new DefaultLedgerAccessController(
      new MemoryStorageAdapter({
        ...createNoopStoredLedgerEnvelope("{}"),
        ciphertextBase64Url: "invalid!",
      }),
    );

    await expect(empty.inspect()).resolves.toEqual({
      status: "setup-required",
    });
    await expect(valid.inspect()).resolves.toEqual({
      status: "unlock-required",
    });
    await expect(legacy.inspect()).resolves.toEqual({
      status: "error",
      code: LEDGER_ACCESS_ERROR_CODES.UNSUPPORTED_FORMAT,
    });
    await expect(invalidV2.inspect()).resolves.toEqual({
      status: "error",
      code: LEDGER_ACCESS_ERROR_CODES.INVALID_ENVELOPE,
    });
  });

  it("maps read failures without treating them as a new ledger", async () => {
    const storage = new MemoryStorageAdapter();
    storage.read.mockRejectedValueOnce(new Error("private storage detail"));
    const controller = new DefaultLedgerAccessController(storage);

    await expect(controller.inspect()).resolves.toEqual({
      status: "error",
      code: LEDGER_ACCESS_ERROR_CODES.READ_FAILED,
    });
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("sets up an encrypted initial ledger and returns the verified repository", async () => {
    const storage = new MemoryStorageAdapter();
    const controller = new DefaultLedgerAccessController(storage);

    const result = await controller.setup(PASSPHRASE);

    expect(result.ok).toBe(true);
    expect(storage.write).toHaveBeenCalledOnce();
    expect(validateStoredLedgerEnvelopeV2(storage.stored).ok).toBe(true);
    expect(JSON.stringify(storage.stored)).not.toContain(
      '"schemaVersion"',
    );
    if (!result.ok) return;
    await expect(result.repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
  });

  it("does not overwrite a pre-existing record during setup", async () => {
    const legacyRecord = {
      formatVersion: 1,
      encryptedPayload: "test-only",
    };
    const storage = new MemoryStorageAdapter(legacyRecord);
    const controller = new DefaultLedgerAccessController(storage);

    await expect(controller.setup(PASSPHRASE)).resolves.toEqual({
      ok: false,
      code: LEDGER_ACCESS_ERROR_CODES.UNSUPPORTED_FORMAT,
    });
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.stored).toEqual(legacyRecord);
  });

  it("redirects a stale setup attempt to unlock when a valid V2 record already exists", async () => {
    const encryptedRecord = createNoopStoredLedgerEnvelope("{}");
    const storage = new MemoryStorageAdapter(encryptedRecord);
    const controller = new DefaultLedgerAccessController(storage);

    await expect(controller.setup(PASSPHRASE)).resolves.toEqual({
      ok: false,
      code: LEDGER_ACCESS_ERROR_CODES.SETUP_RECOVERY_REQUIRED,
    });
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.stored).toEqual(encryptedRecord);
  });

  it("does not unlock the Dashboard when initial encrypted persistence fails", async () => {
    const storage = new MemoryStorageAdapter();
    storage.write.mockRejectedValueOnce(new Error("write failed"));
    const controller = new DefaultLedgerAccessController(storage);

    await expect(controller.setup(PASSPHRASE)).resolves.toEqual({
      ok: false,
      code: LEDGER_ACCESS_ERROR_CODES.SETUP_FAILED,
    });
    expect(storage.stored).toBeNull();
  });

  it("keeps a successfully written V2 record and requires unlock when verification read fails", async () => {
    const storage = new MemoryStorageAdapter();
    storage.read
      .mockImplementationOnce(async () => null)
      .mockRejectedValueOnce(new Error("verification read failed"));
    const controller = new DefaultLedgerAccessController(storage);

    await expect(controller.setup(PASSPHRASE)).resolves.toEqual({
      ok: false,
      code: LEDGER_ACCESS_ERROR_CODES.SETUP_RECOVERY_REQUIRED,
    });
    expect(storage.write).toHaveBeenCalledOnce();
    expect(storage.read).toHaveBeenCalledTimes(3);
    expect(validateStoredLedgerEnvelopeV2(storage.stored).ok).toBe(true);

    const unlock = await new DefaultLedgerAccessController(storage).unlock(
      PASSPHRASE,
    );
    expect(unlock.ok).toBe(true);
    if (!unlock.ok) return;
    await expect(unlock.repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
  });

  it("maps a failed setup reconciliation read without deleting the written record", async () => {
    const storage = new MemoryStorageAdapter();
    storage.read
      .mockImplementationOnce(async () => null)
      .mockRejectedValueOnce(new Error("verification read failed"))
      .mockRejectedValueOnce(new Error("reconciliation read failed"));
    const controller = new DefaultLedgerAccessController(storage);

    await expect(controller.setup(PASSPHRASE)).resolves.toEqual({
      ok: false,
      code: LEDGER_ACCESS_ERROR_CODES.READ_FAILED,
    });
    expect(storage.write).toHaveBeenCalledOnce();
    expect(validateStoredLedgerEnvelopeV2(storage.stored).ok).toBe(true);
    await expect(controller.inspect()).resolves.toEqual({
      status: "unlock-required",
    });
  });

  it("unlocks with the correct password and rejects a wrong password with zero writes", async () => {
    const storage = new MemoryStorageAdapter();
    const setupController = new DefaultLedgerAccessController(storage);
    const setup = await setupController.setup(PASSPHRASE);
    expect(setup.ok).toBe(true);
    storage.write.mockClear();
    const encryptedRecord = structuredClone(storage.stored);

    const wrong = await new DefaultLedgerAccessController(storage).unlock(
      "another valid passphrase",
    );
    expect(wrong).toEqual({
      ok: false,
      code: LEDGER_ACCESS_ERROR_CODES.UNLOCK_FAILED,
    });
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.stored).toEqual(encryptedRecord);

    const correct = await new DefaultLedgerAccessController(storage).unlock(
      PASSPHRASE,
    );
    expect(correct.ok).toBe(true);
    if (!correct.ok) return;
    await expect(correct.repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
  });

  it("maps authenticated ciphertext tampering to the unified unlock failure", async () => {
    const storage = new MemoryStorageAdapter();
    await new DefaultLedgerAccessController(storage).setup(PASSPHRASE);
    const envelope = storage.stored as StoredLedgerEnvelopeV2;
    const ciphertext = base64UrlToBytes(envelope.ciphertextBase64Url);
    ciphertext[0] ^= 1;
    storage.stored = {
      ...envelope,
      ciphertextBase64Url: bytesToBase64Url(ciphertext),
    };
    storage.write.mockClear();

    await expect(
      new DefaultLedgerAccessController(storage).unlock(PASSPHRASE),
    ).resolves.toEqual({
      ok: false,
      code: LEDGER_ACCESS_ERROR_CODES.UNLOCK_FAILED,
    });
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("keeps the record when reset fails and clears it only on success", async () => {
    const original = createNoopStoredLedgerEnvelope("{}");
    const failingStorage = new MemoryStorageAdapter(original);
    failingStorage.clear.mockRejectedValueOnce(new Error("clear failed"));

    await expect(
      new DefaultLedgerAccessController(
        failingStorage,
      ).resetEncryptedLedger(),
    ).resolves.toEqual({
      ok: false,
      code: LEDGER_ACCESS_ERROR_CODES.RESET_FAILED,
    });
    expect(failingStorage.stored).toEqual(original);

    await expect(
      new DefaultLedgerAccessController(
        failingStorage,
      ).resetEncryptedLedger(),
    ).resolves.toEqual({ ok: true });
    expect(failingStorage.stored).toBeNull();
  });
});

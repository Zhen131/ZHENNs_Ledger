import { describe, expect, it, vi } from "vitest";

import type { StorageAdapter } from "./storageAdapter";
import {
  base64UrlToBytes,
  bytesToBase64Url,
} from "@/platform/encryption";
import type { StoredLedgerEnvelopeV2 } from "./cryptoEnvelope";
import { WebCryptoEncryptionService } from "./webCryptoEncryptionService";
import { createInitialLedgerData } from "@/core/state";
import { sampleUsdtTrades } from "@/test-support";
import {
  DefaultLedgerRepository,
  LEDGER_REPOSITORY_ERROR_CODES,
} from "@/platform/persistence";

const PASSPHRASE = "correct horse battery staple";

class MemoryStorageAdapter implements StorageAdapter {
  stored: unknown | null = null;
  readonly read = vi.fn(async () => this.stored);
  readonly write = vi.fn(async (value: StoredLedgerEnvelopeV2) => {
    this.stored = structuredClone(value);
  });
  readonly clear = vi.fn(async () => {
    this.stored = null;
  });
}

function createLedger() {
  return {
    ...createInitialLedgerData(),
    trades: structuredClone(sampleUsdtTrades),
    priceSnapshots: [
      {
        id: "price-binance-btc",
        assetSymbol: "BTC",
        price: "70000",
        currency: "USDT",
        recordedAt: "2026-07-25",
        source: "api" as const,
        binanceProvenance: {
          provider: "binance" as const,
          symbol: "BTCUSDT",
          sourceQuoteCurrency: "USDT" as const,
          fetchedAt: "2026-07-25T12:00:00Z",
        },
        createdAt: "2026-07-25T12:00:00Z",
        updatedAt: "2026-07-25T12:00:00Z",
      },
    ],
  };
}

describe("encrypted LedgerRepository integration", () => {
  it("stores no ledger JSON plaintext and round-trips the complete ledger", async () => {
    const storage = new MemoryStorageAdapter();
    const encryption =
      await WebCryptoEncryptionService.createForSetup(PASSPHRASE);
    const repository = new DefaultLedgerRepository(storage, encryption);
    const ledger = createLedger();

    await repository.save(ledger);

    const serializedRecord = JSON.stringify(storage.stored);
    expect((storage.stored as StoredLedgerEnvelopeV2).formatVersion).toBe(2);
    expect((storage.stored as StoredLedgerEnvelopeV2).ledgerSchemaVersion).toBe(
      1,
    );
    expect(serializedRecord).not.toContain('"schemaVersion"');
    expect(serializedRecord).not.toContain('"trades"');
    expect(serializedRecord).not.toContain("Bitcoin");
    expect(serializedRecord).not.toContain("BTCUSDT");
    expect(serializedRecord).not.toContain("70000");

    const storedEnvelope = storage.stored as StoredLedgerEnvelopeV2;
    const unlockedEncryption =
      await WebCryptoEncryptionService.createForUnlock(
        PASSPHRASE,
        storedEnvelope.kdf.saltBase64Url,
      );
    const remountedRepository = new DefaultLedgerRepository(
      storage,
      unlockedEncryption,
    );
    await expect(remountedRepository.load()).resolves.toEqual(ledger);
  });

  it("uses a fresh IV for each save while retaining the session salt", async () => {
    const storage = new MemoryStorageAdapter();
    const encryption =
      await WebCryptoEncryptionService.createForSetup(PASSPHRASE);
    const repository = new DefaultLedgerRepository(storage, encryption);

    await repository.save(createLedger());
    const first = structuredClone(
      storage.stored,
    ) as StoredLedgerEnvelopeV2;
    await repository.save(createLedger());
    const second = storage.stored as StoredLedgerEnvelopeV2;

    expect(second.kdf.saltBase64Url).toBe(first.kdf.saltBase64Url);
    expect(second.cipher.ivBase64Url).not.toBe(
      first.cipher.ivBase64Url,
    );
    expect(second.ciphertextBase64Url).not.toBe(
      first.ciphertextBase64Url,
    );
  });

  it("rejects wrong keys and valid-shape tampering without writing", async () => {
    const storage = new MemoryStorageAdapter();
    const encryption =
      await WebCryptoEncryptionService.createForSetup(PASSPHRASE);
    const repository = new DefaultLedgerRepository(storage, encryption);
    await repository.save(createLedger());
    storage.write.mockClear();
    const original = structuredClone(
      storage.stored,
    ) as StoredLedgerEnvelopeV2;

    const wrongEncryption =
      await WebCryptoEncryptionService.createForUnlock(
        "another valid passphrase",
        original.kdf.saltBase64Url,
      );
    await expect(
      new DefaultLedgerRepository(storage, wrongEncryption).load(),
    ).rejects.toMatchObject({
      code: LEDGER_REPOSITORY_ERROR_CODES.INVALID_STORED_DATA,
    });
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.stored).toEqual(original);

    const bytes = base64UrlToBytes(original.ciphertextBase64Url);
    bytes[0] ^= 1;
    storage.stored = {
      ...original,
      ciphertextBase64Url: bytesToBase64Url(bytes),
    };
    await expect(repository.load()).rejects.toMatchObject({
      code: LEDGER_REPOSITORY_ERROR_CODES.INVALID_STORED_DATA,
    });
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("leaves the previous successful ciphertext untouched when a write fails", async () => {
    const storage = new MemoryStorageAdapter();
    const encryption =
      await WebCryptoEncryptionService.createForSetup(PASSPHRASE);
    const repository = new DefaultLedgerRepository(storage, encryption);
    await repository.save(createLedger());
    const previous = structuredClone(storage.stored);
    storage.write.mockRejectedValueOnce(new Error("transaction failed"));

    await expect(repository.save(createInitialLedgerData())).rejects.toMatchObject({
      code: LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
    });
    expect(storage.stored).toEqual(previous);
  });
});

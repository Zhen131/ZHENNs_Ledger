import { describe, expect, it, vi } from "vitest";

import { base64UrlToBytes, bytesToBase64Url } from "./cryptoEncoding";
import {
  createCryptoEnvelopeMetadataV1,
  type StoredLedgerEnvelopeV2,
} from "./cryptoEnvelope";
import {
  deriveLedgerKey,
  WebCryptoEncryptionService,
  type CryptoProvider,
} from "./webCryptoEncryptionService";

const PASSPHRASE = "correct horse battery staple";

describe("WebCryptoEncryptionService", () => {
  it("round-trips Unicode and empty plaintext with the same passphrase and salt", async () => {
    const setupService =
      await WebCryptoEncryptionService.createForSetup(PASSPHRASE);
    const unicodeEnvelope = await setupService.encrypt(
      '{"memo":"账本 🔐 café"}',
    );
    const emptyEnvelope = await setupService.encrypt("");
    const unlockService =
      await WebCryptoEncryptionService.createForUnlock(
        PASSPHRASE,
        unicodeEnvelope.kdf.saltBase64Url,
      );

    await expect(unlockService.decrypt(unicodeEnvelope)).resolves.toBe(
      '{"memo":"账本 🔐 café"}',
    );
    await expect(unlockService.decrypt(emptyEnvelope)).resolves.toBe("");
  });

  it("round-trips a payload close to 8 MiB without truncation", async () => {
    const service =
      await WebCryptoEncryptionService.createForSetup(PASSPHRASE);
    const plaintext = "账".repeat(2_700_000);
    const envelope = await service.encrypt(plaintext);

    await expect(service.decrypt(envelope)).resolves.toBe(plaintext);
  });

  it("generates a fresh IV and ciphertext for every encryption", async () => {
    const service =
      await WebCryptoEncryptionService.createForSetup(PASSPHRASE);
    const first = await service.encrypt("same plaintext");
    const second = await service.encrypt("same plaintext");

    expect(first.kdf.saltBase64Url).toBe(second.kdf.saltBase64Url);
    expect(first.cipher.ivBase64Url).not.toBe(
      second.cipher.ivBase64Url,
    );
    expect(first.ciphertextBase64Url).not.toBe(
      second.ciphertextBase64Url,
    );
  });

  it("rejects wrong passphrases, different salt, and authenticated-data tampering", async () => {
    const service =
      await WebCryptoEncryptionService.createForSetup(PASSPHRASE);
    const envelope = await service.encrypt("sensitive ledger");
    const wrongPassword =
      await WebCryptoEncryptionService.createForUnlock(
        "another valid passphrase",
        envelope.kdf.saltBase64Url,
      );
    const differentSalt =
      await WebCryptoEncryptionService.createForSetup(PASSPHRASE);

    await expect(wrongPassword.decrypt(envelope)).rejects.toBeDefined();
    await expect(differentSalt.decrypt(envelope)).rejects.toBeDefined();

    for (const tampered of createTamperedEnvelopes(envelope)) {
      await expect(service.decrypt(tampered)).rejects.toBeDefined();
    }
  });

  it("derives a non-extractable AES-256-GCM key", async () => {
    const key = await deriveLedgerKey(
      PASSPHRASE,
      new Uint8Array(16).fill(7),
    );

    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(key.usages).toEqual(["encrypt", "decrypt"]);
    await expect(
      globalThis.crypto.subtle.exportKey("raw", key),
    ).rejects.toBeDefined();
  });

  it("derives once per session and reuses the key for consecutive saves", async () => {
    const deriveKey = vi.fn(
      globalThis.crypto.subtle.deriveKey.bind(globalThis.crypto.subtle),
    );
    const cryptoProvider = {
      getRandomValues: globalThis.crypto.getRandomValues.bind(
        globalThis.crypto,
      ),
      subtle: {
        importKey: globalThis.crypto.subtle.importKey.bind(
          globalThis.crypto.subtle,
        ),
        deriveKey,
        encrypt: globalThis.crypto.subtle.encrypt.bind(
          globalThis.crypto.subtle,
        ),
        decrypt: globalThis.crypto.subtle.decrypt.bind(
          globalThis.crypto.subtle,
        ),
      },
    } as unknown as CryptoProvider;

    const service = await WebCryptoEncryptionService.createForSetup(
      PASSPHRASE,
      cryptoProvider,
    );
    await service.encrypt("first save");
    await service.encrypt("second save");

    expect(deriveKey).toHaveBeenCalledOnce();
  });
});

function createTamperedEnvelopes(
  envelope: StoredLedgerEnvelopeV2,
): StoredLedgerEnvelopeV2[] {
  const changedCiphertext = base64UrlToBytes(
    envelope.ciphertextBase64Url,
  );
  changedCiphertext[0] ^= 1;
  const changedIv = base64UrlToBytes(envelope.cipher.ivBase64Url);
  changedIv[0] ^= 1;
  const changedSalt = base64UrlToBytes(envelope.kdf.saltBase64Url);
  changedSalt[0] ^= 1;

  return [
    {
      ...envelope,
      ciphertextBase64Url: bytesToBase64Url(changedCiphertext),
    },
    {
      ...envelope,
      cipher: {
        ...envelope.cipher,
        ivBase64Url: bytesToBase64Url(changedIv),
      },
    },
    {
      ...envelope,
      kdf: {
        ...envelope.kdf,
        saltBase64Url: bytesToBase64Url(changedSalt),
      },
    },
    {
      ...envelope,
      ...createCryptoEnvelopeMetadataV1(
        envelope.kdf.saltBase64Url,
        envelope.cipher.ivBase64Url,
      ),
      ledgerSchemaVersion: 2,
    } as unknown as StoredLedgerEnvelopeV2,
  ];
}

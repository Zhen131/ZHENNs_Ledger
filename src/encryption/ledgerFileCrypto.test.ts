import { describe, expect, it, vi } from "vitest";

import { base64UrlToBytes, bytesToBase64Url } from "./cryptoEncoding";
import {
  LEDGER_FILE_V1_CONSTANTS,
  type EncryptedLedgerGenerationV1,
  type LedgerFileCryptoV1,
} from "./ledgerFileContract";
import { LedgerFileCrypto } from "./ledgerFileCrypto";
import type { CryptoProvider } from "./ledgerKeyDerivation";

const PASSPHRASE = "correct horse battery staple";

describe("LedgerFileCrypto", () => {
  it("independently authenticates and decrypts adjacent full generations with one salt and different IVs", async () => {
    const crypto = await LedgerFileCrypto.createForSetup(PASSPHRASE);
    const first = await crypto.encryptGeneration(
      "file-a",
      {
        revisionId: "revision-a",
        parentRevisionId: null,
        ledgerSchemaVersion: 1,
      },
      '{"savedAt":"2026-07-28T10:00:00.000Z","ledgerData":{"trades":[]}}',
    );
    const second = await crypto.encryptGeneration(
      "file-a",
      {
        revisionId: "revision-b",
        parentRevisionId: "revision-a",
        ledgerSchemaVersion: 1,
      },
      '{"savedAt":"2026-07-28T10:01:00.000Z","ledgerData":{"trades":[1]}}',
    );
    const unlock = await LedgerFileCrypto.createForUnlock(
      PASSPHRASE,
      crypto.getCryptoMetadata(),
    );

    await expect(unlock.decryptGeneration("file-a", first)).resolves.toContain(
      '"trades":[]',
    );
    await expect(
      unlock.decryptGeneration("file-a", second),
    ).resolves.toContain('"trades":[1]');
    expect(first.ivBase64Url).not.toBe(second.ivBase64Url);
    expect(first.ciphertextBase64Url).not.toBe(
      second.ciphertextBase64Url,
    );
  });

  it("rejects a wrong password, different salt, ciphertext tampering, and authenticated metadata tampering", async () => {
    const crypto = await LedgerFileCrypto.createForSetup(PASSPHRASE);
    const generation = await crypto.encryptGeneration(
      "file-a",
      {
        revisionId: "revision-a",
        parentRevisionId: null,
        ledgerSchemaVersion: 1,
      },
      "secret payload",
    );
    const wrongPassword = await LedgerFileCrypto.createForUnlock(
      "another valid passphrase",
      crypto.getCryptoMetadata(),
    );
    const differentSalt = await LedgerFileCrypto.createForSetup(PASSPHRASE);

    await expect(
      wrongPassword.decryptGeneration("file-a", generation),
    ).rejects.toBeDefined();
    await expect(
      differentSalt.decryptGeneration("file-a", generation),
    ).rejects.toBeDefined();

    for (const [fileId, tampered] of createTamperedGenerations(generation)) {
      await expect(
        crypto.decryptGeneration(fileId, tampered),
      ).rejects.toBeDefined();
    }

    const tamperedMetadata: LedgerFileCryptoV1 = {
      ...crypto.getCryptoMetadata(),
      cipher: {
        ...crypto.getCryptoMetadata().cipher,
        tagLength: 96,
      },
    } as unknown as LedgerFileCryptoV1;
    const changedAad = await LedgerFileCrypto.createForUnlock(
      PASSPHRASE,
      tamperedMetadata,
    );
    await expect(
      changedAad.decryptGeneration("file-a", generation),
    ).rejects.toBeDefined();
  });

  it("derives once per file session and reuses the non-extractable key", async () => {
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
    const crypto = await LedgerFileCrypto.createForSetup(
      PASSPHRASE,
      cryptoProvider,
    );

    await crypto.encryptGeneration(
      "file-a",
      {
        revisionId: "a",
        parentRevisionId: null,
        ledgerSchemaVersion: 1,
      },
      "first",
    );
    await crypto.encryptGeneration(
      "file-a",
      {
        revisionId: "b",
        parentRevisionId: "a",
        ledgerSchemaVersion: 1,
      },
      "second",
    );

    expect(deriveKey).toHaveBeenCalledOnce();
    expect(deriveKey).toHaveBeenCalledWith(
      expect.objectContaining({
        name: LEDGER_FILE_V1_CONSTANTS.kdfName,
        hash: LEDGER_FILE_V1_CONSTANTS.kdfHash,
        iterations: LEDGER_FILE_V1_CONSTANTS.kdfIterations,
      }),
      expect.anything(),
      {
        name: LEDGER_FILE_V1_CONSTANTS.cipherName,
        length: LEDGER_FILE_V1_CONSTANTS.keyLength,
      },
      false,
      ["encrypt", "decrypt"],
    );
  });

  it("decrypts a C V1 fixture generated before key derivation was decoupled", async () => {
    const metadata: LedgerFileCryptoV1 = {
      cryptoVersion: 1,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: 600_000,
        saltBase64Url: "BwcHBwcHBwcHBwcHBwcHBw",
      },
      cipher: {
        name: "AES-GCM",
        keyLength: 256,
        tagLength: 128,
      },
    };
    const generation: EncryptedLedgerGenerationV1 = {
      revisionId: "fixture-revision",
      parentRevisionId: null,
      ledgerSchemaVersion: 1,
      ivBase64Url: "CQkJCQkJCQkJCQkJ",
      ciphertextBase64Url:
        "9zhn4OlMwPmw33DWGPkNJm1YjvAmEOulk7Hfig8ONwFt8kUmMLcJkwwEDBIJ3KIVBPOP4kMWp7TgDWoGyM7h05jLEJ6yt7vGksvXJ8OCnfLyPRpr_cLE7bamZ9FBu1OSv7LpiUFVqvVLdGjpEnBBG90RuplgmJTElLEZo7KCHXnWap0dpalQmD4SyfsICT5Akw",
    };
    const crypto = await LedgerFileCrypto.createForUnlock(
      PASSPHRASE,
      metadata,
    );

    await expect(
      crypto.decryptGeneration("fixture-file", generation),
    ).resolves.toBe(
      '{"savedAt":"2026-07-29T00:00:00.000Z","ledgerData":{"schemaVersion":1,"assets":[],"trades":[],"priceSnapshots":[],"feeRules":[]}}',
    );
  });
});

function createTamperedGenerations(
  generation: EncryptedLedgerGenerationV1,
): Array<[string, EncryptedLedgerGenerationV1]> {
  const changedCiphertext = base64UrlToBytes(
    generation.ciphertextBase64Url,
  );
  changedCiphertext[0] ^= 1;
  const changedIv = base64UrlToBytes(generation.ivBase64Url);
  changedIv[0] ^= 1;

  return [
    ["file-b", generation],
    [
      "file-a",
      {
        ...generation,
        revisionId: "revision-b",
      },
    ],
    [
      "file-a",
      {
        ...generation,
        parentRevisionId: "unexpected-parent",
      },
    ],
    [
      "file-a",
      {
        ...generation,
        ledgerSchemaVersion: 2,
      } as unknown as EncryptedLedgerGenerationV1,
    ],
    [
      "file-a",
      {
        ...generation,
        ivBase64Url: bytesToBase64Url(changedIv),
      },
    ],
    [
      "file-a",
      {
        ...generation,
        ciphertextBase64Url: bytesToBase64Url(changedCiphertext),
      },
    ],
  ];
}

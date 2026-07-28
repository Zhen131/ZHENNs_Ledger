import { describe, expect, it, vi } from "vitest";

import { base64UrlToBytes, bytesToBase64Url } from "./cryptoEncoding";
import {
  type EncryptedLedgerGenerationV1,
  type LedgerFileCryptoV1,
} from "./ledgerFileContract";
import { LedgerFileCrypto } from "./ledgerFileCrypto";
import type { CryptoProvider } from "./webCryptoEncryptionService";

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

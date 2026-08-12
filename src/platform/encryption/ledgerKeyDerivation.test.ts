import { describe, expect, it, vi } from "vitest";

import {
  deriveLedgerKeyWithParameters,
  type CryptoProvider,
  type LedgerKeyDerivationParameters,
} from "./ledgerKeyDerivation";

const PASSPHRASE = "correct horse battery staple";

describe("deriveLedgerKeyWithParameters", () => {
  it("uses each caller's explicit contract without shared format defaults", async () => {
    const deriveKey = vi.fn(
      globalThis.crypto.subtle.deriveKey.bind(
        globalThis.crypto.subtle,
      ),
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
      },
    } as unknown as CryptoProvider;
    const fileContract: LedgerKeyDerivationParameters = {
      kdfName: "PBKDF2",
      kdfHash: "SHA-256",
      kdfIterations: 11,
      cipherName: "AES-GCM",
      keyLength: 128,
    };
    const indexedDbContract: LedgerKeyDerivationParameters = {
      kdfName: "PBKDF2",
      kdfHash: "SHA-256",
      kdfIterations: 22,
      cipherName: "AES-GCM",
      keyLength: 256,
    };

    const fileKey = await deriveLedgerKeyWithParameters(
      PASSPHRASE,
      new Uint8Array(16).fill(1),
      fileContract,
      cryptoProvider,
    );
    const indexedDbKey = await deriveLedgerKeyWithParameters(
      PASSPHRASE,
      new Uint8Array(16).fill(2),
      indexedDbContract,
      cryptoProvider,
    );

    expect(deriveKey).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: 11,
      }),
      expect.anything(),
      { name: "AES-GCM", length: 128 },
      false,
      ["encrypt", "decrypt"],
    );
    expect(deriveKey).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: 22,
      }),
      expect.anything(),
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    expect(fileKey.algorithm).toMatchObject({
      name: "AES-GCM",
      length: 128,
    });
    expect(indexedDbKey.algorithm).toMatchObject({
      name: "AES-GCM",
      length: 256,
    });
  });
});

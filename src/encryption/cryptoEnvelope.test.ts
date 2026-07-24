import { describe, expect, it } from "vitest";

import { bytesToBase64Url } from "./cryptoEncoding";
import {
  createCryptoAadV1,
  createCryptoEnvelopeMetadataV1,
  validateStoredLedgerEnvelopeV2,
} from "./cryptoEnvelope";

const salt = bytesToBase64Url(new Uint8Array(16).fill(1));
const iv = bytesToBase64Url(new Uint8Array(12).fill(2));
const ciphertext = bytesToBase64Url(new Uint8Array(16).fill(3));

function createValidEnvelope() {
  return {
    ...createCryptoEnvelopeMetadataV1(salt, iv),
    ciphertextBase64Url: ciphertext,
  };
}

describe("StoredLedgerEnvelopeV2", () => {
  it("accepts only the exact frozen format", () => {
    expect(validateStoredLedgerEnvelopeV2(createValidEnvelope())).toEqual({
      ok: true,
      value: createValidEnvelope(),
    });
  });

  it.each([
    null,
    [],
    {},
    { ...createValidEnvelope(), extra: true },
    { ...createValidEnvelope(), formatVersion: 1 },
    { ...createValidEnvelope(), cryptoVersion: 2 },
    {
      ...createValidEnvelope(),
      kdf: { ...createValidEnvelope().kdf, iterations: 1 },
    },
    {
      ...createValidEnvelope(),
      kdf: { ...createValidEnvelope().kdf, extra: true },
    },
    {
      ...createValidEnvelope(),
      cipher: { ...createValidEnvelope().cipher, ivBase64Url: "AQ" },
    },
    { ...createValidEnvelope(), ciphertextBase64Url: "not valid!" },
    {
      ...createValidEnvelope(),
      ciphertextBase64Url: bytesToBase64Url(new Uint8Array(15)),
    },
  ])("rejects malformed or unknown envelopes", (value) => {
    expect(validateStoredLedgerEnvelopeV2(value)).toEqual({ ok: false });
  });

  it("emits stable AAD bytes in the specified field order", () => {
    const metadata = createCryptoEnvelopeMetadataV1(salt, iv);
    const decoded = new TextDecoder().decode(createCryptoAadV1(metadata));

    expect(decoded).toBe(
      `{"formatVersion":2,"cryptoVersion":1,"ledgerSchemaVersion":1,"kdf":{"name":"PBKDF2","hash":"SHA-256","iterations":600000,"saltBase64Url":"${salt}"},"cipher":{"name":"AES-GCM","keyLength":256,"ivBase64Url":"${iv}","tagLength":128}}`,
    );
    expect(decoded).not.toContain("ciphertextBase64Url");
  });
});

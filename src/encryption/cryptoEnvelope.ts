import { base64UrlToBytes } from "./cryptoEncoding";

export const LEDGER_CRYPTO_CONSTANTS = {
  formatVersion: 2,
  cryptoVersion: 1,
  ledgerSchemaVersion: 1,
  kdfName: "PBKDF2",
  kdfHash: "SHA-256",
  kdfIterations: 600_000,
  saltBytes: 16,
  cipherName: "AES-GCM",
  keyLength: 256,
  ivBytes: 12,
  tagLength: 128,
  minimumCiphertextBytes: 16,
} as const;

export type CryptoEnvelopeMetadataV1 = {
  formatVersion: 2;
  cryptoVersion: 1;
  ledgerSchemaVersion: 1;
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: 600000;
    saltBase64Url: string;
  };
  cipher: {
    name: "AES-GCM";
    keyLength: 256;
    ivBase64Url: string;
    tagLength: 128;
  };
};

export type StoredLedgerEnvelopeV2 = CryptoEnvelopeMetadataV1 & {
  ciphertextBase64Url: string;
};

export type StoredLedgerEnvelopeValidationResult =
  | { ok: true; value: StoredLedgerEnvelopeV2 }
  | { ok: false };

const TOP_LEVEL_KEYS = [
  "cipher",
  "ciphertextBase64Url",
  "cryptoVersion",
  "formatVersion",
  "kdf",
  "ledgerSchemaVersion",
] as const;
const KDF_KEYS = [
  "hash",
  "iterations",
  "name",
  "saltBase64Url",
] as const;
const CIPHER_KEYS = [
  "ivBase64Url",
  "keyLength",
  "name",
  "tagLength",
] as const;

export function createCryptoEnvelopeMetadataV1(
  saltBase64Url: string,
  ivBase64Url: string,
): CryptoEnvelopeMetadataV1 {
  return {
    formatVersion: LEDGER_CRYPTO_CONSTANTS.formatVersion,
    cryptoVersion: LEDGER_CRYPTO_CONSTANTS.cryptoVersion,
    ledgerSchemaVersion: LEDGER_CRYPTO_CONSTANTS.ledgerSchemaVersion,
    kdf: {
      name: LEDGER_CRYPTO_CONSTANTS.kdfName,
      hash: LEDGER_CRYPTO_CONSTANTS.kdfHash,
      iterations: LEDGER_CRYPTO_CONSTANTS.kdfIterations,
      saltBase64Url,
    },
    cipher: {
      name: LEDGER_CRYPTO_CONSTANTS.cipherName,
      keyLength: LEDGER_CRYPTO_CONSTANTS.keyLength,
      ivBase64Url,
      tagLength: LEDGER_CRYPTO_CONSTANTS.tagLength,
    },
  };
}

export function createCryptoAadV1(
  metadata: CryptoEnvelopeMetadataV1,
): Uint8Array {
  const orderedMetadata: CryptoEnvelopeMetadataV1 = {
    formatVersion: metadata.formatVersion,
    cryptoVersion: metadata.cryptoVersion,
    ledgerSchemaVersion: metadata.ledgerSchemaVersion,
    kdf: {
      name: metadata.kdf.name,
      hash: metadata.kdf.hash,
      iterations: metadata.kdf.iterations,
      saltBase64Url: metadata.kdf.saltBase64Url,
    },
    cipher: {
      name: metadata.cipher.name,
      keyLength: metadata.cipher.keyLength,
      ivBase64Url: metadata.cipher.ivBase64Url,
      tagLength: metadata.cipher.tagLength,
    },
  };

  return new TextEncoder().encode(JSON.stringify(orderedMetadata));
}

export function validateStoredLedgerEnvelopeV2(
  value: unknown,
): StoredLedgerEnvelopeValidationResult {
  if (!isExactObject(value, TOP_LEVEL_KEYS)) {
    return { ok: false };
  }

  if (
    value.formatVersion !== LEDGER_CRYPTO_CONSTANTS.formatVersion ||
    value.cryptoVersion !== LEDGER_CRYPTO_CONSTANTS.cryptoVersion ||
    value.ledgerSchemaVersion !==
      LEDGER_CRYPTO_CONSTANTS.ledgerSchemaVersion ||
    typeof value.ciphertextBase64Url !== "string" ||
    !isExactObject(value.kdf, KDF_KEYS) ||
    !isExactObject(value.cipher, CIPHER_KEYS)
  ) {
    return { ok: false };
  }

  if (
    value.kdf.name !== LEDGER_CRYPTO_CONSTANTS.kdfName ||
    value.kdf.hash !== LEDGER_CRYPTO_CONSTANTS.kdfHash ||
    value.kdf.iterations !== LEDGER_CRYPTO_CONSTANTS.kdfIterations ||
    typeof value.kdf.saltBase64Url !== "string" ||
    value.cipher.name !== LEDGER_CRYPTO_CONSTANTS.cipherName ||
    value.cipher.keyLength !== LEDGER_CRYPTO_CONSTANTS.keyLength ||
    typeof value.cipher.ivBase64Url !== "string" ||
    value.cipher.tagLength !== LEDGER_CRYPTO_CONSTANTS.tagLength
  ) {
    return { ok: false };
  }

  try {
    const salt = base64UrlToBytes(value.kdf.saltBase64Url);
    const iv = base64UrlToBytes(value.cipher.ivBase64Url);
    const ciphertext = base64UrlToBytes(value.ciphertextBase64Url);

    if (
      salt.byteLength !== LEDGER_CRYPTO_CONSTANTS.saltBytes ||
      iv.byteLength !== LEDGER_CRYPTO_CONSTANTS.ivBytes ||
      ciphertext.byteLength <
        LEDGER_CRYPTO_CONSTANTS.minimumCiphertextBytes
    ) {
      return { ok: false };
    }
  } catch {
    return { ok: false };
  }

  return {
    ok: true,
    value: value as StoredLedgerEnvelopeV2,
  };
}

export function getStoredLedgerFormatVersion(value: unknown): unknown {
  return isRecord(value) ? value.formatVersion : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExactObject(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(value).sort();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index])
  );
}

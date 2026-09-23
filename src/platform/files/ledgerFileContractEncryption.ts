import type {
  LedgerFileCryptoV2,
  EncryptedLedgerGenerationV4,
  LedgerFileV2,
} from "./ledgerFileContract";
import { LEDGER_FILE_OUTER_V2_CONSTANTS } from "./ledgerFileContract";

export function createLedgerFileGenerationAadV2(
  file: Pick<
    LedgerFileV2,
    "fileFormatVersion" | "fileId" | "crypto"
  >,
  generation: Omit<
    EncryptedLedgerGenerationV4,
    "ciphertextBase64Url"
  >,
): Uint8Array {
  const ordered = {
    fileFormatVersion: file.fileFormatVersion,
    fileId: file.fileId,
    crypto: {
      cryptoVersion: file.crypto.cryptoVersion,
      kdf: {
        name: file.crypto.kdf.name,
        hash: file.crypto.kdf.hash,
        iterations: file.crypto.kdf.iterations,
        saltBase64Url: file.crypto.kdf.saltBase64Url,
      },
      cipher: {
        name: file.crypto.cipher.name,
        keyLength: file.crypto.cipher.keyLength,
        tagLength: file.crypto.cipher.tagLength,
      },
    },
    generation: {
      revisionId: generation.revisionId,
      parentRevisionId: generation.parentRevisionId,
      ledgerSchemaVersion: generation.ledgerSchemaVersion,
      ivBase64Url: generation.ivBase64Url,
    },
  };

  return new TextEncoder().encode(JSON.stringify(ordered));
}

export function createLedgerFileCryptoV2(
  saltBase64Url: string,
): LedgerFileCryptoV2 {
  return {
    cryptoVersion: LEDGER_FILE_OUTER_V2_CONSTANTS.cryptoVersion,
    kdf: {
      name: LEDGER_FILE_OUTER_V2_CONSTANTS.kdfName,
      hash: LEDGER_FILE_OUTER_V2_CONSTANTS.kdfHash,
      iterations: LEDGER_FILE_OUTER_V2_CONSTANTS.kdfIterations,
      saltBase64Url,
    },
    cipher: {
      name: LEDGER_FILE_OUTER_V2_CONSTANTS.cipherName,
      keyLength: LEDGER_FILE_OUTER_V2_CONSTANTS.keyLength,
      tagLength: LEDGER_FILE_OUTER_V2_CONSTANTS.tagLength,
    },
  };
}

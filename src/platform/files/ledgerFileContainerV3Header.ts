import type {
  LedgerFileV3S1,
  EncryptedLedgerGenerationV3S1,
} from "./ledgerFileContainerV3";

export type LedgerFileGenerationHeaderV3S1 = Omit<
  EncryptedLedgerGenerationV3S1,
  "ciphertextBytes"
> & {
  ciphertextByteLength: number;
};

export type LedgerFileHeaderV3S1 = Omit<
  LedgerFileV3S1,
  "current" | "previous"
> & {
  current: LedgerFileGenerationHeaderV3S1;
  previous: LedgerFileGenerationHeaderV3S1 | null;
};

export function orderedHeader(
  file: LedgerFileV3S1,
  currentCiphertextByteLength: number,
  previousCiphertextByteLength: number | null,
): LedgerFileHeaderV3S1 {
  return {
    fileFormatVersion: file.fileFormatVersion,
    cryptoVersion: file.cryptoVersion,
    ledgerSchemaVersion: file.ledgerSchemaVersion,
    backupFormatVersion: file.backupFormatVersion,
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
    current: orderedGenerationHeader(
      file.current,
      currentCiphertextByteLength,
    ),
    previous:
      file.previous && previousCiphertextByteLength !== null
        ? orderedGenerationHeader(
            file.previous,
            previousCiphertextByteLength,
          )
        : null,
  };
}

function orderedGenerationHeader(
  generation: EncryptedLedgerGenerationV3S1,
  ciphertextByteLength: number,
): LedgerFileGenerationHeaderV3S1 {
  return {
    revisionId: generation.revisionId,
    parentRevisionId: generation.parentRevisionId,
    ledgerSchemaVersion: generation.ledgerSchemaVersion,
    ivBase64Url: generation.ivBase64Url,
    ciphertextByteLength,
  };
}

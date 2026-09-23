import { type LedgerFileCryptoV2 } from "./ledgerFileContract";
import type {
  EncryptedLedgerGenerationV3S2,
  LedgerFileV3S2,
} from "./ledgerFileSlotContainerV3";

export type LedgerFileGenerationHeaderV3S2 = Omit<
  EncryptedLedgerGenerationV3S2,
  "ciphertextBytes"
> & {
  ciphertextByteLength: number;
};

export type LedgerFileHeaderV3S2 = Omit<
  LedgerFileV3S2,
  "activeHeaderSlot" | "current" | "previous"
> & {
  current: LedgerFileGenerationHeaderV3S2;
  previous: LedgerFileGenerationHeaderV3S2 | null;
};

export function orderedHeader(file: LedgerFileV3S2): LedgerFileHeaderV3S2 {
  return {
    fileFormatVersion: file.fileFormatVersion,
    cryptoVersion: file.cryptoVersion,
    ledgerSchemaVersion: file.ledgerSchemaVersion,
    backupFormatVersion: file.backupFormatVersion,
    fileId: file.fileId,
    sequence: file.sequence,
    crypto: orderedCrypto(file.crypto),
    bodySlotBytes: file.bodySlotBytes,
    bodySlotCount: file.bodySlotCount,
    current: orderedGenerationHeader(file.current),
    previous: file.previous ? orderedGenerationHeader(file.previous) : null,
  };
}

export function orderedCrypto(crypto: LedgerFileCryptoV2): LedgerFileCryptoV2 {
  return {
    cryptoVersion: crypto.cryptoVersion,
    kdf: {
      name: crypto.kdf.name,
      hash: crypto.kdf.hash,
      iterations: crypto.kdf.iterations,
      saltBase64Url: crypto.kdf.saltBase64Url,
    },
    cipher: {
      name: crypto.cipher.name,
      keyLength: crypto.cipher.keyLength,
      tagLength: crypto.cipher.tagLength,
    },
  };
}

function orderedGenerationHeader(
  generation: EncryptedLedgerGenerationV3S2,
): LedgerFileGenerationHeaderV3S2 {
  return {
    revisionId: generation.revisionId,
    parentRevisionId: generation.parentRevisionId,
    ledgerSchemaVersion: generation.ledgerSchemaVersion,
    bodySlot: generation.bodySlot,
    ivBase64Url: generation.ivBase64Url,
    ciphertextByteLength: generation.ciphertextBytes.byteLength,
  };
}

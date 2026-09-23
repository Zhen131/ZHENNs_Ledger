import type {
  EncryptedLedgerBlockV3S3,
  LedgerFileV3S3,
} from "./ledgerFileChunkedContainerV3";
import {
  toHeader,
  orderedBlockMetadata,
  orderedCrypto,
} from "./ledgerFileChunkedContainerV3Header";

export function createLedgerFileBlockAadV3S3(
  file: Pick<
    LedgerFileV3S3,
    | "fileFormatVersion"
    | "cryptoVersion"
    | "ledgerSchemaVersion"
    | "backupFormatVersion"
    | "fileId"
    | "crypto"
  >,
  block: Omit<EncryptedLedgerBlockV3S3, "ciphertextBytes">,
): Uint8Array {
  const ordered = {
    fileFormatVersion: file.fileFormatVersion,
    cryptoVersion: file.cryptoVersion,
    ledgerSchemaVersion: file.ledgerSchemaVersion,
    backupFormatVersion: file.backupFormatVersion,
    fileId: file.fileId,
    crypto: orderedCrypto(file.crypto),
    block: orderedBlockMetadata(block),
  };
  return new TextEncoder().encode(JSON.stringify(ordered));
}

export function createLedgerFileManifestAadV3S3(
  file: LedgerFileV3S3,
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(toHeader(file)));
}

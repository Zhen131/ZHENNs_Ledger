import {
  MAX_LEDGER_FILE_V2_BYTES,
  type LedgerFileContractError,
  type LedgerFileCryptoV2,
} from "./ledgerFileContract";

export const LEDGER_FILE_V3_MAGIC = new Uint8Array([
  0x4c, 0x46, 0x54, 0x4c, 0x33, 0x0d, 0x0a, 0x00,
]);

export const LEDGER_FILE_OUTER_V3_CONSTANTS = {
  fileFormatVersion: 3,
  cryptoVersion: 1,
  ledgerSchemaVersion: 5,
  backupFormatVersion: 3,
  headerLengthBytes: 4,
  maximumHeaderBytes: 256 * 1024,
  maximumFileBytes: MAX_LEDGER_FILE_V2_BYTES,
} as const;

export type LedgerFileV3S1 = {
  fileFormatVersion: 3;
  cryptoVersion: 1;
  ledgerSchemaVersion: 5;
  backupFormatVersion: 3;
  fileId: string;
  crypto: LedgerFileCryptoV2;
  current: EncryptedLedgerGenerationV3S1;
  previous: EncryptedLedgerGenerationV3S1 | null;
};

export type EncryptedLedgerGenerationV3S1 = {
  revisionId: string;
  parentRevisionId: string | null;
  ledgerSchemaVersion: 5;
  ivBase64Url: string;
  ciphertextBytes: Uint8Array;
};

export type LedgerFileV3ValidationResult =
  | { ok: true; value: LedgerFileV3S1 }
  | { ok: false; errors: LedgerFileContractError[] };

export function isLedgerFileV3Bytes(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= LEDGER_FILE_V3_MAGIC.byteLength &&
    LEDGER_FILE_V3_MAGIC.every((value, index) => bytes[index] === value)
  );
}

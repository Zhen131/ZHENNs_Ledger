import type {
  EncryptedLedgerGenerationV3S2,
  LedgerFileV3S2,
} from "./ledgerFileSlotContainerV3";
import { orderedCrypto } from "./ledgerFileSlotContainerV3Header";

export function createLedgerFileGenerationAadV3S2(
  file: Pick<
    LedgerFileV3S2,
    | "fileFormatVersion"
    | "cryptoVersion"
    | "ledgerSchemaVersion"
    | "backupFormatVersion"
    | "fileId"
    | "crypto"
  >,
  generation: Omit<EncryptedLedgerGenerationV3S2, "ciphertextBytes">,
): Uint8Array {
  const ordered = {
    fileFormatVersion: file.fileFormatVersion,
    cryptoVersion: file.cryptoVersion,
    ledgerSchemaVersion: file.ledgerSchemaVersion,
    backupFormatVersion: file.backupFormatVersion,
    fileId: file.fileId,
    crypto: orderedCrypto(file.crypto),
    generation: {
      revisionId: generation.revisionId,
      parentRevisionId: generation.parentRevisionId,
      ledgerSchemaVersion: generation.ledgerSchemaVersion,
      bodySlot: generation.bodySlot,
      ivBase64Url: generation.ivBase64Url,
    },
  };
  return new TextEncoder().encode(JSON.stringify(ordered));
}

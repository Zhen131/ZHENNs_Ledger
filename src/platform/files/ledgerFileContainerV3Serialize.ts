import type { LedgerFileV3S1 } from "./ledgerFileContainerV3";
import {
  LEDGER_FILE_V3_MAGIC,
  LEDGER_FILE_OUTER_V3_CONSTANTS,
} from "./ledgerFileContainerV3";
import { orderedHeader } from "./ledgerFileContainerV3Header";
import { validateLedgerFileV3S1 } from "./ledgerFileContainerV3Parse";

export function serializeLedgerFileV3S1(
  file: LedgerFileV3S1,
): Uint8Array {
  const validation = validateLedgerFileV3S1(file);
  if (!validation.ok) {
    throw new Error("Generated ledger file failed its V3 S-1 contract", {
      cause: validation.errors,
    });
  }

  const currentCiphertext = file.current.ciphertextBytes;
  const previousCiphertext = file.previous?.ciphertextBytes ?? null;
  const header = orderedHeader(
    file,
    currentCiphertext.byteLength,
    previousCiphertext?.byteLength ?? null,
  );
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  if (
    headerBytes.byteLength === 0 ||
    headerBytes.byteLength >
      LEDGER_FILE_OUTER_V3_CONSTANTS.maximumHeaderBytes
  ) {
    throw new Error("Ledger file V3 header exceeds its byte limit");
  }

  const byteLength =
    LEDGER_FILE_V3_MAGIC.byteLength +
    LEDGER_FILE_OUTER_V3_CONSTANTS.headerLengthBytes +
    headerBytes.byteLength +
    currentCiphertext.byteLength +
    (previousCiphertext?.byteLength ?? 0);
  if (byteLength > LEDGER_FILE_OUTER_V3_CONSTANTS.maximumFileBytes) {
    throw new Error("Ledger file V3 exceeds its outer byte limit");
  }

  const bytes = new Uint8Array(byteLength);
  bytes.set(LEDGER_FILE_V3_MAGIC, 0);
  new DataView(bytes.buffer).setUint32(
    LEDGER_FILE_V3_MAGIC.byteLength,
    headerBytes.byteLength,
    true,
  );
  let offset =
    LEDGER_FILE_V3_MAGIC.byteLength +
    LEDGER_FILE_OUTER_V3_CONSTANTS.headerLengthBytes;
  bytes.set(headerBytes, offset);
  offset += headerBytes.byteLength;
  bytes.set(currentCiphertext, offset);
  offset += currentCiphertext.byteLength;
  if (previousCiphertext) {
    bytes.set(previousCiphertext, offset);
  }
  return bytes;
}

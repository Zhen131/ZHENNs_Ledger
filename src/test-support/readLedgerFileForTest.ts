import {
  isLedgerFileV3Bytes,
  LEDGER_FILE_OUTER_V3_CONSTANTS,
  LEDGER_FILE_V3_MAGIC,
  parseLedgerFileV3S1,
  type EncryptedLedgerGenerationV3S1,
  type EncryptedLedgerGenerationV4,
  type LedgerFileContractError,
  type LedgerFileCrypto,
  type LedgerFileV2,
  type LedgerFileV3S1,
  validateLedgerFileV2,
  validateLedgerFileV3S1,
} from "@/platform/files";
import {
  base64UrlToBytes,
  bytesToBase64Url,
} from "@/platform/encryption";

type LedgerFileV3ForTest = Omit<
  LedgerFileV3S1,
  "current" | "previous"
> & {
  current: EncryptedLedgerGenerationV4;
  previous: EncryptedLedgerGenerationV4 | null;
};

export type LedgerFileForTest = LedgerFileV2 | LedgerFileV3ForTest;

export type LedgerFileForTestValidationResult =
  | { ok: true; value: LedgerFileForTest }
  | { ok: false; errors: LedgerFileContractError[] };

/** Centralizes format-dependent inspection of current product files. */
export function readLedgerFileForTest(
  input: string | Uint8Array,
): LedgerFileForTest {
  const bytes = ledgerFileTestInputToBytes(input);
  if (isLedgerFileV3Bytes(bytes)) {
    const parsed = parseLedgerFileV3S1(bytes);
    if (!parsed.ok) {
      throw new Error("Test ledger file failed the V3 contract", {
        cause: parsed.errors,
      });
    }
    return toTestLedgerFileV3(parsed.value);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch (error) {
    throw new Error("Test ledger file is not valid JSON", {
      cause: error,
    });
  }
  const validated = validateLedgerFileV2(parsed);
  if (!validated.ok) {
    throw new Error("Test ledger file failed the V2 contract", {
      cause: validated.errors,
    });
  }
  return validated.value;
}

export function validateLedgerFileForTest(
  input: unknown,
): LedgerFileForTestValidationResult {
  if (
    typeof input === "object" &&
    input !== null &&
    "fileFormatVersion" in input &&
    input.fileFormatVersion === 3
  ) {
    try {
      const validated = validateLedgerFileV3S1(
        toProductLedgerFileV3(input as LedgerFileV3ForTest),
      );
      return validated.ok
        ? { ok: true, value: toTestLedgerFileV3(validated.value) }
        : validated;
    } catch (error) {
      return {
        ok: false,
        errors: [
          {
            code: "LEDGER_FILE_INVALID_ENCODING",
            path: "ciphertextBytes",
            message: "Test V3 ciphertext is not canonical Base64URL",
            cause: error,
          },
        ],
      };
    }
  }
  return validateLedgerFileV2(input);
}

export function serializeLedgerFileForTest(
  file: LedgerFileForTest,
): string {
  if (file.fileFormatVersion === 3) {
    return ledgerFileBytesToTestString(serializeLedgerFileV3ForTest(file));
  }
  return JSON.stringify(file);
}

function serializeLedgerFileV3ForTest(file: LedgerFileV3ForTest): Uint8Array {
  const currentCiphertext = base64UrlToBytes(
    file.current.ciphertextBase64Url,
  );
  const previousCiphertext = file.previous
    ? base64UrlToBytes(file.previous.ciphertextBase64Url)
    : null;
  const generationHeader = (
    generation: LedgerFileV3ForTest["current"],
    ciphertextByteLength: number,
  ) => ({
    revisionId: generation.revisionId,
    parentRevisionId: generation.parentRevisionId,
    ledgerSchemaVersion: generation.ledgerSchemaVersion,
    ivBase64Url: generation.ivBase64Url,
    ciphertextByteLength,
  });
  const header = {
    fileFormatVersion: file.fileFormatVersion,
    cryptoVersion: file.cryptoVersion,
    ledgerSchemaVersion: file.ledgerSchemaVersion,
    backupFormatVersion: file.backupFormatVersion,
    fileId: file.fileId,
    crypto: file.crypto,
    current: generationHeader(file.current, currentCiphertext.byteLength),
    previous:
      file.previous && previousCiphertext
        ? generationHeader(file.previous, previousCiphertext.byteLength)
        : null,
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const prefixBytes =
    LEDGER_FILE_V3_MAGIC.byteLength +
    LEDGER_FILE_OUTER_V3_CONSTANTS.headerLengthBytes;
  const bytes = new Uint8Array(
    prefixBytes +
      headerBytes.byteLength +
      currentCiphertext.byteLength +
      (previousCiphertext?.byteLength ?? 0),
  );
  bytes.set(LEDGER_FILE_V3_MAGIC, 0);
  new DataView(bytes.buffer).setUint32(
    LEDGER_FILE_V3_MAGIC.byteLength,
    headerBytes.byteLength,
    true,
  );
  let offset = prefixBytes;
  bytes.set(headerBytes, offset);
  offset += headerBytes.byteLength;
  bytes.set(currentCiphertext, offset);
  offset += currentCiphertext.byteLength;
  if (previousCiphertext) bytes.set(previousCiphertext, offset);
  return bytes;
}

export function encryptLedgerFileGenerationForTest(
  crypto: LedgerFileCrypto,
  file: LedgerFileForTest,
  revision: {
    revisionId: string;
    parentRevisionId: string | null;
    ledgerSchemaVersion: 4;
  },
  serializedPayload: string,
) {
  if (file.fileFormatVersion === 3) {
    return crypto.encryptGenerationV3S1(
        file.fileId,
        revision,
        serializedPayload,
      ).then(toTestGenerationV3);
  }
  return crypto.encryptGeneration(
        file.fileId,
        revision,
        serializedPayload,
      );
}

export function decryptLedgerFileGenerationForTest(
  crypto: LedgerFileCrypto,
  file: LedgerFileForTest,
  generation: LedgerFileForTest["current"],
) {
  return file.fileFormatVersion === 3
    ? crypto.decryptGenerationV3S1(
        file.fileId,
        toProductGenerationV3(generation),
      )
    : crypto.decryptGeneration(
        file.fileId,
        generation as EncryptedLedgerGenerationV4,
      );
}

function toTestLedgerFileV3(file: LedgerFileV3S1): LedgerFileV3ForTest {
  return {
    ...file,
    current: toTestGenerationV3(file.current),
    previous: file.previous ? toTestGenerationV3(file.previous) : null,
  };
}

function toProductLedgerFileV3(file: LedgerFileV3ForTest): LedgerFileV3S1 {
  return {
    ...file,
    current: toProductGenerationV3(file.current),
    previous: file.previous ? toProductGenerationV3(file.previous) : null,
  };
}

function toTestGenerationV3(
  generation: EncryptedLedgerGenerationV3S1,
): EncryptedLedgerGenerationV4 {
  return {
    revisionId: generation.revisionId,
    parentRevisionId: generation.parentRevisionId,
    ledgerSchemaVersion: generation.ledgerSchemaVersion,
    ivBase64Url: generation.ivBase64Url,
    ciphertextBase64Url: bytesToBase64Url(generation.ciphertextBytes),
  };
}

function toProductGenerationV3(
  generation: EncryptedLedgerGenerationV4,
): EncryptedLedgerGenerationV3S1 {
  return {
    revisionId: generation.revisionId,
    parentRevisionId: generation.parentRevisionId,
    ledgerSchemaVersion: generation.ledgerSchemaVersion,
    ivBase64Url: generation.ivBase64Url,
    ciphertextBytes: base64UrlToBytes(generation.ciphertextBase64Url),
  };
}

export function ledgerFileWritableDataToBytes(
  data: string | Uint8Array,
): Uint8Array {
  return typeof data === "string"
    ? new TextEncoder().encode(data)
    : Uint8Array.from(data);
}

export function ledgerFileBytesToTestString(bytes: Uint8Array): string {
  if (!isLedgerFileV3Bytes(bytes)) {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 8_192) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + 8_192)),
    );
  }
  return chunks.join("");
}

export function ledgerFileTestStringToBytes(value: string): Uint8Array {
  if (!value.startsWith("LFTL3\r\n\0")) {
    return new TextEncoder().encode(value);
  }
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

export function readLedgerFileJsonHeaderForTest(
  input: string | Uint8Array,
): string {
  const bytes = ledgerFileTestInputToBytes(input);
  if (!isLedgerFileV3Bytes(bytes)) {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  const headerLength = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(LEDGER_FILE_V3_MAGIC.byteLength, true);
  const headerStart =
    LEDGER_FILE_V3_MAGIC.byteLength +
    LEDGER_FILE_OUTER_V3_CONSTANTS.headerLengthBytes;
  return new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(headerStart, headerStart + headerLength),
  );
}

export function appendLedgerFileJsonWhitespaceForTest(
  input: string | Uint8Array,
): string {
  const bytes = ledgerFileTestInputToBytes(input);
  if (!isLedgerFileV3Bytes(bytes)) {
    return `${new TextDecoder("utf-8", { fatal: true }).decode(bytes)}\n`;
  }
  const headerLength = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(LEDGER_FILE_V3_MAGIC.byteLength, true);
  const headerStart =
    LEDGER_FILE_V3_MAGIC.byteLength +
    LEDGER_FILE_OUTER_V3_CONSTANTS.headerLengthBytes;
  const bodyStart = headerStart + headerLength;
  const changed = new Uint8Array(bytes.byteLength + 1);
  changed.set(bytes.subarray(0, bodyStart), 0);
  changed[bodyStart] = 0x0a;
  changed.set(bytes.subarray(bodyStart), bodyStart + 1);
  new DataView(changed.buffer).setUint32(
    LEDGER_FILE_V3_MAGIC.byteLength,
    headerLength + 1,
    true,
  );
  return ledgerFileBytesToTestString(changed);
}

function ledgerFileTestInputToBytes(
  input: string | Uint8Array,
): Uint8Array {
  return typeof input === "string"
    ? ledgerFileTestStringToBytes(input)
    : Uint8Array.from(input);
}

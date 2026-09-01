import {
  isLedgerFileV3Bytes,
  isLedgerFileV3S2Bytes,
  LEDGER_FILE_BODY_SLOT_COUNT,
  LEDGER_FILE_HEADER_SLOT_BYTES,
  LEDGER_FILE_V3_MAGIC,
  ledgerFileHeaderSlotOffsetV3S2,
  ledgerFileBodySlotOffsetV3S2,
  parseLedgerFileV3S2,
  readLedgerFileHeaderJsonV3S2,
  type EncryptedLedgerGenerationV3S2,
  type EncryptedLedgerGenerationV4,
  type LedgerFileContractError,
  type LedgerFileCrypto,
  type LedgerFileV2,
  type LedgerFileV3S2,
  validateLedgerFileV2,
  validateLedgerFileV3S2,
} from "@/platform/files";
import {
  base64UrlToBytes,
  bytesToBase64Url,
} from "@/platform/encryption";

type LedgerFileV3ForTest = Omit<
  LedgerFileV3S2,
  "current" | "previous"
> & {
  current: EncryptedLedgerGenerationV3ForTest;
  previous: EncryptedLedgerGenerationV3ForTest | null;
};

type EncryptedLedgerGenerationV3ForTest =
  EncryptedLedgerGenerationV4 & {
    bodySlot?: EncryptedLedgerGenerationV3S2["bodySlot"];
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
  if (isLedgerFileV3S2Bytes(bytes)) {
    const parsed = parseLedgerFileV3S2(bytes);
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
      const validated = validateLedgerFileV3S2(
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
  const product = toProductLedgerFileV3(file);
  const header = {
    fileFormatVersion: product.fileFormatVersion,
    cryptoVersion: product.cryptoVersion,
    ledgerSchemaVersion: product.ledgerSchemaVersion,
    backupFormatVersion: product.backupFormatVersion,
    fileId: product.fileId,
    sequence: product.sequence,
    crypto: product.crypto,
    bodySlotBytes: product.bodySlotBytes,
    bodySlotCount: product.bodySlotCount,
    current: generationHeaderForTest(product.current),
    previous: product.previous
      ? generationHeaderForTest(product.previous)
      : null,
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const prefixBytes = LEDGER_FILE_V3_MAGIC.byteLength + 8;
  const bytes = new Uint8Array(
    prefixBytes +
      LEDGER_FILE_HEADER_SLOT_BYTES * 2 +
      product.bodySlotBytes * LEDGER_FILE_BODY_SLOT_COUNT,
  );
  bytes.set(LEDGER_FILE_V3_MAGIC);
  const view = new DataView(bytes.buffer);
  view.setUint32(
    LEDGER_FILE_V3_MAGIC.byteLength,
    LEDGER_FILE_HEADER_SLOT_BYTES,
    true,
  );
  view.setUint32(
    LEDGER_FILE_V3_MAGIC.byteLength + 4,
    product.bodySlotBytes,
    true,
  );
  const headerStart = ledgerFileHeaderSlotOffsetV3S2(
    product.activeHeaderSlot,
  );
  view.setUint32(headerStart, headerBytes.byteLength, true);
  bytes.set(headerBytes, headerStart + 4);
  bytes.set(
    product.current.ciphertextBytes,
    ledgerFileBodySlotOffsetV3S2(
      product.bodySlotBytes,
      product.current.bodySlot,
    ),
  );
  if (product.previous) {
    bytes.set(
      product.previous.ciphertextBytes,
      ledgerFileBodySlotOffsetV3S2(
        product.bodySlotBytes,
        product.previous.bodySlot,
      ),
    );
  }
  return bytes;
}

function generationHeaderForTest(
  generation: EncryptedLedgerGenerationV3S2,
) {
  return {
    revisionId: generation.revisionId,
    parentRevisionId: generation.parentRevisionId,
    ledgerSchemaVersion: generation.ledgerSchemaVersion,
    bodySlot: generation.bodySlot,
    ivBase64Url: generation.ivBase64Url,
    ciphertextByteLength: generation.ciphertextBytes.byteLength,
  };
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
    const bodySlot =
      file.current.revisionId === revision.revisionId
        ? file.current.bodySlot ?? 0
        : file.previous?.revisionId === revision.revisionId
          ? file.previous.bodySlot ?? 1
          : file.current.bodySlot ?? 0;
    return crypto.encryptGenerationV3S2(
        file.fileId,
        { ...revision, bodySlot },
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
    ? crypto.decryptGenerationV3S2(
        file.fileId,
        toProductGenerationV3(
          generation as EncryptedLedgerGenerationV3ForTest,
          generation === file.previous
            ? file.previous?.bodySlot ?? 1
            : file.current.bodySlot ?? 0,
        ),
      )
    : crypto.decryptGeneration(
        file.fileId,
        generation as EncryptedLedgerGenerationV4,
      );
}

function toTestLedgerFileV3(file: LedgerFileV3S2): LedgerFileV3ForTest {
  return {
    ...file,
    current: toTestGenerationV3(file.current),
    previous: file.previous ? toTestGenerationV3(file.previous) : null,
  };
}

function toProductLedgerFileV3(file: LedgerFileV3ForTest): LedgerFileV3S2 {
  const currentBodySlot = file.current.bodySlot ?? 0;
  return {
    ...file,
    current: toProductGenerationV3(file.current, currentBodySlot),
    previous: file.previous
      ? toProductGenerationV3(
          file.previous,
          file.previous.bodySlot ?? (currentBodySlot === 0 ? 1 : 0),
        )
      : null,
  };
}

function toTestGenerationV3(
  generation: EncryptedLedgerGenerationV3S2,
): EncryptedLedgerGenerationV3ForTest {
  return {
    revisionId: generation.revisionId,
    parentRevisionId: generation.parentRevisionId,
    ledgerSchemaVersion: generation.ledgerSchemaVersion,
    bodySlot: generation.bodySlot,
    ivBase64Url: generation.ivBase64Url,
    ciphertextBase64Url: bytesToBase64Url(generation.ciphertextBytes),
  };
}

function toProductGenerationV3(
  generation: EncryptedLedgerGenerationV3ForTest,
  bodySlot: EncryptedLedgerGenerationV3S2["bodySlot"],
): EncryptedLedgerGenerationV3S2 {
  return {
    revisionId: generation.revisionId,
    parentRevisionId: generation.parentRevisionId,
    ledgerSchemaVersion: generation.ledgerSchemaVersion,
    bodySlot,
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
  const file = readLedgerFileForTest(bytes);
  if (file.fileFormatVersion !== 3) {
    throw new Error("Expected a V3 ledger file test header");
  }
  return readLedgerFileHeaderJsonV3S2(bytes, file.activeHeaderSlot);
}

export function appendLedgerFileJsonWhitespaceForTest(
  input: string | Uint8Array,
): string {
  const bytes = ledgerFileTestInputToBytes(input);
  if (!isLedgerFileV3Bytes(bytes)) {
    return `${new TextDecoder("utf-8", { fatal: true }).decode(bytes)}\n`;
  }
  const file = readLedgerFileForTest(bytes);
  if (file.fileFormatVersion !== 3) {
    throw new Error("Expected a V3 ledger file test header");
  }
  const header = readLedgerFileHeaderJsonV3S2(
    bytes,
    file.activeHeaderSlot,
  );
  const headerBytes = new TextEncoder().encode(`${header}\n`);
  const headerStart = ledgerFileHeaderSlotOffsetV3S2(
    file.activeHeaderSlot,
  );
  const changed = Uint8Array.from(bytes);
  changed.fill(
    0,
    headerStart,
    headerStart + LEDGER_FILE_HEADER_SLOT_BYTES,
  );
  new DataView(changed.buffer).setUint32(
    headerStart,
    headerBytes.byteLength,
    true,
  );
  changed.set(headerBytes, headerStart + Uint32Array.BYTES_PER_ELEMENT);
  return ledgerFileBytesToTestString(changed);
}

function ledgerFileTestInputToBytes(
  input: string | Uint8Array,
): Uint8Array {
  return typeof input === "string"
    ? ledgerFileTestStringToBytes(input)
    : Uint8Array.from(input);
}

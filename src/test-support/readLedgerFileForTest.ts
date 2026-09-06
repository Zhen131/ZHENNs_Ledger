import {
  createLedgerFileManifestAadV3S3,
  isLedgerFileV3Bytes,
  isLedgerFileV3S2Bytes,
  ledgerFileBodySlotOffsetV3S2,
  ledgerFileBodySlotOffsetV3S3,
  ledgerFileHeaderSlotOffsetV3S2,
  ledgerFileHeaderSlotOffsetV3S3,
  LEDGER_FILE_BODY_SLOT_COUNT,
  LEDGER_FILE_HEADER_SLOT_BYTES,
  LEDGER_FILE_V3_MAGIC,
  LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
  LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES,
  LEDGER_FILE_V3_S3_MANIFEST_TAG_BYTES,
  mergeBlockPayloadsV3S3,
  parseLedgerBlockPayloadV3S3,
  parseLedgerFileV3S2,
  parseLedgerFileV3S3Candidates,
  readLedgerFileHeaderJsonV3S2,
  type EncryptedLedgerBlockV3S3,
  type EncryptedLedgerGenerationV3S2,
  type EncryptedLedgerGenerationV4,
  type LedgerFileContractError,
  type LedgerFileCrypto,
  type LedgerFileCryptoV2,
  type LedgerFileV2,
  type LedgerFileV3S2,
  type LedgerFileV3S3,
  type LedgerGenerationV3S3,
  validateLedgerFileV2,
  validateLedgerFileV3S2,
  validateLedgerFileV3S3,
} from "@/platform/files";
import {
  base64UrlToBytes,
  bytesToBase64Url,
} from "@/platform/encryption";

const V3_S3_FILE_SOURCE = Symbol("v3-s3-file-source");
const V3_S3_GENERATION_SOURCE = Symbol("v3-s3-generation-source");
const TEST_BINARY_STRING_CACHE_LIMIT = 8;
const testBinaryStringBytes = new Map<string, Uint8Array>();

type V3S3FileSource = {
  file: LedgerFileV3S3;
  bytes: Uint8Array;
};

type V3S3GenerationSource = {
  generation: LedgerGenerationV3S3;
  sealedFile?: LedgerFileV3S3;
};

type LedgerFileV3ForTest = {
  fileFormatVersion: 3;
  cryptoVersion: 1;
  ledgerSchemaVersion: 5;
  backupFormatVersion: 3;
  fileId: string;
  sequence: number;
  activeHeaderSlot: 0 | 1;
  bodySlotBytes: number;
  bodySlotCount: number;
  crypto: LedgerFileCryptoV2;
  current: EncryptedLedgerGenerationV3ForTest;
  previous: EncryptedLedgerGenerationV3ForTest | null;
  recordsPerBlock?: number;
  manifestAuthIvBase64Url?: string;
  [V3_S3_FILE_SOURCE]?: V3S3FileSource;
};

type EncryptedLedgerGenerationV3ForTest =
  EncryptedLedgerGenerationV4 & {
    bodySlot?: EncryptedLedgerGenerationV3S2["bodySlot"] | number;
    [V3_S3_GENERATION_SOURCE]?: V3S3GenerationSource;
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
    const chunked = parseLedgerFileV3S3Candidates(bytes);
    if (chunked.ok) {
      const selected = chunked.value.candidates
        .filter(({ referencedPaddingIsZero }) => referencedPaddingIsZero)
        .sort((left, right) => right.file.sequence - left.file.sequence)[0];
      if (selected) return toTestLedgerFileV3S3(selected.file, bytes);
    }
    const slotted = parseLedgerFileV3S2(bytes);
    if (!slotted.ok) {
      throw new Error("Test ledger file failed the V3 contract", {
        cause: [...(chunked.ok ? [] : chunked.errors), ...slotted.errors],
      });
    }
    return toTestLedgerFileV3S2(slotted.value);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch (error) {
    throw new Error("Test ledger file is not valid JSON", { cause: error });
  }
  const validated = validateLedgerFileV2(parsed);
  if (!validated.ok) {
    throw new Error("Test ledger file failed the V2 contract", {
      cause: validated.errors,
    });
  }
  return validated.value;
}

/**
 * Preserves S-2 slot assertions while current product output uses S-3 blocks.
 * The compatibility view maps each logical generation to its independently
 * authenticated control block; it never participates in product parsing.
 */
export function readLedgerFileSlotViewForTest(
  input: string | Uint8Array,
) {
  const file = readLedgerFileForTest(input);
  if (file.fileFormatVersion !== 3) {
    return {
      ok: false as const,
      errors: [
        {
          code: "LEDGER_FILE_UNSUPPORTED_VERSION" as const,
          path: "fileFormatVersion",
          message: "Expected a V3 slot-backed test file",
        },
      ],
    };
  }
  const source = file[V3_S3_FILE_SOURCE];
  if (!source) {
    return parseLedgerFileV3S2(ledgerFileTestInputToBytes(input));
  }
  const current = source.file.current.controlBlock;
  const previous = source.file.previous?.controlBlock ?? null;
  return {
    ok: true as const,
    value: {
      fileFormatVersion: 3 as const,
      cryptoVersion: 1 as const,
      ledgerSchemaVersion: 5 as const,
      backupFormatVersion: 3 as const,
      fileId: source.file.fileId,
      sequence: source.file.sequence,
      activeHeaderSlot: source.file.activeHeaderSlot,
      bodySlotBytes: source.file.bodySlotBytes,
      bodySlotCount: 3 as const,
      crypto: source.file.crypto,
      current: {
        revisionId: source.file.current.revisionId,
        parentRevisionId: source.file.current.parentRevisionId,
        ledgerSchemaVersion: 5 as const,
        bodySlot: current.bodySlots[0] as 0 | 1 | 2,
        ivBase64Url: current.ivBase64Url,
        ciphertextBytes: current.ciphertextBytes,
      },
      previous: source.file.previous && previous
        ? {
            revisionId: source.file.previous.revisionId,
            parentRevisionId: source.file.previous.parentRevisionId,
            ledgerSchemaVersion: 5 as const,
            bodySlot: previous.bodySlots[0] as 0 | 1 | 2,
            ivBase64Url: previous.ivBase64Url,
            ciphertextBytes: previous.ciphertextBytes,
          }
        : null,
    },
  };
}

export function readLedgerFileBodySlotForTest(
  input: string | Uint8Array,
  slot: number,
): Uint8Array {
  const bytes = ledgerFileTestInputToBytes(input);
  const file = readLedgerFileForTest(bytes);
  if (file.fileFormatVersion === 3 && file[V3_S3_FILE_SOURCE]) {
    const offset = ledgerFileBodySlotOffsetV3S3(slot);
    return Uint8Array.from(
      bytes.subarray(offset, offset + LEDGER_FILE_V3_S3_BODY_SLOT_BYTES),
    );
  }
  if (file.fileFormatVersion === 3) {
    const offset = ledgerFileBodySlotOffsetV3S2(
      file.bodySlotBytes,
      slot as 0 | 1 | 2,
    );
    return Uint8Array.from(
      bytes.subarray(offset, offset + file.bodySlotBytes),
    );
  }
  throw new Error("Expected a V3 body-slot test file");
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
    const file = input as LedgerFileV3ForTest;
    try {
      if (file[V3_S3_FILE_SOURCE]) {
        const product = toProductLedgerFileV3S3(file);
        const validated = validateLedgerFileV3S3(product);
        return validated.ok
          ? {
              ok: true,
              value: toTestLedgerFileV3S3(
                product,
                unsafeSerializeV3S3(product),
              ),
            }
          : validated;
      }
      const validated = validateLedgerFileV3S2(
        toProductLedgerFileV3S2(file),
      );
      return validated.ok
        ? { ok: true, value: toTestLedgerFileV3S2(validated.value) }
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
    const source = file[V3_S3_FILE_SOURCE];
    return ledgerFileBytesToTestString(
      source
        ? unsafeSerializeV3S3(toProductLedgerFileV3S3(file))
        : serializeLedgerFileV3S2ForTest(file),
    );
  }
  return JSON.stringify(file);
}

export async function encryptLedgerFileGenerationForTest(
  crypto: LedgerFileCrypto,
  file: LedgerFileForTest,
  revision: {
    revisionId: string;
    parentRevisionId: string | null;
    ledgerSchemaVersion: 5;
  },
  serializedPayload: string,
) {
  if (file.fileFormatVersion === 3 && file[V3_S3_FILE_SOURCE]) {
    const product = toProductLedgerFileV3S3(file);
    const targetPrevious =
      product.previous?.revisionId === revision.revisionId;
    const target = targetPrevious ? product.previous! : product.current;
    const currentPlaintext = await decryptLedgerFileGenerationForTest(
      crypto,
      file,
      targetPrevious ? file.previous! : file.current,
    );
    let generation: LedgerGenerationV3S3;
    if (serializedPayload === currentPlaintext) {
      const controlBlock = await reencryptBlockV3S3(
        crypto,
        product.fileId,
        target.controlBlock,
      );
      const factBlocks = target.factBlocks;
      generation = { ...target, ...revision, controlBlock, factBlocks };
    } else {
      const plaintextByteLength = new TextEncoder().encode(
        serializedPayload,
      ).byteLength;
      const controlBlock = await crypto.encryptBlockV3S3(
        product.fileId,
        {
          ...blockMetadataForReencryption(target.controlBlock),
          plaintextByteLength,
        },
        serializedPayload,
      );
      generation = { ...target, ...revision, controlBlock };
    }
    let sealedFile: LedgerFileV3S3 = {
      ...product,
      manifestAuthIvBase64Url: crypto.createIvBase64UrlV3S3(),
      manifestAuthTagBytes: new Uint8Array(16),
      current: targetPrevious ? product.current : generation,
      previous: targetPrevious ? generation : product.previous,
    };
    sealedFile = {
      ...sealedFile,
      manifestAuthTagBytes:
        await crypto.authenticateManifestV3S3(sealedFile),
    };
    return toTestGenerationV3S3(generation, sealedFile);
  }
  if (file.fileFormatVersion === 3) {
    const bodySlot =
      file.current.revisionId === revision.revisionId
        ? file.current.bodySlot ?? 0
        : file.previous?.revisionId === revision.revisionId
          ? file.previous.bodySlot ?? 1
          : file.current.bodySlot ?? 0;
    return crypto
      .encryptGenerationV3S2(
        file.fileId,
        { ...revision, bodySlot: bodySlot as 0 | 1 | 2 },
        serializedPayload,
      )
      .then(toTestGenerationV3S2);
  }
  return crypto.encryptGeneration(file.fileId, revision, serializedPayload);
}

export async function decryptLedgerFileGenerationForTest(
  crypto: LedgerFileCrypto,
  file: LedgerFileForTest,
  generation: LedgerFileForTest["current"],
): Promise<string> {
  if (file.fileFormatVersion === 3 && file[V3_S3_FILE_SOURCE]) {
    const source = (generation as EncryptedLedgerGenerationV3ForTest)[
      V3_S3_GENERATION_SOURCE
    ];
    if (!source) throw new Error("Missing V3 S-3 generation test source");
    const control = parseLedgerBlockPayloadV3S3(
      await crypto.decryptBlockV3S3(
        file.fileId,
        source.generation.controlBlock,
      ),
      "control",
      source.generation.controlBlock.recordCount,
    );
    const facts = [];
    for (const block of source.generation.factBlocks) {
      facts.push(
        parseLedgerBlockPayloadV3S3(
          await crypto.decryptBlockV3S3(file.fileId, block),
          "facts",
          block.recordCount,
        ),
      );
    }
    return mergeBlockPayloadsV3S3(control, facts).serializedPayload;
  }
  if (file.fileFormatVersion === 3) {
    return crypto.decryptGenerationV3S2(
      file.fileId,
      toProductGenerationV3S2(
        generation as EncryptedLedgerGenerationV3ForTest,
        generation === file.previous
          ? ((file.previous?.bodySlot ?? 1) as 0 | 1 | 2)
          : ((file.current.bodySlot ?? 0) as 0 | 1 | 2),
      ),
    );
  }
  return crypto.decryptGeneration(
    file.fileId,
    generation as EncryptedLedgerGenerationV4,
  );
}

function toTestLedgerFileV3S3(
  file: LedgerFileV3S3,
  bytes: Uint8Array,
): LedgerFileV3ForTest {
  return {
    fileFormatVersion: 3,
    cryptoVersion: 1,
    ledgerSchemaVersion: 5,
    backupFormatVersion: 3,
    fileId: file.fileId,
    sequence: file.sequence,
    activeHeaderSlot: file.activeHeaderSlot,
    bodySlotBytes: file.bodySlotBytes,
    bodySlotCount: file.bodySlotCount,
    recordsPerBlock: file.recordsPerBlock,
    manifestAuthIvBase64Url: file.manifestAuthIvBase64Url,
    crypto: file.crypto,
    current: toTestGenerationV3S3(file.current),
    previous: file.previous
      ? toTestGenerationV3S3(file.previous)
      : null,
    [V3_S3_FILE_SOURCE]: { file, bytes: Uint8Array.from(bytes) },
  };
}

function toTestGenerationV3S3(
  generation: LedgerGenerationV3S3,
  sealedFile?: LedgerFileV3S3,
): EncryptedLedgerGenerationV3ForTest {
  const control = generation.controlBlock;
  return {
    revisionId: generation.revisionId,
    parentRevisionId: generation.parentRevisionId,
    ledgerSchemaVersion: 5,
    bodySlot: control.bodySlots[0],
    ivBase64Url: control.ivBase64Url,
    ciphertextBase64Url: bytesToBase64Url(control.ciphertextBytes),
    [V3_S3_GENERATION_SOURCE]: { generation, sealedFile },
  };
}

function toProductLedgerFileV3S3(
  file: LedgerFileV3ForTest,
): LedgerFileV3S3 {
  const source = file[V3_S3_FILE_SOURCE];
  if (!source) throw new Error("Missing V3 S-3 file test source");
  const sealedOverride =
    file.current[V3_S3_GENERATION_SOURCE]?.sealedFile ??
    file.previous?.[V3_S3_GENERATION_SOURCE]?.sealedFile;
  const base = sealedOverride ?? source.file;
  return {
    ...base,
    fileId: file.fileId,
    sequence: file.sequence,
    activeHeaderSlot: file.activeHeaderSlot,
    bodySlotCount: file.bodySlotCount,
    crypto: file.crypto,
    manifestAuthIvBase64Url:
      sealedOverride &&
      file.manifestAuthIvBase64Url === source.file.manifestAuthIvBase64Url
        ? sealedOverride.manifestAuthIvBase64Url
        : file.manifestAuthIvBase64Url ?? base.manifestAuthIvBase64Url,
    current: applyTestGenerationV3S3(base.current, file.current),
    previous: file.previous
      ? applyTestGenerationV3S3(
          base.previous ??
            file.previous[V3_S3_GENERATION_SOURCE]!.generation,
          file.previous,
        )
      : null,
  };
}

function applyTestGenerationV3S3(
  fallback: LedgerGenerationV3S3,
  test: EncryptedLedgerGenerationV3ForTest,
): LedgerGenerationV3S3 {
  const source = test[V3_S3_GENERATION_SOURCE]?.generation ?? fallback;
  const supplied = base64UrlToBytes(test.ciphertextBase64Url);
  const original = source.controlBlock.ciphertextBytes;
  let ciphertextBytes = original;
  if (test.ciphertextBase64Url !== bytesToBase64Url(original)) {
    ciphertextBytes = new Uint8Array(original.byteLength);
    for (let index = 0; index < ciphertextBytes.byteLength; index += 1) {
      ciphertextBytes[index] =
        supplied[index % Math.max(supplied.byteLength, 1)] ?? 0;
    }
  }
  return {
    ...source,
    revisionId: test.revisionId,
    parentRevisionId: test.parentRevisionId,
    controlBlock: {
      ...source.controlBlock,
      ivBase64Url: test.ivBase64Url,
      ciphertextBytes,
    },
  };
}

async function reencryptBlockV3S3(
  crypto: LedgerFileCrypto,
  fileId: string,
  block: EncryptedLedgerBlockV3S3,
): Promise<EncryptedLedgerBlockV3S3> {
  const plaintext = await crypto.decryptBlockV3S3(fileId, block);
  return crypto.encryptBlockV3S3(
    fileId,
    blockMetadataForReencryption(block),
    plaintext,
  );
}

function blockMetadataForReencryption(
  block: EncryptedLedgerBlockV3S3,
): Omit<EncryptedLedgerBlockV3S3, "ivBase64Url" | "ciphertextBytes"> {
  return {
    blockId: block.blockId,
    role: block.role,
    order: block.order,
    sealed: block.sealed,
    recordCount: block.recordCount,
    ledgerSchemaVersion: block.ledgerSchemaVersion,
    plaintextByteLength: block.plaintextByteLength,
    bodySlots: [...block.bodySlots],
  };
}

function unsafeSerializeV3S3(
  file: LedgerFileV3S3,
): Uint8Array {
  const byteLength =
    LEDGER_FILE_V3_MAGIC.byteLength +
    8 +
    LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES * 2 +
    file.bodySlotCount * LEDGER_FILE_V3_S3_BODY_SLOT_BYTES;
  const bytes = new Uint8Array(byteLength);
  bytes.set(LEDGER_FILE_V3_MAGIC);
  const view = new DataView(bytes.buffer);
  view.setUint32(
    LEDGER_FILE_V3_MAGIC.byteLength,
    LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES,
    true,
  );
  view.setUint32(
    LEDGER_FILE_V3_MAGIC.byteLength + 4,
    LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
    true,
  );
  const headerBytes = createLedgerFileManifestAadV3S3(file);
  const headerOffset = ledgerFileHeaderSlotOffsetV3S3(
    file.activeHeaderSlot,
  );
  bytes.fill(
    0,
    headerOffset,
    headerOffset + LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES,
  );
  view.setUint32(headerOffset, headerBytes.byteLength, true);
  bytes.set(headerBytes, headerOffset + 4);
  bytes.set(
    file.manifestAuthTagBytes,
    headerOffset +
      LEDGER_FILE_V3_S3_HEADER_SLOT_BYTES -
      LEDGER_FILE_V3_S3_MANIFEST_TAG_BYTES,
  );
  const blocks = new Map<string, EncryptedLedgerBlockV3S3>();
  for (const generation of [file.current, file.previous]) {
    if (!generation) continue;
    for (const block of [generation.controlBlock, ...generation.factBlocks]) {
      blocks.set(JSON.stringify(block.bodySlots), block);
    }
  }
  for (const block of blocks.values()) {
    let copied = 0;
    for (const slot of block.bodySlots) {
      const offset = ledgerFileBodySlotOffsetV3S3(slot);
      bytes.fill(0, offset, offset + LEDGER_FILE_V3_S3_BODY_SLOT_BYTES);
      const take = Math.min(
        LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
        block.ciphertextBytes.byteLength - copied,
      );
      bytes.set(
        block.ciphertextBytes.subarray(copied, copied + take),
        offset,
      );
      copied += take;
    }
  }
  return bytes;
}

function serializeLedgerFileV3S2ForTest(
  file: LedgerFileV3ForTest,
): Uint8Array {
  const product = toProductLedgerFileV3S2(file);
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

function toTestLedgerFileV3S2(file: LedgerFileV3S2): LedgerFileV3ForTest {
  return {
    ...file,
    current: toTestGenerationV3S2(file.current),
    previous: file.previous ? toTestGenerationV3S2(file.previous) : null,
  };
}

function toProductLedgerFileV3S2(
  file: LedgerFileV3ForTest,
): LedgerFileV3S2 {
  const currentBodySlot = (file.current.bodySlot ?? 0) as 0 | 1 | 2;
  return {
    fileFormatVersion: 3,
    cryptoVersion: 1,
    ledgerSchemaVersion: 5,
    backupFormatVersion: 3,
    fileId: file.fileId,
    sequence: file.sequence,
    activeHeaderSlot: file.activeHeaderSlot,
    bodySlotBytes: file.bodySlotBytes,
    bodySlotCount: 3,
    crypto: file.crypto,
    current: toProductGenerationV3S2(file.current, currentBodySlot),
    previous: file.previous
      ? toProductGenerationV3S2(
          file.previous,
          (file.previous.bodySlot ??
            (currentBodySlot === 0 ? 1 : 0)) as 0 | 1 | 2,
        )
      : null,
  };
}

function toTestGenerationV3S2(
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

function toProductGenerationV3S2(
  generation: EncryptedLedgerGenerationV3ForTest,
  bodySlot: 0 | 1 | 2,
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
  const value = chunks.join("");
  testBinaryStringBytes.set(value, Uint8Array.from(bytes));
  while (testBinaryStringBytes.size > TEST_BINARY_STRING_CACHE_LIMIT) {
    testBinaryStringBytes.delete(testBinaryStringBytes.keys().next().value!);
  }
  return value;
}

export function ledgerFileTestStringToBytes(value: string): Uint8Array {
  if (!value.startsWith("LFTL3\r\n\0")) {
    return new TextEncoder().encode(value);
  }
  const cached = testBinaryStringBytes.get(value);
  return cached
    ? Uint8Array.from(cached)
    : Uint8Array.from(value, (character) => character.charCodeAt(0));
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
  const start = ledgerFileHeaderSlotOffsetV3S2(file.activeHeaderSlot);
  const length = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(start, true);
  return new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(start + 4, start + 4 + length),
  );
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
  const header = file[V3_S3_FILE_SOURCE]
    ? readLedgerFileJsonHeaderForTest(bytes)
    : readLedgerFileHeaderJsonV3S2(bytes, file.activeHeaderSlot);
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
  changed.set(headerBytes, headerStart + 4);
  return ledgerFileBytesToTestString(changed);
}

function ledgerFileTestInputToBytes(
  input: string | Uint8Array,
): Uint8Array {
  return typeof input === "string"
    ? ledgerFileTestStringToBytes(input)
    : Uint8Array.from(input);
}

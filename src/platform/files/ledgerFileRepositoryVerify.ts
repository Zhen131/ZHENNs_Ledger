import {
  type CanonicalLedgerPayloadV4,
  SUPPORTED_LEDGER_SCHEMA_VERSION,
} from "./ledgerFileContract";
import {
  isLedgerFileV3S3Bytes,
  type EncryptedLedgerBlockV3S3,
  type LedgerFileV3S3,
  type LedgerGenerationV3S3,
} from "./ledgerFileChunkedContainerV3";
import {
  parseLedgerFileV3S3Candidates,
  validateLedgerFileV3S3,
} from "./ledgerFileChunkedContainerV3Parse";
import {
  serializeLedgerFileV3S3,
} from "./ledgerFileChunkedContainerV3Serialize";
import {
  mergeBlockPayloadsV3S3,
  parseLedgerBlockPayloadV3S3,
  type LedgerBlockPayloadV3S3,
} from "./ledgerFileChunkingV3";
import { LedgerFileCrypto } from "./ledgerFileCrypto";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
  LedgerFileRepositoryError,
} from "./ledgerFileRepositoryContract";
import type {
  VerifiedGeneration,
  VerifiedLedgerFile,
  PendingSaveIntent,
  PendingRecoveryIntent,
} from "./ledgerFileRepositoryIntents";
import {
  sameBytes,
  sameGeneration,
  sameEncryptedBlock,
} from "./ledgerFileRepositoryPayload";
import {
  readReachableBodySlotsV3S3,
  readReachableIvBase64UrlsV3S3,
} from "./ledgerFileRepositoryWrite";

export function expectedFromPending(pending: PendingSaveIntent) {
  return {
    file: pending.file,
    fileId: pending.file.fileId,
    currentRevisionId: pending.file.current.revisionId,
    currentParentRevisionId:
      pending.baseFile.current.revisionId,
    currentGeneration: pending.file.current,
    currentPayload: pending.expectedCurrent,
    currentBlockSerializedPayloads:
      pending.expectedCurrentBlockPayloads,
    reachableBodySlots: pending.expectedReachableBodySlots,
    reachableIvBase64Urls:
      pending.expectedReachableIvBase64Urls,
    previousGeneration: pending.baseFile.current,
    previousPayload: pending.baseCurrent,
    serializedFile: pending.serializedFile,
  };
}

export function expectedFromRecovery(
  pending: PendingRecoveryIntent,
  previousGeneration: LedgerGenerationV3S3,
  previousPayload: VerifiedGeneration,
): VerificationExpectation {
  return {
    file: pending.file,
    fileId: pending.file.fileId,
    currentRevisionId: pending.file.current.revisionId,
    currentParentRevisionId: previousGeneration.revisionId,
    currentGeneration: pending.file.current,
    currentPayload: pending.expectedCurrent,
    currentBlockSerializedPayloads:
      pending.expectedCurrentBlockPayloads,
    reachableBodySlots: pending.expectedReachableBodySlots,
    reachableIvBase64Urls:
      pending.expectedReachableIvBase64Urls,
    previousGeneration,
    previousPayload,
    serializedFile: pending.serializedFile,
  };
}

export async function verifySerializedLedgerFile(
  serialized: Uint8Array,
  crypto: LedgerFileCrypto,
  expected?: VerificationExpectation,
): Promise<VerifiedLedgerFile> {
  const exactExpectedBytes =
    expected !== undefined &&
    sameBytes(serialized, expected.serializedFile);
  return verifyLedgerFile(
    exactExpectedBytes
      ? expected.file
      : parseAndValidateLedgerFile(serialized),
    crypto,
    expected,
    serialized,
    exactExpectedBytes,
  );
}

type VerificationExpectation = {
  file: LedgerFileV3S3;
  fileId: string;
  currentRevisionId: string;
  currentParentRevisionId: string | null;
  currentGeneration: LedgerGenerationV3S3;
  currentPayload: CanonicalLedgerPayloadV4;
  currentBlockSerializedPayloads: ReadonlyMap<string, string> | null;
  reachableBodySlots?: readonly number[];
  reachableIvBase64Urls?: readonly string[];
  previousGeneration: LedgerGenerationV3S3 | null;
  previousPayload: VerifiedGeneration | null;
  serializedFile: Uint8Array;
};

export async function verifyLedgerFile(
  file: LedgerFileV3S3,
  crypto: LedgerFileCrypto,
  expected?: VerificationExpectation,
  serializedFile = serializeLedgerFile(file),
  exactExpectedBytes = false,
): Promise<VerifiedLedgerFile> {
  if (!crypto.matchesCryptoMetadata(file.crypto)) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      "Ledger file crypto metadata does not match the bound session",
    );
  }

  if (expected && file.fileId !== expected.fileId) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.FILE_ID_MISMATCH,
      "Readback fileId does not match the bound ledger file",
    );
  }

  try {
    await crypto.verifyManifestV3S3(file);
  } catch (error) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      "Ledger file manifest could not be authenticated",
      error,
    );
  }

  let current: VerifiedGeneration | null = null;
  let previous: VerifiedGeneration | null = null;
  let currentError: unknown;
  let previousError: unknown;

  try {
    current = await verifyGeneration(
      file,
      file.current,
      crypto,
      expected?.previousPayload ?? undefined,
      expected?.currentBlockSerializedPayloads ?? undefined,
      expected?.currentPayload,
    );
  } catch (error) {
    currentError = error;
  }

  if (file.previous) {
    if (
      expected?.previousGeneration &&
      expected.previousPayload &&
      sameGeneration(file.previous, expected.previousGeneration)
    ) {
      previous = {
        ...expected.previousPayload,
        generation: file.previous,
      };
    } else {
      try {
        previous = await verifyGeneration(file, file.previous, crypto);
      } catch (error) {
        previousError = error;
      }
    }
  }

  if (!current) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      "Current ledger file generation could not be authenticated and validated",
      currentError,
    );
  }

  if (file.previous && !previous) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      "Previous ledger file generation could not be authenticated and validated",
      previousError,
    );
  }

  if (expected) {
    if (
      file.current.revisionId !== expected.currentRevisionId ||
      file.current.parentRevisionId !==
        expected.currentParentRevisionId
    ) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.REVISION_MISMATCH,
        "Readback current revision does not match the save intent",
      );
    }

    if (!sameGeneration(file.current, expected.currentGeneration)) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
        "Readback current generation does not match the exact encrypted save intent",
      );
    }

    if (
      current.serializedPayload !==
        expected.currentPayload.serializedPayload ||
      current.serializedLedgerData !==
        expected.currentPayload.serializedLedgerData
    ) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
        "Readback current payload does not match the save intent",
      );
    }

    if (expected.previousGeneration === null) {
      if (file.previous !== null || previous !== null) {
        throw new LedgerFileRepositoryError(
          LEDGER_FILE_REPOSITORY_ERROR_CODES.REVISION_MISMATCH,
          "Initial ledger file readback unexpectedly contains a previous generation",
        );
      }
    } else if (
      file.previous === null ||
      previous === null ||
      !sameGeneration(file.previous, expected.previousGeneration) ||
      previous.serializedPayload !==
        expected.previousPayload?.serializedPayload ||
      previous.serializedLedgerData !==
        expected.previousPayload.serializedLedgerData
    ) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
        "Readback previous generation is not the unchanged verified base",
      );
    }

    if (
      !exactExpectedBytes &&
      !sameBytes(serializedFile, expected.serializedFile)
    ) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
        "Ledger file readback did not match the exact prepared bytes",
      );
    }
  }

  return {
    file,
    current,
    previous,
    serializedFile,
    reachableBodySlots:
      expected?.reachableBodySlots ??
      readReachableBodySlotsV3S3(serializedFile),
    reachableIvBase64Urls:
      expected?.reachableIvBase64Urls ??
      readReachableIvBase64UrlsV3S3(serializedFile),
  };
}

export async function verifyLedgerFileForOpen(
  file: LedgerFileV3S3,
  serializedFile: Uint8Array,
  crypto: LedgerFileCrypto,
  reachableBodySlots: readonly number[],
  reachableIvBase64Urls: readonly string[],
): Promise<
  | { status: "verified"; verified: VerifiedLedgerFile }
  | {
      status: "recovery-required";
      previous: VerifiedGeneration;
    }
> {
  if (!crypto.matchesCryptoMetadata(file.crypto)) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      "Ledger file crypto metadata does not match the unlock attempt",
    );
  }

  try {
    await crypto.verifyManifestV3S3(file);
  } catch (error) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      "Ledger file manifest could not be authenticated",
      error,
    );
  }

  let current: VerifiedGeneration | null = null;
  let previous: VerifiedGeneration | null = null;
  let currentError: unknown;
  let previousError: unknown;

  try {
    current = await verifyGeneration(file, file.current, crypto);
  } catch (error) {
    currentError = error;
  }
  if (file.previous) {
    try {
      previous = await verifyGeneration(file, file.previous, crypto);
    } catch (error) {
      previousError = error;
    }
  }

  if (!current) {
    if (file.previous && previous) {
      return { status: "recovery-required", previous };
    }
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      "Ledger file generations could not be authenticated and validated",
      currentError ?? previousError,
    );
  }
  if (file.previous && !previous) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      "Ledger file generations could not be authenticated and validated",
      previousError,
    );
  }

  return {
    status: "verified",
    verified: {
      file,
      current,
      previous,
      serializedFile,
      reachableBodySlots,
      reachableIvBase64Urls,
    },
  };
}

async function verifyGeneration(
  file: LedgerFileV3S3,
  generation: LedgerGenerationV3S3,
  crypto: LedgerFileCrypto,
  trusted?: VerifiedGeneration,
  expectedBlockSerializedPayloads?: ReadonlyMap<string, string>,
  expectedPayload?: CanonicalLedgerPayloadV4,
): Promise<VerifiedGeneration> {
  try {
    const generationBlockIds = new Set(
      [generation.controlBlock, ...generation.factBlocks].map(
        (block) => block.blockId,
      ),
    );
    if (
      expectedBlockSerializedPayloads &&
      [...expectedBlockSerializedPayloads.keys()].some(
        (blockId) => !generationBlockIds.has(blockId),
      )
    ) {
      throw new Error(
        "Expected V3 S-3 block payload is outside the generation",
      );
    }
    const blockPayloads = new Map<string, LedgerBlockPayloadV3S3>();
    const control = await readVerifiedBlockPayload(
      file,
      generation.controlBlock,
      crypto,
      trusted,
      expectedBlockSerializedPayloads?.get(
        generation.controlBlock.blockId,
      ),
      expectedBlockSerializedPayloads !== undefined,
    );
    blockPayloads.set(generation.controlBlock.blockId, control);
    const factPayloads: LedgerBlockPayloadV3S3[] = [];
    for (const block of generation.factBlocks) {
      const payload = await readVerifiedBlockPayload(
        file,
        block,
        crypto,
        trusted,
        expectedBlockSerializedPayloads?.get(block.blockId),
        expectedBlockSerializedPayloads !== undefined,
      );
      blockPayloads.set(block.blockId, payload);
      factPayloads.push(payload);
    }
    const payloadResult = expectedPayload ??
      mergeBlockPayloadsV3S3(control, factPayloads);
    return {
      generation,
      payload: payloadResult.value,
      serializedPayload: payloadResult.serializedPayload,
      serializedLedgerData: payloadResult.serializedLedgerData,
      blockPayloads,
    };
  } catch (error) {
    if (error instanceof LedgerFileRepositoryError) throw error;
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Decrypted ledger blocks could not be authenticated and merged",
      error,
    );
  }
}

async function readVerifiedBlockPayload(
  file: LedgerFileV3S3,
  block: EncryptedLedgerBlockV3S3,
  crypto: LedgerFileCrypto,
  trusted?: VerifiedGeneration,
  expectedSerializedPayload?: string,
  expectedPayloadsProvided = false,
): Promise<LedgerBlockPayloadV3S3> {
  const trustedBlock = trusted
    ? [
        trusted.generation.controlBlock,
        ...trusted.generation.factBlocks,
      ].find((candidate) =>
        candidate.blockId === block.blockId &&
        sameEncryptedBlock(candidate, block),
      )
    : undefined;
  const trustedPayload = trustedBlock
    ? trusted?.blockPayloads.get(trustedBlock.blockId)
    : undefined;
  if (trustedPayload) {
    if (
      expectedSerializedPayload !== undefined &&
      JSON.stringify(trustedPayload) !== expectedSerializedPayload
    ) {
      throw new Error(
        `Trusted V3 S-3 block ${block.blockId} does not match the save plan`,
      );
    }
    return trustedPayload;
  }

  if (
    expectedPayloadsProvided &&
    expectedSerializedPayload === undefined
  ) {
    throw new Error(
      `Changed V3 S-3 block ${block.blockId} is missing from the save plan`,
    );
  }

  const plaintext = await crypto.decryptBlockV3S3(file.fileId, block);
  if (
    expectedSerializedPayload !== undefined &&
    plaintext !== expectedSerializedPayload
  ) {
    throw new Error(
      `Authenticated V3 S-3 block ${block.blockId} does not match the save plan`,
    );
  }
  return parseLedgerBlockPayloadV3S3(
    plaintext,
    block.role,
    block.recordCount,
  );
}

export function parseAndValidateLedgerFile(
  serialized: Uint8Array,
): LedgerFileV3S3 {
  const selected = parseAndValidateLedgerFileCandidates(
    serialized,
  ).candidates.find(({ referencedPaddingIsZero }) =>
    referencedPaddingIsZero,
  );
  if (!selected) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file has no unique complete V3 S-3 header candidate",
    );
  }
  return selected.file;
}

export function parseAndValidateLedgerFileCandidates(
  serialized: Uint8Array,
): {
  candidates: Array<{
    file: LedgerFileV3S3;
    referencedPaddingIsZero: boolean;
  }>;
  reachableBodySlots: number[];
} {
  if (!isLedgerFileV3S3Bytes(serialized)) {
    rejectUnsupportedJsonLedgerFile(serialized);
  }
  const parsed = parseLedgerFileV3S3Candidates(serialized);
  if (!parsed.ok) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file failed the strict V3 S-3 chunked container contract",
      parsed.errors,
    );
  }
  const candidates = parsed.value.candidates
    .sort((left, right) => right.file.sequence - left.file.sequence);
  if (
    !candidates.some(({ referencedPaddingIsZero }) =>
      referencedPaddingIsZero,
    ) ||
    (candidates[1] && candidates[1].file.sequence === candidates[0]!.file.sequence)
  ) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file has no unique complete V3 S-3 header candidate",
    );
  }
  return {
    candidates,
    reachableBodySlots: parsed.value.reachableBodySlots,
  };
}

export function assertValidLedgerFile(file: LedgerFileV3S3): void {
  const validation = validateLedgerFileV3S3(file);
  if (!validation.ok) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Generated ledger file failed its own V3 S-3 contract",
      validation.errors,
    );
  }
}

export function serializeLedgerFile(file: LedgerFileV3S3): Uint8Array {
  return serializeLedgerFileV3S3(file);
}

function rejectUnsupportedJsonLedgerFile(bytes: Uint8Array): never {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch (error) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file is neither a V3 binary container nor valid legacy JSON",
      error,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file does not use the supported V3 container",
    );
  }

  const currentLedgerSchemaVersion = readPlaintextVersion(
    parsed,
    "current",
    "ledgerSchemaVersion",
  );
  const previousLedgerSchemaVersion = readPlaintextVersion(
    parsed,
    "previous",
    "ledgerSchemaVersion",
  );
  const retiredLedgerSchemaVersion = [
    currentLedgerSchemaVersion,
    previousLedgerSchemaVersion,
  ].find(
    (version): version is number =>
      typeof version === "number" &&
      version !== SUPPORTED_LEDGER_SCHEMA_VERSION,
  );
  // Schemas 2 and 3 keep their own more specific retirement message. Anything
  // else inside a retired V2 container is rejected for the container itself:
  // no V2 file is opened whatever ledger it carries, and a reader of the
  // message has to be able to tell that the file format generation is the
  // problem rather than the ledger schema.
  if (
    retiredLedgerSchemaVersion === 2 ||
    retiredLedgerSchemaVersion === 3
  ) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file uses an unsupported ledger schema",
      [
        {
          code: "LEDGER_FILE_UNSUPPORTED_LEDGER_SCHEMA",
          path: "current.ledgerSchemaVersion",
          message: `This file contains a V${retiredLedgerSchemaVersion} ledger; V5 does not provide migration`,
        },
      ],
    );
  }

  const fileFormatVersion = readPlaintextVersion(
    parsed,
    "fileFormatVersion",
  );
  if (fileFormatVersion === 2) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file format V2 is retired and is not opened before migration is enabled",
      [
        {
          code: "LEDGER_FILE_UNSUPPORTED_VERSION",
          path: "fileFormatVersion",
          message:
            "Ledger file format V2 is retired; this file uses ledger file format V2 and the supported ledger file format is V3",
        },
      ],
    );
  }

  if (retiredLedgerSchemaVersion !== undefined) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file uses an unsupported ledger schema",
      [
        {
          code: "LEDGER_FILE_UNSUPPORTED_LEDGER_SCHEMA",
          path: "current.ledgerSchemaVersion",
          message: "The ledger schema version is unsupported",
        },
      ],
    );
  }

  throw new LedgerFileRepositoryError(
    LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
    "Ledger file does not use the supported V3 container",
    [
      {
        code: "LEDGER_FILE_UNSUPPORTED_VERSION",
        path: "fileFormatVersion",
        message: "Unsupported ledger file format version",
      },
    ],
  );
}

function readPlaintextVersion(
  value: object,
  key: string,
): unknown;
function readPlaintextVersion(
  value: object,
  outerKey: string,
  innerKey: string,
): unknown;
function readPlaintextVersion(
  value: object,
  outerKey: string,
  innerKey?: string,
): unknown {
  if (!(outerKey in value)) return undefined;
  const outer = value[outerKey as keyof typeof value] as unknown;
  if (innerKey === undefined) return outer;
  if (typeof outer !== "object" || outer === null || !(innerKey in outer)) {
    return undefined;
  }
  return outer[innerKey as keyof typeof outer];
}

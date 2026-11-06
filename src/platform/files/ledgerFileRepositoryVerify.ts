/**
 * 这个文件管核对一份账本文件。
 * 它解密每一块、验块清单、比编号和版本。
 * 它还比写下去的和读回来的一样不一样。
 * 它不管怎么写，那在 ledgerFileRepositoryWrite.ts。
 * 不显然的决定。
 * 低版本文件在解密前就拒绝，并说清楚是哪个版本。2026-09-07 定（W16 02A 修订 A 第七节）。
 */

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
import { type LedgerBlockPayloadV3S3 } from "./ledgerFileChunkingV3";
import {
  mergeBlockPayloadsV3S3,
  parseLedgerBlockPayloadV3S3,
} from "./ledgerFileChunkingV3Payload";
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

/**
 * 这个函数从一次准备好的保存里。
 * 取出写完以后应该读回来的样子。
 * 举例：准备写入 3 个块 → 答这 3 个块应有的内容、槽和随机数。
 */
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

/**
 * 这个函数从一次准备好的恢复里。
 * 取出写完以后应该读回来的样子。
 * 举例：用上一代恢复 → 答恢复后这一代应有的内容。
 */
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

/**
 * 这个函数把一串字节读成文件，再完整核对一遍。
 * 举例：密码对、块都完好 → 答核对过的文件。
 * 文件坏了、密码不对、和应有的样子不一样时抛 `LedgerFileRepositoryError`。
 */
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

/**
 * 这个函数完整核对一份已经读出来的文件。
 * 解密每一块，验块清单，比和应有的样子。
 * 举例：写下去 3 个块，读回来第 2 块不一样 → 抛 `LEDGER_FILE_READBACK_FAILED`。
 * 钥匙不对抛 `LEDGER_FILE_AUTHENTICATION_FAILED`；文件编号不对抛 `LEDGER_FILE_ID_MISMATCH`。
 */
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

/**
 * 这个函数回答。
 * 打开账本时，这份文件能直接用，还是要先从上一代恢复？
 * 举例：这一代某块坏了、上一代完好 → 答要恢复，给出上一代。
 * 钥匙不对、两代都不能用时抛 `LedgerFileRepositoryError`。
 */
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

/**
 * 这个函数把一串字节读成 S-3 文件，选最新的那份完整的。
 * 举例：两个头槽次数是 7 和 8，都完整 → 答 8 那份。
 * 没有唯一完整的那份时抛 `LEDGER_FILE_INVALID_FILE`。
 */
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

/**
 * 这个函数把一串字节读成 S-3 文件的候选。
 * 按写的次数从新到旧排。
 * 不是文件格式 3 时，先认出是哪种旧格式。
 * 再给出明确的拒绝理由。
 * 举例：一份文件格式 2 的 JSON 文件 → 抛错，说这个格式已退役。
 */
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

/** 这个函数确认一份 S-3 文件合规矩，不合就抛 `LEDGER_FILE_INVALID_FILE`。 */
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

/**
 * 这个函数把一份 S-3 文件写成字节；文件不合规矩时抛错。
 * 举例：用到 3 个内容槽 → 答 3670032 字节。
 */
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
  // 为什么结构版本 2、3 单独报：它们有更具体的退役说明。
  // 旧的文件格式 2 里装别的版本，都按「文件格式退役」拒绝。
  // 不管装的是哪个版本，格式 2 的文件都不打开。
  // 看报错的人要能分清，问题出在文件格式，不是账本结构。
  // 2026-09-07 定（W16 02A 修订 A 第七节）。
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

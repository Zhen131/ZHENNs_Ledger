import {
  type LedgerFileHandle,
  type LedgerFileHandleAdapter,
} from "./ledgerFileHandleAdapter";
import {
  type CanonicalLedgerPayloadV4,
  SUPPORTED_LEDGER_SCHEMA_VERSION,
} from "./ledgerFileContract";
import {
  ledgerFileBodySlotsRequiredV3S3,
  LEDGER_FILE_OUTER_V3_S3_CONSTANTS,
  LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
  otherLedgerFileHeaderSlotV3S3,
  RECORDS_PER_LEDGER_BLOCK,
  type EncryptedLedgerBlockV3S3,
  type LedgerFileV3S3,
  type LedgerGenerationV3S3,
} from "./ledgerFileChunkedContainerV3";
import {
  parseLedgerFileV3S3Candidates,
} from "./ledgerFileChunkedContainerV3Parse";
import {
  prepareLedgerFileUpdateV3S3,
} from "./ledgerFileChunkedContainerV3Serialize";
import {
  createLedgerGenerationPlanV3S3,
  type LedgerGenerationPlanV3S3,
} from "./ledgerFileChunkingV3";
import { LedgerFileCrypto } from "./ledgerFileCrypto";
import { type LedgerAction } from "@/core/state";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
  LedgerFileRepositoryError,
} from "./ledgerFileRepositoryContract";
import type {
  VerifiedGeneration,
  PendingRecoveryIntent,
} from "./ledgerFileRepositoryIntents";

type PreparedLedgerFileWrite = Pick<
  PendingRecoveryIntent,
  "serializedFile" | "writeMode" | "patches"
>;

export async function writePreparedLedgerFile(
  adapter: LedgerFileHandleAdapter,
  handle: LedgerFileHandle,
  prepared: PreparedLedgerFileWrite,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const readback = prepared.writeMode === "patch"
    ? await adapter.writeBinaryPatchesAndReadBack(
        handle,
        prepared.patches,
        prepared.serializedFile.byteLength,
        signal,
      )
    : await adapter.writeBinaryAndReadBack(
        handle,
        prepared.serializedFile,
        signal,
      );
  return readback.bytes;
}

export async function createInitialLedgerFileV3S3(
  crypto: LedgerFileCrypto,
  fileId: string,
  revision: {
    revisionId: string;
    parentRevisionId: null;
  },
  payload: CanonicalLedgerPayloadV4,
): Promise<LedgerFileV3S3> {
  const plan = createLedgerGenerationPlanV3S3(
    revision.revisionId,
    payload,
  );
  const requiredSlots = generationPlanRequiredSlots(plan);
  const bodySlotCount = requiredSlots + ordinaryRewriteSlotReserve(plan);
  const allocator = createBodySlotAllocator(
    Array.from({ length: bodySlotCount }, (_, slot) => slot),
  );
  const usedIvBase64Urls = new Set<string>();
  const current = await encryptGenerationPlanV3S3(
    crypto,
    fileId,
    revision,
    plan,
    allocator,
    `${revision.revisionId}:control`,
    usedIvBase64Urls,
  );
  return sealLedgerFileManifestV3S3(crypto, {
    fileFormatVersion: LEDGER_FILE_OUTER_V3_S3_CONSTANTS.fileFormatVersion,
    cryptoVersion: LEDGER_FILE_OUTER_V3_S3_CONSTANTS.cryptoVersion,
    ledgerSchemaVersion:
      LEDGER_FILE_OUTER_V3_S3_CONSTANTS.ledgerSchemaVersion,
    backupFormatVersion:
      LEDGER_FILE_OUTER_V3_S3_CONSTANTS.backupFormatVersion,
    fileId,
    sequence: 1,
    activeHeaderSlot: 0,
    recordsPerBlock: RECORDS_PER_LEDGER_BLOCK,
    bodySlotBytes: LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
    bodySlotCount,
    crypto: crypto.getCryptoMetadata(),
    manifestAuthIvBase64Url: crypto.createIvBase64UrlV3S3(
      usedIvBase64Urls,
    ),
    manifestAuthTagBytes: new Uint8Array(16),
    current,
    previous: null,
  });
}

export async function prepareNextLedgerFileV3S3(
  crypto: LedgerFileCrypto,
  physicalBaseFile: LedgerFileV3S3,
  baseSerializedFile: Uint8Array,
  reachableBodySlots: readonly number[],
  logicalBase: VerifiedGeneration,
  payload: CanonicalLedgerPayloadV4,
  revisionId: string,
  reachableIvBase64Urls?: readonly string[],
  action?: LedgerAction,
) {
  const plan = createLedgerGenerationPlanV3S3(
    revisionId,
    payload,
    {
      generation: logicalBase.generation,
      blockPayloads: logicalBase.blockPayloads,
    },
    action,
  );
  const initialFree = Array.from(
    { length: physicalBaseFile.bodySlotCount },
    (_, slot) => slot,
  ).filter((slot) => !reachableBodySlots.includes(slot));
  const requiredSlots = generationPlanRequiredSlots(plan);
  const reserveSlots = 2 * ordinaryRewriteSlotReserve(plan);
  let bodySlotCount = physicalBaseFile.bodySlotCount;
  const free = [...initialFree];
  if (free.length < requiredSlots) {
    const added = requiredSlots - free.length + reserveSlots;
    free.push(
      ...Array.from(
        { length: added },
        (_, index) => physicalBaseFile.bodySlotCount + index,
      ),
    );
    bodySlotCount += added;
  }
  const allocator = createBodySlotAllocator(free);
  const usedIvBase64Urls = new Set(
    reachableIvBase64Urls ??
      readReachableIvBase64UrlsV3S3(baseSerializedFile),
  );
  const current = await encryptGenerationPlanV3S3(
    crypto,
    physicalBaseFile.fileId,
    {
      revisionId,
      parentRevisionId: logicalBase.generation.revisionId,
    },
    plan,
    allocator,
    logicalBase.generation.controlBlock.blockId,
    usedIvBase64Urls,
  );
  const nextFile = await sealLedgerFileManifestV3S3(crypto, {
    fileFormatVersion: physicalBaseFile.fileFormatVersion,
    cryptoVersion: physicalBaseFile.cryptoVersion,
    ledgerSchemaVersion: physicalBaseFile.ledgerSchemaVersion,
    backupFormatVersion: physicalBaseFile.backupFormatVersion,
    fileId: physicalBaseFile.fileId,
    sequence: physicalBaseFile.sequence + 1,
    activeHeaderSlot: otherLedgerFileHeaderSlotV3S3(
      physicalBaseFile.activeHeaderSlot,
    ),
    recordsPerBlock: RECORDS_PER_LEDGER_BLOCK,
    bodySlotBytes: LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
    bodySlotCount,
    crypto: physicalBaseFile.crypto,
    manifestAuthIvBase64Url: crypto.createIvBase64UrlV3S3(
      usedIvBase64Urls,
    ),
    manifestAuthTagBytes: new Uint8Array(16),
    current,
    previous: logicalBase.generation,
  });
  return {
    ...prepareLedgerFileUpdateV3S3(
    physicalBaseFile,
    baseSerializedFile,
    nextFile,
    ),
    expectedCurrentBlockPayloads: new Map<string, string>([
      [current.controlBlock.blockId, plan.controlSerializedPayload],
      ...plan.factBlocks.flatMap((block) =>
        block.serializedPayload === null
          ? []
          : [[block.blockId, block.serializedPayload] as const],
      ),
    ]),
    expectedReachableBodySlots: Array.from(
      new Set([
        ...reachableBodySlots,
        ...collectLedgerFileBodySlots(nextFile),
      ]),
    ).sort((left, right) => left - right),
    expectedReachableIvBase64Urls: Array.from(
      new Set([
        ...usedIvBase64Urls,
        nextFile.manifestAuthIvBase64Url,
      ]),
    ),
  };
}

export function collectLedgerFileBodySlots(file: LedgerFileV3S3): number[] {
  return [file.current, file.previous]
    .flatMap((generation) =>
      generation
        ? [generation.controlBlock, ...generation.factBlocks]
        : [],
    )
    .flatMap((block) => block.bodySlots);
}

export function collectLedgerFileIvBase64Urls(
  files: readonly LedgerFileV3S3[],
): string[] {
  const ivs = new Set<string>();
  for (const file of files) {
    ivs.add(file.manifestAuthIvBase64Url);
    for (const generation of [file.current, file.previous]) {
      if (!generation) continue;
      for (const block of [
        generation.controlBlock,
        ...generation.factBlocks,
      ]) {
        ivs.add(block.ivBase64Url);
      }
    }
  }
  return [...ivs];
}

async function encryptGenerationPlanV3S3(
  crypto: LedgerFileCrypto,
  fileId: string,
  revision: {
    revisionId: string;
    parentRevisionId: string | null;
  },
  plan: LedgerGenerationPlanV3S3,
  allocate: (count: number) => number[],
  controlBlockId: string,
  usedIvBase64Urls: Set<string>,
): Promise<LedgerGenerationV3S3> {
  const controlPlaintextBytes = new TextEncoder().encode(
    plan.controlSerializedPayload,
  ).byteLength;
  const controlBlock = await crypto.encryptBlockV3S3(
    fileId,
    {
      blockId: controlBlockId,
      role: "control",
      order: 0,
      sealed: true,
      recordCount: 0,
      ledgerSchemaVersion: SUPPORTED_LEDGER_SCHEMA_VERSION,
      plaintextByteLength: controlPlaintextBytes,
      bodySlots: allocate(
        ledgerFileBodySlotsRequiredV3S3(controlPlaintextBytes + 16),
      ),
    },
    plan.controlSerializedPayload,
    usedIvBase64Urls,
  );
  usedIvBase64Urls.add(controlBlock.ivBase64Url);
  const factBlocks: EncryptedLedgerBlockV3S3[] = [];
  for (const block of plan.factBlocks) {
    if (block.reusedBlock) {
      factBlocks.push(block.reusedBlock);
      continue;
    }
    if (block.serializedPayload === null) {
      throw new Error(
        `Changed V3 S-3 block ${block.blockId} has no plaintext`,
      );
    }
    const plaintextByteLength = new TextEncoder().encode(
      block.serializedPayload,
    ).byteLength;
    const encrypted = await crypto.encryptBlockV3S3(
        fileId,
        {
          blockId: block.blockId,
          role: "facts",
          order: block.order,
          sealed: block.sealed,
          recordCount: block.recordCount,
          ledgerSchemaVersion: SUPPORTED_LEDGER_SCHEMA_VERSION,
          plaintextByteLength,
          bodySlots: allocate(
            ledgerFileBodySlotsRequiredV3S3(plaintextByteLength + 16),
          ),
        },
        block.serializedPayload,
        usedIvBase64Urls,
      );
    usedIvBase64Urls.add(encrypted.ivBase64Url);
    factBlocks.push(encrypted);
  }
  return {
    revisionId: revision.revisionId,
    parentRevisionId: revision.parentRevisionId,
    controlBlock,
    factBlocks,
    openBlockId: plan.openBlockId,
  };
}

async function sealLedgerFileManifestV3S3(
  crypto: LedgerFileCrypto,
  file: LedgerFileV3S3,
): Promise<LedgerFileV3S3> {
  const manifestAuthTagBytes = await crypto.authenticateManifestV3S3(file);
  return { ...file, manifestAuthTagBytes };
}

function generationPlanRequiredSlots(
  plan: LedgerGenerationPlanV3S3,
): number {
  const controlBytes = new TextEncoder().encode(
    plan.controlSerializedPayload,
  ).byteLength;
  return (
    ledgerFileBodySlotsRequiredV3S3(controlBytes + 16) +
    plan.factBlocks.reduce((total, block) => {
      if (block.reusedBlock) return total;
      if (block.serializedPayload === null) {
        throw new Error(
          `Changed V3 S-3 block ${block.blockId} has no plaintext`,
        );
      }
      const bytes = new TextEncoder().encode(block.serializedPayload).byteLength;
      return total + ledgerFileBodySlotsRequiredV3S3(bytes + 16);
    }, 0)
  );
}

function ordinaryRewriteSlotReserve(
  plan: LedgerGenerationPlanV3S3,
): number {
  const controlBytes = new TextEncoder().encode(
    plan.controlSerializedPayload,
  ).byteLength;
  const controlSlots = ledgerFileBodySlotsRequiredV3S3(controlBytes + 16);
  const maximumFactSlots = Math.max(
    1,
    ...plan.factBlocks.map((block) => {
      if (block.serializedPayload === null) {
        return block.reusedBlock?.bodySlots.length ?? 1;
      }
      const bytes = new TextEncoder().encode(block.serializedPayload).byteLength;
      return ledgerFileBodySlotsRequiredV3S3(bytes + 16);
    }),
  );
  return controlSlots + maximumFactSlots;
}

function createBodySlotAllocator(
  available: number[],
): (count: number) => number[] {
  const remaining = [...available].sort((left, right) => left - right);
  return (count) => {
    if (remaining.length < count) {
      throw new Error("V3 S-3 file has no safe body slots for this write");
    }
    return remaining.splice(0, count);
  };
}

export function readReachableBodySlotsV3S3(bytes: Uint8Array): number[] {
  const parsed = parseLedgerFileV3S3Candidates(bytes);
  if (!parsed.ok) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file body-slot reachability could not be established",
      parsed.errors,
    );
  }
  return parsed.value.reachableBodySlots;
}

export function readReachableIvBase64UrlsV3S3(bytes: Uint8Array): string[] {
  const parsed = parseLedgerFileV3S3Candidates(bytes);
  if (!parsed.ok) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file IV reachability could not be established",
      parsed.errors,
    );
  }
  return collectLedgerFileIvBase64Urls(
    parsed.value.candidates.map(({ file }) => file),
  );
}

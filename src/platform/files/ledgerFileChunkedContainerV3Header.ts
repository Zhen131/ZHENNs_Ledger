/**
 * 这个文件管 S-3 文件头的形状，和按固定顺序把它拼出来。
 * 它不管把文件头写进槽里，那在 ledgerFileChunkedContainerV3Serialize.ts。
 * 不显然的决定。
 * 上一代只记和这一代不同的块，不再整本存两份。2026-09-01 定（W15 06C 第 R-2 节 F-5）。
 */

import { type LedgerFileCryptoV2 } from "./ledgerFileContract";
import type {
  EncryptedLedgerBlockV3S3,
  LedgerGenerationV3S3,
  LedgerFileV3S3,
} from "./ledgerFileChunkedContainerV3";
import { sameBlockHeader } from "./ledgerFileChunkedContainerV3Shared";

/** 文件头里一个块的说明，比加密好的块少了密文本身。 */
export type LedgerBlockHeaderV3S3 = Omit<
  EncryptedLedgerBlockV3S3,
  "ciphertextBytes"
> & {
  ciphertextByteLength: number;
};

/**
 * 文件头里这一代的说明。
 * 包括编号、上一代编号、控制块、记录块、没装满的块。
 */
export type LedgerGenerationHeaderV3S3 = {
  revisionId: string;
  parentRevisionId: string | null;
  controlBlock: LedgerBlockHeaderV3S3;
  factBlocks: LedgerBlockHeaderV3S3[];
  openBlockId: string | null;
};

/**
 * 文件头里上一代的说明。
 * 只记变过的记录块和这一代独有的块编号。
 */
export type LedgerPreviousHeaderV3S3 = {
  revisionId: string;
  parentRevisionId: string | null;
  controlBlock: LedgerBlockHeaderV3S3;
  changedFactBlocks: LedgerBlockHeaderV3S3[];
  currentOnlyBlockIds: string[];
};

/**
 * S-3 文件头。
 * 有版本号、编号、写到第几次、槽。
 * 还有加密参数和两代的说明。
 */
export type LedgerFileHeaderV3S3 = {
  fileFormatVersion: 3;
  cryptoVersion: 1;
  ledgerSchemaVersion: 5;
  backupFormatVersion: 3;
  fileId: string;
  sequence: number;
  recordsPerBlock: number;
  bodySlotBytes: number;
  bodySlotCount: number;
  crypto: LedgerFileCryptoV2;
  manifestAuthIvBase64Url: string;
  current: LedgerGenerationHeaderV3S3;
  previous: LedgerPreviousHeaderV3S3 | null;
};

/**
 * 这个函数把一份 S-3 文件整理成按固定顺序排好的文件头。
 * 上一代只写下和这一代不同的部分。
 * 举例：两代只有 1 号记录块不同 → 答的上一代里只列这一块。
 * 不会出错。
 */
export function toHeader(file: LedgerFileV3S3): LedgerFileHeaderV3S3 {
  return {
    fileFormatVersion: file.fileFormatVersion,
    cryptoVersion: file.cryptoVersion,
    ledgerSchemaVersion: file.ledgerSchemaVersion,
    backupFormatVersion: file.backupFormatVersion,
    fileId: file.fileId,
    sequence: file.sequence,
    recordsPerBlock: file.recordsPerBlock,
    bodySlotBytes: file.bodySlotBytes,
    bodySlotCount: file.bodySlotCount,
    crypto: orderedCrypto(file.crypto),
    manifestAuthIvBase64Url: file.manifestAuthIvBase64Url,
    current: generationHeader(file.current),
    previous: file.previous ? previousHeader(file.current, file.previous) : null,
  };
}

/**
 * 这个函数把一代内容整理成文件头里那一段。
 * 按固定顺序排字段。
 * 举例：同一代 → 每次答一样的字段顺序。
 */
export function generationHeader(generation: LedgerGenerationV3S3): LedgerGenerationHeaderV3S3 {
  return {
    revisionId: generation.revisionId,
    parentRevisionId: generation.parentRevisionId,
    controlBlock: blockHeader(generation.controlBlock),
    factBlocks: generation.factBlocks.map(blockHeader),
    openBlockId: generation.openBlockId,
  };
}

function previousHeader(
  current: LedgerGenerationV3S3,
  previous: LedgerGenerationV3S3,
): LedgerPreviousHeaderV3S3 {
  const currentById = new Map(current.factBlocks.map((block) => [block.blockId, block]));
  const previousById = new Map(previous.factBlocks.map((block) => [block.blockId, block]));
  return {
    revisionId: previous.revisionId,
    parentRevisionId: previous.parentRevisionId,
    controlBlock: blockHeader(previous.controlBlock),
    changedFactBlocks: previous.factBlocks
      .filter((block) => {
        const next = currentById.get(block.blockId);
        return !next || !sameBlockHeader(block, next);
      })
      .map(blockHeader),
    currentOnlyBlockIds: current.factBlocks
      .filter(({ blockId }) => !previousById.has(blockId))
      .map(({ blockId }) => blockId),
  };
}

function blockHeader(block: EncryptedLedgerBlockV3S3): LedgerBlockHeaderV3S3 {
  return {
    ...orderedBlockMetadata(block),
    ciphertextByteLength: block.ciphertextBytes.byteLength,
  };
}

/**
 * 这个函数把一个块的说明按固定顺序排字段。
 * 举例：同一个块 → 每次答一样的字段顺序。
 */
export function orderedBlockMetadata(block: Omit<EncryptedLedgerBlockV3S3, "ciphertextBytes">) {
  return {
    blockId: block.blockId,
    role: block.role,
    order: block.order,
    sealed: block.sealed,
    recordCount: block.recordCount,
    ledgerSchemaVersion: block.ledgerSchemaVersion,
    ivBase64Url: block.ivBase64Url,
    plaintextByteLength: block.plaintextByteLength,
    bodySlots: [...block.bodySlots],
  };
}

/**
 * 这个函数按固定字段顺序重新拼一份加密参数。
 * 举例：字段顺序乱的参数 → 答顺序固定的一份，值不变。
 */
export function orderedCrypto(crypto: LedgerFileCryptoV2): LedgerFileCryptoV2 {
  return {
    cryptoVersion: crypto.cryptoVersion,
    kdf: {
      name: crypto.kdf.name,
      hash: crypto.kdf.hash,
      iterations: crypto.kdf.iterations,
      saltBase64Url: crypto.kdf.saltBase64Url,
    },
    cipher: {
      name: crypto.cipher.name,
      keyLength: crypto.cipher.keyLength,
      tagLength: crypto.cipher.tagLength,
    },
  };
}

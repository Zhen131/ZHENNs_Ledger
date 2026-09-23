import { type LedgerFileCryptoV2 } from "./ledgerFileContract";
import type {
  EncryptedLedgerBlockV3S3,
  LedgerGenerationV3S3,
  LedgerFileV3S3,
} from "./ledgerFileChunkedContainerV3";
import { sameBlockHeader } from "./ledgerFileChunkedContainerV3Shared";

export type LedgerBlockHeaderV3S3 = Omit<
  EncryptedLedgerBlockV3S3,
  "ciphertextBytes"
> & {
  ciphertextByteLength: number;
};

export type LedgerGenerationHeaderV3S3 = {
  revisionId: string;
  parentRevisionId: string | null;
  controlBlock: LedgerBlockHeaderV3S3;
  factBlocks: LedgerBlockHeaderV3S3[];
  openBlockId: string | null;
};

export type LedgerPreviousHeaderV3S3 = {
  revisionId: string;
  parentRevisionId: string | null;
  controlBlock: LedgerBlockHeaderV3S3;
  changedFactBlocks: LedgerBlockHeaderV3S3[];
  currentOnlyBlockIds: string[];
};

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

import type { LedgerAction } from "@/core/state";
import { type CanonicalLedgerPayloadV4 } from "./ledgerFileContract";
import {
  RECORDS_PER_LEDGER_BLOCK,
  type LedgerGenerationV3S3,
} from "./ledgerFileChunkedContainerV3";
import type {
  LedgerFactCollection,
  LedgerBlockPayloadV3S3,
  LedgerFactBlockPlanV3S3,
  LedgerGenerationPlanV3S3,
} from "./ledgerFileChunkingV3";
import { LEDGER_FACT_COLLECTIONS } from "./ledgerFileChunkingV3";
import type { FactEntry } from "./ledgerFileChunkingV3Shared";
import {
  mergeLedgerDataV3S3,
  flattenLedgerData,
  emptyLedgerData,
  collectionArray,
} from "./ledgerFileChunkingV3Shared";

export function createLedgerGenerationPlanV3S3(
  revisionId: string,
  payload: CanonicalLedgerPayloadV4,
  base?: {
    generation: LedgerGenerationV3S3;
    blockPayloads: ReadonlyMap<string, LedgerBlockPayloadV3S3>;
  },
  action?: LedgerAction,
): LedgerGenerationPlanV3S3 {
  const controlSerializedPayload = serializeBlockPayload(
    payload.value.savedAt,
    [],
  );
  if (!base) {
    return createFullPlan(
      revisionId,
      payload,
      controlSerializedPayload,
    );
  }
  if (action?.type === "trade/add") {
    const incremental = createTradeAppendPlan(
      revisionId,
      payload,
      controlSerializedPayload,
      base,
      action,
    );
    if (incremental) return incremental;
  }

  const candidateEntries = flattenLedgerData(payload.value.ledgerData);
  const candidateByKey = new Map(
    candidateEntries.map((entry) => [factKey(entry), entry]),
  );
  const seen = new Set<string>();
  const working = base.generation.factBlocks.flatMap((block) => {
    const blockPayload = base.blockPayloads.get(block.blockId);
    if (!blockPayload) {
      throw new Error(`Missing verified plaintext for fact block ${block.blockId}`);
    }
    const entries = flattenLedgerData(blockPayload.ledgerData).flatMap(
      (entry) => {
        const next = candidateByKey.get(factKey(entry));
        if (!next) return [];
        seen.add(factKey(next));
        return [next];
      },
    );
    if (entries.length === 0) return [];
    return [{ block, entries }];
  });

  const additions = candidateEntries.filter(
    (entry) => !seen.has(factKey(entry)),
  );
  let additionOffset = 0;
  const open = working.find(({ block }) => !block.sealed);
  if (open) {
    const capacity = RECORDS_PER_LEDGER_BLOCK - open.entries.length;
    const appended = additions.slice(0, capacity);
    open.entries.push(...appended);
    additionOffset += appended.length;
  }

  while (additionOffset < additions.length) {
    const entries = additions.slice(
      additionOffset,
      additionOffset + RECORDS_PER_LEDGER_BLOCK,
    );
    const order = Math.max(
      -1,
      ...working.map(({ block }) => block.order),
    ) + 1;
    working.push({
      block: {
        blockId: `${revisionId}:facts:${order}`,
        role: "facts",
        order,
        sealed: entries.length === RECORDS_PER_LEDGER_BLOCK,
        recordCount: entries.length,
        ledgerSchemaVersion: 5,
        ivBase64Url: "",
        plaintextByteLength: 0,
        bodySlots: [],
        ciphertextBytes: new Uint8Array(),
      },
      entries,
    });
    additionOffset += entries.length;
  }

  const plans = working.map(({ block, entries }) => {
    const order = block.order;
    // A deletion may leave a previously sealed block sparse. Compaction is
    // deliberately out of scope: the block stays sealed and is never refilled.
    const sealed = block.sealed || entries.length === RECORDS_PER_LEDGER_BLOCK;
    const changedSerializedPayload = serializeBlockPayload(
      payload.value.savedAt,
      entries,
    );
    const oldPayload = base.blockPayloads.get(block.blockId);
    const factsUnchanged =
      oldPayload !== undefined &&
      JSON.stringify(oldPayload.ledgerData) ===
        JSON.stringify(
          (JSON.parse(changedSerializedPayload) as LedgerBlockPayloadV3S3)
            .ledgerData,
        );
    const reusedBlock =
      factsUnchanged &&
      block.order === order &&
      block.sealed === sealed &&
      block.recordCount === entries.length
        ? block
        : null;
    return {
      blockId: block.blockId,
      order,
      sealed,
      recordCount: entries.length,
      serializedPayload: reusedBlock && oldPayload
        ? JSON.stringify(oldPayload)
        : changedSerializedPayload,
      reusedBlock,
    };
  });

  const reconstructedLedgerData = mergeLedgerDataV3S3(
    plans.map(({ serializedPayload }) =>
      JSON.parse(serializedPayload!) as LedgerBlockPayloadV3S3,
    ),
  );
  if (
    JSON.stringify(reconstructedLedgerData) !==
      payload.serializedLedgerData
  ) {
    // A reordered or otherwise whole-ledger replacement is allowed to rebuild
    // all fact blocks. Ordinary append/edit/delete paths preserve membership.
    return createFullPlan(
      revisionId,
      payload,
      controlSerializedPayload,
    );
  }

  const openPlan = plans.find(({ sealed }) => !sealed) ?? null;
  return {
    controlSerializedPayload,
    factBlocks: plans,
    openBlockId: openPlan?.blockId ?? null,
    fullRebuild: false,
  };
}

function createTradeAppendPlan(
  revisionId: string,
  payload: CanonicalLedgerPayloadV4,
  controlSerializedPayload: string,
  base: {
    generation: LedgerGenerationV3S3;
    blockPayloads: ReadonlyMap<string, LedgerBlockPayloadV3S3>;
  },
  action: Extract<LedgerAction, { type: "trade/add" }>,
): LedgerGenerationPlanV3S3 | null {
  const candidateTrade = payload.value.ledgerData.trades.at(-1);
  if (
    !candidateTrade ||
    candidateTrade.id !== action.trade.id
  ) {
    return null;
  }

  const baseCounts: Record<LedgerFactCollection, number> = {
    assets: 0,
    trades: 0,
    cashEvents: 0,
    assetTransfers: 0,
    priceSnapshots: 0,
    feeRules: 0,
  };
  for (const block of base.generation.factBlocks) {
    const blockPayload = base.blockPayloads.get(block.blockId);
    if (!blockPayload) return null;
    for (const collection of LEDGER_FACT_COLLECTIONS) {
      baseCounts[collection] +=
        collectionArray(blockPayload.ledgerData, collection).length;
    }
  }
  if (
    LEDGER_FACT_COLLECTIONS.some((collection) =>
      payload.value.ledgerData[collection].length !==
        baseCounts[collection] +
          (collection === "trades" ? 1 : 0),
    )
  ) {
    return null;
  }

  const openBlock = base.generation.openBlockId
    ? base.generation.factBlocks.find(
        (block) => block.blockId === base.generation.openBlockId,
      )
    : undefined;
  const plans: LedgerFactBlockPlanV3S3[] =
    base.generation.factBlocks.map((block) => ({
      blockId: block.blockId,
      order: block.order,
      sealed: block.sealed,
      recordCount: block.recordCount,
      serializedPayload: null,
      reusedBlock: block,
    }));

  let openBlockId: string;
  if (openBlock) {
    const openPayload = base.blockPayloads.get(openBlock.blockId);
    if (!openPayload) return null;
    const entries = flattenLedgerData(openPayload.ledgerData);
    entries.push({
      collection: "trades",
      id: candidateTrade.id,
      value: candidateTrade,
    });
    if (entries.length > RECORDS_PER_LEDGER_BLOCK) return null;
    const sealed = entries.length === RECORDS_PER_LEDGER_BLOCK;
    const index = plans.findIndex(
      (block) => block.blockId === openBlock.blockId,
    );
    plans[index] = {
      blockId: openBlock.blockId,
      order: openBlock.order,
      sealed,
      recordCount: entries.length,
      serializedPayload: serializeBlockPayload(
        payload.value.savedAt,
        entries,
      ),
      reusedBlock: null,
    };
    openBlockId = sealed ? "" : openBlock.blockId;
  } else {
    const order = Math.max(
      -1,
      ...base.generation.factBlocks.map((block) => block.order),
    ) + 1;
    const blockId = `${revisionId}:facts:${order}`;
    plans.push({
      blockId,
      order,
      sealed: false,
      recordCount: 1,
      serializedPayload: serializeBlockPayload(
        payload.value.savedAt,
        [{ collection: "trades", id: candidateTrade.id, value: candidateTrade }],
      ),
      reusedBlock: null,
    });
    openBlockId = blockId;
  }

  return {
    controlSerializedPayload,
    factBlocks: plans,
    openBlockId: openBlockId || null,
    fullRebuild: false,
  };
}

function createFullPlan(
  revisionId: string,
  payload: CanonicalLedgerPayloadV4,
  controlSerializedPayload: string,
): LedgerGenerationPlanV3S3 {
  const entries = flattenLedgerData(payload.value.ledgerData);
  const factBlocks: LedgerFactBlockPlanV3S3[] = [];
  for (
    let offset = 0;
    offset < entries.length;
    offset += RECORDS_PER_LEDGER_BLOCK
  ) {
    const facts = entries.slice(offset, offset + RECORDS_PER_LEDGER_BLOCK);
    const order = factBlocks.length;
    factBlocks.push({
      blockId: `${revisionId}:facts:${order}`,
      order,
      sealed: facts.length === RECORDS_PER_LEDGER_BLOCK,
      recordCount: facts.length,
      serializedPayload: serializeBlockPayload(
        payload.value.savedAt,
        facts,
      ),
      reusedBlock: null,
    });
  }
  const open = factBlocks.find(({ sealed }) => !sealed) ?? null;
  return {
    controlSerializedPayload,
    factBlocks,
    openBlockId: open?.blockId ?? null,
    fullRebuild: true,
  };
}

function serializeBlockPayload(
  savedAt: string,
  entries: readonly FactEntry[],
): string {
  const ledgerData = emptyLedgerData();
  for (const entry of entries) {
    collectionArray(ledgerData, entry.collection).push(entry.value);
  }
  return JSON.stringify({ savedAt, ledgerData });
}

function factKey(entry: FactEntry): string {
  return `${entry.collection}\u0000${entry.id}`;
}

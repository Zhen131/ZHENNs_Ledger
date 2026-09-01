import type { LedgerData } from "@/core/models";
import type { LedgerAction } from "@/core/state";
import { isValidISODateOrDateTime } from "@/core/validation";
import {
  createCanonicalLedgerPayloadV4,
  type CanonicalLedgerPayloadV4,
  type DecryptedLedgerPayloadV4,
} from "./ledgerFileContract";
import {
  RECORDS_PER_LEDGER_BLOCK,
  type EncryptedLedgerBlockV3S3,
  type LedgerGenerationV3S3,
} from "./ledgerFileChunkedContainerV3";

export const LEDGER_FACT_COLLECTIONS = [
  "assets",
  "trades",
  "cashEvents",
  "assetTransfers",
  "priceSnapshots",
  "feeRules",
] as const;

export type LedgerFactCollection =
  (typeof LEDGER_FACT_COLLECTIONS)[number];

export type LedgerBlockPayloadV3S3 = DecryptedLedgerPayloadV4;

export type LedgerFactBlockPlanV3S3 = {
  blockId: string;
  order: number;
  sealed: boolean;
  recordCount: number;
  serializedPayload: string | null;
  reusedBlock: EncryptedLedgerBlockV3S3 | null;
};

export type LedgerGenerationPlanV3S3 = {
  controlSerializedPayload: string;
  factBlocks: LedgerFactBlockPlanV3S3[];
  openBlockId: string | null;
  fullRebuild: boolean;
};

type FactEntry = {
  collection: LedgerFactCollection;
  id: string;
  value: unknown;
};

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
        ledgerSchemaVersion: 4,
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

export function parseLedgerBlockPayloadV3S3(
  serialized: string,
  role: "control" | "facts",
  expectedRecordCount: number,
): LedgerBlockPayloadV3S3 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error("Decrypted V3 S-3 block is not valid JSON", {
      cause: error,
    });
  }
  if (
    !isExactObject(parsed, ["ledgerData", "savedAt"] as const) ||
    typeof parsed.savedAt !== "string" ||
    !parsed.savedAt.includes("T") ||
    !isValidISODateOrDateTime(parsed.savedAt) ||
    !isExactObject(parsed.ledgerData, [
      "assetTransfers",
      "assets",
      "cashEvents",
      "feeRules",
      "priceSnapshots",
      "schemaVersion",
      "trades",
    ] as const) ||
    parsed.ledgerData.schemaVersion !== 4 ||
    !LEDGER_FACT_COLLECTIONS.every((key) =>
      Array.isArray(
        (parsed.ledgerData as Record<LedgerFactCollection, unknown>)[key],
      ),
    )
  ) {
    throw new Error("Decrypted V3 S-3 block does not use the V4 payload shape");
  }
  const payload = parsed as LedgerBlockPayloadV3S3;
  const facts = flattenLedgerData(payload.ledgerData);
  if (
    facts.length !== expectedRecordCount ||
    (role === "control" && facts.length !== 0) ||
    (role === "facts" && facts.length === 0) ||
    JSON.stringify(payload) !== serialized
  ) {
    throw new Error("Decrypted V3 S-3 block count or canonical encoding is invalid");
  }
  return payload;
}

export function mergeBlockPayloadsV3S3(
  control: LedgerBlockPayloadV3S3,
  facts: readonly LedgerBlockPayloadV3S3[],
): CanonicalLedgerPayloadV4 {
  const merged = mergeLedgerDataV3S3(facts);
  const result = createCanonicalLedgerPayloadV4(merged, control.savedAt);
  if (!result.ok) {
    throw new Error("Merged V3 S-3 blocks failed the canonical V4 payload contract", {
      cause: result.errors,
    });
  }
  return result.value;
}

function mergeLedgerDataV3S3(
  facts: readonly LedgerBlockPayloadV3S3[],
): LedgerData {
  const merged = emptyLedgerData();
  for (const payload of facts) {
    for (const collection of LEDGER_FACT_COLLECTIONS) {
      collectionArray(merged, collection).push(
        ...collectionArray(payload.ledgerData, collection),
      );
    }
  }
  return merged;
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

function flattenLedgerData(ledgerData: LedgerData): FactEntry[] {
  return LEDGER_FACT_COLLECTIONS.flatMap((collection) =>
    collectionArray(ledgerData, collection).map((value) => ({
      collection,
      id: factId(value),
      value,
    })),
  );
}

function factId(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    value.id.length === 0
  ) {
    throw new Error("Every V4 ledger fact must have a non-empty id");
  }
  return value.id;
}

function factKey(entry: FactEntry): string {
  return `${entry.collection}\u0000${entry.id}`;
}

function emptyLedgerData(): LedgerData {
  return {
    schemaVersion: 4,
    assets: [],
    trades: [],
    cashEvents: [],
    assetTransfers: [],
    priceSnapshots: [],
    feeRules: [],
  };
}

function collectionArray(
  ledgerData: LedgerData,
  collection: LedgerFactCollection,
): unknown[] {
  return ledgerData[collection] as unknown[];
}

function isExactObject<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

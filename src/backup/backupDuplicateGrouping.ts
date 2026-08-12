import type { Trade } from "@/core/models";
import { toDecimalString } from "@/core/shared";
import { getLedgerDateKey } from "@/core/shared";

export type IndexedBackupTrade = Readonly<{
  originalIndex: number;
  trade: Readonly<Trade>;
}>;

export type BackupDuplicateSuspicionLevel = "high" | "general";

export type BackupDuplicateTriggerEdge = Readonly<{
  leftIndex: number;
  rightIndex: number;
  relation: "same-exact-time" | "same-day-with-day-precision";
}>;

export type SuspiciousBackupTradeGroup = Readonly<{
  level: BackupDuplicateSuspicionLevel;
  tradeIndices: readonly number[];
  tradePaths: readonly `trades[${number}]`[];
  tradeIds: readonly string[];
  /**
   * A deterministic linear-size witness set of real suspicious relations.
   *
   * This is intentionally not every pair in a clique. Every member is linked
   * by actual edges, while N identical trades need only N - 1 edges.
   */
  triggerEdges: readonly BackupDuplicateTriggerEdge[];
}>;

type Candidate = Readonly<{
  node: number;
  originalIndex: number;
  trade: Readonly<Trade>;
  dateKey: string;
  exactTimeKey?: string;
  feeKey: string;
}>;

type InternalEdge = Readonly<{
  left: Candidate;
  right: Candidate;
  relation: BackupDuplicateTriggerEdge["relation"];
}>;

/**
 * Groups suspicious historical trades without changing the candidate ledger.
 *
 * Entries whose ID occurs more than once are excluded completely: duplicate
 * identifiers belong to the hard-error layer and must not be reframed as a
 * warning that a user could confirm past.
 */
export function groupSuspiciousBackupTrades(
  indexedTrades: readonly IndexedBackupTrade[],
): readonly SuspiciousBackupTradeGroup[] {
  const idCounts = countTradeIds(indexedTrades);
  const eligibleTrades = [...indexedTrades]
    .filter(({ trade }) => idCounts.get(trade.id) === 1)
    .sort((left, right) => left.originalIndex - right.originalIndex);

  const candidatesByCore = new Map<string, Candidate[]>();
  const candidates: Candidate[] = [];

  for (const indexedTrade of eligibleTrades) {
    const candidate = createCandidate(indexedTrade, candidates.length);
    candidates.push(candidate);

    const coreKey = createCoreKey(indexedTrade.trade);
    const bucket = candidatesByCore.get(coreKey);
    if (bucket) {
      bucket.push(candidate);
    } else {
      candidatesByCore.set(coreKey, [candidate]);
    }
  }

  const edges: InternalEdge[] = [];
  for (const bucket of candidatesByCore.values()) {
    collectLinearWitnessEdges(bucket, edges);
  }

  if (edges.length === 0) {
    return [];
  }

  const disjointSet = new DisjointSet(candidates.length);
  const touchedNodes = new Set<number>();
  for (const edge of edges) {
    disjointSet.union(edge.left.node, edge.right.node);
    touchedNodes.add(edge.left.node);
    touchedNodes.add(edge.right.node);
  }

  const membersByRoot = new Map<number, Candidate[]>();
  for (const candidate of candidates) {
    if (!touchedNodes.has(candidate.node)) {
      continue;
    }

    const root = disjointSet.find(candidate.node);
    const members = membersByRoot.get(root);
    if (members) {
      members.push(candidate);
    } else {
      membersByRoot.set(root, [candidate]);
    }
  }

  const edgesByRoot = new Map<number, InternalEdge[]>();
  for (const edge of edges) {
    const root = disjointSet.find(edge.left.node);
    const groupEdges = edgesByRoot.get(root);
    if (groupEdges) {
      groupEdges.push(edge);
    } else {
      edgesByRoot.set(root, [edge]);
    }
  }

  return [...membersByRoot.entries()]
    .map(([root, members]) => createGroup(members, edgesByRoot.get(root) ?? []))
    .sort(
      (left, right) =>
        (left.tradeIndices[0] ?? 0) - (right.tradeIndices[0] ?? 0),
    );
}

function countTradeIds(
  indexedTrades: readonly IndexedBackupTrade[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const { trade } of indexedTrades) {
    counts.set(trade.id, (counts.get(trade.id) ?? 0) + 1);
  }
  return counts;
}

function createCandidate(
  indexedTrade: IndexedBackupTrade,
  node: number,
): Candidate {
  const { trade } = indexedTrade;
  const dateKey = getLedgerDateKey(trade.occurredAt);

  return {
    node,
    originalIndex: indexedTrade.originalIndex,
    trade,
    dateKey,
    feeKey: JSON.stringify([
      toDecimalString(trade.fee),
      trade.feeCurrency,
    ]),
    ...(trade.timePrecision === "day"
      ? {}
      : { exactTimeKey: createExactTimeKey(trade.occurredAt) }),
  };
}

function createCoreKey(trade: Readonly<Trade>): string {
  return JSON.stringify([
    trade.type,
    trade.assetSymbol,
    toDecimalString(trade.quantity),
    toDecimalString(trade.price),
    toDecimalString(trade.totalValue),
    trade.currency,
  ]);
}

function createExactTimeKey(
  occurredAt: string,
): string | undefined {
  if (!occurredAt.includes("T")) {
    return undefined;
  }

  const instant = Date.parse(occurredAt);
  if (Number.isNaN(instant)) {
    return undefined;
  }

  // Exact records compare their real instant. Source-date semantics apply only
  // when at least one endpoint has day precision.
  return String(instant);
}

function collectLinearWitnessEdges(
  bucket: readonly Candidate[],
  edges: InternalEdge[],
): void {
  const candidatesByDate = groupBy(bucket, (candidate) => candidate.dateKey);
  for (const sameDateCandidates of candidatesByDate.values()) {
    const dayAnchor = sameDateCandidates.find(
      ({ trade }) => trade.timePrecision === "day",
    );
    if (!dayAnchor) {
      continue;
    }

    for (const candidate of sameDateCandidates) {
      if (candidate.node !== dayAnchor.node) {
        edges.push({
          left: dayAnchor,
          right: candidate,
          relation: "same-day-with-day-precision",
        });
      }
    }
  }

  const preciseCandidates = bucket.filter(
    (candidate) => candidate.exactTimeKey !== undefined,
  );
  const candidatesByExactTime = groupBy(
    preciseCandidates,
    (candidate) => candidate.exactTimeKey as string,
  );
  for (const sameTimeCandidates of candidatesByExactTime.values()) {
    if (sameTimeCandidates.length < 2) {
      continue;
    }

    const anchor = sameTimeCandidates[0];
    for (let index = 1; index < sameTimeCandidates.length; index += 1) {
      edges.push({
        left: anchor,
        right: sameTimeCandidates[index],
        relation: "same-exact-time",
      });
    }
  }
}

function groupBy<T>(
  values: readonly T[],
  getKey: (value: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = getKey(value);
    const group = groups.get(key);
    if (group) {
      group.push(value);
    } else {
      groups.set(key, [value]);
    }
  }
  return groups;
}

function createGroup(
  unsortedMembers: readonly Candidate[],
  edges: readonly InternalEdge[],
): SuspiciousBackupTradeGroup {
  const members = [...unsortedMembers].sort(
    (left, right) => left.originalIndex - right.originalIndex,
  );
  const groupEdges = edges.map(toPublicEdge).sort(compareEdges);
  const firstFeeKey = members[0].feeKey;

  return {
    level: members.every((member) => member.feeKey === firstFeeKey)
      ? "high"
      : "general",
    tradeIndices: members.map((member) => member.originalIndex),
    tradePaths: members.map(
      (member) => `trades[${member.originalIndex}]` as const,
    ),
    tradeIds: members.map((member) => member.trade.id),
    triggerEdges: groupEdges,
  };
}

function toPublicEdge(edge: InternalEdge): BackupDuplicateTriggerEdge {
  return {
    leftIndex: Math.min(edge.left.originalIndex, edge.right.originalIndex),
    rightIndex: Math.max(edge.left.originalIndex, edge.right.originalIndex),
    relation: edge.relation,
  };
}

function compareEdges(
  left: BackupDuplicateTriggerEdge,
  right: BackupDuplicateTriggerEdge,
): number {
  return (
    left.leftIndex - right.leftIndex ||
    left.rightIndex - right.rightIndex ||
    left.relation.localeCompare(right.relation)
  );
}

class DisjointSet {
  private readonly parents: number[];

  constructor(size: number) {
    this.parents = Array.from({ length: size }, (_, index) => index);
  }

  find(node: number): number {
    const parent = this.parents[node];
    if (parent !== node) {
      this.parents[node] = this.find(parent);
    }
    return this.parents[node];
  }

  union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.parents[rightRoot] = leftRoot;
    }
  }
}

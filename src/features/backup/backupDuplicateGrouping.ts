/**
 * 这个文件管一件事：找出 B 里疑似记了两次的买卖。
 * 它只提醒，不改、不删、不合并任何一笔；要不要导入由人决定。
 * 不显然的决定：编号重复的交易不进这里，算硬错误；2026-07-31 定（W11 03A 第 4.5 节）。
 */
import type { Trade } from "@/core/models";
import { toDecimalString } from "@/core/shared";
import { getLedgerDateKey } from "@/core/shared";

/** 一笔交易，加上它在 B 文件 `trades` 里的原位置。 */
export type IndexedBackupTrade = Readonly<{
  originalIndex: number;
  trade: Readonly<Trade>;
}>;

/** 疑似重复的程度：`high` 是手续费也一样，`general` 是手续费不一样。 */
export type BackupDuplicateSuspicionLevel = "high" | "general";

/**
 * 两笔交易为什么被认为疑似重复。
 * 记着它们的原位置和触发的那条时间规则。
 */
export type BackupDuplicateTriggerEdge = Readonly<{
  leftIndex: number;
  rightIndex: number;
  relation: "same-exact-time" | "same-day-with-day-precision";
}>;

/** 一组疑似重复的交易：程度、原位置、编号、触发的关系。 */
export type SuspiciousBackupTradeGroup = Readonly<{
  level: BackupDuplicateSuspicionLevel;
  tradeIndices: readonly number[];
  tradePaths: readonly `trades[${number}]`[];
  tradeIds: readonly string[];
  /**
   * 只记最少几条真实的触发关系，不把组里两两都列出来。
   * N 笔一模一样的交易，只记 N - 1 条。
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
 * 这个函数回答：这些交易里，哪些疑似是同一笔记了两次？
 * 比较日期时间、买卖、币、数量、单价、成交金额、币种。
 * 编号、备注、原始文字、创建时间不比。
 * 举例：两笔都是 2026-07-01 买 0.1 BTC、单价 65000、成交 6500。
 * → 答一组；手续费也一样就是 `high`，不一样就是 `general`。
 * 两笔都精确到秒、但时刻不同：不算重复。
 * 至少一笔只记到天、且同一天：算疑似。
 * 为什么编号重复的不放进来：那是硬错误。
 * 不能让人点一下确认就放过。
 * 这条 2026-07-31 定（W11 03A 第 4.5 节）。
 * 不会出错。
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

  // 精确时刻的记录比真实时刻。
  // 只要有一笔只记到天，才按记录那天的日期比。
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
    (left.relation < right.relation
      ? -1
      : left.relation > right.relation
        ? 1
        : 0)
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

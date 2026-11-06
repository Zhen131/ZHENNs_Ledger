/**
 * 这个文件是全仓唯一一份「两笔记录谁排前面」的规矩。
 * 它不管一笔记录算哪一天，那在 ledgerDate.ts。
 * 它也不管表单怎么存时刻，那在 factMoment.ts。
 * 不显然的决定：只记到天的记录排在当地那一天的开头，2026-09-07 定（W16 03A 第二节 D-1c）。
 */

import type { PriceSnapshot } from "@/core/models";

import { getLedgerDateKey } from "./ledgerDate";
import { resolveWallTimeInTimeZone } from "./timeZone";

type LedgerFactOrderKind =
  | "trade"
  | "cash-event"
  | "asset-transfer"
  | "price-snapshot";

/**
 * 排序时要看的五样东西。
 * 它们是时刻、地点、录入时间、种类、编号。
 */
type LedgerFactOrderInput = Readonly<{
  occurredAt: string;
  occurredTimeZone?: string;
  createdAt?: string;
  kind?: LedgerFactOrderKind;
  id?: string;
}>;

const FALLBACK_ORDER_TIME_ZONE = "UTC";
/**
 * 当地零点不存在时，往后逐分钟找的范围：4 小时。
 * 为什么是 4 小时：这是猜的，日志里没写，要核。
 */
const MINUTES_SCANNED_FOR_A_MISSING_LOCAL_MIDNIGHT = 4 * 60;

/**
 * 记住算过的「某地某天从哪个时刻开始」。
 * 每次现算很慢，所以记下来。
 * 同一天、同一地点永远算出同一个时刻，所以记住不会出错。
 */
const localDayStartInstants = new Map<string, number>();

/**
 * 这个函数回答：排序时，这一笔按哪个时刻排？
 * 记到分钟的，就按它自己的时刻；只记到天的，按当地那一天的开头。
 * 没记地点的，按 UTC 那一天的开头。
 * 举例："2026-08-20"、Asia/Shanghai → 答 2026-08-19T16:00:00Z 那一刻。
 *
 * 为什么排在一天开头：同一天记了时刻的几笔会排在它后面，2026-09-07 定（W16 03A 第二节 D-1c、D-1d）。
 * 结果只看这一笔自己。
 * 不看设备时区、当前时间和传进来的顺序（同节 D-1e）。
 */
export function getLedgerFactSortInstant(fact: LedgerFactOrderInput): number {
  if (fact.occurredAt.length > 10) {
    return Date.parse(fact.occurredAt);
  }

  return getLocalDayStartInstant(
    getLedgerDateKey(fact.occurredAt),
    fact.occurredTimeZone ?? FALLBACK_ORDER_TIME_ZONE,
  );
}

/**
 * 这个函数回答：两笔记录谁排前面？负数左边先，正数右边先。
 * 先比时刻；一样就比录入时间；再一样，买卖排在别的记录前面；最后比编号。
 * 举例：同一天只记到天的入金和买入，录入时间也相同。
 * → 答买入在前。
 *
 * 为什么只有这一份：以前三处各写一份，规则还不一样。
 * 2026-09-07 定（W16 03A 第二节 D-2、D-4）。
 * 结果和传进来的先后无关，不拿数组下标当判据（同节 D-2c）。
 */
export function compareLedgerFactOrder(
  left: LedgerFactOrderInput,
  right: LedgerFactOrderInput,
): number {
  const instantOrder =
    getLedgerFactSortInstant(left) - getLedgerFactSortInstant(right);
  if (instantOrder !== 0) {
    return instantOrder;
  }

  if (left.createdAt !== undefined && right.createdAt !== undefined) {
    const createdAtOrder =
      Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (createdAtOrder !== 0) {
      return createdAtOrder;
    }
  }

  if (left.kind !== right.kind) {
    if (left.kind === "trade") return -1;
    if (right.kind === "trade") return 1;
  }

  return (left.id ?? "").localeCompare(right.id ?? "", "en");
}

/**
 * 这个函数把一条记下来的价格，变成排序要看的那几样东西。
 * 记下来的价格把时刻叫 recordedAt，别的记录叫 occurredAt；只在这里把两个名字对上。
 * 举例：recordedAt "2026-08-20" → 答 occurredAt "2026-08-20"、种类是价格。
 */
export function toPriceSnapshotOrderInput(
  snapshot: PriceSnapshot,
): LedgerFactOrderInput {
  return {
    occurredAt: snapshot.recordedAt,
    ...(snapshot.occurredTimeZone === undefined
      ? {}
      : { occurredTimeZone: snapshot.occurredTimeZone }),
    createdAt: snapshot.createdAt,
    kind: "price-snapshot",
    id: snapshot.id,
  };
}

function getLocalDayStartInstant(dateKey: string, timeZone: string): number {
  const utcMidnight = Date.parse(`${dateKey}T00:00:00Z`);
  if (timeZone === FALLBACK_ORDER_TIME_ZONE) {
    return utcMidnight;
  }

  const cacheKey = `${dateKey} ${timeZone}`;
  const cached = localDayStartInstants.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const resolved =
    resolveLocalDayStartInstant(dateKey, timeZone) ?? utcMidnight;
  localDayStartInstants.set(cacheKey, resolved);
  return resolved;
}

/**
 * 为什么要找那天第一个存在的时刻：有的地点在零点拨钟。
 * 那天就没有 00:00。
 * 这时取那天第一个真实存在的时刻。
 * 地点认不出，就退回 UTC 零点。
 * 排序永远不许抛错，2026-09-07 定（W16 03A 修订 A 第一节 D-1c′、D-1c″）。
 */
function resolveLocalDayStartInstant(
  dateKey: string,
  timeZone: string,
): number | undefined {
  try {
    for (
      let minute = 0;
      minute <= MINUTES_SCANNED_FOR_A_MISSING_LOCAL_MIDNIGHT;
      minute += 1
    ) {
      const hours = String(Math.floor(minute / 60)).padStart(2, "0");
      const minutes = String(minute % 60).padStart(2, "0");
      const candidates = resolveWallTimeInTimeZone(
        `${dateKey}T${hours}:${minutes}:00`,
        timeZone,
      );
      if (candidates.length > 0) {
        return candidates[0].instant.getTime();
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

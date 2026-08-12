import type {
  ISODateString,
  ISODateTimeString,
} from "@/core/models";

const LEDGER_DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}/;

export type LedgerClock = {
  now(): Date;
};

export type LedgerTimeSnapshot = Readonly<{
  now: Date;
  todayKey: ISODateString;
}>;

/**
 * 从 LedgerClock 捕获单一时刻，并从同一个 Date 派生本地日期。
 *
 * invariant：同一次业务操作的时间戳和“今天”必须来自同一次 clock.now()。
 */
export function captureLedgerTime(clock: LedgerClock): LedgerTimeSnapshot {
  const now = clock.now();
  return {
    now,
    todayKey: formatLocalDateKey(now),
  };
}

export function getLedgerDateKey(
  value: ISODateString | ISODateTimeString | string,
): ISODateString {
  const match = LEDGER_DATE_KEY_PATTERN.exec(value);

  if (!match) {
    throw new Error(`Ledger fact does not start with YYYY-MM-DD: ${value}`);
  }

  return match[0];
}

export function formatLocalDateKey(date: Date): ISODateString {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createSystemLedgerClock(
  now: () => Date = () => new Date(),
): LedgerClock {
  return { now };
}

export const systemLedgerClock = createSystemLedgerClock();

export function millisecondsUntilNextLocalMidnight(now: Date): number {
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );
  return Math.max(1, nextMidnight.getTime() - now.getTime());
}

export function isLedgerFactInFuture(
  value: string,
  todayKey: string,
): boolean {
  return getLedgerDateKey(value) > todayKey;
}

export function compareLedgerFactOrder(
  left: string,
  right: string,
  leftIndex: number,
  rightIndex: number,
): number {
  const leftDate = getLedgerDateKey(left);
  const rightDate = getLedgerDateKey(right);

  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  const leftHasTime = left.length > 10;
  const rightHasTime = right.length > 10;

  if (leftHasTime && rightHasTime) {
    const timeOrder = Date.parse(left) - Date.parse(right);
    if (timeOrder !== 0) {
      return timeOrder;
    }
  }

  return leftIndex - rightIndex;
}

export function addLedgerDays(
  dateKey: string,
  amount: number,
): ISODateString {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
}

export function enumerateLedgerDays(
  startDateKey: string,
  endDateKey: string,
): ISODateString[] {
  const days: ISODateString[] = [];
  for (
    let dateKey = startDateKey;
    dateKey <= endDateKey;
    dateKey = addLedgerDays(dateKey, 1)
  ) {
    days.push(dateKey);
  }
  return days;
}

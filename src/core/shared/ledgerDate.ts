/**
 * 这个文件管账本里的「今天」和「哪一天」。
 * 它负责取当前时刻、取日期、按天往前往后数。
 * 它不管两笔记录谁排前面（那在 ledgerFactOrder.ts），也不管时区换算（那在 timeZone.ts）。
 * 不显然的决定：哪一天只看文字前 10 位的当地日期。
 * 2026-09-07 定（W16 03A 第二节 D-3a）。
 */

import type {
  ISODateString,
  ISODateTimeString,
} from "@/core/models";

const LEDGER_DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}/;

/** 账本用的钟：能问现在几点，也能问设备在哪个时区。测试里可以换成假的钟。 */
export type LedgerClock = {
  now(): Date;
  timeZone?(): string;
};

/** 同一次取到的当前时刻和「今天」日期，两个总是配套。 */
export type LedgerTimeSnapshot = Readonly<{
  now: Date;
  todayKey: ISODateString;
}>;

/**
 * 这个函数回答：现在是哪个时刻，今天是哪一天？
 * 两个答案来自同一次看钟。
 * 所以不会一个是昨天、一个是今天。
 * 举例：设备时间 2026-11-06 23:59:59 → 答这个时刻和 "2026-11-06"。
 *
 * 为什么要同一次看钟：跨午夜分两次看，时间和日期会对不上。
 * （这是猜的，日志里没写，要核。）
 */
export function captureLedgerTime(clock: LedgerClock): LedgerTimeSnapshot {
  const now = clock.now();
  return {
    now,
    todayKey: formatLocalDateKey(now),
  };
}

/**
 * 这个函数回答：一笔记录算哪一天？只取它文字的前 10 位。
 * 举例："2026-08-20T05:40:32+08:00" → 答 "2026-08-20"。
 *
 * 为什么只取前 10 位、不换算时区：哪一天按当地日期算。
 * 这个口径一个字不许动。2026-09-07 定（W16 03A 第二节 D-3a）。
 *
 * 开头不是「年-月-日」时抛错。
 */
export function getLedgerDateKey(
  value: ISODateString | ISODateTimeString | string,
): ISODateString {
  const match = LEDGER_DATE_KEY_PATTERN.exec(value);

  if (!match) {
    throw new Error(`Ledger fact does not start with YYYY-MM-DD: ${value}`);
  }

  return match[0];
}

function formatLocalDateKey(date: Date): ISODateString {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 这个函数做一个真的钟：时间默认问电脑，时区问浏览器。
 * 举例：在布达佩斯的电脑上，时区答 "Europe/Budapest"。
 */
export function createSystemLedgerClock(
  now: () => Date = () => new Date(),
): LedgerClock {
  return {
    now,
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/**
 * 这个函数回答钟所在的时区；钟答不上来就当 UTC。
 * 举例：假钟没有时区 → 答 "UTC"。
 */
export function getLedgerTimeZone(clock: LedgerClock): string {
  return clock.timeZone?.() ?? "UTC";
}

/** 程序平时用的那一个真钟，所有界面共用。 */
export const systemLedgerClock = createSystemLedgerClock();

/**
 * 这个函数回答：离本地下一个零点还有多少毫秒，最少答 1。
 * 举例：现在 23:59:59.000 → 答 1000。
 */
export function millisecondsUntilNextLocalMidnight(now: Date): number {
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );
  return Math.max(1, nextMidnight.getTime() - now.getTime());
}

/**
 * 这个函数回答：一笔记录的日期是不是比今天晚。
 * 举例：记录日期 2026-11-07，今天 2026-11-06 → 答是。
 * 记录开头不是日期时抛错。
 */
export function isLedgerFactInFuture(
  value: string,
  todayKey: string,
): boolean {
  return getLedgerDateKey(value) > todayKey;
}

/**
 * 这个函数回答：某一天往后（或往前）数几天是哪一天。
 * 举例："2026-02-27" 加 2 天 → 答 "2026-03-01"。
 */
export function addLedgerDays(
  dateKey: string,
  amount: number,
): ISODateString {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
}

/**
 * 这个函数列出从开始日到结束日的每一天，两头都算。
 * 举例："2026-08-30" 到 "2026-09-01" → 答三天。
 * 开始日比结束日晚时答空列表。
 */
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

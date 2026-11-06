/**
 * 这个文件管一件事：一个日期或日期时间的写法对不对。
 * 它不管这个日期是不是在未来，那在 ledgerDate.ts 和各检查函数里。
 * 不显然的决定：先自己逐段查日历，再交给 Date.parse。这是猜的，日志里没写，要核。
 */

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/;

/**
 * 这个函数回答：这是合法的日期或带时差的日期时间吗？
 * 举例："2026-02-30" → 答不合法；"2026-08-20T05:40:32+08:00" → 答合法。
 * 不带时差的日期时间（没有 Z 或 +08:00）也答不合法。
 *
 * 为什么不直接用 Date.parse：它会把 2026-02-30 悄悄滚到 3 月 2 日。
 * 所以先逐段查日历和时间，最后才让 Date.parse 再确认一次。
 * （这个做法日志里没写来历，这是猜的，要核。）
 * 不会抛错，不合法就答 false。
 */
export function isValidISODateOrDateTime(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const dateMatch = ISO_DATE_PATTERN.exec(value);
  if (dateMatch) {
    return isValidCalendarDate(
      Number(dateMatch[1]),
      Number(dateMatch[2]),
      Number(dateMatch[3]),
    );
  }

  const dateTimeMatch = ISO_DATETIME_PATTERN.exec(value);
  if (!dateTimeMatch) {
    return false;
  }

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    offsetHourText,
    offsetMinuteText,
  ] = dateTimeMatch;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour =
    offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute =
    offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);

  return (
    isValidCalendarDate(
      Number(yearText),
      Number(monthText),
      Number(dayText),
    ) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59 &&
    offsetHour >= 0 &&
    offsetHour <= 23 &&
    offsetMinute >= 0 &&
    offsetMinute <= 59 &&
    !Number.isNaN(Date.parse(value))
  );
}

function isValidCalendarDate(
  year: number,
  month: number,
  day: number,
): boolean {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1
  ) {
    return false;
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

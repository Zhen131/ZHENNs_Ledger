const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/;

/**
 * 接受严格的 YYYY-MM-DD 或带时区的 ISO datetime。
 *
 * Date.parse 会把 2026-02-30 等无效日期自动滚动到三月，
 * 因此这里先逐段校验日历与时间，再用 Date.parse 做最终确认。
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

type ZonedDateTimeParts = Readonly<{
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}>;

/**
 * Returns the UTC offset that applied in an IANA zone at an exact instant.
 * This deliberately delegates seasonal rules to the runtime's IANA database.
 */
export function getTimeZoneOffsetAt(
  instant: Date,
  timeZone: string,
): string {
  assertValidInstant(instant);

  const offset = new Intl.DateTimeFormat("en", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;

  if (offset === "GMT") {
    return "+00:00";
  }

  if (!offset || !/^GMT[+-]\d{2}:\d{2}$/.test(offset)) {
    throw new RangeError(`Could not resolve an offset for time zone: ${timeZone}`);
  }

  return offset.slice(3);
}

/**
 * Converts an exact instant to an RFC 3339-like wall-clock string in an IANA zone.
 */
export function formatWallTimeInTimeZone(
  instant: Date,
  timeZone: string,
): string {
  assertValidInstant(instant);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const fields = readZonedDateTimeParts(parts);

  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}:${fields.second}${getTimeZoneOffsetAt(instant, timeZone)}`;
}

export function isSupportedTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch (error) {
    return error instanceof RangeError ? false : (() => { throw error; })();
  }
}

function readZonedDateTimeParts(
  parts: Intl.DateTimeFormatPart[],
): ZonedDateTimeParts {
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const keys = ["year", "month", "day", "hour", "minute", "second"] as const;

  for (const key of keys) {
    if (!values.has(key)) {
      throw new RangeError(`Missing ${key} while formatting a time zone`);
    }
  }

  return {
    year: values.get("year")!,
    month: values.get("month")!,
    day: values.get("day")!,
    hour: values.get("hour")!,
    minute: values.get("minute")!,
    second: values.get("second")!,
  };
}

function assertValidInstant(instant: Date): void {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("A valid instant is required");
  }
}

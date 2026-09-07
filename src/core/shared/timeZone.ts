type ZonedDateTimeParts = Readonly<{
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}>;

export type WallTimeCandidate = Readonly<{
  instant: Date;
  offset: string;
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

/**
 * Resolves every exact instant which the runtime formats as a supplied wall
 * time in an IANA zone. A spring-forward gap has no candidates; a fall-back
 * overlap has two. This uses only the runtime IANA database and fixed input.
 */
export function resolveWallTimeInTimeZone(
  wallTime: string,
  timeZone: string,
): WallTimeCandidate[] {
  const naiveInstant = new Date(`${wallTime}Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(wallTime) ||
    Number.isNaN(naiveInstant.getTime()) ||
    formatWallTimeInTimeZone(naiveInstant, "UTC").slice(0, -6) !== wallTime
  ) {
    throw new RangeError("A valid offset-free wall time is required");
  }

  const offsets = new Set<string>();
  for (
    let milliseconds = naiveInstant.getTime() - 36 * 60 * 60 * 1000;
    milliseconds <= naiveInstant.getTime() + 36 * 60 * 60 * 1000;
    milliseconds += 30 * 60 * 1000
  ) {
    offsets.add(getTimeZoneOffsetAt(new Date(milliseconds), timeZone));
  }

  const candidates = [...offsets]
    .map((offset) => {
      const offsetMinutes = parseOffsetMinutes(offset);
      return {
        instant: new Date(naiveInstant.getTime() - offsetMinutes * 60 * 1000),
        offset,
      };
    })
    .filter(({ instant }) =>
      formatWallTimeInTimeZone(instant, timeZone).slice(0, -6) === wallTime,
    )
    .sort((left, right) => left.instant.getTime() - right.instant.getTime());

  return candidates;
}

export function isSupportedTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
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

function parseOffsetMinutes(offset: string): number {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) throw new RangeError(`Invalid UTC offset: ${offset}`);

  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "+" ? minutes : -minutes;
}

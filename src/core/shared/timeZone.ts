/**
 * 这个文件管时区换算。
 * 它回答某一刻在某地是几点，也回答某地的几点是哪一刻。
 * 它不管表单怎么用这些结果（那在 factMoment.ts），也不管排序（那在 ledgerFactOrder.ts）。
 * 不显然的决定：夏令时规则交给浏览器自带的时区库。
 * 2026-09-06 定（W16 时间与时区决策记录第四节）。
 */

type ZonedDateTimeParts = Readonly<{
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}>;

type WallTimeCandidate = Readonly<{
  instant: Date;
  offset: string;
}>;

/**
 * 这个函数回答：某一刻在某地，当地时间比 UTC 快或慢多少。
 * 举例：2026-07-01 中午在 Europe/Budapest → 答 "+02:00"；1 月同一时刻 → 答 "+01:00"。
 * 地点认不出或时刻无效时抛错。
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
 * 这个函数回答：某一刻在某地的钟面上是几点。
 * 答案连同时差一起写出来。
 * 举例：2026-08-19T21:40:32Z 在 Asia/Shanghai → 答 "2026-08-20T05:40:32+08:00"。
 * 时刻无效或地点认不出时抛错。
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
 * 这个函数回答：某地钟面上的这个时间，对应哪几个真实时刻？
 * 举例：Europe/Budapest 的 2026-03-29T02:30:00 → 答空，钟跳过了这段。
 * 举例：同地 2026-10-25T02:30:00 → 答两个时刻，这段走了两遍。
 * 时间写法不是「年-月-日T时:分:秒」或日期不存在时抛错。
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

/**
 * 这个函数回答浏览器认不认识这个地点名。
 * 举例："Asia/Shanghai" → 答认识；"Mars/Base" → 答不认识。
 */
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

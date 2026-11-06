/**
 * 这个文件管一件事：交易页上一笔记录的时刻怎么写成字。
 * 它只管显示，不改账本里存的时刻和地点；时刻怎么存在 core 的时间那几个文件里。
 * 不显然的决定：能按记录地点或现在地点看，默认按记录地点。
 * 这条 2026-09-06 定（W16 02A 第二节 D-4d）。
 */
import { formatWallTimeInTimeZone } from "@/core/shared";

/**
 * 时刻按哪个地点显示。
 * `recorded` 按记下来时的地点，也就是账本里存的样子。
 * `current` 把同一个时刻换成看的人现在的钟点。
 */
export type ActivityTimeZoneView = "recorded" | "current";

/**
 * 交易页默认按记录地点显示时刻。
 * 为什么：默认先让人认得出自己写的东西；2026-09-06 定（W16 02A 第二节 D-4d）。
 */
export const DEFAULT_ACTIVITY_TIME_ZONE_VIEW: ActivityTimeZoneView = "recorded";

/**
 * 这个函数回答：按选的看法，这个时刻写成什么字？
 * 换看法只换显示的字，账本里的时刻和地点一个不改。
 * 举例：记的是 2026-08-20T05:40:00+08:00，地点 Asia/Shanghai。
 * 看的人现在在 Europe/Budapest，夏天是 +02:00。
 * → 按记录答 8 月 20 日 05:40，按现在答 8 月 19 日 23:40。
 * 只记到天的记录两种看法都只写日期。
 * 为什么不换算：换了就编出一个没人记过的时间；2026-09-06 定（W16 02A 第二节 D-4c）。
 * 换算出错时，退回按记录地点显示，不抛错。
 */
export function formatOccurredAtForView(
  occurredAt: string,
  occurredTimeZone: string | undefined,
  view: ActivityTimeZoneView,
  currentTimeZone: string,
): string {
  if (view === "recorded" || occurredAt.length === 10) {
    return formatRecordedOccurredAt(occurredAt, occurredTimeZone);
  }

  const instant = new Date(occurredAt);
  if (Number.isNaN(instant.getTime())) {
    return formatRecordedOccurredAt(occurredAt, occurredTimeZone);
  }

  let wallTime: string;
  try {
    wallTime = formatWallTimeInTimeZone(instant, currentTimeZone);
  } catch {
    return formatRecordedOccurredAt(occurredAt, occurredTimeZone);
  }

  return formatRecordedOccurredAt(wallTime, currentTimeZone);
}

/**
 * 这个函数回答：按记录地点，这个时刻写成什么字？
 * 举例：2026-08-20T05:40:00+08:00，地点 Asia/Shanghai。
 * → 答「2026-08-20 05:40 (+08:00) · Asia/Shanghai」，秒不显示。
 * 没有地点就只写时刻和偏移，不猜地点；只记到天就只写日期。
 * 这几条 2026-09-06 定（W16 02A 第二节 D-4a～D-4c）。
 * 认不出的写法原样返回，不会出错。
 */
export function formatRecordedOccurredAt(
  occurredAt: string,
  occurredTimeZone?: string,
): string {
  if (occurredAt.length === 10) return occurredAt;

  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
    occurredAt,
  );
  if (!match) return occurredAt;

  const [, date, time, rawOffset] = match;
  const offset = rawOffset === "Z" ? "+00:00" : rawOffset;
  const place = occurredTimeZone ? ` · ${occurredTimeZone}` : "";
  return `${date} ${time} (${offset})${place}`;
}

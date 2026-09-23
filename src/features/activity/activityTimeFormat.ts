import { formatWallTimeInTimeZone } from "@/core/shared";

/**
 * Which place a recorded moment is shown in. "recorded" shows it in the place
 * it was recorded in, which is what the ledger stores; "current" shows the same
 * moment on the reader's own clock.
 */
export type ActivityTimeZoneView = "recorded" | "current";

export const DEFAULT_ACTIVITY_TIME_ZONE_VIEW: ActivityTimeZoneView = "recorded";

/**
 * Renders a moment in the chosen view. Switching views changes nothing but the
 * text: `occurredAt` and `occurredTimeZone` are read, never written.
 *
 * A fact recorded only to the day has no moment to move, so both views show the
 * same date. Converting it would invent a time nobody recorded.
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

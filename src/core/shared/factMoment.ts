/**
 * 这个文件管一件事：表单上填的日期和时间存成哪个时刻。
 * 它不管排序（那在 ledgerFactOrder.ts），也不管时区怎么换算（那在 timeZone.ts）。
 * 不显然的决定：夏令时切换日的怪时间一律拒绝。2026-09-07 定（W16 02A 修订 A 第二节 D-3g）。
 */

import type { TimePrecision } from "@/core/models";

import { resolveWallTimeInTimeZone } from "./timeZone";

/**
 * 记账时除了设备时区以外，还能选的几个地点。
 * 为什么只有这三个、选了也不记住：地点只管这一次记账。
 * 下次打开回到设备时区。2026-09-06 定（W16 02A 第二节 D-3b、D-3c）。
 */
export const FACT_TIME_ZONE_OPTIONS = [
  "Asia/Shanghai",
  "Europe/Budapest",
  "UTC",
] as const;

type FactMomentDraft = Readonly<{
  occurredAt: string;
  timePrecision: TimePrecision;
  occurredTimeZone?: string;
}>;

/**
 * 这个函数回答一个值是不是认识的时刻精度。
 * 认识的只有三种：只到天、到分钟、到秒。
 * 举例："minute" → 答是；"hour" → 答不是。
 */
export function isTimePrecision(value: unknown): value is TimePrecision {
  return value === "day" || value === "minute" || value === "second";
}

type FactMomentRejection = "nonexistent" | "ambiguous" | "invalid";

type FactMomentResult =
  | Readonly<{ ok: true; value: FactMomentDraft }>
  | Readonly<{ ok: false; reason: FactMomentRejection }>;

/**
 * 这个函数回答：表单上填的日期、时间、地点，存成哪个时刻？
 * 举例：2026-03-29、02:30、Europe/Budapest → 答拒绝，这个时间不存在。
 * 举例：2026-08-20、05:40、Asia/Shanghai → 答 "2026-08-20T05:40:00+08:00"。
 * 时间空着时只存日期，精度是天，不写地点。
 * 这和以前存出来的逐字节一样。
 *
 * 为什么这两种都拒绝：替你挑一个，就存下了你没写的东西。
 * 2026-09-07 定（W16 02A 修订 A 第二节 D-3g）。
 *
 * 出错时不抛错，返回 ok:false 和原因。
 * 原因有三种：不存在、重复两次、格式不对。
 * 表单拿到后拦下这一笔，给出说明。
 */
export function resolveFactMoment(
  date: string,
  time: string,
  timeZone: string,
): FactMomentResult {
  if (time === "") {
    return { ok: true, value: { occurredAt: date, timePrecision: "day" } };
  }

  if (!/^\d{2}:\d{2}$/.test(time) || timeZone === "") {
    return { ok: false, reason: "invalid" };
  }

  try {
    const wallTime = `${date}T${time}:00`;
    const candidates = resolveWallTimeInTimeZone(wallTime, timeZone);
    if (candidates.length === 0) return { ok: false, reason: "nonexistent" };
    if (candidates.length !== 1) return { ok: false, reason: "ambiguous" };
    return {
      ok: true,
      value: {
        occurredAt: `${wallTime}${candidates[0].offset}`,
        occurredTimeZone: timeZone,
        timePrecision: "minute",
      },
    };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

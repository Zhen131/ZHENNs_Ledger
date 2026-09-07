import { describe, expect, it } from "vitest";

import {
  formatWallTimeInTimeZone,
  getTimeZoneOffsetAt,
  isSupportedTimeZone,
  resolveWallTimeInTimeZone,
} from "./timeZone";

describe("timeZone", () => {
  it("uses the offset that applied in Budapest on the supplied winter and summer instants", () => {
    expect(
      getTimeZoneOffsetAt(new Date("2026-01-15T12:00:00Z"), "Europe/Budapest"),
    ).toBe("+01:00");
    expect(
      getTimeZoneOffsetAt(new Date("2026-07-15T12:00:00Z"), "Europe/Budapest"),
    ).toBe("+02:00");
  });

  it("formats an instant as wall time in the requested IANA zone", () => {
    expect(
      formatWallTimeInTimeZone(new Date("2026-08-20T05:40:32Z"), "Asia/Shanghai"),
    ).toBe("2026-08-20T13:40:32+08:00");
    expect(
      formatWallTimeInTimeZone(new Date("2026-08-20T05:40:32Z"), "UTC"),
    ).toBe("2026-08-20T05:40:32+00:00");
  });

  it("recognizes IANA names through the runtime instead of a fixed allow-list", () => {
    expect(isSupportedTimeZone("Asia/Shanghai")).toBe(true);
    expect(isSupportedTimeZone("Europe/Budapest")).toBe(true);
    expect(isSupportedTimeZone("Not/A-Time-Zone")).toBe(false);
  });

  it("resolves a unique Budapest wall time on the spring transition day outside the gap", () => {
    expect(
      resolveWallTimeInTimeZone("2026-03-29T01:30:00", "Europe/Budapest"),
    ).toEqual([
      {
        instant: new Date("2026-03-29T00:30:00Z"),
        offset: "+01:00",
      },
    ]);
  });

  it("finds no instant for a Budapest wall time skipped by the spring transition", () => {
    expect(
      resolveWallTimeInTimeZone("2026-03-29T02:30:00", "Europe/Budapest"),
    ).toEqual([]);
  });

  it("resolves both instants for a Budapest wall time repeated by the autumn transition", () => {
    expect(
      resolveWallTimeInTimeZone("2026-10-25T02:30:00", "Europe/Budapest"),
    ).toEqual([
      {
        instant: new Date("2026-10-25T00:30:00Z"),
        offset: "+02:00",
      },
      {
        instant: new Date("2026-10-25T01:30:00Z"),
        offset: "+01:00",
      },
    ]);
  });

  it.each([
    ["Asia/Shanghai", "2026-03-28T18:30:00Z", "+08:00"],
    ["UTC", "2026-03-29T02:30:00Z", "+00:00"],
  ] as const)("resolves the same wall time uniquely in %s", (timeZone, instant, offset) => {
    expect(resolveWallTimeInTimeZone("2026-03-29T02:30:00", timeZone)).toEqual([
      { instant: new Date(instant), offset },
    ]);
  });
});

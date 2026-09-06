import { describe, expect, it } from "vitest";

import {
  formatWallTimeInTimeZone,
  getTimeZoneOffsetAt,
  isSupportedTimeZone,
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
});

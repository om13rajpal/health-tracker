import { describe, it, expect, afterEach, vi } from "vitest";
import { toIstDateString, istDateRangeUtc, defaultIstHistoryWindow } from "./dates.js";

describe("toIstDateString", () => {
  it("returns the IST calendar date for a UTC instant just before IST midnight", () => {
    // 2026-09-06T18:29:59.000Z is 2026-09-06T23:59:59 IST (UTC+5:30) — still the 6th in IST.
    expect(toIstDateString(new Date("2026-09-06T18:29:59.000Z"))).toBe("2026-09-06");
  });

  it("returns the next IST calendar date once past IST midnight", () => {
    // 2026-09-06T18:30:00.000Z is 2026-09-07T00:00:00 IST — the 7th in IST, still the 6th in UTC.
    expect(toIstDateString(new Date("2026-09-06T18:30:00.000Z"))).toBe("2026-09-07");
  });
});

describe("defaultIstHistoryWindow", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("bounds the window with IST dates when UTC is still on the previous day", () => {
    // 2026-09-06T20:00:00Z is 2026-09-07T01:30 IST — inside the 00:00-05:29 IST
    // window where the UTC date lags the IST date by one day.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T20:00:00.000Z"));

    const { from, to } = defaultIstHistoryWindow(30);

    expect(to).toBe("2026-09-07"); // not "2026-09-06" — today's IST rows must be included
    expect(from).toBe("2026-08-08");
  });

  it("agrees with UTC outside the offset window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T10:00:00.000Z"));

    expect(defaultIstHistoryWindow(30).to).toBe("2026-09-06");
  });
});

describe("istDateRangeUtc", () => {
  it("returns the UTC instants bounding IST midnight-to-midnight for the given date", () => {
    const { start, end } = istDateRangeUtc("2026-09-06");
    // IST 2026-09-06T00:00:00 == UTC 2026-09-05T18:30:00
    expect(start.toISOString()).toBe("2026-09-05T18:30:00.000Z");
    // IST 2026-09-07T00:00:00 (exclusive end) == UTC 2026-09-06T18:30:00
    expect(end.toISOString()).toBe("2026-09-06T18:30:00.000Z");
  });
});

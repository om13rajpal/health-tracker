import { describe, it, expect } from "vitest";
import { getTodayLocal } from "./date";

describe("getTodayLocal", () => {
  it("returns the IST date, not the UTC date, when UTC is still on the previous day", () => {
    // IST = UTC + 5:30. IST midnight on 2026-09-07 is UTC 2026-09-06T18:30:00.000Z.
    // 2026-09-06T20:00:00.000Z is after that rollover:
    //   2026-09-06T20:00:00.000Z + 5:30 = 2026-09-07T01:30:00.000Z (IST)
    // A naive `date.toISOString().slice(0, 10)` on the raw UTC instant would
    // incorrectly return "2026-09-06" (still the UTC day), even though it is
    // already "2026-09-07" for the IST user.
    const utcInstant = new Date("2026-09-06T20:00:00.000Z");

    expect(utcInstant.toISOString().slice(0, 10)).toBe("2026-09-06");
    expect(getTodayLocal(utcInstant)).toBe("2026-09-07");
  });

  it("agrees with the naive UTC slice when the instant is well within the same IST day", () => {
    // 2026-09-06T10:00:00.000Z + 5:30 = 2026-09-06T15:30:00.000Z (IST),
    // far from either day boundary, so both approaches return the same date.
    const utcInstant = new Date("2026-09-06T10:00:00.000Z");

    expect(getTodayLocal(utcInstant)).toBe("2026-09-06");
    expect(utcInstant.toISOString().slice(0, 10)).toBe("2026-09-06");
  });
});

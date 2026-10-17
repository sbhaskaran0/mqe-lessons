// The Leitner schedule is pure and takes the clock as an argument, so these tests name their own dates.
import { describe, expect, it } from "vitest";
import { dueEntries, enter, INTERVAL_DAYS, isDue, nextDue, review, startOfDay, type Leitner, type LeitnerEntry } from "../../src/review/leitner";

// Local times, because "start of day" is local.
const at = (day: number, hour = 15) => new Date(2026, 9, day, hour, 30).getTime();
const midnight = (day: number) => new Date(2026, 9, day).getTime();

describe("startOfDay", () => {
  it("is local midnight, and counts calendar days", () => {
    expect(startOfDay(at(16))).toBe(midnight(16));
    expect(startOfDay(at(16, 0))).toBe(midnight(16));
    expect(startOfDay(at(16), 3)).toBe(midnight(19));
    // Across the month end.
    expect(startOfDay(new Date(2026, 9, 30, 23, 59).getTime(), 3)).toBe(new Date(2026, 10, 2).getTime());
  });
});

describe("enter", () => {
  it("joins at box 1, due at the start of tomorrow", () => {
    expect(enter(undefined, at(16))).toEqual({ box: 1, due: midnight(17), lapses: 0, at: at(16) });
  });

  it("leaves an item already scheduled alone", () => {
    const prev: LeitnerEntry = { box: 3, due: midnight(30), lapses: 2, at: 5 };
    expect(enter(prev, at(16))).toBe(prev);
  });
});

describe("review", () => {
  const entry = (box: LeitnerEntry["box"], lapses = 0): LeitnerEntry => ({ box, due: midnight(16), lapses, at: 1 });

  it("moves a correct answer up a box and sets the next due date from the interval", () => {
    expect(review(entry(1), true, at(16))).toEqual({ box: 2, due: midnight(16 + INTERVAL_DAYS[2]), lapses: 0, at: at(16) });
    expect(review(entry(2), true, at(16))).toMatchObject({ box: 3, due: midnight(23) });
    expect(review(entry(3), true, at(16))).toMatchObject({ box: 4, due: midnight(16 + 21) });
  });

  it("retires an item after a correct answer in the last box", () => {
    expect(review(entry(4), true, at(16))).toBeUndefined();
  });

  it("sends a wrong answer to box 1 tomorrow and counts the lapse", () => {
    expect(review(entry(3, 1), false, at(16))).toEqual({ box: 1, due: midnight(17), lapses: 2, at: at(16) });
    expect(review(entry(1), false, at(16))).toMatchObject({ box: 1, lapses: 1 });
  });

  it("walks the whole ladder: 1, 3, 7 and 21 days", () => {
    let now = at(1);
    let e: LeitnerEntry | undefined = enter(undefined, now);
    const gaps: number[] = [];
    while (e) {
      gaps.push(Math.round((e.due - startOfDay(now)) / 86_400_000));
      now = e.due; // reviewed the morning it falls due, and right every time
      e = review(e, true, now);
    }
    expect(gaps).toEqual([1, 3, 7, 21]);
  });
});

describe("what is due", () => {
  const leitner: Leitner = {
    "a#s#0": { box: 1, due: midnight(16), lapses: 0, at: 1 },
    "b#s#0": { box: 2, due: midnight(14), lapses: 1, at: 1 },
    "c#s#0": { box: 1, due: midnight(17), lapses: 0, at: 1 },
    "d#s#0": { box: 3, due: midnight(20), lapses: 0, at: 1 },
    "e#s#0": { box: 1, due: midnight(14), lapses: 0, at: 1 },
  };

  it("is due from the morning of its day", () => {
    expect(isDue(leitner["a#s#0"]!, midnight(16))).toBe(true);
    expect(isDue(leitner["a#s#0"]!, midnight(16) - 1)).toBe(false);
    expect(isDue(leitner["c#s#0"]!, at(16, 23))).toBe(false);
  });

  it("lists due entries longest overdue first, ties by key", () => {
    expect(dueEntries(leitner, at(16)).map(([k]) => k)).toEqual(["b#s#0", "e#s#0", "a#s#0"]);
  });

  it("can leave entries out", () => {
    expect(dueEntries(leitner, at(16), (k) => k !== "b#s#0").map(([k]) => k)).toEqual(["e#s#0", "a#s#0"]);
  });

  it("names the soonest entry that is not due yet", () => {
    expect(nextDue(leitner, at(16))).toBe(midnight(17));
    expect(nextDue(leitner, at(30))).toBeUndefined();
  });
});

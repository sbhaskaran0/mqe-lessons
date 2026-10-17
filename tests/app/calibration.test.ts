// F5: calibration on the dashboard, the share of answers that were right at each confidence level.
import { describe, expect, it } from "vitest";
import { buildModel } from "../../src/content/model";
import type { Index } from "../../src/ir";
import { buildDashboard, calibration, CALIBRATION_MIN } from "../../src/progress/dashboard";
import { emptyProgress, type ConfidenceLevel, type ProgressData } from "../../src/progress/store";

const rate = (level: ConfidenceLevel, correct: boolean[]) => correct.map((c, i) => ({ level, correct: c, at: i }));
const dataWith = (confidence: ProgressData["confidence"]): ProgressData => ({ ...emptyProgress(), confidence });

describe("calibration", () => {
  it("is empty and not ready without ratings", () => {
    const c = calibration(emptyProgress());
    expect(c).toMatchObject({ total: 0, ready: false, reading: undefined });
    expect(c.rows.map((r) => r.pct)).toEqual([undefined, undefined, undefined]);
  });

  it("computes the percentage right and the count per level, over every key", () => {
    const c = calibration(dataWith({
      a: rate(3, [true, true, false]),
      b: rate(3, [true, true, true, true]),
      c: rate(1, [true, false]),
      d: rate(2, [false]),
    }));
    expect(c.rows.map((r) => [r.label, r.answers, r.right, r.pct])).toEqual([["Guessing", 2, 1, 50], ["Fairly sure", 1, 0, 0], ["Sure", 7, 6, 86]]);
    expect(c.total).toBe(10);
    expect(c.ready).toBe(true);
    expect(c.reading).toBe("When you say Sure you are right 86% of the time.");
  });

  it("is ready from exactly five rated answers", () => {
    expect(CALIBRATION_MIN).toBe(5);
    expect(calibration(dataWith({ a: rate(2, [true, true, true, true]) })).ready).toBe(false);
    expect(calibration(dataWith({ a: rate(2, [true, true, true, true, false]) })).ready).toBe(true);
  });

  it("reads off the most confident level that has answers", () => {
    expect(calibration(dataWith({ a: rate(1, [true]), b: rate(2, [true, false]) })).reading).toBe("When you say Fairly sure you are right 50% of the time.");
  });

  it("rides along on the dashboard", () => {
    const model = buildModel({ courses: [], notes: {}, widgets: {}, datasets: {} } as unknown as Index);
    expect(buildDashboard(model, dataWith({ a: rate(3, [true]) })).calibration.total).toBe(1);
  });
});

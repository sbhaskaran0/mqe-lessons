// The d3-style number formatter used by readouts and slider values.
import { describe, expect, it } from "vitest";
import { auto, format, stepDecimals } from "../../src/widgets/format";

const M = "−";

describe("format", () => {
  it("fixed, percent and grouping, as d3 does them", () => {
    expect(format(".2f", 25)).toBe("25.00");
    expect(format(".3f", 2.5)).toBe("2.500");
    expect(format(".0%", 0.256)).toBe("26%");
    expect(format(".1%", 0.0253)).toBe("2.5%");
    expect(format(",", 1234567)).toBe("1,234,567");
    expect(format(",.2f", 1234.5)).toBe("1,234.50");
    expect(format(",.0f", 999.6)).toBe("1,000");
    expect(format("d", 3.7)).toBe("4");
  });

  it("significant digits, exponents and SI prefixes", () => {
    expect(format(".3r", 0.012345)).toBe("0.0123");
    expect(format(".2e", 12345)).toBe("1.23e+4");
    expect(format(".3s", 12345)).toBe("12.3k");
    expect(format(".2s", 0.00042)).toBe("420µ");
    expect(format(".3g", 0.5)).toBe("0.500");
    expect(format(".2p", 0.1234)).toBe("12%");
  });

  it("signs: typographic minus, no negative zero, explicit plus and parentheses", () => {
    expect(format(".2f", -1.5)).toBe(`${M}1.50`);
    expect(format(".2f", -0.001)).toBe("0.00");
    expect(format("+.1f", 2)).toBe("+2.0");
    expect(format("(.2f", -1.5)).toBe("(1.50)");
    expect(format(",.2f", -1234.5)).toBe(`${M}1,234.50`);
  });

  it("trims insignificant zeros with ~", () => {
    expect(format(".3~f", 2.5)).toBe("2.5");
    expect(format(".3~f", 2)).toBe("2");
    expect(format(".4~r", 25.0001)).toBe("25");
  });

  it("pads to a width", () => {
    expect(format("08.2f", 3.14159)).toBe("00003.14");
    expect(format(">8.1f", 3.14159)).toBe("     3.1");
    expect(format("<6.1f", 3.14159)).toBe("3.1   ");
    expect(format("$,.2f", 1234.5)).toBe("$1,234.50");
  });

  it("falls back to the automatic format for a missing or unreadable specifier", () => {
    expect(format(undefined, 25)).toBe("25");
    expect(format("", 0.0253206)).toBe("0.02532");
    expect(format("not a format", 12345.678)).toBe("12,350");
    expect(auto(2.5)).toBe("2.5");
    expect(auto(1e-7)).toBe("1e-7");
    expect(auto(NaN)).toBe("—");
    expect(auto(-Infinity)).toBe(`${M}∞`);
  });

  it("derives slider decimals from the step", () => {
    expect([0.005, 0.01, 0.25, 5, 1e-7].map(stepDecimals)).toEqual([3, 2, 2, 0, 7]);
  });
});

// The dataset reader: RFC 4180 CSV (quotes, embedded commas and line breaks, CRLF, BOM), column typing, JSON shapes.
import { describe, expect, it } from "vitest";
import { numbers, parseCsv, parseTable } from "../../src/widgets/data/table";

describe("parseCsv (RFC 4180)", () => {
  it("splits plain rows and ignores a final newline", () => {
    expect(parseCsv("a,b\n1,2\n3,4\n")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("reads CRLF and a lone CR as row ends", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\r1,2\r")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps commas, line breaks and doubled quotes inside quoted fields", () => {
    expect(parseCsv('name,note\n"Smith, J.","said ""hi""\nthen left"\n')).toEqual([["name", "note"], ["Smith, J.", 'said "hi"\nthen left']]);
  });

  it("treats empty fields as empty strings, including a trailing comma and an empty quoted field", () => {
    expect(parseCsv("a,b,c\n1,,3\n,,\n4,5,\n")).toEqual([["a", "b", "c"], ["1", "", "3"], ["", "", ""], ["4", "5", ""]]);
    expect(parseCsv('a,b\n"",x\n')).toEqual([["a", "b"], ["", "x"]]);
  });

  it("skips blank lines and strips a byte-order mark", () => {
    expect(parseCsv("﻿a,b\n\n1,2\n\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("allows a quote in the middle of an unquoted field, and keeps spaces", () => {
    expect(parseCsv('5" pipe, x \n')).toEqual([['5" pipe', " x "]]);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});

describe("parseTable", () => {
  it("makes a column numeric when every present cell is a number, and missing cells null", () => {
    const t = parseTable("year,group,rate,note\n2000,rich,0.25,\n2001,poor,,x\n2002,rich,NA,y\n", "csv");
    expect(t.columns).toEqual(["year", "group", "rate", "note"]);
    expect(t.n).toBe(3);
    expect(t.col.year).toEqual([2000, 2001, 2002]);
    expect(t.col.group).toEqual(["rich", "poor", "rich"]);
    expect(t.col.rate).toEqual([0.25, null, null]);
    expect(t.col.note).toEqual([null, "x", "y"]);
  });

  it("keeps identifiers with leading zeros, and mixed columns, as text", () => {
    const t = parseTable("fips,v\n007,1\n010,2\n", "csv");
    expect(t.col.fips).toEqual(["007", "010"]);
    expect(parseTable("v\n1\nabc\n", "csv").col.v).toEqual(["1", "abc"]);
  });

  it("reads signs, decimals and exponents", () => {
    expect(parseTable("v\n-1.5\n+2\n.5\n1e3\n2.5E-1\n", "csv").col.v).toEqual([-1.5, 2, 0.5, 1000, 0.25]);
  });

  it("pads short rows and ignores extra cells", () => {
    const t = parseTable("a,b\n1\n2,3,4\n", "csv");
    expect(t.col.a).toEqual([1, 2]);
    expect(t.col.b).toEqual([null, 3]);
  });

  it("reads JSON as records or as columns", () => {
    const rec = parseTable('[{"year":1963,"p":0.3},{"year":1971,"p":null},{"year":1979,"p":0.25,"flag":"≈"}]', "json");
    expect(rec.col.year).toEqual([1963, 1971, 1979]);
    expect(rec.col.p).toEqual([0.3, null, 0.25]);
    expect(rec.col.flag).toEqual([null, null, "≈"]);
    const cols = parseTable('{"year":[1,2,3],"v":[4,5]}', "json");
    expect(cols.n).toBe(3);
    expect(cols.col.v).toEqual([4, 5, null]);
  });

  it("rejects an empty file and JSON that is not a table", () => {
    expect(() => parseTable("", "csv")).toThrow(/empty/);
    expect(() => parseTable('"just text"', "json")).toThrow(/array of records/);
  });

  it("numbers() names the columns when one is missing", () => {
    const t = parseTable("a\n1\n", "csv");
    expect(numbers(t, "a")).toEqual([1]);
    expect(() => numbers(t, "b")).toThrow(/no column 'b' \(columns: a\)/);
  });
});

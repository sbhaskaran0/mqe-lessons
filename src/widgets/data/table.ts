// Dataset files (the vault's tidy CSV or JSON exports) as column-oriented tables. Pure: the widget runtime and
// `npm run validate` both read datasets through this module, so a number on screen is the number a test checked.

export type Cell = number | string | null;
export type Table = {
  columns: string[];
  /** Number of rows. */
  n: number;
  /** Column name -> its cells. A column is numeric when every non-missing cell is a number; missing cells are null. */
  col: Record<string, Cell[]>;
};

/** RFC 4180: comma-separated, fields optionally in double quotes (which may hold commas, quotes as "" and line
 *  breaks); CRLF or LF row ends; a leading byte-order mark is ignored. Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false; // a field has begun on this row (so `""` and a trailing comma still count)
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    if (started || row.length) {
      endField();
      if (row.length > 1 || row[0] !== "") rows.push(row);
    }
    row = [];
    started = false;
  };
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") {
      quoted = true;
      started = true;
    } else if (c === ",") {
      endField();
      started = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      endRow();
    } else {
      field += c;
      started = true;
    }
  }
  endRow();
  return rows;
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const MISSING = new Set(["", "na", "n/a", "nan", "null", "none", "."]);

/** A cell as text means a number only if it reads as one and isn't an identifier with leading zeros ("007"). */
const isNumeric = (s: string) => NUMBER.test(s) && !/^[+-]?0\d/.test(s);
const isMissing = (s: string) => MISSING.has(s.trim().toLowerCase());

function column(raw: string[]): Cell[] {
  const present = raw.map((s) => s.trim()).filter((s) => !isMissing(s));
  const numeric = present.length > 0 && present.every(isNumeric);
  return raw.map((s) => (isMissing(s) ? null : numeric ? Number(s.trim()) : s.trim()));
}

/** Header row plus data rows. Short rows are padded with missing cells; extra cells are ignored. */
export function tableFromRows(header: string[], rows: string[][]): Table {
  const names = header.map((h) => h.trim());
  const col: Record<string, Cell[]> = {};
  names.forEach((name, j) => {
    col[name] = column(rows.map((r) => r[j] ?? ""));
  });
  return { columns: names, n: rows.length, col };
}

function fromJson(data: unknown): Table {
  // Records: [{year: 1963, premium: 0.3}, ...]
  if (Array.isArray(data)) {
    const rows = data.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null && !Array.isArray(r));
    const names = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const cell = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
    return tableFromRows(names, rows.map((r) => names.map((k) => cell(r[k]))));
  }
  // Columns: {year: [1963, ...], premium: [0.3, ...]}
  if (typeof data === "object" && data !== null) {
    const entries = Object.entries(data).filter((e): e is [string, unknown[]] => Array.isArray(e[1]));
    if (entries.length) {
      const n = Math.max(...entries.map(([, v]) => v.length));
      const names = entries.map(([k]) => k);
      const rows = Array.from({ length: n }, (_, i) => entries.map(([, v]) => (v[i] === null || v[i] === undefined ? "" : String(v[i]))));
      return tableFromRows(names, rows);
    }
  }
  throw new Error("JSON datasets are an array of records or an object of column arrays");
}

export function parseTable(text: string, format: "csv" | "json"): Table {
  if (format === "json") return fromJson(JSON.parse(text));
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("the dataset file is empty");
  return tableFromRows(rows[0]!, rows.slice(1));
}

/** Finite numbers of a numeric column (null for anything else), one per row. */
export function numbers(table: Table, name: string): (number | null)[] {
  const cells = table.col[name];
  if (!cells) throw new Error(`the dataset has no column '${name}' (columns: ${table.columns.join(", ")})`);
  return cells.map((c) => (typeof c === "number" && Number.isFinite(c) ? c : null));
}

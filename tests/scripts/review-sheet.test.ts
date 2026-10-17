// H6a: the per-lecture review sheet, generated from the fixture export (every item kind is in Toy 101 L1 Growth).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { exportFixture, REPO, scratchDir } from "../helpers";
// @ts-expect-error plain .mjs module without types
import { resolveLecture, writeSheet } from "../../scripts/review-sheet.mjs";

const SLUG = "toy-101-l1-growth";
let content: string;
let out: string;
let html: string;
let file: string;

beforeAll(() => {
  content = exportFixture();
  out = scratchDir("mqe-sheet");
  const r = writeSheet(SLUG, { content, out, shots: path.join(out, "no-shots") });
  file = r.file;
  html = readFileSync(file, "utf8");
});

/** The order of the item cards: their kind classes, as they appear in the page. */
const kinds = () => [...html.matchAll(/<article class="item k-(\w+)/g)].map((m) => m[1]);
const text = () => html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<[^>]*>/g, " ");

describe("review sheet", () => {
  test("is one HTML file named for the lecture, with its title and counts", () => {
    expect(path.basename(file)).toBe(`${SLUG}.html`);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<h1>");
    const counts = Object.fromEntries([...html.matchAll(/<div><b>(\d+)<\/b><span>(\w+)<\/span><\/div>/g)].map((m) => [m[2], Number(m[1])]));
    expect(counts).toEqual({ checks: 3, derives: 1, predictions: 2, goals: 1, placements: 6, planned: 1 });
  });

  test("has every item kind", () => {
    for (const k of ["derive", "mcq", "numeric", "predict", "goal", "planned", "placement"]) expect(kinds(), k).toContain(k);
  });

  test("lists the riskiest items first", () => {
    const order = ["derive", "mcq", "numeric", "predict", "goal", "planned", "placement"];
    const ranks = kinds().map((k) => order.indexOf(k as string));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(kinds()[0]).toBe("derive");
  });

  test("gives each item a stable slug#stepId#block id", () => {
    const ids = [...html.matchAll(/<article class="item[^"]*" id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(kinds().length);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(`${SLUG}#5-deriving-the-steady-state-2#0`);
    for (const id of ids) expect(id).toMatch(new RegExp(String.raw`^${SLUG}#[a-z0-9-]+#\d+$`));
  });

  test("shows the objective coverage table, with untested objectives highlighted", () => {
    const meta = JSON.parse(readFileSync(path.join(content, "index.json"), "utf8")).notes[SLUG];
    expect(html).toContain("Objective coverage");
    const rows = [...html.matchAll(/<tr class="(untested)?" id="obj-(\d+)">/g)];
    expect(rows.length).toBe(meta.objectives.length);
    for (const o of meta.objectives) {
      const row = html.match(new RegExp(String.raw`<tr class="(untested)?" id="obj-${o.n}">([\s\S]*?)</tr>`))!;
      // Untested exactly when no item card names the objective.
      const tagged = (html.match(new RegExp(`class="tag obj" href="#obj-${o.n}"`, "g")) ?? []).length;
      expect(Boolean(row[1]), `objective ${o.n}`).toBe(tagged === 0);
    }
  });

  test("renders maths with KaTeX at generation time", () => {
    expect(html).toContain('class="katex"');
    expect(html).not.toContain("katex-error");
    expect(html).toContain("node_modules/katex/dist/katex.min.css");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  test("leaves no raw $ from authored maths", () => {
    expect(text()).not.toContain("$");
  });

  test("shows the parts a reviewer checks", () => {
    // Derivation: justify question, hint, and a rejected form with its message.
    expect(html).toContain("Why may we divide by");
    expect(html).toContain("Raise both sides to the same power");
    expect(html).toContain("dividing by");
    // Numeric: the answer with its tolerance and a wrong-answer diagnostic.
    expect(html).toMatch(/<code>25<\/code> ± <code>0\.05<\/code>/);
    expect(html).toContain("that is");
    // Planned placeholder: the brief and a figure.
    expect(html).toContain("Planned placeholder");
    expect(html).toContain("Toy%20diagram.png");
  });

  test("links a step's screenshot when the lesson run left a manifest", () => {
    expect(html).not.toContain('class="shot"');
    const shots = scratchDir("mqe-shots");
    const dir = path.join(shots, SLUG);
    // The sheet resolves each manifest entry to a file that exists, next to the manifest.
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "2-the-steady-state-4.png"), "png");
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ shots: [{ stepId: "2-the-steady-state-4", screenshot: "test-results/lesson/x/2-the-steady-state-4.png" }] }));
    const withShot = readFileSync(writeSheet(SLUG, { content, out: path.join(out, "with-shots"), shots }).file, "utf8");
    expect(withShot).toContain('class="shot"');
    expect(withShot).toContain("2-the-steady-state-4.png");
  });
});

describe("command line", () => {
  test("resolves a title prefix and writes the sheet; an unknown lecture fails", () => {
    const script = path.join(REPO, "scripts", "review-sheet.mjs");
    const ok = spawnSync(process.execPath, [script, "Toy 101 L1", "--content", content, "--out", path.join(out, "cli")], { encoding: "utf8" });
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("review sheet:");
    expect(readFileSync(path.join(out, "cli", `${SLUG}.html`), "utf8")).toContain("<h1>");
    const bad = spawnSync(process.execPath, [script, "No Such Lecture", "--content", content, "--out", out], { encoding: "utf8" });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("no lecture matches");
  });

  test("resolveLecture matches whole-word prefixes", () => {
    const index = JSON.parse(readFileSync(path.join(content, "index.json"), "utf8"));
    expect(resolveLecture(index, "toy 101 l1").slug).toBe(SLUG);
  });
});

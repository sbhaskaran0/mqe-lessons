// Widget parity snapshot (B0 migration). For every widget in an export it records what learners and authors depend
// on: parameter ids with their labels, symbols, ranges, steps and defaults; element and scalar ids; every `tests`
// entry; the hover notation rows; and, for every placement, the elements its `show` list makes visible. Take one
// before a migration and compare after it:
//   npx tsx tests/widgets/parity.ts --save <file> [content dir]
//   npx tsx tests/widgets/parity.ts --against <file> [content dir] [--allow-ranges p1,p2]
// Reads the export as raw JSON (no zod), so a snapshot taken with one widget runtime can be compared with another.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO } from "../helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Snapshot = Record<string, Json>;

const ids = (xs: Json[] | undefined) => (xs ?? []).flatMap((x) => (x?.id === undefined ? [] : [String(x.id)]));

/** Marks (things drawn) grouped by the panel that draws them, for any widget type this repo has had. */
function panelsOf(spec: Json): { id: string; marks: string[] }[] {
  switch (spec.type) {
    case "function-plot":
      return [{ id: "", marks: [...ids(spec.curves), ...ids(spec.points), ...ids(spec.lines), ...ids(spec.regions)] }];
    case "dynamics": {
      const panels: Json[] = spec.panels?.length ? spec.panels : [{ id: "levels" }];
      const out = panels.map((p) => ({ id: String(p.id), marks: [] as string[] }));
      for (const s of spec.series ?? []) (out.find((p) => p.id === s.panel) ?? out[0]!).marks.push(String(s.id));
      if (spec.phase) out.push({ id: "phase", marks: [] });
      return out;
    }
    case "panels":
      // A view with one panel compares like a function-plot (whose single plot had no id); its panel id is new.
      return (spec.panels ?? []).map((p: Json) => ({
        id: spec.panels.length > 1 ? String(p.id) : "",
        marks: [...ids(p.curves), ...ids(p.points), ...ids(p.lines), ...ids(p.regions), ...ids(p.arrows), ...ids(p.series)],
      }));
    default:
      return [];
  }
}

/** Visible marks and panels under a `show` list. function-plot: only listed marks. dynamics and panels: if `show`
 *  lists a mark, only listed marks; a panel shows if listed or if it holds a listed mark; a show list naming only
 *  panels shows all of their marks. The single function-plot panel has no id and always shows. */
function visible(spec: Json, show: string[] | undefined): string[] {
  const panels = panelsOf(spec);
  if (!show) return panels.flatMap((p) => (p.id ? [p.id, ...p.marks] : p.marks)).sort();
  const listed = new Set(show);
  if (spec.type === "function-plot") return panels[0]!.marks.filter((m) => listed.has(m)).sort();
  const anyMark = panels.some((p) => p.marks.some((m) => listed.has(m)));
  const out: string[] = [];
  for (const p of panels) {
    const marks = p.marks.filter((m) => listed.has(m) || (!anyMark && listed.has(p.id)));
    // The old dynamics rule hid an unlisted panel whenever another panel was listed; parity flags any difference.
    const anyPanel = spec.type === "dynamics" && panels.some((q) => listed.has(q.id));
    const shown = listed.has(p.id) || (!anyPanel && p.marks.some((m) => listed.has(m)));
    if (shown) out.push(p.id, ...marks);
  }
  return out.filter(Boolean).sort();
}

function snapshot(dir: string): Snapshot {
  const index = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8"));
  const out: Snapshot = {};
  for (const [slug, entry] of Object.entries<Json>(index.widgets)) {
    const spec = entry.spec;
    if (spec.type === "panels" && !(spec.panels ?? []).length) continue; // a model's own page: new, not a migration
    const params = Object.fromEntries(Object.entries<Json>(spec.params ?? {}).map(([k, p]) => [k, { tex: p.tex, label: p.label, min: p.min, max: p.max, step: p.step, default: p.default }]));
    const panels = panelsOf(spec);
    const elements = [...panels.flatMap((p) => (p.id ? [p.id, ...p.marks] : p.marks)), ...ids(spec.readouts), ...ids(spec.shocks ?? spec.recurrence?.shocks)].sort();
    const derived = Object.keys(spec.derived ?? {});
    out[slug] = {
      name: entry.name,
      params,
      paramOrder: Object.keys(spec.params ?? {}),
      elements,
      scalars: [...derived, ...ids(spec.readouts)].sort(),
      readouts: (spec.readouts ?? []).map((r: Json) => ({ id: r.id, tex: r.tex, label: r.label, format: r.format })),
      tests: spec.tests ?? [],
      notation: (entry.notation ?? []).map((r: Json) => r.tex).sort(),
      compare_figure: spec.compare_figure,
      views: [] as Json[],
    };
  }
  for (const f of readdirSync(path.join(dir, "notes")).sort()) {
    const body = JSON.parse(readFileSync(path.join(dir, "notes", f), "utf8"));
    for (const sec of body.sections) {
      for (const st of sec.steps) {
        for (const b of st.blocks) {
          if (b.t !== "interactive" || b.status === "planned" || !out[b.widget]) continue;
          const spec = index.widgets[b.widget].spec;
          out[b.widget]!.views.push({
            at: `${body.slug}#${st.id}`,
            state: b.state,
            lock: b.lock,
            show: b.show,
            highlight: b.highlight,
            hide: b.predict?.hide,
            goal: b.goal?.when,
            visible: visible(spec, b.show),
          });
        }
      }
    }
  }
  return out;
}

function diff(a: unknown, b: unknown, where: string, out: string[]) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff((a as Json)[k], (b as Json)[k], `${where}.${k}`, out);
    return;
  }
  out.push(`${where}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const save = flag("--save");
const against = flag("--against");
const allowRanges = new Set((flag("--allow-ranges") ?? "").split(",").filter(Boolean));
const dir = args[0] ?? path.join(REPO, "content");
const now = snapshot(dir);
if (save) {
  writeFileSync(save, `${JSON.stringify(now, null, 1)}\n`);
  console.log(`parity: ${Object.keys(now).length} widgets, ${Object.values(now).reduce((n, w) => n + w.views.length, 0)} placements -> ${save}`);
} else if (against) {
  const was: Snapshot = JSON.parse(readFileSync(against, "utf8"));
  const out: string[] = [];
  for (const slug of new Set([...Object.keys(was), ...Object.keys(now)])) {
    const [a, b] = [was[slug], now[slug]];
    if (a && b) {
      // D1: a shared model's union range may widen min/max (and a view's default stays as it was); listed params only.
      for (const p of allowRanges) {
        if (a.params[p] && b.params[p]) for (const k of ["min", "max"]) b.params[p][k] = a.params[p][k];
      }
    }
    diff(a, b, slug, out);
  }
  for (const line of out) console.log(line);
  console.log(`parity: ${out.length ? `${out.length} difference(s)` : "identical"}`);
  process.exit(out.length ? 1 : 0);
}

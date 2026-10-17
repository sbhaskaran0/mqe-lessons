// Validates an export directory (content/ by default): every file against the zod IR, every reference
// (slugs, assets, notation chips, widget ids) against what the export actually contains, and every widget's
// expressions and `tests` with the same evaluator the player uses.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { Index, NoteBody, type Block, type Derive, type NoteMeta } from "./ir";
import { selfTestParams } from "./params";
import { selfTestDerive } from "./validate/derive-adapter";
import { parseTable, type Table } from "./widgets/data/table";
import { checkExpr, checkView, checkWidget, compile, type DataLookup, defaults, FUNCTIONS, scopes, withDerived } from "./widgets/expr";
import { type WidgetSpec, widgetParts } from "./widgets/spec";

export type Report = { errors: string[]; notes: string[]; stats: { notes: number; steps: number; widgets: number; datasets: number; assets: number } };

const NOTE_LINK = /\]\(note:([a-z0-9-]+)(?:#[^)]*)?\)/g;
const ASSET_LINK = /\]\(<(assets\/[^>]+)>\)/g;

function issues(where: string, error: z.ZodError): string[] {
  return error.issues.map((i) => `${where}: ${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`);
}

export function validateContent(dir: string): Report {
  const errors: string[] = [];
  const notes: string[] = [];
  const stats = { notes: 0, steps: 0, widgets: 0, datasets: 0, assets: 0 };
  const indexFile = path.join(dir, "index.json");
  if (!existsSync(indexFile)) return { errors: [`${indexFile} is missing - run npm run export`], notes, stats };
  const parsed = Index.safeParse(JSON.parse(readFileSync(indexFile, "utf8")));
  if (!parsed.success) return { errors: issues("index.json", parsed.error), notes, stats };
  const index = parsed.data;
  const slugs = new Set(Object.keys(index.notes));
  const assets = new Set<string>();
  const slug = (where: string, s: string | undefined) => {
    if (s !== undefined && !slugs.has(s)) errors.push(`${where}: no note '${s}'`);
  };
  const asset = (where: string, src: string) => {
    assets.add(src);
    if (!existsSync(path.join(dir, src))) errors.push(`${where}: asset ${src} is missing`);
  };
  const markdown = (where: string, md: string | undefined) => {
    for (const m of (md ?? "").matchAll(NOTE_LINK)) slug(where, m[1]);
    for (const m of (md ?? "").matchAll(ASSET_LINK)) asset(where, m[1]!);
  };

  for (const c of index.courses) {
    for (const s of [c.hub, ...c.lectures, ...c.practice, ...c.guides]) slug(`courses.${c.code}`, s);
  }
  for (const d of index.domains) d.notes.forEach((s) => slug(`domains.${d.id}`, s));
  for (const [tag, ss] of Object.entries(index.tags)) ss.forEach((s) => slug(`tags.${tag}`, s));
  for (const [s, m] of Object.entries(index.notes)) {
    const where = `notes.${s}`;
    [...m.requires, ...m.lessons, ...m.interactives, ...m.edges.out.map((e) => e.note), ...m.edges.in.map((e) => e.note)].forEach((x) => slug(where, x));
    slug(where, m.pairedAnswers);
    m.figures.forEach((f) => asset(where, f));
    m.interactives.forEach((w) => { if (!index.widgets[w]) errors.push(`${where}: places widget '${w}', which is not in widgets`); });
  }
  for (const [id, d] of Object.entries(index.datasets)) {
    asset(`datasets.${id}`, d.src);
    slug(`datasets.${id}`, d.dataSource);
  }
  stats.datasets = Object.keys(index.datasets).length;

  // Dataset files, read once, so widget tests that run on a dataset (a series value, a Gini of a column) can run here.
  const tables = new Map<string, Table | undefined>();
  const dataset = (id: string): Table | undefined => {
    if (!tables.has(id)) {
      const meta = index.datasets[id];
      let table: Table | undefined;
      if (meta && existsSync(path.join(dir, meta.src))) {
        try {
          table = parseTable(readFileSync(path.join(dir, meta.src), "utf8"), meta.format);
        } catch (e) {
          errors.push(`datasets.${id}: ${(e as Error).message}`);
        }
      }
      tables.set(id, table);
    }
    return tables.get(id);
  };

  // Widgets whose spec checks out: only those can be evaluated at a view's starting values.
  const sound = new Set<string>();
  for (const [w, entry] of Object.entries(index.widgets)) {
    const where = `widgets.${w}`;
    slug(where, w);
    entry.illustrates.forEach((s) => slug(where, s));
    entry.notation.forEach((r) => slug(where, r.from));
    if (entry.spec.compare_figure) asset(where, entry.spec.compare_figure);
    if ("dataset" in entry.spec && entry.spec.dataset !== undefined && !index.datasets[entry.spec.dataset]) {
      errors.push(`${where}: dataset '${entry.spec.dataset}' is not in datasets`);
    }
    const r = checkWidget(entry.spec, dataset);
    if (!r.errors.length) sound.add(w);
    errors.push(...r.errors.map((e) => `${where}: ${e}`));
    notes.push(...r.notes.map((e) => `${where}: ${e}`));
  }
  stats.widgets = Object.keys(index.widgets).length;

  const files = new Set(existsSync(path.join(dir, "notes")) ? readdirSync(path.join(dir, "notes")) : []);
  for (const f of files) if (!slugs.has(f.replace(/\.json$/, ""))) errors.push(`notes/${f}: not listed in index.json`);
  for (const s of slugs) {
    const file = `${s}.json`;
    if (!files.has(file)) {
      errors.push(`notes/${file} is missing`);
      continue;
    }
    const body = NoteBody.safeParse(JSON.parse(readFileSync(path.join(dir, "notes", file), "utf8")));
    if (!body.success) {
      errors.push(...issues(`notes/${file}`, body.error));
      continue;
    }
    const b = body.data;
    stats.notes++;
    if (b.slug !== s) errors.push(`notes/${file}: slug is '${b.slug}'`);
    const tex = new Set(b.notation.map((r) => r.tex));
    b.notation.forEach((r) => { slug(`notes/${file} notation`, r.from); markdown(`notes/${file} notation`, r.meaning); });
    const ids = new Set<string>();
    const meta = index.notes[s]!;
    let checks = 0;
    let derives = 0;
    const tested = new Map<number, number>();
    for (const sec of b.sections) {
      if (ids.has(sec.id)) errors.push(`notes/${file}: section id '${sec.id}' repeats`);
      ids.add(sec.id);
      slug(`notes/${file}#${sec.id}`, sec.lesson);
      for (const st of sec.steps) {
        const where = `notes/${file}#${st.id}`;
        stats.steps++;
        if (ids.has(st.id)) errors.push(`${where}: step id repeats`);
        ids.add(st.id);
        for (const sym of st.symbols) if (!tex.has(sym)) errors.push(`${where}: symbol chip '${sym}' is not in the note's notation`);
        for (const block of st.blocks) {
          if (block.t === "check") checks++;
          if (block.t === "derive") derives++;
          objectiveTags(where, block, meta, tested, errors);
          checkBlock(where, `${s}#${st.id}`, block, index, { slug, asset, markdown, errors, notes, data: dataset, sound });
        }
      }
    }
    if (checks !== meta.checks) errors.push(`notes/${file}: ${checks} checks, index says ${meta.checks}`);
    if (derives !== (meta.derives ?? 0)) errors.push(`notes/${file}: ${derives} derives, index says ${meta.derives ?? 0}`);
    for (const o of meta.objectives ?? []) {
      if (o.tested !== (tested.get(o.n) ?? 0)) errors.push(`notes.${s}: objective ${o.n} is tested by ${tested.get(o.n) ?? 0} item(s), index says ${o.tested}`);
      markdown(`notes.${s} objectives`, o.md);
    }
    if (b.practice) {
      const paired = index.notes[s]!.pairedAnswers;
      if (b.practice.answers !== paired) errors.push(`notes/${file}: practice.answers is '${b.practice.answers}', pairedAnswers is '${paired ?? "unset"}'`);
      slug(`notes/${file} practice`, b.practice.answers);
      const itemIds = new Set<string>();
      for (const it of b.practice.items) {
        const where = `notes/${file}#practice-${it.id}`;
        if (itemIds.has(it.id)) errors.push(`${where}: practice item id repeats`);
        itemIds.add(it.id);
        it.links.forEach((l) => slug(where, l));
        markdown(where, it.group);
        markdown(where, it.prompt);
        markdown(where, it.answer);
        it.rubric?.forEach((r) => markdown(where, r));
        if (it.answer === undefined) notes.push(`${where}: question ${it.number} has no answer in ${b.practice.answers}`);
      }
    }
  }
  const assetFiles = listFiles(path.join(dir, "assets")).map((f) => `assets/${f}`);
  for (const f of assetFiles) if (!assets.has(f)) notes.push(`${f} is exported but nothing references it`);
  stats.assets = assets.size;
  return { errors, notes, stats };
}

type Ctx = {
  slug: (where: string, s: string | undefined) => void;
  asset: (where: string, src: string) => void;
  markdown: (where: string, md: string | undefined) => void;
  errors: string[];
  notes: string[];
  data: DataLookup;
  sound: ReadonlySet<string>;
};

/** Objective tags must point into the lecture's list (NoteMeta.objectives); `tested` gathers what the index claims. */
function objectiveTags(where: string, b: Block, meta: NoteMeta, tested: Map<number, number>, errors: string[]) {
  const tags = "objectives" in b ? b.objectives : undefined;
  if (!tags) return;
  const listed = new Set((meta.objectives ?? []).map((o) => o.n));
  for (const n of tags) if (!listed.has(n)) errors.push(`${where}: objective ${n} is not in the note's objectives (${[...listed].join(", ") || "none"})`);
  const tests = b.t === "check" || b.t === "derive" || (b.t === "interactive" && b.status !== "planned" && (b.goal !== undefined || b.predict !== undefined));
  if (tests) for (const n of tags) tested.set(n, (tested.get(n) ?? 0) + 1);
}

/** FNV-1a: a stable seed per block, so the derivation self-test draws the same values on every run. */
export function seedOf(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

function checkDerive(where: string, key: string, b: Derive, { slug, markdown, errors }: Ctx) {
  markdown(where, b.title);
  b.inherited.forEach((r) => slug(where, r.from));
  b.steps.forEach((st, i) => {
    markdown(where, st.md);
    markdown(where, st.hint);
    if (!st.tex.trim()) errors.push(`${where}: derive "${b.title}": step ${i + 1} has no maths`);
    if (st.justify) {
      markdown(where, st.justify.prompt);
      st.justify.options.forEach((o) => markdown(where, o.md));
      if (!st.justify.options.some((o) => o.correct)) errors.push(`${where}: derive "${b.title}": step ${i + 1} justify has no correct option`);
    }
  });
  b.reject.forEach((r) => markdown(where, r.md));
  errors.push(...selfTestDerive(b, { seed: seedOf(key) }).map((e) => `${where}: derive "${b.title}": ${e}`));
}

/** Compute-before-reveal: the readout must have a value where the view starts, and a value the learner can move
 *  with an unlocked slider is worth knowing about (they could reach the answer without computing it). */
function readoutIssues(spec: WidgetSpec, view: { state?: Record<string, number>; lock?: string[] }, readout: string): { errors: string[]; notes: string[] } {
  const expr = spec.readouts?.find((r) => r.id === readout)?.expr;
  if (expr === undefined || checkExpr(expr, scopes(spec).base).errors.length) return { errors: [], notes: [] };
  const valueAt = (params: Record<string, number>) => {
    try {
      return compile(expr)(withDerived(spec, params));
    } catch {
      return NaN;
    }
  };
  const start = { ...defaults(spec), ...view.state };
  const value = valueAt(start);
  if (!Number.isFinite(value)) return { errors: [`predict.readout '${readout}' has no finite value at the view's starting values`], notes: [] };
  const moves = Object.entries(spec.params ?? {}).filter(([k, p]) => {
    if (view.lock?.includes(k)) return false;
    const other = start[k]! === p.max ? p.min : p.max;
    return Math.abs(valueAt({ ...start, [k]: other }) - value) > 1e-9 * Math.max(1, Math.abs(value));
  });
  return { errors: [], notes: moves.length ? [`predict.readout '${readout}' moves with unlocked ${moves.map(([k]) => k).join(", ")} - the learner can find the answer by dragging`] : [] };
}

function checkPredict(where: string, b: Extract<Block, { t: "interactive" }>, spec: WidgetSpec | undefined, { markdown, errors, notes }: Ctx) {
  const p = b.predict;
  if (!p) return;
  markdown(where, p.ask);
  markdown(where, p.why);
  p.options?.forEach((o) => markdown(where, o));
  p.feedback?.forEach((f) => markdown(where, f ?? undefined));
  if (p.feedback && p.feedback.length !== (p.options?.length ?? 0)) errors.push(`${where}: predict.feedback has ${p.feedback.length} entries for ${p.options?.length ?? 0} options`);
  if (p.answer !== undefined && (!p.options || p.answer >= p.options.length)) errors.push(`${where}: predict.answer is not an option index`);
  if (p.readout !== undefined && p.options) errors.push(`${where}: predict has both options and readout`);
  if (p.readout !== undefined && p.tol === undefined) errors.push(`${where}: predict.readout needs tol`);
  if (p.readout === undefined || !spec) return;
  if (!spec.readouts?.some((r) => r.id === p.readout)) {
    errors.push(`${where}: predict.readout '${p.readout}' is not a readout of ${b.widget}`);
    return;
  }
  const r = readoutIssues(spec, b, p.readout);
  errors.push(...r.errors.map((e) => `${where}: ${e}`));
  notes.push(...r.notes.map((e) => `${where}: ${e}`));
}

function checkBlock(where: string, key: string, b: Block, index: z.infer<typeof Index>, ctx: Ctx) {
  const { slug, asset, markdown, errors, data, sound } = ctx;
  switch (b.t) {
    case "prose":
    case "table":
      markdown(where, b.md);
      break;
    case "figure":
      asset(where, b.src);
      markdown(where, b.caption);
      break;
    case "callout":
      markdown(where, b.title);
      markdown(where, b.md);
      break;
    case "quote":
      markdown(where, b.md);
      b.papers?.forEach((p) => slug(where, p));
      break;
    case "links":
      b.items.forEach((p) => slug(where, p));
      break;
    case "check":
      markdown(where, b.prompt);
      markdown(where, b.why);
      if (b.kind === "mcq") b.options.forEach((o) => { markdown(where, o.md); markdown(where, o.feedback); });
      else {
        for (const w of b.wrong ?? []) {
          markdown(where, w.md);
          if (Math.abs(w.answer - b.answer) <= b.tol) errors.push(`${where}: wrong answer ${w.answer} lies within the right answer ${b.answer} ± ${b.tol}`);
        }
        // A varied check: recompute the answer at the question's numbers and at seeded draws (src/params).
        b.wrongCompute?.forEach((w) => markdown(where, w.md));
        errors.push(...selfTestParams(b).map((e) => `${where}: varied check: ${e}`));
      }
      break;
    case "derive":
      checkDerive(where, key, b, ctx);
      break;
    case "interactive": {
      markdown(where, b.prompt);
      markdown(where, b.purpose);
      if (b.figure !== undefined) asset(where, b.figure);
      if (b.status === "planned") {
        // A placeholder: its widget may not exist yet, so only its own text is checked.
        markdown(where, b.goal?.success);
        markdown(where, b.goal?.hint);
        checkPredict(where, b, undefined, ctx);
        break;
      }
      const entry = index.widgets[b.widget];
      if (!entry) {
        errors.push(`${where}: widget '${b.widget}' is not in widgets`);
        break;
      }
      const { params, elements } = widgetParts(entry.spec);
      for (const k of Object.keys(b.state ?? {})) if (!params.includes(k)) errors.push(`${where}: state '${k}' is not a parameter of ${b.widget}`);
      for (const k of b.lock ?? []) if (!params.includes(k)) errors.push(`${where}: lock '${k}' is not a parameter of ${b.widget}`);
      for (const k of [...(b.show ?? []), ...(b.highlight ? [b.highlight] : []), ...(b.predict?.hide ?? [])]) {
        if (!elements.includes(k)) errors.push(`${where}: '${k}' is not an element of ${b.widget}`);
      }
      const goalErrors = b.goal ? checkExpr(b.goal.when, scopes(entry.spec).goal, FUNCTIONS.base).errors : [];
      errors.push(...goalErrors.map((e) => `${where}: goal.when ${e}`));
      if (b.goal) {
        markdown(where, b.goal.success);
        markdown(where, b.goal.hint);
      }
      checkPredict(where, b, sound.has(b.widget) ? entry.spec : undefined, ctx);
      if (sound.has(b.widget) && !goalErrors.length) errors.push(...checkView(entry.spec, b, data).map((e) => `${where}: ${e}`));
      break;
    }
  }
}

function listFiles(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  );
}

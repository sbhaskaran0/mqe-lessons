// The lesson IR (schema "mqe-lessons/1"): the contract between `vault_tool.py export` (the only parser of vault
// markdown) and this player. content/index.json holds navigation; content/notes/<slug>.json holds one note's body.
// Every shape here is strict: a field the exporter adds or drops fails `npm run validate` until this file follows.
import { z } from "zod";
import { WidgetSpec, type WidgetType } from "./widgets/spec";

export const IR_SCHEMA = "mqe-lessons/1";

/** Lowercase hyphenated note name; progress is keyed by `slug#stepId`. */
export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "not a slug");
export type Slug = z.infer<typeof Slug>;

export const NOTE_TYPES = ["concept", "fact", "source", "paper", "lecture", "practice", "course", "interactive", "guide"] as const;
export const NoteType = z.enum(NOTE_TYPES);
export type NoteType = z.infer<typeof NoteType>;

export const EDGE_KINDS = [
  "covers", "applies", "requires", "related", "part_of", "next", "presents", "uses", "cites", "illustrates", "shows",
] as const;
export const Edge = z.strictObject({ kind: z.enum(EDGE_KINDS), note: Slug });
export type Edge = z.infer<typeof Edge>;

/** One row of a Notation table. `tex` is the Symbol cell as inline markdown (it may hold several $…$ groups);
 *  `keys` are the normalized symbols it defines ('~…' = a whole expression); `from` marks a row borrowed
 *  from a linked concept note by a note that has no table of its own. */
export const NotationRow = z.strictObject({
  tex: z.string(),
  meaning: z.string(),
  kind: z.string(),
  typical: z.string(),
  keys: z.array(z.string()),
  from: Slug.optional(),
});
export type NotationRow = z.infer<typeof NotationRow>;

/** Lecture objective numbers an item tests (`objective: 4, 6`), 1-based into NoteMeta.objectives. */
const Objectives = z.array(z.number().int().positive()).min(1);

export const Goal = z.strictObject({ when: z.string(), success: z.string(), hint: z.string().optional() });
export const Predict = z.strictObject({
  hide: z.array(z.string()),
  ask: z.string(),
  options: z.array(z.string()).min(2).optional(),
  answer: z.number().int().nonnegative().optional(),
  /** Shown with the verdict, right or wrong. */
  why: z.string().optional(),
  /** Per option, in order (null: no feedback for that option); shown when that option is chosen. */
  feedback: z.array(z.string().nullable()).optional(),
  /** Offer an ungraded "Why did that happen?" box after the reveal. */
  reflect: z.boolean().optional(),
  /** Compute before reveal: the learner types a number, graded against this readout within `tol`. */
  readout: z.string().optional(),
  tol: z.number().nonnegative().optional(),
});

/** A varied number of a parameterized check; `sym` is TeX as written in `vary:` (`\delta`). */
export const Vary = z.union([
  z.strictObject({ sym: z.string(), lo: z.number(), hi: z.number(), step: z.number().positive().optional() }),
  z.strictObject({ sym: z.string(), values: z.array(z.number()).min(2) }),
]);
export type Vary = z.infer<typeof Vary>;

const Check = z.discriminatedUnion("kind", [
  z.strictObject({
    t: z.literal("check"),
    kind: z.literal("mcq"),
    prompt: z.string(),
    /** `feedback`: shown when the learner picks that option. */
    options: z.array(z.strictObject({ md: z.string(), correct: z.boolean(), feedback: z.string().optional() })).min(2),
    why: z.string(),
    objectives: Objectives.optional(),
  }),
  z.strictObject({
    t: z.literal("check"),
    kind: z.literal("numeric"),
    prompt: z.string(),
    answer: z.number(),
    tol: z.number().nonnegative(),
    /** Anticipated wrong answers: a value within `tol` of `answer` shows `md`. */
    wrong: z.array(z.strictObject({ answer: z.number(), tol: z.number().nonnegative(), md: z.string() })).optional(),
    why: z.string(),
    objectives: Objectives.optional(),
    // A varied check (`vary:` + `compute:`; PLAN.md "Interface note: params"). The next three fields come together.
    // What is written (prompt, answer, tol, why) is the base variant; src/params `instantiate` draws the others.
    /** The numbers that change: a range (drawn on `step`, else rounded to the decimals of its bounds) or a set. */
    vary: z.array(Vary).min(1).optional(),
    /** The answer as bare TeX over the bound symbols, e.g. `\left(\frac{sA}{\delta}\right)^{\frac{1}{1-\alpha}}`. */
    compute: z.string().optional(),
    /** Every `sym = n` part of the prompt's inline maths: the base values `compute` reads, and the spans a variant
     *  rewrites wherever they appear (prompt, why, wrong feedback). `span` is the whole `$…$` as written. */
    bindings: z.array(z.strictObject({ sym: z.string(), value: z.number(), span: z.string() })).optional(),
    /** Anticipated wrong answers as formulas (`wrong: $sA/\delta$ — …`), evaluated per variant. A varied check
     *  has these instead of `wrong`. */
    wrongCompute: z.array(z.strictObject({ tex: z.string(), md: z.string() })).optional(),
  }),
]);
export type NumericCheck = Extract<z.infer<typeof Check>, { kind: "numeric" }>;

/** One numbered step of a derivation. A `justify` step is shown, not typed: the learner answers its multiple choice. */
export const DeriveStep = z.strictObject({
  /** The whole item as inline markdown (prose and maths). */
  md: z.string(),
  /** Its last $…$ span, without the dollars: what the checker compares. */
  tex: z.string(),
  hint: z.string().optional(),
  justify: z
    .strictObject({ prompt: z.string(), options: z.array(z.strictObject({ md: z.string(), correct: z.boolean() })).min(2) })
    .optional(),
});
export type DeriveStep = z.infer<typeof DeriveStep>;

/** A `> [!derive]-` worked derivation (e0-checker.md grammar). The exporter splits structure only; src/derive reads
 *  the TeX. `symbols`, `define`, `given`, `accept` and `reject.tex` are bare TeX (no dollars); `unknowns`, `dims`,
 *  `data` and `matrices` are the callout's comma-separated items as written, dollars kept ("$b_2$ real"). */
export const Derive = z.strictObject({
  t: z.literal("derive"),
  title: z.string(),
  objectives: Objectives.optional(),
  symbols: z.array(z.string()),
  /** Notation rows the maths uses: from the `notation:` note alone, else the note's own table, then linked notes. */
  inherited: z.array(z.strictObject({ tex: z.string(), typical: z.string(), from: Slug })),
  unknowns: z.array(z.string()),
  dims: z.array(z.string()),
  data: z.array(z.string()),
  matrices: z.array(z.string()),
  define: z.array(z.string()),
  given: z.array(z.string()),
  /** The last step is the target. */
  steps: z.array(DeriveStep).min(1),
  accept: z.array(z.string()),
  reject: z.array(z.strictObject({ tex: z.string(), md: z.string() })),
});
export type Derive = z.infer<typeof Derive>;

/** Markdown fields are inline markdown: wikilinks arrive resolved to [text](note:slug), embedded images to
 *  ![alt](<assets/...>), and $…$ / $$…$$ math is left for KaTeX. */
export const Block = z.discriminatedUnion("t", [
  z.strictObject({ t: z.literal("prose"), md: z.string() }),
  z.strictObject({ t: z.literal("math"), tex: z.string() }),
  z.strictObject({ t: z.literal("figure"), src: z.string(), alt: z.string(), caption: z.string().optional() }),
  z.strictObject({ t: z.literal("table"), md: z.string() }),
  /** kind "why" is the plain-English section's "Why it matters" line. */
  z.strictObject({ t: z.literal("callout"), kind: z.string(), title: z.string(), md: z.string(), folded: z.boolean() }),
  /** "> [!quote] Paper summary: [[…]]" carries the papers it names. */
  z.strictObject({ t: z.literal("quote"), md: z.string(), papers: z.array(Slug).optional() }),
  z.strictObject({ t: z.literal("links"), role: z.enum(["concepts", "facts", "papers"]), items: z.array(Slug) }),
  z.strictObject({
    t: z.literal("interactive"),
    widget: Slug,
    state: z.record(z.string(), z.number()).optional(),
    lock: z.array(z.string()).optional(),
    show: z.array(z.string()).optional(),
    highlight: z.string().optional(),
    prompt: z.string().optional(),
    goal: Goal.optional(),
    predict: Predict.optional(),
    /** A placeholder for a widget not built yet: `widget` may be missing from Index.widgets; show `figure` (or only
     *  the step text). Activation drops `status` and changes nothing else, so step ids stay put. */
    status: z.literal("planned").optional(),
    /** Asset path of the static figure the placement stands in for. */
    figure: z.string().optional(),
    /** What the widget is for (a planned placement's brief, else its prompt). */
    purpose: z.string().optional(),
    objectives: Objectives.optional(),
  }),
  Check,
  Derive,
]);
export type Block = z.infer<typeof Block>;

export const Step = z.strictObject({
  id: z.string(),
  /** Set when an H3 started this step. */
  heading: z.string().optional(),
  blocks: z.array(Block).min(1),
  words: z.number().int().nonnegative(),
  /** `tex` of the NoteBody.notation rows whose symbols appear in this step's math. */
  symbols: z.array(z.string()),
});
export type Step = z.infer<typeof Step>;

export const SECTION_ROLES = ["intuition", "definition", "notation", "depth", "coverage", "papers", "paper-in-lesson", "other"] as const;
export const Section = z.strictObject({
  id: z.string(),
  heading: z.string(),
  role: z.enum(SECTION_ROLES),
  steps: z.array(Step).min(1),
  /** For role "paper-in-lesson": the lecture this section explains the paper for. */
  lesson: Slug.optional(),
});
export type Section = z.infer<typeof Section>;

/** One numbered question of a practice set, with its worked answer from the paired answers note. */
export const PracticeItem = z.strictObject({
  /** Stable within the note: "q12". Progress keys use `slug#practice-<id>`. */
  id: z.string(),
  /** As printed: "12". */
  number: z.string(),
  /** The group heading it sits under, e.g. "A. Concepts" or "B. Calculations". */
  group: z.string().optional(),
  prompt: z.string(),
  /** Absent when the answers note has no answer with this number. */
  answer: z.string().optional(),
  /** Key steps from the answer's `> [!rubric]-` callout, in order, for self-grading; the callout is not in `answer`. */
  rubric: z.array(z.string()).min(2).optional(),
  /** Notes the question or its answer points to ("→ [[OLS Estimator]]"), for "revise this". */
  links: z.array(Slug),
});
export type PracticeItem = z.infer<typeof PracticeItem>;

export const NoteBody = z.strictObject({
  slug: Slug,
  notation: z.array(NotationRow),
  /** Prose in the Notation section above the table. */
  notationIntro: z.string().optional(),
  sections: z.array(Section),
  /** Practice notes with a paired answers note: the questions, one per item, answers attached. */
  practice: z.strictObject({ answers: Slug, items: z.array(PracticeItem).min(1) }).optional(),
});
export type NoteBody = z.infer<typeof NoteBody>;

export const NoteMeta = z.strictObject({
  slug: Slug,
  /** The vault note name (what wikilinks use). */
  name: z.string(),
  /** Display title: a lecture's or paper's `title`, a course's confirmed title, else the note name. */
  title: z.string(),
  type: NoteType,
  path: z.string(),
  summary: z.string(),
  domain: z.string().optional(),
  domains: z.array(z.string()).optional(),
  tags: z.array(z.string()),
  aliases: z.array(z.string()),
  requires: z.array(Slug),
  lessons: z.array(Slug),
  courses: z.array(z.string()),
  course: z.string().optional(),
  lecture: z.number().int().optional(),
  authors: z.array(z.string()).optional(),
  year: z.number().int().optional(),
  venue: z.string().optional(),
  source: z.string().optional(),
  period: z.string().optional(),
  edges: z.strictObject({ out: z.array(Edge), in: z.array(Edge) }),
  figures: z.array(z.string()),
  interactives: z.array(Slug),
  checks: z.number().int().nonnegative(),
  /** Derive blocks in the body; absent when there are none. */
  derives: z.number().int().positive().optional(),
  words: z.number().int().nonnegative(),
  pairedAnswers: Slug.optional(),
  /** A lecture's '## What to be able to do' list, once any of its items is tagged `objective: N`. `tested` counts
   *  the checks, derives and placements with a goal or predict tagged with it. */
  objectives: z
    .array(z.strictObject({ n: z.number().int().positive(), md: z.string(), tested: z.number().int().nonnegative() }))
    .optional(),
  /** Lectures only. The export carries only "pending" (the interactive pass has not run) for now. */
  interactive: z.union([z.boolean(), z.literal("pending")]).optional(),
  created: z.iso.datetime(),
  updated: z.iso.datetime(),
});
export type NoteMeta = z.infer<typeof NoteMeta>;

export const Course = z.strictObject({
  code: z.string(),
  id: Slug,
  /** Absent while the hub's title is a placeholder - show the code alone. */
  title: z.string().optional(),
  instructor: z.string().optional(),
  hub: Slug,
  lectures: z.array(Slug),
  practice: z.array(Slug),
  guides: z.array(Slug),
});
export type Course = z.infer<typeof Course>;

/** Read off spec.ts, so a widget type added there needs no change here. */
const WIDGET_TYPES = WidgetSpec.options.map((o) => o.shape.type.value) as [WidgetType, ...WidgetType[]];

export const WidgetEntry = z.strictObject({
  slug: Slug,
  name: z.string(),
  type: z.enum(WIDGET_TYPES),
  /** The model note a view widget is built on (B0); absent for a self-contained widget. */
  model: Slug.optional(),
  spec: WidgetSpec,
  illustrates: z.array(Slug),
  /** Rows from the illustrated notes' Notation tables that define the spec's symbols (slider hover text). */
  notation: z.array(NotationRow),
});
export type WidgetEntry = z.infer<typeof WidgetEntry>;

export const DatasetMeta = z.strictObject({
  id: z.string(),
  title: z.string(),
  src: z.string(),
  format: z.enum(["csv", "json"]),
  columns: z.record(z.string(), z.record(z.string(), z.string())),
  period: z.string().optional(),
  generated: z.string().optional(),
  sha256: z.string().optional(),
  notebook: z.string().optional(),
  description: z.string().optional(),
  dataSource: Slug.optional(),
});
export type DatasetMeta = z.infer<typeof DatasetMeta>;

export const Index = z
  .strictObject({
    schema: z.literal(IR_SCHEMA),
    generated_at: z.iso.datetime(),
    vault: z.strictObject({ notes: z.number().int(), errors: z.literal(0), warnings: z.number().int().nonnegative() }),
    courses: z.array(Course),
    domains: z.array(z.strictObject({ id: z.string(), label: z.string(), notes: z.array(Slug) })),
    tags: z.record(z.string(), z.array(Slug)),
    notes: z.record(Slug, NoteMeta),
    widgets: z.record(Slug, WidgetEntry),
    datasets: z.record(z.string(), DatasetMeta),
  })
  .refine((ix) => Object.entries(ix.notes).every(([slug, m]) => m.slug === slug), "notes must be keyed by their slug")
  .refine((ix) => Object.entries(ix.widgets).every(([slug, w]) => w.slug === slug && w.type === w.spec.type), "widgets must be keyed by slug");
export type Index = z.infer<typeof Index>;

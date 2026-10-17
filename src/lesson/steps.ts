// Pure helpers over a note body: the flat step sequence the reveal walks, each step's visual, and its gates.
import type { Block, NoteBody, Section, Step } from "../ir";
import { blockKey, type ProgressData } from "../progress/store";

export type FlatStep = { step: Step; section: Section; index: number; firstInSection: boolean };

export function flattenSteps(body: NoteBody): FlatStep[] {
  const out: FlatStep[] = [];
  for (const section of body.sections) {
    section.steps.forEach((step, i) => out.push({ step, section, index: out.length, firstInSection: i === 0 }));
  }
  return out;
}

export type VisualBlock = Extract<Block, { t: "figure" } | { t: "interactive" }>;

/** The block that drives the visual pane: the step's last figure or interactive. */
export function stepVisual(step: Step): { block: VisualBlock; at: number } | undefined {
  for (let i = step.blocks.length - 1; i >= 0; i--) {
    const b = step.blocks[i]!;
    if (b.t === "figure" || b.t === "interactive") return { block: b, at: i };
  }
  return undefined;
}

export type Gate = { key: string; kind: "check" | "goal" | "derive" };

/** What must be answered (or skipped) before Continue moves past this step. */
export function stepGates(slug: string, step: Step): Gate[] {
  const gates: Gate[] = [];
  step.blocks.forEach((b, i) => {
    if (b.t === "check") gates.push({ key: blockKey(slug, step.id, i), kind: "check" });
    else if (b.t === "derive") gates.push({ key: blockKey(slug, step.id, i), kind: "derive" });
    // A planned placement is a figure, so a goal on it can never be met and gates nothing.
    else if (b.t === "interactive" && b.goal && b.status !== "planned") gates.push({ key: blockKey(slug, step.id, i), kind: "goal" });
  });
  return gates;
}

/** A derivation opens its gate once it is finished, given up or skipped; a record that is still "open" (lines saved
 *  part-way) does not. */
export function gateOpen(data: ProgressData, gate: Gate): boolean {
  if (gate.kind === "check") return data.checks[gate.key] !== undefined;
  if (gate.kind === "derive") {
    const d = data.derives[gate.key];
    return d !== undefined && d.result !== "open";
  }
  return data.checkpoints[gate.key] !== undefined;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The step an anchor points at: a step id, a section id, or an Obsidian heading anchor (heading text). */
export function findAnchor(steps: FlatStep[], anchor: string): FlatStep | undefined {
  const wanted = slugify(anchor);
  return (
    steps.find((s) => s.step.id === anchor) ??
    steps.find((s) => s.firstInSection && s.section.id === anchor) ??
    steps.find((s) => s.firstInSection && (s.section.id === wanted || slugify(s.section.heading) === wanted)) ??
    steps.find((s) => s.step.heading !== undefined && slugify(s.step.heading) === wanted)
  );
}

export const hasVisuals = (steps: FlatStep[]) => steps.some((s) => stepVisual(s.step) !== undefined);

/** Section headings as the reader sees them; the untitled lead section of lectures reads as "Overview". */
export const sectionTitle = (section: Section) => section.heading || "Overview";

export type Placement = { step: string; label: string };

/** The steps of a note body that place a widget, labelled by section (and step heading when it has one). */
export function placements(body: NoteBody, widget: string): Placement[] {
  const out: Placement[] = [];
  for (const section of body.sections) {
    for (const step of section.steps) {
      if (!step.blocks.some((b) => b.t === "interactive" && b.widget === widget)) continue;
      const label = [sectionTitle(section), step.heading].filter(Boolean).join(" · ");
      // Consecutive steps under one heading read as one place.
      if (out.at(-1)?.label !== label) out.push({ step: step.id, label });
    }
  }
  return out;
}

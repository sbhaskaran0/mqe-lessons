// The contract between the lesson player (src/app, src/lesson) and the widget runtime (src/widgets).
// The player owns layout, the sticky visual pane, prompts and progress; it renders <WidgetHost> and
// passes the active step's ```interactive block as `view`. The runtime owns everything inside the widget.
//
// Rules both sides rely on:
// - Within one note the player keeps the same <WidgetHost key={widget slug}> mounted while consecutive
//   steps name the same widget, and only changes `view`; the widget animates to the new view
//   (state presets, lock, show, highlight) instead of remounting.
// - `view.state` presets apply when a view arrives; afterwards the learner's slider moves win until the
//   next view. Locked params render as disabled sliders.
// - The runtime calls onGoalMet once per view when `view.goal.when` first holds, and onPredict when the
//   learner commits a prediction. The player records both as checkpoint results.
// - Colours, fonts and spacing come from CSS variables in src/styles/tokens.css (--chart-1..6,
//   --chart-axis, --chart-grid, --chart-highlight, --accent, --text, …). No hard-coded colours.
// - Symbols render with <Tex> from src/lib/Tex.tsx; hovering a parameter shows its notation row
//   from entry.notation (meaning · kind · typical value).
import type { ComponentType } from "react";
import type { Block, DatasetMeta, WidgetEntry } from "../ir";

export type InteractiveBlock = Extract<Block, { t: "interactive" }>;

export type WidgetProps = {
  entry: WidgetEntry;
  /** The active step's block; null when the widget is shown on its own (its note page, or "explore"). */
  view: InteractiveBlock | null;
  datasets: Record<string, DatasetMeta>;
  /** Base URL that dataset/figure `src` paths are relative to (the content root). */
  contentBase: string;
  /** Narrow layout (mobile, inline in a step) - fewer controls side by side. */
  compact?: boolean;
  onGoalMet?: () => void;
  /** `expected` is the readout's value for a compute-before-reveal prediction; `explanation` is the learner's
   *  optional "why do you think so?", written before the reveal. */
  onPredict?: (choice: { option?: number; value?: number; correct?: boolean; expected?: number; explanation?: string }) => void;
  /** What progress already holds for this view, so a revisited step doesn't re-ask: a met goal shows its
   *  success state; a committed prediction starts revealed (the first guess stays the recorded one). */
  initial?: { goalMet?: boolean; predicted?: { option?: number; value?: number; correct?: boolean } };
};

export type WidgetComponent = ComponentType<WidgetProps>;

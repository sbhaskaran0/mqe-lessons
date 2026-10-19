// What a view shows of a panels widget. One rule for every panel kind, merging function-plot's (only the marks `show`
// names) with dynamics' (a show list naming panels shows them whole):
// - if `show` names any mark, only the named marks show;
// - otherwise a panel `show` names shows all of its marks;
// - a panel shows if it is named, or if it holds a named mark.
// A mark hidden by an unanswered prediction still counts as named, so the reveal never changes the layout.
// A panel hidden by an unanswered prediction leaves the stage while another panel stays on it; when it would empty
// the stage (a one-panel view), it stays as an empty frame (its axes, none of its marks) until the learner commits.
import type { Runtime } from "../core/useWidgetRuntime";
import type { PanelsSpec } from "../expr";
import { type Panel, panelMarks } from "../spec";

export type ShowRule = {
  /** The panel is on screen. */
  panel: (p: Panel) => boolean;
  /** The mark is drawn: named (or its panel named, when no mark is) and not hidden by a prediction. */
  mark: (id: string, panel: string) => boolean;
};

type Lists = Pick<Runtime, "listed" | "pending">;

export function showRule(spec: { panels: readonly Panel[] }, rt: Lists): ShowRule {
  const anyMark = spec.panels.some((p) => panelMarks(p).some((id) => rt.listed(id) === true));
  const named = (id: string, panel: string) => rt.listed(id) !== false || (!anyMark && rt.listed(panel) === true);
  const onShow = (p: Panel) => rt.listed(p.id) !== false || panelMarks(p).some((id) => named(id, p.id));
  const keepHidden = !spec.panels.some((p) => onShow(p) && !rt.pending(p.id));
  return {
    mark: (id, panel) => !rt.pending(id) && !rt.pending(panel) && named(id, panel),
    panel: (p) => onShow(p) && (keepHidden || !rt.pending(p.id)),
  };
}

/** Elements a placement shows (panels and marks), for parity checks and tests: `show` and no prediction. */
export function visibleElements(spec: PanelsSpec, show: string[] | undefined): string[] {
  const listed = (id: string) => (show ? show.includes(id) : undefined);
  const rule = showRule(spec, { listed, pending: () => false });
  return spec.panels.filter(rule.panel).flatMap((p) => [p.id, ...panelMarks(p).filter((id) => rule.mark(id, p.id))]);
}

// The layout every widget shares, top to bottom: title with its tools, the plot stage, the prediction, readouts,
// the free sliders (locked parameters follow as chips) and goal feedback. The stage keeps one height per view, sized
// to the room the pane has (see stage.tsx), so nothing below it shifts and nothing the learner moves is out of view.
// `compact` stacks everything in one narrow column.
import { type ReactNode, useContext, useRef } from "react";
import type { WidgetEntry } from "../../ir";
import type { Runtime } from "../core/useWidgetRuntime";
import { CompareToggleSlot } from "./Compare";
import { ResetIcon } from "./icons";
import { StageContext, useStageBudget } from "./stage";

type Props = {
  entry: WidgetEntry;
  rt?: Runtime;
  compact?: boolean;
  stage: ReactNode;
  predict?: ReactNode;
  readouts?: ReactNode;
  params?: ReactNode;
  tools?: ReactNode;
  feedback?: ReactNode;
};

export function WidgetFrame({ entry, rt, compact, stage, predict, readouts, params, tools, feedback }: Props) {
  const title = entry.spec.title ?? entry.name;
  const compare = useContext(CompareToggleSlot);
  const root = useRef<HTMLElement>(null);
  const stageEl = useRef<HTMLDivElement>(null);
  const budget = useStageBudget(root, stageEl, rt?.viewKey ?? "", !compact);
  const resettable = rt && Object.keys(rt.spec.params ?? {}).length > 0 ? rt : null;
  return (
    <section
      ref={root}
      className={`w-root${compact ? " w-compact" : ""}`}
      data-widget={entry.slug}
      data-type={entry.type}
      data-mode={rt?.explore ? "explore" : "view"}
      data-goal={rt?.view?.goal ? "" : undefined}
      aria-label={title}
    >
      <header className="w-head">
        <h3 className="w-title">{title}</h3>
        {compare || tools || resettable ? (
          <div className="w-toolbar">
            {compare}
            {tools}
            {resettable ? (
              <button type="button" className="w-btn w-btn-quiet w-btn-sm" aria-label="Reset" onClick={resettable.reset} title="Back to this step's starting values">
                <ResetIcon /> <span className="w-btn-label">Reset</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </header>
      <div className="w-stage" ref={stageEl}>
        <StageContext.Provider value={budget}>{stage}</StageContext.Provider>
      </div>
      {predict}
      {readouts}
      {params}
      {feedback}
    </section>
  );
}

/** A widget-shaped card for things that aren't a working widget yet (or any more). */
export function WidgetNotice({ entry, tone, title, children }: { entry: WidgetEntry; tone: "info" | "error"; title: string; children: ReactNode }) {
  const compare = useContext(CompareToggleSlot); // a widget still loading its data can be compared with its figure
  return (
    <section className={`w-root w-notice w-notice-${tone}`} data-widget={entry.slug} data-type={entry.type} role={tone === "error" ? "alert" : undefined}>
      <header className="w-head">
        <h3 className="w-title">{entry.spec.title ?? entry.name}</h3>
        {compare ? <div className="w-toolbar">{compare}</div> : null}
      </header>
      <div className="w-notice-body">
        <p className="w-notice-title">{title}</p>
        {children}
      </div>
    </section>
  );
}

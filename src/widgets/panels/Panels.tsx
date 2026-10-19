// panels: a view of a model, flattened by the exporter into one spec. Its panels (curve, path, contour, vector) stack
// in the stage and share one set of sliders, readouts, goal and prediction. A model note's own page is the same
// widget with no panels: its sliders and its values.
import { useDeferredValue, useMemo, useState } from "react";
import { resolveColor } from "../core/colors";
import { readoutValues } from "../core/evaluate";
import { useGoal, useWidgetRuntime } from "../core/useWidgetRuntime";
import { type PanelsSpec, pathSeries, samplerRuns, simulate, withDerived } from "../expr";
import { format } from "../format";
import type { WidgetProps } from "../host";
import type { PlotShare } from "../plot/PlotFrame";
import type { Panel } from "../spec";
import { GoalFeedback, HintButton, PredictPanel } from "../ui/Feedback";
import { ParamPanel } from "../ui/ParamPanel";
import { type ReadoutItem, Readouts } from "../ui/Readouts";
import { WidgetFrame } from "../ui/WidgetFrame";
import { CurvePanel } from "./CurvePanel";
import { PhasePanel, type SeriesView, TimePanel } from "./PathPanel";
import { PlanePanel } from "./PlanePanel";
import { SamplerPanel } from "./SamplerPanel";
import { showRule } from "./show";

const isTime = (p: Panel) => p.kind === "path" && !p.phase;

export default function Panels({ entry, view, compact, onGoalMet, onPredict, initial }: WidgetProps) {
  const spec = entry.spec as PanelsSpec;
  const rt = useWidgetRuntime(spec, view, onPredict, initial);
  const base = useMemo(() => withDerived(spec, rt.params), [spec, rt.params]);
  const sampled = useSampled(spec, rt.params);
  const scope = useMemo(() => (sampled ? { ...base, ...sampled.summaries } : base), [base, sampled]);
  const readouts = useMemo(() => readoutValues(spec, scope), [spec, scope]);
  rt.readouts.current = readouts;
  const goal = useGoal(rt, useMemo(() => ({ ...scope, ...readouts }), [scope, readouts]), onGoalMet);
  const sim = useMemo(() => (spec.recurrence ? simulate(spec, rt.params) : null), [spec, rt.params]);
  const { listed, pending } = rt;
  const show = useMemo(() => showRule(spec, { listed, pending }), [spec, listed, pending]);
  const [hoverT, setHoverT] = useState<number | null>(null);

  const visible = spec.panels.filter(show.panel);
  const times = visible.filter(isTime);
  const many = visible.length > 1;
  // Stacked time panels share one time axis: only the last of them labels it. Other panels carry their own axes.
  const share = (p: Panel): PlotShare => ({ parts: visible.length, axes: (times.length ? 1 : 0) + visible.length - times.length, axis: !isTime(p) || p === times[times.length - 1] });
  const markerMode = !!rt.predict && !rt.predict.options && rt.predict.readout === undefined;
  const first = visible[0];
  const series = sim ? seriesViews(spec, sim, show) : [];
  const shocks = (spec.recurrence?.shocks ?? []).filter((s, _, all) => {
    if (s.id === undefined) return true;
    const anyListed = all.some((x) => x.id !== undefined && rt.listed(x.id));
    return !rt.pending(s.id) && (rt.listed(s.id) !== false || !anyListed);
  });
  const title = spec.title ?? entry.name;

  const stage = spec.panels.length ? (
    <div className="w-panels">
      {visible.map((p, i) => {
        const marker = markerMode && p === first;
        switch (p.kind) {
          case "curve":
            return <CurvePanel key={p.id} spec={spec} panel={p} scope={scope} rt={rt} show={show} height={compact ? 260 : many ? 240 : 340} share={many ? share(p) : undefined} titled={many} marker={marker} ariaTitle={title} />;
          case "path":
            if (p.phase) return sim ? <PhasePanel key={p.id} spec={spec} panel={p} sim={sim} params={rt.params} rt={rt} height={compact ? 230 : 260} share={share(p)} /> : null;
            return (
              <TimePanel
                key={p.id}
                spec={spec}
                panel={p}
                series={series.filter((s) => s.panel === p.id)}
                shocks={shocks}
                labelShocks={p === times[0]}
                height={compact ? 210 : many ? 220 : 320}
                share={share(p)}
                rt={rt}
                hoverT={hoverT}
                onHover={setHoverT}
                marker={marker}
                titled={many}
              />
            );
          case "sampler":
            return <SamplerPanel key={p.id} panel={p} run={sampled?.error ?? sampled?.runs[p.id]} scope={scope} rt={rt} show={show} height={compact ? 240 : many ? 240 : 320} share={many ? share(p) : undefined} titled={many} ariaTitle={title} />;
          default:
            return <PlanePanel key={p.id} spec={spec} panel={p} scope={scope} rt={rt} show={show} height={compact ? 260 : many ? 240 : 340} share={many ? share(p) : undefined} titled={many} ariaTitle={`${title} ${i + 1}`} />;
        }
      })}
    </div>
  ) : null;

  // A curve panel takes the guess along its x axis; a time panel takes the level a path settles at.
  const curveFirst = first?.kind === "curve" ? first : undefined;
  const xName = curveFirst ? (curveFirst.x.label ?? curveFirst.x.var ?? curveFirst.x.sweep ?? "x") : "";
  const xVar = curveFirst ? (curveFirst.x.var ?? curveFirst.x.sweep ?? "x") : "";
  const items: ReadoutItem[] = spec.readouts
    ? spec.readouts.map((r) => ({ id: r.id, tex: r.tex, label: r.label, format: r.format, labels: r.labels, value: readouts[r.id] ?? NaN }))
    : spec.panels.length
      ? []
      : Object.keys(spec.derived ?? {}).map((id) => ({ id, label: id, format: ".4~r", value: scope[id] ?? NaN }));

  return (
    <WidgetFrame
      entry={entry}
      rt={rt}
      compact={compact}
      stage={stage}
      predict={
        curveFirst ? (
          <PredictPanel predict={rt.predict} howTo={`Drag the marker to where you expect it along ${xName}.`} value={rt.predict?.marker?.[0]} describe={(v) => `${xVar} ≈ ${format(".3~r", v)}`} />
        ) : (
          <PredictPanel predict={rt.predict} howTo="Drag the marker to the level you expect the path to settle at." value={rt.predict?.marker?.[1]} describe={(v) => format(".3~r", v)} />
        )
      }
      readouts={<Readouts rt={rt} notation={entry.notation} items={items} />}
      params={<ParamPanel rt={rt} notation={entry.notation} />}
      tools={
        <>
          {sampled ? (
            <button type="button" className="w-btn w-btn-quiet w-btn-sm" onClick={sampled.again} title="Draw a fresh set of samples with the same settings">
              Draw again
            </button>
          ) : null}
          <HintButton goal={goal} />
        </>
      }
      feedback={<GoalFeedback goal={goal} />}
    />
  );
}

/** The view's Monte Carlo runs, or null without a sampler panel. A redraw takes up to ~100 ms, so it runs on deferred
 *  params: the slider moves at once and the histogram follows. "Draw again" moves every replication to fresh streams;
 *  goals and tests read the first draw, which is what a view starts from. */
function useSampled(spec: PanelsSpec, params: Record<string, number>) {
  const has = spec.panels.some((p) => p.kind === "sampler");
  const later = useDeferredValue(params);
  const [redraw, setRedraw] = useState(0);
  return useMemo(() => {
    if (!has) return null;
    const again = () => setRedraw((r) => r + 1);
    try {
      return { ...samplerRuns(spec, withDerived(spec, later), redraw), error: undefined, again };
    } catch (e) {
      return { runs: {}, summaries: {}, error: (e as Error).message, again };
    }
  }, [has, spec, later, redraw]);
}

/** Every time panel's series with its simulated values; colours run across the whole view, in panel order. */
function seriesViews(spec: PanelsSpec, sim: ReturnType<typeof simulate>, show: ReturnType<typeof showRule>): (SeriesView & { panel: string })[] {
  return pathSeries(spec).map((s, i) => ({
    id: s.id,
    tex: s.tex,
    label: s.label,
    color: resolveColor(s.color, i),
    values: sim.series[s.id] ?? [],
    shown: show.mark(s.id, s.panel),
    panel: s.panel,
  }));
}

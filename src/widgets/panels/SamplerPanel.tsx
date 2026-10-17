// A sampler panel: the histogram of one statistic over the replications of a seeded Monte Carlo (sampler.ts), drawn
// on a fixed x axis so a narrower sampling distribution looks narrower, with vertical lines (the true parameter, the
// mean of the draws) and normal densities (what a standard error claims the spread is) over it.
import { useMemo } from "react";
import { resolveColor } from "../core/colors";
import { value } from "../core/evaluate";
import type { Runtime } from "../core/useWidgetRuntime";
import type { Scope } from "../expr";
import { format } from "../format";
import { Bars, Clip, Curve, pathD, sample, Segment } from "../plot/marks";
import { type PlotLabel, PlotFrame, type PlotShare, usePlot } from "../plot/PlotFrame";
import { nice, type Range } from "../plot/ticks";
import { useAnimatedRange, useStickyRange } from "../plot/useRange";
import { normalPdf, type SamplerResult, type SamplerSpec } from "../sampler";
import { lineEnds, markLabels, markText } from "./CurvePanel";
import type { ShowRule } from "./show";

type Props = {
  panel: SamplerSpec;
  /** The run at the current values, or why it failed. */
  run: SamplerResult | string | undefined;
  /** Base values plus every sampler summary: what the lines and densities read. */
  scope: Scope;
  rt: Runtime;
  show: ShowRule;
  height: number;
  share?: PlotShare;
  titled: boolean;
  ariaTitle: string;
};

const BAR_COLOR = "var(--chart-1)";

export function SamplerPanel({ panel, run, scope, rt, show, height, share, titled, ariaTitle }: Props) {
  const x: Range = useMemo(() => [panel.x.min, panel.x.max], [panel.x.min, panel.x.max]);
  const shown = (id: string) => show.mark(id, panel.id);
  const densities = useMemo(
    () =>
      (panel.densities ?? []).map((d, i) => {
        const mean = value(d.mean, scope);
        const sd = value(d.sd, scope);
        const f = (v: number) => (sd > 0 ? normalPdf(v, mean, sd) : NaN);
        // Labelled on the right shoulder, staggered, so they clear the lines through the centre and each other.
        const at = mean + (1.1 + 0.7 * i) * sd;
        return { ...d, color: resolveColor(d.color, i + 1), pts: sample(f, x[0], x[1], 200), peak: [mean, f(mean)] as const, tag: [at, f(at)] as const };
      }),
    [panel.densities, scope, x],
  );
  const result = typeof run === "object" ? run : undefined;
  const top = Math.max(
    1e-9,
    ...(result?.bars.map((b) => b.height) ?? []),
    ...densities.filter((d) => shown(d.id)).map((d) => (Number.isFinite(d.peak[1]) ? d.peak[1] : 0)),
  );
  const yWanted: Range = [0, panel.y?.max ?? nice(0, top * 1.08)[1]];
  const y = useAnimatedRange(useStickyRange(yWanted, `${rt.viewKey}|${panel.id}`));
  // Vertical lines through the centre sit close together, so every label here is nudged clear of the others.
  const labels: PlotLabel[] = [
    ...markLabels({ lines: panel.lines }, scope, rt, shown, x, y).map((l) => ({ ...l, avoid: true })),
    ...densities.flatMap((d) => {
      const content = markText(d.tex, d.label);
      return content && shown(d.id) && Number.isFinite(d.tag[1]) ? [{ id: d.id, x: d.tag[0], y: d.tag[1], content, color: d.color, anchor: "ne" as const, avoid: true }] : [];
    }),
  ];
  const note = result
    ? `${format(",d", result.reps)} samples of N = ${format(",d", result.rows)}` + (result.outside ? ` · ${format(",d", result.outside)} outside the axis` : "")
    : typeof run === "string"
      ? `The samples could not be drawn: ${run}`
      : "Drawing…";
  return (
    <div className="w-panel" data-panel={panel.id}>
      {titled && panel.title ? <div className="w-panel-title">{panel.title}</div> : null}
      <PlotFrame
        x={x}
        y={y}
        height={height}
        share={share}
        xTitle={panel.x.label || panel.x.tex ? { label: panel.x.label, tex: panel.x.tex } : undefined}
        yTitle={panel.y?.label || panel.y?.tex ? { label: panel.y.label, tex: panel.y.tex } : { label: "Density" }}
        labels={labels}
        ariaLabel={`${panel.title ?? ariaTitle}: histogram of ${panel.stat} over ${result ? result.reps : "many"} samples`}
      >
        <Clip>
          {result ? <Bars id={panel.id} bars={result.bars} color={BAR_COLOR} highlight={rt.highlight === panel.id} className={rt.isRevealed(panel.id) ? "w-reveal" : undefined} /> : null}
          <Overlays panel={panel} densities={densities} scope={scope} rt={rt} shown={shown} />
        </Clip>
      </PlotFrame>
      <p className="w-panel-note" data-sampler-note="">
        {note}
      </p>
    </div>
  );
}

function Overlays({ panel, densities, scope, rt, shown }: { panel: SamplerSpec; densities: { id: string; color: string; style?: "solid" | "dashed" | "dotted"; pts: [number, number][] | readonly (readonly [number, number])[] }[]; scope: Scope; rt: Runtime; shown: (id: string) => boolean }) {
  const plot = usePlot();
  const cls = (id: string) => (rt.isRevealed(id) ? "w-reveal" : undefined);
  return (
    <>
      {densities.filter((d) => shown(d.id)).map((d) => (
        <Curve key={d.id} id={d.id} d={pathD(d.pts, plot)} color={d.color} style={d.style} highlight={rt.highlight === d.id} className={cls(d.id)} />
      ))}
      {(panel.lines ?? []).filter((l) => shown(l.id)).map((l, i) => {
        const ends = lineEnds(l, scope, plot.x, plot.y);
        return ends ? <Segment key={l.id} id={l.id} a={ends[0]} b={ends[1]} color={l.color ? resolveColor(l.color, i) : "var(--text)"} style={l.style ?? "dashed"} width={1.75} highlight={rt.highlight === l.id} className={cls(l.id)} /> : null;
      })}
    </>
  );
}

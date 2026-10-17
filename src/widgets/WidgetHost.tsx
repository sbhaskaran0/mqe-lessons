// The widget runtime's entry point (see host.tsx for the contract with the player). It checks the spec, picks
// the component for its type from the registry, and makes sure a broken widget shows a readable card instead of
// a blank pane. A placement that is still planned (or that the runtime can't draw) shows its static figure instead.
import "mafs/core.css";
import "./widgets.css";
import "./planned.css";
import { Suspense, useEffect } from "react";
import type { WidgetEntry } from "../ir";
import { checkWidget } from "./expr";
import type { WidgetProps } from "./host";
import { hasRuntime, registry } from "./registry";
import { WidgetSpec } from "./spec";
import { CompareFrame } from "./ui/Compare";
import { WidgetErrorBoundary, WidgetError } from "./ui/ErrorBoundary";

const checked = new WeakMap<WidgetEntry, string[]>();

/** Structural and expression problems in a widget's spec (export validates these too; this guards live edits).
 *  It runs during the widget's first render, so it leaves the spec's `tests` to `npm run validate`. */
export function specProblems(entry: WidgetEntry): string[] {
  let problems = checked.get(entry);
  if (!problems) {
    const parsed = WidgetSpec.safeParse(entry.spec);
    problems = parsed.success
      ? checkWidget(parsed.data, undefined, { tests: false }).errors
      : parsed.error.issues.map((i) => `${i.path.join(".") || "spec"}: ${i.message}`);
    checked.set(entry, problems);
  }
  return problems;
}

/** `onPlaceholder` fires when the static figure is shown instead, so progress can tell a later activation from a first sight.
 *  `entry` is absent for a planned placement whose widget isn't built (and so isn't in the export).
 *  `onLive` fires when a live widget is drawn for this view, so the player can record it as seen. */
export type HostProps = Omit<WidgetProps, "entry"> & { entry?: WidgetEntry | undefined; onLive?: (() => void) | undefined; onPlaceholder?: (() => void) | undefined };

/** Whether this view shows its static figure rather than a widget: the placement says it is planned, or its spec
 *  doesn't validate against the supported primitives and the placement has a figure to stand in. */
export function standsIn(entry: WidgetEntry | undefined, view: WidgetProps["view"]): boolean {
  if (view?.status === "planned") return true;
  if (!view?.figure) return false;
  return !entry || specProblems(entry).length > 0;
}

export function WidgetHost({ entry, onLive, onPlaceholder, ...rest }: HostProps) {
  if (standsIn(entry, rest.view)) return <PlannedFigure view={rest.view!} contentBase={rest.contentBase} name={entry?.name} onShown={onPlaceholder} />;
  if (!entry) return <p className="w-planned-note">This interactive is not available yet.</p>;
  const props: WidgetProps = { ...rest, entry };
  return (
    <WidgetErrorBoundary entry={entry}>
      <Suspense fallback={<div className={`w-root w-skeleton${props.compact ? " w-compact" : ""}`} aria-busy="true" />}>
        <Dispatch {...props} onLive={onLive} />
      </Suspense>
    </WidgetErrorBoundary>
  );
}

function PlannedFigure({ view, contentBase, name, onShown }: { view: NonNullable<WidgetProps["view"]>; contentBase: string; name: string | undefined; onShown: (() => void) | undefined }) {
  useEffect(() => onShown?.(), [onShown]);
  // What the interactive is for, in words: never the slug.
  const what = (view.prompt ?? view.purpose ?? name)?.replace(/\$/g, "");
  const label = what ?? "Interactive";
  return (
    <figure className="w-planned" data-widget={view.widget} data-planned="">
      {view.figure ? <img className="w-planned-img" src={new URL(view.figure, contentBase || document.baseURI).href} alt={label} loading="lazy" decoding="async" /> : null}
      {view.figure || !what ? null : <p className="w-planned-what">{what}</p>}
      <figcaption className="w-planned-note">Interactive coming</figcaption>
    </figure>
  );
}

function Dispatch({ onLive, ...props }: WidgetProps & { onLive: (() => void) | undefined }) {
  const problems = specProblems(props.entry);
  const Component = problems.length ? undefined : registry[props.entry.spec.type];
  const live = Component !== undefined && hasRuntime(props.entry.spec.type);
  useEffect(() => {
    if (live) onLive?.();
  }, [live, onLive]);
  if (problems.length) return <WidgetError entry={props.entry} problems={problems} />;
  if (!Component) return <WidgetError entry={props.entry} problems={[`no widget runtime for type '${props.entry.spec.type}'`]} />;
  return (
    <CompareFrame entry={props.entry} contentBase={props.contentBase} compact={props.compact}>
      <Component {...props} />
    </CompareFrame>
  );
}

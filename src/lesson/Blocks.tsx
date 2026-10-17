// One renderer per IR block type. A step renders its blocks in order; on desktop the block that drives the
// visual pane is replaced in the step column by a small marker, since the pane shows it.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Md, useNoteLinkClick } from "../app/Md";
import { Icon, Modal, ProgressBar } from "../app/ui";
import { useContent } from "../content/context";
import { noteHref } from "../content/model";
import { assetUrl } from "../content/store";
import type { Block, NoteBody } from "../ir";
import { blockKey, noteFraction, progress, useProgress } from "../progress";
import { plannedSeenKey } from "../progress/dashboard";
import type { InteractiveBlock, WidgetProps } from "../widgets/host";
import { Check } from "./Check";
import { Derive } from "./Derive";
import { MathBlock } from "./SymbolHover";

// The widget runtime (mathjs, Mafs, the spec checker) loads with the first widget a reader meets, not with every page.
const WidgetHost = lazy(() => import("../widgets/WidgetHost").then((m) => ({ default: m.WidgetHost })));

/** Fetches the widget runtime and the widget kinds a note places while the reader is still on its opening steps, so
 *  the first interactive they reach starts at once instead of on a download. */
export function usePreloadWidgets(body: NoteBody) {
  const content = useContent();
  useEffect(() => {
    const types = body.sections.flatMap((s) => s.steps.flatMap((st) => st.blocks.flatMap((b) => (b.t === "interactive" ? [content.index.widgets[b.widget]?.type] : []))));
    const used = types.filter((t) => t !== undefined);
    if (!used.length) return;
    void import("../widgets/WidgetHost").catch(() => {});
    void import("../widgets/registry").then((r) => r.preload(used), () => {});
  }, [body, content]);
}

export type BlockContext = {
  slug: string;
  stepId: string;
  /** Narrow layout: deep-dive panel, phone width, course notes. */
  compact: boolean;
  /** Bare interactive blocks of an interactive note show the widget on its own (view = null). */
  standaloneWidget?: string;
};

export function BlockView({ block, index, ctx, inPane }: { block: Block; index: number; ctx: BlockContext; inPane: boolean }) {
  switch (block.t) {
    case "prose":
      return <Md md={block.md} className="block-prose" />;
    case "math":
      return <MathBlock tex={block.tex} />;
    case "figure":
      return inPane ? <VisualMarker kind="figure" label={block.caption ?? block.alt} /> : <Figure block={block} />;
    case "table":
      return <Md md={block.md} className="block-table" />;
    case "callout":
      return <Callout block={block} />;
    case "quote":
      return block.papers?.length ? <PaperQuote papers={block.papers} /> : <Md md={block.md} as="div" className="block-quote" />;
    case "links":
      return <LinkPath items={block.items} role={block.role} />;
    case "check":
      return <Check block={block} storeKey={blockKey(ctx.slug, ctx.stepId, index)} />;
    case "derive":
      return <Derive block={block} storeKey={blockKey(ctx.slug, ctx.stepId, index)} />;
    case "interactive":
      return <Interactive block={block} storeKey={blockKey(ctx.slug, ctx.stepId, index)} ctx={ctx} inPane={inPane} />;
  }
}

function VisualMarker({ kind, label }: { kind: "figure" | "interactive"; label: string }) {
  return (
    <p className="visual-marker" data-kind={kind}>
      <Icon name={kind === "figure" ? "image" : "sliders"} size={16} />
      <span className="visual-marker-label">
        <Md md={label} inline />
      </span>
      <Icon name="arrowRight" size={16} className="visual-marker-arrow" />
    </p>
  );
}

export function Figure({ block, framed = false }: { block: Extract<Block, { t: "figure" }>; framed?: boolean }) {
  const [zoom, setZoom] = useState(false);
  const src = assetUrl(block.src);
  return (
    <figure className={framed ? "figure figure-framed" : "figure"}>
      <button type="button" className="figure-zoom" onClick={() => setZoom(true)} aria-label={`Enlarge figure: ${block.alt}`}>
        <img src={src} alt={block.alt} loading="lazy" decoding="async" />
      </button>
      {block.caption ? <Md md={block.caption} as="figcaption" /> : null}
      <Modal open={zoom} onClose={() => setZoom(false)} label={block.alt} variant="full" className="lightbox">
        <div className="lightbox-bar">
          <span className="lightbox-title">{block.alt}</span>
          <button type="button" className="icon-btn" onClick={() => setZoom(false)} aria-label="Close figure">
            <Icon name="close" />
          </button>
        </div>
        <img className="lightbox-img" src={src} alt={block.alt} />
        {block.caption ? <Md md={block.caption} className="lightbox-caption" /> : null}
      </Modal>
    </figure>
  );
}

const CALLOUT_LABEL: Record<string, string> = {
  note: "Note",
  tip: "Tip",
  info: "Info",
  warning: "Warning",
  important: "Important",
  danger: "Careful",
  question: "Question",
  quote: "Quote",
  why: "Why it matters",
};

function Callout({ block }: { block: Extract<Block, { t: "callout" }> }) {
  const title = block.title || CALLOUT_LABEL[block.kind] || "Note";
  if (block.folded) {
    return (
      <details className="callout callout-folded" data-kind={block.kind}>
        <summary>
          <Md md={title} inline className="callout-title" />
          <span className="callout-reveal" aria-hidden="true">
            <span className="when-closed">Reveal</span>
            <span className="when-open">Hide</span>
          </span>
        </summary>
        <Md md={block.md} className="callout-body" />
      </details>
    );
  }
  return (
    <aside className="callout" data-kind={block.kind} aria-label={CALLOUT_LABEL[block.kind] ?? "Note"}>
      <Md md={title} inline as="p" className="callout-title" />
      {block.md ? <Md md={block.md} className="callout-body" /> : null}
    </aside>
  );
}

function PaperQuote({ papers }: { papers: string[] }) {
  const content = useContent();
  const onClick = useNoteLinkClick();
  return (
    <div className="paper-quote" onClick={onClick}>
      <p className="paper-quote-kicker">
        <Icon name="book" size={16} /> Paper summary
      </p>
      {papers.map((slug) => {
        const m = content.note(slug);
        if (!m) return null;
        const byline = [m.authors?.join(", "), m.year].filter(Boolean).join(" · ");
        return (
          <a key={slug} className="paper-card" href={noteHref(content, slug)} data-note={slug}>
            <span className="paper-card-title">{m.title}</span>
            {byline ? <span className="paper-card-byline">{byline}</span> : null}
            {m.venue ? <span className="paper-card-venue">{m.venue}</span> : null}
            {m.summary ? <Md md={m.summary} inline as="span" className="paper-card-summary" /> : null}
          </a>
        );
      })}
    </div>
  );
}

function LinkPath({ items, role }: { items: string[]; role: "concepts" | "facts" | "papers" }) {
  const content = useContent();
  const data = useProgress();
  const onClick = useNoteLinkClick();
  return (
    <ol className="link-path" data-role={role} onClick={onClick}>
      {items.map((slug, i) => {
        const m = content.note(slug);
        if (!m) return null;
        const fraction = noteFraction(data, slug);
        const opened = data.notes[slug] !== undefined;
        return (
          <li key={slug} className="link-path-item" data-done={fraction >= 1 || undefined} data-opened={opened || undefined}>
            <span className="link-path-node" aria-hidden="true">
              {fraction >= 1 ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <a className="link-path-card" href={noteHref(content, slug)} data-note={slug}>
              <span className="link-path-title">{m.title}</span>
              {m.summary ? <Md md={m.summary} inline as="span" className="link-path-summary" /> : null}
              {opened ? <ProgressBar value={fraction} label={`${m.title}: ${Math.round(fraction * 100)}% seen`} /> : null}
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/** The key a block's prediction is stored under: its own, since one block can carry both a goal and a prediction. */
export const predictKey = (storeKey: string) => `${storeKey}#predict`;

function checkpointHandlers(storeKey: string) {
  return {
    // A skipped goal reached later becomes met; a met goal keeps the time it was first reached.
    onGoalMet: () => {
      if (progress.get().checkpoints[storeKey]?.result === "met") return;
      progress.recordCheckpoint(storeKey, { kind: "goal", result: "met", at: Date.now() });
    },
    // The widget asks again whenever its step comes back into view; only the first guess says what the learner
    // expected before seeing the answer, so later commits are not recorded.
    onPredict: (choice: { option?: number; value?: number; correct?: boolean; explanation?: string }) => {
      if (progress.get().checkpoints[predictKey(storeKey)]) return;
      const answer: { option?: number; value?: number } = {};
      if (choice.option !== undefined) answer.option = choice.option;
      if (choice.value !== undefined) answer.value = choice.value;
      const result = choice.correct === undefined ? "committed" : choice.correct ? "correct" : "incorrect";
      progress.recordCheckpoint(predictKey(storeKey), { kind: "predict", result, answer, at: Date.now() });
      // The learner's own "why", written before the reveal: kept with the first guess, never graded.
      if (choice.explanation) progress.recordExplanation(predictKey(storeKey), choice.explanation);
    },
  };
}

/** What progress already holds for a block, read back the way the handlers above wrote it, so a step the learner comes
 *  back to shows its success and its recorded guess instead of asking again. */
function useInitial(block: InteractiveBlock, storeKey: string, enabled: boolean): InteractiveBlockInitial | undefined {
  const { checkpoints } = useProgress();
  const goal = checkpoints[storeKey];
  const guess = checkpoints[predictKey(storeKey)];
  return useMemo(() => {
    if (!enabled) return undefined;
    const goalMet = !!block.goal && goal?.result === "met";
    const predicted = block.predict && guess?.kind === "predict" ? predictedOf(guess) : undefined;
    return goalMet || predicted ? { goalMet, predicted } : undefined;
  }, [enabled, block.goal, block.predict, goal, guess]);
}

type InteractiveBlockInitial = NonNullable<WidgetProps["initial"]>;

function predictedOf(r: { result: string; answer?: unknown }): InteractiveBlockInitial["predicted"] {
  const a = (r.answer ?? {}) as { option?: number; value?: number };
  if (a.option === undefined && a.value === undefined) return undefined;
  return { ...a, ...(r.result === "correct" ? { correct: true } : r.result === "incorrect" ? { correct: false } : {}) };
}

/** The widget for a block, with the player's progress hooks wired in (stable per block, so a widget can keep
 *  them in effect dependencies without re-firing). */
export function WidgetSlot({ block, storeKey, compact, standalone }: { block: InteractiveBlock; storeKey: string; compact: boolean; standalone?: boolean }) {
  const content = useContent();
  const handlers = useMemo(() => checkpointHandlers(storeKey), [storeKey]);
  const initial = useInitial(block, storeKey, !standalone);
  const entry = content.index.widgets[block.widget];
  // Recorded once the live widget is drawn, so the progress page can point at interactives that arrived after a read.
  const seen = useMemo(() => {
    const slug = storeKey.slice(0, storeKey.indexOf("#"));
    if (!slug || standalone) return {};
    return {
      onLive: () => progress.markWidgetsSeen(slug, [storeKey]),
      // Seeing the placeholder is what makes its later activation "new" (see newInteractives).
      onPlaceholder: () => progress.markWidgetsSeen(slug, [plannedSeenKey(storeKey)]),
    };
  }, [storeKey, standalone]);
  // A planned placement has no entry in the export: it shows its figure instead.
  if (!entry && block.status !== "planned") {
    return (
      <p className="widget-missing" role="note">
        This step places the interactive “{block.widget}”, which is not in the export.
      </p>
    );
  }
  return (
    <div className="widget-slot" data-widget={block.widget}>
      <Suspense fallback={<div className="widget-loading" data-compact={compact || undefined} aria-busy="true" aria-label={`Loading ${entry?.name ?? "interactive"}`} />}>
        <WidgetHost
          entry={entry}
          view={standalone ? null : block}
          datasets={content.index.datasets}
          contentBase={content.contentBase}
          compact={compact}
          onGoalMet={handlers.onGoalMet}
          onPredict={handlers.onPredict}
          initial={initial}
          onLive={seen.onLive}
          onPlaceholder={seen.onPlaceholder}
        />
      </Suspense>
    </div>
  );
}

const isBare = (b: InteractiveBlock) => Object.keys(b).every((k) => k === "t" || k === "widget");

function Interactive({ block, storeKey, ctx, inPane }: { block: InteractiveBlock; storeKey: string; ctx: BlockContext; inPane: boolean }) {
  const content = useContent();
  // A planned placement has no widget note yet, so its chip reads as what it is for, never as its slug.
  const name = content.index.widgets[block.widget]?.name ?? (block.status === "planned" ? (block.prompt ?? block.purpose) : undefined) ?? block.widget;
  const standalone = ctx.standaloneWidget === block.widget && isBare(block);
  return (
    <div className="block-interactive">
      {/* In the pane the prompt sits above the widget there; inline it sits above the widget here. */}
      {block.prompt && !inPane ? <Md md={block.prompt} className="interactive-prompt" /> : null}
      {inPane ? (
        <VisualMarker kind="interactive" label={name} />
      ) : (
        <div className="widget-inline">
          <WidgetSlot block={block} storeKey={storeKey} compact={ctx.compact} standalone={standalone} />
        </div>
      )}
      {block.goal && block.status !== "planned" ? <GoalStatus goal={block.goal} storeKey={storeKey} /> : null}
    </div>
  );
}

function GoalStatus({ goal, storeKey }: { goal: NonNullable<InteractiveBlock["goal"]>; storeKey: string }) {
  const result = useProgress().checkpoints[storeKey];
  const met = result?.result === "met";
  return (
    <div className="goal" data-state={met ? "met" : result?.result === "skipped" ? "skipped" : "pending"} role="status">
      <p className="goal-head">
        <Icon name={met ? "check" : "flag"} size={16} />
        <span>{met ? "Goal reached" : result?.result === "skipped" ? "Goal skipped" : "Goal: reach it in the interactive"}</span>
      </p>
      {met ? <Md md={goal.success} className="goal-success" /> : null}
      {!met && goal.hint ? (
        <details className="goal-hint">
          <summary>Need a hint?</summary>
          <Md md={goal.hint} />
        </details>
      ) : null}
    </div>
  );
}

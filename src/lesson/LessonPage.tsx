// Lesson mode (#/lesson/<lecture>) and the micro-lesson (#/note/<slug>): progressive reveal behind Continue,
// checkpoints that gate it, Review mode, the sticky visual pane on desktop, symbols, deep dives and the footer.
import { Suspense, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "../app/ErrorBoundary";
import { Md, NoteLinkProvider, type NoteLinkHandler } from "../app/Md";
import { NotFound } from "../app/NotFound";
import { href, navigate } from "../app/router";
import { DESKTOP, Icon, Modal, ProgressBar, scrollBehavior, Switch, useDocumentTitle, useMediaQuery, WIDE } from "../app/ui";
import { useContent } from "../content/context";
import { courseOf, lecturesOf, noteHref } from "../content/model";
import { loadNote } from "../content/store";
import type { NoteBody, NoteMeta } from "../ir";
import { blockKey, noteFraction, progress, useProgress, useSettings } from "../progress";
import { DeepDive } from "./DeepDive";
import { Figure, usePreloadWidgets, WidgetSlot } from "./Blocks";
import { NoteFooter, NoteHeader, nextLecture } from "./NoteChrome";
import { findAnchor, flattenSteps, gateOpen, type Gate, hasVisuals, sectionTitle, stepGates, stepVisual, type FlatStep } from "./steps";
import { StepView } from "./StepView";
import { SymbolScope } from "./SymbolHover";
import { SymbolsDrawer } from "./Symbols";
import { useActiveStep } from "./useActiveStep";

type Mode = "lesson" | "note";

const GATE_NOTE: Record<Gate["kind"], string> = {
  check: "Answer the checkpoint to continue, or skip it.",
  goal: "Reach the goal in the interactive to continue, or skip it.",
  derive: "Finish the derivation to continue, or skip it.",
};

export function LessonPage({ slug, mode, at }: { slug: string; mode: Mode; at?: string | undefined }) {
  const content = useContent();
  const meta = content.note(slug);
  const hubOf = content.courseByHub.get(slug);
  const wanted: Mode | undefined = meta ? (meta.type === "lecture" ? "lesson" : "note") : undefined;
  const redirect = hubOf ? href({ name: "course", id: hubOf.id }) : wanted && wanted !== mode ? href({ name: wanted, slug, ...(at ? { at } : {}) }) : null;

  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true });
  }, [redirect]);

  if (!meta) return <NotFound what={slug} />;
  if (redirect) return null;
  return (
    <ErrorBoundary key={slug}>
      <Suspense fallback={<PageLoading title={meta.title} />}>
        <LessonLoader meta={meta} mode={mode} at={at} />
      </Suspense>
    </ErrorBoundary>
  );
}

function PageLoading({ title }: { title: string }) {
  return (
    <div className="page page-loading" aria-busy="true">
      <p className="loading">Loading {title}…</p>
    </div>
  );
}

function LessonLoader({ meta, mode, at }: { meta: NoteMeta; mode: Mode; at?: string | undefined }) {
  const body = use(loadNote(meta.slug));
  // Starting over remounts the view, so every step, check and widget starts from its stored (now empty) state.
  // The anchor that opened the page no longer applies: a fresh start lands on step 1.
  const [round, setRound] = useState(0);
  const restart = () => {
    progress.resetNote(meta.slug);
    if (at) navigate(href({ name: mode, slug: meta.slug }), { replace: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    setRound((r) => r + 1);
  };
  return <LessonView key={round} meta={meta} body={body} mode={mode} at={round > 0 ? undefined : at} onRestart={restart} />;
}

type Dive = { slug: string; anchor?: string | undefined };

function LessonView({ meta, body, mode, at, onRestart }: { meta: NoteMeta; body: NoteBody; mode: Mode; at?: string | undefined; onRestart: () => void }) {
  const content = useContent();
  const settings = useSettings();
  const data = useProgress();
  const desktop = useMediaQuery(DESKTOP);
  const wide = useMediaQuery(WIDE);
  useDocumentTitle(meta.title);
  usePreloadWidgets(body);

  const slug = meta.slug;
  const steps = useMemo(() => flattenSteps(body), [body]);
  const ids = useMemo(() => steps.map((s) => s.step.id), [steps]);
  const withPane = desktop && hasVisuals(steps);
  const review = settings.review;
  const anchorStep = at ? findAnchor(steps, at) : undefined;

  const [revealed, setRevealed] = useState(() => {
    const furthest = progress.get().notes[slug]?.furthest ?? 0;
    return Math.min(steps.length, Math.max(1, furthest + 1, (anchorStep?.index ?? 0) + 1));
  });
  const visibleCount = review ? steps.length : revealed;
  const visible = steps.slice(0, visibleCount);

  // Where to land: an explicit anchor, else the step the reader was last on, else the furthest step.
  const [landing] = useState(() => {
    if (anchorStep) return anchorStep;
    const last = progress.get().last;
    const lastStep = last?.slug === slug && last.stepId ? steps.find((s) => s.step.id === last.stepId) : undefined;
    if (lastStep && lastStep.index < visibleCount) return lastStep;
    return steps[Math.min(revealed, steps.length) - 1];
  });

  const listRef = useRef<HTMLDivElement>(null);
  const activeId = useActiveStep(listRef, null, visibleCount, landing?.step.id ?? ids[0]);
  const activeIndex = Math.max(0, ids.indexOf(activeId ?? ""));

  useEffect(() => progress.visit(slug), [slug]);
  useEffect(() => {
    if (activeId && ids.includes(activeId)) progress.markSeen(slug, ids, activeId);
  }, [activeId, ids, slug]);

  useLayoutEffect(() => {
    if (!landing || landing.index === 0) return;
    const el = listRef.current?.querySelector(`[data-step-id="${CSS.escape(landing.step.id)}"]`);
    el?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [landing]);

  // Continue reveals the next step, brings it into view once it has rendered and moves focus to it, so the button
  // that was pressed does not leave keyboard and screen-reader users behind. preventScroll: the glide is the scroll.
  const pendingScroll = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingScroll.current;
    if (!id) return;
    pendingScroll.current = null;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-step-id="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
    el?.focus({ preventScroll: true });
  }, [revealed]);

  const lastVisible = steps[revealed - 1];
  const gates = lastVisible ? stepGates(slug, lastVisible.step) : [];
  const unmet = gates.filter((g) => !gateOpen(data, g));

  const advance = useCallback(() => {
    if (revealed >= steps.length) return;
    pendingScroll.current = ids[revealed]!;
    progress.reveal(slug, ids, revealed);
    setRevealed(revealed + 1);
  }, [revealed, steps.length, ids, slug]);

  const skip = () => {
    const at = Date.now();
    for (const g of unmet) {
      if (g.kind === "check") progress.recordCheck(g.key, "skipped");
      else if (g.kind === "derive") progress.recordDerive(g.key, { result: "skipped" });
      else progress.recordCheckpoint(g.key, { kind: "goal", result: "skipped", at });
    }
    advance();
  };

  const scrollToStep = (s: FlatStep) => {
    if (!review && s.index >= revealed) return;
    const el = listRef.current?.querySelector(`[data-step-id="${CSS.escape(s.step.id)}"]`);
    el?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
  };

  // Deep dives: in lesson mode, links to concepts, facts, papers and other notes open over the lesson.
  const [dive, setDive] = useState<Dive[]>([]);
  const handleNoteLink: NoteLinkHandler = (target, anchor) => {
    if (target === slug) {
      const s = anchor ? findAnchor(steps, anchor) : undefined;
      if (!s) return false;
      if (s.index >= visibleCount) setRevealed(s.index + 1);
      pendingScroll.current = s.step.id;
      if (s.index < visibleCount) scrollToStep(s);
      return true;
    }
    if (mode !== "lesson") return false;
    const m = content.note(target);
    if (!m || m.type === "lecture" || m.type === "course") return false;
    setDive([{ slug: target, anchor }]);
    return true;
  };
  // Every Md in the lesson listens to this context, so the provided function must not change on each render.
  const noteLink = useRef(handleNoteLink);
  useLayoutEffect(() => {
    noteLink.current = handleNoteLink;
  });
  const onNoteLink = useCallback<NoteLinkHandler>((target, anchor) => noteLink.current(target, anchor), []);

  // Panels and rail.
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [railOverlay, setRailOverlay] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const railOpen = desktop && (wide ? settings.railOpen : railOverlay);
  const toggleRail = () => (wide ? progress.setSettings({ railOpen: !settings.railOpen }) : setRailOverlay((o) => !o));
  useEffect(() => {
    if (!railOverlay) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setRailOverlay(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [railOverlay]);

  // The pane shows the visual of the active step, or the most recent one before it, dimmed.
  let paneStep: FlatStep | undefined;
  for (let i = Math.min(activeIndex, visibleCount - 1); i >= 0; i--) {
    if (stepVisual(steps[i]!.step)) {
      paneStep = steps[i];
      break;
    }
  }
  const paneDim = paneStep !== undefined && paneStep.index !== activeIndex;

  const finished = visibleCount >= steps.length;
  const kind = mode === "lesson" ? "lesson" : "note";
  const fraction = noteFraction(data, slug);
  const course = courseOf(content, meta);
  const next = nextLecture(content, meta);
  const standalone = meta.type === "interactive" ? slug : undefined;

  const rail = <Rail meta={meta} mode={mode} steps={steps} visibleCount={visibleCount} activeIndex={activeIndex} onJump={(s) => (setContentsOpen(false), scrollToStep(s))} />;

  return (
    <NoteLinkProvider value={onNoteLink}>
      <div className="lesson" data-mode={mode} data-rail={railOpen ? (wide ? "docked" : "overlay") : "closed"} data-pane={withPane || undefined}>
        <div className="lesson-toolbar">
          <button
            type="button"
            className="icon-btn"
            onClick={desktop ? toggleRail : () => setContentsOpen(true)}
            aria-label={desktop ? (railOpen ? "Hide contents" : "Show contents") : "Contents"}
            aria-expanded={desktop ? railOpen : contentsOpen}
            title="Contents"
          >
            <Icon name={desktop ? "sidebar" : "list"} />
          </button>
          <nav className="toolbar-crumbs" aria-label="Breadcrumb">
            {course ? (
              <a href={href({ name: "course", id: course.id })}>{course.code}</a>
            ) : (
              <a href={href({ name: "library", query: {} })}>Library</a>
            )}
            <Icon name="chevronRight" size={14} />
            <span className="crumb-current">{meta.type === "lecture" && meta.lecture !== undefined ? `Lecture ${meta.lecture}` : meta.title}</span>
          </nav>
          <ProgressBar value={fraction} label={`${Math.round(fraction * 100)}% of this ${mode === "lesson" ? "lesson" : "note"} seen`} className="toolbar-progress" />
          <Switch checked={review} onChange={(v) => progress.setSettings({ review: v })} label="Review mode" />
          <button type="button" className="icon-btn" onClick={() => setConfirmRestart(true)} aria-label="Start over" title={`Start this ${kind} over`}>
            <Icon name="reset" />
          </button>
          {body.notation.length > 0 ? (
            <button type="button" className="btn btn-secondary btn-small symbols-btn" onClick={() => setSymbolsOpen(true)}>
              Symbols ({body.notation.length})
            </button>
          ) : null}
        </div>

        <div className="lesson-grid">
          {railOpen ? (
            <>
              {!wide ? <div className="rail-scrim" onClick={() => setRailOverlay(false)} aria-hidden="true" /> : null}
              <aside className="rail">{rail}</aside>
            </>
          ) : null}

          <div className="lesson-main">
            <NoteHeader meta={meta} steps={steps.length} practice={body.practice?.items.length} />
            <SymbolScope notation={body.notation}>
              <div className="steps" ref={listRef}>
                {steps.length === 0 ? <p className="empty-note">This note has no lesson steps yet; open it in Obsidian to read it.</p> : null}
                {visible.map((s) => (
                  <StepView
                    key={s.step.id}
                    flat={s}
                    slug={slug}
                    notation={body.notation}
                    paneVisuals={withPane}
                    compact={!desktop}
                    active={s.index === activeIndex}
                    standaloneWidget={standalone}
                  />
                ))}
              </div>
            </SymbolScope>

            {!finished ? (
              <div className="continue-bar" data-gated={unmet.length > 0 || undefined}>
                {unmet.length > 0 ? (
                  <p className="gate-note" id={`gate-${slug}`}>
                    {GATE_NOTE[unmet[0]!.kind]}
                  </p>
                ) : null}
                <div className="continue-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-continue"
                    aria-disabled={unmet.length > 0 || undefined}
                    aria-describedby={unmet.length > 0 ? `gate-${slug}` : undefined}
                    onClick={() => unmet.length === 0 && advance()}
                  >
                    Continue
                  </button>
                  {unmet.length > 0 ? (
                    <button type="button" className="btn btn-ghost" onClick={skip}>
                      Skip
                    </button>
                  ) : null}
                  <span className="continue-count">
                    Step {revealed} of {steps.length}
                  </span>
                </div>
              </div>
            ) : steps.length > 0 ? (
              <div className="end-card">
                <p className="end-title">
                  <Icon name="check" /> {review ? "Every step is shown." : `You have reached the end of this ${mode === "lesson" ? "lesson" : "note"}.`}
                </p>
                <div className="end-actions">
                  {next ? (
                    <a className="btn btn-primary btn-wrap" href={noteHref(content, next.slug)}>
                      Next: {next.title} <Icon name="arrowRight" size={16} />
                    </a>
                  ) : null}
                  {course ? (
                    <a className={`btn btn-wrap ${next ? "btn-secondary" : "btn-primary"}`} href={href({ name: "course", id: course.id })}>
                      Back to {course.code}
                    </a>
                  ) : null}
                  <button type="button" className="btn btn-ghost btn-wrap" onClick={() => setConfirmRestart(true)}>
                    <Icon name="reset" size={16} /> Start over
                  </button>
                </div>
              </div>
            ) : null}

            {finished ? <NoteFooter meta={meta} /> : null}
          </div>

          {withPane ? (
            <SymbolScope notation={body.notation} className="pane-scope">
              <VisualPane slug={slug} flat={paneStep} dim={paneDim} standalone={standalone} />
            </SymbolScope>
          ) : null}
        </div>

        <Modal open={contentsOpen} onClose={() => setContentsOpen(false)} label="Contents" variant="sheet" className="contents-sheet">
          <header className="sheet-head">
            <h2>Contents</h2>
            <button type="button" className="icon-btn" onClick={() => setContentsOpen(false)} aria-label="Close contents">
              <Icon name="close" />
            </button>
          </header>
          <div className="sheet-scroll">{rail}</div>
        </Modal>
        <Modal open={confirmRestart} onClose={() => setConfirmRestart(false)} label={`Start this ${kind} over`} variant="center" className="restart">
          <div className="restart-body">
            <h2>Start this {kind} over?</h2>
            <p>
              This forgets the steps you have seen and your answers to its checkpoints, goals and derivations, so it opens at step 1 again. Your review schedule,
              practice grades and flags are kept.
            </p>
            <div className="button-row">
              <button type="button" className="btn btn-danger-solid" onClick={() => (setConfirmRestart(false), onRestart())}>
                Start over
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmRestart(false)}>
                Cancel
              </button>
            </div>
          </div>
        </Modal>
        <SymbolsDrawer open={symbolsOpen} onClose={() => setSymbolsOpen(false)} notation={body.notation} intro={body.notationIntro} title={meta.title} />
        <DeepDive stack={dive} onChange={setDive} lessonTitle={meta.title} current={slug} />
      </div>
    </NoteLinkProvider>
  );
}

function VisualPane({ slug, flat, dim, standalone }: { slug: string; flat: FlatStep | undefined; dim: boolean; standalone?: string | undefined }) {
  const visual = flat ? stepVisual(flat.step) : undefined;
  const visualKey = visual ? (visual.block.t === "figure" ? `f:${visual.block.src}` : `w:${visual.block.widget}`) : "";

  // A new step's visual starts at the top of the pane, so its prompt is in view: a different visual jumps there (it is
  // remounting anyway), a new view of the same widget glides there.
  const sticky = useRef<HTMLDivElement>(null);
  const shown = useRef({ step: flat?.step.id, key: visualKey });
  useLayoutEffect(() => {
    const el = sticky.current;
    const before = shown.current;
    shown.current = { step: flat?.step.id, key: visualKey };
    if (!el || before.step === flat?.step.id || el.scrollTop === 0) return;
    el.scrollTo({ top: 0, behavior: before.key === visualKey ? scrollBehavior() : "instant" });
  }, [flat?.step.id, visualKey]);

  if (!flat || !visual) {
    return (
      <aside className="pane" aria-label="Visual">
        <div className="pane-sticky pane-empty">
          <Icon name="image" size={28} />
          <p>Figures and interactives appear here as you reach them.</p>
        </div>
      </aside>
    );
  }
  const { block, at } = visual;
  return (
    <aside className="pane" aria-label="Visual" data-dim={dim || undefined}>
      <div className="pane-sticky" ref={sticky} data-kind={block.t === "figure" ? "figure" : "widget"}>
        {/* Keyed by widget slug: consecutive steps that drive the same widget keep one mounted host. */}
        <div className="pane-visual" key={visualKey}>
          {block.t === "figure" ? (
            <Figure block={block} framed />
          ) : (
            <>
              {block.prompt ? <Md key={block.prompt} md={block.prompt} className="interactive-prompt pane-prompt" /> : null}
              <WidgetSlot block={block} storeKey={blockKey(slug, flat.step.id, at)} compact={false} standalone={standalone === block.widget && Object.keys(block).length === 2} />
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function Rail({ meta, mode, steps, visibleCount, activeIndex, onJump }: { meta: NoteMeta; mode: Mode; steps: FlatStep[]; visibleCount: number; activeIndex: number; onJump: (s: FlatStep) => void }) {
  const content = useContent();
  const data = useProgress();
  const course = courseOf(content, meta);
  const lectures = course && mode === "lesson" ? lecturesOf(content, course) : [];
  const sections = steps.filter((s) => s.firstInSection);
  const activeSection = steps[activeIndex]?.section.id;
  return (
    <nav className="rail-nav" aria-label="Contents">
      {lectures.length > 0 && course ? (
        <div className="rail-block">
          <a className="rail-title" href={href({ name: "course", id: course.id })}>
            {course.code}
          </a>
          <ol className="rail-lectures">
            {lectures.map((l) => {
              const f = noteFraction(data, l.slug);
              return (
                <li key={l.slug}>
                  <a href={noteHref(content, l.slug)} aria-current={l.slug === meta.slug ? "page" : undefined} className="rail-lecture">
                    <span className="rail-lecture-num" data-done={f >= 1 || undefined}>
                      {f >= 1 ? <Icon name="check" size={12} /> : (l.lecture ?? "·")}
                    </span>
                    <span className="rail-lecture-title">{l.title}</span>
                  </a>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
      <div className="rail-block">
        <p className="rail-title">In this {mode === "lesson" ? "lesson" : "note"}</p>
        <ol className="rail-outline">
          {sections.map((s) => {
            const locked = s.index >= visibleCount;
            return (
              <li key={s.section.id}>
                <button
                  type="button"
                  className="rail-section"
                  aria-current={s.section.id === activeSection ? "location" : undefined}
                  disabled={locked}
                  onClick={() => onJump(s)}
                >
                  {locked ? <Icon name="lock" size={12} /> : null}
                  <span>{sectionTitle(s.section)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

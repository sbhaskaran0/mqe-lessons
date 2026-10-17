// The deep-dive slide-over: a linked note's micro-lesson (every step, compact) over the lesson, which stays
// exactly where it was. Links inside the panel stack further notes; "Back to lesson" closes the whole stack.
import { Suspense, use, useEffect, useMemo, useRef } from "react";
import { Md, NoteLinkProvider, useNoteLinkHandler, type NoteLinkHandler } from "../app/Md";
import { hashPath, href } from "../app/router";
import { Icon, Modal } from "../app/ui";
import { useContent } from "../content/context";
import { noteHref } from "../content/model";
import { loadNote } from "../content/store";
import { progress } from "../progress";
import { ErrorBoundary, ErrorNotice } from "../app/ErrorBoundary";
import { NoteFooter, NoteHeader } from "./NoteChrome";
import { StepView } from "./StepView";
import { SymbolScope } from "./SymbolHover";
import { findAnchor, flattenSteps } from "./steps";
import { useActiveStep } from "./useActiveStep";

type Props = {
  stack: { slug: string; anchor?: string | undefined }[];
  onChange: (stack: { slug: string; anchor?: string | undefined }[]) => void;
  lessonTitle: string;
  /** The close button: the page the panel returns to. */
  backLabel?: string;
  /** The note the panel sits over: a link back to it closes the panel instead of opening it again. */
  current?: string;
};

export function DeepDive({ stack, onChange, lessonTitle, backLabel = "Back to lesson", current }: Props) {
  const content = useContent();
  const outer = useNoteLinkHandler();
  const top = stack[stack.length - 1];
  const scrollY = useRef(0);
  const open = top !== undefined;

  useEffect(() => {
    if (!open) return;
    scrollY.current = window.scrollY;
    const where = hashPath(window.location.hash);
    return () => {
      // The panel also unmounts when a link in it leaves the page; that page starts at the top (ScrollToTop), and
      // putting this page's offset back would override it.
      if (hashPath(window.location.hash) === where) window.scrollTo({ top: scrollY.current, behavior: "instant" });
    };
  }, [open]);

  const onLink: NoteLinkHandler = (slug, anchor) => {
    if (slug === current) {
      onChange([]);
      // Once the panel has put the reader's place back, so the glide to the step starts from there.
      if (anchor) requestAnimationFrame(() => outer?.(slug, anchor));
      return true;
    }
    const m = content.note(slug);
    // Lectures and courses are destinations of their own: follow those links out of the panel.
    if (!m || m.type === "lecture" || m.type === "course") return false;
    if (slug === top?.slug && !anchor) return true;
    onChange([...stack, { slug, anchor }]);
    return true;
  };

  const meta = top ? content.note(top.slug) : undefined;
  return (
    <Modal open={open} onClose={() => onChange([])} label={meta ? `Deep dive: ${meta.title}` : "Deep dive"} variant="sheet" className="dive">
      <header className="sheet-head dive-head">
        <button type="button" className="btn btn-primary btn-wrap dive-back" onClick={() => onChange([])}>
          <Icon name="arrowLeft" size={16} /> {backLabel}
        </button>
        {stack.length > 1 ? (
          <button type="button" className="btn btn-ghost btn-wrap" onClick={() => onChange(stack.slice(0, -1))}>
            <Icon name="chevronLeft" size={16} /> {content.note(stack[stack.length - 2]!.slug)?.title ?? "Back"}
          </button>
        ) : null}
        <span className="dive-spacer" />
        {top ? (
          <a className="icon-btn" href={noteHref(content, top.slug)} aria-label="Open as a full page" title="Open as a full page">
            <Icon name="external" size={18} />
          </a>
        ) : null}
      </header>
      {top ? (
        <NoteLinkProvider value={onLink}>
          <ErrorBoundary key={top.slug} fallback={(e) => <ErrorNotice error={e} />}>
            <Suspense fallback={<p className="loading">Loading…</p>}>
              <DiveBody key={top.slug} slug={top.slug} anchor={top.anchor} lessonTitle={lessonTitle} />
            </Suspense>
          </ErrorBoundary>
        </NoteLinkProvider>
      ) : null}
    </Modal>
  );
}

function DiveBody({ slug, anchor, lessonTitle }: { slug: string; anchor?: string | undefined; lessonTitle: string }) {
  const content = useContent();
  const meta = content.note(slug)!;
  const body = use(loadNote(slug));
  const steps = useMemo(() => flattenSteps(body), [body]);
  const ids = useMemo(() => steps.map((s) => s.step.id), [steps]);
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const active = useActiveStep(list, scroller, steps, steps[0]?.step.id);
  const standalone = meta.type === "interactive" ? slug : undefined;

  useEffect(() => {
    // The lesson underneath stays "where you left off"; a dive only records what was seen.
    if (active) progress.markSeen(slug, ids, active, { keepLast: true });
  }, [active, slug, ids]);

  useEffect(() => {
    scroller.current?.focus({ preventScroll: true });
    const target = anchor ? findAnchor(steps, anchor) : undefined;
    if (target) list.current?.querySelector(`[data-step-id="${CSS.escape(target.step.id)}"]`)?.scrollIntoView({ block: "start" });
  }, [anchor, steps]);

  return (
    <div className="sheet-scroll dive-scroll" ref={scroller} tabIndex={-1} aria-label={`${meta.title}, opened from ${lessonTitle}`}>
      <NoteHeader meta={meta} steps={steps.length} compact />
      {meta.summary ? <Md md={meta.summary} inline as="p" className="dive-summary" /> : null}
      <SymbolScope notation={body.notation}>
        <div className="steps steps-compact" ref={list}>
          {steps.length === 0 ? <p className="empty-note">This note has no lesson steps yet.</p> : null}
          {steps.map((s) => (
            <StepView key={s.step.id} flat={s} slug={slug} notation={body.notation} paneVisuals={false} compact headingLevel={3} standaloneWidget={standalone} />
          ))}
        </div>
      </SymbolScope>
      <NoteFooter meta={meta} />
      <p className="dive-full-link">
        <a href={href({ name: meta.type === "lecture" ? "lesson" : "note", slug })}>Open “{meta.title}” as a full page</a>
      </p>
    </div>
  );
}

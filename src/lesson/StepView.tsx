// One step: its section heading when it opens a section, its H3, the symbol chips, then its blocks.
import { forwardRef, memo } from "react";
import { Md, useNoteLinkClick } from "../app/Md";
import { useContent } from "../content/context";
import { noteHref } from "../content/model";
import type { NotationRow } from "../ir";
import { BlockView, type BlockContext } from "./Blocks";
import { FlagBlock } from "./Flag";
import { sectionTitle, stepVisual, type FlatStep } from "./steps";
import { SymbolChips } from "./Symbols";

type Props = {
  flat: FlatStep;
  slug: string;
  notation: NotationRow[];
  /** Desktop lesson: the step's driving visual is shown in the pane, not inline. */
  paneVisuals: boolean;
  compact: boolean;
  active?: boolean;
  standaloneWidget?: string | undefined;
  headingLevel?: 2 | 3;
};

// memo: every prop is a primitive or a reference that is stable across renders (flat and notation come from the
// note's memoised steps and body), so reading a step or answering a check re-renders only the steps whose `active`
// flag or own progress changed, not all of them. Blocks subscribe to progress themselves.
export const StepView = memo(forwardRef<HTMLElement, Props>(function StepView(
  { flat, slug, notation, paneVisuals, compact, active, standaloneWidget, headingLevel = 2 },
  ref,
) {
  const content = useContent();
  // The heading's link to the lecture a paper is read in is not inside any Md; it needs the same handler.
  const onLink = useNoteLinkClick();
  const { step, section, firstInSection } = flat;
  const visual = paneVisuals ? stepVisual(step) : undefined;
  const ctx: BlockContext = { slug, stepId: step.id, compact, ...(standaloneWidget ? { standaloneWidget } : {}) };
  const SectionHeading = headingLevel === 2 ? "h2" : "h3";
  const StepHeading = headingLevel === 2 ? "h3" : "h4";
  const lesson = section.role === "paper-in-lesson" && section.lesson ? content.note(section.lesson) : undefined;
  const showSectionHeading = firstInSection && (section.heading !== "" || flat.index > 0);
  return (
    <article
      ref={ref}
      className="step"
      // Focusable by script only: Continue and in-lesson links land focus here.
      tabIndex={-1}
      data-step-id={step.id}
      data-role={section.role}
      data-active={active || undefined}
      data-has-visual={visual ? true : undefined}
      aria-label={step.heading ?? sectionTitle(section)}
    >
      {showSectionHeading ? (
        <SectionHeading className="section-heading" id={`sec-${slug}-${section.id}`} onClick={onLink}>
          {section.role === "intuition" ? <span className="section-kicker">Start here</span> : null}
          {lesson ? (
            <>
              <span className="section-kicker">In the lecture</span>
              <a href={noteHref(content, lesson.slug)} data-note={lesson.slug} className="note-link">
                {lesson.title}
              </a>
            </>
          ) : (
            <Md md={sectionTitle(section)} inline />
          )}
        </SectionHeading>
      ) : null}
      {step.heading ? <Md md={step.heading} inline as={StepHeading} className="step-heading" /> : null}
      {step.symbols.length > 0 ? <SymbolChips symbols={step.symbols} notation={notation} /> : null}
      <div className="step-blocks">
        {step.blocks.map((block, i) => (
          <FlagBlock key={i} block={block} slug={slug} stepId={step.id} index={i}>
            <BlockView block={block} index={i} ctx={ctx} inPane={visual !== undefined && visual.at === i} />
          </FlagBlock>
        ))}
      </div>
    </article>
  );
}));

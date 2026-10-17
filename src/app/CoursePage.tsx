// A course: the lecture path in lecture order with per-lecture progress, then practice, guides, the papers its
// lectures present, and the course hub's own notes.
import { Suspense, use, useMemo } from "react";
import { useContent } from "../content/context";
import { coursePapers, courseLabel, lecturesOf, noteHref } from "../content/model";
import { loadNote } from "../content/store";
import type { Course, NoteMeta } from "../ir";
import { StepView } from "../lesson/StepView";
import { flattenSteps } from "../lesson/steps";
import { noteFraction, useProgress } from "../progress";
import { ErrorBoundary } from "./ErrorBoundary";
import { href } from "./router";
import { Md } from "./Md";
import { NotFound } from "./NotFound";
import { Icon, NoteCard, ProgressBar, useDocumentTitle } from "./ui";

export function CoursePage({ id }: { id: string }) {
  const content = useContent();
  const course = content.courseById.get(id);
  useDocumentTitle(course ? courseLabel(course) : "Not found");
  if (!course) return <NotFound what={`course/${id}`} />;
  return <CourseView course={course} />;
}

function LecturePath({ lectures }: { lectures: NoteMeta[] }) {
  const content = useContent();
  const data = useProgress();
  return (
    <ol className="lecture-path">
      {lectures.map((l, i) => {
        const f = noteFraction(data, l.slug);
        const n = data.notes[l.slug];
        const state = f >= 1 ? "done" : n ? "started" : "new";
        return (
          <li key={l.slug} className="lecture-path-item" data-state={state}>
            <span className="lecture-path-node" aria-hidden="true">
              {state === "done" ? <Icon name="check" size={16} /> : (l.lecture ?? i + 1)}
            </span>
            <a className="lecture-card" href={noteHref(content, l.slug)}>
              <span className="lecture-card-kicker">Lecture {l.lecture ?? i + 1}</span>
              <span className="lecture-card-title">{l.title}</span>
              {l.summary ? <Md md={l.summary} inline as="span" className="lecture-card-summary" /> : null}
              <span className="lecture-card-foot">
                <ProgressBar value={f} label={`${l.title}: ${Math.round(f * 100)}% seen`} />
                <span className="lecture-card-cta">
                  {state === "done" ? "Review" : state === "started" ? `Continue · ${n!.seen}/${n!.total}` : "Start"}
                  <Icon name="arrowRight" size={14} />
                </span>
              </span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

function CourseView({ course }: { course: Course }) {
  const content = useContent();
  const lectures = lecturesOf(content, course);
  const papers = coursePapers(content, course);
  const practice = course.practice.map((s) => content.note(s)).filter((m): m is NoteMeta => m !== undefined);
  const guides = course.guides.map((s) => content.note(s)).filter((m): m is NoteMeta => m !== undefined);
  const hub = content.note(course.hub);
  return (
    <div className="page page-course">
      <header className="course-header">
        <p className="page-kicker">Course</p>
        <h1>
          {course.code}
          {course.title ? <span className="course-header-title">{course.title}</span> : null}
        </h1>
        {course.instructor ? <p className="course-header-instructor">{course.instructor}</p> : null}
        {hub?.summary ? <Md md={hub.summary} inline as="p" className="lede" /> : null}
      </header>

      <section aria-labelledby="path-heading">
        <h2 id="path-heading" className="section-title">
          Lecture path
        </h2>
        {lectures.length ? <LecturePath lectures={lectures} /> : <p className="muted">No lectures have been ingested for this course yet.</p>}
      </section>

      {practice.length > 0 ? (
        <section aria-labelledby="practice-heading">
          <h2 id="practice-heading" className="section-title">
            Practice
          </h2>
          <div className="card-grid">
            {practice.map((m) => {
              const answers = m.pairedAnswers ? content.note(m.pairedAnswers) : undefined;
              return (
                <div key={m.slug} className="practice-item">
                  <NoteCard meta={m} extra={m.lecture !== undefined ? <span>Lecture {m.lecture}</span> : null} />
                  {answers ? (
                    <>
                      {/* A set with paired answers plays question by question (#/practice). */}
                      <a className="text-link practice-answers" href={href({ name: "practice", slug: m.slug })}>
                        Practise question by question <Icon name="arrowRight" size={14} />
                      </a>
                      <a className="text-link practice-answers" href={noteHref(content, answers.slug)}>
                        Answers: {answers.title} <Icon name="arrowRight" size={14} />
                      </a>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {guides.length > 0 ? (
        <section aria-labelledby="guides-heading">
          <h2 id="guides-heading" className="section-title">
            Guides
          </h2>
          <div className="card-grid">
            {guides.map((m) => (
              <NoteCard key={m.slug} meta={m} />
            ))}
          </div>
        </section>
      ) : null}

      {papers.length > 0 ? (
        <section aria-labelledby="papers-heading">
          <h2 id="papers-heading" className="section-title">
            Papers in this course
          </h2>
          <div className="card-grid">
            {papers.map(({ paper, lectures: ls }) => (
              <NoteCard key={paper.slug} meta={paper} extra={<span>{ls.map((l) => `L${l.lecture ?? "?"}`).join(", ")}</span>} />
            ))}
          </div>
        </section>
      ) : null}

      {hub ? (
        <section aria-labelledby="hub-heading" className="course-notes">
          <h2 id="hub-heading" className="section-title">
            Course notes
          </h2>
          <ErrorBoundary>
            <Suspense fallback={<p className="loading">Loading…</p>}>
              <HubBody slug={hub.slug} />
            </Suspense>
          </ErrorBoundary>
        </section>
      ) : null}
    </div>
  );
}

function HubBody({ slug }: { slug: string }) {
  const body = use(loadNote(slug));
  const steps = useMemo(() => flattenSteps(body), [body]);
  return (
    <div className="steps steps-compact">
      {steps.map((s) => (
        <StepView key={s.step.id} flat={s} slug={slug} notation={body.notation} paneVisuals={false} compact headingLevel={3} />
      ))}
    </div>
  );
}

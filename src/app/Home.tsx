// Home: pick up where you left off, the courses with their progress, and what was added to the vault lately.
import { useContent } from "../content/context";
import { courseLabel, lecturesOf, noteHref, recentNotes, TYPE_LABEL } from "../content/model";
import type { Course } from "../ir";
import { noteFraction, useProgress, type ProgressData } from "../progress";
import { href } from "./router";
import { Icon, NoteCard, ProgressBar, useDocumentTitle } from "./ui";

function courseFraction(data: ProgressData, slugs: string[]): number {
  if (slugs.length === 0) return 0;
  return slugs.reduce((sum, s) => sum + noteFraction(data, s), 0) / slugs.length;
}

function CourseCard({ course }: { course: Course }) {
  const content = useContent();
  const data = useProgress();
  const lectures = lecturesOf(content, course);
  const fraction = courseFraction(
    data,
    lectures.map((l) => l.slug),
  );
  const done = lectures.filter((l) => noteFraction(data, l.slug) >= 1).length;
  return (
    <a className="course-card" href={href({ name: "course", id: course.id })}>
      {course.title ? <span className="course-card-code">{course.code}</span> : null}
      <span className="course-card-title">{course.title ?? course.code}</span>
      {course.instructor ? <span className="course-card-instructor">{course.instructor}</span> : null}
      <span className="course-card-stats">
        {lectures.length} {lectures.length === 1 ? "lecture" : "lectures"}
        {course.practice.length ? ` · ${course.practice.length} practice ${course.practice.length === 1 ? "set" : "sets"}` : ""}
      </span>
      <ProgressBar value={fraction} label={`${courseLabel(course)}: ${Math.round(fraction * 100)}% seen`} />
      <span className="course-card-progress">{done > 0 ? `${done} of ${lectures.length} lectures complete` : fraction > 0 ? "In progress" : "Not started"}</span>
    </a>
  );
}

function ContinueCard() {
  const content = useContent();
  const data = useProgress();
  const inProgress = Object.entries(data.notes)
    .filter(([slug, n]) => content.note(slug) && n.seen < n.total)
    .sort((a, b) => b[1].at - a[1].at)
    .map(([slug]) => content.note(slug)!);
  const last = data.last ? content.note(data.last.slug) : undefined;
  const primary = last && (data.notes[last.slug]?.seen ?? 0) < (data.notes[last.slug]?.total ?? 1) ? last : inProgress[0] ?? last;
  if (!primary) return null;
  const others = inProgress.filter((m) => m.slug !== primary.slug).slice(0, 3);
  const n = data.notes[primary.slug];
  const fraction = noteFraction(data, primary.slug);
  return (
    <section className="continue-section" aria-labelledby="continue-heading">
      <h2 id="continue-heading" className="section-title">
        Continue where you left off
      </h2>
      <a className="continue-card" href={noteHref(content, primary.slug)}>
        <span className="continue-card-kicker">
          {TYPE_LABEL[primary.type]}
          {primary.course ? ` · ${primary.course}` : ""}
          {primary.lecture !== undefined && primary.type === "lecture" ? ` · Lecture ${primary.lecture}` : ""}
        </span>
        <span className="continue-card-title">{primary.title}</span>
        <ProgressBar value={fraction} label={`${Math.round(fraction * 100)}% seen`} />
        <span className="continue-card-meta">
          {n ? `${n.seen} of ${n.total} steps seen` : "Just opened"}
          <span className="continue-card-cta">
            {fraction >= 1 ? "Review" : "Resume"} <Icon name="arrowRight" size={16} />
          </span>
        </span>
      </a>
      {others.length > 0 ? (
        <div className="card-list card-list-tight">
          {others.map((m) => (
            <NoteCard key={m.slug} meta={m} compact />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function Home() {
  const content = useContent();
  useDocumentTitle("");
  const { index } = content;
  const recent = recentNotes(content, 6);
  const counts = Object.values(index.notes).reduce<Record<string, number>>((acc, m) => ((acc[m.type] = (acc[m.type] ?? 0) + 1), acc), {});
  return (
    <div className="page page-home">
      <header className="home-hero">
        <h1>MQE Lessons</h1>
        <p className="lede">
          Your vault as bite-sized lessons: intuition first, then the math, then the symbols. {counts.lecture ?? 0} lectures, {counts.concept ?? 0} concepts and{" "}
          {counts.paper ?? 0} papers across {index.courses.length} courses.
        </p>
      </header>

      <ContinueCard />

      <section aria-labelledby="courses-heading">
        <h2 id="courses-heading" className="section-title">
          Courses
        </h2>
        <div className="course-grid">
          {index.courses.map((c) => (
            <CourseCard key={c.id} course={c} />
          ))}
        </div>
      </section>

      <section aria-labelledby="recent-heading">
        <div className="section-title-row">
          <h2 id="recent-heading" className="section-title">
            Recently added
          </h2>
          <a className="text-link" href={href({ name: "library", query: { type: "all" } })}>
            Browse the library <Icon name="arrowRight" size={14} />
          </a>
        </div>
        <div className="card-grid">
          {recent.map((m) => (
            <NoteCard key={m.slug} meta={m} extra={<span>{formatDate(m.created)}</span>} />
          ))}
        </div>
      </section>
    </div>
  );
}

const DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
export const formatDate = (iso: string) => DATE.format(new Date(iso));

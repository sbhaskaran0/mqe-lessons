// The app shell: load the index, then route. Everything below the header renders from content/ alone.
import { lazy, Suspense, use, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ContentProvider, createContent } from "../content/context";
import { loadIndex } from "../content/store";
import { LessonPage } from "../lesson/LessonPage";
import { applyTheme, useSettings } from "../progress";
import { CoursePage } from "./CoursePage";
import { ErrorBoundary } from "./ErrorBoundary";
import { Header } from "./Header";
import { Home } from "./Home";
import { NotFound } from "./NotFound";
import { hashPath, parseHash, useHash, type Route } from "./router";
import { SettingsDialog } from "./Settings";

const DevWidgets = lazy(() => import("./DevWidgets"));
// The library and the map are split out of the entry chunk: neither is needed to open a lesson.
const Library = lazy(() => import("./Library").then((m) => ({ default: m.Library })));
const MapPage = lazy(() => import("../map/MapPage"));
const PracticePage = lazy(() => import("../practice/PracticePage").then((m) => ({ default: m.PracticePage })));
const ReviewPage = lazy(() => import("../review/ReviewPage").then((m) => ({ default: m.ReviewPage })));
const ExamPage = lazy(() => import("../exam/ExamPage").then((m) => ({ default: m.ExamPage })));
const ProgressPage = lazy(() => import("../progress/ProgressPage").then((m) => ({ default: m.ProgressPage })));

export function App() {
  const { theme } = useSettings();
  useEffect(() => applyTheme(theme), [theme]);
  return (
    <ErrorBoundary>
      <Suspense fallback={<p className="loading loading-app">Loading lessons…</p>}>
        <Loaded />
      </Suspense>
    </ErrorBoundary>
  );
}

function Loaded() {
  const index = use(loadIndex());
  const content = useMemo(() => createContent(index), [index]);
  return (
    <ContentProvider value={content}>
      <Shell />
    </ContentProvider>
  );
}

function Shell() {
  const hash = useHash();
  const route = useMemo(() => parseHash(hash), [hash]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const path = hashPath(hash);

  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <Header onSettings={() => setSettingsOpen(true)} path={path} />
      <main id="main" tabIndex={-1}>
        <ScrollToTop path={path} />
        <ErrorBoundary key={path}>
          <Page route={route} onSettings={() => setSettingsOpen(true)} />
        </ErrorBoundary>
      </main>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

/** A new page starts at the top, with focus on <main> so keyboard and screen-reader users start there too;
 *  query-only changes (library filters, ?at=) keep both the scroll position and the focus. This sits before the
 *  page as a sibling so its layout effect runs first, and a lesson that restores the reader's place in the same
 *  commit gets the last word. */
function ScrollToTop({ path }: { path: string }) {
  const shown = useRef(path);
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    // The first load has nothing to move focus from. Comparing paths, not counting runs, also keeps StrictMode's
    // second dev-time run from taking focus.
    if (shown.current === path) return;
    shown.current = path;
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [path]);
  return null;
}

function Page({ route, onSettings }: { route: Route; onSettings: () => void }) {
  switch (route.name) {
    case "home":
      return <Home />;
    case "library":
      return (
        <Suspense fallback={<p className="loading">Loading the library…</p>}>
          <Library query={route.query} />
        </Suspense>
      );
    case "map":
      return (
        <Suspense fallback={<p className="loading">Loading the map…</p>}>
          <MapPage query={route.query} />
        </Suspense>
      );
    case "course":
      return <CoursePage id={route.id} />;
    case "lesson":
      return <LessonPage key={`lesson/${route.slug}`} slug={route.slug} mode="lesson" at={route.at} />;
    case "note":
      return <LessonPage key={`note/${route.slug}`} slug={route.slug} mode="note" at={route.at} />;
    case "practice":
      return (
        <Suspense fallback={<p className="loading">Loading the practice set…</p>}>
          <PracticePage key={route.slug} slug={route.slug} at={route.at} show={route.show} />
        </Suspense>
      );
    case "progress":
      return (
        <Suspense fallback={<p className="loading">Loading your progress…</p>}>
          <ProgressPage onSettings={onSettings} />
        </Suspense>
      );
    case "review":
      return (
        <Suspense fallback={<p className="loading">Loading your review…</p>}>
          <ReviewPage />
        </Suspense>
      );
    case "exam":
      return (
        <Suspense fallback={<p className="loading">Loading the exam…</p>}>
          <ExamPage id={route.id} />
        </Suspense>
      );
    case "dev-widgets":
      return (
        <Suspense fallback={<p className="loading">Loading widgets…</p>}>
          <DevWidgets />
        </Suspense>
      );
    case "not-found":
      return <NotFound />;
  }
}

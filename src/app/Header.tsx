// The app header: home, library, map, progress, review (with the number of items due), the global search box (a combobox over MiniSearch) and settings.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useContent } from "../content/context";
import { noteHref, TYPE_LABEL } from "../content/model";
import { dueItems } from "../progress/dashboard";
import { useProgress } from "../progress";
import "../review/review.css";
import { href, navigate } from "./router";
import { Icon } from "./ui";

export function Header({ onSettings, path }: { onSettings: () => void; path: string }) {
  return (
    <header className="app-header">
      <a className="brand" href={href({ name: "home" })} aria-label="MQE Lessons, home">
        <span className="brand-mark" aria-hidden="true">
          M
        </span>
        <span className="brand-name">MQE Lessons</span>
      </a>
      <MainNav path={path} />
      <SearchBox key={path} />
      <button type="button" className="icon-btn" onClick={onSettings} aria-label="Settings" title="Settings">
        <Icon name="settings" />
      </button>
    </header>
  );
}

/** The section links. On a phone they fold into a menu so the search box keeps its room. */
function MainNav({ path }: { path: string }) {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const content = useContent();
  const due = dueItems(content, useProgress(), Date.now()).length;
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => root.current?.contains(e.target as Node) || setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <nav
      ref={root}
      className="header-nav"
      aria-label="Main"
      data-open={open || undefined}
      // Tabbing past the last link would leave an open menu covering the page; React's onBlur is focusout, so this
      // sees focus leaving any child. relatedTarget is where it went (null: nowhere focusable, which also closes).
      onBlur={(e) => {
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button ref={toggle} type="button" className="icon-btn nav-toggle" aria-label="Menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <Icon name="menu" />
      </button>
      {/* A link to the page already open leaves the path as it is, so the menu closes on any link. */}
      <div className="nav-links" id={id} onClick={() => setOpen(false)}>
        <a href={href({ name: "library", query: {} })} aria-current={path.startsWith("/library") ? "page" : undefined}>
          Library
        </a>
        <a href={href({ name: "map", query: {} })} aria-current={path.startsWith("/map") ? "page" : undefined}>
          Map
        </a>
        <a href={href({ name: "progress" })} aria-current={path.startsWith("/progress") ? "page" : undefined}>
          Progress
        </a>
        <a href={href({ name: "review" })} aria-current={path.startsWith("/review") ? "page" : undefined}>
          Review
          {due > 0 ? (
            <>
              <span className="nav-badge" aria-hidden="true">
                {due}
              </span>
              <span className="visually-hidden"> ({due} due today)</span>
            </>
          ) : null}
        </a>
      </div>
    </nav>
  );
}

function SearchBox() {
  const content = useContent();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const results = useMemo(() => content.search(q, 8), [content, q]);
  const showList = open && q.trim().length > 0;

  // "/" focuses search from anywhere that is not already a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || t.closest("input, textarea, select, [contenteditable=true], dialog")) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (to: string) => {
    setOpen(false);
    setQ("");
    input.current?.blur();
    navigate(to);
  };
  const submit = () => {
    const hit = results[sel];
    if (hit && sel >= 0) go(noteHref(content, hit.slug));
    else if (q.trim()) go(href({ name: "library", query: { q: q.trim() } }));
  };

  return (
    <div className="search" role="search">
      <Icon name="search" size={18} className="search-icon" />
      <input
        ref={input}
        type="search"
        className="search-input"
        placeholder="Search notes"
        aria-label="Search notes"
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={!showList ? undefined : sel === -1 ? `${id}-opt-all` : results[sel] ? `${id}-opt-${sel}` : undefined}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => Math.min(s + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(s - 1, -1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            if (q) setQ("");
            else input.current?.blur();
          }
        }}
      />
      {showList ? (
        <ul className="search-results" id={`${id}-list`} role="listbox" aria-label="Search results">
          {results.map((m, i) => (
            <li
              key={m.slug}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === sel}
              className="search-option"
              // mousedown, not click: the input's blur would close the list before a click lands.
              onMouseDown={(e) => {
                e.preventDefault();
                go(noteHref(content, m.slug));
              }}
              onMouseEnter={() => setSel(i)}
            >
              <span className="search-option-title">{m.title}</span>
              <span className="search-option-type">{TYPE_LABEL[m.type]}</span>
            </li>
          ))}
          <li
            id={`${id}-opt-all`}
            role="option"
            aria-selected={sel === -1}
            className="search-option search-option-all"
            onMouseDown={(e) => {
              e.preventDefault();
              go(href({ name: "library", query: { q: q.trim() } }));
            }}
          >
            {results.length ? "See all results in the library" : "No matching titles. Search the library"}
            <Icon name="arrowRight" size={14} />
          </li>
        </ul>
      ) : null}
    </div>
  );
}

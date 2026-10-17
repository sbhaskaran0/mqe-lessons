// Small shared pieces: icons, progress bars, the modal sheet, the switch, note cards, media-query hooks.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useContent } from "../content/context";
import { noteHref, TYPE_LABEL } from "../content/model";
import type { NoteMeta } from "../ir";
import { noteFraction, useProgress } from "../progress";
import { Md } from "./Md";

const ICONS = {
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  close: "M18 6 6 18M6 6l12 12",
  check: "M20 6 9 17l-5-5",
  cross: "M18 6 6 18M6 6l12 12",
  chevronLeft: "M15 18l-6-6 6-6",
  chevronRight: "M9 18l6-6-6-6",
  arrowLeft: "M19 12H5M12 19l-7-7 7-7",
  arrowRight: "M5 12h14M12 5l7 7-7 7",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  menu: "M3 6h18M3 12h18M3 18h18",
  sidebar: "M3 4h18v16H3zM9 4v16",
  external: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 1 1 8 0v4",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5",
  image: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9a1.5 1.5 0 1 0 0-.01",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  zoom: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35M11 8v6M8 11h6",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  reset: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  flag: "M4 22V4M4 4h13l-2 4 2 4H4",
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className ? `icon ${className}` : "icon"} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ProgressBar({ value, label, className }: { value: number; label?: string; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      className={className ? `progress ${className}` : "progress"}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label ?? "Progress"}
      data-complete={pct === 100 || undefined}
    >
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

type ModalProps = {
  open: boolean;
  onClose: () => void;
  label: string;
  variant?: "sheet" | "center" | "full";
  className?: string;
  children: ReactNode;
};

/** A native <dialog> (focus trap, Esc and top layer for free) presented as a side sheet or a centred card. */
export function Modal({ open, onClose, label, variant = "sheet", className, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`modal modal-${variant}${className ? ` ${className}` : ""}`}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => open && onClose()}
      onClick={(e) => {
        // A click on the dialog element itself (not its content) is a click on the backdrop.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open ? <div className="modal-body">{children}</div> : null}
    </dialog>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)}>
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{label}</span>
    </button>
  );
}

/** A note as a card: type, title, summary, and progress once it has been opened. */
export function NoteCard({ meta, compact = false, extra }: { meta: NoteMeta; compact?: boolean; extra?: ReactNode }) {
  const content = useContent();
  const data = useProgress();
  const fraction = noteFraction(data, meta.slug);
  const opened = data.notes[meta.slug] !== undefined;
  return (
    <a className={`note-card${compact ? " note-card-compact" : ""}`} href={noteHref(content, meta.slug)} data-note={meta.slug} data-type={meta.type}>
      <span className="note-card-kicker">
        <span className="type-badge" data-type={meta.type}>
          {TYPE_LABEL[meta.type]}
        </span>
        {meta.type === "paper" && meta.year ? <span>{meta.year}</span> : null}
        {extra}
      </span>
      <span className="note-card-title">{meta.title}</span>
      {!compact && meta.summary ? <Md md={meta.summary} inline as="span" className="note-card-summary" /> : null}
      {opened ? <ProgressBar value={fraction} label={`${meta.title}: ${Math.round(fraction * 100)}% seen`} className="note-card-progress" /> : null}
    </a>
  );
}

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  };
}

const mediaSubscribers = new Map<string, (onChange: () => void) => () => void>();

export function useMediaQuery(query: string): boolean {
  let subscribe = mediaSubscribers.get(query);
  if (!subscribe) {
    subscribe = subscribeMedia(query);
    mediaSubscribers.set(query, subscribe);
  }
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

export const DESKTOP = "(min-width: 1024px)";
export const WIDE = "(min-width: 1440px)";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · MQE Lessons` : "MQE Lessons";
  }, [title]);
}

// "Something looks wrong here": a per-block flag the learner raises while studying. It opens an inline form (a
// reason and an optional note, never a browser dialog), stores the flag in the progress store, and, when the page is
// served by the dev server, writes every change through to feedback/flags.json (see scripts/flags-plugin.ts) so an
// agent can read the flags later and fix the notes.
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Icon, scrollBehavior } from "../app/ui";
import type { Block } from "../ir";
import { blockKey, FLAG_REASONS, progress, type Flag, type FlagReason } from "../progress";
import "./flag.css";

const EXCERPT_CHARS = 160;
const NOTE_CHARS = 500;

/** Inline markdown down to the words a reader would search for. */
function plain(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*$>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A short plain-text snippet of a block, stored with its flag so the block can be found if step ids shift. */
export function blockExcerpt(block: Block): string {
  let text: string;
  switch (block.t) {
    case "prose":
    case "table":
    case "quote":
      text = plain(block.md);
      break;
    case "math":
      text = block.tex.replace(/\s+/g, " ").trim();
      break;
    case "figure":
      text = plain(block.caption ?? block.alt);
      break;
    case "callout":
      text = plain(`${block.title}: ${block.md}`);
      break;
    case "links":
      text = `${block.role}: ${block.items.join(", ")}`;
      break;
    case "check":
      text = plain(block.prompt);
      break;
    case "interactive":
      text = block.prompt ? plain(block.prompt) : `interactive: ${block.widget}`;
      break;
    default:
      // Block kinds added after this was written (derive, …) still get a findable label.
      text = block.t;
  }
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1).trimEnd()}…` : text;
}

// ---------- dev write-through ----------

let sync: { available: Promise<boolean>; queue: Promise<void> } | undefined;

/** Starts, once, the write-through of the flag list to the dev server. Production and static builds return at
 *  once; a dev page whose server has no /__flags (a preview, say) pings it once and then stays silent. */
export function startFlagSync(): void {
  if (sync || !import.meta.env.DEV || typeof fetch !== "function") return;
  const available = fetch("__flags/ping")
    .then((r) => r.status === 204)
    .catch(() => false);
  const s = { available, queue: Promise.resolve() };
  sync = s;
  let last = progress.get().flags;
  progress.subscribe(() => {
    const flags = progress.get().flags;
    if (flags === last) return;
    last = flags;
    // One request at a time, each carrying the list as it stands when its turn comes.
    s.queue = s.queue.then(async () => {
      if (!(await s.available)) return;
      try {
        await fetch("__flags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ flags: Object.values(progress.get().flags) }),
        });
      } catch {
        // The dev server went away; the flags are still in the browser and in the export.
      }
    });
  });
}

// ---------- the control ----------

type Props = { block: Block; slug: string; stepId: string; index: number; children: ReactNode };

/** Wraps one block with its flag button and, when open, the inline form. */
export function FlagBlock({ block, slug, stepId, index, children }: Props) {
  const key = blockKey(slug, stepId, index);
  const flag = useSyncExternalStore(
    progress.subscribe,
    () => progress.get().flags[key],
    () => undefined,
  );
  const [open, setOpen] = useState(false);
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLFormElement>(null);

  useEffect(() => startFlagSync(), []);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    const target = e.target as Node;
    if (target !== buttonRef.current && !panelRef.current?.contains(target)) return;
    e.stopPropagation();
    close();
  };

  return (
    <div className="flaggable" data-flagged={flag ? true : undefined} onKeyDown={onKeyDown}>
      {children}
      <button
        ref={buttonRef}
        type="button"
        className="flag-btn"
        data-flagged={flag ? true : undefined}
        aria-expanded={open}
        aria-controls={open ? `${id}-form` : undefined}
        aria-label={flag ? `Flagged as ${flag.reason}. Edit flag` : "Flag this block"}
        title={flag ? `Flagged: ${flag.reason}` : "Flag something wrong here"}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="flag" size={14} />
        {flag ? <span className="flag-btn-label">{flag.reason}</span> : null}
      </button>
      {open ? (
        <FlagForm
          id={`${id}-form`}
          formRef={panelRef}
          flag={flag}
          onCancel={close}
          onSave={(reason, note) => {
            progress.setFlag({ slug, stepId, block: index, kind: block.t, reason, note, excerpt: blockExcerpt(block) });
            close();
          }}
          onRemove={() => {
            progress.removeFlag(key);
            close();
          }}
        />
      ) : null}
    </div>
  );
}

type FormProps = {
  id: string;
  formRef: RefObject<HTMLFormElement | null>;
  flag: Flag | undefined;
  onSave(reason: FlagReason, note: string): void;
  onRemove(): void;
  onCancel(): void;
};

function FlagForm({ id, formRef, flag, onSave, onRemove, onCancel }: FormProps) {
  const [reason, setReason] = useState<FlagReason | null>(flag?.reason ?? null);
  const [note, setNote] = useState(flag?.note ?? "");
  const noteId = useId();
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Land focus on the chosen reason, or the first, as Check moves it to the verdict. Only on opening: later
  // changes come from a learner who is already inside the group. The panel opens below the block, where the sticky
  // Continue bar can cover it, so bring it into view with "nearest" (flag.css reserves the bar's height); any other
  // block value would scroll the window and move the scroll-spy.
  useEffect(() => {
    chipRefs.current[reason ? FLAG_REASONS.indexOf(reason) : 0]?.focus({ preventScroll: true });
    formRef.current?.scrollIntoView?.({ block: "nearest", behavior: scrollBehavior() });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (e: KeyboardEvent, from: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (from + step + FLAG_REASONS.length) % FLAG_REASONS.length;
    setReason(FLAG_REASONS[next]!);
    chipRefs.current[next]?.focus();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reason) onSave(reason, note.trim());
  };

  return (
    <form ref={formRef} id={id} className="flag-form" aria-label="Flag this block" onSubmit={submit}>
      <div role="radiogroup" aria-label="What is wrong" className="flag-reasons">
        {FLAG_REASONS.map((r, i) => (
          <button
            key={r}
            ref={(el) => void (chipRefs.current[i] = el)}
            type="button"
            role="radio"
            className="chip"
            aria-checked={reason === r}
            // Roving tabindex: the group is one stop, arrows move inside it.
            tabIndex={reason === r || (reason === null && i === 0) ? 0 : -1}
            onClick={() => setReason(r)}
            onKeyDown={(e) => move(e, i)}
          >
            {r}
          </button>
        ))}
      </div>
      <label htmlFor={noteId} className="flag-note-label">
        Note <span className="muted">(optional)</span>
      </label>
      <textarea
        id={noteId}
        className="flag-note"
        rows={2}
        maxLength={NOTE_CHARS}
        value={note}
        placeholder="What looks wrong, or what you expected"
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flag-actions">
        <button type="submit" className="btn btn-primary btn-small" disabled={reason === null}>
          {flag ? "Update flag" : "Save flag"}
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>
          Cancel
        </button>
        {flag ? (
          <button type="button" className="btn btn-danger btn-small flag-remove" onClick={onRemove}>
            Remove flag
          </button>
        ) : null}
      </div>
    </form>
  );
}

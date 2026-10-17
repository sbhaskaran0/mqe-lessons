// Symbol hover inside rendered math. A SymbolScope gives everything rendered inside it a markdown renderer that wraps
// the note's Notation symbols (`.sym.sym-<row>`, see content/markdown.ts), and explains a wrapped symbol on hover
// (mouse) or tap (touch, pen, click) with the same detail a symbol chip shows. One delegated listener per scope, so a
// lesson with hundreds of symbols adds no per-symbol handlers; the scope nearest a symbol in the DOM answers for it,
// which keeps the drawer and the deep-dive panel (dialogs inside the lesson) on their own note's rows.
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNoteLinkClick } from "../app/Md";
import { ContentProvider, useContent, type Content } from "../content/context";
import type { NotationRow } from "../ir";
import { SymbolDetail } from "./SymbolDetail";
import "./hover.css";

type Scope = { base: Content };
const ScopeContext = createContext<Scope | null>(null);

type Open = { n: number; el: HTMLElement; pinned: boolean };
type Pos = { top: number; left: number; width: number; above: boolean };

const GAP = 8;
const CLOSE_DELAY = 180;

function symIndex(el: Element): number {
  const m = /(?:^|\s)sym-(\d+)(?:\s|$)/.exec(el.getAttribute("class") ?? "");
  return m ? Number(m[1]) : -1;
}

export function SymbolScope({ notation, children, className }: { notation: readonly NotationRow[]; children: ReactNode; className?: string }) {
  const outer = useContext(ScopeContext);
  const current = useContent();
  const base = outer?.base ?? current;
  const scoped = useMemo<Content>(() => ({ ...base, md: base.md.withNotation(notation) }), [base, notation]);
  const scope = useMemo<Scope>(() => ({ base }), [base]);

  const tipId = useId();
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  // A symbol closed on purpose (Escape, a tap elsewhere) stays closed until the pointer leaves it.
  const dismissed = useRef<Element | null>(null);

  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const close = useCallback(() => {
    cancelClose();
    setOpen((o) => {
      dismissed.current = o?.el ?? null;
      return null;
    });
  }, []);
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen((o) => (o?.pinned ? o : null)), CLOSE_DELAY);
  };
  useEffect(() => cancelClose, []);

  /** The wrapped symbol an event landed on, if this scope (not a nested one, not the popover) owns it. */
  const symAt = (target: EventTarget | null): HTMLElement | null => {
    const el = target instanceof Element ? target.closest(".sym") : null;
    if (!el || el.closest("[data-sym-scope]") !== root.current) return null;
    const n = symIndex(el);
    return n >= 0 && n < notation.length ? (el as HTMLElement) : null;
  };

  const place = useCallback(() => {
    const p = pop.current;
    const r = root.current;
    if (!open || !p || !r || !open.el.isConnected) return;
    const at = open.el.getBoundingClientRect();
    const box = r.getBoundingClientRect();
    const minX = Math.max(GAP, box.left);
    const maxX = Math.min(window.innerWidth - GAP, box.right);
    const width = Math.min(340, maxX - minX);
    const x = Math.min(Math.max(at.left + at.width / 2 - width / 2, minX), maxX - width);
    // Measure at the final width: text wraps differently, and a short estimate would let the popover cover the
    // symbol (and, under a mouse, flicker as it closes and reopens).
    p.style.width = `${width}px`;
    const h = p.offsetHeight;
    const fitsBelow = at.bottom + GAP + h <= window.innerHeight - GAP;
    const above = !fitsBelow && at.top - GAP - h >= GAP;
    const y = above ? at.top - GAP - h : at.bottom + GAP;
    setPos({ top: y - box.top, left: x - box.left, width, above });
  }, [open]);

  useLayoutEffect(() => {
    if (!open) setPos(null);
    else place();
  }, [open, place]);

  // The explained symbol stays marked while its popover is open (a tap leaves no hover to show which one it is).
  // The node is KaTeX output React does not manage, so a class on it is safe.
  useEffect(() => {
    if (!open) return;
    open.el.classList.add("sym-active");
    return () => open.el.classList.remove("sym-active");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t && (pop.current?.contains(t) || t.closest(".sym") === open.el)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Default prevented too: Escape's default action is what closes a <dialog>.
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    // Capture, so Escape closes the popover before it closes the dialog the scope may sit in.
    document.addEventListener("keydown", onKey, true);
    // A symbol in a sticky pane or a scrolling sheet moves without the scope moving: follow it.
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, close, place]);

  const row = open ? notation[open.n] : undefined;
  const onLinkClick = useNoteLinkClick();

  return (
    <ScopeContext value={scope}>
      <ContentProvider value={scoped}>
        <div
          ref={root}
          className={className ? `sym-scope ${className}` : "sym-scope"}
          data-sym-scope=""
          data-sym-open={open ? open.n : undefined}
          onPointerOver={(e) => {
            if (e.pointerType !== "mouse") return;
            const el = symAt(e.target);
            if (!el || el === dismissed.current) return;
            cancelClose();
            if (open?.el !== el) setOpen({ n: symIndex(el), el, pinned: false });
          }}
          onPointerOut={(e) => {
            const to = e.relatedTarget instanceof Element ? e.relatedTarget : null;
            if (dismissed.current && to?.closest(".sym") !== dismissed.current) dismissed.current = null;
            if (e.pointerType !== "mouse" || !open || open.pinned) return;
            if (to && (to.closest(".sym") === open.el || pop.current?.contains(to))) return;
            if (symAt(e.target)) closeSoon();
          }}
          onClick={(e) => {
            const el = symAt(e.target);
            if (!el) return;
            cancelClose();
            dismissed.current = null;
            setOpen((o) => (o?.el === el && o.pinned ? null : { n: symIndex(el), el, pinned: true }));
          }}
        >
          {children}
          {open && row ? (
            <PlainMath>
              <div
                ref={pop}
                id={tipId}
                role="tooltip"
                className="sym-pop symbol-detail"
                data-above={pos?.above || undefined}
                data-pinned={open.pinned || undefined}
                style={pos ? { top: pos.top, left: pos.left, width: pos.width } : { visibility: "hidden", top: 0, left: 0 }}
                onPointerEnter={cancelClose}
                onPointerLeave={(e) => e.pointerType === "mouse" && !open.pinned && closeSoon()}
                onClick={onLinkClick}
              >
                <SymbolDetail row={row} />
              </div>
            </PlainMath>
          ) : null}
        </div>
      </ContentProvider>
    </ScopeContext>
  );
}

/** Renders its children with the page's plain markdown again: symbol chips and the popover itself explain one
 *  symbol already, so their math is not wrapped a second time. */
export function PlainMath({ children }: { children: ReactNode }) {
  const scope = useContext(ScopeContext);
  return scope ? <ContentProvider value={scope.base}>{children}</ContentProvider> : <>{children}</>;
}

/** A display-math block, wrapped for hover when it sits in a SymbolScope. */
export function MathBlock({ tex }: { tex: string }) {
  const { md } = useContent();
  return (
    <div className="block-math" tabIndex={0} role="group" aria-label="Equation">
      <span dangerouslySetInnerHTML={{ __html: md.math(tex, true) }} />
    </div>
  );
}

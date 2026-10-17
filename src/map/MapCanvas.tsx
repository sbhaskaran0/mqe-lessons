// The map as SVG: node cards with a progress ring, prerequisite edges, pan and zoom (drag, wheel, pinch, buttons),
// and keyboard navigation. The scene (every node and edge) is memoized, so panning only changes one transform.
import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import { noteFraction, type ProgressData } from "../progress";
import { adjacency, reach, type MapNode } from "./graph";
import { edgePath, neighbour, NODE_H, NODE_W, type Direction, type MapView } from "./layout";
import { centerOn, clampK, fit, reveal, zoomAt, type Transform } from "./viewport";

export type MapCanvasHandle = {
  fit(): void;
  zoomBy(factor: number): void;
  /** Pan so the node sits in the middle of the visible area, zooming in to at least `minZoom`. */
  center(slug: string, minZoom?: number): void;
};

type Props = {
  view: MapView;
  selected?: string;
  /** Nodes the search box matches. */
  matches: ReadonlySet<string>;
  /** slug -> CSS colour (a token reference). */
  colors: ReadonlyMap<string, string>;
  progress: ProgressData;
  /** The side card is open and covers the right edge of the map. */
  cardOpen: boolean;
  onSelect(slug: string | undefined): void;
  onOpen(slug: string): void;
  ref?: Ref<MapCanvasHandle>;
};

const CARD_INSET = 360;
/** Below this zoom the titles are unreadable noise, so the map shows coloured cards only. */
const FAR_ZOOM = 0.4;
const TITLE_CHARS = 22;
const RING_R = 11;
const RING_LEN = 2 * Math.PI * RING_R;

/** Two lines of title, broken at spaces; the full title stays in the node's tooltip. */
export function wrapTitle(title: string, chars = TITLE_CHARS): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of title.split(/\s+/)) {
    if (line && `${line} ${word}`.length > chars) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  lines.push(line);
  if (lines.length <= 2) return lines;
  const rest = lines.slice(1).join(" ");
  return [lines[0]!, rest.length > chars ? `${rest.slice(0, chars - 1).trimEnd()}…` : rest];
}

export function MapCanvas({ view, selected, matches, colors, progress, cardOpen, onSelect, onOpen, ref }: Props) {
  const { layout, graph } = view;
  const wrapper = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [t, setT] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const [animate, setAnimate] = useState(false);
  const tRef = useRef(t);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const insets = { right: cardOpen && size.w > 720 ? CARD_INSET : 0 };
  const insetsRef = useRef(insets);
  insetsRef.current = insets;

  const apply = useCallback((next: Transform, animated = false) => {
    tRef.current = next;
    setAnimate(animated);
    setT(next);
  }, []);

  useLayoutEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit when the graph changes (and once the first measurement arrives); later resizes leave the view alone.
  const measured = size.w > 0;
  useLayoutEffect(() => {
    if (measured) apply(fit({ w: layout.width, h: layout.height }, sizeRef.current));
  }, [layout, measured, apply]);

  useImperativeHandle(
    ref,
    () => ({
      fit: () => apply(fit({ w: layout.width, h: layout.height }, sizeRef.current), true),
      zoomBy: (factor) => {
        const s = sizeRef.current;
        apply(zoomAt(tRef.current, (s.w - insetsRef.current.right) / 2, s.h / 2, tRef.current.k * factor), true);
      },
      center: (slug, minZoom = 0) => {
        const p = layout.nodes.get(slug);
        if (!p) return;
        const k = clampK(Math.max(tRef.current.k, minZoom));
        apply(centerOn({ ...tRef.current, k }, p.x, p.y, sizeRef.current, insetsRef.current), true);
      },
    }),
    [layout, apply],
  );

  // Wheel zoom needs a non-passive listener to stop the page from scrolling under the map.
  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      // A trackpad pinch arrives as ctrl+wheel with small deltas; a mouse wheel notch is about 100.
      const rate = e.ctrlKey ? 0.01 : 0.0015;
      apply(zoomAt(tRef.current, e.clientX - r.left, e.clientY - r.top, tRef.current.k * Math.exp(-e.deltaY * rate)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [apply]);

  // ---- pointers: one finger or the mouse pans, two fingers pinch ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; t: Transform } | null>(null);
  const pinch = useRef<{ dist: number; cx: number; cy: number; t: Transform } | null>(null);
  const moved = useRef(false);

  const local = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pinchState = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return null;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, t: tRef.current };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 1) {
      moved.current = false;
      drag.current = { ...local(e), t: tRef.current };
    } else {
      moved.current = true;
      drag.current = null;
      pinch.current = pinchState();
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size >= 2) {
      const now = pinchState()!;
      const start = pinch.current;
      const zoomed = zoomAt(start.t, start.cx, start.cy, start.t.k * (now.dist / start.dist));
      apply({ ...zoomed, x: zoomed.x + now.cx - start.cx, y: zoomed.y + now.cy - start.cy });
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (!moved.current) {
      if (Math.hypot(p.x - d.x, p.y - d.y) < 4) return;
      moved.current = true;
      // Capture only once it is a drag, so a plain click still reaches the node under the pointer.
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    apply({ k: d.t.k, x: d.t.x + p.x - d.x, y: d.t.y + p.y - d.y });
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    const rest = [...pointers.current.values()][0];
    drag.current = rest ? { ...rest, t: tRef.current } : null;
  };

  // ---- selection and keyboard ----
  const adj = useMemo(() => adjacency(graph), [graph]);
  const rel = useMemo(() => {
    if (!selected || !adj.preds.has(selected)) return undefined;
    return { ancestors: reach(adj.preds, selected), descendants: reach(adj.succs, selected) };
  }, [adj, selected]);

  // Stable, so panning (which re-renders this component) leaves the memoized scene alone.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectNode = useCallback((slug: string) => {
    if (!moved.current) onSelectRef.current(slug);
  }, []);

  const first = layout.columns[0]?.[0];
  const tabStop = selected && layout.nodes.has(selected) ? selected : first;

  const goto = (slug: string) => {
    onSelect(slug);
    wrapper.current?.querySelector<SVGGElement>(`[data-slug="${CSS.escape(slug)}"]`)?.focus({ preventScroll: true });
    const p = layout.nodes.get(slug);
    if (p) apply(reveal(tRef.current, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2, w: NODE_W, h: NODE_H }, sizeRef.current, insetsRef.current), true);
  };

  const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const slug = (e.target as Element).closest<SVGGElement>("[data-slug]")?.dataset.slug;
    const dir = ARROWS[e.key];
    if (dir) {
      e.preventDefault();
      const from = slug ?? tabStop;
      const to = slug || selected ? neighbour(layout, adj, from!, dir) : first;
      if (to) goto(to);
    } else if (e.key === "Enter" && slug) {
      e.preventDefault();
      onOpen(slug);
    } else if (e.key === " " && slug) {
      e.preventDefault();
      onSelect(slug);
    } else if (e.key === "Escape" && selected) {
      onSelect(undefined);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomCentre(1.25);
    } else if (e.key === "-") {
      e.preventDefault();
      zoomCentre(0.8);
    } else if (e.key === "0") {
      e.preventDefault();
      apply(fit({ w: layout.width, h: layout.height }, sizeRef.current), true);
    }
  };
  const zoomCentre = (factor: number) => {
    const s = sizeRef.current;
    apply(zoomAt(tRef.current, (s.w - insetsRef.current.right) / 2, s.h / 2, tRef.current.k * factor), true);
  };

  return (
    <div
      ref={wrapper}
      className="map-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (!moved.current && !(e.target as Element).closest("[data-slug]")) onSelect(undefined);
      }}
    >
      <svg className="map-svg" data-far={t.k < FAR_ZOOM || undefined} role="group" aria-label={`Prerequisite map, ${graph.nodes.length} notes. Arrow keys move between notes, Enter opens one.`}>
        <defs>
          <marker id="map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,1 L9,5 L0,9 z" className="map-arrow" />
          </marker>
        </defs>
        <g className="map-viewport" data-animate={animate || undefined} style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})` }}>
          <Scene
            view={view}
            rel={rel}
            selected={selected}
            matches={matches}
            colors={colors}
            progress={progress}
            tabStop={tabStop}
            onSelect={selectNode}
          />
        </g>
      </svg>
    </div>
  );
}

type SceneProps = {
  view: MapView;
  rel: { ancestors: Set<string>; descendants: Set<string> } | undefined;
  selected: string | undefined;
  matches: ReadonlySet<string>;
  colors: ReadonlyMap<string, string>;
  progress: ProgressData;
  tabStop: string | undefined;
  onSelect(slug: string): void;
};

const Scene = memo(function Scene({ view, rel, selected, matches, colors, progress, tabStop, onSelect }: SceneProps) {
  const { graph, layout } = view;
  const relOf = (slug: string) => {
    if (!rel) return undefined;
    if (slug === selected) return "self";
    if (rel.ancestors.has(slug)) return "ancestor";
    if (rel.descendants.has(slug)) return "descendant";
    return "other";
  };
  const onPath = (from: string, to: string) =>
    !!rel && ((rel.ancestors.has(from) && (rel.ancestors.has(to) || to === selected)) || (rel.descendants.has(to) && (rel.descendants.has(from) || from === selected)));

  return (
    <>
      <g className="map-edges">
        {layout.edges.map((e) => (
          <path
            key={`${e.from}>${e.to}`}
            className="map-edge"
            d={edgePath(e.points)}
            markerEnd="url(#map-arrow)"
            data-rel={rel ? (onPath(e.from, e.to) ? "path" : "other") : undefined}
          />
        ))}
      </g>
      <g className="map-nodes">
        {graph.nodes.map((n) => (
          <NodeCard
            key={n.slug}
            node={n}
            x={layout.nodes.get(n.slug)!.x - NODE_W / 2}
            y={layout.nodes.get(n.slug)!.y - NODE_H / 2}
            rel={relOf(n.slug)}
            match={matches.has(n.slug)}
            color={colors.get(n.slug) ?? "var(--text-3)"}
            fraction={noteFraction(progress, n.slug)}
            tabStop={n.slug === tabStop}
            onSelect={onSelect}
          />
        ))}
      </g>
    </>
  );
});

type NodeProps = {
  node: MapNode;
  x: number;
  y: number;
  rel: string | undefined;
  match: boolean;
  color: string;
  fraction: number;
  tabStop: boolean;
  onSelect(slug: string): void;
};

const NodeCard = memo(function NodeCard({ node, x, y, rel, match, color, fraction, tabStop, onSelect }: NodeProps) {
  const lines = wrapTitle(node.title);
  const pct = Math.round(fraction * 100);
  return (
    <g
      className="map-node"
      transform={`translate(${x} ${y})`}
      data-slug={node.slug}
      data-type={node.type}
      data-rel={rel}
      data-match={match || undefined}
      data-done={fraction >= 1 || undefined}
      role="button"
      tabIndex={tabStop ? 0 : -1}
      aria-label={`${node.title}, ${pct}% seen`}
      aria-pressed={rel === "self"}
      onClick={() => onSelect(node.slug)}
      style={{ "--node-color": color } as CSSProperties}
    >
      <title>{node.title}</title>
      <rect className="map-node-card" width={NODE_W} height={NODE_H} rx={10} />
      <rect className="map-node-stripe" width={5} height={NODE_H - 16} x={0} y={8} rx={2.5} />
      <g transform={`translate(27 ${NODE_H / 2})`} className="map-ring">
        <circle className="map-ring-track" r={RING_R} />
        {fraction > 0 ? (
          <circle className="map-ring-fill" r={RING_R} strokeDasharray={RING_LEN} strokeDashoffset={RING_LEN * (1 - fraction)} transform="rotate(-90)" />
        ) : null}
        {fraction >= 1 ? <path className="map-ring-check" d="M-4,0.5 L-1,3.5 L4.5,-3" /> : null}
      </g>
      <text className="map-node-title" x={48} y={lines.length === 1 ? NODE_H / 2 + 4.5 : NODE_H / 2 - 4}>
        {lines.map((l, i) => (
          <tspan key={i} x={48} dy={i === 0 ? 0 : 15}>
            {l}
          </tspan>
        ))}
      </text>
    </g>
  );
});

// The state every widget shares: parameter values, the active view (presets, lock, show, highlight), goals and
// predictions. A widget component renders from this and reports learner moves through `set`; it never has to
// know how views arrive. See host.tsx for the rules this implements.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compile, defaults, type Scope, withDerived } from "../expr";
import type { InteractiveBlock, WidgetProps } from "../host";
import type { WidgetSpec } from "../spec";
import { readoutValues } from "./evaluate";
import { lerp, PRESET_MS, tween } from "./motion";

/** `expected` is the named readout's value at commit time (a compute-before-reveal predict). `explanation` is the
 *  learner's own optional reason, typed before the reveal: the player stores it, nothing grades it. */
export type PredictResult = { option?: number; value?: number; correct?: boolean; expected?: number; explanation?: string };

/** Is the typed number within `tol` of the model's value? (Absolute, like a numeric check's `answer +/- tol`; a hair of
 *  slack keeps 16.05 against 16 +/- 0.05 right despite floating point.) */
export function grade(value: number, expected: number, tol: number): boolean {
  return Number.isFinite(value) && Number.isFinite(expected) && Math.abs(value - expected) <= tol + 1e-9 * Math.max(1, Math.abs(expected));
}
type Phase = "ask" | "revealed";

/** State that belongs to one view and starts afresh when the next one arrives. */
type PerView = {
  key: string;
  touched: boolean;
  gestures: number;
  hintAsked: boolean;
  goalMet: boolean;
  phase: Phase;
  choice: number | null;
  marker: [number, number] | null;
  result: PredictResult | null;
  flags: Record<string, boolean>;
};

const fresh = (key: string, initial?: WidgetProps["initial"], predictSpec?: InteractiveBlock["predict"]): PerView => {
  const base: PerView = { key, touched: false, gestures: 0, hintAsked: false, goalMet: false, phase: "ask", choice: null, marker: null, result: null, flags: {} };
  if (!initial) return base;
  // A revisited view starts where progress left it. Only the learner's first guess is recorded, so it is the one shown.
  const was = predictSpec ? initial.predicted : undefined;
  if (was) {
    const result: PredictResult = { ...was };
    // The spec's answer is the authority on right or wrong; the stored flag only covers specs without one.
    if (result.option !== undefined && predictSpec?.answer !== undefined) result.correct = result.option === predictSpec.answer;
    Object.assign(base, { phase: "revealed", choice: was.option ?? null, result });
  }
  return { ...base, goalMet: !!initial.goalMet };
};

/** A pause longer than this between learner changes starts a new gesture (for "hint after a few tries"). */
const GESTURE_GAP_MS = 700;
/** Unsuccessful gestures before the goal's hint shows by itself. */
export const HINT_AFTER = 3;

export type PredictRuntime = NonNullable<InteractiveBlock["predict"]> & {
  phase: Phase;
  choice: number | null;
  choose: (i: number) => void;
  marker: [number, number] | null;
  placeMarker: (p: [number, number]) => void;
  /** Commit the guess. Without options or a readout the widget passes the value it reads off its marker; with a
   *  readout the value is the number the learner typed. `explanation` is their optional reason. */
  commit: (value?: number, explanation?: string) => void;
  result: PredictResult | null;
};

export type Runtime = {
  spec: WidgetSpec;
  view: InteractiveBlock | null;
  viewKey: string;
  explore: boolean;
  params: Scope;
  /** A learner move: locked params are ignored, values are clamped to their range. */
  set: (patch: Scope) => void;
  /** A programmatic move animated over `ms` (presets, reveals); never counts as the learner's. */
  animateTo: (patch: Scope, ms?: number) => void;
  /** Back to the view's presets (defaults for params the view doesn't set). */
  reset: () => void;
  animating: boolean;
  isLocked: (id: string) => boolean;
  /** Passes the view's `show` list and is not hidden by an uncommitted prediction. */
  isShown: (id: string) => boolean;
  /** Listed in `show` (true), not listed (false), or there is no `show` list (undefined). */
  listed: (id: string) => boolean | undefined;
  /** Hidden until the learner commits a prediction. */
  pending: (id: string) => boolean;
  /** Hidden by the prediction and now revealed: render with the reveal animation. */
  isRevealed: (id: string) => boolean;
  highlight: string | undefined;
  touched: boolean;
  /** Forget the learner's moves in this view: after a programmatic move (a reveal, Reset) the goal and an unanswered
   *  prediction wait for a fresh one. */
  untouch: () => void;
  gestures: number;
  flag: (name: string) => boolean;
  setFlag: (name: string, on: boolean) => void;
  predict: PredictRuntime | null;
  goalMet: boolean;
  hintAsked: boolean;
  askHint: () => void;
  markGoalMet: () => boolean;
};

function clampTo(spec: WidgetSpec, patch: Scope | undefined): Scope {
  const out: Scope = {};
  for (const [id, v] of Object.entries(patch ?? {})) {
    const p = spec.params?.[id];
    if (p && Number.isFinite(v)) out[id] = Math.min(p.max, Math.max(p.min, v));
  }
  return out;
}

const EMPTY: readonly string[] = [];

export function useWidgetRuntime(
  spec: WidgetSpec,
  view: InteractiveBlock | null,
  onPredict: WidgetProps["onPredict"],
  initial?: WidgetProps["initial"],
): Runtime {
  const viewKey = useMemo(() => (view ? JSON.stringify(view) : "explore"), [view]);

  // Per-view state resets during render, so the first frame of a new view never shows the old view's reveal.
  const [pvState, setPv] = useState<PerView>(() => fresh(viewKey, initial, view?.predict));
  let pv = pvState;
  if (pv.key !== viewKey) {
    pv = fresh(viewKey, initial, view?.predict);
    setPv(pv);
  }
  const pvRef = useRef(pv);
  pvRef.current = pv;
  const patchView = useCallback((patch: Partial<PerView>) => setPv((p) => ({ ...p, ...patch })), []);

  const [params, setParamsState] = useState<Scope>(() => ({ ...defaults(spec), ...clampTo(spec, view?.state) }));
  const paramsRef = useRef(params);
  const write = useCallback((next: Scope) => {
    paramsRef.current = next;
    setParamsState(next);
  }, []);

  const [animating, setAnimating] = useState(false);
  const tweenRef = useRef<{ cancel: () => void; target: Scope } | null>(null);
  const finishTween = useCallback(() => {
    const t = tweenRef.current;
    if (!t) return;
    t.cancel();
    tweenRef.current = null;
    write({ ...paramsRef.current, ...t.target });
    setAnimating(false);
  }, [write]);

  const animateTo = useCallback(
    (patch: Scope, ms: number = PRESET_MS) => {
      finishTween();
      const from = { ...paramsRef.current };
      const target = clampTo(spec, patch);
      if (Object.entries(target).every(([id, v]) => from[id] === v)) return;
      const holder = { cancel: () => {}, target };
      tweenRef.current = holder;
      setAnimating(true);
      holder.cancel = tween(ms, (k) => {
        const next = { ...paramsRef.current };
        for (const [id, v] of Object.entries(target)) next[id] = k >= 1 ? v : lerp(from[id] ?? v, v, k);
        write(next);
        if (k >= 1 && tweenRef.current === holder) {
          tweenRef.current = null;
          setAnimating(false);
        }
      });
    },
    [spec, finishTween, write],
  );

  useEffect(() => () => tweenRef.current?.cancel(), []);

  // A new view animates its presets in; the learner's other values carry over.
  const appliedKey = useRef(viewKey);
  useEffect(() => {
    if (appliedKey.current === viewKey) return;
    appliedKey.current = viewKey;
    if (view?.state) animateTo(view.state);
  }, [viewKey, view, animateTo]);

  const lock = view?.lock ?? EMPTY;
  const isLocked = useCallback((id: string) => lock.includes(id), [lock]);

  const lastSet = useRef(0);
  const set = useCallback(
    (patch: Scope) => {
      finishTween();
      const cur = paramsRef.current;
      const next = { ...cur };
      let changed = false;
      for (const [id, v] of Object.entries(clampTo(spec, patch))) {
        if (lock.includes(id) || cur[id] === v) continue;
        next[id] = v;
        changed = true;
      }
      if (!changed) return;
      write(next);
      const now = Date.now();
      const newGesture = now - lastSet.current > GESTURE_GAP_MS;
      lastSet.current = now;
      if (!pvRef.current.touched || newGesture) {
        setPv((p) => ({ ...p, touched: true, gestures: p.gestures + (newGesture ? 1 : 0) }));
      }
    },
    [spec, lock, finishTween, write],
  );

  const untouch = useCallback(() => {
    pvRef.current = { ...pvRef.current, touched: false };
    patchView({ touched: false });
  }, [patchView]);

  // Back at the presets the goal waits for a fresh move, as when the view arrived: Reset is not a move.
  const reset = useCallback(() => {
    animateTo({ ...defaults(spec), ...(view?.state ?? {}) });
    untouch();
  }, [animateTo, spec, view, untouch]);

  const predictSpec = view?.predict;
  const asking = !!predictSpec && pv.phase === "ask";
  const show = view?.show;
  // A readout prediction hides its own readout (it would give the answer away) as well as whatever `hide` names.
  const hidden = useMemo<readonly string[]>(
    () => (predictSpec ? (predictSpec.readout !== undefined ? [...predictSpec.hide, predictSpec.readout] : predictSpec.hide) : EMPTY),
    [predictSpec],
  );
  const isShown = useCallback(
    (id: string) => (!show || show.includes(id)) && !(asking && hidden.includes(id)),
    [show, asking, hidden],
  );
  const listed = useCallback((id: string) => (show ? show.includes(id) : undefined), [show]);
  const pending = useCallback((id: string) => asking && hidden.includes(id), [asking, hidden]);
  const isRevealed = useCallback(
    (id: string) => !!predictSpec && pv.phase === "revealed" && hidden.includes(id),
    [predictSpec, pv.phase, hidden],
  );

  const onPredictRef = useRef(onPredict);
  onPredictRef.current = onPredict;
  const commit = useCallback(
    (value?: number, explanation?: string) => {
      const cur = pvRef.current;
      if (!predictSpec || cur.phase !== "ask") return;
      let result: PredictResult;
      if (predictSpec.options) {
        if (cur.choice === null) return;
        result = { option: cur.choice };
        if (predictSpec.answer !== undefined) result.correct = cur.choice === predictSpec.answer;
      } else if (predictSpec.readout !== undefined) {
        // Compute before reveal: graded against the readout at the params the learner has now, before it is shown.
        if (value === undefined || !Number.isFinite(value)) return;
        result = { value };
        const expected = readoutValues(spec, withDerived(spec, paramsRef.current))[predictSpec.readout];
        if (expected !== undefined && Number.isFinite(expected)) {
          result.expected = expected;
          if (predictSpec.tol !== undefined) result.correct = grade(value, expected, predictSpec.tol);
        }
      } else {
        const v = value ?? cur.marker?.[0];
        if (v === undefined) return;
        result = { value: v };
      }
      const why = explanation?.trim();
      if (why) result.explanation = why;
      patchView({ phase: "revealed", result });
      onPredictRef.current?.(result);
    },
    [spec, predictSpec, patchView],
  );

  const predict: PredictRuntime | null = predictSpec
    ? {
        ...predictSpec,
        phase: pv.phase,
        choice: pv.choice,
        choose: (i) => pvRef.current.phase === "ask" && patchView({ choice: i }),
        marker: pv.marker,
        placeMarker: (p) => pvRef.current.phase === "ask" && patchView({ marker: p }),
        commit,
        result: pv.result,
      }
    : null;

  const markGoalMet = useCallback(() => {
    if (pvRef.current.goalMet) return false;
    pvRef.current = { ...pvRef.current, goalMet: true };
    patchView({ goalMet: true });
    return true;
  }, [patchView]);

  return {
    spec,
    view,
    viewKey,
    explore: view === null,
    params,
    set,
    animateTo,
    reset,
    animating,
    isLocked,
    isShown,
    listed,
    pending,
    isRevealed,
    highlight: view?.highlight,
    touched: pv.touched,
    untouch,
    gestures: pv.gestures,
    flag: (name) => !!pv.flags[name],
    setFlag: (name, on) => setPv((p) => ({ ...p, flags: { ...p.flags, [name]: on } })),
    predict,
    goalMet: pv.goalMet,
    hintAsked: pv.hintAsked,
    askHint: () => patchView({ hintAsked: true }),
    markGoalMet,
  };
}

export type GoalState = {
  goal: NonNullable<InteractiveBlock["goal"]>;
  met: boolean;
  hintVisible: boolean;
  /** The learner asked for the hint (rather than it showing after a few tries), so it may take focus. */
  hintAsked: boolean;
  askHint: () => void;
};

/** Evaluates the view's goal over `scope` (params, derived values, readouts, built-in scalars) after each learner
 *  move, and calls onGoalMet the first time it holds in this view. Preset and reveal animations never count. */
export function useGoal(rt: Runtime, scope: Scope, onGoalMet: WidgetProps["onGoalMet"]): GoalState | null {
  const goal = rt.view?.goal;
  // A readout prediction comes first: compute, then reveal, then explore. The goal can't be met by chasing a hidden number.
  const waiting = rt.predict?.readout !== undefined && rt.predict.phase === "ask";
  const holds = useMemo(() => {
    if (!goal || waiting) return false;
    try {
      return Boolean(compile(goal.when)(scope));
    } catch {
      // validate evaluates every goal where its view starts; a value it fails on elsewhere reads as not met
      return false;
    }
  }, [goal, scope, waiting]);
  const cb = useRef(onGoalMet);
  cb.current = onGoalMet;
  const { touched, animating, markGoalMet } = rt;
  useEffect(() => {
    if (goal && holds && touched && !animating && markGoalMet()) cb.current?.();
  }, [goal, holds, touched, animating, markGoalMet]);
  if (!goal) return null;
  return {
    goal,
    met: rt.goalMet,
    hintVisible: !!goal.hint && !rt.goalMet && (rt.hintAsked || rt.gestures >= HINT_AFTER),
    hintAsked: rt.hintAsked,
    askHint: rt.askHint,
  };
}

---
type: interactive
summary: Drag the saving rate and depreciation to see where investment meets depreciation and how steady-state capital moves.
domain: macroeconomics
illustrates: ["[[Toy Growth Model]]", "[[Toy Production Function]]"]
tags: [interactive, model]
---
# Toy Steady State Explorer

## Spec

```yaml
type: view
title: Toy steady state
params:
  s:     {tex: "s",       min: 0.05, max: 0.9,  step: 0.01,  default: 0.5}
  A:     {tex: "A",       min: 0.5,  max: 2,    step: 0.05,  default: 1}
  alpha: {tex: "\\alpha", min: 0.2,  max: 0.8,  step: 0.01,  default: 0.5}
  delta: {tex: "\\delta", min: 0.02, max: 0.2,  step: 0.005, default: 0.1}
vars:
  k: {tex: "k", label: "Capital per worker"}
equations:
  f: "A*k^alpha"
derived:
  kbar: "(s*A/delta)^(1/(1-alpha))"
  ybar: "A*kbar^alpha"
  cbar: "(1-s)*ybar"
panels:
  - kind: curve
    id: diagram
    x: {var: k, tex: "k", label: "Capital per worker", min: 0, max: 40}
    y: {label: "Per-worker quantities", min: 0, max: 4}
    curves:
      - {id: output, expr: f, tex: "f(k)"}
      - {id: saving, expr: "s*f", tex: "sf(k)"}
      - {id: depreciation, expr: "delta*k", tex: "\\delta k", style: dashed}
    points:
      - {id: steady, x: kbar, y: "s*A*kbar^alpha", tex: "\\bar{k}", guides: true}
    regions:
      - {id: consumption, between: [output, saving]}
readouts:
  - {id: kbar_out, tex: "\\bar{k}", expr: kbar, format: ".2f"}
  - {id: cbar_out, tex: "\\bar{c}", expr: cbar, format: ".3f"}
tests:
  - params: {s: 0.5, A: 1, alpha: 0.5, delta: 0.1}
    expect: {kbar: 25, ybar: 5, cbar: 2.5, cbar_out: 2.5, "saving@16": 2}
    tol: 0.001
  - at: {k: 16}
    expect: {f: 4}
compare_figure: Toy diagram.png
```

## Notes

Reproduces the toy diagram: the investment curve, the depreciation line and their crossing.

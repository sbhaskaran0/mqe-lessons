---
type: interactive
summary: Watch capital per worker converge to its steady state, then raise the saving rate mid-way and follow the transition.
domain: macroeconomics
illustrates: ["[[Toy Growth Model]]"]
---
# Toy Convergence

## Spec

```yaml
type: view
params:
  s:     {tex: "s",       min: 0.05, max: 0.9, step: 0.01,  default: 0.5}
  A:     {tex: "A",       min: 0.5,  max: 2,   step: 0.05,  default: 1}
  alpha: {tex: "\\alpha", min: 0.2,  max: 0.8, step: 0.01,  default: 0.5}
  delta: {tex: "\\delta", min: 0.02, max: 0.2, step: 0.005, default: 0.1}
vars:
  k: {tex: "k_t"}
equations:
  next_k: "s*A*k^alpha + (1-delta)*k"
derived:
  kbar: "(s*A/delta)^(1/(1-alpha))"
  kbar_hi: {of: kbar, with: {s: 0.6}}
recurrence:
  var: k
  tex: "k_t"
  init: "4*kbar"
  periods: 60
  next: next_k
  shocks:
    - {t: 30, set: {s: 0.6}, label: Saving rate rises}
panels:
  - kind: path
    id: levels
    title: Capital per worker
    scale: levels
    series:
      - {id: capital, expr: "k", tex: "k_t"}
  - kind: path
    id: growth
    title: Growth
    scale: growth
    series:
      - {id: growth_y, expr: "growth(A*k^alpha)", label: "Growth of output per worker"}
tests:
  - params: {s: 0.5, A: 1, alpha: 0.5, delta: 0.1}
    expect: {kbar: 25, kbar_hi: 36, "capital@0": 100, "capital@1": 95, "growth_y@1": -0.0253206}
    tol: 0.0001
```

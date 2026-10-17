---
type: interactive
status: planned
summary: Planned - drag the saving rate to the top of the steady-state consumption hill.
domain: macroeconomics
illustrates: ["[[Toy Growth Model]]"]
tags: [interactive, model]
---
# Toy Golden Rule

## Spec

A placeholder: the spec is deliberately incomplete (its panel has no y axis and no curves), so `check` only warns until it is built.

```yaml
type: view
title: Golden rule
params:
  s:     {tex: "s",       min: 0.05, max: 0.95, step: 0.01, default: 0.3}
  alpha: {tex: "\\alpha", min: 0.2, max: 0.8, step: 0.01, default: 0.5}
panels:
  - kind: curve
    id: hill
    x: {sweep: s, tex: "s", label: "Saving rate"}
```

---
type: interactive
summary: A stub widget for the chunker tests.
domain: macroeconomics
illustrates: ["[[Solow Growth Model]]"]
---
# Chunker Widget

## Spec

```yaml
type: function-plot
x: {var: k, tex: "k", min: 0, max: 10}
y: {min: 0, max: 3}
params:
  s: {tex: "s", min: 0, max: 1, default: 0.2}
  A: {tex: "A", min: 0.5, max: 2, default: 1}
curves:
  - {id: saving, expr: "s*A*k^0.5", tex: "sf(k)"}
```

---
type: interactive
summary: A precomputed kernel density chart - the curve and its error are looked up for each bandwidth and kernel.
domain: data
illustrates: ["[[Toy Kernel Smoothing]]"]
---
# Toy Bandwidth Lookup

## Spec

```yaml
type: data-chart
title: Kernel bandwidth
dataset: toy-kde-lookup
params:
  h:      {tex: "h", label: Bandwidth, min: 0.5, max: 1.5, step: 0.5, default: 0.5}
  kernel: {tex: "K", label: Kernel, min: 1, max: 2, step: 1, default: 1, labels: {1: Gaussian, 2: Box}}
  px:     {tex: "x_0", label: Probe x, min: 0, max: 4, step: 0.5, default: 1}
  py:     {tex: "y_0", label: Probe y, min: 0, max: 0.5, step: 0.05, default: 0.1}
derived:
  err: 'at("ise", h)'
readouts:
  - {id: ise_now, expr: 'at("ise", h)', label: "Error at this h", format: ".3f"}
  - {id: best_h, expr: 'at("h_opt", 0)', label: "Best h", format: ".1f"}
panels:
  - id: density
    title: Density estimate
    x: {column: x, label: "Income"}
    y: {column: y, label: "Density"}
    series:
      - {id: hist, label: Histogram, mark: bar, where: {series: hist}}
      - {id: kde, label: KDE, where: {series: kde, h: {param: h}, kernel: {param: kernel}}}
      - {id: rug, label: Data, mark: rug, where: {series: data}}
      - {id: probe, label: Probe, drag: {x: px, y: py}}
  - id: error
    title: Error against bandwidth
    mark: point
    x: {column: x, label: "Bandwidth"}
    y: {column: y, label: "Error"}
    series:
      - {id: ise, label: Error, mark: line, where: {series: ise, kernel: {param: kernel}}}
      - {id: h_opt, label: Best h, where: {series: h_opt, kernel: {param: kernel}}}
tests:
  - params: {h: 1, kernel: 2}
    expect: {ise_now: 0.02, err: 0.02, best_h: 1, "kde@2": 0.2, "ise.min": 0.02, "kde.n": 5, "rug.n": 5}
    tol: 0.000001
  - params: {h: 0.5, kernel: 1}
    expect: {ise_now: 0.05, "kde@2": 0.8, "ise.max": 0.05}
    tol: 0.000001
```

## Notes

The fixture for precomputed charts: every row is looked up from `toy-kde-lookup` by the sliders `h` and `kernel`. The error series is keyed by the kernel only (its x is the bandwidth), `h_opt` is a constant per kernel, and the histogram and rug have no grid params at all (blank cells).

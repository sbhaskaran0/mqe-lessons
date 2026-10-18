---
type: concept
summary: A kernel density estimate smooths a sample into a curve; the bandwidth trades noise for bias.
domain:
- data
requires: []
---
# Toy Kernel Smoothing

## In plain English

A histogram of incomes is jagged: move the bin edges and it changes shape. A kernel density estimate replaces each observation with a small bump and adds the bumps up. Narrow bumps follow every quirk of the sample; wide bumps blur real features away. The width of the bumps, the bandwidth, is the one choice that matters, and the shape of each bump, the kernel, matters much less than most people expect.

**Why it matters:** Every smoothed curve in the lectures hides a bandwidth choice, and the best one balances noise against bias.

## Definition

With bandwidth $h$ and kernel $K$, the estimate at $x_0$ is

$$\hat{f}(x_0) = \frac{1}{nh}\sum_i K\left(\frac{x_0 - x_i}{h}\right).$$

## Notation

| Symbol | Meaning | Type | Typical value |
| --- | --- | --- | --- |
| $h$ | Bandwidth: the width of each bump | Parameter | 1 |
| $K$ | Kernel: the shape of each bump | Choice | Gaussian |
| $x_0$ | A point where the density is read | Variable | — |
| $y_0$ | A density level | Variable | — |

## Try it

Pick the kernel and bandwidth with the smallest error, then put the probe at $x_0 = 2$.

```interactive
widget: Toy Bandwidth Lookup
state: {h: 0.5, kernel: 1, px: 1, py: 0.1}
goal:
  when: 'kernel == 2 and abs(err - at("ise", at("h_opt", 0))) < 1e-9 and px == 2'
  success: "That is the smallest error: the box kernel at $h = 1$."
  hint: "Switch the kernel, then watch the error panel as you move $h$."
```

## Links

- [[Toy Survey]]

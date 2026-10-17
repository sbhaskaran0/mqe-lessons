---
type: concept
summary: 'Plot investment sf(k) and depreciation δk against capital per worker: the gap is Δk, the crossing is the steady state, and shifting the curve (s, A) or rotating the line (δ) shows every shock''s long-run effect and transition.'
domain:
- macroeconomics
aliases:
- Investment-depreciation diagram
- Solow-Swan diagram
- Solow graph
requires:
- '[[Solow Growth Model]]'
- '[[Steady State]]'
lessons:
- '[[Econ 402A L1 Solow Growth Model]]'
courses:
- Econ 402A
---
# Solow Diagram

## In plain English

The Solow diagram is a picture that shows, for every possible amount of capital per worker, two things: how much new capital the economy adds through saving, and how much existing capital wears out. Where the saving curve sits above the wear-and-tear line, capital grows; where it sits below, capital shrinks; where they cross, capital stays put — the steady state. Because each extra machine adds less output than the last, the saving curve bends over while wear and tear rises in a straight line, so the two cross exactly once. Shifting either one shows at a glance where the economy ends up after a change.

**Why it matters:** It turns every "what happens if saving or depreciation changes" question into a two-step graph exercise, which is exactly how these questions are examined.

## Definition

The Solow diagram plots actual investment per worker $sf(k)$ and depreciation per worker $\delta k$ against capital per worker $k$. The vertical gap between them is the change in capital:

$$\Delta k_{t+1} = k_{t+1} - k_t = s f(k_t) - \delta k_t, \qquad f(k) = Ak^{\alpha}$$

![[Solow diagram - investment vs depreciation.png]]

*Hand-drawn: the concave curve $sf(k)$ crosses the line $\delta k$ at the steady state $\bar{k}$. At $k = 100$ depreciation exceeds investment by 5, so capital falls to 95.*

## Notation

| Symbol | Meaning | Type | Typical value |
| --- | --- | --- | --- |
| $k$ | Capital per worker (horizontal axis) | State variable | 100 at the start of the example |
| $f(k) = Ak^{\alpha}$ | Output per worker | Function | — |
| $sf(k)$ | Actual investment per worker: the share of output saved | Function (concave curve) | — |
| $\delta k$ | Depreciation per worker: capital worn out each period | Function (straight line) | — |
| $s$ | Saving rate | Parameter in (0, 1) | 0.5 in the example |
| $\delta$ | Depreciation rate — the slope of the line | Parameter | 0.1 in the example |
| $A$ | Total factor productivity | Exogenous | 1 in the example |
| $\alpha$ | Capital share (curvature of $f$) | Parameter in (0, 1) | 0.5 in the example |
| $\bar{k}$ | Steady state, where $sf(\bar{k}) = \delta\bar{k}$ | Endogenous | 25 in the example |
| $\Delta k_{t+1}$ | Change in capital per worker from $t$ to $t+1$ | Endogenous | −5 at $k = 100$ |
| $t^{*}$ | Date a shock hits | Index | — |
| $c$ | Consumption per worker, $f(k) - sf(k)$ | Endogenous | 2.5 at the steady state |
| $\eta$, $\tilde{\gamma}$ | Population growth and labor-augmenting technology growth (extended model only) | Parameter | ≈ 0.01, ≈ 0.03 |

## Reading the diagram

| Region | Investment vs depreciation | $\Delta k$ | Capital |
| --- | --- | --- | --- |
| $k < \bar{k}$ | $sf(k) > \delta k$ | > 0 | Rises toward $\bar{k}$ |
| $k = \bar{k}$ | $sf(k) = \delta k$ | 0 | Stays — steady state |
| $k > \bar{k}$ | $sf(k) < \delta k$ | < 0 | Falls toward $\bar{k}$ |

The gap is widest far from $\bar{k}$ and shrinks as $k$ approaches it, so capital moves fast at first and then slows down.

## Worked example

$\alpha = 1/2$, $s = 1/2$, $\delta = 0.1$, $A = 1$, so $sf(k) = 0.5\sqrt{k}$ and $\bar{k} = (sA/\delta)^{1/(1-\alpha)} = 25$.

| $k$ | Investment $sf(k)$ | Depreciation $\delta k$ | $\Delta k$ |
| --- | --- | --- | --- |
| 9 | 1.5 | 0.9 | +0.6 |
| 25 | 2.5 | 2.5 | 0 |
| 100 | 5.0 | 10.0 | −5.0 |

## Shock analysis

The procedure for any parameter change:

1. Start at the old steady state $\bar{k}_1$.
2. Shift the object the parameter enters: $s$ or $A$ shift the curve $sf(k)$; $\delta$ rotates the line $\delta k$.
3. At the old $\bar{k}_1$, read the sign of the new gap — it says which way capital starts moving.
4. The new crossing is the new steady state $\bar{k}_2$.
5. Draw the time path: flat at $\bar{k}_1$ until $t^{*}$, then a smooth approach to $\bar{k}_2$, steepest just after the shock. Capital **never jumps**.

### A rise in depreciation

![[Solow diagram - rise in depreciation.png]]

The line rotates up from $\delta_1 k$ to $\delta_2 k$. At $\bar{k}_1$ depreciation now exceeds investment, so capital falls to the lower crossing $\bar{k}_2$. In the example, $\delta$ from 0.1 to 0.125 lowers $\bar{k}$ from 25 to 16; capital runs 25 → 24.38 → 23.80 → …, reaching 20.45 after 10 periods and 17.17 after 30.

### A rise in the saving rate

![[Solow diagram - rise in saving rate.png]]

The curve shifts up from $s_1f(k)$ to $s_2f(k)$. At $\bar{k}_1$ investment now exceeds depreciation, so capital rises to $\bar{k}_2$. In the example, $s$ from 0.5 to 0.6 raises $\bar{k}$ from 25 to 36; capital runs 25 → 25.50 → 25.98 → …, reaching 29.16 after 10 periods and 33.46 after 30.


### With population and technology growth

The same diagram works per effective worker: the axis is $\tilde{k}$ and the straight line is break-even investment $(\delta + \eta + \tilde{\gamma})\tilde{k}$, so faster population or technology growth rotates the line up just like higher depreciation.

![[Solow diagram - rise in population growth with technological progress.png]]

Details and the log growth paths are in [[Solow Model with Technological Progress]].

### All shocks

| Shock | What moves on the diagram | $\bar{k}$ | Transition |
| --- | --- | --- | --- |
| $s$ up | Curve shifts up | ↑ | $k$ rises gradually |
| $s$ down | Curve shifts down | ↓ | $k$ falls gradually |
| $\delta$ up | Line rotates up (steeper) | ↓ | $k$ falls gradually |
| $\delta$ down | Line rotates down (flatter) | ↑ | $k$ rises gradually |
| $A$ up (beyond the notes) | Curve shifts up, like a rise in $s$ | ↑ | $k$ rises; $y$ also jumps at once because $A$ multiplies output |
| One-off loss of capital (war, earthquake) | Nothing shifts; the economy moves left along the axis | Unchanged | $k$ rebuilds to the old $\bar{k}$ |

Output per worker follows capital, $y = Ak^{\alpha}$, so its time path has the same shape.

## Reading consumption off the diagram

Add the output curve $f(k)$ above $sf(k)$. At any $k$, consumption is the gap between them, $c = f(k) - sf(k) = (1-s)f(k)$. At a steady state, $sf(\bar{k}) = \delta\bar{k}$, so consumption is the gap between $f(k)$ and the **depreciation line**: $\bar{c} = f(\bar{k}) - \delta\bar{k}$.

![[Solow diagram - consumption at different saving rates.png]]

*Hand-drawn: a saving rate near 1 (blue) puts the steady state where $f(k)$ meets $\delta k$, leaving nothing to consume; a saving rate near 0 (green) leaves almost no capital and output. The dashed line, parallel to $\delta k$, touches $f(k)$ where the gap between $f(k)$ and $\delta k$ is largest — the golden-rule capital stock, where $f'(k) = \delta$.*

See [[Golden Rule Saving Rate]] for the algebra.

## Common mistakes

- Drawing capital jumping at $t^{*}$. Only the curve or line moves at once; $k$ moves along the time path.
- Shifting the wrong object: a change in $\delta$ rotates the straight line, it does not move the curve.
- Reading consumption as the gap between $sf(k)$ and $\delta k$ — that gap is $\Delta k$. Consumption is the gap between $f(k)$ and $sf(k)$.
- Forgetting that with population growth and technical progress the line's slope becomes $\delta + \eta + \tilde{\gamma}$ and the axis is capital per *effective* worker — see [[Solow Model with Technological Progress]]. Here $\eta$ is population growth and $\tilde{\gamma}$ the growth rate of labor-augmenting technology.

## Where it is used

- Macro: steady-state and comparative-statics questions in any Solow-type growth model; the same inflow-versus-outflow picture appears for any stable [[Steady State]].

## Links

- [[Solow Growth Model]] · [[Golden Rule Saving Rate]] · [[Capital Accumulation Equation]] · [[Steady State]]

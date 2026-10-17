---
type: lecture
summary: 'Fixed saving and diminishing returns drive capital per worker to k̄ = (sA/δ)^(1/(1−α)); with labor and TFP growth, capital per effective worker converges instead, and only technology growth raises long-run per-worker growth.'
course: Econ 402A
lecture: L1
title: The Solow Growth Model
source: The Solow Growth Model written notes 1.pdf; Solow handwritten notes 2.pdf; Solow_Growth_Model_Master_s_Notes.pdf
---

# Econ 402A L1 — The Solow Growth Model

**The simplest model of long-run growth: output comes from technology, capital and labor; a fixed share of output is saved and becomes capital; capital wears out. Because each extra unit of capital adds less output, capital per worker converges to a steady state where investment just covers depreciation — in the notes' example from $k = 100$ down to $\bar{k} = 25$. Shocks to saving or depreciation move that steady state, and capital travels there gradually. Steady-state consumption peaks at the golden-rule saving rate, $s = \alpha$.**

> [!info] Sources and notation
> This summary follows the professor's **written notes**, which work per worker with $A$ and $L$ held constant: $k = K/L$, $\bar{k}$ for the steady state, $k^{*}$ for the golden-rule capital stock. **Written notes 2** (sections 11–16) add population and technology growth and work per *effective* worker, $\tilde{k} = K/(\tilde{A}L)$; the professor's handwritten $\eta$ (population growth) looks like a 3. The typed notes cover the same extension.

## 1. Goal and assumptions

The goal is the simplest model that explains long-run growth. Output is Cobb-Douglas, $Y = AK^{\alpha}L^{1-\alpha}$ ([[Cobb-Douglas Production Function]]), with three sources of growth: technology $A$ (exogenous), capital $K$ (endogenous) and labor $L$ (exogenous). Which variables the model explains and which it takes as given matters for every question that follows ([[Endogenous and Exogenous Variables]]).

## 2. Capital accumulation

Households save a fixed share $s$ of output and consume the rest. Saving equals investment ([[Saving-Investment Identity]]), and investment generates new capital; existing capital depreciates at rate $\delta$. Together these give the law of motion $K_{t+1} = sY_t + (1-\delta)K_t$ ([[Capital Accumulation Equation]]).

## 3. Per-worker units

Dividing production by $L$ cancels the labor terms: $y = Y/L = A(K/L)^{\alpha} = Ak^{\alpha}$. Dividing the law of motion by the constant $L$ gives the equation the rest of the notes use:

$$k_{t+1} = sAk_t^{\alpha} + (1-\delta)k_t$$

## 4. A worked example

With $\alpha = 1/2$, $s = 1/2$, $\delta = 0.1$, $A = 1$ and $k_1 = 100$: $k_2 = \tfrac12(100^{1/2}) + 0.9(100) = 5 + 90 = 95$. New investment (5) does not cover depreciation (10), so capital falls. These numbers run through the whole lecture.

## 5. Investment vs depreciation

Subtracting $k_t$ from both sides gives $\Delta k = sf(k_t) - \delta k_t$: capital grows by investment minus depreciation. Plotting both against $k$ gives the [[Solow Diagram]]. Investment $sf(k)$ is concave because of diminishing returns; depreciation $\delta k$ is a straight line. At $k = 100$ the line is 5 above the curve — the fall to 95 in section 4. Where they cross, $sf(k) = \delta k$, so $\Delta k = 0$: the steady state.

![[Solow diagram - investment vs depreciation.png]]

## 6. The steady state

Setting $k_{t+1} = k_t = \bar{k}$ ([[Steady State]]) gives $sA\bar{k}^{\alpha} = \delta\bar{k}$, so $sA/\delta = \bar{k}^{1-\alpha}$ and

$$\bar{k} = \left(\frac{sA}{\delta}\right)^{\frac{1}{1-\alpha}}$$

In the example $\bar{k} = (0.5/0.1)^2 = 25$. The full derivation, step by step, is in [[Solow Growth Model]].

## 7. Dynamics

Starting at $k_1 = 100$, four times the steady state, capital declines toward 25: quickly at first (95, 90.4, 86.1, …), then more slowly as the gap between investment and depreciation shrinks. It is still at about 29 after 50 periods. Below the steady state the mirror image holds. This is convergence, driven by diminishing returns ([[Convexity and Concavity]]).

![[Solow transition path - capital converging to steady state.png]]

## 8. Shocks

The notes analyze shocks starting from the steady state, using the diagram and a time path side by side:

- **Depreciation rises at $t^{*}$**: the line rotates up from $\delta_1k$ to $\delta_2k$, the crossing moves left, and capital declines gradually from $\bar{k}_1$ to the lower $\bar{k}_2$.

![[Solow diagram - rise in depreciation.png]]

- **Saving rate rises**: the curve shifts up from $s_1f(k)$ to $s_2f(k)$, the crossing moves right, and capital rises gradually to the higher $\bar{k}_2$.

![[Solow diagram - rise in saving rate.png]]

In both cases capital is flat until the shock and then bends smoothly toward its new level — it never jumps. With the example's numbers, $\delta$ from 0.1 to 0.125 lowers $\bar{k}$ to 16, and $s$ from 0.5 to 0.6 raises it to 36.

## 9. Consumption

Consumption per worker is $c = (1-s)y$, with $y = Ak^{\alpha}$. A higher saving rate has two opposite effects: it raises $k$ and therefore $y$, but only **over time**; it lowers the share consumed, $1-s$, **immediately**. On the diagram, consumption is the gap between $f(k)$ and $sf(k)$. At the extremes it is zero: with $s = 1$ output is high but nothing is consumed; with $s = 0$ there is no capital, so $y = 0$.

![[Solow diagram - consumption at different saving rates.png]]

## 10. The golden rule

Which $s$ maximizes steady-state consumption? In steady state $sf(\bar{k}) = \delta\bar{k}$, so $\bar{c} = f(\bar{k}) - \delta\bar{k}$. Maximizing gives $f'(\bar{k}) = \delta$ ([[Unconstrained Optimization]]). The intuition: if $f'(\bar{k}) > \delta$, extra capital adds more output than it costs in depreciation, so consumption rises and the economy should save more; if $f'(\bar{k}) < \delta$, it should save less. With Cobb-Douglas, $\alpha A k^{\alpha-1} = \delta$ gives $k^{*} = (\alpha A/\delta)^{1/(1-\alpha)}$, and matching this to $\bar{k}$ gives $s = \alpha$ ([[Golden Rule Saving Rate]]). The example economy, with $s = 1/2 = \alpha$, sits exactly at the golden rule ($\bar{c} = 2.5$).

After a rise in $s$, consumption drops at once and then recovers as capital builds up. The notes draw two cases. If $s < \alpha$, consumption ends **above** its old level. If $s > \alpha$, it recovers only partly and ends **below**. In numbers: $s$ from 0.3 to 0.4 takes $c$ from 2.1 down to 1.8, then up to 2.4. From 0.5 to 0.6 it goes 2.5 → 2.0 → 2.4.

![[Golden rule - consumption path after a rise in saving.png]]

## 11. Adding growth in labor and TFP

Written notes 2 let labor and technology grow: $L_{t+1} = L_t(1+\eta)$ and $A_{t+1} = A_t(1+\gamma)$. Last time the steady state meant constant capital per worker, $\bar{k} = (As/\delta)^{1/(1-\alpha)}$ — but if $A$ grows, that target keeps rising and "this doesn't work". The fix: define labor-augmenting technology $\tilde{A} = A^{1/(1-\alpha)}$ ([[Factor-Augmenting Technology]]) and capital per **effective** worker $\tilde{k} = K/(\tilde{A}L)$ ([[Efficiency Units of Labor]]).

## 12. Stationarizing

Rewriting production as $Y = K^{\alpha}(\tilde{A}L)^{1-\alpha}$ and dividing by $\tilde{A}L$ gives $\tilde{y} = \tilde{k}^{\alpha}$; $\tilde{A}$ grows at $\gamma/(1-\alpha) = \tilde{\gamma}$ ([[Logarithms and Growth Rates]]). Dividing the law of motion by $\tilde{A}_tL_t$ and using $\tilde{A}_t = \tilde{A}_{t+1}/(1+\tilde{\gamma})$, $L_t = L_{t+1}/(1+\eta)$, then dropping the tiny $\tilde{\gamma}\eta$ term:

$$\tilde{k}_{t+1}(1 + \tilde{\gamma} + \eta) = s\tilde{k}_t^{\alpha} + (1-\delta)\tilde{k}_t$$

Remember what moves $\tilde{k} = K/(\tilde{A}L)$: the numerator rises with investment $sf(\tilde{k})$ and falls with depreciation $\delta\tilde{k}$; the denominator rises at rate $\tilde{\gamma}$ (technology) and $\eta$ (population). Step-by-step derivation in [[Solow Model with Technological Progress]].

## 13. The new steady state

Setting $\tilde{k}_{t+1} = \tilde{k}_t = \bar{k}$: $\bar{k}(\delta + \eta + \tilde{\gamma}) = s\bar{k}^{\alpha}$, so $\bar{k} = (s/(\delta + \eta + \tilde{\gamma}))^{1/(1-\alpha)}$. On the [[Solow Diagram]] the straight line is now break-even investment, $(\delta + \eta + \tilde{\gamma})\tilde{k}$. (Example: $\alpha = 1/3$, $s = 0.2$, $\delta = 0.05$, $\eta = 0.01$, $\gamma = 0.02$ gives $\tilde{\gamma} = 0.03$ and $\bar{k} = 3.31$.) The golden rule becomes $f'(\bar{k}) = \delta + \eta + \tilde{\gamma}$ — still $s = \alpha$.

## 14. Shock: faster population growth

A rise in $\eta$ means more people next period than at the old rate, so the break-even line rotates up, $\bar{k}$ falls and $\tilde{k}$ declines gradually (in the example, $\eta$ from 0.01 to 0.02 lowers $\bar{k}$ to 2.83).

![[Solow diagram - rise in population growth with technological progress.png]]

## 15. Three kinds of variables, and growth paths in logs

| Kind | Variables | Built from | Steady-state growth |
| --- | --- | --- | --- |
| Per effective worker | $\tilde{k}, \tilde{y}, \tilde{c}$ | $\tilde{k} = K/(\tilde{A}L)$ | 0 |
| Per worker | $k, y, c$ | $\ln k = \ln\tilde{k} + \ln\tilde{A}$ | $\tilde{\gamma}$ |
| Aggregate | $K, Y, C$ | $\ln K = \ln\tilde{k} + \ln\tilde{A} + \ln L$ | $\tilde{\gamma} + \eta$ |

The notes draw each piece in logs and add them ([[Balanced Growth Path]]). After the rise in $\eta$, $\ln\tilde{k}$ falls to its new level while $\ln\tilde{A}$ keeps slope $\tilde{\gamma}$. So per-worker capital grows more slowly for a while, then runs parallel to its old path but **lower** — a level effect (about 0.16 log points lower in the example).

![[Log growth paths - rise in population growth, capital per worker.png]]

For aggregate capital, $\ln L$ steepens from $\eta_1$ to $\eta_2$, so $\ln K$ eventually grows faster, at $\tilde{\gamma} + \eta_2$.

![[Log growth paths - rise in population growth, aggregate capital.png]]

## 16. Shock: slower technology growth

A fall in $\tilde{\gamma}$ rotates the break-even line **down**, so $\bar{k}$ rises ($\gamma$ from 0.02 to 0.01 takes $\bar{k}$ from 3.31 to 4.35). But per-worker capital, $\ln k = \ln\tilde{k} + \ln\tilde{A}$, bends from slope $\tilde{\gamma}_1$ to the flatter $\tilde{\gamma}_2$, and aggregates from $\tilde{\gamma}_1 + \eta$ to $\tilde{\gamma}_2 + \eta$. This is a **growth effect**: saving, depreciation and population growth only shift the level of the per-worker path, while technology growth sets its slope.

![[Solow diagram - fall in technology growth with log growth paths.png]]

## Cross-course links

> [!tip] Concepts shared with other courses
> - Constant returns and the intensive form $f(k)$ are [[Homogeneous Functions and Euler's Theorem]] — the same property that makes the skill premium depend only on $H/L$ in Econ 424.
> - "Endogenous" here means *determined by the model*; in Econ 430 it means *correlated with the error* — [[Endogenous and Exogenous Variables]].
> - Labor-augmenting technology is the same object as factor-augmenting technology in the skill-premium model.

## Math refresher

- [[Math Prep L6 Optimization]] — the golden-rule first-order condition
- [[Math Prep L4 Multivariable Differentiation]] — marginal product of capital, homogeneity and the intensive form
- [[Math Prep L7 Approximations Logs and Series]] — growth-rate rules for the extended model

## What to be able to do

1. Classify $A$, $K$, $L$, $s$, $\delta$ as exogenous, endogenous or parameters.
2. Derive the per-worker law of motion from $K_{t+1} = sY_t + (1-\delta)K_t$, and iterate it from a starting value.
3. Draw the Solow diagram, mark the steady state, and explain why capital rises below it and falls above it.
4. Solve for $\bar{k}$, $\bar{y}$ and $\bar{c}$ with Cobb-Douglas.
5. Show the effect of a change in $s$, $\delta$ or $A$ on the diagram and draw the time path of $k$, $y$ and $c$.
6. Derive the golden rule $f'(\bar{k}) = \delta$, show $s = \alpha$, and say whether an economy should save more or less.
7. Trace consumption after a rise in saving, and say when it ends higher or lower.
8. Show why the per-worker steady state fails when $A$ grows; define $\tilde{A}$ and $\tilde{k}$, and derive $\tilde{y} = \tilde{k}^{\alpha}$ and $\tilde{\gamma} = \gamma/(1-\alpha)$.
9. Derive the stationarized law of motion (including dropping $\tilde{\gamma}\eta$) and the new steady state.
10. Show a rise in $\eta$ or a fall in $\gamma$ on the diagram and draw the time paths of $\ln\tilde{k}$, $\ln k$ and $\ln K$, separating level effects from growth effects.

## Concepts in this lecture

[[Solow Growth Model]] · [[Solow Diagram]] · [[Endogenous and Exogenous Variables]] · [[Cobb-Douglas Production Function]] · [[Saving-Investment Identity]] · [[Capital Accumulation Equation]] · [[Steady State]] · [[Golden Rule Saving Rate]] · [[Solow Model with Technological Progress]] · [[Balanced Growth Path]] · [[Factor-Augmenting Technology]] · [[Efficiency Units of Labor]] · [[Logarithms and Growth Rates]] · [[Homogeneous Functions and Euler's Theorem]] · [[Partial Derivatives and the Gradient]] · [[Unconstrained Optimization]] · [[Convexity and Concavity]]

## Facts and data in this lecture

None.

Next: [[Econ 402A L2 Two-Period Saving Model]] · Course: [[Econ 402A]]

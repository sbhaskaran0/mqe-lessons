---
type: practice
course: Econ 402A
lecture: L1
summary: 'Intuition-first revision of the Solow model — basic model, Solow diagram, shocks, golden rule, growth and stationarizing — with every symbol explained and 14 practice questions.'
---

# Econ 402A L1 — Solow Model Revision Lesson

Each part follows the same pattern: **the idea in words → the math → what every symbol means**. If an equation looks scary, read the words first; the equation only ever restates them. Answers to the practice questions are in [[Econ 402A L1 Solow Revision Answers]] — try them first.

## Part 0 — Symbol cheat sheet

Keep this open while you read. "Say it" is how to read the symbol aloud.

| Symbol | Say it | What it means | Can it change? |
| --- | --- | --- | --- |
| $Y$ | "Y" | Total output = total income of the economy | Determined by the model |
| $K$ | "K" | Total capital: machines, buildings | Determined by the model, but only slowly (a stock) |
| $L$ | "L" | Number of workers | Given from outside |
| $A$ | "A" | Technology (TFP): how much output you squeeze from given $K$ and $L$ | Given from outside |
| $s$ | "s" | Saving rate: share of income saved (e.g. 0.2 = 20%) | A fixed parameter |
| $\delta$ | "delta" | Depreciation rate: share of capital that wears out each year (e.g. 0.05) | A fixed parameter |
| $\alpha$ | "alpha" | Capital's share: how much output responds to capital (≈ 1/3) | A fixed parameter |
| $k = K/L$ | "little k" | Capital **per worker** | Determined by the model |
| $y = Y/L$ | "little y" | Output **per worker** — living standards | Determined by the model |
| $c$ | "c" | Consumption per worker | Determined by the model |
| $f(k)$ | "f of k" | Output per worker produced with $k$ capital per worker | A function |
| $f'(k)$ | "f prime of k" | **MPK**: extra output from one more unit of capital | Falls as $k$ rises |
| $t$, $t+1$ | "t", "t plus one" | This period, next period | — |
| $\bar{k}$ | "k bar" | **Steady-state** value — the bar always means "steady state" | — |
| $\Delta k$ | "delta k" (capital D) | Change in $k$ from one period to the next | — |
| $\eta$ | "eta" (looks like a 3 in the notes) | Population growth rate | Given |
| $\gamma$ | "gamma" | Technology (TFP) growth rate | Given |
| $\tilde{A}$, $\tilde{\gamma}$ | "A tilde", "gamma tilde" | Technology rewritten to multiply workers, and its growth rate $\gamma/(1-\alpha)$ | Given |
| $\tilde{k}$, $\tilde{y}$, $\tilde{c}$ | "k tilde" etc. | Per **effective** worker — the tilde means "divided by $\tilde{A}L$" | Determined by the model |
| $\ln$ | "log" | Natural log; slopes of log graphs are growth rates | — |

## Part 1 — The whole story in one paragraph

An economy makes output from technology, machines and workers. People save a fixed share of their income, and the savings become new machines. Machines wear out. Each extra machine adds less output than the one before. So when machines are scarce, saving adds machines faster than they wear out and the economy grows; when machines are plentiful, wear and tear catches up with saving. The economy settles where new machines exactly replace worn-out ones — the **steady state**. Saving more moves that resting point up, but cannot keep growth going forever. Only better technology can.

> [!tip] One picture to remember
> A bathtub: the tap is saving (investment), the drain is depreciation. The water level is capital. The level settles where inflow = outflow.

## Part 2 — The building blocks

### 2a. Production

**In words.** Output depends on technology, capital and labor. Doubling *both* machines and workers doubles output, but adding machines alone runs into diminishing returns.

**In math.**

$$Y = A K^{\alpha} L^{1-\alpha}$$

**Per worker** (divide both sides by $L$):

$$y = A k^{\alpha}$$

**Symbols:** $Y$ output; $A$ technology; $K$ capital; $L$ workers; $\alpha$ capital's share, between 0 and 1 (so $k^{\alpha}$ grows ever more slowly — diminishing returns); $y$, $k$ per worker. See [[Cobb-Douglas Production Function]].

### 2b. Saving, investment and depreciation

**In words.** A share $s$ of output is saved; saving equals investment; a share $\delta$ of capital wears out.

**In math.**

$$K_{t+1} = sY_t + (1-\delta)K_t$$

Read it left to right: *next year's capital* = *new machines bought out of saving* + *the part of this year's machines that did not wear out*. See [[Capital Accumulation Equation]] and [[Saving-Investment Identity]].

### 2c. The law of motion (per worker)

**In words.** Same equation, divided by the (constant) number of workers.

**In math.**

$$k_{t+1} = s A k_t^{\alpha} + (1-\delta)k_t \qquad\Longleftrightarrow\qquad \Delta k = \underbrace{s f(k)}_{\text{new machines}} - \underbrace{\delta k}_{\text{worn out}}$$

**Symbols:** $k_{t+1}$ next year's capital per worker; $sf(k) = sAk^{\alpha}$ investment per worker; $\delta k$ depreciation per worker; $\Delta k$ the change.

**Worked example** (the professor's): $\alpha = \tfrac12$, $s = \tfrac12$, $\delta = 0.1$, $A = 1$, start at $k = 100$. Investment $= 0.5 \times \sqrt{100} = 5$. Depreciation $= 0.1 \times 100 = 10$. So $k$ falls by 5, to 95.

## Part 3 — The Solow diagram and the steady state

**In words.** Plot investment and depreciation against capital. Where investment is higher, capital grows; where depreciation is higher, it shrinks; where they cross, capital stops changing.

![[Solow diagram - investment vs depreciation.png]]

*The curve $sf(k)$ bends over (diminishing returns); the line $\delta k$ is straight. They cross at $\bar{k}$.*

**In math.** Steady state means "no change": $\Delta k = 0$, so

$$s A \bar{k}^{\alpha} = \delta \bar{k} \quad\Longrightarrow\quad \bar{k} = \left(\frac{sA}{\delta}\right)^{\frac{1}{1-\alpha}}$$

**How to read the formula:** top = what flows in ($s$ and $A$); bottom = what leaks out ($\delta$); the power $\frac{1}{1-\alpha}$ is bigger than 1, so it magnifies the ratio. In the example: $\bar{k} = (0.5/0.1)^2 = 25$, $\bar{y} = \sqrt{25} = 5$.

![[Solow transition path - capital converging to steady state.png]]

*Starting at 100, capital falls toward 25 — fast at first, slower as the gap closes (95, 90.4, 86.1, …).* See [[Steady State]] and [[Solow Diagram]].

## Part 4 — Shocks: shift, read, trace

**In words.** Every shock question is the same three steps: (1) which thing moves — the curve ($s$ or $A$) or the line ($\delta$)? (2) where is the new crossing? (3) draw the time path: flat, then a smooth bend to the new level. Capital **never jumps**.

![[Solow diagram - rise in depreciation.png]]

*Depreciation up → the line rotates up → new crossing to the left → $k$ falls gradually.*

![[Solow diagram - rise in saving rate.png]]

*Saving up → the curve shifts up → new crossing to the right → $k$ rises gradually.*

| Shock | What moves | $\bar{k}$ |
| --- | --- | --- |
| $s$ ↑ | Curve up | ↑ |
| $\delta$ ↑ | Line steeper | ↓ |
| $A$ ↑ | Curve up | ↑ |
| Earthquake destroys capital | Nothing moves; $k$ jumps left | Same — rebuilds |

## Part 5 — Consumption and the golden rule

**In words.** Saving more gives more machines and more output *later*, but you consume a smaller share *now*. Save everything ($s = 1$) and you consume nothing; save nothing ($s = 0$) and there is no output. Somewhere in between, steady-state consumption is as large as possible — the **golden rule**.

**In math.** Consumption is what is not saved: $c = (1-s)y$. In steady state, investment just covers depreciation, so

$$\bar{c} = f(\bar{k}) - \delta\bar{k}$$

Maximize it: one more unit of capital adds $f'(\bar{k})$ (the MPK) of output but costs $\delta$ to maintain. Keep adding capital while that is profitable:

$$\text{Golden rule: } f'(\bar{k}) = \delta \quad\Longrightarrow\quad s = \alpha \text{ (with Cobb-Douglas)}$$

**The MPK rule:** if $f'(\bar{k}) > \delta$, saving more **raises** steady-state consumption; if $f'(\bar{k}) < \delta$, saving more **lowers** it.

![[Solow diagram - consumption at different saving rates.png]]

*Consumption is the gap between $f(k)$ and the $\delta k$ line; it is widest where the slope of $f$ equals $\delta$ (the dashed tangent).*

![[Golden rule - consumption path after a rise in saving.png]]

*After saving rises, consumption drops at once, then recovers. Below the golden rule ($s < \alpha$) it ends higher; above it, lower.* See [[Golden Rule Saving Rate]].

## Part 6 — Adding growth: effective workers

**In words.** With more workers every year and better technology, capital per worker keeps rising — there is no resting point. The fix is to measure capital per **effective** worker: count each worker in "efficiency units" (a worker with twice the technology counts as two). Measured that way, capital settles down again.

**In math.** Labor grows at $\eta$ and technology at $\gamma$. Rewrite technology so it multiplies workers: $\tilde{A} = A^{1/(1-\alpha)}$, growing at $\tilde{\gamma} = \gamma/(1-\alpha)$. Divide by effective workers $\tilde{A}L$:

$$\tilde{y} = \tilde{k}^{\alpha}, \qquad \tilde{k}_{t+1}(1 + \tilde{\gamma} + \eta) = s\tilde{k}_t^{\alpha} + (1-\delta)\tilde{k}_t$$

$$\text{Steady state: } (\delta + \eta + \tilde{\gamma})\,\bar{k} = s\bar{k}^{\alpha}$$

**Symbols:** the tilde (~) means "per effective worker"; $\delta + \eta + \tilde{\gamma}$ is **break-even investment** — what it takes to keep $\tilde{k}$ constant: replace worn-out machines ($\delta$), equip new workers ($\eta$), keep up with technology ($\tilde{\gamma}$). The Solow diagram is unchanged except that the straight line becomes $(\delta + \eta + \tilde{\gamma})\tilde{k}$, and the golden rule becomes $f'(\bar{k}) = \delta + \eta + \tilde{\gamma}$ (still $s = \alpha$).

### Three kinds of variables

| Kind | Example | Long-run growth rate | Why |
| --- | --- | --- | --- |
| Per effective worker | $\tilde{k}$ | **0** | That is what "steady state" means |
| Per worker | $k = \tilde{k}\tilde{A}$ | $\tilde{\gamma}$ | Adds technology growth |
| Aggregate | $K = \tilde{k}\tilde{A}L$ | $\tilde{\gamma} + \eta$ | Adds population growth too |

In logs, products become sums: $\ln k = \ln\tilde{k} + \ln\tilde{A}$. Draw each piece and add them.

![[Solow diagram - rise in population growth with technological progress.png]]

![[Log growth paths - rise in population growth, capital per worker.png]]

*Population growth ↑: $\tilde{k}$ falls to a lower level, so the per-worker path ends **parallel but lower** — a level effect. Aggregate growth rises to $\tilde{\gamma} + \eta_2$.*

![[Solow diagram - fall in technology growth with log growth paths.png]]

*Technology growth ↓: $\tilde{k}$ rises, but the per-worker path bends to a **flatter slope** — a growth effect.* See [[Solow Model with Technological Progress]] and [[Balanced Growth Path]].

> [!important] The one sentence to remember
> Saving, depreciation and population growth change the **level** of living standards; only technology growth changes their long-run **growth rate**.

## Part 7 — Practice questions

**A. Concepts**

1. Classify each as exogenous, endogenous or a parameter: $A$, $K$, $L$, $s$, $\delta$, $Y$.
2. True or false, and why: "A country that permanently raises its saving rate will permanently grow faster."
3. Why can capital not jump when the saving rate changes, while consumption can?

**B. Calculations** (basic model, $A = 1$)

4. $\alpha = 0.5$, $s = 0.3$, $\delta = 0.1$, $k = 16$. Compute investment, depreciation and next period's $k$. Is the economy above or below its steady state? Find $\bar{k}$.
5. $\alpha = 1/3$, $s = 0.25$, $\delta = 0.05$. Find $\bar{k}$, $\bar{y}$ and $\bar{c}$.
6. For the economy in question 5, compute the MPK at the steady state. Should it save more or less to raise steady-state consumption? What is the golden-rule saving rate, and what consumption does it deliver?
7. Same economy: $s$ rises from 0.25 to 0.30. What happens to consumption immediately, and what is the new steady-state consumption?

**C. Diagrams** (describe in words, or sketch on paper)

8. Depreciation **falls**. Show the Solow diagram and the time path of $k$ and $y$.
9. Technology $A$ jumps up once. How does this differ from a rise in $s$ on impact?

**D. Growth version**

10. $\gamma = 0.02$, $\alpha = 1/3$, $\eta = 0.01$. Find $\tilde{\gamma}$ and the long-run growth rates of $\tilde{k}$, $k$, $K$, $y$ and $Y$.
11. $s = 0.2$, $\delta = 0.05$, $\eta = 0.01$, $\tilde{\gamma} = 0.03$, $\alpha = 1/3$. Find $\bar{k}$ and $\tilde{y}$ in steady state. Is MPK above or below break-even investment?
12. Multiple choice — technology growth $\gamma$ falls. In the long run:
    a) $\tilde{k}$ falls and per-worker growth falls
    b) $\tilde{k}$ rises and per-worker growth falls
    c) $\tilde{k}$ rises and per-worker growth is unchanged
    d) Only aggregate growth falls
13. Population growth rises. Sketch $\ln\tilde{k}$, $\ln\tilde{A}$ and $\ln k$ against time, and say whether the change in $\ln k$ is a level or a growth effect.
14. Explain in two sentences why the model is "stationarized" — what goes wrong without it?

---
type: concept
summary: Fixed saving, diminishing returns and depreciation drive capital per worker to a steady state k̄ = (sA/δ)^(1/(1−α)) where investment just replaces worn-out capital; saving raises levels, not long-run growth.
domain:
- macroeconomics
aliases:
- Solow model
- Solow-Swan model
- Neoclassical growth model
- Exogenous growth model
- Basic Solow model
requires:
- '[[Cobb-Douglas Production Function]]'
- '[[Capital Accumulation Equation]]'
- '[[Saving-Investment Identity]]'
- '[[Steady State]]'
lessons:
- '[[Econ 402A L1 Solow Growth Model]]'
courses:
- Econ 402A
---
# Solow Growth Model

## In plain English

The Solow model is the simplest model of long-run growth. Output is made from technology, machines and workers. Technology and the number of workers are taken as given; the stock of machines is built up inside the model. People save a fixed share of their income, and those savings become new machines. Machines wear out, and each extra machine adds less output than the last. So an economy that keeps saving eventually reaches a point where new investment only just replaces what wears out — it stops getting richer from saving alone. An economy that starts with more machines than that runs down to the same point. Only better technology keeps living standards rising.

**Why it matters:** It separates what saving can do (make a country permanently richer in level) from what only innovation can do (keep it growing), and it predicts that economies far from their steady state change fastest.

## Definition

Robert Solow's 1956 model of long-run growth: households save a constant fraction of income, saving becomes capital, and capital has diminishing returns. In the basic version technology $A$ and labor $L$ are constant, and capital per worker follows

$$k_{t+1} = sAk_t^{\alpha} + (1-\delta)k_t$$

converging to the steady state

$$\bar{k} = \left(\frac{sA}{\delta}\right)^{\frac{1}{1-\alpha}}$$

## Notation

Stocks ($K$, $L$, $k$) are measured at the start of a period and move only gradually; flows ($Y$, $C$, $S$, $I$) can jump.

| Symbol | Meaning | Type | Typical value |
| --- | --- | --- | --- |
| $Y$ | Output — also total income | Endogenous (flow) | — |
| $K$ | Capital stock: machines, structures | Endogenous (stock, state variable) | — |
| $L$ | Labor (all of the population works) | Exogenous; constant in the basic model | — |
| $A$ | Total factor productivity (technology) | Exogenous; constant in the basic model | 1 in the example |
| $C$, $S$, $I$ | Consumption, saving, investment: $C = (1-s)Y$, $S = sY$, $S = I$ | Endogenous (flows) | — |
| $y = Y/L$, $k = K/L$, $c = C/L$ | Output, capital and consumption per worker | Endogenous; $k$ is the state variable | — |
| $s$ | Saving rate — assumed, not chosen optimally | Parameter in (0, 1) | 0.5 in the example (≈ 0.2 in data) |
| $\alpha$ | Capital share: exponent on $K$ | Parameter in (0, 1) | 0.5 in the example (≈ 1/3 in data) |
| $\delta$ | Depreciation rate: share of capital worn out each period | Parameter | 0.1 in the example (≈ 0.05 in data) |
| $f(k) = Ak^{\alpha}$ | Output per worker as a function of capital per worker | Function | — |
| $\bar{k}$, $\bar{y}$, $\bar{c}$ | Steady-state values (an overbar always means steady state) | Endogenous | 25, 5, 2.5 in the example |
| $t$ | Time period | Index | — |
| $\eta$, $\gamma$ | Growth rates of labor and of TFP in the extended model | Parameter | ≈ 0.01, ≈ 0.02 |
| $\tilde{\gamma}$, $\tilde{k}$ | Growth rate of labor-augmenting technology; capital per effective worker (extended model) | Parameter / endogenous | ≈ 0.03 |

## Assumptions

Three sources of growth enter through Cobb-Douglas production, $Y = AK^{\alpha}L^{1-\alpha}$ ([[Cobb-Douglas Production Function]]):

| Source | Role | Status ([[Endogenous and Exogenous Variables]]) |
| --- | --- | --- |
| $A$ — technology | Multiplies output | **Exogenous** |
| $K$ — capital | Accumulated from saving | **Endogenous** |
| $L$ — labor | Workers | **Exogenous** |

Behaviour: output is split into consumption and saving at a **fixed saving rate** $s$; saving equals investment ([[Saving-Investment Identity]]) and generates new capital; capital depreciates at rate $\delta$ each period.

## Law of motion

Aggregate capital ([[Capital Accumulation Equation]]):

$$K_{t+1} = sY_t + (1-\delta)K_t$$

**Per worker.** Divide production by $L$: $Y/L = AK^{\alpha}L^{1-\alpha}/L = A(K/L)^{\alpha}$, so $y = Ak^{\alpha}$. Divide the law of motion by the (constant) $L$:

$$\frac{K_{t+1}}{L} = \frac{sAK_t^{\alpha}L^{1-\alpha}}{L} + \frac{(1-\delta)K_t}{L} \quad\Longrightarrow\quad k_{t+1} = sAk_t^{\alpha} + (1-\delta)k_t$$

This step needs $L$ constant; with a growing workforce see [[Solow Model with Technological Progress]].

**Worked example** ($\alpha = 1/2$, $s = 1/2$, $\delta = 0.1$, $A = 1$, $k_1 = 100$): $k_2 = \tfrac12\cdot 100^{1/2} + 0.9\cdot 100 = 5 + 90 = 95$. Investment (5) is below depreciation (10), so capital falls.

## Steady state

Set $k_{t+1} = k_t = \bar{k}$ ([[Steady State]]). Subtracting $k_t$ from the law of motion gives $k_{t+1} - k_t = sAk_t^{\alpha} - \delta k_t$, so

$$0 = sA\bar{k}^{\alpha} - \delta\bar{k} \;\Longrightarrow\; \frac{sA}{\delta} = \frac{\bar{k}}{\bar{k}^{\alpha}} = \bar{k}^{1-\alpha} \;\Longrightarrow\; \bar{k} = \left(\frac{sA}{\delta}\right)^{\frac{1}{1-\alpha}}$$

Example: $\bar{k} = (0.5/0.1)^2 = 25$, $\bar{y} = \sqrt{25} = 5$, $\bar{c} = 0.5 \times 5 = 2.5$.

> [!tip] Reading the formula
> Numerator = what goes in ($sA$). Denominator = what leaks out ($\delta$). The exponent $1/(1-\alpha) > 1$ amplifies the ratio because more capital produces more output, which is partly saved again. With $\alpha = 1/3$ the exponent is 1.5, so doubling $s$ raises $\bar{k}$ by $2^{1.5} = 2.83\times$ — and $\bar{y}$ by only $2^{0.5} = 1.41\times$.

Graphically, the steady state is where the concave investment curve $sf(k)$ crosses the depreciation line $\delta k$ — see [[Solow Diagram]].

## Dynamics

![[Solow transition path - capital converging to steady state.png]]

Starting above the steady state, capital falls toward it — quickly at first, then more slowly as the gap between investment and depreciation shrinks:

| Period | 1 | 2 | 3 | 4 | 5 | 11 | 21 | 31 | 51 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| $k_t$ | 100 | 95.00 | 90.37 | 86.09 | 82.12 | 63.62 | 45.89 | 36.71 | 28.93 |

The initial gap of 75 halves within 11 periods. Near $\bar{k}$ the gap shrinks by a factor $1 - (1-\alpha)\delta = 0.95$ each period (see the stability example in [[Steady State]]). Starting below $\bar{k}$ the mirror image happens: capital grows, fastest when furthest away. This is **conditional convergence** — toward each economy's own $\bar{k}$, which depends on $s$, $A$, $\delta$ and $\alpha$.

## Shocks

Parameter changes move $\bar{k}$; capital then travels there gradually and output $y = Ak^{\alpha}$ follows.

| Change | $\bar{k}$ | Example |
| --- | --- | --- |
| Saving rate $s$ up | ↑ | $s$: 0.5 → 0.6 gives $\bar{k}$: 25 → 36 |
| Depreciation $\delta$ up | ↓ | $\delta$: 0.1 → 0.125 gives $\bar{k}$: 25 → 16 |
| Technology $A$ up | ↑ | — |
| One-off loss of capital | Unchanged | $k$ rebuilds to the old $\bar{k}$ |

The graphs for each case, with time paths, are in [[Solow Diagram]].

## Consumption and the golden rule

Consumption per worker is $c = (1-s)y$. A rise in $s$ works through two channels: it cuts the share consumed **immediately**, and it raises $k$ and therefore $y$ **over time**. At the extremes consumption is zero: $s = 1$ gives high output but nothing consumed; $s = 0$ gives no capital and no output. In between, steady-state consumption peaks at the [[Golden Rule Saving Rate]], $s = \alpha$ under Cobb-Douglas.

In the example ($\alpha = 1/2$), $\bar{c} = 10s(1-s)$:

| $s$ | 0.1 | 0.3 | 0.5 | 0.7 | 0.9 |
| --- | --- | --- | --- | --- | --- |
| $\bar{k}$ | 1 | 9 | 25 | 49 | 81 |
| $\bar{c}$ | 0.9 | 2.1 | **2.5** | 2.1 | 0.9 |

The example economy, with $s = 1/2 = \alpha$, is exactly at the golden rule.

## Adding growth

With labor growing at $\eta$ and TFP at $\gamma$, capital per worker never settles. Dividing by effective labor restores a steady state, $\tilde{k} \to (s/(\delta+\eta+\tilde{\gamma}))^{1/(1-\alpha)}$ with $\tilde{\gamma} = \gamma/(1-\alpha)$, along which output per worker grows at $\tilde{\gamma}$ forever — the [[Balanced Growth Path]]. Saving still affects only levels; sustained growth in living standards needs technological progress. Details in [[Solow Model with Technological Progress]].

## Common mistakes

- Saying higher saving raises the long-run *growth rate*. It raises the steady-state *level*; growth is faster only during the transition.
- Letting capital jump after a parameter change — it is a stock and moves only through the law of motion.
- Dividing by $L$ as if it were constant when the workforce grows.
- Thinking the aim is to maximize capital: the golden rule maximizes *consumption*.

## Where it is used

- Macro: growth accounting, convergence across countries, development policy; the benchmark that optimal-saving (Ramsey) models are compared against.

## Links

- [[Solow Diagram]] · [[Golden Rule Saving Rate]] · [[Solow Model with Technological Progress]] · [[Endogenous and Exogenous Variables]]
- [[Two-Period Consumption-Saving Model]] — saving as a choice: with capital, MPK plays the interest rate's role

---
type: concept
summary: A fixed saving share and wear and tear drive capital per worker to a resting level where investment just replaces worn-out capital.
domain:
- macroeconomics
aliases:
- Toy model
requires:
- '[[Toy Production Function]]'
---
# Toy Growth Model

## In plain English

The toy growth model tracks one thing: how much equipment each worker has. Every year people set aside a fixed share of what they produce and turn it into new equipment, while some old equipment wears out. When equipment is scarce, the new additions outpace the wear and the stock grows. When it is plentiful, wear catches up. Eventually the two balance and the stock stops changing, like a bathtub whose tap and drain run at the same rate. Saving more raises that resting level but cannot keep it rising forever.

**Why it matters:** It separates what saving can do (raise the level) from what it cannot (raise long-run growth).

## Definition

Capital per worker follows

$$k_{t+1} = sAk_t^{\alpha} + (1-\delta)k_t$$

and settles at the steady state

$$\bar{k} = \left(\frac{sA}{\delta}\right)^{\frac{1}{1-\alpha}}$$

## Notation

| Symbol | Meaning | Type | Typical value |
| --- | --- | --- | --- |
| $k$ | Capital per worker | State variable | 100 at the start |
| $s$ | Saving rate | Parameter in (0, 1) | 0.5 |
| $\delta$ | Depreciation rate | Parameter | 0.1 |
| $A$ | Productivity | Parameter | 1 |
| $\alpha$ | Capital share | Parameter in (0, 1) | 0.5 |
| $\bar{k}$, $\bar{c}$ | Steady-state capital and consumption | Endogenous | 25, 2.5 |
| $c$ | Consumption per worker | Endogenous | — |
| $sf(k)$ | Investment per worker | Function (curve) | — |
| $\delta k$ | Depreciation per worker | Function (line) | — |
| $k^{*}$ | Golden-rule capital | Endogenous | 25 |
| $t$ | Period | Index | — |

## Worked example

With $s = 0.5$, $A = 1$, $\alpha = 0.5$ and $\delta = 0.1$, the steady state is $\bar{k} = 25$.

![[Toy diagram.png]]

*The curve $sf(k)$ crosses the line $\delta k$ at $\bar{k}$.*

## Links

- [[Toy Production Function]]
- Paper: [[Toy 1956 - A Toy Contribution]]

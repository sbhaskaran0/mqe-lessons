---
type: lecture
summary: Saving and wear and tear drive capital per worker to a steady state; saving more raises its level, not long-run growth.
course: Toy 101
lecture: L1
title: Growth in a Toy Economy
source: Fixture written for the lesson player's tests
interactive: true
---
# Toy 101 L1 — Growth in a Toy Economy

**Capital per worker converges to a steady state where investment just covers depreciation.**

## 1. Production

Output per worker depends on capital per worker through the production function:

$$y = Ak^{\alpha}$$

where $\alpha$ is the capital share ([[Toy Production Function]]).

## 2. The steady state

Investment $sf(k)$ is a concave curve and depreciation $\delta k$ a straight line; they cross at the steady state $\bar{k}$.

![[Toy diagram.png]]

*The crossing is the steady state.*

```interactive
widget: Toy Steady State Explorer
state: {s: 0.4}
lock: [A, alpha]
show: [saving, depreciation, steady, kbar_out]
highlight: steady
prompt: Only $s$ and $\delta$ move. Raise $s$ and watch where the curve meets the line.
```

%% step %%

Now find the saving rate that maximizes steady-state consumption.

```interactive
widget: Toy Steady State Explorer
state: {s: 0.3}
lock: [A, alpha, delta]
goal:
  when: "abs(s - alpha) < 0.01"
  success: "That's the golden rule: with this technology, $s = \\alpha$."
  hint: "Watch the consumption readout."
objective: 3
```

%% a note to self that the player must never show %%

> [!check]- If the saving rate doubles, what happens to long-run growth of output per worker?
> - [ ] It doubles
>   - Doubling saving raises investment once; capital then settles at a new, higher steady state and stops growing.
> - [x] It is unchanged: only the level rises
> - [ ] It falls to zero
> objective: 1
>
> **Why:** In the steady state capital per worker is constant, so saving changes the level only.

> [!check]- With $s = 0.5$, $A = 1$, $\alpha = 0.5$ and $\delta = 0.1$, what is $\bar{k}$?
> answer: 25 ± 0.05
> wrong: 5 — that is $sA/\delta$; raise it to the power $1/(1-\alpha) = 2$
> objective: 2
>
> **Why:** $\bar{k} = (sA/\delta)^{1/(1-\alpha)} = 5^2 = 25$.

## 3. Convergence

### From above

Starting at four times the steady state, capital falls toward it, quickly at first.

```interactive
widget: Toy Convergence
predict:
  hide: [capital]
  ask: Sketch the path of capital after the saving rate rises at t = 30.
  options:
    - {text: Jumps up at once, feedback: "Capital is a stock: only investment adds to it, a little each period."}
    - Rises gradually
    - Stays flat
  answer: 1
  why: "Higher saving lifts investment above depreciation, so $k$ climbs toward the new $\\bar{k}$ period by period."
objective: 1
```

## 4. Data

Saving rates differ across countries ([[Toy Saving Rates]]).

```interactive
widget: Toy Saving Chart
show: [rich, poor, crisis]
```

## 5. Deriving the steady state

Setting investment equal to depreciation pins down $\bar{k}$ in two steps.

> [!derive]- Solve for the steady state $\bar{k}$
> objective: 2
> notation: [[Toy Growth Model]]
> symbols: $s \in (0.05, 0.95)$, $\alpha \in (0.2, 0.8)$, $\delta \in (0.02, 0.2)$
> unknowns: $\bar{k}$
> given: $sA\bar{k}^{\alpha} = \delta\bar{k}$
>
> 1. Divide both sides by $\delta\bar{k}^{\alpha}$: $\bar{k}^{1-\alpha} = \frac{sA}{\delta}$
>    justify: Why may we divide by $\bar{k}^{\alpha}$?
>    - [ ] Because $\alpha < 1$
>    - [x] Because the steady state we want has $\bar{k} > 0$
> 2. Take the $1/(1-\alpha)$ power: $\bar{k} = \left(\frac{sA}{\delta}\right)^{\frac{1}{1-\alpha}}$
>    hint: Raise both sides to the same power, $1/(1-\alpha)$.
>
> reject: $\bar{k} = \left(\frac{sA}{\delta}\right)^{\frac{1}{\alpha}}$ — dividing by $\bar{k}^{\alpha}$ leaves $\bar{k}^{1-\alpha}$, so the power is $1/(1-\alpha)$

Now use the formula before the diagram does.

> [!interactive]- Work out $\bar{k}$ for $s = 0.4$, then reveal it
> widget: Toy Steady State Explorer
> state: {s: 0.4}
> lock: [s, A, alpha, delta]
> predict: {ask: "With $s = 0.4$, $A = 1$, $\\alpha = 0.5$ and $\\delta = 0.1$, what is $\\bar{k}$?", hide: [kbar_out], readout: kbar_out, tol: 0.05}
> objective: 2

> [!interactive]- (planned) See that consumption peaks where $s = \alpha$
> widget: Toy Golden Rule
> figure: Toy diagram.png
> objective: 3
> brief:
>   model: "[[Toy Growth Model]]"
>   panels: ["curve: steady-state consumption against s (sweep s), current s marked"]
>   learner: Drag s to the top of the hill
>   goal: "abs(s - alpha) < 0.01"
>   numbers:
>     - {params: {s: 0.5, alpha: 0.5}, expect: {cbar: 2.5}, source: "L1, golden rule example"}

> [!check]- With $s = 0.3$, $A = 1$, $\alpha = 0.5$ and $\delta = 0.1$, what is steady-state capital $\bar{k}$?
> answer: 9 ± 1%
> vary: $s \in [0.2, 0.4]$ step 0.05; $\delta \in \{0.05, 0.08, 0.1\}$
> compute: $\left(\frac{sA}{\delta}\right)^{\frac{1}{1-\alpha}}$
> wrong: $sA/\delta$ — that is $sA/\delta$ itself; raise it to the power $1/(1-\alpha)$
>
> **Why:** Solve $sA\bar{k}^{\alpha} = \delta\bar{k}$: $\bar{k} = (sA/\delta)^{1/(1-\alpha)}$. With $\alpha = 0.5$ the power is 2, so square $sA/\delta$.

## What to be able to do

1. Explain why a higher saving rate raises the level of output per worker but not its long-run growth.
2. Derive the steady state $\bar{k}$ from investment equal to depreciation.
3. Find the golden-rule saving rate.

## Papers in this lecture

[[Toy 1956 - A Toy Contribution]]

## Concepts in this lecture

[[Toy Growth Model]] · [[Toy Production Function]]

## Facts and data in this lecture

[[Toy Saving Rates]] · [[Toy Survey]]

Course: [[Toy 101]]

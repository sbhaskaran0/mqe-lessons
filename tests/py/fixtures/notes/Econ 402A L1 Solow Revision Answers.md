---
type: practice
course: Econ 402A
lecture: L1
summary: 'Worked answers to the Solow revision lesson questions, with the intuition behind each step.'
---

# Econ 402A L1 — Solow Revision Answers

Questions: [[Econ 402A L1 Solow Revision Lesson]]. All numbers checked in Python.

## A. Concepts

**1.** Exogenous (given from outside): $A$, $L$. Endogenous (solved by the model): $K$, $Y$. Parameters (fixed constants): $s$, $\delta$. See [[Endogenous and Exogenous Variables]].

**2. False.** A higher saving rate raises the *level* of the steady state. Growth is faster only during the transition to the new steady state; in the long run, per-worker growth is set by technology ($\tilde{\gamma}$, or zero in the basic model).

**3.** Capital is a **stock** built up over time — it only changes through investment and depreciation, period by period. Consumption is a **flow**: $c = (1-s)y$, so when $s$ changes, the share consumed changes immediately.

## B. Calculations

**4.** Investment $= 0.3 \times \sqrt{16} = 1.2$. Depreciation $= 0.1 \times 16 = 1.6$. Next period $k = 16 + 1.2 - 1.6 = 15.6$. Depreciation exceeds investment, so the economy is **above** its steady state: $\bar{k} = (0.3/0.1)^{1/(1-0.5)} = 3^2 = 9$.

**5.** $\bar{k} = (0.25/0.05)^{1/(2/3)} = 5^{1.5} = 11.18$. $\bar{y} = \bar{k}^{1/3} = 5^{0.5} = 2.236$. $\bar{c} = (1 - 0.25) \times 2.236 = 1.677$.

**6.** MPK $= \alpha\bar{k}^{\alpha-1}$. A shortcut: in steady state $s\bar{k}^{\alpha} = \delta\bar{k}$, so MPK $= \alpha\delta/s = (1/3)(0.05)/0.25 = 0.0667$. That is **above** $\delta = 0.05$, so the economy saves too little — saving more raises steady-state consumption. Golden rule: $s = \alpha = 1/3$, giving $\bar{k} = (6.67)^{1.5} = 17.21$, $\bar{y} = 2.582$, $\bar{c} = (2/3)(2.582) = 1.721$ — higher than 1.677. ✓

**7.** Immediately: output is unchanged (capital cannot jump), but the consumed share falls from 0.75 to 0.70: $c = 0.70 \times 2.236 = 1.565$ (down from 1.677). In the new steady state: $\bar{k} = 6^{1.5} = 14.70$, $\bar{y} = 2.449$, $\bar{c} = 0.70 \times 2.449 = 1.715$ — **higher** than before, because $s$ moved toward $\alpha$ without crossing it.

## C. Diagrams

**8.** The depreciation line **rotates down** (flatter). At the old $\bar{k}$, investment now exceeds depreciation, so the new crossing is to the right: $\bar{k}$ rises. Time path: $k$ flat at the old level until the shock, then rises smoothly (fastest at first) to the new level; $y = Ak^{\alpha}$ follows the same shape. Mirror image of the "rise in depreciation" drawing.

**9.** On the diagram both shift the investment curve up and raise $\bar{k}$. The difference is on impact: a rise in $A$ raises output **immediately** ($y = Ak^{\alpha}$ jumps even though $k$ has not moved yet), while a rise in $s$ leaves output unchanged at first and *lowers* consumption.

## D. Growth version

**10.** $\tilde{\gamma} = \gamma/(1-\alpha) = 0.02/(2/3) = 0.03$. Long run: $\tilde{k}$: 0; $k$: 3%; $K$: 3% + 1% = 4%; $y$: 3%; $Y$: 4%. Rule: per effective worker 0, per worker $\tilde{\gamma}$, aggregate $\tilde{\gamma} + \eta$.

**11.** Break-even rate $= 0.05 + 0.01 + 0.03 = 0.09$. $\bar{k} = (0.2/0.09)^{1.5} = 3.31$; $\tilde{y} = 3.31^{1/3} = 1.49$. MPK $= \alpha \times 0.09/s = (1/3)(0.09)/0.2 = 0.15 > 0.09$ — above break-even, so saving more would raise steady-state consumption ($s = 0.2 < \alpha$).

**12. (b).** Lower $\tilde{\gamma}$ makes the break-even line flatter, so $\bar{k}$ **rises**; but per-worker growth equals $\tilde{\gamma}$ in the long run, so it **falls**. A growth effect.

**13.** $\ln\tilde{k}$: flat, then declines smoothly to a lower flat level. $\ln\tilde{A}$: a straight line with slope $\tilde{\gamma}$, unchanged. $\ln k$ = their sum: a line of slope $\tilde{\gamma}$, then a stretch of slower growth while $\tilde{k}$ falls, ending on a **parallel but lower** line. A **level effect** — long-run growth is still $\tilde{\gamma}$.

**14.** With growing technology and population, capital per worker grows forever, so there is no constant value to solve for — no steady state. Dividing by effective workers $\tilde{A}L$ (stationarizing) creates a variable, $\tilde{k}$, that does settle down, so we can find its steady state and then read growth rates back out.

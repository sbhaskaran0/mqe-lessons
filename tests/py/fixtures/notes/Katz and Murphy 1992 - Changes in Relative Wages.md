---
type: paper
summary: 'Relative supply and demand explain US relative wages 1963–87: college supply grew steadily, so the 1980s rise in the college premium means demand for skill grew faster — a smooth trend in a two-group CES model fits remarkably well.'
authors:
- Lawrence F. Katz
- Kevin M. Murphy
year: 1992
title: 'Changes in Relative Wages, 1963–1987: Supply and Demand Factors'
venue: Quarterly Journal of Economics 107(1), 35–78
aliases:
- Katz and Murphy (1992)
- Katz-Murphy
domain:
- labor
- inequality
lessons:
- '[[Econ 424 L2 Between-Group Inequality]]'
courses:
- Econ 424
---
# Katz and Murphy (1992) — Changes in Relative Wages

## Key takeaways

1. **Prices need both blades of the scissors.** The college premium is the relative price of skilled labor, so its movements must be read against relative supply. College supply grew in every decade; a rising premium therefore requires relative *demand* to have grown faster.
2. **A smooth demand trend plus supply fluctuations explains the data.** In a two-group CES model, a steady trend in relative demand plus the observed path of relative supply reproduces the fall of the premium in the 1970s (baby-boom college graduates flooding the market) and its sharp rise in the 1980s (supply growth slowing).
3. **The elasticity of substitution is finite and above one.** The slope of the relative wage on relative supply identifies $-1/\sigma$; the paper's estimate is $\sigma \approx 1.4$ with relative demand for college labor growing about 3.3% a year (beyond the lecture).
4. **This became "the canonical model"** — the race between education and technology (after Tinbergen, 1974) — the benchmark every later study of the skill premium starts from.

## Research question

Why did US relative wages by education, experience and sex change so much between 1963 and 1987 — falling for college graduates in the 1970s and rising steeply in the 1980s — and how much is supply versus demand?

## Data and setting

March CPS earnings, 1963–1987, organized into education–experience–sex cells, with [[Composition Adjustment|composition-adjusted]] relative wages and relative supplies measured in [[Efficiency Units of Labor|efficiency units]] ([[Current Population Survey (CPS)]]).

## Empirical strategy

Assume college and non-college labor are combined in a [[CES Production Function]]. Then the log relative wage is linear in log relative supply and log relative technology:

$$\log\frac{w_{Ht}}{w_{Lt}} = \gamma_0 + \gamma_1 t - \frac{1}{\sigma}\log\frac{H_t}{L_t} + \epsilon_t$$

The unobserved relative technology term is replaced by a linear time trend, so the slope is identified from **deviations of relative supply from trend** — see [[Canonical Model of the Skill Premium]] and [[Frisch-Waugh-Lovell Theorem]].

## Results

The lecture replicates the exercise on 1963–2017 data rather than reporting the paper's own table.

![[US college skill premium 1963-2017.png]]

![[US relative college supply 1963-2017.png]]

The premium falls until about 1980 and then climbs by roughly 0.3 log points, while relative supply rises almost without a break — so demand must have outrun supply ([[US Skill Premium Since 1963]], [[US Relative Skill Supply Since 1963]]).

![[Relative supply and demand shift raising the skill premium.png]]

![[Table - Canonical model estimates of the skill premium 1963-2017.png]]

| Estimate (1963–2017, lecture) | Trend (× 100 per year) | Slope on log relative supply | Implied $\sigma$ |
| --- | --- | --- | --- |
| OLS | 1.78 (0.11) | −0.44 (0.04) | 2.28 |
| 2SLS (instrument: relative population of college to non-college) | 1.64 (0.11) | −0.39 (0.04) | 2.58 |

![[Canonical model fit of the skill premium 1963-2017.png]]

![[Canonical model fit of the detrended skill premium.png]]

![[Detrended relative supply vs detrended skill premium.png]]

The detrended series move almost as mirror images: when relative supply runs above trend (the 1970s), the premium runs below trend. That is the variation that pins down $\sigma$ ([[Elasticity of Substitution Between College and Non-College Labor]]).

## Caveats

- **Identification**: requires deviations from trend in relative supply to be unrelated to deviations from trend in relative demand. Education choices may respond to expected premia, which is why the lecture also reports 2SLS.
- **The linear trend is an assumption.** On longer samples the fitted premium runs above the actual one after about 2010 in the lecture's figure, consistent with a slowdown in demand growth (beyond the lecture: later work finds the trend break around 1990).
- **Estimates of $\sigma$ depend on the period**: about 1.4 on 1963–87 versus 2.3–2.6 on 1963–2017 in the lecture.
- **Two groups cannot explain polarization** — the rise of the top relative to the middle while the bottom keeps up — which motivated task-based models ([[Acemoglu and Autor 2011 - Skills, Tasks and Technologies]]).

## In [[Econ 424 L2 Between-Group Inequality]]

This is the "canonical model (Tinbergen, 1974; Katz and Murphy, 1992)" that structures the whole lecture. The argument runs: build a composition-adjusted premium; note that supply rose while the premium rose; conclude that demand must have shifted out; then formalize it with CES and estimate. The lecture's own estimates use the full 1963–2017 sample — know these numbers ($\sigma \approx 2.3$–$2.6$, demand trend ≈ 1.6–1.8% a year), and be able to explain why including a trend changes the identifying assumption.

## Links

- [[Canonical Model of the Skill Premium]] · [[CES Production Function]] · [[Elasticity of Substitution]] · [[Relative Supply and Demand]] · [[Skill Premium]] · [[Factor-Augmenting Technology]] · [[Instrumental Variables and 2SLS]]

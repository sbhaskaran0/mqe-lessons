---
type: lecture
course: Fixture
lecture: L9
---
# Chunker Edge Cases

**A bold lead paragraph before any section.**

## In plain English

This section is always exactly one step, however long it runs. It explains the idea without any symbols at all, using an everyday example about a bathtub: water flows in through the tap and drains out through the plughole, and the level settles where the two flows match. Everything after this sentence is filler to push the section well past the usual step length so that the test can prove the section is never split into more than one step, no matter how many words it holds, because the intuition is meant to be read as a single unit before anything else appears on the screen for the reader to study and think about.

**Why it matters:** The intuition comes first and stays whole.

## Definition

The lead-in ends with a colon:

$$y = Ak^{\alpha}$$

where $y$ is output and $k$ is capital per worker.

## Notation

Prose above the table goes to the notation drawer.

| Symbol | Meaning | Type | Typical value |
| --- | --- | --- | --- |
| $y$ | Output per worker | Endogenous | — |
| $k$ | Capital per worker | State variable | — |
| $\alpha$ | Capital share | Parameter | 1/3 |
| $sf(k)$ | Investment per worker | Function | — |

## Visuals

Text that introduces the first figure and mentions $k$.

![[First figure.png]]

*Caption for the first figure.*

Text that introduces the second figure, mentioning $sf(k)$.

![[Second figure.png]]

Text after the second figure that closes the run.

%% a private comment that must never reach the player %%

%% step %%

After a manual break.

```interactive
widget: Chunker Widget
state: {s: 0.4}
lock: [A]
show: [saving]
prompt: Raise $s$ and watch the [[Solow Diagram]].
```

Words after the widget.

> [!check]- Which option is right?
> - [ ] Wrong
> - [x] Right
>
> **Why:** Because it is.

> [!check]- What is 2/3 to two decimals?
> answer: 2/3 ± 0.005
>
> **Why:** $2/3 \approx 0.67$.

### A subheading

Text under the subheading.

## Long list

The items follow:

- **One.** The first item carries enough words to matter for the step budget, so the list as a whole runs far past it and has to be cut between items. It keeps going with another clause, adding words for no reason other than length.
- **Two.** The second item also carries a good number of words, describing nothing in particular at considerable length for the purposes of the test. It keeps going with another clause, adding words for no reason other than length.
- **Three.** The third item is here to push the list well beyond one step, with yet more words that mean nothing but count toward the total. It keeps going with another clause, adding words for no reason other than length.
- **Four.** The fourth item closes the list with a final run of words, long enough that the last item lands in a later step than the first. It keeps going with another clause, adding words for no reason other than length.

## Quotes and callouts

> [!quote] Paper summary: [[Katz and Murphy 1992 - Changes in Relative Wages]] · [[Not A Paper]]

> A plain blockquote.

> [!note]- A folded note
> Folded body with a link to [[Solow Growth Model|the Solow model]].

Next: [[Somewhere]] · Course: [[Somewhere Else]]

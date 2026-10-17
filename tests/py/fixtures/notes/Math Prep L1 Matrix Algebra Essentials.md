---
type: lecture
summary: "The matrix rules every regression derivation uses: order and reversal rules, when an inverse exists, block (partitioned) inverses, and the trace tricks behind degrees of freedom."
course: Math Prep
lecture: L1
title: Matrix Algebra Essentials
source: Refresher authored for the vault (no lecture source)
---

# Math Prep L1 — Matrix Algebra Essentials

**Four tools carry almost all of the matrix algebra in econometrics: the reversal rules for transposes and inverses, the conditions for an inverse to exist, the partitioned inverse, and the trace. With them you can read $\mathbf{b} = (\mathbf{X}'\mathbf{X})^{-1}\mathbf{X}'\mathbf{y}$, $\mathrm{Var}(\mathbf{b}) = \sigma^2(\mathbf{X}'\mathbf{X})^{-1}$ and $E[\mathbf{e}'\mathbf{e}] = (n-K)\sigma^2$ line by line.**

## 1. Order matters, and products reverse

[[Matrix Algebra Identities]]: $(AB)' = B'A'$ and $(AB)^{-1} = B^{-1}A^{-1}$. These are why $X'X$ is symmetric and why its inverse is too. Write dimensions under every term — it catches most mistakes.

## 2. When does an inverse exist?

[[Invertibility and Determinants]]: for a square matrix, a nonzero determinant, full rank, independent columns and no zero eigenvalue are all the same condition. In regression the square matrix is $\mathbf{X}'\mathbf{X}$, invertible exactly when the regressors are not linearly dependent — the identification condition in [[Econ 430 L1 Simple Linear Regression]].

## 3. Working in blocks

[[Partitioned Matrices]]: split $\mathbf{X} = [\mathbf{X}_1\ \mathbf{X}_2]$ and the partitioned inverse hands you $(\mathbf{X}_2'\mathbf{M}_1\mathbf{X}_2)^{-1}$ — the algebra of the [[Frisch-Waugh-Lovell Theorem]], which is how [[Econ 424 L2 Between-Group Inequality]] justifies detrending.

## 4. The trace

[[Trace of a Matrix]]: the cyclic property turns a scalar quadratic form into a trace, so $E[\boldsymbol{\varepsilon}'\mathbf{M}\boldsymbol{\varepsilon}] = \sigma^2\mathrm{tr}(\mathbf{M})$. For an idempotent matrix trace equals rank, which is where $N - K$ in $\widehat{\sigma}^2$ comes from ([[Sampling Distribution of OLS]]).

## Self-check

> [!question]- 1. Invert $\begin{pmatrix}1&2\\3&4\end{pmatrix}$.
> $\frac{1}{-2}\begin{pmatrix}4&-2\\-3&1\end{pmatrix} = \begin{pmatrix}-2&1\\1.5&-0.5\end{pmatrix}$. → [[Matrix Algebra Identities]]

> [!question]- 2. Is $\begin{pmatrix}2&1\\4&2\end{pmatrix}$ invertible?
> No: the determinant is $4 - 4 = 0$; the second column is half the first. → [[Invertibility and Determinants]]

> [!question]- 3. Simplify $\big((X'X)^{-1}X'\big)'$.
> $X(X'X)^{-1}$, using $(AB)' = B'A'$ and the symmetry of $(X'X)^{-1}$. → [[Matrix Algebra Identities]]

> [!question]- 4. $\mathbf{P}$ is a $5\times5$ projection onto a 2-dimensional subspace. What is $\mathrm{tr}(\mathbf{I} - \mathbf{P})$?
> $5 - 2 = 3$: trace is linear, and for an idempotent matrix trace equals rank. → [[Trace of a Matrix]]

> [!question]- 5. True or false: $\mathrm{tr}(ABC) = \mathrm{tr}(ACB)$.
> False in general. The trace is cyclic, $\mathrm{tr}(ABC) = \mathrm{tr}(BCA) = \mathrm{tr}(CAB)$, but you cannot swap two factors. → [[Trace of a Matrix]]

## What to be able to do

1. Transpose and invert products without reversing the order wrongly.
2. State the equivalent conditions for invertibility, and connect them to identification.
3. Use the partitioned inverse to get the block of $(\mathbf{X}'\mathbf{X})^{-1}$ for a subset of regressors.
4. Use the cyclic trace property to compute $E[\boldsymbol{\varepsilon}'\mathbf{M}\boldsymbol{\varepsilon}]$.

## Concepts in this lecture

[[Matrix Algebra Identities]] · [[Invertibility and Determinants]] · [[Partitioned Matrices]] · [[Trace of a Matrix]]

## Facts and data in this lecture

None.

Next: [[Math Prep L2 Vector Spaces Rank and Projection]] · Course: [[Math Prep]]

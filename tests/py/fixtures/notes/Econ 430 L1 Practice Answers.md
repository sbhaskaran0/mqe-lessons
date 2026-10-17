---
type: practice
course: Econ 430
lecture: L1
---
# L1 Practice Answers

Answers to [[Econ 430 L1 Practice Questions]].

## A. Derivations

**1.** $\partial SSR/\partial b_1 = -2\sum(y_i - b_1 - b_2x_i) = 0$ gives $\sum\hat{e}_i = 0$. $\partial SSR/\partial b_2 = -2\sum x_i(y_i - b_1 - b_2x_i) = 0$ gives $\sum x_i\hat{e}_i = 0$. The first yields $N\bar{y} = Nb_1 + b_2\sum x_i$, hence $b_1 = \bar{y} - b_2\bar{x}$. Substituting into the second and collecting in deviation form gives $\sum(x_i-\bar{x})(y_i-\bar{y}) = b_2\sum(x_i-\bar{x})^2$. The two conditions: residuals sum to zero, and residuals are orthogonal to $x$.

**2.** With $\sum w_i = 0$ and $\sum w_i x_i = 1$, substituting $y_i = \beta_1 + \beta_2 x_i + e_i$ gives $b_2 = \beta_2 + \sum w_i e_i$. Then $E[b_2\mid x] = \beta_2 + \sum w_i E[e_i\mid x] = \beta_2$ by **SR2**. For the variance: **SR4** kills the cross terms, **SR3** replaces $\mathrm{Var}(e_i\mid x)$ with $\sigma^2$, giving $\sigma^2\sum w_i^2 = \sigma^2/\sum(x_i-\bar{x})^2$. Unbiasedness used **only SR2** — SR3 and SR4 enter only for the variance.

**3.** $\mathbf{e}'\mathbf{e} = \mathbf{y}'\mathbf{y} - 2\mathbf{b}'\mathbf{X}'\mathbf{y} + \mathbf{b}'\mathbf{X}'\mathbf{X}\mathbf{b}$. Differentiating: $-2\mathbf{X}'\mathbf{y} + 2\mathbf{X}'\mathbf{X}\mathbf{b} = \mathbf{0}$, so $\mathbf{b} = (\mathbf{X}'\mathbf{X})^{-1}\mathbf{X}'\mathbf{y}$. Dimensions: $\mathbf{X}'\mathbf{X}$ is $K\times K$, $\mathbf{X}'\mathbf{y}$ is $K\times1$; derivative of a $1\times1$ w.r.t. $K\times1$ is $K\times1$. The inverse exists iff $\mathbf{X}$ has full column rank $K$, requiring $N\geq K$ and no linear dependence. SOC: $\mathbf{X}'\mathbf{X}$ positive definite, so the critical point is the unique minimum.

**4.** Symmetry: $(\mathbf{X}'\mathbf{X})^{-1}$ is symmetric, so $\mathbf{M}' = \mathbf{M}$. Idempotency: $\mathbf{P}\mathbf{P} = \mathbf{X}(\mathbf{X}'\mathbf{X})^{-1}\mathbf{X}'\mathbf{X}(\mathbf{X}'\mathbf{X})^{-1}\mathbf{X}' = \mathbf{P}$, so $\mathbf{M}\mathbf{M} = \mathbf{I} - 2\mathbf{P} + \mathbf{P} = \mathbf{M}$. Annihilation: $\mathbf{M}\mathbf{X} = \mathbf{X} - \mathbf{X}(\mathbf{X}'\mathbf{X})^{-1}\mathbf{X}'\mathbf{X} = \mathbf{0}$. Hence $\mathbf{M}\mathbf{y} = \mathbf{M}\mathbf{X}\boldsymbol{\beta} + \mathbf{M}\boldsymbol{\varepsilon} = \mathbf{M}\boldsymbol{\varepsilon}$.

**5.** $f = (\beta_1 + \beta_2 x_0 + e_0) - (b_1 + b_2 x_0)$. Since $e_0$ is independent of the sample, $\mathrm{Var}(f) = \mathrm{Var}(e_0) + \mathrm{Var}(b_1 + b_2x_0)$, and the second term collapses to $\sigma^2[1/N + (x_0-\bar{x})^2/\sum(x_i-\bar{x})^2]$. The **1** is the new observation's own error; the **1/N** is uncertainty about the level of the line; the **$(x_0-\bar{x})^2$** term is uncertainty about the slope, which costs more the further from $\bar{x}$.

**6.** Take $\mathrm{Cov}(x,\cdot)$ through: $\mathrm{Cov}(x,y) = 0 + \beta\mathrm{Var}(x) + 0$. Take expectations: $E[y] = \alpha + \beta E[x]$.

**7.** With $x_i\in\{0,1\}$, $\bar{x} = n_1/n$. The denominator of $b_2$ is $n_1n_0/n$; the numerator simplifies to $(n_1n_0/n)(\bar{y}_1 - \bar{y}_0)$. So $b_2 = \bar{y}_1 - \bar{y}_0$ and $b_1 = \bar{y} - b_2\bar{x} = \bar{y}_0$.

## B. Short conceptual

**8.** (a) **Unaffected** — unbiasedness needs only SR2. (b) The usual formula is **wrong**, so $t$ stats, $p$ values and intervals are invalid; use White robust SEs. (c) **No longer BLUE** — GLS/WLS is efficient. (d) Consistency unaffected. → [[Homoskedasticity]]

**9.** The two normal equations impose two exact linear restrictions on the $N$ residuals, so only $N-2$ are free. In matrix terms $\mathbf{e} = \mathbf{M}\boldsymbol{\varepsilon}$ and $E[\mathbf{e}'\mathbf{e}] = \sigma^2\mathrm{trace}(\mathbf{M}) = \sigma^2(N-K)$; dividing by $N-K$ gives unbiasedness. Dividing by $N$ would understate $\sigma^2$.

**10.** $R^2$ measures the fraction of variation in the **dependent variable** explained, and the two models have different dependent variables ($\ln y$ vs $y$). The total sums of squares are not comparable, so the comparison is meaningless. Compare on predictive error (CV RMSE after back-transforming to common units), on residual diagnostics, or on theoretical grounds.

**11.** The CI covers $E[y\mid x_0]$, a fixed quantity whose only uncertainty is in estimating $\beta_1,\beta_2$; as $N$ grows those are pinned down and the interval collapses. The PI must also cover $e_0$, whose variance $\sigma^2$ does not depend on $N$. The PI half-width tends to $t\cdot\sigma$, not zero.

**12.** **Incorrect.** Any bivariate distribution admits $y = \alpha + \beta x + \varepsilon$ with $\mathrm{Cov}(x,\varepsilon) = 0$, where $\alpha,\beta$ are the linear projection coefficients — this holds whether or not $E[y\mid x]$ is linear. What linearity of $E[y\mid x]$ buys is that the projection *coincides* with the conditional mean. The stronger condition $E[\varepsilon\mid x] = 0$ is what the regression model assumes, and that **is** equivalent to $E[y\mid x]$ being linear. → [[Conditional Mean vs Linear Projection]]

**13.** The cut-off is $2p/n = 4/50 = 0.08$, so $h_i = 0.4$ is **very** high leverage. But $|t_i| = 0.3$ is well inside 2, so the point is fitted well. It is **not influential**: far from $\bar{x}$ but on the line. Worth reporting — it has the power to become influential — but it is not distorting the current estimates. → [[Regression Diagnostics]]

**14.** Two restrictions tested jointly: $S = 0$ and $K - 3 = 0$. $H_0$ is **normality**. $p = 0.002$ **rejects** normality, so exact small-sample $t$ and $F$ inference is unreliable; with large $N$ the CLT still justifies asymptotic inference, with small $N$ bootstrap.

**15.** CV estimates **out-of-sample prediction error** by holding data back. The bootstrap estimates the **sampling distribution of an estimator** by resampling the data you have. The bootstrap cannot detect overfitting because every resample comes from the same data the model was fitted on — no held-out information. Complements, not substitutes.

**16.** With all $k$ dummies plus an intercept, the dummy columns sum exactly to the column of ones, so the columns of $\mathbf{X}$ are linearly dependent, $\mathbf{X}'\mathbf{X}$ is singular, and the inverse does not exist — infinitely many $\mathbf{b}$ give the same fit. Precisely the failure of full rank: there exists $\boldsymbol{\delta}\neq\mathbf{0}$ with $\mathbf{X}\boldsymbol{\delta} = \mathbf{0}$. Fix: drop one dummy, which becomes the reference group. → [[Full Rank and Identification]]

## C. Interpretation

**17.** Log-linear. Roughly $100\times0.094 = $ **9.4%** higher wage per extra year. Exactly $100(e^{0.094}-1) = $ **9.86%**. The approximation understates, and the gap grows with the coefficient.

**18.** Linear. Income is in \$100 units, so a \$100 rise in weekly income is associated with a **\$10.21** rise in weekly food expenditure — about 10 cents per extra dollar, matching the lecture's motivating example. Elasticity at the means: $10.21\times(19.60/283.57) = $ **0.71**. Food is a necessity: expenditure rises less than proportionately. The intercept $-\$97.19$ has no sensible interpretation — extrapolation to zero income.

**19.** Log-log, so the coefficient **is** the elasticity: **0.84**. A 10% rise in square footage → roughly 8.4% higher price; exactly $1.1^{0.84} - 1 = $ **8.34%**. Price rises less than proportionately with size.

**20.** Marginal effect $= 2(0.0154)(2000) = $ **\$61.60 per additional square foot** at $sqft = 2000$. Elasticity $= 61.6\times(2000/117{,}462) = $ **1.05**. No single slope exists because the model is nonlinear in $sqft$ — the marginal effect is a linear function of $sqft$, so at $sqft = 4000$ it would be \$123.20.

**21.** Reference group is men: mean male wage $= b_1 = $ **\$21.03/hour**; mean female wage $= 21.03 - 4.29 = $ **\$16.74/hour**. The $t$ test tests $H_0$: the two population means are equal — algebraically identical to a pooled-variance two-sample $t$ test. This is a **raw gap** with no controls, so not an estimate of discrimination. → [[Indicator Variables]]

**22.** $\hat\lambda = 0.0013$ is statistically indistinguishable from 0 ($p = 0.78$ fails to reject), so **use the log**. Two reasons: the log is interpretable as a proportional change, and rounding to a natural value avoids overfitting the transformation to sample noise. → [[Box-Cox and Power Transformations]]

## D. Harder

**23.** Let $\tilde\beta_2 = \sum a_i y_i$. Unbiasedness for all $\beta_1,\beta_2$ requires $\sum a_i = 0$ and $\sum a_i x_i = 1$ — exactly the conditions the OLS weights satisfy. Write $a_i = w_i + d_i$; the restrictions force $\sum d_i = 0$ and $\sum d_i x_i = 0$, hence $\sum w_i d_i = 0$. Then $\mathrm{Var}(\tilde\beta_2) = \sigma^2\sum a_i^2 = \mathrm{Var}(b_2) + \sigma^2\sum d_i^2 \geq \mathrm{Var}(b_2)$, equality only if all $d_i = 0$. **Homoskedasticity enters at $\mathrm{Var}(\sum a_i y_i) = \sigma^2\sum a_i^2$** — without it you get $\sum a_i^2\sigma_i^2$ and the OLS weights are not optimal. Normality is never used: first and second moments only. → [[Gauss-Markov Theorem]]

**24.** $\mathbf{M}$ is idempotent and symmetric, so rank = trace. $\mathrm{trace}(\mathbf{M}) = n - \mathrm{trace}((\mathbf{X}'\mathbf{X})^{-1}\mathbf{X}'\mathbf{X}) = n - K$, using $\mathrm{trace}(\mathbf{AB}) = \mathrm{trace}(\mathbf{BA})$. Then $E[\mathbf{e}'\mathbf{e}] = E[\boldsymbol{\varepsilon}'\mathbf{M}\boldsymbol{\varepsilon}] = \sigma^2\mathrm{trace}(\mathbf{M}) = \sigma^2(n-K)$, so dividing by $n-K$ gives $E[\widehat{\sigma}^2] = \sigma^2$. → [[Projection Matrix and Residual Maker]]

**25.** The omitted $x^2$ is absorbed into $v = \beta_3 x^2 + e$, and since $E[x^2\mid x]\neq0$, **SR2 fails**: $E[v\mid x]\neq0$ and $\mathrm{Cov}(x,v)\neq0$. OLS therefore estimates the **linear projection** of $y$ on $x$, not $\beta_2$ — biased by $\beta_3\,\mathrm{Cov}(x,x^2)/\mathrm{Var}(x)$, the classic omitted-variable bias formula. The residual-vs-fitted plot shows systematic **curvature** (U or inverted-U), and a LOWESS smoother would diverge from the OLS line. Fix: add $x^2$, or transform. → [[Strict Exogeneity]]

**26.** With $N = 30$, normality is rejected and $N$ is too small to lean on the CLT, so exact $t$-based intervals are untrustworthy. **Report the bootstrap**: percentile or bias-corrected intervals for $b_2$, plus bootstrap standard errors, and say so explicitly. The visible skew is itself evidence against the symmetric $t$ interval. Also check whether a Box-Cox transformation of $y$ makes the residuals better behaved — that would be the preferable fix rather than a patch on inference. → [[Bootstrapping OLS]]

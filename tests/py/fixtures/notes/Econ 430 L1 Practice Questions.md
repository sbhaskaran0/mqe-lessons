---
type: practice
course: Econ 430
lecture: L1
---
# L1 Practice Questions

26 questions on [[Econ 430 L1 Simple Linear Regression]]. Attempt closed-book, then check [[Econ 430 L1 Practice Answers]].

## A. Derivations

1. Starting from $SSR = \sum(y_i - b_1 - b_2 x_i)^2$, derive both normal equations and solve for $b_1$ and $b_2$. State the two orthogonality conditions your FOCs imply. → [[OLS Estimator]]
2. Show that $b_2 = \beta_2 + \sum w_i e_i$ with $w_i = (x_i-\bar{x})/\sum(x_i-\bar{x})^2$, and use it to prove $E[b_2\mid x] = \beta_2$ and $\mathrm{Var}(b_2\mid x) = \sigma^2/\sum(x_i-\bar{x})^2$. State which assumption each step uses.
3. Derive $\mathbf{b} = (\mathbf{X}'\mathbf{X})^{-1}\mathbf{X}'\mathbf{y}$ from $\mathbf{e}'\mathbf{e}$. Verify dimensions at each step and state the condition under which the inverse exists. → [[OLS in Matrix Form]]
4. Prove that $\mathbf{M} = \mathbf{I} - \mathbf{X}(\mathbf{X}'\mathbf{X})^{-1}\mathbf{X}'$ is symmetric and idempotent, and that $\mathbf{M}\mathbf{X} = \mathbf{0}$. Then show $\mathbf{M}\mathbf{y} = \mathbf{M}\boldsymbol{\varepsilon}$. → [[Projection Matrix and Residual Maker]]
5. Show $\mathrm{Var}(f) = \sigma^2[1 + 1/N + (x_0-\bar{x})^2/\sum(x_i-\bar{x})^2]$ for the forecast error. Identify which term comes from which source of uncertainty. → [[Confidence vs Prediction Intervals]]
6. Starting from $y = \alpha + \beta x + \varepsilon$ with $\mathrm{Cov}(x,\varepsilon) = 0$, derive $\beta = \mathrm{Cov}(x,y)/\mathrm{Var}(x)$ and $\alpha = E[y] - \beta E[x]$. → [[Conditional Mean vs Linear Projection]]
7. Show that when $x$ is a binary indicator, $b_1 = \bar{y}_0$ and $b_2 = \bar{y}_1 - \bar{y}_0$. → [[Indicator Variables]]

## B. Short conceptual

8. Heteroskedasticity is present. State precisely what happens to (a) unbiasedness of $b_2$, (b) the standard error formula, (c) the BLUE property, (d) consistency.
9. Why is $\widehat{\sigma}^2$ divided by $N-2$ rather than $N$? Give the algebraic reason, not just "degrees of freedom."
10. A colleague reports the log-linear model has $R^2 = 0.61$ and the linear model $R^2 = 0.54$, and concludes the log-linear model is better. What is wrong with this?
11. Explain why the prediction interval does not shrink to zero as $N\to\infty$, while the confidence interval does.
12. A researcher writes $y = \alpha + \beta x + \varepsilon$ and claims this requires $E[y\mid x]$ to be linear in $x$. Is the claim correct?
13. An observation has leverage $h_i = 0.4$ with $n = 50$ and $p = 2$, but a studentised residual of 0.3. Is it a problem?
14. Why does the Jarque-Bera statistic have 2 degrees of freedom? What is the null, and what does $p = 0.002$ tell you?
15. Distinguish what cross-validation and the bootstrap are each used for. Why can't the bootstrap tell you whether your model overfits?
16. The dummy variable trap: state what goes wrong in terms of $\mathbf{X}'\mathbf{X}$, and connect it to the full-rank assumption.

## C. Interpretation

17. Estimated: $\ln(wage) = 1.62 + 0.094\,educ$. Interpret the slope. Give both the approximate and the exact percentage effect of one more year of education.
18. Estimated: $food\_exp = -97.19 + 10.21\,income$, with mean income 19.60 and mean food_exp 283.57 (income in \$100/week, expenditure in \$/week). Interpret the slope and compute the elasticity at the means.
19. Estimated: $\ln(price) = 4.17 + 0.84\ln(sqft)$. What is the elasticity? If square footage rises 10%, what happens to price?
20. Estimated: $price = \alpha_1 + \alpha_2\,sqft^2$ with $\hat\alpha_2 = 0.0154$. Compute the marginal effect and elasticity at $sqft = 2000$, predicted price 117,462. Why can you not report a single slope?
21. Estimated: $wage = 21.03 - 4.29\,female$. State the mean wage for men, the mean for women, and what the $t$ test on the female coefficient is testing.
22. A Box-Cox procedure returns $\hat\lambda = 0.0013$ with an LR test of $H_0: \lambda = 0$ giving $p = 0.78$. What do you do and why?

## D. Harder / synthesis

23. Prove the Gauss-Markov theorem for $b_2$ in the simple regression case. Where exactly does homoskedasticity enter, and where does normality fail to be needed?
24. Explain why $\mathrm{trace}(\mathbf{M}) = n - K$, and show how this delivers $E[\widehat{\sigma}^2] = \sigma^2$.
25. Suppose the true model is $y = \beta_1 + \beta_2 x + \beta_3 x^2 + e$ but you estimate $y = \gamma_1 + \gamma_2 x + v$. What does OLS estimate? Which assumption is violated, and what does the residual-vs-fitted plot look like?
26. You have $N = 30$, residuals failing Jarque-Bera at $p = 0.001$, and a bootstrap distribution of $b_2$ that is visibly skewed. Which inference would you report, and why?

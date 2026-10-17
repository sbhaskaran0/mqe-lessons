// The three E0 derivations, written in the proposed `[!derive]-` grammar, with the forms the checker must accept
// (and where each should land on the path) and the common errors it must reject.
import { calloutToIR, type DeriveBlockIR, type DeriveCallout, parseDeriveCallout } from "../../src/derive";

export type Expect = "target" | `milestone ${number}` | "valid-no-progress";

export interface Fixture {
  name: string;
  /** The callout as written in the vault, its IR (as the exporter would emit it) and the parsed derivation. */
  markdown: string;
  ir: DeriveBlockIR;
  callout: DeriveCallout;
  /** Forms that must be accepted, with the verdict each should get from the start of the derivation. */
  accept: [string, Expect][];
  /** Forms that must be rejected; a number is the index of the reject: line whose message must be shown. */
  reject: [string, number?][];
  /** The true solution, assigned in order, for the mutation sweep's ground truth. */
  solution: [key: string, step: number, side: "l" | "r"][];
  /** Correct forms the mutation sweep perturbs (~200 mutants in total). */
  mutate: string[];
}

function fromMarkdown(markdown: string): Pick<Fixture, "markdown" | "ir" | "callout"> {
  return { markdown, ir: calloutToIR(markdown), callout: parseDeriveCallout(markdown) };
}

export const solow: Fixture = {
  name: "Solow steady state",
  ...fromMarkdown(String.raw`> [!derive]- Solve for the steady state $\bar{k}$
> objective: 4
> symbols: $s \in (0.05, 0.95)$, $A$, $\alpha \in (0.2, 0.8)$, $\delta \in (0.02, 0.2)$, $k_t$, $k_{t+1}$
> unknowns: $\bar{k}$
> given: $k_{t+1} = sAk_t^{\alpha} + (1-\delta)k_t$
>
> 1. Set $k_{t+1} = k_t = \bar{k}$: $\bar{k} = sA\bar{k}^{\alpha} + (1-\delta)\bar{k}$
> 2. Cancel $(1-\delta)\bar{k}$: $sA\bar{k}^{\alpha} = \delta\bar{k}$
> 3. Divide by $\delta\bar{k}^{\alpha}$, then take the $1/(1-\alpha)$ power: $\bar{k} = \left(\frac{sA}{\delta}\right)^{\frac{1}{1-\alpha}}$
>
> accept: $\bar{k}^{1-\alpha} = \frac{sA}{\delta}$
> reject: $\bar{k} = (sA/\delta)^{1/\alpha}$ — dividing by $\bar{k}^{\alpha}$ leaves $\bar{k}^{1-\alpha}$, so the power is $1/(1-\alpha)$
> reject: $\bar{k} = (s/\delta)^{1/(1-\alpha)}$ — productivity $A$ has dropped out
> reject: $sA\bar{k}^{\alpha} = (1-\delta)\bar{k}$ — subtract $(1-\delta)\bar{k}$ from both sides: $\bar{k} - (1-\delta)\bar{k} = \delta\bar{k}$
> reject: $\bar{k} = \left(\frac{\delta}{sA}\right)^{\frac{1}{1-\alpha}}$ — the fraction is upside down
> reject: $\bar{k} = (sA/\delta)^{1-\alpha}$ — to undo a power of $1-\alpha$, raise to $1/(1-\alpha)$`),
  accept: [
    ["kbar = (s A/delta)^(1/(1-alpha))", "target"],
    ["kbar = (sA/δ)^(1/(1−α))", "target"],
    [String.raw`\bar{k} = \left(\frac{sA}{\delta}\right)^{\frac{1}{1-\alpha}}`, "target"],
    ["k̄ = (δ/(sA))^(1/(α−1))", "target"],
    ["kbar = (sA)^(1/(1-alpha)) / delta^(1/(1-alpha))", "target"],
    ["kbar = exp((ln(s) + ln(A) - ln(delta))/(1-alpha))", "target"],
    ["(s*A/delta)^(1/(1-alpha)) = kbar", "target"],
    ["kbar = (s A delta^-1)^(1/(1-alpha))", "target"],
    ["kbar = sqrt(sA/δ)^(2/(1-α))", "target"],
    [String.raw`\bar k = \exp\left(\frac{\ln(sA/\delta)}{1-\alpha}\right)`, "target"],
    ["kbar = (sA/delta)^(-1/(alpha-1))", "target"],
    ["(sA/delta)^(1/(1-alpha))", "target"],
    ["kbar = s^(1/(1-alpha)) A^(1/(1-alpha)) delta^(1/(alpha-1))", "target"],
    ["kbar^(1-alpha) = sA/delta", "target"],
    ["delta kbar^(1-alpha) = s A", "target"],
    ["sAkbar^alpha = delta kbar", "milestone 2"],
    ["s A kbar^alpha kbar = delta kbar^2", "milestone 2"],
    ["ln s + ln A + alpha ln kbar = ln delta + ln kbar", "milestone 2"],
    ["kbar = sAkbar^α + (1−δ)kbar", "milestone 2"],
    ["kbar^(alpha-1) = delta/(sA)", "milestone 2"],
    ["(1-alpha) ln(kbar) = ln(s A / delta)", "milestone 2"],
    ["sA/kbar^(1-alpha) = delta", "milestone 2"],
    ["k_(t+1) = s A k_t^alpha + (1-delta) k_t", "valid-no-progress"],
  ],
  reject: [
    ["kbar = (sA/delta)^(1/alpha)", 0],
    ["kbar = (s/delta)^(1/(1-alpha))", 1],
    ["s A kbar^alpha = (1-delta) kbar", 2],
    ["kbar = (delta/(s A))^(1/(1-alpha))", 3],
    ["kbar = (sA/delta)^(1-alpha)", 4],
    ["kbar^alpha = sA/delta", 0],
    ["s A kbar^alpha = delta"],
    ["kbar = sA/delta"],
    ["kbar = (sA/delta)^(1/(1+alpha))"],
    ["kbar = (sA/delta)^(1/(1-alpha)) + 1"],
    ["sAkbar^alpha = delta kbar^alpha"],
    ["kbar = s A kbar^alpha / delta + kbar"],
  ],
  solution: [["bar:k", 3, "r"]],
  mutate: ["kbar = (s A/delta)^(1/(1-alpha))"],
};

export const ols: Fixture = {
  name: "OLS FOCs to b2",
  ...fromMarkdown(String.raw`> [!derive]- From the first-order conditions to $b_2$
> objective: 5
> dims: $n$
> data: $x_i$, $y_i$
> unknowns: $b_1$ real, $b_2$ real
> given: $\sum_{i=1}^n (y_i - b_1 - b_2 x_i) = 0$
> given: $\sum_{i=1}^n x_i (y_i - b_1 - b_2 x_i) = 0$
>
> 1. Divide the first condition by $n$: $b_1 = \bar{y} - b_2\bar{x}$
> 2. Substitute into the second: $\sum_{i=1}^n x_i (y_i - \bar{y}) = b_2 \sum_{i=1}^n x_i (x_i - \bar{x})$
> 3. $b_2 = \frac{\sum_{i=1}^n (x_i - \bar{x})(y_i - \bar{y})}{\sum_{i=1}^n (x_i - \bar{x})^2}$
>
> reject: $b_2 = \frac{\sum x_i y_i}{\sum x_i^2}$ — that is the slope of a line through the origin; the model still has an intercept $b_1$
> reject: $b_2 = \frac{\sum (x_i-\bar{x})(y_i-\bar{y})}{\sum (y_i-\bar{y})^2}$ — the denominator is the spread of $x$, not $y$
> reject: $b_2 = \frac{\sum (x_i-\bar{x})(y_i-\bar{y})}{\sum (x_i-\bar{x})}$ — the denominator needs a square: $\sum (x_i - \bar{x})$ is always 0
> reject: $b_1 = \bar{y} + b_2\bar{x}$ — sign: the first condition says $\bar{y} = b_1 + b_2\bar{x}$`),
  accept: [
    ["b_2 = sum((x_i - xbar)*(y_i - ybar))/sum((x_i-xbar)^2)", "target"],
    [String.raw`b_2 = \frac{\sum_{i=1}^n (x_i - \bar{x})(y_i - \bar{y})}{\sum_{i=1}^n (x_i - \bar{x})^2}`, "target"],
    ["b_2 = (n sum(x y) - sum(x) sum(y))/(n sum(x^2) - sum(x)^2)", "target"],
    ["b_2 = (sum(x_i y_i) - n xbar ybar)/(sum(x_i^2) - n xbar^2)", "target"],
    ["b_2 = sum((x_i - xbar) y_i)/sum((x_i - xbar) x_i)", "target"],
    ["b₂ = Σ(xᵢ−x̄)(yᵢ−ȳ)/Σ(xᵢ−x̄)²", "target"],
    ["sum((x-xbar)(y-ybar))/sum((x-xbar)^2) = b_2", "target"],
    ["b_2 = sum((y_i - ybar)(x_i - xbar))/sum((xbar - x_i)^2)", "target"],
    ["b_2 = (sum(x_i y_i)/n - xbar ybar)/(sum(x_i^2)/n - xbar^2)", "target"],
    ["b_2 = sum(x_i (y_i - ybar))/sum(x_i (x_i - xbar))", "target"],
    ["b_2 = (sum(x y) - sum(x) sum(y)/n)/(sum(x^2) - sum(x)^2/n)", "target"],
    [String.raw`b_2 = \frac{n\sum x_i y_i - \sum x_i \sum y_i}{n\sum x_i^2 - \left(\sum x_i\right)^2}`, "target"],
    ["b_2 = sum(x_i y_i - xbar ybar)/sum(x_i^2 - xbar^2)", "target"],
    ["b_1 = ybar - b_2 xbar", "milestone 1"],
    ["n b_1 = sum(y) - b_2 sum(x)", "milestone 1"],
    ["ybar = b_1 + b_2 xbar", "milestone 1"],
    ["sum(y_i) = n b_1 + b_2 sum(x_i)", "milestone 1"],
    ["sum(x_i (y_i - ybar + b_2 xbar - b_2 x_i)) = 0", "milestone 2"],
    ["b_2 sum((x_i - xbar)^2) = sum((x_i-xbar)(y_i-ybar))", "milestone 2"],
  ],
  reject: [
    ["b_2 = sum(x y)/sum(x^2)", 0],
    ["b_2 = sum((x-xbar)(y-ybar))/sum((y-ybar)^2)", 1],
    ["b_2 = sum((x-xbar)(y-ybar))/sum(x - xbar)", 2],
    ["b_1 = ybar + b_2 xbar", 3],
    ["b_2 sum(x^2) = sum(x y)", 0],
    ["b_2 = (n sum(x y) + sum(x) sum(y))/(n sum(x^2) - sum(x)^2)"],
    ["b_2 = (sum(x y) - n xbar ybar)/(sum(x^2) - xbar^2)"],
    ["b_2 = (n sum(x y) - sum(x) sum(y))/(n sum(x)^2 - sum(x)^2)"],
    ["b_2 = sum((x-xbar)(y-ybar))/sum((x-xbar)^2) + ybar"],
    ["b_2 = sum((x_i-xbar)(y_i-ybar))/sum((x_i-xbar)^2)/n"],
  ],
  solution: [
    ["b_2", 3, "r"],
    ["b_1", 1, "r"],
  ],
  mutate: ["b_2 = sum((x_i - xbar)*(y_i - ybar))/sum((x_i-xbar)^2)", "b_2 = (n sum(x y) - sum(x) sum(y))/(n sum(x^2) - sum(x)^2)"],
};

const matrixHeader = String.raw`> dims: $n > K$
> matrices: $\mathbf{X}$ is $n \times K$
> define: $\mathbf{P} = \mathbf{X}(\mathbf{X}'\mathbf{X})^{-1}\mathbf{X}'$
> define: $\mathbf{M} = \mathbf{I}_n - \mathbf{P}$`;

export const residualMaker: Fixture = {
  name: "Residual maker MX = 0",
  ...fromMarkdown(String.raw`> [!derive]- Show that the residual maker annihilates $\mathbf{X}$
${matrixHeader}
> given: $\mathbf{M} = \mathbf{I}_n - \mathbf{X}(\mathbf{X}'\mathbf{X})^{-1}\mathbf{X}'$
>
> 1. Multiply out: $\mathbf{M}\mathbf{X} = \mathbf{X} - \mathbf{X}(\mathbf{X}'\mathbf{X})^{-1}\mathbf{X}'\mathbf{X}$
> 2. $(\mathbf{X}'\mathbf{X})^{-1}\mathbf{X}'\mathbf{X} = \mathbf{I}_K$, so $\mathbf{M}\mathbf{X} = \mathbf{0}$
>
> reject: $\mathbf{M} = \mathbf{I} - \mathbf{X}'(\mathbf{X}\mathbf{X}')^{-1}\mathbf{X}$ — the transposes are swapped: $\mathbf{X}\mathbf{X}'$ is $n \times n$ with rank $K$, so it has no inverse
> reject: $\mathbf{M}\mathbf{X} = \mathbf{X}$ — that is $\mathbf{I}\mathbf{X}$ alone; the projection part removes all of $\mathbf{X}$
> reject: $\mathbf{M} = \mathbf{0}$ — $\mathbf{M}\mathbf{X} = \mathbf{0}$ doesn't make $\mathbf{M}$ zero: it still keeps everything orthogonal to the columns of $\mathbf{X}$`),
  accept: [
    ["M X = 0", "target"],
    ["MX = 0", "target"],
    ["PX = X", "target"],
    ["X = PX", "target"],
    ["(I - X(X'X)^{-1}X')X = 0", "target"],
    ["X - PX = 0", "target"],
    [String.raw`\mathbf{M}\mathbf{X} = \mathbf{0}`, "target"],
    ["X'M = 0", "target"],
    ["M'X = 0", "target"],
    ["(I_n - P) X = 0", "target"],
    ["2MX = 0", "target"],
    ["X - X(X'X)^{-1}X'X = 0", "target"],
    ["X(X'X)^(-1)X'X = X", "target"],
    ["X^T M = 0", "target"],
    ["MX = X - X", "target"],
    ["MX = X - PX", "milestone 1"],
    ["MX = X - X(X'X)^{-1}X'X", "milestone 1"],
    ["MX = IX - PX", "milestone 1"],
    ["M = I - P", "valid-no-progress"],
    ["MM = M", "valid-no-progress"],
  ],
  reject: [
    ["M = I - X'(XX')^{-1}X", 0],
    ["MX = X", 1],
    ["M = 0", 2],
    // PX = 0 says the same as MX = X (PX = X − MX), so it gets that line's message.
    ["PX = 0", 1],
    ["X = MX", 1],
    ["XM = 0"],
    ["M = I - X(X'X)X'"],
    ["MX = -X"],
    ["PX = -X"],
    ["X'X M = 0"],
    ["MP = P"],
    ["M X = I"],
  ],
  solution: [],
  mutate: ["(I_n - X(X'X)^{-1}X')X = 0", "X(X'X)^{-1}X'X = X"],
};

export const traceM: Fixture = {
  name: "Residual maker trace(M) = n − K",
  ...fromMarkdown(String.raw`> [!derive]- The trace of the residual maker
${matrixHeader}
>
> 1. $\operatorname{tr}(\mathbf{M}) = \operatorname{tr}(\mathbf{I}_n) - \operatorname{tr}(\mathbf{X}(\mathbf{X}'\mathbf{X})^{-1}\mathbf{X}')$
> 2. Cycle the trace: $\operatorname{tr}(\mathbf{M}) = n - K$
>
> reject: $\operatorname{tr}(\mathbf{M}) = n$ — $\mathbf{M}$ removes the $K$ dimensions spanned by $\mathbf{X}$`),
  accept: [
    ["trace(M) = n - K", "target"],
    ["tr(M) = n-K", "target"],
    [String.raw`\mathrm{trace}(\mathbf{M}) = n - K`, "target"],
    ["trace(P) = K", "target"],
    ["n - trace(M) = K", "target"],
    ["trace(I_n) - trace(P) = n - K", "target"],
    ["trace(X(X'X)^{-1}X') = K", "target"],
    ["trace(M) + K = n", "target"],
    [String.raw`\operatorname{tr}(\mathbf{M}) = n - K`, "target"],
    ["trace(M) - n + K = 0", "target"],
    ["trace(M) = trace(I_n) - trace(P)", "milestone 1"],
  ],
  reject: [["trace(M) = n", 0], ["trace(M) = K"], ["trace(M) = n - K - 1"], ["trace(P) = n"], ["trace(M) = K - n"], ["trace(M) = n + K"]],
  solution: [],
  mutate: ["trace(I_n - X(X'X)^{-1}X') = n - K"],
};

export const fixtures = [solow, ols, residualMaker, traceM];

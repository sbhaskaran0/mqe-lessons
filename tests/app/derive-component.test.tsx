// @vitest-environment happy-dom
// The derivation exercise: typing lines against the real checker, the verdicts, justify questions, step-by-step and
// hints, giving up, Review mode, and that progress survives a remount. The fixture derive is the exported one from
// the fixture vault; a longer one (several milestones, hints, a justify step) is built from callout text.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { calloutToIR } from "../../src/derive";
import { createMarkdown } from "../../src/content/markdown";
import { ContentProvider, type Content } from "../../src/content/context";
import { NoteBody, type Block } from "../../src/ir";
import { Derive, stepProse } from "../../src/lesson/Derive";
import { gateOpen, stepGates } from "../../src/lesson/steps";
import { progress } from "../../src/progress";
import { exportFixture } from "../helpers";
import { readFileSync } from "node:fs";
import path from "node:path";

type DeriveBlock = Extract<Block, { t: "derive" }>;
const KEY = "toy-101-l1-growth#5-deriving-the-steady-state-2#0";

let fixture: DeriveBlock;
let fixtureStep: Parameters<typeof stepGates>[1];

beforeAll(() => {
  const dir = exportFixture();
  const body = NoteBody.parse(JSON.parse(readFileSync(path.join(dir, "notes", "toy-101-l1-growth.json"), "utf8")));
  const step = body.sections.flatMap((s) => s.steps).find((st) => st.blocks.some((b) => b.t === "derive"))!;
  fixtureStep = step;
  fixture = step.blocks.find((b): b is DeriveBlock => b.t === "derive")!;
});

// A longer derivation: three typed milestones with hints, and a justify step between the first and the second.
const long = () =>
  calloutToIR(String.raw`> [!derive]- Solve for the steady state $\bar{k}$
> objective: 4, 6
> symbols: $s \in (0.05, 0.95)$, $A$, $\alpha \in (0.2, 0.8)$, $\delta \in (0.02, 0.2)$, $k_t$, $k_{t+1}$
> unknowns: $\bar{k}$
> given: $k_{t+1} = sAk_t^{\alpha} + (1-\delta)k_t$
>
> 1. Set $k_{t+1} = k_t = \bar{k}$: $\bar{k} = sA\bar{k}^{\alpha} + (1-\delta)\bar{k}$
>    hint: In the steady state $k_{t+1} = k_t$.
> 2. Why can we divide by $\bar{k}$? $\bar{k} > 0$ so $sA\bar{k}^{\alpha - 1} = \delta$
>    justify: Why is dividing by $\bar{k}$ allowed?
>    - [ ] Because $\alpha < 1$
>    - [x] Because the steady state we want has $\bar{k} > 0$
> 3. Cancel $(1-\delta)\bar{k}$: $sA\bar{k}^{\alpha} = \delta\bar{k}$
>    hint: Subtract $(1-\delta)\bar{k}$ from both sides.
> 4. Take the root: $\bar{k} = \left(\frac{sA}{\delta}\right)^{\frac{1}{1-\alpha}}$
>    hint: Divide by $\delta\bar{k}^{\alpha}$.
>
> accept: $\bar{k}^{1-\alpha} = \frac{sA}{\delta}$
> reject: $\bar{k} = (sA/\delta)^{1/\alpha}$ — dividing by $\bar{k}^{\alpha}$ leaves $\bar{k}^{1-\alpha}$`) as unknown as DeriveBlock;

const content = { md: createMarkdown({ noteHref: () => null, assetUrl: (s) => s }) } as unknown as Content;

function mount(block: DeriveBlock) {
  return render(
    <ContentProvider value={content}>
      <Derive block={block} storeKey={KEY} />
    </ContentProvider>,
  );
}

const input = () => screen.findByLabelText("Your next line") as Promise<HTMLInputElement>;
async function typeLine(text: string, send = true) {
  const el = await input();
  fireEvent.change(el, { target: { value: text } });
  if (send) fireEvent.submit(el.closest("form")!);
}
const verdict = () => document.querySelector(".derive-verdict") as HTMLElement;
const record = () => progress.get().derives[KEY];

beforeEach(() => {
  progress.reset();
  progress.setSettings({ review: false });
});
afterEach(cleanup);

const TARGET = "kbar = (sA/δ)^(1/(1−α))";

describe("Derive: the exercise card", () => {
  it("shows the title and the given as rendered maths, loads the checker lazily, and labels the input", async () => {
    mount(fixture);
    expect(screen.getByRole("region", { name: "Derivation" })).toBeTruthy();
    expect(screen.getByText("Given")).toBeTruthy();
    expect(document.querySelectorAll(".derive-givens .katex").length).toBeGreaterThan(0);
    expect(screen.getByText(/Loading the checker/)).toBeTruthy();
    const el = await input();
    expect(el.tagName).toBe("INPUT");
    expect(verdict().getAttribute("role")).toBe("status");
  });

  it("previews what it read as the learner types, and shows parse errors with clickable suggestions", async () => {
    mount(fixture);
    await typeLine(TARGET, false);
    const preview = document.querySelector(".derive-preview")!;
    expect(preview.textContent).toContain("I read this as");
    expect(preview.querySelector(".katex")).toBeTruthy();

    await typeLine("kt = 1", false);
    expect(preview.textContent).toContain("Not readable yet");
    expect(preview.textContent).toContain('I don\'t know the symbol "kt"');
    // No sentence of suggestions inline: the suggestions are buttons.
    expect(preview.textContent).not.toMatch(/Did you mean [^?]*\?\s*$/);
  });

  it("offers a symbol chip per declared symbol and inserts its typed name at the cursor", async () => {
    mount(fixture);
    const el = await input();
    fireEvent.change(el, { target: { value: "= 1" } });
    el.setSelectionRange(0, 0);
    const chips = within(screen.getByRole("group", { name: "Symbols" }));
    fireEvent.click(chips.getByRole("button", { name: "Insert alpha" }));
    expect(el.value).toBe("alpha= 1");
  });

  it("focusing the input scrolls the input, preview and chips into view with block: nearest, never start/center/end", async () => {
    mount(fixture);
    const el = await input();
    const group = el.closest(".derive-compose") as HTMLElement;
    expect(group.querySelector(".derive-preview")).not.toBeNull();
    expect(group.querySelector(".derive-chips")).not.toBeNull();
    const calls: unknown[] = [];
    group.scrollIntoView = ((arg?: unknown) => void calls.push(arg)) as typeof group.scrollIntoView;
    fireEvent.focus(el);
    expect(calls).toEqual([{ block: "nearest" }]);
  });

  it("disables Check line until something is typed", async () => {
    mount(fixture);
    const el = await input();
    const btn = screen.getByRole("button", { name: "Check line" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(el, { target: { value: "x" } });
    expect(btn.disabled).toBe(false);
  });
});

describe("Derive: verdicts", () => {
  it("reaches a milestone: names the step, reveals its worked line and keeps the typed line", async () => {
    mount(long());
    // The checker credits the furthest step a line is equivalent to: this one is step 1 written after step 3's cancelling.
    await typeLine("sA kbar^α = δ kbar");
    await waitFor(() => expect(verdict().textContent).toContain("that is step 3 of 4"));
    expect(screen.getByRole("list", { name: "Steps reached" }).textContent).toContain("Cancel");
    expect(screen.getByRole("list", { name: "Your lines" }).children).toHaveLength(1);
    expect(record()).toMatchObject({ result: "open", state: { reached: 2, done: false }, attempts: 1 });
    // The input is cleared for the next line and the gate stays shut.
    expect(((await input()) as HTMLInputElement).value).toBe("");
    expect(gateOpen(progress.get(), { key: KEY, kind: "derive" })).toBe(false);
  });

  it("says a true line that goes nowhere is no progress, gently, with the step's hint when there is one", async () => {
    mount(long());
    await typeLine("k_(t+1) = sA k_t^α + (1−δ) k_t");
    await waitFor(() => expect(verdict().textContent).toMatch(/true, but it doesn't get you closer/));
    expect(verdict().querySelector("[data-ok='neutral']")).toBeTruthy();
    expect(verdict().textContent).toContain("Hint");
    expect(verdict().textContent).toContain("steady state");
  });

  it("shows the checker's message for a wrong line and leaves the exercise unchanged", async () => {
    mount(long());
    await typeLine("kbar = (sA/δ)^(1/α)");
    await waitFor(() => expect(verdict().textContent).toContain("dividing by"));
    expect(verdict().querySelector("[data-ok='false']")).toBeTruthy();
    expect(record()).toMatchObject({ attempts: 1, state: { lines: [], reached: 0 } });
  });

  it("renders the author's reject message, and a justify prompt in the worked list, as maths", async () => {
    mount(long());
    await typeLine("kbar = (sA/δ)^(1/α)");
    await waitFor(() => expect(verdict().querySelector(".katex")).toBeTruthy());
    expect(verdict().textContent).not.toContain("$");
    fireEvent.click(screen.getByRole("button", { name: "Show worked derivation" }));
    const worked = await screen.findByRole("list", { name: "Worked derivation" });
    expect(worked.querySelector(".derive-why-label .katex")).toBeTruthy();
    expect(worked.textContent).not.toContain("$");
  });

  it("keeps the checker's own messages literal, so typed _ and * are not read as markdown", async () => {
    mount(long());
    await typeLine("k_t = 2*q_x");
    await waitFor(() => expect(verdict().querySelector(".derive-verdict-line")).toBeTruthy());
    expect(verdict().textContent).toContain("q_x");
  });

  it("turns a parse error from a submitted line into suggestion buttons that fix the input", async () => {
    mount(long());
    await typeLine("kt = 1");
    await waitFor(() => expect(verdict().querySelector(".derive-chip")).toBeTruthy());
    fireEvent.click(verdict().querySelector(".derive-chip")!);
    expect(((await input()) as HTMLInputElement).value).toBe("k_t = 1");
  });
});

describe("Derive: justify steps", () => {
  it("shows the step's maths first, then the question; a wrong answer can be retried and a right one passes", async () => {
    mount(fixture);
    await input();
    const q = screen.getByRole("form", { name: "Question for step 1" });
    // The maths of the step comes before the question.
    expect(q.querySelector(".derive-justify-line .katex")).toBeTruthy();
    expect(q.textContent).toContain("Why may we divide");
    fireEvent.click(within(q).getAllByRole("radio")[0]!);
    fireEvent.click(within(q).getByRole("button", { name: "Check answer" }));
    expect(q.textContent).toContain("Not quite");
    expect(record()?.justified ?? []).toEqual([]);
    const right = within(q).getAllByRole("radio")[1]!;
    fireEvent.click(right);
    fireEvent.click(within(q).getByRole("button", { name: "Check answer" }));
    expect(record()).toMatchObject({ justified: [0], result: "open" });
  });

  it("is done only when the target is typed and every question is answered, and then shows the worked derivation", async () => {
    mount(fixture);
    await typeLine(TARGET);
    await waitFor(() => expect(record()?.state.done).toBe(true));
    // The target alone does not finish it while a question is open.
    expect(record()?.result).toBe("open");
    expect(verdict().textContent).toContain("Answer the question above to finish");
    expect(verdict()).toBe(document.activeElement);
    expect(gateOpen(progress.get(), { key: KEY, kind: "derive" })).toBe(false);

    const q = screen.getByRole("form", { name: "Question for step 1" });
    fireEvent.click(within(q).getAllByRole("radio")[1]!);
    fireEvent.click(within(q).getByRole("button", { name: "Check answer" }));
    await waitFor(() => expect(record()?.result).toBe("done"));
    expect(verdict().textContent).toContain("Derivation complete");
    expect(verdict()).toBe(document.activeElement);
    expect(screen.getByRole("list", { name: "Worked derivation" }).children).toHaveLength(2);
    expect(screen.queryByLabelText("Your next line")).toBeNull();
    expect(gateOpen(progress.get(), { key: KEY, kind: "derive" })).toBe(true);
  });

  it("finishes when the questions are answered first and the target typed last", async () => {
    mount(fixture);
    await input();
    const q = screen.getByRole("form", { name: "Question for step 1" });
    fireEvent.click(within(q).getAllByRole("radio")[1]!);
    fireEvent.click(within(q).getByRole("button", { name: "Check answer" }));
    await typeLine(TARGET);
    await waitFor(() => expect(record()?.result).toBe("done"));
  });
});

describe("Derive: step by step", () => {
  it("names the next step in words without its maths, and reveals its hint on request, counting it", async () => {
    mount(long());
    await input();
    expect(document.querySelector(".derive-next")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Step by step" }));
    const next = document.querySelector(".derive-next") as HTMLElement;
    expect(next.textContent).toContain("Next: step 1");
    expect(next.textContent).toContain("Set");
    expect(next.querySelector(".katex-display")).toBeNull();
    expect(next.textContent).not.toContain("(1−δ)");
    expect(screen.queryByText("In the steady state")).toBeNull();

    fireEvent.click(within(next).getByRole("button", { name: "Show hint" }));
    expect(document.querySelector(".derive-hint")!.textContent).toContain("steady state");
    expect(record()?.hints).toBe(1);
    expect(screen.queryByRole("button", { name: "Show hint" })).toBeNull();
  });

  it("moves on to the next unfinished step after a milestone", async () => {
    mount(long());
    await typeLine("sA kbar^α = δ kbar");
    await waitFor(() => expect(record()?.state.reached).toBe(2));
    fireEvent.click(screen.getByRole("checkbox", { name: "Step by step" }));
    // Step 2 is the justify step, which is a question rather than a line to type.
    await waitFor(() => expect(document.querySelector(".derive-next")!.textContent).toContain("Next: step 2"));
    expect(document.querySelector(".derive-next")!.textContent).toContain("Answer the question above");
  });

  it("stepProse drops only the closing maths", () => {
    expect(stepProse("Divide both sides by $\\delta\\bar{k}^{\\alpha}$: $\\bar{k}^{1-\\alpha} = x$")).toBe("Divide both sides by $\\delta\\bar{k}^{\\alpha}$");
    expect(stepProse("$a = b$")).toBe("$a = b$");
    expect(stepProse("No maths here")).toBe("No maths here");
  });
});

describe("Derive: giving up, skipping, Review mode", () => {
  it("Show worked derivation gives up: every step is shown, focus goes to it, and the gate opens", async () => {
    mount(long());
    await input();
    fireEvent.click(screen.getByRole("button", { name: "Show worked derivation" }));
    await waitFor(() => expect(record()?.result).toBe("gave-up"));
    expect(screen.getByRole("list", { name: "Worked derivation" }).children).toHaveLength(4);
    expect(screen.queryByLabelText("Your next line")).toBeNull();
    expect(document.activeElement?.textContent).toBe("Worked derivation");
    expect(screen.getByText("Worked answer shown")).toBeTruthy();
    expect(gateOpen(progress.get(), { key: KEY, kind: "derive" })).toBe(true);
    // The justify step shows its right answer in the worked derivation.
    expect(screen.getByRole("list", { name: "Worked derivation" }).textContent).toContain("has");
  });

  it("a skipped exercise stays answerable and a later finish replaces the skip", async () => {
    progress.recordDerive(KEY, { result: "skipped" });
    mount(fixture);
    expect(screen.getByText("Skipped")).toBeTruthy();
    await typeLine(TARGET);
    await waitFor(() => expect(record()?.state.done).toBe(true));
    expect(record()?.result).toBe("skipped");
    const q = screen.getByRole("form", { name: "Question for step 1" });
    fireEvent.click(within(q).getAllByRole("radio")[1]!);
    fireEvent.click(within(q).getByRole("button", { name: "Check answer" }));
    await waitFor(() => expect(record()?.result).toBe("done"));
  });

  it("Review mode shows the worked derivation without the input, and records nothing", async () => {
    progress.setSettings({ review: true });
    mount(long());
    await waitFor(() => expect(screen.getByRole("list", { name: "Worked derivation" })).toBeTruthy());
    expect(screen.queryByLabelText("Your next line")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show worked derivation" })).toBeNull();
    expect(record()).toBeUndefined();
  });

  it("`exercise` asks the question even with Review mode on (a scheduled review of a derivation)", async () => {
    progress.setSettings({ review: true });
    render(
      <ContentProvider value={content}>
        <Derive block={long()} storeKey={KEY} exercise />
      </ContentProvider>,
    );
    await input();
    expect(screen.queryByRole("list", { name: "Worked derivation" })).toBeNull();
  });
});

describe("Derive: persistence", () => {
  it("restores the accepted lines, the milestone reached and the counts after a remount", async () => {
    const first = mount(long());
    await typeLine("sA kbar^α = δ kbar");
    await waitFor(() => expect(record()?.state.reached).toBe(2));
    first.unmount();

    const saved = JSON.parse(JSON.stringify(record()));
    expect(saved).toMatchObject({ state: { lines: ["sA kbar^α = δ kbar"], reached: 2, done: false }, result: "open", attempts: 1, hints: 0 });

    mount(long());
    await input();
    expect(screen.getByRole("list", { name: "Your lines" }).children).toHaveLength(1);
    expect(screen.getByRole("list", { name: "Steps reached" })).toBeTruthy();
    await typeLine("kbar = (sA/δ)^(1/(1−α))");
    await waitFor(() => expect(record()?.state.reached).toBe(3));
    expect(record()?.state.lines).toHaveLength(2);
  });

  it("reopens a finished exercise as done, with the worked derivation and no input", async () => {
    progress.recordDerive(KEY, { state: { lines: [TARGET], reached: 1, done: true }, justified: [0], result: "done" });
    mount(fixture);
    await waitFor(() => expect(verdict().textContent).toContain("Derivation complete"));
    expect(screen.queryByLabelText("Your next line")).toBeNull();
    expect(screen.getByRole("list", { name: "Worked derivation" })).toBeTruthy();
    // Opening a finished exercise must not take focus.
    expect(document.activeElement).not.toBe(verdict());
  });
});

describe("Derive: the gate", () => {
  it("a derive block is a gate, open only once finished, given up or skipped", () => {
    const gates = stepGates("toy-101-l1-growth", fixtureStep);
    expect(gates).toEqual([{ key: KEY, kind: "derive" }]);
    const data = () => progress.get();
    expect(gateOpen(data(), gates[0]!)).toBe(false);
    progress.recordDerive(KEY, { state: { lines: ["a = b"], reached: 0, done: false } });
    expect(gateOpen(data(), gates[0]!)).toBe(false);
    act(() => progress.recordDerive(KEY, { result: "skipped" }));
    expect(gateOpen(data(), gates[0]!)).toBe(true);
  });
});

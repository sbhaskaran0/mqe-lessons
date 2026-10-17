// The IR contract: what `vault_tool.py export` writes must satisfy src/ir.ts and resolve every reference.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Index, NoteBody } from "../src/ir";
import { validateContent } from "../src/validate";
import { exportFixture, REPO, scratchDir } from "./helpers";

let fixture: string;
beforeAll(() => {
  fixture = exportFixture();
});

const read = (dir: string, file: string) => JSON.parse(readFileSync(path.join(dir, file), "utf8"));

describe("fixture vault export", () => {
  it("validates with no errors, widgets and datasets included", () => {
    const r = validateContent(fixture);
    expect(r.errors).toEqual([]);
    expect(r.stats).toMatchObject({ notes: 13, widgets: 3, datasets: 1 });
  });

  it("parses into the typed IR", () => {
    const index = Index.parse(read(fixture, "index.json"));
    expect(index.widgets["toy-steady-state-explorer"]?.spec.type).toBe("panels");
    const body = NoteBody.parse(read(fixture, "notes/toy-101-l1-growth.json"));
    const kinds = body.sections.flatMap((s) => s.steps.flatMap((st) => st.blocks.map((b) => b.t)));
    expect(kinds.filter((k) => k === "interactive")).toHaveLength(6);
    expect(kinds.filter((k) => k === "check")).toHaveLength(3);
    expect(kinds.filter((k) => k === "derive")).toHaveLength(1);
  });

  it("carries the Phase 2 fields: derivations, planned placements, objectives, feedback, rubrics", () => {
    const index = Index.parse(read(fixture, "index.json"));
    const meta = index.notes["toy-101-l1-growth"]!;
    expect(meta.derives).toBe(1);
    expect(meta.objectives?.map((o) => o.tested)).toEqual([2, 3, 1]);
    expect(meta.interactives).not.toContain("toy-golden-rule");
    const blocks = NoteBody.parse(read(fixture, "notes/toy-101-l1-growth.json")).sections.flatMap((s) => s.steps.flatMap((st) => st.blocks));
    const planned = blocks.find((b) => b.t === "interactive" && b.status === "planned");
    expect(planned).toMatchObject({ widget: "toy-golden-rule", figure: "assets/Attachments/Toy diagram.png", objectives: [3] });
    expect(index.widgets["toy-golden-rule"]).toBeUndefined();
    const derive = blocks.find((b) => b.t === "derive");
    expect(derive?.t === "derive" && derive.steps.map((st) => [!!st.justify, !!st.hint])).toEqual([[true, false], [false, true]]);
    const mcq = blocks.find((b) => b.t === "check" && b.kind === "mcq");
    expect(mcq?.t === "check" && mcq.kind === "mcq" && mcq.options[0]?.feedback).toMatch(/^Doubling saving/);
    const numeric = blocks.find((b) => b.t === "check" && b.kind === "numeric");
    expect(numeric?.t === "check" && numeric.kind === "numeric" && numeric.wrong?.[0]?.answer).toBe(5);
    const predicts = blocks.flatMap((b) => (b.t === "interactive" && b.predict ? [b.predict] : []));
    expect(predicts.map((p) => [p.why !== undefined, p.feedback?.length, p.readout])).toEqual([[true, 3, undefined], [false, undefined, "kbar_out"]]);
    const q = NoteBody.parse(read(fixture, "notes/toy-101-l1-questions.json"));
    expect(q.practice?.items[0]?.rubric).toHaveLength(3);
  });

  it("carries the practice set, answers attached, on the question note only", () => {
    const index = Index.parse(read(fixture, "index.json"));
    const q = NoteBody.parse(read(fixture, "notes/toy-101-l1-questions.json"));
    expect(q.practice?.answers).toBe("toy-101-l1-answers");
    expect(q.practice?.answers).toBe(index.notes["toy-101-l1-questions"]?.pairedAnswers);
    expect(q.practice?.items.map((i) => [i.id, i.number])).toEqual([["q1", "1"], ["q2", "2"]]);
    expect(q.practice?.items[0]?.prompt).toMatch(/^Find \$\\bar\{k\}\$ when/);
    expect(q.practice?.items[1]?.answer).toMatch(/^No: saving raises the level/);
    expect(q.sections.length).toBeGreaterThan(0);
    expect(NoteBody.parse(read(fixture, "notes/toy-101-l1-answers.json")).practice).toBeUndefined();
  });
});

describe("validation catches broken exports", () => {
  function broken(mutate: (dir: string) => void): string[] {
    const dir = scratchDir("mqe-broken");
    cpSync(fixture, dir, { recursive: true });
    mutate(dir);
    const { errors } = validateContent(dir);
    rmSync(dir, { recursive: true, force: true });
    return errors;
  }
  const edit = (dir: string, file: string, fn: (json: any) => void) => {
    const json = read(dir, file);
    fn(json);
    writeFileSync(path.join(dir, file), JSON.stringify(json));
  };

  it("a field the schema does not know", () => {
    const errors = broken((d) => edit(d, "notes/toy-growth-model.json", (j) => { j.sections[0].steps[0].extra = 1; }));
    expect(errors.join("\n")).toMatch(/toy-growth-model\.json: sections\.0\.steps\.0: Unrecognized key/);
  });

  it("a derivation whose accept form does not reach the target (the checker's self-test runs in validate)", () => {
    const errors = broken((d) =>
      edit(d, "notes/toy-101-l1-growth.json", (j) => {
        const derive = j.sections.flatMap((s: any) => s.steps).flatMap((st: any) => st.blocks).find((b: any) => b.t === "derive");
        expect(derive).toBeDefined();
        derive.accept = ["x = 12345"];
      }),
    );
    expect(errors.join("\n")).toMatch(/toy-101-l1-growth.*derive "/);
  });

  it("a link to a note that was not exported", () => {
    const errors = broken((d) =>
      edit(d, "notes/toy-growth-model.json", (j) => { j.sections[0].steps[0].blocks[0].md += " [x](note:no-such-note)"; }),
    );
    expect(errors.join("\n")).toMatch(/no note 'no-such-note'/);
  });

  it("a missing asset", () => {
    const errors = broken((d) => rmSync(path.join(d, "assets", "Attachments", "Toy diagram.png")));
    expect(errors.join("\n")).toMatch(/asset assets\/Attachments\/Toy diagram\.png is missing/);
  });

  it("a symbol chip with no notation row", () => {
    const errors = broken((d) => edit(d, "notes/toy-growth-model.json", (j) => { j.sections[1].steps[0].symbols.push("$zzz$"); }));
    expect(errors.join("\n")).toMatch(/symbol chip '\$zzz\$'/);
  });

  it("a widget test that no longer holds", () => {
    const errors = broken((d) =>
      edit(d, "index.json", (j) => { j.widgets["toy-steady-state-explorer"].spec.tests[0].expect.kbar = 26; }),
    );
    expect(errors.join("\n")).toMatch(/tests\[0\]: kbar = 25, expected 26/);
  });

  it("a block that names an element the widget lacks", () => {
    const errors = broken((d) =>
      edit(d, "notes/toy-101-l1-growth.json", (j) => {
        const step = j.sections.flatMap((s: any) => s.steps).find((st: any) => st.blocks.some((b: any) => b.t === "interactive"));
        step.blocks.find((b: any) => b.t === "interactive").show = ["ghost"];
      }),
    );
    expect(errors.join("\n")).toMatch(/'ghost' is not an element of toy-steady-state-explorer/);
  });

  it("practice that names the wrong answers note, repeats an id or links nowhere", () => {
    const q = "notes/toy-101-l1-questions.json";
    expect(broken((d) => edit(d, q, (j) => { j.practice.answers = "toy-growth-model"; })).join("\n"))
      .toMatch(/practice\.answers is 'toy-growth-model', pairedAnswers is 'toy-101-l1-answers'/);
    expect(broken((d) => edit(d, q, (j) => { j.practice.items[1].id = "q1"; })).join("\n")).toMatch(/practice-q1: practice item id repeats/);
    expect(broken((d) => edit(d, q, (j) => { j.practice.items[0].links.push("no-such-note"); })).join("\n")).toMatch(/practice-q1: no note 'no-such-note'/);
    expect(broken((d) => edit(d, q, (j) => { j.practice.items[0].answer += " [x](note:gone)"; })).join("\n")).toMatch(/no note 'gone'/);
  });

  const growth = "notes/toy-101-l1-growth.json";
  const blocksOf = (j: any) => j.sections.flatMap((s: any) => s.steps.flatMap((st: any) => st.blocks));

  it("a derive count, objective or tested count the index does not agree with", () => {
    expect(broken((d) => edit(d, "index.json", (j) => { j.notes["toy-101-l1-growth"].derives = 2; })).join("\n")).toMatch(/1 derives, index says 2/);
    expect(broken((d) => edit(d, growth, (j) => { blocksOf(j).find((b: any) => b.t === "derive").objectives = [9]; })).join("\n"))
      .toMatch(/objective 9 is not in the note's objectives \(1, 2, 3\)/);
    expect(broken((d) => edit(d, "index.json", (j) => { j.notes["toy-101-l1-growth"].objectives[0].tested = 5; })).join("\n"))
      .toMatch(/objective 1 is tested by 2 item\(s\), index says 5/);
  });

  it("a derivation or check whose structure is off", () => {
    expect(broken((d) => edit(d, growth, (j) => { blocksOf(j).find((b: any) => b.t === "derive").steps = []; })).join("\n")).toMatch(/steps: Too small/);
    expect(broken((d) => edit(d, growth, (j) => {
      for (const o of blocksOf(j).find((b: any) => b.t === "derive").steps[0].justify.options) o.correct = false;
    })).join("\n")).toMatch(/derive "Solve for the steady state [^"]*": step 1 justify has no correct option/);
    expect(broken((d) => edit(d, growth, (j) => { blocksOf(j).find((b: any) => b.kind === "numeric").wrong[0].answer = 25.01; })).join("\n"))
      .toMatch(/wrong answer 25\.01 lies within the right answer 25/);
  });

  it("a varied check whose formula does not give its answer (validate recomputes it)", () => {
    expect(broken((d) => edit(d, growth, (j) => { blocksOf(j).find((b: any) => b.vary).answer = 10; })).join("\n"))
      .toMatch(/: varied check: compute: gives 9 at the question's numbers, but 'answer:' is 10 ± 0\.09 - fix one of them/);
  });

  it("a predict readout the widget lacks or cannot compute", () => {
    const readout = (fn: (p: any) => void) => broken((d) => edit(d, growth, (j) => fn(blocksOf(j).find((b: any) => b.predict?.readout).predict)));
    expect(readout((p) => { p.readout = "nope"; }).join("\n")).toMatch(/predict\.readout 'nope' is not a readout of toy-steady-state-explorer/);
    expect(readout((p) => { delete p.tol; }).join("\n")).toMatch(/predict\.readout needs tol/);
    expect(readout((p) => { p.options = ["a", "b"]; }).join("\n")).toMatch(/predict has both options and readout/);
  });

  it("a planned placement skips the widget lookup but not its figure", () => {
    expect(broken((d) => edit(d, growth, (j) => { blocksOf(j).find((b: any) => b.status === "planned").widget = "never-built"; }))).toEqual([]);
    expect(broken((d) => edit(d, growth, (j) => { blocksOf(j).find((b: any) => b.status === "planned").figure = "assets/Attachments/Nope.png"; })).join("\n"))
      .toMatch(/asset assets\/Attachments\/Nope\.png is missing/);
    expect(broken((d) => edit(d, growth, (j) => { delete blocksOf(j).find((b: any) => b.status === "planned").status; })).join("\n"))
      .toMatch(/widget 'toy-golden-rule' is not in widgets/);
  });

  it("a readout the learner can move with a slider is a note", () => {
    const dir = scratchDir("mqe-readout");
    cpSync(fixture, dir, { recursive: true });
    edit(dir, growth, (j) => { blocksOf(j).find((b: any) => b.predict?.readout).lock = ["A"]; });
    const r = validateContent(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(r.errors).toEqual([]);
    expect(r.notes.join("\n")).toMatch(/predict\.readout 'kbar_out' moves with unlocked s, alpha, delta/);
  });

  it("a question with no answer is a note, not an error", () => {
    const dir = scratchDir("mqe-noanswer");
    cpSync(fixture, dir, { recursive: true });
    edit(dir, "notes/toy-101-l1-questions.json", (j) => { delete j.practice.items[1].answer; });
    const r = validateContent(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(r.errors).toEqual([]);
    expect(r.notes.join("\n")).toMatch(/practice-q2: question 2 has no answer in toy-101-l1-answers/);
  });
});

describe.skipIf(!existsSync(path.join(REPO, "content", "index.json")))("content/ (the last `npm run export` of the real vault)", () => {
  it("validates with no errors", () => {
    const r = validateContent(path.join(REPO, "content"));
    expect(r.errors).toEqual([]);
    expect(r.stats.notes).toBeGreaterThanOrEqual(160);
  });
});

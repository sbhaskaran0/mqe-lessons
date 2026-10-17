// @vitest-environment happy-dom
// data-chart end to end: the fixture export's dataset is fetched (from the exported files), parsed and drawn; series
// toggle from the legend and obey a view's `show`; hovering reads values at the nearest x; failures are tidy cards.
import "./setup";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture, fixtureDir, widget } from "./setup";
import { block, entryOf, memoryDataset, mount, serve, serveFixture } from "./data-helpers";

afterEach(() => vi.unstubAllGlobals());

const csv = (name: string) => readFileSync(path.join(fixtureDir(), "assets", "data", "exports", name), "utf8");

describe("data-chart on the fixture dataset", () => {
  it("fetches the exported file once and draws a path per series, the annotation and the axis titles", async () => {
    let release!: () => void;
    const served = serveFixture(new Promise<void>((r) => (release = r)));
    const w = await mount(widget("toy-saving-chart"));
    await waitFor(() => expect(w.c.textContent).toContain("Loading the data"));
    expect(w.c.querySelector('[aria-busy="true"]')).not.toBeNull();
    release();
    await w.ready();
    expect(served.calls).toEqual(["assets/data/exports/toy-saving-rates.csv"]);
    // 21 years (2000-2020) per series
    for (const id of ["rich", "poor"]) expect(w.el(id)!.querySelector("path.w-curve")!.getAttribute("d")!.split("L")).toHaveLength(21);
    expect(w.el("crisis")).not.toBeNull();
    expect(w.c.querySelector('[data-label="note-crisis"]')?.textContent).toBe("Crisis");
    expect(w.c.querySelector(".w-axis-title-x")?.textContent).toContain("Year");
    expect(w.c.querySelector(".w-axis-title-y")?.textContent).toContain("Saving rate");
    expect(w.c.querySelector(".w-axis-title-y .katex")).not.toBeNull();
    expect(w.c.querySelector(".w-data-note")?.textContent).toContain("Toy saving rates by country group");
    expect(w.c.querySelector(".w-data-note")?.textContent).not.toContain("Approximate");
  });

  it("the series come from the right rows: the crisis dip is in each series' own path", async () => {
    serveFixture();
    const w = await mount(widget("toy-saving-chart"));
    await w.ready();
    // y coordinates in the path: 2008 (index 8) sits below its neighbours for both series
    for (const id of ["rich", "poor"]) {
      const ys = w.el(id)!.querySelector("path.w-curve")!.getAttribute("d")!.split("L").map((seg) => Number(seg.replace("M", "").split(",")[1]));
      expect(ys[8]).toBeGreaterThan(ys[7]!); // SVG y grows downward
      expect(ys[8]).toBeGreaterThan(ys[9]!);
    }
  });

  it("toggles a series from its legend chip and back", async () => {
    serveFixture();
    const w = await mount(widget("toy-saving-chart"));
    await w.ready();
    const chip = w.c.querySelector<HTMLButtonElement>('[data-series="poor"]')!;
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    expect(w.el("poor")).toBeNull();
    expect(w.el("rich")).not.toBeNull();
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(w.el("poor")).not.toBeNull();
  });

  it("a view's show list hides the other series (their chips go inert) and the annotations it doesn't name", async () => {
    serveFixture();
    const w = await mount(widget("toy-saving-chart"), block({ show: ["rich"] }));
    await w.ready();
    expect(w.el("rich")).not.toBeNull();
    expect(w.el("poor")).toBeNull();
    expect(w.el("crisis")).toBeNull();
    const poor = w.c.querySelector<HTMLButtonElement>('[data-series="poor"]')!;
    expect(poor.disabled).toBe(true);
    expect(w.c.querySelector<HTMLButtonElement>('[data-series="rich"]')!.disabled).toBe(false);
    w.rerender(block({ show: ["rich", "poor", "crisis"] }));
    await waitFor(() => expect(w.el("poor")).not.toBeNull());
    expect(w.el("crisis")).not.toBeNull();
    expect(poor.disabled).toBe(false);
  });

  it("a learner's toggle lasts until the next view arrives", async () => {
    serveFixture();
    const w = await mount(widget("toy-saving-chart"), block());
    await w.ready();
    fireEvent.click(w.c.querySelector('[data-series="poor"]')!);
    expect(w.el("poor")).toBeNull();
    w.rerender(block({ highlight: "rich" }));
    await waitFor(() => expect(w.el("poor")).not.toBeNull());
    expect(w.c.querySelector('[data-series="rich"]')!.className).toContain("w-hl");
    expect(w.el("rich")!.querySelector(".w-halo")).not.toBeNull();
  });

  it("hovering reads every shown series at the nearest year", async () => {
    serveFixture();
    const w = await mount(widget("toy-saving-chart"));
    await w.ready();
    const plot = w.c.querySelector(".w-plot")!;
    const rows = new Map(
      csv("toy-saving-rates.csv")
        .trim()
        .split("\n")
        .slice(1)
        .map((l) => {
          const [year, group, rate] = l.split(",");
          return [`${year}|${group}`, rate!] as const;
        }),
    );
    let seen = "";
    for (let x = 0; x <= WIDTH && seen !== "2008"; x += 4) {
      fireEvent.pointerMove(plot, { clientX: x, clientY: 100 });
      seen = w.c.querySelector(".w-hover-t")?.textContent ?? "";
    }
    expect(seen).toBe("2008");
    const values = [...w.c.querySelectorAll(".w-hover-row")].map((r) => r.querySelector(".w-hover-v")!.textContent);
    expect(values).toEqual([rows.get("2008|rich"), rows.get("2008|poor")].map((v) => String(Number(v))));
    expect(values).toEqual(["0.22", "0.07"]);
    // hiding a series removes its row
    fireEvent.click(w.c.querySelector('[data-series="poor"]')!);
    fireEvent.pointerMove(plot, { clientX: 0, clientY: 100 });
    for (let x = 0; x <= WIDTH && w.c.querySelector(".w-hover-t")?.textContent !== "2008"; x += 4) fireEvent.pointerMove(plot, { clientX: x, clientY: 100 });
    expect(w.c.querySelectorAll(".w-hover-row")).toHaveLength(1);
    fireEvent.pointerLeave(plot);
    expect(w.c.querySelector(".w-hover")).toBeNull();
  });
});

const WIDTH = 600;

describe("marks, x kinds and approximations", () => {
  const mini = (extra = {}) => memoryDataset("mini", "country,share,more\nUS,0.30,0.1\nUK,0.25,0.2\nFR,0.20,0.3\n", extra);
  const spec = (over = {}) => ({
    type: "data-chart",
    dataset: "mini",
    x: { column: "country", label: "Country" },
    y: { column: "share", label: "Share" },
    ...over,
  });

  it("bars over a text column: one slot per band, labelled by name, bars for each series side by side", async () => {
    const d = mini();
    serve(d.files);
    const w = await mount(entryOf(spec({ mark: "bar", series: [{ id: "a", label: "Share" }, { id: "b", label: "More", column: "more" }] })), null, {}, { mini: d.meta });
    await w.ready();
    expect(w.el("a")!.querySelectorAll("rect")).toHaveLength(3);
    expect(w.el("b")!.querySelectorAll("rect")).toHaveLength(3);
    expect([...w.c.querySelectorAll(".w-ticks text")].map((t) => t.textContent)).toEqual(expect.arrayContaining(["US", "UK", "FR"]));
    // the taller value has the taller bar
    const h = (id: string, i: number) => Number(w.el(id)!.querySelectorAll("rect")[i]!.getAttribute("height"));
    expect(h("a", 0)).toBeGreaterThan(h("a", 2));
    expect(h("b", 0)).toBeLessThan(h("b", 2));
  });

  it("area and point marks", async () => {
    const d = memoryDataset("t", "year,v\n1,1\n2,3\n3,2\n");
    serve(d.files);
    const area = await mount(entryOf({ type: "data-chart", dataset: "t", mark: "area", x: { column: "year" }, y: { column: "v" } }), null, {}, { t: d.meta });
    await area.ready();
    expect(area.c.querySelector("path.w-area")?.getAttribute("d")).toMatch(/Z$/);
    expect(area.el("v")).not.toBeNull();
    cleanup();
    const points = await mount(entryOf({ type: "data-chart", dataset: "t", mark: "point", x: { column: "year" }, y: { column: "v" } }), null, {}, { t: d.meta });
    await points.ready();
    expect(points.el("v")!.querySelectorAll("circle")).toHaveLength(3);
  });

  it("a date column becomes an ordinary numeric axis (fractional years) and hover shows the date as written", async () => {
    const d = memoryDataset("dates", "day,v\n2020-01-01,1\n2021-01-01,2\n2022-01-01,3\n");
    serve(d.files);
    const w = await mount(entryOf({ type: "data-chart", dataset: "dates", x: { column: "day", kind: "time" }, y: { column: "v" }, annotations: [{ id: "e", x: "2021-01-01", label: "Event" }] }), null, {}, { dates: d.meta });
    await w.ready();
    expect(w.c.querySelector('[data-label="note-e"]')?.textContent).toBe("Event");
    for (let x = 0; x <= WIDTH && !w.c.querySelector(".w-hover-t"); x += 4) fireEvent.pointerMove(w.c.querySelector(".w-plot")!, { clientX: x, clientY: 80 });
    expect(w.c.querySelector(".w-hover-t")?.textContent).toMatch(/^202[012]-01-01$/);
  });

  it("marks approximate values with ≈ when the dataset description says they were read off a chart", async () => {
    const d = mini({ description: "Values read off Figure 3 of the lecture slides (approximate)." });
    serve(d.files);
    const w = await mount(entryOf(spec()), null, {}, { mini: d.meta });
    await w.ready();
    expect(w.c.querySelector(".w-data-note")?.textContent).toContain("≈ Approximate");
    for (let x = 0; x <= WIDTH && !w.c.querySelector(".w-hover-v"); x += 4) fireEvent.pointerMove(w.c.querySelector(".w-plot")!, { clientX: x, clientY: 80 });
    expect(w.c.querySelector(".w-hover-v")?.textContent).toMatch(/^≈0\.\d+$/);
  });

  it("marks only the flagged rows when the dataset has an approx column", async () => {
    const d = memoryDataset("flag", "year,v,approx\n1,1,1\n2,2,0\n3,3,0\n");
    serve(d.files);
    const w = await mount(entryOf({ type: "data-chart", dataset: "flag", x: { column: "year" }, y: { column: "v" } }), null, {}, { flag: d.meta });
    await w.ready();
    const hoverAll = () => {
      const out: string[] = [];
      for (let x = 0; x <= WIDTH; x += 4) {
        fireEvent.pointerMove(w.c.querySelector(".w-plot")!, { clientX: x, clientY: 80 });
        const v = w.c.querySelector(".w-hover-v")?.textContent;
        if (v && !out.includes(v)) out.push(v);
      }
      return out;
    };
    expect(hoverAll()).toEqual(["≈1", "2", "3"]);
    expect(w.c.querySelector(".w-data-note")?.textContent).not.toContain("Approximate");
  });

  it("a predicted series stays hidden, with an inert chip, until the guess is committed", async () => {
    serveFixture();
    const w = await mount(widget("toy-saving-chart"), block({ predict: { hide: ["poor"], ask: "Which way?", options: ["Lower", "Same"], answer: 0 } }));
    await w.ready();
    expect(w.el("poor")).toBeNull();
    expect(w.c.querySelector<HTMLButtonElement>('[data-series="poor"]')!.disabled).toBe(true);
    fireEvent.click(w.c.querySelector('[role="radio"]')!);
    fireEvent.click(w.button(/commit/i)!);
    await waitFor(() => expect(w.el("poor")).not.toBeNull());
    expect(w.c.querySelector<HTMLButtonElement>('[data-series="poor"]')!.disabled).toBe(false);
  });

  it("params, readouts and goals work as in any widget", async () => {
    const d = memoryDataset("t", "year,v\n1,1\n2,3\n");
    serve(d.files);
    const onGoalMet = vi.fn();
    const e = entryOf({
      type: "data-chart",
      dataset: "t",
      x: { column: "year" },
      y: { column: "v" },
      params: { k: { tex: "k", min: 0, max: 10, default: 1, step: 1 } },
      readouts: [{ id: "double", expr: "2*k", tex: "2k", format: ".0f" }],
    });
    const w = await mount(e, block({ goal: { when: "double >= 6", success: "Got it", hint: "Try 3" } }), { onGoalMet }, { t: d.meta });
    await w.ready();
    expect(w.readout("double")).toBe("2");
    w.move("k", 4);
    expect(w.readout("double")).toBe("8");
    await waitFor(() => expect(onGoalMet).toHaveBeenCalledTimes(1));
    expect(w.c.querySelector('[data-goal="met"]')).not.toBeNull();
  });
});

describe("failures are tidy cards", () => {
  it("an HTTP error offers Try again, which loads the data when it comes back", async () => {
    const d = memoryDataset("flaky", "year,v\n1,1\n2,2\n");
    const e = entryOf({ type: "data-chart", dataset: "flaky", x: { column: "year" }, y: { column: "v" } });
    serve({});
    const w = await mount(e, null, {}, { flaky: d.meta });
    await waitFor(() => expect(w.c.querySelector(".w-notice-error")).not.toBeNull());
    expect(w.c.textContent).toContain("HTTP 404");
    serve(d.files);
    await act(async () => fireEvent.click(w.button(/try again/i)!));
    await w.ready();
    expect(w.el("v")).not.toBeNull();
  });

  it("a dataset id the lesson doesn't have", async () => {
    const w = await mount(entryOf({ type: "data-chart", dataset: "nope", x: { column: "a" }, y: { column: "b" } }), null, {}, {});
    await waitFor(() => expect(w.c.querySelector(".w-notice-error")).not.toBeNull());
    expect(w.c.textContent).toContain("'nope'");
  });

  it("a column the dataset lacks names the columns it has", async () => {
    const d = memoryDataset("cols", "year,v\n1,1\n");
    serve(d.files);
    const w = await mount(entryOf({ type: "data-chart", dataset: "cols", x: { column: "year" }, y: { column: "wages" } }), null, {}, { cols: d.meta });
    await waitFor(() => expect(w.c.querySelector(".w-notice-error")).not.toBeNull());
    expect(w.c.textContent).toMatch(/column 'wages' is not in the dataset \(columns: year, v\)/);
  });

  it("unparseable JSON is reported, not thrown", async () => {
    const meta = { id: "bad", title: "Bad", src: "assets/data/bad.json", format: "json" as const, columns: {} };
    serve({ "assets/data/bad.json": "{not json" });
    const w = await mount(entryOf({ type: "data-chart", dataset: "bad", x: { column: "a" }, y: { column: "b" } }), null, {}, { bad: meta });
    await waitFor(() => expect(w.c.querySelector(".w-notice-error")).not.toBeNull());
  });

  it("uses the content base for the request", async () => {
    const d = memoryDataset("based", "year,v\n1,1\n2,2\n");
    const served = serve(d.files, "/content/");
    const w = await mount(entryOf({ type: "data-chart", dataset: "based", x: { column: "year" }, y: { column: "v" } }), null, { contentBase: "/content/" }, { based: d.meta });
    await w.ready();
    expect(served.calls).toEqual([`/content/${d.meta.src}`]);
  });
});

describe("theming", () => {
  it("the dataset widgets use design tokens only: no hard-coded colours", () => {
    const files = ["data-chart/DataChart.tsx", "distribution/Distribution.tsx", "data/data.css", "data/DatasetCards.tsx", "data/PredictMarker.tsx", "ui/Compare.tsx", "ui/compare.css"];
    for (const f of files) {
      const text = readFileSync(path.join(__dirname, "..", "..", "src", "widgets", f), "utf8");
      expect(text, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    }
    expect(fixture().index.widgets["toy-saving-chart"]).toBeDefined();
  });
});

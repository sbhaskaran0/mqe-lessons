// @vitest-environment happy-dom
// Lazy widgets (H4, player side): a planned placement shows its static figure with a quiet note, never an error card;
// a spec the runtime can't draw falls back to the figure when the placement has one; once the placement is activated
// the live widget renders and reports itself as mounted live.
import "./setup";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WidgetEntry } from "../../src/ir";
import type { InteractiveBlock } from "../../src/widgets/host";
import { standsIn, WidgetHost } from "../../src/widgets/WidgetHost";
import { fixture, lectureViews, widget } from "./setup";

const planned = () => lectureViews().find((b) => b.status === "planned")!;
const live = () => lectureViews().find((b) => b.status !== "planned" && fixture().index.widgets[b.widget])!;
const host = (entry: WidgetEntry | undefined, view: InteractiveBlock, onLive?: () => void) =>
  render(<WidgetHost entry={entry} view={view} datasets={fixture().index.datasets} contentBase="http://localhost/content/" onLive={onLive} />);

describe("planned placeholders", () => {
  it("the fixture placeholder is a planned block with a figure and no widget in the export", () => {
    const b = planned();
    expect(b.figure).toBeTruthy();
    expect(fixture().index.widgets[b.widget]).toBeUndefined();
  });

  it("renders the static figure and an 'Interactive coming' note, with no error card or widget", () => {
    const b = planned();
    const { container } = host(undefined, b);
    const img = container.querySelector<HTMLImageElement>("img.w-planned-img")!;
    expect(img.src).toBe(new URL(b.figure!, "http://localhost/content/").href);
    expect(img.alt).not.toBe("");
    expect(container.querySelector(".w-planned-note")?.textContent).toBe("Interactive coming");
    expect(container.querySelector(".w-notice, .w-notice-error, .w-root")).toBeNull();
    expect(container.textContent).not.toMatch(/couldn't be drawn/);
  });

  it("a planned placement without a figure shows only the note", () => {
    const { container } = host(undefined, { t: "interactive", widget: "not-built", status: "planned" });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".w-planned-note")?.textContent).toBe("Interactive coming");
    expect(container.textContent).not.toContain("not-built");
  });

  it("labels a figureless placeholder by what it is for, never by its slug", () => {
    const { container } = host(undefined, { t: "interactive", widget: "two-period-consumption-choice", status: "planned", prompt: "Find the $MRS = 1 + r$ optimum", purpose: "See the tangency" });
    expect(container.querySelector(".w-planned-what")?.textContent).toBe("Find the MRS = 1 + r optimum");
    expect(container.textContent).not.toContain("two-period-consumption-choice");
    const img = host(undefined, { t: "interactive", widget: "slug-only", status: "planned", figure: "x.png", purpose: "See the tangency" });
    expect(img.container.querySelector("img")?.alt).toBe("See the tangency");
    expect(img.container.textContent).not.toContain("slug-only");
  });

  it("stays a placeholder while the placement is planned even if the widget now exists and validates", () => {
    const entry = widget("toy-steady-state-explorer");
    const { container } = host(entry, { ...live(), status: "planned", figure: "assets/x.png" });
    expect(container.querySelector(".w-planned")).not.toBeNull();
    expect(container.querySelector(".w-root")).toBeNull();
  });

  it("falls back to the figure when the spec doesn't validate, and keeps the error card when there is no figure", () => {
    const base = widget("toy-steady-state-explorer");
    const broken: WidgetEntry = { ...base, spec: { type: "panels", title: "Broken" } as unknown as WidgetEntry["spec"] };
    expect(standsIn(broken, { t: "interactive", widget: base.slug, figure: "assets/x.png" })).toBe(true);
    const withFigure = host(broken, { t: "interactive", widget: base.slug, figure: "assets/x.png" });
    expect(withFigure.container.querySelector("img.w-planned-img")).not.toBeNull();
    expect(withFigure.container.querySelector(".w-notice-error")).toBeNull();
    withFigure.unmount();
    const bare = host(broken, { t: "interactive", widget: base.slug });
    expect(bare.container.querySelector(".w-notice-error")).not.toBeNull();
  });
});

describe("activation", () => {
  it("a live placement renders the widget and reports it live once", async () => {
    const b = live();
    const entry = fixture().index.widgets[b.widget]!;
    const onLive = vi.fn();
    const { container, rerender } = host(entry, b, onLive);
    await waitFor(() => expect(container.querySelector(".w-root:not(.w-skeleton)")).not.toBeNull());
    expect(container.querySelector(".w-planned")).toBeNull();
    expect(onLive).toHaveBeenCalledTimes(1);
    rerender(<WidgetHost entry={entry} view={b} datasets={fixture().index.datasets} contentBase="" onLive={onLive} />);
    expect(onLive).toHaveBeenCalledTimes(1);
  });

  it("a placeholder never reports live; it reports that the placeholder was shown", () => {
    const onLive = vi.fn();
    const onPlaceholder = vi.fn();
    render(<WidgetHost entry={undefined} view={planned()} datasets={{}} contentBase="" onLive={onLive} onPlaceholder={onPlaceholder} />);
    expect(onLive).not.toHaveBeenCalled();
    expect(onPlaceholder).toHaveBeenCalledTimes(1);
  });
});

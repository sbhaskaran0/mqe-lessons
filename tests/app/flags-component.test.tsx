// @vitest-environment happy-dom
// The flag control: open, choose a reason, save, Esc, keyboard, edit and remove, and the dev write-through.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../../src/ir";
import { blockExcerpt, FlagBlock } from "../../src/lesson/Flag";
import { progress } from "../../src/progress";

const prose: Block = { t: "prose", md: "The **capital stock** evolves as [k](note:k) with $k_{t+1}$ and ![fig](<assets/a.png>) more." };
const KEY = "solow#def-1#0";

// The write-through starts once per module, so the fetch stub is installed before the first render.
const calls: { url: string; body?: string }[] = [];
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    return new Response(null, { status: 204 });
  }),
);

function mount(block: Block = prose) {
  return render(
    <FlagBlock block={block} slug="solow" stepId="def-1" index={0}>
      <p>block body</p>
    </FlagBlock>,
  );
}

const trigger = () => screen.getByRole("button", { name: /flag this block|edit flag/i });

beforeEach(() => {
  Object.keys(progress.get().flags).forEach((k) => progress.removeFlag(k));
  calls.length = 0;
});
afterEach(cleanup);

describe("Flag control", () => {
  it("opens an inline form with the four reasons, focused on the first, and Save waits for a reason", () => {
    mount();
    expect(screen.queryByRole("form", { name: "Flag this block" })).toBeNull();
    fireEvent.click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Wrong maths", "Unclear", "Typo", "Other"]);
    expect(document.activeElement).toBe(radios[0]);
    expect((screen.getByRole("button", { name: "Save flag" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves the reason, note, kind and excerpt, closes, shows the marker and returns focus to the button", () => {
    mount();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("radio", { name: "Wrong maths" }));
    fireEvent.change(screen.getByRole("textbox", { name: /note/i }), { target: { value: "  sign is off  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save flag" }));

    expect(progress.get().flags[KEY]).toMatchObject({
      slug: "solow", stepId: "def-1", block: 0, kind: "prose", reason: "Wrong maths", note: "sign is off",
      excerpt: "The capital stock evolves as k with k_{t+1} and more.",
    });
    expect(screen.queryByRole("radio")).toBeNull();
    const button = screen.getByRole("button", { name: "Flagged as Wrong maths. Edit flag" });
    expect(button.getAttribute("data-flagged")).toBe("true");
    expect(button.textContent).toContain("Wrong maths");
    expect(document.activeElement).toBe(button);
  });

  it("closes on Escape without saving and returns focus to the button", () => {
    mount();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("radio", { name: "Typo" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("radio")).toBeNull();
    expect(progress.get().flags).toEqual({});
    expect(document.activeElement).toBe(trigger());
  });

  it("works from the keyboard: arrows move the reason, submitting the form saves", () => {
    mount();
    fireEvent.click(trigger());
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    const typo = screen.getByRole("radio", { name: "Typo" });
    expect(typo.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(typo);
    expect(typo.tabIndex).toBe(0);
    expect(screen.getByRole("radio", { name: "Other" }).tabIndex).toBe(-1);
    // Past the end wraps to the start.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Wrong maths" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.submit(screen.getByRole("form", { name: "Flag this block" }));
    expect(progress.get().flags[KEY]?.reason).toBe("Wrong maths");
  });

  it("edits an existing flag with its values filled in, and removes it", () => {
    progress.setFlag({ slug: "solow", stepId: "def-1", block: 0, kind: "prose", reason: "Unclear", note: "hm", excerpt: "x" });
    mount();
    fireEvent.click(trigger());
    const unclear = screen.getByRole("radio", { name: "Unclear" });
    expect(unclear.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(unclear);
    expect((screen.getByRole("textbox", { name: /note/i }) as HTMLTextAreaElement).value).toBe("hm");

    fireEvent.click(screen.getByRole("radio", { name: "Typo" }));
    fireEvent.click(screen.getByRole("button", { name: "Update flag" }));
    expect(progress.get().flags[KEY]).toMatchObject({ reason: "Typo", note: "hm" });

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Remove flag" }));
    expect(progress.get().flags).toEqual({});
    expect(screen.getByRole("button", { name: "Flag this block" }).getAttribute("data-flagged")).toBeNull();
  });

  it("posts the full list to the dev server after each change, once the ping succeeds", async () => {
    mount();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("radio", { name: "Other" }));
    fireEvent.click(screen.getByRole("button", { name: "Save flag" }));
    await waitFor(() => expect(calls.some((c) => c.url === "__flags")).toBe(true));
    const body = JSON.parse(calls.find((c) => c.url === "__flags")!.body!);
    expect(body.flags).toHaveLength(1);
    expect(body.flags[0]).toMatchObject({ slug: "solow", reason: "Other" });

    calls.length = 0;
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Remove flag" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(JSON.parse(calls[0]!.body!)).toEqual({ flags: [] });
  });
});

describe("blockExcerpt", () => {
  it("gives short plain text for each kind of block and caps long ones", () => {
    expect(blockExcerpt({ t: "math", tex: "y = \\alpha\n + \\beta" })).toBe("y = \\alpha + \\beta");
    expect(blockExcerpt({ t: "callout", kind: "why", title: "Why it matters", md: "It **drives** growth.", folded: false })).toBe("Why it matters: It drives growth.");
    expect(blockExcerpt({ t: "figure", src: "a.png", alt: "alt text" })).toBe("alt text");
    expect(blockExcerpt({ t: "links", role: "concepts", items: ["a", "b"] })).toBe("concepts: a, b");
    const long = blockExcerpt({ t: "prose", md: "word ".repeat(100) });
    expect(long).toHaveLength(160);
    expect(long.endsWith("…")).toBe(true);
  });
});

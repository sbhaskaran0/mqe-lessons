// Shared by the dataset-widget tests: mount a widget through the host, and a fetch that serves files.
import "./setup";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, vi } from "vitest";
import type { DatasetMeta, WidgetEntry } from "../../src/ir";
import type { InteractiveBlock, WidgetProps } from "../../src/widgets/host";
import { WidgetSpec } from "../../src/widgets/spec";
import { WidgetHost } from "../../src/widgets/WidgetHost";
import { fixture, fixtureDir } from "./setup";

type Props = Partial<Omit<WidgetProps, "entry" | "view">>;

export function entryOf(spec: unknown, slug = "test-widget"): WidgetEntry {
  const s = WidgetSpec.parse(spec);
  return { slug, name: "Test Widget", type: s.type, spec: s, illustrates: [], notation: [] };
}

export const block = (extra: Partial<InteractiveBlock> = {}): InteractiveBlock => ({ t: "interactive", widget: "test-widget", ...extra });

let counter = 0;

/** A dataset the tests serve from memory. Each gets its own file name: the widgets cache a file for the page's life. */
export function memoryDataset(id: string, csv: string, extra: Partial<DatasetMeta> = {}): { meta: DatasetMeta; files: Record<string, string> } {
  const src = `assets/data/${id}-${++counter}.csv`;
  return { meta: { id, title: `Dataset ${id}`, src, format: "csv", columns: {}, ...extra }, files: { [src]: csv } };
}

export type Served = { calls: string[] };

/** Replaces fetch: `files` maps a content-relative path to text; everything else is a 404. */
export function serve(files: Record<string, string>, contentBase = ""): Served {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const text = files[url.slice(contentBase.length)];
    return { ok: text !== undefined, status: text === undefined ? 404 : 200, text: async () => text ?? "" };
  });
  return { calls };
}

/** Serves everything the fixture export holds (dataset files under assets/data/), after `hold` resolves if given. */
export function serveFixture(hold?: Promise<unknown>): Served {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    await hold;
    try {
      const text = readFileSync(path.join(fixtureDir(), url), "utf8");
      return { ok: true, status: 200, text: async () => text };
    } catch {
      return { ok: false, status: 404, text: async () => "" };
    }
  });
  return { calls };
}

export async function mount(entry: WidgetEntry, view: InteractiveBlock | null = null, props: Props = {}, datasets: Record<string, DatasetMeta> = fixture().index.datasets) {
  const ui = (v: InteractiveBlock | null, p: Props = props) => <WidgetHost entry={entry} view={v} datasets={datasets} contentBase="" {...p} />;
  const r = render(ui(view));
  const c = r.container;
  return {
    c,
    rerender: (v: InteractiveBlock | null, p?: Props) => r.rerender(ui(v, p)),
    /** Waits until the widget itself (not its skeleton, loading or error card) is drawn. */
    ready: () => waitFor(() => expect(c.querySelector(".w-plot, .w-square")).not.toBeNull()),
    el: (id: string) => c.querySelector(`[data-el="${id}"]`),
    slider: (id: string) => c.querySelector<HTMLInputElement>(`[data-param="${id}"] input`)!,
    readout: (id: string) => c.querySelector(`[data-readout="${id}"] output`)?.textContent ?? null,
    move: (id: string, v: number) => fireEvent.change(c.querySelector<HTMLInputElement>(`[data-param="${id}"] input`)!, { target: { value: String(v) } }),
    button: (text: RegExp) => [...c.querySelectorAll("button")].find((b) => text.test(b.textContent ?? "")),
  };
}

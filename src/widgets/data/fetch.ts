// Fetching datasets for the live widgets. One request per file for the life of the page; a failed request is
// forgotten so "Try again" really tries again.
import { useCallback, useEffect, useState } from "react";
import type { DatasetMeta } from "../../ir";
import { parseTable, type Table } from "./table";

const cache = new Map<string, Promise<Table>>();

export function loadDataset(meta: DatasetMeta, contentBase: string): Promise<Table> {
  const url = `${contentBase}${meta.src}`;
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`${meta.src} could not be loaded (HTTP ${res.status})`);
        return parseTable(await res.text(), meta.format);
      })
      .catch((e: unknown) => {
        cache.delete(url);
        throw e instanceof Error ? e : new Error(String(e));
      });
    cache.set(url, p);
  }
  return p;
}

export type DatasetState =
  | { status: "loading" }
  | { status: "ready"; table: Table; meta: DatasetMeta }
  | { status: "error"; message: string; retry: () => void };

export function useDataset(id: string, datasets: Record<string, DatasetMeta>, contentBase: string): DatasetState {
  const meta = datasets[id];
  const [state, setState] = useState<{ key: string; table?: Table; error?: string }>({ key: "" });
  const [attempt, setAttempt] = useState(0);
  const key = `${contentBase}${meta?.src ?? ""}|${attempt}`;

  useEffect(() => {
    if (!meta) return;
    let live = true;
    loadDataset(meta, contentBase).then(
      (table) => live && setState({ key, table }),
      (e: Error) => live && setState({ key, error: e.message }),
    );
    return () => {
      live = false;
    };
    // `meta` is looked up by id; its identity changes only when the export does.
  }, [meta, contentBase, key]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  if (!meta) return { status: "error", message: `The dataset '${id}' is not in this lesson's data (index.json lists none by that id).`, retry };
  if (state.key !== key) return { status: "loading" };
  if (state.table) return { status: "ready", table: state.table, meta };
  return { status: "error", message: state.error ?? "unknown error", retry };
}

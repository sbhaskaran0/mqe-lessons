// Datasets whose numbers were read off a published chart rather than computed carry that in their registry
// description ("values read off Figure 3", "approximate"). The widgets then show them with ≈, as the vault does.
import type { DatasetMeta } from "../../ir";

const READ_OFF = /\b(approximate(ly)?|approx\.?|read (off|from|by eye)|eyeball(ed)?|digiti[sz]ed|chart[- ]read|estimated from (the |a )?(chart|figure|graph|plot))\b/i;

export function isApproximate(meta: DatasetMeta | undefined): boolean {
  return !!meta?.description && READ_OFF.test(meta.description);
}

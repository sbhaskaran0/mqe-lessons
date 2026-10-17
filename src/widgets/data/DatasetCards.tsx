// What a dataset-backed widget shows before its data is in: a quiet loading card, or a readable error with a way to
// try again. Both keep the widget's frame so the page doesn't jump when the data arrives.
import "./data.css";
import type { WidgetEntry } from "../../ir";
import { WidgetNotice } from "../ui/WidgetFrame";

export function DatasetLoading({ entry }: { entry: WidgetEntry }) {
  return (
    <WidgetNotice entry={entry} tone="info" title="Loading the data…">
      <div className="w-data-loading" aria-busy="true" aria-live="polite" />
    </WidgetNotice>
  );
}

export function DatasetError({ entry, message, retry }: { entry: WidgetEntry; message: string; retry?: () => void }) {
  return (
    <WidgetNotice entry={entry} tone="error" title="The data for this widget couldn't be used.">
      <ul className="w-problems">
        <li>{message}</li>
      </ul>
      {retry ? (
        <div>
          <button type="button" className="w-btn" onClick={retry}>
            Try again
          </button>
        </div>
      ) : (
        <p className="w-notice-fix">
          Check <code>_data/registry.yaml</code> and the widget's spec in <code>Interactives/{entry.name}.md</code>, then re-export.
        </p>
      )}
    </WidgetNotice>
  );
}

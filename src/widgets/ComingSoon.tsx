// Registry stand-in for widget types that arrive in phase 3 (data-chart, distribution, custom).
import type { WidgetProps } from "./host";
import { WidgetNotice } from "./ui/WidgetFrame";

const WHAT: Record<string, string> = {
  "data-chart": "Dataset charts",
  distribution: "Distribution widgets",
  custom: "Custom widgets",
};

export default function ComingSoon({ entry }: WidgetProps) {
  return (
    <WidgetNotice entry={entry} tone="info" title={`${WHAT[entry.type] ?? "This widget type"} are coming in phase 3.`}>
      <p>
        <span className="w-notice-type">{entry.type}</span> {entry.spec.title ?? entry.name} will be interactive here once its runtime lands.
      </p>
    </WidgetNotice>
  );
}

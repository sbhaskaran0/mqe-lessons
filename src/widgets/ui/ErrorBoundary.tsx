// A widget that throws while rendering shows a readable card instead of blanking the visual pane.
import { Component, type ReactNode } from "react";
import type { WidgetEntry } from "../../ir";
import { WidgetNotice } from "./WidgetFrame";

type Props = { entry: WidgetEntry; children: ReactNode };
type State = { error: Error | null };

export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidUpdate(prev: Props) {
    // A corrected spec (live re-export in dev) gets a fresh attempt.
    if (this.state.error && prev.entry !== this.props.entry) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <WidgetError entry={this.props.entry} problems={[error.message]} />;
  }
}

export function WidgetError({ entry, problems }: { entry: WidgetEntry; problems: string[] }) {
  return (
    <WidgetNotice entry={entry} tone="error" title="This widget couldn't be drawn.">
      <ul className="w-problems">
        {problems.slice(0, 8).map((p, i) => (
          <li key={i}>{p}</li>
        ))}
        {problems.length > 8 ? <li>…and {problems.length - 8} more</li> : null}
      </ul>
      <p className="w-notice-fix">
        Fix the spec in <code>Interactives/{entry.name}.md</code> and re-export.
      </p>
    </WidgetNotice>
  );
}

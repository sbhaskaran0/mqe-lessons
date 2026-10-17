// Catches render and loading errors so one bad note never blanks the whole app.
import { Component, type ReactNode } from "react";
import { ContentError } from "../content/store";

type Props = { children: ReactNode; fallback?: (error: Error, reset: () => void) => ReactNode };

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  reset = () => this.setState({ error: null });

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return this.props.fallback ? this.props.fallback(error, this.reset) : <ErrorNotice error={error} />;
  }
}

export function ErrorNotice({ error }: { error: Error }) {
  const content = error instanceof ContentError;
  return (
    <div className="error-notice" role="alert">
      <h2>{content ? "This content could not be loaded" : "Something went wrong on this page"}</h2>
      <pre className="error-message">{error.message}</pre>
      <p>
        {content
          ? "If you are running the dev server, check its terminal for export errors, then reload."
          : "Reloading usually fixes it. Your progress is saved."}
      </p>
      <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}

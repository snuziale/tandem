import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Card } from "@uipath/apollo-wind";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error(error, info.componentStack);
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  reload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    const message = error.message ?? String(error);
    const truncated =
      message.length > 300 ? `${message.slice(0, 300)}…` : message;

    return (
      <div className="flex-1 min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-lg w-full p-6 gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Something went wrong
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              The app hit an unexpected error. Reloading usually fixes it.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={this.reset}>Try again</Button>
            <Button variant="secondary" onClick={this.reload}>
              Reload
            </Button>
          </div>
          <pre className="font-mono text-xs text-muted-foreground whitespace-pre-wrap break-words">
            {truncated}
          </pre>
        </Card>
      </div>
    );
  }
}

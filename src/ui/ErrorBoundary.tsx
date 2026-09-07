import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  name: string;
  silent?: boolean;
  onClose?: () => void;
}

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.silent) return null;
    return (
      <div className="component-error" role="alert">
        <p>{this.props.name} could not be displayed. Reload to try again; unsaved edits may be lost.</p>
        <button type="button" onClick={() => window.location.reload()}>
          RELOAD
        </button>
        {this.props.onClose && (
          <button type="button" onClick={this.props.onClose}>
            CLOSE
          </button>
        )}
      </div>
    );
  }
}

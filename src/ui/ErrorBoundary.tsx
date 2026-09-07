import { Component, type ReactNode } from "react";
import { reportUiError } from "./uiErrors";

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

  componentDidCatch() {
    if (!this.props.silent) reportUiError(`${this.props.name} could not be displayed. Unsaved edits may not have been saved.`);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.silent) return null;
    return (
      <div className={`component-error ${this.props.name === "Firstlight" ? "root-error-toast" : ""}`} role="alert">
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

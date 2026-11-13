// ErrorBoundary: a tab that cannot be drawn must never blank the page — the header, banner and tab strip stay and
// this says so. Clears when `resetKey` changes or the visitor presses Try again. Family shared service
// (owner, 2026-11-13): vendor it, never edit a lab's copy.
import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(prev) { if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false }); } // eslint-disable-line react/no-did-update-set-state
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app-error" role="alert" data-testid={this.props.testId || "tab-crash"}>
        <p>{this.props.message || "This tab could not be drawn. Nothing was lost: the rest of the lab still works."}</p>
        <button type="button" onClick={() => this.setState({ failed: false })}>Try again</button>
      </div>
    );
  }
}

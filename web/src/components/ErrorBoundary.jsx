import { Component } from "react";

// A tab that cannot be drawn must never blank the page: the header, the banner and the tab strip stay, and this says so. The boundary clears when
// `resetKey` changes (another tab, another vertical) or when the visitor presses Try again.
export default class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(prev) { if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false }); } // eslint-disable-line react/no-did-update-set-state
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app-error" role="alert" data-testid="tab-crash">
        <p>This tab could not be drawn. Nothing was lost: the rest of the lab still works.</p>
        <button type="button" onClick={() => this.setState({ failed: false })}>Try again</button>
      </div>
    );
  }
}

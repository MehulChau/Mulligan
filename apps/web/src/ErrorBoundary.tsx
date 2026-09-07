import { Component, type ErrorInfo, type ReactNode } from "react";
import { clearPersistedRoundState } from "./persistence/roundStorage";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Wraps the canvas + round view (the part of the UI that renders live game
 * state every shot) -- a rendering exception there must not white-screen
 * the whole app mid-session. Deliberately does NOT wrap TopBar/SettingsSheet:
 * if the round view itself is what broke, the player can still reach
 * Settings to export their session before reloading.
 *
 * A class component because React only calls getDerivedStateFromError/
 * componentDidCatch on classes -- there's no hook equivalent for catching
 * render errors from *children*.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("Round view crashed:", error, info.componentStack);
  }

  private handleResume = () => {
    // The saved round is still in IndexedDB untouched -- a reload re-runs
    // App's normal boot-time resume check against it, the same path a
    // fresh page load always takes. No boundary-specific recovery logic
    // needed.
    window.location.reload();
  };

  private handleNewRound = () => {
    clearPersistedRoundState().finally(() => window.location.reload());
  };

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <p>
            The round view hit an error and couldn't keep going: <code>{this.state.error.message}</code>
          </p>
          <p>Your progress up to the last shot was saved.</p>
          <div className="error-boundary-actions">
            <button type="button" className="hit" onClick={this.handleResume}>
              Reload and resume
            </button>
            <button type="button" className="device-action device-action-quiet" onClick={this.handleNewRound}>
              Start a new round instead
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

import { Component, type ReactNode } from "react";
import { t } from "../i18n";
import type { Lang } from "../types";

type Props = { lang: Lang; children: ReactNode };
type State = { failed: boolean; attempt: number };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  private recover = (): void => {
    this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }));
  };

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="card crash" role="alert">
          <p>{t(this.props.lang, "viewCrashed")}</p>
          <div className="actions">
            <button className="btn primary" onClick={this.recover}>
              {t(this.props.lang, "retry")}
            </button>
          </div>
        </div>
      );
    }
    return <div key={this.state.attempt} className="boundary">{this.props.children}</div>;
  }
}

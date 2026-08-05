import React from "react";
import ReactDOM from "react-dom/client";

import { resolveAuxiliarySurface, type AuxiliarySurface } from "./auxiliarySurface";
import {
  captureSentryException,
  scheduleSentryInitialization,
} from "./lib/observability/sentryClient";
import "./styles/tokens-base.css";
import "./styles/companion.css";
import "./styles/companion-pill.css";

declare global {
  interface Window {
    __DRIFTY_BOOTSTRAPPED__?: boolean;
  }
}

type AuxiliaryComponent = React.ComponentType;

class AuxiliaryErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    captureSentryException(error, {
      tags: { surface: "auxiliary", phase: "react_render" },
      extra: { componentStack: errorInfo.componentStack ?? "" },
    });
  }

  render() {
    if (this.state.error) {
      return <AuxiliaryError message={this.state.error.message} />;
    }
    return this.props.children;
  }
}

function AuxiliaryLoader({ surface }: { readonly surface: AuxiliarySurface }) {
  const [LoadedSurface, setLoadedSurface] = React.useState<AuxiliaryComponent | null>(null);

  React.useEffect(() => {
    let active = true;
    void loadAuxiliaryComponent(surface)
      .then((component) => {
        if (active) setLoadedSurface(() => component);
      })
      .catch((error) => {
        captureSentryException(error, {
          tags: { surface, phase: "startup" },
        });
        if (!active) return;
        const message = error instanceof Error ? error.message : String(error);
        setLoadedSurface(() => () => <AuxiliaryError message={message} />);
      });
    return () => {
      active = false;
    };
  }, [surface]);

  React.useEffect(() => {
    if (!LoadedSurface) return;
    window.__DRIFTY_BOOTSTRAPPED__ = true;
    scheduleSentryInitialization();
  }, [LoadedSurface]);

  return LoadedSurface ? <LoadedSurface /> : null;
}

function AuxiliaryError({ message }: { readonly message: string }) {
  return (
    <div className="bootstrap-error">
      <h1>Drifty companion failed to render</h1>
      <pre>{message}</pre>
    </div>
  );
}

async function loadAuxiliaryComponent(surface: AuxiliarySurface): Promise<AuxiliaryComponent> {
  if (surface === "watcher") {
    return (await import("./features/companion/WatcherWindowApp")).WatcherWindowApp;
  }
  if (surface === "companion") {
    return (await import("./features/companion/CompanionWindowApp")).CompanionWindowApp;
  }
  return (await import("./features/companion/DriftAlarmWindowApp")).DriftAlarmWindowApp;
}

const surface = resolveAuxiliarySurface(window.location.search);
if (surface) {
  document.documentElement.dataset.surface = surface;
}

window.addEventListener("unhandledrejection", (event) => {
  captureSentryException(event.reason, {
    tags: { surface: surface ?? "auxiliary", phase: window.__DRIFTY_BOOTSTRAPPED__ ? "runtime_rejection" : "startup_rejection" },
  });
});

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <AuxiliaryErrorBoundary>
        {surface ? <AuxiliaryLoader surface={surface} /> : <AuxiliaryError message="Unknown auxiliary surface" />}
      </AuxiliaryErrorBoundary>
    </React.StrictMode>,
  );
}

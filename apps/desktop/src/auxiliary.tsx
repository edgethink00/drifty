import { AuxiliaryLocalizationProvider } from "./features/localization/AuxiliaryLocalizationProvider";
import React from "react";
import ReactDOM from "react-dom/client";

import { resolveAuxiliarySurface, type AuxiliarySurface } from "./auxiliarySurface";
import {
  captureSentryException,
  scheduleSentryInitialization,
} from "./lib/observability/sentryClient";
import { DEV_SETTINGS_ENABLED } from "./appFeatureSwitches";
import { DEV_MODE_STORAGE_KEY } from "./features/settings/settingsStorage";
import { installDarkPalettePreviewStorageSync } from "./features/settings/darkPalettePreview";
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
  throw new Error(`Unknown auxiliary surface: ${String(surface)}`);
}

const surface = resolveAuxiliarySurface(window.location.search);
if (surface) {
  document.documentElement.dataset.surface = surface;
}
installDarkPalettePreviewStorageSync(
  window,
  document.documentElement,
  DEV_SETTINGS_ENABLED,
  DEV_MODE_STORAGE_KEY,
);

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
        <AuxiliaryLocalizationProvider>
          {surface ? <AuxiliaryLoader surface={surface} /> : <AuxiliaryError message="Unknown auxiliary surface" />}
        </AuxiliaryLocalizationProvider>
      </AuxiliaryErrorBoundary>
    </React.StrictMode>,
  );
}

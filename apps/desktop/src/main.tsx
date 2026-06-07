import React from "react";
import ReactDOM from "react-dom/client";

import "./styles.css";

type BootstrapSurface = "app" | "watcher" | "drift-alarm";

declare global {
  interface Window {
    __DRIFTY_BOOTSTRAPPED__?: boolean;
    __DRIFTY_SET_BOOT_STATUS__?: (message: string) => void;
  }
}

window.__DRIFTY_SET_BOOT_STATUS__ = (message: string) => {
  const shell = document.getElementById("boot-shell");
  if (shell) shell.dataset.bootStatus = message;
};
window.__DRIFTY_SET_BOOT_STATUS__?.("main.tsx loaded");
const initialSurface = resolveLocationSurface(window.location);
if (initialSurface !== "app") document.documentElement.dataset.surface = initialSurface;

class BootstrapErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="bootstrap-error">
          <h1>Drifty failed to render</h1>
          <pre>{this.state.error.message}</pre>
        </div>
      );
    }

    return this.props.children;
  }
}

function BootstrapLoader() {
  const [LoadedApp, setLoadedApp] = React.useState<React.ComponentType | null>(null);

  React.useEffect(() => {
    window.__DRIFTY_SET_BOOT_STATUS__?.("Bootstrap shell mounted");

    const start = async () => {
      try {
        await waitForFirstFrameOrFallback();
        const nextSurface = await resolveBootstrapSurface();

        if (nextSurface === "watcher") {
          window.__DRIFTY_SET_BOOT_STATUS__?.("Importing watcher module…");
          const mod = await import("./features/companion/WatcherWindowApp");
          window.__DRIFTY_SET_BOOT_STATUS__?.("Watcher module imported");
          setLoadedApp(() => mod.WatcherWindowApp);
          return;
        }

        if (nextSurface === "drift-alarm") {
          window.__DRIFTY_SET_BOOT_STATUS__?.("Importing drift alarm module…");
          const mod = await import("./features/companion/DriftAlarmWindowApp");
          window.__DRIFTY_SET_BOOT_STATUS__?.("Drift alarm module imported");
          setLoadedApp(() => mod.DriftAlarmWindowApp);
          return;
        }

        window.__DRIFTY_SET_BOOT_STATUS__?.("Importing App module…");
        const [{ AuthProvider }, { initializePostHog }, mod] = await Promise.all([
          import("./features/auth/AuthContext"),
          import("./lib/analytics/posthog"),
          import("./App"),
        ]);
        initializePostHog();
        window.__DRIFTY_SET_BOOT_STATUS__?.("App module imported");
        const App = mod.default;
        setLoadedApp(() => function AppWithAuthProvider() {
          return (
            <AuthProvider>
              <App />
            </AuthProvider>
          );
        });
      } catch (error) {
        const root = document.getElementById("root");
        if (!root) return;
        root.replaceChildren(createBootstrapErrorElement("Drifty startup error", toSafeErrorMessage(error)));
      }
    };

    void start();
  }, []);

  React.useEffect(() => {
    if (LoadedApp) {
      window.__DRIFTY_SET_BOOT_STATUS__?.("App component ready");
      window.__DRIFTY_BOOTSTRAPPED__ = true;
      document.getElementById("boot-shell")?.remove();
      document.getElementById("boot-error")?.remove();
    }
  }, [LoadedApp]);

  if (!LoadedApp) return null;
  return <LoadedApp />;
}

function resolveLocationSurface(location: Pick<Location, "pathname" | "search">): BootstrapSurface {
  const requestedSurface = new URLSearchParams(location.search).get("driftySurface");
  if (requestedSurface === "watcher" || requestedSurface === "drift-alarm") return requestedSurface;
  if (location.pathname === "/watcher") return "watcher";
  if (location.pathname === "/drift-alarm") return "drift-alarm";
  return "app";
}

async function resolveBootstrapSurface(): Promise<BootstrapSurface> {
  const locationSurface = resolveLocationSurface(window.location);
  if (locationSurface !== "app") return locationSurface;
  if (!("__TAURI_INTERNALS__" in window)) return "app";

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const label = getCurrentWindow().label;
    if (label === "watcher-peek") return "watcher";
    if (label === "drift-alarm") return "drift-alarm";
    return "app";
  } catch {
    return "app";
  }
}

function resolveCurrentSurface(): BootstrapSurface {
  const documentSurface = document.documentElement.dataset.surface;
  if (documentSurface === "watcher" || documentSurface === "drift-alarm") return documentSurface;
  return resolveLocationSurface(window.location);
}

function createBootstrapErrorElement(title: string, message: string) {
  const element = document.createElement("div");
  element.className = "bootstrap-error";
  setBootstrapErrorContent(element, title, message);
  return element;
}

function setBootstrapErrorContent(element: HTMLElement, title: string, message: string) {
  const heading = document.createElement("h1");
  heading.textContent = title;

  const detail = document.createElement("pre");
  detail.textContent = message;

  element.replaceChildren(heading, detail);
}

function toSafeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function upsertLateBootstrapDiagnostic(message: string) {
  const existingDiagnostic = document.querySelector<HTMLElement>('body > .bootstrap-error[data-bootstrap-diagnostic="late-rejection"]');
  const diagnostic = existingDiagnostic ?? createBootstrapErrorElement("Drifty background error", message);
  diagnostic.dataset.bootstrapDiagnostic = "late-rejection";
  setBootstrapErrorContent(diagnostic, "Drifty background error", message);
  if (!existingDiagnostic) document.body.append(diagnostic);
}

window.addEventListener("unhandledrejection", (event) => {
  const root = document.getElementById("root");
  if (!root) return;
  const message = toSafeErrorMessage(event.reason);
  const surface = resolveCurrentSurface();

  if (window.__DRIFTY_BOOTSTRAPPED__ && (surface === "watcher" || surface === "drift-alarm")) {
    event.preventDefault();
    upsertLateBootstrapDiagnostic(message);
    return;
  }

  root.replaceChildren(createBootstrapErrorElement("Drifty startup error", message));
});

function waitForFirstFrameOrFallback(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const timeoutId = window.setTimeout(finish, 48);

    window.requestAnimationFrame(() => {
      window.clearTimeout(timeoutId);
      finish();
    });
  });
}

const root = document.getElementById("root");
if (root) {
  window.__DRIFTY_SET_BOOT_STATUS__?.("React root found");
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <BootstrapErrorBoundary>
        <BootstrapLoader />
      </BootstrapErrorBoundary>
    </React.StrictMode>,
  );
  window.__DRIFTY_SET_BOOT_STATUS__?.("React render scheduled");
}

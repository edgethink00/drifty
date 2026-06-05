import React from "react";
import ReactDOM from "react-dom/client";

import { AuthProvider } from "./features/auth/AuthContext";
import { initializePostHog } from "./lib/analytics/posthog";
import "./styles.css";

declare global {
  interface Window {
    __DTIME_BOOTSTRAPPED__?: boolean;
    __DTIME_SET_BOOT_STATUS__?: (message: string) => void;
  }
}

window.__DTIME_SET_BOOT_STATUS__ = (message: string) => {
  const shell = document.getElementById("boot-shell");
  if (shell) shell.dataset.bootStatus = message;
};
window.__DTIME_SET_BOOT_STATUS__?.("main.tsx loaded");
initializePostHog();

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
  const [isWatcherSurface, setIsWatcherSurface] = React.useState(window.location.pathname === "/watcher");

  React.useEffect(() => {
    window.__DTIME_SET_BOOT_STATUS__?.("Bootstrap shell mounted");

    const start = async () => {
      try {
        await waitForFirstFrameOrFallback();
        const nextIsWatcherSurface = await resolveIsWatcherSurface();
        setIsWatcherSurface(nextIsWatcherSurface);

        if (nextIsWatcherSurface) {
          window.__DTIME_SET_BOOT_STATUS__?.("Importing watcher module…");
          const mod = await import("./features/companion/WatcherWindowApp");
          window.__DTIME_SET_BOOT_STATUS__?.("Watcher module imported");
          setLoadedApp(() => mod.WatcherWindowApp);
          return;
        }

        window.__DTIME_SET_BOOT_STATUS__?.("Importing App module…");
        const mod = await import("./App");
        window.__DTIME_SET_BOOT_STATUS__?.("App module imported");
        setLoadedApp(() => mod.default);
      } catch (error) {
        const root = document.getElementById("root");
        if (!root) return;
        root.innerHTML = `<div class="bootstrap-error"><h1>Drifty startup error</h1><pre>${String(
          error instanceof Error ? error.message : error,
        )}</pre></div>`;
      }
    };

    void start();
  }, []);

  React.useEffect(() => {
    if (LoadedApp) {
      window.__DTIME_SET_BOOT_STATUS__?.("App component ready");
      window.__DTIME_BOOTSTRAPPED__ = true;
      document.getElementById("boot-shell")?.remove();
    }
  }, [LoadedApp]);

  if (!LoadedApp) return null;
  if (isWatcherSurface) return <LoadedApp />;

  return (
    <AuthProvider>
      <LoadedApp />
    </AuthProvider>
  );
}

async function resolveIsWatcherSurface(): Promise<boolean> {
  if (window.location.pathname === "/watcher") return true;
  if (!("__TAURI_INTERNALS__" in window)) return false;

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().label === "watcher-peek";
  } catch {
    return false;
  }
}

window.addEventListener("unhandledrejection", (event) => {
  const root = document.getElementById("root");
  if (!root) return;
  const reason = event.reason as { message?: string } | string | undefined;
  root.innerHTML = `<div class="bootstrap-error"><h1>Drifty startup error</h1><pre>${String(
    typeof reason === "string" ? reason : reason?.message ?? event.reason,
  )}</pre></div>`;
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
  window.__DTIME_SET_BOOT_STATUS__?.("React root found");
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <BootstrapErrorBoundary>
        <BootstrapLoader />
      </BootstrapErrorBoundary>
    </React.StrictMode>,
  );
  window.__DTIME_SET_BOOT_STATUS__?.("React render scheduled");
}

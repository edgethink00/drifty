import React from "react";
import ReactDOM from "react-dom/client";

import {
  captureSentryException,
  scheduleSentryInitialization,
} from "./lib/observability/sentryClient";
import {
  applyRejectionAction,
  resolveRejectionAction,
  resolveRejectionPhase,
  type ResolvedBootstrapSurface,
} from "./lib/bootstrap/rejectionAction";
import "./styles.css";
import "./features/dashboard/dashboard.css";
import "./features/dashboard/compact-charts.css";
import "./features/flow-chart/flow-chart.css";
import "./features/dashboard/week-dashboard.css";
import "./features/dashboard/month-calendar.css";
import "./features/insights/insights.css";
import "./features/loading/loading-skeletons.css";
import "./features/leaderboard/leaderboard.css";
import "./features/leaderboard/rank-embeds.css";
import "./features/share/share-card.css";
import "./features/profile/profile-page.css";
import "./styles/chartHoverMotion.css";
import "./styles/modal-chrome.css";
import { hideBootShell } from "./features/loading/bootShell";

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
// Browser-only builds (dev:web QA, static demo) have no native window material,
// so the shell keeps a CSS blur fallback. Marking the document here lets the
// stylesheet scope that fallback without touching the packaged app path.
if (!("__TAURI_INTERNALS__" in window)) document.documentElement.dataset.runtime = "browser";

class BootstrapErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    captureSentryException(error, {
      tags: { surface: "bootstrap", phase: "react_render" },
      extra: { componentStack: errorInfo.componentStack ?? "" },
    });
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
  const shouldInitializePostHogRef = React.useRef(false);

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

        if (nextSurface === "companion") {
          window.__DRIFTY_SET_BOOT_STATUS__?.("Importing companion module…");
          const mod = await import("./features/companion/CompanionWindowApp");
          window.__DRIFTY_SET_BOOT_STATUS__?.("Companion module imported");
          setLoadedApp(() => mod.CompanionWindowApp);
          return;
        }

        if (nextSurface === "drift-alarm") {
          window.__DRIFTY_SET_BOOT_STATUS__?.("Importing drift alarm module…");
          const mod = await import("./features/companion/DriftAlarmWindowApp");
          window.__DRIFTY_SET_BOOT_STATUS__?.("Drift alarm module imported");
          setLoadedApp(() => mod.DriftAlarmWindowApp);
          return;
        }

        if (nextSurface === "pet-mode") {
          window.__DRIFTY_SET_BOOT_STATUS__?.("Importing Pet Mode module…");
          const mod = await import("./features/pet-mode/PetModeWindowApp");
          window.__DRIFTY_SET_BOOT_STATUS__?.("Pet Mode module imported");
          setLoadedApp(() => mod.PetModeWindowApp);
          return;
        }

        if (import.meta.env.DEV && nextSurface === "privacy-review-concepts") {
          window.__DRIFTY_SET_BOOT_STATUS__?.("Importing privacy review concepts…");
          const mod = await import("./features/settings/AiPrivacyReviewConceptsApp");
          window.__DRIFTY_SET_BOOT_STATUS__?.("Privacy review concepts imported");
          setLoadedApp(() => mod.AiPrivacyReviewConceptsApp);
          return;
        }

        window.__DRIFTY_SET_BOOT_STATUS__?.("Importing App module…");
        const [{ AuthProvider }, mod] = await Promise.all([
          import("./features/auth/AuthContext"),
          import("./App"),
        ]);
        window.__DRIFTY_SET_BOOT_STATUS__?.("App module imported");
        const App = mod.default;
        shouldInitializePostHogRef.current = true;
        setLoadedApp(() => function AppWithAuthProvider() {
          return (
            <AuthProvider>
              <App />
            </AuthProvider>
          );
        });
      } catch (error) {
        captureSentryException(error, {
          tags: { surface: "bootstrap", phase: "startup" },
        });
        const root = document.getElementById("root");
        if (!root) return;
        const message = error instanceof Error ? error.message : toSafeErrorMessage(error);
        root.replaceChildren(createBootstrapErrorElement("Drifty startup error", message));
      }
    };

    void start();
  }, []);

  React.useEffect(() => {
    if (LoadedApp) {
      window.__DRIFTY_SET_BOOT_STATUS__?.("App component ready");
      window.__DRIFTY_BOOTSTRAPPED__ = true;
      hideBootShell();
      document.getElementById("boot-error")?.remove();
      if (shouldInitializePostHogRef.current) {
        void import("./lib/analytics/posthogClient")
          .then(({ schedulePostHogInitialization }) => schedulePostHogInitialization())
          .catch((error) => {
            captureSentryException(error, {
              tags: { surface: "bootstrap", phase: "posthog_schedule" },
            });
          });
      }
      scheduleSentryInitialization();
    }
  }, [LoadedApp]);

  if (!LoadedApp) return null;
  return <LoadedApp />;
}

function resolveLocationSurface(location: Pick<Location, "pathname" | "search">): ResolvedBootstrapSurface {
  const requestedSurface = new URLSearchParams(location.search).get("driftySurface");
  if (
    requestedSurface === "watcher"
    || requestedSurface === "companion"
    || requestedSurface === "drift-alarm"
    || requestedSurface === "pet-mode"
  ) return requestedSurface;
  if (import.meta.env.DEV && requestedSurface === "privacy-review-concepts") return requestedSurface;
  if (location.pathname === "/watcher") return "watcher";
  if (location.pathname === "/companion") return "companion";
  if (location.pathname === "/drift-alarm") return "drift-alarm";
  if (location.pathname === "/pet-mode") return "pet-mode";
  return "app";
}

async function resolveBootstrapSurface(): Promise<ResolvedBootstrapSurface> {
  const locationSurface = resolveLocationSurface(window.location);
  if (locationSurface !== "app") return locationSurface;
  if (!("__TAURI_INTERNALS__" in window)) return "app";

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const label = getCurrentWindow().label;
    if (label === "watcher-peek") return "watcher";
    if (label === "companion-pill") return "companion";
    if (label === "drift-alarm") return "drift-alarm";
    if (label === "pet-mode") return "pet-mode";
    return "app";
  } catch {
    return "app";
  }
}

function resolveCurrentSurface(): ResolvedBootstrapSurface {
  const documentSurface = document.documentElement.dataset.surface;
  if (
    documentSurface === "watcher"
    || documentSurface === "companion"
    || documentSurface === "drift-alarm"
    || documentSurface === "pet-mode"
  ) {
    return documentSurface;
  }
  if (import.meta.env.DEV && documentSurface === "privacy-review-concepts") {
    return documentSurface;
  }
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
  const message = toSafeErrorMessage(event.reason);
  const surface = resolveCurrentSurface();
  const bootstrapped = Boolean(window.__DRIFTY_BOOTSTRAPPED__);
  const phase = resolveRejectionPhase(bootstrapped);

  // Every rejection is captured for observability regardless of phase/surface.
  captureSentryException(event.reason, {
    tags: { surface, phase: `${phase}_rejection` },
  });

  // Keep action selection centralized so runtime app rejections cannot replace
  // the live React tree with the startup error surface.
  applyRejectionAction(resolveRejectionAction({ bootstrapped, surface }), event, message, {
    getRoot: () => document.getElementById("root"),
    createErrorElement: createBootstrapErrorElement,
    showLateDiagnostic: upsertLateBootstrapDiagnostic,
  });
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

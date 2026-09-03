/**
 * Testable decision and DOM-application helpers for the global
 * `unhandledrejection` handler in `main.tsx`. Only pre-bootstrap rejections may
 * replace the boot root; runtime rejections on the main app preserve its UI.
 */

export type BootstrapSurface = "app" | "watcher" | "companion" | "pet-mode" | "pet-quick-controls";
export type ResolvedBootstrapSurface = BootstrapSurface | "privacy-review-concepts";

export type RejectionPhase = "startup" | "runtime";

/**
 * What the handler should do once it has resolved the bootstrap phase and the
 * active surface.
 *
 * - `startup-error`: replace `#root` with the bootstrap error surface. Only
 *   valid before bootstrap completes.
 * - `late-diagnostic`: keep the existing companion-window overlay behavior
 *   (`preventDefault` + append a diagnostic element to `<body>`).
 * - `preserve`: leave the DOM untouched. Used for runtime rejections on the
 *   main app surface so the live React tree is never replaced.
 */
export type RejectionAction = "startup-error" | "late-diagnostic" | "preserve";

export interface RejectionDecisionInput {
  bootstrapped: boolean;
  surface: ResolvedBootstrapSurface;
}

/**
 * Map the bootstrap boundary flag to the observability phase tag suffix.
 * Callers compose the full Sentry tag as `${phase}_rejection`.
 */
export function resolveRejectionPhase(bootstrapped: boolean): RejectionPhase {
  return bootstrapped ? "runtime" : "startup";
}

/**
 * Pure decision: given the bootstrap boundary and the active surface, pick the
 * safe action for an unhandled promise rejection.
 *
 * - Not yet bootstrapped -> any rejection is fatal to startup.
 * - Bootstrapped main app / privacy-review surface -> preserve the React tree.
 * - Bootstrapped companion surfaces (watcher / companion) -> late diagnostic.
 */
export function resolveRejectionAction(input: RejectionDecisionInput): RejectionAction {
  if (!input.bootstrapped) return "startup-error";
  if (
    input.surface === "watcher"
    || input.surface === "companion"
    || input.surface === "pet-mode"
    || input.surface === "pet-quick-controls"
  ) return "late-diagnostic";
  return "preserve";
}

export interface RejectionHandlerDom {
  /** Resolve the boot root element (`document.getElementById("root")`). */
  getRoot: () => HTMLElement | null;
  /** Build the bootstrap error element shown on the startup-failure surface. */
  createErrorElement: (title: string, message: string) => HTMLElement;
  /** Show the non-fatal late-diagnostic overlay for companion windows. */
  showLateDiagnostic: (message: string) => void;
}

/**
 * Apply a resolved rejection action. Only the `startup-error` path touches
 * `#root`, so the bootstrapped main app tree is never replaced by a late
 * rejection. `preserve` is a complete no-op relative to the DOM.
 */
export function applyRejectionAction(
  action: RejectionAction,
  event: { preventDefault: () => void },
  message: string,
  dom: RejectionHandlerDom,
): void {
  if (action === "preserve") return;

  if (action === "late-diagnostic") {
    event.preventDefault();
    dom.showLateDiagnostic(message);
    return;
  }

  const root = dom.getRoot();
  if (!root) return;
  root.replaceChildren(dom.createErrorElement("Drifty startup error", message));
}

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { ModalPresenceContext, MODAL_MOTION_PANEL_SELECTOR, ownModalElements } from "../lib/modalPresenceContext";
import { useModalDismiss } from "../lib/useModalDismiss";
import { useModalFocusTrap } from "../lib/useModalFocusTrap";
import "./modal-presence.css";

// Read the actual transition budget; CSS is the source of timing values.
function exitFallbackMs(root: HTMLElement | null): number {
  const panel = root ? ownModalElements(root, MODAL_MOTION_PANEL_SELECTOR)[0] : null;
  if (!panel) return 0;
  const style = window.getComputedStyle(panel);
  const milliseconds = (value: string) => value.trim().endsWith("ms") ? parseFloat(value) : parseFloat(value) * 1000;
  const durations = style.transitionDuration.split(",").map(milliseconds);
  const delays = style.transitionDelay.split(",").map(milliseconds);
  const longest = Math.max(0, ...durations.map((duration, index) => duration + (delays[index % delays.length] || 0)).filter(Number.isFinite));
  // jsdom has no stylesheet timing; browser zero-motion styles remove immediately.
  return style.transitionDuration ? longest + 80 : 220;
}

function BoundaryDismiss({ onDismiss, disabled }: { onDismiss: () => void; disabled: boolean }) {
  useModalDismiss(onDismiss, { disabled });
  return null;
}

/** Keep this boundary mounted: <ModalPresence>{open ? <Dialog /> : null}</ModalPresence>.
 * Children must render one overlay containing a .modal-shell (or data-modal-motion-panel) with dialog semantics.
 * Retains the last rendered element (including nullable-data props) until exit ends.
 * Business callbacks run immediately; only visual removal is deferred.
 */
export function ModalPresence({ children, onDismiss, dismissDisabled = false, explicitTabNavigation = false }: {
  readonly children: ReactNode;
  /** For inline dialogs whose parent lives outside this boundary's context. */
  readonly onDismiss?: () => void;
  readonly dismissDisabled?: boolean;
  /** Forwarded to the boundary's trap; a descendant dialog's own request is
   * ignored once this boundary owns focus. */
  readonly explicitTabNavigation?: boolean;
}) {
  const present = children !== null && children !== undefined && children !== false;
  const retained = useRef<ReactNode>(null);
  const root = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(present);
  const [entered, setEntered] = useState(false);
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));
  const visible = present || mounted;
  const exiting = !present;
  const context = useMemo(() => ({ exiting, root }), [exiting]);
  const phase = exiting ? "exiting" : entered || reduced ? "open" : "entering";

  useLayoutEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    if (present) retained.current = children;
  }, [children, present]);

  useLayoutEffect(() => {
    if (!present) {
      // An entry cancelled before its first frame has no visible exit to retain.
      if (reduced || !entered) {
        setMounted(false);
        setEntered(false);
        retained.current = null;
        return;
      }
      const timer = window.setTimeout(() => {
        setMounted(false);
        setEntered(false);
        retained.current = null;
      }, exitFallbackMs(root.current));
      return () => window.clearTimeout(timer);
    }
    setMounted(true);
    // Establish the small initial pose before transitioning to full size.
    // An interrupted exit keeps entered=true so CSS reverses from its current pose.
    let frame = 0;
    const start = () => {
      const panel = root.current ? ownModalElements(root.current, MODAL_MOTION_PANEL_SELECTOR)[0] : null;
      if (!panel) return;
      // Flush the initial CSS pose before the next frame changes its target.
      window.getComputedStyle(panel).opacity;
      observer.disconnect();
      frame = window.requestAnimationFrame(() => setEntered(true));
    };
    const observer = new MutationObserver(start);
    if (root.current) observer.observe(root.current, { childList: true, subtree: true });
    start();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [present, reduced]);

  useModalFocusTrap(root, { enabled: visible, explicitTabNavigation });

  const blockExitInteraction = (event: SyntheticEvent) => {
    if (!exiting) return;
    event.preventDefault();
    event.stopPropagation();
  };

  if (!visible || (!present && reduced)) return null;
  return (
    <ModalPresenceContext.Provider value={context}>
      {onDismiss ? <BoundaryDismiss onDismiss={onDismiss} disabled={dismissDisabled} /> : null}
      <div
        ref={root}
        data-modal-presence={phase}
        onClickCapture={blockExitInteraction}
        onPointerDownCapture={blockExitInteraction}
        onSubmitCapture={blockExitInteraction}
        onKeyDownCapture={(event) => {
          if (exiting) blockExitInteraction(event);
        }}
        onTransitionEnd={(event) => {
          if (!exiting || event.propertyName !== "transform" || !(event.target instanceof HTMLElement)
            || !event.target.matches(MODAL_MOTION_PANEL_SELECTOR)
            || event.target.closest("[data-modal-presence]") !== root.current) return;
          setMounted(false);
          setEntered(false);
          retained.current = null;
        }}
      >
        {present ? children : retained.current}
      </div>
    </ModalPresenceContext.Provider>
  );
}

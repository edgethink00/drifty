import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { FlowIntervalMinutes } from "@drifty/domain";

import { HOVER_CARD_OFFSET } from "../../components/hoverCardPosition";
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { FlowHoverGroupHighlights } from "../flow-chart/FlowHoverGroupHighlights";
import { moveFlowHoverCardToPointer } from "../flow-chart/FlowChartHoverCards";
import type { FlowBlockHoverGroup } from "../flow-chart/flowHoverGroups";
import { useLocalization } from "../localization/LocalizationContext";
import { AgentToolLabel } from "./AgentToolLabel";

const AGENTS_HOVER_CARD_ID = "agents-run-hover-card";
// Match Flow hover's one-frame retarget buffer so crossing dense run cells
// cannot flash every intermediate card on the way to the intended target.
const AGENTS_HOVER_RETARGET_SETTLE_DELAY_MS = 16;

export type AgentsHoverDetails = {
  readonly id: string;
  readonly repo: string | null;
  readonly timeRangeLabel: string;
  readonly activeSeconds: number;
  readonly peakConcurrency: number;
  readonly providerLabels: readonly string[];
  readonly modelLabels: readonly string[];
  readonly commitCount: number;
  readonly tone: string;
  readonly flowGroup?: FlowBlockHoverGroup;
  readonly cellSummary?: {
    readonly repos: readonly { readonly repo: string | null; readonly providerLabels: readonly string[] }[];
    readonly surroundingRangeLabel?: string;
  };
};

type AgentsHoverState = {
  readonly details: AgentsHoverDetails;
  readonly target: HTMLElement;
  readonly x: number;
  readonly y: number;
};

function eventElementFromTarget(target: EventTarget | null, body: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>("[data-agent-hover-id]");
  if (!element || !body.contains(element)) return null;
  return element;
}

function AgentToolList({ labels }: { readonly labels: readonly string[] }) {
  const { t } = useLocalization();
  return (
    <span className="agents-hover-card__tools">
      {labels.length ? labels.slice(0, 2).map(label => <AgentToolLabel key={label} label={label} />) : <AgentToolLabel label={t("agents.generic.unknownProvider")} />}
      {labels.length > 2 ? <span className="agents-hover-card__more">{t("agents.hover.moreTools", { count: labels.length - 2 })}</span> : null}
    </span>
  );
}

function AgentsHoverCard({ hover, cardRef }: { readonly hover: AgentsHoverState; readonly cardRef: RefObject<HTMLDivElement> }) {
  const { effectiveLanguage, t } = useLocalization();
  const modelLabels = hover.details.modelLabels.slice(0, 2);
  const cellSummary = hover.details.cellSummary;
  const durationLabel = hover.details.activeSeconds > 0 && hover.details.activeSeconds < 60
    ? effectiveLanguage === "ko" ? "1분 미만" : "<1m"
    : formatLocalizedCompactDurationFromSeconds(hover.details.activeSeconds, effectiveLanguage);

  return (
    <div
      id={AGENTS_HOVER_CARD_ID}
      ref={cardRef}
      className="flow-hover-card agents-hover-card"
      role="tooltip"
      style={{ left: hover.x + HOVER_CARD_OFFSET, top: hover.y + HOVER_CARD_OFFSET }}
    >
      <div className="agents-hover-card__head">
        <span className="agents-hover-card__tone" style={{ "--agents-hover-tone": hover.details.tone } as CSSProperties} aria-hidden="true" />
        <div>
          <strong>{cellSummary ? hover.details.timeRangeLabel : hover.details.repo ?? t("agents.hover.agentRun")}</strong>
          <span>{cellSummary ? t("agents.hover.active", { duration: durationLabel }) : `${hover.details.timeRangeLabel} · ${t("agents.hover.active", { duration: durationLabel })}`}</span>
        </div>
        <dl className="agents-hover-card__peak">
          <dt>{t(cellSummary ? "agents.hover.concurrentPeak" : "agents.hover.peak")}</dt>
          <dd>×{hover.details.peakConcurrency}</dd>
        </dl>
      </div>
      <dl className="agents-hover-card__facts">
        {cellSummary ? (
          <div className="agents-hover-card__repo-section">
            <dt>{t("agents.hover.repos")}</dt>
            <dd className="agents-hover-card__repos">
              {cellSummary.repos.slice(0, 2).map(({ repo, providerLabels }) => (
                <span className="agents-hover-card__repo" key={repo ?? ""}>
                  <span className="agents-hover-card__repo-name">{repo ?? t("agents.generic.noRepo")}</span>
                  <AgentToolList labels={providerLabels} />
                </span>
              ))}
              {cellSummary.repos.length > 2 ? <span className="agents-hover-card__more">{t("agents.hover.moreRepos", { count: cellSummary.repos.length - 2 })}</span> : null}
            </dd>
          </div>
        ) : <div className="agents-hover-card__repo-section"><dt>{t("agents.hover.tools")}</dt><dd><AgentToolList labels={hover.details.providerLabels} /></dd></div>}
        {modelLabels.length > 0 ? (
          <div>
            <dt>{t("agents.hover.models")}</dt>
            <dd className="agents-hover-card__models">
              {modelLabels.map(model => <div key={model}>{model}</div>)}
              {hover.details.modelLabels.length > 2 ? <span className="agents-hover-card__more">{t("agents.hover.moreModels", { count: hover.details.modelLabels.length - 2 })}</span> : null}
            </dd>
          </div>
        ) : null}
        {hover.details.commitCount > 0 ? <div><dt>{t(cellSummary ? "agents.hover.cellCommits" : "agents.hover.commits")}</dt><dd>{hover.details.commitCount}</dd></div> : null}
      </dl>
      {cellSummary?.surroundingRangeLabel ? <p className="agents-hover-card__context">{t("agents.hover.surroundingActivity", { range: cellSummary.surroundingRangeLabel })}</p> : null}
    </div>
  );
}

export function AgentsHoverLayer({
  bodyElement,
  detailsById,
  highlight,
}: {
  readonly bodyElement: HTMLElement | null;
  readonly detailsById: ReadonlyMap<string, AgentsHoverDetails>;
  readonly highlight?: {
    readonly gridElement: HTMLDivElement | null;
    readonly intervalMinutes: FlowIntervalMinutes;
    readonly boundaryMinutes: number;
  };
}) {
  const [hover, setHover] = useState<AgentsHoverState | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const detailsByIdRef = useRef(detailsById);
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const pointerHoverRef = useRef<AgentsHoverState | null>(null);
  const focusHoverRef = useRef<AgentsHoverState | null>(null);
  const pendingPointerHoverRef = useRef<AgentsHoverState | null>(null);
  const retargetTimerRef = useRef<number | null>(null);
  const latestPointerRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);

  const clearDescriptionTarget = useCallback(() => {
    activeTargetRef.current?.removeAttribute("aria-describedby");
    activeTargetRef.current = null;
  }, []);

  const publishHover = useCallback(() => {
    const next = focusHoverRef.current ?? pointerHoverRef.current;
    clearDescriptionTarget();
    if (next) {
      next.target.setAttribute("aria-describedby", AGENTS_HOVER_CARD_ID);
      activeTargetRef.current = next.target;
    }
    setHover(next);
  }, [clearDescriptionTarget]);

  const cancelPointerRetarget = useCallback(() => {
    pendingPointerHoverRef.current = null;
    if (retargetTimerRef.current === null) return;
    window.clearTimeout(retargetTimerRef.current);
    retargetTimerRef.current = null;
  }, []);

  const cancelPointerFrame = useCallback(() => {
    latestPointerRef.current = null;
    if (frameRef.current === null) return;
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const clearPointerHover = useCallback(() => {
    cancelPointerRetarget();
    cancelPointerFrame();
    pointerHoverRef.current = null;
    publishHover();
  }, [cancelPointerFrame, cancelPointerRetarget, publishHover]);

  const commitPointerHover = useCallback((next: AgentsHoverState) => {
    pointerHoverRef.current = next;
    publishHover();
  }, [publishHover]);

  const dismissHover = useCallback(() => {
    cancelPointerRetarget();
    cancelPointerFrame();
    pointerHoverRef.current = null;
    focusHoverRef.current = null;
    publishHover();
  }, [cancelPointerFrame, cancelPointerRetarget, publishHover]);

  useLayoutEffect(() => {
    detailsByIdRef.current = detailsById;
    cancelPointerRetarget();
    cancelPointerFrame();
    pointerHoverRef.current = null;
    const focusedElement = bodyElement ? eventElementFromTarget(document.activeElement, bodyElement) : null;
    const focusedId = focusedElement?.dataset.agentHoverId;
    const details = focusedId ? detailsById.get(focusedId) : undefined;
    if (focusedElement && details) {
      const bounds = focusedElement.getBoundingClientRect();
      const next = {
        details,
        target: focusedElement,
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      };
      focusHoverRef.current = next;
    } else {
      focusHoverRef.current = null;
    }
    publishHover();
  }, [bodyElement, cancelPointerFrame, cancelPointerRetarget, detailsById, publishHover]);

  useEffect(() => {
    if (!bodyElement) {
      dismissHover();
      return undefined;
    }

    const flushPointerMove = () => {
      frameRef.current = null;
      const pointer = latestPointerRef.current;
      if (pointer) moveFlowHoverCardToPointer(cardRef.current, pointer.x, pointer.y);
    };
    const schedulePointerMove = (x: number, y: number) => {
      latestPointerRef.current = { x, y };
      if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(flushPointerMove);
    };
    const schedulePointerRetarget = (next: AgentsHoverState) => {
      if (pendingPointerHoverRef.current?.details.id === next.details.id) return;
      cancelPointerRetarget();
      pendingPointerHoverRef.current = next;
      retargetTimerRef.current = window.setTimeout(() => {
        const pending = pendingPointerHoverRef.current;
        pendingPointerHoverRef.current = null;
        retargetTimerRef.current = null;
        if (!pending?.target.isConnected) return;
        commitPointerHover(pending);
      }, AGENTS_HOVER_RETARGET_SETTLE_DELAY_MS);
    };
    const handlePointerMove = (event: PointerEvent) => {
      // Focus owns both the content and its position until blur/Escape. A
      // pointer over another cell must not drag the focused cell's card there.
      if (focusHoverRef.current) return;
      const element = eventElementFromTarget(event.target, bodyElement);
      const id = element?.dataset.agentHoverId;
      const details = id ? detailsByIdRef.current.get(id) : undefined;
      if (!element || !id || !details) {
        if (pointerHoverRef.current || pendingPointerHoverRef.current) clearPointerHover();
        return;
      }
      schedulePointerMove(event.clientX, event.clientY);
      if (pointerHoverRef.current?.details.id === id) {
        cancelPointerRetarget();
        return;
      }
      const next = { details, target: element, x: event.clientX, y: event.clientY };
      if (!pointerHoverRef.current) {
        cancelPointerRetarget();
        commitPointerHover(next);
        return;
      }
      schedulePointerRetarget(next);
    };
    const handleFocusIn = (event: FocusEvent) => {
      cancelPointerRetarget();
      cancelPointerFrame();
      pointerHoverRef.current = null;
      const element = eventElementFromTarget(event.target, bodyElement);
      const id = element?.dataset.agentHoverId;
      const details = id ? detailsByIdRef.current.get(id) : undefined;
      if (element && details) {
        const bounds = element.getBoundingClientRect();
        focusHoverRef.current = {
          details,
          target: element,
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
        };
      } else {
        focusHoverRef.current = null;
      }
      publishHover();
    };
    const handleFocusOut = (event: FocusEvent) => {
      const element = eventElementFromTarget(event.relatedTarget, bodyElement);
      const id = element?.dataset.agentHoverId;
      const details = id ? detailsByIdRef.current.get(id) : undefined;
      if (element && details) {
        const bounds = element.getBoundingClientRect();
        focusHoverRef.current = {
          details,
          target: element,
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
        };
      } else {
        focusHoverRef.current = null;
      }
      publishHover();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      dismissHover();
    };

    bodyElement.addEventListener("pointermove", handlePointerMove, { passive: true });
    bodyElement.addEventListener("pointerleave", clearPointerHover);
    bodyElement.addEventListener("focusin", handleFocusIn);
    bodyElement.addEventListener("focusout", handleFocusOut);
    document.addEventListener("mouseleave", clearPointerHover);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", clearPointerHover);
    return () => {
      bodyElement.removeEventListener("pointermove", handlePointerMove);
      bodyElement.removeEventListener("pointerleave", clearPointerHover);
      bodyElement.removeEventListener("focusin", handleFocusIn);
      bodyElement.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("mouseleave", clearPointerHover);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", clearPointerHover);
      cancelPointerRetarget();
      cancelPointerFrame();
      clearDescriptionTarget();
    };
  }, [
    bodyElement,
    cancelPointerFrame,
    cancelPointerRetarget,
    clearDescriptionTarget,
    clearPointerHover,
    commitPointerHover,
    dismissHover,
    publishHover,
  ]);

  useLayoutEffect(() => {
    if (!hover) return;
    moveFlowHoverCardToPointer(cardRef.current, hover.x, hover.y);
  }, [hover]);

  const highlightedGroup = hover?.details.flowGroup;

  return (
    <>
      {highlight?.gridElement && highlightedGroup
        ? createPortal(
            <FlowHoverGroupHighlights
              group={highlightedGroup}
              intervalMinutes={highlight.intervalMinutes}
              boundaryMinutes={highlight.boundaryMinutes}
              variant="hover"
            />,
            highlight.gridElement,
          )
        : null}
      {hover ? <AgentsHoverCard hover={hover} cardRef={cardRef} /> : null}
    </>
  );
}

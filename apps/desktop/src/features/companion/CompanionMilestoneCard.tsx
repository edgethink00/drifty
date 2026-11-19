import type { CSSProperties, DOMAttributes } from "react";
import type { CompanionMilestoneChoice, CompanionPillMilestoneEvent } from "./CompanionPillMoment";
import { PillDismissIcon, PillOpenArrowIcon } from "./CompanionPillIcons";
import { useLocalization } from "../localization/LocalizationContext";
import "./companionMilestoneCard.css";

/**
 * A focus session's moments as one short card (owner review 2026-11-19/20):
 * a pomodoro break ("5분 쉬어요" with Skip break), the next round ("2/4 라운드
 * 시작", no action) and the session's end ("집중 세션 끝" with its focus time
 * and "오늘 보기"). The time left and the round stay in the menu bar and the
 * title bar, so a card holds the title, one line, and its one action if any;
 * with an action it is the "breakCard" state, without one the shorter
 * "noteCard". The close button's ring counts down the 6 seconds it stays.
 */
export function milestoneCardState(event: CompanionPillMilestoneEvent): "milestone" | "milestoneCard" | "breakCard" | "noteCard" {
  if (event.frame === "card") return event.choices?.length || event.destination ? "breakCard" : "noteCard";
  // A weekly first place draws the illustrated trophy card.
  return event.presentation === "trophyCard" ? "milestoneCard" : "milestone";
}

export type MilestoneCardStat = { readonly value: string; readonly label: string };
export type MilestoneCardDestination = { readonly label: string; readonly ariaLabel: string; readonly onOpen: () => void };

export function CompanionMilestoneCardView({
  event,
  isActive,
  autoDismissState,
  autoDismissStyle,
  onDismiss,
  onChoose,
  holdHandlers,
  stat = null,
  destination = null,
}: {
  readonly event: CompanionPillMilestoneEvent;
  readonly isActive: boolean;
  readonly autoDismissState: "running" | "paused" | undefined;
  readonly autoDismissStyle: CSSProperties;
  readonly onDismiss: () => void;
  readonly onChoose?: (choice: CompanionMilestoneChoice) => void;
  /** Pointer and keyboard focus pause the countdown, as on every other card. */
  readonly holdHandlers?: DOMAttributes<HTMLElement>;
  /** The figure printed beside the title, as the session's focus time. */
  readonly stat?: MilestoneCardStat | null;
  /** Where the card leads when it has no choice, as the end's "오늘 보기". */
  readonly destination?: MilestoneCardDestination | null;
}) {
  const { t } = useLocalization();
  const progress = event.progress;
  return (
    <div
      className={"view view--mcard mcard" + (isActive ? " is-active" : "")}
      data-view="mcard"
      data-tone={event.tone ?? undefined}
      data-auto={autoDismissState}
      aria-hidden={!isActive}
      style={autoDismissStyle}
      {...holdHandlers}
    >
      <button className="mcard__close" type="button" title={t("companion.card.dismiss")} onClick={onDismiss}><PillDismissIcon /></button>
      <div className="mcard__text">
        <span className="mcard__title-row">
          <strong className="mcard__title">{event.title}</strong>
          {stat ? <span className="mcard__stat" aria-label={stat.value + " " + stat.label}>{stat.value}</span> : null}
        </span>
        <span className="mcard__sub">
          {progress ? (
            <span className="mcard__dots" aria-hidden="true">
              {Array.from({ length: progress.total }, (_unused, index) => <i key={index} data-on={index < progress.done || undefined} />)}
            </span>
          ) : null}
          <span>{event.subtitle}</span>
        </span>
      </div>
      {event.choices && onChoose ? (
        <div className="mcard__actions">
          {event.choices.map((choice) => (
            <button key={choice.id} type="button" className="mcard__button" onClick={() => onChoose(choice.id)}>{choice.label}</button>
          ))}
        </div>
      ) : destination ? (
        <div className="mcard__actions">
          <button type="button" className="mcard__button" aria-label={destination.ariaLabel} onClick={destination.onOpen}>
            <span>{destination.label}</span>
            <PillOpenArrowIcon />
          </button>
        </div>
      ) : null}
    </div>
  );
}

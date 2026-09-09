import type { CompanionPillMomentEvent } from "./CompanionPillMoment";
import type { CompanionPillWindowEvent } from "./watcherBridge";

export function companionEventIdentity(event: CompanionPillWindowEvent | CompanionPillMomentEvent): string {
  if (!("kind" in event)) return `watcherPeek:${event.id}`;
  if (event.kind === "companionDriftAlarm") return `driftAlarm:${event.alarm.id}`;
  if (event.kind === "endOfDayReview") return `${event.kind}:${event.generatedAt}`;
  return `${event.kind}:${event.id}`;
}

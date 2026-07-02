import type { ParseResult, PublishTeamFocusTotalInput, TeamPeriod } from "./teamTypes";
import { isTeamPeriod } from "./teamServiceRecords";

export function parsePublishPayload(input: PublishTeamFocusTotalInput): ParseResult<Record<string, unknown>> {
  const organizationId = requiredText(input.organization_id, "Organization id is required.", 120);
  if (!organizationId.ok) return organizationId;
  const period = parsePeriod(input.period);
  if (!period.ok) return period;
  const displayName = requiredText(input.display_name, "Display name is required.", 80);
  if (!displayName.ok) return displayName;
  const roleLabel = requiredText(input.role_label, "Role label is required.", 40);
  if (!roleLabel.ok) return roleLabel;
  const timezone = requiredText(input.timezone, "Timezone is required.", 80);
  if (!timezone.ok) return timezone;
  const focus = parseFocusValues(input.focus_seconds, input.focus_score);
  if (!focus.ok) return focus;
  const windowDates = parseWindowDates(input.window_start_date, input.window_end_date);
  if (!windowDates.ok) return windowDates;

  return {
    ok: true,
    value: {
      input_organization_id: organizationId.value,
      period_name: period.value,
      input_display_name: displayName.value,
      input_role_label: roleLabel.value,
      input_focus_seconds: input.focus_seconds,
      input_focus_score: input.focus_score,
      input_window_start_date: input.window_start_date,
      input_window_end_date: input.window_end_date,
      input_timezone: timezone.value,
    },
  };
}

export function parsePeriod(value: unknown): ParseResult<TeamPeriod> {
  return isTeamPeriod(value) ? { ok: true, value } : { ok: false, error: "Unsupported team focus period." };
}

export function requiredText(value: unknown, error: string, maxLength: number): ParseResult<string> {
  if (typeof value !== "string") return { ok: false, error };
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > maxLength) return { ok: false, error };
  return { ok: true, value: trimmed };
}

export function optionalText(value: string | null | undefined, fallback: string, maxLength: number): string {
  const trimmed = value?.trim() || fallback;
  return trimmed.slice(0, maxLength);
}

function parseFocusValues(focusSeconds: number, focusScore: number): ParseResult<true> {
  if (!Number.isFinite(focusSeconds) || focusSeconds < 0) return { ok: false, error: "Focus seconds must be non-negative." };
  if (!Number.isFinite(focusScore) || focusScore < 0 || focusScore > 100) {
    return { ok: false, error: "Focus score must be between 0 and 100." };
  }
  return { ok: true, value: true };
}

function parseWindowDates(windowStartDate: string, windowEndDate: string): ParseResult<true> {
  const start = requiredText(windowStartDate, "Focus window dates are invalid.", 20);
  const end = requiredText(windowEndDate, "Focus window dates are invalid.", 20);
  if (!start.ok) return start;
  if (!end.ok) return end;
  return end.value >= start.value ? { ok: true, value: true } : { ok: false, error: "Focus window dates are invalid." };
}

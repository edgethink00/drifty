// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_TIMELINE_CARD_PROMPT_VERSION,
  activityBlockLabelKey,
  type ActivityBlockLabelRecord,
  type ActivitySegment,
  type ActivityTimelineWindowRecord,
} from "@drifty/domain";
import { ActivityInspectorPreview, WeekActivityInspector, type ActivityInspectorEvent } from "../dashboard/WeekActivityInspector";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { activityLabelForFlowRange } from "./activityInspectorLabel";
import { buildActivityLabelBlocks, buildActivityLabelIndex } from "./activityLabelBlocks";
import { ActivityLabelsContext } from "./ActivityLabelsContext";

afterEach(cleanup);

const DAY = "2026-10-14";
function segment(id: string, start: string, end: string, title: string): ActivitySegment {
  const startedAt = new Date(DAY + "T" + start + ":00");
  const endedAt = new Date(DAY + "T" + end + ":00");
  return {
    id, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(),
    durationSeconds: (endedAt.getTime() - startedAt.getTime()) / 1000,
    appName: "Code", platform: "macos", source: "nsworkspace", windowTitle: title,
  };
}
const segments = [
  segment("1", "09:00", "09:30", "checkout.ts"),
  segment("2", "09:30", "10:30", "retry.ts"),
  segment("3", "11:00", "11:02", "notes"),
];
const events = new Map([[DAY, [
  { segmentIds: ["1", "2"], topMinutes: 9 * 60, durationMinutes: 90 },
  { segmentIds: ["3"], topMinutes: 11 * 60, durationMinutes: 2 },
]]]);
const user: ActivityBlockLabelRecord = {
  blockKey: activityBlockLabelKey(DAY, ["1", "2"]), source: "user", logicalDay: DAY,
  blockStartedAt: "", blockEndedAt: "", segmentIds: ["1", "2"], status: "user",
  title: "Checkout retry review", description: "Read the retry handler.",
};

function blocks(labels: ActivityBlockLabelRecord[], windows: ActivityTimelineWindowRecord[] = [], now = "2026-10-14T18:00:00") {
  return buildActivityLabelBlocks(events, {
    startOfDayMinutes: 0,
    segmentsById: new Map(segments.map((item) => [item.id, item])),
    labels,
    windows,
    language: "en",
    nowMs: new Date(now).getTime(),
  });
}

describe("activity label blocks", () => {
  /** One described window holding the given cards. */
  function windowOf(...cards: [title: string, start: string, end: string][]): ActivityTimelineWindowRecord {
    const at = (time: string) => new Date(DAY + "T" + time + ":00").toISOString();
    return {
      windowKey: DAY + ":w:x", language: "en", logicalDay: DAY,
      startedAt: at(cards[0][1]), endedAt: at(cards[cards.length - 1][2]),
      promptVersion: ACTIVITY_TIMELINE_CARD_PROMPT_VERSION, createdAt: "2026-10-14T12:00:00Z",
      cards: cards.map(([title, start, end], position) => ({
        position, startedAt: at(start), endedAt: at(end), status: "ready" as const, variant: "strict" as const,
        title, description: "", segmentIds: ["1", "2"],
      })),
    };
  }

  it("names a block by the timeline card covering most of it and lists the other cards inside", () => {
    const [named, short] = blocks([], [windowOf(["Checkout flow review", "09:00", "10:00"], ["Retry handler reading", "10:00", "10:30"])]);
    expect(named.display).toMatchObject({ title: "Checkout flow review", origin: "ai" });
    expect(named.otherCards.map((other) => other.title)).toEqual(["Retry handler reading"]);
    expect(short.display).toBeNull();
  });

  it("keeps the user's hidden choice, ignores old block-level rows and cards in another language", () => {
    const hidden = { ...user, status: "hidden" as const, title: "", description: "" };
    expect(blocks([hidden], [windowOf(["Checkout flow review", "09:00", "10:30"])])[0].display).toBeNull();
    const oldBlockRow = { ...user, source: "ai" as const, status: "ready" as const, promptVersion: "activity-block-label-v1", language: "en" };
    expect(blocks([oldBlockRow])[0].display).toBeNull();
    expect(blocks([], [{ ...windowOf(["Checkout flow review", "09:00", "10:30"]), language: "ko" }])[0].display).toBeNull();
  });

  it("finds the work block around a Day hover slice and says when it covers more", () => {
    const controller = { index: buildActivityLabelIndex(blocks([user]), new Map(segments.map(s => [s.id, s]))), editingEnabled: true, saveUserLabel: async () => undefined, resetUserLabel: async () => undefined };
    const slice = activityLabelForFlowRange(controller, DAY, 9 * 60 + 30, 10 * 60, 0, ["2"]);
    expect(slice).toMatchObject({ scope: "range", display: { title: "Checkout retry review" } });
    expect(activityLabelForFlowRange(controller, DAY, 9 * 60, 10 * 60 + 30, 0, ["1", "2"])?.scope).toBe("block");
    expect(activityLabelForFlowRange(controller, DAY, 12 * 60, 12 * 60 + 5, 0, ["9"])).toBeNull();
    expect(controller.index.forSegments(DAY, ["2", "1"])?.display?.title).toBe("Checkout retry review");
  });

  const flowEvent: ActivityInspectorEvent = {
    id: "flow", surface: "flow", segmentIds: ["2"], appName: "Code", category: "workspace", productivity: "focus",
    startLabel: "09:30", endLabel: "10:00", identities: [], hasMixedCategory: false, hasMixedProductivity: false,
  };

  it("keeps the Day card's own app in the header and adds the block's name beneath it", () => {
    const controller = { index: buildActivityLabelIndex(blocks([user]), new Map(segments.map(s => [s.id, s]))), editingEnabled: true, saveUserLabel: async () => undefined, resetUserLabel: async () => undefined };
    const label = activityLabelForFlowRange(controller, DAY, 9 * 60 + 30, 10 * 60, 0, ["2"]);
    const anchor = document.createElement("button");
    document.body.append(anchor);
    render(
      <LocalizationTestProvider language="en">
        <ActivityInspectorPreview
          event={flowEvent}
          segments={[segments[1]]}
          appIcons={{}}
          anchorElement={anchor}
          actionsDisabledReason={null}
          activityLabel={label}
          onDismiss={() => undefined}
        />
      </LocalizationTestProvider>,
    );
    const card = screen.getByRole("tooltip");
    expect(card.querySelector(".week-activity-inspector__heading strong")?.textContent).toBe("Code");
    const row = card.querySelector<HTMLElement>(".activity-label-row")!;
    expect(row.textContent).toBe("Task: Checkout retry reviewRead the retry handler.");
    expect(within(row).getByText("Checkout retry review")).toBeTruthy();
    expect(within(row).getByText("Read the retry handler.")).toBeTruthy();
    expect(within(card).queryByRole("button")).toBeNull();
  });

  it("hides the block's name from a pinned Day card and offers it back", async () => {
    const saveUserLabel = vi.fn(async () => undefined);
    const resetUserLabel = vi.fn(async () => undefined);
    const renderPinned = (labels: ActivityBlockLabelRecord[]) => {
      const controller = { index: buildActivityLabelIndex(blocks(labels), new Map(segments.map(s => [s.id, s]))), editingEnabled: true, saveUserLabel, resetUserLabel };
      const anchor = document.createElement("button");
      document.body.append(anchor);
      return render(
        <LocalizationTestProvider language="en">
          <ActivityLabelsContext.Provider value={controller}>
            <WeekActivityInspector
              event={flowEvent}
              segments={[segments[1]]}
              appIcons={{}}
              anchorElement={anchor}
              activityLabel={activityLabelForFlowRange(controller, DAY, 9 * 60 + 30, 10 * 60, 0, ["2"])}
              onClose={() => undefined}
            />
          </ActivityLabelsContext.Provider>
        </LocalizationTestProvider>,
      );
    };

    const { unmount } = renderPinned([user]);
    const inspector = screen.getByRole("dialog");
    expect(within(inspector).getByText("Checkout retry review")).toBeTruthy();
    expect(within(inspector).queryByRole("textbox")).toBeNull();
    fireEvent.click(within(inspector).getByRole("button", { name: "Hide task name" }));
    await waitFor(() => expect(saveUserLabel).toHaveBeenCalledTimes(1));
    expect(saveUserLabel.mock.calls[0]).toEqual([expect.objectContaining({ segmentIds: ["1", "2"] }), "", ""]);
    unmount();

    renderPinned([{ ...user, status: "hidden", title: "", description: "" }]);
    const hiddenCard = screen.getByRole("dialog");
    expect(hiddenCard.querySelector(".activity-label-row")).toBeNull();
    fireEvent.click(within(hiddenCard).getByRole("button", { name: "Show task name" }));
    await waitFor(() => expect(resetUserLabel).toHaveBeenCalledTimes(1));
  });
});


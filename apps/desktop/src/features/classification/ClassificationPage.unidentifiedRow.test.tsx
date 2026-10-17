// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { ClassificationPage } from "./ClassificationPage";
import { buildClassificationCorrectionDraft, classificationCorrectionScopeForRow } from "./classificationCorrection";
import {
  buildClassificationActivityRows,
  buildClassificationCategoryBreakdowns,
  buildClassificationSourceSummaries,
  classifySourceKey,
} from "./classificationViewData";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import type { DisplayLanguage } from "../localization/languageCatalog";

function chatgpt(id: string, startedAt: string, durationSeconds: number, windowTitle?: string): ActivitySegment {
  const started = new Date(`${startedAt}+00:00`);
  return {
    id,
    startedAt: started.toISOString(),
    endedAt: new Date(started.getTime() + durationSeconds * 1000).toISOString(),
    durationSeconds,
    appName: "ChatGPT",
    bundleId: "com.openai.chat",
    platform: "macos",
    source: "nsworkspace",
    windowTitle: windowTitle ?? null,
  } as ActivitySegment;
}

// The untitled captures and the ones titled with the app's own name add up to
// more time than the real conversation, so the unnamed row sorts first - the
// shape that used to hand the top row a pencil that did nothing.
const SEGMENTS = [
  chatgpt("untitled-1", "2026-09-09T09:23:00", 220),
  chatgpt("app-titled-1", "2026-09-09T09:31:00", 300, "ChatGPT"),
  chatgpt("named-1", "2026-09-09T09:40:00", 400, "릴리스 노트 초안 다듬기 - drifty_mac"),
];

function renderPage(overrides: Partial<Parameters<typeof ClassificationPage>[0]> = {}, language: DisplayLanguage = "ko") {
  const rows = buildClassificationActivityRows(SEGMENTS);
  const sources = buildClassificationSourceSummaries(SEGMENTS, {});
  const totalSeconds = SEGMENTS.reduce((sum, item) => sum + item.durationSeconds, 0);
  const breakdowns = buildClassificationCategoryBreakdowns(SEGMENTS, {}, totalSeconds);
  const onStartClassificationDetailCorrection = vi.fn();

  render(
    <LocalizationTestProvider language={language}>
      <ClassificationPage
        appIcons={{}}
        canShiftClassificationForward={false}
        classificationActivityPeakSeconds={Math.max(...rows.map((row) => row.totalSeconds))}
        classificationActivityRows={rows}
        classificationCategoryBreakdowns={breakdowns}
        classificationDateLabel="2026년 9월 9일"
        classificationOptions={{}}
        classificationPanelStyle={{ "--classification-selected-tone": "#8ec07c" }}
        classificationFocusRatePercent={62}
        classificationRange="Day"
        classificationSessionCount={SEGMENTS.length}
        classificationSourceSummaries={sources}
        classificationTopAppIconSrc={null}
        classificationTopAppLabel="ChatGPT"
        classificationTopAppName="ChatGPT"
        classificationTotalSeconds={totalSeconds}
        effectiveClassifyCategoryId={breakdowns[0]?.category ?? null}
        effectiveClassifySourceId={sources[0] ? classifySourceKey(sources[0]) : null}
        expandedClassificationActivityRows={new Set()}
        isCurrentClassificationRange
        devModeEnabled={false}
        classificationCorrectionDraft={null}
        classificationCorrectionNotice={null}
        classificationCorrectionSaving={false}
        selectedClassificationBreakdown={breakdowns[0] ?? null}
        selectedClassificationSourceSummary={sources[0] ?? null}
        selectedClassificationTone="#8ec07c"
        onActivityRowToggle={vi.fn()}
        onCategorySelect={vi.fn()}
        onCancelClassificationCorrection={vi.fn()}
        onClassificationCorrectionCategoryChange={vi.fn()}
        onClassificationCorrectionProductivityChange={vi.fn()}
        onNextClassificationRange={vi.fn()}
        onPreviousClassificationRange={vi.fn()}
        onRangeChange={vi.fn()}
        onSaveClassificationCorrection={vi.fn()}
        onSourceSelect={vi.fn()}
        onStartClassificationDetailCorrection={onStartClassificationDetailCorrection}
        onStartClassificationSurfaceCorrection={vi.fn()}
        onTodayClassificationRange={vi.fn()}
        {...overrides}
      />
    </LocalizationTestProvider>,
  );

  return { rows, onStartClassificationDetailCorrection };
}

describe("classification activity list, unnamed captures", () => {
  it("names the merged unnamed row for what it is instead of borrowing the app name", () => {
    const { rows } = renderPage();
    expect(rows[0].unidentified).toBe(true);
    expect(rows[0].count).toBe(2);
    expect(screen.getByText("확인되지 않은 활동")).toBeTruthy();
    expect(screen.queryByText("ChatGPT", { selector: ".classification-panel-view__activity-copy strong" })).toBeNull();
    expect(screen.getByText("릴리스 노트 초안 다듬기 - drifty_mac")).toBeTruthy();
  });

  it("offers a records correction on the unnamed row and a rule correction on a named one", () => {
    const { rows, onStartClassificationDetailCorrection } = renderPage();
    const unnamedPencil = screen.getByRole("button", { name: /확인되지 않은 기록 2건 분류 수정/ });
    fireEvent.click(unnamedPencil);
    expect(onStartClassificationDetailCorrection).toHaveBeenCalledWith(rows[0].id);

    const namedPencil = screen.getByRole("button", { name: /이 상세 항목 분류 수정: 릴리스 노트 초안 다듬기/ });
    fireEvent.click(namedPencil);
    expect(onStartClassificationDetailCorrection).toHaveBeenCalledWith(rows[1].id);
  });

  it("opens a visible editor for the unnamed row, scoped to the records", () => {
    const rows = buildClassificationActivityRows(SEGMENTS);
    const row = rows[0];
    const scope = classificationCorrectionScopeForRow("detail", row);
    const draft = buildClassificationCorrectionDraft({
      rowId: row.id, scope, segment: row.segments[0], classificationOptions: {}, displayLabel: row.label,
    });
    expect(scope).toBe("records");
    expect(draft).not.toBeNull();

    renderPage({ classificationCorrectionDraft: draft });
    const dialog = screen.getByRole("dialog", { name: "확인되지 않은 활동 분류 수정" });
    expect(dialog).toBeTruthy();
    // Hidden until placed is how the old silent failure looked; assert it landed.
    expect(dialog.getAttribute("data-positioned")).toBe("true");
    expect(screen.getByText("이 기록만")).toBeTruthy();
    expect(screen.getByText(/이 기록 2건만 바뀝니다/)).toBeTruthy();
  });
});

describe("classification source share localization", () => {
  it.each([
    ["de", "1,9%"], ["fr", "1,9%"], ["pt-BR", "1,9%"],
    ["ja", "1.9%"], ["zh-Hans", "1.9%"],
    ["en", "1.9%"], ["ko", "1.9%"], ["es", "1.9%"],
  ] as const)("formats a small source share in %s without changing its precision", (language, expected) => {
    const source = buildClassificationSourceSummaries(SEGMENTS, {})[0];
    renderPage({ classificationSourceSummaries: [{ ...source, shareOfTotal: 0.019 }] }, language);
    expect(document.querySelector(".classification-panel-view__source-measure span")?.textContent).toBe(expected);
  });
});

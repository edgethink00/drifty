// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { CompactClassificationHoverCard, type CompactClassificationHoverState } from "./HoverCards";

const hover: CompactClassificationHoverState = {
  label: "프로젝트 없음",
  durationLabel: "38분",
  shareLabel: "38%",
  dotClassName: "",
  color: "#9ca3af",
  appBreakdown: [{ appName: "Arc", siteDomain: "x.com", totalSeconds: 38 * 60 }],
  x: 10,
  y: 10,
};

describe("CompactClassificationHoverCard", () => {
  it("follows the display language when the caller passes none", () => {
    // Insights and the Your Week breakdown render this card without a language.
    render(
      <LocalizationTestProvider language="ko">
        <CompactClassificationHoverCard hover={hover} appIcons={{}} />
      </LocalizationTestProvider>,
    );

    expect(screen.getByText("기록 시간의 38%")).toBeTruthy();
    expect(screen.getByText("38분", { selector: ".category-hover-card__app strong" })).toBeTruthy();
    expect(screen.queryByText(/of tracked time/)).toBeNull();
  });
});

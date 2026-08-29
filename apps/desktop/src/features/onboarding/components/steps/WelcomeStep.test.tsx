// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LocalizationProvider,
  useLocalizationController,
} from "../../../localization/LocalizationContext";
import { WelcomeStep } from "./WelcomeStep";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

function WelcomeHarness() {
  const controller = useLocalizationController();
  return (
    <LocalizationProvider controller={controller}>
      <WelcomeStep promotionActive={false} promotionEndsAt={null} />
    </LocalizationProvider>
  );
}

describe("WelcomeStep language choice", () => {
  it("lets a new user opt into Korean beta from the first screen", () => {
    render(<WelcomeHarness />);

    expect(screen.getByText("Welcome to drifty.")).toBeTruthy();
    const languageGroup = screen.getByRole("radiogroup", { name: "Display language" });
    const koreanOption = screen.getByRole("radio", { name: "한국어 Beta" });
    expect(koreanOption.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(koreanOption);

    expect(screen.getByText("Drifty에 오신 것을 환영합니다.")).toBeTruthy();
    expect(languageGroup.getAttribute("aria-label")).toBe("표시 언어");
    expect(screen.getByRole("radio", { name: "한국어 베타" }).getAttribute("aria-checked")).toBe("true");
  });
});

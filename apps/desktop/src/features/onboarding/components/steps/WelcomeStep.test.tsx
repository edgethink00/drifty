// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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

describe("WelcomeStep language policy", () => {
  it("keeps the first onboarding screen English-only", () => {
    render(<WelcomeHarness />);

    expect(screen.getByText("Welcome to drifty.")).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("radio", { name: /한국어/i })).toBeNull();
  });
});

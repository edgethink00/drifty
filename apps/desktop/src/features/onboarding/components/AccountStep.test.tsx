// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountStep } from "./AccountStep";

describe("AccountStep", () => {
  it("shows account actions with consistent Terms and Privacy legal copy", () => {
    const onStartCloudTrialWithEmail = vi.fn();
    const onStartCloudTrialWithGoogle = vi.fn();

    render(
      <AccountStep
        accountConnected={false}
        onStartCloudTrialWithEmail={onStartCloudTrialWithEmail}
        onStartCloudTrialWithGoogle={onStartCloudTrialWithGoogle}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue with email/i }));

    expect(onStartCloudTrialWithGoogle).toHaveBeenCalledTimes(1);
    expect(onStartCloudTrialWithEmail).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/by continuing, you accept/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /terms/i }).getAttribute("href")).toBe("https://drifty.so/terms/");
    expect(screen.getByRole("link", { name: /privacy/i }).getAttribute("href")).toBe("https://drifty.so/privacy/");
  });
});

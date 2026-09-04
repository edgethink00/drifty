// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { AuthConfigurationGate, AuthLoadingGate, AuthRequiredGate } from "./AuthGates";

afterEach(cleanup);

describe("AuthGates localization", () => {
  it("shows the required sign-in gate in Korean", () => {
    const onSignIn = vi.fn();
    render(
      <LocalizationTestProvider language="ko">
        <AuthRequiredGate onSignIn={onSignIn} />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("main", { name: "로그인 필요" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Drifty에 로그인하세요" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("keeps configuration identifiers intact in the Korean setup gate", () => {
    render(
      <LocalizationTestProvider language="ko">
        <AuthConfigurationGate />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("heading", { name: "로그인 설정을 확인해 주세요" })).toBeTruthy();
    expect(screen.getByText(/VITE_SUPABASE_URL과 VITE_SUPABASE_ANON_KEY/u)).toBeTruthy();
  });

  it("announces saved-session loading in Korean", () => {
    render(
      <LocalizationTestProvider language="ko">
        <AuthLoadingGate />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("status").textContent).toBe("저장된 Drifty 세션을 불러오는 중…");
    expect(screen.getByRole("main", { name: "저장된 Drifty 세션 불러오는 중" })).toBeTruthy();
  });
});

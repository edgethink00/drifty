// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { ProviderCredentialNotice } from "./ProviderCredentialNotice";
import { OpenRouterConnectionFields } from "./OpenRouterSetupPanel";
import type { ProviderCredentialRecovery } from "./useProviderKeyPersistence";
afterEach(cleanup);
it("keeps healthy key fields quiet and offers recovery only when the person clicks", () => {
  const recover = vi.fn(async () => {});
  const recovery: ProviderCredentialRecovery = { state: "error", pending: true, recovering: false, recover };
  const view = render(<LocalizationTestProvider language="ko"><OpenRouterConnectionFields apiKey="synthetic-key"
    onApiKeyChange={() => {}} onChooseModels={() => {}} credentialRecovery={recovery} /></LocalizationTestProvider>);
  expect(screen.getByRole("alert").textContent).toContain("키 변경사항이 아직 저장되지 않았습니다.");
  expect(recover).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "키 접근 허용" }));
  expect(recover).toHaveBeenCalledOnce();
  expect((screen.getByLabelText("OpenRouter API 키") as HTMLInputElement).type).toBe("password");
  view.rerender(<LocalizationTestProvider language="ko"><ProviderCredentialNotice recovery={{ ...recovery, recovering: true }} /></LocalizationTestProvider>);
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("status")).toBeTruthy();
  view.rerender(<LocalizationTestProvider language="ko"><ProviderCredentialNotice recovery={{ ...recovery, state: "ready", pending: false }} /></LocalizationTestProvider>);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});

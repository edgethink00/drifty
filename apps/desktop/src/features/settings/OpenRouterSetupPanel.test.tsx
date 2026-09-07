// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { OpenRouterConnectionFields } from "./OpenRouterSetupPanel";

it("establishes the model picker invoker before opening when a click does not focus buttons", () => {
  let activeAtOpen: Element | null = null;
  const onChooseModels = vi.fn(() => { activeAtOpen = document.activeElement; });
  render(<OpenRouterConnectionFields apiKey="" onApiKeyChange={vi.fn()} onChooseModels={onChooseModels} />);
  screen.getByLabelText("OpenRouter API key").focus();
  const trigger = screen.getByRole("button", { name: "Choose OpenRouter models" });
  fireEvent.click(trigger);
  expect(onChooseModels).toHaveBeenCalledOnce();
  expect(activeAtOpen).toBe(trigger);
});

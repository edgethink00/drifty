// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunitySupportSettingsBlock, DRIFTY_DISCORD_INVITE_URL } from "./CommunitySupportSettingsBlock";

const { openUrlMock } = vi.hoisted(() => ({ openUrlMock: vi.fn() }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

describe("CommunitySupportSettingsBlock", () => {
  beforeEach(() => {
    openUrlMock.mockReset();
    openUrlMock.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("opens the permanent Drifty Discord invite outside the app", async () => {
    render(<CommunitySupportSettingsBlock onSendFeedback={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /open discord/i }));

    await waitFor(() => expect(openUrlMock).toHaveBeenCalledWith(DRIFTY_DISCORD_INVITE_URL));
  });

  it("prevents duplicate Discord opens while the first request is pending", async () => {
    let resolveOpen: (() => void) | undefined;
    openUrlMock.mockImplementation(() => new Promise<void>((resolve) => {
      resolveOpen = resolve;
    }));
    render(<CommunitySupportSettingsBlock onSendFeedback={vi.fn()} />);
    const openDiscordButton = screen.getByRole("button", { name: /open discord/i });

    fireEvent.click(openDiscordButton);
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledTimes(1));
    fireEvent.click(openDiscordButton);

    expect(openUrlMock).toHaveBeenCalledTimes(1);
    expect(openDiscordButton.getAttribute("aria-busy")).toBe("true");
    expect(openDiscordButton.getAttribute("disabled")).not.toBeNull();

    resolveOpen?.();
    await waitFor(() => {
      expect(openDiscordButton.getAttribute("aria-busy")).toBe("false");
      expect(openDiscordButton.getAttribute("disabled")).toBeNull();
    });
  });

  it("keeps private feedback on the existing in-app path", () => {
    const onSendFeedback = vi.fn();
    render(<CommunitySupportSettingsBlock onSendFeedback={onSendFeedback} />);

    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));

    expect(onSendFeedback).toHaveBeenCalledTimes(1);
  });

  it("shows an inline recovery message when Discord cannot be opened", async () => {
    openUrlMock.mockRejectedValue(new Error("opener unavailable"));
    render(<CommunitySupportSettingsBlock onSendFeedback={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /open discord/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't open discord/i);
    expect(screen.getByRole("button", { name: /open discord/i }).getAttribute("disabled")).toBeNull();
  });

  it("clears the Discord error and retries after a failed open", async () => {
    openUrlMock.mockRejectedValueOnce(new Error("opener unavailable"));
    render(<CommunitySupportSettingsBlock onSendFeedback={vi.fn()} />);
    const openDiscordButton = screen.getByRole("button", { name: /open discord/i });

    fireEvent.click(openDiscordButton);
    expect(await screen.findByRole("alert")).toBeTruthy();

    fireEvent.click(openDiscordButton);

    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(openUrlMock).toHaveBeenCalledTimes(2));
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock, isTauri: () => true }));

import {
  clearOnboardingGitHubStarResult,
  isGitHubStarDone,
  loadOnboardingGitHubStarAccount,
  markGitHubStarDone,
  readOnboardingGitHubStarResult,
  starDriftyFromOnboarding,
} from "./githubStar";

function answer(replies: Record<string, unknown>) {
  invokeMock.mockImplementation(async (command: string) => replies[command]);
}

afterEach(() => {
  invokeMock.mockReset();
  window.localStorage.clear();
  clearOnboardingGitHubStarResult();
});

describe("loadOnboardingGitHubStarAccount", () => {
  it("names the gh account while the public repository is not starred yet", async () => {
    answer({ github_repository_status: { public: true, stars: 10 }, github_star_status: "not_starred", github_cli_login: "octocat" });
    await expect(loadOnboardingGitHubStarAccount()).resolves.toBe("octocat");
  });

  it("offers nothing without a usable gh, once starred, or once answered", async () => {
    answer({ github_repository_status: { public: true, stars: 10 }, github_star_status: "unavailable", github_cli_login: "octocat" });
    await expect(loadOnboardingGitHubStarAccount()).resolves.toBeNull();
    answer({ github_repository_status: { public: true, stars: 10 }, github_star_status: "starred", github_cli_login: "octocat" });
    await expect(loadOnboardingGitHubStarAccount()).resolves.toBeNull();
    answer({ github_repository_status: { public: true, stars: 10 }, github_star_status: "not_starred", github_cli_login: "octocat" });
    markGitHubStarDone();
    await expect(loadOnboardingGitHubStarAccount()).resolves.toBeNull();
  });
});

describe("starDriftyFromOnboarding", () => {
  it("ends the ask after a star and reports it", async () => {
    answer({ github_star_repository: true });
    await starDriftyFromOnboarding("octocat");
    expect(isGitHubStarDone()).toBe(true);
    expect(readOnboardingGitHubStarResult()).toEqual({ account: "octocat", starred: true });
  });

  it("reports a failure and leaves the corner card free to ask later", async () => {
    invokeMock.mockRejectedValue(new Error("gh failed"));
    await starDriftyFromOnboarding("octocat");
    expect(isGitHubStarDone()).toBe(false);
    expect(readOnboardingGitHubStarResult()).toEqual({ account: "octocat", starred: false });
  });
});

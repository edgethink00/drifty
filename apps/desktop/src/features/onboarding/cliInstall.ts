import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createChatClient } from "../chat/chatClient";
import type { CliSetupChoice } from "./cliPilot";

export type CliInstall =
  | { readonly state: "checking" }
  | { readonly state: "found"; readonly version: string | null; readonly signedIn?: boolean }
  | { readonly state: "missing" }
  | { readonly state: "unavailable" };

export const CLI_CHOICES = ["claude_cli", "codex_cli"] as const satisfies readonly CliSetupChoice[];

/** "2.1.215 (Claude Code)" or "codex-cli 0.162.0" become "2.1.215" / "0.162.0". */
export function shortCliVersion(raw: string | null | undefined): string | null {
  return raw?.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? null;
}

export function cliCommands(choice: CliSetupChoice, windows: boolean): { readonly install: string; readonly login: string } {
  if (choice === "codex_cli") return { install: "npm install -g @openai/codex", login: "codex login" };
  return {
    install: windows ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash",
    login: "claude",
  };
}

export function isWindowsHost(): boolean {
  return typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);
}

const CHECKING: Record<CliSetupChoice, CliInstall> = { claude_cli: { state: "checking" }, codex_cli: { state: "checking" } };
/** A check the user asked for stays visible this long, so pressing the button never looks like nothing happened. */
const MIN_VISIBLE_CHECK_MS = 700;
/**
 * Development review only (?cliRemote=1): a remote that stands in for the
 * user's Terminal. Its switches say whether the chosen CLI is installed and
 * signed in; the app only learns about a change the next time it checks.
 */
export type CliRedetect = "manual" | "focus";
export type CliReviewRemote = { readonly installed: boolean; readonly signedIn: boolean; readonly redetect: CliRedetect };
let remote: CliReviewRemote | null = null;
const remoteListeners = new Set<() => void>();
function initialRemote(): CliReviewRemote | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("cliRemote") !== "1") return null;
  return {
    installed: params.get("cliInstalled") !== "0",
    signedIn: params.get("cliSignedIn") !== "0",
    redetect: params.get("cliRedetect") === "focus" ? "focus" : "manual",
  };
}
remote = initialRemote();
export function getCliReviewRemote(): CliReviewRemote | null {
  return remote;
}
export function setCliReviewRemote(next: Partial<CliReviewRemote>): void {
  if (!remote) return;
  remote = { ...remote, ...next };
  remoteListeners.forEach((listener) => listener());
}
export function subscribeCliReviewRemote(listener: () => void): () => void {
  remoteListeners.add(listener);
  return () => remoteListeners.delete(listener);
}
export function useCliReviewRemote(): CliReviewRemote | null {
  return useSyncExternalStore(subscribeCliReviewRemote, getCliReviewRemote, getCliReviewRemote);
}

function withRemote(install: CliInstall, review: CliReviewRemote | null): CliInstall {
  if (!review || install.state === "unavailable") return install;
  if (!review.installed) return { state: "missing" };
  const version = install.state === "found" ? install.version : "1.0.0";
  return { state: "found", version, signedIn: review.signedIn };
}

/**
 * Looks for the CLIs once when enabled; later checks come from the step's
 * Check again button. With the review remote's "focus" setting it also checks
 * again when the window regains focus (or the remote changes, which stands in
 * for returning from Terminal). A failed lookup is "unavailable", kept apart
 * from a CLI that is not installed.
 */
export function useCliInstalls(enabled: boolean): { readonly installs: Record<CliSetupChoice, CliInstall>; readonly checking: boolean; readonly recheck: () => void } {
  const [installs, setInstalls] = useState(CHECKING);
  const [checking, setChecking] = useState(false);
  const run = useRef(0);
  const review = useCliReviewRemote();
  const recheck = useCallback(() => {
    const id = ++run.current;
    const startedAt = Date.now();
    setChecking(true);
    setInstalls(CHECKING);
    void createChatClient().getStatus().then(status => {
      if (id !== run.current) return;
      const next = (name: "claude" | "codex"): CliInstall => {
        const item = status.providers.find(entry => entry.provider === name);
        const found: CliInstall = item?.installed
          ? { state: "found", version: shortCliVersion(item.version), ...(item.signedIn === undefined ? {} : { signedIn: item.signedIn }) }
          : { state: "missing" };
        return withRemote(found, getCliReviewRemote());
      };
      const result = { claude_cli: next("claude"), codex_cli: next("codex") };
      const wait = Math.max(0, MIN_VISIBLE_CHECK_MS - (Date.now() - startedAt));
      setTimeout(() => {
        if (id !== run.current) return;
        setInstalls(result);
        setChecking(false);
      }, wait);
    }, () => {
      if (id !== run.current) return;
      setInstalls({ claude_cli: { state: "unavailable" }, codex_cli: { state: "unavailable" } });
      setChecking(false);
    });
  }, []);
  useEffect(() => {
    if (!enabled) return;
    recheck();
  }, [enabled, recheck]);
  const redetectOnFocus = review?.redetect === "focus";
  useEffect(() => {
    if (!enabled || !redetectOnFocus) return;
    const onReturn = () => { if (document.visibilityState === "visible") recheck(); };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [enabled, recheck, redetectOnFocus]);
  // In review, a remote switch stands in for finishing in Terminal and coming back.
  const remoteInstalled = review?.installed;
  const remoteSignedIn = review?.signedIn;
  const firstRemote = useRef(true);
  useEffect(() => {
    if (firstRemote.current) { firstRemote.current = false; return; }
    if (!enabled || !redetectOnFocus) return;
    const timer = setTimeout(recheck, 600);
    return () => clearTimeout(timer);
  }, [enabled, recheck, redetectOnFocus, remoteInstalled, remoteSignedIn]);
  return { installs, checking, recheck };
}

import { invoke } from "@tauri-apps/api/core";
import type { DriftAlarmFocusTarget } from "./driftAlarmEvent";
import { isTauriRuntime } from "./watcherBridge";

export function filterDefinitelyAvailableFocusTargets(
  targets: readonly DriftAlarmFocusTarget[],
): DriftAlarmFocusTarget[] {
  return targets.filter((target) => !isBrowserSiteFocusTarget(target));
}

export async function resolveAvailableFocusTargets(
  targets: readonly DriftAlarmFocusTarget[],
): Promise<DriftAlarmFocusTarget[]> {
  const resolvedTargets = await Promise.all(targets.map(async (target) => {
    if (!isBrowserSiteFocusTarget(target)) return target;
    if (await focusTargetBrowserTabExists(target)) return target;
    return null;
  }));

  return resolvedTargets.filter((target): target is DriftAlarmFocusTarget => target !== null);
}

export function haveSameDriftAlarmFocusTargets(
  left: readonly DriftAlarmFocusTarget[],
  right: readonly DriftAlarmFocusTarget[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((target, index) => {
    const nextTarget = right[index];
    return Boolean(nextTarget)
      && target.targetId === nextTarget.targetId
      && target.label === nextTarget.label
      && target.detail === nextTarget.detail
      && target.iconSrc === nextTarget.iconSrc
      && target.siteUrl === nextTarget.siteUrl;
  });
}

function isBrowserSiteFocusTarget(target: DriftAlarmFocusTarget): boolean {
  return Boolean(target.siteDomain?.trim());
}

async function focusTargetBrowserTabExists(target: DriftAlarmFocusTarget): Promise<boolean> {
  const browserName = target.browserName?.trim() ?? "";
  const siteDomain = target.siteDomain?.trim() ?? "";
  const siteUrl = target.siteUrl?.trim() || null;
  if (!browserName || !siteDomain || !isTauriRuntime()) return false;

  try {
    const exists = await invoke<boolean>("focus_target_browser_tab_exists", {
      browserName,
      siteDomain,
      siteUrl,
    });
    return exists === true;
  } catch (error) {
    console.warn("Failed to check focus target browser tab", error);
    return false;
  }
}

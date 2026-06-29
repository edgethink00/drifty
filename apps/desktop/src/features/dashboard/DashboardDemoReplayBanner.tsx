import type { DemoDashboardReplayPhase } from "./demoDashboardReplay";

export type DashboardDemoReplayBannerState = {
  readonly phase: Exclude<DemoDashboardReplayPhase, "idle">;
  readonly progress: number;
  readonly onRestart: () => void;
  readonly onStop: () => void;
};

export function DashboardDemoReplayBanner({ replay: _replay }: { readonly replay: DashboardDemoReplayBannerState | null }) {
  return null;
}

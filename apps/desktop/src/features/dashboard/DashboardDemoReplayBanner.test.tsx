// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardDemoReplayBanner, type DashboardDemoReplayBannerState } from "./DashboardDemoReplayBanner";

describe("DashboardDemoReplayBanner", () => {
  it("renders nothing when replay is inactive", () => {
    const { container } = render(<DashboardDemoReplayBanner replay={null} />);

    expect(container.firstChild).toBeNull();
  });

  it.each(["pre_roll", "playing", "complete"] satisfies DashboardDemoReplayBannerState["phase"][])(
    "renders nothing while replay is %s",
    (phase) => {
    const onStop = vi.fn();
    const onRestart = vi.fn();

    const { container } = render(
      <DashboardDemoReplayBanner
        replay={{
          phase,
          progress: 0.42,
          onRestart,
          onStop,
        }}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(onStop).not.toHaveBeenCalled();
    expect(onRestart).not.toHaveBeenCalled();
    },
  );
});

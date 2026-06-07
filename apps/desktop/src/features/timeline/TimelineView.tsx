import type { formatTimelineItems } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";

type TimelineItem = ReturnType<typeof formatTimelineItems>[number];

export function TimelineView({
  items,
  appIcons,
}: {
  items: TimelineItem[];
  appIcons: Record<string, string | null>;
}) {
  return (
    <div>
      <h3>Timeline</h3>
      <p className="muted">Captured sequence for the selected day.</p>
      <div className="list">
        {items.map((item) => (
          <div className="segment-row segment-row--rich" key={item.id}>
            <div className="segment-main">
              <AppGlyph appName={item.appName} iconSrc={appIcons[item.bundleId ?? item.appName] ?? null} />
              <div className="segment-main__body">
                <div className="segment-title-line">
                  <strong>{item.appName}</strong>
                  {item.siteDomain ? (
                    <span className="segment-site-pill">
                      <SiteFavicon domain={item.siteDomain} size={14} fallbackIconSrc={appIcons[item.bundleId ?? item.appName] ?? null} />
                      {item.siteDomain}
                    </span>
                  ) : null}
                </div>
                <div className="muted segment-summary">{item.siteTitle ?? item.windowTitle ?? "No window title"}</div>
              </div>
            </div>
            <div className="segment-meta">
              <div className="segment-meta__range">{item.startedLabel} — {item.endedLabel}</div>
              <span className="pill">{item.durationLabel}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

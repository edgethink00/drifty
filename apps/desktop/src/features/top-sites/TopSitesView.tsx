import type { SiteDuration } from "@drifty/domain";
import { SiteFavicon } from "../../components/SiteFavicon";

export function TopSitesView({
  sites,
  appIcons = {},
}: {
  sites: SiteDuration[];
  appIcons?: Record<string, string | null>;
}) {
  if (sites.length === 0) {
    return <p className="muted">No site data for this day.</p>;
  }

  const max = Math.max(...sites.map((site) => site.totalSeconds), 1);

  return (
    <div className="top-sites-list">
      {sites.map((site) => (
        <div className="top-site-row" key={site.siteDomain}>
          <div className="top-site-main">
            <SiteFavicon domain={site.siteDomain} size={24} fallbackIconSrc={site.browserName ? appIcons[site.browserName] ?? null : null} />
            <div>
              <strong>{site.siteDomain}</strong>
              <div className="muted">
                {site.siteTitle ?? site.browserName ?? "Browser session"}
              </div>
            </div>
          </div>
          <div className="top-site-meta">
            <strong>{Math.round(site.totalSeconds / 60)}m</strong>
            <span className="muted">{site.visits} visits</span>
          </div>
          <div className="mini-meter">
            <div className="mini-meter__fill" style={{ width: `${(site.totalSeconds / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

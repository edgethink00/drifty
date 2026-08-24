import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";

type DriftAlarmSourceIconProps = {
  readonly siteDomain: string | null;
  readonly appName: string;
  readonly iconSrc: string | null;
};

export function DriftAlarmSourceIcon({ siteDomain, appName, iconSrc }: DriftAlarmSourceIconProps) {
  if (siteDomain) {
    // The alarm runs in its own least-privilege window with no site-icon
    // context and no tracker commands, so the icon has to arrive resolved in
    // the event payload.
    return <SiteFavicon domain={siteDomain} iconSrc={iconSrc} size={20} />;
  }
  if (iconSrc) {
    return <img className="app-icon app-icon--sm" src={iconSrc} alt="" aria-hidden="true" />;
  }
  return <AppGlyph appName={appName} iconSrc={null} size="sm" />;
}

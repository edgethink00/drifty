import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";

type DriftAlarmSourceIconProps = {
  readonly siteDomain: string | null;
  readonly appName: string;
  readonly iconSrc: string | null;
};

export function DriftAlarmSourceIcon({ siteDomain, appName, iconSrc }: DriftAlarmSourceIconProps) {
  if (siteDomain) {
    return <SiteFavicon domain={siteDomain} fallbackIconSrc={iconSrc} size={20} />;
  }
  if (iconSrc) {
    return <img className="app-icon app-icon--sm" src={iconSrc} alt="" aria-hidden="true" />;
  }
  return <AppGlyph appName={appName} iconSrc={null} size="sm" />;
}

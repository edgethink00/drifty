import { useState } from "react";
import { useAppIconPresentation } from "./useAppIconPresentation";
import { useSiteIcon } from "./SiteIconContext";

/**
 * Renders a site icon from the local cache.
 *
 * The icon bytes are fetched and cached by the native layer, so this component
 * only ever renders a `data:` URL, a caller-supplied app icon, or a lettered
 * placeholder - it issues no network request of its own.
 */
export function SiteFavicon({
  domain,
  size = 20,
  fallbackIconSrc,
  iconSrc: explicitIconSrc,
}: {
  domain: string;
  size?: number;
  fallbackIconSrc?: string | null;
  /**
   * Pre-resolved icon for surfaces outside the main window, which have no
   * site-icon context and cannot call the native command themselves. The
   * drift alarm overlay receives its icons in the event payload.
   */
  iconSrc?: string | null;
}) {
  const cachedIconSrc = useSiteIcon(domain);
  const appFallback = useAppIconPresentation(explicitIconSrc || cachedIconSrc ? null : fallbackIconSrc);
  const resolvedSrc = explicitIconSrc ?? cachedIconSrc ?? appFallback ?? null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const iconSrc = resolvedSrc && resolvedSrc !== failedSrc ? resolvedSrc : null;

  if (!iconSrc) {
    return (
      <div className="site-favicon site-favicon--fallback" style={{ width: size, height: size }} aria-hidden="true">
        <span>{domain[0]?.toUpperCase() ?? "•"}</span>
      </div>
    );
  }

  return (
    <img
      className="site-favicon"
      src={iconSrc}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailedSrc(iconSrc)}
    />
  );
}

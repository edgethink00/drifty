import { createContext, useContext } from "react";
import type { SiteIconMap } from "../features/app-icons/siteIconRequests";

/**
 * Site icons are resolved natively and cached on disk, then read here as
 * `data:` URLs. A context keeps every `SiteFavicon` call site unchanged
 * instead of threading another map through the component tree, which already
 * passes `appIcons` through more than twenty props.
 */
const SiteIconContext = createContext<SiteIconMap>({});

export const SiteIconProvider = SiteIconContext.Provider;

export function useSiteIcon(domain: string | null | undefined): string | null {
  const icons = useContext(SiteIconContext);
  if (!domain) return null;
  return icons[domain.trim().toLowerCase()] ?? null;
}


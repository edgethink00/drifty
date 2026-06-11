import { useEffect, useMemo, useState } from "react";

function faviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

export function SiteFavicon({
  domain,
  size = 20,
  fallbackIconSrc,
}: {
  domain: string;
  size?: number;
  fallbackIconSrc?: string | null;
}) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const sources = useMemo(() => {
    const nextSources = [faviconUrl(domain)];
    if (fallbackIconSrc) {
      nextSources.push(fallbackIconSrc);
    }
    return nextSources;
  }, [domain, fallbackIconSrc]);

  useEffect(() => {
    setSourceIndex(0);
  }, [sources]);

  if (sourceIndex >= sources.length) {
    return (
      <div className="site-favicon site-favicon--fallback" style={{ width: size, height: size }} aria-hidden="true">
        {domain[0]?.toUpperCase() ?? "•"}
      </div>
    );
  }

  return (
    <img
      className="site-favicon"
      src={sources[sourceIndex]}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setSourceIndex((current) => current + 1)}
    />
  );
}

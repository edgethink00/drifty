const NOISE_QUERY_KEY_PREFIXES = ["utm_"] as const;

const NOISE_QUERY_KEYS = new Set([
  "access_token",
  "auth",
  "auth_token",
  "fbclid",
  "feature",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "password",
  "ref",
  "ref_src",
  "refresh_token",
  "session",
  "session_id",
  "sessionid",
  "si",
  "sid",
  "source",
  "t",
  "token",
  "yclid",
]);

function parsedHttpUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    return parsed;
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

function canonicalHost(hostname: string): string {
  let host = hostname.toLowerCase().replace(/\.+$/g, "");
  while (host.startsWith("www.")) host = host.slice(4);
  return host;
}

function isNoiseQueryKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return NOISE_QUERY_KEYS.has(normalized)
    || NOISE_QUERY_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    || normalized.includes("token")
    || normalized.includes("secret")
    || normalized.includes("session")
    || normalized.includes("password");
}

function cleanedQuery(searchParams: URLSearchParams): string {
  const kept = [...searchParams.entries()]
    .filter(([key]) => !isNoiseQueryKey(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyOrder = leftKey.localeCompare(rightKey);
      return keyOrder === 0 ? leftValue.localeCompare(rightValue) : keyOrder;
    });
  return new URLSearchParams(kept).toString();
}

function canonicalPath(pathname: string): string {
  return pathname === "/" ? "" : pathname;
}

function buildCanonicalUrl(parsed: URL, host: string, pathname: string, query: string): string {
  const port = parsed.port ? `:${parsed.port}` : "";
  const path = canonicalPath(pathname);
  const suffix = query ? `?${query}` : "";
  return `${parsed.protocol.toLowerCase()}//${host}${port}${path}${suffix}`;
}

function youtubeVideoIdFromPath(pathname: string): string | null {
  return pathname.split("/").filter(Boolean)[0] ?? null;
}

function canonicalizeYouTubeUrl(parsed: URL, host: string): string | null {
  const pathParts = parsed.pathname.split("/").filter(Boolean);
  if (host === "youtu.be") {
    const videoId = youtubeVideoIdFromPath(parsed.pathname);
    return videoId ? `https://youtube.com/watch?v=${encodeURIComponent(videoId)}` : null;
  }

  if (host !== "youtube.com" && host !== "m.youtube.com") return null;

  const firstPathPart = pathParts[0] ?? "";
  if (firstPathPart === "watch") {
    const videoId = parsed.searchParams.get("v")?.trim();
    return videoId ? `https://youtube.com/watch?v=${encodeURIComponent(videoId)}` : null;
  }
  if (firstPathPart === "shorts") {
    const videoId = pathParts[1]?.trim() ?? "";
    return videoId ? `https://youtube.com/shorts/${encodeURIComponent(videoId)}` : null;
  }
  if (firstPathPart === "playlist") {
    const playlistId = parsed.searchParams.get("list")?.trim();
    return playlistId ? `https://youtube.com/playlist?list=${encodeURIComponent(playlistId)}` : null;
  }

  return buildCanonicalUrl(parsed, "youtube.com", parsed.pathname, cleanedQuery(parsed.searchParams));
}

export function canonicalizeClassificationRuleSiteUrl(value?: string | null): string | null {
  if (!value) return null;
  const parsed = parsedHttpUrl(value);
  if (!parsed) return null;

  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";

  const host = canonicalHost(parsed.hostname);
  const youtubeUrl = canonicalizeYouTubeUrl(parsed, host);
  if (youtubeUrl) return youtubeUrl;

  return buildCanonicalUrl(parsed, host, parsed.pathname, cleanedQuery(parsed.searchParams));
}

export function siteTargetFromCanonicalUrl(value: string): string | null {
  const parsed = parsedHttpUrl(value);
  return parsed ? canonicalHost(parsed.hostname) : null;
}

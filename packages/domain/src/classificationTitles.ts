/** Only already-allowed title fields belong here; callers apply privacy switches first. */
export type ClassificationTitleInput = {
  readonly appName: string;
  readonly bundleId?: string | null;
  readonly browserName?: string | null;
  readonly siteDomain?: string | null;
  readonly windowTitle?: string | null;
  readonly title?: string | null;
};

const BROWSER_NAMES = new Set([
  "arc", "aside", "brave", "brave browser", "chrome", "chrome canary", "chromium", "comet", "dia",
  "duckduckgo", "firefox", "firefox developer edition", "floorp", "google chrome", "google chrome beta",
  "google chrome canary", "google chrome dev", "google chrome for testing", "helium", "microsoft edge",
  "mozilla firefox", "msedge", "naver whale", "opera", "opera gx", "safari", "safari technology preview",
  "thorium", "vivaldi", "whale", "zen", "zen browser", "네이버 웨일",
]);
const BROWSER_BUNDLES = new Set([
  "com.apple.safari", "com.apple.safaritechnologypreview", "com.brave.browser", "com.google.chrome",
  "com.google.chrome.beta", "com.google.chrome.dev", "com.google.chrome.canary", "com.microsoft.edgemac",
  "company.thebrowser.browser", "company.thebrowser.dia", "org.chromium.chromium", "org.mozilla.firefox",
]);
// Observed browser labels; an arbitrary occurrence of "memory" or a capacity is insufficient.
const MEMORY_LABELS = new Set([
  "high memory usage", "메모리 사용량 많음", "메모리 사용량 높음", "hohe arbeitsspeichernutzung",
  "高記憶體用量", "メモリを大量に使用", "memoria utilizzata elevata", "mức sử dụng bộ nhớ cao",
  "vysoké využitie pamäte", "内存用量高", "yüksek bellek kullanımı", "vysoké využití paměti",
  "uso elevado de memoria", "utilisation élevée de la mémoire", "høy minnebruk",
  "การใช้งานหน่วยความจำสูง", "penggunaan memori tinggi",
]);
const MEMORY_VALUE = /^\d+(?:[.,]\d+)?\s*(?:MB|GB|MiB|GiB)$/i;
const DECORATION_SEPARATOR = /\s+[-–—|]\s+|:\s*/g;
const LEADING_COUNTER = /^\(\d+\)\s*/;
const EDGE_PAGES = /^\s+(?:and \d+ more pages?|외 페이지\s*\d+개|und \d+ weitere Seiten|et \d+ autres? pages?|y \d+ páginas? más|e \d+ altre pagine)(?=\s*(?:[-–—|]|$))/i;
const EDITOR_APP = /^(?:adobe )?(?:photoshop|illustrator)(?: \d{4})?$/i;
// Greedy filename ends at the LAST @; a filename may itself contain "@ 100% (RGB/8)".
const EDITOR_ZOOM = /^(.*)\s+@\s+\d+(?:[.,]\d+)?\s*%(\s*\([^()\n]*(?:RGB|CMYK|Gray|Lab|Bitmap)[^()\n]*\)\s*\*?)$/;
const MGBA_FPS = /^(mGBA\s+[-–—]\s+.+?)\s+\(\d+(?:[.,]\d+)?\s*fps\)(\s+[-–—]\s+\d+\.\d+\.\d+(?:[-\w.]*)?)$/i;

function text(value?: string | null): string | null {
  const normalized = value?.normalize("NFC").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function marker(value?: string | null): string {
  // Edge embeds these in its product name. Never remove them from page content.
  return (value ?? "").replace(/[\u200b\u200c\u200d\ufeff]/g, "").toLowerCase().trim();
}

function isBrowser(input: ClassificationTitleInput): boolean {
  return BROWSER_NAMES.has(marker(input.appName)) || BROWSER_NAMES.has(marker(input.browserName))
    || BROWSER_BUNDLES.has(marker(input.bundleId));
}

function isEdge(input: ClassificationTitleInput): boolean {
  return [input.appName, input.browserName].some((name) => ["microsoft edge", "msedge"].includes(marker(name)))
    || marker(input.bundleId) === "com.microsoft.edgemac";
}

function platformTitleWithoutCounter(title: string, domain?: string | null): string {
  const match = title.match(LEADING_COUNTER);
  if (!match) return title;
  const remainder = title.slice(match[0].length);
  const host = (domain ?? "").toLowerCase().replace(/^www\./, "");
  const expected: Record<string, string> = {
    "youtube.com": "YouTube", "m.youtube.com": "YouTube", "instagram.com": "Instagram",
    "discord.com": "Discord", "facebook.com": "Facebook", "x.com": "X",
  };
  // Only a measured platform shell title, never an arbitrary video/article such as (500) Days of Summer.
  return expected[host] === remainder ? remainder : title;
}

type Decoration = { readonly separator: string; readonly value: string };

function decorations(tail: string): Decoration[] | null {
  const separators = [...tail.matchAll(DECORATION_SEPARATOR)];
  if (!separators.length || separators[0].index !== 0) return null;
  return separators.map((part, i) => ({
    separator: part[0],
    value: tail.slice(part.index + part[0].length, separators[i + 1]?.index ?? tail.length),
  }));
}

/**
 * Stable classification text without rewriting tracker records or manual rules.
 * Browser decorations require an independent page title and a recognized browser suffix.
 * Unknown tail fields (profile, tab group, audio, microphone, timers) remain evidence.
 */
export function normalizeClassificationTitles(input: ClassificationTitleInput): { windowTitle: string | null; title: string | null } {
  let windowTitle = text(input.windowTitle);
  let title = text(input.title);
  if (!windowTitle) {
    if (title && isBrowser(input)) title = platformTitleWithoutCounter(title, input.siteDomain);
    return { windowTitle, title };
  }
  if (!isBrowser(input)) {
    if (EDITOR_APP.test(input.appName)) windowTitle = windowTitle.replace(EDITOR_ZOOM, "$1$2");
    if (marker(input.appName) === "mgba") windowTitle = windowTitle.replace(MGBA_FPS, "$1$2");
    return { windowTitle, title };
  }
  if (!title) return { windowTitle, title };

  const originalTitle = title;
  title = platformTitleWithoutCounter(title, input.siteDomain);
  let candidate = windowTitle;
  if (originalTitle !== title && candidate.startsWith(originalTitle)) {
    candidate = title + candidate.slice(originalTitle.length);
  } else if (!candidate.startsWith(title)) {
    const withoutCounter = candidate.replace(LEADING_COUNTER, "");
    if (withoutCounter.startsWith(title)) candidate = withoutCounter;
  }
  if (!candidate.startsWith(title)) return { windowTitle, title };
  let tail = candidate.slice(title.length);
  if (!tail) return { windowTitle: candidate, title };

  // A prefix inside a longer word is not evidence that the captured titles agree.
  const pages = isEdge(input) ? tail.match(EDGE_PAGES)?.[0] : undefined;
  if (pages) tail = tail.slice(pages.length);
  const parts = decorations(tail);
  if (!parts) return { windowTitle, title };
  // A profile can itself be named "Chrome"; multiple browser tokens are ambiguous.
  if (parts.filter((part) => BROWSER_NAMES.has(marker(part.value))).length > 1) return { windowTitle, title };
  let browserIndex = -1;
  for (let i = parts.length - 1; i >= Math.max(0, parts.length - 2); i -= 1) {
    if (BROWSER_NAMES.has(marker(parts[i].value))) { browserIndex = i; break; }
  }
  if (browserIndex < 0) return { windowTitle, title };

  const removed = new Set<number>([browserIndex]);
  for (let i = 0; i < browserIndex; i += 1) {
    if (MEMORY_LABELS.has(marker(parts[i].value)) && i + 1 < browserIndex && MEMORY_VALUE.test(parts[i + 1].value)) {
      removed.add(i);
      removed.add(i + 1);
      i += 1;
    } else if (!isEdge(input) && /^(?:Left view|Right view)$/.test(parts[i].value)) {
      removed.add(i);
    }
  }
  windowTitle = title + parts.filter((_, i) => !removed.has(i)).map((part) => part.separator + part.value).join("");
  return { windowTitle, title };
}

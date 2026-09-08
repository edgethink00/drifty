import type { ActivitySegment } from "@drifty/domain";

// These are intervention eligibility hints, not replacements for the shared
// activity classifier. Ambiguous videos still go through the existing AI gate.
const MUSIC_OR_LEARNING_HINTS = /\b(?:music|songs?|soundtrack|ost|bgm|lyrics?|ballad|ambient|ambience|lo[ -]?fi|relax(?:ing|ation)?|meditation|study|studying|tutorials?|lectures?|courses?|lessons?|education(?:al)?|learn(?:ing)?|how\s+to|programming|coding|software|unreal|unity|godot|blender|gamedev|game\s+(?:dev(?:elopment)?|design)|film\s*making|analysis|documentary|business|industry|career|workshop)\b|음악|노래|가사|발라드|플레이리스트|공부|학습|강의|강좌|수업|교육|튜토리얼|프로그래밍|코딩|개발|제작\s*(?:법|방법|과정)|만드는\s*(?:법|방법)|업무|창업|취업|면접|산업|업계|비즈니스|다큐|분석|해설/i;
const COMEDY_FORMAT = /스케치\s*코미디|콩트|상황극|개그|\b(?:comedy\s+sketch|sketch\s+comedy|skit|stand[ -]?up\s+comedy)\b/i;
const RECAP_FORMAT = /결말\s*포함|몰아\s*보기|\b(?:movie|film|anime|drama)\s+recap\b|\bfull\s+episode\b/i;

/** Called only after the normal classifier has selected a YouTube drift candidate. */
export function selectedYouTubeDriftReason(segment: ActivitySegment): string | null {
  const title = segment.youtubeTitle?.trim();
  if (!title || !hasMatchingVideoUrl(segment)) return null;

  // Descriptions and tags may reveal a tutorial or soundtrack even when the
  // title does not. A veto leaves the AI decision intact; it never forces focus.
  const metadata = [title, segment.youtubeDescription, ...(segment.youtubeKeywords ?? [])].filter(Boolean).join("\n");
  if (MUSIC_OR_LEARNING_HINTS.test(metadata)) return null;

  const category = segment.youtubeCategory?.trim().toLowerCase().replace(/\s+/g, " ");
  if (category === "gaming") return "youtube-selected-gaming";
  if (category === "comedy" && COMEDY_FORMAT.test(title)) return "youtube-selected-comedy";
  if (category === "film & animation" && RECAP_FORMAT.test(title)) return "youtube-selected-recap";
  return null;
}

function hasMatchingVideoUrl(segment: ActivitySegment): boolean {
  const videoId = segment.youtubeVideoId;
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId) || !segment.siteUrl) return false;
  try {
    const url = new URL(segment.siteUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const site = segment.siteDomain?.trim().toLowerCase().replace(/^www\./, "");
    if (host !== site) return false;
    if (host === "youtu.be") return url.pathname === `/${videoId}`;
    return (host === "youtube.com" || host === "m.youtube.com")
      && url.pathname === "/watch"
      && url.searchParams.get("v") === videoId;
  } catch {
    return false;
  }
}

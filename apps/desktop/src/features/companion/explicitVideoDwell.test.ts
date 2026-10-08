import { describe, it, expect, vi } from "vitest";
import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";
import { buildDriftAlarmCandidates } from "./driftAlarmData";
import { evaluateYouTubeDriftAlarmGate } from "./youtubeDriftAlarmGate";
const { classifyLiveActivityWithAi } = vi.hoisted(() => ({ classifyLiveActivityWithAi: vi.fn() }));
vi.mock("../classification/aiClassificationService", () => ({ classifyLiveActivityWithAi }));
const unavailable: ClassificationOptions = { includeBuiltInHeuristics: false, includeAiClassifications: true,
  builtInHeuristicsUnavailableSince: "2026-10-08T00:00:00.000Z" };
function row(url: string | null, seconds = 120, start = 0, extra: Partial<ActivitySegment> = {}): ActivitySegment {
  return { id: `s-${start}`, appName: "Google Chrome", browserName: "Google Chrome",
    bundleId: "c:\\program files\\google\\chrome\\application\\chrome.exe", platform: "windows", source: "win32-foreground",
    siteDomain: url ? new URL(url).hostname.replace(/^www\./, "") : "instagram.com", siteUrl: url ?? undefined,
    windowTitle: "Viewing activity", siteTitle: "Viewing activity",
    startedAt: new Date(Date.UTC(2026, 9, 8, 0, 1, start)).toISOString(),
    endedAt: new Date(Date.UTC(2026, 9, 8, 0, 1, start + seconds)).toISOString(), durationSeconds: seconds, ...extra };
}
const reel = "https://www.instagram.com/reel/reference/";
const short = "https://www.youtube.com/shorts/SHORT000001";
const manualFocus = { category: "learning", productivity: "focus", source: "manual", confidence: 1 } as const;
const aiFocus = { ...manualFocus, source: "llm", aiResult: true } as const;
const cases: {
  name: string;
  rows: ActivitySegment[];
  options?: ClassificationOptions;
  delay?: number;
  currentUrl?: string;
  shouldClose?: boolean;
  noSnapshot?: boolean;
}[] = [
  { name: "single Shorts", shouldClose: true, rows: [row(short, 120, 0, { youtubeIsShorts: true, youtubeVideoId: "SHORT000001" })] },
  { name: "single Reels", shouldClose: true, rows: [row(reel)] },
  { name: "single TikTok video", shouldClose: true, rows: [row("https://www.tiktok.com/@creator/video/123456789")] },
  { name: "single TikTok root", shouldClose: true, rows: [row("https://www.tiktok.com/")] },
  { name: "Instagram reference profile", rows: [row("https://www.instagram.com/referenceprofile/")] },
  { name: "Instagram reference post", rows: [row("https://www.instagram.com/p/reference/")] },
  { name: "TikTok reference profile", rows: [row("https://www.tiktok.com/@referenceprofile")] },
  { name: "unknown captured Instagram path", rows: [row(null)] },
  { name: "X profile outside video scope", rows: [row("https://x.com/referenceprofile")] },
  { name: "current DM", rows: [row("https://www.instagram.com/direct/inbox/")] },
  { name: "current login path", rows: [row("https://www.instagram.com/accounts/login/")] },
  { name: "manual Focus Reel", rows: [row(reel, 120, 0, { classification: manualFocus })] },
  { name: "user Focus rule", rows: [row(reel)], options: { rules: [{ targetKind: "site", targetValue: "instagram.com", category: "learning", productivity: "focus", enabled: true }] } },
  { name: "AI Focus learning Short", rows: [row(short, 120, 0, { youtubeIsShorts: true, youtubeVideoId: "SHORT000001", classification: aiFocus })] },
  { name: "profile 110s then Reel 10s", rows: [row("https://www.instagram.com/referenceprofile/", 110), row(reel, 10, 110)] },
  { name: "manual Focus Reel 110s then unknown Reel 10s", rows: [row(reel, 110, 0, { classification: manualFocus }), row(reel, 10, 110)] },
  { name: "DM 110s then Reel 10s", rows: [row("https://www.instagram.com/direct/inbox/", 110), row(reel, 10, 110)] },
  { name: "59s below minimum", rows: [row(reel, 59)] },
  { name: "long user delay", rows: [row(reel, 120)], delay: 180 },
  { name: "interrupted viewing 120s then 10s", rows: [row(reel, 120), row(reel, 10, 200)] },
  { name: "ordinary YouTube learning video", rows: [row("https://www.youtube.com/watch?v=STUDY000001", 120, 0, { youtubeVideoId: "STUDY000001", youtubeCategory: "Education", youtubeIsShorts: false })] },
  { name: "profile row before fresh Reel snapshot", rows: [row("https://www.instagram.com/referenceprofile/")], currentUrl: reel },
  { name: "manual Focus row before fresh Reel snapshot", rows: [row(reel, 120, 0, { classification: manualFocus })], currentUrl: "https://www.instagram.com/reel/next/" },
  { name: "two explicit Reels 35s each", rows: [row(reel, 35), row("https://www.instagram.com/reel/next/", 35, 35)], shouldClose: true },
  { name: "exact 60s explicit Reel", rows: [row(reel, 60)], shouldClose: true },
  { name: "no current snapshot", rows: [row(reel)], noSnapshot: true },
  { name: "Instagram Explore outside video scope", rows: [row("https://www.instagram.com/explore/")] },
  { name: "Instagram Stories outside video scope", rows: [row("https://www.instagram.com/stories/reference/")] },
  { name: "TikTok Explore outside video scope", rows: [row("https://www.tiktok.com/explore")] },
  { name: "remote current row", rows: [row(reel, 120, 0, { deviceId: "other-device" })] },
  { name: "imported current row", rows: [row(reel, 120, 0, { source: "browser-history-import", siteSource: "browser-history-import" })] },
  { name: "captured host mismatches URL", rows: [row(reel, 120, 0, { siteDomain: "tiktok.com" })] },
  { name: "non-web URL", rows: [row("file://instagram.com/reel/reference/")] },
  { name: "AI neutral Reel", rows: [row(reel, 120, 0, { classification: { category: "social_media", productivity: "neutral", source: "llm", aiResult: true, confidence: 1 } })] },
  { name: "user neutral rule", rows: [row(reel)], options: { rules: [{ targetKind: "site", targetValue: "instagram.com", category: "social_media", productivity: "neutral", enabled: true }] } },
  { name: "long user delay reached", rows: [row(reel, 180)], delay: 180, shouldClose: true },
  { name: "two browsers do not combine", rows: [row(reel, 50, 0, { browserName: "Microsoft Edge", appName: "Microsoft Edge", bundleId: "msedge.exe" }), row(reel, 20, 50)] },
];
describe("explicit unclassified video dwell", () => {
  it.each(cases)("$name", async ({ rows, options, delay, currentUrl, shouldClose, noSnapshot }) => {
    const latest = rows[rows.length - 1]!;
    const snapshot = { observedAt: latest.endedAt, appName: latest.appName, bundleId: latest.bundleId ?? null, browserName: latest.browserName ?? null, windowTitle: latest.windowTitle ?? null, siteDomain: latest.siteDomain ?? null, siteTitle: latest.siteTitle ?? null, siteUrl: currentUrl ?? latest.siteUrl ?? null, youtubeIsShorts: latest.youtubeIsShorts ?? null, youtubeVideoId: latest.youtubeVideoId ?? null, source: latest.source };
    const input = { segments: rows, currentSnapshot: noSnapshot ? null : snapshot, classificationOptions: { ...unavailable, ...options }, minimumDurationSeconds: delay ?? 30 };
    const candidates = buildDriftAlarmCandidates(input);
    expect(candidates).toHaveLength(shouldClose ? 1 : 0);
    const candidate = candidates[0];
    const gate = candidate ? await evaluateYouTubeDriftAlarmGate({ segment: candidate.segment, category: candidate.category, classificationSource: candidate.classification.source, allowAiClassification: false }) : null;
    if (candidate)
      expect(gate?.kind).toBe("skipped");
    expect(classifyLiveActivityWithAi).not.toHaveBeenCalled();
  });
});

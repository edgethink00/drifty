import { describe, expect, it } from 'vitest';
import {
  FLOW_INTERVAL_OPTIONS,
  buildAppUsageSummaries,
  buildFlowBlocks,
  buildDailyTotals,
  buildHourlyBuckets,
  buildProductivityPersona,
  computePreservedFocusStrikeSeconds,
  classifyActivity,
  classifyActivityDetailed,
  groupSegmentsByApp,
  topSites,
  type ActivitySegment,
  type ProductivityPersonaId,
} from '@drifty/domain';

const segments: ActivitySegment[] = [
  {
    id: '1',
    startedAt: '2026-04-06T09:00:00.000Z',
    endedAt: '2026-04-06T09:30:00.000Z',
    durationSeconds: 1800,
    appName: 'Code',
    bundleId: 'com.microsoft.VSCode',
    windowTitle: 'app.tsx',
    platform: 'macos',
    source: 'nsworkspace',
  },
  {
    id: '2',
    startedAt: '2026-04-06T09:30:00.000Z',
    endedAt: '2026-04-06T10:00:00.000Z',
    durationSeconds: 1800,
    appName: 'Code',
    bundleId: 'com.microsoft.VSCode',
    windowTitle: 'app.tsx',
    platform: 'macos',
    source: 'nsworkspace',
  },
];

const appUsageSegments: ActivitySegment[] = [
  {
    id: 'a-1',
    startedAt: '2026-04-06T08:00:00.000Z',
    endedAt: '2026-04-06T08:30:00.000Z',
    durationSeconds: 1800,
    appName: 'Alpha',
    bundleId: null,
    windowTitle: 'Alpha window',
    platform: 'macos',
    source: 'nsworkspace',
  },
  {
    id: 'a-2',
    startedAt: '2026-04-07T09:00:00.000Z',
    endedAt: '2026-04-07T09:30:00.000Z',
    durationSeconds: 1800,
    appName: 'Alpha',
    bundleId: 'com.alpha.app',
    windowTitle: 'Alpha window',
    platform: 'macos',
    source: 'nsworkspace',
  },
  {
    id: 'b-1',
    startedAt: '2026-04-06T10:00:00.000Z',
    endedAt: '2026-04-06T11:00:00.000Z',
    durationSeconds: 3600,
    appName: 'Beta',
    bundleId: 'com.beta.app',
    windowTitle: 'Beta window',
    platform: 'macos',
    source: 'nsworkspace',
  },
  {
    id: 'c-1',
    startedAt: '2026-04-06T12:00:00.000Z',
    endedAt: '2026-04-06T12:30:00.000Z',
    durationSeconds: 1800,
    appName: 'Gamma',
    bundleId: 'com.gamma.app',
    windowTitle: 'Gamma window',
    platform: 'macos',
    source: 'nsworkspace',
  },
];

function localIso(hour: number, minute: number): string {
  return new Date(2026, 3, 6, hour, minute, 0, 0).toISOString();
}

function localIsoAt(dayOffset: number, hour: number, minute: number): string {
  return new Date(2026, 3, 6 + dayOffset, hour, minute, 0, 0).toISOString();
}

function segment(input: {
  id: string;
  start: string;
  end: string;
  appName: string;
  bundleId?: string | null;
  windowTitle?: string | null;
  browserName?: string | null;
  siteDomain?: string | null;
  siteTitle?: string | null;
  classification?: ActivitySegment['classification'];
}): ActivitySegment {
  return {
    id: input.id,
    startedAt: input.start,
    endedAt: input.end,
    durationSeconds: Math.round((new Date(input.end).getTime() - new Date(input.start).getTime()) / 1000),
    appName: input.appName,
    bundleId: input.bundleId ?? null,
    windowTitle: input.windowTitle ?? null,
    browserName: input.browserName ?? null,
    siteDomain: input.siteDomain ?? null,
    siteTitle: input.siteTitle ?? null,
    platform: 'macos',
    source: 'nsworkspace',
    classification: input.classification ?? null,
  };
}

describe('domain helpers', () => {
  it('groups segments by app', () => {
    const groups = groupSegmentsByApp(segments);
    expect(groups).toHaveLength(1);
    expect(groups[0].durationSeconds).toBe(3600);
  });

  it('builds hourly buckets', () => {
    const buckets = buildHourlyBuckets(segments);
    const hourLabel = `${new Date(segments[0].startedAt).getHours().toString().padStart(2, '0')}:00`;
    const bucket = buckets.find((entry) => entry.hourLabel === hourLabel);
    expect(bucket?.durationSeconds).toBe(3600);
    expect(buckets[0].durationSeconds).toBe(0);
  });

  it('aggregates top sites and flow blocks', () => {
    const browserSegments: ActivitySegment[] = [
      {
        ...segments[0],
        id: 'browser-1',
        appName: 'Safari',
        browserName: 'Safari',
        siteDomain: 'tauri.app',
        siteTitle: 'Tauri docs',
      },
    ];
    const sites = topSites(browserSegments);
    const blocks = buildFlowBlocks(browserSegments, '2026-04-06');
    expect(sites[0].siteDomain).toBe('tauri.app');
    expect(blocks).toHaveLength(6);
    expect(blocks[0].siteDomain).toBe('tauri.app');
  });

  it('assigns pre-4am activity to the previous logical day', () => {
    const logicalSegments = [
      segment({
        id: 'boundary-crossing',
        start: localIsoAt(1, 3, 0),
        end: localIsoAt(1, 5, 0),
        appName: 'Code',
        windowTitle: 'Project docs',
      }),
    ];

    expect(buildDailyTotals(logicalSegments, '2026-04-06', '2026-04-07', 4 * 60)).toEqual([
      { day: '2026-04-06', totalSeconds: 60 * 60 },
      { day: '2026-04-07', totalSeconds: 60 * 60 },
    ]);
  });

  it('builds flow blocks for the configured logical day window', () => {
    const logicalSegments = [
      segment({
        id: 'late-night-docs',
        start: localIsoAt(1, 3, 50),
        end: localIsoAt(1, 4, 5),
        appName: 'Safari',
        siteTitle: 'Developer docs',
      }),
    ];

    const previousLogicalDayBlocks = buildFlowBlocks(logicalSegments, '2026-04-06', 5, undefined, 4 * 60);
    const nextLogicalDayBlocks = buildFlowBlocks(logicalSegments, '2026-04-07', 5, undefined, 4 * 60);

    expect(previousLogicalDayBlocks.map((block) => block.minuteOfDay)).toEqual([3 * 60 + 50, 3 * 60 + 55]);
    expect(nextLogicalDayBlocks.map((block) => block.minuteOfDay)).toEqual([4 * 60]);
  });

  it('preserves a continuous focus strike immediately before drift', () => {
    const focusStart = segment({
      id: 'focus-start',
      start: localIso(9, 0),
      end: localIso(9, 20),
      appName: 'Code',
      classification: { category: 'workspace', productivity: 'focus', source: 'manual', confidence: 1, reason: 'Test focus' },
    });
    const focusFollowup = segment({
      id: 'focus-followup',
      start: localIso(9, 22),
      end: localIso(9, 42),
      appName: 'Code',
      classification: { category: 'workspace', productivity: 'focus', source: 'manual', confidence: 1, reason: 'Test focus' },
    });
    const drift = segment({
      id: 'drift',
      start: localIso(9, 45),
      end: localIso(9, 50),
      appName: 'YouTube',
      classification: { category: 'entertainment', productivity: 'drift', source: 'manual', confidence: 1, reason: 'Test drift' },
    });

    expect(computePreservedFocusStrikeSeconds([focusStart, focusFollowup, drift], drift)).toBe(40 * 60);
  });

  it('breaks the preserved focus strike after a gap over five minutes', () => {
    const focus = segment({
      id: 'focus-before-gap',
      start: localIso(9, 0),
      end: localIso(9, 20),
      appName: 'Code',
      classification: { category: 'workspace', productivity: 'focus', source: 'manual', confidence: 1, reason: 'Test focus' },
    });
    const drift = segment({
      id: 'drift-after-gap',
      start: localIso(9, 26),
      end: localIso(9, 30),
      appName: 'YouTube',
      classification: { category: 'entertainment', productivity: 'drift', source: 'manual', confidence: 1, reason: 'Test drift' },
    });

    expect(computePreservedFocusStrikeSeconds([focus, drift], drift)).toBeNull();
  });

  it('keeps the preserved focus strike across an exact five minute gap', () => {
    const focus = segment({
      id: 'focus-exact-gap',
      start: localIso(9, 0),
      end: localIso(9, 20),
      appName: 'Code',
      classification: { category: 'workspace', productivity: 'focus', source: 'manual', confidence: 1, reason: 'Test focus' },
    });
    const drift = segment({
      id: 'drift-exact-gap',
      start: localIso(9, 25),
      end: localIso(9, 30),
      appName: 'YouTube',
      classification: { category: 'entertainment', productivity: 'drift', source: 'manual', confidence: 1, reason: 'Test drift' },
    });

    expect(computePreservedFocusStrikeSeconds([focus, drift], drift)).toBe(20 * 60);
  });

  it('breaks the preserved focus strike when non-focus appears before drift', () => {
    const focus = segment({
      id: 'focus-before-neutral',
      start: localIso(9, 0),
      end: localIso(9, 20),
      appName: 'Code',
      classification: { category: 'workspace', productivity: 'focus', source: 'manual', confidence: 1, reason: 'Test focus' },
    });
    const neutral = segment({
      id: 'neutral-before-drift',
      start: localIso(9, 21),
      end: localIso(9, 22),
      appName: 'Finder',
      classification: { category: 'utility', productivity: 'neutral', source: 'manual', confidence: 1, reason: 'Test neutral' },
    });
    const drift = segment({
      id: 'drift-after-neutral',
      start: localIso(9, 23),
      end: localIso(9, 30),
      appName: 'YouTube',
      classification: { category: 'entertainment', productivity: 'drift', source: 'manual', confidence: 1, reason: 'Test drift' },
    });

    expect(computePreservedFocusStrikeSeconds([focus, neutral, drift], drift)).toBeNull();
  });

  it('ignores preserved focus strikes for non-current drift segments', () => {
    const focus = segment({
      id: 'focus-before-old-drift',
      start: localIso(9, 0),
      end: localIso(9, 20),
      appName: 'Code',
      classification: { category: 'workspace', productivity: 'focus', source: 'manual', confidence: 1, reason: 'Test focus' },
    });
    const oldDrift = segment({
      id: 'old-drift',
      start: localIso(9, 22),
      end: localIso(9, 25),
      appName: 'YouTube',
      classification: { category: 'entertainment', productivity: 'drift', source: 'manual', confidence: 1, reason: 'Test drift' },
    });
    const currentFocus = segment({
      id: 'later-focus',
      start: localIso(9, 26),
      end: localIso(9, 30),
      appName: 'Code',
      classification: { category: 'workspace', productivity: 'focus', source: 'manual', confidence: 1, reason: 'Test focus' },
    });

    expect(computePreservedFocusStrikeSeconds([focus, oldDrift, currentFocus], oldDrift)).toBeNull();
  });

  it('builds ranked app usage summaries', () => {
    const summaries = buildAppUsageSummaries(appUsageSegments);

    expect(summaries).toHaveLength(3);
    expect(summaries.map((summary) => summary.appName)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(summaries[0]).toEqual({
      rank: 1,
      appName: 'Alpha',
      bundleId: 'com.alpha.app',
      usageKind: 'app',
      siteDomain: null,
      siteTitle: null,
      browserName: null,
      totalSeconds: 3600,
      sessionCount: 2,
      activeDays: 2,
      averageSessionSeconds: 1800,
      shareOfTotal: 3600 / 9000,
      firstStartedAt: '2026-04-06T08:00:00.000Z',
      lastEndedAt: '2026-04-07T09:30:00.000Z',
    });
    expect(summaries[1]).toMatchObject({
      rank: 2,
      appName: 'Beta',
      bundleId: 'com.beta.app',
      usageKind: 'app',
      siteDomain: null,
      siteTitle: null,
      browserName: null,
      totalSeconds: 3600,
      sessionCount: 1,
      activeDays: 1,
      averageSessionSeconds: 3600,
      shareOfTotal: 3600 / 9000,
      firstStartedAt: '2026-04-06T10:00:00.000Z',
      lastEndedAt: '2026-04-06T11:00:00.000Z',
    });
    expect(summaries[2]).toMatchObject({
      rank: 3,
      appName: 'Gamma',
      bundleId: 'com.gamma.app',
      usageKind: 'app',
      siteDomain: null,
      siteTitle: null,
      browserName: null,
      totalSeconds: 1800,
      sessionCount: 1,
      activeDays: 1,
      averageSessionSeconds: 1800,
      shareOfTotal: 1800 / 9000,
      firstStartedAt: '2026-04-06T12:00:00.000Z',
      lastEndedAt: '2026-04-06T12:30:00.000Z',
    });
  });

  it('limits ranked app usage summaries', () => {
    const summaries = buildAppUsageSummaries(appUsageSegments, { limit: 2 });

    expect(summaries).toHaveLength(2);
    expect(summaries.map((summary) => summary.rank)).toEqual([1, 2]);
    expect(summaries.map((summary) => summary.appName)).toEqual(['Alpha', 'Beta']);
  });

  it('breaks browser usage out by site for activity summaries', () => {
    const browserUsageSegments: ActivitySegment[] = [
      {
        ...segments[0],
        id: 'browser-github-1',
        appName: 'Google Chrome',
        bundleId: 'com.google.Chrome',
        browserName: 'Chrome',
        siteDomain: 'GitHub.com',
        siteTitle: 'GitHub',
        durationSeconds: 1200,
      },
      {
        ...segments[1],
        id: 'browser-github-2',
        appName: 'Google Chrome',
        bundleId: 'com.google.Chrome',
        browserName: 'Chrome',
        siteDomain: 'github.com',
        siteTitle: 'Pull request',
        durationSeconds: 900,
      },
      {
        ...segments[1],
        id: 'browser-youtube-1',
        appName: 'Google Chrome',
        bundleId: 'com.google.Chrome',
        browserName: 'Chrome',
        siteDomain: 'youtube.com',
        siteTitle: 'YouTube',
        durationSeconds: 1500,
      },
      {
        ...segments[1],
        id: 'code-1',
        appName: 'Code',
        bundleId: 'com.microsoft.VSCode',
        durationSeconds: 600,
      },
      {
        ...segments[1],
        id: 'browser-instagram-title-only',
        appName: 'Google Chrome',
        bundleId: 'com.google.Chrome',
        browserName: 'Chrome',
        siteTitle: 'Instagram',
        durationSeconds: 300,
      },
    ];
    const summaries = buildAppUsageSummaries(browserUsageSegments);

    expect(summaries.map((summary) => summary.appName)).toEqual(['github.com', 'youtube.com', 'Code', 'Instagram']);
    expect(summaries[0]).toMatchObject({
      usageKind: 'site',
      appName: 'github.com',
      bundleId: null,
      siteDomain: 'github.com',
      siteTitle: 'GitHub',
      browserName: 'Chrome',
      totalSeconds: 2100,
      sessionCount: 2,
    });
    expect(summaries[2]).toMatchObject({
      usageKind: 'app',
      appName: 'Code',
      bundleId: 'com.microsoft.VSCode',
      siteDomain: null,
    });
    expect(summaries[3]).toMatchObject({
      usageKind: 'site',
      appName: 'Instagram',
      bundleId: null,
      siteDomain: null,
      siteTitle: 'Instagram',
      browserName: 'Chrome',
    });

    const appGroupedSummaries = buildAppUsageSummaries(browserUsageSegments, { groupBy: 'app' });
    expect(appGroupedSummaries.map((summary) => summary.appName)).toEqual(['Google Chrome', 'Code']);
    expect(appGroupedSummaries[0]).toMatchObject({
      usageKind: 'app',
      appName: 'Google Chrome',
      bundleId: 'com.google.Chrome',
      totalSeconds: 3900,
    });
  });

  it('keeps 5-minute flow blocks as the default interval', () => {
    const blocks = buildFlowBlocks([
      {
        ...segments[0],
        startedAt: localIso(9, 0),
        endedAt: localIso(9, 30),
      },
    ], '2026-04-06');

    expect(blocks).toHaveLength(6);
    expect(blocks.map((block) => block.minuteOfDay)).toEqual([9 * 60, 9 * 60 + 5, 9 * 60 + 10, 9 * 60 + 15, 9 * 60 + 20, 9 * 60 + 25]);
    expect(blocks.map((block) => block.durationSeconds)).toEqual([300, 300, 300, 300, 300, 300]);
  });

  it('buckets flow blocks by finer selected intervals with per-bucket overlap', () => {
    const blocks = buildFlowBlocks([
      {
        ...segments[0],
        startedAt: localIso(9, 1),
        endedAt: localIso(9, 7),
        durationSeconds: 360,
      },
    ], '2026-04-06', 3);

    expect(blocks).toHaveLength(3);
    expect(blocks.map((block) => block.minuteOfDay)).toEqual([9 * 60, 9 * 60 + 3, 9 * 60 + 6]);
    expect(blocks.map((block) => block.durationSeconds)).toEqual([120, 180, 60]);
  });

  it('offers mock-aligned flow block intervals', () => {
    expect(FLOW_INTERVAL_OPTIONS).toEqual([3, 5, 10]);

    const blocks = buildFlowBlocks([
      {
        ...segments[0],
        startedAt: localIso(9, 0),
        endedAt: localIso(9, 30),
        durationSeconds: 1800,
      },
    ], '2026-04-06', 10);

    expect(blocks).toHaveLength(3);
    expect(blocks.map((block) => block.minuteOfDay)).toEqual([9 * 60, 9 * 60 + 10, 9 * 60 + 20]);
    expect(blocks.map((block) => block.durationSeconds)).toEqual([600, 600, 600]);
  });

  it('classifies unmatched activity as unknown instead of focus workspace', () => {
    const classification = classifyActivity({
      ...segments[0],
      appName: 'Unmapped App',
      bundleId: 'com.example.unmapped',
      windowTitle: 'Plain task window',
    });

    expect(classification).toEqual({ category: 'unknown', productivity: 'neutral' });
  });

  it('can ignore stored AI classifications for developer comparison views', () => {
    const segment = {
      ...segments[0],
      appName: 'Code',
      bundleId: 'com.microsoft.VSCode',
      classification: {
        category: 'entertainment' as const,
        productivity: 'drift' as const,
        source: 'llm' as const,
        confidence: 0.8,
        reason: 'AI smoke result',
        aiResult: true,
      },
    };

    expect(classifyActivity(segment)).toEqual({ category: 'entertainment', productivity: 'drift' });
    expect(classifyActivity(segment, { includeAiClassifications: false })).toEqual({ category: 'workspace', productivity: 'focus' });
  });

  it('applies a matching site rule before built-in heuristics', () => {
    const netflix = {
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'www.netflix.com',
      siteTitle: 'Netflix',
    };
    const rules = [{ targetKind: 'site' as const, targetValue: 'netflix.com', category: 'entertainment' as const, productivity: 'neutral' as const, enabled: true }];

    expect(classifyActivityDetailed(netflix, { rules })).toMatchObject({ productivity: 'neutral', source: 'rule' });
    expect(classifyActivityDetailed({ ...netflix, siteDomain: 'help.netflix.com' }, { rules })).toMatchObject({ productivity: 'neutral', source: 'rule' });
    expect(classifyActivityDetailed(netflix)).toMatchObject({ productivity: 'drift', source: 'domain-db' });
  });

  it('applies app rules by bundle id or normalized app name', () => {
    const game = {
      ...segments[0],
      appName: 'League of Legends',
      bundleId: 'com.riotgames.LeagueofLegends',
      windowTitle: 'Summoner\'s Rift',
    };

    expect(classifyActivityDetailed(game, {
      rules: [{ targetKind: 'app', targetValue: 'com.riotgames.LeagueofLegends', category: 'game', productivity: 'neutral', enabled: true }],
    })).toMatchObject({ productivity: 'neutral', source: 'rule' });

    expect(classifyActivityDetailed({ ...game, bundleId: null }, {
      rules: [{ targetKind: 'app', targetValue: '  league  OF legends ', category: 'game', productivity: 'neutral', enabled: true }],
    })).toMatchObject({ productivity: 'neutral', source: 'rule' });
  });

  it('lets rules override stored llm classifications but not manual corrections', () => {
    const rules = [{ targetKind: 'site' as const, targetValue: 'youtube.com', category: 'entertainment' as const, productivity: 'neutral' as const, enabled: true }];
    const base = {
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'youtube.com',
    };

    expect(classifyActivityDetailed({
      ...base,
      classification: { category: 'entertainment', productivity: 'drift', source: 'llm', confidence: 0.9, aiResult: true },
    }, { rules })).toMatchObject({ productivity: 'neutral', source: 'rule' });

    expect(classifyActivityDetailed({
      ...base,
      classification: { category: 'entertainment', productivity: 'focus', source: 'manual', confidence: 1, aiResult: false },
    }, { rules })).toMatchObject({ productivity: 'focus', source: 'manual' });
  });

  it('skips disabled rules', () => {
    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'netflix.com',
    }, {
      rules: [{ targetKind: 'site', targetValue: 'netflix.com', category: 'entertainment', productivity: 'neutral', enabled: false }],
    })).toMatchObject({ productivity: 'drift', source: 'domain-db' });
  });

  it('uses the native app registry before context fallback', () => {
    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'League of Legends',
      bundleId: 'com.riotgames.LeagueofLegends',
      windowTitle: 'Summoner\'s Rift',
    })).toMatchObject({ category: 'game', productivity: 'drift', surface: 'app', source: 'app-db' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Code',
      bundleId: 'com.microsoft.VSCode',
      windowTitle: 'plain.txt',
    })).toMatchObject({ category: 'workspace', productivity: 'focus', surface: 'app', source: 'app-db' });
  });

  it('covers conservative workspace and game app registry additions', () => {
    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'PyCharm',
      bundleId: null,
      windowTitle: 'main.py',
    })).toMatchObject({ category: 'workspace', productivity: 'focus', surface: 'app', source: 'app-db' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Epic Games Launcher',
      bundleId: null,
      windowTitle: 'Library',
    })).toMatchObject({ category: 'game', productivity: 'drift', surface: 'app', source: 'app-db' });
  });

  it('classifies browser activity by domain before browser app name', () => {
    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Google Chrome',
      bundleId: 'com.google.Chrome',
      browserName: 'Google Chrome',
      siteDomain: 'netflix.com',
      siteTitle: 'Netflix',
      windowTitle: 'Netflix',
    })).toMatchObject({ category: 'entertainment', productivity: 'drift', surface: 'browser', source: 'domain-db' });
  });

  it('classifies Edge and Firefox as browser surface without url metadata', () => {
    const edge = classifyActivityDetailed({
      ...segments[0],
      appName: 'Microsoft Edge',
      bundleId: 'com.microsoft.edgemac',
      windowTitle: 'Settings',
    });

    const firefox = classifyActivityDetailed({
      ...segments[0],
      appName: 'Firefox',
      bundleId: 'org.mozilla.firefox',
      windowTitle: 'Preferences',
    });

    expect(edge.surface).toBe('browser');
    expect(firefox.surface).toBe('browser');
  });

  it('covers conservative learning, workspace, and shopping domain registry additions', () => {
    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'stackoverflow.com',
      siteTitle: 'TypeScript answer',
    })).toMatchObject({ category: 'learning', productivity: 'focus', surface: 'browser', source: 'domain-db' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'gitlab.com',
      siteTitle: 'Merge request',
    })).toMatchObject({ category: 'workspace', productivity: 'focus', surface: 'browser', source: 'domain-db' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'musinsa.com',
      siteTitle: 'Store',
    })).toMatchObject({ category: 'shopping', productivity: 'drift', surface: 'browser', source: 'domain-db' });
  });

  it('classifies AI domains conservatively by product surface', () => {
    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'platform.kimi.ai',
      siteTitle: 'Kimi Platform',
    })).toMatchObject({ category: 'workspace', productivity: 'focus', surface: 'browser', source: 'domain-db' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'phind.com',
      siteTitle: 'Phind answer',
    })).toMatchObject({ category: 'learning', productivity: 'focus', surface: 'browser', source: 'domain-db' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'claude.ai',
      siteTitle: 'Untitled chat',
    })).toMatchObject({ category: 'unknown', productivity: 'neutral', surface: 'browser', source: 'unknown' });
  });

  it('routes multipurpose domains through contextual classification', () => {
    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'github.com',
      siteTitle: 'React developer guide',
    })).toMatchObject({ category: 'learning', productivity: 'focus', surface: 'browser', source: 'context' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'github.com',
      siteTitle: 'Pull request',
    })).toMatchObject({ category: 'unknown', productivity: 'neutral', surface: 'browser', source: 'unknown' });
  });

  it.each([
    ['deep_diver', [
      segment({ id: 'deep-1', start: localIsoAt(0, 9, 0), end: localIsoAt(0, 10, 0), appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
      segment({ id: 'deep-2', start: localIsoAt(0, 10, 0), end: localIsoAt(0, 10, 40), appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
      segment({ id: 'deep-3', start: localIsoAt(0, 10, 40), end: localIsoAt(0, 11, 0), appName: 'Spotify' }),
    ]],
    ['deep_focus_deep_drift', [
      segment({ id: 'bipolar-1', start: localIsoAt(0, 9, 0), end: localIsoAt(0, 10, 0), appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
      segment({ id: 'bipolar-2', start: localIsoAt(0, 10, 0), end: localIsoAt(0, 10, 45), appName: 'Safari', browserName: 'Safari', siteDomain: 'youtube.com' }),
      segment({ id: 'bipolar-3', start: localIsoAt(0, 10, 45), end: localIsoAt(0, 11, 15), appName: 'Slack' }),
    ]],
    ['drift_diver', [
      segment({ id: 'drift-1', start: localIsoAt(0, 9, 0), end: localIsoAt(0, 9, 40), appName: 'Safari', browserName: 'Safari', siteDomain: 'youtube.com' }),
      segment({ id: 'drift-2', start: localIsoAt(0, 9, 40), end: localIsoAt(0, 10, 0), appName: 'Spotify' }),
      segment({ id: 'drift-3', start: localIsoAt(0, 10, 0), end: localIsoAt(0, 10, 10), appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
    ]],
    ['focus_sprinter', [
      segment({ id: 'sprint-1', start: localIsoAt(0, 9, 0), end: localIsoAt(0, 9, 10), appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
      segment({ id: 'sprint-2', start: localIsoAt(0, 9, 15), end: localIsoAt(0, 9, 25), appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
      segment({ id: 'sprint-3', start: localIsoAt(0, 9, 30), end: localIsoAt(0, 9, 40), appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
      segment({ id: 'sprint-4', start: localIsoAt(0, 9, 40), end: localIsoAt(0, 10, 0), appName: 'Spotify' }),
    ]],
    ['reactive_operator', [
      segment({ id: 'reactive-1', start: localIsoAt(0, 9, 0), end: localIsoAt(0, 9, 30), appName: 'Slack' }),
      segment({ id: 'reactive-2', start: localIsoAt(0, 9, 30), end: localIsoAt(0, 9, 50), appName: 'Mail' }),
      segment({ id: 'reactive-3', start: localIsoAt(0, 9, 50), end: localIsoAt(0, 10, 20), appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
    ]],
    ['night_owl', [
      segment({ id: 'night-1', start: localIsoAt(0, 22, 30), end: localIsoAt(0, 23, 30), appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
      segment({ id: 'night-2', start: localIsoAt(0, 23, 30), end: localIsoAt(1, 0, 30), appName: 'Figma' }),
      segment({ id: 'night-3', start: localIsoAt(0, 14, 0), end: localIsoAt(0, 15, 0), appName: 'Spotify' }),
    ]],
    ['balanced_builder', [
      segment({ id: 'balanced-1', start: localIsoAt(0, 9, 0), end: localIsoAt(0, 9, 35), appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
      segment({ id: 'balanced-2', start: localIsoAt(0, 9, 35), end: localIsoAt(0, 9, 55), appName: 'Slack' }),
      segment({ id: 'balanced-3', start: localIsoAt(0, 10, 0), end: localIsoAt(0, 10, 25), appName: 'Spotify' }),
    ]],
  ] satisfies Array<[ProductivityPersonaId, ActivitySegment[]]>)('builds the %s productivity persona locally', (personaId: ProductivityPersonaId, personaSegments: ActivitySegment[]) => {
    expect(buildProductivityPersona(personaSegments).personaId).toBe(personaId);
  });

  it('uses AI stored classifications when building productivity personas', () => {
    const report = buildProductivityPersona([
      segment({
        id: 'ai-included',
        start: localIsoAt(0, 9, 0),
        end: localIsoAt(0, 10, 30),
        appName: 'Code',
        bundleId: 'com.microsoft.VSCode',
        classification: {
          source: 'llm',
          aiResult: true,
          category: 'entertainment',
          productivity: 'drift',
          confidence: 0.99,
        },
      }),
      segment({ id: 'focus-rule', start: localIsoAt(0, 10, 30), end: localIsoAt(0, 11, 0), appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
    ]);

    expect(report.personaId).toBe('drift_diver');
    expect(report.metrics.focusShare).toBe(0.25);
    expect(report.metrics.driftShare).toBe(0.75);
  });

  it('keeps high surface switching as a metric while assigning the next meaningful persona', () => {
    const report = buildProductivityPersona([
      segment({ id: 'switch-1', start: localIsoAt(0, 9, 0), end: localIsoAt(0, 9, 5), appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
      segment({ id: 'switch-2', start: localIsoAt(0, 9, 5), end: localIsoAt(0, 9, 10), appName: 'Safari', browserName: 'Safari', siteDomain: 'react.dev' }),
      segment({ id: 'switch-3', start: localIsoAt(0, 9, 10), end: localIsoAt(0, 9, 15), appName: 'Safari', browserName: 'Safari', siteDomain: 'github.com', siteTitle: 'docs' }),
      segment({ id: 'switch-4', start: localIsoAt(0, 9, 15), end: localIsoAt(0, 9, 20), appName: 'Figma' }),
      segment({ id: 'switch-5', start: localIsoAt(0, 9, 20), end: localIsoAt(0, 9, 25), appName: 'Terminal' }),
      segment({ id: 'switch-6', start: localIsoAt(0, 9, 25), end: localIsoAt(0, 9, 30), appName: 'Postman' }),
      segment({ id: 'switch-7', start: localIsoAt(0, 9, 30), end: localIsoAt(0, 9, 35), appName: 'Docker Desktop' }),
      segment({ id: 'switch-8', start: localIsoAt(0, 9, 35), end: localIsoAt(0, 9, 40), appName: 'Xcode' }),
    ]);

    expect(report.personaId).toBe('focus_sprinter');
    expect(report.metrics.uniqueSurfaceCount).toBe(8);
    expect(report.metrics.switchRatePerHour).toBeGreaterThan(10);
  });

  it('classifies YouTube music playlist activity as music', () => {
    const classification = classifyActivity({
      ...segments[0],
      appName: 'Safari',
      siteDomain: 'youtube.com',
      siteTitle: 'Tiny Desk Concert',
      siteUrl: 'https://www.youtube.com/watch?v=abc123&list=RDabc123',
      youtubeVideoId: 'abc123',
      youtubePlaylistId: 'RDabc123',
    });

    expect(classification).toEqual({ category: 'music', productivity: 'neutral' });
  });

  it('classifies mixed-case RDMM YouTube playlist activity as music', () => {
    const classification = classifyActivity({
      ...segments[0],
      appName: 'Safari',
      siteDomain: 'youtube.com',
      siteTitle: 'No title heuristic needed',
      siteUrl: 'https://www.youtube.com/watch?v=abc123&list=rdmm2cws-example',
      youtubeVideoId: 'abc123',
      youtubePlaylistId: 'rdmm2cws-example',
      youtubeCategory: 'Entertainment',
    });

    expect(classification).toEqual({ category: 'music', productivity: 'neutral' });
  });

  it('keeps ordinary YouTube watch pages as entertainment when no stronger signal exists', () => {
    for (const siteDomain of ['youtube.com', 'www.youtube.com']) {
      expect(classifyActivity({
        ...segments[0],
        appName: 'Safari',
        siteDomain,
        siteTitle: 'A day in my life',
        siteUrl: 'https://www.youtube.com/watch?v=abc123',
        youtubeVideoId: 'abc123',
      })).toEqual({ category: 'entertainment', productivity: 'drift' });
    }
  });

  it('keeps YouTube browse pages unknown and neutral across home, feed, search, and channel paths', () => {
    const navigationCases = [
      { siteDomain: 'www.youtube.com', siteUrl: 'https://www.youtube.com/' },
      { siteDomain: 'youtube.com', siteUrl: 'https://www.youtube.com/results?search_query=typescript' },
      { siteDomain: 'youtube.com', siteUrl: 'https://www.youtube.com/feed' },
      { siteDomain: 'youtube.com', siteUrl: 'https://www.youtube.com/feed/subscriptions' },
      { siteDomain: 'youtube.com', siteUrl: 'https://www.youtube.com/@drifty' },
      { siteDomain: 'youtube.com', siteUrl: 'https://www.youtube.com/@drifty/videos' },
      { siteDomain: 'youtube.com', siteUrl: 'https://www.youtube.com/channel/UC123' },
      { siteDomain: 'youtube.com', siteUrl: 'https://www.youtube.com/c/Drifty' },
      { siteDomain: 'youtube.com', siteUrl: 'https://www.youtube.com/user/drifty' },
    ];

    for (const { siteDomain, siteUrl } of navigationCases) {
      expect(classifyActivity({
        ...segments[0],
        appName: 'Safari',
        siteDomain,
        siteTitle: 'YouTube',
        siteUrl,
      })).toEqual({ category: 'unknown', productivity: 'neutral' });
    }
  });

  it('does not use YouTube title heuristics for classification', () => {
    const classification = classifyActivity({
      ...segments[0],
      appName: 'Safari',
      siteDomain: 'youtube.com',
      siteTitle: 'Official audio tutorial game music guide',
      siteUrl: 'https://www.youtube.com/watch?v=abc123',
      youtubeVideoId: 'abc123',
    });

    expect(classification).toEqual({ category: 'entertainment', productivity: 'drift' });
  });

  it('classifies YouTube Shorts as entertainment even when other signals look musical', () => {
    const classification = classifyActivity({
      ...segments[0],
      appName: 'Safari',
      siteDomain: 'youtube.com',
      siteTitle: 'Official music video',
      siteUrl: 'https://www.youtube.com/shorts/abc123?list=RDMMabc123',
      youtubeVideoId: 'abc123',
      youtubePlaylistId: 'RDMMabc123',
      youtubeIsShorts: true,
      youtubeCategory: 'Music',
    });

    expect(classification).toEqual({ category: 'entertainment', productivity: 'drift' });
  });

  it('classifies music.youtube.com as music', () => {
    const classification = classifyActivity({
      ...segments[0],
      appName: 'Safari',
      siteDomain: 'music.youtube.com',
      siteTitle: 'Album radio',
      siteUrl: 'https://music.youtube.com/watch?v=abc123',
      youtubeVideoId: 'abc123',
    });

    expect(classification).toEqual({ category: 'music', productivity: 'neutral' });
  });

  it('uses YouTube official category metadata when present', () => {
    expect(classifyActivity({
      ...segments[0],
      appName: 'Safari',
      siteDomain: 'youtube.com',
      siteTitle: 'Lecture without title hints',
      youtubeVideoId: 'lecture123',
      youtubeCategory: 'Education',
    })).toEqual({ category: 'learning', productivity: 'focus' });

    expect(classifyActivity({
      ...segments[0],
      appName: 'Safari',
      siteDomain: 'youtube.com',
      siteTitle: 'Playthrough',
      youtubeVideoId: 'game123',
      youtubeCategory: 'Gaming',
    })).toEqual({ category: 'game', productivity: 'drift' });
  });

  it('uses the broader official YouTube category set without title heuristics', () => {
    expect(classifyActivity({
      ...segments[0],
      appName: 'Safari',
      siteDomain: 'youtube.com',
      siteTitle: 'Creator vlog with docs tutorial words in the title',
      youtubeVideoId: 'people123',
      youtubeCategory: 'People & Blogs',
    })).toEqual({ category: 'entertainment', productivity: 'drift' });

    expect(classifyActivity({
      ...segments[0],
      appName: 'Safari',
      siteDomain: 'youtube.com',
      siteTitle: 'Plain video title',
      youtubeVideoId: 'science123',
      youtubeCategory: '  Science   &   Technology  ',
    })).toEqual({ category: 'learning', productivity: 'focus' });

    expect(classifyActivity({
      ...segments[0],
      appName: 'Safari',
      siteDomain: 'youtube.com',
      siteTitle: 'Plain video title',
      youtubeVideoId: 'style123',
      youtubeCategory: 'How-to & Style',
    })).toEqual({ category: 'learning', productivity: 'focus' });

    expect(classifyActivity({
      ...segments[0],
      appName: 'Safari',
      siteDomain: 'youtube.com',
      siteTitle: 'Plain video title',
      youtubeVideoId: 'travel123',
      youtubeCategory: 'Travel & Events',
    })).toEqual({ category: 'entertainment', productivity: 'drift' });
  });

  it('classifies cmux as workspace focus even when the window title looks neutral', () => {
    expect(classifyActivity({
      ...segments[0],
      appName: 'cmux',
      bundleId: 'dev.cmux',
      windowTitle: 'Messages and notes',
    })).toEqual({ category: 'workspace', productivity: 'focus' });
  });

  it('accumulates repeated app overlap before choosing the dominant flow block', () => {
    const blocks = buildFlowBlocks([
      {
        ...segments[0],
        id: 'code-a',
        startedAt: localIso(9, 0),
        endedAt: localIso(9, 5),
        durationSeconds: 300,
      },
      {
        ...segments[0],
        id: 'code-b',
        startedAt: localIso(9, 10),
        endedAt: localIso(9, 15),
        durationSeconds: 300,
      },
      {
        ...segments[0],
        id: 'mail-a',
        appName: 'Mail',
        startedAt: localIso(9, 5),
        endedAt: localIso(9, 10),
        durationSeconds: 300,
      },
    ], '2026-04-06');

    expect(blocks).toHaveLength(3);
    expect(blocks[0].appName).toBe('Code');
    expect(blocks.map((block) => block.durationSeconds)).toEqual([300, 300, 300]);
  });

});

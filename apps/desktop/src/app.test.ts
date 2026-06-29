import { describe, expect, it } from 'vitest';
import {
  DRIFTY_PRODUCTIVITY_RUBRIC_V1,
  FLOW_INTERVAL_OPTIONS,
  buildAppUsageSummaries,
  buildFlowBlocks,
  buildDailyTotals,
  buildHourlyBuckets,
  buildEffectiveProductivityDurations,
  buildProductivityPersona,
  computePreservedFocusStrikeSeconds,
  DRIFTY_PRODUCTIVITY_RUBRIC_VERSION,
  classifyActivity,
  classifyActivityDetailed,
  groupSegmentsByApp,
  scoreDriftyProductivityRubricV1,
  topSites,
  type ActivitySegment,
  type ActivityCategory,
  type ProductivityLabel,
  type ProductivityPersonaId,
  type ProductivityRubricMetricInput,
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
  siteUrl?: string | null;
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
    siteUrl: input.siteUrl ?? null,
    platform: 'macos',
    source: 'nsworkspace',
    classification: input.classification ?? null,
  };
}

function storedClassification(category: ActivityCategory, productivity: ProductivityLabel): ActivitySegment['classification'] {
  return {
    category,
    productivity,
    source: 'manual',
    confidence: 1,
    reason: 'Test classification',
  };
}

function classifiedSegment(input: {
  id: string;
  startHour: number;
  startMinute: number;
  durationMinutes: number;
  appName: string;
  category: ActivityCategory;
  productivity: ProductivityLabel;
  bundleId?: string | null;
  browserName?: string | null;
  siteDomain?: string | null;
}): ActivitySegment {
  const start = localIso(input.startHour, input.startMinute);
  const end = new Date(new Date(start).getTime() + input.durationMinutes * 60 * 1000).toISOString();
  return segment({
    id: input.id,
    start,
    end,
    appName: input.appName,
    bundleId: input.bundleId,
    browserName: input.browserName,
    siteDomain: input.siteDomain,
    classification: storedClassification(input.category, input.productivity),
  });
}

function effectiveProductivityDuration(segments: ActivitySegment[], productivity: ProductivityLabel): number {
  return buildEffectiveProductivityDurations(segments).find((entry) => entry.productivity === productivity)?.totalSeconds ?? 0;
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

  it('folds contextual communication productivity into the three user-facing labels', () => {
    const communicationSegments = [
      classifiedSegment({ id: 'mixed-focus-before', startHour: 9, startMinute: 0, durationMinutes: 10, appName: 'Code', category: 'workspace', productivity: 'focus' }),
      classifiedSegment({ id: 'mixed-short', startHour: 9, startMinute: 10, durationMinutes: 5, appName: 'KakaoTalk', category: 'communication', productivity: 'neutral' }),
      classifiedSegment({ id: 'mixed-focus-after', startHour: 9, startMinute: 15, durationMinutes: 10, appName: 'Code', category: 'workspace', productivity: 'focus' }),
      classifiedSegment({ id: 'work-focus-before', startHour: 9, startMinute: 40, durationMinutes: 10, appName: 'Code', category: 'workspace', productivity: 'focus' }),
      classifiedSegment({ id: 'work-extended', startHour: 9, startMinute: 50, durationMinutes: 18, appName: 'Slack', category: 'communication', productivity: 'neutral' }),
      classifiedSegment({ id: 'work-focus-after', startHour: 10, startMinute: 8, durationMinutes: 10, appName: 'Code', category: 'workspace', productivity: 'focus' }),
      classifiedSegment({ id: 'mixed-long-focus-before', startHour: 10, startMinute: 30, durationMinutes: 10, appName: 'Code', category: 'workspace', productivity: 'focus' }),
      classifiedSegment({ id: 'mixed-long', startHour: 10, startMinute: 40, durationMinutes: 6, appName: 'Discord', category: 'communication', productivity: 'neutral' }),
      classifiedSegment({ id: 'mixed-long-focus-after', startHour: 10, startMinute: 46, durationMinutes: 10, appName: 'Code', category: 'workspace', productivity: 'focus' }),
      classifiedSegment({ id: 'work-drift-focus-before', startHour: 11, startMinute: 10, durationMinutes: 10, appName: 'Code', category: 'workspace', productivity: 'focus' }),
      classifiedSegment({ id: 'work-drift-blocked', startHour: 11, startMinute: 20, durationMinutes: 7, appName: 'Slack', category: 'communication', productivity: 'drift' }),
      classifiedSegment({ id: 'work-drift-after', startHour: 11, startMinute: 27, durationMinutes: 10, appName: 'Steam', category: 'game', productivity: 'drift' }),
    ];

    expect(effectiveProductivityDuration(communicationSegments, 'focus')).toBe(93 * 60);
    expect(effectiveProductivityDuration(communicationSegments, 'neutral')).toBe(6 * 60);
    expect(effectiveProductivityDuration(communicationSegments, 'drift')).toBe(17 * 60);

    const blocks = buildFlowBlocks(communicationSegments, '2026-04-06', 5);
    expect(blocks.filter((block) => block.appName === 'KakaoTalk').every((block) => block.productivity === 'focus' && block.productivityBasis === 'contextual')).toBe(true);
    expect(blocks.filter((block) => block.appName === 'Slack' && block.minuteOfDay < 11 * 60).every((block) => block.productivity === 'focus' && block.productivityBasis === 'contextual')).toBe(true);
    expect(blocks.filter((block) => block.appName === 'Discord').every((block) => block.productivity === 'neutral' && block.productivityBasis === 'direct')).toBe(true);
    expect(blocks.filter((block) => block.appName === 'Slack' && block.minuteOfDay >= 11 * 60).every((block) => block.productivity === 'drift' && block.productivityBasis === 'direct')).toBe(true);
    expect(blocks.filter((block) => block.appName === 'Slack').every((block) => block.sourceProductivity !== null)).toBe(true);
  });

  it('preserves non-neutral communication and utility classifications in effective productivity', () => {
    const nonNeutralSegments = [
      classifiedSegment({ id: 'communication-drift', startHour: 9, startMinute: 0, durationMinutes: 5, appName: 'Slack', category: 'communication', productivity: 'drift' }),
      classifiedSegment({ id: 'utility-focus', startHour: 9, startMinute: 10, durationMinutes: 2, appName: 'Finder', category: 'utility', productivity: 'focus' }),
    ];

    expect(effectiveProductivityDuration(nonNeutralSegments, 'focus')).toBe(2 * 60);
    expect(effectiveProductivityDuration(nonNeutralSegments, 'neutral')).toBe(0);
    expect(effectiveProductivityDuration(nonNeutralSegments, 'drift')).toBe(5 * 60);

    const blocks = buildFlowBlocks(nonNeutralSegments, '2026-04-06', 5);
    expect(blocks.find((block) => block.appName === 'Slack')?.productivityBasis).toBe('direct');
    expect(blocks.find((block) => block.appName === 'Finder')?.productivityBasis).toBe('direct');
  });

  it('uses nearby active focus time for sparse mixed communication context', () => {
    const sparseContextSegments = [
      classifiedSegment({ id: 'focus-before-older', startHour: 8, startMinute: 50, durationMinutes: 2, appName: 'Code', category: 'workspace', productivity: 'focus' }),
      classifiedSegment({ id: 'focus-before-near', startHour: 8, startMinute: 56, durationMinutes: 1, appName: 'Code', category: 'workspace', productivity: 'focus' }),
      classifiedSegment({ id: 'mixed-short', startHour: 9, startMinute: 0, durationMinutes: 1, appName: 'KakaoTalk', category: 'communication', productivity: 'neutral' }),
      classifiedSegment({ id: 'focus-after-near', startHour: 9, startMinute: 3, durationMinutes: 1, appName: 'Code', category: 'workspace', productivity: 'focus' }),
      classifiedSegment({ id: 'focus-after-later', startHour: 9, startMinute: 8, durationMinutes: 2, appName: 'Code', category: 'workspace', productivity: 'focus' }),
    ];

    expect(effectiveProductivityDuration(sparseContextSegments, 'focus')).toBe(7 * 60);
    expect(effectiveProductivityDuration(sparseContextSegments, 'neutral')).toBe(0);

    const blocks = buildFlowBlocks(sparseContextSegments, '2026-04-06', 5);
    const kakaoBlock = blocks.find((block) => block.appName === 'KakaoTalk');
    expect(kakaoBlock?.productivity).toBe('focus');
    expect(kakaoBlock?.productivityBasis).toBe('contextual');
  });

  it('uses contextual focus when evaluating nearby work-primary communication windows', () => {
    const communicationSegments = [
      classifiedSegment({ id: 'seed-focus-before', startHour: 9, startMinute: 0, durationMinutes: 2, appName: 'Code', category: 'workspace', productivity: 'focus' }),
      classifiedSegment({ id: 'seed-slack', startHour: 9, startMinute: 2, durationMinutes: 2, appName: 'Slack', category: 'communication', productivity: 'neutral' }),
      classifiedSegment({ id: 'seed-focus-after', startHour: 9, startMinute: 4, durationMinutes: 2, appName: 'Code', category: 'workspace', productivity: 'focus' }),
      classifiedSegment({ id: 'extended-teams', startHour: 9, startMinute: 8, durationMinutes: 9, appName: 'Microsoft Teams', category: 'communication', productivity: 'neutral' }),
      classifiedSegment({ id: 'extended-focus-after', startHour: 9, startMinute: 17, durationMinutes: 2, appName: 'Code', category: 'workspace', productivity: 'focus' }),
    ];

    expect(effectiveProductivityDuration(communicationSegments, 'focus')).toBe(17 * 60);
    expect(effectiveProductivityDuration(communicationSegments, 'neutral')).toBe(0);

    const blocks = buildFlowBlocks(communicationSegments, '2026-04-06', 5);
    expect(blocks.filter((block) => block.appName === 'Microsoft Teams').every((block) => block.productivity === 'focus' && block.productivityBasis === 'contextual')).toBe(true);
  });

  it('folds contextual utility productivity into focus or drift', () => {
    const utilitySegments = [
      classifiedSegment({ id: 'utility-focus-before', startHour: 9, startMinute: 0, durationMinutes: 10, appName: 'Code', category: 'workspace', productivity: 'focus' }),
      classifiedSegment({ id: 'utility-focus-finder', startHour: 9, startMinute: 10, durationMinutes: 1, appName: 'Finder', category: 'utility', productivity: 'neutral' }),
      classifiedSegment({ id: 'utility-focus-after', startHour: 9, startMinute: 11, durationMinutes: 10, appName: 'Code', category: 'workspace', productivity: 'focus' }),
      classifiedSegment({ id: 'utility-drift-before', startHour: 9, startMinute: 30, durationMinutes: 10, appName: 'Steam', category: 'game', productivity: 'drift' }),
      classifiedSegment({ id: 'utility-drift-finder', startHour: 9, startMinute: 40, durationMinutes: 1, appName: 'Finder', category: 'utility', productivity: 'neutral' }),
      classifiedSegment({ id: 'utility-drift-after', startHour: 9, startMinute: 41, durationMinutes: 10, appName: 'Steam', category: 'game', productivity: 'drift' }),
      classifiedSegment({ id: 'utility-long-before', startHour: 10, startMinute: 0, durationMinutes: 10, appName: 'Code', category: 'workspace', productivity: 'focus' }),
      classifiedSegment({ id: 'utility-long', startHour: 10, startMinute: 10, durationMinutes: 2, appName: 'Finder', category: 'utility', productivity: 'neutral' }),
      classifiedSegment({ id: 'utility-long-after', startHour: 10, startMinute: 12, durationMinutes: 10, appName: 'Code', category: 'workspace', productivity: 'focus' }),
    ];

    expect(effectiveProductivityDuration(utilitySegments, 'focus')).toBe(41 * 60);
    expect(effectiveProductivityDuration(utilitySegments, 'neutral')).toBe(120);
    expect(effectiveProductivityDuration(utilitySegments, 'drift')).toBe(21 * 60);
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

  it('offers compact flow block intervals', () => {
    expect(FLOW_INTERVAL_OPTIONS).toEqual([3, 4, 5]);

    const blocks = buildFlowBlocks([
      {
        ...segments[0],
        startedAt: localIso(9, 0),
        endedAt: localIso(9, 30),
        durationSeconds: 1800,
      },
    ], '2026-04-06', 4);

    expect(blocks).toHaveLength(8);
    expect(blocks.map((block) => block.minuteOfDay)).toEqual([9 * 60, 9 * 60 + 4, 9 * 60 + 8, 9 * 60 + 12, 9 * 60 + 16, 9 * 60 + 20, 9 * 60 + 24, 9 * 60 + 28]);
    expect(blocks.map((block) => block.durationSeconds)).toEqual([240, 240, 240, 240, 240, 240, 240, 120]);
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

  it('applies detail rules only inside the matching surface', () => {
    const rules = [{
      targetKind: 'site' as const,
      targetValue: 'example.com',
      matchScope: 'detail' as const,
      detailKind: 'title' as const,
      detailValue: 'Sprint plan',
      category: 'workspace' as const,
      productivity: 'focus' as const,
      enabled: true,
    }];

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'example.com',
      siteTitle: 'Sprint plan',
    }, { rules })).toMatchObject({ category: 'workspace', productivity: 'focus', source: 'rule' });
    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'other.example',
      siteTitle: 'Sprint plan',
    }, { rules })).not.toMatchObject({ source: 'rule' });
    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'example.com',
      siteTitle: 'Different plan',
    }, { rules })).not.toMatchObject({ source: 'rule' });
  });

  it('prefers matching detail rules before broad surface rules', () => {
    const video = {
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'youtube.com',
      siteTitle: 'YouTube',
      youtubeTitle: 'TypeScript deep dive',
    };
    const rules = [
      { targetKind: 'site' as const, targetValue: 'youtube.com', category: 'entertainment' as const, productivity: 'drift' as const, enabled: true },
      {
        targetKind: 'site' as const,
        targetValue: 'youtube.com',
        matchScope: 'detail' as const,
        detailKind: 'youtubeTitle' as const,
        detailValue: 'TypeScript deep dive',
        category: 'learning' as const,
        productivity: 'focus' as const,
        enabled: true,
      },
    ];

    expect(classifyActivityDetailed(video, { rules })).toMatchObject({ category: 'learning', productivity: 'focus', source: 'rule' });
    expect(classifyActivityDetailed({ ...video, youtubeTitle: 'Highlights' }, { rules })).toMatchObject({ category: 'entertainment', productivity: 'drift', source: 'rule' });
  });

  it('applies site URL detail rules only to the same canonical URL on a matching site surface', () => {
    const rules = [
      {
        targetKind: 'site' as const,
        targetValue: 'lichess.org',
        category: 'entertainment' as const,
        productivity: 'drift' as const,
        enabled: true,
      },
      {
        targetKind: 'site' as const,
        targetValue: 'lichess.org',
        matchScope: 'detail' as const,
        detailKind: 'siteUrl' as const,
        detailValue: 'https://www.lichess.org/training/123?utm_source=share#comments',
        category: 'learning' as const,
        productivity: 'focus' as const,
        enabled: true,
      },
    ];
    const training = {
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'lichess.org',
      siteUrl: 'https://lichess.org/training/123',
    };

    expect(classifyActivityDetailed(training, { rules })).toMatchObject({ category: 'learning', productivity: 'focus', source: 'rule' });
    expect(classifyActivityDetailed({ ...training, siteUrl: 'https://lichess.org/training/456' }, { rules })).toMatchObject({ category: 'entertainment', productivity: 'drift', source: 'rule' });
    expect(classifyActivityDetailed({ ...training, siteDomain: 'chess.com', siteUrl: 'https://lichess.org/training/123' }, { rules })).not.toMatchObject({ category: 'learning', productivity: 'focus', source: 'rule' });
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

  it('marks reused AI classifications as cached', () => {
    const segment = {
      ...segments[0],
      appName: 'Unmapped App',
      classification: {
        category: 'entertainment' as const,
        productivity: 'drift' as const,
        source: 'llm' as const,
        confidence: 0.8,
        reason: 'Reused AI result',
        aiResult: true,
        reusedAiResult: true,
      },
    };

    expect(classifyActivityDetailed(segment)).toMatchObject({ source: 'llm', aiCached: true });
    expect(classifyActivityDetailed({
      ...segment,
      classification: { ...segment.classification, reusedAiResult: false },
    }).aiCached).toBeUndefined();
  });

  it('keeps stored user-rule rows but recomputes stamped heuristic rule rows', () => {
    const stored = {
      category: 'entertainment' as const,
      productivity: 'neutral' as const,
      source: 'rule' as const,
      confidence: 1,
      reason: 'Matched local app rule: code',
      aiResult: false,
    };
    const vsCode = {
      ...segments[0],
      appName: 'Code',
      bundleId: 'com.microsoft.VSCode',
    };

    expect(classifyActivityDetailed({
      ...vsCode,
      classification: { ...stored, classificationRuleId: 'rule-1' },
    })).toMatchObject({ category: 'entertainment', productivity: 'neutral', source: 'rule' });

    expect(classifyActivityDetailed({
      ...vsCode,
      classification: stored,
    })).toMatchObject({ category: 'workspace', productivity: 'focus', source: 'app-db' });
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

  it('uses the native app registry for known apps', () => {
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

  it('leaves multipurpose domains unknown for AI classification', () => {
    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'github.com',
      siteTitle: 'React developer guide',
    })).toMatchObject({ category: 'unknown', productivity: 'neutral', surface: 'browser', source: 'unknown' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Discord',
      bundleId: 'com.hnc.Discord',
      windowTitle: '#general | drifty - Discord',
    })).toMatchObject({ category: 'unknown', productivity: 'neutral', surface: 'app', source: 'unknown' });
  });

  it('covers single-purpose registry additions for apps and domains', () => {
    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Microsoft PowerPoint',
      bundleId: 'com.microsoft.Powerpoint',
      windowTitle: '0612_weekly_meeting',
    })).toMatchObject({ category: 'workspace', productivity: 'focus', source: 'app-db' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Linear',
      bundleId: 'com.linear',
    })).toMatchObject({ category: 'workspace', productivity: 'focus', source: 'app-db' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'drifty',
      bundleId: 'so.drifty.mac',
    })).toMatchObject({ category: 'utility', productivity: 'neutral', source: 'app-db' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Claude',
      bundleId: 'com.anthropic.claudefordesktop',
    })).toMatchObject({ category: 'workspace', productivity: 'focus', source: 'app-db' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'supabase.com',
    })).toMatchObject({ category: 'workspace', productivity: 'focus', source: 'domain-db' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'linkedin.com',
    })).toMatchObject({ category: 'social_media', productivity: 'neutral', source: 'domain-db' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Safari',
      browserName: 'Safari',
      siteDomain: 'lichess.org',
    })).toMatchObject({ category: 'game', productivity: 'drift', source: 'domain-db' });
  });

  it('classifies promoted registry domains as predefined rules', () => {
    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Google Chrome',
      browserName: 'Google Chrome',
      siteDomain: 'meet.google.com',
    })).toMatchObject({ category: 'communication', productivity: 'neutral', surface: 'browser', source: 'domain-db' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Google Chrome',
      browserName: 'Google Chrome',
      siteDomain: 'calendar.google.com',
    })).toMatchObject({ category: 'communication', productivity: 'neutral', surface: 'browser', source: 'domain-db' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Google Chrome',
      browserName: 'Google Chrome',
      siteDomain: '127.0.0.1',
      siteUrl: 'http://127.0.0.1:1420/?driftypreview=1',
      windowTitle: 'drifty',
    })).toMatchObject({ category: 'workspace', productivity: 'focus', surface: 'browser', source: 'domain-db' });
  });

  it('classifies YouTube window titles when tab metadata is missing', () => {
    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Google Chrome',
      browserName: 'Google Chrome',
      siteDomain: null,
      windowTitle: '인첸트 갑옷 농사 - YouTube - 오디오 재생 - Chrome - Alex',
    })).toMatchObject({ category: 'entertainment', productivity: 'drift', surface: 'browser', source: 'youtube', confidence: 0.7 });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Google Chrome',
      browserName: 'Google Chrome',
      siteDomain: null,
      windowTitle: '플레이리스트 - YouTube Music - Chrome - Alex',
    })).toMatchObject({ category: 'music', productivity: 'neutral', surface: 'browser', source: 'youtube' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Google Chrome',
      browserName: 'Google Chrome',
      siteDomain: '127.0.0.1',
      windowTitle: '폭풍갈퀴의 주인 - YouTube - 오디오 재생 - Chrome - Alex',
    })).toMatchObject({ category: 'workspace', productivity: 'focus', source: 'domain-db' });

    expect(classifyActivityDetailed({
      ...segments[0],
      appName: 'Google Chrome',
      browserName: 'Google Chrome',
      siteDomain: null,
      windowTitle: 'how to use youtube api - stack overflow - Chrome - Alex',
    })).toMatchObject({ category: 'unknown', source: 'unknown' });
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

  it('returns the same fixed rubric score and persona for the same segment input', () => {
    const personaSegments = [
      segment({ id: 'stable-1', start: localIsoAt(0, 9, 0), end: localIsoAt(0, 10, 0), appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
      segment({ id: 'stable-2', start: localIsoAt(0, 10, 0), end: localIsoAt(0, 11, 0), appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
      segment({ id: 'stable-3', start: localIsoAt(0, 11, 0), end: localIsoAt(0, 11, 20), appName: 'Slack' }),
    ];

    const firstReport = buildProductivityPersona(personaSegments);
    const secondReport = buildProductivityPersona([...personaSegments].reverse());

    expect(firstReport.rubricVersion).toBe(DRIFTY_PRODUCTIVITY_RUBRIC_VERSION);
    expect(secondReport.rubricVersion).toBe(DRIFTY_PRODUCTIVITY_RUBRIC_VERSION);
    expect(secondReport.personaId).toBe(firstReport.personaId);
    expect(secondReport.scores.overallScore).toBe(firstReport.scores.overallScore);
  });

  it('scores stable focus work above fragmented drift-heavy work on the fixed rubric', () => {
    const focusHeavyReport = buildProductivityPersona([
      segment({ id: 'focus-score-1', start: localIsoAt(0, 9, 0), end: localIsoAt(0, 10, 20), appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
      segment({ id: 'focus-score-2', start: localIsoAt(0, 10, 20), end: localIsoAt(0, 11, 0), appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
    ]);
    const driftHeavyReport = buildProductivityPersona([
      segment({ id: 'drift-score-1', start: localIsoAt(0, 9, 0), end: localIsoAt(0, 9, 10), appName: 'Safari', browserName: 'Safari', siteDomain: 'youtube.com' }),
      segment({ id: 'drift-score-2', start: localIsoAt(0, 9, 10), end: localIsoAt(0, 9, 20), appName: 'Slack' }),
      segment({ id: 'drift-score-3', start: localIsoAt(0, 9, 20), end: localIsoAt(0, 9, 30), appName: 'Safari', browserName: 'Safari', siteDomain: 'x.com' }),
      segment({ id: 'drift-score-4', start: localIsoAt(0, 9, 30), end: localIsoAt(0, 9, 40), appName: 'Mail' }),
      segment({ id: 'drift-score-5', start: localIsoAt(0, 9, 40), end: localIsoAt(0, 10, 0), appName: 'Safari', browserName: 'Safari', siteDomain: 'youtube.com' }),
    ]);

    expect(focusHeavyReport.scores.overallScore).toBeGreaterThan(driftHeavyReport.scores.overallScore);
  });

  it('uses stored AI classifications in fixed rubric scores', () => {
    const heuristicReport = buildProductivityPersona([
      segment({ id: 'ai-score-heuristic', start: localIsoAt(0, 9, 0), end: localIsoAt(0, 10, 0), appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
    ]);
    const storedAiReport = buildProductivityPersona([
      segment({
        id: 'ai-score-stored',
        start: localIsoAt(0, 9, 0),
        end: localIsoAt(0, 10, 0),
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
    ]);

    expect(storedAiReport.metrics.driftShare).toBe(1);
    expect(storedAiReport.scores.overallScore).toBeLessThan(heuristicReport.scores.overallScore);
  });

  it('scores exact derived fixed rubric threshold metrics without calibration state', () => {
    const { dimensions } = DRIFTY_PRODUCTIVITY_RUBRIC_V1;
    const atTargets: ProductivityRubricMetricInput = {
      focusShare: dimensions.focusQuality.focusShare.target,
      focusAverageSegmentSeconds: dimensions.focusQuality.focusAverageSegmentSeconds.target,
      driftShare: dimensions.driftControl.driftShare.target,
      switchRatePerHour: dimensions.switchingStability.switchRatePerHour.target,
      reactiveShare: dimensions.reactiveLoad.reactiveShare.target,
      nightShare: dimensions.nightBalance.nightShare.target,
    };
    const atFloorsAndCeilings: ProductivityRubricMetricInput = {
      focusShare: dimensions.focusQuality.focusShare.floor,
      focusAverageSegmentSeconds: dimensions.focusQuality.focusAverageSegmentSeconds.floor,
      driftShare: dimensions.driftControl.driftShare.ceiling,
      switchRatePerHour: dimensions.switchingStability.switchRatePerHour.ceiling,
      reactiveShare: dimensions.reactiveLoad.reactiveShare.ceiling,
      nightShare: dimensions.nightBalance.nightShare.ceiling,
    };

    expect(scoreDriftyProductivityRubricV1(atTargets).overallScore).toBe(1);
    expect(scoreDriftyProductivityRubricV1(atFloorsAndCeilings).overallScore).toBe(0);
  });

  it('uses fixed rubric constants rather than user-history samples for dimension scores', () => {
    const { dimensions } = DRIFTY_PRODUCTIVITY_RUBRIC_V1;
    const midpointMetrics: ProductivityRubricMetricInput = {
      focusShare: (dimensions.focusQuality.focusShare.floor + dimensions.focusQuality.focusShare.target) / 2,
      focusAverageSegmentSeconds: (
        dimensions.focusQuality.focusAverageSegmentSeconds.floor +
        dimensions.focusQuality.focusAverageSegmentSeconds.target
      ) / 2,
      driftShare: (dimensions.driftControl.driftShare.target + dimensions.driftControl.driftShare.ceiling) / 2,
      switchRatePerHour: (
        dimensions.switchingStability.switchRatePerHour.target +
        dimensions.switchingStability.switchRatePerHour.ceiling
      ) / 2,
      reactiveShare: (dimensions.reactiveLoad.reactiveShare.target + dimensions.reactiveLoad.reactiveShare.ceiling) / 2,
      nightShare: (dimensions.nightBalance.nightShare.target + dimensions.nightBalance.nightShare.ceiling) / 2,
    };

    expect(scoreDriftyProductivityRubricV1(midpointMetrics)).toMatchObject({
      rubricVersion: DRIFTY_PRODUCTIVITY_RUBRIC_V1.version,
      overallScore: 0.5,
      dimensions: [
        { key: "focus_quality", score: 0.5 },
        { key: "drift_control", score: 0.5 },
        { key: "switching_stability", score: 0.5 },
        { key: "reactive_load", score: 0.5 },
        { key: "night_balance", score: 0.5 },
      ],
    });
  });

  it('returns the same fixed rubric score for repeated calls with the same metric object', () => {
    const metrics: ProductivityRubricMetricInput = {
      focusShare: 0.51,
      focusAverageSegmentSeconds: 45,
      driftShare: 0.012,
      switchRatePerHour: 36,
      reactiveShare: 0.011,
      nightShare: 0.192,
    };

    expect(scoreDriftyProductivityRubricV1(metrics)).toEqual(scoreDriftyProductivityRubricV1(metrics));
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

  it('keeps non-feed YouTube browse pages unknown and neutral across home, search, and channel paths', () => {
    const navigationCases = [
      { siteDomain: 'www.youtube.com', siteUrl: 'https://www.youtube.com/' },
      { siteDomain: 'youtube.com', siteUrl: 'https://www.youtube.com/results?search_query=typescript' },
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

  it('classifies sustained YouTube feed pages as entertainment drift only after thirty seconds', () => {
    expect(classifyActivity({
      ...segments[0],
      durationSeconds: 29,
      appName: 'Safari',
      siteDomain: 'youtube.com',
      siteTitle: 'YouTube',
      siteUrl: 'https://www.youtube.com/feed',
    })).toEqual({ category: 'unknown', productivity: 'neutral' });

    expect(classifyActivity({
      ...segments[0],
      durationSeconds: 30,
      appName: 'Safari',
      siteDomain: 'youtube.com',
      siteTitle: 'YouTube',
      siteUrl: 'https://www.youtube.com/feed/subscriptions',
    })).toEqual({ category: 'entertainment', productivity: 'drift' });
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

/**
 * Synthetic records for the browser preview's Chat: about ten recent days of
 * believable work, dated relative to now so "yesterday" and "last week" have
 * answers. Written in the eval ledger format that seed_database.py reads.
 */

export type PreviewLedgerSegment = {
  readonly id: string;
  readonly start: string;
  readonly end: string;
  readonly app: string;
  readonly title: string;
  readonly siteDomain?: string;
  readonly siteUrl?: string;
  readonly category: string;
  readonly productivity: "focus" | "drift" | "other";
  readonly project?: string;
};

type Block = {
  readonly from: string;
  readonly to: string;
  readonly app: string;
  readonly title: string;
  readonly site?: string;
  readonly category: string;
  readonly productivity: "focus" | "drift" | "other";
  readonly project?: string;
};

const WEEKDAY_PLANS: readonly (readonly Block[])[] = [
  [
    { from: "09:10", to: "10:45", app: "Visual Studio Code", title: "chat_cli.rs — drifty", category: "Software Development", productivity: "focus", project: "Drifty" },
    { from: "10:45", to: "11:10", app: "Slack", title: "#drifty-dev", category: "Communication", productivity: "other" },
    { from: "11:10", to: "12:05", app: "Safari", title: "Pull request #2151 · edgethink00/drifty", site: "github.com", category: "Software Development", productivity: "focus", project: "Drifty" },
    { from: "13:20", to: "13:45", app: "Safari", title: "Lo-fi beats to code to", site: "youtube.com", category: "Entertainment", productivity: "drift" },
    { from: "13:50", to: "15:30", app: "Figma", title: "Chat page — Drifty", category: "Design", productivity: "focus", project: "Drifty" },
    { from: "15:30", to: "16:15", app: "Notion", title: "Northstar weekly plan", site: "notion.so", category: "Planning", productivity: "focus", project: "Northstar" },
    { from: "16:15", to: "16:30", app: "Safari", title: "Instagram", site: "instagram.com", category: "Social Media", productivity: "drift" },
    { from: "16:35", to: "18:05", app: "Visual Studio Code", title: "api.ts — northstar", category: "Software Development", productivity: "focus", project: "Northstar" },
  ],
  [
    { from: "09:30", to: "10:00", app: "Mail", title: "Inbox", category: "Communication", productivity: "other" },
    { from: "10:00", to: "11:50", app: "Visual Studio Code", title: "ChatPage.tsx — drifty", category: "Software Development", productivity: "focus", project: "Drifty" },
    { from: "11:50", to: "12:10", app: "Safari", title: "Hacker News", site: "news.ycombinator.com", category: "News", productivity: "drift" },
    { from: "13:30", to: "14:30", app: "Zoom", title: "Northstar customer call", category: "Meetings", productivity: "focus", project: "Northstar" },
    { from: "14:30", to: "15:10", app: "Notion", title: "Call notes — Northstar", site: "notion.so", category: "Planning", productivity: "focus", project: "Northstar" },
    { from: "15:10", to: "16:40", app: "Visual Studio Code", title: "mcp.py — drifty", category: "Software Development", productivity: "focus", project: "Drifty" },
    { from: "16:40", to: "17:05", app: "Safari", title: "Shorts", site: "youtube.com", category: "Entertainment", productivity: "drift" },
    { from: "17:05", to: "17:50", app: "Slack", title: "#northstar", category: "Communication", productivity: "other", project: "Northstar" },
  ],
];

const WEEKEND_PLAN: readonly Block[] = [
  { from: "11:00", to: "11:40", app: "Safari", title: "Weekend recipes", site: "youtube.com", category: "Entertainment", productivity: "drift" },
  { from: "14:00", to: "15:10", app: "Visual Studio Code", title: "side-project — garden", category: "Software Development", productivity: "focus" },
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function offsetLabel(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return sign + pad(Math.floor(absolute / 60)) + ":" + pad(absolute % 60);
}

function localIso(day: Date, clock: string): { readonly iso: string; readonly at: Date } {
  const [hours, minutes] = clock.split(":").map(Number);
  const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, 0, 0);
  const iso = at.getFullYear() + "-" + pad(at.getMonth() + 1) + "-" + pad(at.getDate()) + "T" + pad(at.getHours()) + ":" + pad(at.getMinutes()) + ":00" + offsetLabel(at);
  return { iso, at };
}

export function buildPreviewChatLedger(now: Date, days = 10): { readonly segments: PreviewLedgerSegment[] } {
  const segments: PreviewLedgerSegment[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    const weekday = day.getDay();
    const plan = weekday === 0 || weekday === 6 ? WEEKEND_PLAN : WEEKDAY_PLANS[(day.getDate() + weekday) % WEEKDAY_PLANS.length];
    plan.forEach((block, index) => {
      const start = localIso(day, block.from);
      const end = localIso(day, block.to);
      if (end.at.getTime() > now.getTime()) return;
      segments.push({
        id: "preview-" + start.iso.slice(0, 10) + "-" + index,
        start: start.iso,
        end: end.iso,
        app: block.app,
        title: block.title,
        ...(block.site ? { siteDomain: block.site, siteUrl: "https://" + block.site + "/" } : {}),
        category: block.category,
        productivity: block.productivity,
        ...(block.project ? { project: block.project } : {}),
      });
    });
  }
  return { segments };
}


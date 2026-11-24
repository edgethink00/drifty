import type { TabId } from "../../app/navigation";

/** A place the command palette and its ⌘-number shortcuts open. Chat is a page over the tabs. */
export type CommandNavigationTarget = Exclude<TabId, "settings" | "profile" | "team"> | "chat";

export type CommandNavigationOptions = {
  readonly includeProjects: boolean;
  readonly includeAgents: boolean;
  readonly includeChat: boolean;
};

/**
 * The sidebar's order, which the palette lists and ⌘1–⌘9 follow: Calendar,
 * the Activity group (Chat last, as in the sidebar), then Leaderboard.
 */
export function commandNavigationOrder({ includeProjects, includeAgents, includeChat }: CommandNavigationOptions): readonly CommandNavigationTarget[] {
  const order: CommandNavigationTarget[] = ["dashboard", "classification"];
  if (includeProjects) order.push("projects");
  order.push("trends");
  if (includeAgents) order.push("agents");
  order.push("history");
  if (includeChat) order.push("chat");
  order.push("leaderboard");
  return order;
}

/** The palette's hint for a target: ⌘1 for the first, none past ⌘9. */
export function commandNavigationShortcut(order: readonly CommandNavigationTarget[], target: CommandNavigationTarget): string | undefined {
  const position = order.indexOf(target);
  return position >= 0 && position < 9 ? "⌘" + (position + 1) : undefined;
}

type ShortcutKeyEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing">;

/** The target ⌘ plus a number key opens, or null for any other key. */
export function commandNavigationShortcutTarget(event: ShortcutKeyEvent, order: readonly CommandNavigationTarget[]): CommandNavigationTarget | null {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing) return null;
  if (!/^[1-9]$/.test(event.key)) return null;
  return order[Number(event.key) - 1] ?? null;
}

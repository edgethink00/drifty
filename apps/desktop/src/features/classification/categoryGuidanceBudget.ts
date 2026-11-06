import type { LiveCategoryGuidance } from "@drifty/domain";

/**
 * Description limits tried, in order, when one managed-local item exceeds the
 * context window. Names, ids, removals and the activity itself stay intact;
 * only the user's longer category and productivity descriptions shrink.
 */
export const CONTEXT_BUDGET_DESCRIPTION_LIMITS = [120, 40] as const;

export function compactCategoryGuidanceDescriptions(
  guidance: readonly LiveCategoryGuidance[],
  maxLength: number,
): LiveCategoryGuidance[] {
  return guidance.map((entry) => {
    if (!("description" in entry) || typeof entry.description !== "string" || entry.description.length <= maxLength) return entry;
    // A UTF-16 limit can land halfway through a character such as an emoji.
    const description = entry.description.slice(0, maxLength).replace(/[\uD800-\uDBFF]$/u, "").trimEnd();
    return { ...entry, description };
  });
}

export function hasLongerCategoryDescriptions(guidance: readonly LiveCategoryGuidance[] | undefined, maxLength: number): boolean {
  return (guidance ?? []).some((entry) => "description" in entry && typeof entry.description === "string" && entry.description.length > maxLength);
}

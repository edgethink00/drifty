import { customCategoryIds, type CategoryCustomizations } from "@drifty/domain";

/**
 * Class-based category colors for user-added categories. The built-in ones
 * are written in the stylesheets (".flow-cell--workspace" and friends); an
 * added category's id only exists at run time, so its rules are generated
 * here. Every class that colors a category by name is listed.
 */
const CATEGORY_COLOR_CLASSES = [
  "category-dot",
  "category-stack__segment",
  "day-ribbon__segment",
  "pattern-cell",
  "flow-cell",
  "flow-chart-legend__dot",
  "week-track__slice",
] as const;

/** The stylesheet giving each added category its color; ids this device does not know read as Unclassified. */
export function customCategoryStyleSheet(customizations: CategoryCustomizations): string {
  const fallback = CATEGORY_COLOR_CLASSES.map((name) => `[class*="${name}--custom-"]`).join(", ");
  const lines = [`${fallback} { background: var(--category-unknown); }`];
  const variables: string[] = [];
  for (const id of customCategoryIds(customizations)) {
    const color = customizations[id]?.color;
    if (color) variables.push(`--category-${id}: ${color};`);
    const selectors = CATEGORY_COLOR_CLASSES.map((name) => `.${name}--${id}`).join(", ");
    lines.push(`${selectors} { background: var(--category-${id}, var(--category-unknown)); }`);
    lines.push(`.classification-panel-view__category-row:has(.category-dot--${id}) { --classification-category-tone: var(--category-${id}, var(--category-unknown)); }`);
  }
  return [...(variables.length > 0 ? [`:root { ${variables.join(" ")} }`] : []), ...lines].join("\n");
}

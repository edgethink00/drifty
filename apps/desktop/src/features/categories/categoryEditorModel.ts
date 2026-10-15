import {
  CUSTOMIZABLE_CATEGORIES,
  CUSTOMIZABLE_PRODUCTIVITY_LABELS,
  isCustomActivityCategory,
  type ActivityCategory,
  type CategoryCustomization,
  type CategoryCustomizations,
  type ProductivityCustomization,
  type ProductivityCustomizations,
  type ProductivityLabel,
  type Project,
} from "@drifty/domain";
import { normalizeHex, normalizeProjectColor } from "../../lib/colorPalette";
import type { AppThemeColorKey } from "../settings/SettingsColorControls";
import {
  APP_THEME_PRODUCTIVITY_COLOR_OPTIONS,
  CATEGORY_COLOR_OPTIONS,
  categoryControlColor,
  type AppThemeColorOverrides,
  type CategoryColorOverrides,
} from "../settings/settingsStorage";

/**
 * The category editor's model: what can be selected, what each definition
 * looks like saved and as a draft, and which drafts differ from what is saved.
 * Kept apart from the sheet so the save rules can be read (and tested) without
 * rendering it.
 */

export type CategoryEditorGroup = "productivity" | "category" | "project";

/** Where the editor opens. A group alone selects its first item. */
export type CategoryEditorTarget =
  | { readonly group: "productivity"; readonly key?: ProductivityLabel }
  | { readonly group: "category"; readonly key?: ActivityCategory }
  | { readonly group: "project"; readonly key?: string };

/** Opens a new project draft when used as a project target key. */
export const NEW_PROJECT_KEY = "new";

export type EditorSelection =
  | { readonly group: "productivity"; readonly key: ProductivityLabel }
  | { readonly group: "category"; readonly key: ActivityCategory }
  | { readonly group: "project"; readonly key: string };

/** The categories the editor lists. Unclassified is not one: it has no name,
 * description, or productivity to tune, so it keeps its built-in look. */
export const LISTED_CATEGORIES: readonly ActivityCategory[] = CUSTOMIZABLE_CATEGORIES;
export const LISTED_PRODUCTIVITY: readonly ProductivityLabel[] = CUSTOMIZABLE_PRODUCTIVITY_LABELS;

/** Whether a category has a card: a built-in one, or an added one that is not deleted. */
function listsCategory(category: ActivityCategory, customizations: CategoryCustomizations): boolean {
  if (LISTED_CATEGORIES.includes(category)) return true;
  const added = customizations[category];
  return isCustomActivityCategory(category) && Boolean(added?.name) && !added?.deletedAt;
}

/** Whether an opening target names a card the editor shows (and so opens it for editing). */
export function targetsListedCard(target: CategoryEditorTarget, customizations: CategoryCustomizations = {}): boolean {
  if (target.key === undefined) return false;
  return target.group !== "category" || listsCategory(target.key, customizations);
}

export type ProductivityChoice = "default" | ProductivityLabel;

/** A productivity label or category as the editor shows it: saved, or drafted. */
export type DefinitionValue = {
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly productivity: ProductivityChoice;
};

export type ProjectValue = {
  readonly name: string;
  readonly description: string;
  readonly color: string;
};

/** "productivity:focus", "category:learning": one drafted definition. */
export type DefinitionKey = string;

export function definitionKey(selection: { readonly group: "productivity"; readonly key: ProductivityLabel } | { readonly group: "category"; readonly key: ActivityCategory }): DefinitionKey {
  return (selection.group + ":" + selection.key) as DefinitionKey;
}

export function selectionId(selection: EditorSelection): string {
  return selection.group + ":" + selection.key;
}

export function sameSelection(left: EditorSelection, right: EditorSelection): boolean {
  return selectionId(left) === selectionId(right);
}

export const PRODUCTIVITY_COLOR_KEY: Readonly<Record<ProductivityLabel, AppThemeColorKey>> = {
  focus: "productivityFocus",
  neutral: "productivityNeutral",
  drift: "productivityDrift",
};

export function defaultCategoryColor(category: ActivityCategory): string {
  return normalizeHex(CATEGORY_COLOR_OPTIONS.find((option) => option.key === category)?.defaultColor ?? "#66707a");
}

export function defaultProductivityColor(label: ProductivityLabel): string {
  return normalizeHex(APP_THEME_PRODUCTIVITY_COLOR_OPTIONS.find((option) => option.key === PRODUCTIVITY_COLOR_KEY[label])?.defaultColor ?? "#9b968b");
}

export function productivityColor(label: ProductivityLabel, overrides: AppThemeColorOverrides): string {
  return normalizeHex(overrides[PRODUCTIVITY_COLOR_KEY[label]] ?? defaultProductivityColor(label));
}

/*
 * In the editor a definition's description is the whole description in
 * effect: Drifty's own until the user edits it. Stored customizations keep
 * only the user's edited text, so Drifty's own (or an emptied field) stores
 * nothing and the classifier keeps its default meaning.
 */

export function savedCategoryValue(category: ActivityCategory, customizations: CategoryCustomizations, colors: CategoryColorOverrides, defaultDescription: string): DefinitionValue {
  const customization = customizations[category];
  return {
    name: customization?.name ?? "",
    description: customization?.description?.trim() || defaultDescription,
    color: normalizeHex(categoryControlColor(category, colors)),
    productivity: customization?.productivity ?? "default",
  };
}

/** A user-added category as saved: its own name, words, color, and fixed productivity. */
export function savedAddedCategoryValue(category: ActivityCategory, customizations: CategoryCustomizations, fallbackColor = "#66707a"): DefinitionValue {
  const customization = customizations[category];
  return {
    name: customization?.name ?? "",
    description: customization?.description?.trim() ?? "",
    color: normalizeHex(customization?.color ?? fallbackColor),
    productivity: customization?.productivity ?? "default",
  };
}

/**
 * The stored form of a drafted added category. It keeps when it was created
 * (or takes createdAt when new) and, if deleted, when that happened.
 */
export function addedCategoryCustomizationFrom(draft: DefinitionValue, saved: CategoryCustomization | undefined, createdAt: string): CategoryCustomization {
  const description = draft.description.trim();
  return {
    name: draft.name.trim(),
    ...(description ? { description } : {}),
    ...(draft.productivity !== "default" ? { productivity: draft.productivity } : {}),
    color: normalizeHex(draft.color),
    createdAt: saved?.createdAt ?? createdAt,
    ...(saved?.deletedAt ? { deletedAt: saved.deletedAt } : {}),
  };
}

export function savedProductivityValue(label: ProductivityLabel, customizations: ProductivityCustomizations, colors: AppThemeColorOverrides, defaultDescription: string): DefinitionValue {
  const customization = customizations[label];
  return {
    name: customization?.name ?? "",
    description: customization?.description?.trim() || defaultDescription,
    color: productivityColor(label, colors),
    productivity: "default",
  };
}

export function defaultDefinitionValue(selection: { readonly group: "productivity"; readonly key: ProductivityLabel } | { readonly group: "category"; readonly key: ActivityCategory }, defaultDescription: string): DefinitionValue {
  return {
    name: "",
    description: defaultDescription,
    color: selection.group === "category" ? defaultCategoryColor(selection.key) : defaultProductivityColor(selection.key),
    productivity: "default",
  };
}

export function sameDefinition(left: DefinitionValue, right: DefinitionValue): boolean {
  return left.name.trim() === right.name.trim()
    && left.description.trim() === right.description.trim()
    && normalizeHex(left.color) === normalizeHex(right.color)
    && left.productivity === right.productivity;
}

/** Whether the words the classifier reads changed; a color or name alone does not reclassify. */
export function descriptionChanged(draft: DefinitionValue, saved: DefinitionValue): boolean {
  return draft.description.trim() !== saved.description.trim();
}

export function textChanged(draft: DefinitionValue, saved: DefinitionValue): boolean {
  return draft.name.trim() !== saved.name.trim()
    || descriptionChanged(draft, saved)
    || draft.productivity !== saved.productivity;
}

/** The stored customization for a drafted category, or null when it is back to the built-in one. */
export function categoryCustomizationFrom(draft: DefinitionValue, defaultName: string, defaultDescription: string): CategoryCustomization | null {
  const name = draft.name.trim();
  const description = draft.description.trim();
  const next: CategoryCustomization = {
    ...(name && name !== defaultName ? { name } : {}),
    ...(description && description !== defaultDescription.trim() ? { description } : {}),
    ...(draft.productivity !== "default" ? { productivity: draft.productivity } : {}),
  };
  return Object.keys(next).length > 0 ? next : null;
}

export function productivityCustomizationFrom(draft: DefinitionValue, defaultName: string, defaultDescription: string): ProductivityCustomization | null {
  const name = draft.name.trim();
  const description = draft.description.trim();
  const next: ProductivityCustomization = {
    ...(name && name !== defaultName ? { name } : {}),
    ...(description && description !== defaultDescription.trim() ? { description } : {}),
  };
  return Object.keys(next).length > 0 ? next : null;
}

export function savedProjectValue(project: Project): ProjectValue {
  return { name: project.name, description: project.description, color: normalizeProjectColor(project.color) };
}

export function sameProject(left: ProjectValue, right: ProjectValue): boolean {
  return left.name.trim() === right.name.trim()
    && left.description.trim() === right.description.trim()
    && normalizeProjectColor(left.color) === normalizeProjectColor(right.color);
}

/** Active projects first, archived after, each in the library's order. */
export function orderedProjects(projects: readonly Project[]): { readonly active: readonly Project[]; readonly archived: readonly Project[] } {
  return {
    active: projects.filter((project) => project.status === "active"),
    archived: projects.filter((project) => project.status !== "active"),
  };
}

/** Resolves an opening target against what exists; a missing key falls back to the group's first item. */
export function initialSelection(target: CategoryEditorTarget, projects: readonly Project[], showProjects: boolean, customizations: CategoryCustomizations = {}): EditorSelection {
  switch (target.group) {
    case "productivity":
      return { group: "productivity", key: target.key ?? LISTED_PRODUCTIVITY[0] };
    case "category":
      return { group: "category", key: target.key && listsCategory(target.key, customizations) ? target.key : LISTED_CATEGORIES[0] };
    case "project": {
      if (!showProjects) return { group: "category", key: LISTED_CATEGORIES[0] };
      if (target.key && (target.key === NEW_PROJECT_KEY || projects.some((project) => project.id === target.key))) {
        return { group: "project", key: target.key };
      }
      const first = orderedProjects(projects).active[0] ?? projects[0];
      return first ? { group: "project", key: first.id } : { group: "project", key: NEW_PROJECT_KEY };
    }
  }
}

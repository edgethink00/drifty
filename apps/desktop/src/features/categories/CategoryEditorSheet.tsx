import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  CATEGORY_CUSTOM_NAME_MAX_LENGTH,
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  MAX_ADDED_PRODUCTIVITY_LEVELS,
  MAX_CATEGORY_COUNT,
  customCategoryIds,
  isCustomActivityCategory,
  isCustomProductivityLevel,
  newCustomCategoryId,
  newProductivityLevelId,
  productivityLevelIds,
  type ActivityCategory,
  type CustomProductivityLevel,
  type CategoryCustomization,
  type CategoryCustomizations,
  type ProductivityCustomization,
  type ProductivityCustomizations,
  type ProductivityLabel,
  type Project,
  type ProjectInput,
} from "@drifty/domain";
import { ActionLabel } from "../../components/ActionLabel";
import { KeyHint } from "../../components/KeyHint";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { ModalPresence } from "../../components/ModalPresence";
import { PencilGlyph } from "../../components/PencilGlyph";
import { ProjectEditorFields } from "../../components/ProjectEditorFields";
import { describeActionError, type DescribedActionError } from "../../lib/actionErrors";
import { normalizeHex, normalizeProjectColor } from "../../lib/colorPalette";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalSubmitShortcut } from "../../lib/useModalSubmitShortcut";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";
import { translateFor } from "../localization/translate";
import type { TranslationKey } from "../localization/translations";
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { ProjectDeleteConfirmation, type ProjectDeleteResult } from "../projects/ProjectDeleteConfirmation";
import { PROJECT_LIBRARY_WINDOW_DAYS } from "../projects/projectDates";
import type { ProjectSaveResult } from "../projects/projectSaveResult";
import { firstUnusedProjectColor } from "../settings/projectPalette";
import type { AppThemeColorKey } from "../settings/SettingsColorControls";
import type { AppThemeColorOverrides, CategoryColorOverrides } from "../settings/settingsStorage";
import type { DefinitionChanges } from "../settings/useCategoryCustomizationController";
import {
  LISTED_CATEGORIES,
  LISTED_PRODUCTIVITY,
  NEW_PROJECT_KEY,
  PRODUCTIVITY_COLOR_KEY,
  addedCategoryCustomizationFrom,
  categoryCustomizationFrom,
  defaultCategoryColor,
  defaultDefinitionValue,
  defaultProductivityColor,
  definitionKey,
  initialSelection,
  orderedProjects,
  productivityCustomizationFrom,
  savedAddedCategoryValue,
  sameDefinition,
  sameProject,
  sameSelection,
  savedCategoryValue,
  savedProductivityValue,
  savedProjectValue,
  selectionId,
  targetsListedCard,
  textChanged,
  type CategoryEditorTarget,
  type DefinitionValue,
  type EditorSelection,
  type ProductivityChoice,
  type ProjectValue,
} from "./categoryEditorModel";
import { DefinitionDescriptionField, DefinitionIdentityField, balancedIdentitySwatches } from "./definitionFields";
import { ArchiveIcon, LockIcon, PlusIcon, ResetIcon, TrashIcon, UnarchiveIcon } from "./definitionIcons";
import { useCardMotion } from "./useCardMotion";
import { CategoryEditorLockBand, CategoryEditorLockScreen, type CloudOffer, type IntelligenceProviderChoice } from "./CategoryEditorAiNotice";
import "./categoryEditor.css";

type DefinitionSelection =
  | { readonly group: "productivity"; readonly key: ProductivityLabel }
  | { readonly group: "category"; readonly key: ActivityCategory };

const CATEGORY_CRITERIA_KEY: Readonly<Record<ActivityCategory, TranslationKey>> = {
  workspace: "settings.categories.default.workspace",
  learning: "settings.categories.default.learning",
  communication: "settings.categories.default.communication",
  music: "settings.categories.default.music",
  game: "settings.categories.default.game",
  social_media: "settings.categories.default.socialMedia",
  entertainment: "settings.categories.default.entertainment",
  shopping: "settings.categories.default.shopping",
  utility: "settings.categories.default.utility",
  unknown: "settings.categories.default.unknown",
};

const PRODUCTIVITY_CRITERIA_KEY: Readonly<Record<ProductivityLabel, TranslationKey>> = {
  focus: "settings.productivity.default.focus",
  neutral: "settings.productivity.default.neutral",
  drift: "settings.productivity.default.drift",
};

const PRODUCTIVITY_PLACEHOLDER_KEY: Readonly<Record<ProductivityLabel, TranslationKey>> = {
  focus: "settings.productivity.placeholder.focus",
  neutral: "settings.productivity.placeholder.neutral",
  drift: "settings.productivity.placeholder.drift",
};

/**
 * Where each category sits in the Your Day flow legend while Drifty decides
 * its productivity; a fixed productivity moves it. Unclassified sits apart.
 */
const LEGEND_LANE: Readonly<Record<ActivityCategory, ProductivityLabel | null>> = {
  workspace: "focus",
  learning: "focus",
  communication: "neutral",
  music: "neutral",
  utility: "neutral",
  entertainment: "drift",
  social_media: "drift",
  shopping: "drift",
  game: "drift",
  unknown: null,
};

type ToneStyle = CSSProperties & { readonly "--definition-tone": string };

function toneStyle(color: string): ToneStyle {
  return { "--definition-tone": color };
}

/** The card id of an added productivity level. */
function levelCardId(key: string): string {
  return "level:" + key;
}

function parseDefinitionKey(key: string): DefinitionSelection {
  const [group, value] = key.split(":");
  return group === "category"
    ? { group: "category", key: value as ActivityCategory }
    : { group: "productivity", key: value as ProductivityLabel };
}

/** An added productivity level as the editor shows it: its name and color. */
type LevelValue = {
  readonly name: string;
  readonly color: string;
};

/** A category added in this sitting: its id is final, and it is a draft until Save. */
type AddedCategoryDraft = {
  readonly id: ActivityCategory;
  readonly color: string;
};

/** The projects tab's selection when it has no project to point at. */
const NO_PROJECT = "";

export type CategoryEditorSheetProps = {
  readonly initialTarget: CategoryEditorTarget;
  readonly categoryCustomizations: CategoryCustomizations;
  readonly productivityCustomizations: ProductivityCustomizations;
  readonly categoryColorOverrides: CategoryColorOverrides;
  readonly appThemeColorOverrides: AppThemeColorOverrides;
  readonly showProjects: boolean;
  readonly projects: readonly Project[];
  readonly projectsBusy?: boolean;
  /** Enabled app/site rules per category; deleting a category turns them off, which its strip says. */
  readonly ruleCountByCategory?: Readonly<Partial<Record<ActivityCategory, number>>>;
  /** Each project's time in the latest seven days (the Projects list's column); the delete confirmation names it. Null while loading. */
  readonly projectRecentSeconds?: ReadonlyMap<string, number> | null;
  readonly onSaveDefinitions: (changes: DefinitionChanges) => Promise<void> | void;
  readonly onCategoryColorChange: (category: ActivityCategory, value: string) => void;
  readonly onCategoryColorReset: (category: ActivityCategory) => void;
  readonly onProductivityColorChange: (key: AppThemeColorKey, value: string) => void;
  readonly onProductivityColorReset: (key: AppThemeColorKey) => void;
  readonly onSaveProject: (input: ProjectInput) => Promise<ProjectSaveResult> | ProjectSaveResult;
  readonly onDeleteProject: (id: string) => Promise<ProjectDeleteResult> | ProjectDeleteResult | void;
  readonly onClose: () => void;
  /** True while Intelligence (the project model) is not connected, so projects get no time. */
  readonly intelligenceUnavailable?: boolean;
  /** Opens Settings › Intelligence after the editor closes (saving first when there are changes). */
  readonly onOpenIntelligence?: () => void;
  /** Starts Drifty Cloud (trial, sign-in or plan) when it is not available yet; the lock screen offers it beside your own key. */
  readonly onStartCloud?: () => void;
  /** What Drifty Cloud takes for this person, shown on the provider lock screen. */
  readonly cloudOffer?: CloudOffer;
  /** Starts the free Drifty Cloud trial in place; the lock lifts when it starts. */
  readonly onStartTrial?: () => Promise<void>;
  /** An OpenRouter key is already in the Keychain, so OpenRouter connects in place. */
  readonly openRouterReady?: boolean;
  /** Picks a model for Intelligence; stayHere connects it without leaving (a ready key), otherwise Settings › Intelligence opens on it. */
  readonly onConnectProvider?: (provider: Exclude<IntelligenceProviderChoice, "cloud">, stayHere: boolean) => void;
};

/**
 * The category editor: every definition Drifty sorts time by — productivity
 * labels, categories, projects — in one sheet that opens from wherever those
 * definitions show. Each group is a list of cards, Dayflow's way: the name
 * over its description, edited in place. Edits stay drafts until Save and
 * apply to activity classified from then on. App and site rules save as they
 * change, so they keep their own sheet.
 */
export function CategoryEditorSheet({
  initialTarget,
  categoryCustomizations,
  productivityCustomizations,
  categoryColorOverrides,
  appThemeColorOverrides,
  showProjects,
  projects,
  projectsBusy = false,
  projectRecentSeconds,
  ruleCountByCategory,
  onSaveDefinitions,
  onCategoryColorChange,
  onCategoryColorReset,
  onProductivityColorChange,
  onProductivityColorReset,
  onSaveProject,
  onDeleteProject,
  onClose,
  intelligenceUnavailable = false,
  onOpenIntelligence,
  onStartCloud,
  cloudOffer,
  onStartTrial,
  openRouterReady = false,
  onConnectProvider,
}: CategoryEditorSheetProps) {
  const { effectiveLanguage, t } = useLocalization();
  const builtInT = translateFor(effectiveLanguage);
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const draftCounter = useRef(0);
  const deckPressOnEmpty = useRef(false);

  const [opening] = useState(() => {
    const resolved = initialSelection(initialTarget, projects, showProjects, categoryCustomizations);
    if (resolved.group !== "project" || resolved.key !== NEW_PROJECT_KEY) return { selection: resolved, newKeys: [] as string[], drafts: {} as Record<string, ProjectValue> };
    // "New project" while Intelligence locks projects opens on the lock instead of a draft.
    if (intelligenceUnavailable && onOpenIntelligence !== undefined) {
      const first = orderedProjects(projects).active[0] ?? projects[0];
      return { selection: { group: "project", key: first?.id ?? NO_PROJECT } as EditorSelection, newKeys: [] as string[], drafts: {} as Record<string, ProjectValue> };
    }
    draftCounter.current += 1;
    const key = "draft-" + draftCounter.current;
    return {
      selection: { group: "project", key } as EditorSelection,
      newKeys: [key],
      drafts: { [key]: { name: "", description: "", color: firstUnusedProjectColor(projects.filter((project) => project.status === "active").map((project) => project.color)) } },
    };
  });
  const [selection, setSelection] = useState<EditorSelection>(opening.selection);
  // A door that names one item opens with that card in edit; a door that
  // names only a group opens on its list.
  // (Unclassified is not listed, so a door naming it opens the category list.)
  const [editing, setEditing] = useState(() => targetsListedCard(initialTarget, categoryCustomizations));
  // The added productivity level whose card is open, if one is.
  const [editingLevel, setEditingLevel] = useState<CustomProductivityLevel | null>(null);
  // The productivity level (built-in label or drafted key) whose "add a
  // category" list is open.
  const [assignOpen, setAssignOpen] = useState<string | null>(null);
  const [addedCategories, setAddedCategories] = useState<readonly AddedCategoryDraft[]>([]);
  const [categoryErrors, setCategoryErrors] = useState<Readonly<Partial<Record<ActivityCategory, string>>>>({});
  // Added productivity levels: edits by id, ones added and ones deleted in
  // this sitting. All are drafts until Save.
  const [levelDrafts, setLevelDrafts] = useState<Readonly<Partial<Record<CustomProductivityLevel, LevelValue>>>>({});
  const [newLevels, setNewLevels] = useState<readonly CustomProductivityLevel[]>([]);
  const [deletedLevels, setDeletedLevels] = useState<readonly CustomProductivityLevel[]>([]);
  const [levelErrors, setLevelErrors] = useState<Readonly<Partial<Record<CustomProductivityLevel, string>>>>({});
  // Browser preview: built-in items marked for deletion, by definition key,
  // and categories fixed to a drafted productivity level.
  // Categories deleted, and saved-deleted ones restored, in this sitting; both are drafts until Save.
  const [deletedKeys, setDeletedKeys] = useState<readonly string[]>([]);
  const [restoredKeys, setRestoredKeys] = useState<readonly string[]>([]);
  const [definitionDrafts, setDefinitionDrafts] = useState<Record<string, DefinitionValue>>({});
  const [projectDrafts, setProjectDrafts] = useState<Record<string, ProjectValue>>(opening.drafts);
  const [newProjectKeys, setNewProjectKeys] = useState<readonly string[]>(opening.newKeys);
  const [projectErrors, setProjectErrors] = useState<Record<string, DescribedActionError>>({});
  const [definitionError, setDefinitionError] = useState<DescribedActionError | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<{ readonly detail: string } | null>(null);

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const { active: activeProjects, archived: archivedProjects } = orderedProjects(projects);

  // Every category the sheet lists: Drifty's own, the ones the user added
  // (in the order they were made), then the ones added in this sitting.
  const savedAddedCategories = useMemo(() => customCategoryIds(categoryCustomizations), [categoryCustomizations]);
  const editorCategories: readonly ActivityCategory[] = [...LISTED_CATEGORIES, ...savedAddedCategories, ...addedCategories.map((entry) => entry.id)];
  const isAddedCategory = (category: ActivityCategory) => isCustomActivityCategory(category);
  const isNewCategory = (category: ActivityCategory) => addedCategories.some((entry) => entry.id === category);

  // Added productivity levels: the saved ones in the order they were made,
  // then the ones added in this sitting. A level deleted now stays listed as
  // a strip until Save.
  const savedLevels = useMemo(() => productivityLevelIds(productivityCustomizations), [productivityCustomizations]);
  const liveLevels: readonly CustomProductivityLevel[] = [...savedLevels.filter((id) => !deletedLevels.includes(id)), ...newLevels];
  const savedLevelValue = (id: CustomProductivityLevel): LevelValue => ({
    name: productivityCustomizations[id]?.name ?? "",
    color: normalizeHex(productivityCustomizations[id]?.color ?? defaultProductivityColor("neutral")),
  });
  const levelValue = (id: CustomProductivityLevel): LevelValue => levelDrafts[id] ?? savedLevelValue(id);
  const levelName = (id: CustomProductivityLevel) => levelValue(id).name.trim() || t("categoryEditor.newProductivity");

  // Drifty's own description of an item: what the description field starts
  // with, and what an emptied field goes back to.
  // An added category has no description of Drifty's own.
  const builtInDefinition = (target: DefinitionSelection) => (target.group === "category" && isAddedCategory(target.key)
    ? ""
    : t(target.group === "category" ? CATEGORY_CRITERIA_KEY[target.key] : PRODUCTIVITY_CRITERIA_KEY[target.key]));
  const savedDefinition = (target: DefinitionSelection): DefinitionValue => (target.group === "category"
    ? isAddedCategory(target.key)
      ? savedAddedCategoryValue(target.key, categoryCustomizations, addedCategories.find((entry) => entry.id === target.key)?.color)
      : savedCategoryValue(target.key, categoryCustomizations, categoryColorOverrides, builtInDefinition(target))
    : savedProductivityValue(target.key, productivityCustomizations, appThemeColorOverrides, builtInDefinition(target)));
  const currentDefinition = (target: DefinitionSelection): DefinitionValue => definitionDrafts[definitionKey(target)] ?? savedDefinition(target);
  const builtInName = (target: DefinitionSelection) => (target.group === "category"
    ? isAddedCategory(target.key) ? categoryCustomizations[target.key]?.name ?? "" : localizedCategoryLabel(target.key, builtInT)
    : localizedProductivityLabel(target.key, builtInT));
  // A new category without a name yet shows a stand-in name.
  const definitionName = (target: DefinitionSelection) => currentDefinition(target).name.trim() || builtInName(target) || t("categoryEditor.newCategory");

  const updateDefinition = (target: DefinitionSelection, patch: Partial<DefinitionValue>) => {
    const key = definitionKey(target);
    const saved = savedDefinition(target);
    if (target.group === "category" && patch.name !== undefined && categoryErrors[target.key]) {
      setCategoryErrors((previous) => {
        const copy = { ...previous };
        delete copy[target.key];
        return copy;
      });
    }
    setDefinitionDrafts((previous) => {
      const next = { ...(previous[key] ?? saved), ...patch };
      const copy = { ...previous };
      // A draft is dropped only when it is exactly the saved value. Comparing
      // trimmed text here would swallow the space typed after a prefilled
      // description before the next word arrives.
      if (sameDefinition(next, saved) && next.name === saved.name && next.description === saved.description) delete copy[key];
      else copy[key] = next;
      return copy;
    });
  };

  const currentProject = (key: string): ProjectValue | null => {
    const draft = projectDrafts[key];
    if (draft) return draft;
    const project = projectById.get(key);
    return project ? savedProjectValue(project) : null;
  };

  const updateProject = (key: string, patch: Partial<ProjectValue>) => {
    const project = projectById.get(key);
    setProjectDrafts((previous) => {
      const base = previous[key] ?? (project ? savedProjectValue(project) : null);
      if (!base) return previous;
      const next = { ...base, ...patch };
      const copy = { ...previous };
      if (project && sameProject(next, savedProjectValue(project))) delete copy[key];
      else copy[key] = next;
      return copy;
    });
    setProjectErrors((previous) => {
      if (!(key in previous)) return previous;
      const copy = { ...previous };
      delete copy[key];
      return copy;
    });
  };

  const addProjectDraft = () => {
    draftCounter.current += 1;
    const key = "draft-" + draftCounter.current;
    const taken = [...activeProjects.map((project) => project.color), ...Object.values(projectDrafts).map((draft) => draft.color)];
    setProjectDrafts((previous) => ({ ...previous, [key]: { name: "", description: "", color: firstUnusedProjectColor(taken) } }));
    setNewProjectKeys((previous) => [...previous, key]);
    setSelection({ group: "project", key });
    setEditingLevel(null);
    setEditing(true);
  };

  // With no project left, the projects tab stays open on its empty list
  // rather than handing the user to another tab.
  const firstProjectSelection = (except?: string): EditorSelection => {
    const next = activeProjects.find((project) => project.id !== except) ?? archivedProjects.find((project) => project.id !== except);
    if (next) return { group: "project", key: next.id };
    const draft = newProjectKeys.find((key) => key !== except);
    return { group: "project", key: draft ?? NO_PROJECT };
  };

  const discardProjectDraft = (key: string) => {
    setProjectDrafts((previous) => {
      const copy = { ...previous };
      delete copy[key];
      return copy;
    });
    setNewProjectKeys((previous) => previous.filter((item) => item !== key));
    setProjectErrors((previous) => {
      const copy = { ...previous };
      delete copy[key];
      return copy;
    });
    setSelection(firstProjectSelection(key));
    setEditing(false);
  };

  // A project removed elsewhere (or a group hidden) cannot stay selected.
  useEffect(() => {
    if (selection.group !== "project") return;
    if (!showProjects) {
      setSelection({ group: "category", key: LISTED_CATEGORIES[0] });
      return;
    }
    if (selection.key === NO_PROJECT) return;
    if (!newProjectKeys.includes(selection.key) && !projectById.has(selection.key)) setSelection(firstProjectSelection(selection.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, showProjects, projectById, newProjectKeys]);

  const draftedDefinitionKeys = Object.keys(definitionDrafts);
  const draftedProjectKeys = Object.keys(projectDrafts);
  const dirty = draftedDefinitionKeys.length > 0 || draftedProjectKeys.length > 0 || deletedKeys.length > 0 || restoredKeys.length > 0 || addedCategories.length > 0
    || Object.keys(levelDrafts).length > 0 || newLevels.length > 0 || deletedLevels.length > 0;
  const locked = saving || statusChanging;

  const applyColor = (target: DefinitionSelection, color: string) => {
    const value = normalizeHex(color);
    if (target.group === "category") {
      if (value === defaultCategoryColor(target.key)) onCategoryColorReset(target.key);
      else onCategoryColorChange(target.key, value);
      return;
    }
    if (value === defaultProductivityColor(target.key)) onProductivityColorReset(PRODUCTIVITY_COLOR_KEY[target.key]);
    else onProductivityColorChange(PRODUCTIVITY_COLOR_KEY[target.key], value);
  };

  /**
   * Saves every draft; true once all of it saved and the sheet closed. Leaving
   * for setup drops a new project nobody has typed into, rather than stopping
   * on its missing name.
   */
  const save = async (options: { readonly dropUntouchedNew?: boolean } = {}): Promise<boolean> => {
    if (locked) return false;
    const untouched = (key: string) => !projectDrafts[key]?.name.trim() && !projectDrafts[key]?.description.trim();
    const newKeys = options.dropUntouchedNew ? newProjectKeys.filter((key) => !untouched(key)) : newProjectKeys;
    const unnamed = newKeys.find((key) => !projectDrafts[key]?.name.trim());
    if (unnamed) {
      setSelection({ group: "project", key: unnamed });
      setEditingLevel(null);
      setEditing(true);
      setProjectErrors((previous) => ({ ...previous, [unnamed]: { message: t("categoryEditor.projectNameRequired"), detail: null } }));
      return false;
    }
    // An added category needs a name. One added here and left untouched is
    // dropped; one with words but no name stops the save, as a project does.
    const draftOf = (category: ActivityCategory) => definitionDrafts[definitionKey({ group: "category", key: category })];
    const keptNew = addedCategories
      .map((entry) => entry.id)
      .filter((category) => Boolean(draftOf(category)?.name.trim() || draftOf(category)?.description.trim()));
    const unnamedCategory = [...savedAddedCategories, ...keptNew].find((category) => {
      const draft = draftOf(category);
      return draft !== undefined && !draft.name.trim() && !deletedKeys.includes(definitionKey({ group: "category", key: category }));
    });
    if (unnamedCategory) {
      setSelection({ group: "category", key: unnamedCategory });
      setEditingLevel(null);
      setEditing(true);
      setCategoryErrors((previous) => ({ ...previous, [unnamedCategory]: t("categoryEditor.categoryNameRequired") }));
      return false;
    }
    // An added level needs a name too. A new one nobody named or gave a
    // category is dropped; a named-less one holding categories stops the save.
    const levelHoldsCategories = (id: CustomProductivityLevel) => editorCategories.some((category) => currentDefinition({ group: "category", key: category }).productivity === id);
    const keptNewLevels = newLevels.filter((id) => Boolean(levelValue(id).name.trim()) || levelHoldsCategories(id));
    const unnamedLevel = [...savedLevels.filter((id) => !deletedLevels.includes(id)), ...keptNewLevels].find((id) => !levelValue(id).name.trim());
    if (unnamedLevel) {
      setSelection({ group: "productivity", key: LISTED_PRODUCTIVITY[0] });
      setEditingLevel(unnamedLevel);
      setEditing(true);
      setLevelErrors((previous) => ({ ...previous, [unnamedLevel]: t("categoryEditor.levelNameRequired") }));
      return false;
    }
    setSaving(true);
    setDefinitionError(null);

    const categories: Partial<Record<ActivityCategory, CategoryCustomization | null>> = {};
    const productivity: Partial<Record<ProductivityLabel | CustomProductivityLevel, ProductivityCustomization | null>> = {};
    let definitionsChanged = false;
    try {
      const now = Date.now();
      // Levels: new ones are stamped in the order they were added; a deleted
      // one is removed.
      keptNewLevels.forEach((id, index) => {
        const value = levelValue(id);
        productivity[id] = { name: value.name.trim(), color: normalizeHex(value.color), createdAt: new Date(now + index).toISOString() };
      });
      for (const id of savedLevels) {
        if (deletedLevels.includes(id)) productivity[id] = null;
        else if (levelDrafts[id]) productivity[id] = { name: levelValue(id).name.trim(), color: normalizeHex(levelValue(id).color), ...(productivityCustomizations[id]?.createdAt ? { createdAt: productivityCustomizations[id]?.createdAt } : {}) };
      }
      if (Object.keys(productivity).length > 0) definitionsChanged = true;
      // A category fixed to a level that no longer exists goes back to Drifty's judgment.
      const remainingLevels = new Set<string>([...savedLevels.filter((id) => !deletedLevels.includes(id)), ...keptNewLevels]);
      const drafts: Record<string, DefinitionValue> = { ...definitionDrafts };
      for (const category of editorCategories) {
        const target = { group: "category", key: category } as const;
        const current = currentDefinition(target);
        if (isCustomProductivityLevel(current.productivity) && !remainingLevels.has(current.productivity)) {
          drafts[definitionKey(target)] = { ...current, productivity: "default" };
        }
      }
      for (const [key, draft] of Object.entries(drafts)) {
        const target = parseDefinitionKey(key);
        const saved = savedDefinition(target);
        // An added category keeps its name, words, color, and fixed
        // productivity together; new ones are stamped in the order they were added.
        if (target.group === "category" && isAddedCategory(target.key)) {
          if (deletedKeys.includes(key)) continue;
          const newIndex = addedCategories.findIndex((entry) => entry.id === target.key);
          if (newIndex >= 0 ? !keptNew.includes(target.key) : sameDefinition(draft, saved)) continue;
          categories[target.key] = addedCategoryCustomizationFrom(
            draft,
            (categories[target.key] ?? categoryCustomizations[target.key]) as CategoryCustomization | undefined,
            new Date(now + Math.max(0, newIndex)).toISOString(),
          );
          definitionsChanged = true;
          continue;
        }
        if (normalizeHex(draft.color) !== normalizeHex(saved.color)) applyColor(target, draft.color);
        if (!textChanged(draft, saved) || deletedKeys.includes(key)) continue;
        definitionsChanged = true;
        if (target.group === "category") categories[target.key] = categoryCustomizationFrom(draft, builtInName(target), builtInDefinition(target));
        else productivity[target.key] = productivityCustomizationFrom(draft, builtInName(target), builtInDefinition(target));
      }
      // A deletion keeps the category's saved name, color, and words for past
      // records and stamps when it stopped being used; a restore removes the stamp.
      const deletedAt = new Date().toISOString();
      for (const key of deletedKeys) {
        const target = parseDefinitionKey(key);
        if (target.group !== "category") continue;
        categories[target.key] = { ...(categoryCustomizations[target.key] ?? {}), deletedAt };
        definitionsChanged = true;
      }
      for (const key of restoredKeys) {
        const target = parseDefinitionKey(key);
        if (target.group !== "category" || deletedKeys.includes(key)) continue;
        const { deletedAt: _restored, ...rest } = (categories[target.key] ?? categoryCustomizations[target.key] ?? {}) as CategoryCustomization;
        categories[target.key] = Object.keys(rest).length > 0 ? rest : null;
        definitionsChanged = true;
      }
      if (definitionsChanged) await onSaveDefinitions({ categories, productivity });
    } catch (error) {
      setDefinitionError(describeActionError(error, t("projects.editor.saveError")));
      setSaving(false);
      return false;
    }
    setDeletedKeys([]);
    setRestoredKeys([]);
    setDefinitionDrafts({});
    setAddedCategories([]);
    setCategoryErrors({});
    setLevelDrafts({});
    setNewLevels([]);
    setDeletedLevels([]);
    setLevelErrors({});

    const failures: Record<string, DescribedActionError> = {};
    const savedKeys: string[] = [];
    const order = [...draftedProjectKeys.filter((key) => !newProjectKeys.includes(key)), ...newKeys];
    for (const key of order) {
      const draft = projectDrafts[key];
      if (!draft) continue;
      const existing = projectById.get(key);
      const input: ProjectInput = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        color: normalizeProjectColor(draft.color),
        status: existing?.status ?? "active",
      };
      if (existing) input.id = existing.id;
      try {
        const result = await onSaveProject(input);
        if (result === true) savedKeys.push(key);
        else failures[key] = saveFailure(result);
      } catch (error) {
        failures[key] = describeActionError(error, t("projects.editor.saveError"));
      }
    }
    if (savedKeys.length > 0) {
      setProjectDrafts((previous) => {
        const copy = { ...previous };
        for (const key of savedKeys) delete copy[key];
        return copy;
      });
      setNewProjectKeys((previous) => previous.filter((key) => !savedKeys.includes(key)));
    }
    setSaving(false);
    const failed = Object.keys(failures);
    if (failed.length === 0) {
      onClose();
      return true;
    }
    setProjectErrors(failures);
    setSelection({ group: "project", key: failed[0] });
    setEditingLevel(null);
    setEditing(true);
    return false;
  };

  const saveFailure = (result: Exclude<ProjectSaveResult, true>): DescribedActionError => (typeof result === "object"
    ? { message: result.error, detail: result.detail ?? null }
    : { message: t("projects.editor.saveError"), detail: null });

  const setProjectStatus = async (project: Project, status: Project["status"]) => {
    setStatusChanging(true);
    try {
      const result = await onSaveProject({ id: project.id, name: project.name, description: project.description, color: project.color, status });
      if (result !== true) setProjectErrors((previous) => ({ ...previous, [project.id]: saveFailure(result) }));
    } catch (error) {
      setProjectErrors((previous) => ({ ...previous, [project.id]: describeActionError(error, t("projects.editor.saveError")) }));
    } finally {
      setStatusChanging(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    const target = pendingDelete;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await onDeleteProject(target.id);
      if (result === undefined || result === true) {
        setPendingDelete(null);
        setProjectDrafts((previous) => {
          const copy = { ...previous };
          delete copy[target.id];
          return copy;
        });
        setSelection(firstProjectSelection(target.id));
        setEditing(false);
      } else {
        setDeleteError({ detail: typeof result === "object" ? result.error : "" });
      }
    } catch (error) {
      setDeleteError({ detail: error instanceof Error ? error.message : "" });
    } finally {
      setDeleting(false);
    }
  };

  // Opening and folding a card moves the list (and keeps the open card in view).
  useCardMotion(dialogRef, editing ? (editingLevel !== null ? levelCardId(editingLevel) : selectionId(selection)) : null);
  // Bring the list of categories to add into view under the tags.
  useEffect(() => {
    if (!assignOpen) return;
    dialogRef.current?.querySelector<HTMLElement>(".category-editor__assign-list")?.scrollIntoView?.({ block: "nearest" });
  }, [assignOpen]);
  useAnchoredDialog(dialogRef);
  const overlayDismiss = useOverlayDismiss(onClose, { disabled: locked, keepOpen: dirty });

  // Productivity levels ("lanes") are the built-in labels, which stay, plus in
  // the browser preview drafted ones; a deleted category drops out everywhere.
  // A category deleted in an earlier sitting stays out of the list (and the
  // classifier) until it is restored; one deleted now shows as a strip.
  const savedDeleted = (category: ActivityCategory) => Boolean(categoryCustomizations[category]?.deletedAt)
    && !restoredKeys.includes(definitionKey({ group: "category", key: category }));
  const isDeleted = (target: DefinitionSelection) => deletedKeys.includes(definitionKey(target))
    || (target.group === "category" && savedDeleted(target.key));
  const liveCategories = editorCategories.filter((category) => !isDeleted({ group: "category", key: category }));
  const isBuiltInLane = (lane: string): lane is ProductivityLabel => (LISTED_PRODUCTIVITY as readonly string[]).includes(lane);
  const laneName = (lane: string) => (isBuiltInLane(lane)
    ? definitionName({ group: "productivity", key: lane })
    : levelName(lane as CustomProductivityLevel));
  // A lane is a built-in productivity or a live added level; a deleted level is none.
  const liveLane = (lane: string | null | undefined): string | null => {
    if (!lane) return null;
    if (isBuiltInLane(lane)) return lane;
    return liveLevels.includes(lane as CustomProductivityLevel) ? lane : null;
  };
  // The level a category is fixed to, if any.
  const pinnedLane = (category: ActivityCategory): string | null => {
    const pinned = currentDefinition({ group: "category", key: category }).productivity;
    return pinned === "default" ? null : liveLane(pinned);
  };
  // Where each category counts: the level it is fixed to, or else where
  // Drifty usually puts it (nowhere once that level is deleted).
  const laneOf = (category: ActivityCategory): string | null => {
    if (category === "unknown") return null;
    return pinnedLane(category) ?? liveLane(LEGEND_LANE[category]);
  };
  const pinTo = (category: ActivityCategory, lane: string) => {
    updateDefinition({ group: "category", key: category }, { productivity: lane as ProductivityChoice });
  };
  const unpin = (category: ActivityCategory) => {
    if (currentDefinition({ group: "category", key: category }).productivity !== "default") updateDefinition({ group: "category", key: category }, { productivity: "default" });
  };

  const stopEditing = () => {
    setEditing(false);
    setEditingLevel(null);
    setAssignOpen(null);
  };

  // Folding the open card leaves focus on that card when the keyboard did it.
  const foldCard = ({ restoreFocus = false }: { readonly restoreFocus?: boolean } = {}) => {
    const id = editingLevel !== null ? levelCardId(editingLevel) : selectionId(selection);
    stopEditing();
    if (!restoreFocus) return;
    window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLButtonElement>("[data-card='" + id + "'] .category-editor__card-button")?.focus();
    });
  };
  // Escape folds an open card first; the next press closes the sheet.
  useModalDismiss(editing ? () => foldCard({ restoreFocus: true }) : onClose, { disabled: locked || pendingDelete !== null || assignOpen !== null });
  // The primary button answers ⌘/Ctrl+Enter (and Enter in a name, since
  // descriptions are multi-line): Save once something changed, Done before.
  useModalSubmitShortcut(dialogRef, "modEnter", () => (dirty ? void save() : onClose()), { disabled: locked || pendingDelete !== null });

  // A press on the list's empty space (not on a card) folds the open card. A
  // press that began inside a card and was released here, as when selecting
  // text, does not.
  const isDeckEmptySpace = (event: { readonly target: EventTarget; readonly currentTarget: EventTarget }) => event.target === event.currentTarget
    || (event.target instanceof HTMLElement && event.target.classList.contains("category-editor__cards"));

  const startEditing = (target: EditorSelection) => {
    setSelection(target);
    setEditingLevel(null);
    setAssignOpen(null);
    setEditing(true);
  };


  const categoryTag = (category: ActivityCategory, { auto = false, onRemove }: { readonly auto?: boolean; readonly onRemove?: () => void } = {}) => {
    const name = definitionName({ group: "category", key: category });
    return (
      <span
        key={category}
        className={"category-editor__tag" + (auto ? " is-auto" : "")}
        style={toneStyle(currentDefinition({ group: "category", key: category }).color)}
        title={auto ? t("categoryEditor.autoTag") : undefined}
      >
        <span className="category-editor__tag-dot" aria-hidden="true" />
        {name}
        {onRemove ? (
          <button type="button" className="category-editor__tag-remove" aria-label={t("categoryEditor.unpin", { name })} onClick={onRemove}>×</button>
        ) : null}
      </span>
    );
  };

  // A productivity label's categories, the one place a category's
  // productivity is set: the ones fixed to it can be taken out, and any
  // other category can be fixed to it, including one Drifty already counts
  // here per activity (an outline tag).
  const laneField = (lane: string) => {
    const members = liveCategories.filter((category) => laneOf(category) === lane);
    const others = liveCategories.filter((category) => pinnedLane(category) !== lane);
    return (
      <div className="project-editor-field category-editor__lane-field">
        <span className="label-mono">{t("categoryEditor.laneCategories")}</span>
        <div className="category-editor__tags">
          {members.map((category) => {
            const pinned = pinnedLane(category) === lane;
            return categoryTag(category, { auto: !pinned, onRemove: pinned ? () => unpin(category) : undefined });
          })}
          <button
            type="button"
            className="category-editor__tag category-editor__tag--add"
            aria-expanded={assignOpen === lane}
            aria-controls={"category-editor-assign-" + lane}
            disabled={others.length === 0}
            onClick={() => setAssignOpen((open) => (open === lane ? null : lane))}
          >
            <PlusIcon />
            {t("categoryEditor.addCategory")}
          </button>
        </div>
        {assignOpen === lane ? (
          <div
            id={"category-editor-assign-" + lane}
            className="category-editor__assign-list"
            role="menu"
            aria-label={t("categoryEditor.addCategory")}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              setAssignOpen(null);
            }}
          >
            {others.map((category) => {
              const current = laneOf(category);
              const from = current === lane
                ? t("settings.categories.productivityAuto")
                : current ? t("categoryEditor.movesFrom", { label: laneName(current) }) : null;
              return (
                <button
                  key={category}
                  type="button"
                  role="menuitem"
                  className="category-editor__assign-item"
                  style={toneStyle(currentDefinition({ group: "category", key: category }).color)}
                  onClick={() => {
                    pinTo(category, lane);
                    setAssignOpen(null);
                  }}
                >
                  <span className="category-editor__swatch category-editor__swatch--sm" aria-hidden="true" />
                  <span>{definitionName({ group: "category", key: category })}</span>
                  {from ? <span className="category-editor__assign-from">{from}</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  // Dayflow's card: the name, a description the user wrote (Drifty's own
  // shows only in the open card), and a pencil; pressing it turns the card
  // into its form in place. A card with a description line is one the user
  // has given their own criteria.
  const cardButton = ({ id, color, name, nameIsPlaceholder = false, detail, extra, drafted, muted = false, disabled = false, onOpen }: {
    readonly id: string;
    readonly color: string;
    readonly name: string;
    /** A new item without a name yet shows a stand-in name, in gray. */
    readonly nameIsPlaceholder?: boolean;
    readonly detail?: string;
    readonly extra?: ReactNode;
    readonly drafted: boolean;
    readonly muted?: boolean;
    /** A card that cannot be opened (projects while Intelligence locks them). */
    readonly disabled?: boolean;
    readonly onOpen: () => void;
  }) => (
    <li key={id} className={"category-editor__card" + (muted ? " is-muted" : "")} style={toneStyle(color)} data-card={id}>
      <button type="button" className="category-editor__card-button" disabled={disabled} onClick={onOpen}>
        <span className="category-editor__swatch" aria-hidden="true" />
        <span className="category-editor__card-text">
          <span className={"category-editor__card-name" + (nameIsPlaceholder ? " is-placeholder" : "")}>
            {name}
            {drafted ? <span className="category-editor__chip-drafted" title={t("categoryEditor.unsaved")}><span className="sr-only">{t("categoryEditor.unsaved")}</span></span> : null}
          </span>
          {detail ? <span className="category-editor__card-detail">{detail}</span> : null}
          {extra}
        </span>
        <span className="pencil-plate pencil-plate--sm category-editor__card-pencil" aria-hidden="true"><PencilGlyph /></span>
      </button>
    </li>
  );

  // The open card keeps the closed card's grid: the color dot in its own
  // column, and everything else (name, fields, actions) on the name's edge.
  // A new item's name field shows an example, so it is marked to keep that
  // example gray.
  const editingCard = (id: string, color: string | undefined, label: string, content: ReactNode, { isNew = false }: { readonly isNew?: boolean } = {}) => (
    <li key={id} className={"category-editor__card is-editing" + (isNew ? " is-new" : "")} style={color ? toneStyle(color) : undefined} data-card={id}>
      <div className="category-editor__card-body" role="region" aria-label={label}>
        <fieldset className="category-editor__pane-fields" disabled={locked}>{content}</fieldset>
      </div>
    </li>
  );

  // In the browser preview a deleted item stays in place as a strip until
  // the sheet closes, so the deletion can be undone.
  const deletedCard = (target: DefinitionSelection) => (
    <li key={selectionId(target)} className="category-editor__card is-deleted" style={toneStyle(currentDefinition(target).color)} data-card={selectionId(target)}>
      <div className="category-editor__deleted">
        <span className="category-editor__swatch" aria-hidden="true" />
        <span className="category-editor__deleted-name">{definitionName(target)}</span>
        <span className="category-editor__deleted-note">
          {t("categoryEditor.deletePending")}
          {target.group === "category" && (ruleCountByCategory?.[target.key] ?? 0) > 0
            ? t("categoryEditor.deleteRulesOff", { count: ruleCountByCategory?.[target.key] ?? 0 })
            : null}
        </span>
        <QuietButton icon={<ResetIcon />} label={t("categoryEditor.undoDelete")} onClick={() => setDeletedKeys((previous) => previous.filter((key) => key !== definitionKey(target)))} />
      </div>
    </li>
  );

  const deleteDefinition = (target: DefinitionSelection) => {
    setDeletedKeys((previous) => [...previous, definitionKey(target)]);
    if (target.group === "category") unpin(target.key);
    stopEditing();
  };

  const definitionCard = (target: DefinitionSelection) => {
    const id = selectionId(target);
    const value = currentDefinition(target);
    if (deletedKeys.includes(definitionKey(target))) return deletedCard(target);
    if (editing && editingLevel === null && sameSelection(target, selection)) {
      return editingCard(id, value.color, definitionName(target), renderDefinitionPane(target), { isNew: target.group === "category" && isNewCategory(target.key) });
    }
    // A category's row is its name and description; where it counts lives on
    // the productivity tab's cards.
    const members = target.group === "productivity" ? liveCategories.filter((category) => laneOf(category) === target.key) : [];
    return cardButton({
      id,
      color: value.color,
      name: definitionName(target),
      nameIsPlaceholder: !value.name.trim() && !builtInName(target),
      detail: value.description.trim() && value.description.trim() !== builtInDefinition(target).trim() ? value.description.trim() : undefined,
      drafted: definitionKey(target) in definitionDrafts || restoredKeys.includes(definitionKey(target)) || (target.group === "category" && isNewCategory(target.key)),
      extra: members.length > 0 ? (
        <span className="category-editor__tags">
          {members.map((category) => categoryTag(category, { auto: pinnedLane(category) !== target.key }))}
        </span>
      ) : null,
      onOpen: () => startEditing(target),
    });
  };

  const projectCard = (key: string, muted = false) => {
    const value = currentProject(key);
    if (!value) return null;
    const target: EditorSelection = { group: "project", key };
    const id = selectionId(target);
    const unnamed = !value.name.trim();
    if (editing && editingLevel === null && sameSelection(target, selection)) {
      return editingCard(id, normalizeProjectColor(value.color), value.name.trim() || t("categoryEditor.untitledProject"), renderProjectPane(key), { isNew: newProjectKeys.includes(key) });
    }
    return cardButton({
      id,
      color: normalizeProjectColor(value.color),
      name: value.name.trim() || t("categoryEditor.untitledProject"),
      nameIsPlaceholder: unnamed,
      detail: value.description.trim() || undefined,
      drafted: key in projectDrafts,
      muted,
      disabled: projectsLocked(),
      onOpen: () => startEditing(target),
    });
  };

  // A new category opens as its card in edit, with an id it keeps; it is
  // saved with the sheet's Save, once it has a name.
  const addCategory = () => {
    const id = newCustomCategoryId();
    const taken = liveCategories.map((category) => currentDefinition({ group: "category", key: category }).color);
    setAddedCategories((previous) => [...previous, { id, color: firstUnusedProjectColor(taken) }]);
    setSelection({ group: "category", key: id });
    setAssignOpen(null);
    setEditingLevel(null);
    setEditing(true);
  };
  const discardNewCategory = (category: ActivityCategory) => {
    const key = definitionKey({ group: "category", key: category });
    setAddedCategories((previous) => previous.filter((entry) => entry.id !== category));
    setDefinitionDrafts((previous) => {
      const copy = { ...previous };
      delete copy[key];
      return copy;
    });
    setCategoryErrors((previous) => {
      const copy = { ...previous };
      delete copy[category];
      return copy;
    });
    stopEditing();
    setSelection({ group: "category", key: LISTED_CATEGORIES[0] });
  };

  // ── Added productivity levels ──────────────────────────────────────────
  // A level is a name and a color; the categories fixed to it (from its
  // card's tags) count as neutral in every score and show under the level in
  // the app's charts. It has no description: the classifier picks only
  // focus, neutral, or drift.
  const updateLevel = (id: CustomProductivityLevel, patch: Partial<LevelValue>) => {
    const isNew = newLevels.includes(id);
    setLevelDrafts((previous) => {
      const next = { ...(previous[id] ?? savedLevelValue(id)), ...patch };
      const copy = { ...previous };
      const saved = savedLevelValue(id);
      if (!isNew && next.name === saved.name && normalizeHex(next.color) === normalizeHex(saved.color)) delete copy[id];
      else copy[id] = next;
      return copy;
    });
    if (patch.name !== undefined && levelErrors[id]) {
      setLevelErrors((previous) => {
        const copy = { ...previous };
        delete copy[id];
        return copy;
      });
    }
  };
  const addLevel = () => {
    const id = newProductivityLevelId();
    const taken = [...LISTED_PRODUCTIVITY.map((label) => currentDefinition({ group: "productivity", key: label }).color), ...liveLevels.map((level) => levelValue(level).color)];
    setNewLevels((previous) => [...previous, id]);
    setLevelDrafts((previous) => ({ ...previous, [id]: { name: "", color: firstUnusedProjectColor(taken) } }));
    setSelection({ group: "productivity", key: LISTED_PRODUCTIVITY[0] });
    setAssignOpen(null);
    setEditingLevel(id);
    setEditing(true);
  };
  const openLevel = (id: CustomProductivityLevel) => {
    setAssignOpen(null);
    setEditingLevel(id);
    setEditing(true);
  };
  // Deleting a level lets its categories go back to Drifty's judgment; a
  // level added in this sitting is simply dropped.
  const deleteLevel = (id: CustomProductivityLevel) => {
    if (newLevels.includes(id)) {
      setNewLevels((previous) => previous.filter((level) => level !== id));
      setLevelDrafts((previous) => {
        const copy = { ...previous };
        delete copy[id];
        return copy;
      });
    } else {
      setDeletedLevels((previous) => [...previous, id]);
    }
    setLevelErrors((previous) => {
      const copy = { ...previous };
      delete copy[id];
      return copy;
    });
    stopEditing();
  };
  const levelSiblings = (except: string) => {
    const siblings = new Map<string, string>();
    for (const label of LISTED_PRODUCTIVITY) {
      if (label !== except) siblings.set(normalizeHex(currentDefinition({ group: "productivity", key: label }).color), definitionName({ group: "productivity", key: label }));
    }
    for (const level of liveLevels) {
      if (level !== except) siblings.set(normalizeHex(levelValue(level).color), levelName(level));
    }
    return siblings;
  };
  const levelCard = (id: CustomProductivityLevel) => {
    const cardId = levelCardId(id);
    const value = levelValue(id);
    const isNew = newLevels.includes(id);
    if (deletedLevels.includes(id)) {
      return (
        <li key={cardId} className="category-editor__card is-deleted" style={toneStyle(value.color)} data-card={cardId}>
          <div className="category-editor__deleted">
            <span className="category-editor__swatch" aria-hidden="true" />
            <span className="category-editor__deleted-name">{levelName(id)}</span>
            <span className="category-editor__deleted-note">{t("categoryEditor.levelDeletePending")}</span>
            <QuietButton icon={<ResetIcon />} label={t("categoryEditor.undoDelete")} onClick={() => setDeletedLevels((previous) => previous.filter((level) => level !== id))} />
          </div>
        </li>
      );
    }
    if (editing && editingLevel === id) {
      const error = levelErrors[id];
      return editingCard(cardId, value.color, levelName(id), (
        <div className="project-editor-fields category-editor__fields">
          <DefinitionIdentityField
            nameId={"category-editor-level-" + id + "-name"}
            name={value.name}
            placeholder={t("categoryEditor.newProductivityNamePlaceholder")}
            maxLength={CATEGORY_CUSTOM_NAME_MAX_LENGTH}
            color={value.color}
            swatches={balancedIdentitySwatches(t, levelSiblings(id))}
            customColorLabel={t("settings.appearance.customColorAria", { label: levelName(id), type: "category" })}
            t={t}
            onNameChange={(next) => updateLevel(id, { name: next })}
            onColorChange={(next) => updateLevel(id, { color: next })}
          />
          {laneField(id)}
          {error ? <p className="category-editor__error" role="alert">{error}</p> : null}
          <div className="category-editor__pane-foot">
            {isNew
              ? <QuietButton icon={<TrashIcon />} label={t("categoryEditor.discardNewProject")} disabled={locked} onClick={() => deleteLevel(id)} />
              : <QuietButton icon={<TrashIcon />} label={t("categoryEditor.delete")} danger disabled={locked} onClick={() => deleteLevel(id)} />}
          </div>
        </div>
      ), { isNew });
    }
    const members = liveCategories.filter((category) => laneOf(category) === id);
    return cardButton({
      id: cardId,
      color: value.color,
      name: levelName(id),
      nameIsPlaceholder: !value.name.trim(),
      drafted: id in levelDrafts,
      extra: members.length > 0 ? (
        <span className="category-editor__tags">{members.map((category) => categoryTag(category))}</span>
      ) : null,
      onOpen: () => openLevel(id),
    });
  };

  const renderDefinitionPane = (target: DefinitionSelection) => {
    const value = currentDefinition(target);
    const defaultName = builtInName(target);
    const name = value.name.trim();
    // Restore acts on the whole item (name, color, description and, for a
    // category, its fixed productivity), so it sits on the item's title row.
    // That row is always there, so the card keeps its height when it appears.
    const builtInValue = defaultDefinitionValue(target, builtInDefinition(target));
    // An added category has no built-in form to go back to.
    const added = target.group === "category" && isAddedCategory(target.key);
    const restorable = !added && !sameDefinition(value, builtInValue);
    const nameId = "category-editor-" + target.group + "-" + target.key + "-name";
    const siblings = new Map<string, string>();
    const error = target.group === "category" ? categoryErrors[target.key] : undefined;
    if (target.group === "category") {
      for (const other of liveCategories) {
        if (other !== target.key) siblings.set(normalizeHex(currentDefinition({ group: "category", key: other }).color), definitionName({ group: "category", key: other }));
      }
    } else {
      for (const [color, label] of levelSiblings(target.key)) siblings.set(color, label);
    }
    return (
      <>
        <div className="project-editor-fields category-editor__fields">
          <DefinitionIdentityField
            nameId={nameId}
            name={value.name}
            placeholder={added ? defaultName || t("categoryEditor.newCategoryNamePlaceholder") : defaultName}
            maxLength={CATEGORY_CUSTOM_NAME_MAX_LENGTH}
            color={value.color}
            swatches={balancedIdentitySwatches(t, siblings)}
            customColorLabel={t("settings.appearance.customColorAria", { label: name || defaultName, type: "category" })}
            trailing={restorable ? (
              <QuietButton icon={<ResetIcon />} label={t("categoryEditor.restoreDefault")} disabled={locked} onClick={() => updateDefinition(target, builtInValue)} />
            ) : null}
            t={t}
            onNameChange={(next) => updateDefinition(target, { name: next })}
            onColorChange={(next) => updateDefinition(target, { color: next })}
          />
          <DefinitionDescriptionField
            label={t("settings.categories.descriptionLabel")}
            value={value.description}
            placeholder={target.group === "category"
              ? t(added ? "categoryEditor.newCategoryDescriptionPlaceholder" : "settings.categories.descriptionPlaceholder")
              : t(PRODUCTIVITY_PLACEHOLDER_KEY[target.key])}
            maxLength={CATEGORY_DESCRIPTION_MAX_LENGTH}
            t={t}
            onChange={(next) => updateDefinition(target, { description: next })}
          />
          {target.group === "productivity" ? laneField(target.key) : null}
          {error ? <p className="category-editor__error" role="alert">{error}</p> : null}
          {/* A category added in this sitting is simply dropped; a saved one
              is deleted. The last category stays: activity always lands in one. */}
          {target.group === "category" && isNewCategory(target.key) ? (
            <div className="category-editor__pane-foot">
              <QuietButton icon={<TrashIcon />} label={t("categoryEditor.discardNewProject")} disabled={locked} onClick={() => discardNewCategory(target.key)} />
            </div>
          ) : target.group === "category" && liveCategories.length > 1 ? (
            <div className="category-editor__pane-foot">
              <QuietButton icon={<TrashIcon />} label={t("categoryEditor.delete")} danger disabled={locked} onClick={() => deleteDefinition(target)} />
            </div>
          ) : null}
        </div>
      </>
    );
  };

  const renderProjectPane = (key: string) => {
    const value = currentProject(key);
    if (!value) return null;
    const project = projectById.get(key) ?? null;
    const usedColors = new Set(activeProjects.filter((item) => item.id !== key).map((item) => item.color.trim().toLowerCase()));
    const error = projectErrors[key];
    return (
      <>
        <ProjectEditorFields
          idPrefix={"category-editor-project-" + key}
          name={value.name}
          description={value.description}
          color={value.color}
          usedColors={usedColors}
          onNameChange={(next) => updateProject(key, { name: next })}
          onDescriptionChange={(next) => updateProject(key, { description: next })}
          onColorChange={(next) => updateProject(key, { color: next })}
        />
        {error ? (
          <p className="category-editor__error" role="alert" title={error.detail ?? undefined}>
            {error.message}
            {error.detail ? <span className="sr-only"> {error.detail}</span> : null}
          </p>
        ) : null}
        <div className="category-editor__pane-foot">
          {project ? (
            <>
              <QuietButton
                icon={project.status === "active" ? <ArchiveIcon /> : <UnarchiveIcon />}
                label={project.status === "active" ? t("projects.archive") : t("projects.unarchive")}
                disabled={locked || projectsBusy}
                onClick={() => void setProjectStatus(project, project.status === "active" ? "archived" : "active")}
              />
              <QuietButton
                icon={<TrashIcon />}
                label={t("projects.deleteConfirm.delete")}
                danger
                disabled={locked || projectsBusy}
                onClick={() => {
                  setDeleteError(null);
                  setPendingDelete(project);
                }}
              />
            </>
          ) : (
            <QuietButton icon={<TrashIcon />} label={t("categoryEditor.discardNewProject")} disabled={locked} onClick={() => discardProjectDraft(key)} />
          )}
        </div>
      </>
    );
  };


  const initialFocus = opening.newKeys.length > 0
    ? "#category-editor-project-" + opening.newKeys[0] + "-name"
    : editing
      ? ".category-editor__card.is-editing input:not([disabled]), .category-editor__card.is-editing textarea"
      : "[role='tab'][aria-selected='true']";

  // ── Intelligence (the project model) not connected ──────────────────────
  const intelligenceOff = onOpenIntelligence !== undefined && intelligenceUnavailable;
  // Closing drops drafts, so leaving for setup saves them first.
  const leaveFor = async (next: (() => void) | undefined) => {
    if (dirty) {
      if (!(await save({ dropUntouchedNew: true }))) return;
    } else {
      onClose();
    }
    next?.();
  };
  const openIntelligence = () => leaveFor(onOpenIntelligence);
  // The provider lock screen: Drifty Cloud signs in, starts the trial here, or
  // shows plans; a ready key connects here; any other model opens its card in
  // Settings › Intelligence.
  const pickProvider = (provider: IntelligenceProviderChoice): void | Promise<void> => {
    if (provider === "cloud") {
      if (cloudOffer === "trial" && onStartTrial) return onStartTrial();
      void leaveFor(onStartCloud);
      return;
    }
    if (provider === "openrouter" && openRouterReady) {
      onConnectProvider?.(provider, true);
      return;
    }
    void leaveFor(() => onConnectProvider?.(provider, false));
  };
  function projectsLocked(): boolean {
    return intelligenceOff;
  }

  // ── Group tabs over the group's cards ──────────────────────────────────
  // Same order (productivity, categories, projects), names and segmented
  // control as the flow chart's color-by switch, the pencil beside which
  // opens this sheet.
  const activeGroup = selection.group;
  const groupOrder: EditorSelection["group"][] = ["productivity", "category", ...(showProjects ? ["project" as const] : [])];
  const groupLabel = (group: EditorSelection["group"]) => t(group === "productivity"
    ? "settings.productivity.title"
    : group === "category" ? "settings.categories.title" : "settings.projects.title");
  const selectGroup = (group: EditorSelection["group"]) => {
    stopEditing();
    if (group === "project") setSelection(firstProjectSelection());
    else if (group === "productivity") setSelection({ group: "productivity", key: LISTED_PRODUCTIVITY[0] });
    else setSelection({ group: "category", key: LISTED_CATEGORIES[0] });
  };
  const groupTabs = (
    <div className="seg category-editor__tabs" role="tablist" aria-label={t("categoryEditor.navAria")}>
      {groupOrder.map((group) => {
        const selected = group === activeGroup;
        return (
          <button key={group} type="button" role="tab" aria-selected={selected} className={selected ? "on" : undefined} onClick={() => selectGroup(group)}>
            {groupLabel(group)}
            {group === "project" && projectsLocked() ? <span className="category-editor__tab-lock"><LockIcon /></span> : null}
          </button>
        );
      })}
    </div>
  );

  const cards = activeGroup === "productivity"
    // Added levels follow neutral, where they count in every score.
    ? LISTED_PRODUCTIVITY.flatMap((key) => [
      definitionCard({ group: "productivity", key }),
      ...(key === "neutral" ? [...savedLevels, ...newLevels].map(levelCard) : []),
    ])
    : activeGroup === "category"
      ? editorCategories.filter((key) => !savedDeleted(key)).map((key) => definitionCard({ group: "category", key }))
      : [...activeProjects.map((project) => projectCard(project.id)), ...newProjectKeys.map((key) => projectCard(key))];
  const noProjectsYet = activeGroup === "project" && cards.length === 0 && archivedProjects.length === 0;
  // On a locked, empty tab the lock screen holds the way forward.
  const hideAddForLock = noProjectsYet && projectsLocked();
  const addButton = activeGroup === "project"
    ? hideAddForLock ? null : (
      <button type="button" className="modal-btn modal-btn--secondary category-editor__add" disabled={locked || projectsLocked()} onClick={addProjectDraft}>
        <PlusIcon />
        {t("projects.new")}
      </button>
    )
    : activeGroup === "category"
      ? (() => {
        const full = liveCategories.length >= MAX_CATEGORY_COUNT;
        return (
          <button
            type="button"
            className="modal-btn modal-btn--secondary category-editor__add"
            disabled={locked || full}
            title={full ? t("categoryEditor.categoryLimit", { count: MAX_CATEGORY_COUNT }) : undefined}
            onClick={addCategory}
          >
            <PlusIcon />
            {t("categoryEditor.newCategory")}
          </button>
        );
      })()
      : (() => {
        const full = liveLevels.length >= MAX_ADDED_PRODUCTIVITY_LEVELS;
        return (
          <button
            type="button"
            className="modal-btn modal-btn--secondary category-editor__add"
            disabled={locked || full}
            title={full ? t("categoryEditor.levelLimit", { count: LISTED_PRODUCTIVITY.length + MAX_ADDED_PRODUCTIVITY_LEVELS }) : undefined}
            onClick={addLevel}
          >
            <PlusIcon />
            {t("categoryEditor.newProductivity")}
          </button>
        );
      })();

  const deck = (
    <div className="category-editor__deck">
      <div
        className="category-editor__deck-scroll"
        onPointerDown={(event) => { deckPressOnEmpty.current = isDeckEmptySpace(event); }}
        onClick={(event) => {
          const pressedEmpty = deckPressOnEmpty.current;
          deckPressOnEmpty.current = false;
          if (editing && pressedEmpty && isDeckEmptySpace(event)) foldCard();
        }}
      >
        {activeGroup === "project" && !noProjectsYet && projectsLocked()
          ? <CategoryEditorLockBand disabled={locked} onOpen={() => void openIntelligence()} />
          : null}
        <ul className="category-editor__cards" aria-label={groupLabel(activeGroup)}>{cards}</ul>
        {noProjectsYet ? (
          projectsLocked() ? (
            <CategoryEditorLockScreen
              disabled={locked}
              cloudOffer={cloudOffer}
              openRouterReady={openRouterReady}
              onPick={pickProvider}
            />
          ) : (
            <div className="category-editor__empty">
              <p>{t("categoryEditor.noProjects")}</p>
            </div>
          )
        ) : null}
        {activeGroup === "category" && [...LISTED_CATEGORIES, ...savedAddedCategories].some(savedDeleted) ? (
          <>
            <span className="category-editor__section-label">{t("categoryEditor.deletedCategories")}</span>
            <ul className="category-editor__cards" aria-label={t("categoryEditor.deletedCategories")}>
              {[...LISTED_CATEGORIES, ...savedAddedCategories].filter(savedDeleted).map((category) => {
                const target: DefinitionSelection = { group: "category", key: category };
                return (
                  <li key={selectionId(target)} className="category-editor__card is-deleted" style={toneStyle(currentDefinition(target).color)} data-card={selectionId(target)}>
                    <div className="category-editor__deleted">
                      <span className="category-editor__swatch" aria-hidden="true" />
                      <span className="category-editor__deleted-name">{definitionName(target)}</span>
                      <QuietButton icon={<ResetIcon />} label={t("categoryEditor.restoreDeleted")} disabled={locked} onClick={() => setRestoredKeys((previous) => [...previous, definitionKey(target)])} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        {activeGroup === "project" && archivedProjects.length > 0 ? (
          <>
            <span className="category-editor__section-label">{t("settings.projects.archived")}</span>
            <ul className="category-editor__cards" aria-label={t("settings.projects.archived")}>{archivedProjects.map((project) => projectCard(project.id, true))}</ul>
          </>
        ) : null}
      </div>
    </div>
  );


  return (
    <div className="auth-modal__overlay category-editor__overlay" {...overlayDismiss}>
      <section
        ref={dialogRef}
        className="auth-modal modal-shell category-editor"
        data-modal-variant="workspace"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={locked}
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label={t("categoryEditor.close")} onClick={onClose} disabled={locked} />
        <div className="category-editor__layout" data-modal-initial-selector={initialFocus}>
          <div className="modal-head category-editor__head">
            <div className="modal-head__copy">
              <h2 id={titleId}>{t("categoryEditor.title")}</h2>
            </div>
          </div>
          <div className="category-editor__tabs-row">
            {groupTabs}
          </div>
          {deck}
          {/* One footer row under the cards: the group's "+ New …" leads it,
              and a note about saving sits beside the buttons it describes
              (the shared modal footer's layout). */}
          {definitionError ? <p className="category-editor__error" role="alert" title={definitionError.detail ?? undefined}>{definitionError.message}</p> : null}
          <div className="modal-foot category-editor__foot">
            <div className="modal-foot__start">{addButton}</div>
            {dirty ? (
              <>
                {/* Escape folds an open card first, so its chip shows only when it closes the sheet. */}
                <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose} disabled={locked}>{t("common.cancel")}{editing ? null : <KeyHint shortcut="escape" />}</button>
                <button type="button" className="modal-btn modal-btn--primary" onClick={() => void save()} disabled={locked} aria-busy={saving}>
                  {/* Saving here is quick: a spinner over the label, so the button keeps Done's width. */}
                  <ActionLabel busy={saving}>{t("common.save")}</ActionLabel>
                  <KeyHint shortcut="modEnter" />
                </button>
              </>
            ) : (
              <button type="button" className="modal-btn modal-btn--primary" onClick={onClose} disabled={locked}>{t("categoryEditor.done")}<KeyHint shortcut="modEnter" /></button>
            )}
          </div>
        </div>
      </section>
      <ModalPresence>
        {pendingDelete ? (
          <ProjectDeleteConfirmation
            project={pendingDelete}
            matchedTime={(projectRecentSeconds?.get(pendingDelete.id) ?? 0) > 0
              ? formatLocalizedCompactDurationFromSeconds(projectRecentSeconds!.get(pendingDelete.id)!, effectiveLanguage)
              : null}
            matchedWindow={t("projects.latestDays", { count: PROJECT_LIBRARY_WINDOW_DAYS })}
            deleting={deleting}
            error={deleteError}
            onCancel={() => {
              if (deleting) return;
              setPendingDelete(null);
              setDeleteError(null);
            }}
            onArchive={pendingDelete.status === "active" ? () => {
              const target = pendingDelete;
              setPendingDelete(null);
              void setProjectStatus(target, "archived");
            } : undefined}
            onConfirm={() => void confirmDelete()}
          />
        ) : null}
      </ModalPresence>
    </div>
  );
}

function QuietButton({ icon, label, danger = false, disabled, onClick }: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
}) {
  return (
    <button type="button" className={"category-editor__quiet" + (danger ? " is-danger" : "")} disabled={disabled} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

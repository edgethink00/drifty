import type { Project } from "@drifty/domain";

/** Rows on one page of the project table. */
export const PROJECT_LIBRARY_PAGE_SIZE = 15;

export type ProjectLibrarySortKey = "name" | "last" | "time";

export interface ProjectLibrarySort {
  readonly key: ProjectLibrarySortKey;
  readonly direction: "asc" | "desc";
}

/** What the project table shows: the search, an optional column sort, and the page. */
export interface ProjectLibraryView {
  readonly query: string;
  /** Null keeps the user's own project order. */
  readonly sort: ProjectLibrarySort | null;
  readonly page: number;
}

export const DEFAULT_PROJECT_LIBRARY_VIEW: ProjectLibraryView = { query: "", sort: null, page: 0 };

// A column's first press puts the useful end first: names A→Z, the latest activity and the most time on top.
const FIRST_DIRECTION: Record<ProjectLibrarySortKey, ProjectLibrarySort["direction"]> = { name: "asc", last: "desc", time: "desc" };

/** A column title cycles its first direction, the reverse, then back to the user's order. */
export function nextProjectLibrarySort(current: ProjectLibrarySort | null, key: ProjectLibrarySortKey): ProjectLibrarySort | null {
  if (!current || current.key !== key) return { key, direction: FIRST_DIRECTION[key] };
  if (current.direction === FIRST_DIRECTION[key]) return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  return null;
}

export function matchesProjectQuery(project: Project, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  return !trimmed || project.name.toLowerCase().includes(trimmed);
}

export interface ProjectLibraryValues {
  readonly totalSecondsByProject: ReadonlyMap<string, number>;
  readonly lastActivityByProject: ReadonlyMap<string, string>;
  readonly locale?: string;
}

/** Sorts a copy by the chosen column; ties and an unsorted view keep the given (user) order. */
export function sortProjectLibrary(projects: readonly Project[], sort: ProjectLibrarySort | null, values: ProjectLibraryValues): Project[] {
  if (!sort) return [...projects];
  const sign = sort.direction === "asc" ? 1 : -1;
  const collator = new Intl.Collator(values.locale, { sensitivity: "base", numeric: true });
  return projects
    .map((project, index) => ({ project, index }))
    .sort((left, right) => {
      const order = sort.key === "name"
        ? collator.compare(left.project.name, right.project.name)
        : sort.key === "last"
          ? (values.lastActivityByProject.get(left.project.id) ?? "").localeCompare(values.lastActivityByProject.get(right.project.id) ?? "")
          : (values.totalSecondsByProject.get(left.project.id) ?? 0) - (values.totalSecondsByProject.get(right.project.id) ?? 0);
      return order * sign || left.index - right.index;
    })
    .map(({ project }) => project);
}

/**
 * The projects a table section lists, in the order it lists them: the active
 * (or archived) ones that match the search, sorted by the chosen column. The
 * table and the detail's previous/next buttons both read this order.
 */
export function projectLibraryOrder(
  projects: readonly Project[],
  section: "active" | "archived",
  view: Pick<ProjectLibraryView, "query" | "sort">,
  values: ProjectLibraryValues,
): Project[] {
  const inSection = projects.filter((project) => (project.status === "archived") === (section === "archived") && matchesProjectQuery(project, view.query));
  return sortProjectLibrary(inSection, view.sort, values);
}

export interface ProjectLibraryPage<T> {
  readonly items: readonly T[];
  /** The page actually shown, clamped to the pages that exist. */
  readonly page: number;
  readonly pageCount: number;
  /** One-based positions of the first and last row shown; zero when the list is empty. */
  readonly first: number;
  readonly last: number;
  readonly total: number;
}

export function pageOfProjectLibrary<T>(items: readonly T[], page: number, size = PROJECT_LIBRARY_PAGE_SIZE): ProjectLibraryPage<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const shown = Math.min(Math.max(0, Math.floor(page)), pageCount - 1);
  const start = shown * size;
  const slice = items.slice(start, start + size);
  return {
    items: slice,
    page: shown,
    pageCount,
    first: slice.length > 0 ? start + 1 : 0,
    last: start + slice.length,
    total: items.length,
  };
}

/** The page that holds a row, so returning from a project's detail lands where it is. */
export function projectLibraryPageOf(index: number, size = PROJECT_LIBRARY_PAGE_SIZE): number {
  return index < 0 ? 0 : Math.floor(index / size);
}

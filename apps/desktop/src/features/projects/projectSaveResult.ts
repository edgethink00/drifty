/** Resolves true when the project was persisted; an editor stays open on failure. */
export type ProjectSaveResult = boolean | { readonly saved: false; readonly error: string; readonly detail?: string | null };

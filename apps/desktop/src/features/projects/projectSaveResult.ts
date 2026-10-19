/** A new project returns its permanent id for display order; failure keeps the editor open. */
export type ProjectSaveFailure = { readonly saved: false; readonly error: string; readonly detail?: string | null };
export type ProjectSaveResult = boolean | { readonly saved: true; readonly id: string } | ProjectSaveFailure;

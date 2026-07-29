export const BOOT_SHELL_PREVIEW_DURATION_MS = 3_000;

let previewTimeoutId: number | null = null;

export function hideBootShell(): void {
  if (previewTimeoutId !== null) {
    window.clearTimeout(previewTimeoutId);
    previewTimeoutId = null;
  }

  delete document.documentElement.dataset.bootActive;

  const shell = document.getElementById("boot-shell");
  if (!shell) return;

  shell.hidden = true;
  shell.setAttribute("aria-hidden", "true");
  delete shell.dataset.bootPreview;
}

export function showBootShellPreview(): boolean {
  const shell = document.getElementById("boot-shell");
  const status = document.getElementById("boot-status");
  if (!shell || !status) return false;

  if (previewTimeoutId !== null) window.clearTimeout(previewTimeoutId);

  status.textContent = "drifty loading…";
  document.documentElement.dataset.bootActive = "true";
  shell.hidden = false;
  shell.removeAttribute("aria-hidden");
  shell.dataset.bootPreview = "true";

  previewTimeoutId = window.setTimeout(() => {
    previewTimeoutId = null;
    hideBootShell();
  }, BOOT_SHELL_PREVIEW_DURATION_MS);

  return true;
}

export const BOOT_SHELL_PREVIEW_DURATION_MS = 7_000;
export const BOOT_SHELL_PREVIEW_DURATION_SECONDS = BOOT_SHELL_PREVIEW_DURATION_MS / 1_000;

let previewTimeoutId: number | null = null;

export function shouldDeferBootShellForNativeMaterial(
  surface: string,
  platform: string | undefined,
): boolean {
  return surface === "app" && platform === "windows";
}

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
  shell.setAttribute("aria-busy", "false");
  delete shell.dataset.bootPreview;
}

export function showBootShellPreview(): boolean {
  const shell = document.getElementById("boot-shell");
  const status = document.getElementById("boot-status");
  const visibleStatus = document.getElementById("boot-status-visible");
  if (!shell || !status || !visibleStatus) return false;

  if (previewTimeoutId !== null) window.clearTimeout(previewTimeoutId);

  status.textContent = "Loading Drifty…";
  visibleStatus.textContent = "drifty loading…";
  visibleStatus.style.animation = "none";
  void visibleStatus.offsetWidth;
  visibleStatus.style.removeProperty("animation");
  document.documentElement.dataset.bootActive = "true";
  shell.hidden = false;
  shell.removeAttribute("aria-hidden");
  shell.setAttribute("aria-busy", "true");
  shell.dataset.bootPreview = "true";

  previewTimeoutId = window.setTimeout(() => {
    previewTimeoutId = null;
    hideBootShell();
  }, BOOT_SHELL_PREVIEW_DURATION_MS);

  return true;
}

/**
 * The CSV pieces of the team export in Settings: hours as decimals a
 * spreadsheet can add, cells safe to open, a file name a desktop accepts.
 * The board's own CSV of its widgets is gone; export lives in Settings
 * (owner decision 2026-10-25).
 */
export type TeamBoardCsvValue = string | number | null;

/** Hours with two decimals, as spreadsheets add them. */
export function teamBoardCsvHours(seconds: number): number {
  return Math.round(seconds / 36) / 100;
}

/**
 * One cell. Text that a spreadsheet would read as a formula (a team or
 * project named "=…") is kept as text, and quotes, commas and line breaks
 * are quoted.
 */
export function teamBoardCsvCell(value: TeamBoardCsvValue): string {
  if (value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

/** A file name a desktop accepts: the scope and the dates. */
export function teamBoardCsvFileName(parts: readonly string[]): string {
  const name = parts.filter((part) => part.trim() !== "").join(" ").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return (name === "" ? "drifty-team" : name).slice(0, 120) + ".csv";
}

/** Hands the file to the browser or the app's web view, as the debug log export does. */
export function downloadTeamBoardCsv(fileName: string, text: string): void {
  // A byte-order mark lets spreadsheet apps read Korean and other non-Latin names.
  const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

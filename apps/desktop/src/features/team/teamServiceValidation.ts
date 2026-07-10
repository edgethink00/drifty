import type { ParseResult } from "./teamTypes";

export function requiredText(value: unknown, error: string, maxLength: number): ParseResult<string> {
  if (typeof value !== "string") return { ok: false, error };
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > maxLength) return { ok: false, error };
  return { ok: true, value: trimmed };
}

export function optionalText(value: string | null | undefined, fallback: string, maxLength: number): string {
  const trimmed = value?.trim() || fallback;
  return trimmed.slice(0, maxLength);
}

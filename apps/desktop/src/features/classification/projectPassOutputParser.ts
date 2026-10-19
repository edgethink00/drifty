import type { ProjectPassAssignment, ProjectPassCorrection, ProjectPassOutput } from "./aiProjectReviewService";

export function parseProjectPassOutput(content: string): ProjectPassOutput | null {
  for (let start = content.indexOf("{"); start !== -1;) {
    const end = findJsonObjectEnd(content, start);
    // An unfinished outer response must not turn an inner assignment into an
    // apparently successful empty project pass.
    if (end === null) return null;
    const output = parseProjectPassCandidate(content.slice(start, end + 1));
    if (output) return output;
    start = content.indexOf("{", end + 1);
  }
  return null;
}

function findJsonObjectEnd(content: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const char = content.charAt(index);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
      if (depth < 0) return null;
    }
  }
  return null;
}

function parseProjectPassCandidate(candidate: string): ProjectPassOutput | null {
  try {
    return normalizeProjectPassOutput(JSON.parse(candidate));
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function normalizeProjectPassOutput(value: unknown): ProjectPassOutput | null {
  if (!isRecord(value) || !Array.isArray(value.assignments) || !Array.isArray(value.corrections)) return null;
  return {
    assignments: value.assignments.filter(isProjectPassAssignment),
    corrections: value.corrections.filter(isProjectPassCorrection),
  };
}

function isProjectPassAssignment(value: unknown): value is ProjectPassAssignment {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    (typeof value.projectId === "string" || value.projectId === null) &&
    typeof value.confidence === "number" &&
    (value.reason === undefined || typeof value.reason === "string")
  );
}

function isProjectPassCorrection(value: unknown): value is ProjectPassCorrection {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    (typeof value.category === "string" || value.category === null) &&
    (typeof value.productivity === "string" || value.productivity === null) &&
    typeof value.confidence === "number" &&
    (value.reason === undefined || typeof value.reason === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

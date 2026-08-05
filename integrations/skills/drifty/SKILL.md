---
name: drifty
description: Query personal on-device activity captured by Drifty through the read-only drifty CLI. Use only when the user wants facts from their Drifty activity records, such as what they did or when, whether a named task or project was captured, or recorded focus, drift, apps, sites, and classifications for a period. Never use for Git commits or repository history even when a date is mentioned; also exclude code search, calendar scheduling, generic productivity advice, macOS help, and unrelated facts.
---

# Drifty

Use the local `drifty` command as the factual source. Keep all queries read-only and local.

## Choose the query

1. Resolve relative dates against the current local date and timezone. Convert them to explicit `YYYY-MM-DD` days or ISO 8601 ranges.
2. Start broad questions about a day or recorded focus/drift totals with:
   `drifty summary --day YYYY-MM-DD`
3. Start questions about a named task, project term, app, site, or classification with:
   `drifty search --query "TERM" --day YYYY-MM-DD`
   Use `--from ISO --to ISO` instead of `--day` for a period.
4. Start requests for chronological evidence with:
   `drifty timeline --day YYYY-MM-DD`
5. Do not run `drifty status` before a normal query. Run it only when availability is genuinely unknown after a failure.
6. Run the chosen query directly in the documented minimal form. Never run `--help` preemptively.

## Protect the history

- Keep the default `--detail safe`. It supplies app names, site domains, timing, and classification without full URLs or window titles.
- Use `--detail full` only when the user explicitly needs a full URL or exact window title and the extra exposure is necessary. Never request it speculatively.
- Do not access Drifty's SQLite database directly. Do not use network tools or any mutating command for this task.
- Do not reproduce more raw history than the answer needs.

## Read the evidence

- Treat `recordedSeconds`, `focusSeconds`, `driftSeconds`, `otherSeconds`, `matchedSeconds`, and item durations as recorded evidence, not estimates of the user's entire day.
- Treat `no_records`, `coverage_not_guaranteed`, an unclassified item, a missing CLI, or a database error as a material evidence limit.
- Never turn an empty result into proof that an activity did not occur. Never invent missing activities, totals, causes, intentions, or productivity advice.
- An interval between captured segments means only that no record was returned for that interval. Do not call it a recording gap, stopped recording, or inactivity unless Drifty explicitly reports that state.
- Follow `nextCursor` only when the first bounded page cannot answer the question. Avoid unnecessary pagination.

## Answer

- State the resolved day or range, especially for relative dates.
- Summarize the returned facts in the user's language. Convert seconds to readable durations when helpful, while preserving exactness.
- Mention material warnings and partial coverage briefly.
- If the command fails because its contract appears different, run `drifty --help` or `drifty <command> --help` once, adjust to the live contract, and retry once.
- If Drifty is missing or unreadable, explain that the records could not be checked. Do not claim that no records or activity exist.

# AGENTS.md

Notes for coding agents working in this repository. People should start with
[CONTRIBUTING.md](CONTRIBUTING.md); the same rules apply to them.

## Layout

- `apps/desktop`: React and Vite user interface
- `packages/domain`: shared activity models, time rules and AI prompt building
- `packages/charts`: chart components
- `src-tauri`: Tauri 2 shell, Rust commands and native macOS and Windows code
- `services/tracker-python`: activity capture and local storage
- `integrations/skills`: the read-only agent skill for Drifty records
- `browser-extension`: an archived experiment; the app does not use it

Drifty Cloud's server and the iPhone app are not in this repository.

## Commands

```bash
npm run dev:web       # interface only, at http://127.0.0.1:1420
npm run tauri:dev     # the desktop app (see "Build from source" in README.md)
npm run typecheck
npm run lint
npm test              # web, Python and Rust tests
```

Open the interface with `?driftyPreview=1` to see it with sample data and no
tracker.

## Rules

- Follow the privacy rules in CONTRIBUTING.md. Raw activity (apps, sites,
  window titles, sessions) stays on the computer unless a feature the person
  turned on needs it, and never reaches a team, leaderboard or public surface.
- Use made-up names, titles and hosts in tests and fixtures.
- A build from source runs without a Drifty account. Keep tracking, local
  history and the person's own AI connections working when signed out.
- Keep a change to one concern and add or update tests for the behavior you
  change. Do not commit build output, local databases, logs or credentials.

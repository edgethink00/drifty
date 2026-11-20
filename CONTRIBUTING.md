# Contributing to Drifty

The team and community develop the Drifty desktop app here. Open a pull
request against `main`. Maintainers review changes here and merge accepted
pull requests after the checks pass.

## Before you start

- For a bug, open an issue with your OS version, Drifty version and the steps
  that show it. Screenshots help; please blur anything personal.
- For a new feature or a large change, open an issue first so we can agree on
  the direction before you write code.
- Changes to Drifty Cloud (accounts, billing, cloud AI, sync, leaderboard)
  live in server code that is not in this repository. Describe them in an
  issue instead.

## Development

See "Build from source" in the [README](README.md). Before opening a pull
request, run:

```bash
npm run typecheck
npm run lint
npm test
```

Keep each pull request to one change, add or update tests for the behavior
you change, and describe what a person using Drifty will notice.

## Privacy rules for changes

Drifty records what people do on their computers, so a few rules are firm:

- Raw activity (apps, sites, window titles, sessions) stays on the computer
  unless a feature the person turned on needs it, and then only the minimum.
- Nothing from raw activity may reach a team, leaderboard or public surface.
- Test fixtures use made-up names, titles and hosts, never your own records.

## Contributor License Agreement

Before we can accept your first pull request, you sign the
[Contributor License Agreement](CLA.md) by commenting on the pull request as
the CLA bot asks. You keep the copyright to your contribution; the agreement
lets EdgeThink distribute it under the project license and under other
licenses, for example to an organization that cannot use AGPL software.

# Drifty

Drifty is a desktop time tracker for macOS and Windows that sorts your day for
you. It records which app, site and window you are in, then uses AI to group
that activity into categories, projects and focus, so you can see where your
time went without starting timers or tagging anything by hand.

[Download](https://drifty.so/download/) · [Docs](https://docs.drifty.so/) · [Changelog](https://drifty.so/changelog/) · [Privacy policy](https://drifty.so/privacy/)

## What it does

- Tracks the frontmost app, window titles and supported browser tabs, and
  notices when you step away. History is stored in SQLite on your computer.
- Classifies activity with the AI connection you choose: a local model Drifty
  downloads for you, a self-hosted endpoint, your own OpenAI, Anthropic or
  OpenRouter key, Codex CLI or Claude Code, or Drifty Cloud.
- Shows your day, week, projects and insights, and answers questions about
  your records in Chat.
- With an optional Drifty account: Drifty Cloud AI, sync across your own
  computers and iPhone, and an opt-in leaderboard.

## Privacy

Your activity history stays on your computer unless you use a feature that
needs it. AI classification sends minimized activity fields to the AI connection
you picked, device sync copies your records to your own account, and the
leaderboard publishes aggregate focus totals only. In the official app, the
Usage statistics setting in Settings › Privacy is on by default: it sends
product usage events and, while you are signed in, keeps minimized activity
records with your account to improve Drifty. Sharing your Chat conversations is
a separate setting that stays off unless you turn it on. The
[privacy policy](https://drifty.so/privacy/) lists every case.

## What is in this repository

| Path | Contents |
| --- | --- |
| `apps/desktop` | React and Vite user interface |
| `packages/domain` | Shared activity models, time rules and AI prompt building |
| `packages/charts` | Chart components |
| `src-tauri` | Tauri 2 shell, Rust commands and native macOS and Windows code |
| `services/tracker-python` | Activity capture and local storage |
| `browser-extension` | Archived Chrome extension experiment; the app does not use it |
| `integrations/skills` | Agent skill for reading Drifty records |

Drifty Cloud's server (accounts, billing, cloud AI, sync and leaderboard) and
the iPhone app are not part of this repository. The automatic memory beta
downloads a separate engine that is not published here either. A build from source runs
fully on your computer; signing in needs Drifty's hosted service.

## Build from source

The steps below are for macOS 13 or later. You need Node.js 24, Rust 1.90 or
later, Python 3 and the Xcode Command Line Tools. Tauri expects the bundled
tracker binaries when it compiles, so build them once before the first
`npm run tauri:dev`.

```bash
npm ci
python3 -m venv .venv
.venv/bin/pip install -r services/tracker-python/requirements-build.txt
DRIFTY_TRACKER_BUILD_PYTHON="$PWD/.venv/bin/python" npm run build:tracker-sidecar
npm run tauri:dev     # run the app
npm run dev:web       # interface only, in a browser at http://127.0.0.1:1420
```

Without Supabase settings the app runs signed out: tracking, local history
and your own AI connections all work.

Checks:

```bash
npm run typecheck
npm run lint
npm test              # web, Python and Rust tests
```

A source build uses the same app identifier as the official app, so quit the
official Drifty before running one. Windows source builds work but are not
documented here yet.

## Contributing

Bug reports from real setups are the most useful thing you can send. Pull
requests are welcome; please read [CONTRIBUTING.md](CONTRIBUTING.md) first.
Contributors sign the [Contributor License Agreement](CLA.md) once.

Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

Drifty's source is licensed under the [GNU Affero General Public License
v3.0 only](LICENSE). The Drifty name, logo and cat character are trademarks of
EdgeThink and are not covered by that license; see [TRADEMARKS.md](TRADEMARKS.md).

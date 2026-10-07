# App icons

Most files here are generated from `app-icon-source.svg` (the macOS white tile).

`icon.ico` is the exception. Windows does not put app icons in a shared tile, so the
Windows icon draws the same hourglass on a transparent canvas with a thin white halo for
dark surfaces. Regenerate it with:

```bash
node scripts/generate-windows-app-icon.mjs
```

Do not regenerate `icon.ico` with `tauri icon`; that restores the macOS tile.
`scripts/windows-app-icon.test.mjs` fails if that happens.


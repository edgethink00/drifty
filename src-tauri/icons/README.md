# App icons

Most files here are generated from `app-icon-source.svg` (the macOS white tile).

`icon.ico` is the exception. Windows does not put app icons in a shared tile, so
the Windows icon draws the same hourglass on a transparent canvas with a thin
white halo for dark surfaces. It is drawn separately; do not regenerate it with
`tauri icon`, which restores the macOS tile.

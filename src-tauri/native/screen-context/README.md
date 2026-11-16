# Screen context helper (macOS)

Mac release builds bundle a small helper at the app-resource path
`screen-context/helper`, built with `npm run build:screen-context-release` (macOS 14 or
later). It captures and reads the screen for Drifty's optional screen features.
Those features stay off until the person turns them on and grants Screen
Recording. Development builds and Windows builds omit the helper, and Drifty then
hides the features.

The Rust core in `src-tauri/crates/screen-context-core` starts the helper for one
request at a time. The helper never receives a process id, window handle, output
path, shell command or provider credential from its caller.

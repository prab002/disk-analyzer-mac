# Copilot instructions — Disk Analyzer

A native **macOS disk-usage visualizer**: scan a folder, render every file/folder
as a size-proportional **treemap**, and let the user reveal or Trash large items.

## Stack
- **Shell:** Tauri 2 (Rust) — `src-tauri/`
- **Frontend:** React 19 + Vite + TypeScript — `src/`
- **Treemap:** `d3-hierarchy`
- **Scanning:** `rayon` (parallel walk), `trash` crate (safe delete), `dirs`

## Project layout
- `src/App.tsx` — main UI, state, Tauri command calls, About/FDA banners
- `src/Treemap.tsx` — d3 treemap layout + cell rendering
- `src/lib/format.ts` — byte formatting + file-type → color map
- `src/lib/types.ts` — `FileNode` (mirrors the Rust `Node` struct)
- `src-tauri/src/lib.rs` — all Tauri commands and the filesystem walk

### Tauri commands (in `lib.rs`, registered in `run()`)
`scan_directory`, `delete_to_trash`, `reveal_in_finder`, `home_dir`,
`has_full_disk_access`, `open_full_disk_access_settings`.

## Build / check commands
```bash
pnpm install                 # deps (pnpm, lockfile v9)
pnpm tauri dev               # run app in dev
npx tsc --noEmit             # typecheck frontend (run after TS/TSX changes)
(cd src-tauri && cargo check)# typecheck Rust (run after .rs changes)
(cd src-tauri && cargo fmt && cargo clippy)
pnpm tauri build --target universal-apple-darwin   # release DMG (macOS only)
```
Always run `npx tsc --noEmit` and `cargo check` before considering a change done.

## Conventions & invariants (do not regress)
- **Bounded scan tree.** `build_tree` retains nodes only to `MAX_TREE_DEPTH` and
  prunes by `MIN_NODE_BYTES` / `MAX_CHILDREN`; deeper sizes are summed via
  `dir_totals` without allocating nodes. This keeps memory bounded on huge scans —
  never make the tree fully unbounded.
- **Off the UI thread.** Heavy commands (`scan_directory`, `delete_to_trash`) are
  `async` and wrapped in `tauri::async_runtime::spawn_blocking` so the WebView
  never freezes (no macOS beachball). Keep new heavy work off the main thread.
- **Permissions.** The app is ad-hoc signed (`bundle.macOS.signingIdentity: "-"`)
  so macOS persists the Full Disk Access grant. FDA is the one-time "all folders"
  permission path — don't reintroduce per-folder prompting.
- **Treemap coloring.** Leaf cells (files + un-expanded folders) get a solid fill;
  container folders stay faint. d3 `.sum` treats childless nodes as leaves.

## macOS notes
- App is **not notarized** (no paid Apple cert) → Gatekeeper blocks first launch.
  Documented unblock: `xattr -cr /Applications/disk-analyzer.app`.
- Releases are tag-driven (`v*`) via `.github/workflows/release.yml`.

## PR expectations
- Keep changes minimal and match surrounding style.
- Frontend-only changes hot-reload; Rust changes require a rebuild.
- Update `README.md` if user-facing behavior changes.

# Taboret Known Bugs & Status

## FIXED
- **CachyOS (Niri)** — Resizing the window doesn't update the grid. (Fixed via renderer resize event)
- **Vite/Tauri port mismatch** — Vite was on :8080, Tauri expected :5173. Both open (one browser, one native window). Fixed: Vite now always uses 5173, browser auto-open disabled.
- **Save dialog** — Defaulted to Downloads with a file-save dialog. Fixed: now uses a folder-picker dialog so users choose where the board folder lives. The Rust backend writes board.json + media/ inside the chosen folder.
- **Open dialog** — Was file-only (required selecting board.json by name). Fixed: now uses a folder-picker dialog so users pick the board folder directly. Any board folder contains a board.json automatically.
- **Phantom image after delete** — Container not removed from canvas before destroy. Fixed in removeItem (proper guard + clearSelection before destroy).
- **Web drop URL fallback** — Pinterest CDN URLs could fail with a single attempt. Fixed: extracts all candidate URLs (CDN → page URL fallback) and tries each in sequence.

## ACTIVE
- **Pinterest drag-and-drop** — Pinterest CDN image URLs sometimes return 403 (hotlink protection). The fallback to the pin page URL (og:image extraction) is the reliable path but slower. If Pinterest sets aggressive auth requirements, even the page approach may fail in some regions.
- **Board naming** — All boards are saved as `board.json` inside their folder. The folder name IS the board name. Opening a board opens a folder; the folder name appears in the board name field. This is intentional (folder = board package), but users unfamiliar with this model may be confused.

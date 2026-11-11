# Taboret Known Bugs & Status

## FIXED
- **CachyOS (Niri)** — Resizing the window doesn't update the grid. (Fixed via renderer resize event)
- **Vite/Tauri port mismatch** — Vite was on :8080, Tauri expected :5173. Both open (one browser, one native window). Fixed: Vite now always uses 5173, browser auto-open disabled.
- **Save dialog** — Defaulted to Downloads with a file-save dialog. Fixed: now uses a folder-picker dialog so users choose where the board folder lives. The Rust backend writes board.json + media/ inside the chosen folder.
- **Open dialog** — Was file-only (required selecting board.json by name). Fixed: now uses a folder-picker dialog so users pick the board folder directly. Any board folder contains a board.json automatically.
- **Phantom image after delete** — Container not removed from canvas before destroy. Fixed in removeItem (proper guard + clearSelection before destroy).
- **Native file drag & drop in Tauri Linux** — WebKitGTK drops from OS file managers bypass HTML5 event listeners. Fixed: hooked Tauri `onDragDropEvent` from `@tauri-apps/api/webview` to import OS files directly.
- **+Media button freezing app** — Unbounded `img.decode()` call stalled indefinitely on WebKitGTK data URLs. Fixed: added timeout fallback and hooked native Tauri dialog picker (`pickMediaFiles`).
- **Aligning >2 images overlapping / stacking** — `distribute-h`/`distribute-v` resulted in negative gaps if items overlapped, and users lacked horizontal/vertical line arrangements. Fixed: enforced positive gap floor (24px) and added BeeRef-style Arrange Row (horizontal line) and Arrange Column (vertical line) buttons.
- **Pinterest drag-and-drop** — Anchor `/pin/` hrefs resolved against localhost, `src` was ignored when `srcset` existed, Pinterest CDN requests were rejected due to invalid referer, and HTML parsing lacked `<img>` tag fallback. Fixed: resolved relative pin URLs to `https://www.pinterest.com`, added multi-resolution candidate fallbacks (`736x`, `1200x`, `src`), updated Rust Referer header to `https://www.pinterest.com/`, and added `<img>` scraping fallback (BeeRef parity).
- **Directory Open/Save clarity** — Dialog titles, button labels ("Open Folder", "Save Folder"), and tooltips updated to clearly state directory selection.

## ACTIVE
- **Group header tab interaction** — Group header tab in top-left is currently a visual indicator; dragging the tab itself to move all grouped items is planned.
- **Multi-item gizmo scaling** — Scaling multiple selected objects simultaneously with a collective resize gizmo is planned.

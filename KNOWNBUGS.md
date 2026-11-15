# Taboret Known Bugs & Status

## FIXED
- **CachyOS (Niri)** — Resizing the window doesn't update the grid. (Fixed via renderer resize event)
- **Vite/Tauri port mismatch** — Vite was on :8080, Tauri expected :5173. Both open (one browser, one native window). Fixed: Vite now always uses 5173, browser auto-open disabled.
- **Save dialog** — Defaulted to Downloads with a file-save dialog. Fixed: now uses a folder-picker dialog so users choose where the board folder lives. The Rust backend writes board.json + media/ inside the chosen folder.
- **Open dialog** — Was file-only (required selecting board.json by name). Fixed: now uses a folder-picker dialog so users pick the board folder directly. Any board folder contains a board.json automatically.
- **Phantom image after delete** — Container not removed from canvas before destroy. Fixed in removeItem (proper guard + clearSelection before destroy).
- **Native file drag & drop in Tauri Linux** — WebKitGTK drops from OS file managers bypass HTML5 event listeners. Fixed: hooked Tauri `onDragDropEvent` from `@tauri-apps/api/webview` to import OS files directly.
- **Batch import crash (Mesa EGL / GStreamer)** — Importing large batches of images flooded the EGL texture queue, triggering Mesa driver failures. Furthermore, WebKitGTK crashed on video files when GStreamer's `autoaudiosink` was absent. Fixed: throttled batch imports with a 20ms yield between items, downscaled giant textures (>4096px) to conserve VRAM, muted and isolated video elements before setting src to avoid GStreamer pipeline crashes, and batched group/gizmo updates to fire once at the end.
- **+Media button freezing app** — Unbounded `img.decode()` call stalled indefinitely on WebKitGTK data URLs. Fixed: added timeout fallback and hooked native Tauri dialog picker (`pickMediaFiles`).
- **Aligning >2 images overlapping / stacking** — `distribute-h`/`distribute-v` resulted in negative gaps if items overlapped, and users lacked horizontal/vertical line arrangements. Fixed: enforced positive gap floor (24px) and added BeeRef-style Arrange Row (horizontal line) and Arrange Column (vertical line) buttons.
- **Pinterest drag-and-drop** — Anchor `/pin/` hrefs resolved against localhost, `src` was ignored when `srcset` existed, Pinterest CDN requests were rejected due to invalid referer, and HTML parsing lacked `<img>` tag fallback. Fixed: resolved relative pin URLs to `https://www.pinterest.com`, added multi-resolution candidate fallbacks (`736x`, `1200x`, `src`), updated Rust Referer header to `https://www.pinterest.com/`, and added `<img>` scraping fallback (BeeRef parity).
- **Directory Open/Save clarity** — Dialog titles, button labels ("Open Folder", "Save Folder"), and tooltips updated to clearly state directory selection.
- **Slow board loading (<500 images)** — Fixed in `onOpenBoard`: added `{ skipNotify: true }` to item restoration, added cooperative yields every 25 items for UI responsiveness, and consolidated layout updates (`updateGroupDisplay` and `notifyChanged`) to execute once after all items are placed.
- **Mesa EGL DRI2 probe spam** — Fixed in `src-tauri/src/main.rs`: set `EGL_LOG_LEVEL=fatal` when unset under Linux to silence harmless Mesa DRI2 probing noise when running proprietary NVIDIA drivers under Wayland.
- **Incremental save system & session state tracking** — Fixed in `items.js`, `storage.js`, and `main.js`:
  1. Added `isSaved` tracking per item; existing items are marked saved when opening a board or after saving.
  2. `saveBoard` passes `data_url: null` for all clean/saved items, saving multi-second Base64 re-serialization over IPC.
  3. Added `markAllDirty()` when saving to a new folder ("Save As") to ensure full copying to new destinations.
- **Group header tab interaction (Obsidian Canvas parity)** — Fixed in `items.js` & `interactions.js`: rendered interactive group header tabs with crisp `group.title` text; added `hitTestGroupTab` so clicking a tab selects all group items and dragging moves the entire group simultaneously.
- **Multi-item collective gizmo scaling** — Fixed in `interactions.js`: multi-selection now draws 4 collective corner resize handles, hit-tests them, and performs proportional scaling around the opposite corner pivot, resizing dimensions and adjusting relative spacing for all selected items together without distortion.
- **Linux middle-click auto-pasting** — On Linux (X11 & Wayland), middle-click canvas panning triggered default primary-selection paste and `auxclick` events. Fixed: prevented default on `auxclick` (button 1) and guarded clipboard paste in `interactions.js` against recent middle-click events and active canvas panning.
- **Animated GIF playback** — User-confirmed working in native `pnpm tauri dev` (WebKitGTK) and in Chromium via `omggif` frame decoding directly into `PIXI.Texture.from(frameCanvas)`.
- **Bring to Front / Send to Back reliability** — Fixed in `items.js`:
  1. `sendToBack` shifts all other items' `zIndex` up by 1 and assigns `zIndex = 0` to the target item, preserving monotonic, non-negative z-ordering.
  2. Both `bringToFront` and `sendToBack` explicitly call `this.canvasContainer.sortChildren()` for immediate visual re-sorting.
- **Rotated item bounding box & gizmo accessibility** — Fixed in `interactions.js`:
  1. Single-item selection draws a rotated bounding polygon and corner handles aligned to the item's `item.rotation`.
  2. Rotation handle is placed along the true rotated top normal, preventing rotated images from overlapping or blocking the rotation control.
  3. `hitTestGizmoHandles` unrotates canvas coordinates into item-local space for accurate handle detection at any angle.
  4. Rotate handle styling updated to match corner handles (white fill with blue outline) with high-contrast cursor.
- **Group/Ungroup button state** — Fixed in `ui.js`: `btnUngroup` is only enabled when `selectedItems.some(i => i.groupId !== null)`.
- **"Frame All" shortcut** — Added `F` (BeeRef standard) alongside `Z` in `interactions.js`, top bar tooltip, and shortcuts modal.
- **UI Dock icons & button labels** — Fixed in `ui.js`:
  1. Updated top bar buttons: "New" -> "New Board", "Open Folder" -> "Open Board", "Save Folder" -> "Save Board".
  2. Replaced plain text "⇔ H" and "⇕ V" with crisp SVG icons and clear tooltips for Distribute Horizontally and Distribute Vertically.
- **Adaptive infinite grid scaling (Lorien / InfiniPaint parity)** — Fixed in `board.js`: `updateGridTransform` calculates power-of-2 LOD scale (`zoom / 2^round(log2(zoom))`), keeping screen cell dimensions comfortably between ~56px and 113px at any zoom level while maintaining strict 1:1 physical lock to canvas coordinates and items.
- **Media filename preservation across save/load (P0)** — Fixed in `items.js` & `main.js`:
  1. `items.js` preserves original `data.filename || data.file` instead of generating new timestamped filenames on reopened items.
  2. `main.js` `onOpenBoard` explicitly forwards `filename: fileKey` and guards against missing file keys.
  3. Enhanced GIF detection by checking `mimeType === "image/gif"` as well as filename and dataUrl.
- **Toast cleanup, dismissal, and interruption cancellation (P0)** — Fixed in `ui.js`, `main.js`, and `interactions.js`:
  1. `showLoadingProgress` includes a manual close ("×") button, uses safe `textContent`, and detects stalls (>10s with no updates).
  2. `ui.dismissAllProgress()` cleans up all active progress bars on `New Board` and `Open Board`.
  3. `openGeneration` token in `main.js` ensures that starting a new action or opening another board cancels any previous in-flight board opening immediately without interleaving items or leaving stuck toasts.
  4. `importFileList` shows live filenames *before* each file is imported and wraps execution in `try...finally` to guarantee progress completion.
- **Context menu right-drag pan suppression** — Fixed in `board.js` & `ui.js`: `board.js` tracks pan movement (>4px) and suppresses the global context menu after a right-drag pan.
- **macOS Meta key shortcuts** — Fixed in `interactions.js`: single-key shortcuts (H, V, T, F, Z) check `!e.ctrlKey && !e.metaKey`, preventing macOS Cmd combinations (such as Cmd+V for paste) from inadvertently triggering single-key transforms.
- **VRAM texture disposal** — Fixed in `items.js`: `removeItem` and `clear` destroy Pixi textures and sources to prevent GPU memory leaks.
- **Rust security & MIME expansion** — Fixed in `src-tauri/src/lib.rs`:
  1. Path traversal guard in `save_board_to_folder` sanitizes destination file names.
  2. Added `.avif`, `.mov`, `.m4v`, `.ogv` to Rust MIME detection.
- **Inline Group Renaming** — Fixed in `ui.js`, `interactions.js`, and `main.js`: replaced synchronous `window.prompt()` with an inline styled `<input>` overlay positioned directly over the group tab with Enter to commit and Escape to cancel.

---

## ACTIVE

### 🟡 Large board loading optimization (boards over 100 images)
- **Status**: Medium priority.
- **Location**: `storage.js` `readBoard`, `lib.rs` `read_board_from_folder`.
- **Issue**: `read_board_from_folder` reads all media files into memory and Base64-encodes them in one synchronous Rust IPC call. For large boards, this causes a 10-20s initial freeze before JS receives data.
- **Fix path**: Split Rust command into `read_board_manifest` (instant, returns `board.json`) and per-file reads so JS can stream items on demand with live progress.
- **Priority**: Medium.

---

### 🟡 Save dialog button says "Open" (GTK folder picker limitation on Linux)
- **Status**: Low priority.
- **Location**: `storage.js` `pickSaveFolder()`.
- **Issue**: GTK folder picker always shows "Open" as confirm button. Can't change via Tauri `plugin-dialog` on Linux.
- **Fix path**: Prompt for board name first (via inline modal/input), then auto-create `${parentFolder}/${boardName}/`.
- **Priority**: Low.

---

### 🟡 App hero icon configuration
- **Status**: Not implemented. Low priority.
- **Location**: `src-tauri/icons/`
- **Issue**: Place a 1024×1024 `icon.png` in `src-tauri/icons/` and run `pnpm tauri icon`.
- **Priority**: Low.

---

## TODO: Video Playback (Postponed for Dedicated Session)
- **Status**: Postponed.
- **Context**: In WebKitGTK under Wayland + NVIDIA, `<video>` element frame extraction to WebGL requires custom canvas blitting (`src/video.js`) and asset protocol streaming (`convertFileSrc`). Postponed to avoid complex codec tests until core data integrity and UI stability are complete.

---

## FUTURE (Planned Enhancements)
- **Dot grid toggle** — Toggle between lines, dots, and none.
- **Shift-select range** — Click item A, Shift-click item B selects in reading order.
- **Multi-item rotation** — Rotate collective multi-selection around collective center.
- **Undo / Redo stack** — History stack for transform, move, and edit operations.

# UX
- `Click X to Cancel` but cannot click X when the import hangs.
- Text (And Group Name Label) is blurry when zooming in or when resizing element to make it bigger
- Should add feature to change the *color* of a Group (or other UI things as well)
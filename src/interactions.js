import * as PIXI from "pixi.js";
import { fetchRemoteMedia, readLocalFile } from "./storage.js";

/**
 * Controller for mouse, keyboard, selection, transform gizmo, and drag-and-drop operations.
 */
export class InteractionController {
  constructor(viewport, itemManager, options = {}) {
    this.viewport = viewport;
    this.itemManager = itemManager;
    this.options = options;

    this.selectedItems = new Set();
    this.isDraggingItems = false;
    this.dragStartPositions = new Map();
    this.dragStartMouse = { x: 0, y: 0 };

    // Marquee (box selection)
    this.isMarqueeSelecting = false;
    this.marqueeStart = { x: 0, y: 0 };
    this.marqueeGraphics = new PIXI.Graphics();
    this.viewport.canvas.addChild(this.marqueeGraphics);

    // Transform Gizmo Graphics
    this.gizmoGraphics = new PIXI.Graphics();
    this.gizmoGraphics.eventMode = "none";
    this.viewport.canvas.addChild(this.gizmoGraphics);

    // Gizmo manipulation state
    this.activeGizmoAction = null; // 'scale-tl', 'scale-tr', 'scale-br', 'scale-bl', 'rotate'
    this.gizmoStartMouse = { x: 0, y: 0 };
    this.gizmoItemStartState = null;

    // Callbacks
    this.onSelectionChanged = null;
    this.onTextEditRequested = null;
    this.onNotification = null;

    this.setupMouseEvents();
    this.setupKeyEvents();
    this.setupDragAndDrop();
    this.setupClipboardPaste();
  }

  notify(message, type = "info") {
    if (this.onNotification) {
      this.onNotification(message, type);
    }
  }

  setupMouseEvents() {
    const canvasEl = this.viewport.app.canvas;

    canvasEl.addEventListener("mousedown", (e) => {
      // Right or middle clicks are handled by viewport panning
      if (e.button !== 0 || this.viewport.isSpacePressed) return;

      const screenX = e.clientX;
      const screenY = e.clientY;
      const canvasPos = this.viewport.screenToCanvas(screenX, screenY);

      // Check if clicked on Gizmo handle of a single selected item
      if (this.selectedItems.size === 1) {
        const item = Array.from(this.selectedItems)[0];
        const hitHandle = this.hitTestGizmoHandles(item, canvasPos);
        if (hitHandle) {
          this.startGizmoAction(hitHandle, canvasPos, item);
          e.preventDefault();
          return;
        }
      }

      // Check if clicked on an item
      const clickedItem = this.hitTestItem(canvasPos);

      if (clickedItem) {
        if (e.shiftKey) {
          // Toggle selection
          if (this.selectedItems.has(clickedItem)) {
            this.deselectItem(clickedItem);
          } else {
            this.selectItem(clickedItem, false);
          }
          this.pendingSingleSelect = null;
        } else {
          // If clicked item is not already selected, select only this one
          if (!this.selectedItems.has(clickedItem)) {
            this.clearSelection();
            this.selectItem(clickedItem, false);
            this.pendingSingleSelect = null;
          } else {
            // Already selected as part of a multi-selection:
            // allow dragging the whole selection, but if clicked without moving, select only this one
            this.pendingSingleSelect = clickedItem;
          }
        }

        // Prepare to drag all selected items
        this.hasDraggedItems = false;
        this.isDraggingItems = true;
        this.dragStartMouse = { ...canvasPos };
        this.dragStartPositions.clear();

        for (const item of this.selectedItems) {
          this.dragStartPositions.set(item.id, { x: item.x, y: item.y });
        }
      } else {
        // Clicked empty canvas: start marquee selection
        if (!e.shiftKey) {
          this.clearSelection();
        }
        this.isMarqueeSelecting = true;
        this.marqueeStart = { ...canvasPos };
      }
    });

    window.addEventListener("mousemove", (e) => {
      const canvasPos = this.viewport.screenToCanvas(e.clientX, e.clientY);

      // Handle Gizmo scaling / rotation
      if (this.activeGizmoAction && this.gizmoItemStartState) {
        this.handleGizmoDrag(canvasPos);
        return;
      }

      // Handle dragging selected items
      if (this.isDraggingItems) {
        const dx = canvasPos.x - this.dragStartMouse.x;
        const dy = canvasPos.y - this.dragStartMouse.y;
        if (Math.hypot(dx, dy) > 3) {
          this.hasDraggedItems = true;
        }

        for (const item of this.selectedItems) {
          const start = this.dragStartPositions.get(item.id);
          if (start) {
            this.itemManager.setItemPosition(item, start.x + dx, start.y + dy);
          }
        }
        this.itemManager.updateGroupDisplay();
        this.updateGizmo();
        return;
      }

      // Handle marquee box selection
      if (this.isMarqueeSelecting) {
        this.updateMarquee(this.marqueeStart, canvasPos);
        return;
      }

      // Update hover cursor for gizmo handles if 1 item selected
      if (this.selectedItems.size === 1 && !this.viewport.isPanning) {
        const item = Array.from(this.selectedItems)[0];
        const handle = this.hitTestGizmoHandles(item, canvasPos);
        if (handle) {
          document.body.style.cursor = this.getCursorForHandle(handle);
        } else if (!this.viewport.isSpacePressed) {
          document.body.style.cursor = "default";
        }
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (this.activeGizmoAction) {
        this.activeGizmoAction = null;
        this.gizmoItemStartState = null;
        this.itemManager.notifyChanged();
        this.updateGizmo();
      }

      if (this.isDraggingItems) {
        // If it was just a click (not dragged) on an item inside a multi-selection, select only that item!
        if (!this.hasDraggedItems && this.pendingSingleSelect && !e.shiftKey) {
          this.clearSelection();
          this.selectItem(this.pendingSingleSelect, false);
        }
        this.pendingSingleSelect = null;
        this.isDraggingItems = false;
        this.hasDraggedItems = false;
        this.itemManager.notifyChanged();
        this.updateGizmo();
      }

      if (this.isMarqueeSelecting) {
        const canvasPos = this.viewport.screenToCanvas(e.clientX, e.clientY);
        this.finishMarqueeSelection(this.marqueeStart, canvasPos);
        this.isMarqueeSelecting = false;
        this.marqueeGraphics.clear();
      }
    });

    // Double-click on text note to edit
    canvasEl.addEventListener("dblclick", (e) => {
      const canvasPos = this.viewport.screenToCanvas(e.clientX, e.clientY);
      const clickedItem = this.hitTestItem(canvasPos);

      if (clickedItem && clickedItem.type === "text") {
        if (this.onTextEditRequested) {
          this.onTextEditRequested(clickedItem);
        }
      } else if (!clickedItem) {
        // Double-click empty canvas creates a text note!
        this.itemManager.addTextItem({
          x: canvasPos.x,
          y: canvasPos.y,
          text: "New note...",
        });
      }
    });
  }

  hitTestItem(canvasPos) {
    // Sort items by zIndex descending so top-most item is clicked first
    const sorted = Array.from(this.itemManager.items.values())
      .filter((item) => item && item.container && !item.container.destroyed)
      .sort((a, b) => b.zIndex - a.zIndex);

    for (const item of sorted) {
      const bounds = this.itemManager.getItemBounds(item);
      if (
        canvasPos.x >= bounds.x &&
        canvasPos.x <= bounds.x + bounds.width &&
        canvasPos.y >= bounds.y &&
        canvasPos.y <= bounds.y + bounds.height
      ) {
        return item;
      }
    }
    return null;
  }

  // ---------------- SELECTION & GIZMO ----------------
  selectItem(item, clearOthers = true) {
    if (clearOthers) {
      this.clearSelection();
    }
    this.selectedItems.add(item);
    this.itemManager.setItemSelected(item, true);
    this.updateGizmo();
    if (this.onSelectionChanged) {
      this.onSelectionChanged(Array.from(this.selectedItems));
    }
  }

  deselectItem(item) {
    this.selectedItems.delete(item);
    this.itemManager.setItemSelected(item, false);
    this.updateGizmo();
    if (this.onSelectionChanged) {
      this.onSelectionChanged(Array.from(this.selectedItems));
    }
  }

  clearSelection() {
    for (const item of this.selectedItems) {
      if (item && item.container && !item.container.destroyed) {
        this.itemManager.setItemSelected(item, false);
      }
    }
    this.selectedItems.clear();
    if (this.gizmoGraphics && !this.gizmoGraphics.destroyed) {
      this.gizmoGraphics.clear();
    }
    if (this.onSelectionChanged) {
      this.onSelectionChanged([]);
    }
  }

  selectAll() {
    this.clearSelection();
    for (const item of this.itemManager.items.values()) {
      this.selectedItems.add(item);
      this.itemManager.setItemSelected(item, true);
    }
    this.updateGizmo();
    if (this.onSelectionChanged) {
      this.onSelectionChanged(Array.from(this.selectedItems));
    }
  }

  updateMarquee(start, current) {
    const minX = Math.min(start.x, current.x);
    const minY = Math.min(start.y, current.y);
    const w = Math.abs(current.x - start.x);
    const h = Math.abs(current.y - start.y);

    this.marqueeGraphics.clear();
    this.marqueeGraphics.rect(minX, minY, w, h);
    this.marqueeGraphics.fill({ color: 0x3b82f6, alpha: 0.15 });
    this.marqueeGraphics.stroke({ color: 0x60a5fa, width: 1.5 });
  }

  finishMarqueeSelection(start, end) {
    const minX = Math.min(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxX = Math.max(start.x, end.x);
    const maxY = Math.max(start.y, end.y);

    if (maxX - minX < 4 && maxY - minY < 4) return;

    for (const item of this.itemManager.items.values()) {
      const b = this.itemManager.getItemBounds(item);
      // Check intersection
      const intersects = !(
        b.x + b.width < minX ||
        b.x > maxX ||
        b.y + b.height < minY ||
        b.y > maxY
      );

      if (intersects) {
        this.selectedItems.add(item);
        this.itemManager.setItemSelected(item, true);
      }
    }

    this.updateGizmo();
    if (this.onSelectionChanged) {
      this.onSelectionChanged(Array.from(this.selectedItems));
    }
  }

  updateGizmo() {
    if (!this.gizmoGraphics || this.gizmoGraphics.destroyed) return;
    this.gizmoGraphics.clear();

    if (this.selectedItems.size === 0) {
      return;
    }

    // Multi-selection: draw collective bounding box frame
    if (this.selectedItems.size > 1) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const it of this.selectedItems) {
        if (!it || !it.container || it.container.destroyed) continue;
        const b = this.itemManager.getItemBounds(it);
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
      }

      if (minX !== Infinity) {
        const pad = 4 / this.viewport.zoom;
        const w = maxX - minX + pad * 2;
        const h = maxY - minY + pad * 2;
        this.gizmoGraphics.rect(minX - pad, minY - pad, w, h);
        this.gizmoGraphics.stroke({
          color: 0x38bdf8,
          width: 1.5 / this.viewport.zoom,
          alpha: 0.8,
        });
      }
      return;
    }

    const item = Array.from(this.selectedItems)[0];
    if (
      !item ||
      !this.itemManager.items.has(item.id) ||
      !item.container ||
      item.container.destroyed
    ) {
      this.selectedItems.delete(item);
      return;
    }

    const b = this.itemManager.getItemBounds(item);
    const handleSize = 10 / this.viewport.zoom;
    const rotateOffset = 30 / this.viewport.zoom;

    // Outer bounding border
    this.gizmoGraphics.rect(b.x, b.y, b.width, b.height);
    this.gizmoGraphics.stroke({
      color: 0x38bdf8,
      width: 2 / this.viewport.zoom,
    });

    // 4 Corner handles
    const corners = [
      { x: b.x, y: b.y }, // TL
      { x: b.x + b.width, y: b.y }, // TR
      { x: b.x + b.width, y: b.y + b.height }, // BR
      { x: b.x, y: b.y + b.height }, // BL
    ];

    for (const pt of corners) {
      this.gizmoGraphics.rect(
        pt.x - handleSize / 2,
        pt.y - handleSize / 2,
        handleSize,
        handleSize,
      );
      this.gizmoGraphics.fill({ color: 0xffffff });
      this.gizmoGraphics.stroke({
        color: 0x0284c7,
        width: 1.5 / this.viewport.zoom,
      });
    }

    // Rotation handle
    const topCenterX = b.x + b.width / 2;
    const topCenterY = b.y;
    const rotY = topCenterY - rotateOffset;

    // Stem line
    this.gizmoGraphics.moveTo(topCenterX, topCenterY);
    this.gizmoGraphics.lineTo(topCenterX, rotY);
    this.gizmoGraphics.stroke({
      color: 0x38bdf8,
      width: 1.5 / this.viewport.zoom,
    });

    // Rotation circle
    this.gizmoGraphics.circle(topCenterX, rotY, handleSize / 1.5);
    this.gizmoGraphics.fill({ color: 0x38bdf8 });
    this.gizmoGraphics.stroke({
      color: 0xffffff,
      width: 1.5 / this.viewport.zoom,
    });
  }

  hitTestGizmoHandles(item, canvasPos) {
    const b = this.itemManager.getItemBounds(item);
    const threshold = 16 / this.viewport.zoom;
    const rotateOffset = 30 / this.viewport.zoom;

    // Rotation handle
    const topCenterX = b.x + b.width / 2;
    const rotY = b.y - rotateOffset;
    if (Math.hypot(canvasPos.x - topCenterX, canvasPos.y - rotY) <= threshold) {
      return "rotate";
    }

    // Corner handles
    if (Math.hypot(canvasPos.x - b.x, canvasPos.y - b.y) <= threshold)
      return "scale-tl";
    if (
      Math.hypot(canvasPos.x - (b.x + b.width), canvasPos.y - b.y) <= threshold
    )
      return "scale-tr";
    if (
      Math.hypot(
        canvasPos.x - (b.x + b.width),
        canvasPos.y - (b.y + b.height),
      ) <= threshold
    )
      return "scale-br";
    if (
      Math.hypot(canvasPos.x - b.x, canvasPos.y - (b.y + b.height)) <= threshold
    )
      return "scale-bl";

    return null;
  }

  getCursorForHandle(handle) {
    switch (handle) {
      case "rotate":
        return "crosshair";
      case "scale-tl":
      case "scale-br":
        return "nwse-resize";
      case "scale-tr":
      case "scale-bl":
        return "nesw-resize";
      default:
        return "default";
    }
  }

  startGizmoAction(handle, mouseCanvasPos, item) {
    this.activeGizmoAction = handle;
    this.gizmoStartMouse = { ...mouseCanvasPos };
    this.gizmoItemStartState = {
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      scaleX: item.scaleX,
      scaleY: item.scaleY,
      rotation: item.rotation,
      itemBounds: this.itemManager.getItemBounds(item),
    };
  }

  handleGizmoDrag(currentPos) {
    const item = Array.from(this.selectedItems)[0];
    if (!item || !this.gizmoItemStartState) return;

    const start = this.gizmoItemStartState;

    if (this.activeGizmoAction === "rotate") {
      const angle = Math.atan2(currentPos.y - item.y, currentPos.x - item.x);
      // Snap to 45 degree increments if shift is pressed
      let finalAngle = angle + Math.PI / 2;
      this.itemManager.setItemRotation(item, finalAngle);
      this.updateGizmo();
      return;
    }

    // Scaling
    const initialDist = Math.hypot(
      this.gizmoStartMouse.x - item.x,
      this.gizmoStartMouse.y - item.y,
    );
    const currentDist = Math.hypot(
      currentPos.x - item.x,
      currentPos.y - item.y,
    );

    if (initialDist > 0) {
      const factor = currentDist / initialDist;
      const newScaleX = start.scaleX * factor;
      const newScaleY = start.scaleY * factor;
      this.itemManager.setItemScale(item, newScaleX, newScaleY);
      this.updateGizmo();
    }
  }

  // ---------------- KEYBOARD SHORTCUTS ----------------
  setupKeyEvents() {
    window.addEventListener("keydown", (e) => {
      // Ignore keys if user is editing text in an input or textarea
      const target = e.target;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // Delete / Backspace: Remove selected items
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        this.deleteSelectedItems();
        return;
      }

      // Escape: Deselect
      if (e.key === "Escape") {
        this.clearSelection();
        return;
      }

      // Select All: Ctrl+A
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        this.selectAll();
        return;
      }

      // Group: Ctrl+G / Ungroup: Ctrl+Shift+G
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) {
          const ids = Array.from(this.selectedItems).map((i) => i.id);
          this.itemManager.ungroup(ids);
          this.notify("Ungrouped selected items");
        } else {
          const ids = Array.from(this.selectedItems).map((i) => i.id);
          if (ids.length > 1) {
            this.itemManager.createGroup(ids, "Group");
            this.notify("Group created");
          }
        }
        return;
      }

      // Flip Horizontal: H
      if (e.key.toLowerCase() === "h" && !e.ctrlKey) {
        for (const item of this.selectedItems) {
          this.itemManager.flipItemHorizontal(item);
        }
        this.updateGizmo();
        return;
      }

      // Flip Vertical: V
      if (e.key.toLowerCase() === "v" && !e.ctrlKey) {
        for (const item of this.selectedItems) {
          this.itemManager.flipItemVertical(item);
        }
        this.updateGizmo();
        return;
      }

      // Bring to Front: ] / Send to Back: [
      if (e.key === "]") {
        for (const item of this.selectedItems) {
          this.itemManager.bringToFront(item);
        }
        return;
      }
      if (e.key === "[") {
        for (const item of this.selectedItems) {
          this.itemManager.sendToBack(item);
        }
        return;
      }

      // Add Text: T
      if (e.key.toLowerCase() === "t" && !e.ctrlKey) {
        const center = this.viewport.screenToCanvas(
          this.viewport.app.screen.width / 2,
          this.viewport.app.screen.height / 2,
        );
        const textItem = this.itemManager.addTextItem({
          x: center.x,
          y: center.y,
          text: "Double click to edit note...",
        });
        this.selectItem(textItem, true);
        return;
      }

      // Reset View / Frame All: Z
      if (e.key.toLowerCase() === "z" && !e.ctrlKey) {
        const bounds = this.itemManager.getOverallBounds();
        this.viewport.resetView(bounds);
        return;
      }
    });
  }

  deleteSelectedItems() {
    const toDelete = Array.from(this.selectedItems);
    if (toDelete.length === 0) return;

    // Clear selection first so gizmo is cleared and selectedItems does not hold deleted items
    this.clearSelection();

    for (const item of toDelete) {
      this.itemManager.removeItem(item);
    }
  }

  // ---------------- DRAG & DROP MEDIA (Requirement 1) ----------------
  setupDragAndDrop() {
    const dropZone = window;

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });

    dropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      const dropPos = this.viewport.screenToCanvas(e.clientX, e.clientY);

      // 1. Check local files
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files);
        const importedItems = [];
        let curX = dropPos.x;
        let curY = dropPos.y;
        let rowMaxH = 0;
        const spacing = 24;
        const maxCols = Math.ceil(Math.sqrt(files.length));
        let col = 0;

        for (const file of files) {
          try {
            const media = await readLocalFile(file);
            const isVideo =
              media.mimeType?.startsWith("video/") ||
              media.filename.endsWith(".mp4") ||
              media.filename.endsWith(".webm");

            let item;
            if (isVideo) {
              item = await this.itemManager.addVideoItem({
                dataUrl: media.dataUrl,
                filename: `media/${media.filename}`,
                sourcePath: media.sourcePath,
                x: curX,
                y: curY,
              });
            } else {
              item = await this.itemManager.addImageItem({
                dataUrl: media.dataUrl,
                filename: `media/${media.filename}`,
                sourcePath: media.sourcePath,
                x: curX,
                y: curY,
              });
            }

            importedItems.push(item);
            const b = this.itemManager.getItemBounds(item);
            curX += b.width + spacing;
            rowMaxH = Math.max(rowMaxH, b.height);
            col++;

            if (col >= maxCols) {
              col = 0;
              curX = dropPos.x;
              curY += rowMaxH + spacing;
              rowMaxH = 0;
            }
          } catch (err) {
            console.error(`Detailed error importing file "${file.name}":`, err);
            this.notify(
              `Failed importing ${file.name}: ${err?.message || "Invalid or unsupported media"}`,
              "error",
            );
          }
        }

        // Select all newly imported items together
        this.clearSelection();
        for (const it of importedItems) {
          this.selectedItems.add(it);
          this.itemManager.setItemSelected(it, true);
        }
        this.updateGizmo();
        if (this.onSelectionChanged) {
          this.onSelectionChanged(Array.from(this.selectedItems));
        }
        return;
      }

      // 2. Check web drop (Pinterest, Artstation, Google Images URLs or HTML)
      // Collect all candidate URLs in priority order; try each until one works.
      const candidates = this.extractDroppedWebUrls(e.dataTransfer);
      if (candidates.length > 0) {
        let lastErr = null;
        for (const url of candidates) {
          try {
            this.notify("Downloading web reference...", "info");
            const media = await fetchRemoteMedia(url);
            await this.addImportedMedia(media, dropPos);
            this.notify("Added reference from web!", "success");
            return;
          } catch (err) {
            console.warn(`Drop URL failed (${url}):`, err);
            lastErr = err;
          }
        }
        // All candidates failed
        console.error("All drop URL candidates failed:", lastErr);
        this.notify(
          `Could not download image: ${lastErr?.message || lastErr}`,
          "error",
        );
      }
    });
  }

  /**
   * Extracts all candidate URLs from a drag-and-drop DataTransfer, ordered by priority.
   * Returns an array so the caller can try each in sequence (the first to succeed wins).
   *
   * Priority strategy:
   *  1. Direct CDN media URLs (already resolved image URLs from srcset / src)
   *  2. Pinterest page URLs (Rust backend scrapes og:image from the HTML)
   *  3. Other page links / plain-text URLs
   *
   * Pinterest note: dragging a pin provides both an i.pinimg.com CDN URL AND the
   * pinterest.com/pin/... page URL. The CDN URL works when Pinterest's CDN is accessible,
   * but can fail due to hotlink protection. The pin page URL is the reliable fallback —
   * the Rust fetch_remote_media will extract og:image from the page HTML.
   */
  extractDroppedWebUrls(dataTransfer) {
    const candidates = [];
    const seen = new Set();
    const addUrl = (url) => {
      if (url && !seen.has(url)) {
        seen.add(url);
        candidates.push(url);
      }
    };

    // 1. Check text/html for img/video sources (richest data from Pinterest, Artstation, etc.)
    const html = dataTransfer.getData("text/html");
    let pinPageUrl = null; // capture for fallback

    if (html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      // Extract img src / srcset
      const img = doc.querySelector("img");
      if (img) {
        let bestUrl = null;
        const srcset = img.getAttribute("srcset");
        if (srcset) {
          const cdnCandidates = srcset
            .split(",")
            .map((c) => c.trim().split(" ")[0])
            .filter(Boolean);
          // Try highest-res srcset entry first
          for (const c of cdnCandidates.reverse()) {
            let u = c;
            if (u.includes("i.pinimg.com")) {
              u = u.replace(/\/236x\//, "/736x/").replace(/\/474x\//, "/736x/");
            }
            addUrl(u);
            if (!bestUrl) bestUrl = u;
          }
        }
        if (!bestUrl) {
          let src = img.getAttribute("src");
          if (src?.includes("i.pinimg.com")) {
            src = src
              .replace(/\/236x\//, "/736x/")
              .replace(/\/474x\//, "/736x/");
          }
          if (src) addUrl(src);
        }
      }

      // Extract video sources
      const video = doc.querySelector("video, source");
      if (video?.src) addUrl(video.src);

      // Check anchors for Pinterest pin page URL (used as fallback if CDN fails)
      const anchor = doc.querySelector("a[href]");
      if (anchor?.href) {
        if (
          anchor.href.includes("pinterest.com/pin/") ||
          anchor.href.includes("pin.it/")
        ) {
          pinPageUrl = anchor.href;
          // Don't add yet — we'll add it AFTER CDN candidates so it's tried last
        } else if (this.isLikelyMediaUrl(anchor.href)) {
          addUrl(anchor.href);
        }
      }
    }

    // 2. Check text/uri-list
    const uriList = dataTransfer.getData("text/uri-list");
    if (uriList) {
      const urls = uriList
        .split("\n")
        .map((u) => u.trim().replace(/^#.*/, "")) // strip comments
        .filter((u) => u.startsWith("http"));

      for (const u of urls) {
        let resolved = u;
        if (u.includes("i.pinimg.com")) {
          resolved = u
            .replace(/\/236x\//, "/736x/")
            .replace(/\/474x\//, "/736x/");
        }
        if (this.isLikelyMediaUrl(resolved)) {
          addUrl(resolved);
        } else if (u.includes("pinterest.com/pin/") || u.includes("pin.it/")) {
          if (!pinPageUrl) pinPageUrl = u;
        } else {
          // Generic page link — try as fallback (Rust will scrape og:image)
          addUrl(resolved);
        }
      }
    }

    // 3. Add Pinterest page URL last (slowest — requires scraping, but most reliable)
    if (pinPageUrl) addUrl(pinPageUrl);

    // 4. Plain text URL fallback
    const text = dataTransfer.getData("text/plain")?.trim();
    if (text && (text.startsWith("http://") || text.startsWith("https://"))) {
      let resolved = text;
      if (text.includes("i.pinimg.com")) {
        resolved = text
          .replace(/\/236x\//, "/736x/")
          .replace(/\/474x\//, "/736x/");
      }
      addUrl(resolved);
    }

    return candidates;
  }

  isLikelyMediaUrl(url) {
    return /\.(png|jpe?g|webp|gif|avif|svg|mp4|webm)($|\?)/i.test(url);
  }

  async importMediaFile(fileOrPath, position) {
    const media = await readLocalFile(fileOrPath);
    await this.addImportedMedia(media, position);
  }

  async addImportedMedia(media, position) {
    const isVideo =
      media.mimeType?.startsWith("video/") ||
      media.filename.endsWith(".mp4") ||
      media.filename.endsWith(".webm");

    if (isVideo) {
      const item = await this.itemManager.addVideoItem({
        dataUrl: media.dataUrl,
        filename: `media/${media.filename}`,
        sourcePath: media.sourcePath,
        x: position.x,
        y: position.y,
      });
      this.selectItem(item, true);
    } else {
      const item = await this.itemManager.addImageItem({
        dataUrl: media.dataUrl,
        filename: `media/${media.filename}`,
        sourcePath: media.sourcePath,
        x: position.x,
        y: position.y,
      });
      this.selectItem(item, true);
    }
  }

  // ---------------- CLIPBOARD PASTE ----------------
  setupClipboardPaste() {
    window.addEventListener("paste", async (e) => {
      // Ignore if editing text
      const target = e.target;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const items = e.clipboardData?.items;
      if (!items) return;

      const center = this.viewport.screenToCanvas(
        this.viewport.app.screen.width / 2,
        this.viewport.app.screen.height / 2,
      );

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            await this.importMediaFile(blob, center);
            this.notify("Pasted image from clipboard", "success");
            return;
          }
        }
      }

      // Check if text is URL
      const text = e.clipboardData.getData("text")?.trim();
      if (text && (text.startsWith("http://") || text.startsWith("https://"))) {
        try {
          this.notify("Fetching image from clipboard link...", "info");
          const media = await fetchRemoteMedia(text);
          await this.addImportedMedia(media, center);
          this.notify("Pasted image from link", "success");
        } catch {
          // Fallback: create text note with pasted URL
          this.itemManager.addTextItem({
            x: center.x,
            y: center.y,
            text,
          });
        }
      }
    });
  }
}

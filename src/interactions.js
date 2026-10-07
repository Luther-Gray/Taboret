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
        } else {
          // If not already selected, select only this one
          if (!this.selectedItems.has(clickedItem)) {
            this.clearSelection();
            this.selectItem(clickedItem, false);
          }
        }

        // Prepare to drag all selected items
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
        this.isDraggingItems = false;
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

    if (this.selectedItems.size !== 1) {
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
        let offsetX = 0;
        for (const file of e.dataTransfer.files) {
          try {
            await this.importMediaFile(file, {
              x: dropPos.x + offsetX,
              y: dropPos.y,
            });
            offsetX += 40;
          } catch (err) {
            console.error(`Detailed error importing file "${file.name}":`, err);
            this.notify(
              `Failed importing ${file.name}: ${err?.message || "Invalid or unsupported media"}`,
              "error",
            );
          }
        }
        return;
      }

      // 2. Check web drop (Pinterest, Artstation, Google Images URLs or HTML)
      const url = this.extractDroppedWebUrl(e.dataTransfer);
      if (url) {
        try {
          this.notify("Downloading web reference...", "info");
          const media = await fetchRemoteMedia(url);
          await this.addImportedMedia(media, dropPos);
          this.notify("Added reference from web!", "success");
        } catch (err) {
          console.error("Failed fetching dropped web media:", err);
          this.notify("Could not download image from web link", "error");
        }
      }
    });
  }

  extractDroppedWebUrl(dataTransfer) {
    // Check uri-list
    const uriList = dataTransfer.getData("text/uri-list");
    if (uriList) {
      const urls = uriList
        .split("\n")
        .map((u) => u.trim())
        .filter(Boolean);
      for (const u of urls) {
        if (this.isLikelyMediaUrl(u)) return u;
      }
      if (urls.length > 0) return urls[0];
    }

    // Check HTML (Pinterest, Google Images, Artstation often enclose <img src="...">)
    const html = dataTransfer.getData("text/html");
    if (html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const img = doc.querySelector("img");
      if (img && img.src) {
        return img.src;
      }
      const video = doc.querySelector("video, source");
      if (video && video.src) {
        return video.src;
      }
    }

    // Check plain text
    const text = dataTransfer.getData("text/plain")?.trim();
    if (text && (text.startsWith("http://") || text.startsWith("https://"))) {
      return text;
    }

    return null;
  }

  isLikelyMediaUrl(url) {
    return /\.(png|jpe?g|webp|gif|svg|mp4|webm)($|\?)/i.test(url);
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

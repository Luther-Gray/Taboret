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
    this.gizmoMultiStartState = null;
    this.selectionBounds = null;

    // Callbacks
    this.onSelectionChanged = null;
    this.onTextEditRequested = null;
    this.onNotification = null;
    this.onProgress = null;

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

      // Check if clicked on Gizmo handle (single or multi-selection)
      if (this.selectedItems.size > 0) {
        const hitHandle = this.hitTestGizmoHandles(canvasPos);
        if (hitHandle) {
          this.startGizmoAction(hitHandle, canvasPos);
          e.preventDefault();
          return;
        }
      }

      // Check if clicked on a Group Header Tab
      const hitGroup = this.itemManager.hitTestGroupTab(canvasPos);
      if (hitGroup) {
        const groupItems = this.itemManager.getGroupItems(hitGroup.gid);
        this.clearSelection();
        for (const it of groupItems) {
          this.selectedItems.add(it);
        }
        this.updateGizmo();

        this.hasDraggedItems = false;
        this.isDraggingItems = true;
        this.dragStartMouse = { ...canvasPos };
        this.dragStartPositions.clear();
        for (const item of this.selectedItems) {
          this.dragStartPositions.set(item.id, { x: item.x, y: item.y });
        }
        e.preventDefault();
        return;
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
      if (
        this.activeGizmoAction &&
        (this.gizmoItemStartState || this.gizmoMultiStartState)
      ) {
        this.handleGizmoDrag(canvasPos, e.shiftKey);
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

      // Update hover cursor for gizmo handles
      if (this.selectedItems.size > 0 && !this.viewport.isPanning) {
        const handle = this.hitTestGizmoHandles(canvasPos);
        if (handle) {
          document.body.style.cursor = this.getCursorForHandle(handle);
          return;
        }
      }

      // Hover cursor for group tab
      if (
        !this.viewport.isPanning &&
        this.itemManager.hitTestGroupTab(canvasPos)
      ) {
        document.body.style.cursor = "pointer";
        return;
      }

      if (!this.viewport.isSpacePressed && !this.viewport.isPanning) {
        document.body.style.cursor = "default";
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (this.activeGizmoAction) {
        this.activeGizmoAction = null;
        this.gizmoItemStartState = null;
        this.gizmoMultiStartState = null;
        this.itemManager.updateGroupDisplay();
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

    // Double-click on group tab to rename, text note to edit, or empty canvas to create note
    canvasEl.addEventListener("dblclick", (e) => {
      const canvasPos = this.viewport.screenToCanvas(e.clientX, e.clientY);
      const hitGroup = this.itemManager.hitTestGroupTab(canvasPos);
      if (hitGroup) {
        const tab = hitGroup.bounds.tab;
        const screenPos = this.viewport.canvasToScreen(tab.x, tab.y);
        const screenW = tab.width * this.viewport.zoom;
        const screenH = tab.height * this.viewport.zoom;
        const currentTitle = hitGroup.group.title || "Group";

        if (this.onGroupRenameRequested) {
          this.onGroupRenameRequested(
            screenPos.x,
            screenPos.y,
            screenW,
            screenH,
            currentTitle,
            (newTitle) => {
              hitGroup.group.title = newTitle;
              this.itemManager.updateGroupDisplay();
              this.itemManager.notifyChanged();
            },
          );
        } else {
          const newTitle = window.prompt("Rename group:", currentTitle);
          if (newTitle !== null && newTitle.trim() !== "") {
            hitGroup.group.title = newTitle.trim();
            this.itemManager.updateGroupDisplay();
            this.itemManager.notifyChanged();
          }
        }
        return;
      }

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
      this.selectionBounds = null;
      return;
    }

    const handleSize = 10 / this.viewport.zoom;
    const rotateOffset = 30 / this.viewport.zoom;

    // Multi-selection: draw collective bounding box frame and 4 corner handles
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

      if (minX === Infinity) {
        this.selectionBounds = null;
        return;
      }

      const w = maxX - minX;
      const h = maxY - minY;
      this.selectionBounds = { x: minX, y: minY, width: w, height: h };

      this.gizmoGraphics.rect(minX, minY, w, h);
      this.gizmoGraphics.stroke({
        color: 0x38bdf8,
        width: 1.5 / this.viewport.zoom,
        alpha: 0.85,
      });

      // 4 Corner handles for collective scaling
      const corners = [
        { x: minX, y: minY }, // TL
        { x: maxX, y: minY }, // TR
        { x: maxX, y: maxY }, // BR
        { x: minX, y: maxY }, // BL
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
      this.selectionBounds = null;
      return;
    }

    const b = this.itemManager.getItemBounds(item);
    this.selectionBounds = { ...b, item };

    const rot = item.rotation || 0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const hw = (item.width * item.scaleX) / 2;
    const hh = (item.height * item.scaleY) / 2;

    // Helper to rotate local box coordinates into world space centered at item
    const toWorld = (lx, ly) => ({
      x: item.x + (lx * cos - ly * sin),
      y: item.y + (lx * sin + ly * cos),
    });

    const tl = toWorld(-hw, -hh);
    const tr = toWorld(hw, -hh);
    const br = toWorld(hw, hh);
    const bl = toWorld(-hw, hh);

    // Rotated outer bounding polygon
    this.gizmoGraphics.poly([
      tl.x,
      tl.y,
      tr.x,
      tr.y,
      br.x,
      br.y,
      bl.x,
      bl.y,
      tl.x,
      tl.y,
    ]);
    this.gizmoGraphics.stroke({
      color: 0x38bdf8,
      width: 2 / this.viewport.zoom,
    });

    // 4 Corner handles
    const corners = [tl, tr, br, bl];

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

    // Rotated rotation handle at midpoint of top edge
    const topCenter = toWorld(0, -hh);
    const rotHandle = toWorld(0, -hh - rotateOffset);

    // Stem line
    this.gizmoGraphics.moveTo(topCenter.x, topCenter.y);
    this.gizmoGraphics.lineTo(rotHandle.x, rotHandle.y);
    this.gizmoGraphics.stroke({
      color: 0x38bdf8,
      width: 1.5 / this.viewport.zoom,
    });

    // Rotation circle
    this.gizmoGraphics.circle(rotHandle.x, rotHandle.y, handleSize / 1.5);
    this.gizmoGraphics.fill({ color: 0xffffff });
    this.gizmoGraphics.stroke({
      color: 0x0284c7,
      width: 1.5 / this.viewport.zoom,
    });
  }

  hitTestGizmoHandles(canvasPos) {
    if (!this.selectionBounds || this.selectedItems.size === 0) return null;
    const threshold = 16 / this.viewport.zoom;
    const rotateOffset = 30 / this.viewport.zoom;

    // Single item: hit-test in item's local rotated coordinate space
    if (this.selectedItems.size === 1) {
      const item = Array.from(this.selectedItems)[0];
      const rot = item.rotation || 0;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const hw = (item.width * item.scaleX) / 2;
      const hh = (item.height * item.scaleY) / 2;

      // Unrotate canvasPos into local space centered at item
      const dx = canvasPos.x - item.x;
      const dy = canvasPos.y - item.y;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;

      // Rotation handle at (0, -hh - rotateOffset)
      if (Math.hypot(lx, ly - (-hh - rotateOffset)) <= threshold) {
        return "rotate";
      }

      // Corner handles: TL, TR, BR, BL
      if (Math.hypot(lx - -hw, ly - -hh) <= threshold) return "scale-tl";
      if (Math.hypot(lx - hw, ly - -hh) <= threshold) return "scale-tr";
      if (Math.hypot(lx - hw, ly - hh) <= threshold) return "scale-br";
      if (Math.hypot(lx - -hw, ly - hh) <= threshold) return "scale-bl";

      return null;
    }

    // Multi-selection: axis-aligned bounding box handles
    const b = this.selectionBounds;
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
        return "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67' stroke='%23000' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67' stroke='%2338bdf8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\") 12 12, grab";
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

  startGizmoAction(handle, mouseCanvasPos) {
    this.activeGizmoAction = handle;
    this.gizmoStartMouse = { ...mouseCanvasPos };

    if (this.selectedItems.size === 1) {
      const item = Array.from(this.selectedItems)[0];
      const startAngle = Math.atan2(
        mouseCanvasPos.y - item.y,
        mouseCanvasPos.x - item.x,
      );
      this.gizmoItemStartState = {
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        scaleX: item.scaleX,
        scaleY: item.scaleY,
        rotation: item.rotation,
        startAngle,
        itemBounds: this.itemManager.getItemBounds(item),
      };
      this.gizmoMultiStartState = null;
    } else {
      const b = this.selectionBounds;
      let pivot = { x: b.x, y: b.y };
      if (handle === "scale-br") {
        pivot = { x: b.x, y: b.y }; // TL
      } else if (handle === "scale-bl") {
        pivot = { x: b.x + b.width, y: b.y }; // TR
      } else if (handle === "scale-tr") {
        pivot = { x: b.x, y: b.y + b.height }; // BL
      } else if (handle === "scale-tl") {
        pivot = { x: b.x + b.width, y: b.y + b.height }; // BR
      }

      this.gizmoMultiStartState = {
        bounds: { ...b },
        pivot,
        initialDist: Math.hypot(
          mouseCanvasPos.x - pivot.x,
          mouseCanvasPos.y - pivot.y,
        ),
        items: Array.from(this.selectedItems).map((it) => ({
          item: it,
          x: it.x,
          y: it.y,
          scaleX: it.scaleX,
          scaleY: it.scaleY,
        })),
      };
      this.gizmoItemStartState = null;
    }
  }

  handleGizmoDrag(currentPos, shiftKey = false) {
    if (this.gizmoMultiStartState) {
      const { pivot, initialDist, items } = this.gizmoMultiStartState;
      if (initialDist <= 0) return;

      const currentDist = Math.hypot(
        currentPos.x - pivot.x,
        currentPos.y - pivot.y,
      );
      const factor = Math.max(0.05, currentDist / initialDist);

      for (const entry of items) {
        const newX = pivot.x + (entry.x - pivot.x) * factor;
        const newY = pivot.y + (entry.y - pivot.y) * factor;
        this.itemManager.setItemPosition(entry.item, newX, newY);
        this.itemManager.setItemScale(
          entry.item,
          entry.scaleX * factor,
          entry.scaleY * factor,
        );
      }
      this.updateGizmo();
      return;
    }

    const item = Array.from(this.selectedItems)[0];
    if (!item || !this.gizmoItemStartState) return;

    const start = this.gizmoItemStartState;

    if (this.activeGizmoAction === "rotate") {
      const currentAngle = Math.atan2(
        currentPos.y - item.y,
        currentPos.x - item.x,
      );
      const deltaAngle = currentAngle - start.startAngle;
      let finalAngle = start.rotation + deltaAngle;
      if (shiftKey) {
        // Snap to 15-degree increments when Shift is held
        const step = Math.PI / 12;
        finalAngle = Math.round(finalAngle / step) * step;
      }
      this.itemManager.setItemRotation(item, finalAngle);
      this.updateGizmo();
      return;
    }

    // Single item scaling
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
      if (e.key.toLowerCase() === "h" && !e.ctrlKey && !e.metaKey) {
        for (const item of this.selectedItems) {
          this.itemManager.flipItemHorizontal(item);
        }
        this.updateGizmo();
        return;
      }

      // Flip Vertical: V (guarded against Cmd+V on macOS)
      if (e.key.toLowerCase() === "v" && !e.ctrlKey && !e.metaKey) {
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
      if (e.key.toLowerCase() === "t" && !e.ctrlKey && !e.metaKey) {
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

      // Reset View / Frame All: F (BeeRef standard) or Z
      if (
        (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "z") &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
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
    // 1. Native Tauri Drag & Drop for OS file drops on Linux / WebKitGTK / Wayland
    if (
      typeof window !== "undefined" &&
      Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__)
    ) {
      import("@tauri-apps/api/webview")
        .then(({ getCurrentWebview }) => {
          getCurrentWebview()
            .onDragDropEvent(async (event) => {
              if (event.payload.type === "drop") {
                const paths = event.payload.paths;
                if (!paths || paths.length === 0) return;

                const dpr = window.devicePixelRatio || 1;
                const screenX = (event.payload.position?.x ?? 0) / dpr;
                const screenY = (event.payload.position?.y ?? 0) / dpr;
                const dropPos = this.viewport.screenToCanvas(screenX, screenY);

                await this.importFileList(paths, dropPos);
              }
            })
            .catch((err) => {
              console.warn("Failed to attach Tauri onDragDropEvent:", err);
            });
        })
        .catch((e) => {
          console.warn("Could not import Tauri webview API:", e);
        });
    }

    // 2. HTML5 Drag & Drop (for web references: Pinterest, Artstation, Cara, Google Images)
    const dropZone = window;

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });

    dropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      const dropPos = this.viewport.screenToCanvas(e.clientX, e.clientY);

      // Check local files (works in web browsers)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        await this.importFileList(Array.from(e.dataTransfer.files), dropPos);
        return;
      }

      // Check web drop (Pinterest, Artstation, Cara, Google Images URLs or HTML)
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

  async importFileList(files, dropPos) {
    const importedItems = [];
    let curX = dropPos.x;
    let curY = dropPos.y;
    let rowMaxH = 0;
    const spacing = 24;
    const maxCols = Math.ceil(Math.sqrt(files.length));
    let col = 0;

    const progress =
      files.length > 1 && this.onProgress
        ? this.onProgress(`Importing ${files.length} items...`, files.length)
        : null;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const displayName =
          typeof file === "string"
            ? file.split(/[/\\]/).pop()
            : file?.name || `Item ${i + 1}`;

        if (progress) {
          progress.update(i, files.length, `Importing "${displayName}"...`);
        }

        try {
          const media = await readLocalFile(file);
          const isVideo =
            media.mimeType?.startsWith("video/") ||
            /\.(mp4|webm)$/i.test(media.filename);

          const safeFilename = `media/${Date.now()}_${media.filename
            .replace(/^[/\\]+/, "")
            .split(/[/\\]/)
            .pop()}`;

          let item;
          if (isVideo) {
            try {
              item = await this.itemManager.addVideoItem(
                {
                  dataUrl: media.dataUrl,
                  filename: safeFilename,
                  sourcePath: media.sourcePath,
                  x: curX,
                  y: curY,
                },
                { skipNotify: true },
              );
            } catch (vidErr) {
              console.warn(
                "Video import failed, falling back to image:",
                vidErr,
              );
              item = await this.itemManager.addImageItem(
                {
                  dataUrl: media.dataUrl,
                  filename: safeFilename,
                  sourcePath: media.sourcePath,
                  x: curX,
                  y: curY,
                },
                { skipNotify: true },
              );
            }
          } else {
            item = await this.itemManager.addImageItem(
              {
                dataUrl: media.dataUrl,
                filename: safeFilename,
                sourcePath: media.sourcePath,
                x: curX,
                y: curY,
              },
              { skipNotify: true },
            );
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

          if (progress) {
            progress.update(
              i + 1,
              files.length,
              `Imported "${displayName}" (${i + 1}/${files.length})`,
            );
          }

          // Yield to browser event loop between batch items
          if (files.length > 1) {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        } catch (err) {
          if (progress) {
            progress.update(i + 1, files.length);
          }
          console.error(`Detailed error importing file "${displayName}":`, err);
          this.notify(
            `Failed importing ${displayName}: ${err?.message || "Invalid or unsupported media"}`,
            "error",
          );
        }
      }
    } finally {
      if (progress) {
        progress.finish(`Imported ${importedItems.length} items`);
      }
    }

    if (importedItems.length > 0) {
      this.itemManager.updateGroupDisplay();
      this.itemManager.notifyChanged();
      this.clearSelection();
      for (const it of importedItems) {
        this.selectedItems.add(it);
        this.itemManager.setItemSelected(it, true);
      }
      this.updateGizmo();
      if (this.onSelectionChanged) {
        this.onSelectionChanged(Array.from(this.selectedItems));
      }
    }
  }

  /**
   * Extracts all candidate URLs from a drag-and-drop DataTransfer, ordered by priority.
   * Returns an array so the caller can try each in sequence (the first to succeed wins).
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

    // 1. Check text/html for img/video sources (richest data from Pinterest, Artstation, Cara, etc.)
    const html = dataTransfer.getData("text/html");
    let pinPageUrl = null;

    if (html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      // Extract all img elements (Pinterest pins are often nested inside container divs)
      const imgs = doc.querySelectorAll("img");
      for (const img of imgs) {
        const srcset = img.getAttribute("srcset");
        if (srcset) {
          const cdnCandidates = srcset
            .split(",")
            .map((c) => c.trim().split(" ")[0])
            .filter(Boolean);
          // Try highest-res srcset entries first
          for (const c of cdnCandidates.reverse()) {
            addUrl(c);
            if (c.includes("i.pinimg.com")) {
              addUrl(c.replace(/\/(236x|474x|originals)\//, "/736x/"));
              addUrl(c.replace(/\/(236x|474x|736x)\//, "/1200x/"));
            }
          }
        }

        const src = img.getAttribute("src");
        if (src) {
          addUrl(src);
          if (src.includes("i.pinimg.com")) {
            addUrl(src.replace(/\/(236x|474x|originals)\//, "/736x/"));
            addUrl(src.replace(/\/(236x|474x|736x)\//, "/1200x/"));
          }
        }
      }

      // Extract video sources
      const videos = doc.querySelectorAll("video, source");
      for (const v of videos) {
        if (v.src) addUrl(v.src);
      }

      // Check anchors for Pinterest pin page URL or direct media links
      const anchors = doc.querySelectorAll("a[href]");
      for (const a of anchors) {
        const rawHref = a.getAttribute("href") || "";
        let fullHref = rawHref;
        if (rawHref.startsWith("/pin/")) {
          fullHref = `https://www.pinterest.com${rawHref}`;
        }
        if (
          fullHref.includes("pinterest.com/pin/") ||
          fullHref.includes("pin.it/")
        ) {
          if (!pinPageUrl) pinPageUrl = fullHref;
        } else if (this.isLikelyMediaUrl(fullHref)) {
          addUrl(fullHref);
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
          addUrl(u);
          addUrl(u.replace(/\/(236x|474x|originals)\//, "/736x/"));
          addUrl(u.replace(/\/(236x|474x|736x)\//, "/1200x/"));
        } else if (this.isLikelyMediaUrl(resolved)) {
          addUrl(resolved);
        } else if (u.includes("pinterest.com/pin/") || u.includes("pin.it/")) {
          if (!pinPageUrl) pinPageUrl = u;
        } else {
          addUrl(resolved);
        }
      }
    }

    // 3. Plain text URL fallback
    const text = dataTransfer.getData("text/plain")?.trim();
    if (text && (text.startsWith("http://") || text.startsWith("https://"))) {
      if (text.includes("pinterest.com/pin/") || text.includes("pin.it/")) {
        if (!pinPageUrl) pinPageUrl = text;
      } else {
        addUrl(text);
        if (text.includes("i.pinimg.com")) {
          addUrl(text.replace(/\/(236x|474x|originals)\//, "/736x/"));
          addUrl(text.replace(/\/(236x|474x|736x)\//, "/1200x/"));
        }
      }
    }

    // 4. Add Pinterest page URL (tried if direct CDN URLs return 403 hotlink blocked)
    if (pinPageUrl) addUrl(pinPageUrl);

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
    let lastMiddleClickTime = 0;
    window.addEventListener(
      "mousedown",
      (e) => {
        if (e.button === 1) lastMiddleClickTime = Date.now();
      },
      true,
    );
    window.addEventListener(
      "mouseup",
      (e) => {
        if (e.button === 1) lastMiddleClickTime = Date.now();
      },
      true,
    );
    window.addEventListener(
      "auxclick",
      (e) => {
        if (e.button === 1) {
          lastMiddleClickTime = Date.now();
          e.preventDefault();
        }
      },
      true,
    );

    window.addEventListener("paste", async (e) => {
      // Prevent Linux primary-selection paste on middle click / panning
      if (this.viewport.isPanning || Date.now() - lastMiddleClickTime < 450) {
        e.preventDefault();
        return;
      }

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

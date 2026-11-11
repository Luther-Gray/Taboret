import * as PIXI from "pixi.js";

/**
 * Unique ID generator
 */
export function generateId(prefix = "item") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Item Manager for Taboret.
 * Handles rendering, positioning, flipping, rotation, grouping, and Beeref-style alignment.
 */
export class ItemManager {
  constructor(canvasContainer) {
    this.canvasContainer = canvasContainer;
    this.items = new Map(); // id -> item object
    this.groups = new Map(); // id -> group object { id, title, color }
    this.groupGraphics = new PIXI.Graphics();
    this.groupGraphics.eventMode = "none";
    this.canvasContainer.addChild(this.groupGraphics);
    this.nextZIndex = 1;
    this.onItemsChanged = null;
  }

  async addImageItem(data, options = {}) {
    const id = data.id || generateId("img");
    const dataUrl = data.dataUrl;

    let width = data.width;
    let height = data.height;
    let texture;

    // Decode image to ensure valid data and natural dimensions without freezing on WebKitGTK
    await new Promise((resolve) => {
      const img = new Image();
      let finished = false;
      const done = () => {
        if (!finished) {
          finished = true;
          width = width || img.naturalWidth || 400;
          height = height || img.naturalHeight || 300;

          // Protect GPU VRAM and Mesa EGL from giant textures (e.g. 8000px raw photos)
          const maxDim = 4096;
          let source = img;
          if (img.naturalWidth > maxDim || img.naturalHeight > maxDim) {
            try {
              const scale = Math.min(
                maxDim / img.naturalWidth,
                maxDim / img.naturalHeight,
              );
              const canvas = document.createElement("canvas");
              canvas.width = Math.round(img.naturalWidth * scale);
              canvas.height = Math.round(img.naturalHeight * scale);
              const ctx = canvas.getContext("2d");
              if (ctx) {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                source = canvas;
              }
            } catch (downscaleErr) {
              console.warn("Could not downscale giant image:", downscaleErr);
            }
          }

          try {
            texture = PIXI.Texture.from(source);
          } catch {
            texture = PIXI.Texture.from(dataUrl);
          }
          resolve();
        }
      };

      img.onload = done;
      img.onerror = () => {
        if (!finished) {
          finished = true;
          try {
            texture = PIXI.Texture.from(dataUrl);
          } catch {
            texture = PIXI.Texture.WHITE;
          }
          width = width || 400;
          height = height || 300;
          resolve();
        }
      };

      // 2.5s safety timeout to prevent WebKitGTK decode hangs
      setTimeout(done, 2500);

      img.src = dataUrl;
      if (img.complete && img.naturalWidth > 0) {
        done();
      }
    });

    const item = {
      id,
      type: data.type || "image",
      filename: data.filename || `media/image_${Date.now()}.png`,
      dataUrl,
      sourcePath: data.sourcePath || null,
      x: data.x ?? 0,
      y: data.y ?? 0,
      width,
      height,
      scaleX: data.scaleX ?? 1,
      scaleY: data.scaleY ?? 1,
      rotation: data.rotation ?? 0,
      flipH: Boolean(data.flipH),
      flipV: Boolean(data.flipV),
      zIndex: data.zIndex ?? this.nextZIndex++,
      groupId: data.groupId || null,
      container: null,
      sprite: null,
      selectionOutline: null,
      selected: false,
    };

    this.createDisplayObject(item, texture);
    this.items.set(id, item);
    if (!options.skipNotify) {
      this.updateGroupDisplay();
      this.notifyChanged();
    }
    return item;
  }

  async addVideoItem(data, options = {}) {
    const id = data.id || generateId("vid");
    const dataUrl = data.dataUrl;

    const video = document.createElement("video");
    // CRITICAL: Configure mute attributes BEFORE assigning .src so WebKitGTK's
    // GStreamer backend does not attempt to construct an audio sink pipeline
    // (which crashes WebKitWebProcess if autoaudiosink is missing on Linux).
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.playsInline = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.loop = true;
    video.crossOrigin = "anonymous";

    try {
      video.src = dataUrl;
      await new Promise((resolve) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => resolve();
        setTimeout(resolve, 1500);
      });

      try {
        await video.play();
      } catch {
        // Autoplay might be muted/blocked; handled gracefully
      }
    } catch (e) {
      console.warn("Video element setup warning:", e);
    }

    const width = data.width || video.videoWidth || 640;
    const height = data.height || video.videoHeight || 360;

    let texture;
    try {
      texture = PIXI.Texture.from(video);
    } catch {
      texture = PIXI.Texture.WHITE;
    }

    const item = {
      id,
      type: "video",
      videoElement: video,
      filename: data.filename || `media/video_${Date.now()}.mp4`,
      dataUrl,
      sourcePath: data.sourcePath || null,
      x: data.x ?? 0,
      y: data.y ?? 0,
      width,
      height,
      scaleX: data.scaleX ?? 1,
      scaleY: data.scaleY ?? 1,
      rotation: data.rotation ?? 0,
      flipH: Boolean(data.flipH),
      flipV: Boolean(data.flipV),
      zIndex: data.zIndex ?? this.nextZIndex++,
      groupId: data.groupId || null,
      container: null,
      sprite: null,
      selectionOutline: null,
      selected: false,
    };

    this.createDisplayObject(item, texture);
    this.items.set(id, item);
    if (!options.skipNotify) {
      this.updateGroupDisplay();
      this.notifyChanged();
    }
    return item;
  }

  addTextItem(data) {
    const id = data.id || generateId("text");
    const textContent = data.text || "Double click to edit note...";
    const fontSize = data.fontSize || 20;
    const textColor = data.textColor || "#ffffff";
    const bgColor = data.bgColor || "#252528";

    const item = {
      id,
      type: "text",
      text: textContent,
      fontSize,
      textColor,
      bgColor,
      filename: `note_${id}.txt`,
      x: data.x ?? 0,
      y: data.y ?? 0,
      width: data.width || 260,
      height: data.height || 120,
      scaleX: data.scaleX ?? 1,
      scaleY: data.scaleY ?? 1,
      rotation: data.rotation ?? 0,
      flipH: Boolean(data.flipH),
      flipV: Boolean(data.flipV),
      zIndex: data.zIndex ?? this.nextZIndex++,
      groupId: data.groupId || null,
      container: null,
      textObj: null,
      bgCard: null,
      selectionOutline: null,
      selected: false,
    };

    this.createTextDisplayObject(item);
    this.items.set(id, item);
    this.updateGroupDisplay();
    this.notifyChanged();
    return item;
  }

  createDisplayObject(item, texture) {
    const container = new PIXI.Container();
    container.position.set(item.x, item.y);
    container.rotation = item.rotation;
    container.zIndex = item.zIndex;

    const sprite = new PIXI.Sprite(texture);
    sprite.width = item.width;
    sprite.height = item.height;
    // Set anchor to center for natural pivot during scale & rotate
    sprite.anchor.set(0.5, 0.5);
    sprite.scale.set(
      item.scaleX * (item.flipH ? -1 : 1),
      item.scaleY * (item.flipV ? -1 : 1),
    );

    const selectionOutline = new PIXI.Graphics();
    selectionOutline.visible = false;

    container.addChild(sprite);
    container.addChild(selectionOutline);

    container.eventMode = "static";
    container.cursor = "pointer";

    item.container = container;
    item.sprite = sprite;
    item.selectionOutline = selectionOutline;

    this.canvasContainer.addChild(container);
    this.updateSelectionOutline(item);
  }

  createTextDisplayObject(item) {
    const container = new PIXI.Container();
    container.position.set(item.x, item.y);
    container.rotation = item.rotation;
    container.zIndex = item.zIndex;

    const bgCard = new PIXI.Graphics();
    const textObj = new PIXI.Text({
      text: item.text,
      style: {
        fontFamily: "Inter, sans-serif",
        fontSize: item.fontSize,
        fill: item.textColor,
        wordWrap: true,
        wordWrapWidth: item.width - 24,
      },
    });

    const padding = 12;
    const cardWidth = Math.max(item.width, textObj.width + padding * 2);
    const cardHeight = Math.max(item.height, textObj.height + padding * 2);
    item.width = cardWidth;
    item.height = cardHeight;

    bgCard.roundRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight, 8);
    bgCard.fill({ color: item.bgColor, alpha: 0.95 });
    bgCard.stroke({ color: "#44444c", width: 1.5 });

    textObj.anchor.set(0.5, 0.5);

    const selectionOutline = new PIXI.Graphics();
    selectionOutline.visible = false;

    container.addChild(bgCard);
    container.addChild(textObj);
    container.addChild(selectionOutline);

    container.scale.set(
      item.scaleX * (item.flipH ? -1 : 1),
      item.scaleY * (item.flipV ? -1 : 1),
    );

    container.eventMode = "static";
    container.cursor = "pointer";

    item.container = container;
    item.bgCard = bgCard;
    item.textObj = textObj;
    item.selectionOutline = selectionOutline;

    this.canvasContainer.addChild(container);
    this.updateSelectionOutline(item);
  }

  updateTextContent(item, newText) {
    if (item.type !== "text" || !item.textObj) return;
    item.text = newText;
    item.textObj.text = newText;

    const padding = 12;
    const cardWidth = Math.max(160, item.textObj.width + padding * 2);
    const cardHeight = Math.max(60, item.textObj.height + padding * 2);
    item.width = cardWidth;
    item.height = cardHeight;

    item.bgCard.clear();
    item.bgCard.roundRect(
      -cardWidth / 2,
      -cardHeight / 2,
      cardWidth,
      cardHeight,
      8,
    );
    item.bgCard.fill({ color: item.bgColor, alpha: 0.95 });
    item.bgCard.stroke({ color: "#44444c", width: 1.5 });

    this.updateSelectionOutline(item);
    this.updateGroupDisplay();
    this.notifyChanged();
  }

  setItemPosition(item, x, y) {
    item.x = x;
    item.y = y;
    if (item.container) {
      item.container.position.set(x, y);
    }
  }

  setItemScale(item, scaleX, scaleY) {
    item.scaleX = Math.max(0.05, Math.abs(scaleX));
    item.scaleY = Math.max(0.05, Math.abs(scaleY));
    this.applyTransform(item);
  }

  setItemRotation(item, rotation) {
    item.rotation = rotation;
    if (item.container) {
      item.container.rotation = rotation;
    }
  }

  flipItemHorizontal(item) {
    item.flipH = !item.flipH;
    this.applyTransform(item);
    this.notifyChanged();
  }

  flipItemVertical(item) {
    item.flipV = !item.flipV;
    this.applyTransform(item);
    this.notifyChanged();
  }

  applyTransform(item) {
    if (item.type === "text") {
      item.container.scale.set(
        item.scaleX * (item.flipH ? -1 : 1),
        item.scaleY * (item.flipV ? -1 : 1),
      );
    } else if (item.sprite) {
      item.sprite.scale.set(
        item.scaleX * (item.flipH ? -1 : 1),
        item.scaleY * (item.flipV ? -1 : 1),
      );
    }
    this.updateSelectionOutline(item);
    this.updateGroupDisplay();
  }

  updateSelectionOutline(item) {
    if (!item || !item.selectionOutline || item.selectionOutline.destroyed)
      return;
    const g = item.selectionOutline;
    try {
      g.clear();

      if (!item.selected) {
        g.visible = false;
        return;
      }

      g.visible = true;
      const w = item.width * (item.type === "text" ? 1 : item.scaleX);
      const h = item.height * (item.type === "text" ? 1 : item.scaleY);

      // Glowing subtle neon border around selected element
      g.rect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4);
      g.stroke({ color: 0x3b82f6, width: 2.5, alpha: 0.9 });
    } catch (e) {
      console.warn("Could not update selection outline:", e);
    }
  }

  setItemSelected(item, isSelected) {
    if (!item) return;
    item.selected = isSelected;
    this.updateSelectionOutline(item);
  }

  bringToFront(item) {
    if (!item) return;
    item.zIndex = this.nextZIndex++;
    if (item.container && !item.container.destroyed) {
      item.container.zIndex = item.zIndex;
    }
    this.notifyChanged();
  }

  sendToBack(item) {
    if (!item) return;
    const minZ = Math.min(
      ...Array.from(this.items.values()).map((i) => i.zIndex),
    );
    item.zIndex = minZ - 1;
    if (item.container && !item.container.destroyed) {
      item.container.zIndex = item.zIndex;
    }
    this.notifyChanged();
  }

  removeItem(item) {
    if (!item) return;

    if (item.videoElement) {
      try {
        item.videoElement.pause();
        item.videoElement.src = "";
        item.videoElement.load();
      } catch (e) {
        console.warn("Error pausing video element:", e);
      }
      item.videoElement = null;
    }

    if (item.container) {
      try {
        if (this.canvasContainer.children.includes(item.container)) {
          this.canvasContainer.removeChild(item.container);
        }
        item.container.destroy({ children: true });
      } catch (e) {
        console.warn("Error destroying container:", e);
      }
      item.container = null;
      item.sprite = null;
      item.selectionOutline = null;
    }

    this.items.delete(item.id);
    this.updateGroupDisplay();
    this.notifyChanged();
  }

  // ---------------- GROUPS ----------------
  createGroup(itemIds, title = "Group") {
    if (!itemIds || itemIds.length === 0) return null;
    const groupId = generateId("group");
    const colors = [0x3b82f6, 0x10b981, 0x8b5cf6, 0xf59e0b, 0xec4899, 0x06b6d4];
    const color = colors[this.groups.size % colors.length];

    this.groups.set(groupId, { id: groupId, title, color });

    for (const id of itemIds) {
      const item = this.items.get(id);
      if (item) {
        item.groupId = groupId;
      }
    }

    this.updateGroupDisplay();
    this.notifyChanged();
    return groupId;
  }

  ungroup(itemIds) {
    for (const id of itemIds) {
      const item = this.items.get(id);
      if (item) {
        item.groupId = null;
      }
    }

    // Clean up empty groups
    for (const [gid] of this.groups) {
      const hasMembers = Array.from(this.items.values()).some(
        (i) => i.groupId === gid,
      );
      if (!hasMembers) {
        this.groups.delete(gid);
      }
    }

    this.updateGroupDisplay();
    this.notifyChanged();
  }

  getGroupItems(groupId) {
    return Array.from(this.items.values()).filter((i) => i.groupId === groupId);
  }

  updateGroupDisplay() {
    this.groupGraphics.clear();

    for (const [gid, group] of this.groups) {
      const groupItems = this.getGroupItems(gid);
      if (groupItems.length === 0) continue;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const item of groupItems) {
        const bounds = this.getItemBounds(item);
        minX = Math.min(minX, bounds.x);
        minY = Math.min(minY, bounds.y);
        maxX = Math.max(maxX, bounds.x + bounds.width);
        maxY = Math.max(maxY, bounds.y + bounds.height);
      }

      const padding = 20;
      const gx = minX - padding;
      const gy = minY - padding;
      const gw = maxX - minX + padding * 2;
      const gh = maxY - minY + padding * 2;

      // Group translucent background card
      this.groupGraphics.roundRect(gx, gy, gw, gh, 12);
      this.groupGraphics.fill({ color: group.color, alpha: 0.08 });
      this.groupGraphics.stroke({
        color: group.color,
        width: 1.5,
        alpha: 0.4,
      });

      // Group title header tab
      const tabWidth = Math.min(gw, 140);
      const tabHeight = 24;
      this.groupGraphics.roundRect(
        gx,
        gy - tabHeight + 4,
        tabWidth,
        tabHeight,
        6,
      );
      this.groupGraphics.fill({ color: group.color, alpha: 0.8 });
    }
  }

  // ---------------- ALIGNMENT & SORTING (BeeRef Parity) ----------------
  getItemBounds(item) {
    const w = item.width * item.scaleX;
    const h = item.height * item.scaleY;
    // Bounding box approximation centered at (item.x, item.y)
    return {
      x: item.x - w / 2,
      y: item.y - h / 2,
      width: w,
      height: h,
    };
  }

  alignItems(selectedItems, mode) {
    if (!selectedItems || selectedItems.length < 2) return;

    const boundsList = selectedItems.map((item) => ({
      item,
      ...this.getItemBounds(item),
    }));

    const minX = Math.min(...boundsList.map((b) => b.x));
    const maxX = Math.max(...boundsList.map((b) => b.x + b.width));
    const minY = Math.min(...boundsList.map((b) => b.y));
    const maxY = Math.max(...boundsList.map((b) => b.y + b.height));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // Distribute modes: space items evenly between the outermost items
    if (mode === "distribute-h") {
      if (boundsList.length < 3) return; // need 3+ to distribute
      const sorted = [...boundsList].sort((a, b) => a.x - b.x);
      const totalWidth = sorted.reduce((sum, b) => sum + b.width, 0);
      const span = maxX - minX;
      // Ensure positive gap: if items overlap, use clean 24px spacing instead of negative gap
      const calculatedGap = (span - totalWidth) / (sorted.length - 1);
      const gap = Math.max(24, calculatedGap);
      let curX = minX;
      for (const b of sorted) {
        this.setItemPosition(b.item, curX + b.width / 2, b.item.y);
        curX += b.width + gap;
      }
      this.updateGroupDisplay();
      this.notifyChanged();
      return;
    }

    if (mode === "distribute-v") {
      if (boundsList.length < 3) return; // need 3+ to distribute
      const sorted = [...boundsList].sort((a, b) => a.y - b.y);
      const totalHeight = sorted.reduce((sum, b) => sum + b.height, 0);
      const span = maxY - minY;
      const calculatedGap = (span - totalHeight) / (sorted.length - 1);
      const gap = Math.max(24, calculatedGap);
      let curY = minY;
      for (const b of sorted) {
        this.setItemPosition(b.item, b.item.x, curY + b.height / 2);
        curY += b.height + gap;
      }
      this.updateGroupDisplay();
      this.notifyChanged();
      return;
    }

    for (const b of boundsList) {
      const item = b.item;
      switch (mode) {
        case "left":
          this.setItemPosition(item, minX + b.width / 2, item.y);
          break;
        case "right":
          this.setItemPosition(item, maxX - b.width / 2, item.y);
          break;
        case "center-h":
          this.setItemPosition(item, centerX, item.y);
          break;
        case "top":
          this.setItemPosition(item, item.x, minY + b.height / 2);
          break;
        case "bottom":
          this.setItemPosition(item, item.x, maxY - b.height / 2);
          break;
        case "center-v":
          this.setItemPosition(item, item.x, centerY);
          break;
      }
    }

    this.updateGroupDisplay();
    this.notifyChanged();
  }

  /**
   * Arranges selected items into an optimal grid/table with even spacing (like BeeRef Arrange).
   */
  arrangeInGrid(selectedItems, spacing = 24) {
    if (!selectedItems || selectedItems.length < 2) return;

    // Calculate grid columns
    const count = selectedItems.length;
    const cols = Math.ceil(Math.sqrt(count));

    // Sort by current Y then X for logical arrangement order
    const sorted = [...selectedItems].sort((a, b) => {
      if (Math.abs(a.y - b.y) > 40) return a.y - b.y;
      return a.x - b.x;
    });

    const startX = Math.min(...sorted.map((i) => this.getItemBounds(i).x));
    const startY = Math.min(...sorted.map((i) => this.getItemBounds(i).y));

    let currentX = startX;
    let currentY = startY;
    let rowMaxHeight = 0;

    sorted.forEach((item, index) => {
      const bounds = this.getItemBounds(item);

      if (index > 0 && index % cols === 0) {
        currentX = startX;
        currentY += rowMaxHeight + spacing;
        rowMaxHeight = 0;
      }

      this.setItemPosition(
        item,
        currentX + bounds.width / 2,
        currentY + bounds.height / 2,
      );

      currentX += bounds.width + spacing;
      rowMaxHeight = Math.max(rowMaxHeight, bounds.height);
    });

    this.updateGroupDisplay();
    this.notifyChanged();
  }

  /**
   * Arranges selected items in a single horizontal row with consistent spacing (BeeRef Arrange Horizontal).
   * Centered vertically along the collective bounding box center.
   */
  arrangeHorizontal(selectedItems, spacing = 24) {
    if (!selectedItems || selectedItems.length < 2) return;

    const sorted = [...selectedItems].sort((a, b) => a.x - b.x);
    const boundsList = sorted.map((item) => ({
      item,
      ...this.getItemBounds(item),
    }));

    const startX = Math.min(...boundsList.map((b) => b.x));
    const minY = Math.min(...boundsList.map((b) => b.y));
    const maxY = Math.max(...boundsList.map((b) => b.y + b.height));
    const centerY = (minY + maxY) / 2;

    let currentX = startX;
    for (const b of boundsList) {
      this.setItemPosition(b.item, currentX + b.width / 2, centerY);
      currentX += b.width + spacing;
    }

    this.updateGroupDisplay();
    this.notifyChanged();
  }

  /**
   * Arranges selected items in a single vertical column with consistent spacing (BeeRef Arrange Vertical).
   * Centered horizontally along the collective bounding box center.
   */
  arrangeVertical(selectedItems, spacing = 24) {
    if (!selectedItems || selectedItems.length < 2) return;

    const sorted = [...selectedItems].sort((a, b) => a.y - b.y);
    const boundsList = sorted.map((item) => ({
      item,
      ...this.getItemBounds(item),
    }));

    const startY = Math.min(...boundsList.map((b) => b.y));
    const minX = Math.min(...boundsList.map((b) => b.x));
    const maxX = Math.max(...boundsList.map((b) => b.x + b.width));
    const centerX = (minX + maxX) / 2;

    let currentY = startY;
    for (const b of boundsList) {
      this.setItemPosition(b.item, centerX, currentY + b.height / 2);
      currentY += b.height + spacing;
    }

    this.updateGroupDisplay();
    this.notifyChanged();
  }

  /**
   * Normalize heights or widths of selected items to match reference item (BeeRef feature).
   */
  normalizeSizes(selectedItems, dimension = "height") {
    if (!selectedItems || selectedItems.length < 2) return;
    const targetItem = selectedItems[0];

    if (dimension === "height") {
      const targetH = targetItem.height * targetItem.scaleY;
      for (let i = 1; i < selectedItems.length; i++) {
        const item = selectedItems[i];
        const newScale = targetH / item.height;
        this.setItemScale(item, newScale, newScale);
      }
    } else {
      const targetW = targetItem.width * targetItem.scaleX;
      for (let i = 1; i < selectedItems.length; i++) {
        const item = selectedItems[i];
        const newScale = targetW / item.width;
        this.setItemScale(item, newScale, newScale);
      }
    }

    this.updateGroupDisplay();
    this.notifyChanged();
  }

  getOverallBounds() {
    if (this.items.size === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const item of this.items.values()) {
      const b = this.getItemBounds(item);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  notifyChanged() {
    if (this.onItemsChanged) {
      this.onItemsChanged();
    }
  }

  clear() {
    for (const item of this.items.values()) {
      if (item.videoElement) {
        item.videoElement.pause();
        item.videoElement.src = "";
      }
      if (item.container) {
        this.canvasContainer.removeChild(item.container);
        item.container.destroy({ children: true });
      }
    }
    this.items.clear();
    this.groups.clear();
    this.groupGraphics.clear();
    this.nextZIndex = 1;
    this.notifyChanged();
  }

  serialize() {
    const itemsList = Array.from(this.items.values()).map((i) => ({
      id: i.id,
      type: i.type,
      file: i.filename,
      x: Math.round(i.x),
      y: Math.round(i.y),
      width: Math.round(i.width),
      height: Math.round(i.height),
      scaleX: Number(i.scaleX.toFixed(4)),
      scaleY: Number(i.scaleY.toFixed(4)),
      rotation: Number(i.rotation.toFixed(4)),
      flipH: i.flipH,
      flipV: i.flipV,
      zIndex: i.zIndex,
      groupId: i.groupId,
      text: i.text,
      fontSize: i.fontSize,
      textColor: i.textColor,
      bgColor: i.bgColor,
    }));

    const groupsList = Array.from(this.groups.values()).map((g) => ({
      id: g.id,
      title: g.title,
      color: g.color,
    }));

    return {
      version: 1,
      items: itemsList,
      groups: groupsList,
    };
  }
}

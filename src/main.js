import { BoardViewport } from "./board.js";
import { ItemManager } from "./items.js";
import { InteractionController } from "./interactions.js";
import { UIManager } from "./ui.js";
import { pickFolder, pickSaveFolder, readBoard, saveBoard } from "./storage.js";

(async () => {
  const container = document.getElementById("pixi-container");
  if (!container) return;

  // 1. Initialize Viewport (Canvas, infinite Grid, Zoom/Pan)
  const viewport = new BoardViewport(container);
  await viewport.init();

  // 2. Initialize Items and Media Engine
  const itemManager = new ItemManager(viewport.canvas);

  // 3. Initialize Interaction Controller (Selection, Gizmo, Drag & Drop, Shortcuts)
  const interactions = new InteractionController(viewport, itemManager);

  // 4. Initialize UI Manager (Top bar, context actions, menus, modals)
  const ui = new UIManager();

  // Board State
  let currentFolder = null;
  let isModified = false;
  let openGeneration = 0;

  ui.canShowContextMenu = () => !viewport.isPanning && !viewport.hasPanned;

  const markModified = (modified = true) => {
    isModified = modified;
    ui.setModified(modified);
  };

  itemManager.onItemsChanged = () => {
    markModified(true);
    interactions.updateGizmo();
  };

  interactions.onSelectionChanged = (selected) => {
    ui.updateSelectionState(selected);
  };

  interactions.onTextEditRequested = (item) => {
    ui.openTextEditor(item, (newText) => {
      itemManager.updateTextContent(item, newText);
    });
  };

  interactions.onGroupRenameRequested = (
    screenX,
    screenY,
    width,
    height,
    currentTitle,
    onCommit,
  ) => {
    ui.showInlineRename(
      screenX,
      screenY,
      width,
      height,
      currentTitle,
      onCommit,
    );
  };

  interactions.onNotification = (msg, type) => {
    ui.showToast(msg, type);
  };

  interactions.onProgress = (title, total) => {
    return ui.showLoadingProgress(title, total);
  };

  // ---------------- UI ACTIONS ----------------
  ui.onBoardNameChange = () => {
    markModified(true);
  };

  ui.onNewBoard = () => {
    if (isModified) {
      if (!confirm("Start a new board? Any unsaved changes will be lost.")) {
        return;
      }
    }
    openGeneration++;
    ui.dismissAllProgress();
    itemManager.clear();
    viewport.resetView();
    currentFolder = null;
    ui.setBoardName("Untitled Board");
    markModified(false);
    ui.showToast("Created new Mood Board", "info");
  };

  ui.onOpenBoard = async () => {
    let progress = null;
    const currentGen = ++openGeneration;
    try {
      const folder = await pickFolder();
      if (!folder || currentGen !== openGeneration) return;

      ui.dismissAllProgress();
      ui.showToast("Opening Mood Board...", "info");
      const { boardData, mediaMap } = await readBoard(folder);
      if (currentGen !== openGeneration) return;
      currentFolder = folder;

      // Clear current canvas
      itemManager.clear();

      // Set board name
      const name =
        boardData.name ||
        (typeof folder === "string" ? folder.split("/").pop() : folder.name);
      ui.setBoardName(name);

      // Restore items
      const itemsToLoad = boardData.items || [];
      progress =
        itemsToLoad.length > 5
          ? ui.showLoadingProgress(`Opening "${name}"...`, itemsToLoad.length)
          : null;

      for (let i = 0; i < itemsToLoad.length; i++) {
        if (
          currentGen !== openGeneration ||
          (progress && progress.isCancelled)
        ) {
          if (progress) progress.remove();
          return;
        }

        const itemData = itemsToLoad[i];
        const fileKey = itemData.file || itemData.filename || null;
        const dataUrl = fileKey
          ? mediaMap.get(fileKey) ||
            mediaMap.get(fileKey.replace(/^media\//, ""))
          : null;

        const displayFile = fileKey
          ? fileKey.split("/").pop()
          : `Item ${i + 1}`;
        if (progress) {
          progress.update(i, itemsToLoad.length, `Loading "${displayFile}"...`);
        }

        try {
          if (itemData.type === "text") {
            itemManager.addTextItem(
              { ...itemData, filename: fileKey },
              { skipNotify: true },
            );
          } else if (itemData.type === "video") {
            if (dataUrl) {
              await itemManager.addVideoItem(
                { ...itemData, filename: fileKey, dataUrl },
                { skipNotify: true },
              );
            }
          } else {
            if (dataUrl) {
              await itemManager.addImageItem(
                { ...itemData, filename: fileKey, dataUrl },
                { skipNotify: true },
              );
            }
          }
        } catch (itemErr) {
          console.warn(`Failed loading item ${fileKey}:`, itemErr);
        }

        if (progress) {
          progress.update(
            i + 1,
            itemsToLoad.length,
            `Loaded "${displayFile}" (${i + 1}/${itemsToLoad.length})`,
          );
        }

        // Periodic yield every 25 items so the browser/WebKitGTK stays responsive
        // on large boards (e.g. 500+ items) without freezing the UI loop
        if (i > 0 && i % 25 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      if (currentGen !== openGeneration) return;

      // Restore groups
      for (const group of boardData.groups || []) {
        itemManager.groups.set(group.id, group);
      }
      itemManager.updateGroupDisplay();
      itemManager.notifyChanged();

      // Restore viewport
      if (boardData.pan && boardData.zoom) {
        viewport.setViewport(boardData.pan, boardData.zoom);
      } else {
        viewport.resetView(itemManager.getOverallBounds());
      }

      itemManager.markAllSaved();
      markModified(false);
      if (progress) {
        progress.finish(`Loaded "${name}" (${itemsToLoad.length} items)`);
      } else {
        ui.showToast(`Loaded "${name}" from folder`, "success");
      }
    } catch (err) {
      if (currentGen === openGeneration) {
        console.error("Error opening board:", err);
        ui.showToast(`Failed to open board: ${err.message}`, "error");
        if (progress) {
          progress.error(`Failed to open: ${err.message}`);
        }
      }
    }
  };

  ui.onSaveBoard = async () => {
    try {
      let targetFolder = currentFolder;
      if (!targetFolder) {
        targetFolder = await pickSaveFolder();
        if (!targetFolder) {
          ui.showToast("Save cancelled: No folder chosen", "info");
          return;
        }
      }

      const isNewFolder = !currentFolder || targetFolder !== currentFolder;
      if (isNewFolder) {
        itemManager.markAllDirty();
      }
      currentFolder = targetFolder;

      ui.showToast("Saving Mood Board to folder...", "info");

      const serialized = itemManager.serialize();
      const boardData = {
        name: ui.boardName,
        pan: { x: Math.round(viewport.pan.x), y: Math.round(viewport.pan.y) },
        zoom: Number(viewport.zoom.toFixed(4)),
        ...serialized,
      };

      const mediaItems = Array.from(itemManager.items.values());
      const result = await saveBoard(targetFolder, boardData, mediaItems);

      itemManager.markAllSaved();
      markModified(false);
      ui.showToast(
        `Board saved successfully (${result.folderPath})`,
        "success",
      );
    } catch (err) {
      console.error("Error saving board:", err);
      ui.showToast(`Failed to save: ${err.message}`, "error");
    }
  };

  ui.onAddMedia = async (files) => {
    const center = viewport.screenToCanvas(
      viewport.app.screen.width / 2,
      viewport.app.screen.height / 2,
    );
    await interactions.importFileList(files, center);
  };

  ui.onAddText = () => {
    const center = viewport.screenToCanvas(
      viewport.app.screen.width / 2,
      viewport.app.screen.height / 2,
    );
    const item = itemManager.addTextItem({
      x: center.x,
      y: center.y,
      text: "Double click to edit note...",
    });
    interactions.selectItem(item, true);
  };

  ui.onArrange = () => {
    const selected = Array.from(interactions.selectedItems);
    const items =
      selected.length > 1 ? selected : Array.from(itemManager.items.values());
    if (items.length > 1) {
      itemManager.arrangeInGrid(items);
      interactions.updateGizmo();
      ui.showToast("Arranged references in grid", "info");
    }
  };

  ui.onArrangeRow = () => {
    const selected = Array.from(interactions.selectedItems);
    const items =
      selected.length > 1 ? selected : Array.from(itemManager.items.values());
    if (items.length > 1) {
      itemManager.arrangeHorizontal(items);
      interactions.updateGizmo();
      ui.showToast("Arranged references in row", "info");
    }
  };

  ui.onArrangeCol = () => {
    const selected = Array.from(interactions.selectedItems);
    const items =
      selected.length > 1 ? selected : Array.from(itemManager.items.values());
    if (items.length > 1) {
      itemManager.arrangeVertical(items);
      interactions.updateGizmo();
      ui.showToast("Arranged references in column", "info");
    }
  };

  ui.onAlign = (mode) => {
    const selected = Array.from(interactions.selectedItems);
    if (selected.length > 1) {
      itemManager.alignItems(selected, mode);
      interactions.updateGizmo();
    }
  };

  ui.onNormalize = (dimension) => {
    const selected = Array.from(interactions.selectedItems);
    if (selected.length > 1) {
      itemManager.normalizeSizes(selected, dimension);
      interactions.updateGizmo();
      ui.showToast(`Normalized item ${dimension}s`, "info");
    }
  };

  ui.onFlipH = () => {
    for (const item of interactions.selectedItems) {
      itemManager.flipItemHorizontal(item);
    }
    interactions.updateGizmo();
  };

  ui.onFlipV = () => {
    for (const item of interactions.selectedItems) {
      itemManager.flipItemVertical(item);
    }
    interactions.updateGizmo();
  };

  ui.onGroup = () => {
    const ids = Array.from(interactions.selectedItems).map((i) => i.id);
    if (ids.length > 1) {
      itemManager.createGroup(ids, "Group");
      ui.showToast("Group created", "success");
    }
  };

  ui.onUngroup = () => {
    const ids = Array.from(interactions.selectedItems).map((i) => i.id);
    if (ids.length > 0) {
      itemManager.ungroup(ids);
      ui.showToast("Ungrouped items", "info");
    }
  };

  ui.onBringToFront = () => {
    for (const item of interactions.selectedItems) {
      itemManager.bringToFront(item);
    }
  };

  ui.onSendToBack = () => {
    for (const item of interactions.selectedItems) {
      itemManager.sendToBack(item);
    }
  };

  ui.onDelete = () => {
    interactions.deleteSelectedItems();
  };

  ui.onResetView = () => {
    const bounds = itemManager.getOverallBounds();
    viewport.resetView(bounds);
  };

  // Keyboard shortcuts for Ctrl+S, Ctrl+O, Ctrl+N
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      ui.onSaveBoard();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
      e.preventDefault();
      ui.onOpenBoard();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
      e.preventDefault();
      ui.onNewBoard();
    }
  });

  // Start with a clean, blank canvas by default
  markModified(false);
})();

/**
 * Taboret Minimalist UI Module.
 * Provides an unobtrusive, elegant user interface that doesn't intrude on creative workflow.
 */

export class UIManager {
  constructor(options = {}) {
    this.options = options;
    this.boardName = "Untitled Board";
    this.isModified = false;

    // Elements
    this.topBar = null;
    this.contextBar = null;
    this.contextMenu = null;
    this.shortcutsModal = null;
    this.toastContainer = null;
    this.textEditorOverlay = null;

    // Callbacks
    this.onNewBoard = null;
    this.onOpenBoard = null;
    this.onSaveBoard = null;
    this.onAddMedia = null;
    this.onAddText = null;
    this.onArrange = null;
    this.onAlign = null;
    this.onNormalize = null;
    this.onFlipH = null;
    this.onFlipV = null;
    this.onGroup = null;
    this.onUngroup = null;
    this.onBringToFront = null;
    this.onSendToBack = null;
    this.onDelete = null;
    this.onResetView = null;
    this.onBoardNameChange = null;

    this.init();
  }

  init() {
    this.createToastContainer();
    this.createTopBar();
    this.createContextBar();
    this.createContextMenu();
    this.createShortcutsModal();
    this.createTextEditorOverlay();
    this.setupGlobalContextMenu();
  }

  createToastContainer() {
    const el = document.createElement("div");
    el.id = "toast-container";
    el.className = "toast-container";
    document.body.appendChild(el);
    this.toastContainer = el;
  }

  showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("toast-show");
    }, 10);

    setTimeout(() => {
      toast.classList.remove("toast-show");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  createTopBar() {
    const bar = document.createElement("div");
    bar.className = "top-bar";
    bar.innerHTML = `
      <div class="top-bar-left">
        <div class="logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="3"></rect>
            <path d="M3 9h18"></path>
            <path d="M9 21V9"></path>
          </svg>
          <span class="logo-title">Taboret</span>
        </div>
        <div class="board-name-wrapper">
          <input type="text" class="board-name-input" id="boardNameInput" value="${this.boardName}" title="Click to rename board" />
          <span class="status-indicator ${this.isModified ? "status-unsaved" : "status-saved"}" id="statusIndicator" title="${this.isModified ? "Unsaved changes" : "Saved"}"></span>
        </div>
      </div>

      <div class="top-bar-actions">
        <button class="btn btn-icon" id="btnNew" title="New Board (Ctrl+N)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          <span>New</span>
        </button>
        <button class="btn btn-icon" id="btnOpen" title="Open Folder (Ctrl+O)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span>Open</span>
        </button>
        <button class="btn btn-icon btn-primary" id="btnSave" title="Save to Folder (Ctrl+S)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          <span>Save</span>
        </button>
        <div class="divider"></div>
        <button class="btn btn-icon" id="btnAddMedia" title="Import Local Media (or drag files/links onto canvas)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <span>+ Media</span>
        </button>
        <input type="file" id="mediaFileInput" accept="image/*,video/*" multiple style="display: none;" />
        <button class="btn btn-icon" id="btnAddText" title="Add Text Note (T)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
          <span>+ Text</span>
        </button>
        <button class="btn btn-icon" id="btnArrangeTop" title="Arrange in Grid (BeeRef Pack)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          <span>Arrange</span>
        </button>
        <div class="divider"></div>
        <button class="btn btn-icon" id="btnResetView" title="Frame All References (Z)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="8 12 12 16 16 12"/><line x1="12" y1="8" x2="12" y2="16"/></svg>
        </button>
        <button class="btn btn-icon" id="btnShortcuts" title="Keyboard Shortcuts (?)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </button>
      </div>
    `;

    document.body.appendChild(bar);
    this.topBar = bar;

    // Attach listeners
    bar.querySelector("#btnNew").onclick = () => this.onNewBoard?.();
    bar.querySelector("#btnOpen").onclick = () => this.onOpenBoard?.();
    bar.querySelector("#btnSave").onclick = () => this.onSaveBoard?.();
    bar.querySelector("#btnResetView").onclick = () => this.onResetView?.();
    bar.querySelector("#btnShortcuts").onclick = () =>
      this.toggleShortcutsModal(true);
    bar.querySelector("#btnAddText").onclick = () => this.onAddText?.();
    bar.querySelector("#btnArrangeTop").onclick = () => this.onArrange?.();

    const mediaInput = bar.querySelector("#mediaFileInput");
    bar.querySelector("#btnAddMedia").onclick = () => mediaInput.click();
    mediaInput.onchange = (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.onAddMedia?.(Array.from(e.target.files));
        mediaInput.value = "";
      }
    };

    const nameInput = bar.querySelector("#boardNameInput");
    nameInput.onchange = () => {
      this.boardName = nameInput.value.trim() || "Untitled Board";
      this.onBoardNameChange?.(this.boardName);
    };
  }

  createContextBar() {
    const bar = document.createElement("div");
    bar.className = "context-bar";
    bar.style.display = "none";
    bar.innerHTML = `
      <div class="context-group">
        <span class="context-label" id="selectionCount">1 item</span>
      </div>
      <div class="divider"></div>
      <div class="context-group">
        <button class="btn-icon-sm" id="btnFlipH" title="Flip Horizontal (H)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 7 5 5-5 5V7z"/><path d="m21 7-5 5 5 5V7z"/><path d="M12 3v18"/></svg>
          <span>Flip H</span>
        </button>
        <button class="btn-icon-sm" id="btnFlipV" title="Flip Vertical (V)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 3 5 5 5-5H7z"/><path d="m7 21 5-5 5 5H7z"/><path d="M3 12h18"/></svg>
          <span>Flip V</span>
        </button>
      </div>
      <div class="divider"></div>
      <div class="context-group">
        <button class="btn-icon-sm" id="btnGroup" title="Group (Ctrl+G)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>
          <span>Group</span>
        </button>
        <button class="btn-icon-sm" id="btnUngroup" title="Ungroup (Ctrl+Shift+G)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          <span>Ungroup</span>
        </button>
      </div>
      <div class="divider"></div>
      <div class="context-group">
        <button class="btn-icon-sm" id="btnAlignLeft" title="Align Left edges">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="3"/><rect x="8" y="5" width="12" height="4" rx="1"/><rect x="8" y="15" width="8" height="4" rx="1"/></svg>
        </button>
        <button class="btn-icon-sm" id="btnAlignCenterH" title="Center horizontally">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="21" x2="12" y2="3"/><rect x="5" y="5" width="14" height="4" rx="1"/><rect x="7" y="15" width="10" height="4" rx="1"/></svg>
        </button>
        <button class="btn-icon-sm" id="btnAlignRight" title="Align Right edges">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="20" y1="21" x2="20" y2="3"/><rect x="4" y="5" width="12" height="4" rx="1"/><rect x="8" y="15" width="8" height="4" rx="1"/></svg>
        </button>
        <button class="btn-icon-sm" id="btnAlignTop" title="Align Top edges">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="4" x2="21" y2="4"/><rect x="5" y="8" width="4" height="12" rx="1"/><rect x="15" y="8" width="4" height="8" rx="1"/></svg>
        </button>
        <button class="btn-icon-sm" id="btnAlignBottom" title="Align Bottom edges">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="20" x2="21" y2="20"/><rect x="5" y="4" width="4" height="12" rx="1"/><rect x="15" y="8" width="4" height="8" rx="1"/></svg>
        </button>
        <button class="btn-icon-sm" id="btnDistributeH" title="Distribute horizontally (3+ items)" style="font-size:11px; letter-spacing:-1px;">⇔ H</button>
        <button class="btn-icon-sm" id="btnDistributeV" title="Distribute vertically (3+ items)" style="font-size:11px; letter-spacing:-1px;">⇕ V</button>
        <button class="btn-icon-sm" id="btnArrangeGrid" title="Pack / Arrange Grid">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        </button>
      </div>
      <div class="divider"></div>
      <div class="context-group">
        <button class="btn-icon-sm" id="btnNormHeight" title="Match Heights (BeeRef)">
          <span>= Height</span>
        </button>
        <button class="btn-icon-sm" id="btnNormWidth" title="Match Widths (BeeRef)">
          <span>= Width</span>
        </button>
      </div>
      <div class="divider"></div>
      <div class="context-group">
        <button class="btn-icon-sm btn-danger" id="btnDelete" title="Delete (Del)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `;

    document.body.appendChild(bar);
    this.contextBar = bar;

    bar.querySelector("#btnFlipH").onclick = () => this.onFlipH?.();
    bar.querySelector("#btnFlipV").onclick = () => this.onFlipV?.();
    bar.querySelector("#btnGroup").onclick = () => this.onGroup?.();
    bar.querySelector("#btnUngroup").onclick = () => this.onUngroup?.();
    bar.querySelector("#btnAlignLeft").onclick = () => this.onAlign?.("left");
    bar.querySelector("#btnAlignCenterH").onclick = () =>
      this.onAlign?.("center-h");
    bar.querySelector("#btnAlignRight").onclick = () => this.onAlign?.("right");
    bar.querySelector("#btnAlignTop").onclick = () => this.onAlign?.("top");
    bar.querySelector("#btnAlignBottom").onclick = () =>
      this.onAlign?.("bottom");
    bar.querySelector("#btnDistributeH").onclick = () =>
      this.onAlign?.("distribute-h");
    bar.querySelector("#btnDistributeV").onclick = () =>
      this.onAlign?.("distribute-v");
    bar.querySelector("#btnArrangeGrid").onclick = () => this.onArrange?.();
    bar.querySelector("#btnNormHeight").onclick = () =>
      this.onNormalize?.("height");
    bar.querySelector("#btnNormWidth").onclick = () =>
      this.onNormalize?.("width");
    bar.querySelector("#btnDelete").onclick = () => this.onDelete?.();
  }

  updateSelectionState(selectedItems) {
    if (!selectedItems || selectedItems.length === 0) {
      this.contextBar.style.display = "none";
      return;
    }

    this.contextBar.style.display = "flex";
    const countLabel = this.contextBar.querySelector("#selectionCount");
    countLabel.textContent = `${selectedItems.length} ${selectedItems.length === 1 ? "item" : "items"}`;

    const multiOnly = this.contextBar.querySelectorAll(
      "#btnAlignLeft, #btnAlignCenterH, #btnAlignRight, #btnAlignTop, #btnAlignBottom, #btnArrangeGrid, #btnNormHeight, #btnNormWidth, #btnGroup",
    );
    for (const btn of multiOnly) {
      btn.style.opacity = selectedItems.length > 1 ? "1" : "0.4";
      btn.style.pointerEvents = selectedItems.length > 1 ? "auto" : "none";
    }

    // Distribute buttons need 3+ items
    const distributeOnly = this.contextBar.querySelectorAll(
      "#btnDistributeH, #btnDistributeV",
    );
    for (const btn of distributeOnly) {
      btn.style.opacity = selectedItems.length >= 3 ? "1" : "0.4";
      btn.style.pointerEvents = selectedItems.length >= 3 ? "auto" : "none";
    }
  }

  createContextMenu() {
    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.display = "none";
    menu.innerHTML = `
      <div class="menu-item" data-action="flip-h"><span>Flip Horizontal</span><span class="shortcut">H</span></div>
      <div class="menu-item" data-action="flip-v"><span>Flip Vertical</span><span class="shortcut">V</span></div>
      <div class="menu-divider"></div>
      <div class="menu-item" data-action="group"><span>Group Items</span><span class="shortcut">Ctrl+G</span></div>
      <div class="menu-item" data-action="ungroup"><span>Ungroup</span><span class="shortcut">Ctrl+Shift+G</span></div>
      <div class="menu-divider"></div>
      <div class="menu-item" data-action="front"><span>Bring to Front</span><span class="shortcut">]</span></div>
      <div class="menu-item" data-action="back"><span>Send to Back</span><span class="shortcut">[</span></div>
      <div class="menu-divider"></div>
      <div class="menu-item" data-action="arrange"><span>Arrange in Grid</span></div>
      <div class="menu-item" data-action="distribute-h"><span>Distribute Horizontally</span></div>
      <div class="menu-item" data-action="distribute-v"><span>Distribute Vertically</span></div>
      <div class="menu-item" data-action="match-h"><span>Match Heights</span></div>
      <div class="menu-item" data-action="match-w"><span>Match Widths</span></div>
      <div class="menu-divider"></div>
      <div class="menu-item menu-item-danger" data-action="delete"><span>Delete</span><span class="shortcut">Del</span></div>
    `;

    document.body.appendChild(menu);
    this.contextMenu = menu;

    menu.addEventListener("click", (e) => {
      const item = e.target.closest(".menu-item");
      if (!item) return;
      const action = item.dataset.action;
      this.handleMenuAction(action);
      this.hideContextMenu();
    });

    window.addEventListener("click", () => this.hideContextMenu());
  }

  setupGlobalContextMenu() {
    window.addEventListener("contextmenu", (e) => {
      // If user was panning with right click, don't show browser menu
      e.preventDefault();

      // Show custom menu if cursor is over items or right clicked
      this.contextMenu.style.left = `${e.clientX}px`;
      this.contextMenu.style.top = `${e.clientY}px`;
      this.contextMenu.style.display = "block";
    });
  }

  hideContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.style.display = "none";
    }
  }

  handleMenuAction(action) {
    switch (action) {
      case "flip-h":
        this.onFlipH?.();
        break;
      case "flip-v":
        this.onFlipV?.();
        break;
      case "group":
        this.onGroup?.();
        break;
      case "ungroup":
        this.onUngroup?.();
        break;
      case "front":
        this.onBringToFront?.();
        break;
      case "back":
        this.onSendToBack?.();
        break;
      case "arrange":
        this.onArrange?.();
        break;
      case "distribute-h":
        this.onAlign?.("distribute-h");
        break;
      case "distribute-v":
        this.onAlign?.("distribute-v");
        break;
      case "match-h":
        this.onNormalize?.("height");
        break;
      case "match-w":
        this.onNormalize?.("width");
        break;
      case "delete":
        this.onDelete?.();
        break;
    }
  }

  createShortcutsModal() {
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.style.display = "none";
    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>Taboret Controls & Shortcuts</span>
          </div>
          <button class="modal-close" id="btnCloseModal">&times;</button>
        </div>
        <div class="shortcuts-grid">
          <div class="shortcut-col">
            <h3>Navigation</h3>
            <div class="shortcut-row"><span>Pan Canvas</span><kbd>Right Drag / Space + Drag</kbd></div>
            <div class="shortcut-row"><span>Zoom to Cursor</span><kbd>Scroll Wheel</kbd></div>
            <div class="shortcut-row"><span>Frame All</span><kbd>Z</kbd></div>
            
            <h3>Items & Media</h3>
            <div class="shortcut-row"><span>Import Media</span><kbd>Drag & Drop / Ctrl+V</kbd></div>
            <div class="shortcut-row"><span>Web Reference</span><kbd>Drag from Pinterest/Artstation</kbd></div>
            <div class="shortcut-row"><span>Add Note</span><kbd>T or Double Click</kbd></div>
            <div class="shortcut-row"><span>Delete Selected</span><kbd>Delete / Backspace</kbd></div>
          </div>
          <div class="shortcut-col">
            <h3>Transforms</h3>
            <div class="shortcut-row"><span>Scale / Resize</span><kbd>Drag Gizmo Corners</kbd></div>
            <div class="shortcut-row"><span>Rotate</span><kbd>Drag Gizmo Top Handle</kbd></div>
            <div class="shortcut-row"><span>Flip Horizontal</span><kbd>H</kbd></div>
            <div class="shortcut-row"><span>Flip Vertical</span><kbd>V</kbd></div>
            <div class="shortcut-row"><span>Bring to Front</span><kbd>]</kbd></div>
            <div class="shortcut-row"><span>Send to Back</span><kbd>[</kbd></div>

            <h3>BeeRef Group & Align</h3>
            <div class="shortcut-row"><span>Group Selected</span><kbd>Ctrl + G</kbd></div>
            <div class="shortcut-row"><span>Ungroup</span><kbd>Ctrl + Shift + G</kbd></div>
            <div class="shortcut-row"><span>Box Selection</span><kbd>Drag Empty Canvas</kbd></div>
            <div class="shortcut-row"><span>Save Folder</span><kbd>Ctrl + S</kbd></div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.shortcutsModal = modal;

    modal.querySelector("#btnCloseModal").onclick = () =>
      this.toggleShortcutsModal(false);
    modal.onclick = (e) => {
      if (e.target === modal) this.toggleShortcutsModal(false);
    };

    window.addEventListener("keydown", (e) => {
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        const target = e.target;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          e.preventDefault();
          this.toggleShortcutsModal(true);
        }
      } else if (
        e.key === "Escape" &&
        this.shortcutsModal.style.display !== "none"
      ) {
        this.toggleShortcutsModal(false);
      }
    });
  }

  toggleShortcutsModal(show) {
    this.shortcutsModal.style.display = show ? "flex" : "none";
  }

  createTextEditorOverlay() {
    const overlay = document.createElement("div");
    overlay.className = "text-editor-overlay";
    overlay.style.display = "none";
    overlay.innerHTML = `
      <div class="text-editor-box">
        <textarea id="inlineTextArea" rows="4" placeholder="Type reference note..."></textarea>
        <div class="text-editor-actions">
          <span class="editor-hint">Press Esc or click outside to save</span>
          <button class="btn btn-sm btn-primary" id="btnDoneText">Done</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.textEditorOverlay = overlay;

    const textarea = overlay.querySelector("#inlineTextArea");
    const btnDone = overlay.querySelector("#btnDoneText");

    let currentItem = null;
    let onCommit = null;

    const finish = () => {
      if (currentItem && onCommit) {
        onCommit(textarea.value);
      }
      overlay.style.display = "none";
      currentItem = null;
    };

    btnDone.onclick = finish;
    overlay.onclick = (e) => {
      if (e.target === overlay) finish();
    };

    textarea.onkeydown = (e) => {
      if (e.key === "Escape") {
        finish();
      }
    };

    this.openTextEditor = (item, callback) => {
      currentItem = item;
      onCommit = callback;
      textarea.value = item.text || "";
      overlay.style.display = "flex";
      setTimeout(() => {
        textarea.focus();
        textarea.select();
      }, 50);
    };
  }

  setModified(isModified) {
    this.isModified = isModified;
    const dot = document.getElementById("statusIndicator");
    if (dot) {
      dot.className = `status-indicator ${isModified ? "status-unsaved" : "status-saved"}`;
      dot.title = isModified ? "Unsaved changes" : "Saved";
    }
  }

  setBoardName(name) {
    this.boardName = name;
    const input = document.getElementById("boardNameInput");
    if (input) {
      input.value = name;
    }
  }
}

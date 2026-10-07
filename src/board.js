import * as PIXI from "pixi.js";

/**
 * Taboret Board Viewport Engine.
 * Manages the infinite canvas, zoom/pan navigation, and adaptive background grid.
 */
export class BoardViewport {
  constructor(containerElement, options = {}) {
    this.containerElement = containerElement;
    this.options = {
      canvasColor: "#141414",
      gridColor: "#2a2a2a",
      gridSize: 80,
      gridThickness: 2,
      minZoom: 0.05,
      maxZoom: 20,
      panSpeed: 0.25,
      ...options,
    };

    this.app = null;
    this.canvas = null; // Main PIXI.Container holding all board items
    this.gridSprite = null;

    // Viewport transforms
    this.pan = { x: 0, y: 0 };
    this.panTarget = { x: 0, y: 0 };
    this.zoom = 1;
    this.zoomTarget = 1;

    // Input state
    this.isPanning = false;
    this.panStartMouse = { x: 0, y: 0 };
    this.panStartTarget = { x: 0, y: 0 };
    this.isSpacePressed = false;
    this.mouseScreen = { x: 0, y: 0 };

    this.onViewportChange = null;
  }

  async init() {
    this.app = new PIXI.Application();
    await this.app.init({
      background: this.options.canvasColor,
      resizeTo: window,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    this.containerElement.appendChild(this.app.canvas);

    // Main world container
    this.canvas = new PIXI.Container();
    this.canvas.sortableChildren = true;

    // Build grid
    this.createGrid();

    // Add to stage: Grid sits behind world canvas
    this.app.stage.addChild(this.gridSprite);
    this.app.stage.addChild(this.canvas);

    // Initial center
    this.pan.x = this.app.screen.width / 2;
    this.pan.y = this.app.screen.height / 2;
    this.panTarget.x = this.pan.x;
    this.panTarget.y = this.pan.y;
    this.canvas.position.set(this.pan.x, this.pan.y);

    this.setupEvents();
    this.setupTicker();
  }

  createGrid() {
    const { gridSize, gridThickness, canvasColor, gridColor } = this.options;

    const g = new PIXI.Graphics();
    g.rect(0, 0, gridSize, gridSize).fill(canvasColor);
    // Draw subtle grid crosshairs/lines
    g.rect(gridSize - gridThickness, 0, gridThickness, gridSize).fill(
      gridColor,
    );
    g.rect(0, gridSize - gridThickness, gridSize, gridThickness).fill(
      gridColor,
    );

    const texture = this.app.renderer.generateTexture(g);
    this.gridSprite = new PIXI.TilingSprite({
      texture,
      width: this.app.screen.width,
      height: this.app.screen.height,
    });
    this.gridSprite.eventMode = "none";
  }

  setupEvents() {
    // Window Resize listener (resolves KNOWNBUGS.md on all window managers)
    this.app.renderer.on("resize", (width, height) => {
      if (this.gridSprite) {
        this.gridSprite.width = width;
        this.gridSprite.height = height;
        this.updateGridTransform();
      }
    });

    window.addEventListener("resize", () => {
      if (this.gridSprite && this.app) {
        this.gridSprite.width = window.innerWidth;
        this.gridSprite.height = window.innerHeight;
        this.updateGridTransform();
      }
    });

    // Space key tracking for pan navigation
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !this.isTextInputActive(e)) {
        this.isSpacePressed = true;
        this.updateCursor();
      }
    });

    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        this.isSpacePressed = false;
        this.updateCursor();
      }
    });

    // Mouse movement on canvas
    this.app.canvas.addEventListener("mousemove", (e) => {
      this.mouseScreen.x = e.clientX;
      this.mouseScreen.y = e.clientY;

      if (this.isPanning) {
        const dx = e.clientX - this.panStartMouse.x;
        const dy = e.clientY - this.panStartMouse.y;
        this.panTarget.x = this.panStartTarget.x + dx;
        this.panTarget.y = this.panStartTarget.y + dy;
      }
    });

    // Mouse Down: Right-click, Middle-click, or Space+Left-click starts panning
    this.app.canvas.addEventListener("mousedown", (e) => {
      const isRightClick = e.button === 2;
      const isMiddleClick = e.button === 1;
      const isSpaceLeftClick = e.button === 0 && this.isSpacePressed;

      if (isRightClick || isMiddleClick || isSpaceLeftClick) {
        this.startPanning(e.clientX, e.clientY);
        e.preventDefault();
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (this.isPanning) {
        if (e.button === 2 || e.button === 1 || e.button === 0) {
          this.stopPanning();
        }
      }
    });

    // Mouse Wheel Zoom centered on cursor
    this.app.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const mouseX = e.clientX;
        const mouseY = e.clientY;

        // Smooth zoom step
        const zoomDelta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newZoom = Math.min(
          this.options.maxZoom,
          Math.max(this.options.minZoom, this.zoomTarget * zoomDelta),
        );

        if (Math.abs(newZoom - this.zoomTarget) > 0.0001) {
          // Keep the point under cursor invariant
          const factor = newZoom / this.zoomTarget;
          this.panTarget.x = mouseX - (mouseX - this.panTarget.x) * factor;
          this.panTarget.y = mouseY - (mouseY - this.panTarget.y) * factor;
          this.zoomTarget = newZoom;
        }
      },
      { passive: false },
    );
  }

  isTextInputActive(e) {
    const target = e.target;
    return (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    );
  }

  startPanning(clientX, clientY) {
    this.isPanning = true;
    this.panStartMouse = { x: clientX, y: clientY };
    this.panStartTarget = { x: this.panTarget.x, y: this.panTarget.y };
    this.updateCursor();
  }

  stopPanning() {
    this.isPanning = false;
    this.updateCursor();
  }

  updateCursor() {
    if (this.isPanning) {
      document.body.style.cursor = "grabbing";
    } else if (this.isSpacePressed) {
      document.body.style.cursor = "grab";
    } else {
      document.body.style.cursor = "default";
    }
  }

  setupTicker() {
    const speed = this.options.panSpeed;

    this.app.ticker.add(() => {
      // Smooth lerp for pan and zoom
      const prevX = this.pan.x;
      const prevY = this.pan.y;
      const prevZ = this.zoom;

      this.pan.x += (this.panTarget.x - this.pan.x) * speed;
      this.pan.y += (this.panTarget.y - this.pan.y) * speed;
      this.zoom += (this.zoomTarget - this.zoom) * speed;

      const changed =
        Math.abs(prevX - this.pan.x) > 0.01 ||
        Math.abs(prevY - this.pan.y) > 0.01 ||
        Math.abs(prevZ - this.zoom) > 0.0005;

      if (changed) {
        this.canvas.position.set(this.pan.x, this.pan.y);
        this.canvas.scale.set(this.zoom);
        this.updateGridTransform();

        if (this.onViewportChange) {
          this.onViewportChange({
            pan: { ...this.pan },
            zoom: this.zoom,
          });
        }
      }
    });
  }

  updateGridTransform() {
    if (!this.gridSprite) return;
    this.gridSprite.tilePosition.set(this.pan.x, this.pan.y);
    this.gridSprite.tileScale.set(this.zoom);
  }

  screenToCanvas(screenX, screenY) {
    return {
      x: (screenX - this.pan.x) / this.zoom,
      y: (screenY - this.pan.y) / this.zoom,
    };
  }

  canvasToScreen(canvasX, canvasY) {
    return {
      x: this.pan.x + canvasX * this.zoom,
      y: this.pan.y + canvasY * this.zoom,
    };
  }

  resetView(itemsBounds = null) {
    if (itemsBounds && itemsBounds.width > 0 && itemsBounds.height > 0) {
      const padding = 100;
      const screenW = this.app.screen.width - padding * 2;
      const screenH = this.app.screen.height - padding * 2;

      const scaleX = screenW / itemsBounds.width;
      const scaleY = screenH / itemsBounds.height;
      const targetZoom = Math.min(
        1.5,
        Math.max(this.options.minZoom, Math.min(scaleX, scaleY)),
      );

      const centerX = itemsBounds.x + itemsBounds.width / 2;
      const centerY = itemsBounds.y + itemsBounds.height / 2;

      this.zoomTarget = targetZoom;
      this.panTarget.x = this.app.screen.width / 2 - centerX * targetZoom;
      this.panTarget.y = this.app.screen.height / 2 - centerY * targetZoom;
    } else {
      this.zoomTarget = 1;
      this.panTarget.x = this.app.screen.width / 2;
      this.panTarget.y = this.app.screen.height / 2;
    }
  }

  setViewport(pan, zoom) {
    if (pan && typeof pan.x === "number" && typeof pan.y === "number") {
      this.pan.x = pan.x;
      this.pan.y = pan.y;
      this.panTarget.x = pan.x;
      this.panTarget.y = pan.y;
    }
    if (typeof zoom === "number" && zoom > 0) {
      this.zoom = zoom;
      this.zoomTarget = zoom;
    }
    if (this.canvas) {
      this.canvas.position.set(this.pan.x, this.pan.y);
      this.canvas.scale.set(this.zoom);
      this.updateGridTransform();
    }
  }
}

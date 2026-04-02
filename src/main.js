import * as PIXI from "pixi.js";

(async () => {
  //----------------Flags---------------------
  // Panning - Panning is moving the Canvas, not the Viewport. Think like old mario games.
  let isPanning = false;
  let panStart = { x: 0, y: 0 };
  let panTarget = { x: 0, y: 0 };
  const panSpeed = 0.22;
  // Zooming
  const zoomFactor = 0;
  const zoomMin = 50;
  const zoomMax = 8000;
  // Grid Variables. The Grid is a sprite attatched to the "Viewport"/"Camera".
  let canvasColor = "#1a1a1a";
  let gridColor = "#515151";
  let gridSize = 100;
  let gridThickness = 3;
  //------------------Project Boilerplate-----------------
  // Create and Initalize Taboret. This is boilerplate stuff & a few settings.
  const Taboret = new PIXI.Application();
  await Taboret.init({ background: canvasColor, resizeTo: window });
  document.getElementById("pixi-container").appendChild(Taboret.canvas);

  // Define and add the Canvas that holds everything. This is the main container we manipulate and work with.
  const Canvas = new PIXI.Container();
  //--------------------------- GRID------------------------------
  // We'll draw the grid's pattern here.
  const Grid = new PIXI.Graphics();
  Grid.rect(0, 0, gridSize, gridSize).fill(canvasColor);
  Grid.rect(gridSize - gridThickness, 0, gridThickness, gridSize).fill(
    gridColor,
  ); // Vertical Lines
  Grid.rect(0, gridSize - gridThickness, gridSize, gridThickness).fill(
    gridColor,
  ); // Horizonal Lines
  // Generate a texture with the Grid patterns
  const gridTexture = Taboret.renderer.generateTexture(Grid);
  // Attatch the Grid to a Tiling Sprite and size it to fit the "Viewport"
  const gridSprite = new PIXI.TilingSprite({
    texture: gridTexture,
    width: Taboret.screen.width,
    height: Taboret.screen.height,
  });
  // Lay the Sprite onto the "Viewport"
  Taboret.stage.addChild(gridSprite);
  Taboret.stage.addChild(Canvas);
  //------------------------Panning---------------------
  // Pan Input - We're "Sticking" the canvas to our mouse and turn isPanning on.
  Taboret.canvas.addEventListener("mousedown", (event) => {
    isPanning = true;
    panStart = { x: event.clientX - Canvas.x, y: event.clientY - Canvas.y };
  });
  // Moving the Canvas, which is stuck to our mouse right now, to wherever the cursor goes. Ticker is adding a **Lerp** to this movement. Without it, it feels jittery. It also helps to sync everything to your monitor's refresh rate.
  Taboret.canvas.addEventListener("mousemove", (event) => {
    if (!isPanning) return;
    panTarget.x = event.clientX - panStart.x;
    panTarget.y = event.clientY - panStart.y;
  });
  Taboret.ticker.add(() => {
    Canvas.position.set(
      Canvas.x + (panTarget.x - Canvas.x) * panSpeed,
      Canvas.y + (panTarget.y - Canvas.y) * panSpeed,
    );
    gridSprite.tilePosition.set(Canvas.x % gridSize, Canvas.y % gridSize);
  });
  // When the mouse leaves the window or when we let go of the click, we stop panning.
  window.addEventListener("mouseup", () => (isPanning = false));

  //---------------------Zooming------------------------
})();

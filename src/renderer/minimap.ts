/**
 * Minimap renderer — a small top-down overview of the entire battlefield.
 * Shows terrain, unit positions, and camera viewport rectangle.
 * Supports click-to-jump navigation.
 */

import { Camera } from '../engine/camera';
import { Battlefield, TerrainType } from '../game/battlefield';
import { World } from '../engine/ecs';
import { Army } from '../game/army';

const TERRAIN_COLORS: Record<number, [number, number, number]> = {
  [TerrainType.Plains]: [58, 107, 48],
  [TerrainType.Forest]: [30, 74, 24],
  [TerrainType.Hills]: [122, 100, 53],
  [TerrainType.Water]: [42, 74, 122],
  [TerrainType.Mountains]: [106, 101, 96],
};

const ARMY_COLORS: [number, number, number][] = [
  [255, 80, 80],  // Red army
  [80, 100, 255], // Blue army
];

export class MinimapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private imageData: ImageData | null = null;

  /** Cached terrain pixel buffer — only rebuilt when terrain changes */
  private terrainBuffer: Uint8ClampedArray | null = null;
  private lastTerrainCols = 0;
  private lastTerrainRows = 0;

  /** Battlefield world bounds for coordinate mapping */
  private worldWidth = 200;
  private worldHeight = 200;

  /** Callback when user clicks on the minimap */
  onClickPosition: ((worldX: number, worldY: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get minimap 2D context');
    this.ctx = ctx;

    this.canvas.addEventListener('click', this.handleClick);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /**
   * Render the minimap for the current frame.
   */
  render(
    camera: Camera,
    battlefield: Battlefield,
    world: World,
    armies: Army[],
  ): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    this.worldWidth = battlefield.width;
    this.worldHeight = battlefield.height;

    // Build terrain image data if needed
    if (
      !this.terrainBuffer ||
      this.lastTerrainCols !== battlefield.cols ||
      this.lastTerrainRows !== battlefield.rows
    ) {
      this.rebuildTerrainBuffer(battlefield, w, h);
    }

    // Create fresh image data from cached terrain
    if (!this.imageData || this.imageData.width !== w || this.imageData.height !== h) {
      this.imageData = ctx.createImageData(w, h);
    }

    // Copy terrain base
    if (this.terrainBuffer) {
      this.imageData.data.set(this.terrainBuffer);
    }

    // Draw unit dots directly into pixel buffer
    const data = this.imageData.data;
    for (let a = 0; a < armies.length; a++) {
      const army = armies[a];
      const color = ARMY_COLORS[a] || [128, 128, 128];

      for (const id of army.unitIds) {
        const armyData = world.get('army', id);
        if (armyData[1] < 0.5) continue; // dead

        const unitData = world.get('unit', id);
        const ux = unitData[0];
        const uy = unitData[1];

        // Map world position to minimap pixel
        const px = Math.floor((ux / this.worldWidth) * w);
        const py = Math.floor((uy / this.worldHeight) * h);

        // Draw a bright 2x2 dot
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            const ny = py + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const idx = (ny * w + nx) * 4;
              data[idx] = color[0];
              data[idx + 1] = color[1];
              data[idx + 2] = color[2];
              data[idx + 3] = 255;
            }
          }
        }
      }
    }

    // Put pixel data
    ctx.putImageData(this.imageData, 0, 0);

    // Draw camera viewport rectangle as white outline
    const [vMinX, vMinY, vMaxX, vMaxY] = camera.getVisibleBounds();

    const rectX = (vMinX / this.worldWidth) * w;
    const rectY = (vMinY / this.worldHeight) * h;
    const rectW = ((vMaxX - vMinX) / this.worldWidth) * w;
    const rectH = ((vMaxY - vMinY) / this.worldHeight) * h;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      Math.max(0, rectX),
      Math.max(0, rectY),
      Math.min(rectW, w - Math.max(0, rectX)),
      Math.min(rectH, h - Math.max(0, rectY)),
    );
  }

  /**
   * Rebuild the terrain pixel buffer from the battlefield grid.
   */
  private rebuildTerrainBuffer(
    battlefield: Battlefield,
    canvasW: number,
    canvasH: number,
  ): void {
    this.lastTerrainCols = battlefield.cols;
    this.lastTerrainRows = battlefield.rows;
    this.terrainBuffer = new Uint8ClampedArray(canvasW * canvasH * 4);

    for (let py = 0; py < canvasH; py++) {
      for (let px = 0; px < canvasW; px++) {
        // Map pixel to terrain cell
        const worldX = (px / canvasW) * battlefield.width;
        const worldY = (py / canvasH) * battlefield.height;
        const col = Math.floor(worldX / battlefield.cellSize);
        const row = Math.floor(worldY / battlefield.cellSize);

        const terrain = battlefield.getTerrain(col, row);
        const color = TERRAIN_COLORS[terrain] || [51, 51, 51];

        const idx = (py * canvasW + px) * 4;
        this.terrainBuffer[idx] = color[0];
        this.terrainBuffer[idx + 1] = color[1];
        this.terrainBuffer[idx + 2] = color[2];
        this.terrainBuffer[idx + 3] = 255;
      }
    }
  }

  /**
   * Handle click on minimap to jump camera.
   */
  private handleClick = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // Map minimap pixel to world coordinates
    const worldX = (px / rect.width) * this.worldWidth;
    const worldY = (py / rect.height) * this.worldHeight;

    this.onClickPosition?.(worldX, worldY);
  };

  /**
   * Force terrain cache rebuild (call after terrain changes).
   */
  invalidateTerrain(): void {
    this.terrainBuffer = null;
  }

  destroy(): void {
    this.canvas.removeEventListener('click', this.handleClick);
  }
}

/**
 * Canvas 2D fallback renderer.
 * Draws the battlefield, terrain, and units when WebGPU rendering
 * isn't producing visible output (e.g., headless, unsupported GPU).
 *
 * Also used as the minimap overlay.
 */

import { Battlefield, TerrainType, TERRAIN_MODIFIERS } from '../game/battlefield';
import { World } from '../engine/ecs';
import { Army, UNIT_STRIDE } from '../game/army';
import { Camera } from '../engine/camera';

const TERRAIN_COLORS: Record<number, string> = {
  [TerrainType.Plains]: '#3a6b30',
  [TerrainType.Forest]: '#1e4a18',
  [TerrainType.Hills]: '#7a6435',
  [TerrainType.Water]: '#2a4a7a',
  [TerrainType.Mountains]: '#6a6560',
};

const ARMY_COLORS = ['#e04040', '#4060e0'];

const UNIT_TYPE_SHAPES = ['circle', 'diamond', 'triangle', 'square'] as const;

export class CanvasFallbackRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    this.ctx = ctx;
  }

  render(
    camera: Camera,
    battlefield: Battlefield,
    world: World,
    armies: Army[],
    heatmapData: Float32Array | null = null,
    heatmapOpacity: number = 0.4,
    showHeatmap: boolean = true,
    ghostPos: { x: number; y: number } | null = null,
    ghostUnitType: number = 0,
    ghostArmyIndex: number = 0,
  ): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Get visible world bounds from camera
    const [vMinX, vMinY, vMaxX, vMaxY] = camera.getVisibleBounds();

    // Transform: world -> screen
    const scaleX = w / (vMaxX - vMinX);
    const scaleY = h / (vMaxY - vMinY);
    const scale = Math.min(scaleX, scaleY);

    const offsetX = (w - (vMaxX - vMinX) * scale) / 2;
    const offsetY = (h - (vMaxY - vMinY) * scale) / 2;

    const worldToScreenX = (wx: number) => (wx - vMinX) * scale + offsetX;
    const worldToScreenY = (wy: number) => (wy - vMinY) * scale + offsetY;

    // --- Draw terrain grid ---
    for (let r = 0; r < battlefield.rows; r++) {
      for (let c = 0; c < battlefield.cols; c++) {
        const worldX = c * battlefield.cellSize;
        const worldY = r * battlefield.cellSize;
        const worldX2 = worldX + battlefield.cellSize;
        const worldY2 = worldY + battlefield.cellSize;

        // Frustum cull
        if (worldX2 < vMinX || worldX > vMaxX || worldY2 < vMinY || worldY > vMaxY) continue;

        const sx = worldToScreenX(worldX);
        const sy = worldToScreenY(worldY);
        const sw = battlefield.cellSize * scale;
        const sh = battlefield.cellSize * scale;

        const terrain = battlefield.getTerrain(c, r);
        ctx.fillStyle = TERRAIN_COLORS[terrain] || '#333';
        ctx.fillRect(sx, sy, sw, sh);

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx, sy, sw, sh);
      }
    }

    // --- Draw heatmap overlay ---
    if (showHeatmap && heatmapData) {
      for (let r = 0; r < battlefield.rows; r++) {
        for (let c = 0; c < battlefield.cols; c++) {
          const idx = (r * battlefield.cols + c) * 4;
          const probA = heatmapData[idx];
          const probB = heatmapData[idx + 1];
          const intensity = heatmapData[idx + 2];

          if (intensity < 0.01) continue;

          const worldX = c * battlefield.cellSize;
          const worldY = r * battlefield.cellSize;

          if (worldX + battlefield.cellSize < vMinX || worldX > vMaxX) continue;
          if (worldY + battlefield.cellSize < vMinY || worldY > vMaxY) continue;

          const sx = worldToScreenX(worldX);
          const sy = worldToScreenY(worldY);
          const sw = battlefield.cellSize * scale;
          const sh = battlefield.cellSize * scale;

          const advantage = probA - probB;
          const alpha = intensity * heatmapOpacity;

          if (advantage > 0) {
            ctx.fillStyle = `rgba(220, 50, 40, ${alpha * advantage})`;
          } else {
            ctx.fillStyle = `rgba(40, 50, 220, ${alpha * -advantage})`;
          }
          ctx.fillRect(sx, sy, sw, sh);
        }
      }
    }

    // --- Draw units ---
    for (let a = 0; a < armies.length; a++) {
      const army = armies[a];
      const color = ARMY_COLORS[a] || '#888';

      for (const id of army.unitIds) {
        const armyData = world.get('army', id);
        if (armyData[1] < 0.5) continue; // dead

        const unitData = world.get('unit', id);
        const ux = unitData[0];
        const uy = unitData[1];
        const health = unitData[2];
        const maxHealth = unitData[3];
        const unitType = unitData[7];

        // Frustum cull
        if (ux < vMinX - 5 || ux > vMaxX + 5 || uy < vMinY - 5 || uy > vMaxY + 5) continue;

        const sx = worldToScreenX(ux);
        const sy = worldToScreenY(uy);
        const unitSize = Math.max(2, scale * 0.8);

        // Health-based alpha
        const healthPct = health / maxHealth;
        ctx.globalAlpha = 0.4 + 0.6 * healthPct;

        // Draw unit shape based on type
        ctx.fillStyle = color;
        ctx.beginPath();

        const shape = UNIT_TYPE_SHAPES[Math.floor(unitType)] || 'circle';
        switch (shape) {
          case 'circle': // Infantry
            ctx.arc(sx, sy, unitSize, 0, Math.PI * 2);
            break;
          case 'diamond': // Archer
            ctx.moveTo(sx, sy - unitSize);
            ctx.lineTo(sx + unitSize, sy);
            ctx.lineTo(sx, sy + unitSize);
            ctx.lineTo(sx - unitSize, sy);
            break;
          case 'triangle': // Cavalry
            ctx.moveTo(sx, sy - unitSize * 1.2);
            ctx.lineTo(sx + unitSize, sy + unitSize * 0.6);
            ctx.lineTo(sx - unitSize, sy + unitSize * 0.6);
            break;
          case 'square': // Artillery
            ctx.rect(sx - unitSize, sy - unitSize, unitSize * 2, unitSize * 2);
            break;
        }
        ctx.fill();

        // Health bar
        if (unitSize > 3 && healthPct < 1) {
          const barW = unitSize * 2;
          const barH = Math.max(1, unitSize * 0.3);
          const barX = sx - barW / 2;
          const barY = sy - unitSize - barH - 1;

          ctx.fillStyle = '#333';
          ctx.fillRect(barX, barY, barW, barH);

          ctx.fillStyle = healthPct > 0.5 ? '#4a4' : healthPct > 0.25 ? '#aa4' : '#a44';
          ctx.fillRect(barX, barY, barW * healthPct, barH);
        }

        ctx.globalAlpha = 1;
      }
    }

    // --- Ghost preview for placement mode ---
    if (ghostPos) {
      const gx = worldToScreenX(ghostPos.x);
      const gy = worldToScreenY(ghostPos.y);
      const gSize = Math.max(3, scale * 1.2);
      const gColor = ARMY_COLORS[ghostArmyIndex] || '#888';

      ctx.globalAlpha = 0.4;
      ctx.fillStyle = gColor;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath();

      const gShape = UNIT_TYPE_SHAPES[ghostUnitType] || 'circle';
      switch (gShape) {
        case 'circle':
          ctx.arc(gx, gy, gSize, 0, Math.PI * 2);
          break;
        case 'diamond':
          ctx.moveTo(gx, gy - gSize);
          ctx.lineTo(gx + gSize, gy);
          ctx.lineTo(gx, gy + gSize);
          ctx.lineTo(gx - gSize, gy);
          break;
        case 'triangle':
          ctx.moveTo(gx, gy - gSize * 1.2);
          ctx.lineTo(gx + gSize, gy + gSize * 0.6);
          ctx.lineTo(gx - gSize, gy + gSize * 0.6);
          break;
        case 'square':
          ctx.rect(gx - gSize, gy - gSize, gSize * 2, gSize * 2);
          break;
      }
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // --- Legend ---
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(w - 130, h - 80, 125, 75);

    ctx.font = '10px monospace';
    ctx.fillStyle = '#888';
    ctx.fillText('Unit Types:', w - 125, h - 65);

    const legendItems = [
      { shape: 'circle', label: 'Infantry', color: '#aaa' },
      { shape: 'diamond', label: 'Archer', color: '#aaa' },
      { shape: 'triangle', label: 'Cavalry', color: '#aaa' },
      { shape: 'square', label: 'Artillery', color: '#aaa' },
    ];

    legendItems.forEach((item, i) => {
      const ly = h - 52 + i * 14;
      ctx.fillStyle = item.color;
      ctx.fillText(`  ${item.shape === 'circle' ? '●' : item.shape === 'diamond' ? '◆' : item.shape === 'triangle' ? '▲' : '■'} ${item.label}`, w - 125, ly);
    });
  }

  destroy(): void {
    // No GPU resources to clean up for Canvas2D
  }
}

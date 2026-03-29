/**
 * Main renderer orchestrator.
 * Manages the WebGPU render pipeline and coordinates all sub-renderers.
 */

import { Camera } from '../engine/camera';
import { TerrainRenderer } from './terrain-renderer';
import { UnitRenderer } from './unit-renderer';
import { ParticleSystem } from './particle-system';
import { HeatmapRenderer } from './heatmap-renderer';

export class Renderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;

  readonly terrain: TerrainRenderer;
  readonly units: UnitRenderer;
  readonly particles: ParticleSystem;
  readonly heatmap: HeatmapRenderer;

  constructor(device: GPUDevice, canvas: HTMLCanvasElement) {
    this.device = device;

    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('Failed to get WebGPU canvas context');
    this.context = ctx;

    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device,
      format: this.format,
      alphaMode: 'premultiplied',
    });

    this.terrain = new TerrainRenderer(device);
    this.units = new UnitRenderer(device);
    this.particles = new ParticleSystem(device);
    this.heatmap = new HeatmapRenderer(device);
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.terrain.initialize(this.format),
      this.units.initialize(this.format),
      this.particles.initialize(this.format),
      this.heatmap.initialize(this.format),
    ]);
  }

  /**
   * Render a full frame.
   */
  render(
    camera: Camera,
    time: number,
    dt: number,
    terrainConfig: { cols: number; rows: number; cellSize: number },
    selectedUnit: number
  ): void {
    const viewProj = camera.getViewProjectionMatrix();
    const encoder = this.device.createCommandEncoder({ label: 'frame' });

    // Compute pass: update particles
    this.particles.update(encoder, dt / 1000);

    // Render pass
    const textureView = this.context.getCurrentTexture().createView();
    const renderPass = encoder.beginRenderPass({
      label: 'main-render',
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    // Draw order: terrain → heatmap → units → particles
    this.terrain.render(
      renderPass, viewProj,
      terrainConfig.cols, terrainConfig.rows, terrainConfig.cellSize,
      time
    );

    this.heatmap.render(
      renderPass, viewProj,
      terrainConfig.cols, terrainConfig.rows, terrainConfig.cellSize
    );

    this.units.render(renderPass, viewProj, time, selectedUnit);
    this.particles.render(renderPass, viewProj);

    renderPass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.terrain.destroy();
    this.units.destroy();
    this.particles.destroy();
    this.heatmap.destroy();
  }
}

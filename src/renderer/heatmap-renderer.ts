/**
 * Heatmap overlay renderer.
 * Visualizes Monte Carlo battle probability across the battlefield.
 */

import { createBuffer } from '../engine/gpu';
import heatmapShader from './heatmap.wgsl?raw';

export class HeatmapRenderer {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private heatmapBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private cellCount = 0;

  visible = true;
  opacity = 0.4;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  async initialize(format: GPUTextureFormat): Promise<void> {
    const module = this.device.createShaderModule({
      label: 'Heatmap Shader',
      code: heatmapShader,
    });

    this.uniformBuffer = this.device.createBuffer({
      label: 'heatmap-uniforms',
      size: 80, // mat4x4(64) + 4 floats(16)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });

    this.pipeline = await this.device.createRenderPipelineAsync({
      label: 'Heatmap Pipeline',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  /**
   * Update heatmap data from Monte Carlo results.
   * heatmapData: Float32Array with 4 floats per cell [prob_a, prob_b, intensity, pad]
   */
  updateHeatmap(heatmapData: Float32Array, cols: number, rows: number): void {
    this.cellCount = cols * rows;

    if (this.heatmapBuffer) this.heatmapBuffer.destroy();
    this.heatmapBuffer = createBuffer(
      this.device,
      heatmapData,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'heatmap-data'
    );

    this.rebuildBindGroup();
  }

  private rebuildBindGroup(): void {
    if (!this.pipeline || !this.uniformBuffer || !this.heatmapBuffer) return;

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.heatmapBuffer } },
      ],
    });
  }

  render(
    pass: GPURenderPassEncoder,
    viewProjMatrix: Float32Array,
    cols: number,
    rows: number,
    cellSize: number
  ): void {
    if (!this.visible || !this.pipeline || !this.bindGroup || !this.uniformBuffer) return;
    if (this.cellCount === 0) return;

    const uniforms = new Float32Array(20);
    uniforms.set(viewProjMatrix, 0);
    uniforms[16] = cols;
    uniforms[17] = rows;
    uniforms[18] = cellSize;
    uniforms[19] = this.opacity;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6, this.cellCount);
  }

  destroy(): void {
    this.uniformBuffer?.destroy();
    this.heatmapBuffer?.destroy();
  }
}

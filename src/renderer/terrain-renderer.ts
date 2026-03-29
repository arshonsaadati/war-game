/**
 * Terrain grid renderer using instanced quads.
 */

import { createBuffer } from '../engine/gpu';
import terrainShader from './terrain.wgsl?raw';

export class TerrainRenderer {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private terrainBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private cellCount = 0;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  async initialize(format: GPUTextureFormat): Promise<void> {
    const module = this.device.createShaderModule({
      label: 'Terrain Shader',
      code: terrainShader,
    });

    this.uniformBuffer = this.device.createBuffer({
      label: 'terrain-uniforms',
      size: 80, // mat4x4(64) + 4 floats(16) = 80, padded to 16-byte alignment
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    this.pipeline = await this.device.createRenderPipelineAsync({
      label: 'Terrain Pipeline',
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: 'vs_main',
      },
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

  updateTerrain(terrainData: Float32Array, cols: number, rows: number): void {
    this.cellCount = cols * rows;

    if (this.terrainBuffer) this.terrainBuffer.destroy();
    this.terrainBuffer = createBuffer(
      this.device,
      terrainData,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'terrain-data'
    );

    this.rebuildBindGroup();
  }

  private rebuildBindGroup(): void {
    if (!this.pipeline || !this.uniformBuffer || !this.terrainBuffer) return;

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.terrainBuffer } },
      ],
    });
  }

  render(
    pass: GPURenderPassEncoder,
    viewProjMatrix: Float32Array,
    cols: number,
    rows: number,
    cellSize: number,
    time: number
  ): void {
    if (!this.pipeline || !this.bindGroup || !this.uniformBuffer) return;

    // Write uniforms: mat4x4 + gridCols + gridRows + cellSize + time
    const uniforms = new Float32Array(20);
    uniforms.set(viewProjMatrix, 0);
    uniforms[16] = cols;
    uniforms[17] = rows;
    uniforms[18] = cellSize;
    uniforms[19] = time;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6, this.cellCount); // 6 verts per quad, instanced
  }

  destroy(): void {
    this.uniformBuffer?.destroy();
    this.terrainBuffer?.destroy();
  }
}

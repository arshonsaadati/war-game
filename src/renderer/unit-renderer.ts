/**
 * Instanced unit renderer.
 * Renders all units in a single draw call per army.
 */

import { createBuffer } from '../engine/gpu';
import unitShader from './units.wgsl?raw';

export class UnitRenderer {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private unitBuffer: GPUBuffer | null = null;
  private armyBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private unitCount = 0;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  async initialize(format: GPUTextureFormat): Promise<void> {
    const module = this.device.createShaderModule({
      label: 'Unit Shader',
      code: unitShader,
    });

    this.uniformBuffer = this.device.createBuffer({
      label: 'unit-uniforms',
      size: 80, // mat4x4(64) + time(4) + selected(4) + pad(8) = 80
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    this.pipeline = await this.device.createRenderPipelineAsync({
      label: 'Unit Pipeline',
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

  updateUnits(unitData: Float32Array, armyData: Float32Array, count: number): void {
    this.unitCount = count;

    if (this.unitBuffer) this.unitBuffer.destroy();
    if (this.armyBuffer) this.armyBuffer.destroy();

    if (count === 0) return;

    this.unitBuffer = createBuffer(
      this.device, unitData,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'units'
    );

    this.armyBuffer = createBuffer(
      this.device, armyData,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'army-info'
    );

    this.rebuildBindGroup();
  }

  private rebuildBindGroup(): void {
    if (!this.pipeline || !this.uniformBuffer || !this.unitBuffer || !this.armyBuffer) return;

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.unitBuffer } },
        { binding: 2, resource: { buffer: this.armyBuffer } },
      ],
    });
  }

  render(
    pass: GPURenderPassEncoder,
    viewProjMatrix: Float32Array,
    time: number,
    selectedUnit: number = -1
  ): void {
    if (!this.pipeline || !this.bindGroup || !this.uniformBuffer || this.unitCount === 0) return;

    const uniforms = new Float32Array(20);
    uniforms.set(viewProjMatrix, 0);
    uniforms[16] = time;
    uniforms[17] = selectedUnit;
    uniforms[18] = 0;
    uniforms[19] = 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6, this.unitCount);
  }

  destroy(): void {
    this.uniformBuffer?.destroy();
    this.unitBuffer?.destroy();
    this.armyBuffer?.destroy();
  }
}

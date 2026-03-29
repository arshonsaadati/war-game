/**
 * GPU-driven particle system.
 * Compute shader updates particle state, render pipeline draws them.
 */

import particleShader from './particles.wgsl?raw';

const MAX_PARTICLES = 8192;
const PARTICLE_STRIDE = 12; // floats per particle
const PARTICLE_BYTES = PARTICLE_STRIDE * 4;

export interface ParticleEmission {
  x: number;
  y: number;
  count: number;
  color: [number, number, number];
  speed: number;
  size: number;
  life: number;
}

export class ParticleSystem {
  private device: GPUDevice;

  // Compute pipeline
  private computePipeline: GPUComputePipeline | null = null;
  private computeBindGroup: GPUBindGroup | null = null;
  private computeParamsBuffer: GPUBuffer | null = null;

  // Render pipeline
  private renderPipeline: GPURenderPipeline | null = null;
  private renderBindGroup: GPUBindGroup | null = null;
  private renderUniformBuffer: GPUBuffer | null = null;

  // Shared particle buffer
  private particleBuffer: GPUBuffer | null = null;

  private activeParticles = 0;
  private nextSlot = 0;

  // CPU-side particle data for emission (we upload on emit)
  private cpuParticles: Float32Array;

  constructor(device: GPUDevice) {
    this.device = device;
    this.cpuParticles = new Float32Array(MAX_PARTICLES * PARTICLE_STRIDE);
  }

  async initialize(format: GPUTextureFormat): Promise<void> {
    const module = this.device.createShaderModule({
      label: 'Particle Shader',
      code: particleShader,
    });

    // Shared particle buffer
    this.particleBuffer = this.device.createBuffer({
      label: 'particles',
      size: MAX_PARTICLES * PARTICLE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // --- Compute pipeline ---
    this.computeParamsBuffer = this.device.createBuffer({
      label: 'particle-params',
      size: 16, // dt, gravity, drag, count
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const computeBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    this.computePipeline = await this.device.createComputePipelineAsync({
      label: 'Particle Compute',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [computeBindGroupLayout] }),
      compute: { module, entryPoint: 'cs_update' },
    });

    this.computeBindGroup = this.device.createBindGroup({
      layout: computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.computeParamsBuffer } },
        { binding: 1, resource: { buffer: this.particleBuffer } },
      ],
    });

    // --- Render pipeline ---
    this.renderUniformBuffer = this.device.createBuffer({
      label: 'particle-render-uniforms',
      size: 64, // mat4x4
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const renderBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });

    this.renderPipeline = await this.device.createRenderPipelineAsync({
      label: 'Particle Render',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one' }, // additive blending
            alpha: { srcFactor: 'one', dstFactor: 'one' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.renderBindGroup = this.device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.renderUniformBuffer } },
        { binding: 1, resource: { buffer: this.particleBuffer } },
      ],
    });
  }

  /**
   * Emit particles at a position (for combat effects).
   */
  emit(emission: ParticleEmission): void {
    for (let i = 0; i < emission.count; i++) {
      const slot = this.nextSlot % MAX_PARTICLES;
      const offset = slot * PARTICLE_STRIDE;

      const angle = Math.random() * Math.PI * 2;
      const speed = emission.speed * (0.5 + Math.random() * 0.5);

      this.cpuParticles[offset + 0] = emission.x;
      this.cpuParticles[offset + 1] = emission.y;
      this.cpuParticles[offset + 2] = Math.cos(angle) * speed; // vel_x
      this.cpuParticles[offset + 3] = Math.sin(angle) * speed; // vel_y
      this.cpuParticles[offset + 4] = 1.0; // life
      this.cpuParticles[offset + 5] = emission.life; // max_life
      this.cpuParticles[offset + 6] = emission.size;
      this.cpuParticles[offset + 7] = emission.color[0];
      this.cpuParticles[offset + 8] = emission.color[1];
      this.cpuParticles[offset + 9] = emission.color[2];
      this.cpuParticles[offset + 10] = 0;
      this.cpuParticles[offset + 11] = 0;

      this.nextSlot++;
    }

    this.activeParticles = Math.min(this.nextSlot, MAX_PARTICLES);

    // Upload changed particles
    if (this.particleBuffer) {
      this.device.queue.writeBuffer(
        this.particleBuffer, 0,
        this.cpuParticles, 0,
        this.activeParticles * PARTICLE_STRIDE
      );
    }
  }

  /**
   * Emit combat effects between two positions.
   */
  emitCombat(x1: number, y1: number, x2: number, y2: number): void {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;

    // Sparks
    this.emit({
      x: mx, y: my, count: 8,
      color: [1.0, 0.8, 0.2],
      speed: 15, size: 0.3, life: 0.5,
    });

    // Smoke
    this.emit({
      x: mx, y: my, count: 4,
      color: [0.4, 0.4, 0.4],
      speed: 5, size: 0.6, life: 1.0,
    });
  }

  /**
   * Run compute pass to update particle physics.
   */
  update(encoder: GPUCommandEncoder, dt: number): void {
    if (!this.computePipeline || !this.computeBindGroup || !this.computeParamsBuffer) return;
    if (this.activeParticles === 0) return;

    const params = new Float32Array([dt, -5.0, 0.5, this.activeParticles]);
    this.device.queue.writeBuffer(this.computeParamsBuffer, 0, params);

    const pass = encoder.beginComputePass({ label: 'particle-update' });
    pass.setPipeline(this.computePipeline);
    pass.setBindGroup(0, this.computeBindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.activeParticles / 64));
    pass.end();
  }

  /**
   * Render particles.
   */
  render(pass: GPURenderPassEncoder, viewProjMatrix: Float32Array): void {
    if (!this.renderPipeline || !this.renderBindGroup || !this.renderUniformBuffer) return;
    if (this.activeParticles === 0) return;

    this.device.queue.writeBuffer(this.renderUniformBuffer, 0, viewProjMatrix);

    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.renderBindGroup);
    pass.draw(6, this.activeParticles);
  }

  destroy(): void {
    this.particleBuffer?.destroy();
    this.computeParamsBuffer?.destroy();
    this.renderUniformBuffer?.destroy();
  }
}

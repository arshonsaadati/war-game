/**
 * Orchestrates Monte Carlo battle simulation on the GPU.
 * Sets up compute pipelines, manages buffers, and reads back results.
 */

import { createBuffer, createEmptyBuffer, readBuffer } from '../engine/gpu';
import monteCarloShader from './monte-carlo.wgsl?raw';
import reductionShader from './reduction.wgsl?raw';

export interface SimulationConfig {
  numSimulations: number; // how many Monte Carlo trials
  terrainCols: number;
  terrainRows: number;
  cellSize: number;
  seed?: number;
}

export interface BattleResult {
  armyAWins: number;
  armyBWins: number;
  draws: number;
  totalSims: number;
  winProbabilityA: number;
  winProbabilityB: number;
  avgSurvivingA: number;
  avgSurvivingB: number;
  rawResults: SimResultData[];
}

export interface SimResultData {
  armyASurviving: number;
  armyBSurviving: number;
  armyATotalDamage: number;
  armyBTotalDamage: number;
}

export class BattleSimulator {
  private device: GPUDevice;
  private monteCarloModule: GPUShaderModule | null = null;
  private reductionModule: GPUShaderModule | null = null;
  private monteCarloLayout: GPUBindGroupLayout | null = null;
  private monteCarloPipeline: GPUComputePipeline | null = null;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  async initialize(): Promise<void> {
    this.monteCarloModule = this.device.createShaderModule({
      label: 'Monte Carlo Battle Shader',
      code: monteCarloShader,
    });

    // Log shader compilation errors
    const mcInfo = await this.monteCarloModule.getCompilationInfo();
    for (const msg of mcInfo.messages) {
      console[msg.type === 'error' ? 'error' : 'warn'](
        `[WGSL ${msg.type}] line ${msg.lineNum}: ${msg.message}`
      );
    }

    this.reductionModule = this.device.createShaderModule({
      label: 'Reduction Shader',
      code: reductionShader,
    });

    const redInfo = await this.reductionModule.getCompilationInfo();
    for (const msg of redInfo.messages) {
      console[msg.type === 'error' ? 'error' : 'warn'](
        `[WGSL ${msg.type}] line ${msg.lineNum}: ${msg.message}`
      );
    }

    this.monteCarloPipeline = await this.device.createComputePipelineAsync({
      label: 'Monte Carlo Pipeline',
      layout: 'auto',
      compute: {
        module: this.monteCarloModule,
        entryPoint: 'main',
      },
    });

    this.monteCarloLayout = this.monteCarloPipeline.getBindGroupLayout(0);
  }

  async runBattle(
    armyAData: Float32Array,
    armyBData: Float32Array,
    terrainData: Float32Array,
    config: SimulationConfig
  ): Promise<BattleResult> {
    if (!this.monteCarloPipeline || !this.monteCarloLayout) {
      throw new Error('Simulator not initialized. Call initialize() first.');
    }

    const numUnitsA = armyAData.length / 8; // 8 floats per unit
    const numUnitsB = armyBData.length / 8;
    const seed = config.seed ?? Math.floor(Math.random() * 0xFFFFFFFF);

    // SimParams struct (8 u32/f32 values = 32 bytes)
    const params = new ArrayBuffer(32);
    const paramsU32 = new Uint32Array(params);
    const paramsF32 = new Float32Array(params);
    paramsU32[0] = numUnitsA;
    paramsU32[1] = numUnitsB;
    paramsU32[2] = config.numSimulations;
    paramsU32[3] = config.terrainCols;
    paramsU32[4] = config.terrainRows;
    paramsF32[5] = config.cellSize;
    paramsU32[6] = seed;
    paramsU32[7] = 0; // padding

    // Create GPU buffers
    const paramsBuffer = createBuffer(
      this.device, params,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      'sim-params'
    );

    const armyABuffer = createBuffer(
      this.device, armyAData,
      GPUBufferUsage.STORAGE,
      'army-a'
    );

    const armyBBuffer = createBuffer(
      this.device, armyBData,
      GPUBufferUsage.STORAGE,
      'army-b'
    );

    const terrainBuffer = createBuffer(
      this.device, terrainData,
      GPUBufferUsage.STORAGE,
      'terrain'
    );

    // Results buffer: SimResult = 4 values * 4 bytes = 16 bytes each
    const resultsSize = config.numSimulations * 16;
    const resultsBuffer = createEmptyBuffer(
      this.device, resultsSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      'sim-results'
    );

    // Bind group
    const bindGroup = this.device.createBindGroup({
      layout: this.monteCarloLayout,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: armyABuffer } },
        { binding: 2, resource: { buffer: armyBBuffer } },
        { binding: 3, resource: { buffer: terrainBuffer } },
        { binding: 4, resource: { buffer: resultsBuffer } },
      ],
    });

    // Dispatch compute
    const workgroupSize = 64;
    const numWorkgroups = Math.ceil(config.numSimulations / workgroupSize);

    const encoder = this.device.createCommandEncoder({ label: 'monte-carlo-encoder' });
    const pass = encoder.beginComputePass({ label: 'monte-carlo-pass' });
    pass.setPipeline(this.monteCarloPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(numWorkgroups);
    pass.end();

    this.device.queue.submit([encoder.finish()]);

    // Read back results
    const rawData = await readBuffer(this.device, resultsBuffer, resultsSize);
    const resultView = new Uint32Array(rawData);
    const resultFloatView = new Float32Array(rawData);

    // Parse results and aggregate on CPU
    // (We have the reduction shader too, but CPU aggregation is fine for readback)
    const rawResults: SimResultData[] = [];
    let aWins = 0, bWins = 0, draws = 0;
    let totalSurvA = 0, totalSurvB = 0;

    for (let i = 0; i < config.numSimulations; i++) {
      const offset = i * 4;
      const result: SimResultData = {
        armyASurviving: resultView[offset],
        armyBSurviving: resultView[offset + 1],
        armyATotalDamage: resultFloatView[offset + 2],
        armyBTotalDamage: resultFloatView[offset + 3],
      };
      rawResults.push(result);

      if (result.armyASurviving > result.armyBSurviving) aWins++;
      else if (result.armyBSurviving > result.armyASurviving) bWins++;
      else draws++;

      totalSurvA += result.armyASurviving;
      totalSurvB += result.armyBSurviving;
    }

    // Cleanup
    paramsBuffer.destroy();
    armyABuffer.destroy();
    armyBBuffer.destroy();
    terrainBuffer.destroy();
    resultsBuffer.destroy();

    const totalSims = config.numSimulations;
    return {
      armyAWins: aWins,
      armyBWins: bWins,
      draws,
      totalSims,
      winProbabilityA: aWins / totalSims,
      winProbabilityB: bWins / totalSims,
      avgSurvivingA: totalSurvA / totalSims,
      avgSurvivingB: totalSurvB / totalSims,
      rawResults,
    };
  }
}

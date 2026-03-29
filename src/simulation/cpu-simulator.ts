/**
 * CPU fallback for the Monte Carlo battle simulation.
 * Ports the GPU compute shader logic (monte-carlo.wgsl) to TypeScript
 * so the game works on devices where GPU compute hangs or is unavailable.
 */

import { SimulationConfig, BattleResult, SimResultData } from './simulator';

// Unit struct layout: [posX, posY, health, maxHealth, attack, defense, morale, unitType]
const UNIT_STRIDE = 8;

// Terrain cell layout: [terrainType, attackMod, defenseMod, moraleMod]
const TERRAIN_STRIDE = 4;

// Unit type constants (matching WGSL: 0=infantry, 1=archer, 2=cavalry, 3=artillery)
const UNIT_TYPE_INFANTRY = 0;
const UNIT_TYPE_CAVALRY = 2;
const UNIT_TYPE_ARTILLERY = 3;

// ------------------------------------------------------------------
// PCG random number generator — same algorithm as the WGSL shader
// ------------------------------------------------------------------

function pcgHash(input: number): number {
  // All arithmetic must stay in u32 range
  let state = Math.imul(input >>> 0, 747796405) + 2891336453;
  state = state >>> 0;
  let word = ((state >>> ((state >>> 28) + 4)) ^ state) >>> 0;
  word = Math.imul(word, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

class PCGRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  /** Returns a float in [0, 1). Advances the RNG state. */
  nextFloat(): number {
    this.seed = pcgHash(this.seed);
    return (this.seed >>> 0) / 0xFFFFFFFF;
  }
}

// ------------------------------------------------------------------
// Terrain lookup
// ------------------------------------------------------------------

interface TerrainCell {
  terrainType: number;
  attackMod: number;
  defenseMod: number;
  moraleMod: number;
}

const DEFAULT_TERRAIN: TerrainCell = {
  terrainType: 0,
  attackMod: 1,
  defenseMod: 1,
  moraleMod: 1,
};

function getTerrainAt(
  terrainData: Float32Array,
  terrainCols: number,
  terrainRows: number,
  cellSize: number,
  posX: number,
  posY: number,
): TerrainCell {
  const col = Math.floor(posX / cellSize) >>> 0;
  const row = Math.floor(posY / cellSize) >>> 0;

  if (col < terrainCols && row < terrainRows) {
    const idx = (row * terrainCols + col) * TERRAIN_STRIDE;
    return {
      terrainType: terrainData[idx],
      attackMod: terrainData[idx + 1],
      defenseMod: terrainData[idx + 2],
      moraleMod: terrainData[idx + 3],
    };
  }

  return DEFAULT_TERRAIN;
}

// ------------------------------------------------------------------
// Combat damage — mirrors calc_damage() in the WGSL shader
// ------------------------------------------------------------------

function calcDamage(
  attacker: Float32Array, // slice of 8 floats
  defender: Float32Array,
  attTerrain: TerrainCell,
  defTerrain: TerrainCell,
  rng: PCGRandom,
): number {
  const attAttack = attacker[4];
  const attMorale = attacker[6];
  const attType = attacker[7];
  const defDefense = defender[5];

  // Base damage = attack * terrain_attack_mod
  const baseAttack = attAttack * attTerrain.attackMod;

  // Defense reduction
  const effectiveDefense = defDefense * defTerrain.defenseMod;

  // Morale factor (0.5 to 1.5 range based on morale percentage)
  const moraleFactor = 0.5 + attMorale / 100.0;

  // Random variance: +/- 30%
  const variance = 0.7 + rng.nextFloat() * 0.6;

  // Distance between units
  const dx = attacker[0] - defender[0];
  const dy = attacker[1] - defender[1];
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Range factor
  let rangeFactor = 1.0;
  if (attType === UNIT_TYPE_INFANTRY || attType === UNIT_TYPE_CAVALRY) {
    // Melee: full damage at dist < 5, falling off to 0 at dist > 20
    rangeFactor = Math.min(Math.max(1.0 - (dist - 5.0) / 15.0, 0.0), 1.0);
  } else {
    // Ranged: optimal distance depends on unit type
    const optimalDist = attType === UNIT_TYPE_ARTILLERY ? 35.0 : 20.0;
    rangeFactor = Math.min(
      Math.max(1.0 - Math.abs(dist - optimalDist) / optimalDist, 0.2),
      1.0,
    );
  }

  // Cavalry charge bonus (extra damage at charge range)
  let chargeBonus = 1.0;
  if (attType === UNIT_TYPE_CAVALRY && dist > 8.0 && dist < 15.0) {
    chargeBonus = 1.5;
  }

  // Final damage calculation
  const rawDamage =
    baseAttack * moraleFactor * variance * rangeFactor * chargeBonus;
  const damage = Math.max(rawDamage - effectiveDefense * 0.5, 1.0);

  return damage;
}

// ------------------------------------------------------------------
// Single simulation run — mirrors the WGSL main() entry point
// ------------------------------------------------------------------

function runSingleSim(
  armyAData: Float32Array,
  armyBData: Float32Array,
  terrainData: Float32Array,
  config: SimulationConfig,
  simSeed: number,
): SimResultData {
  const rng = new PCGRandom(simSeed);

  const countA = Math.min(armyAData.length / UNIT_STRIDE, 96);
  const countB = Math.min(armyBData.length / UNIT_STRIDE, 96);

  // Copy health values (local simulation state)
  const healthA = new Float32Array(countA);
  const healthB = new Float32Array(countB);
  for (let i = 0; i < countA; i++) {
    healthA[i] = armyAData[i * UNIT_STRIDE + 2]; // health offset
  }
  for (let i = 0; i < countB; i++) {
    healthB[i] = armyBData[i * UNIT_STRIDE + 2];
  }

  let totalDamageToA = 0;
  let totalDamageToB = 0;

  // Simulate up to 50 combat rounds
  for (let round = 0; round < 50; round++) {
    // Count alive units
    let aliveA = 0;
    let aliveB = 0;
    for (let i = 0; i < countA; i++) {
      if (healthA[i] > 0) aliveA++;
    }
    for (let i = 0; i < countB; i++) {
      if (healthB[i] > 0) aliveB++;
    }

    if (aliveA === 0 || aliveB === 0) break;

    // Each alive unit in A attacks a random alive unit in B
    for (let i = 0; i < countA; i++) {
      if (healthA[i] <= 0) continue;

      // Pick random target in B
      const targetRoll = Math.floor(rng.nextFloat() * countB) >>> 0;
      let tgt = targetRoll % countB;

      // Find next alive target
      for (let t = 0; t < countB; t++) {
        if (healthB[tgt] > 0) break;
        tgt = (tgt + 1) % countB;
      }
      if (healthB[tgt] <= 0) break;

      const attOffset = i * UNIT_STRIDE;
      const defOffset = tgt * UNIT_STRIDE;
      const attTerrain = getTerrainAt(
        terrainData,
        config.terrainCols,
        config.terrainRows,
        config.cellSize,
        armyAData[attOffset],
        armyAData[attOffset + 1],
      );
      const defTerrain = getTerrainAt(
        terrainData,
        config.terrainCols,
        config.terrainRows,
        config.cellSize,
        armyBData[defOffset],
        armyBData[defOffset + 1],
      );

      const dmg = calcDamage(
        armyAData.subarray(attOffset, attOffset + UNIT_STRIDE),
        armyBData.subarray(defOffset, defOffset + UNIT_STRIDE),
        attTerrain,
        defTerrain,
        rng,
      );
      healthB[tgt] -= dmg;
      totalDamageToB += dmg;
    }

    // Each alive unit in B attacks a random alive unit in A
    for (let i = 0; i < countB; i++) {
      if (healthB[i] <= 0) continue;

      const targetRoll = Math.floor(rng.nextFloat() * countA) >>> 0;
      let tgt = targetRoll % countA;

      for (let t = 0; t < countA; t++) {
        if (healthA[tgt] > 0) break;
        tgt = (tgt + 1) % countA;
      }
      if (healthA[tgt] <= 0) break;

      const attOffset = i * UNIT_STRIDE;
      const defOffset = tgt * UNIT_STRIDE;
      const attTerrain = getTerrainAt(
        terrainData,
        config.terrainCols,
        config.terrainRows,
        config.cellSize,
        armyBData[attOffset],
        armyBData[attOffset + 1],
      );
      const defTerrain = getTerrainAt(
        terrainData,
        config.terrainCols,
        config.terrainRows,
        config.cellSize,
        armyAData[defOffset],
        armyAData[defOffset + 1],
      );

      const dmg = calcDamage(
        armyBData.subarray(attOffset, attOffset + UNIT_STRIDE),
        armyAData.subarray(defOffset, defOffset + UNIT_STRIDE),
        attTerrain,
        defTerrain,
        rng,
      );
      healthA[tgt] -= dmg;
      totalDamageToA += dmg;
    }
  }

  // Count final survivors
  let survivingA = 0;
  let survivingB = 0;
  for (let i = 0; i < countA; i++) {
    if (healthA[i] > 0) survivingA++;
  }
  for (let i = 0; i < countB; i++) {
    if (healthB[i] > 0) survivingB++;
  }

  return {
    armyASurviving: survivingA,
    armyBSurviving: survivingB,
    armyATotalDamage: totalDamageToA,
    armyBTotalDamage: totalDamageToB,
  };
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/** Default number of trials for CPU fallback (fewer than GPU's 4096). */
export const CPU_DEFAULT_SIMULATIONS = 512;

/**
 * CPU-based Monte Carlo battle simulator.
 * Same interface as BattleSimulator.runBattle() but runs sequentially
 * on the CPU. No initialize() step required.
 */
export class CPUBattleSimulator {
  runBattle(
    armyAData: Float32Array,
    armyBData: Float32Array,
    terrainData: Float32Array,
    config: SimulationConfig,
  ): BattleResult {
    const numSims = config.numSimulations;
    const baseSeed = config.seed ?? Math.floor(Math.random() * 0xFFFFFFFF);

    const rawResults: SimResultData[] = [];
    let aWins = 0;
    let bWins = 0;
    let draws = 0;
    let totalSurvA = 0;
    let totalSurvB = 0;

    for (let simId = 0; simId < numSims; simId++) {
      // Same seed derivation as the WGSL shader: baseSeed ^ pcgHash(simId)
      const simSeed = (baseSeed ^ pcgHash(simId)) >>> 0;

      const result = runSingleSim(
        armyAData,
        armyBData,
        terrainData,
        config,
        simSeed,
      );
      rawResults.push(result);

      if (result.armyASurviving > result.armyBSurviving) aWins++;
      else if (result.armyBSurviving > result.armyASurviving) bWins++;
      else draws++;

      totalSurvA += result.armyASurviving;
      totalSurvB += result.armyBSurviving;
    }

    return {
      armyAWins: aWins,
      armyBWins: bWins,
      draws,
      totalSims: numSims,
      winProbabilityA: aWins / numSims,
      winProbabilityB: bWins / numSims,
      avgSurvivingA: totalSurvA / numSims,
      avgSurvivingB: totalSurvB / numSims,
      rawResults,
    };
  }
}

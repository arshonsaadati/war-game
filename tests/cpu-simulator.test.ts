import { describe, it, expect } from 'vitest';
import { CPUBattleSimulator, CPU_DEFAULT_SIMULATIONS } from '../src/simulation/cpu-simulator';
import { SimulationConfig } from '../src/simulation/simulator';

// Helper: build a flat Float32Array of units.
// Each unit = 8 floats: [posX, posY, health, maxHealth, attack, defense, morale, unitType]
function makeUnits(
  units: Array<{
    x: number;
    y: number;
    health: number;
    maxHealth: number;
    attack: number;
    defense: number;
    morale: number;
    type: number;
  }>,
): Float32Array {
  const buf = new Float32Array(units.length * 8);
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const off = i * 8;
    buf[off] = u.x;
    buf[off + 1] = u.y;
    buf[off + 2] = u.health;
    buf[off + 3] = u.maxHealth;
    buf[off + 4] = u.attack;
    buf[off + 5] = u.defense;
    buf[off + 6] = u.morale;
    buf[off + 7] = u.type;
  }
  return buf;
}

// Default terrain: 4x4 grid of plains (attackMod=1, defenseMod=1, moraleMod=1)
function makePlainsTerrain(cols: number, rows: number): Float32Array {
  const buf = new Float32Array(cols * rows * 4);
  for (let i = 0; i < cols * rows; i++) {
    buf[i * 4] = 0; // Plains
    buf[i * 4 + 1] = 1; // attackMod
    buf[i * 4 + 2] = 1; // defenseMod
    buf[i * 4 + 3] = 1; // moraleMod
  }
  return buf;
}

function defaultConfig(numSims: number = CPU_DEFAULT_SIMULATIONS): SimulationConfig {
  return {
    numSimulations: numSims,
    terrainCols: 4,
    terrainRows: 4,
    cellSize: 50,
    seed: 12345,
  };
}

// A symmetric infantry unit template
function infantry(x: number, y: number) {
  return { x, y, health: 100, maxHealth: 100, attack: 15, defense: 12, morale: 70, type: 0 };
}

describe('CPUBattleSimulator', () => {
  const sim = new CPUBattleSimulator();

  it('produces valid results with correct structure', () => {
    const armyA = makeUnits([infantry(10, 10), infantry(12, 10)]);
    const armyB = makeUnits([infantry(30, 10), infantry(32, 10)]);
    const terrain = makePlainsTerrain(4, 4);
    const config = defaultConfig(64);

    const result = sim.runBattle(armyA, armyB, terrain, config);

    expect(result.totalSims).toBe(64);
    expect(result.armyAWins + result.armyBWins + result.draws).toBe(64);
    expect(result.winProbabilityA).toBeGreaterThanOrEqual(0);
    expect(result.winProbabilityA).toBeLessThanOrEqual(1);
    expect(result.winProbabilityB).toBeGreaterThanOrEqual(0);
    expect(result.winProbabilityB).toBeLessThanOrEqual(1);
    expect(result.avgSurvivingA).toBeGreaterThanOrEqual(0);
    expect(result.avgSurvivingB).toBeGreaterThanOrEqual(0);
    expect(result.rawResults).toHaveLength(64);
  });

  it('raw results have valid per-simulation data', () => {
    const armyA = makeUnits([infantry(10, 10)]);
    const armyB = makeUnits([infantry(30, 10)]);
    const terrain = makePlainsTerrain(4, 4);
    const config = defaultConfig(32);

    const result = sim.runBattle(armyA, armyB, terrain, config);

    for (const r of result.rawResults) {
      // Each side started with 1 unit, so survivors must be 0 or 1
      expect(r.armyASurviving).toBeGreaterThanOrEqual(0);
      expect(r.armyASurviving).toBeLessThanOrEqual(1);
      expect(r.armyBSurviving).toBeGreaterThanOrEqual(0);
      expect(r.armyBSurviving).toBeLessThanOrEqual(1);
      // Damage must be positive (combat always deals at least 1 damage)
      expect(r.armyATotalDamage).toBeGreaterThan(0);
      expect(r.armyBTotalDamage).toBeGreaterThan(0);
    }
  });

  it('results have variance (not all identical)', () => {
    // Place units close together (dist ~3) so melee range factor is 1.0
    // and random variance in damage actually matters
    const armyA = makeUnits([
      infantry(10, 10),
      infantry(10, 12),
      infantry(10, 14),
      infantry(10, 16),
      infantry(10, 18),
    ]);
    const armyB = makeUnits([
      infantry(13, 10),
      infantry(13, 12),
      infantry(13, 14),
      infantry(13, 16),
      infantry(13, 18),
    ]);
    const terrain = makePlainsTerrain(4, 4);
    const config = defaultConfig(256);

    const result = sim.runBattle(armyA, armyB, terrain, config);

    // Collect unique survivor-A counts across simulations
    const uniqueSurvA = new Set(result.rawResults.map((r) => r.armyASurviving));
    const uniqueSurvB = new Set(result.rawResults.map((r) => r.armyBSurviving));

    // With 256 sims, close-range combat, and randomness, we should see varied outcomes
    expect(uniqueSurvA.size).toBeGreaterThanOrEqual(2);
    expect(uniqueSurvB.size).toBeGreaterThanOrEqual(2);
  });

  it('symmetric armies produce close to 50/50 win probability', () => {
    // Both sides get 10 identical infantry at mirrored positions
    const unitsA = [];
    const unitsB = [];
    for (let i = 0; i < 10; i++) {
      unitsA.push(infantry(10, 10 + i * 2));
      unitsB.push(infantry(12, 10 + i * 2)); // same distance from each other
    }

    const armyA = makeUnits(unitsA);
    const armyB = makeUnits(unitsB);
    const terrain = makePlainsTerrain(4, 4);
    const config = defaultConfig(512);

    const result = sim.runBattle(armyA, armyB, terrain, config);

    // With symmetric armies the win probability should be roughly 50/50.
    // Allow a generous margin for randomness: between 20% and 80%.
    expect(result.winProbabilityA).toBeGreaterThan(0.2);
    expect(result.winProbabilityA).toBeLessThan(0.8);
    expect(result.winProbabilityB).toBeGreaterThan(0.2);
    expect(result.winProbabilityB).toBeLessThan(0.8);
  });

  it('a much larger army consistently wins', () => {
    // Army A: 20 infantry vs Army B: 2 infantry
    const unitsA = [];
    for (let i = 0; i < 20; i++) {
      unitsA.push(infantry(10, 5 + i * 2));
    }
    const unitsB = [infantry(12, 20), infantry(12, 22)];

    const armyA = makeUnits(unitsA);
    const armyB = makeUnits(unitsB);
    const terrain = makePlainsTerrain(4, 4);
    const config = defaultConfig(256);

    const result = sim.runBattle(armyA, armyB, terrain, config);

    // Army A should win overwhelmingly (> 90% of sims)
    expect(result.winProbabilityA).toBeGreaterThan(0.9);
    expect(result.avgSurvivingA).toBeGreaterThan(result.avgSurvivingB);
  });

  it('deterministic with same seed', () => {
    const armyA = makeUnits([infantry(10, 10), infantry(12, 10)]);
    const armyB = makeUnits([infantry(30, 10), infantry(32, 10)]);
    const terrain = makePlainsTerrain(4, 4);

    const config1 = defaultConfig(64);
    config1.seed = 999;
    const result1 = sim.runBattle(armyA, armyB, terrain, config1);

    const config2 = defaultConfig(64);
    config2.seed = 999;
    const result2 = sim.runBattle(armyA, armyB, terrain, config2);

    expect(result1.armyAWins).toBe(result2.armyAWins);
    expect(result1.armyBWins).toBe(result2.armyBWins);
    expect(result1.draws).toBe(result2.draws);

    for (let i = 0; i < result1.rawResults.length; i++) {
      expect(result1.rawResults[i].armyASurviving).toBe(result2.rawResults[i].armyASurviving);
      expect(result1.rawResults[i].armyBSurviving).toBe(result2.rawResults[i].armyBSurviving);
    }
  });

  it('different seeds produce different results', () => {
    // Place units close together so combat outcomes actually vary
    const unitsA = [];
    const unitsB = [];
    for (let i = 0; i < 5; i++) {
      unitsA.push(infantry(10, 10 + i * 2));
      unitsB.push(infantry(13, 10 + i * 2));
    }
    const armyA = makeUnits(unitsA);
    const armyB = makeUnits(unitsB);
    const terrain = makePlainsTerrain(4, 4);

    const config1 = defaultConfig(128);
    config1.seed = 1111;
    const result1 = sim.runBattle(armyA, armyB, terrain, config1);

    const config2 = defaultConfig(128);
    config2.seed = 2222;
    const result2 = sim.runBattle(armyA, armyB, terrain, config2);

    // With different seeds, at least some raw results should differ
    let different = false;
    for (let i = 0; i < result1.rawResults.length; i++) {
      if (
        result1.rawResults[i].armyASurviving !== result2.rawResults[i].armyASurviving ||
        result1.rawResults[i].armyBSurviving !== result2.rawResults[i].armyBSurviving
      ) {
        different = true;
        break;
      }
    }
    expect(different).toBe(true);
  });

  it('CPU_DEFAULT_SIMULATIONS is 512', () => {
    expect(CPU_DEFAULT_SIMULATIONS).toBe(512);
  });
});

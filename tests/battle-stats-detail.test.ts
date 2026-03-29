import { describe, it, expect } from 'vitest';
import { analyzeBattle, DetailedBattleStats } from '../src/game/battle-stats';
import { World } from '../src/engine/ecs';
import {
  UNIT_STRIDE,
  UnitType,
  createArmy,
  spawnFormation,
  Army,
} from '../src/game/army';
import { Battlefield } from '../src/game/battlefield';
import { BattleResult, SimResultData } from '../src/simulation/simulator';

function setupWorld(): { world: World; armyA: Army; armyB: Army; battlefield: Battlefield } {
  const world = new World(1000);
  world.registerComponent('unit', Float32Array, UNIT_STRIDE);
  world.registerComponent('army', Float32Array, 2);

  const armyA = createArmy(world, 0, 'Red Legion', [1, 0, 0]);
  const armyB = createArmy(world, 1, 'Blue Guard', [0, 0, 1]);

  const battlefield = new Battlefield({ width: 200, height: 200, cellSize: 10 });
  battlefield.generateRandom(42);

  // Spawn some units
  spawnFormation(world, armyA, UnitType.Infantry, 30, 100, 3, 5);
  spawnFormation(world, armyA, UnitType.Archer, 20, 80, 2, 4);
  spawnFormation(world, armyB, UnitType.Infantry, 170, 100, 3, 5);
  spawnFormation(world, armyB, UnitType.Cavalry, 180, 120, 2, 3);

  return { world, armyA, armyB, battlefield };
}

function makeBattleResult(overrides?: Partial<BattleResult>): BattleResult {
  const rawResults: SimResultData[] = [];
  for (let i = 0; i < 100; i++) {
    rawResults.push({
      armyASurviving: 5 + Math.floor(Math.random() * 10),
      armyBSurviving: 3 + Math.floor(Math.random() * 8),
      armyATotalDamage: 200 + Math.random() * 300,
      armyBTotalDamage: 250 + Math.random() * 350,
    });
  }

  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  let totalSurvA = 0;
  let totalSurvB = 0;

  for (const r of rawResults) {
    if (r.armyASurviving > r.armyBSurviving) aWins++;
    else if (r.armyBSurviving > r.armyASurviving) bWins++;
    else draws++;
    totalSurvA += r.armyASurviving;
    totalSurvB += r.armyBSurviving;
  }

  return {
    armyAWins: aWins,
    armyBWins: bWins,
    draws,
    totalSims: 100,
    winProbabilityA: aWins / 100,
    winProbabilityB: bWins / 100,
    avgSurvivingA: totalSurvA / 100,
    avgSurvivingB: totalSurvB / 100,
    rawResults,
    ...overrides,
  };
}

describe('analyzeBattle', () => {
  it('returns valid DetailedBattleStats', () => {
    const { world, armyA, armyB, battlefield } = setupWorld();
    const result = makeBattleResult();
    const stats = analyzeBattle(result, world, armyA, armyB, battlefield);

    expect(stats).toBeDefined();
    expect(typeof stats.casualtiesA).toBe('number');
    expect(typeof stats.casualtiesB).toBe('number');
    expect(typeof stats.avgDamageDealtA).toBe('number');
    expect(typeof stats.avgDamageDealtB).toBe('number');
    expect(typeof stats.winStreak).toBe('number');
    expect(['A', 'B', 'none']).toContain(stats.winStreakArmy);
    expect(stats.closestBattle).toHaveProperty('index');
    expect(stats.closestBattle).toHaveProperty('margin');
    expect(stats.mostDecisive).toHaveProperty('index');
    expect(stats.mostDecisive).toHaveProperty('margin');
    expect(typeof stats.mostEffectiveUnitTypeA).toBe('string');
    expect(typeof stats.mostEffectiveUnitTypeB).toBe('string');
    expect(Array.isArray(stats.terrainAdvantage)).toBe(true);
  });

  it('computes non-negative casualties', () => {
    const { world, armyA, armyB, battlefield } = setupWorld();
    const result = makeBattleResult();
    const stats = analyzeBattle(result, world, armyA, armyB, battlefield);

    expect(stats.casualtiesA).toBeGreaterThanOrEqual(0);
    expect(stats.casualtiesB).toBeGreaterThanOrEqual(0);
  });

  it('computes positive average damage', () => {
    const { world, armyA, armyB, battlefield } = setupWorld();
    const result = makeBattleResult();
    const stats = analyzeBattle(result, world, armyA, armyB, battlefield);

    expect(stats.avgDamageDealtA).toBeGreaterThan(0);
    expect(stats.avgDamageDealtB).toBeGreaterThan(0);
  });

  it('finds closest and most decisive battles with valid indices', () => {
    const { world, armyA, armyB, battlefield } = setupWorld();
    const result = makeBattleResult();
    const stats = analyzeBattle(result, world, armyA, armyB, battlefield);

    expect(stats.closestBattle.index).toBeGreaterThanOrEqual(0);
    expect(stats.closestBattle.index).toBeLessThan(result.rawResults.length);
    expect(stats.closestBattle.margin).toBeGreaterThanOrEqual(0);

    expect(stats.mostDecisive.index).toBeGreaterThanOrEqual(0);
    expect(stats.mostDecisive.index).toBeLessThan(result.rawResults.length);
    expect(stats.mostDecisive.margin).toBeGreaterThanOrEqual(stats.closestBattle.margin);
  });

  it('produces a valid win streak count', () => {
    const { world, armyA, armyB, battlefield } = setupWorld();
    const result = makeBattleResult();
    const stats = analyzeBattle(result, world, armyA, armyB, battlefield);

    expect(stats.winStreak).toBeGreaterThanOrEqual(0);
    expect(stats.winStreak).toBeLessThanOrEqual(result.rawResults.length);
  });

  it('identifies most effective unit types as valid strings', () => {
    const { world, armyA, armyB, battlefield } = setupWorld();
    const result = makeBattleResult();
    const stats = analyzeBattle(result, world, armyA, armyB, battlefield);

    const validTypes = ['Infantry', 'Archer', 'Cavalry', 'Artillery'];
    expect(validTypes).toContain(stats.mostEffectiveUnitTypeA);
    expect(validTypes).toContain(stats.mostEffectiveUnitTypeB);
  });

  it('terrain advantage has correct structure', () => {
    const { world, armyA, armyB, battlefield } = setupWorld();
    const result = makeBattleResult();
    const stats = analyzeBattle(result, world, armyA, armyB, battlefield);

    expect(stats.terrainAdvantage.length).toBeGreaterThan(0);
    for (const t of stats.terrainAdvantage) {
      expect(typeof t.terrain).toBe('string');
      expect(typeof t.attackMod).toBe('number');
      expect(typeof t.defenseMod).toBe('number');
      expect(typeof t.unitsA).toBe('number');
      expect(typeof t.unitsB).toBe('number');
      expect(t.unitsA).toBeGreaterThanOrEqual(0);
      expect(t.unitsB).toBeGreaterThanOrEqual(0);
    }
  });

  it('terrain unit counts sum to army sizes', () => {
    const { world, armyA, armyB, battlefield } = setupWorld();
    const result = makeBattleResult();
    const stats = analyzeBattle(result, world, armyA, armyB, battlefield);

    const totalTerrainA = stats.terrainAdvantage.reduce((s, t) => s + t.unitsA, 0);
    const totalTerrainB = stats.terrainAdvantage.reduce((s, t) => s + t.unitsB, 0);

    expect(totalTerrainA).toBe(armyA.unitIds.length);
    expect(totalTerrainB).toBe(armyB.unitIds.length);
  });

  it('handles empty raw results gracefully', () => {
    const { world, armyA, armyB, battlefield } = setupWorld();
    const result = makeBattleResult({
      rawResults: [],
      armyAWins: 0,
      armyBWins: 0,
      draws: 0,
      totalSims: 0,
      avgSurvivingA: 0,
      avgSurvivingB: 0,
    });
    const stats = analyzeBattle(result, world, armyA, armyB, battlefield);

    expect(stats).toBeDefined();
    expect(stats.winStreak).toBe(0);
    expect(stats.closestBattle.margin).toBe(0);
    expect(stats.mostDecisive.margin).toBe(0);
  });

  it('detects streak for dominant army when all results are A wins', () => {
    const { world, armyA, armyB, battlefield } = setupWorld();
    const rawResults: SimResultData[] = Array.from({ length: 50 }, () => ({
      armyASurviving: 10,
      armyBSurviving: 0,
      armyATotalDamage: 100,
      armyBTotalDamage: 500,
    }));

    const result: BattleResult = {
      armyAWins: 50,
      armyBWins: 0,
      draws: 0,
      totalSims: 50,
      winProbabilityA: 1,
      winProbabilityB: 0,
      avgSurvivingA: 10,
      avgSurvivingB: 0,
      rawResults,
    };

    const stats = analyzeBattle(result, world, armyA, armyB, battlefield);

    expect(stats.winStreak).toBe(50);
    expect(stats.winStreakArmy).toBe('A');
  });
});

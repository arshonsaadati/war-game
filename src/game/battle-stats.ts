/**
 * Detailed battle statistics analysis.
 * Computes casualties, damage metrics, streaks, and terrain breakdowns
 * from Monte Carlo simulation results.
 */

import { BattleResult, SimResultData } from '../simulation/simulator';
import { World } from '../engine/ecs';
import { Army, UNIT_STRIDE, UnitType } from './army';
import { Battlefield, TerrainType, TERRAIN_MODIFIERS } from './battlefield';

export interface TerrainAdvantage {
  terrain: string;
  attackMod: number;
  defenseMod: number;
  /** Number of army A units on this terrain */
  unitsA: number;
  /** Number of army B units on this terrain */
  unitsB: number;
}

export interface DetailedBattleStats {
  casualtiesA: number;
  casualtiesB: number;
  avgDamageDealtA: number;
  avgDamageDealtB: number;
  winStreak: number;
  /** Which army holds the streak: 'A', 'B', or 'none' */
  winStreakArmy: 'A' | 'B' | 'none';
  closestBattle: { index: number; margin: number };
  mostDecisive: { index: number; margin: number };
  mostEffectiveUnitTypeA: string;
  mostEffectiveUnitTypeB: string;
  terrainAdvantage: TerrainAdvantage[];
}

const TERRAIN_NAMES: Record<TerrainType, string> = {
  [TerrainType.Plains]: 'Plains',
  [TerrainType.Forest]: 'Forest',
  [TerrainType.Hills]: 'Hills',
  [TerrainType.Water]: 'Water',
  [TerrainType.Mountains]: 'Mountains',
};

const UNIT_TYPE_NAMES: Record<UnitType, string> = {
  [UnitType.Infantry]: 'Infantry',
  [UnitType.Archer]: 'Archer',
  [UnitType.Cavalry]: 'Cavalry',
  [UnitType.Artillery]: 'Artillery',
};

/**
 * Analyze a battle result and produce detailed statistics.
 */
export function analyzeBattle(
  result: BattleResult,
  world: World,
  armyA: Army,
  armyB: Army,
  battlefield: Battlefield,
): DetailedBattleStats {
  const totalA = armyA.unitIds.length;
  const totalB = armyB.unitIds.length;

  // Casualties = total units minus average surviving
  const casualtiesA = Math.max(0, totalA - result.avgSurvivingA);
  const casualtiesB = Math.max(0, totalB - result.avgSurvivingB);

  // Average damage dealt (from raw results)
  let totalDmgA = 0;
  let totalDmgB = 0;
  for (const r of result.rawResults) {
    totalDmgA += r.armyATotalDamage;
    totalDmgB += r.armyBTotalDamage;
  }
  const numSims = result.rawResults.length || 1;
  const avgDamageDealtA = totalDmgB / numSims; // damage dealt BY A = damage TO B
  const avgDamageDealtB = totalDmgA / numSims; // damage dealt BY B = damage TO A

  // Win streak: longest consecutive wins for the dominant army
  let currentStreak = 0;
  let maxStreak = 0;
  let streakArmy: 'A' | 'B' | 'none' = 'none';
  let currentStreakArmy: 'A' | 'B' | 'none' = 'none';

  for (const r of result.rawResults) {
    let winner: 'A' | 'B' | 'none' = 'none';
    if (r.armyASurviving > r.armyBSurviving) winner = 'A';
    else if (r.armyBSurviving > r.armyASurviving) winner = 'B';

    if (winner !== 'none' && winner === currentStreakArmy) {
      currentStreak++;
    } else {
      currentStreak = winner !== 'none' ? 1 : 0;
      currentStreakArmy = winner;
    }

    if (currentStreak > maxStreak) {
      maxStreak = currentStreak;
      streakArmy = currentStreakArmy;
    }
  }

  // Closest and most decisive battles
  let closestIndex = 0;
  let closestMargin = Infinity;
  let decisiveIndex = 0;
  let decisiveMargin = 0;

  for (let i = 0; i < result.rawResults.length; i++) {
    const r = result.rawResults[i];
    const margin = Math.abs(r.armyASurviving - r.armyBSurviving);

    if (margin < closestMargin) {
      closestMargin = margin;
      closestIndex = i;
    }
    if (margin > decisiveMargin) {
      decisiveMargin = margin;
      decisiveIndex = i;
    }
  }

  // If no results, set closestMargin to 0
  if (result.rawResults.length === 0) {
    closestMargin = 0;
  }

  // Most effective unit type — determined by which type has highest
  // (attack * terrain attack mod) across all units of that type
  const effectivenessA = computeUnitEffectiveness(world, armyA, battlefield);
  const effectivenessB = computeUnitEffectiveness(world, armyB, battlefield);

  const mostEffectiveUnitTypeA = getBestUnitType(effectivenessA);
  const mostEffectiveUnitTypeB = getBestUnitType(effectivenessB);

  // Terrain advantage breakdown
  const terrainAdvantage = computeTerrainAdvantage(world, armyA, armyB, battlefield);

  return {
    casualtiesA,
    casualtiesB,
    avgDamageDealtA,
    avgDamageDealtB,
    winStreak: maxStreak,
    winStreakArmy: streakArmy,
    closestBattle: { index: closestIndex, margin: closestMargin },
    mostDecisive: { index: decisiveIndex, margin: decisiveMargin },
    mostEffectiveUnitTypeA,
    mostEffectiveUnitTypeB,
    terrainAdvantage,
  };
}

function computeUnitEffectiveness(
  world: World,
  army: Army,
  battlefield: Battlefield,
): Record<UnitType, number> {
  const effectiveness: Record<UnitType, number> = {
    [UnitType.Infantry]: 0,
    [UnitType.Archer]: 0,
    [UnitType.Cavalry]: 0,
    [UnitType.Artillery]: 0,
  };

  for (const id of army.unitIds) {
    const armyData = world.get('army', id);
    if (armyData[1] <= 0) continue; // dead

    const unitData = world.get('unit', id);
    const posX = unitData[0];
    const posY = unitData[1];
    const attack = unitData[4];
    const unitType = Math.round(unitData[7]) as UnitType;

    const [attackMod] = battlefield.getModifiers(posX, posY);
    const effectiveAttack = attack * attackMod;

    if (unitType in effectiveness) {
      effectiveness[unitType] += effectiveAttack;
    }
  }

  return effectiveness;
}

function getBestUnitType(effectiveness: Record<UnitType, number>): string {
  let bestType: UnitType = UnitType.Infantry;
  let bestValue = -1;

  for (const [typeStr, value] of Object.entries(effectiveness)) {
    const type = Number(typeStr) as UnitType;
    if (value > bestValue) {
      bestValue = value;
      bestType = type;
    }
  }

  return UNIT_TYPE_NAMES[bestType] ?? 'Unknown';
}

function computeTerrainAdvantage(
  world: World,
  armyA: Army,
  armyB: Army,
  battlefield: Battlefield,
): TerrainAdvantage[] {
  const terrainMap = new Map<TerrainType, { unitsA: number; unitsB: number }>();

  // Count army A units per terrain
  for (const id of armyA.unitIds) {
    const armyData = world.get('army', id);
    if (armyData[1] <= 0) continue;

    const unitData = world.get('unit', id);
    const terrain = battlefield.getTerrainAtWorldPos(unitData[0], unitData[1]);

    if (!terrainMap.has(terrain)) {
      terrainMap.set(terrain, { unitsA: 0, unitsB: 0 });
    }
    terrainMap.get(terrain)!.unitsA++;
  }

  // Count army B units per terrain
  for (const id of armyB.unitIds) {
    const armyData = world.get('army', id);
    if (armyData[1] <= 0) continue;

    const unitData = world.get('unit', id);
    const terrain = battlefield.getTerrainAtWorldPos(unitData[0], unitData[1]);

    if (!terrainMap.has(terrain)) {
      terrainMap.set(terrain, { unitsA: 0, unitsB: 0 });
    }
    terrainMap.get(terrain)!.unitsB++;
  }

  const advantages: TerrainAdvantage[] = [];
  for (const [terrain, counts] of terrainMap.entries()) {
    const mods = TERRAIN_MODIFIERS[terrain];
    advantages.push({
      terrain: TERRAIN_NAMES[terrain] ?? 'Unknown',
      attackMod: mods[0],
      defenseMod: mods[1],
      unitsA: counts.unitsA,
      unitsB: counts.unitsB,
    });
  }

  // Sort by total units (most populated terrain first)
  advantages.sort((a, b) => (b.unitsA + b.unitsB) - (a.unitsA + a.unitsB));

  return advantages;
}

/**
 * Render detailed battle stats as HTML and inject into the battle-log element.
 */
export function renderBattleLogHTML(
  el: HTMLElement,
  stats: DetailedBattleStats,
  armyAName: string,
  armyBName: string,
): void {
  const L: string[] = [];
  L.push(`<span class="log-label">Casualties:</span> <span class="log-red">${armyAName}</span> ${stats.casualtiesA.toFixed(1)} | <span class="log-blue">${armyBName}</span> ${stats.casualtiesB.toFixed(1)}`);
  L.push(`<span class="log-label">Avg Damage Dealt:</span> <span class="log-red">${armyAName}</span> <span class="log-value">${stats.avgDamageDealtA.toFixed(1)}</span> | <span class="log-blue">${armyBName}</span> <span class="log-value">${stats.avgDamageDealtB.toFixed(1)}</span>`);
  L.push(`<span class="log-label">Most Effective Unit:</span> <span class="log-red">${stats.mostEffectiveUnitTypeA}</span> | <span class="log-blue">${stats.mostEffectiveUnitTypeB}</span>`);
  if (stats.winStreak > 1) {
    const cls = stats.winStreakArmy === 'A' ? 'log-red' : 'log-blue';
    const name = stats.winStreakArmy === 'A' ? armyAName : armyBName;
    L.push(`<span class="log-label">Win Streak:</span> <span class="${cls}">${name}</span> <span class="log-value">${stats.winStreak}</span> consecutive`);
  }
  L.push(`<span class="log-label">Closest Battle:</span> Sim #${stats.closestBattle.index + 1} (margin: <span class="log-value">${stats.closestBattle.margin}</span>)`);
  L.push(`<span class="log-label">Most Decisive:</span> Sim #${stats.mostDecisive.index + 1} (margin: <span class="log-value">${stats.mostDecisive.margin}</span>)`);
  if (stats.terrainAdvantage.length > 0) {
    L.push(`<span class="log-label">Terrain Breakdown:</span>`);
    for (const t of stats.terrainAdvantage) {
      L.push(`  ${t.terrain}: atk ${t.attackMod.toFixed(1)}x def ${t.defenseMod.toFixed(1)}x (<span class="log-red">${t.unitsA}</span>/<span class="log-blue">${t.unitsB}</span> units)`);
    }
  }
  el.innerHTML = L.map(l => `<div>${l}</div>`).join('');
}

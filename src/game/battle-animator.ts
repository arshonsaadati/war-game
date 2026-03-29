/**
 * Battle animation system.
 * Takes Monte Carlo results and animates a representative battle over time.
 * Units march toward each other, clash at the midpoint, and casualties
 * drop based on the simulation outcome.
 */

import { World, EntityId } from '../engine/ecs';
import { Army } from './army';
import { Battlefield } from './battlefield';
import { BattleResult } from '../simulation/simulator';

export type AnimationState = 'idle' | 'running' | 'paused' | 'complete';

/** Callback signature for combat events (e.g. trigger particle effects). */
export type CombatCallback = (x: number, y: number) => void;

interface UnitAnimState {
  entityId: EntityId;
  armyIdx: 0 | 1;
  alive: boolean;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  // Scheduled death time (normalized 0..1), or -1 if survives
  deathTime: number;
  hasFired: boolean; // has emitted combat event
}

export interface BattleAnimatorConfig {
  /** Time in seconds for the full animation at 1x speed. Default: 10 */
  duration?: number;
  /** Combat engagement range in world units. Default: 12 */
  combatRange?: number;
  /** Movement speed in world-units per second at 1x. Default: 15 */
  moveSpeed?: number;
}

export class BattleAnimator {
  private world: World;
  private armyA: Army;
  private armyB: Army;
  private battlefield: Battlefield;
  private result: BattleResult | null = null;

  private _state: AnimationState = 'idle';
  private _speed = 1.0;
  private _progress = 0; // 0..1
  private _elapsed = 0;  // seconds at 1x speed
  private _duration: number;
  private _combatRange: number;
  private _moveSpeed: number;

  private unitStates: UnitAnimState[] = [];
  private onCombat: CombatCallback | null = null;

  // Snapshot of original positions so we can reset
  private originalPositions: Map<EntityId, [number, number]> = new Map();
  private originalAlive: Map<EntityId, number> = new Map();

  constructor(
    world: World,
    armyA: Army,
    armyB: Army,
    battlefield: Battlefield,
    config?: BattleAnimatorConfig
  ) {
    this.world = world;
    this.armyA = armyA;
    this.armyB = armyB;
    this.battlefield = battlefield;
    this._duration = config?.duration ?? 10;
    this._combatRange = config?.combatRange ?? 12;
    this._moveSpeed = config?.moveSpeed ?? 15;
  }

  get state(): AnimationState { return this._state; }
  get progress(): number { return this._progress; }
  get speed(): number { return this._speed; }

  /** Register a callback for combat events (particle effects). */
  onCombatEvent(cb: CombatCallback): void {
    this.onCombat = cb;
  }

  start(result: BattleResult): void {
    this.result = result;
    this._state = 'running';
    this._progress = 0;
    this._elapsed = 0;

    this.snapshotOriginalState();
    this.buildAnimationPlan();
  }

  pause(): void {
    if (this._state === 'running') {
      this._state = 'paused';
    }
  }

  resume(): void {
    if (this._state === 'paused') {
      this._state = 'running';
    }
  }

  setSpeed(speed: number): void {
    this._speed = Math.max(0.1, Math.min(speed, 10));
  }

  isComplete(): boolean {
    return this._state === 'complete';
  }

  update(dt: number): void {
    if (this._state !== 'running') return;

    this._elapsed += dt * this._speed;
    this._progress = Math.min(this._elapsed / this._duration, 1);

    for (const us of this.unitStates) {
      if (!us.alive) continue;

      // Check for death
      if (us.deathTime >= 0 && this._progress >= us.deathTime) {
        us.alive = false;
        this.world.set('army', us.entityId, us.armyIdx, 0);

        // Combat effect at death
        const unitData = this.world.get('unit', us.entityId);
        this.onCombat?.(unitData[0], unitData[1]);
        continue;
      }

      // Move unit in a straight line from start toward target
      // March phase is 0% to 50%, combat phase is 50% to 100%
      const marchProgress = Math.min(this._progress / 0.5, 1);

      // Don't march past the combat range of the target
      const totalDx = us.targetX - us.startX;
      const totalDy = us.targetY - us.startY;
      const totalDist = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
      const stopDist = Math.max(0, totalDist - this._combatRange);
      const marchDist = stopDist * marchProgress;

      let posX: number, posY: number;
      if (totalDist > 0.1) {
        const dirX = totalDx / totalDist;
        const dirY = totalDy / totalDist;
        posX = us.startX + dirX * marchDist;
        posY = us.startY + dirY * marchDist;
      } else {
        posX = us.startX;
        posY = us.startY;
      }

      // Emit combat event when units reach engagement range
      if (marchProgress >= 0.95 && !us.hasFired) {
        us.hasFired = true;
        this.onCombat?.(posX, posY);
      }

      // Update ECS position
      const unitData = this.world.get('unit', us.entityId);
      this.world.set('unit', us.entityId,
        posX, posY,
        unitData[2], unitData[3], unitData[4], unitData[5], unitData[6], unitData[7]
      );
    }

    if (this._progress >= 1) {
      this._state = 'complete';
    }
  }

  reset(): void {
    for (const [entityId, [px, py]] of this.originalPositions) {
      const unitData = this.world.get('unit', entityId);
      this.world.set('unit', entityId,
        px, py, unitData[2], unitData[3], unitData[4], unitData[5], unitData[6], unitData[7]
      );
    }

    for (const [entityId, alive] of this.originalAlive) {
      const armyData = this.world.get('army', entityId);
      this.world.set('army', entityId, armyData[0], alive);
    }

    this.unitStates = [];
    this._state = 'idle';
    this._progress = 0;
    this._elapsed = 0;
  }

  // --- Private methods ---

  private snapshotOriginalState(): void {
    this.originalPositions.clear();
    this.originalAlive.clear();

    const allUnits = [...this.armyA.unitIds, ...this.armyB.unitIds];
    for (const id of allUnits) {
      const unitData = this.world.get('unit', id);
      this.originalPositions.set(id, [unitData[0], unitData[1]]);
      const armyData = this.world.get('army', id);
      this.originalAlive.set(id, armyData[1]);
    }
  }

  private buildAnimationPlan(): void {
    this.unitStates = [];

    if (!this.result || this.result.rawResults.length === 0) return;

    // Pick the median result
    const sorted = [...this.result.rawResults].sort(
      (a, b) => (a.armyASurviving - a.armyBSurviving) - (b.armyASurviving - b.armyBSurviving)
    );
    const median = sorted[Math.floor(sorted.length / 2)];

    const aDead = Math.max(0, this.armyA.unitIds.length - median.armyASurviving);
    const bDead = Math.max(0, this.armyB.unitIds.length - median.armyBSurviving);

    // Calculate average enemy position for each army (march target)
    const avgEnemyA = this.getArmyCenter(this.armyB);
    const avgEnemyB = this.getArmyCenter(this.armyA);

    // Army A units
    const aDeathIndices = this.selectDeathIndices(this.armyA.unitIds.length, aDead);
    for (let i = 0; i < this.armyA.unitIds.length; i++) {
      const entityId = this.armyA.unitIds[i];
      const unitData = this.world.get('unit', entityId);
      const dies = aDeathIndices.has(i);
      // Death during combat phase (50%-95%)
      const deathTime = dies ? 0.5 + seededRandom(entityId) * 0.45 : -1;

      this.unitStates.push({
        entityId,
        armyIdx: 0,
        alive: true,
        startX: unitData[0],
        startY: unitData[1],
        targetX: avgEnemyA[0],
        targetY: avgEnemyA[1],
        deathTime,
        hasFired: false,
      });
    }

    // Army B units
    const bDeathIndices = this.selectDeathIndices(this.armyB.unitIds.length, bDead);
    for (let i = 0; i < this.armyB.unitIds.length; i++) {
      const entityId = this.armyB.unitIds[i];
      const unitData = this.world.get('unit', entityId);
      const dies = bDeathIndices.has(i);
      const deathTime = dies ? 0.5 + seededRandom(entityId) * 0.45 : -1;

      this.unitStates.push({
        entityId,
        armyIdx: 1,
        alive: true,
        startX: unitData[0],
        startY: unitData[1],
        targetX: avgEnemyB[0],
        targetY: avgEnemyB[1],
        deathTime,
        hasFired: false,
      });
    }
  }

  private getArmyCenter(army: Army): [number, number] {
    let sumX = 0, sumY = 0, count = 0;
    for (const id of army.unitIds) {
      const armyData = this.world.get('army', id);
      if (armyData[1] <= 0) continue;
      const unitData = this.world.get('unit', id);
      sumX += unitData[0];
      sumY += unitData[1];
      count++;
    }
    if (count === 0) return [100, 100];
    return [sumX / count, sumY / count];
  }

  /**
   * Select which unit indices die — front-line units die first.
   */
  private selectDeathIndices(total: number, numDead: number): Set<number> {
    const indices = new Set<number>();
    for (let i = 0; i < Math.min(numDead, total); i++) {
      indices.add(i);
    }
    return indices;
  }
}

function seededRandom(seed: number): number {
  let s = seed;
  s = ((s >>> 16) ^ s) * 0x45d9f3b;
  s = ((s >>> 16) ^ s) * 0x45d9f3b;
  s = (s >>> 16) ^ s;
  return (s & 0x7fffffff) / 0x7fffffff;
}

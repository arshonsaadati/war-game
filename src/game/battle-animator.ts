/**
 * Battle animation system.
 * Takes Monte Carlo results and animates a representative battle over time,
 * mutating ECS data (positions, isAlive) without touching WebGPU directly.
 */

import { World, EntityId } from '../engine/ecs';
import { Army } from './army';
import { Battlefield } from './battlefield';
import { BattleResult } from '../simulation/simulator';
import { findPath, worldToGrid, gridToWorld } from './pathfinding';

export type AnimationState = 'idle' | 'running' | 'paused' | 'complete';

/** Callback signature for combat events (e.g. trigger particle effects). */
export type CombatCallback = (x: number, y: number) => void;

interface UnitAnimState {
  entityId: EntityId;
  armyIdx: 0 | 1;
  alive: boolean;
  // Path in world coordinates
  path: [number, number][];
  pathIndex: number;
  // Scheduled death time (normalized 0..1 across animation), or -1 if survives
  deathTime: number;
  // Target opponent entity for combat
  targetId: EntityId | null;
  // Combat engagement range (world units)
  inCombat: boolean;
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

  /**
   * Start animating a battle from the given Monte Carlo result.
   * Takes a single representative result from rawResults to decide who dies.
   */
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

  /**
   * Advance the animation by dt seconds.
   * Mutates ECS unit positions and army isAlive flags.
   */
  update(dt: number): void {
    if (this._state !== 'running') return;

    this._elapsed += dt * this._speed;
    this._progress = Math.min(this._elapsed / this._duration, 1);

    // Move units and process combat
    for (const us of this.unitStates) {
      if (!us.alive) continue;

      // Check for death
      if (us.deathTime >= 0 && this._progress >= us.deathTime) {
        us.alive = false;
        this.world.set('army', us.entityId, us.armyIdx, 0); // isAlive = 0

        // Emit combat effect at death position
        const unitData = this.world.get('unit', us.entityId);
        if (this.onCombat) {
          this.onCombat(unitData[0], unitData[1]);
        }
        continue;
      }

      // Move unit along path toward enemy
      this.moveUnit(us, dt * this._speed);
    }

    // Check for completion
    if (this._progress >= 1) {
      this._state = 'complete';
    }
  }

  /**
   * Reset the animation: restore all units to their original positions and alive state.
   */
  reset(): void {
    // Restore original state
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

    // Pick the median result as representative
    const sorted = [...this.result.rawResults].sort(
      (a, b) => (a.armyASurviving - a.armyBSurviving) - (b.armyASurviving - b.armyBSurviving)
    );
    const median = sorted[Math.floor(sorted.length / 2)];

    // Determine how many units die from each army
    const aDead = Math.max(0, this.armyA.unitIds.length - median.armyASurviving);
    const bDead = Math.max(0, this.armyB.unitIds.length - median.armyBSurviving);

    // Build unit anim states for army A
    const aDeathIndices = this.selectDeathIndices(this.armyA.unitIds.length, aDead);
    for (let i = 0; i < this.armyA.unitIds.length; i++) {
      const entityId = this.armyA.unitIds[i];
      const dies = aDeathIndices.has(i);
      this.unitStates.push(this.buildUnitState(entityId, 0, dies, this.armyB));
    }

    // Build unit anim states for army B
    const bDeathIndices = this.selectDeathIndices(this.armyB.unitIds.length, bDead);
    for (let i = 0; i < this.armyB.unitIds.length; i++) {
      const entityId = this.armyB.unitIds[i];
      const dies = bDeathIndices.has(i);
      this.unitStates.push(this.buildUnitState(entityId, 1, dies, this.armyA));
    }
  }

  private buildUnitState(
    entityId: EntityId,
    armyIdx: 0 | 1,
    dies: boolean,
    enemyArmy: Army
  ): UnitAnimState {
    const unitData = this.world.get('unit', entityId);
    const posX = unitData[0];
    const posY = unitData[1];

    // Find nearest enemy and plan a path toward them
    let nearestEnemy: EntityId | null = null;
    let nearestDist = Infinity;

    for (const enemyId of enemyArmy.unitIds) {
      const enemyData = this.world.get('unit', enemyId);
      const dx = enemyData[0] - posX;
      const dy = enemyData[1] - posY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestEnemy = enemyId;
      }
    }

    // Build path toward the nearest enemy
    let path: [number, number][] = [];
    if (nearestEnemy !== null) {
      const enemyData = this.world.get('unit', nearestEnemy);
      const [startCol, startRow] = worldToGrid(this.battlefield, posX, posY);
      const [endCol, endRow] = worldToGrid(this.battlefield, enemyData[0], enemyData[1]);
      const gridPath = findPath(this.battlefield, startCol, startRow, endCol, endRow);

      // Convert grid path to world coordinates
      path = gridPath.map(([c, r]) => gridToWorld(this.battlefield, c, r));
    }

    // If the unit dies, schedule its death across the 40%-90% range of the animation
    // (first half is approach, deaths happen during combat phase)
    const deathTime = dies ? 0.4 + seededRandom(entityId) * 0.5 : -1;

    return {
      entityId,
      armyIdx: armyIdx as 0 | 1,
      alive: true,
      path,
      pathIndex: 0,
      deathTime,
      targetId: nearestEnemy,
      inCombat: false,
    };
  }

  private moveUnit(us: UnitAnimState, dt: number): void {
    if (us.path.length === 0) return;

    const unitData = this.world.get('unit', us.entityId);
    let posX = unitData[0];
    let posY = unitData[1];

    // Check if already in combat range of target
    if (us.targetId !== null) {
      const targetData = this.world.get('unit', us.targetId);
      const dx = targetData[0] - posX;
      const dy = targetData[1] - posY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= this._combatRange) {
        if (!us.inCombat) {
          us.inCombat = true;
          // Emit combat effect
          if (this.onCombat) {
            this.onCombat((posX + targetData[0]) / 2, (posY + targetData[1]) / 2);
          }
        }
        return; // Stop moving once in range
      }
    }

    // Move toward next path waypoint
    if (us.pathIndex < us.path.length) {
      const [targetX, targetY] = us.path[us.pathIndex];
      const dx = targetX - posX;
      const dy = targetY - posY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 0.5) {
        // Arrived at waypoint, advance
        us.pathIndex++;
      } else {
        // Move toward waypoint
        const step = this._moveSpeed * dt;
        const ratio = Math.min(step / dist, 1);
        posX += dx * ratio;
        posY += dy * ratio;

        // Update ECS position
        this.world.set('unit', us.entityId,
          posX, posY,
          unitData[2], unitData[3], unitData[4], unitData[5], unitData[6], unitData[7]
        );
      }
    }
  }

  /**
   * Select which unit indices should die.
   * Spreads deaths across the formation (front units die first).
   */
  private selectDeathIndices(total: number, numDead: number): Set<number> {
    const indices = new Set<number>();
    // Kill from the front (lower indices first — they're closer to the enemy)
    for (let i = 0; i < Math.min(numDead, total); i++) {
      indices.add(i);
    }
    return indices;
  }
}

/**
 * Simple deterministic pseudo-random based on entity ID.
 * Returns a value in [0, 1).
 */
function seededRandom(seed: number): number {
  let s = seed;
  s = ((s >>> 16) ^ s) * 0x45d9f3b;
  s = ((s >>> 16) ^ s) * 0x45d9f3b;
  s = (s >>> 16) ^ s;
  return (s & 0x7fffffff) / 0x7fffffff;
}

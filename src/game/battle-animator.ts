/**
 * Battle animation system.
 * Runs a real-time simplified battle simulation that you can watch.
 * Unlike the Monte Carlo (which runs 512 abstract simulations for statistics),
 * this plays out ONE actual fight where unit types matter:
 *   - Infantry: advances to melee range (~5), fights hand-to-hand
 *   - Archers: stay back, shoot from range (~25), retreat if enemies close
 *   - Cavalry: charges fast, bonus damage on first contact
 *   - Artillery: stays far back (~35), high damage, very fragile
 */

import { World, EntityId } from '../engine/ecs';
import { Army } from './army';
import { Battlefield } from './battlefield';
import { BattleResult } from '../simulation/simulator';
import { UnitType } from './army';

export type AnimationState = 'idle' | 'running' | 'paused' | 'complete';
export type CombatCallback = (x: number, y: number) => void;

// Unit behavior constants per type
const ENGAGE_RANGE: Record<number, number> = {
  [UnitType.Infantry]: 5,
  [UnitType.Archer]: 25,
  [UnitType.Cavalry]: 8,
  [UnitType.Artillery]: 35,
};

const MOVE_SPEED: Record<number, number> = {
  [UnitType.Infantry]: 12,
  [UnitType.Archer]: 6,    // archers barely move — they hold position
  [UnitType.Cavalry]: 25,  // cavalry is fast
  [UnitType.Artillery]: 0, // artillery never moves
};

const ATTACK_COOLDOWN: Record<number, number> = {
  [UnitType.Infantry]: 1.0,
  [UnitType.Archer]: 1.5,
  [UnitType.Cavalry]: 0.8,
  [UnitType.Artillery]: 2.5,
};

interface LiveUnit {
  entityId: EntityId;
  armyIdx: 0 | 1;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  attack: number;
  defense: number;
  unitType: number;
  targetId: EntityId | null;
  attackTimer: number;
  hasCharged: boolean; // cavalry charge bonus (first hit only)
}

export interface BattleAnimatorConfig {
  duration?: number;
  combatRange?: number;
  moveSpeed?: number;
}

export class BattleAnimator {
  private world: World;
  private armyA: Army;
  private armyB: Army;
  private battlefield: Battlefield;

  private _state: AnimationState = 'idle';
  private _speed = 1.0;
  private _progress = 0;
  private _elapsed = 0;
  private _duration: number;

  private units: LiveUnit[] = [];
  private onCombat: CombatCallback | null = null;

  // Snapshot for reset
  private originalPositions: Map<EntityId, [number, number]> = new Map();
  private originalAlive: Map<EntityId, number> = new Map();
  private originalHealth: Map<EntityId, number> = new Map();

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
    this._duration = config?.duration ?? 30;
  }

  get state(): AnimationState { return this._state; }
  get progress(): number { return this._progress; }
  get speed(): number { return this._speed; }

  onCombatEvent(cb: CombatCallback): void { this.onCombat = cb; }

  start(_result: BattleResult): void {
    this._state = 'running';
    this._progress = 0;
    this._elapsed = 0;

    this.snapshotOriginalState();
    this.buildLiveUnits();
  }

  pause(): void {
    if (this._state === 'running') this._state = 'paused';
  }

  resume(): void {
    if (this._state === 'paused') this._state = 'running';
  }

  setSpeed(speed: number): void {
    this._speed = Math.max(0.1, Math.min(speed, 10));
  }

  isComplete(): boolean {
    return this._state === 'complete';
  }

  update(dt: number): void {
    if (this._state !== 'running') return;

    const simDt = dt * this._speed;
    this._elapsed += simDt;
    this._progress = Math.min(this._elapsed / this._duration, 1);

    // Run the actual battle tick
    this.battleTick(simDt);

    // Sync live units back to ECS
    for (const u of this.units) {
      if (u.health <= 0) {
        this.world.set('army', u.entityId, u.armyIdx, 0);
      }
      const ud = this.world.get('unit', u.entityId);
      this.world.set('unit', u.entityId,
        u.x, u.y, Math.max(0, u.health), ud[3], ud[4], ud[5], ud[6], ud[7]
      );
    }

    // Check for end: one side eliminated or time up
    const aliveA = this.units.filter(u => u.armyIdx === 0 && u.health > 0).length;
    const aliveB = this.units.filter(u => u.armyIdx === 1 && u.health > 0).length;

    if (aliveA === 0 || aliveB === 0 || this._progress >= 1) {
      this._state = 'complete';
    }
  }

  reset(): void {
    for (const [id, [px, py]] of this.originalPositions) {
      const ud = this.world.get('unit', id);
      this.world.set('unit', id, px, py, ud[2], ud[3], ud[4], ud[5], ud[6], ud[7]);
    }
    for (const [id, hp] of this.originalHealth) {
      const ud = this.world.get('unit', id);
      this.world.set('unit', id, ud[0], ud[1], hp, ud[3], ud[4], ud[5], ud[6], ud[7]);
    }
    for (const [id, alive] of this.originalAlive) {
      const ad = this.world.get('army', id);
      this.world.set('army', id, ad[0], alive);
    }

    this.units = [];
    this._state = 'idle';
    this._progress = 0;
    this._elapsed = 0;
  }

  // ---- Private ----

  private snapshotOriginalState(): void {
    this.originalPositions.clear();
    this.originalAlive.clear();
    this.originalHealth.clear();

    for (const id of [...this.armyA.unitIds, ...this.armyB.unitIds]) {
      const ud = this.world.get('unit', id);
      this.originalPositions.set(id, [ud[0], ud[1]]);
      this.originalHealth.set(id, ud[2]);
      const ad = this.world.get('army', id);
      this.originalAlive.set(id, ad[1]);
    }
  }

  private buildLiveUnits(): void {
    this.units = [];

    const build = (army: Army, idx: 0 | 1) => {
      for (const id of army.unitIds) {
        const ad = this.world.get('army', id);
        if (ad[1] <= 0) continue;
        const ud = this.world.get('unit', id);
        this.units.push({
          entityId: id,
          armyIdx: idx,
          x: ud[0], y: ud[1],
          health: ud[2], maxHealth: ud[3],
          attack: ud[4], defense: ud[5],
          unitType: Math.round(ud[7]),
          targetId: null,
          attackTimer: 0,
          hasCharged: false,
        });
      }
    };

    build(this.armyA, 0);
    build(this.armyB, 1);
  }

  private battleTick(dt: number): void {
    const alive = this.units.filter(u => u.health > 0);
    const teamA = alive.filter(u => u.armyIdx === 0);
    const teamB = alive.filter(u => u.armyIdx === 1);

    for (const u of alive) {
      const enemies = u.armyIdx === 0 ? teamB : teamA;
      if (enemies.length === 0) return;

      // Find nearest enemy
      let nearest: LiveUnit | null = null;
      let nearestDist = Infinity;
      for (const e of enemies) {
        const dx = e.x - u.x;
        const dy = e.y - u.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = e;
        }
      }

      if (!nearest) continue;

      const engageRange = ENGAGE_RANGE[u.unitType] ?? 5;
      const moveSpd = MOVE_SPEED[u.unitType] ?? 10;

      if (nearestDist > engageRange && moveSpd > 0) {
        // Move toward enemy
        const dx = nearest.x - u.x;
        const dy = nearest.y - u.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0.1) {
          const step = moveSpd * dt;
          const ratio = Math.min(step / dist, 1);
          u.x += dx * ratio;
          u.y += dy * ratio;
        }
      } else if (nearestDist <= engageRange) {
        // In range — attack!
        u.attackTimer -= dt;
        if (u.attackTimer <= 0) {
          const cooldown = ATTACK_COOLDOWN[u.unitType] ?? 1.0;
          u.attackTimer = cooldown;

          // Calculate damage
          let dmg = u.attack;

          // Cavalry charge bonus (first attack only)
          if (u.unitType === UnitType.Cavalry && !u.hasCharged) {
            dmg *= 1.8;
            u.hasCharged = true;
          }

          // Random variance +/- 25%
          dmg *= 0.75 + seededRandom(u.entityId + Math.floor(this._elapsed * 100)) * 0.5;

          // Defense reduction
          dmg = Math.max(1, dmg - nearest.defense * 0.4);

          nearest.health -= dmg;

          // Combat effect
          const mx = (u.x + nearest.x) / 2;
          const my = (u.y + nearest.y) / 2;
          this.onCombat?.(mx, my);

          // If enemy dies, emit extra effect
          if (nearest.health <= 0) {
            this.onCombat?.(nearest.x, nearest.y);
          }
        }
      }

      // Archers retreat if enemies get too close
      if (u.unitType === UnitType.Archer && nearestDist < 8 && moveSpd > 0) {
        const dx = u.x - nearest.x;
        const dy = u.y - nearest.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0.1) {
          const retreat = 8 * dt;
          u.x += (dx / dist) * retreat;
          u.y += (dy / dist) * retreat;
        }
      }
    }
  }
}

function seededRandom(seed: number): number {
  let s = Math.abs(seed | 0);
  s = ((s >>> 16) ^ s) * 0x45d9f3b;
  s = ((s >>> 16) ^ s) * 0x45d9f3b;
  s = (s >>> 16) ^ s;
  return (s & 0x7fffffff) / 0x7fffffff;
}

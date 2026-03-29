import { describe, it, expect } from 'vitest';
import { World } from '../src/engine/ecs';
import {
  UNIT_STRIDE,
  UnitType,
  createArmy,
  spawnUnit,
  spawnFormation,
} from '../src/game/army';
import { Battlefield } from '../src/game/battlefield';
import { BattleAnimator, AnimationState } from '../src/game/battle-animator';
import { BattleResult } from '../src/simulation/simulator';

function makeWorld(): World {
  const world = new World(10000);
  world.registerComponent('unit', Float32Array, UNIT_STRIDE);
  world.registerComponent('army', Float32Array, 2);
  return world;
}

function makeBattlefield(): Battlefield {
  return new Battlefield({ width: 200, height: 200, cellSize: 10 });
}

function makeBattleResult(aSurv: number, bSurv: number, totalSims = 10): BattleResult {
  const rawResults = Array.from({ length: totalSims }, () => ({
    armyASurviving: aSurv,
    armyBSurviving: bSurv,
    armyATotalDamage: 100,
    armyBTotalDamage: 100,
  }));

  const aWins = aSurv > bSurv ? totalSims : 0;
  const bWins = bSurv > aSurv ? totalSims : 0;
  const draws = aSurv === bSurv ? totalSims : 0;

  return {
    armyAWins: aWins,
    armyBWins: bWins,
    draws,
    totalSims,
    winProbabilityA: aWins / totalSims,
    winProbabilityB: bWins / totalSims,
    avgSurvivingA: aSurv,
    avgSurvivingB: bSurv,
    rawResults,
  };
}

describe('BattleAnimator', () => {
  describe('state machine', () => {
    it('starts in idle state', () => {
      const world = makeWorld();
      const bf = makeBattlefield();
      const armyA = createArmy(world, 0, 'A', [1, 0, 0]);
      const armyB = createArmy(world, 1, 'B', [0, 0, 1]);
      spawnUnit(world, armyA, UnitType.Infantry, 10, 100);
      spawnUnit(world, armyB, UnitType.Infantry, 190, 100);

      const animator = new BattleAnimator(world, armyA, armyB, bf);
      expect(animator.state).toBe('idle');
      expect(animator.isComplete()).toBe(false);
      expect(animator.progress).toBe(0);
    });

    it('transitions to running on start()', () => {
      const world = makeWorld();
      const bf = makeBattlefield();
      const armyA = createArmy(world, 0, 'A', [1, 0, 0]);
      const armyB = createArmy(world, 1, 'B', [0, 0, 1]);
      spawnUnit(world, armyA, UnitType.Infantry, 10, 100);
      spawnUnit(world, armyB, UnitType.Infantry, 190, 100);

      const animator = new BattleAnimator(world, armyA, armyB, bf);
      const result = makeBattleResult(1, 0);
      animator.start(result);

      expect(animator.state).toBe('running');
    });

    it('can pause and resume', () => {
      const world = makeWorld();
      const bf = makeBattlefield();
      const armyA = createArmy(world, 0, 'A', [1, 0, 0]);
      const armyB = createArmy(world, 1, 'B', [0, 0, 1]);
      spawnUnit(world, armyA, UnitType.Infantry, 10, 100);
      spawnUnit(world, armyB, UnitType.Infantry, 190, 100);

      const animator = new BattleAnimator(world, armyA, armyB, bf);
      animator.start(makeBattleResult(1, 0));

      animator.pause();
      expect(animator.state).toBe('paused');

      animator.resume();
      expect(animator.state).toBe('running');
    });

    it('pause does nothing when not running', () => {
      const world = makeWorld();
      const bf = makeBattlefield();
      const armyA = createArmy(world, 0, 'A', [1, 0, 0]);
      const armyB = createArmy(world, 1, 'B', [0, 0, 1]);
      spawnUnit(world, armyA, UnitType.Infantry, 10, 100);
      spawnUnit(world, armyB, UnitType.Infantry, 190, 100);

      const animator = new BattleAnimator(world, armyA, armyB, bf);
      animator.pause(); // idle -> should stay idle
      expect(animator.state).toBe('idle');
    });

    it('resume does nothing when not paused', () => {
      const world = makeWorld();
      const bf = makeBattlefield();
      const armyA = createArmy(world, 0, 'A', [1, 0, 0]);
      const armyB = createArmy(world, 1, 'B', [0, 0, 1]);
      spawnUnit(world, armyA, UnitType.Infantry, 10, 100);
      spawnUnit(world, armyB, UnitType.Infantry, 190, 100);

      const animator = new BattleAnimator(world, armyA, armyB, bf);
      animator.start(makeBattleResult(1, 0));
      animator.resume(); // running -> should stay running
      expect(animator.state).toBe('running');
    });

    it('completes after sufficient elapsed time', () => {
      const world = makeWorld();
      const bf = makeBattlefield();
      const armyA = createArmy(world, 0, 'A', [1, 0, 0]);
      const armyB = createArmy(world, 1, 'B', [0, 0, 1]);
      spawnUnit(world, armyA, UnitType.Infantry, 10, 100);
      spawnUnit(world, armyB, UnitType.Infantry, 190, 100);

      const duration = 5;
      const animator = new BattleAnimator(world, armyA, armyB, bf, { duration });
      animator.start(makeBattleResult(1, 0));

      // Run for more than duration at 1x speed
      animator.update(6);

      expect(animator.state).toBe('complete');
      expect(animator.isComplete()).toBe(true);
      expect(animator.progress).toBe(1);
    });

    it('does not advance while paused', () => {
      const world = makeWorld();
      const bf = makeBattlefield();
      const armyA = createArmy(world, 0, 'A', [1, 0, 0]);
      const armyB = createArmy(world, 1, 'B', [0, 0, 1]);
      spawnUnit(world, armyA, UnitType.Infantry, 10, 100);
      spawnUnit(world, armyB, UnitType.Infantry, 190, 100);

      const animator = new BattleAnimator(world, armyA, armyB, bf, { duration: 10 });
      animator.start(makeBattleResult(1, 0));
      animator.update(2); // progress = 0.2
      const prog = animator.progress;

      animator.pause();
      animator.update(5); // should not advance

      expect(animator.progress).toBe(prog);
    });
  });

  describe('speed control', () => {
    it('setSpeed changes animation speed', () => {
      const world = makeWorld();
      const bf = makeBattlefield();
      const armyA = createArmy(world, 0, 'A', [1, 0, 0]);
      const armyB = createArmy(world, 1, 'B', [0, 0, 1]);
      spawnUnit(world, armyA, UnitType.Infantry, 10, 100);
      spawnUnit(world, armyB, UnitType.Infantry, 190, 100);

      const animator = new BattleAnimator(world, armyA, armyB, bf, { duration: 10 });
      animator.start(makeBattleResult(1, 0));
      animator.setSpeed(2);
      expect(animator.speed).toBe(2);

      // At 2x speed, 5 seconds real time = 10 seconds animation time
      animator.update(5);
      expect(animator.isComplete()).toBe(true);
    });

    it('clamps speed to valid range', () => {
      const world = makeWorld();
      const bf = makeBattlefield();
      const armyA = createArmy(world, 0, 'A', [1, 0, 0]);
      const armyB = createArmy(world, 1, 'B', [0, 0, 1]);

      const animator = new BattleAnimator(world, armyA, armyB, bf);
      animator.setSpeed(0);
      expect(animator.speed).toBeGreaterThanOrEqual(0.1);

      animator.setSpeed(100);
      expect(animator.speed).toBeLessThanOrEqual(10);
    });
  });

  describe('unit death', () => {
    it('marks losing army units as dead (isAlive = 0)', () => {
      const world = makeWorld();
      const bf = makeBattlefield();
      const armyA = createArmy(world, 0, 'A', [1, 0, 0]);
      const armyB = createArmy(world, 1, 'B', [0, 0, 1]);

      // Army A: 3 units, Army B: 3 units
      spawnFormation(world, armyA, UnitType.Infantry, 30, 100, 1, 3, 5);
      spawnFormation(world, armyB, UnitType.Infantry, 170, 100, 1, 3, 5);

      // Result: A wins with 2 surviving, B has 0 surviving
      // So 1 A unit dies, all 3 B units die
      const result = makeBattleResult(2, 0);

      const animator = new BattleAnimator(world, armyA, armyB, bf, { duration: 5 });
      animator.start(result);

      // Run animation to completion
      animator.update(6);

      // Count alive units per army
      let aAlive = 0;
      for (const id of armyA.unitIds) {
        const armyData = world.get('army', id);
        if (armyData[1] > 0) aAlive++;
      }

      let bAlive = 0;
      for (const id of armyB.unitIds) {
        const armyData = world.get('army', id);
        if (armyData[1] > 0) bAlive++;
      }

      expect(aAlive).toBe(2);
      expect(bAlive).toBe(0);
    });
  });

  describe('reset', () => {
    it('restores units to original positions and alive state', () => {
      const world = makeWorld();
      const bf = makeBattlefield();
      const armyA = createArmy(world, 0, 'A', [1, 0, 0]);
      const armyB = createArmy(world, 1, 'B', [0, 0, 1]);
      const unitA = spawnUnit(world, armyA, UnitType.Infantry, 30, 100);
      const unitB = spawnUnit(world, armyB, UnitType.Infantry, 170, 100);

      const origDataA = [...world.get('unit', unitA)];
      const origDataB = [...world.get('unit', unitB)];
      const origAliveA = world.get('army', unitA)[1];
      const origAliveB = world.get('army', unitB)[1];

      const animator = new BattleAnimator(world, armyA, armyB, bf, { duration: 5 });
      animator.start(makeBattleResult(1, 0));
      animator.update(6); // complete

      // Reset
      animator.reset();

      // Verify restored
      expect(animator.state).toBe('idle');
      expect(animator.progress).toBe(0);

      const restoredA = world.get('unit', unitA);
      expect(restoredA[0]).toBeCloseTo(origDataA[0]); // posX
      expect(restoredA[1]).toBeCloseTo(origDataA[1]); // posY

      const restoredB = world.get('unit', unitB);
      expect(restoredB[0]).toBeCloseTo(origDataB[0]);
      expect(restoredB[1]).toBeCloseTo(origDataB[1]);

      expect(world.get('army', unitA)[1]).toBe(origAliveA);
      expect(world.get('army', unitB)[1]).toBe(origAliveB);
    });
  });

  describe('combat callback', () => {
    it('fires onCombatEvent when unit enters combat range', () => {
      const world = makeWorld();
      const bf = makeBattlefield();
      const armyA = createArmy(world, 0, 'A', [1, 0, 0]);
      const armyB = createArmy(world, 1, 'B', [0, 0, 1]);

      // Place units close together so they engage quickly
      spawnUnit(world, armyA, UnitType.Infantry, 90, 100);
      spawnUnit(world, armyB, UnitType.Infantry, 110, 100);

      const combatEvents: [number, number][] = [];
      const animator = new BattleAnimator(world, armyA, armyB, bf, {
        duration: 5,
        combatRange: 25,
        moveSpeed: 50,
      });

      animator.onCombatEvent((x, y) => combatEvents.push([x, y]));
      animator.start(makeBattleResult(1, 0));

      // Run many small steps to trigger combat
      for (let i = 0; i < 100; i++) {
        animator.update(0.1);
      }

      // Should have fired at least one combat event
      expect(combatEvents.length).toBeGreaterThan(0);
    });
  });

  describe('movement', () => {
    it('moves units toward opponents during animation', () => {
      const world = makeWorld();
      const bf = makeBattlefield();
      const armyA = createArmy(world, 0, 'A', [1, 0, 0]);
      const armyB = createArmy(world, 1, 'B', [0, 0, 1]);
      const unitA = spawnUnit(world, armyA, UnitType.Infantry, 30, 100);
      spawnUnit(world, armyB, UnitType.Infantry, 170, 100);

      const origX = world.get('unit', unitA)[0];

      const animator = new BattleAnimator(world, armyA, armyB, bf, {
        duration: 10,
        moveSpeed: 30,
        combatRange: 5,
      });

      // All survive so no deaths interrupt movement
      animator.start(makeBattleResult(1, 1));

      // Run a few steps
      for (let i = 0; i < 20; i++) {
        animator.update(0.1);
      }

      const newX = world.get('unit', unitA)[0];
      // Unit A should have moved rightward (toward army B at x=170)
      expect(newX).toBeGreaterThan(origX);
    });
  });
});

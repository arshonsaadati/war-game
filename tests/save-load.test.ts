import { describe, it, expect, beforeEach, vi } from 'vitest';
import { World } from '../src/engine/ecs';
import {
  UNIT_STRIDE,
  UnitType,
  createArmy,
  spawnUnit,
  spawnFormation,
  Army,
} from '../src/game/army';
import { Battlefield, TerrainType } from '../src/game/battlefield';
import {
  serializeGameState,
  deserializeGameState,
  exportToJSON,
  importFromJSON,
  getSaveSlots,
  saveToSlot,
  loadFromSlot,
  deleteSlot,
  GameState,
} from '../src/game/save-load';

function makeWorld(): World {
  const world = new World(10000);
  world.registerComponent('unit', Float32Array, UNIT_STRIDE);
  world.registerComponent('army', Float32Array, 2);
  return world;
}

function setupTestState(): {
  world: World;
  armyA: Army;
  armyB: Army;
  battlefield: Battlefield;
} {
  const world = makeWorld();
  const armyA = createArmy(world, 0, 'Red Legion', [1, 0, 0]);
  const armyB = createArmy(world, 1, 'Blue Guard', [0, 0, 1]);

  spawnFormation(world, armyA, UnitType.Infantry, 30, 100, 2, 3);
  spawnFormation(world, armyA, UnitType.Archer, 20, 100, 1, 4);
  spawnUnit(world, armyA, UnitType.Cavalry, 15, 70);

  spawnFormation(world, armyB, UnitType.Infantry, 170, 100, 2, 3);
  spawnUnit(world, armyB, UnitType.Artillery, 190, 100);

  const battlefield = new Battlefield({ width: 200, height: 200, cellSize: 10 });
  battlefield.generateRandom(42);

  return { world, armyA, armyB, battlefield };
}

describe('Save/Load System', () => {
  describe('serialize / deserialize roundtrip', () => {
    it('preserves unit positions, types, and health', () => {
      const { world, armyA, armyB, battlefield } = setupTestState();
      const totalUnits = armyA.unitIds.length + armyB.unitIds.length;

      // Collect original unit data
      const originalUnits: number[][] = [];
      for (const army of [armyA, armyB]) {
        for (const id of army.unitIds) {
          originalUnits.push(world.get('unit', id));
        }
      }

      // Serialize
      const state = serializeGameState(world, [armyA, armyB], battlefield);
      expect(state.units).toHaveLength(totalUnits);
      expect(state.armies).toHaveLength(2);

      // Deserialize into fresh world
      const world2 = makeWorld();
      const result = deserializeGameState(state, world2);

      // Check army counts
      expect(result.armies).toHaveLength(2);
      const [newA, newB] = result.armies;
      expect(newA.unitIds.length).toBe(armyA.unitIds.length);
      expect(newB.unitIds.length).toBe(armyB.unitIds.length);

      // Check all unit data roundtrips
      let idx = 0;
      for (const army of result.armies) {
        for (const id of army.unitIds) {
          const data = world2.get('unit', id);
          const orig = originalUnits[idx];
          expect(data[0]).toBeCloseTo(orig[0]); // posX
          expect(data[1]).toBeCloseTo(orig[1]); // posY
          expect(data[2]).toBeCloseTo(orig[2]); // health
          expect(data[3]).toBeCloseTo(orig[3]); // maxHealth
          expect(data[4]).toBeCloseTo(orig[4]); // attack
          expect(data[5]).toBeCloseTo(orig[5]); // defense
          expect(data[6]).toBeCloseTo(orig[6]); // morale
          expect(data[7]).toBeCloseTo(orig[7]); // unitType
          idx++;
        }
      }
    });

    it('preserves army names and colors', () => {
      const { world, armyA, armyB, battlefield } = setupTestState();
      const state = serializeGameState(world, [armyA, armyB], battlefield);

      const world2 = makeWorld();
      const result = deserializeGameState(state, world2);

      expect(result.armies[0].name).toBe('Red Legion');
      expect(result.armies[0].color).toEqual([1, 0, 0]);
      expect(result.armies[1].name).toBe('Blue Guard');
      expect(result.armies[1].color).toEqual([0, 0, 1]);
    });

    it('preserves battlefield config and terrain', () => {
      const { world, armyA, armyB, battlefield } = setupTestState();
      const state = serializeGameState(world, [armyA, armyB], battlefield);

      const world2 = makeWorld();
      const result = deserializeGameState(state, world2);

      expect(result.battlefield.width).toBe(200);
      expect(result.battlefield.height).toBe(200);
      expect(result.battlefield.cellSize).toBe(10);
      expect(result.battlefield.cols).toBe(battlefield.cols);
      expect(result.battlefield.rows).toBe(battlefield.rows);

      // Spot-check terrain cells
      for (let r = 0; r < battlefield.rows; r++) {
        for (let c = 0; c < battlefield.cols; c++) {
          expect(result.battlefield.getTerrain(c, r)).toBe(battlefield.getTerrain(c, r));
        }
      }
    });

    it('only saves alive units (dead units excluded)', () => {
      const world = makeWorld();
      const army = createArmy(world, 0, 'Test', [1, 0, 0]);
      spawnUnit(world, army, UnitType.Infantry, 10, 20);
      const deadId = spawnUnit(world, army, UnitType.Infantry, 30, 40);
      spawnUnit(world, army, UnitType.Infantry, 50, 60);

      // Kill middle unit
      world.set('army', deadId, 0, 0);

      const battlefield = new Battlefield({ width: 100, height: 100, cellSize: 10 });
      const state = serializeGameState(world, [army], battlefield);

      expect(state.units).toHaveLength(2); // only alive units
    });
  });

  describe('JSON export / import roundtrip', () => {
    it('produces valid JSON and roundtrips correctly', () => {
      const { world, armyA, armyB, battlefield } = setupTestState();
      const state = serializeGameState(world, [armyA, armyB], battlefield);

      const json = exportToJSON(state);
      expect(typeof json).toBe('string');
      expect(() => JSON.parse(json)).not.toThrow();

      const imported = importFromJSON(json);
      expect(imported.version).toBe(state.version);
      expect(imported.armies).toEqual(state.armies);
      expect(imported.units).toEqual(state.units);
      expect(imported.battlefield).toEqual(state.battlefield);
    });

    it('importFromJSON rejects invalid input', () => {
      expect(() => importFromJSON('{}')).toThrow('Invalid save file format');
      expect(() => importFromJSON('not json')).toThrow();
      expect(() => importFromJSON('{"version":"x","armies":[],"units":[]}')).toThrow('Invalid save file format');
    });

    it('full roundtrip: serialize -> export -> import -> deserialize', () => {
      const { world, armyA, armyB, battlefield } = setupTestState();
      const state = serializeGameState(world, [armyA, armyB], battlefield);
      const json = exportToJSON(state);
      const imported = importFromJSON(json);

      const world2 = makeWorld();
      const result = deserializeGameState(imported, world2);

      expect(result.armies[0].unitIds.length).toBe(armyA.unitIds.length);
      expect(result.armies[1].unitIds.length).toBe(armyB.unitIds.length);
    });
  });

  describe('localStorage save/load', () => {
    let storage: Record<string, string>;

    beforeEach(() => {
      storage = {};
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage[key] ?? null,
        setItem: (key: string, value: string) => { storage[key] = value; },
        removeItem: (key: string) => { delete storage[key]; },
        key: (index: number) => Object.keys(storage)[index] ?? null,
        get length() { return Object.keys(storage).length; },
        clear: () => { storage = {}; },
      });
    });

    it('saves and loads from a slot', () => {
      const { world, armyA, armyB, battlefield } = setupTestState();
      const state = serializeGameState(world, [armyA, armyB], battlefield);

      saveToSlot('test-save', state);
      const loaded = loadFromSlot('test-save');

      expect(loaded).not.toBeNull();
      expect(loaded!.armies).toHaveLength(2);
      expect(loaded!.units).toHaveLength(state.units.length);
      expect(loaded!.battlefield.width).toBe(200);
    });

    it('returns null for non-existent slot', () => {
      expect(loadFromSlot('does-not-exist')).toBeNull();
    });

    it('lists save slots', () => {
      const { world, armyA, armyB, battlefield } = setupTestState();
      const state = serializeGameState(world, [armyA, armyB], battlefield);

      saveToSlot('alpha', state);
      saveToSlot('beta', state);

      const slots = getSaveSlots();
      expect(slots).toHaveLength(2);

      const names = slots.map((s) => s.name);
      expect(names).toContain('alpha');
      expect(names).toContain('beta');
    });

    it('deletes a save slot', () => {
      const { world, armyA, armyB, battlefield } = setupTestState();
      const state = serializeGameState(world, [armyA, armyB], battlefield);

      saveToSlot('to-delete', state);
      expect(loadFromSlot('to-delete')).not.toBeNull();

      deleteSlot('to-delete');
      expect(loadFromSlot('to-delete')).toBeNull();
      expect(getSaveSlots()).toHaveLength(0);
    });

    it('slot info includes unit and army counts', () => {
      const { world, armyA, armyB, battlefield } = setupTestState();
      const state = serializeGameState(world, [armyA, armyB], battlefield);
      const totalUnits = armyA.unitIds.length + armyB.unitIds.length;

      saveToSlot('info-test', state);
      const slots = getSaveSlots();
      expect(slots).toHaveLength(1);
      expect(slots[0].unitCount).toBe(totalUnits);
      expect(slots[0].armyCount).toBe(2);
    });
  });

  describe('loaded state correctness', () => {
    it('loaded state has correct army sizes after multiple saves', () => {
      const { world, armyA, armyB, battlefield } = setupTestState();
      const sizeA = armyA.unitIds.length;
      const sizeB = armyB.unitIds.length;

      const state = serializeGameState(world, [armyA, armyB], battlefield);

      // Deserialize multiple times should give consistent results
      for (let i = 0; i < 3; i++) {
        const w = makeWorld();
        const result = deserializeGameState(state, w);
        expect(result.armies[0].unitIds.length).toBe(sizeA);
        expect(result.armies[1].unitIds.length).toBe(sizeB);
      }
    });

    it('deserialized units have correct army membership', () => {
      const { world, armyA, armyB, battlefield } = setupTestState();
      const state = serializeGameState(world, [armyA, armyB], battlefield);

      const world2 = makeWorld();
      const result = deserializeGameState(state, world2);

      // All of army A's units should belong to army 0
      for (const id of result.armies[0].unitIds) {
        const armyData = world2.get('army', id);
        expect(armyData[0]).toBe(0); // armyId
        expect(armyData[1]).toBe(1); // isAlive
      }

      // All of army B's units should belong to army 1
      for (const id of result.armies[1].unitIds) {
        const armyData = world2.get('army', id);
        expect(armyData[0]).toBe(1);
        expect(armyData[1]).toBe(1);
      }
    });

    it('state version is set', () => {
      const { world, armyA, armyB, battlefield } = setupTestState();
      const state = serializeGameState(world, [armyA, armyB], battlefield);
      expect(state.version).toBe(1);
    });

    it('timestamp is set on serialize', () => {
      const { world, armyA, armyB, battlefield } = setupTestState();
      const before = Date.now();
      const state = serializeGameState(world, [armyA, armyB], battlefield);
      const after = Date.now();

      expect(state.timestamp).toBeGreaterThanOrEqual(before);
      expect(state.timestamp).toBeLessThanOrEqual(after);
    });
  });
});

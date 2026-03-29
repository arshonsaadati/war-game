import { describe, it, expect } from 'vitest';
import { World } from '../src/engine/ecs';
import {
  UNIT_STRIDE,
  UnitType,
  UNIT_TEMPLATES,
  createArmy,
  spawnUnit,
  spawnFormation,
  buildUnitBuffer,
} from '../src/game/army';

function makeWorld(): World {
  const world = new World(10000);
  world.registerComponent('unit', Float32Array, UNIT_STRIDE);
  world.registerComponent('army', Float32Array, 2);
  return world;
}

describe('Army', () => {
  it('creates an army with no units', () => {
    const world = makeWorld();
    const army = createArmy(world, 0, 'Test Army', [1, 0, 0]);

    expect(army.id).toBe(0);
    expect(army.name).toBe('Test Army');
    expect(army.unitIds).toHaveLength(0);
  });

  it('spawns a unit with correct stats', () => {
    const world = makeWorld();
    const army = createArmy(world, 0, 'Test', [1, 0, 0]);
    const id = spawnUnit(world, army, UnitType.Infantry, 10, 20);

    const data = world.get('unit', id);
    const template = UNIT_TEMPLATES[UnitType.Infantry];

    expect(data[0]).toBeCloseTo(10); // posX
    expect(data[1]).toBeCloseTo(20); // posY
    expect(data[2]).toBeCloseTo(template.health);
    expect(data[3]).toBeCloseTo(template.maxHealth);
    expect(data[4]).toBeCloseTo(template.attack);
    expect(data[5]).toBeCloseTo(template.defense);
    expect(data[6]).toBeCloseTo(template.morale);
    expect(data[7]).toBeCloseTo(UnitType.Infantry);
  });

  it('spawns a formation in grid pattern', () => {
    const world = makeWorld();
    const army = createArmy(world, 0, 'Test', [1, 0, 0]);
    const ids = spawnFormation(world, army, UnitType.Archer, 50, 50, 3, 4, 2.0);

    expect(ids).toHaveLength(12); // 3 rows * 4 cols
    expect(army.unitIds).toHaveLength(12);

    // Check that positions form a grid
    const positions = ids.map(id => {
      const data = world.get('unit', id);
      return [data[0], data[1]];
    });

    // All X positions should include values spread around center (50)
    const xs = positions.map(p => p[0]);
    const ys = positions.map(p => p[1]);

    expect(new Set(xs).size).toBe(4); // 4 unique columns
    expect(new Set(ys).size).toBe(3); // 3 unique rows
  });

  it('builds unit buffer with correct stride', () => {
    const world = makeWorld();
    const army = createArmy(world, 0, 'Test', [1, 0, 0]);
    spawnUnit(world, army, UnitType.Infantry, 10, 20);
    spawnUnit(world, army, UnitType.Cavalry, 30, 40);

    const buffer = buildUnitBuffer(world, army);

    expect(buffer).toBeInstanceOf(Float32Array);
    expect(buffer.length).toBe(2 * UNIT_STRIDE); // 2 units * 8 floats each
    expect(buffer[0]).toBeCloseTo(10); // first unit posX
    expect(buffer[UNIT_STRIDE]).toBeCloseTo(30); // second unit posX
  });

  it('excludes dead units from buffer', () => {
    const world = makeWorld();
    const army = createArmy(world, 0, 'Test', [1, 0, 0]);
    spawnUnit(world, army, UnitType.Infantry, 10, 20);
    const deadUnit = spawnUnit(world, army, UnitType.Infantry, 30, 40);
    spawnUnit(world, army, UnitType.Infantry, 50, 60);

    // Kill middle unit
    world.set('army', deadUnit, 0, 0); // isAlive = 0

    const buffer = buildUnitBuffer(world, army);
    expect(buffer.length).toBe(2 * UNIT_STRIDE); // only 2 alive units
  });

  it('all unit types have valid templates', () => {
    for (const type of [UnitType.Infantry, UnitType.Archer, UnitType.Cavalry, UnitType.Artillery]) {
      const template = UNIT_TEMPLATES[type];
      expect(template.health).toBeGreaterThan(0);
      expect(template.maxHealth).toBeGreaterThan(0);
      expect(template.attack).toBeGreaterThan(0);
      expect(template.defense).toBeGreaterThanOrEqual(0);
      expect(template.morale).toBeGreaterThan(0);
      expect(template.morale).toBeLessThanOrEqual(100);
      expect(template.health).toBe(template.maxHealth);
    }
  });
});

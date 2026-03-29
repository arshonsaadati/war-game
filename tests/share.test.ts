import { describe, it, expect } from 'vitest';
import { World } from '../src/engine/ecs';
import {
  UNIT_STRIDE,
  UnitType,
  createArmy,
  spawnUnit,
  spawnFormation,
  Army,
} from '../src/game/army';
import { Battlefield } from '../src/game/battlefield';
import {
  encodeState,
  decodeState,
  encodeStateToURL,
  decodeStateFromURL,
  SharedState,
} from '../src/game/share';

function makeWorld(): World {
  const world = new World(10000);
  world.registerComponent('unit', Float32Array, UNIT_STRIDE);
  world.registerComponent('army', Float32Array, 2);
  return world;
}

function makeDefaultSetup(): { world: World; armyA: Army; armyB: Army; battlefield: Battlefield } {
  const world = makeWorld();
  const armyA = createArmy(world, 0, 'Red Legion', [1, 0, 0]);
  const armyB = createArmy(world, 1, 'Blue Guard', [0, 0, 1]);
  const battlefield = new Battlefield({ width: 200, height: 200, cellSize: 10 });
  battlefield.generateRandom(42);
  return { world, armyA, armyB, battlefield };
}

describe('URL State Sharing', () => {
  it('roundtrips unit positions and types', () => {
    const { world, armyA, armyB, battlefield } = makeDefaultSetup();
    spawnUnit(world, armyA, UnitType.Infantry, 30, 100);
    spawnUnit(world, armyA, UnitType.Archer, 40, 90);
    spawnUnit(world, armyB, UnitType.Cavalry, 170, 100);
    spawnUnit(world, armyB, UnitType.Artillery, 180, 110);

    const encoded = encodeState(world, [armyA, armyB], battlefield, 42);
    const decoded = decodeState(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.units).toHaveLength(4);
    expect(decoded!.seed).toBe(42);

    // Check army A units
    expect(decoded!.units[0].posX).toBe(30);
    expect(decoded!.units[0].posY).toBe(100);
    expect(decoded!.units[0].unitType).toBe(UnitType.Infantry);
    expect(decoded!.units[0].armyId).toBe(0);

    expect(decoded!.units[1].posX).toBe(40);
    expect(decoded!.units[1].posY).toBe(90);
    expect(decoded!.units[1].unitType).toBe(UnitType.Archer);
    expect(decoded!.units[1].armyId).toBe(0);

    // Check army B units
    expect(decoded!.units[2].posX).toBe(170);
    expect(decoded!.units[2].posY).toBe(100);
    expect(decoded!.units[2].unitType).toBe(UnitType.Cavalry);
    expect(decoded!.units[2].armyId).toBe(1);

    expect(decoded!.units[3].posX).toBe(180);
    expect(decoded!.units[3].posY).toBe(110);
    expect(decoded!.units[3].unitType).toBe(UnitType.Artillery);
    expect(decoded!.units[3].armyId).toBe(1);
  });

  it('roundtrips empty armies', () => {
    const { world, armyA, armyB, battlefield } = makeDefaultSetup();

    const encoded = encodeState(world, [armyA, armyB], battlefield, 7);
    const decoded = decodeState(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.units).toHaveLength(0);
    expect(decoded!.seed).toBe(7);
  });

  it('roundtrips via URL encode/decode', () => {
    const { world, armyA, armyB, battlefield } = makeDefaultSetup();
    spawnUnit(world, armyA, UnitType.Infantry, 50, 50);
    spawnUnit(world, armyB, UnitType.Archer, 150, 150);

    const url = encodeStateToURL(world, [armyA, armyB], battlefield, 42);
    expect(url).toContain('#s=');

    const decoded = decodeStateFromURL(url);
    expect(decoded).not.toBeNull();
    expect(decoded!.units).toHaveLength(2);
    expect(decoded!.units[0].posX).toBe(50);
    expect(decoded!.units[1].posX).toBe(150);
  });

  it('decodeStateFromURL returns null for URL without state', () => {
    expect(decodeStateFromURL('https://example.com/')).toBeNull();
    expect(decodeStateFromURL('https://example.com/#')).toBeNull();
    expect(decodeStateFromURL('https://example.com/#foo=bar')).toBeNull();
  });

  it('decodeState returns null for garbage input', () => {
    expect(decodeState('')).toBeNull();
    expect(decodeState('not-valid-base64!!!')).toBeNull();
    expect(decodeState('AAAA')).toBeNull(); // version 0 != 1
  });

  it('produces URLs under 2000 chars for 100 units', () => {
    const { world, armyA, armyB, battlefield } = makeDefaultSetup();

    // Spawn 50 units per army = 100 total
    for (let i = 0; i < 50; i++) {
      spawnUnit(world, armyA, UnitType.Infantry, 20 + i, 100);
      spawnUnit(world, armyB, UnitType.Archer, 130 + i, 100);
    }

    const url = encodeStateToURL(world, [armyA, armyB], battlefield, 42);
    expect(url.length).toBeLessThan(2000);
  });

  it('preserves all four unit types correctly', () => {
    const { world, armyA, armyB, battlefield } = makeDefaultSetup();
    spawnUnit(world, armyA, UnitType.Infantry, 10, 10);
    spawnUnit(world, armyA, UnitType.Archer, 20, 20);
    spawnUnit(world, armyA, UnitType.Cavalry, 30, 30);
    spawnUnit(world, armyA, UnitType.Artillery, 40, 40);

    const encoded = encodeState(world, [armyA, armyB], battlefield);
    const decoded = decodeState(encoded)!;

    expect(decoded.units[0].unitType).toBe(UnitType.Infantry);
    expect(decoded.units[1].unitType).toBe(UnitType.Archer);
    expect(decoded.units[2].unitType).toBe(UnitType.Cavalry);
    expect(decoded.units[3].unitType).toBe(UnitType.Artillery);
  });

  it('skips dead units during encode', () => {
    const { world, armyA, armyB, battlefield } = makeDefaultSetup();
    spawnUnit(world, armyA, UnitType.Infantry, 10, 10);
    const deadId = spawnUnit(world, armyA, UnitType.Infantry, 20, 20);
    spawnUnit(world, armyA, UnitType.Infantry, 30, 30);

    // Kill the middle unit
    world.set('army', deadId, 0, 0);

    const encoded = encodeState(world, [armyA, armyB], battlefield);
    const decoded = decodeState(encoded)!;

    expect(decoded.units).toHaveLength(2);
    expect(decoded.units[0].posX).toBe(10);
    expect(decoded.units[1].posX).toBe(30);
  });

  it('handles large formations via spawnFormation', () => {
    const { world, armyA, armyB, battlefield } = makeDefaultSetup();
    spawnFormation(world, armyA, UnitType.Infantry, 30, 100, 5, 10);
    spawnFormation(world, armyB, UnitType.Archer, 170, 100, 5, 10);

    const encoded = encodeState(world, [armyA, armyB], battlefield, 42);
    const decoded = decodeState(encoded)!;

    expect(decoded.units).toHaveLength(100); // 50 + 50
    expect(decoded.seed).toBe(42);

    // Check armies are split correctly
    const armyAUnits = decoded.units.filter(u => u.armyId === 0);
    const armyBUnits = decoded.units.filter(u => u.armyId === 1);
    expect(armyAUnits).toHaveLength(50);
    expect(armyBUnits).toHaveLength(50);
  });
});

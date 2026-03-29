import { describe, it, expect } from 'vitest';
import {
  Battlefield,
  TerrainType,
  TERRAIN_MODIFIERS,
} from '../src/game/battlefield';

describe('Battlefield', () => {
  it('initializes with default plains terrain', () => {
    const bf = new Battlefield({ width: 100, height: 100, cellSize: 10 });

    expect(bf.cols).toBe(10);
    expect(bf.rows).toBe(10);
    expect(bf.getTerrain(0, 0)).toBe(TerrainType.Plains);
    expect(bf.getTerrain(5, 5)).toBe(TerrainType.Plains);
  });

  it('sets and gets terrain types', () => {
    const bf = new Battlefield({ width: 100, height: 100, cellSize: 10 });
    bf.setTerrain(3, 4, TerrainType.Forest);

    expect(bf.getTerrain(3, 4)).toBe(TerrainType.Forest);
    expect(bf.getTerrain(3, 5)).toBe(TerrainType.Plains); // unchanged neighbor
  });

  it('handles out-of-bounds gracefully', () => {
    const bf = new Battlefield({ width: 100, height: 100, cellSize: 10 });

    expect(bf.getTerrain(-1, 0)).toBe(TerrainType.Plains);
    expect(bf.getTerrain(0, -1)).toBe(TerrainType.Plains);
    expect(bf.getTerrain(100, 0)).toBe(TerrainType.Plains);
  });

  it('converts world position to terrain', () => {
    const bf = new Battlefield({ width: 100, height: 100, cellSize: 10 });
    bf.setTerrain(3, 4, TerrainType.Hills);

    // World pos (35, 45) should map to cell (3, 4)
    expect(bf.getTerrainAtWorldPos(35, 45)).toBe(TerrainType.Hills);
    expect(bf.getTerrainAtWorldPos(5, 5)).toBe(TerrainType.Plains);
  });

  it('returns correct terrain modifiers', () => {
    const bf = new Battlefield({ width: 100, height: 100, cellSize: 10 });
    bf.setTerrain(0, 0, TerrainType.Forest);

    const mods = bf.getModifiers(5, 5);
    expect(mods).toEqual(TERRAIN_MODIFIERS[TerrainType.Forest]);
  });

  it('builds terrain buffer with correct layout', () => {
    const bf = new Battlefield({ width: 20, height: 20, cellSize: 10 });
    // 2x2 grid
    bf.setTerrain(1, 0, TerrainType.Forest);

    const buffer = bf.buildTerrainBuffer();

    // 2 cols * 2 rows * 4 floats = 16 floats
    expect(buffer.length).toBe(2 * 2 * 4);

    // Cell (0,0) = Plains
    expect(buffer[0]).toBe(TerrainType.Plains);
    expect(buffer[1]).toBe(TERRAIN_MODIFIERS[TerrainType.Plains][0]);

    // Cell (1,0) = Forest
    expect(buffer[4]).toBe(TerrainType.Forest);
    expect(buffer[5]).toBeCloseTo(TERRAIN_MODIFIERS[TerrainType.Forest][0]);
  });

  it('generates random terrain deterministically', () => {
    const bf1 = new Battlefield({ width: 100, height: 100, cellSize: 10 });
    const bf2 = new Battlefield({ width: 100, height: 100, cellSize: 10 });

    bf1.generateRandom(42);
    bf2.generateRandom(42);

    // Same seed should produce same terrain
    for (let r = 0; r < bf1.rows; r++) {
      for (let c = 0; c < bf1.cols; c++) {
        expect(bf1.getTerrain(c, r)).toBe(bf2.getTerrain(c, r));
      }
    }
  });

  it('generates varied terrain', () => {
    const bf = new Battlefield({ width: 200, height: 200, cellSize: 10 });
    bf.generateRandom(42);

    const types = new Set<TerrainType>();
    for (let r = 0; r < bf.rows; r++) {
      for (let c = 0; c < bf.cols; c++) {
        types.add(bf.getTerrain(c, r));
      }
    }

    // Should have at least 3 different terrain types
    expect(types.size).toBeGreaterThanOrEqual(3);
  });

  it('all terrain types have valid modifiers', () => {
    for (const type of [
      TerrainType.Plains,
      TerrainType.Forest,
      TerrainType.Hills,
      TerrainType.Water,
      TerrainType.Mountains,
    ]) {
      const mods = TERRAIN_MODIFIERS[type];
      expect(mods).toHaveLength(4);

      // All modifiers should be positive
      for (const mod of mods) {
        expect(mod).toBeGreaterThan(0);
      }
    }
  });
});

import { describe, it, expect } from 'vitest';
import { Battlefield, TerrainType } from '../src/game/battlefield';
import { findPath, worldToGrid, gridToWorld } from '../src/game/pathfinding';

function makeBattlefield(cols: number, rows: number, cellSize = 10): Battlefield {
  return new Battlefield({ width: cols * cellSize, height: rows * cellSize, cellSize });
}

describe('Pathfinding', () => {
  describe('findPath', () => {
    it('returns single-element path when start equals end', () => {
      const bf = makeBattlefield(5, 5);
      const path = findPath(bf, 2, 2, 2, 2);
      expect(path).toEqual([[2, 2]]);
    });

    it('finds straight path on open plains', () => {
      const bf = makeBattlefield(5, 5);
      const path = findPath(bf, 0, 0, 4, 0);

      expect(path.length).toBe(5);
      expect(path[0]).toEqual([0, 0]);
      expect(path[path.length - 1]).toEqual([4, 0]);
    });

    it('finds path around water obstacles', () => {
      const bf = makeBattlefield(5, 5);
      // Block the direct path with water
      bf.setTerrain(2, 0, TerrainType.Water);
      bf.setTerrain(2, 1, TerrainType.Water);
      bf.setTerrain(2, 2, TerrainType.Water);

      const path = findPath(bf, 0, 0, 4, 0);

      // Should still find a path going around the water wall
      expect(path.length).toBeGreaterThan(0);
      expect(path[0]).toEqual([0, 0]);
      expect(path[path.length - 1]).toEqual([4, 0]);

      // No step should be on water
      for (const [c, r] of path) {
        expect(bf.getTerrain(c, r)).not.toBe(TerrainType.Water);
      }
    });

    it('returns empty path when destination is water', () => {
      const bf = makeBattlefield(5, 5);
      bf.setTerrain(4, 0, TerrainType.Water);

      const path = findPath(bf, 0, 0, 4, 0);
      expect(path).toEqual([]);
    });

    it('returns empty path when completely blocked', () => {
      const bf = makeBattlefield(5, 5);
      // Wall of water blocks all passage
      for (let r = 0; r < 5; r++) {
        bf.setTerrain(2, r, TerrainType.Water);
      }

      const path = findPath(bf, 0, 0, 4, 0);
      expect(path).toEqual([]);
    });

    it('prefers plains over mountains for lower cost', () => {
      const bf = makeBattlefield(5, 3);
      // Top row: plains (cost 1.0 each)
      // Middle row: mountains (cost 2.5 each) - the straight path
      // Bottom row: plains (cost 1.0 each)
      for (let c = 1; c < 4; c++) {
        bf.setTerrain(c, 1, TerrainType.Mountains);
      }

      const path = findPath(bf, 0, 1, 4, 1);

      expect(path.length).toBeGreaterThan(0);
      expect(path[0]).toEqual([0, 1]);
      expect(path[path.length - 1]).toEqual([4, 1]);

      // Path should avoid mountains if possible — at least some steps should be off row 1
      const offMiddle = path.filter(([, r]) => r !== 1);
      expect(offMiddle.length).toBeGreaterThan(0);
    });

    it('handles single-cell grid', () => {
      const bf = makeBattlefield(1, 1);
      const path = findPath(bf, 0, 0, 0, 0);
      expect(path).toEqual([[0, 0]]);
    });

    it('clamps out-of-bounds coordinates', () => {
      const bf = makeBattlefield(5, 5);
      const path = findPath(bf, -5, -5, 10, 10);

      expect(path.length).toBeGreaterThan(0);
      expect(path[0]).toEqual([0, 0]);
      expect(path[path.length - 1]).toEqual([4, 4]);
    });

    it('path steps are always adjacent (4-directional)', () => {
      const bf = makeBattlefield(8, 8);
      bf.generateRandom(42);
      // Clear water to ensure pathability
      for (let r = 0; r < bf.rows; r++) {
        for (let c = 0; c < bf.cols; c++) {
          if (bf.getTerrain(c, r) === TerrainType.Water) {
            bf.setTerrain(c, r, TerrainType.Plains);
          }
        }
      }

      const path = findPath(bf, 0, 0, 7, 7);
      expect(path.length).toBeGreaterThan(0);

      for (let i = 1; i < path.length; i++) {
        const [c1, r1] = path[i - 1];
        const [c2, r2] = path[i];
        const dist = Math.abs(c2 - c1) + Math.abs(r2 - r1);
        expect(dist).toBe(1);
      }
    });
  });

  describe('worldToGrid', () => {
    it('converts world coordinates to grid', () => {
      const bf = makeBattlefield(10, 10, 10);
      expect(worldToGrid(bf, 15, 25)).toEqual([1, 2]);
    });

    it('clamps negative coordinates', () => {
      const bf = makeBattlefield(10, 10, 10);
      expect(worldToGrid(bf, -10, -10)).toEqual([0, 0]);
    });

    it('clamps above-max coordinates', () => {
      const bf = makeBattlefield(10, 10, 10);
      expect(worldToGrid(bf, 999, 999)).toEqual([9, 9]);
    });
  });

  describe('gridToWorld', () => {
    it('converts grid to center of cell in world coords', () => {
      const bf = makeBattlefield(10, 10, 10);
      expect(gridToWorld(bf, 1, 2)).toEqual([15, 25]);
    });

    it('returns center of first cell', () => {
      const bf = makeBattlefield(10, 10, 10);
      expect(gridToWorld(bf, 0, 0)).toEqual([5, 5]);
    });
  });
});

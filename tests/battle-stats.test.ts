import { describe, it, expect } from 'vitest';
import {
  computeStats,
  chiSquaredUniformity,
  validateBattleResults,
} from './validators/battle-stats';

describe('Statistical Validators', () => {
  describe('computeStats', () => {
    it('computes correct mean', () => {
      const stats = computeStats([1, 2, 3, 4, 5]);
      expect(stats.mean).toBeCloseTo(3);
    });

    it('computes correct variance', () => {
      const stats = computeStats([2, 4, 4, 4, 5, 5, 7, 9]);
      expect(stats.mean).toBeCloseTo(5);
      expect(stats.variance).toBeCloseTo(4);
    });

    it('computes correct min/max/median', () => {
      const stats = computeStats([1, 3, 5, 7, 9]);
      expect(stats.min).toBe(1);
      expect(stats.max).toBe(9);
      expect(stats.median).toBe(5);
    });

    it('handles empty array', () => {
      const stats = computeStats([]);
      expect(stats.mean).toBe(0);
      expect(stats.variance).toBe(0);
    });

    it('handles single value', () => {
      const stats = computeStats([42]);
      expect(stats.mean).toBe(42);
      expect(stats.variance).toBe(0);
      expect(stats.median).toBe(42);
    });
  });

  describe('chiSquaredUniformity', () => {
    it('returns high p-value for uniform distribution', () => {
      // Perfectly uniform: 100 per bin across 10 bins
      const observed = new Array(10).fill(100);
      const p = chiSquaredUniformity(observed, 100);
      expect(p).toBeGreaterThan(0.05);
    });

    it('returns low p-value for skewed distribution', () => {
      // Very skewed
      const observed = [900, 10, 10, 10, 10, 10, 10, 10, 10, 10];
      const p = chiSquaredUniformity(observed, 100);
      expect(p).toBeLessThan(0.05);
    });
  });

  describe('validateBattleResults', () => {
    it('passes for valid results', () => {
      const issues = validateBattleResults({
        armyAWins: 60,
        armyBWins: 35,
        draws: 5,
        totalSims: 100,
        avgSurvivingA: 5.2,
        avgSurvivingB: 3.1,
        rawResults: Array.from({ length: 100 }, (_, i) => ({
          armyASurviving: Math.floor(Math.random() * 10),
          armyBSurviving: Math.floor(Math.random() * 8),
        })),
      });

      expect(issues).toEqual([]);
    });

    it('detects win/loss/draw sum mismatch', () => {
      const issues = validateBattleResults({
        armyAWins: 60,
        armyBWins: 35,
        draws: 10, // 60+35+10 = 105 != 100
        totalSims: 100,
        avgSurvivingA: 5,
        avgSurvivingB: 3,
        rawResults: [],
      });

      expect(issues.some(i => i.includes('sum'))).toBe(true);
    });

    it('detects zero variance (broken RNG)', () => {
      const issues = validateBattleResults({
        armyAWins: 100,
        armyBWins: 0,
        draws: 0,
        totalSims: 100,
        avgSurvivingA: 5,
        avgSurvivingB: 0,
        rawResults: Array.from({ length: 100 }, () => ({
          armyASurviving: 5,
          armyBSurviving: 0,
        })),
      });

      expect(issues.some(i => i.includes('variance') || i.includes('identical'))).toBe(true);
    });

    it('detects total annihilation anomaly', () => {
      const issues = validateBattleResults({
        armyAWins: 0,
        armyBWins: 0,
        draws: 100,
        totalSims: 100,
        avgSurvivingA: 0,
        avgSurvivingB: 0,
        rawResults: Array.from({ length: 100 }, () => ({
          armyASurviving: 0,
          armyBSurviving: 0,
        })),
      });

      expect(issues.some(i => i.includes('annihilation'))).toBe(true);
    });
  });
});

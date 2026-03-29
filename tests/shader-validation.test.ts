import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validateWGSL, validateBufferLayout } from './validators/shader-compile';
import { UNIT_STRIDE } from '../src/game/army';

const SHADER_DIR = resolve(__dirname, '../src/simulation');

function loadShader(name: string): string {
  return readFileSync(resolve(SHADER_DIR, name), 'utf-8');
}

describe('Shader Validation', () => {
  describe('Monte Carlo shader', () => {
    const source = loadShader('monte-carlo.wgsl');

    it('has no structural errors', () => {
      const issues = validateWGSL(source, 'monte-carlo.wgsl');
      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toEqual([]);
    });

    it('has balanced braces', () => {
      const issues = validateWGSL(source, 'monte-carlo.wgsl');
      const braceErrors = issues.filter(i => i.message.includes('brace'));
      expect(braceErrors).toEqual([]);
    });

    it('has no duplicate bindings', () => {
      const issues = validateWGSL(source, 'monte-carlo.wgsl');
      const dupeErrors = issues.filter(i => i.message.includes('Duplicate'));
      expect(dupeErrors).toEqual([]);
    });

    it('Unit struct matches TS stride', () => {
      const issues = validateBufferLayout(source, 'Unit', UNIT_STRIDE);
      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toEqual([]);
    });

    it('has expected bindings (params, armyA, armyB, terrain, results)', () => {
      expect(source).toContain('@binding(0)');
      expect(source).toContain('@binding(1)');
      expect(source).toContain('@binding(2)');
      expect(source).toContain('@binding(3)');
      expect(source).toContain('@binding(4)');
    });

    it('uses PCG random number generator', () => {
      expect(source).toContain('pcg_hash');
      expect(source).toContain('rand_float');
    });

    it('has terrain lookup function', () => {
      expect(source).toContain('fn get_terrain');
    });

    it('has damage calculation function', () => {
      expect(source).toContain('fn calc_damage');
    });
  });

  describe('Reduction shader', () => {
    const source = loadShader('reduction.wgsl');

    it('has no structural errors', () => {
      const issues = validateWGSL(source, 'reduction.wgsl');
      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toEqual([]);
    });

    it('uses atomic operations for thread safety', () => {
      expect(source).toContain('atomicAdd');
      expect(source).toContain('atomicStore');
    });

    it('has workgroup barrier for synchronization', () => {
      expect(source).toContain('workgroupBarrier');
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  checkHTMLStructure,
  checkMainTSWiring,
  checkRendererShaders,
  checkRendererFiles,
  checkCSS,
} from './validators/gui-checks';

describe('GUI Validation', () => {
  describe('HTML Structure', () => {
    const results = checkHTMLStructure();

    it('has no failures', () => {
      const failures = results.filter(r => r.status === 'fail');
      if (failures.length > 0) {
        throw new Error(failures.map(f => `${f.name}: ${f.message} ${f.details || ''}`).join('\n'));
      }
    });

    it('has all required element IDs', () => {
      const idCheck = results.find(r => r.name === 'html:required-ids');
      expect(idCheck?.status).toBe('pass');
    });

    it('has two canvas elements', () => {
      const canvasCheck = results.find(r => r.name === 'html:canvases');
      expect(canvasCheck?.status).toBe('pass');
    });

    it('has module script tag', () => {
      const scriptCheck = results.find(r => r.name === 'html:module-script');
      expect(scriptCheck?.status).toBe('pass');
    });
  });

  describe('Main TS Wiring', () => {
    const results = checkMainTSWiring();

    it('queries all required DOM elements', () => {
      const check = results.find(r => r.name === 'main:dom-queries');
      expect(check?.status).toBe('pass');
    });

    it('has all required imports', () => {
      const check = results.find(r => r.name === 'main:imports');
      expect(check?.status).toBe('pass');
    });

    it('has game loop setup', () => {
      const check = results.find(r => r.name === 'main:game-loop');
      expect(check?.status).toBe('pass');
    });

    it('has render pipeline', () => {
      const check = results.find(r => r.name === 'main:render-pipeline');
      expect(check?.status).toBe('pass');
    });

    it('has event listeners', () => {
      const eventChecks = results.filter(r => r.name.startsWith('main:event-'));
      const failures = eventChecks.filter(r => r.status === 'fail');
      expect(failures).toEqual([]);
    });
  });

  describe('Renderer Shaders', () => {
    const results = checkRendererShaders();

    it('all renderer shaders pass validation', () => {
      const failures = results.filter(r => r.status === 'fail');
      if (failures.length > 0) {
        throw new Error(failures.map(f => `${f.name}: ${f.message} — ${f.details}`).join('\n'));
      }
    });

    it('terrain shader is valid', () => {
      const check = results.find(r => r.name === 'shader:terrain.wgsl');
      expect(check?.status).toBe('pass');
    });

    it('unit shader is valid', () => {
      const check = results.find(r => r.name === 'shader:units.wgsl');
      expect(check?.status).toBe('pass');
    });

    it('particle shader is valid', () => {
      const check = results.find(r => r.name === 'shader:particles.wgsl');
      expect(check?.status).toBe('pass');
    });

    it('heatmap shader is valid', () => {
      const check = results.find(r => r.name === 'shader:heatmap.wgsl');
      expect(check?.status).toBe('pass');
    });
  });

  describe('Renderer Files', () => {
    const results = checkRendererFiles();

    it('all renderer files exist with required exports', () => {
      const failures = results.filter(r => r.status === 'fail');
      if (failures.length > 0) {
        throw new Error(failures.map(f => `${f.name}: ${f.message}`).join('\n'));
      }
    });
  });

  describe('CSS', () => {
    const results = checkCSS();

    it('has proper layout and styling', () => {
      const failures = results.filter(r => r.status === 'fail');
      expect(failures).toEqual([]);
    });
  });
});

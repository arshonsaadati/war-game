/**
 * GUI and renderer validation checks.
 * Validates HTML structure, CSS, shader pipelines, and event wiring
 * without requiring a browser.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../..');

export interface GUICheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: string;
}

function readFile(relPath: string): string | null {
  const fullPath = resolve(ROOT, relPath);
  if (!existsSync(fullPath)) return null;
  return readFileSync(fullPath, 'utf-8');
}

/**
 * Validate that the HTML has all required UI elements.
 */
export function checkHTMLStructure(): GUICheckResult[] {
  const results: GUICheckResult[] = [];
  const html = readFile('index.html');

  if (!html) {
    results.push({ name: 'html:exists', status: 'fail', message: 'public/index.html not found' });
    return results;
  }

  results.push({ name: 'html:exists', status: 'pass', message: 'index.html exists' });

  // Required elements by ID
  const requiredIds = [
    'battlefield', 'histogram', 'status', 'fps',
    'run-battle', 'reset', 'sim-count',
    'heatmap-toggle', 'heatmap-opacity',
    'result-a-name', 'result-a-win-pct', 'result-a-wins', 'result-a-surv',
    'result-b-name', 'result-b-win-pct', 'result-b-wins', 'result-b-surv',
    'result-draws', 'result-time', 'results-panel',
    'unit-count-a', 'unit-count-b',
  ];

  const missingIds: string[] = [];
  for (const id of requiredIds) {
    if (!html.includes(`id="${id}"`)) {
      missingIds.push(id);
    }
  }

  if (missingIds.length > 0) {
    results.push({
      name: 'html:required-ids',
      status: 'fail',
      message: `Missing ${missingIds.length} required element IDs`,
      details: missingIds.join(', '),
    });
  } else {
    results.push({
      name: 'html:required-ids',
      status: 'pass',
      message: `All ${requiredIds.length} required IDs present`,
    });
  }

  // Must have two canvas elements
  const canvasCount = (html.match(/<canvas/g) || []).length;
  results.push({
    name: 'html:canvases',
    status: canvasCount >= 2 ? 'pass' : 'fail',
    message: canvasCount >= 2
      ? `Found ${canvasCount} canvas elements (battlefield + histogram)`
      : `Expected 2+ canvas elements, found ${canvasCount}`,
  });

  // Must load main.ts as module
  const hasModuleScript = /script.*type="module".*src.*main\.ts/.test(html);
  results.push({
    name: 'html:module-script',
    status: hasModuleScript ? 'pass' : 'fail',
    message: hasModuleScript ? 'Module script tag present' : 'Missing module script tag for main.ts',
  });

  // Must have viewport meta for mobile
  const hasViewport = html.includes('viewport');
  results.push({
    name: 'html:viewport-meta',
    status: hasViewport ? 'pass' : 'warn',
    message: hasViewport ? 'Viewport meta present' : 'Missing viewport meta tag (mobile support)',
  });

  // Check for responsive CSS
  const hasResponsive = html.includes('@media');
  results.push({
    name: 'html:responsive',
    status: hasResponsive ? 'pass' : 'warn',
    message: hasResponsive ? 'Responsive CSS present' : 'No @media queries found',
  });

  return results;
}

/**
 * Validate that main.ts wires up all required event handlers and DOM queries.
 */
export function checkMainTSWiring(): GUICheckResult[] {
  const results: GUICheckResult[] = [];
  const source = readFile('src/main.ts');

  if (!source) {
    results.push({ name: 'main:exists', status: 'fail', message: 'src/main.ts not found' });
    return results;
  }

  // Check required getElementById calls
  const requiredElements = [
    'battlefield', 'histogram', 'status', 'fps',
    'run-battle', 'reset', 'sim-count',
    'heatmap-toggle', 'heatmap-opacity',
  ];

  const missingElements: string[] = [];
  for (const id of requiredElements) {
    if (!source.includes(`'${id}'`) && !source.includes(`"${id}"`)) {
      missingElements.push(id);
    }
  }

  if (missingElements.length > 0) {
    results.push({
      name: 'main:dom-queries',
      status: 'fail',
      message: `Missing DOM queries for ${missingElements.length} elements`,
      details: missingElements.join(', '),
    });
  } else {
    results.push({
      name: 'main:dom-queries',
      status: 'pass',
      message: 'All required DOM elements queried',
    });
  }

  // Check required event listeners
  const requiredEvents = [
    'addEventListener',
    'click',
    'resize',
  ];

  for (const event of requiredEvents) {
    const found = source.includes(event);
    results.push({
      name: `main:event-${event}`,
      status: found ? 'pass' : 'fail',
      message: found ? `${event} handler present` : `Missing ${event} event handling`,
    });
  }

  // Check required imports
  const requiredImports = [
    'initGPU', 'Camera', 'InputHandler', 'Renderer',
    'BattleSimulator', 'Battlefield', 'GameLoop',
  ];

  const missingImports: string[] = [];
  for (const imp of requiredImports) {
    if (!source.includes(imp)) {
      missingImports.push(imp);
    }
  }

  if (missingImports.length > 0) {
    results.push({
      name: 'main:imports',
      status: 'fail',
      message: `Missing ${missingImports.length} required imports`,
      details: missingImports.join(', '),
    });
  } else {
    results.push({
      name: 'main:imports',
      status: 'pass',
      message: 'All required modules imported',
    });
  }

  // Check game loop setup
  const hasGameLoop = source.includes('new GameLoop') && source.includes('.start()');
  results.push({
    name: 'main:game-loop',
    status: hasGameLoop ? 'pass' : 'fail',
    message: hasGameLoop ? 'Game loop created and started' : 'Game loop not properly initialized',
  });

  // Check WebGPU render pipeline
  const hasRenderPipeline = source.includes('Renderer') && source.includes('.render(');
  results.push({
    name: 'main:render-pipeline',
    status: hasRenderPipeline ? 'pass' : 'fail',
    message: hasRenderPipeline ? 'Render pipeline wired' : 'Render pipeline not connected',
  });

  return results;
}

/**
 * Validate all renderer WGSL shaders.
 */
export function checkRendererShaders(): GUICheckResult[] {
  const results: GUICheckResult[] = [];

  const shaders = [
    { name: 'terrain.wgsl', path: 'src/renderer/terrain.wgsl', requiresVertex: true, requiresFragment: true },
    { name: 'units.wgsl', path: 'src/renderer/units.wgsl', requiresVertex: true, requiresFragment: true },
    { name: 'particles.wgsl', path: 'src/renderer/particles.wgsl', requiresVertex: true, requiresFragment: true, requiresCompute: true },
    { name: 'heatmap.wgsl', path: 'src/renderer/heatmap.wgsl', requiresVertex: true, requiresFragment: true },
  ];

  for (const shader of shaders) {
    const source = readFile(shader.path);
    if (!source) {
      results.push({ name: `shader:${shader.name}`, status: 'fail', message: `${shader.path} not found` });
      continue;
    }

    const issues: string[] = [];

    // Check entry points
    if (shader.requiresVertex && !source.includes('@vertex')) {
      issues.push('Missing @vertex entry point');
    }
    if (shader.requiresFragment && !source.includes('@fragment')) {
      issues.push('Missing @fragment entry point');
    }
    if (shader.requiresCompute && !source.includes('@compute')) {
      issues.push('Missing @compute entry point');
    }

    // Check for uniform binding
    if (!source.includes('@group(0)')) {
      issues.push('No bind group declarations');
    }

    // Check balanced braces
    let depth = 0;
    for (const ch of source) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }
    if (depth !== 0) {
      issues.push(`Unbalanced braces (depth ${depth})`);
    }

    // Check VertexOutput struct
    if (shader.requiresVertex && !source.includes('VertexOutput') && !source.includes('VSOutput')) {
      issues.push('No vertex output struct');
    }

    if (issues.length > 0) {
      results.push({
        name: `shader:${shader.name}`,
        status: 'fail',
        message: `${issues.length} issue(s)`,
        details: issues.join('; '),
      });
    } else {
      results.push({
        name: `shader:${shader.name}`,
        status: 'pass',
        message: 'Shader structure valid',
      });
    }
  }

  return results;
}

/**
 * Validate renderer TypeScript files exist and have proper structure.
 */
export function checkRendererFiles(): GUICheckResult[] {
  const results: GUICheckResult[] = [];

  const renderers = [
    { file: 'src/renderer/renderer.ts', mustContain: ['Renderer', 'initialize', 'render', 'destroy'] },
    { file: 'src/renderer/terrain-renderer.ts', mustContain: ['TerrainRenderer', 'initialize', 'render', 'updateTerrain'] },
    { file: 'src/renderer/unit-renderer.ts', mustContain: ['UnitRenderer', 'initialize', 'render', 'updateUnits'] },
    { file: 'src/renderer/particle-system.ts', mustContain: ['ParticleSystem', 'initialize', 'emit', 'update', 'render'] },
    { file: 'src/renderer/heatmap-renderer.ts', mustContain: ['HeatmapRenderer', 'initialize', 'render', 'updateHeatmap'] },
    { file: 'src/engine/camera.ts', mustContain: ['Camera', 'getViewProjectionMatrix', 'pan', 'zoomAt'] },
    { file: 'src/engine/input.ts', mustContain: ['InputHandler', 'update', 'destroy'] },
  ];

  for (const r of renderers) {
    const source = readFile(r.file);
    if (!source) {
      results.push({ name: `renderer:${r.file}`, status: 'fail', message: `${r.file} not found` });
      continue;
    }

    const missing = r.mustContain.filter(s => !source.includes(s));
    if (missing.length > 0) {
      results.push({
        name: `renderer:${r.file}`,
        status: 'fail',
        message: `Missing: ${missing.join(', ')}`,
      });
    } else {
      results.push({
        name: `renderer:${r.file}`,
        status: 'pass',
        message: `All ${r.mustContain.length} required exports present`,
      });
    }
  }

  return results;
}

/**
 * Validate CSS has proper styling for the game UI.
 */
export function checkCSS(): GUICheckResult[] {
  const results: GUICheckResult[] = [];
  const html = readFile('index.html');

  if (!html) {
    results.push({ name: 'css:exists', status: 'fail', message: 'No HTML to check CSS' });
    return results;
  }

  // Extract style block
  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!styleMatch) {
    results.push({ name: 'css:style-block', status: 'fail', message: 'No <style> block found' });
    return results;
  }

  const css = styleMatch[1];

  // Check for grid layout
  const hasGrid = css.includes('grid-template');
  results.push({
    name: 'css:layout',
    status: hasGrid ? 'pass' : 'warn',
    message: hasGrid ? 'CSS grid layout present' : 'No CSS grid layout — may have layout issues',
  });

  // Check for dark theme colors
  const hasDarkBg = css.includes('#0a') || css.includes('#1') || css.includes('rgb(');
  results.push({
    name: 'css:dark-theme',
    status: hasDarkBg ? 'pass' : 'warn',
    message: hasDarkBg ? 'Dark theme styling present' : 'May not have dark theme',
  });

  // Check for canvas styling
  const hasCanvasStyle = css.includes('canvas') || css.includes('.viewport');
  results.push({
    name: 'css:canvas-styling',
    status: hasCanvasStyle ? 'pass' : 'warn',
    message: hasCanvasStyle ? 'Canvas/viewport styled' : 'Canvas may not be properly styled',
  });

  // Check for button styling
  const hasButtons = css.includes('.btn') || css.includes('button');
  results.push({
    name: 'css:buttons',
    status: hasButtons ? 'pass' : 'warn',
    message: hasButtons ? 'Button styles present' : 'No button styling found',
  });

  return results;
}

/**
 * Test harness entry point for the evaluator agent.
 * Runs all validation checks and outputs a structured report
 * that the evaluator can parse and feed back to the implementer.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validateWGSL, validateBufferLayout } from './validators/shader-compile';
import { validateBattleResults, computeStats } from './validators/battle-stats';
import {
  checkHTMLStructure,
  checkMainTSWiring,
  checkRendererShaders,
  checkRendererFiles,
  checkCSS,
} from './validators/gui-checks';
import { runPerfChecks } from './validators/perf-checks';
import { runIntegrationChecks } from './validators/integration-checks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  message: string;
  details?: string;
}

const results: CheckResult[] = [];

function check(name: string, fn: () => { status: 'pass' | 'fail' | 'warn' | 'skip'; message: string; details?: string }) {
  try {
    results.push({ name, ...fn() });
  } catch (e) {
    results.push({
      name,
      status: 'fail',
      message: `Exception: ${(e as Error).message}`,
      details: (e as Error).stack,
    });
  }
}

// ==========================================
// SECTION 1: File existence checks
// ==========================================
const requiredFiles = [
  'src/engine/gpu.ts',
  'src/engine/ecs.ts',
  'src/engine/camera.ts',
  'src/engine/input.ts',
  'src/simulation/monte-carlo.wgsl',
  'src/simulation/reduction.wgsl',
  'src/simulation/simulator.ts',
  'src/game/army.ts',
  'src/game/battlefield.ts',
  'src/game/game-loop.ts',
  'src/renderer/renderer.ts',
  'src/renderer/terrain-renderer.ts',
  'src/renderer/unit-renderer.ts',
  'src/renderer/particle-system.ts',
  'src/renderer/heatmap-renderer.ts',
  'src/renderer/terrain.wgsl',
  'src/renderer/units.wgsl',
  'src/renderer/particles.wgsl',
  'src/renderer/heatmap.wgsl',
  'src/main.ts',
  'index.html',
];

for (const file of requiredFiles) {
  check(`file:${file}`, () => {
    const exists = existsSync(resolve(__dirname, '..', file));
    return exists
      ? { status: 'pass', message: 'File exists' }
      : { status: 'fail', message: `Missing required file: ${file}` };
  });
}

// ==========================================
// SECTION 2: Simulation shader validation
// ==========================================
const shaderFiles = [
  { name: 'monte-carlo.wgsl', path: 'src/simulation/monte-carlo.wgsl' },
  { name: 'reduction.wgsl', path: 'src/simulation/reduction.wgsl' },
];

for (const shader of shaderFiles) {
  check(`sim-shader:${shader.name}`, () => {
    const fullPath = resolve(__dirname, '..', shader.path);
    if (!existsSync(fullPath)) return { status: 'skip', message: 'Shader not found' };

    const source = readFileSync(fullPath, 'utf-8');
    const issues = validateWGSL(source, shader.name);
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');

    if (errors.length > 0) {
      return { status: 'fail', message: `${errors.length} error(s)`, details: errors.map(e => e.message).join('\n') };
    }
    if (warnings.length > 0) {
      return { status: 'warn', message: `${warnings.length} warning(s)`, details: warnings.map(w => w.message).join('\n') };
    }
    return { status: 'pass', message: 'No issues found' };
  });
}

// ==========================================
// SECTION 3: Buffer layout checks
// ==========================================
check('layout:Unit', () => {
  const shaderPath = resolve(__dirname, '..', 'src/simulation/monte-carlo.wgsl');
  if (!existsSync(shaderPath)) return { status: 'skip', message: 'Shader not found' };
  const source = readFileSync(shaderPath, 'utf-8');
  const issues = validateBufferLayout(source, 'Unit', 8);
  if (issues.length > 0) {
    return { status: 'fail', message: 'Unit struct layout mismatch', details: issues.map(i => i.message).join('\n') };
  }
  return { status: 'pass', message: 'Unit struct matches TS stride (8)' };
});

check('layout:SimResult', () => {
  const shaderPath = resolve(__dirname, '..', 'src/simulation/monte-carlo.wgsl');
  if (!existsSync(shaderPath)) return { status: 'skip', message: 'Shader not found' };
  const source = readFileSync(shaderPath, 'utf-8');
  const issues = validateBufferLayout(source, 'SimResult', 4);
  if (issues.length > 0) {
    return { status: 'fail', message: 'SimResult struct layout mismatch', details: issues.map(i => i.message).join('\n') };
  }
  return { status: 'pass', message: 'SimResult struct matches expected (4)' };
});

check('layout:SimParams', () => {
  const shaderPath = resolve(__dirname, '..', 'src/simulation/monte-carlo.wgsl');
  if (!existsSync(shaderPath)) return { status: 'skip', message: 'Shader not found' };
  const source = readFileSync(shaderPath, 'utf-8');
  const issues = validateBufferLayout(source, 'SimParams', 8);
  if (issues.length > 0) {
    return { status: 'fail', message: 'SimParams struct layout mismatch', details: issues.map(i => i.message).join('\n') };
  }
  return { status: 'pass', message: 'SimParams struct matches TS (8 fields / 32 bytes)' };
});

// ==========================================
// SECTION 4: GUI validation
// ==========================================
const guiResults = [
  ...checkHTMLStructure(),
  ...checkMainTSWiring(),
  ...checkRendererShaders(),
  ...checkRendererFiles(),
  ...checkCSS(),
];

for (const r of guiResults) {
  results.push(r);
}

// ==========================================
// SECTION 5: TypeScript source checks
// ==========================================
check('typescript:key-exports', () => {
  try {
    const armyPath = resolve(__dirname, '..', 'src/game/army.ts');
    const source = readFileSync(armyPath, 'utf-8');
    if (!source.includes('UNIT_STRIDE')) return { status: 'fail', message: 'army.ts missing UNIT_STRIDE' };
    if (!source.includes('buildUnitBuffer')) return { status: 'fail', message: 'army.ts missing buildUnitBuffer' };
    return { status: 'pass', message: 'Key exports found' };
  } catch (e) {
    return { status: 'fail', message: (e as Error).message };
  }
});

// ==========================================
// SECTION 6: Performance & code quality checks
// ==========================================
const perfResults = runPerfChecks();
for (const r of perfResults) {
  results.push(r);
}

// ==========================================
// SECTION 7: Cross-module integration checks
// ==========================================
const integrationResults = runIntegrationChecks();
for (const r of integrationResults) {
  results.push(r);
}

// ==========================================
// Output report
// ==========================================
const passCount = results.filter(r => r.status === 'pass').length;
const failCount = results.filter(r => r.status === 'fail').length;
const warnCount = results.filter(r => r.status === 'warn').length;
const skipCount = results.filter(r => r.status === 'skip').length;
const total = results.length;

console.log('\n' + '='.repeat(70));
console.log('  WAR GAME EVALUATOR REPORT');
console.log('='.repeat(70));
console.log(`  TOTAL: ${total}  PASS: ${passCount}  FAIL: ${failCount}  WARN: ${warnCount}  SKIP: ${skipCount}`);
console.log('='.repeat(70) + '\n');

// Group by section
let lastSection = '';
for (const r of results) {
  const section = r.name.split(':')[0];
  if (section !== lastSection) {
    console.log(`\n  --- ${section.toUpperCase()} ---`);
    lastSection = section;
  }
  const icon = { pass: '\u2713', fail: '\u2717', warn: '\u26A0', skip: '\u25CB' }[r.status];
  const color = { pass: '\x1b[32m', fail: '\x1b[31m', warn: '\x1b[33m', skip: '\x1b[90m' }[r.status];
  console.log(`${color}  ${icon} ${r.name}: ${r.message}\x1b[0m`);
  if (r.details) {
    for (const line of r.details.split('\n')) {
      console.log(`      ${line}`);
    }
  }
}

console.log('\n' + '='.repeat(70));

if (failCount > 0) {
  console.error(`\n\x1b[31m  ${failCount} FAILURE(S) — fix required\x1b[0m\n`);
  process.exit(1);
} else if (warnCount > 0) {
  console.log(`\n\x1b[33m  ${warnCount} WARNING(S) — review recommended\x1b[0m\n`);
} else {
  console.log(`\n\x1b[32m  ALL ${total} CHECKS PASSED\x1b[0m\n`);
}

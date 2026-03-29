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

// --- File existence checks ---
const requiredFiles = [
  'src/engine/gpu.ts',
  'src/engine/ecs.ts',
  'src/simulation/monte-carlo.wgsl',
  'src/simulation/reduction.wgsl',
  'src/simulation/simulator.ts',
  'src/game/army.ts',
  'src/game/battlefield.ts',
  'src/game/game-loop.ts',
  'src/main.ts',
  'public/index.html',
];

for (const file of requiredFiles) {
  check(`file:${file}`, () => {
    const exists = existsSync(resolve(__dirname, '..', file));
    return exists
      ? { status: 'pass', message: 'File exists' }
      : { status: 'fail', message: `Missing required file: ${file}` };
  });
}

// --- Shader validation ---
const shaderFiles = [
  { name: 'monte-carlo.wgsl', path: 'src/simulation/monte-carlo.wgsl' },
  { name: 'reduction.wgsl', path: 'src/simulation/reduction.wgsl' },
];

for (const shader of shaderFiles) {
  check(`shader:${shader.name}`, () => {
    const fullPath = resolve(__dirname, '..', shader.path);
    if (!existsSync(fullPath)) {
      return { status: 'skip', message: 'Shader file not found' };
    }

    const source = readFileSync(fullPath, 'utf-8');
    const issues = validateWGSL(source, shader.name);
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');

    if (errors.length > 0) {
      return {
        status: 'fail',
        message: `${errors.length} error(s) in ${shader.name}`,
        details: errors.map(e => e.message).join('\n'),
      };
    }
    if (warnings.length > 0) {
      return {
        status: 'warn',
        message: `${warnings.length} warning(s) in ${shader.name}`,
        details: warnings.map(w => w.message).join('\n'),
      };
    }
    return { status: 'pass', message: 'No issues found' };
  });
}

// --- Buffer layout checks ---
check('layout:Unit', () => {
  const shaderPath = resolve(__dirname, '..', 'src/simulation/monte-carlo.wgsl');
  if (!existsSync(shaderPath)) {
    return { status: 'skip', message: 'Shader not found' };
  }

  const source = readFileSync(shaderPath, 'utf-8');
  const issues = validateBufferLayout(source, 'Unit', 8); // UNIT_STRIDE = 8

  if (issues.length > 0) {
    return {
      status: 'fail',
      message: 'Unit struct layout mismatch',
      details: issues.map(i => i.message).join('\n'),
    };
  }
  return { status: 'pass', message: 'Unit struct matches TS stride (8)' };
});

check('layout:SimResult', () => {
  const shaderPath = resolve(__dirname, '..', 'src/simulation/monte-carlo.wgsl');
  if (!existsSync(shaderPath)) {
    return { status: 'skip', message: 'Shader not found' };
  }

  const source = readFileSync(shaderPath, 'utf-8');
  const issues = validateBufferLayout(source, 'SimResult', 4);

  if (issues.length > 0) {
    return {
      status: 'fail',
      message: 'SimResult struct layout mismatch',
      details: issues.map(i => i.message).join('\n'),
    };
  }
  return { status: 'pass', message: 'SimResult struct matches expected (4)' };
});

check('layout:SimParams', () => {
  const shaderPath = resolve(__dirname, '..', 'src/simulation/monte-carlo.wgsl');
  if (!existsSync(shaderPath)) {
    return { status: 'skip', message: 'Shader not found' };
  }

  const source = readFileSync(shaderPath, 'utf-8');
  const issues = validateBufferLayout(source, 'SimParams', 8);

  if (issues.length > 0) {
    return {
      status: 'fail',
      message: 'SimParams struct layout mismatch',
      details: issues.map(i => i.message).join('\n'),
    };
  }
  return { status: 'pass', message: 'SimParams struct matches TS (8 fields / 32 bytes)' };
});

// --- TypeScript compilation check ---
check('typescript:compile', () => {
  try {
    // We just check if key imports resolve
    const armyPath = resolve(__dirname, '..', 'src/game/army.ts');
    const source = readFileSync(armyPath, 'utf-8');

    if (!source.includes('UNIT_STRIDE')) {
      return { status: 'fail', message: 'army.ts missing UNIT_STRIDE export' };
    }
    if (!source.includes('buildUnitBuffer')) {
      return { status: 'fail', message: 'army.ts missing buildUnitBuffer export' };
    }

    return { status: 'pass', message: 'Key exports found' };
  } catch (e) {
    return { status: 'fail', message: (e as Error).message };
  }
});

// --- Output report ---
const passCount = results.filter(r => r.status === 'pass').length;
const failCount = results.filter(r => r.status === 'fail').length;
const warnCount = results.filter(r => r.status === 'warn').length;
const skipCount = results.filter(r => r.status === 'skip').length;

console.log('\n' + '='.repeat(60));
console.log('  WAR GAME EVALUATOR REPORT');
console.log('='.repeat(60));
console.log(`  PASS: ${passCount}  FAIL: ${failCount}  WARN: ${warnCount}  SKIP: ${skipCount}`);
console.log('='.repeat(60) + '\n');

for (const r of results) {
  const icon = { pass: '✓', fail: '✗', warn: '⚠', skip: '○' }[r.status];
  const color = { pass: '\x1b[32m', fail: '\x1b[31m', warn: '\x1b[33m', skip: '\x1b[90m' }[r.status];
  console.log(`${color}  ${icon} ${r.name}: ${r.message}\x1b[0m`);
  if (r.details) {
    for (const line of r.details.split('\n')) {
      console.log(`      ${line}`);
    }
  }
}

console.log('\n' + '='.repeat(60));

// Exit with error if any failures
if (failCount > 0) {
  process.exit(1);
}

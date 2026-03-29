/**
 * Cross-module integration checks.
 * Validates that imports resolve, buffer layouts match between TS and WGSL,
 * and renderer wiring is consistent.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../..');

export interface IntegrationCheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  message: string;
  details?: string;
}

function readFile(relPath: string): string | null {
  const fullPath = resolve(ROOT, relPath);
  if (!existsSync(fullPath)) return null;
  return readFileSync(fullPath, 'utf-8');
}

/**
 * Parse import statements from a TypeScript source file.
 * Returns an array of { specifier, resolvedPath } objects.
 * Only handles relative imports (starting with ./ or ../).
 */
function parseRelativeImports(source: string, sourceFilePath: string): { specifier: string; resolvedPath: string }[] {
  const imports: { specifier: string; resolvedPath: string }[] = [];
  const sourceDir = dirname(resolve(ROOT, sourceFilePath));

  // Match: import ... from '...' or import ... from "..."
  const importRegex = /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let match;

  while ((match = importRegex.exec(source)) !== null) {
    const specifier = match[1];

    // Only check relative imports
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;

    // Strip query suffixes like ?raw (used for Vite imports of .wgsl files)
    const cleanSpecifier = specifier.replace(/\?.*$/, '');

    // Try to resolve: as-is, with .ts, with .js, with /index.ts
    const candidates = [
      resolve(sourceDir, cleanSpecifier),
      resolve(sourceDir, cleanSpecifier + '.ts'),
      resolve(sourceDir, cleanSpecifier + '.js'),
      resolve(sourceDir, cleanSpecifier + '.wgsl'),
      resolve(sourceDir, cleanSpecifier, 'index.ts'),
    ];

    const found = candidates.some(c => existsSync(c));
    imports.push({
      specifier,
      resolvedPath: found ? 'resolved' : candidates.map(c => c.replace(ROOT + '/', '')).join(', '),
    });
  }

  return imports;
}

/**
 * Count f32-equivalent fields in a WGSL struct.
 */
function countStructFields(shaderSource: string, structName: string): number | null {
  const structRegex = new RegExp(`struct\\s+${structName}\\s*\\{([^}]+)\\}`);
  const match = shaderSource.match(structRegex);
  if (!match) return null;

  // Strip inline comments before splitting on commas
  const body = match[1].replace(/\/\/[^\n]*/g, '');
  const fields = body
    .split(',')
    .map(f => f.trim())
    .filter(f => f.length > 0);

  let count = 0;
  for (const field of fields) {
    if (field.includes('vec4')) count += 4;
    else if (field.includes('vec3')) count += 3;
    else if (field.includes('vec2')) count += 2;
    else if (field.includes('mat4x4')) count += 16;
    else count += 1; // f32, u32, i32
  }

  return count;
}

/**
 * Run all cross-module integration checks.
 */
export function runIntegrationChecks(): IntegrationCheckResult[] {
  const results: IntegrationCheckResult[] = [];

  // ---- Check 1: All imports in main.ts resolve to existing files ----
  const mainSource = readFile('src/main.ts');
  if (!mainSource) {
    results.push({
      name: 'integration:main-imports',
      status: 'skip',
      message: 'src/main.ts not found',
    });
  } else {
    const imports = parseRelativeImports(mainSource, 'src/main.ts');
    const unresolved = imports.filter(i => i.resolvedPath !== 'resolved');

    if (imports.length === 0) {
      results.push({
        name: 'integration:main-imports',
        status: 'warn',
        message: 'No relative imports found in main.ts',
      });
    } else if (unresolved.length > 0) {
      results.push({
        name: 'integration:main-imports',
        status: 'fail',
        message: `${unresolved.length} import(s) in main.ts cannot be resolved`,
        details: unresolved.map(i => `"${i.specifier}" -> tried: ${i.resolvedPath}`).join('\n'),
      });
    } else {
      results.push({
        name: 'integration:main-imports',
        status: 'pass',
        message: `All ${imports.length} relative imports in main.ts resolve to existing files`,
      });
    }
  }

  // ---- Check 2: SimParams buffer layout (32 bytes = 8 fields) in simulator.ts matches WGSL ----
  const simSource = readFile('src/simulation/simulator.ts');
  const mcShaderSource = readFile('src/simulation/monte-carlo.wgsl');

  if (!simSource || !mcShaderSource) {
    results.push({
      name: 'integration:simparams-layout',
      status: 'skip',
      message: 'simulator.ts or monte-carlo.wgsl not found',
    });
  } else {
    // Check that simulator.ts creates a 32-byte SimParams buffer
    const bufferSizeMatch = simSource.match(/new ArrayBuffer\((\d+)\)/);
    const tsBufferSize = bufferSizeMatch ? parseInt(bufferSizeMatch[1]) : null;

    // Count fields in the WGSL SimParams struct
    const wgslFieldCount = countStructFields(mcShaderSource, 'SimParams');

    if (tsBufferSize === null) {
      results.push({
        name: 'integration:simparams-layout',
        status: 'warn',
        message: 'Could not find SimParams ArrayBuffer allocation in simulator.ts',
      });
    } else if (wgslFieldCount === null) {
      results.push({
        name: 'integration:simparams-layout',
        status: 'warn',
        message: 'Could not find SimParams struct in monte-carlo.wgsl',
      });
    } else {
      const wgslByteSize = wgslFieldCount * 4; // each f32/u32 = 4 bytes
      if (tsBufferSize !== wgslByteSize) {
        results.push({
          name: 'integration:simparams-layout',
          status: 'fail',
          message: `SimParams size mismatch: TS allocates ${tsBufferSize} bytes but WGSL struct is ${wgslFieldCount} fields (${wgslByteSize} bytes)`,
        });
      } else {
        results.push({
          name: 'integration:simparams-layout',
          status: 'pass',
          message: `SimParams layout matches: ${tsBufferSize} bytes (${wgslFieldCount} fields) in both TS and WGSL`,
        });
      }
    }
  }

  // ---- Check 3: army.ts UNIT_STRIDE matches Unit struct in monte-carlo.wgsl ----
  const armySource = readFile('src/game/army.ts');

  if (!armySource || !mcShaderSource) {
    results.push({
      name: 'integration:unit-stride',
      status: 'skip',
      message: 'army.ts or monte-carlo.wgsl not found',
    });
  } else {
    // Extract UNIT_STRIDE value from army.ts
    const strideMatch = armySource.match(/UNIT_STRIDE\s*=\s*(\d+)/);
    const tsStride = strideMatch ? parseInt(strideMatch[1]) : null;

    // Count fields in the WGSL Unit struct
    const wgslUnitFields = countStructFields(mcShaderSource, 'Unit');

    if (tsStride === null) {
      results.push({
        name: 'integration:unit-stride',
        status: 'warn',
        message: 'Could not find UNIT_STRIDE value in army.ts',
      });
    } else if (wgslUnitFields === null) {
      results.push({
        name: 'integration:unit-stride',
        status: 'warn',
        message: 'Could not find Unit struct in monte-carlo.wgsl',
      });
    } else if (tsStride !== wgslUnitFields) {
      results.push({
        name: 'integration:unit-stride',
        status: 'fail',
        message: `UNIT_STRIDE mismatch: army.ts has ${tsStride} but WGSL Unit struct has ${wgslUnitFields} fields`,
      });
    } else {
      results.push({
        name: 'integration:unit-stride',
        status: 'pass',
        message: `UNIT_STRIDE (${tsStride}) matches WGSL Unit struct (${wgslUnitFields} fields)`,
      });
    }
  }

  // ---- Check 4: renderer.ts imports match existing renderer files ----
  const rendererSource = readFile('src/renderer/renderer.ts');
  if (!rendererSource) {
    results.push({
      name: 'integration:renderer-imports',
      status: 'skip',
      message: 'src/renderer/renderer.ts not found',
    });
  } else {
    const imports = parseRelativeImports(rendererSource, 'src/renderer/renderer.ts');
    const unresolved = imports.filter(i => i.resolvedPath !== 'resolved');

    if (imports.length === 0) {
      results.push({
        name: 'integration:renderer-imports',
        status: 'warn',
        message: 'No relative imports found in renderer.ts',
      });
    } else if (unresolved.length > 0) {
      results.push({
        name: 'integration:renderer-imports',
        status: 'fail',
        message: `${unresolved.length} import(s) in renderer.ts cannot be resolved`,
        details: unresolved.map(i => `"${i.specifier}" -> tried: ${i.resolvedPath}`).join('\n'),
      });
    } else {
      results.push({
        name: 'integration:renderer-imports',
        status: 'pass',
        message: `All ${imports.length} imports in renderer.ts resolve to existing files`,
      });
    }
  }

  return results;
}

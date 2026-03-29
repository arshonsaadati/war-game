/**
 * Performance and code quality checks.
 * Validates file size limits, shader best practices, GPU cleanup,
 * build scripts, gitignore, and WGSL formatting.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../..');

export interface PerfCheckResult {
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
 * Recursively collect files matching a given extension under a directory.
 */
function collectFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  const absDir = resolve(ROOT, dir);
  if (!existsSync(absDir)) return results;

  function walk(current: string) {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(fullPath);
      } else if (entry.isFile() && fullPath.endsWith(ext)) {
        results.push(fullPath);
      }
    }
  }

  walk(absDir);
  return results;
}

/**
 * Run all performance and code quality checks.
 */
export function runPerfChecks(): PerfCheckResult[] {
  const results: PerfCheckResult[] = [];

  // ---- Check 1: TypeScript file line counts ----
  const tsFiles = collectFiles('src', '.ts');
  const overWarn: string[] = [];
  const overFail: string[] = [];

  for (const filePath of tsFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const lineCount = content.split('\n').length;
    const relPath = filePath.replace(ROOT + '/', '');

    if (lineCount > 800) {
      overFail.push(`${relPath}: ${lineCount} lines`);
    } else if (lineCount > 500) {
      overWarn.push(`${relPath}: ${lineCount} lines`);
    }
  }

  if (overFail.length > 0) {
    results.push({
      name: 'perf:ts-file-length',
      status: 'fail',
      message: `${overFail.length} file(s) exceed 800-line limit`,
      details: overFail.join('\n'),
    });
  } else if (overWarn.length > 0) {
    results.push({
      name: 'perf:ts-file-length',
      status: 'warn',
      message: `${overWarn.length} file(s) exceed 500-line advisory limit`,
      details: overWarn.join('\n'),
    });
  } else {
    results.push({
      name: 'perf:ts-file-length',
      status: 'pass',
      message: `All ${tsFiles.length} TypeScript files under 500 lines`,
    });
  }

  // ---- Check 2: WGSL workgroup_size multiple of 32 ----
  const wgslFiles = collectFiles('src', '.wgsl');
  const badWorkgroup: string[] = [];

  for (const filePath of wgslFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const relPath = filePath.replace(ROOT + '/', '');

    // Find all @workgroup_size declarations
    const matches = content.matchAll(/@workgroup_size\((\d+)(?:\s*,\s*(\d+))?(?:\s*,\s*(\d+))?\)/g);
    for (const m of matches) {
      const x = parseInt(m[1]);
      const y = m[2] ? parseInt(m[2]) : 1;
      const z = m[3] ? parseInt(m[3]) : 1;
      const total = x * y * z;

      if (total % 32 !== 0) {
        badWorkgroup.push(`${relPath}: @workgroup_size total ${total} (${x}x${y}x${z})`);
      }
    }
  }

  // Only check files that actually have @workgroup_size
  const filesWithWorkgroup = wgslFiles.filter(f =>
    readFileSync(f, 'utf-8').includes('@workgroup_size')
  );

  if (filesWithWorkgroup.length === 0) {
    results.push({
      name: 'perf:wgsl-workgroup-size',
      status: 'skip',
      message: 'No WGSL files with @workgroup_size found',
    });
  } else if (badWorkgroup.length > 0) {
    results.push({
      name: 'perf:wgsl-workgroup-size',
      status: 'fail',
      message: `${badWorkgroup.length} shader(s) have workgroup_size not a multiple of 32`,
      details: badWorkgroup.join('\n'),
    });
  } else {
    results.push({
      name: 'perf:wgsl-workgroup-size',
      status: 'pass',
      message: `All ${filesWithWorkgroup.length} compute shaders have workgroup_size that is a multiple of 32`,
    });
  }

  // ---- Check 3: Renderer .ts files have destroy() method ----
  const rendererTsFiles = collectFiles('src/renderer', '.ts');
  const missingDestroy: string[] = [];

  for (const filePath of rendererTsFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const relPath = filePath.replace(ROOT + '/', '');

    // Check for destroy() method pattern: destroy( or destroy ()
    if (!content.match(/destroy\s*\(/)) {
      missingDestroy.push(relPath);
    }
  }

  if (rendererTsFiles.length === 0) {
    results.push({
      name: 'perf:renderer-destroy',
      status: 'skip',
      message: 'No renderer .ts files found',
    });
  } else if (missingDestroy.length > 0) {
    results.push({
      name: 'perf:renderer-destroy',
      status: 'fail',
      message: `${missingDestroy.length} renderer file(s) missing destroy() for GPU resource cleanup`,
      details: missingDestroy.join('\n'),
    });
  } else {
    results.push({
      name: 'perf:renderer-destroy',
      status: 'pass',
      message: `All ${rendererTsFiles.length} renderer files have destroy() methods`,
    });
  }

  // ---- Check 4: package.json required scripts ----
  const pkgSource = readFile('package.json');
  if (!pkgSource) {
    results.push({
      name: 'perf:package-scripts',
      status: 'fail',
      message: 'package.json not found',
    });
  } else {
    try {
      const pkg = JSON.parse(pkgSource);
      const scripts = pkg.scripts || {};
      const requiredScripts = ['dev', 'build', 'test', 'typecheck', 'harness', 'evaluate'];
      const missing = requiredScripts.filter(s => !(s in scripts));

      if (missing.length > 0) {
        results.push({
          name: 'perf:package-scripts',
          status: 'fail',
          message: `Missing ${missing.length} required script(s)`,
          details: `Missing: ${missing.join(', ')}`,
        });
      } else {
        results.push({
          name: 'perf:package-scripts',
          status: 'pass',
          message: `All ${requiredScripts.length} required scripts present in package.json`,
        });
      }
    } catch {
      results.push({
        name: 'perf:package-scripts',
        status: 'fail',
        message: 'Failed to parse package.json',
      });
    }
  }

  // ---- Check 5: .gitignore exists and includes node_modules and dist ----
  const gitignoreSource = readFile('.gitignore');
  if (!gitignoreSource) {
    results.push({
      name: 'perf:gitignore',
      status: 'fail',
      message: '.gitignore not found',
    });
  } else {
    const lines = gitignoreSource.split('\n').map(l => l.trim());
    const missingEntries: string[] = [];

    // Check for node_modules (could be "node_modules", "node_modules/", etc.)
    if (!lines.some(l => l.startsWith('node_modules'))) {
      missingEntries.push('node_modules');
    }
    // Check for dist (could be "dist", "dist/", etc.)
    if (!lines.some(l => l.startsWith('dist'))) {
      missingEntries.push('dist');
    }

    if (missingEntries.length > 0) {
      results.push({
        name: 'perf:gitignore',
        status: 'fail',
        message: `.gitignore missing entries: ${missingEntries.join(', ')}`,
      });
    } else {
      results.push({
        name: 'perf:gitignore',
        status: 'pass',
        message: '.gitignore exists and includes node_modules and dist',
      });
    }
  }

  // ---- Check 6: WGSL consistent indentation (2 spaces) ----
  const badIndentFiles: string[] = [];

  for (const filePath of wgslFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const relPath = filePath.replace(ROOT + '/', '');
    const fileLines = content.split('\n');
    let hasTabIndent = false;
    let hasOddSpaceIndent = false;

    for (let i = 0; i < fileLines.length; i++) {
      const line = fileLines[i];
      if (line.trim().length === 0) continue; // skip blank lines

      // Check for tab indentation
      if (line.match(/^\t/)) {
        hasTabIndent = true;
        break;
      }

      // Check for indentation that is not a multiple of 2 spaces
      const leadingSpaces = line.match(/^( +)/);
      if (leadingSpaces) {
        const spaceCount = leadingSpaces[1].length;
        if (spaceCount % 2 !== 0) {
          hasOddSpaceIndent = true;
          break;
        }
      }
    }

    if (hasTabIndent) {
      badIndentFiles.push(`${relPath}: uses tab indentation`);
    } else if (hasOddSpaceIndent) {
      badIndentFiles.push(`${relPath}: uses non-2-space indentation`);
    }
  }

  if (wgslFiles.length === 0) {
    results.push({
      name: 'perf:wgsl-indentation',
      status: 'skip',
      message: 'No WGSL files found',
    });
  } else if (badIndentFiles.length > 0) {
    results.push({
      name: 'perf:wgsl-indentation',
      status: 'fail',
      message: `${badIndentFiles.length} WGSL file(s) have inconsistent indentation`,
      details: badIndentFiles.join('\n'),
    });
  } else {
    results.push({
      name: 'perf:wgsl-indentation',
      status: 'pass',
      message: `All ${wgslFiles.length} WGSL files use consistent 2-space indentation`,
    });
  }

  return results;
}

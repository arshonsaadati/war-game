/**
 * WGSL shader validation.
 * Checks shader source for common issues without requiring a GPU.
 * This is a static analysis / lint pass.
 */

export interface ShaderIssue {
  severity: 'error' | 'warning';
  message: string;
  line?: number;
}

/**
 * Validate WGSL shader source for common issues.
 */
export function validateWGSL(source: string, label: string): ShaderIssue[] {
  const issues: ShaderIssue[] = [];
  const lines = source.split('\n');

  // Check for required entry point
  const hasEntryPoint = /\@compute\s+\@workgroup_size/.test(source);
  if (!hasEntryPoint) {
    issues.push({
      severity: 'error',
      message: `${label}: No @compute @workgroup_size entry point found`,
    });
  }

  // Check for unbalanced braces
  let braceDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment lines
    if (line.trim().startsWith('//')) continue;

    for (const ch of line) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }

    if (braceDepth < 0) {
      issues.push({
        severity: 'error',
        message: `${label}: Unbalanced closing brace`,
        line: i + 1,
      });
    }
  }

  if (braceDepth !== 0) {
    issues.push({
      severity: 'error',
      message: `${label}: Unbalanced braces (depth = ${braceDepth} at end)`,
    });
  }

  // Check for binding declarations
  const bindings = source.match(/@binding\((\d+)\)/g) || [];
  const bindingNumbers = bindings.map(b => parseInt(b.match(/\d+/)![0]));
  const uniqueBindings = new Set(bindingNumbers);
  if (bindingNumbers.length !== uniqueBindings.size) {
    issues.push({
      severity: 'error',
      message: `${label}: Duplicate binding numbers detected`,
    });
  }

  // Check for group declarations
  const groups = source.match(/@group\((\d+)\)/g) || [];
  if (groups.length === 0 && bindings.length > 0) {
    issues.push({
      severity: 'warning',
      message: `${label}: Bindings declared without @group`,
    });
  }

  // Check struct alignment (basic check for 16-byte alignment issues)
  const structMatches = source.matchAll(/struct\s+(\w+)\s*\{([^}]+)\}/g);
  for (const match of structMatches) {
    const structName = match[1];
    const fields = match[2].split(',').map(f => f.trim()).filter(f => f.length > 0);

    // Count fields for vec types that need alignment
    for (const field of fields) {
      if (field.includes('vec3') && !field.includes('padding')) {
        issues.push({
          severity: 'warning',
          message: `${label}: struct ${structName} has vec3 field which may cause alignment issues — consider vec4 or explicit padding`,
        });
      }
    }
  }

  // Check that workgroup_size is reasonable
  const wsMatch = source.match(/@workgroup_size\((\d+)(?:,\s*(\d+))?(?:,\s*(\d+))?\)/);
  if (wsMatch) {
    const x = parseInt(wsMatch[1]);
    const y = wsMatch[2] ? parseInt(wsMatch[2]) : 1;
    const z = wsMatch[3] ? parseInt(wsMatch[3]) : 1;
    const total = x * y * z;

    if (total > 256) {
      issues.push({
        severity: 'warning',
        message: `${label}: workgroup_size ${total} exceeds 256 — may not work on all devices`,
      });
    }

    if (total % 32 !== 0) {
      issues.push({
        severity: 'warning',
        message: `${label}: workgroup_size ${total} is not a multiple of 32 — may be suboptimal`,
      });
    }
  }

  return issues;
}

/**
 * Validate that buffer struct layouts match between TS and WGSL.
 * Checks that the WGSL struct field count matches the expected stride.
 */
export function validateBufferLayout(
  shaderSource: string,
  structName: string,
  expectedStride: number
): ShaderIssue[] {
  const issues: ShaderIssue[] = [];

  const structRegex = new RegExp(`struct\\s+${structName}\\s*\\{([^}]+)\\}`);
  const match = shaderSource.match(structRegex);

  if (!match) {
    issues.push({
      severity: 'error',
      message: `Struct "${structName}" not found in shader`,
    });
    return issues;
  }

  // Strip inline comments before splitting on commas
  const body = match[1].replace(/\/\/[^\n]*/g, '');
  const fields = body
    .split(',')
    .map(f => f.trim())
    .filter(f => f.length > 0);

  // Count f32-equivalent fields
  let fieldCount = 0;
  for (const field of fields) {
    if (field.includes('vec4')) fieldCount += 4;
    else if (field.includes('vec3')) fieldCount += 3;
    else if (field.includes('vec2')) fieldCount += 2;
    else if (field.includes('mat4x4')) fieldCount += 16;
    else fieldCount += 1; // f32, u32, i32
  }

  if (fieldCount !== expectedStride) {
    issues.push({
      severity: 'error',
      message: `Struct "${structName}" has ${fieldCount} f32-equivalent fields but TS expects stride of ${expectedStride}`,
    });
  }

  return issues;
}

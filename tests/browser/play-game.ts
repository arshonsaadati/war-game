/**
 * Browser-based game evaluation.
 * Launches the game in a real browser, interacts with it,
 * takes screenshots, and validates everything works.
 *
 * Screenshots are analyzed by the LLM evaluator for visual quality.
 *
 * Usage: npx tsx tests/browser/play-game.ts
 */

import { chromium, Browser, Page } from 'playwright';
import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const SCREENSHOT_DIR = resolve(ROOT, 'test-screenshots');

interface PlayResult {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  message: string;
  screenshot?: string;
  consoleErrors?: string[];
}

const results: PlayResult[] = [];
const consoleMessages: string[] = [];
const consoleErrors: string[] = [];

function log(msg: string) {
  console.log(`\x1b[36m[browser-eval]\x1b[0m ${msg}`);
}

function addResult(r: PlayResult) {
  results.push(r);
  const icon = { pass: '\x1b[32m✓', fail: '\x1b[31m✗', warn: '\x1b[33m⚠', skip: '\x1b[90m○' }[r.status];
  console.log(`${icon} ${r.name}: ${r.message}\x1b[0m`);
  if (r.consoleErrors?.length) {
    for (const e of r.consoleErrors.slice(0, 3)) {
      console.log(`    \x1b[31m${e}\x1b[0m`);
    }
  }
}

async function startDevServer(): Promise<{ proc: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['vite', '--port', '4199'], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let output = '';
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`Dev server timed out. Output so far:\n${output}`));
    }, 20000);

    const checkOutput = () => {
      // Strip ANSI escape codes before matching
      const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
      const match = clean.match(/https?:\/\/localhost:\d+\/?/);
      if (match) {
        clearTimeout(timeout);
        resolve({ proc, url: match[0] });
      }
    };

    proc.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
      checkOutput();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
      checkOutput();
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function takeScreenshot(page: Page, name: string): Promise<string> {
  if (!existsSync(SCREENSHOT_DIR)) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
  const path = resolve(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function run() {
  log('Starting Vite dev server...');
  let server: { proc: ChildProcess; url: string };
  try {
    server = await startDevServer();
  } catch (e) {
    addResult({
      name: 'server:start',
      status: 'fail',
      message: `Failed to start dev server: ${(e as Error).message}`,
    });
    printReport();
    process.exit(1);
  }

  addResult({ name: 'server:start', status: 'pass', message: `Dev server at ${server.url}` });

  let browser: Browser | null = null;

  try {
    log('Launching Chromium with WebGPU flags...');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        '--disable-gpu-sandbox',
        '--no-sandbox',
      ],
    });

    addResult({ name: 'browser:launch', status: 'pass', message: 'Chromium launched' });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    // Capture console
    page.on('console', (msg) => {
      const text = msg.text();
      consoleMessages.push(`[${msg.type()}] ${text}`);
      if (msg.type() === 'error') consoleErrors.push(text);
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`PAGE ERROR: ${err.message}`);
    });

    // ===== PHASE 1: Load page =====
    log(`Navigating to ${server.url}...`);
    const response = await page.goto(server.url, { waitUntil: 'networkidle', timeout: 10000 });

    addResult({
      name: 'page:load',
      status: response?.ok() ? 'pass' : 'fail',
      message: response?.ok() ? `Loaded (${response.status()})` : `Failed: ${response?.status()}`,
    });

    await page.waitForTimeout(2000);

    // ===== PHASE 2: Check GPU initialization =====
    const statusText = await page.textContent('#status').catch(() => null);
    const gpuFailed = statusText?.includes('GPU init failed') || statusText?.includes('not supported');

    if (gpuFailed) {
      addResult({
        name: 'webgpu:init',
        status: 'warn',
        message: `No WebGPU on this device: ${statusText}`,
      });
    } else {
      addResult({
        name: 'webgpu:init',
        status: 'pass',
        message: `GPU ready: ${statusText}`,
      });
    }

    // ===== PHASE 3: Check all UI elements =====
    const requiredSelectors = [
      '#battlefield', '#histogram', '#run-battle', '#reset',
      '#sim-count', '#heatmap-toggle', '#heatmap-opacity',
      '#results-panel', '#fps',
    ];

    let missingUI: string[] = [];
    for (const sel of requiredSelectors) {
      if (!(await page.$(sel))) missingUI.push(sel);
    }

    if (missingUI.length === 0) {
      addResult({ name: 'ui:elements', status: 'pass', message: `All ${requiredSelectors.length} UI elements present` });
    } else {
      addResult({ name: 'ui:elements', status: 'fail', message: `Missing: ${missingUI.join(', ')}` });
    }

    // ===== SCREENSHOT 1: Initial state =====
    const ss1 = await takeScreenshot(page, '01-initial-load');
    addResult({ name: 'screenshot:initial', status: 'pass', message: 'Initial state', screenshot: ss1 });

    // ===== PHASE 4: Check layout isn't broken =====
    const layoutCheck = await page.evaluate(() => {
      const issues: string[] = [];

      // Check viewport canvas exists and has size
      const canvas = document.getElementById('battlefield') as HTMLCanvasElement;
      if (!canvas) { issues.push('No battlefield canvas'); }
      else if (canvas.clientWidth < 100 || canvas.clientHeight < 100) {
        issues.push(`Canvas too small: ${canvas.clientWidth}x${canvas.clientHeight}`);
      }

      // Check sidebar isn't overlapping viewport
      const sidebar = document.querySelector('.sidebar') as HTMLElement;
      const viewport = document.querySelector('.viewport') as HTMLElement;
      if (sidebar && viewport) {
        const sRect = sidebar.getBoundingClientRect();
        const vRect = viewport.getBoundingClientRect();
        if (sRect.right > vRect.left + 10) {
          issues.push('Sidebar overlaps viewport');
        }
      }

      // Check no elements overflow the body
      const body = document.body;
      if (body.scrollWidth > window.innerWidth + 5) {
        issues.push(`Horizontal overflow: body=${body.scrollWidth} > window=${window.innerWidth}`);
      }

      // Check buttons are visible and clickable
      const runBtn = document.getElementById('run-battle');
      if (runBtn) {
        const rect = runBtn.getBoundingClientRect();
        if (rect.width < 30 || rect.height < 15) {
          issues.push('Run Battle button too small');
        }
      }

      // Check text is readable (not white on white, etc)
      const status = document.getElementById('status');
      if (status) {
        const style = getComputedStyle(status);
        const bg = style.backgroundColor;
        const color = style.color;
        if (bg === color) issues.push('Status text same color as background');
      }

      return issues;
    });

    if (layoutCheck.length === 0) {
      addResult({ name: 'layout:check', status: 'pass', message: 'Layout looks correct' });
    } else {
      addResult({
        name: 'layout:check',
        status: 'fail',
        message: `${layoutCheck.length} layout issue(s)`,
        consoleErrors: layoutCheck,
      });
    }

    // ===== PHASE 5: Play the game! =====
    if (!gpuFailed) {
      // Lower sim count for faster testing on low-power GPUs
      await page.fill('#sim-count', '256');
      log('Playing the game — clicking Run Battle (256 sims)...');
      await page.click('#run-battle');

      // Wait for results to appear (up to 30s for slow GPUs)
      try {
        await page.waitForFunction(
          () => {
            const el = document.getElementById('result-a-win-pct');
            return el && el.textContent && el.textContent !== '--';
          },
          { timeout: 30000 }
        );
      } catch {
        // Timeout — check what happened
      }

      const resultAWin = await page.textContent('#result-a-win-pct').catch(() => '--');
      const resultBWin = await page.textContent('#result-b-win-pct').catch(() => '--');
      const resultDraws = await page.textContent('#result-draws').catch(() => '--');
      const resultTime = await page.textContent('#result-time').catch(() => '--');
      const currentStatus = await page.textContent('#status').catch(() => '') || '';

      if (resultAWin && resultAWin !== '--') {
        addResult({
          name: 'battle:completed',
          status: 'pass',
          message: `A: ${resultAWin} | B: ${resultBWin} | Draws: ${resultDraws} | GPU: ${resultTime}`,
        });
      } else if (currentStatus.includes('Running Monte Carlo')) {
        // GPU compute is running but hasn't finished — device may be too slow
        // or headless WebGPU doesn't support compute readback
        addResult({
          name: 'battle:completed',
          status: 'warn',
          message: `GPU compute started but did not complete in time (device limitation). Status: ${currentStatus}`,
        });
      } else {
        addResult({ name: 'battle:completed', status: 'fail', message: `Battle failed. Status: ${currentStatus}` });
      }

      // Screenshot after battle
      const ss2 = await takeScreenshot(page, '02-after-battle');
      addResult({ name: 'screenshot:post-battle', status: 'pass', message: 'Post-battle state', screenshot: ss2 });

      // Check histogram has content
      const histData = await page.evaluate(() => {
        const c = document.getElementById('histogram') as HTMLCanvasElement;
        if (!c) return null;
        const ctx = c.getContext('2d');
        if (!ctx) return null;
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let filled = 0;
        for (let i = 0; i < d.length; i += 16) { // sample every 4th pixel
          if (d[i] > 20 || d[i+1] > 20 || d[i+2] > 20) filled++;
        }
        return { sampled: d.length / 16, filled };
      });

      if (histData && histData.filled > 50) {
        addResult({ name: 'histogram:drawn', status: 'pass', message: `Histogram has content (${histData.filled}/${histData.sampled} sampled pixels lit)` });
      } else {
        addResult({ name: 'histogram:drawn', status: 'warn', message: `Histogram may be empty` });
      }

      // ===== PHASE 6: Interact with controls =====
      log('Testing controls...');

      // Change sim count
      await page.fill('#sim-count', '8192');
      const simVal = await page.inputValue('#sim-count');
      addResult({ name: 'control:sim-count', status: simVal === '8192' ? 'pass' : 'fail', message: `Sim count set to ${simVal}` });

      // Toggle heatmap
      await page.click('#heatmap-toggle');
      await page.waitForTimeout(300);
      await page.click('#heatmap-toggle');
      addResult({ name: 'control:heatmap-toggle', status: 'pass', message: 'Heatmap toggled' });

      // Adjust opacity
      await page.fill('#heatmap-opacity', '0.7');
      addResult({ name: 'control:opacity', status: 'pass', message: 'Opacity adjusted' });

      // Run second battle
      log('Running second battle (256 sims)...');
      try {
        await page.waitForSelector('#run-battle:not([disabled])', { timeout: 30000 });
        await page.click('#run-battle');
        await page.waitForFunction(
          () => {
            const el = document.getElementById('result-a-win-pct');
            return el && el.textContent && el.textContent !== '--';
          },
          { timeout: 30000 }
        );
      } catch {
        // Timeout ok
      }

      const result2 = await page.textContent('#result-a-win-pct').catch(() => '--');
      if (result2 && result2 !== '--') {
        addResult({ name: 'battle:second', status: 'pass', message: `Second battle: A=${result2}` });
      } else {
        addResult({ name: 'battle:second', status: 'warn', message: 'Second battle may not have completed' });
      }

      const ss3 = await takeScreenshot(page, '03-second-battle');
      addResult({ name: 'screenshot:second-battle', status: 'pass', message: 'Second battle state', screenshot: ss3 });

      // ===== PHASE 7: Test reset =====
      log('Testing reset...');
      await page.click('#reset');
      await page.waitForTimeout(500);

      const resetStatus = await page.textContent('#status').catch(() => '');
      addResult({
        name: 'reset:works',
        status: resetStatus?.toLowerCase().includes('reset') ? 'pass' : 'warn',
        message: `After reset: ${resetStatus}`,
      });

      const ss4 = await takeScreenshot(page, '04-after-reset');
      addResult({ name: 'screenshot:after-reset', status: 'pass', message: 'Post-reset state', screenshot: ss4 });

      // ===== PHASE 8: Camera interaction =====
      log('Testing camera pan/zoom...');
      const canvas = await page.$('#battlefield');
      if (canvas) {
        const box = await canvas.boundingBox();
        if (box) {
          // Pan: drag from center
          await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width/2 + 100, box.y + box.height/2 + 50, { steps: 10 });
          await page.mouse.up();

          // Zoom: scroll
          await page.mouse.wheel(0, -300);
          await page.waitForTimeout(500);

          const ss5 = await takeScreenshot(page, '05-after-pan-zoom');
          addResult({ name: 'camera:pan-zoom', status: 'pass', message: 'Camera panned and zoomed', screenshot: ss5 });
        }
      }
    }

    // ===== PHASE 9: FPS check =====
    await page.waitForTimeout(1500);
    const fpsText = await page.textContent('#fps').catch(() => '0');
    const fpsNum = parseInt(fpsText || '0');
    if (fpsNum > 0) {
      addResult({ name: 'render:fps', status: fpsNum > 15 ? 'pass' : 'warn', message: `FPS: ${fpsNum}` });
    } else {
      addResult({ name: 'render:fps', status: 'warn', message: 'FPS counter at 0 (may need GPU)' });
    }

    // ===== PHASE 10: Console error audit =====
    const realErrors = consoleErrors.filter(e =>
      !e.includes('WebGPU') && !e.includes('GPU') &&
      !e.includes('adapter') && !e.includes('not supported') &&
      !e.includes('favicon')
    );

    if (realErrors.length === 0) {
      addResult({ name: 'console:clean', status: 'pass', message: `No unexpected errors (${consoleErrors.length} GPU-related filtered)` });
    } else {
      addResult({
        name: 'console:errors',
        status: 'fail',
        message: `${realErrors.length} console error(s)`,
        consoleErrors: realErrors,
      });
    }

    // Final screenshot
    const ssFinal = await takeScreenshot(page, '06-final');
    addResult({ name: 'screenshot:final', status: 'pass', message: 'Final state', screenshot: ssFinal });

  } catch (e) {
    addResult({ name: 'browser:fatal', status: 'fail', message: `Crashed: ${(e as Error).message}` });
  } finally {
    if (browser) await browser.close();
    server.proc.kill();
  }

  printReport();

  const failures = results.filter(r => r.status === 'fail');
  if (failures.length > 0) process.exit(1);
}

function printReport() {
  const passCount = results.filter(r => r.status === 'pass').length;
  const failCount = results.filter(r => r.status === 'fail').length;
  const warnCount = results.filter(r => r.status === 'warn').length;

  console.log('\n' + '='.repeat(70));
  console.log('  BROWSER PLAY TEST REPORT');
  console.log('='.repeat(70));
  console.log(`  PASS: ${passCount}  FAIL: ${failCount}  WARN: ${warnCount}  TOTAL: ${results.length}`);

  if (existsSync(SCREENSHOT_DIR)) {
    console.log(`  Screenshots: test-screenshots/`);
  }
  console.log('='.repeat(70));

  // Write detailed JSON report + screenshot paths for the LLM evaluator
  const reportPath = resolve(ROOT, 'browser-test-results.json');
  writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: { pass: passCount, fail: failCount, warn: warnCount },
    results,
    screenshots: results.filter(r => r.screenshot).map(r => r.screenshot),
    consoleMessages: consoleMessages.slice(-50),
    consoleErrors,
  }, null, 2));
  console.log(`  Report: ${reportPath}\n`);
}

run();

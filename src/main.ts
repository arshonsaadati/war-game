/**
 * War Game - WebGPU Monte Carlo Battle Simulator
 * Full entry point: GPU rendering, simulation, UI, game loop.
 */

import { initGPU } from './engine/gpu';
import { World } from './engine/ecs';
import { Camera } from './engine/camera';
import { InputHandler } from './engine/input';
import { Renderer } from './renderer/renderer';
import { CanvasFallbackRenderer } from './renderer/canvas-fallback';
import { BattleResult, SimulationConfig } from './simulation/simulator';
import { CPUBattleSimulator, CPU_DEFAULT_SIMULATIONS } from './simulation/cpu-simulator';
import {
  UNIT_STRIDE,
  UnitType,
  createArmy,
  spawnFormation,
  buildUnitBuffer,
  Army,
} from './game/army';
import { Battlefield } from './game/battlefield';
import { GameLoop } from './game/game-loop';
import { BattleAnimator } from './game/battle-animator';

// --- UI Elements ---
const canvas = document.getElementById('battlefield') as HTMLCanvasElement;
const canvas2d = document.getElementById('battlefield-2d') as HTMLCanvasElement;
const histogramCanvas = document.getElementById('histogram') as HTMLCanvasElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const fpsEl = document.getElementById('fps') as HTMLSpanElement;
const runBtn = document.getElementById('run-battle') as HTMLButtonElement;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;
const simCountEl = document.getElementById('sim-count') as HTMLInputElement;
const heatmapToggle = document.getElementById('heatmap-toggle') as HTMLInputElement;
const heatmapOpacity = document.getElementById('heatmap-opacity') as HTMLInputElement;
const playBtn = document.getElementById('play-battle') as HTMLButtonElement;
const pauseBtn = document.getElementById('pause-battle') as HTMLButtonElement;
const animSpeedSlider = document.getElementById('anim-speed') as HTMLInputElement;

// Results display elements
const resultAName = document.getElementById('result-a-name') as HTMLElement;
const resultAWinPct = document.getElementById('result-a-win-pct') as HTMLElement;
const resultAWins = document.getElementById('result-a-wins') as HTMLElement;
const resultASurv = document.getElementById('result-a-surv') as HTMLElement;
const resultBName = document.getElementById('result-b-name') as HTMLElement;
const resultBWinPct = document.getElementById('result-b-win-pct') as HTMLElement;
const resultBWins = document.getElementById('result-b-wins') as HTMLElement;
const resultBSurv = document.getElementById('result-b-surv') as HTMLElement;
const resultDraws = document.getElementById('result-draws') as HTMLElement;
const resultTime = document.getElementById('result-time') as HTMLElement;
const resultPanel = document.getElementById('results-panel') as HTMLElement;
const unitCountA = document.getElementById('unit-count-a') as HTMLElement;
const unitCountB = document.getElementById('unit-count-b') as HTMLElement;

function log(msg: string) {
  statusEl.textContent = msg;
  console.log(`[war-game] ${msg}`);
}

async function main() {
  log('Initializing WebGPU...');

  let gpuCtx;
  try {
    gpuCtx = await initGPU();
  } catch (e) {
    log(`GPU init failed: ${(e as Error).message}`);
    document.body.classList.add('no-gpu');
    return;
  }

  const device = gpuCtx.device;
  log('WebGPU ready. Setting up world...');

  // --- Resize canvas to fill container ---
  function resizeCanvas() {
    const container = canvas.parentElement!;
    const rect = container.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * devicePixelRatio);
    canvas.height = Math.floor(rect.height * devicePixelRatio);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    canvas2d.width = Math.floor(rect.width * devicePixelRatio);
    canvas2d.height = Math.floor(rect.height * devicePixelRatio);
    camera.setViewport(canvas.width, canvas.height);
  }

  // --- World ---
  const world = new World(10000);
  world.registerComponent('unit', Float32Array, UNIT_STRIDE);
  world.registerComponent('army', Float32Array, 2);

  // --- Battlefield ---
  const battlefield = new Battlefield({ width: 200, height: 200, cellSize: 10 });
  battlefield.generateRandom(42);

  // --- Armies ---
  let armyA!: Army;
  let armyB!: Army;

  function setupArmies() {
    armyA = createArmy(world, 0, 'Red Legion', [1, 0, 0]);
    armyB = createArmy(world, 1, 'Blue Guard', [0, 0, 1]);

    // Army A: left side
    spawnFormation(world, armyA, UnitType.Infantry, 30, 100, 5, 10);
    spawnFormation(world, armyA, UnitType.Archer, 20, 100, 3, 8);
    spawnFormation(world, armyA, UnitType.Cavalry, 15, 70, 2, 5);
    spawnFormation(world, armyA, UnitType.Artillery, 10, 100, 1, 3);

    // Army B: right side
    spawnFormation(world, armyB, UnitType.Infantry, 170, 100, 5, 10);
    spawnFormation(world, armyB, UnitType.Archer, 180, 100, 3, 8);
    spawnFormation(world, armyB, UnitType.Cavalry, 185, 130, 2, 5);
    spawnFormation(world, armyB, UnitType.Artillery, 190, 100, 1, 3);

    unitCountA.textContent = `${armyA.unitIds.length} units`;
    unitCountB.textContent = `${armyB.unitIds.length} units`;
  }

  setupArmies();

  // --- Camera ---
  const camera = new Camera();
  camera.setPosition(100, 100);
  camera.setZoom(3);

  // --- Input ---
  const input = new InputHandler(canvas, camera);

  // --- 2D Fallback Renderer (always active as overlay for unit/terrain visibility) ---
  const fallback = new CanvasFallbackRenderer(canvas2d);

  // --- Renderer ---
  const renderer = new Renderer(device, canvas);
  await renderer.initialize();

  // Upload terrain
  renderer.terrain.updateTerrain(
    battlefield.buildTerrainBuffer(),
    battlefield.cols,
    battlefield.rows
  );

  // --- Simulator (CPU-based — reliable on all devices) ---
  const cpuSimulator = new CPUBattleSimulator();

  // --- Upload units to renderer ---
  function uploadUnitsToGPU() {
    const unitDataA = buildUnitBuffer(world, armyA);
    const unitDataB = buildUnitBuffer(world, armyB);

    // Combine both armies into single buffer
    const totalUnits = armyA.unitIds.length + armyB.unitIds.length;
    const combinedUnits = new Float32Array(totalUnits * UNIT_STRIDE);
    combinedUnits.set(unitDataA, 0);
    combinedUnits.set(unitDataB, unitDataA.length);

    // Build army info buffer (army_id, is_alive per unit)
    const armyInfo = new Float32Array(totalUnits * 2);
    for (let i = 0; i < armyA.unitIds.length; i++) {
      const data = world.get('army', armyA.unitIds[i]);
      armyInfo[i * 2] = data[0];
      armyInfo[i * 2 + 1] = data[1];
    }
    for (let i = 0; i < armyB.unitIds.length; i++) {
      const idx = armyA.unitIds.length + i;
      const data = world.get('army', armyB.unitIds[i]);
      armyInfo[idx * 2] = data[0];
      armyInfo[idx * 2 + 1] = data[1];
    }

    renderer.units.updateUnits(combinedUnits, armyInfo, totalUnits);
  }

  uploadUnitsToGPU();

  // --- Battle Animator ---
  let battleAnimator: BattleAnimator | null = null;

  // --- Heatmap data ---
  let heatmapData: Float32Array | null = null;

  function buildHeatmapFromResults(result: BattleResult) {
    const cols = battlefield.cols;
    const rows = battlefield.rows;
    heatmapData = new Float32Array(cols * rows * 4);

    // For each cell, calculate the relative strength of nearby units
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = (c + 0.5) * battlefield.cellSize;
        const cy = (r + 0.5) * battlefield.cellSize;

        let strengthA = 0;
        let strengthB = 0;

        // Sum influence from each army's units based on distance
        for (let i = 0; i < armyA.unitIds.length; i++) {
          const udata = world.get('unit', armyA.unitIds[i]);
          const dx = udata[0] - cx;
          const dy = udata[1] - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          strengthA += udata[4] / (1 + dist * 0.1); // attack / distance
        }

        for (let i = 0; i < armyB.unitIds.length; i++) {
          const udata = world.get('unit', armyB.unitIds[i]);
          const dx = udata[0] - cx;
          const dy = udata[1] - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          strengthB += udata[4] / (1 + dist * 0.1);
        }

        const total = strengthA + strengthB;
        const idx = (r * cols + c) * 4;
        if (total > 0) {
          heatmapData[idx + 0] = (strengthA / total) * result.winProbabilityA * 2;
          heatmapData[idx + 1] = (strengthB / total) * result.winProbabilityB * 2;
          heatmapData[idx + 2] = Math.min(total * 0.01, 1.0); // intensity
        }
        heatmapData[idx + 3] = 0;
      }
    }

    renderer.heatmap.updateHeatmap(heatmapData, cols, rows);
  }

  // --- Battle execution ---
  let lastResult: BattleResult | null = null;

  // GPU compute for Monte Carlo is unreliable (mapAsync can hang the event loop
  // on many devices). Use CPU simulation by default — it's fast enough.
  // GPU is used only for rendering.
  let useGPUCompute = false; // Disabled by default — CPU fallback is reliable

  async function runBattle() {
    runBtn.disabled = true;
    const requestedSims = parseInt(simCountEl.value) || 4096;

    const armyAData = buildUnitBuffer(world, armyA);
    const armyBData = buildUnitBuffer(world, armyB);
    const terrainData = battlefield.buildTerrainBuffer();

    const baseConfig: SimulationConfig = {
      numSimulations: requestedSims,
      terrainCols: battlefield.cols,
      terrainRows: battlefield.rows,
      cellSize: battlefield.cellSize,
    };

    let result: BattleResult;
    const mode = 'CPU';
    const cpuSims = Math.min(requestedSims, CPU_DEFAULT_SIMULATIONS);
    log(`Running Monte Carlo (${cpuSims} simulations)...`);
    const t0 = performance.now();

    const cpuConfig = { ...baseConfig, numSimulations: cpuSims };
    result = cpuSimulator.runBattle(armyAData, armyBData, terrainData, cpuConfig);

    const elapsed = (performance.now() - t0).toFixed(1);
    lastResult = result;

    // Update results panel
    resultAName.textContent = armyA.name;
    resultAWinPct.textContent = `${(result.winProbabilityA * 100).toFixed(1)}%`;
    resultAWins.textContent = `${result.armyAWins}`;
    resultASurv.textContent = result.avgSurvivingA.toFixed(1);
    resultBName.textContent = armyB.name;
    resultBWinPct.textContent = `${(result.winProbabilityB * 100).toFixed(1)}%`;
    resultBWins.textContent = `${result.armyBWins}`;
    resultBSurv.textContent = result.avgSurvivingB.toFixed(1);
    resultDraws.textContent = `${result.draws}`;
    resultTime.textContent = `${elapsed}ms`;
    resultPanel.classList.add('has-results');

    log(`Done (${mode}) in ${elapsed}ms — ${armyA.name}: ${(result.winProbabilityA * 100).toFixed(1)}% | ${armyB.name}: ${(result.winProbabilityB * 100).toFixed(1)}%`);

    // Emit particles at battle midpoint for visual flair
    renderer.particles.emitCombat(30, 100, 170, 100);
    renderer.particles.emitCombat(100, 85, 100, 115);

    // Update heatmap
    buildHeatmapFromResults(result);

    // Draw histogram
    drawHistogram(result.rawResults.map(r => r.armyASurviving - r.armyBSurviving));

    runBtn.disabled = false;
  }

  // --- Histogram (2D canvas overlay) ---
  function drawHistogram(deltas: number[]) {
    const ctx = histogramCanvas.getContext('2d');
    if (!ctx) return;

    const w = histogramCanvas.width;
    const h = histogramCanvas.height;
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, w, h);

    const minVal = Math.min(...deltas);
    const maxVal = Math.max(...deltas);
    const range = maxVal - minVal || 1;
    const numBins = 50;
    const bins = new Array(numBins).fill(0);

    for (const d of deltas) {
      const bin = Math.min(Math.floor(((d - minVal) / range) * numBins), numBins - 1);
      bins[bin]++;
    }

    const maxBin = Math.max(...bins);
    const barWidth = w / numBins;
    const pad = 20;

    for (let i = 0; i < numBins; i++) {
      const barHeight = (bins[i] / maxBin) * (h - pad * 2);
      const x = i * barWidth;
      const y = h - pad - barHeight;
      const binCenter = minVal + (i + 0.5) * (range / numBins);

      if (binCenter > 0) {
        ctx.fillStyle = `rgba(220, 60, 60, ${0.5 + bins[i] / maxBin * 0.5})`;
      } else if (binCenter < 0) {
        ctx.fillStyle = `rgba(60, 70, 220, ${0.5 + bins[i] / maxBin * 0.5})`;
      } else {
        ctx.fillStyle = 'rgba(128, 128, 128, 0.7)';
      }

      ctx.fillRect(x, y, Math.max(barWidth - 1, 1), barHeight);
    }

    // Center line
    const centerX = ((0 - minVal) / range) * w;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, h - pad);
    ctx.stroke();
    ctx.setLineDash([]);

    // Labels
    ctx.fillStyle = '#666';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('B wins  |  A wins', w / 2, h - 4);
  }

  // --- UI event handlers ---
  runBtn.addEventListener('click', runBattle);

  resetBtn.addEventListener('click', () => {
    // Reset animation if active
    if (battleAnimator) {
      battleAnimator.reset();
      battleAnimator = null;
      playBtn.disabled = false;
      runBtn.disabled = false;
      pauseBtn.textContent = 'Pause';
    }
    // Re-create world
    setupArmies();
    uploadUnitsToGPU();
    heatmapData = null;
    lastResult = null;
    resultPanel.classList.remove('has-results');
    log('Battlefield reset.');
  });

  heatmapToggle.addEventListener('change', () => {
    renderer.heatmap.visible = heatmapToggle.checked;
  });

  heatmapOpacity.addEventListener('input', () => {
    renderer.heatmap.opacity = parseFloat(heatmapOpacity.value);
  });

  playBtn.addEventListener('click', async () => {
    if (!lastResult) {
      log('Run a battle first, then play the animation.');
      return;
    }

    // Reset any previous animation
    if (battleAnimator) {
      battleAnimator.reset();
    }

    battleAnimator = new BattleAnimator(world, armyA, armyB, battlefield, {
      duration: 10,
      combatRange: 12,
      moveSpeed: 15,
    });

    battleAnimator.onCombatEvent((x, y) => {
      renderer.particles.emitCombat(x, y, x, y);
    });

    battleAnimator.start(lastResult);
    playBtn.disabled = true;
    runBtn.disabled = true;
    log('Battle animation playing...');
  });

  pauseBtn.addEventListener('click', () => {
    if (!battleAnimator) return;

    if (battleAnimator.state === 'running') {
      battleAnimator.pause();
      pauseBtn.textContent = 'Resume';
      log('Animation paused.');
    } else if (battleAnimator.state === 'paused') {
      battleAnimator.resume();
      pauseBtn.textContent = 'Pause';
      log('Animation resumed.');
    }
  });

  animSpeedSlider.addEventListener('input', () => {
    const speed = parseFloat(animSpeedSlider.value);
    if (battleAnimator) {
      battleAnimator.setSpeed(speed);
    }
  });

  // --- Game loop ---
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  let elapsedTime = 0;
  const gameLoop = new GameLoop(
    50, // tick rate (ms)
    (dt, _elapsed) => {
      // Simulation tick — camera + battle animation
      input.update(dt);
      camera.update();

      // Update battle animation
      if (battleAnimator && battleAnimator.state === 'running') {
        battleAnimator.update(dt / 1000);
        uploadUnitsToGPU();

        const pct = (battleAnimator.progress * 100).toFixed(0);
        log(`Battle animation: ${pct}%`);

        if (battleAnimator.isComplete()) {
          playBtn.disabled = false;
          runBtn.disabled = false;
          pauseBtn.textContent = 'Pause';
          log('Battle animation complete.');
        }
      }
    },
    (dt, _elapsed) => {
      // Render frame
      elapsedTime += dt / 1000;
      fpsEl.textContent = `${gameLoop.fps}`;

      renderer.render(
        camera,
        elapsedTime,
        dt,
        { cols: battlefield.cols, rows: battlefield.rows, cellSize: battlefield.cellSize },
        -1 // no selection yet
      );

      // 2D Canvas overlay — always renders terrain + units as a fallback
      // This ensures visibility even when WebGPU render pipeline doesn't produce output
      fallback.render(
        camera,
        battlefield,
        world,
        [armyA, armyB],
        heatmapData,
        parseFloat(heatmapOpacity.value),
        heatmapToggle.checked
      );
    }
  );

  log(`Ready. ${armyA.name} (${armyA.unitIds.length}) vs ${armyB.name} (${armyB.unitIds.length})`);
  gameLoop.start();
}

main();

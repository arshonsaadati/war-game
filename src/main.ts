/**
 * War Game - WebGPU Monte Carlo Battle Simulator
 * Entry point: initializes GPU, sets up armies, runs simulation.
 */

import { initGPU } from './engine/gpu';
import { World } from './engine/ecs';
import { BattleSimulator } from './simulation/simulator';
import {
  UNIT_STRIDE,
  UnitType,
  createArmy,
  spawnFormation,
  buildUnitBuffer,
} from './game/army';
import { Battlefield } from './game/battlefield';
import { GameLoop } from './game/game-loop';

// UI Elements
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const resultsEl = document.getElementById('results') as HTMLDivElement;
const runBtn = document.getElementById('run-battle') as HTMLButtonElement;

function log(msg: string) {
  statusEl.textContent = msg;
  console.log(msg);
}

async function main() {
  log('Initializing WebGPU...');

  let gpuCtx;
  try {
    gpuCtx = await initGPU();
  } catch (e) {
    log(`GPU init failed: ${(e as Error).message}`);
    return;
  }

  log('WebGPU initialized. Setting up world...');

  // --- World setup ---
  const world = new World(10000);
  world.registerComponent('unit', Float32Array, UNIT_STRIDE);
  world.registerComponent('army', Float32Array, 2); // [armyId, isAlive]

  // --- Battlefield ---
  const battlefield = new Battlefield({ width: 200, height: 200, cellSize: 10 });
  battlefield.generateRandom(42);

  // --- Armies ---
  const armyA = createArmy(world, 0, 'Red Legion', [1, 0, 0]);
  const armyB = createArmy(world, 1, 'Blue Guard', [0, 0, 1]);

  // Army A: mixed force on the left
  spawnFormation(world, armyA, UnitType.Infantry, 30, 100, 5, 10);
  spawnFormation(world, armyA, UnitType.Archer, 20, 100, 3, 8);
  spawnFormation(world, armyA, UnitType.Cavalry, 15, 70, 2, 5);
  spawnFormation(world, armyA, UnitType.Artillery, 10, 100, 1, 3);

  // Army B: mixed force on the right
  spawnFormation(world, armyB, UnitType.Infantry, 170, 100, 5, 10);
  spawnFormation(world, armyB, UnitType.Archer, 180, 100, 3, 8);
  spawnFormation(world, armyB, UnitType.Cavalry, 185, 130, 2, 5);
  spawnFormation(world, armyB, UnitType.Artillery, 190, 100, 1, 3);

  log(`Armies created: ${armyA.name} (${armyA.unitIds.length} units) vs ${armyB.name} (${armyB.unitIds.length} units)`);

  // --- Simulator ---
  const simulator = new BattleSimulator(gpuCtx.device);
  await simulator.initialize();
  log('Battle simulator ready.');

  // --- Run battle ---
  async function runBattle() {
    runBtn.disabled = true;
    log('Running Monte Carlo simulation (4096 trials)...');

    const armyAData = buildUnitBuffer(world, armyA);
    const armyBData = buildUnitBuffer(world, armyB);
    const terrainData = battlefield.buildTerrainBuffer();

    const startTime = performance.now();

    const result = await simulator.runBattle(armyAData, armyBData, terrainData, {
      numSimulations: 4096,
      terrainCols: battlefield.cols,
      terrainRows: battlefield.rows,
      cellSize: battlefield.cellSize,
    });

    const elapsed = (performance.now() - startTime).toFixed(1);

    log(`Simulation complete in ${elapsed}ms`);

    resultsEl.innerHTML = `
      <h3>Battle Results (${result.totalSims} simulations)</h3>
      <div class="result-grid">
        <div class="army-result army-a">
          <h4>${armyA.name}</h4>
          <div class="win-prob">${(result.winProbabilityA * 100).toFixed(1)}%</div>
          <div>Wins: ${result.armyAWins}</div>
          <div>Avg surviving: ${result.avgSurvivingA.toFixed(1)}</div>
        </div>
        <div class="vs">VS</div>
        <div class="army-result army-b">
          <h4>${armyB.name}</h4>
          <div class="win-prob">${(result.winProbabilityB * 100).toFixed(1)}%</div>
          <div>Wins: ${result.armyBWins}</div>
          <div>Avg surviving: ${result.avgSurvivingB.toFixed(1)}</div>
        </div>
      </div>
      <div class="draws">Draws: ${result.draws}</div>
      <div class="timing">GPU compute time: ${elapsed}ms</div>
    `;

    // Draw histogram of outcomes
    drawHistogram(result.rawResults.map(r => r.armyASurviving - r.armyBSurviving));

    runBtn.disabled = false;
  }

  runBtn.addEventListener('click', runBattle);

  // --- Simple canvas visualization ---
  function drawHistogram(deltas: number[]) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Build histogram bins
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

    // Draw bars
    for (let i = 0; i < numBins; i++) {
      const barHeight = (bins[i] / maxBin) * (h - 40);
      const x = i * barWidth;
      const y = h - 20 - barHeight;

      // Color: red for A wins, blue for B wins
      const binCenter = minVal + (i + 0.5) * (range / numBins);
      if (binCenter > 0) {
        ctx.fillStyle = `rgba(220, 50, 50, ${0.5 + bins[i] / maxBin * 0.5})`;
      } else if (binCenter < 0) {
        ctx.fillStyle = `rgba(50, 50, 220, ${0.5 + bins[i] / maxBin * 0.5})`;
      } else {
        ctx.fillStyle = 'rgba(128, 128, 128, 0.7)';
      }

      ctx.fillRect(x, y, barWidth - 1, barHeight);
    }

    // Draw center line
    const centerX = ((0 - minVal) / range) * w;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, h - 20);
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#aaa';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('← B wins | A wins →', w / 2, h - 4);
  }

  // Initial render
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#666';
    ctx.font = '16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Click "Run Battle" to simulate', canvas.width / 2, canvas.height / 2);
  }
}

main();

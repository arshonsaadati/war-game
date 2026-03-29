/**
 * Army editor: placement mode, presets, composition display, and army size scaling.
 * Extracted from main.ts to keep file sizes manageable.
 */

import { World } from '../engine/ecs';
import {
  UnitType,
  Army,
  spawnUnit,
  spawnFormation,
  removeUnit,
  clearArmy,
  countUnitsByType,
  findNearestUnit,
} from './army';

export interface ArmyEditorElements {
  placeModeBtn: HTMLButtonElement;
  placeUnitType: HTMLSelectElement;
  placeArmy: HTMLSelectElement;
  armySizeSlider: HTMLInputElement;
  armySizeLabel: HTMLElement;
  compositionA: HTMLElement;
  compositionB: HTMLElement;
  unitCountA: HTMLElement;
  unitCountB: HTMLElement;
  clearArmyA: HTMLButtonElement;
  clearArmyB: HTMLButtonElement;
  presetStandard: HTMLButtonElement;
  presetCavalryRush: HTMLButtonElement;
  presetArcherLine: HTMLButtonElement;
  presetArtilleryBattery: HTMLButtonElement;
}

export interface ArmyEditorContext {
  world: World;
  getArmyA: () => Army;
  getArmyB: () => Army;
  setArmyA: (a: Army) => void;
  setArmyB: (b: Army) => void;
  onArmyChanged: () => void;
}

export class ArmyEditor {
  private placeModeActive = false;
  private ghostPos: { x: number; y: number } | null = null;
  private els: ArmyEditorElements;
  private ctx: ArmyEditorContext;

  constructor(els: ArmyEditorElements, ctx: ArmyEditorContext) {
    this.els = els;
    this.ctx = ctx;
    this.wireUI();
    this.updateComposition();
  }

  get isPlaceModeActive(): boolean {
    return this.placeModeActive;
  }

  get ghostPosition(): { x: number; y: number } | null {
    return this.ghostPos;
  }

  get selectedUnitType(): UnitType {
    return parseInt(this.els.placeUnitType.value) as UnitType;
  }

  get selectedArmyIndex(): number {
    return parseInt(this.els.placeArmy.value);
  }

  setGhostPosition(wx: number, wy: number): void {
    this.ghostPos = { x: wx, y: wy };
  }

  clearGhost(): void {
    this.ghostPos = null;
  }

  /** Handle left-click on battlefield during place mode */
  handlePlaceClick(wx: number, wy: number): boolean {
    if (!this.placeModeActive) return false;
    const army = this.selectedArmyIndex === 0
      ? this.ctx.getArmyA()
      : this.ctx.getArmyB();
    spawnUnit(this.ctx.world, army, this.selectedUnitType, wx, wy);
    this.updateComposition();
    this.ctx.onArmyChanged();
    return true;
  }

  /** Handle right-click to remove nearest unit */
  handleRemoveClick(wx: number, wy: number): boolean {
    if (!this.placeModeActive) return false;
    const armyA = this.ctx.getArmyA();
    const armyB = this.ctx.getArmyB();

    // Search both armies for closest unit
    const idA = findNearestUnit(this.ctx.world, armyA, wx, wy, 5);
    const idB = findNearestUnit(this.ctx.world, armyB, wx, wy, 5);

    if (idA < 0 && idB < 0) return false;

    // Pick whichever is closer
    let bestArmy = armyA;
    let bestId = idA;

    if (idA >= 0 && idB >= 0) {
      const dA = this.ctx.world.get('unit', idA);
      const dB = this.ctx.world.get('unit', idB);
      const distA = Math.hypot(dA[0] - wx, dA[1] - wy);
      const distB = Math.hypot(dB[0] - wx, dB[1] - wy);
      if (distB < distA) {
        bestArmy = armyB;
        bestId = idB;
      }
    } else if (idB >= 0) {
      bestArmy = armyB;
      bestId = idB;
    }

    removeUnit(this.ctx.world, bestArmy, bestId);
    this.updateComposition();
    this.ctx.onArmyChanged();
    return true;
  }

  updateComposition(): void {
    const armyA = this.ctx.getArmyA();
    const armyB = this.ctx.getArmyB();

    const countsA = countUnitsByType(this.ctx.world, armyA);
    const countsB = countUnitsByType(this.ctx.world, armyB);

    this.els.compositionA.textContent =
      `Infantry: ${countsA[UnitType.Infantry]}, Archer: ${countsA[UnitType.Archer]}, Cavalry: ${countsA[UnitType.Cavalry]}, Artillery: ${countsA[UnitType.Artillery]}`;
    this.els.compositionB.textContent =
      `Infantry: ${countsB[UnitType.Infantry]}, Archer: ${countsB[UnitType.Archer]}, Cavalry: ${countsB[UnitType.Cavalry]}, Artillery: ${countsB[UnitType.Artillery]}`;

    this.els.unitCountA.textContent = `${armyA.unitIds.length} units`;
    this.els.unitCountB.textContent = `${armyB.unitIds.length} units`;
  }

  private wireUI(): void {
    // Place mode toggle
    this.els.placeModeBtn.addEventListener('click', () => {
      this.placeModeActive = !this.placeModeActive;
      this.els.placeModeBtn.classList.toggle('active', this.placeModeActive);
      if (!this.placeModeActive) this.clearGhost();
    });

    // Army size slider
    this.els.armySizeSlider.addEventListener('input', () => {
      this.els.armySizeLabel.textContent = this.els.armySizeSlider.value;
    });

    // Clear army buttons
    this.els.clearArmyA.addEventListener('click', () => {
      clearArmy(this.ctx.world, this.ctx.getArmyA());
      this.updateComposition();
      this.ctx.onArmyChanged();
    });

    this.els.clearArmyB.addEventListener('click', () => {
      clearArmy(this.ctx.world, this.ctx.getArmyB());
      this.updateComposition();
      this.ctx.onArmyChanged();
    });

    // Preset buttons
    this.els.presetStandard.addEventListener('click', () => this.applyPreset('standard'));
    this.els.presetCavalryRush.addEventListener('click', () => this.applyPreset('cavalry-rush'));
    this.els.presetArcherLine.addEventListener('click', () => this.applyPreset('archer-line'));
    this.els.presetArtilleryBattery.addEventListener('click', () => this.applyPreset('artillery-battery'));
  }

  private applyPreset(name: string): void {
    const world = this.ctx.world;
    const armyA = this.ctx.getArmyA();
    const armyB = this.ctx.getArmyB();
    const size = parseInt(this.els.armySizeSlider.value);

    // Clear both armies
    clearArmy(world, armyA);
    clearArmy(world, armyB);

    switch (name) {
      case 'standard':
        this.spawnStandard(world, armyA, 30, size);
        this.spawnStandard(world, armyB, 170, size);
        break;
      case 'cavalry-rush':
        this.spawnCavalryRush(world, armyA, 30, size);
        this.spawnCavalryRush(world, armyB, 170, size);
        break;
      case 'archer-line':
        this.spawnArcherLine(world, armyA, 30, size);
        this.spawnArcherLine(world, armyB, 170, size);
        break;
      case 'artillery-battery':
        this.spawnArtilleryBattery(world, armyA, 30, size);
        this.spawnArtilleryBattery(world, armyB, 170, size);
        break;
    }

    this.updateComposition();
    this.ctx.onArmyChanged();
  }

  // Standard: balanced composition (Infantry ~57%, Archer ~28%, Cavalry ~12%, Artillery ~3%)
  private spawnStandard(world: World, army: Army, baseX: number, totalSize: number): void {
    const inf = Math.round(totalSize * 0.57);
    const arc = Math.round(totalSize * 0.28);
    const cav = Math.round(totalSize * 0.12);
    const art = Math.max(1, totalSize - inf - arc - cav);

    this.spawnGrid(world, army, UnitType.Infantry, baseX, 100, inf);
    this.spawnGrid(world, army, UnitType.Archer, baseX - 10, 100, arc);
    this.spawnGrid(world, army, UnitType.Cavalry, baseX - 15, 70, cav);
    this.spawnGrid(world, army, UnitType.Artillery, baseX - 20, 100, art);
  }

  // Cavalry Rush: mostly cavalry + some infantry shield
  private spawnCavalryRush(world: World, army: Army, baseX: number, totalSize: number): void {
    const cav = Math.round(totalSize * 0.65);
    const inf = totalSize - cav;

    this.spawnGrid(world, army, UnitType.Infantry, baseX, 100, inf);
    this.spawnGrid(world, army, UnitType.Cavalry, baseX - 10, 100, cav);
  }

  // Archer Line: heavy archers behind infantry wall
  private spawnArcherLine(world: World, army: Army, baseX: number, totalSize: number): void {
    const arc = Math.round(totalSize * 0.60);
    const inf = totalSize - arc;

    this.spawnGrid(world, army, UnitType.Infantry, baseX, 100, inf);
    this.spawnGrid(world, army, UnitType.Archer, baseX - 15, 100, arc);
  }

  // Artillery Battery: lots of artillery with infantry guards
  private spawnArtilleryBattery(world: World, army: Army, baseX: number, totalSize: number): void {
    const art = Math.round(totalSize * 0.45);
    const inf = totalSize - art;

    this.spawnGrid(world, army, UnitType.Infantry, baseX, 100, inf);
    this.spawnGrid(world, army, UnitType.Artillery, baseX - 15, 100, art);
  }

  /** Spawn n units in a grid formation near (cx, cy) */
  private spawnGrid(world: World, army: Army, type: UnitType, cx: number, cy: number, count: number): void {
    if (count <= 0) return;
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
    const rows = Math.ceil(count / cols);
    spawnFormation(world, army, type, cx, cy, rows, cols, 2.0);
    // spawnFormation creates rows*cols units; trim extras
    const excess = rows * cols - count;
    for (let i = 0; i < excess; i++) {
      const id = army.unitIds[army.unitIds.length - 1];
      removeUnit(world, army, id);
    }
  }
}

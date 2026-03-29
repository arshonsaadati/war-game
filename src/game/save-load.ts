/**
 * Save/Load system for army configurations and battle setups.
 * Serializes world state (units, armies, battlefield terrain) to JSON
 * and supports localStorage slots and file import/export.
 */

import { World } from '../engine/ecs';
import {
  UNIT_STRIDE,
  UnitType,
  Army,
  createArmy,
  spawnUnit,
} from './army';
import { Battlefield, BattlefieldConfig } from './battlefield';

// --- Data types ---

export interface SavedUnit {
  posX: number;
  posY: number;
  health: number;
  maxHealth: number;
  attack: number;
  defense: number;
  morale: number;
  unitType: UnitType;
  armyId: number;
}

export interface SavedArmy {
  id: number;
  name: string;
  color: [number, number, number];
}

export interface SavedBattlefield {
  width: number;
  height: number;
  cellSize: number;
  terrainGrid: number[];
}

export interface GameState {
  version: number;
  timestamp: number;
  armies: SavedArmy[];
  units: SavedUnit[];
  battlefield: SavedBattlefield;
}

export interface SaveSlotInfo {
  name: string;
  timestamp: number;
  armyCount: number;
  unitCount: number;
}

const SAVE_PREFIX = 'wargame_save_';
const SAVE_VERSION = 1;

// --- Serialization ---

/**
 * Serialize the current game state (world, armies, battlefield) into
 * a JSON-serializable object.
 */
export function serializeGameState(
  world: World,
  armies: Army[],
  battlefield: Battlefield
): GameState {
  const savedArmies: SavedArmy[] = armies.map((a) => ({
    id: a.id,
    name: a.name,
    color: [...a.color] as [number, number, number],
  }));

  const units: SavedUnit[] = [];
  for (const army of armies) {
    for (const entityId of army.unitIds) {
      const armyData = world.get('army', entityId);
      // Only save alive units
      if (armyData[1] <= 0) continue;

      const u = world.get('unit', entityId);
      units.push({
        posX: u[0],
        posY: u[1],
        health: u[2],
        maxHealth: u[3],
        attack: u[4],
        defense: u[5],
        morale: u[6],
        unitType: Math.round(u[7]) as UnitType,
        armyId: army.id,
      });
    }
  }

  return {
    version: SAVE_VERSION,
    timestamp: Date.now(),
    armies: savedArmies,
    units,
    battlefield: {
      width: battlefield.width,
      height: battlefield.height,
      cellSize: battlefield.cellSize,
      terrainGrid: battlefield.getTerrainGrid(),
    },
  };
}

/**
 * Deserialize saved data back into a live world. Creates a fresh
 * Battlefield and new Army objects with all units spawned.
 */
export function deserializeGameState(
  data: GameState,
  world: World
): { armies: Army[]; battlefield: Battlefield } {
  // Rebuild battlefield
  const bfConfig: BattlefieldConfig = {
    width: data.battlefield.width,
    height: data.battlefield.height,
    cellSize: data.battlefield.cellSize,
  };
  const battlefield = new Battlefield(bfConfig);
  battlefield.setTerrainGrid(data.battlefield.terrainGrid);

  // Rebuild armies
  const armies: Army[] = data.armies.map((sa) =>
    createArmy(world, sa.id, sa.name, sa.color)
  );

  const armyById = new Map<number, Army>();
  for (const army of armies) {
    armyById.set(army.id, army);
  }

  // Spawn units
  for (const u of data.units) {
    const army = armyById.get(u.armyId);
    if (!army) continue;

    const entity = world.createEntity();
    world.set(
      'unit',
      entity,
      u.posX,
      u.posY,
      u.health,
      u.maxHealth,
      u.attack,
      u.defense,
      u.morale,
      u.unitType
    );
    world.set('army', entity, u.armyId, 1);
    army.unitIds.push(entity);
  }

  return { armies, battlefield };
}

// --- JSON import / export ---

/** Convert a GameState to a JSON string. */
export function exportToJSON(state: GameState): string {
  return JSON.stringify(state, null, 2);
}

/** Parse a JSON string back into a GameState. */
export function importFromJSON(json: string): GameState {
  const data = JSON.parse(json) as GameState;
  if (!data || typeof data.version !== 'number' || !Array.isArray(data.armies) || !Array.isArray(data.units)) {
    throw new Error('Invalid save file format');
  }
  return data;
}

// --- localStorage slot management ---

/** Return a list of all save slots stored in localStorage. */
export function getSaveSlots(): SaveSlotInfo[] {
  const slots: SaveSlotInfo[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(SAVE_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw) as GameState;
      slots.push({
        name: key.slice(SAVE_PREFIX.length),
        timestamp: data.timestamp ?? 0,
        armyCount: data.armies?.length ?? 0,
        unitCount: data.units?.length ?? 0,
      });
    } catch {
      // skip corrupt entries
    }
  }
  slots.sort((a, b) => b.timestamp - a.timestamp);
  return slots;
}

/** Save a GameState to a named localStorage slot with a timestamp. */
export function saveToSlot(name: string, state: GameState): void {
  state.timestamp = Date.now();
  localStorage.setItem(SAVE_PREFIX + name, JSON.stringify(state));
}

/** Load a GameState from a named localStorage slot. */
export function loadFromSlot(name: string): GameState | null {
  const raw = localStorage.getItem(SAVE_PREFIX + name);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

/** Delete a save slot from localStorage. */
export function deleteSlot(name: string): void {
  localStorage.removeItem(SAVE_PREFIX + name);
}

// --- File download / upload ---

/** Trigger a browser download of the JSON save file. */
export function downloadAsFile(state: GameState, filename: string): void {
  const json = exportToJSON(state);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Open a file picker and return the parsed GameState from the selected JSON file. */
export function uploadFromFile(): Promise<GameState> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const state = importFromJSON(reader.result as string);
          resolve(state);
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });

    input.click();
  });
}

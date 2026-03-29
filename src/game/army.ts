/**
 * Army and unit definitions.
 * Units are stored as flat structs that map to GPU buffers.
 */

import { World, EntityId } from '../engine/ecs';

// GPU-aligned unit struct (matches WGSL struct layout)
// Each unit = 8 floats (32 bytes, aligned)
// [posX, posY, health, maxHealth, attack, defense, morale, unitType]
export const UNIT_STRIDE = 8;

export enum UnitType {
  Infantry = 0,
  Archer = 1,
  Cavalry = 2,
  Artillery = 3,
}

export interface UnitStats {
  health: number;
  maxHealth: number;
  attack: number;
  defense: number;
  morale: number;
}

export const UNIT_TEMPLATES: Record<UnitType, UnitStats> = {
  [UnitType.Infantry]: { health: 100, maxHealth: 100, attack: 15, defense: 12, morale: 70 },
  [UnitType.Archer]: { health: 60, maxHealth: 60, attack: 22, defense: 5, morale: 50 },
  [UnitType.Cavalry]: { health: 120, maxHealth: 120, attack: 25, defense: 8, morale: 80 },
  [UnitType.Artillery]: { health: 40, maxHealth: 40, attack: 40, defense: 3, morale: 40 },
};

export interface Army {
  id: number;
  name: string;
  color: [number, number, number]; // RGB
  unitIds: EntityId[];
}

export function createArmy(
  world: World,
  id: number,
  name: string,
  color: [number, number, number]
): Army {
  return { id, name, color, unitIds: [] };
}

export function spawnUnit(
  world: World,
  army: Army,
  type: UnitType,
  posX: number,
  posY: number
): EntityId {
  const entity = world.createEntity();
  const stats = UNIT_TEMPLATES[type];

  world.set('unit', entity,
    posX,
    posY,
    stats.health,
    stats.maxHealth,
    stats.attack,
    stats.defense,
    stats.morale,
    type
  );

  // Army membership: [armyId, isAlive]
  world.set('army', entity, army.id, 1);

  army.unitIds.push(entity);
  return entity;
}

/**
 * Spawn a formation of units in a grid pattern.
 */
export function spawnFormation(
  world: World,
  army: Army,
  type: UnitType,
  centerX: number,
  centerY: number,
  rows: number,
  cols: number,
  spacing: number = 2.0
): EntityId[] {
  const ids: EntityId[] = [];
  const startX = centerX - ((cols - 1) * spacing) / 2;
  const startY = centerY - ((rows - 1) * spacing) / 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = startX + c * spacing;
      const y = startY + r * spacing;
      ids.push(spawnUnit(world, army, type, x, y));
    }
  }

  return ids;
}

/**
 * Build the flat Float32Array for GPU upload.
 * Returns unit data for all alive units.
 */
export function buildUnitBuffer(world: World, army: Army): Float32Array {
  const store = world.getStore<Float32Array>('unit');
  const aliveUnits = army.unitIds.filter((id) => {
    const [, isAlive] = world.get('army', id);
    return isAlive > 0;
  });

  const buffer = new Float32Array(aliveUnits.length * UNIT_STRIDE);
  for (let i = 0; i < aliveUnits.length; i++) {
    const data = world.get('unit', aliveUnits[i]);
    buffer.set(data, i * UNIT_STRIDE);
  }

  return buffer;
}

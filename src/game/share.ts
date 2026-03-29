/**
 * URL-based state sharing for multiplayer.
 * Encodes game state (armies + battlefield seed) into the URL hash fragment
 * using compact binary encoding. No server needed — just share the link.
 *
 * Binary format per unit (3 bytes):
 *   byte 0: posX (0-200 clamped to uint8)
 *   byte 1: posY (0-200 clamped to uint8)
 *   byte 2: bits [7:3 unused] [2:1 unitType (2 bits)] [0 armyId (1 bit)]
 *
 * Header (4 bytes):
 *   byte 0: version (1)
 *   byte 1: battlefield seed high byte
 *   byte 2: battlefield seed low byte
 *   byte 3: unit count (max 255 — more than enough for gameplay)
 */

import { World } from '../engine/ecs';
import { Army, UnitType } from './army';
import { Battlefield } from './battlefield';

/** Magic version byte for forward compatibility. */
const FORMAT_VERSION = 1;

/** Header size in bytes. */
const HEADER_SIZE = 4;

/** Bytes per unit in the packed format. */
const BYTES_PER_UNIT = 3;

export interface SharedUnit {
  posX: number;
  posY: number;
  unitType: UnitType;
  armyId: number; // 0 or 1
}

export interface SharedState {
  seed: number;
  units: SharedUnit[];
}

/**
 * Pack a single unit into 3 bytes.
 */
function packUnit(posX: number, posY: number, unitType: UnitType, armyId: number): [number, number, number] {
  const x = Math.max(0, Math.min(255, Math.round(posX)));
  const y = Math.max(0, Math.min(255, Math.round(posY)));
  const meta = ((unitType & 0x03) << 1) | (armyId & 0x01);
  return [x, y, meta];
}

/**
 * Unpack 3 bytes back into a unit descriptor.
 */
function unpackUnit(b0: number, b1: number, b2: number): SharedUnit {
  return {
    posX: b0,
    posY: b1,
    unitType: ((b2 >> 1) & 0x03) as UnitType,
    armyId: b2 & 0x01,
  };
}

/**
 * Encode the current game state into a compact binary buffer, then base64url it.
 */
export function encodeState(world: World, armies: Army[], _battlefield: Battlefield, seed: number = 42): string {
  // Collect all alive units from both armies
  const allUnits: { posX: number; posY: number; unitType: UnitType; armyId: number }[] = [];

  for (const army of armies) {
    for (const id of army.unitIds) {
      const armyData = world.get('army', id);
      if (armyData[1] <= 0) continue; // skip dead units
      const unitData = world.get('unit', id);
      allUnits.push({
        posX: unitData[0],
        posY: unitData[1],
        unitType: Math.round(unitData[7]) as UnitType,
        armyId: army.id,
      });
    }
  }

  const unitCount = Math.min(allUnits.length, 255);
  const bufferSize = HEADER_SIZE + unitCount * BYTES_PER_UNIT;
  const buffer = new Uint8Array(bufferSize);

  // Header
  buffer[0] = FORMAT_VERSION;
  buffer[1] = (seed >> 8) & 0xFF;
  buffer[2] = seed & 0xFF;
  buffer[3] = unitCount;

  // Units
  for (let i = 0; i < unitCount; i++) {
    const u = allUnits[i];
    const [b0, b1, b2] = packUnit(u.posX, u.posY, u.unitType, u.armyId);
    const offset = HEADER_SIZE + i * BYTES_PER_UNIT;
    buffer[offset] = b0;
    buffer[offset + 1] = b1;
    buffer[offset + 2] = b2;
  }

  return uint8ToBase64URL(buffer);
}

/**
 * Decode a base64url string back into a SharedState.
 * Returns null if the data is invalid.
 */
export function decodeState(encoded: string): SharedState | null {
  try {
    const buffer = base64URLToUint8(encoded);
    if (buffer.length < HEADER_SIZE) return null;

    const version = buffer[0];
    if (version !== FORMAT_VERSION) return null;

    const seed = (buffer[1] << 8) | buffer[2];
    const unitCount = buffer[3];

    if (buffer.length < HEADER_SIZE + unitCount * BYTES_PER_UNIT) return null;

    const units: SharedUnit[] = [];
    for (let i = 0; i < unitCount; i++) {
      const offset = HEADER_SIZE + i * BYTES_PER_UNIT;
      units.push(unpackUnit(buffer[offset], buffer[offset + 1], buffer[offset + 2]));
    }

    return { seed, units };
  } catch {
    return null;
  }
}

/**
 * Encode game state and return a full URL with the state in the hash.
 */
export function encodeStateToURL(
  world: World,
  armies: Army[],
  battlefield: Battlefield,
  seed?: number
): string {
  const encoded = encodeState(world, armies, battlefield, seed);
  const base = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}`
    : 'https://example.com/';
  return `${base}#s=${encoded}`;
}

/**
 * Decode game state from a URL string.
 * Returns the SharedState or null if the URL has no valid state.
 */
export function decodeStateFromURL(url: string): SharedState | null {
  try {
    const hashIndex = url.indexOf('#');
    if (hashIndex < 0) return null;
    const hash = url.slice(hashIndex + 1);
    const params = new URLSearchParams(hash);
    const stateStr = params.get('s');
    if (!stateStr) return null;
    return decodeState(stateStr);
  } catch {
    return null;
  }
}

/**
 * Check whether the current page URL contains a shared game state.
 */
export function hasSharedState(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash;
  return hash.includes('s=');
}

/**
 * Convenience: get a ready-to-share URL string.
 */
export function getShareURL(
  world: World,
  armies: Army[],
  battlefield: Battlefield,
  seed?: number
): string {
  return encodeStateToURL(world, armies, battlefield, seed);
}

// --- Base64URL helpers (no padding, URL-safe) ---

function uint8ToBase64URL(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa may not be available in Node test environment
  const b64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  // Convert to URL-safe: + → -, / → _, strip padding =
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64URLToUint8(str: string): Uint8Array {
  // Restore standard base64: - → +, _ → /
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding
  while (b64.length % 4 !== 0) b64 += '=';

  let binary: string;
  if (typeof atob === 'function') {
    binary = atob(b64);
  } else {
    binary = Buffer.from(b64, 'base64').toString('binary');
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

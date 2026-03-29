/**
 * Battlefield terrain and map configuration.
 * Terrain affects combat modifiers in the Monte Carlo simulation.
 */

export enum TerrainType {
  Plains = 0,
  Forest = 1,
  Hills = 2,
  Water = 3,
  Mountains = 4,
}

// Terrain combat modifiers: [attackMod, defenseMod, moraleMod, movementCost]
export const TERRAIN_MODIFIERS: Record<TerrainType, [number, number, number, number]> = {
  [TerrainType.Plains]:    [1.0, 1.0, 1.0, 1.0],
  [TerrainType.Forest]:    [0.8, 1.4, 1.0, 1.5],
  [TerrainType.Hills]:     [0.9, 1.3, 1.1, 1.8],
  [TerrainType.Water]:     [0.5, 0.5, 0.7, 3.0],
  [TerrainType.Mountains]: [0.7, 1.6, 1.2, 2.5],
};

export interface BattlefieldConfig {
  width: number;
  height: number;
  cellSize: number; // world units per cell
}

export class Battlefield {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  private terrain: Uint32Array;

  constructor(config: BattlefieldConfig) {
    this.width = config.width;
    this.height = config.height;
    this.cellSize = config.cellSize;
    this.cols = Math.ceil(config.width / config.cellSize);
    this.rows = Math.ceil(config.height / config.cellSize);
    this.terrain = new Uint32Array(this.cols * this.rows);
    // Default to plains
    this.terrain.fill(TerrainType.Plains);
  }

  setTerrain(col: number, row: number, type: TerrainType): void {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      this.terrain[row * this.cols + col] = type;
    }
  }

  getTerrain(col: number, row: number): TerrainType {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
      return TerrainType.Plains;
    }
    return this.terrain[row * this.cols + col] as TerrainType;
  }

  getTerrainAtWorldPos(x: number, y: number): TerrainType {
    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);
    return this.getTerrain(col, row);
  }

  /**
   * Get terrain modifiers at a world position.
   */
  getModifiers(x: number, y: number): [number, number, number, number] {
    const type = this.getTerrainAtWorldPos(x, y);
    return TERRAIN_MODIFIERS[type];
  }

  /**
   * Build flat buffer for GPU upload.
   * Each cell = 4 floats: [terrainType, attackMod, defenseMod, moraleMod]
   */
  buildTerrainBuffer(): Float32Array {
    const buffer = new Float32Array(this.cols * this.rows * 4);
    for (let i = 0; i < this.terrain.length; i++) {
      const type = this.terrain[i] as TerrainType;
      const mods = TERRAIN_MODIFIERS[type];
      buffer[i * 4 + 0] = type;
      buffer[i * 4 + 1] = mods[0]; // attackMod
      buffer[i * 4 + 2] = mods[1]; // defenseMod
      buffer[i * 4 + 3] = mods[2]; // moraleMod
    }
    return buffer;
  }

  /**
   * Generate random terrain with some coherence.
   */
  generateRandom(seed: number = 42): void {
    // Simple pseudo-random with spatial coherence
    let state = seed;
    const rand = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const v = rand();
        let type: TerrainType;
        if (v < 0.5) type = TerrainType.Plains;
        else if (v < 0.7) type = TerrainType.Forest;
        else if (v < 0.85) type = TerrainType.Hills;
        else if (v < 0.92) type = TerrainType.Mountains;
        else type = TerrainType.Water;

        this.setTerrain(c, r, type);
      }
    }
  }
}

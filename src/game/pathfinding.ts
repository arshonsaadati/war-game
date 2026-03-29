/**
 * A* pathfinding on the battlefield grid.
 * Movement cost is derived from terrain type modifiers.
 */

import { Battlefield, TERRAIN_MODIFIERS, TerrainType } from './battlefield';

interface PathNode {
  col: number;
  row: number;
  g: number;   // cost from start
  h: number;   // heuristic to end
  f: number;   // g + h
  parent: PathNode | null;
}

/**
 * Find a path from (startCol, startRow) to (endCol, endRow) on the battlefield grid.
 * Returns an array of [col, row] pairs from start to end (inclusive), or an empty
 * array if no path exists.
 *
 * Movement cost per cell is the terrain's movementCost modifier (index 3 of TERRAIN_MODIFIERS).
 * Water tiles (TerrainType.Water) are impassable.
 */
export function findPath(
  battlefield: Battlefield,
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number
): [number, number][] {
  // Clamp to grid bounds
  startCol = Math.max(0, Math.min(startCol, battlefield.cols - 1));
  startRow = Math.max(0, Math.min(startRow, battlefield.rows - 1));
  endCol = Math.max(0, Math.min(endCol, battlefield.cols - 1));
  endRow = Math.max(0, Math.min(endRow, battlefield.rows - 1));

  // Trivial case
  if (startCol === endCol && startRow === endRow) {
    return [[startCol, startRow]];
  }

  // If the destination is impassable, return empty
  if (battlefield.getTerrain(endCol, endRow) === TerrainType.Water) {
    return [];
  }

  const key = (col: number, row: number) => row * battlefield.cols + col;

  const openSet: PathNode[] = [];
  const closedSet = new Set<number>();
  const gScores = new Map<number, number>();

  const heuristic = (col: number, row: number) => {
    // Octile distance heuristic for 4-directional movement reduces to Manhattan
    return Math.abs(col - endCol) + Math.abs(row - endRow);
  };

  const startNode: PathNode = {
    col: startCol,
    row: startRow,
    g: 0,
    h: heuristic(startCol, startRow),
    f: heuristic(startCol, startRow),
    parent: null,
  };

  openSet.push(startNode);
  gScores.set(key(startCol, startRow), 0);

  // 4-directional neighbors (up, down, left, right)
  const directions: [number, number][] = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
  ];

  while (openSet.length > 0) {
    // Find node with lowest f score
    let bestIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].f < openSet[bestIdx].f) {
        bestIdx = i;
      }
    }

    const current = openSet[bestIdx];
    openSet.splice(bestIdx, 1);

    // Reached the goal
    if (current.col === endCol && current.row === endRow) {
      return reconstructPath(current);
    }

    const currentKey = key(current.col, current.row);
    if (closedSet.has(currentKey)) continue;
    closedSet.add(currentKey);

    for (const [dc, dr] of directions) {
      const nc = current.col + dc;
      const nr = current.row + dr;

      // Bounds check
      if (nc < 0 || nc >= battlefield.cols || nr < 0 || nr >= battlefield.rows) {
        continue;
      }

      const neighborKey = key(nc, nr);
      if (closedSet.has(neighborKey)) continue;

      // Water is impassable
      const terrain = battlefield.getTerrain(nc, nr);
      if (terrain === TerrainType.Water) continue;

      const movementCost = TERRAIN_MODIFIERS[terrain][3]; // index 3 = movementCost
      const tentativeG = current.g + movementCost;

      const existingG = gScores.get(neighborKey);
      if (existingG !== undefined && tentativeG >= existingG) continue;

      gScores.set(neighborKey, tentativeG);

      const h = heuristic(nc, nr);
      const neighbor: PathNode = {
        col: nc,
        row: nr,
        g: tentativeG,
        h,
        f: tentativeG + h,
        parent: current,
      };

      openSet.push(neighbor);
    }
  }

  // No path found
  return [];
}

function reconstructPath(node: PathNode): [number, number][] {
  const path: [number, number][] = [];
  let current: PathNode | null = node;
  while (current) {
    path.push([current.col, current.row]);
    current = current.parent;
  }
  path.reverse();
  return path;
}

/**
 * Convert world coordinates to grid coordinates.
 */
export function worldToGrid(
  battlefield: Battlefield,
  worldX: number,
  worldY: number
): [number, number] {
  const col = Math.floor(worldX / battlefield.cellSize);
  const row = Math.floor(worldY / battlefield.cellSize);
  return [
    Math.max(0, Math.min(col, battlefield.cols - 1)),
    Math.max(0, Math.min(row, battlefield.rows - 1)),
  ];
}

/**
 * Convert grid coordinates to world coordinates (center of cell).
 */
export function gridToWorld(
  battlefield: Battlefield,
  col: number,
  row: number
): [number, number] {
  return [
    (col + 0.5) * battlefield.cellSize,
    (row + 0.5) * battlefield.cellSize,
  ];
}

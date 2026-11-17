// Grid, terrain, pathfinding, line of sight.
import { unitDef } from '../data/units.js';

export const BOARD_W = 10;
export const BOARD_H = 8;

export const TERRAIN = {
  OPEN: 0,
  ROCK: 1,
  WEB: 2,
  MOSS: 3,
  NEST: 4,
};

export const TERRAIN_NAME = ['Open', 'Rock Spire', 'Web', 'Moss Cover', 'Nest Mound'];

export const idx = (x, y) => y * BOARD_W + x;
export const xOf = (i) => i % BOARD_W;
export const yOf = (i) => (i / BOARD_W) | 0;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < BOARD_W && y < BOARD_H;

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
export const DIRS8 = DIRS;

export const chebyshev = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
export const manhattan = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);

export function tileAt(tiles, x, y) {
  if (!inBounds(x, y)) return TERRAIN.ROCK;
  return tiles[idx(x, y)];
}

// Movement cost to ENTER a tile, given a unit's traits.
export function stepCost(terrain, traits = {}) {
  if (traits.fly) return 1;             // flyers hover over everything
  if (terrain === TERRAIN.ROCK) return traits.climber ? 2 : Infinity;
  if (terrain === TERRAIN.WEB) return traits.climber ? 1 : 2;
  return 1;
}

export function effectiveMove(unit) {
  const def = unitDef(unit.type);
  if (!def) return 0;
  const base = def.move;
  if (unit.statuses && unit.statuses.entangled > 0) return Math.floor(base / 2);
  return base;
}

// Dijkstra over an 8-connected grid. Costs are 1 or 2, so a binary
// heap is overkill but keeps the code simple and fast enough (80 tiles).
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node) {
    const a = this.a;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= a[i].cost) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].cost < a[m].cost) m = l;
        if (r < a.length && a[r].cost < a[m].cost) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Flood-fill a unit's movement envelope.
 * Returns { cost: Float32Array, prev: Int32Array, budget: number }.
 * cost[i] is Infinity for unreachable tiles.
 */
export function computeReach(state, unit) {
  const N = BOARD_W * BOARD_H;
  const cost = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const def = unitDef(unit.type) || {};
  const traits = { fly: def.fly, climber: def.climber };
  const budget = effectiveMove(unit);

  const blocked = new Uint8Array(N);
  for (const u of state.units) {
    if (u.id === unit.id || u.hp <= 0) continue;
    blocked[idx(u.x, u.y)] = 1;
  }

  const start = idx(unit.x, unit.y);
  cost[start] = 0;
  const heap = new MinHeap();
  heap.push({ i: start, cost: 0 });

  while (heap.size) {
    const cur = heap.pop();
    if (cur.cost > cost[cur.i] + 1e-9) continue;
    const cx = xOf(cur.i), cy = yOf(cur.i);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (blocked[ni]) continue;
      const step = stepCost(state.tiles[ni], traits);
      if (!Number.isFinite(step)) continue;
      const nc = cur.cost + step;
      if (nc > budget + 1e-9) continue;
      if (nc + 1e-9 < cost[ni]) {
        cost[ni] = nc;
        prev[ni] = cur.i;
        heap.push({ i: ni, cost: nc });
      }
    }
  }
  return { cost, prev, budget };
}

/** Reconstruct a tile-index path from computeReach output. */
export function pathFrom(prev, fromIdx, toIdx) {
  const path = [];
  let cur = toIdx;
  let guard = 0;
  while (cur !== -1 && guard++ < 200) {
    path.push(cur);
    if (cur === fromIdx) break;
    cur = prev[cur];
  }
  return path.reverse();
}

/** All tiles a unit may legally stop on. */
export function reachableTiles(state, unit) {
  const { cost, prev, budget } = computeReach(state, unit);
  const out = [];
  const start = idx(unit.x, unit.y);
  for (let i = 0; i < cost.length; i++) {
    if (i === start) continue;
    if (!Number.isFinite(cost[i]) || cost[i] > budget + 1e-9) continue;
    const x = xOf(i), y = yOf(i);
    const occupant = state.units.some((u) => u.hp > 0 && u.x === x && u.y === y);
    if (occupant) continue;
    out.push({ i, x, y, cost: cost[i], path: pathFrom(prev, start, i) });
  }
  return out;
}

/** Sample every tile the segment a->b passes through (excluding endpoints). */
export function tilesOnLine(ax, ay, bx, by) {
  const out = [];
  const span = chebyshev(ax, ay, bx, by);
  if (span === 0) return out;
  const steps = Math.max(2, span * 4);
  const seen = new Set();
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const x = Math.round(ax + (bx - ax) * t);
    const y = Math.round(ay + (by - ay) * t);
    if (x === ax && y === ay) continue;
    if (x === bx && y === by) continue;
    const k = `${x},${y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([x, y]);
  }
  return out;
}

export function hasLineOfSight(tiles, ax, ay, bx, by) {
  for (const [x, y] of tilesOnLine(ax, ay, bx, by)) {
    if (tileAt(tiles, x, y) === TERRAIN.ROCK) return false;
  }
  return true;
}

export function bfsConnectivity(tiles, from) {
  const N = BOARD_W * BOARD_H;
  const seen = new Uint8Array(N);
  const q = [idx(from.x, from.y)];
  seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    const x = xOf(i), y = yOf(i);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (seen[ni]) continue;
      if (tiles[ni] === TERRAIN.ROCK) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  return seen;
}

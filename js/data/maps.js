// Seeded, rotationally-symmetric map generation.
// Everything placed in the northern band is mirrored 180 degrees,
// so neither side ever starts with a terrain advantage.
import { BOARD_W, BOARD_H, TERRAIN, idx, inBounds, bfsConnectivity } from '../core/board.js';
import { makeRng } from '../core/rng.js';

const NAMES = [
  'The Hollow',
  'Amber Crossroads',
  'Rotwood Basin',
  'Chitin Steppe',
  'Drowned Gallery',
  'Thornfield',
  'The Long Mud',
  'Hollow Reed',
];

const mirrorOf = (x, y) => ({ x: BOARD_W - 1 - x, y: BOARD_H - 1 - y });

export function generateMap(seed = 1) {
  const rnd = makeRng((seed >>> 0) ^ 0x9e3779b9);
  const tiles = new Uint8Array(BOARD_W * BOARD_H); // all OPEN

  const hives = [
    { x: (BOARD_W >> 1) - 1, y: BOARD_H - 1 }, // south (side 0)
    { x: BOARD_W >> 1, y: 0 },                 // north (side 1)
  ];

  const protectedSet = new Set();
  const protect = (x, y) => protectedSet.add(idx(x, y));
  for (const h of hives) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (inBounds(h.x + dx, h.y + dy)) protect(h.x + dx, h.y + dy);
      }
    }
    // Keep the straight approach to each hive clear of spires.
    for (let y = 0; y < BOARD_H; y++) protect(h.x, y);
  }

  const canPlace = (x, y) =>
    inBounds(x, y) && y >= 2 && y <= 5 && !protectedSet.has(idx(x, y)) && tiles[idx(x, y)] === TERRAIN.OPEN;

  const place = (x, y, t) => {
    if (!canPlace(x, y)) return false;
    tiles[idx(x, y)] = t;
    const m = mirrorOf(x, y);
    if (canPlace(m.x, m.y)) tiles[idx(m.x, m.y)] = t;
    return true;
  };

  const scatter = (terrain, count, clusterMax) => {
    let guard = 0;
    let placed = 0;
    while (placed < count && guard++ < 200) {
      const x = rnd.int(BOARD_W);
      const y = 2 + rnd.int(4);
      if (!place(x, y, terrain)) continue;
      placed++;
      const extra = rnd.int(clusterMax);
      let cx = x, cy = y;
      for (let k = 0; k < extra; k++) {
        const d = rnd.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
        cx += d[0]; cy += d[1];
        place(cx, cy, terrain);
      }
    }
  };

  scatter(TERRAIN.ROCK, 2 + rnd.int(2), 2);
  scatter(TERRAIN.WEB, 1 + rnd.int(2), 3);
  scatter(TERRAIN.MOSS, 2, 2);

  // Nest mounds sit just in front of each deployment zone.
  place(2 + rnd.int(3), 2, TERRAIN.NEST);
  place(5 + rnd.int(3), 2, TERRAIN.NEST);

  // Guarantee the two hives can reach each other.
  let seen = bfsConnectivity(tiles, hives[0]);
  if (!seen[idx(hives[1].x, hives[1].y)]) {
    for (let x = 0; x < BOARD_W; x++) {
      for (const y of [3, 4]) {
        if (tiles[idx(x, y)] === TERRAIN.ROCK) tiles[idx(x, y)] = TERRAIN.OPEN;
      }
    }
  }

  return {
    tiles,
    hives,
    name: NAMES[Math.abs(seed) % NAMES.length],
    seed,
  };
}

export function terrainCounts(tiles) {
  const counts = [0, 0, 0, 0, 0];
  for (const t of tiles) counts[t]++;
  return counts;
}

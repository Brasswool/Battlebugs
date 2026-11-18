// Game state: creation, deployment, turn flow, victory.
import { makeRng } from './rng.js';
import { UNITS, UNIT_ORDER, HIVE } from '../data/units.js';
import { generateMap } from '../data/maps.js';
import { BOARD_W, BOARD_H, idx, inBounds, TERRAIN, chebyshev } from './board.js';

export const BUDGET = 120;
export const TURN_CAP = 30;              // rounds before a value decision
export const DEPLOY_ROWS = [[6, 7], [0, 1]];

export const VICTORY = {
  HIVE: 'hive',
  ELIMINATION: 'elimination',
};

export const VICTORY_LABEL = {
  hive: 'Hive assault',
  elimination: 'Elimination',
};

export const PLAYER_LABEL = ['Player 1', 'Player 2'];

// Lower = deployed closer to the enemy.
const FRONT_RANK = {
  rhino: 0, beetle: 0, termite: 1, ant: 2, mantis: 3,
  wasp: 4, dragonfly: 4, spider: 5, bombardier: 6, bee: 7,
};

export const FACTIONS = [
  { name: 'Hollow', color: '#3ddbc8', accent: '#0d6b62' },
  { name: 'Ember', color: '#ff8a4c', accent: '#8a3a1a' },
];

export function factionName(side) {
  return FACTIONS[side] ? FACTIONS[side].name : '—';
}

export function armyCost(list) {
  return list.reduce((sum, t) => sum + (UNITS[t] ? UNITS[t].cost : 0), 0);
}

export function validateArmy(list, budget = BUDGET) {
  if (!list.length) return { ok: false, error: 'Your army is empty.' };
  for (const t of list) if (!UNITS[t]) return { ok: false, error: `Unknown unit "${t}".` };
  const cost = armyCost(list);
  if (cost > budget) return { ok: false, error: `Over budget by ${cost - budget}.` };
  if (list.length > 10) return { ok: false, error: 'Max 10 units.' };
  return { ok: true, cost };
}

export function defaultArmy(side = 0) {
  if (side === 0) {
    // 114 pts: every ability type is represented in the default army.
    return ['ant', 'termite', 'rhino', 'mantis', 'wasp', 'spider', 'bee'];
  }
  return ['ant', 'termite', 'rhino', 'spider', 'bee', 'wasp', 'bombardier']; // 112
}

function makeUnit(state, side, type, x, y) {
  const def = UNITS[type];
  const u = {
    id: `u${state.nextId++}`,
    type,
    side,
    x,
    y,
    hp: def.hp,
    maxHp: def.hp,
    fromX: x,
    fromY: y,
    moved: false,
    acted: false,
    fresh: true,   // has not completed an activation since the last round refresh
    statuses: { entangled: 0, frenzy: 0 },
    facing: side === 0 ? -1 : 1,
    isHive: false,
  };
  state.units.push(u);
  return u;
}

function makeHive(state, side, x, y) {
  const h = {
    id: `hive${side}`,
    type: 'hive',
    side,
    x,
    y,
    hp: HIVE.hp,
    maxHp: HIVE.hp,
    fromX: x,
    fromY: y,
    moved: true,
    acted: true,
    statuses: { entangled: 0, frenzy: 0 },
    facing: side === 0 ? -1 : 1,
    isHive: true,
  };
  state.units.push(h);
  state.hives.push(h);
  return h;
}

/** Rows a side may deploy into, front row first. */
export function deployRows(side) {
  return DEPLOY_ROWS[side] || [];
}

/** Why a unit cannot be placed at (x, y), or null if the tile is legal. */
export function placementError(state, side, type, x, y) {
  if (!UNITS[type]) return `Unknown unit "${type}".`;
  if (!inBounds(x, y)) return 'That tile is off the battlefield.';
  if (!deployRows(side).includes(y)) return 'Place units in your own deployment rows.';
  if (state.tiles[idx(x, y)] === TERRAIN.ROCK) return 'A rock spire blocks that tile.';
  if (state.units.some((u) => u.hp > 0 && u.x === x && u.y === y)) return 'That tile is already occupied.';
  return null;
}

/**
 * Auto-deploy a list, returning [{ type, x, y }] without mutating the state.
 * Shared by createGame, the AI's army setup, and the "Auto-place" button.
 */
export function autoPlacements(state, side, list) {
  const hive = state.hives.find((h) => h.side === side);
  const hiveX = hive ? hive.x : 4;
  const front = side === 0 ? 6 : 1;
  const back = side === 0 ? 7 : 0;

  const freeRow = (y) => {
    const out = [];
    for (let x = 0; x < BOARD_W; x++) {
      if (state.tiles[idx(x, y)] === TERRAIN.ROCK) continue;
      if (state.units.some((u) => u.hp > 0 && u.x === x && u.y === y)) continue;
      out.push({ x, y });
    }
    return out;
  };

  const all = [...freeRow(front), ...freeRow(back)];
  all.sort((a, b) => Math.abs(a.x - hiveX) - Math.abs(b.x - hiveX));

  // Spread the army out: first pass keeps a one-tile gap between units,
  // second pass fills in if the zone is small.
  const picked = [];
  for (const t of all) {
    if (picked.length >= list.length) break;
    if (picked.some((p) => chebyshev(p.x, p.y, t.x, t.y) <= 1)) continue;
    picked.push(t);
  }
  for (const t of all) {
    if (picked.length >= list.length) break;
    if (!picked.includes(t)) picked.push(t);
  }
  if (picked.length < list.length) {
    throw new Error('Deployment zone is too small for this army.');
  }

  // Heavies take the forward tiles, support stays home.
  const ordered = list.slice().sort((a, b) => (FRONT_RANK[a] ?? 5) - (FRONT_RANK[b] ?? 5));
  picked.sort((a, b) =>
    (side === 0 ? a.y - b.y : b.y - a.y) || Math.abs(a.x - hiveX) - Math.abs(b.x - hiveX)
  );

  return ordered.map((type, i) => ({ type, x: picked[i].x, y: picked[i].y }));
}

function deployArmy(state, side, list) {
  for (const p of autoPlacements(state, side, list)) {
    makeUnit(state, side, p.type, p.x, p.y);
  }
}

function placeArmy(state, side, placements) {
  for (const p of placements) {
    const err = placementError(state, side, p.type, p.x, p.y);
    if (err) throw new Error(`Illegal deployment for ${FACTIONS[side].name}: ${err}`);
    makeUnit(state, side, p.type, p.x, p.y);
  }
}

/** Add a unit to a live or preview state (used by the deployment screen). */
export function spawnUnit(state, side, type, x, y) {
  const err = placementError(state, side, type, x, y);
  if (err) return { ok: false, error: err };
  return { ok: true, unit: makeUnit(state, side, type, x, y) };
}

/** Remove a unit from a preview state (deployment take-backs). */
export function despawnUnit(state, id) {
  const i = state.units.findIndex((u) => u.id === id);
  if (i >= 0) {
    const [unit] = state.units.splice(i, 1);
    const hi = state.hives.indexOf(unit);
    if (hi >= 0) state.hives.splice(hi, 1);
    return unit;
  }
  return null;
}

/**
 * Build a legal, near-budget army for the AI.
 * Deterministic for a given rng, so replays stay reproducible.
 */
export function generateArmy(rng, budget = BUDGET) {
  const list = [];
  const cost = () => armyCost(list);
  const copies = (t) => list.filter((x) => x === t).length;
  let guard = 0;

  while (list.length < 10 && guard++ < 120) {
    const affordable = UNIT_ORDER.filter(
      (t) => cost() + UNITS[t].cost <= budget && copies(t) < 3
    );
    if (!affordable.length) break;
    // Once the army is respectable, sometimes bank the remaining points.
    if (list.length >= 6 && cost() >= budget - 8 && rng.chance(0.3)) break;
    list.push(rng.pick(affordable));
  }

  // Never hand the AI a token force — top up with the cheapest bodies.
  guard = 0;
  while (cost() < Math.min(90, budget) && list.length < 10 && guard++ < 30) {
    const cheap = UNIT_ORDER
      .filter((t) => cost() + UNITS[t].cost <= budget && copies(t) < 3)
      .sort((a, b) => UNITS[a].cost - UNITS[b].cost);
    if (!cheap.length) break;
    list.push(cheap[0]);
  }
  return list;
}

/** The AI's army for a given battle seed (stable as long as the seed is). */
export function aiArmyFor(seed, budget = BUDGET) {
  return generateArmy(makeRng((seed >>> 0) ^ 0x51ed270b), budget);
}

export function createGame({
  seed = 1,
  mode = 'human',          // 'human' | 'ai' | 'spectate'
  victory = VICTORY.HIVE,  // 'hive' | 'elimination'
  armies = null,
  placements = null,       // per-side [{ type, x, y }]; null = auto-deploy
  mapSeed = null,
  budget = BUDGET,
  shuffleDeploy = false,
} = {}) {
  const map = generateMap(mapSeed ?? seed);
  const state = {
    seed,
    mode,
    victory: victory === VICTORY.ELIMINATION ? VICTORY.ELIMINATION : VICTORY.HIVE,
    budget,
    tiles: map.tiles,
    mapName: map.name,
    units: [],
    hives: [],
    side: 0,
    round: 1,
    halfTurns: 0,
    winner: null,
    winReason: null,
    log: [],
    nextId: 1,
    rng: makeRng((seed >>> 0) ^ 0x5bd1e995),
  };

  makeHive(state, 0, map.hives[0].x, map.hives[0].y);
  makeHive(state, 1, map.hives[1].x, map.hives[1].y);

  const a0 = armies?.[0] ?? defaultArmy(0);
  const a1 = armies?.[1] ?? defaultArmy(1);
  const p0 = placements?.[0];
  const p1 = placements?.[1];
  if (p0) placeArmy(state, 0, p0);
  else deployArmy(state, 0, shuffleDeploy ? state.rng.shuffle(a0) : a0);
  if (p1) placeArmy(state, 1, p1);
  else deployArmy(state, 1, shuffleDeploy ? state.rng.shuffle(a1) : a1);

  const modeTag = state.mode === 'hotseat' ? ' · Hot seat' : '';
  note(
    state,
    `${map.name} — ${FACTIONS[0].name} vs ${FACTIONS[1].name} · ${VICTORY_LABEL[state.victory]}${modeTag}`,
    'system'
  );
  return state;
}

// ── queries ───────────────────────────────────────────────────

export function unitById(state, id) {
  return state.units.find((u) => u.id === id && u.hp > 0) || null;
}

export function unitAt(state, x, y) {
  return state.units.find((u) => u.hp > 0 && u.x === x && u.y === y) || null;
}

export function sideUnits(state, side) {
  return state.units.filter((u) => u.hp > 0 && u.side === side && !u.isHive);
}

export function allAlive(state) {
  return state.units.filter((u) => u.hp > 0);
}

export function armyValue(state, side) {
  let v = 0;
  for (const u of state.units) {
    if (u.side !== side || u.hp <= 0) continue;
    if (u.isHive) v += 30 * (u.hp / u.maxHp);
    else v += (UNITS[u.type]?.cost ?? 0) * (u.hp / u.maxHp);
  }
  return v;
}

export function note(state, text, kind = 'info') {
  state.log.push({ round: state.round, side: state.side, text, kind });
  if (state.log.length > 400) state.log.shift();
}

// ── turn flow ─────────────────────────────────────────────────

export function checkVictory(state) {
  if (state.winner !== null) return state.winner;

  if (state.victory === VICTORY.ELIMINATION) {
    const alive = [sideUnits(state, 0).length, sideUnits(state, 1).length];
    if (alive[0] === 0 || alive[1] === 0) {
      state.winReason = 'elimination';
      if (alive[0] === 0 && alive[1] === 0) {
        state.winner = -1;
        note(state, 'Both colonies are wiped out. The field is empty — draw.', 'win');
      } else {
        state.winner = alive[0] > 0 ? 0 : 1;
        note(state, `${FACTIONS[state.winner].name} has wiped out the enemy colony.`, 'win');
      }
      return state.winner;
    }
  } else {
    for (const h of state.hives) {
      if (h.hp <= 0) {
        state.winner = 1 - h.side;
        state.winReason = 'hive';
        note(state, `${FACTIONS[1 - h.side].name} has destroyed the ${FACTIONS[h.side].name} Hive.`, 'win');
        return state.winner;
      }
    }
  }

  if (state.round > TURN_CAP) {
    const a = armyValue(state, 0);
    const b = armyValue(state, 1);
    state.winner = Math.abs(a - b) < 0.01 ? -1 : a > b ? 0 : 1;
    state.winReason = 'timeout';
    note(state, `Turn limit reached. ${state.winner === -1 ? 'Draw.' : FACTIONS[state.winner].name + ' holds the field.'}`, 'win');
  }
  return state.winner;
}

/**
 * Alternating activations: a unit's statuses (web, frenzy) are tied to its own
 * activation. When a unit finishes activating (moved && acted) any statuses on
 * it lapse — but only once per round, so a unit webbed after it already
 * activated keeps the web until its next activation.
 */
export function expireSpentStatuses(state) {
  for (const u of state.units) {
    if (u.hp <= 0 || u.isHive) continue;
    if (!(u.moved && u.acted)) continue;
    if (u.fresh === false) continue;
    if (u.statuses.entangled > 0) u.statuses.entangled--;
    if (u.statuses.frenzy > 0) u.statuses.frenzy--;
    u.fresh = false;
  }
}

/**
 * End the current activation (not the whole turn!). Control passes to the
 * other side unit by unit; flags refresh only when both sides have run out.
 * Passing with a half-activated unit forfeits its remaining action.
 */
export function endTurn(state) {
  if (state.winner !== null) return { ok: false, error: 'The battle is over.' };
  const side = state.side;
  const other = 1 - side;

  // Passing ends the activation: unfinished units lose their remaining action.
  for (const u of state.units) {
    if (u.side !== side || u.hp <= 0 || u.isHive) continue;
    if (u.moved && !u.acted) u.acted = true;
  }
  expireSpentStatuses(state);

  if (unitsRemaining(state, side) === 0 && unitsRemaining(state, other) === 0) {
    // Every unit on both sides has activated — start the next round.
    for (const u of state.units) {
      if (u.hp <= 0) continue;
      u.moved = !!u.isHive;
      u.acted = !!u.isHive;
      u.fromX = u.x;
      u.fromY = u.y;
      u.fresh = true;
    }
    state.side = 0;
    state.round++;
    state.halfTurns++;
    const tag0 = state.mode === 'hotseat' ? ` · ${PLAYER_LABEL[0]}` : '';
    note(state, `— Round ${state.round} — ${FACTIONS[0].name}${tag0} to activate —`, 'turn');
    checkVictory(state);
    return { ok: true, events: [{ type: 'endTurn', side: 0, round: state.round }] };
  }

  if (unitsRemaining(state, other) > 0) {
    state.side = other;
    state.halfTurns++;
    const tag = state.mode === 'hotseat' ? ` · ${PLAYER_LABEL[other]}` : '';
    note(state, `— ${FACTIONS[other].name}${tag} to activate —`, 'turn');
    checkVictory(state);
    return { ok: true, events: [{ type: 'endTurn', side: other }] };
  }

  // The other side has nothing ready — keep activating.
  state.halfTurns++;
  note(state, `${FACTIONS[other].name} has nothing ready — ${FACTIONS[side].name} continues.`, 'turn');
  checkVictory(state);
  return { ok: true, events: [{ type: 'endTurn', side }] };
}

export function unitsRemaining(state, side) {
  return sideUnits(state, side).filter((u) => !(u.moved && u.acted)).length;
}

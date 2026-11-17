// Legal actions and their application. Every mutation of the board
// goes through here, so Stage 4's AI can reuse exactly the same rules.
import {
  chebyshev, hasLineOfSight, reachableTiles, BOARD_W, BOARD_H, inBounds, TERRAIN,
  tileAt,
} from './board.js';
import { UNITS, unitDef } from '../data/units.js';
import {
  canTarget, damageBreakdown, splashTargets, travelOf, defOf,
} from './combat.js';
import {
  unitById, unitAt, sideUnits, note, checkVictory, endTurn, expireSpentStatuses,
} from './state.js';

const isMine = (state, u) => u && u.side === state.side && !u.isHive && u.hp > 0;

export function canMove(state, u) {
  return !!u && isMine(state, u) && !u.moved && state.winner === null;
}

export function canAct(state, u) {
  return !!u && isMine(state, u) && !u.acted && state.winner === null;
}

/** Tiles this unit may move to right now. */
export function moveOptions(state, unitId) {
  const u = unitById(state, unitId);
  if (!canMove(state, u)) return [];
  return reachableTiles(state, u);
}

/** Units this unit may attack right now. */
export function attackOptions(state, unitId) {
  const u = unitById(state, unitId);
  if (!canAct(state, u)) return [];
  return state.units
    .filter((t) => t.hp > 0 && t.side !== u.side && canTarget(state, u, t).ok);
}

/**
 * Single source of truth for ability legality. Both the action generator
 * and the mutation use this, so the AI can never be offered an illegal move.
 */
export function canUseAbility(state, u, t, mode) {
  if (!u || !canAct(state, u)) return { ok: false, reason: 'Unit cannot act.' };
  if (u.statuses.entangled > 0) return { ok: false, reason: 'Webbed — abilities disabled.' };
  const def = unitDef(u.type);
  if (!def || !def.abilityRange) return { ok: false, reason: 'No active ability.' };
  if (!t || t.hp <= 0) return { ok: false, reason: 'No such target.' };
  if (chebyshev(u.x, u.y, t.x, t.y) > def.abilityRange) return { ok: false, reason: 'Out of range.' };
  if (!hasLineOfSight(state.tiles, u.x, u.y, t.x, t.y)) {
    return { ok: false, reason: 'Line of sight blocked.' };
  }
  if (def.ability === 'web') {
    if (t.side === u.side) return { ok: false, reason: 'Web only targets enemies.' };
    if (t.isHive) return { ok: false, reason: 'The Hive cannot be webbed.' };
  }
  if (def.ability === 'pollen') {
    if (t.side !== u.side || t.isHive) return { ok: false, reason: 'Pollen only targets allies.' };
    if (t.id === u.id) return { ok: false, reason: 'Cannot target self.' };
    if (mode !== 'heal' && mode !== 'frenzy') return { ok: false, reason: 'Unknown pollen mode.' };
  }
  return { ok: true };
}

/** Targets / modes available to the unit's active ability. */
export function abilityOptions(state, unitId) {
  const u = unitById(state, unitId);
  if (!canAct(state, u)) return [];
  const def = unitDef(u.type);
  if (!def || !def.abilityRange) return [];
  const out = [];

  if (def.ability === 'web') {
    for (const t of state.units) {
      if (canUseAbility(state, u, t, 'web').ok) {
        out.push({ kind: 'ability', mode: 'web', target: t.id, unit: u.id });
      }
    }
  }
  if (def.ability === 'pollen') {
    for (const t of state.units) {
      if (canUseAbility(state, u, t, 'heal').ok && t.hp < t.maxHp) {
        out.push({ kind: 'ability', mode: 'heal', target: t.id, unit: u.id });
      }
      if (canUseAbility(state, u, t, 'frenzy').ok) {
        out.push({ kind: 'ability', mode: 'frenzy', target: t.id, unit: u.id });
      }
    }
  }
  return out;
}

// ── mutation ──────────────────────────────────────────────────

export function moveUnit(state, unitId, x, y) {
  const u = unitById(state, unitId);
  if (!canMove(state, u)) return { ok: false, error: 'Unit cannot move.' };
  const options = reachableTiles(state, u);
  const dest = options.find((o) => o.x === x && o.y === y);
  if (!dest) return { ok: false, error: 'Illegal destination.' };

  u.x = x;
  u.y = y;
  u.moved = true;
  u.facing = u.side === 0 ? -1 : 1;
  note(state, `${unitDef(u.type).name} moves to ${fileOf(x)}${y + 1}.`, 'move');
  return {
    ok: true,
    events: [{ type: 'move', unit: u.id, x, y, path: dest.path, cost: dest.cost }],
  };
}

export function attackUnit(state, unitId, targetId) {
  const a = unitById(state, unitId);
  if (!canAct(state, a)) return { ok: false, error: 'Unit cannot act.' };
  const t = unitById(state, targetId);
  if (!t) return { ok: false, error: 'No such target.' };

  const check = canTarget(state, a, t);
  if (!check.ok) return { ok: false, error: check.reason };

  const bd = damageBreakdown(state, a, t, { basic: true });
  const events = [{ type: 'attack', from: a.id, to: t.id, amount: bd.amount, breakdown: bd }];

  t.hp = Math.max(0, t.hp - bd.amount);
  const aDef = defOf(a);
  const tDef = defOf(t);
  note(
    state,
    `${aDef.name} hits ${tDef.name} for ${bd.amount}` +
      (bd.steps.length ? ` (${bd.steps.map((s) => s.label).join(', ')})` : '') +
      '.',
    'attack'
  );

  // Knockback from a horn charge
  if (a.type === 'rhino' && travelOf(a) >= 2 && !t.isHive) {
    const dx = Math.sign(t.x - a.x);
    const dy = Math.sign(t.y - a.y);
    const nx = t.x + dx, ny = t.y + dy;
    if (inBounds(nx, ny) && !unitAt(state, nx, ny)) {
      const ter = tileAt(state.tiles, nx, ny);
      const canStand = tDef.fly ? true : ter !== TERRAIN.ROCK;
      if (canStand) {
        t.x = nx;
        t.y = ny;
        events.push({ type: 'knockback', unit: t.id, x: nx, y: ny });
        note(state, `${tDef.name} is knocked back.`, 'attack');
      }
    }
  }

  // Splash damage
  if (a.type === 'termite' || a.type === 'bombardier') {
    const amount = Math.max(1, Math.floor(bd.amount * 0.5));
    for (const o of splashTargets(state, a, t)) {
      o.hp = Math.max(0, o.hp - amount);
      events.push({ type: 'splash', unit: o.id, amount });
      note(state, `  splash: ${unitDef(o.type).name} takes ${amount}.`, 'attack');
    }
  }

  if (t.hp <= 0) note(state, `${tDef.name} is destroyed.`, 'death');
  a.acted = true;
  checkVictory(state);
  return { ok: true, events };
}

export function useAbility(state, unitId, { mode = 'web', targetId } = {}) {
  const u = unitById(state, unitId);
  const t = unitById(state, targetId);
  const chk = canUseAbility(state, u, t, mode);
  if (!chk.ok) return { ok: false, error: chk.reason };
  const def = unitDef(u.type);

  const events = [];

  if (def.ability === 'web') {
    t.statuses.entangled = 1;
    events.push({ type: 'web', unit: t.id });
    note(state, `${def.name} webs ${unitDef(t.type).name}.`, 'ability');
  } else if (def.ability === 'pollen') {
    if (mode === 'heal') {
      const before = t.hp;
      t.hp = Math.min(t.maxHp, t.hp + 6);
      events.push({ type: 'heal', unit: t.id, amount: t.hp - before });
      note(state, `${def.name} heals ${unitDef(t.type).name} for ${t.hp - before}.`, 'ability');
    } else if (mode === 'frenzy') {
      t.statuses.frenzy = 1;
      events.push({ type: 'frenzy', unit: t.id });
      note(state, `${def.name} grants frenzy to ${unitDef(t.type).name}.`, 'ability');
    } else {
      return { ok: false, error: 'Unknown pollen mode.' };
    }
  } else {
    return { ok: false, error: 'This unit has no active ability.' };
  }

  u.acted = true;
  return { ok: true, events };
}

export function applyAction(state, action) {
  let res;
  switch (action.kind) {
    case 'move': res = moveUnit(state, action.unit, action.x, action.y); break;
    case 'attack': res = attackUnit(state, action.unit, action.target); break;
    case 'ability': res = useAbility(state, action.unit, { mode: action.mode, targetId: action.target }); break;
    case 'end': return endTurn(state);
    default: return { ok: false, error: `Unknown action "${action.kind}".` };
  }
  // A finished activation (moved && acted) lapses any statuses on that unit.
  if (res.ok) expireSpentStatuses(state);
  return res;
}

/** Every legal action for the side to move — used by random play, tests, and simulation. */
export function allLegalActions(state) {
  const out = [{ kind: 'end' }];
  if (state.winner !== null) return out;
  for (const u of sideUnits(state, state.side)) {
    if (!u.moved) {
      for (const m of moveOptions(state, u.id)) out.push({ kind: 'move', unit: u.id, x: m.x, y: m.y });
    }
    if (!u.acted) {
      for (const t of attackOptions(state, u.id)) out.push({ kind: 'attack', unit: u.id, target: t.id });
      for (const a of abilityOptions(state, u.id)) out.push(a);
    }
  }
  return out;
}

export function fileOf(x) {
  return String.fromCharCode(97 + x);
}

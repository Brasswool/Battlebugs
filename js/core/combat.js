// Damage maths. Every modifier is explicit and logged so the UI can
// explain *why* a hit landed for 11 instead of 5.
import { UNITS, HIVE, COUNTER } from '../data/units.js';
import { TERRAIN, chebyshev, hasLineOfSight, tileAt } from './board.js';
import { VICTORY } from './state.js';

export const defOf = (u) => (u && u.type === 'hive' ? HIVE : UNITS[u ? u.type : ''] || null);

export function roleMult(attackerType, defenderType) {
  const a = defOf({ type: attackerType });
  const d = defOf({ type: defenderType });
  if (!a || !d) return 1;
  const row = COUNTER[a.role];
  if (!row) return 1;
  return row[d.role] ?? 1;
}

export function canTarget(state, attacker, target) {
  const aDef = defOf(attacker);
  const tDef = defOf(target);
  if (!aDef || !tDef) return { ok: false, reason: 'Unknown unit' };
  if (!aDef.dmg) return { ok: false, reason: 'Cannot attack' };
  if (target.hp <= 0) return { ok: false, reason: 'Already dead' };
  if (target.side === attacker.side) return { ok: false, reason: 'Friendly unit' };
  if (target.isHive && state.victory === VICTORY.ELIMINATION) {
    return { ok: false, reason: 'Hives are not objectives in an elimination battle' };
  }

  const dist = chebyshev(attacker.x, attacker.y, target.x, target.y);
  const [minR, maxR] = aDef.range;
  if (dist < minR) return { ok: false, reason: 'Too close to fire' };
  if (dist > maxR) return { ok: false, reason: 'Out of range' };
  if (aDef.cannotTargetFlyers && tDef.fly) return { ok: false, reason: 'Cannot target flyers' };
  if (maxR > 1 && !hasLineOfSight(state.tiles, attacker.x, attacker.y, target.x, target.y)) {
    return { ok: false, reason: 'Rock spire blocks line of sight' };
  }
  return { ok: true, dist };
}

export function travelOf(unit) {
  if (!unit || unit.fromX === undefined) return 0;
  return chebyshev(unit.fromX, unit.fromY, unit.x, unit.y);
}

/**
 * Full damage calculation with an itemised breakdown.
 * order: (base * multipliers) + flat bonuses - armour (unless piercing)
 */
export function damageBreakdown(state, attacker, target, opts = {}) {
  const aDef = defOf(attacker);
  const tDef = defOf(target);
  const steps = [];
  const basic = opts.basic !== false;
  let mult = 1;
  let flat = 0;
  let pierce = false;

  const apply = (label, m) => {
    if (Math.abs(m - 1) < 1e-9) return;
    mult *= m;
    steps.push({ label, factor: m });
  };

  // 1. role counter web
  apply(`Counter (${aDef.role} vs ${tDef.role})`, roleMult(attacker.type, target.type));

  // 2. position: allies pinching the target
  const buddies = state.units.filter(
    (o) =>
      o.hp > 0 && !o.isHive && o.id !== attacker.id &&
      o.side === attacker.side &&
      chebyshev(o.x, o.y, target.x, target.y) === 1
  );
  if (buddies.length >= 1) {
    apply('Flanked', 1.2);
    if (buddies.length >= 2) apply('Swarmed', 1 + 0.1 * Math.min(3, buddies.length) - 0.1 * 1);
  }

  // 3. terrain under the attacker
  if (tileAt(state.tiles, attacker.x, attacker.y) === TERRAIN.NEST) apply('High nest', 1.15);

  // 4. terrain under the target
  const targetTile = tileAt(state.tiles, target.x, target.y);
  if (targetTile === TERRAIN.MOSS && aDef.range[1] > 1) apply('Moss cover', 0.6);
  if (targetTile === TERRAIN.NEST) apply('Nest shelter', 0.85);
  if (target.statuses && target.statuses.entangled > 0) apply('Entangled', 1.15);

  // 5. unit-specific passives (basic attacks only)
  if (basic) {
    if (aDef.ability === 'charge' && travelOf(attacker) >= 2) apply('Horn Charge', 1.5);
    if (aDef.ability === 'pierce') {
      pierce = true;
      if (travelOf(attacker) >= 3) apply('Dive', 1.25);
    }
    if (attacker.type === 'ant') {
      const ants = state.units.filter(
        (o) => o.hp > 0 && o.type === 'ant' && o.id !== attacker.id &&
          o.side === attacker.side &&
          chebyshev(o.x, o.y, target.x, target.y) === 1
      ).length;
      if (ants > 0) {
        const bonus = Math.min(4, ants * 2);
        flat += bonus;
        steps.push({ label: `Legion +${bonus}`, factor: null });
      }
    }
    if (attacker.type === 'mantis' && target.hp <= target.maxHp / 2) {
      flat += 8;
      steps.push({ label: 'Execution +8', factor: null });
    }
  }

  if (attacker.statuses && attacker.statuses.frenzy > 0) {
    flat += 2;
    steps.push({ label: 'Pollen frenzy +2', factor: null });
  }

  if (tDef.volatile && chebyshev(attacker.x, attacker.y, target.x, target.y) === 1) {
    apply('Volatile carcass', 1.5);
  }

  const raw = Math.floor(aDef.dmg * mult + flat);
  const armor = pierce ? 0 : tDef.armor;
  const amount = Math.max(1, raw - armor);

  return {
    amount,
    raw,
    mult,
    flat,
    armor,
    pierce,
    steps,
    base: aDef.dmg,
  };
}

export function splashTargets(state, attacker, primary) {
  return state.units.filter(
    (o) =>
      o.hp > 0 && !o.isHive &&
      o.side !== attacker.side &&
      o.id !== primary.id &&
      chebyshev(o.x, o.y, primary.x, primary.y) === 1
  );
}

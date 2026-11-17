// The Stage-2 placeholder opponent. Deliberately simple and greedy:
// hit what you can kill, web the scariest unit, heal the wounded, otherwise
// walk toward the enemy hive. Stage 4 replaces this with real search.
import { allLegalActions } from '../core/actions.js';
import { damageBreakdown } from '../core/combat.js';
import { unitById } from '../core/state.js';
import { chebyshev } from '../core/board.js';
import { UNITS } from '../data/units.js';

function threatOf(state, unitId) {
  const u = unitById(state, unitId);
  if (!u) return 0;
  if (u.isHive) return 15;
  const def = UNITS[u.type];
  return (def.dmg || 0) * 2 + (def.move || 0) + (def.armor || 0) * 2;
}

export function droneAction(state, rng) {
  const acts = allLegalActions(state).filter((a) => a.kind !== 'end');
  if (!acts.length) return { kind: 'end' };

  // 1. the best attack available: damage, kills, and hive pressure
  const attacks = acts.filter((a) => a.kind === 'attack');
  if (attacks.length) {
    let best = null;
    let bestScore = -Infinity;
    for (const a of attacks) {
      const att = unitById(state, a.unit);
      const t = unitById(state, a.target);
      if (!att || !t) continue;
      const bd = damageBreakdown(state, att, t, { basic: true });
      const kill = bd.amount >= t.hp ? 1 : 0;
      const worth = t.isHive ? 60 : UNITS[t.type].cost;
      const score = bd.amount * 2 + kill * worth + (t.isHive ? 25 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    if (best) return best;
  }

  // 2. web the most dangerous enemy
  const webs = acts.filter((a) => a.kind === 'ability' && a.mode === 'web');
  if (webs.length && rng && rng.chance(0.75)) {
    webs.sort((a, b) => threatOf(state, b.target) - threatOf(state, a.target));
    return webs[0];
  }

  // 3. patch up the worst-wounded ally
  const heals = acts
    .filter((a) => a.kind === 'ability' && a.mode === 'heal')
    .filter((a) => {
      const t = unitById(state, a.target);
      return t && t.hp < t.maxHp - 2;
    });
  if (heals.length) {
    heals.sort((a, b) => unitById(state, a.target).hp - unitById(state, b.target).hp);
    return heals[0];
  }

  // 4. fray attacks are better than raw buffing
  const frenzy = acts.filter((a) => a.kind === 'ability' && a.mode === 'frenzy');
  if (frenzy.length && rng && rng.chance(0.25)) return frenzy[0];

  // 5. advance on the enemy hive — or hunt the nearest enemy in elimination
  const moves = acts.filter((a) => a.kind === 'move');
  if (moves.length) {
    const eliminated = state.victory === 'elimination';
    const hive = state.hives.find((h) => h.side !== state.side && h.hp > 0);
    const enemies = eliminated
      ? state.units.filter((u) => u.hp > 0 && !u.isHive && u.side !== state.side)
      : [];
    let best = null;
    let bestD = Infinity;
    for (const a of moves) {
      let d;
      if (eliminated) {
        d = enemies.length ? Infinity : 0;
        for (const e of enemies) d = Math.min(d, chebyshev(a.x, a.y, e.x, e.y));
      } else {
        d = hive ? chebyshev(a.x, a.y, hive.x, hive.y) : 0;
      }
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    if (best) return best;
  }

  return { kind: 'end' };
}

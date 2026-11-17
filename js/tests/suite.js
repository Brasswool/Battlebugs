// Rules-engine test suite. Everything here runs in the browser.
import { test, ok, eq, near } from './harness.js';
import { makeRng } from '../core/rng.js';
import {
  BOARD_W, BOARD_H, TERRAIN, idx, inBounds, chebyshev, stepCost,
  computeReach, reachableTiles, hasLineOfSight, effectiveMove, bfsConnectivity,
} from '../core/board.js';
import { UNITS } from '../data/units.js';
import { generateMap } from '../data/maps.js';
import {
  createGame, defaultArmy, armyCost, validateArmy, endTurn, checkVictory,
  unitAt, sideUnits, BUDGET, TURN_CAP, autoPlacements, placementError, spawnUnit,
  despawnUnit, generateArmy, aiArmyFor, deployRows, VICTORY, expireSpentStatuses,
} from '../core/state.js';
import { damageBreakdown, roleMult, canTarget, travelOf } from '../core/combat.js';
import {
  moveOptions, attackOptions, abilityOptions, moveUnit, attackUnit,
  useAbility, allLegalActions, applyAction,
} from '../core/actions.js';
import { droneAction } from '../ai/drone.js';

// ── helpers ──────────────────────────────────────────────────
function blank(tiles) {
  return {
    tiles: tiles || new Uint8Array(BOARD_W * BOARD_H),
    units: [],
    hives: [],
    side: 0,
    round: 1,
    halfTurns: 0,
    winner: null,
    winReason: null,
    log: [],
    nextId: 1,
    seed: 1,
    mode: 'test',
    victory: 'hive',
  };
}

function put(s, type, side, x, y, hp) {
  const def = UNITS[type];
  const u = {
    id: `u${s.nextId++}`,
    type,
    side,
    x,
    y,
    hp: hp ?? def.hp,
    maxHp: def.hp,
    fromX: x,
    fromY: y,
    moved: false,
    acted: false,
    statuses: { entangled: 0, frenzy: 0 },
    isHive: false,
    facing: side === 0 ? -1 : 1,
  };
  s.units.push(u);
  return u;
}

const mirrorIdx = (i) => {
  const x = i % BOARD_W;
  const y = (i / BOARD_W) | 0;
  return idx(BOARD_W - 1 - x, BOARD_H - 1 - y);
};

// ── RNG ──────────────────────────────────────────────────────
test('rng · same seed reproduces the same sequence', () => {
  const a = makeRng(42);
  const b = makeRng(42);
  for (let i = 0; i < 8; i++) eq(a(), b(), `value ${i}`);
});

test('rng · different seeds diverge', () => {
  const a = makeRng(1);
  const b = makeRng(2);
  let same = 0;
  for (let i = 0; i < 8; i++) if (a() === b()) same++;
  ok(same < 2, 'sequences should differ');
});

// ── map generation ───────────────────────────────────────────
test('map · is 10x8', () => {
  const m = generateMap(1);
  eq(m.tiles.length, BOARD_W * BOARD_H);
});

test('map · rotationally symmetric for many seeds', () => {
  for (const seed of [1, 7, 42, 99, 1337, 80808]) {
    const m = generateMap(seed);
    for (let i = 0; i < m.tiles.length; i++) {
      eq(m.tiles[i], m.tiles[mirrorIdx(i)], `seed ${seed} tile ${i}`);
    }
  }
});

test('map · hive tiles are open terrain', () => {
  for (const seed of [1, 5, 12, 400]) {
    const m = generateMap(seed);
    for (const h of m.hives) eq(m.tiles[idx(h.x, h.y)], TERRAIN.OPEN, `seed ${seed}`);
  }
});

test('map · hives are mirrored and mutually reachable', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const m = generateMap(seed);
    eq(m.hives[0].x + m.hives[1].x, BOARD_W - 1, 'mirrored x');
    eq(m.hives[0].y + m.hives[1].y, BOARD_H - 1, 'mirrored y');
    const seen = bfsConnectivity(m.tiles, m.hives[0]);
    ok(seen[idx(m.hives[1].x, m.hives[1].y)], `seed ${seed} hives disconnected`);
  }
});

test('map · no rocks in deployment rows', () => {
  for (const seed of [3, 17, 500]) {
    const m = generateMap(seed);
    for (const y of [0, 1, 6, 7]) {
      for (let x = 0; x < BOARD_W; x++) {
        ok(m.tiles[idx(x, y)] !== TERRAIN.ROCK, `rock in deploy row seed ${seed}`);
      }
    }
  }
});

// ── grid ─────────────────────────────────────────────────────
test('grid · bounds and distance', () => {
  ok(inBounds(0, 0) && inBounds(9, 7));
  ok(!inBounds(-1, 0) && !inBounds(10, 7) && !inBounds(0, 8));
  eq(chebyshev(0, 0, 3, 2), 3);
  eq(chebyshev(4, 4, 4, 4), 0);
});

test('grid · terrain costs differ for ground, climbers and flyers', () => {
  eq(stepCost(TERRAIN.OPEN, {}), 1);
  eq(stepCost(TERRAIN.WEB, {}), 2);
  eq(stepCost(TERRAIN.WEB, { fly: true }), 1);
  eq(stepCost(TERRAIN.ROCK, {}), Infinity);
  eq(stepCost(TERRAIN.ROCK, { climber: true }), 2);
  eq(stepCost(TERRAIN.ROCK, { fly: true }), 1);
});

test('move · rocks block ground movement', () => {
  const s = blank();
  s.tiles[idx(1, 0)] = TERRAIN.ROCK;
  const a = put(s, 'ant', 0, 0, 0);
  const { cost } = computeReach(s, a);
  eq(cost[idx(1, 0)], Infinity);
});

test('move · flyers cross terrain at cost 1', () => {
  const s = blank();
  s.tiles[idx(1, 0)] = TERRAIN.WEB;
  const wasp = put(s, 'wasp', 0, 0, 0);
  const ant = put(s, 'ant', 1, 0, 1);
  eq(computeReach(s, wasp).cost[idx(1, 0)], 1);
  eq(computeReach(s, ant).cost[idx(1, 0)], 2);
});

test('move · budget is respected', () => {
  const s = blank();
  const a = put(s, 'ant', 0, 0, 0);
  const dests = reachableTiles(s, a);
  ok(dests.length > 0);
  for (const d of dests) ok(d.cost <= 3, `cost ${d.cost} exceeded move 3`);
  ok(!dests.some((d) => d.x === 4 && d.y === 4), 'ant cannot cross the board');
});

test('move · occupied tiles are not valid destinations', () => {
  const s = blank();
  const a = put(s, 'ant', 0, 0, 0);
  put(s, 'ant', 0, 1, 0);
  const dests = reachableTiles(s, a);
  ok(!dests.some((d) => d.x === 1 && d.y === 0), 'ally tile must be excluded');
});

test('move · webbed units lose half their movement', () => {
  const s = blank();
  const m = put(s, 'mantis', 0, 0, 0);
  eq(effectiveMove(m), 4);
  m.statuses.entangled = 1;
  eq(effectiveMove(m), 2);
});

test('line of sight · rocks block, open ground does not', () => {
  const s = blank();
  ok(hasLineOfSight(s.tiles, 0, 0, 2, 2));
  s.tiles[idx(1, 1)] = TERRAIN.ROCK;
  ok(!hasLineOfSight(s.tiles, 0, 0, 2, 2));
});

// ── game setup ───────────────────────────────────────────────
test('setup · creates two full-health hives', () => {
  const s = createGame({ seed: 4 });
  eq(s.hives.length, 2);
  for (const h of s.hives) {
    eq(h.hp, h.maxHp);
    ok(h.isHive);
  }
});

test('setup · victory variation defaults to hive assault and is stored', () => {
  eq(createGame({ seed: 4 }).victory, VICTORY.HIVE);
  eq(createGame({ seed: 4, victory: VICTORY.ELIMINATION }).victory, VICTORY.ELIMINATION);
  eq(createGame({ seed: 4, victory: 'nonsense' }).victory, VICTORY.HIVE, 'unknown modes fall back');
});

test('setup · standard armies fit the 120 budget', () => {
  for (const side of [0, 1]) {
    const cost = armyCost(defaultArmy(side));
    ok(cost > 0 && cost <= BUDGET, `side ${side} costs ${cost}`);
  }
});

test('setup · over-budget armies are rejected', () => {
  const greedy = ['rhino', 'rhino', 'rhino', 'rhino', 'rhino', 'rhino'];
  const v = validateArmy(greedy);
  ok(!v.ok);
});

test('setup · units deploy inside their own zone without overlap', () => {
  const s = createGame({ seed: 11 });
  const seen = new Set();
  for (const u of s.units) {
    if (u.isHive) continue;
    const zone = u.side === 0 ? [6, 7] : [0, 1];
    ok(zone.includes(u.y), `${u.type} deployed outside its zone`);
    const k = `${u.x},${u.y}`;
    ok(!seen.has(k), 'two units share a tile');
    seen.add(k);
  }
});

test('setup · same seed produces an identical battlefield', () => {
  const a = createGame({ seed: 77 });
  const b = createGame({ seed: 77 });
  eq(JSON.stringify(a.tiles), JSON.stringify(b.tiles));
  eq(a.units.length, b.units.length);
});

// ── army builder ─────────────────────────────────────────────
test('army · cost and validation catch empty, unknown and oversized lists', () => {
  eq(armyCost(['ant', 'rhino']), 32);
  ok(!validateArmy([]).ok, 'empty army');
  ok(!validateArmy(['ant', 'dragon']).ok, 'unknown species');
  ok(!validateArmy(Array(11).fill('ant')).ok, '11 units');
  ok(validateArmy(Array(10).fill('ant')).ok, '10 ants = 100 pts');
  const v = validateArmy(Array(10).fill('ant'));
  eq(v.cost, 100);
});

test('army · AI generator is deterministic, legal and near budget', () => {
  for (const seed of [1, 2, 3, 1337, 424242]) {
    const a = aiArmyFor(seed);
    const b = aiArmyFor(seed);
    eq(a.join(','), b.join(','), `seed ${seed} must be reproducible`);
    const v = validateArmy(a);
    ok(v.ok, v.error);
    ok(a.length >= 1 && a.length <= 10, `seed ${seed} has ${a.length} units`);
    ok(v.cost >= 90, `seed ${seed} only spent ${v.cost} pts`);
  }
});

test('army · generator respects a custom budget', () => {
  const rng = makeRng(7);
  const list = generateArmy(rng, 60);
  const v = validateArmy(list, 60);
  ok(v.ok, v.error);
  ok(v.cost <= 60, `spent ${v.cost}`);
});

// ── deployment ───────────────────────────────────────────────
test('deploy · autoPlacements are legal, unique and inside the zone', () => {
  const s = createGame({ seed: 11, armies: [[], []], placements: [[], []] });
  for (const side of [0, 1]) {
    const list = defaultArmy(side);
    const ps = autoPlacements(s, side, list);
    eq(ps.length, list.length);
    const seen = new Set();
    for (const p of ps) {
      eq(placementError(s, side, p.type, p.x, p.y), null, `${side}:${p.type}`);
      ok(deployRows(side).includes(p.y), 'front/back zone');
      const k = `${p.x},${p.y}`;
      ok(!seen.has(k), 'two units share a tile');
      seen.add(k);
    }
  }
});

test('deploy · manual placements are honoured exactly', () => {
  const army = ['ant', 'rhino', 'bee'];
  const placements = [
    [
      { type: 'ant', x: 0, y: 6 },
      { type: 'rhino', x: 1, y: 6 },
      { type: 'bee', x: 0, y: 7 },
    ],
    null,
  ];
  const s = createGame({ seed: 5, armies: [army, null], placements });
  for (const p of placements[0]) {
    const u = unitAt(s, p.x, p.y);
    ok(u, `no unit at ${p.x},${p.y}`);
    eq(u.type, p.type);
    eq(u.side, 0);
  }
});

test('deploy · placement rules reject wrong rows and occupied tiles', () => {
  const s = createGame({ seed: 5, armies: [[], []], placements: [[], []] });
  ok(placementError(s, 0, 'ant', 0, 2), 'wrong row');
  eq(placementError(s, 0, 'ant', 0, 6), null);
  const hive = s.hives[0];
  ok(placementError(s, 0, 'ant', hive.x, hive.y), 'hive tile');
  ok(spawnUnit(s, 0, 'ant', 3, 6).ok);
  ok(placementError(s, 0, 'ant', 3, 6), 'occupied tile');
  const ant = s.units.find((u) => u.side === 0 && !u.isHive);
  ok(despawnUnit(s, ant.id));
  eq(placementError(s, 0, 'ant', 3, 6), null);
});

test('deploy · illegal createGame placements throw', () => {
  let threw = false;
  try {
    createGame({
      seed: 5,
      armies: [['ant'], null],
      placements: [[{ type: 'ant', x: 0, y: 2 }], null],
    });
  } catch {
    threw = true;
  }
  ok(threw, 'outside the deployment zone must be rejected');
});

test('deploy · an empty placement list leaves that side with no units', () => {
  const s = createGame({ seed: 9, armies: [[], ['ant']], placements: [[], null] });
  eq(sideUnits(s, 0).length, 0);
  ok(sideUnits(s, 1).length > 0);
});

// ── hot seat ─────────────────────────────────────────────────
test('hotseat · both players deploy in their own zones', () => {
  const p1 = [
    { type: 'ant', x: 0, y: 6 },
    { type: 'rhino', x: 1, y: 7 },
  ];
  const p2 = [
    { type: 'bee', x: 9, y: 1 },
    { type: 'mantis', x: 8, y: 0 },
  ];
  const s = createGame({
    seed: 12,
    mode: 'hotseat',
    armies: [['ant', 'rhino'], ['bee', 'mantis']],
    placements: [p1, p2],
  });
  eq(s.mode, 'hotseat');
  for (const p of p1) eq(unitAt(s, p.x, p.y).side, 0);
  for (const p of p2) eq(unitAt(s, p.x, p.y).side, 1);
  eq(sideUnits(s, 0).length, 2);
  eq(sideUnits(s, 1).length, 2);
});

test('hotseat · turn log names the next human player', () => {
  const s = createGame({ seed: 12, mode: 'hotseat', armies: [['ant'], ['ant']] });
  ok(/Hot seat/.test(s.log[0].text), 'mode is tagged in the opening log');
  endTurn(s);
  eq(s.side, 1);
  ok(/Player 2/.test(s.log[s.log.length - 1].text), 'player two is announced');
  endTurn(s);
  eq(s.side, 0);
  ok(/Player 1/.test(s.log[s.log.length - 1].text), 'player one is announced');
});

test('hotseat · both sides hand control back and forth cleanly', () => {
  const s = createGame({ seed: 12, mode: 'hotseat', armies: [['ant', 'bee'], ['ant', 'bee']] });
  const p1 = sideUnits(s, 0);
  p1[0].moved = true;
  p1[0].acted = true;
  ok(endTurn(s).ok);
  eq(s.side, 1);
  for (const u of sideUnits(s, 1)) eq(u.moved, false);
  sideUnits(s, 1)[0].moved = true;
  sideUnits(s, 1)[0].acted = true;
  ok(endTurn(s).ok);
  eq(s.side, 0);
  eq(s.round, 1, 'the round keeps going while units remain');
  // Everything activates — the round rolls over and both armies refresh.
  for (const u of [...sideUnits(s, 0), ...sideUnits(s, 1)]) {
    u.moved = true;
    u.acted = true;
  }
  endTurn(s);
  eq(s.round, 2);
  for (const u of p1) eq(u.moved, false);
});

// ── combat maths ─────────────────────────────────────────────
test('combat · neutral attack deals base damage', () => {
  const s = blank();
  const a = put(s, 'ant', 0, 1, 1);
  const t = put(s, 'ant', 1, 1, 2);
  eq(damageBreakdown(s, a, t).amount, 5);
});

test('combat · counter web multiplies damage', () => {
  eq(roleMult('ant', 'rhino'), 1.35);
  eq(roleMult('bombardier', 'ant'), 1.4);
  eq(roleMult('mantis', 'bee'), 1.4);
  eq(roleMult('ant', 'wasp'), 1);
});

test('combat · armour reduces damage', () => {
  const s = blank();
  const a = put(s, 'ant', 0, 1, 1);
  const t = put(s, 'rhino', 1, 1, 2);
  eq(damageBreakdown(s, a, t).amount, 3); // floor(5*1.35)=6, minus 3 armour
});

test('combat · damage never drops below 1', () => {
  const s = blank();
  const a = put(s, 'bee', 0, 1, 1);
  const t = put(s, 'rhino', 1, 1, 2);
  eq(damageBreakdown(s, a, t).amount, 1); // 3 damage vs 3 armour
});

test('combat · piercing ignores armour entirely', () => {
  const s = blank();
  const a = put(s, 'wasp', 0, 1, 1);
  const t = put(s, 'rhino', 1, 1, 2);
  const bd = damageBreakdown(s, a, t);
  eq(bd.pierce, true);
  eq(bd.amount, 8); // floor(7 * 1.2) with no armour
});

test('combat · flanking adds 20%', () => {
  const s = blank();
  const a = put(s, 'ant', 0, 1, 1);
  put(s, 'termite', 0, 2, 2);
  const t = put(s, 'ant', 1, 1, 2);
  const bd = damageBreakdown(s, a, t);
  eq(bd.amount, 6); // floor(5 * 1.2)
  ok(bd.steps.some((x) => x.label === 'Flanked'));
});

test('combat · ant legion adds +2 per sister on the target (max +4)', () => {
  const s = blank();
  const a = put(s, 'ant', 0, 1, 1);
  put(s, 'ant', 0, 2, 2);
  put(s, 'ant', 0, 0, 2);
  const t = put(s, 'ant', 1, 1, 2);
  const bd = damageBreakdown(s, a, t);
  eq(bd.flat, 4);
  ok(bd.steps.some((x) => x.label.startsWith('Legion')));
});

test('combat · moss cover cuts ranged damage by 40%', () => {
  const s = blank();
  s.tiles[idx(1, 2)] = TERRAIN.MOSS;
  const a = put(s, 'bombardier', 0, 1, 0);
  const t = put(s, 'ant', 1, 1, 2);
  eq(damageBreakdown(s, a, t).amount, 7); // 9 * 1.4 * 0.6 = 7.56
});

test('combat · nest mound grants +15% damage', () => {
  const s = blank();
  s.tiles[idx(1, 1)] = TERRAIN.NEST;
  const a = put(s, 'ant', 0, 1, 1);
  const t = put(s, 'rhino', 1, 1, 2);
  eq(damageBreakdown(s, a, t).amount, 4); // 5*1.35*1.15 = 7.76 -> 7 - 3
});

test('combat · webbed targets take +15%', () => {
  const s = blank();
  const a = put(s, 'ant', 0, 1, 1);
  const t = put(s, 'ant', 1, 1, 2);
  t.statuses.entangled = 1;
  const bd = damageBreakdown(s, a, t);
  eq(bd.amount, 5); // floor(5 * 1.15) = 5
  ok(bd.steps.some((x) => x.label === 'Entangled'));
});

test('combat · horn charge needs a two-tile run-up', () => {
  const s = blank();
  const r = put(s, 'rhino', 0, 1, 1);
  const t = put(s, 'ant', 1, 1, 2);
  eq(damageBreakdown(s, r, t).amount, 11); // 10 * 1.1
  r.fromX = 1;
  r.fromY = 3;
  eq(travelOf(r), 2);
  eq(damageBreakdown(s, r, t).amount, 16); // floor(10 * 1.1 * 1.5)
});

test('combat · mantis execution finishes wounded targets', () => {
  const s = blank();
  const m = put(s, 'mantis', 0, 1, 1);
  const t = put(s, 'ant', 1, 1, 2, 7);
  eq(damageBreakdown(s, m, t).amount, 20); // 12 + 8
});

test('combat · wasp dive rewards distance', () => {
  const s = blank();
  const w = put(s, 'wasp', 0, 1, 1);
  const t = put(s, 'rhino', 1, 1, 2);
  w.fromX = 1;
  w.fromY = 4;
  eq(travelOf(w), 3);
  eq(damageBreakdown(s, w, t).amount, 10); // floor(7 * 1.2 * 1.25), pierce
});

test('combat · bombardier carcass is volatile up close', () => {
  const s = blank();
  const a = put(s, 'ant', 0, 1, 1);
  const t = put(s, 'bombardier', 1, 1, 2);
  eq(damageBreakdown(s, a, t).amount, 7); // floor(5*1.15*1.5)=8, -1 armour
});

test('combat · bombardier cannot shoot adjacent or airborne targets', () => {
  const s = blank();
  const b = put(s, 'bombardier', 0, 1, 1);
  const close = put(s, 'ant', 1, 1, 2);
  const flyer = put(s, 'wasp', 1, 1, 3);
  ok(!canTarget(s, b, close).ok, 'min range 2');
  ok(!canTarget(s, b, flyer).ok, 'cannot target flyers');
});

test('combat · ranged attacks need line of sight', () => {
  const s = blank();
  s.tiles[idx(1, 1)] = TERRAIN.ROCK;
  const b = put(s, 'bombardier', 0, 1, 0);
  const t = put(s, 'ant', 1, 1, 2);
  const r = canTarget(s, b, t);
  ok(!r.ok);
  ok(/line of sight/i.test(r.reason));
});

test('combat · friendly units cannot be attacked', () => {
  const s = blank();
  const a = put(s, 'ant', 0, 1, 1);
  const b = put(s, 'ant', 0, 1, 2);
  ok(!canTarget(s, a, b).ok);
});

// ── actions ──────────────────────────────────────────────────
test('actions · a unit may move once per turn', () => {
  const s = blank();
  const a = put(s, 'ant', 0, 1, 1);
  const r1 = moveUnit(s, a.id, 2, 1);
  ok(r1.ok, r1.error);
  eq(a.moved, true);
  const r2 = moveUnit(s, a.id, 3, 1);
  ok(!r2.ok);
  eq(a.x, 2);
});

test('actions · move then attack, or attack then move', () => {
  const s = blank();
  const a = put(s, 'ant', 0, 1, 1);
  const t = put(s, 'ant', 1, 1, 3);
  ok(moveUnit(s, a.id, 1, 2).ok);
  const hit = attackUnit(s, a.id, t.id);
  ok(hit.ok, hit.error);
  eq(t.hp, 14 - 5);
  eq(a.acted, true);

  const s2 = blank();
  const b = put(s2, 'ant', 0, 1, 1);
  const t2 = put(s2, 'ant', 1, 1, 2);
  ok(attackUnit(s2, b.id, t2.id).ok);
  ok(moveUnit(s2, b.id, 2, 2).ok, 'may still reposition after attacking');
});

test('actions · termites splinter onto neighbours', () => {
  const s = blank();
  const ter = put(s, 'termite', 0, 1, 1);
  const a = put(s, 'ant', 1, 1, 2);
  const b = put(s, 'ant', 1, 2, 2);
  const res = attackUnit(s, ter.id, a.id);
  ok(res.ok, res.error);
  eq(a.hp, 14 - 6);
  eq(b.hp, 14 - 3);
});

test('actions · horn charge knocks the target back one tile', () => {
  const s = blank();
  const r = put(s, 'rhino', 0, 1, 1);
  r.fromX = 1;
  r.fromY = 3;
  const t = put(s, 'ant', 1, 1, 2);
  const res = attackUnit(s, r.id, t.id);
  ok(res.ok, res.error);
  eq(t.y, 3);
  ok(res.events.some((e) => e.type === 'knockback'));
});

test('actions · web shot entangles and halves movement', () => {
  const s = blank();
  const sp = put(s, 'spider', 0, 1, 1);
  const m = put(s, 'mantis', 1, 3, 1);
  const res = useAbility(s, sp.id, { mode: 'web', targetId: m.id });
  ok(res.ok, res.error);
  eq(m.statuses.entangled, 1);
  eq(effectiveMove(m), 2);
  eq(sp.acted, true);
});

test('actions · webbed units cannot use abilities', () => {
  const s = blank();
  const bee = put(s, 'bee', 0, 1, 1);
  bee.statuses.entangled = 1;
  const ally = put(s, 'ant', 0, 2, 1, 5);
  const res = useAbility(s, bee.id, { mode: 'heal', targetId: ally.id });
  ok(!res.ok);
});

test('actions · pollen heals without exceeding max health', () => {
  const s = blank();
  const bee = put(s, 'bee', 0, 1, 1);
  const ally = put(s, 'ant', 0, 2, 1, 12);
  const res = useAbility(s, bee.id, { mode: 'heal', targetId: ally.id });
  ok(res.ok, res.error);
  eq(ally.hp, 14);
});

test('actions · pollen frenzy adds 2 flat damage', () => {
  const s = blank();
  const bee = put(s, 'bee', 0, 0, 0);
  const ant = put(s, 'ant', 0, 2, 1);
  const target = put(s, 'rhino', 1, 2, 2);
  eq(damageBreakdown(s, ant, target).amount, 3);
  ok(useAbility(s, bee.id, { mode: 'frenzy', targetId: ant.id }).ok);
  eq(damageBreakdown(s, ant, target).amount, 5);
});

test('actions · spider web is limited by range', () => {
  const s = blank();
  const sp = put(s, 'spider', 0, 1, 1);
  const far = put(s, 'ant', 1, 1, 6);
  ok(!useAbility(s, sp.id, { mode: 'web', targetId: far.id }).ok);
});

// ── turn flow ────────────────────────────────────────────────
test('turns · passing the activation alternates control unit by unit', () => {
  const s = createGame({ seed: 8 });
  const mine = sideUnits(s, 0);
  mine[0].moved = true;
  mine[0].acted = true;
  const res = endTurn(s);
  ok(res.ok);
  eq(s.side, 1, 'control passes to the other side');
  eq(mine[0].moved, true, 'spent units stay spent until the round resets');
  eq(s.round, 1, 'the round continues while units remain');
});

test('turns · a round only resets when both sides run out of activations', () => {
  const s = createGame({ seed: 8 });
  eq(s.round, 1);
  endTurn(s); // 0 -> 1
  eq(s.round, 1);
  endTurn(s); // 1 -> 0
  eq(s.round, 1);
  for (const u of [...sideUnits(s, 0), ...sideUnits(s, 1)]) {
    u.moved = true;
    u.acted = true;
  }
  endTurn(s);
  eq(s.side, 0, 'side 0 opens every round');
  eq(s.round, 2);
  for (const u of sideUnits(s, 0)) {
    eq(u.moved, false, 'flags refresh for the new round');
    eq(u.acted, false);
  }
});

test('turns · passing with a half-activated unit forfeits its action', () => {
  const s = createGame({ seed: 8 });
  const walker = sideUnits(s, 0).find((u) => reachableTiles(s, u).length > 0);
  ok(walker, 'side 0 has a unit that can move');
  const dest = reachableTiles(s, walker)[0];
  ok(moveUnit(s, walker.id, dest.x, dest.y).ok); // moved, not acted
  endTurn(s);
  eq(walker.acted, true, 'the unused action is forfeited');
  eq(sideUnits(s, 1).every((u) => !u.moved && !u.acted), true, 'the other side is untouched');
});

test('turns · statuses lapse when their owner finishes an activation', () => {
  const s = createGame({ seed: 8 });
  const victim = sideUnits(s, 1)[0];
  victim.statuses.entangled = 1;
  victim.moved = true;
  victim.acted = true;
  expireSpentStatuses(s);
  eq(victim.statuses.entangled, 0, 'the web lifts after the unit activates');

  // A unit webbed after it already activated keeps the web until next round.
  const late = sideUnits(s, 1)[1];
  late.moved = true;
  late.acted = true;
  expireSpentStatuses(s);
  late.statuses.entangled = 1;
  expireSpentStatuses(s);
  eq(late.statuses.entangled, 1, 'a fresh web is not cleared immediately');
});

test('turns · statuses expire after the unit’s next activation across a round', () => {
  const s = createGame({ seed: 8 });
  const late = sideUnits(s, 1)[1];
  late.moved = true;
  late.acted = true;
  expireSpentStatuses(s); // already activated this round
  late.statuses.entangled = 1;
  for (const u of [...sideUnits(s, 0), ...sideUnits(s, 1)]) {
    u.moved = true;
    u.acted = true;
  }
  endTurn(s); // round resets — fresh again
  eq(late.statuses.entangled, 1, 'the web survives the round change');
  late.moved = true;
  late.acted = true;
  expireSpentStatuses(s);
  eq(late.statuses.entangled, 0, 'and lifts after its next activation');
});

// ── victory ──────────────────────────────────────────────────
test('victory · destroying a hive wins the game', () => {
  const s = createGame({ seed: 3 });
  s.hives[1].hp = 0;
  eq(checkVictory(s), 0);
  eq(s.winReason, 'hive');
});

test('victory · elimination ends when the enemy army is wiped out', () => {
  const s = createGame({ seed: 3, victory: VICTORY.ELIMINATION });
  for (const u of s.units) if (u.side === 1 && !u.isHive) u.hp = 0;
  eq(checkVictory(s), 0);
  eq(s.winReason, 'elimination');
  eq(s.hives[1].hp, s.hives[1].maxHp, 'the Hive itself is untouched');
});

test('victory · elimination ignores hive destruction', () => {
  const s = createGame({ seed: 3, victory: VICTORY.ELIMINATION });
  s.hives[1].hp = 0;
  eq(checkVictory(s), null);
  eq(s.winReason, null);
});

test('victory · mutual elimination is a draw', () => {
  const s = createGame({ seed: 3, victory: VICTORY.ELIMINATION });
  for (const u of s.units) if (!u.isHive) u.hp = 0;
  eq(checkVictory(s), -1);
  eq(s.winReason, 'elimination');
});

test('victory · elimination falls back to the turn cap', () => {
  const s = createGame({ seed: 3, victory: VICTORY.ELIMINATION });
  s.round = TURN_CAP + 1;
  checkVictory(s);
  ok(s.winner !== null, 'a winner must be decided');
  eq(s.winReason, 'timeout');
});

test('victory · hives are only attackable in hive assault', () => {
  const hiveMode = createGame({ seed: 3 });
  const hive = hiveMode.hives[1];
  const attacker = put(hiveMode, 'mantis', 0, hive.x, hive.y + 1);
  ok(canTarget(hiveMode, attacker, hive).ok, 'hive assault can hit the Hive');

  const elimination = createGame({ seed: 3, victory: VICTORY.ELIMINATION });
  const protectedHive = elimination.hives[1];
  const hunter = put(elimination, 'mantis', 0, protectedHive.x, protectedHive.y + 1);
  const res = canTarget(elimination, hunter, protectedHive);
  ok(!res.ok, 'the Hive must be protected in elimination');
  ok(/not objectives/i.test(res.reason));
});

test('victory · no actions are legal after the battle ends', () => {
  const s = createGame({ seed: 3 });
  s.hives[0].hp = 0;
  checkVictory(s);
  eq(allLegalActions(s).length, 1); // only "end"
  const u = s.units.find((x) => !x.isHive);
  ok(!attackOptions(s, u.id).length);
  ok(!moveOptions(s, u.id).length);
});

// ── full games ───────────────────────────────────────────────
test('simulation · random games always terminate cleanly', () => {
  for (const seed of [1, 2, 3]) {
    const s = createGame({ seed, mapSeed: seed });
    const rng = makeRng(seed * 7919 + 13);
    let guard = 0;
    while (s.winner === null && guard++ < 4000) {
      const acts = allLegalActions(s);
      const endAt = acts.findIndex((a) => a.kind === 'end');
      let pick;
      if (endAt >= 0 && rng.chance(0.15)) pick = acts[endAt];
      else pick = acts[rng.int(acts.length)];
      const res = applyAction(s, pick);
      ok(res.ok, `seed ${seed}: "${res.error}" from ${JSON.stringify(pick)}`);
    }
    ok(s.winner !== null, `seed ${seed} failed to finish`);
    ok(s.log.length <= 400, 'log must stay bounded');
  }
});

test('simulation · hive damage can actually end a game', () => {
  const s = createGame({ seed: 21 });
  const hive = s.hives[1];
  hive.hp = 4;
  // a mantis beside the hive lands the killing blow
  const m = put(s, 'mantis', 0, hive.x, hive.y - 1);
  m.fromX = hive.x;
  m.fromY = hive.y - 3;
  const res = attackUnit(s, m.id, hive.id);
  ok(res.ok, res.error);
  eq(hive.hp, 0);
  eq(s.winner, 0);
});

test('simulation · the drone AI plays legal games to a finish', () => {
  for (const seed of [2, 9, 17]) {
    const s = createGame({ seed });
    const rng = makeRng(seed * 31 + 7);
    let guard = 0;
    while (s.winner === null && guard++ < 3000) {
      const act = droneAction(s, rng);
      const res = applyAction(s, act);
      ok(res.ok, `seed ${seed}: "${res.error}" from ${JSON.stringify(act)}`);
    }
    ok(s.winner !== null, `seed ${seed} stalled out`);
  }
});

test('simulation · drone elimination battles finish with intact hives', () => {
  for (const seed of [4, 13]) {
    const s = createGame({ seed, victory: VICTORY.ELIMINATION });
    const rng = makeRng(seed * 37 + 11);
    let guard = 0;
    while (s.winner === null && guard++ < 3000) {
      const act = droneAction(s, rng);
      const res = applyAction(s, act);
      ok(res.ok, `seed ${seed}: "${res.error}" from ${JSON.stringify(act)}`);
    }
    ok(s.winner !== null, `seed ${seed} stalled out`);
    for (const h of s.hives) eq(h.hp, h.maxHp, `seed ${seed}: hives stay intact`);
  }
});

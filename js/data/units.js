// ─────────────────────────────────────────────────────────────
//  Roster, stats, and the counter web.
//  Stats are the single source of truth: the AI's piece values,
//  the cost of an army, and the damage maths all derive from here.
// ─────────────────────────────────────────────────────────────

export const ROLES = [
  'swarm',
  'bruiser',
  'assassin',
  'skirmisher',
  'artillery',
  'controller',
  'support',
];

// M[attackerRole][defenderRole] => damage multiplier.
// Missing entries are 1.0 (neutral). This web is deliberately
// non-transitive: no single unit dominates, but every unit has prey.
export const COUNTER = {
  swarm: {
    bruiser: 1.35,   // many small bites ignore heavy armour
    artillery: 1.15, // closes the gap and eats the gun
    support: 1.1,
  },
  artillery: {
    swarm: 1.4,      // splash shreds clumps of cheap bodies
    controller: 1.15,
  },
  assassin: {
    artillery: 1.4,
    support: 1.4,
    controller: 1.2,
  },
  skirmisher: {
    artillery: 1.35,
    bruiser: 1.2,    // pierces plate
    controller: 1.15,
  },
  bruiser: {
    assassin: 1.25,
    skirmisher: 1.25,
    swarm: 1.1,
  },
  controller: {
    bruiser: 1.2,    // webs neutralise slow heavies
    assassin: 1.1,
    artillery: 1.15,
  },
  support: {},
};

export const HIVE = {
  id: 'hive',
  name: 'Hive',
  role: 'hive',
  cost: 0,
  hp: 70,
  move: 0,
  dmg: 0,
  range: [0, 0],
  armor: 2,
  fly: false,
  ability: null,
  blurb: 'The colony. If it falls, the swarm falls with it.',
};

export const UNITS = {
  ant: {
    id: 'ant',
    name: 'Ant Soldier',
    role: 'swarm',
    cost: 10,
    hp: 14,
    move: 3,
    dmg: 5,
    range: [1, 1],
    armor: 0,
    fly: false,
    ability: 'legion',
    blurb: 'Cheap, endless, and braver in company.',
    abilityText: 'Legion — +2 damage per other ant beside the target (max +4).',
    beats: ['bruiser', 'artillery'],
    losesTo: ['artillery'],
    flavor: '"One ant is nothing. Forty ants is a decision."',
  },
  termite: {
    id: 'termite',
    name: 'Termite',
    role: 'swarm',
    cost: 14,
    hp: 16,
    move: 3,
    dmg: 6,
    range: [1, 1],
    armor: 1,
    fly: false,
    ability: 'splinter',
    blurb: 'Splinters on impact, spraying the neighbours.',
    abilityText: 'Splinter — 50% splash damage to every enemy beside the target.',
    beats: ['swarm'],
    losesTo: ['assassin'],
    flavor: '"Wood, chitin, bone. It all splinters the same."',
  },
  rhino: {
    id: 'rhino',
    name: 'Rhino Beetle',
    role: 'bruiser',
    cost: 22,
    hp: 32,
    move: 2,
    dmg: 10,
    range: [1, 1],
    armor: 3,
    fly: false,
    ability: 'charge',
    blurb: 'A wall of plate that only hits hard if it gets a run-up.',
    abilityText: 'Horn Charge — moved 2+ tiles first: +50% damage and knock the target back 1.',
    beats: ['assassin', 'skirmisher'],
    losesTo: ['swarm', 'controller'],
    flavor: '"Do not stand in front of it. Do not stand behind it either."',
  },
  mantis: {
    id: 'mantis',
    name: 'Mantis',
    role: 'assassin',
    cost: 20,
    hp: 16,
    move: 4,
    dmg: 12,
    range: [1, 1],
    armor: 0,
    fly: false,
    ability: 'execution',
    blurb: 'Fragile, fast, and built to finish what others started.',
    abilityText: 'Execution — +8 damage against targets at or below half health.',
    beats: ['artillery', 'support', 'controller'],
    losesTo: ['bruiser', 'swarm'],
    flavor: '"It does not duel. It concludes."',
  },
  wasp: {
    id: 'wasp',
    name: 'Wasp',
    role: 'skirmisher',
    cost: 16,
    hp: 12,
    move: 5,
    dmg: 7,
    range: [1, 1],
    armor: 0,
    fly: true,
    ability: 'pierce',
    blurb: 'Ignores terrain, ignores armour, cannot take a punch.',
    abilityText: 'Pierce — basic attacks ignore armour. Dive — moved 3+ tiles first: +25% damage.',
    beats: ['artillery', 'bruiser', 'controller'],
    losesTo: ['bruiser', 'controller'],
    flavor: '"The sky is a road and it has no speed limit."',
  },
  bombardier: {
    id: 'bombardier',
    name: 'Bombardier Beetle',
    role: 'artillery',
    cost: 18,
    hp: 14,
    move: 2,
    dmg: 9,
    range: [2, 3],
    armor: 1,
    fly: false,
    ability: 'spray',
    cannotTargetFlyers: true,
    volatile: true,
    blurb: 'Lobs caustic spray from range. Helpless up close.',
    abilityText: 'Acid Spray — 50% splash to enemies beside the target. Cannot hit flyers. Takes +50% from adjacent attackers.',
    beats: ['swarm', 'controller'],
    losesTo: ['skirmisher', 'assassin', 'swarm'],
    flavor: '"Range is a wall. Everything that climbs the wall is a problem."',
  },
  spider: {
    id: 'spider',
    name: 'Spider',
    role: 'controller',
    cost: 17,
    hp: 18,
    move: 4,
    dmg: 5,
    range: [1, 1],
    armor: 1,
    fly: false,
    climber: true,
    ability: 'web',
    abilityRange: 2,
    blurb: 'Climbs the rocks and turns your best unit into furniture.',
    abilityText: 'Web Shot (range 2) — target loses half movement and all abilities for a turn, and takes +15% damage.',
    beats: ['bruiser', 'artillery'],
    losesTo: ['artillery', 'swarm'],
    flavor: '"Patience, spun thin."',
  },
  bee: {
    id: 'bee',
    name: 'Bee',
    role: 'support',
    cost: 15,
    hp: 12,
    move: 4,
    dmg: 3,
    range: [1, 1],
    armor: 0,
    fly: true,
    ability: 'pollen',
    abilityRange: 2,
    blurb: 'Heals, hastens, and dies immediately if left alone.',
    abilityText: 'Pollen (range 2) — heal an ally 6, or grant +2 damage for a turn.',
    beats: [],
    losesTo: ['assassin', 'skirmisher'],
    flavor: '"Everything in the hive runs on what she carries."',
  },
};

export const UNIT_ORDER = ['ant', 'termite', 'rhino', 'mantis', 'wasp', 'bombardier', 'spider', 'bee'];

export function unitDef(type) {
  if (type === 'hive') return HIVE;
  return UNITS[type] || null;
}

export function roleLabel(role) {
  return {
    swarm: 'Swarm', bruiser: 'Bruiser', assassin: 'Assassin',
    skirmisher: 'Skirmisher', artillery: 'Artillery',
    controller: 'Controller', support: 'Support', hive: 'Hive',
  }[role] || role;
}

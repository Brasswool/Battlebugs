// Stage 3 entry point: menu, army builder, deployment, playable battle loop.
import {
  createGame, unitAt, unitById, sideUnits, FACTIONS, VICTORY, VICTORY_LABEL,
  PLAYER_LABEL, validateArmy, defaultArmy, autoPlacements, spawnUnit, despawnUnit,
  aiArmyFor, placementError, deployRows,
} from './core/state.js';
import {
  moveOptions, attackOptions, abilityOptions, applyAction, allLegalActions,
} from './core/actions.js';
import { damageBreakdown } from './core/combat.js';
import { idx, BOARD_W } from './core/board.js';
import { unitDef } from './data/units.js';
import { Renderer } from './render/renderer.js';
import { Fx } from './render/fx.js';
import { Hud } from './ui/hud.js';
import { ArmyBuilder } from './ui/army.js';
import { droneAction } from './ai/drone.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const canvas = $('board');
const renderer = new Renderer(canvas);
const fx = new Fx();
const hud = new Hud();
const menu = $('menu');
const hint = $('hint');
const endTurnBtn = $('endTurnBtn');
const nextBtn = $('nextBtn');
const skipBtn = $('skipBtn');
const deployCard = $('deployCard');

let state = null;
let selectedId = null;
let abilityMode = null;
let busy = false;        // AI is acting
let inputLock = false;   // an animation is in flight
let runToken = 0;        // invalidates stale AI loops after a restart
let humanSide = 0;       // -1 = auto-battle (both sides AI)
let hotseat = false;     // both sides are controlled on this device
let deploying = false;
let deploySide = 0;      // whose deployment zone is active
let pending = null;      // { army, aiArmy } while placing units
let selectedType = null; // species selected in the deployment tray
let activeArmySide = 0;  // army currently shown in the builder

const view = {
  time: 0,
  now: 0,
  selected: null,
  hoverTile: null,
  hoverUnit: null,
  moveTiles: null,
  moveSet: null,
  attackIds: null,
  abilityIds: null,
  abilities: [],
  pathPreview: null,
  units: [],
  fx,
};

const cfg = { mode: 'human', difficulty: 'normal', victory: VICTORY.HIVE, seed: 1337 };

const AI_DELAY = { easy: 540, normal: 360, hard: 280 };
const MODE_LABEL = { web: 'Web Shot', heal: 'Pollen · Heal', frenzy: 'Pollen · Frenzy' };

// ── menu wiring ───────────────────────────────────────────────

const armies = [defaultArmy(0), defaultArmy(1)];

const builder = new ArmyBuilder(document, (list) => {
  armies[activeArmySide] = list.slice();
  refreshStartBtn(list);
});

function switchArmySide(side) {
  if (side !== activeArmySide) {
    armies[activeArmySide] = builder.getArmy();
    activeArmySide = side;
    builder.setArmy(armies[side]);
  }
  document.querySelectorAll('#armySideSeg [data-army-side]').forEach((btn) => {
    btn.classList.toggle('on', Number(btn.dataset.armySide) === activeArmySide);
  });
  refreshStartBtn();
}

function refreshStartBtn(list = builder.getArmy()) {
  const btn = $('startBtn');
  if (!btn) return;
  armies[activeArmySide] = list.slice();

  if (cfg.mode === 'hotseat') {
    const checks = armies.map((army) => validateArmy(army));
    const badSide = checks.findIndex((v) => !v.ok);
    btn.disabled = badSide >= 0;
    btn.textContent = 'Deploy both armies';
    btn.title = badSide >= 0
      ? `${PLAYER_LABEL[badSide]}: ${checks[badSide].error}`
      : 'Both armies are ready';
    return;
  }

  const v = validateArmy(list);
  btn.disabled = !v.ok;
  btn.textContent = cfg.mode === 'spectate' ? 'Start auto-battle' : 'Deploy army';
  btn.title = v.ok ? '' : v.error;
}

function wireSeg(id, key, dataKey, onChange) {
  document.querySelectorAll(`#${id} button`).forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      cfg[key] = btn.dataset[dataKey];
      onChange?.(cfg[key]);
      refreshStartBtn();
    });
  });
}

function refreshVictoryNote() {
  const el = $('victoryNote');
  if (!el) return;
  el.textContent = cfg.victory === VICTORY.ELIMINATION
    ? 'Wipe out every enemy unit — Hives are protected.'
    : 'Break the enemy Hive to win.';
}

function onModeChange() {
  const isHotseat = cfg.mode === 'hotseat';
  $('armySideField').classList.toggle('hidden', !isHotseat);
  if (!isHotseat && activeArmySide !== 0) switchArmySide(0);
  refreshStartBtn();
}

document.querySelectorAll('#armySideSeg [data-army-side]').forEach((btn) => {
  btn.addEventListener('click', () => switchArmySide(Number(btn.dataset.armySide)));
});

wireSeg('modeSeg', 'mode', 'mode', onModeChange);
wireSeg('diffSeg', 'difficulty', 'diff');
wireSeg('victorySeg', 'victory', 'victory', refreshVictoryNote);
refreshVictoryNote();
onModeChange();

$('rollSeed').addEventListener('click', () => {
  $('seedInput').value = String(Math.floor(Math.random() * 899999) + 1);
});

$('seedInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startBattle();
});

$('startBtn').addEventListener('click', () => startBattle());

$('newMapBtn').addEventListener('click', () => {
  cfg.seed = Math.floor(Math.random() * 899999) + 1;
  $('seedInput').value = String(cfg.seed);
  startBattle();
});

$('menuBtn').addEventListener('click', () => openMenu());

$('endTurnBtn').addEventListener('click', () => endTurn());
$('nextBtn').addEventListener('click', () => selectNextReady());
$('skipBtn').addEventListener('click', () => skipUnit());

// ── deployment panel wiring ───────────────────────────────────

$('autoDeployBtn').addEventListener('click', autoPlaceDeploy);
$('clearDeployBtn').addEventListener('click', clearDeploy);
$('confirmDeployBtn').addEventListener('click', confirmDeploy);
$('cancelDeployBtn').addEventListener('click', openMenu);

// ── start / deployment / battle ───────────────────────────────

function startBattle() {
  cfg.seed = Math.max(1, parseInt($('seedInput').value, 10) || 1);
  const activeList = builder.getArmy();
  armies[activeArmySide] = activeList;
  const isHotseat = cfg.mode === 'hotseat';

  if (isHotseat) {
    for (const side of [0, 1]) {
      const v = validateArmy(armies[side]);
      if (!v.ok) {
        switchArmySide(side);
        $('armyValid').textContent = `${PLAYER_LABEL[side]}: ${v.error}`;
        $('armyValid').classList.add('bad');
        return;
      }
    }
  } else {
    const v = validateArmy(activeList);
    if (!v.ok) {
      $('armyValid').textContent = v.error;
      $('armyValid').classList.add('bad');
      return;
    }
  }

  runToken++;
  busy = false;
  inputLock = false;
  selectedId = null;
  abilityMode = null;
  selectedType = null;
  deploySide = 0;
  fx.reset();

  hotseat = isHotseat;
  const army = isHotseat ? armies[0].slice() : activeList;
  const aiArmy = isHotseat ? armies[1].slice() : aiArmyFor(cfg.seed);
  humanSide = cfg.mode === 'spectate' ? -1 : 0;

  if (cfg.mode === 'spectate') {
    beginBattle({ army, aiArmy, placements: null });
  } else {
    beginDeploy({ army, aiArmy });
  }
  menu.classList.add('hidden');
}

function beginDeploy({ army, aiArmy }) {
  pending = { army: army.slice(), aiArmy: aiArmy.slice() };

  // Human vs AI: hives + the AI army are already on the board. Hot seat:
  // both colonies are placed in turn, starting with Player 1.
  state = createGame({
    seed: cfg.seed,
    mode: hotseat ? 'hotseat' : 'human',
    victory: cfg.victory,
    mapSeed: cfg.seed,
    armies: hotseat ? [[], []] : [[], pending.aiArmy],
    placements: hotseat ? [[], []] : [[], null],
  });
  deploying = true;
  selectedId = null;
  abilityMode = null;
  selectedType = null;
  view.hoverTile = null;
  view.hoverUnit = null;
  view.units = state.units;
  const modeTag = hotseat ? ' · Hot seat' : '';
  hud.mapMeta.textContent =
    `${state.mapName} · seed ${state.seed} · ${VICTORY_LABEL[cfg.victory]}${modeTag}`;
  document.body.classList.add('deploying');
  deployCard.classList.remove('hidden');
  renderer.resize();
  updateDeployView();
  refresh();
}

function beginBattle({ army, aiArmy, placements }) {
  state = createGame({
    seed: cfg.seed,
    mode: cfg.mode,
    victory: cfg.victory,
    mapSeed: cfg.seed,
    armies: [army, aiArmy],
    placements,
  });
  deploying = false;
  pending = null;
  selectedId = null;
  abilityMode = null;
  selectedType = null;
  fx.reset();
  view.hoverTile = null;
  view.hoverUnit = null;
  view.units = state.units;
  document.body.classList.remove('deploying');
  deployCard.classList.add('hidden');
  renderer.resize();
  updateOverlays();
  refresh();

  const token = runToken;
  if (humanSide === -1) {
    // let the board breathe for a moment, then the colonies fight themselves
    setTimeout(() => runAiSide(token), 650);
  }
}

function openMenu() {
  runToken++;
  busy = false;
  inputLock = false;
  if (deploying) {
    deploying = false;
    pending = null;
    selectedType = null;
    state = null;
    selectedId = null;
    abilityMode = null;
    updateDeployView();
    view.units = [];
  }
  document.body.classList.remove('deploying');
  deployCard.classList.add('hidden');
  menu.classList.remove('hidden');
  refreshStartBtn();
}

// ── deployment interactions ───────────────────────────────────

function deployList(side = deploySide) {
  if (!pending) return [];
  return side === 0 ? pending.army : pending.aiArmy;
}

function deployUnits(side = deploySide) {
  if (!state) return [];
  return state.units.filter((u) => u.side === side && !u.isHive);
}

function deployName(side = deploySide) {
  return hotseat ? `${PLAYER_LABEL[side]} · ${FACTIONS[side].name}` : FACTIONS[side].name;
}

function remainingByType() {
  const left = {};
  for (const t of deployList()) left[t] = (left[t] || 0) + 1;
  for (const u of deployUnits()) left[u.type] = (left[u.type] || 0) - 1;
  return left;
}

function deployableTiles() {
  const out = [];
  for (const y of deployRows(deploySide)) {
    for (let x = 0; x < BOARD_W; x++) {
      if (!placementError(state, deploySide, selectedType || 'ant', x, y)) out.push(idx(x, y));
    }
  }
  return out;
}

function updateDeployView() {
  view.selected = null;
  view.attackIds = null;
  view.abilityIds = null;
  view.abilities = [];
  view.pathPreview = null;
  view.moveSet = null;
  view.units = state ? state.units : [];
  view.moveTiles = state && selectedType ? deployableTiles() : null;
}

function renderDeploy() {
  if (!pending || !state) return;
  const placed = deployUnits();
  const list = deployList();
  const total = list.length;
  const left = remainingByType();

  $('deployTitle').textContent = hotseat ? `Deploy · ${PLAYER_LABEL[deploySide]}` : 'Deploy';
  $('deployCount').textContent = `${placed.length} / ${total}`;
  $('deployFill').style.width = `${total ? (placed.length / total) * 100 : 0}%`;

  const types = [];
  for (const t of list) if (!types.includes(t)) types.push(t);
  $('deployTray').innerHTML = types
    .filter((t) => (left[t] || 0) > 0)
    .map((t) => {
      const def = unitDef(t);
      const on = selectedType === t ? ' on' : '';
      return `<button class="traybtn role-${def.role}${on}" data-place="${t}">
        <span>${def.name}</span>
        <span class="tcost">${def.cost} pts</span>
        <span class="tleft">×${left[t]} left</span>
      </button>`;
    })
    .join('');

  $('deployTray').querySelectorAll('[data-place]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedType = selectedType === btn.dataset.place ? null : btn.dataset.place;
      updateDeployView();
      refresh();
    });
  });

  const missing = total - placed.length;
  const note = $('deployNote');
  const who = hotseat ? `${PLAYER_LABEL[deploySide]} — ` : '';
  note.classList.toggle('bad', missing > 0 && !!selectedType);
  if (!total) note.textContent = 'No army selected.';
  else if (missing > 0) {
    note.textContent = selectedType
      ? `${who}${unitDef(selectedType).name} selected — click a highlighted tile.`
      : `${who}${missing} unit${missing === 1 ? '' : 's'} left to place.`;
  } else if (hotseat && deploySide === 0) {
    note.textContent = 'Player 1 ready — continue to Player 2.';
  } else if (hotseat) {
    note.textContent = 'Both armies placed — start the battle.';
  } else {
    note.textContent = 'Ready — confirm deployment.';
  }

  $('confirmDeployBtn').disabled = placed.length !== total;
  $('confirmDeployBtn').textContent = hotseat
    ? (deploySide === 0 ? 'Continue to Player 2' : 'Start battle')
    : 'Confirm deployment';
  updateHint();
}

function onDeployClick(tile) {
  const clicked = unitAt(state, tile.x, tile.y);

  // Click a placed unit to pick it back up.
  if (clicked && clicked.side === deploySide && !clicked.isHive) {
    selectedType = clicked.type;
    despawnUnit(state, clicked.id);
    updateDeployView();
    refresh();
    return;
  }

  if (!selectedType) {
    $('deployNote').textContent = 'Pick a species from the tray first.';
    $('deployNote').classList.add('bad');
    return;
  }

  const res = spawnUnit(state, deploySide, selectedType, tile.x, tile.y);
  if (!res.ok) {
    $('deployNote').textContent = res.error;
    $('deployNote').classList.add('bad');
    return;
  }

  if (!(remainingByType()[selectedType] > 0)) selectedType = null;
  updateDeployView();
  refresh();
}

function autoPlaceDeploy() {
  if (!state || !pending) return;
  for (const u of deployUnits()) despawnUnit(state, u.id);
  try {
    for (const p of autoPlacements(state, deploySide, deployList())) {
      spawnUnit(state, deploySide, p.type, p.x, p.y);
    }
    selectedType = null;
  } catch (err) {
    $('deployNote').textContent = err.message;
    $('deployNote').classList.add('bad');
  }
  updateDeployView();
  refresh();
}

function clearDeploy() {
  if (!state) return;
  for (const u of deployUnits()) despawnUnit(state, u.id);
  selectedType = null;
  updateDeployView();
  refresh();
}

function confirmDeploy() {
  if (!state || !pending) return;
  const placed = deployUnits();
  if (placed.length !== deployList().length) {
    renderDeploy();
    return;
  }

  if (hotseat && deploySide === 0) {
    deploySide = 1;
    selectedType = null;
    updateDeployView();
    refresh();
    return;
  }

  const placements = [
    deployUnits(0).map((u) => ({ type: u.type, x: u.x, y: u.y })),
    hotseat ? deployUnits(1).map((u) => ({ type: u.type, x: u.x, y: u.y })) : null,
  ];
  const army = pending.army.slice();
  const aiArmy = pending.aiArmy.slice();
  beginBattle({ army, aiArmy, placements });
}

// ── selection + overlays ──────────────────────────────────────

function updateOverlays() {
  view.selected = selectedId;
  view.moveTiles = null;
  view.moveSet = null;
  view.attackIds = null;
  view.abilityIds = null;
  view.abilities = [];
  view.pathPreview = null;
  view.units = state ? state.units : [];

  if (!state || !selectedId) return;
  const u = state.units.find((x) => x.id === selectedId && x.hp > 0);
  if (!u) {
    selectedId = null;
    view.selected = null;
    return;
  }
  const playableSide = (humanSide === -1 || hotseat) ? state.side : humanSide;
  if (u.isHive || u.side !== state.side || state.side !== playableSide || state.winner !== null) return;

  const moves = moveOptions(state, u.id);
  view.moveTiles = moves.map((m) => m.i);
  view.moveSet = new Map(moves.map((m) => [m.i, m.path]));
  view.attackIds = attackOptions(state, u.id).map((t) => t.id);

  const ab = abilityOptions(state, u.id);
  view.abilities = abilityMode ? ab.filter((a) => a.mode === abilityMode) : ab;
  view.abilityIds = [...new Set(view.abilities.map((a) => a.target))];
}

function selectUnit(id) {
  if (!state || deploying) return;
  const u = id ? state.units.find((x) => x.id === id && x.hp > 0) : null;
  selectedId = u ? u.id : null;
  abilityMode = null;
  updateOverlays();
  refresh();
}

function humanControlsCurrentSide() {
  return !!state && !deploying && !busy && state.winner === null &&
    humanSide !== -1 && (hotseat || state.side === humanSide);
}

function selectNextReady() {
  if (!humanControlsCurrentSide()) return;
  const side = state.side;
  const ready = sideUnits(state, side).filter((u) => !(u.moved && u.acted));
  if (!ready.length) return;
  const at = ready.findIndex((u) => u.id === selectedId);
  selectUnit(ready[(at + 1) % ready.length].id);
}

function skipUnit() {
  if (!humanControlsCurrentSide()) return;
  const u = selectedId ? unitById(state, selectedId) : null;
  if (!u || u.side !== state.side) return;
  u.moved = true;
  u.acted = true;
  selectedId = null;
  abilityMode = null;
  updateOverlays();
  refresh();
  maybeAutoEnd();
}

function toggleAbility(mode) {
  if (!humanControlsCurrentSide()) return;
  abilityMode = abilityMode === mode ? null : mode;
  updateOverlays();
  refresh();
}

// ── orders ────────────────────────────────────────────────────

function uiState() {
  const over = !state || state.winner !== null;
  const myTurn = !over && humanSide !== -1 && (hotseat || state.side === humanSide) && !busy;
  const u = selectedId && state ? state.units.find((x) => x.id === selectedId) : null;
  const mine = !!(u && !u.isHive && u.side === state?.side);
  const ready = over ? 0 : sideUnits(state, state.side).filter((x) => !(x.moved && x.acted)).length;

  const abilityModes = [];
  if (myTurn && mine && !u.acted) {
    for (const mode of new Set(abilityOptions(state, u.id).map((a) => a.mode))) {
      abilityModes.push({ mode });
    }
  }
  const attackCount = myTurn && mine && !u.acted ? attackOptions(state, u.id).length : 0;

  return {
    phase: over ? 'over' : humanSide === -1 ? 'auto' : myTurn ? 'human' : 'ai',
    busy,
    abilityMode,
    abilityModes,
    attackCount,
    ready,
    canEnd: myTurn,
    canNext: myTurn && ready > 0,
    canSkip: myTurn && mine && !(u.moved && u.acted),
    onAbility: toggleAbility,
    onNext: selectNextReady,
    onSkip: skipUnit,
  };
}

function refresh() {
  if (!state) return;
  view.units = state.units;
  view.selected = selectedId;
  if (deploying) {
    renderDeploy();
    return;
  }
  hud.render(state, selectedId, uiState());
  updateHint();
}

function updateHint() {
  if (!state) return;
  if (deploying) {
    if (!pending) return;
    const placed = deployUnits().length;
    const total = deployList().length;
    const who = hotseat ? `${deployName()} — ` : '';
    if (placed >= total) {
      hint.textContent = hotseat
        ? (deploySide === 0
          ? 'Player 1 ready — continue to Player 2.'
          : 'Both armies placed — start the battle.')
        : 'All units placed — confirm deployment.';
    } else if (selectedType) {
      hint.textContent = `${who}placing ${unitDef(selectedType).name} — click a highlighted tile in your rows.`;
    } else {
      hint.textContent = hotseat
        ? `${who}pick a species from the tray, or auto-place.`
        : 'Deploy your colony — pick a species from the tray, or auto-place.';
    }
    return;
  }
  if (state.winner !== null) {
    hint.textContent = 'Battle over — open the menu to fight again.';
    return;
  }
  if (abilityMode) {
    hint.textContent = `Choose a target for ${MODE_LABEL[abilityMode] || abilityMode} — click the ability again to cancel.`;
    return;
  }
  if (humanSide === -1) {
    hint.textContent = 'Auto-battle — the drone AI is commanding both colonies.';
    return;
  }
  if (!hotseat && state.side !== humanSide) {
    hint.textContent = `${FACTIONS[state.side].name} is choosing…`;
    return;
  }

  const side = hotseat ? state.side : humanSide;
  const lead = hotseat ? `${PLAYER_LABEL[side]} (${FACTIONS[side].name}) — ` : '';
  const ready = sideUnits(state, side).filter((u) => !(u.moved && u.acted));
  if (!ready.length) {
    hint.textContent = `${lead}every unit has acted — end the turn.`;
    return;
  }
  const u = selectedId ? state.units.find((x) => x.id === selectedId) : null;
  if (!u || u.isHive || u.side !== side) {
    hint.textContent = `${lead}click a unit to give orders`;
  } else if (u.moved && u.acted) {
    hint.textContent = `${lead}this unit is spent — pick the next unit, or end the turn`;
  } else if (u.moved) {
    hint.textContent = `${lead}moved — red = attack · purple = ability target`;
  } else if (u.acted) {
    hint.textContent = `${lead}action spent — blue = move`;
  } else {
    hint.textContent = `${lead}blue = move · red = attack · purple = ability target`;
  }
}

// ── input ─────────────────────────────────────────────────────

canvas.addEventListener('click', onCanvasClick);

async function onCanvasClick(e) {
  if (!state || busy || inputLock) return;
  const tile = renderer.tileFromPoint(e.clientX, e.clientY);
  if (!tile) return;
  if (deploying) {
    onDeployClick(tile);
    return;
  }
  const clicked = unitAt(state, tile.x, tile.y);
  const myTurn = humanSide !== -1 && state.winner === null &&
    (hotseat || state.side === humanSide);

  if (!myTurn) {
    if (clicked) selectUnit(clicked.id);
    return;
  }

  if (abilityMode && selectedId) {
    if (clicked && view.abilityIds && view.abilityIds.includes(clicked.id)) {
      const mode = abilityMode;
      await withInputLock(async () => {
        const res = await performAction({ kind: 'ability', unit: selectedId, mode, target: clicked.id });
        if (!res || !res.ok) hint.textContent = res?.error || 'That ability cannot be used there.';
        abilityMode = null;
        updateOverlays();
        refresh();
        await maybeAutoEnd();
      });
    } else {
      abilityMode = null;
      updateOverlays();
      refresh();
    }
    return;
  }

  if (clicked && clicked.side === state.side) {
    selectUnit(clicked.id);
    return;
  }

  const selected = selectedId ? unitById(state, selectedId) : null;

  if (clicked && selected && view.attackIds && view.attackIds.includes(clicked.id)) {
    await withInputLock(async () => {
      const res = await performAction({ kind: 'attack', unit: selected.id, target: clicked.id });
      if (!res || !res.ok) hint.textContent = res?.error || 'That attack is not legal.';
      await maybeAutoEnd();
    });
    return;
  }

  const ti = idx(tile.x, tile.y);
  if (selected && view.moveSet && view.moveSet.has(ti)) {
    await withInputLock(async () => {
      const res = await performAction({ kind: 'move', unit: selected.id, x: tile.x, y: tile.y });
      if (!res || !res.ok) hint.textContent = res?.error || 'That move is not legal.';
      await maybeAutoEnd();
    });
    return;
  }

  if (!clicked) {
    selectedId = null;
    abilityMode = null;
    updateOverlays();
    refresh();
  }
}

canvas.addEventListener('mousemove', (e) => {
  if (!state) return;
  const tile = renderer.tileFromPoint(e.clientX, e.clientY);
  view.hoverTile = tile;
  view.pathPreview = null;

  if (deploying) {
    view.hoverUnit = null;
    const over = tile ? unitAt(state, tile.x, tile.y) : null;
    const pickUp = !!(over && over.side === deploySide && !over.isHive);
    const canPlace = !!(tile && selectedType && !placementError(state, deploySide, selectedType, tile.x, tile.y));
    canvas.style.cursor = pickUp || canPlace ? 'pointer' : 'default';
    return;
  }

  const u = tile ? unitAt(state, tile.x, tile.y) : null;
  view.hoverUnit = u ? u.id : null;
  canvas.style.cursor = u ? 'pointer' : 'default';
  if (hint.textContent.includes('→')) updateHint();

  if (!tile) return;

  if (!u && view.moveSet && view.moveSet.has(idx(tile.x, tile.y))) {
    view.pathPreview = view.moveSet.get(idx(tile.x, tile.y));
    canvas.style.cursor = 'pointer';
  }

  if (u && selectedId && view.attackIds && view.attackIds.includes(u.id)) {
    const att = unitById(state, selectedId);
    const tDef = unitDef(u.type);
    if (att) {
      const bd = damageBreakdown(state, att, u);
      const kills = bd.amount >= u.hp;
      hint.textContent = `${unitDef(att.type).name} → ${tDef.name}: ${bd.amount} damage${kills ? ' · lethal' : ''}`;
    }
  }
});

canvas.addEventListener('mouseleave', () => {
  view.hoverTile = null;
  view.hoverUnit = null;
  view.pathPreview = null;
  updateHint();
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !state) return;
  if (deploying) {
    if (selectedType) {
      selectedType = null;
      updateDeployView();
      refresh();
    } else {
      openMenu();
    }
    return;
  }
  if (abilityMode) {
    abilityMode = null;
    updateOverlays();
    refresh();
  } else if (selectedId) {
    selectUnit(null);
  }
});

// ── action pipeline ───────────────────────────────────────────

async function withInputLock(fn) {
  inputLock = true;
  try {
    await fn();
  } finally {
    inputLock = false;
    refresh();
  }
}

function preSnapshot(action) {
  if (action.kind === 'move') {
    const u = unitById(state, action.unit);
    const opt = moveOptions(state, action.unit).find((o) => o.x === action.x && o.y === action.y);
    return {
      unit: u ? { id: u.id, x: u.x, y: u.y } : null,
      path: opt ? opt.path.slice() : null,
    };
  }
  if (action.kind === 'attack' || action.kind === 'ability') {
    const t = state.units.find((x) => x.id === action.target);
    return { targetPos: t ? { x: t.x, y: t.y } : null };
  }
  return {};
}

async function performAction(action) {
  if (!state || state.winner !== null) return { ok: false, error: 'Battle over.' };
  const pre = preSnapshot(action);
  const res = applyAction(state, action);
  if (!res || !res.ok) {
    console.warn('[chitin] rejected action', action, res && res.error);
    return res;
  }

  await animate(res.events || [], pre, action);
  clearSpentSelection();
  refresh();
  return res;
}

async function animate(events, pre, action) {
  const instant = humanSide === -1;
  for (const ev of events) {
    if (ev.type === 'move' && pre.unit && pre.path) {
      const u = unitById(state, action.unit);
      if (u && !instant) {
        await fx.moveAlong(u, pre.unit, pre.path);
      } else if (u) {
        fx.offsets.delete(u.id);
      }
    } else if (ev.type === 'attack') {
      const a = unitById(state, action.unit);
      const tp = pre.targetPos || (a ? { x: a.x, y: a.y } : { x: 0, y: 0 });
      if (a && !instant) await fx.lunge(a, tp);
      fx.hit(tp.x, tp.y, ev.amount);
      await wait(instant ? 30 : 110);
    } else if (ev.type === 'splash') {
      const o = state.units.find((x) => x.id === ev.unit);
      if (o) fx.hit(o.x, o.y, ev.amount);
    } else if (ev.type === 'knockback') {
      const o = state.units.find((x) => x.id === ev.unit);
      if (o) fx.note(o.x, o.y, 'Knocked back', '#ffd36b');
    } else if (ev.type === 'heal') {
      const o = state.units.find((x) => x.id === ev.unit);
      if (o) fx.heal(o.x, o.y, ev.amount);
    } else if (ev.type === 'frenzy') {
      const o = state.units.find((x) => x.id === ev.unit);
      if (o) fx.note(o.x, o.y, '+2 DMG', '#ffd36b');
    } else if (ev.type === 'web') {
      const o = state.units.find((x) => x.id === ev.unit);
      if (o) {
        fx.note(o.x, o.y, 'Webbed', '#dfe9f0');
        fx.puffs.push({ x: o.x, y: o.y, born: performance.now(), life: 620, color: '220,235,245' });
      }
    }
  }
  if (!instant) await wait(130);
}

function clearSpentSelection() {
  if (!selectedId) return;
  const u = unitById(state, selectedId);
  if (!u || (u.side === state.side && u.moved && u.acted)) {
    selectedId = null;
    abilityMode = null;
  }
  updateOverlays();
}

async function maybeAutoEnd() {
  if (!state || state.winner !== null || humanSide === -1) return;
  if (!(hotseat || state.side === humanSide)) return;
  const side = state.side;
  const mine = sideUnits(state, side);
  if (!mine.length) return;
  if (!mine.every((u) => u.moved && u.acted)) return;
  await wait(320);
  // Only end if the same side is still up — a hot-seat handover may have
  // happened while we waited.
  if (state.side === side && state.winner === null && !busy) {
    await endTurn();
  }
}

async function endTurn() {
  if (!state || deploying || state.winner !== null || busy || inputLock) return;
  if (humanSide !== -1 && !hotseat && state.side !== humanSide) return;
  const token = runToken;
  selectedId = null;
  abilityMode = null;
  updateOverlays();
  await performAction({ kind: 'end' });
  refresh();
  if (state.winner !== null) return;
  // Hot seat: the other human is always next, so never hand over to the AI.
  if (!hotseat && state.side !== humanSide) await runAiSide(token);
}

// ── AI turn ───────────────────────────────────────────────────

function chooseAiAction() {
  if (cfg.difficulty === 'easy' && state.rng.chance(0.35)) {
    const acts = allLegalActions(state).filter((a) => a.kind !== 'end');
    if (acts.length) return acts[state.rng.int(acts.length)];
  }
  return droneAction(state, state.rng);
}

function aiDelay() {
  if (humanSide === -1) return 160;
  return AI_DELAY[cfg.difficulty] ?? 360;
}

async function runAiSide(token) {
  if (token !== runToken) return;
  if (hotseat) return;
  if (!state || state.winner !== null || state.side === humanSide) return;
  busy = true;
  selectedId = null;
  abilityMode = null;
  updateOverlays();
  refresh();

  try {
    let guard = 0;
    while (state.winner === null && state.side !== humanSide && guard++ < 1200) {
      if (token !== runToken) return;

      const act = chooseAiAction();
      let res;
      if (!act || act.kind === 'end') {
        res = await performAction({ kind: 'end' });
      } else {
        res = await performAction(act);
      }
      if (token !== runToken) return;

      if (!res || !res.ok) {
        // never spin on a rejected action — concede the turn instead
        await performAction({ kind: 'end' });
      }
      if (state.winner !== null || state.side === humanSide) break;
      await wait(aiDelay());
    }
  } catch (err) {
    console.error('[chitin] AI turn failed', err);
  } finally {
    if (token === runToken) {
      busy = false;
      updateOverlays();
      refresh();
    }
  }
}

// ── render loop ───────────────────────────────────────────────

function frame(ms) {
  view.time = ms / 1000;
  view.now = ms;
  if (state) renderer.draw(state, view);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

let resizeTimer = null;
function scheduleResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderer.resize(), 80);
}
window.addEventListener('resize', scheduleResize);
if (window.ResizeObserver) {
  new ResizeObserver(scheduleResize).observe(canvas.parentElement);
}

// ── environment guards ────────────────────────────────────────

if (location.protocol === 'file:') {
  $('fileWarn').classList.remove('hidden');
}

window.__chitin = {
  get state() { return state; },
  get busy() { return busy; },
  get deploying() { return deploying; },
  get pending() { return pending; },
  builder,
  renderer,
  view,
  fx,
  selectUnit,
  endTurn,
  startBattle,
  confirmDeploy,
  autoPlaceDeploy,
};

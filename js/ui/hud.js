// Sidebar HUD. Re-rendered on demand (selection, turn change, actions).
import { FACTIONS, VICTORY, VICTORY_LABEL, PLAYER_LABEL, armyValue, sideUnits, unitsRemaining } from '../core/state.js';
import { unitDef, roleLabel, COUNTER } from '../data/units.js';
import { effectiveMove } from '../core/board.js';

const KIND_CLASS = {
  attack: 'l-attack',
  death: 'l-death',
  ability: 'l-ability',
  win: 'l-win',
  turn: 'l-turn',
  system: 'l-system',
  move: 'l-move',
};

const MODE_LABEL = {
  web: 'Web Shot',
  heal: 'Pollen · Heal',
  frenzy: 'Pollen · Frenzy',
};

export class Hud {
  constructor(doc = document) {
    this.doc = doc;
    this.turnCard = doc.getElementById('turnCard');
    this.hiveCard = doc.getElementById('hiveCard');
    this.inspector = doc.getElementById('inspector');
    this.actions = doc.getElementById('actions');
    this.logList = doc.getElementById('log');
    this.mapMeta = doc.getElementById('mapMeta');
    this.endTurnBtn = doc.getElementById('endTurnBtn');
    this.nextBtn = doc.getElementById('nextBtn');
    this.skipBtn = doc.getElementById('skipBtn');
  }

  render(state, selectedId = null, ui = {}) {
    if (!state) return;
    const modeTag = state.mode === 'hotseat' ? ' · Hot seat' : '';
    this.mapMeta.textContent =
      `${state.mapName} · seed ${state.seed} · ${VICTORY_LABEL[state.victory] || VICTORY_LABEL.hive}${modeTag}`;
    this.renderTurn(state);
    this.renderHives(state);
    this.renderInspector(state, selectedId);
    this.renderActions(state, selectedId, ui);
    this.renderLog(state);

    if (this.endTurnBtn) {
      this.endTurnBtn.disabled = !ui.canEnd;
      const who = state.mode === 'hotseat' ? ` (${PLAYER_LABEL[state.side]})` : '';
      this.endTurnBtn.textContent = state.winner !== null ? 'Battle over' : `Pass${who}`;
      this.endTurnBtn.title = ui.canEnd
        ? 'End this activation — control passes to the other player'
        : 'Not your turn';
    }
    if (this.nextBtn) this.nextBtn.disabled = !ui.canNext;
    if (this.skipBtn) this.skipBtn.disabled = !ui.canSkip;
  }

  renderTurn(state) {
    if (!this.turnCard) return;
    const f = FACTIONS[state.side];
    const hotseat = state.mode === 'hotseat';
    if (state.winner !== null) {
      const eliminated = state.winReason === 'elimination';
      const wonBy = hotseat && state.winner >= 0
        ? `${PLAYER_LABEL[state.winner]} (${FACTIONS[state.winner].name})`
        : state.winner >= 0 ? FACTIONS[state.winner].name : '';
      const txt = state.winner === -1
        ? (eliminated ? 'Mutual annihilation — the field is empty.' : 'Stalemate — the field is even.')
        : eliminated
          ? `${wonBy} has wiped out the enemy colony.`
          : `${wonBy} holds the field.`;
      const reason = state.winReason === 'hive'
        ? 'Hive destroyed'
        : eliminated ? 'Enemy colony eliminated' : 'Turn limit reached';
      this.turnCard.innerHTML = `<div class="cardhead"><h3>Result</h3></div>
        <div class="result">${txt}</div>
        <div class="mini">${reason}</div>`;
      return;
    }
    const ready = unitsRemaining(state, state.side);
    const total = sideUnits(state, state.side).length;
    const who = hotseat ? `${PLAYER_LABEL[state.side]} · ` : '';
    this.turnCard.innerHTML = `
      <div class="cardhead"><h3>Turn</h3><span class="round">Round ${state.round}</span></div>
      <div class="turnline">
        <span class="dot" style="background:${f.color}"></span>
        <span class="turnname" style="color:${f.color}">${who}${f.name}</span>
        <span class="mini">to activate</span>
      </div>
      <div class="meter"><span style="width:${total ? (ready / total) * 100 : 0}%"></span></div>
      <div class="mini">${ready} of ${total} units ready</div>`;
  }

  renderHives(state) {
    if (!this.hiveCard) return;
    const eliminated = state.victory === VICTORY.ELIMINATION;
    const rows = state.hives.map((h) => {
      const f = FACTIONS[h.side];
      if (eliminated) {
        const living = sideUnits(state, h.side).length;
        return `
          <div class="hiverow">
            <div class="hivelabel"><span class="dot" style="background:${f.color}"></span>${f.name}</div>
            <div class="colonycount">${living} unit${living === 1 ? '' : 's'} left</div>
            <div class="hpnum">safe</div>
          </div>`;
      }
      const ratio = Math.max(0, h.hp / h.maxHp);
      return `
        <div class="hiverow">
          <div class="hivelabel"><span class="dot" style="background:${f.color}"></span>${f.name}</div>
          <div class="hpbar"><span style="width:${ratio * 100}%;background:${f.color}"></span></div>
          <div class="hpnum">${Math.ceil(h.hp)}/${h.maxHp}</div>
        </div>`;
    }).join('');
    const values = [0, 1].map((s) => `<span class="chip">${FACTIONS[s].name} ${Math.round(armyValue(state, s))}</span>`).join('');
    this.hiveCard.innerHTML = `<div class="cardhead"><h3>${eliminated ? 'Colonies' : 'Hives'}</h3></div>${rows}
      <div class="chips">${values}</div>`;
  }

  renderInspector(state, selectedId) {
    if (!this.inspector) return;
    const u = selectedId ? state.units.find((x) => x.id === selectedId) : null;
    if (!u) {
      this.inspector.innerHTML = `<div class="cardhead"><h3>Inspector</h3></div>
        <p class="hintbody">Click any insect on the board to inspect its reach, stats and ability.</p>
        <p class="hintbody dim">Ring colours: <span class="k teal">Hollow</span> vs <span class="k orange">Ember</span>.</p>`;
      return;
    }
    const def = unitDef(u.type);
    const f = FACTIONS[u.side];
    const statuses = [];
    if (u.statuses.entangled > 0) statuses.push('<span class="chip warn">Webbed</span>');
    if (u.statuses.frenzy > 0) statuses.push('<span class="chip good">Frenzied</span>');
    if (!statuses.length) statuses.push('<span class="chip dim">No status</span>');

    const role = roleLabel(def.role);
    const prey = Object.entries(COUNTER[def.role] || {})
      .filter(([, m]) => m > 1.05)
      .map(([r, m]) => `${roleLabel(r)} ×${m.toFixed(2)}`).join(' · ') || '—';

    const isHive = u.isHive;
    this.inspector.innerHTML = `
      <div class="cardhead">
        <h3>${def.name}</h3>
        <span class="round" style="color:${f.color}">${f.name}</span>
      </div>
      <div class="roline"><span class="chip">${role}</span>${isHive
        ? `<span class="chip">${state.victory === VICTORY.ELIMINATION ? 'Hive · protected' : 'Objective'}</span>`
        : `<span class="chip">${def.cost} pts</span>`}</div>
      ${isHive ? `<div class="statgrid">
        <div><span>HP</span><b>${Math.ceil(u.hp)}/${u.maxHp}</b></div>
        <div><span>Armour</span><b>${def.armor}</b></div>
        <div><span>Move</span><b>0</b></div>
      </div>
      <p class="ability">${state.victory === VICTORY.ELIMINATION
        ? 'The Hive cannot be attacked in this battle. Wipe out every enemy unit instead.'
        : def.blurb}</p>`
      : `<div class="statgrid">
        <div><span>HP</span><b>${Math.ceil(u.hp)}/${u.maxHp}</b></div>
        <div><span>Move</span><b>${effectiveMove(u)}${u.statuses.entangled ? ` <i>(was ${def.move})</i>` : ''}</b></div>
        <div><span>Range</span><b>${def.range[0] === def.range[1] ? def.range[0] : def.range.join('–')}</b></div>
        <div><span>Damage</span><b>${def.dmg}</b></div>
        <div><span>Armour</span><b>${def.armor}</b></div>
        <div><span>Flying</span><b>${def.fly ? 'Yes' : 'No'}</b></div>
      </div>
      <p class="ability">${def.abilityText}</p>
      <div class="prey"><span>Prey</span>${prey}</div>`}
      <div class="chips">${statuses.join('')}</div>`;
  }

  renderActions(state, selectedId, ui) {
    const el = this.actions;
    if (!el) return;

    if (state.winner !== null) {
      el.innerHTML = `<div class="cardhead"><h3>Orders</h3></div>
        <p class="hintbody dim">The battle is decided. Open the menu to fight again.</p>`;
      return;
    }

    if (ui.phase === 'auto' || ui.phase === 'ai') {
      el.innerHTML = `<div class="cardhead"><h3>Orders</h3><span class="round">${ui.phase === 'auto' ? 'Auto' : 'AI'}</span></div>
        <div class="thinking"><span class="pulse"></span>${FACTIONS[state.side].name} is choosing…</div>`;
      return;
    }

    const u = selectedId ? state.units.find((x) => x.id === selectedId) : null;
    const mine = u && !u.isHive && u.side === state.side;
    const lines = [];
    const buttons = [];

    if (!u) {
      lines.push('<div class="orderhint">Select one of your units to give orders.</div>');
    } else if (!mine) {
      lines.push(`<div class="orderhint dim">${FACTIONS[u.side].name} unit — inspection only.</div>`);
    } else if (u.moved && u.acted) {
      lines.push('<div class="orderhint dim">This unit has finished its activation.</div>');
    } else {
      if (!u.moved) lines.push('<div class="orderhint"><b>Move</b> — click a blue tile</div>');
      if (!u.acted) {
        if (ui.attackCount > 0) {
          lines.push(`<div class="orderhint"><b>Attack</b> — click a red-ringed target (${ui.attackCount} in reach)</div>`);
        } else if (ui.abilityModes.length) {
          lines.push('<div class="orderhint dim">No weapon target in reach — an ability is available.</div>');
        } else if (!u.moved) {
          lines.push('<div class="orderhint dim">No target in reach — move closer or pass.</div>');
        } else {
          lines.push('<div class="orderhint dim">Moved — no target in reach.</div>');
        }
        for (const m of ui.abilityModes) {
          const on = ui.abilityMode === m.mode ? ' on' : '';
          buttons.push(`<button class="action ability${on}" data-ability="${m.mode}">${MODE_LABEL[m.mode] || m.mode}</button>`);
        }
      }
    }

    if (ui.abilityMode) {
      lines.push('<div class="orderhint abilityhint">Pick a highlighted target, or click the ability again to cancel.</div>');
    }

    el.innerHTML = `
      <div class="cardhead"><h3>Orders</h3><span class="round">${state.mode === 'hotseat' ? `${PLAYER_LABEL[state.side]} · ` : ''}${ui.ready} ready</span></div>
      ${lines.join('')}
      ${buttons.length ? `<div class="abilityrow">${buttons.join('')}</div>` : ''}`;

    el.querySelectorAll('[data-ability]').forEach((b) => {
      b.addEventListener('click', () => ui.onAbility?.(b.dataset.ability));
    });
  }

  renderLog(state) {
    if (!this.logList) return;
    const items = state.log.slice(-14).map((e) =>
      `<li class="${KIND_CLASS[e.kind] || ''}">${escapeHtml(e.text)}</li>`
    );
    this.logList.innerHTML = items.join('');
    this.logList.scrollTop = this.logList.scrollHeight;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

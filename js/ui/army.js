// Point-buy army builder for the menu. Pure DOM: owns the list and reports
// every change so the menu can enable/disable the deploy button.
import { UNITS, UNIT_ORDER, roleLabel } from '../data/units.js';
import { BUDGET, armyCost, validateArmy, defaultArmy } from '../core/state.js';

export const ARMY_PRESETS = [
  {
    id: 'balanced',
    name: 'Balanced',
    hint: 'Every role, every trick.',
    list: defaultArmy(0),
  },
  {
    id: 'swarm',
    name: 'Swarm',
    hint: 'Cheap bodies, wide flanks.',
    list: ['ant', 'ant', 'ant', 'ant', 'termite', 'termite', 'wasp', 'bee', 'bombardier'],
  },
  {
    id: 'iron',
    name: 'Iron Wall',
    hint: 'Plate up front, guns behind.',
    list: ['rhino', 'rhino', 'termite', 'spider', 'bombardier', 'bee', 'ant'],
  },
  {
    id: 'ambush',
    name: 'Ambush',
    hint: 'Fast killers, no mercy.',
    list: ['mantis', 'mantis', 'wasp', 'wasp', 'spider', 'bee', 'ant'],
  },
];

const STAT_LINE = (def) => `HP ${def.hp} · Move ${def.move} · ${def.dmg} dmg`;

export class ArmyBuilder {
  constructor(doc = document, onChange = () => {}) {
    this.doc = doc;
    this.onChange = onChange;
    this.list = defaultArmy(0).slice();

    this.rosterEl = doc.getElementById('roster');
    this.listEl = doc.getElementById('armyList');
    this.presetEl = doc.getElementById('presetRow');
    this.costEl = doc.getElementById('armyCost');
    this.countEl = doc.getElementById('armyCount');
    this.fillEl = doc.getElementById('budgetFill');
    this.statusEl = doc.getElementById('armyValid');

    this.buildRoster();
    this.buildPresets();
    this.render();
  }

  getArmy() {
    return this.list.slice();
  }

  setArmy(list) {
    this.list = list.slice();
    this.render();
  }

  add(type) {
    if (!UNITS[type]) return;
    if (this.list.length >= 10) return;
    if (armyCost(this.list) + UNITS[type].cost > BUDGET) return;
    this.list.push(type);
    this.render();
  }

  removeOne(type) {
    const i = this.list.lastIndexOf(type);
    if (i >= 0) this.list.splice(i, 1);
    this.render();
  }

  clear() {
    this.list = [];
    this.render();
  }

  buildRoster() {
    if (!this.rosterEl) return;
    this.rosterEl.innerHTML = UNIT_ORDER.map((type) => {
      const def = UNITS[type];
      return `
        <button class="unitcard role-${def.role}" data-type="${type}" title="${def.abilityText}">
          <span class="uc-top">
            <b>${def.name}</b>
            <span class="uc-cost">${def.cost}</span>
          </span>
          <span class="uc-role">${roleLabel(def.role)}</span>
          <span class="uc-stats">${STAT_LINE(def)}</span>
          <span class="uc-plus">＋</span>
        </button>`;
    }).join('');

    this.rosterEl.querySelectorAll('[data-type]').forEach((btn) => {
      btn.addEventListener('click', () => this.add(btn.dataset.type));
    });
  }

  buildPresets() {
    if (!this.presetEl) return;
    this.presetEl.innerHTML = ARMY_PRESETS.map(
      (p) => `<button class="preset" data-preset="${p.id}" title="${p.hint}">${p.name}</button>`
    ).join('');

    this.presetEl.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = ARMY_PRESETS.find((p) => p.id === btn.dataset.preset);
        if (preset) this.setArmy(preset.list);
      });
    });
  }

  render() {
    const cost = armyCost(this.list);
    const validation = validateArmy(this.list);

    if (this.costEl) this.costEl.textContent = String(cost);
    if (this.countEl) this.countEl.textContent = `${this.list.length} / 10`;
    if (this.fillEl) {
      this.fillEl.style.width = `${Math.min(100, (cost / BUDGET) * 100)}%`;
      this.fillEl.classList.toggle('over', cost > BUDGET);
      this.fillEl.classList.toggle('full', cost === BUDGET);
    }
    if (this.statusEl) {
      this.statusEl.textContent = validation.ok
        ? `${BUDGET - cost} pts spare`
        : validation.error;
      this.statusEl.classList.toggle('bad', !validation.ok);
    }

    this.renderList();
    this.renderRosterState(cost);
    this.onChange?.(this.getArmy(), validation, cost);
  }

  renderList() {
    if (!this.listEl) return;
    if (!this.list.length) {
      this.listEl.innerHTML = '<p class="emptyarmy">No species chosen — click a card on the right.</p>';
      return;
    }

    const groups = [];
    for (const type of this.list) {
      const hit = groups.find((g) => g.type === type);
      if (hit) hit.n++;
      else groups.push({ type, n: 1 });
    }

    this.listEl.innerHTML = groups.map(({ type, n }) => {
      const def = UNITS[type];
      return `
        <div class="armychip role-${def.role}">
          <span class="ac-name">${def.name}${n > 1 ? ` <b>×${n}</b>` : ''}</span>
          <span class="ac-cost">${def.cost * n}</span>
          <button class="ac-remove" data-remove="${type}" title="Remove one ${def.name}">×</button>
        </div>`;
    }).join('');

    this.listEl.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => this.removeOne(btn.dataset.remove));
    });
  }

  renderRosterState(cost) {
    if (!this.rosterEl) return;
    const full = this.list.length >= 10;
    this.rosterEl.querySelectorAll('[data-type]').forEach((btn) => {
      const def = UNITS[btn.dataset.type];
      const blocked = full || cost + def.cost > BUDGET;
      btn.disabled = blocked;
      btn.classList.toggle('blocked', blocked);
      btn.title = blocked
        ? full ? 'Army is full (10 units).' : 'Not enough points left.'
        : def.abilityText;
    });
  }
}

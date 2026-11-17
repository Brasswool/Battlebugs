// Transient visual effects: movement tweening, lunges, hit flashes,
// floating numbers. Positions are in TILE units; the renderer converts.
const BOARD_W = 10;

export class Fx {
  constructor() {
    this.offsets = new Map();   // unitId -> {x,y} in tiles, relative to its real tile
    this.floaters = [];         // {x,y,text,color,born,life}
    this.puffs = [];            // {x,y,born,life,color}
    this.flashes = [];          // {x,y,born,life}
    this.path = null;           // array of tile indices, for movement preview
  }

  reset() {
    this.offsets.clear();
    this.floaters.length = 0;
    this.puffs.length = 0;
    this.flashes.length = 0;
    this.path = null;
  }

  tween(ms, onStep) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms);
        onStep(k);
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  /** Slide a unit along its path. The state is already at the destination. */
  async moveAlong(unit, from, path) {
    const destX = unit.x;
    const destY = unit.y;
    const pts = (path && path.length ? path : []).map((i) => ({
      x: i % BOARD_W,
      y: (i / BOARD_W) | 0,
    }));
    if (!pts.length) {
      pts.push({ x: destX, y: destY });
    }
    let prev = { x: from.x, y: from.y };
    for (const p of pts) {
      const a = prev;
      const b = p;
      await this.tween(68, (k) => {
        this.offsets.set(unit.id, {
          x: a.x + (b.x - a.x) * k - destX,
          y: a.y + (b.y - a.y) * k - destY,
        });
      });
      prev = p;
    }
    this.offsets.delete(unit.id);
  }

  /** Short shove toward the target and back. */
  async lunge(unit, target) {
    const dx = Math.sign(target.x - unit.x);
    const dy = Math.sign(target.y - unit.y);
    await this.tween(130, (k) => {
      const push = Math.sin(k * Math.PI) * 0.28;
      this.offsets.set(unit.id, { x: dx * push, y: dy * push });
    });
    this.offsets.delete(unit.id);
  }

  hit(x, y, amount) {
    const now = performance.now();
    this.floaters.push({ x, y, text: `-${amount}`, color: '#ff8f7a', born: now, life: 900 });
    this.puffs.push({ x, y, born: now, life: 420, color: '255,160,140' });
    this.flashes.push({ x, y, born: now, life: 220 });
  }

  heal(x, y, amount) {
    const now = performance.now();
    this.floaters.push({ x, y, text: amount > 0 ? `+${amount}` : '0', color: '#8ef2b0', born: now, life: 950 });
    this.puffs.push({ x, y, born: now, life: 560, color: '140,242,176' });
  }

  note(x, y, text, color = '#ffd36b') {
    this.floaters.push({ x, y, text, color, born: performance.now(), life: 1100 });
  }

  update(now) {
    this.floaters = this.floaters.filter((f) => now - f.born < f.life);
    this.puffs = this.puffs.filter((p) => now - p.born < p.life);
    this.flashes = this.flashes.filter((f) => now - f.born < f.life);
  }
}

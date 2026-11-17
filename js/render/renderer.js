// Canvas renderer. Top-down, tile-based, fully procedural.
import { BOARD_W, BOARD_H, TERRAIN } from '../core/board.js';
import { drawInsect, drawHive, drawShadow, roundRect, PALETTES } from './sprites.js';
import { FACTIONS, DEPLOY_ROWS } from '../core/state.js';
import { unitDef } from '../data/units.js';

const frac = (n) => n - Math.floor(n);
const jitter = (x, y) => frac(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.tile = 40;
    this.ox = 0;
    this.oy = 0;
    this.w = 0;
    this.h = 0;
    this.resize();
  }

  resize() {
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : { width: 900, height: 620 };
    const w = Math.max(360, Math.floor(rect.width));
    const h = Math.max(260, Math.floor(rect.height));
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.w = w;
    this.h = h;
    const pad = 16;
    this.tile = Math.min((w - pad * 2) / BOARD_W, (h - pad * 2) / BOARD_H);
    this.ox = (w - this.tile * BOARD_W) / 2;
    this.oy = (h - this.tile * BOARD_H) / 2;
  }

  px(x) { return this.ox + x * this.tile; }
  py(y) { return this.oy + y * this.tile; }
  cx(x) { return this.ox + (x + 0.5) * this.tile; }
  cy(y) { return this.oy + (y + 0.5) * this.tile; }

  tileFromPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - this.ox) / this.tile);
    const y = Math.floor((clientY - rect.top - this.oy) / this.tile);
    if (x < 0 || y < 0 || x >= BOARD_W || y >= BOARD_H) return null;
    return { x, y };
  }

  draw(state, view = {}) {
    const ctx = this.ctx;
    const t = view.time || 0;
    const now = view.now ?? performance.now();
    const fx = view.fx || null;
    if (fx) fx.update(now);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    this.drawBackdrop(state);
    this.drawTiles(state, t);
    this.drawZones(state);
    this.drawHighlights(view);
    this.drawFlashes(fx, now);

    for (const h of state.hives) {
      if (h.hp <= 0) continue;
      const r = this.tile * 0.46;
      drawHive(ctx, h.side, this.cx(h.x), this.cy(h.y) + this.tile * 0.04, r, h.hp / h.maxHp, t);
      this.drawHealth(h, this.cx(h.x), this.cy(h.y) + r * 0.92, this.tile * 0.72, true);
    }

    const offOf = (u) => (fx && fx.offsets.get(u.id)) || { x: 0, y: 0 };
    const order = state.units
      .filter((u) => !u.isHive && u.hp > 0)
      .sort((a, b) => {
        const ao = offOf(a), bo = offOf(b);
        return (a.y + ao.y) - (b.y + bo.y) || (a.x + ao.x) - (b.x + bo.x);
      });

    for (const u of order) {
      const off = offOf(u);
      const ux = this.cx(u.x + off.x);
      const uy = this.cy(u.y + off.y);
      const isSel = view.selected === u.id;
      const spent = u.moved && u.acted;
      const r = this.tile * 0.34;
      const bob = Math.sin(t * 2 + u.x * 0.9 + u.y * 0.7) * this.tile * 0.012;

      drawShadow(ctx, ux, uy + r * 0.72, r * 0.85, r * 0.32);

      if (isSel) {
        ctx.beginPath();
        ctx.arc(ux, uy, r * 1.35, 0, Math.PI * 2);
        ctx.strokeStyle = PALETTES[u.side].rim;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (view.hoverUnit === u.id) {
        ctx.beginPath();
        ctx.arc(ux, uy, r * 1.28, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.save();
      if (spent) ctx.globalAlpha = 0.55;
      if (u.statuses.entangled > 0) {
        ctx.beginPath();
        ctx.arc(ux, uy, r * 1.15, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(220,235,245,0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      drawInsect(ctx, u.type, u.side, ux, uy + bob, r, t);
      ctx.restore();

      this.drawHealth(u, ux, uy + r * 1.15, this.tile * 0.56, false);
      if (u.statuses.frenzy > 0) this.drawBadge(ux + r * 0.9, uy - r * 0.8, '#ffd36b');
      if (u.statuses.entangled > 0) this.drawBadge(ux - r * 0.9, uy - r * 0.8, '#dfe9f0');
    }

    this.drawFx(fx, now);
  }

  /** Floating numbers, expanding impact rings. */
  drawFx(fx, now) {
    if (!fx) return;
    const ctx = this.ctx;
    const T = this.tile;

    for (const p of fx.puffs) {
      const k = (now - p.born) / p.life;
      if (k < 0 || k > 1) continue;
      ctx.beginPath();
      ctx.arc(this.cx(p.x), this.cy(p.y), T * (0.1 + k * 0.4), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${p.color},${(1 - k) * 0.75})`;
      ctx.lineWidth = 2.4 * (1 - k) + 0.5;
      ctx.stroke();
    }

    for (const f of fx.floaters) {
      const k = (now - f.born) / f.life;
      if (k < 0 || k > 1) continue;
      const rise = T * (0.25 + k * 0.95);
      ctx.save();
      ctx.globalAlpha = k < 0.72 ? 1 : Math.max(0, (1 - k) / 0.28);
      ctx.font = `700 ${Math.max(11, T * 0.34)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(f.text, this.cx(f.x), this.cy(f.y) - rise);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, this.cx(f.x), this.cy(f.y) - rise);
      ctx.restore();
    }
  }

  drawFlashes(fx, now) {
    if (!fx) return;
    const ctx = this.ctx;
    const T = this.tile;
    for (const f of fx.flashes) {
      const k = (now - f.born) / f.life;
      if (k < 0 || k > 1) continue;
      ctx.fillStyle = `rgba(255,80,60,${(1 - k) * 0.34})`;
      ctx.fillRect(this.px(f.x), this.py(f.y), T, T);
    }
  }

  drawBackdrop(state) {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(this.w * 0.5, this.h * 0.45, 40, this.w * 0.5, this.h * 0.5, Math.max(this.w, this.h) * 0.75);
    g.addColorStop(0, '#131b16');
    g.addColorStop(1, '#080b09');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  drawTiles(state, t) {
    const ctx = this.ctx;
    const T = this.tile;

    for (let y = 0; y < BOARD_H; y++) {
      for (let x = 0; x < BOARD_W; x++) {
        const px = this.px(x), py = this.py(y);
        const j = jitter(x, y);
        const base = (x + y) % 2 === 0 ? '#1f3020' : '#22351f';
        ctx.fillStyle = base;
        ctx.fillRect(px, py, T + 0.5, T + 0.5);

        // faint organic speckle
        ctx.fillStyle = `rgba(140,190,120,${0.02 + j * 0.03})`;
        ctx.fillRect(px + j * T * 0.7, py + jitter(y, x) * T * 0.7, T * 0.18, T * 0.14);

        const terrain = state.tiles[y * BOARD_W + x];
        if (terrain === TERRAIN.WEB) this.drawWeb(px, py, T, j);
        if (terrain === TERRAIN.MOSS) this.drawMoss(px, py, T, j);
        if (terrain === TERRAIN.NEST) this.drawNest(px, py, T);
        if (terrain === TERRAIN.ROCK) this.drawRock(px, py, T, j);

        ctx.strokeStyle = 'rgba(210,240,200,0.045)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, T, T);
      }
    }
  }

  drawWeb(px, py, T, j) {
    const ctx = this.ctx;
    const cx = px + T / 2, cy = py + T / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(215,230,235,0.35)';
    ctx.lineWidth = 0.9;
    const spokes = 7;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2 + j;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * T * 0.44, cy + Math.sin(a) * T * 0.44);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(215,230,235,0.22)';
    for (const rr of [0.18, 0.32]) {
      ctx.beginPath();
      for (let i = 0; i <= spokes; i++) {
        const a = (i / spokes) * Math.PI * 2 + j;
        const x = cx + Math.cos(a) * T * rr;
        const y = cy + Math.sin(a) * T * rr;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawMoss(px, py, T, j) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(120,175,95,0.16)';
    ctx.fillRect(px, py, T, T);
    ctx.fillStyle = 'rgba(150,205,120,0.35)';
    for (let i = 0; i < 7; i++) {
      const a = frac(Math.sin(i * 12.9898 + j * 78.233) * 43758.5453);
      const b = frac(Math.sin(i * 39.346 + j * 11.135) * 24634.6345);
      ctx.beginPath();
      ctx.arc(px + a * T, py + b * T, T * 0.035 + a * T * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawNest(px, py, T) {
    const ctx = this.ctx;
    const cx = px + T / 2, cy = py + T / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(200,150,70,0.12)';
    ctx.fillRect(px, py, T, T);
    ctx.strokeStyle = 'rgba(215,170,90,0.45)';
    for (let i = 0; i < 3; i++) {
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(cx, cy, T * (0.14 + i * 0.11), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawRock(px, py, T, j) {
    const ctx = this.ctx;
    ctx.fillStyle = '#1a1e21';
    ctx.fillRect(px, py, T, T);
    const cx = px + T / 2, cy = py + T / 2;
    ctx.beginPath();
    const pts = 7;
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * Math.PI * 2 - 0.4;
      const rr = T * (0.30 + frac(Math.sin(i * 3.7 + j * 9.1) * 987.65) * 0.11);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr * 0.86;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(cx, cy - T * 0.4, cx, cy + T * 0.4);
    g.addColorStop(0, '#4a545c');
    g.addColorStop(1, '#232a30');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,170,185,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - T * 0.16, cy - T * 0.10);
    ctx.lineTo(cx + T * 0.02, cy - T * 0.26);
    ctx.lineTo(cx + T * 0.18, cy - T * 0.08);
    ctx.strokeStyle = 'rgba(200,220,235,0.20)';
    ctx.stroke();
  }

  drawZones(state) {
    const ctx = this.ctx;
    // subtle faction staining on deployment rows
    for (const side of [0, 1]) {
      const rows = DEPLOY_ROWS[side];
      const y0 = this.py(rows[0]);
      const y1 = this.py(rows[rows.length - 1]) + this.tile;
      const g = ctx.createLinearGradient(0, side === 0 ? y1 : y0, 0, side === 0 ? y0 : y1);
      const col = FACTIONS[side].color;
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, this.hexA(col, 0.055));
      ctx.fillStyle = g;
      ctx.fillRect(this.px(0), Math.min(y0, y1), this.tile * BOARD_W, Math.abs(y1 - y0));
    }
  }

  drawHighlights(view) {
    const ctx = this.ctx;
    const T = this.tile;

    if (view.moveTiles) {
      for (const i of view.moveTiles) {
        const x = i % BOARD_W, y = (i / BOARD_W) | 0;
        ctx.fillStyle = 'rgba(120,220,255,0.13)';
        ctx.fillRect(this.px(x) + 1, this.py(y) + 1, T - 2, T - 2);
        ctx.strokeStyle = 'rgba(150,230,255,0.32)';
        ctx.strokeRect(this.px(x) + 1.5, this.py(y) + 1.5, T - 3, T - 3);
      }
    }
    if (view.attackIds) {
      for (const id of view.attackIds) {
        const u = (view.units || []).find((o) => o.id === id);
        if (!u) continue;
        ctx.save();
        ctx.fillStyle = 'rgba(255,90,80,0.14)';
        ctx.fillRect(this.px(u.x) + 1, this.py(u.y) + 1, T - 2, T - 2);
        ctx.strokeStyle = 'rgba(255,120,100,0.75)';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.px(u.x) + 2, this.py(u.y) + 2, T - 4, T - 4);
        ctx.restore();
      }
    }
    if (view.abilityIds) {
      for (const id of view.abilityIds) {
        const u = (view.units || []).find((o) => o.id === id);
        if (!u) continue;
        ctx.save();
        ctx.fillStyle = 'rgba(200,160,255,0.12)';
        ctx.fillRect(this.px(u.x) + 1, this.py(u.y) + 1, T - 2, T - 2);
        ctx.strokeStyle = 'rgba(205,170,255,0.7)';
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 2;
        ctx.strokeRect(this.px(u.x) + 2, this.py(u.y) + 2, T - 4, T - 4);
        ctx.restore();
      }
    }
    if (view.pathPreview && view.pathPreview.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(160,235,255,0.85)';
      ctx.lineWidth = Math.max(2, T * 0.055);
      ctx.setLineDash([T * 0.16, T * 0.12]);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      view.pathPreview.forEach((i, n) => {
        const x = i % BOARD_W, y = (i / BOARD_W) | 0;
        const px = this.cx(x), py = this.cy(y);
        if (n === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    }
    if (view.hoverTile) {
      const { x, y } = view.hoverTile;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(this.px(x) + 1, this.py(y) + 1, T - 2, T - 2);
    }
  }

  drawHealth(u, cx, cy, w, big) {
    const ctx = this.ctx;
    const h = big ? 5 : 3.2;
    const ratio = Math.max(0, u.hp / u.maxHp);
    const x = cx - w / 2;
    const y = cy;

    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    roundRect(ctx, x - 1, y - 1, w + 2, h + 2, (h + 2) / 2);
    ctx.fill();

    const col = ratio > 0.55 ? (big ? '#ffcf6b' : PALETTES[u.side].hp)
      : ratio > 0.28 ? '#ffb347' : '#ff5f4d';
    ctx.fillStyle = col;
    roundRect(ctx, x, y, Math.max(1, w * ratio), h, h / 2);
    ctx.fill();

    if (big) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = `600 ${Math.max(9, this.tile * 0.2)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.ceil(u.hp)}`, cx, y + h + this.tile * 0.24);
      ctx.textAlign = 'left';
    }
  }

  drawBadge(cx, cy, color) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(cx, cy, this.tile * 0.085, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  hexA(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
}

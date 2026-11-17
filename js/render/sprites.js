// Procedural insect art. No image assets — every bug is drawn from
// paths, so the whole game ships as text files.
//
// Local space: head points toward -y. Roughly ±11 units across.
// The renderer scales that to the tile size.

export const PALETTES = [
  {          // Hollow — teal
    deep: '#0d3a36', mid: '#1c6a62', head: '#54e6d4',
    rim: '#8bfbee', legs: '#2a9287', glow: 'rgba(80,235,215,0.30)',
    hp: '#3ddbc8',
  },
  {          // Ember — orange
    deep: '#4a1c0e', mid: '#8d3a18', head: '#ffa666',
    rim: '#ffc9a6', legs: '#b55a2a', glow: 'rgba(255,150,90,0.30)',
    hp: '#ff8a4c',
  },
];

function blob(ctx, x, y, rx, ry, rot, fill, stroke, lw = 1.1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot || 0);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  ctx.restore();
}

function legs(ctx, ys, len, width, color, t, phase) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ys.forEach((y, i) => {
    for (const s of [-1, 1]) {
      const sw = Math.sin(t * 4.4 + i * 1.9 + phase) * 0.85;
      ctx.beginPath();
      ctx.moveTo(s * 1.6, y);
      ctx.quadraticCurveTo(s * (len * 0.7), y + sw, s * len, y + len * 0.62 + sw);
      ctx.stroke();
    }
  });
}

function antennae(ctx, x0, y0, color, t, spread = 5.5) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.75;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    const sw = Math.sin(t * 3 + s) * 0.6;
    ctx.beginPath();
    ctx.moveTo(s * 1.1, y0);
    ctx.quadraticCurveTo(s * (spread * 0.6), y0 - 3 + sw, s * spread, y0 - 1.6 + sw);
    ctx.stroke();
  }
}

function wings(ctx, y, len, color, t, spread = 6.5) {
  const flap = 0.55 + Math.abs(Math.sin(t * 9)) * 0.45;
  ctx.save();
  ctx.globalAlpha *= 0.5;
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(s * 1.2, y);
    ctx.rotate(s * 0.32);
    ctx.beginPath();
    ctx.ellipse(s * (len * 0.42), 0, len * 0.62, 2.4 * flap + 0.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function mandibles(ctx, y, color) {
  ctx.fillStyle = color;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * 0.9, y);
    ctx.lineTo(s * 2.4, y - 2.1);
    ctx.lineTo(s * 2.6, y - 0.4);
    ctx.closePath();
    ctx.fill();
  }
}

/** Draw one insect. r = radius in CSS pixels. */
export function drawInsect(ctx, type, side, px, py, r, t = 0, opts = {}) {
  const pal = PALETTES[side] || PALETTES[0];
  const scale = r / 11;

  ctx.save();
  ctx.translate(px, py);
  if (side === 1) ctx.rotate(Math.PI);
  ctx.scale(scale, scale);
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;

  const phase = (px * 0.07 + py * 0.11) % 6.28;
  const light = pal.head;

  switch (type) {
    case 'ant': {
      legs(ctx, [-2.2, 0.4, 3.2], 8.4, 0.9, pal.legs, t, phase);
      blob(ctx, 0, 5.1, 3.5, 4.3, 0, pal.deep, pal.rim, 0.9);
      blob(ctx, 0, 0, 2.6, 3.3, 0, pal.mid, pal.rim, 0.9);
      blob(ctx, 0, -5.7, 3.0, 2.9, 0, light, pal.rim, 0.9);
      antennae(ctx, 0, -7.4, light, t);
      mandibles(ctx, -7.9, pal.rim);
      break;
    }

    case 'termite': {
      legs(ctx, [-1.4, 1.0, 3.6], 8.0, 1.15, pal.legs, t, phase);
      blob(ctx, 0, 4.6, 4.2, 5.4, 0, pal.deep, pal.rim, 1.0);
      blob(ctx, 0, -0.4, 3.4, 3.9, 0, pal.mid, pal.rim, 1.0);
      blob(ctx, 0, -6.4, 3.6, 3.2, 0, light, pal.rim, 1.0);
      antennae(ctx, 0, -8.2, light, t, 4.4);
      mandibles(ctx, -8.8, pal.rim);
      break;
    }

    case 'rhino': {
      legs(ctx, [-2.4, 0.6, 4.0], 8.8, 1.7, pal.legs, t, phase);
      blob(ctx, 0, 3.4, 6.0, 7.2, 0, pal.deep, pal.rim, 1.3);
      blob(ctx, 0, -5.2, 4.4, 3.6, 0, pal.mid, pal.rim, 1.2);
      blob(ctx, 0, -7.6, 3.2, 2.4, 0, light, pal.rim, 1.0);
      // the horn
      ctx.beginPath();
      ctx.moveTo(-1.6, -8.4);
      ctx.quadraticCurveTo(0, -15.5, 1.6, -8.4);
      ctx.closePath();
      ctx.fillStyle = pal.rim;
      ctx.fill();
      mandibles(ctx, -9.6, pal.rim);
      break;
    }

    case 'mantis': {
      legs(ctx, [2.0, 4.2], 7.2, 0.95, pal.legs, t, phase);
      blob(ctx, 0, 5.4, 2.6, 6.2, 0, pal.deep, pal.rim, 1.0);
      blob(ctx, 0, -1.2, 2.2, 4.0, 0, pal.mid, pal.rim, 1.0);
      blob(ctx, 0, -6.4, 2.8, 2.3, 0, light, pal.rim, 0.9);
      // raptorial forelegs
      ctx.strokeStyle = pal.rim;
      ctx.lineWidth = 1.25;
      ctx.lineCap = 'round';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 1.8, -3.4);
        ctx.quadraticCurveTo(s * 7.4, -6.2, s * 5.6, -11.2);
        ctx.stroke();
      }
      antennae(ctx, 0, -8.4, light, t, 4.2);
      break;
    }

    case 'wasp': {
      wings(ctx, -0.6, 7.0, pal.head, t);
      legs(ctx, [0.4, 2.4], 5.6, 0.8, pal.legs, t, phase);
      blob(ctx, 0, 4.6, 3.4, 4.6, 0, pal.deep, pal.rim, 0.9);
      // stripes
      ctx.strokeStyle = pal.rim;
      ctx.lineWidth = 1.0;
      for (const y of [2.8, 4.8, 6.6]) {
        ctx.beginPath();
        ctx.moveTo(-3.1 + Math.abs(y - 4.6) * 0.22, y);
        ctx.lineTo(3.1 - Math.abs(y - 4.6) * 0.22, y);
        ctx.stroke();
      }
      blob(ctx, 0, -1.4, 2.9, 3.0, 0, pal.mid, pal.rim, 0.9);
      blob(ctx, 0, -5.8, 2.5, 2.4, 0, light, pal.rim, 0.9);
      // stinger
      ctx.beginPath();
      ctx.moveTo(-0.9, 9.0);
      ctx.lineTo(0, 11.4);
      ctx.lineTo(0.9, 9.0);
      ctx.closePath();
      ctx.fillStyle = pal.rim;
      ctx.fill();
      antennae(ctx, 0, -7.4, light, t, 4.0);
      break;
    }

    case 'bombardier': {
      legs(ctx, [-1.8, 1.2, 3.8], 7.6, 1.15, pal.legs, t, phase);
      blob(ctx, 0, 2.6, 5.4, 6.2, 0, pal.deep, pal.rim, 1.2);
      // caustic reservoir
      blob(ctx, 0, 5.2, 2.6, 2.2, 0, pal.mid, pal.rim, 0.9);
      blob(ctx, 0, -4.6, 3.0, 3.6, 0, pal.mid, pal.rim, 1.0);
      blob(ctx, 0, -7.6, 2.3, 2.0, 0, light, pal.rim, 0.9);
      // nozzle
      ctx.fillStyle = pal.rim;
      ctx.beginPath();
      ctx.moveTo(-1.5, 7.6);
      ctx.lineTo(1.5, 7.6);
      ctx.lineTo(2.4, 10.4);
      ctx.lineTo(-2.4, 10.4);
      ctx.closePath();
      ctx.fill();
      mandibles(ctx, -9.2, pal.rim);
      break;
    }

    case 'spider': {
      // eight legs, bent and high
      ctx.strokeStyle = pal.legs;
      ctx.lineWidth = 0.95;
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        for (const s of [-1, 1]) {
          const baseY = -2.4 + i * 2.0;
          const sw = Math.sin(t * 4 + i * 1.3 + phase) * 0.8;
          const kneeX = s * 6.6;
          const kneeY = baseY - 3.2 + sw;
          const footX = s * 10.2;
          const footY = baseY + 2.4 + sw;
          ctx.beginPath();
          ctx.moveTo(s * 2.6, baseY);
          ctx.lineTo(kneeX, kneeY);
          ctx.lineTo(footX, footY);
          ctx.stroke();
        }
      }
      blob(ctx, 0, 3.6, 5.2, 5.6, 0, pal.deep, pal.rim, 1.1);
      blob(ctx, 0, -0.4, 3.6, 3.2, 0, pal.mid, pal.rim, 1.0);
      blob(ctx, 0, -4.2, 2.6, 2.2, 0, light, pal.rim, 0.9);
      // eyes
      ctx.fillStyle = '#0b0d0c';
      for (const [ex, ey] of [[-1.3, -5.0], [1.3, -5.0], [-2.5, -3.8], [2.5, -3.8]]) {
        ctx.beginPath();
        ctx.arc(ex, ey, 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'bee': {
      wings(ctx, -2.2, 6.2, pal.head, t);
      legs(ctx, [0.2, 2.2, 4.0], 5.4, 0.85, pal.legs, t, phase);
      // fuzzy abdomen
      blob(ctx, 0, 4.4, 4.2, 4.8, 0, pal.deep, pal.rim, 1.0);
      ctx.strokeStyle = pal.rim;
      ctx.lineWidth = 1.05;
      for (const y of [2.4, 4.4, 6.4]) {
        ctx.beginPath();
        ctx.moveTo(-4.0 + Math.abs(y - 4.4) * 0.3, y);
        ctx.lineTo(4.0 - Math.abs(y - 4.4) * 0.3, y);
        ctx.stroke();
      }
      blob(ctx, 0, -1.4, 3.3, 3.2, 0, pal.mid, pal.rim, 1.0);
      // fuzz
      ctx.fillStyle = pal.head;
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * 3.3, -1.4 + Math.sin(ang) * 3.2, 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
      blob(ctx, 0, -6.0, 2.2, 2.0, 0, light, pal.rim, 0.85);
      antennae(ctx, 0, -7.6, light, t, 4.4);
      break;
    }

    case 'beetle': {
      legs(ctx, [-2.0, 0.8, 3.6], 8.2, 1.5, pal.legs, t, phase);
      blob(ctx, 0, 3.8, 5.6, 6.6, 0, pal.deep, pal.rim, 1.2);
      // wing casings split down the back
      ctx.strokeStyle = pal.rim;
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(0, -1.2);
      ctx.lineTo(0, 8.6);
      ctx.stroke();
      blob(ctx, 0, -4.8, 4.0, 3.4, 0, pal.mid, pal.rim, 1.1);
      blob(ctx, 0, -7.2, 2.9, 2.2, 0, light, pal.rim, 1.0);
      // stag mandibles: two branching horns
      ctx.strokeStyle = pal.rim;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 1.6, -8.0);
        ctx.quadraticCurveTo(s * 4.6, -11.4, s * 3.4, -14.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s * 3.3, -12.4);
        ctx.quadraticCurveTo(s * 6.2, -12.8, s * 7.2, -10.6);
        ctx.stroke();
      }
      break;
    }

    case 'dragonfly': {
      // two wing pairs, swept back
      wings(ctx, -1.6, 5.4, pal.head, t);
      wings(ctx, 2.2, 3.2, pal.mid, t);
      legs(ctx, [1.6, 3.4], 4.6, 0.7, pal.legs, t, phase);
      // long thin tail
      ctx.strokeStyle = pal.deep;
      ctx.lineWidth = 1.9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 2.2);
      ctx.lineTo(0, 11.6);
      ctx.stroke();
      blob(ctx, 0, -0.6, 2.6, 3.4, 0, pal.mid, pal.rim, 0.95);
      blob(ctx, 0, -5.4, 2.8, 2.6, 0, light, pal.rim, 0.95);
      // wrap-around eyes
      ctx.fillStyle = '#0b0d0c';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * 1.7, -7.0, 1.5, 1.9, s * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    default: {
      blob(ctx, 0, 0, 5, 6, 0, pal.deep, pal.rim, 1.2);
    }
  }

  ctx.restore();
}

/** The colony objective. Cracks appear as it takes damage. */
export function drawHive(ctx, side, px, py, r, hpRatio, t = 0) {
  const pal = PALETTES[side] || PALETTES[0];
  ctx.save();
  ctx.translate(px, py);

  const pulse = 1 + Math.sin(t * 1.6) * 0.012;
  ctx.scale(pulse, pulse);

  // shadow
  ctx.beginPath();
  ctx.ellipse(0, r * 0.62, r * 0.95, r * 0.30, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fill();

  // dome
  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, pal.mid);
  g.addColorStop(0.55, pal.deep);
  g.addColorStop(1, '#0a0d0c');
  ctx.beginPath();
  ctx.moveTo(-r * 0.92, r * 0.45);
  ctx.quadraticCurveTo(-r * 0.95, -r * 0.72, 0, -r * 0.95);
  ctx.quadraticCurveTo(r * 0.95, -r * 0.72, r * 0.92, r * 0.45);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = pal.rim;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // honeycomb
  ctx.strokeStyle = pal.head;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 0.8;
  const cell = r * 0.26;
  for (let row = 0; row < 3; row++) {
    for (let col = -1; col <= 1; col++) {
      const cx = col * cell * 1.7 + (row % 2 ? cell * 0.85 : 0);
      const cy = -r * 0.30 + row * cell * 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const x = cx + Math.cos(a) * cell * 0.52;
        const y = cy + Math.sin(a) * cell * 0.52;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // damage cracks
  if (hpRatio < 0.75) {
    ctx.strokeStyle = 'rgba(10,8,6,0.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.7);
    ctx.lineTo(-r * 0.05, -r * 0.3);
    ctx.lineTo(-r * 0.3, -r * 0.05);
    ctx.stroke();
  }
  if (hpRatio < 0.45) {
    ctx.strokeStyle = 'rgba(10,8,6,0.9)';
    ctx.beginPath();
    ctx.moveTo(r * 0.45, -r * 0.45);
    ctx.lineTo(r * 0.18, -r * 0.15);
    ctx.lineTo(r * 0.4, r * 0.15);
    ctx.lineTo(r * 0.2, r * 0.4);
    ctx.stroke();
  }
  if (hpRatio < 0.2) {
    ctx.fillStyle = 'rgba(255,110,60,0.10)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function drawShadow(ctx, px, py, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

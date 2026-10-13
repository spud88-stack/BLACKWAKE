// World renderer: baked tile map, y-sorted entities, light-grid multiply, emissive pass, particles.
import { S, buildSprites, glow, mk } from './sprites.js';
import { rayGrid } from '../sim/nav.js';
import { TILE, RNG, dist, clamp } from '../core/util.js';
import { PROPS, ROOMS, ALIENS } from '../sim/data.js';
import { T_FLOOR, T_WALL, T_WINDOW } from '../sim/gen.js';
import { text } from './font.js';

export const VW = 480, VH = 270;
const CELL = 8;
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0; };

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    canvas.width = VW; canvas.height = VH;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    buildSprites();
    this.lw = Math.ceil(VW / CELL) + 3; this.lh = Math.ceil(VH / CELL) + 3;
    this.lightCv = mk(this.lw, this.lh);
    this.lctx = this.lightCv.getContext('2d');
    this.limg = this.lctx.createImageData(this.lw, this.lh);
    this.vis = new Uint8Array(this.lw * this.lh);
    this.rng = new RNG(99);
    this.parts = []; this.tracers = []; this.rings = []; this.flashes = []; this.slashes = [];
    this.cam = { x: 0, y: 0 }; this.shake = 0; this.kx = 0; this.ky = 0; this.t = 0; this.hurt = 0; this.hurtAng = 0;
    this.debug = false;
    this.motes = [];
    for (let i = 0; i < 46; i++) this.motes.push({ x: this.rng.range(0, VW), y: this.rng.range(0, VH), vx: this.rng.range(-3, 3), vy: this.rng.range(-2, 2), p: this.rng.range(0, 6) });
  }

  setWorld(world) {
    this.world = world;
    const m = world.map, W = m.w * TILE, H = m.h * TILE;
    this.mapCv = mk(W, H); this.decCv = mk(W, H);
    const x = this.mapCv.getContext('2d');
    this.dctx = this.decCv.getContext('2d');
    this.dctx.imageSmoothingEnabled = false;
    for (let ty = 0; ty < m.h; ty++) for (let tx = 0; tx < m.w; tx++) {
      const i = ty * m.w + tx, t = m.tiles[i], px = tx * TILE, py = ty * TILE, hv = hash(tx, ty);
      if (t === T_FLOOR) {
        const r = m.rooms[m.roomId[i]], kind = r ? ROOMS[r.type].floor : 'plate';
        x.drawImage(S.floor[kind][[0, 0, 0, 1, 0, 2, 0, 3][hv % 8]], px, py);
        if (m.organic[i]) x.drawImage(S.organic[hv % 4], px, py);
        const up = m.tiles[i - m.w];
        if (up === T_WALL || up === T_WINDOW) { x.fillStyle = 'rgba(0,0,0,0.38)'; x.fillRect(px, py, 16, 2); x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(px, py + 2, 16, 3); }
        if (m.tiles[i - 1] === T_WALL) { x.fillStyle = 'rgba(0,0,0,0.2)'; x.fillRect(px, py, 2, 16); }
        if (m.doorAt[i]) { x.fillStyle = '#1b1e25'; x.fillRect(px, py, 16, 16); x.fillStyle = '#b99a2e'; const d = m.doors[m.doorAt[i] - 1]; if (d.orient === 'h') { x.fillRect(px, py + 14, 16, 1); x.fillRect(px, py + 1, 16, 1); } else { x.fillRect(px + 1, py, 1, 16); x.fillRect(px + 14, py, 1, 16); } }
      } else if (t === T_WALL || t === T_WINDOW) {
        const below = m.tiles[i + m.w] === T_FLOOR;
        if (t === T_WINDOW) x.drawImage(S.window, px, py);
        else if (below) x.drawImage(S.wallFace[hv % 8], px, py);
        else {
          x.drawImage(S.wallTop, px, py);
          x.fillStyle = '#3a4250';
          if (m.tiles[i - m.w] === T_FLOOR) x.fillRect(px, py, 16, 1);
          if (m.tiles[i - 1] === T_FLOOR) x.fillRect(px, py, 1, 16);
          if (m.tiles[i + 1] === T_FLOOR) x.fillRect(px + 15, py, 1, 16);
        }
        if (t === T_WALL && below) { x.fillStyle = '#20242e'; if (m.tiles[i - 1] === T_FLOOR) x.fillRect(px, py, 1, 16); if (m.tiles[i + 1] === T_FLOOR) x.fillRect(px + 15, py, 1, 16); }
      }
    }
    // Lift the baked art so full light reads as bright rather than merely visible.
    x.globalCompositeOperation = 'lighter'; x.globalAlpha = 0.38; x.drawImage(this.mapCv, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    for (const d of m.decals) this.stamp(d.k, d.x, d.y, d.s, d.a);
    this.explored = new Uint8Array(world.light.w * world.light.h);
    this.parts.length = 0; this.tracers.length = 0; this.rings.length = 0;
    const p = world.player;
    this.cam.x = p.x - VW / 2; this.cam.y = p.y - VH / 2;
  }

  stamp(kind, wx, wy, s = 1, a = 0) {
    const arr = S.decals[kind];
    if (!arr) return;
    const sp = arr[Math.abs(Math.floor(wx * 7 + wy * 13)) % arr.length], d = this.dctx;
    if (kind === 'bloodtrail') { d.save(); d.translate(Math.round(wx), Math.round(wy)); d.rotate(a); d.drawImage(sp, 0, -4); d.restore(); return; }
    const w = Math.round(sp.width * s), h = Math.round(sp.height * s);
    d.drawImage(sp, Math.round(wx - w / 2), Math.round(wy - h / 2), w, h);
  }

  part(o) { if (this.parts.length < 700) this.parts.push(Object.assign({ z: 0, vz: 0, vx: 0, vy: 0, g: 0, size: 1, drag: 0, life: 0.5, t: 0 }, o)); }
  burst(x, y, n, o) {
    const r = this.rng;
    for (let i = 0; i < n; i++) {
      const a = o.ang !== undefined ? o.ang + r.range(-(o.spread || 0.6), o.spread || 0.6) : r.range(0, 6.283), sp = r.range(o.s0 || 20, o.s1 || 80);
      this.part({ x, y, z: o.z || 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: r.range(o.vz0 || 10, o.vz1 || 60), g: o.g === undefined ? 220 : o.g, col: Array.isArray(o.col) ? r.pick(o.col) : o.col, life: r.range(o.l0 || 0.25, o.l1 || 0.6), em: o.em, stamp: o.stamp, size: o.size || 1, drag: o.drag || 0 });
    }
  }
  smoke(x, y, n, col = 'rgba(120,125,135,', s = 1) {
    for (let i = 0; i < n; i++) this.part({ x: x + this.rng.range(-4, 4) * s, y: y + this.rng.range(-4, 4) * s, vx: this.rng.range(-8, 8), vy: this.rng.range(-14, -3), smoke: col, life: this.rng.range(0.6, 1.5), size: this.rng.int(2, 4) * s, drag: 1.2 });
  }
  near(x, y, r = 380) { const p = this.world.player; return Math.abs(x - p.x) < r && Math.abs(y - p.y) < r * 0.7; }

  fx(f) {
    const r = this.rng, w = this.world, p = w.player;
    switch (f.type) {
      case 'shot': {
        if (!this.near(f.x, f.y)) break;
        this.flashes.push({ x: f.x, y: f.y, ang: f.ang, t: 0.05, w: f.w });
        if (f.w !== 'flamer' && f.w !== 'arc') this.part({ x: f.x - Math.cos(f.ang) * 5, y: f.y - Math.sin(f.ang) * 5, z: 6, vx: Math.cos(f.ang + 1.7) * r.range(20, 40), vy: Math.sin(f.ang + 1.7) * r.range(20, 40), vz: r.range(40, 70), g: 300, col: f.w === 'shotgun' ? '#c8463a' : '#d8b048', life: 0.7, stamp: 'casing', bounce: 1 });
        if (f.w !== 'flamer') this.smoke(f.x, f.y, 1);
        if (f.player) { const k = { pistol: 1.6, smg: 1.0, shotgun: 4.5, rifle: 1.8, arc: 2.2, flamer: 0.25 }[f.w]; this.kx -= Math.cos(f.ang) * k; this.ky -= Math.sin(f.ang) * k; this.shake = Math.max(this.shake, k * 0.55); }
        break;
      }
      case 'tracer': if (this.near(f.x, f.y) || this.near(f.x2, f.y2)) this.tracers.push({ x: f.x, y: f.y - 3, x2: f.x2, y2: f.y2 - 3, t: f.w === 'arc' ? 0.12 : 0.06, max: f.w === 'arc' ? 0.12 : 0.06, w: f.w }); break;
      case 'impact': if (this.near(f.x, f.y)) { this.burst(f.x, f.y, 5, { ang: f.ang + Math.PI, spread: 1.1, col: ['#ffe0a0', '#ffb040', '#fff'], em: true, s0: 30, s1: 110, l0: 0.1, l1: 0.3, g: 200 }); this.smoke(f.x, f.y, 1); this.dctx.fillStyle = '#14161b'; this.dctx.fillRect(Math.round(f.x), Math.round(f.y), 1, 1); } break;
      case 'ricochet': this.burst(f.x, f.y, 6, { col: ['#fff', '#ffe0a0'], em: true, s0: 40, s1: 130, l0: 0.1, l1: 0.25 }); break;
      case 'alienHit': if (this.near(f.x, f.y)) { this.burst(f.x, f.y, 4 + Math.min(6, f.dmg / 5), { ang: f.ang, spread: 0.8, col: ['#4a2f70', '#6a45a0', '#2f1c48'], s0: 20, s1: 100, stamp: 'ichorDot', l0: 0.2, l1: 0.5 }); } break;
      case 'alienDeath': {
        if (!this.near(f.x, f.y)) break;
        this.burst(f.x, f.y, f.r > 9 ? 40 : 16 + f.r * 2, { col: ['#4a2f70', '#6a45a0', '#2f1c48', '#1a1024'], s0: 20, s1: 120, stamp: 'ichorDot', l0: 0.3, l1: 0.7 });
        this.stamp('ichor', f.x, f.y, 0.6 + f.r / 7);
        const d = this.dctx; d.fillStyle = '#17101f';
        const rr = Math.max(2, f.r - 1);
        d.fillRect(Math.round(f.x - rr), Math.round(f.y - rr * 0.6), rr * 2, Math.round(rr * 1.3));
        d.fillStyle = '#2b1c36'; d.fillRect(Math.round(f.x - rr + 1), Math.round(f.y - rr * 0.6), rr * 2 - 2, 1);
        for (let i = 0; i < 6; i++) { const a = r.range(0, 6.28); d.fillStyle = '#17101f'; d.fillRect(Math.round(f.x + Math.cos(a) * (rr + 2)), Math.round(f.y + Math.sin(a) * (rr + 1)), 2, 1); }
        this.shake = Math.max(this.shake, f.r > 6 ? 4 : 1);
        break;
      }
      case 'humanHit': {
        this.burst(f.x, f.y - 4, 7, { ang: f.ang, spread: 1, col: ['#8a1c1c', '#b02a2a', '#5a1212'], s0: 20, s1: 90, stamp: 'bloodDot' });
        if (f.player && f.dmg > 0.5) { this.hurt = 0.4; this.hurtAng = f.ang; this.shake = Math.max(this.shake, Math.min(6, 1.5 + f.dmg * 0.2)); }
        break;
      }
      case 'drip': this.dctx.fillStyle = '#5a1212'; this.dctx.fillRect(Math.round(f.x + r.range(-2, 2)), Math.round(f.y + r.range(-1, 2)), r.int(1, 2), 1); break;
      case 'down': case 'humanDeath': this.stamp('blood', f.x, f.y, 1.3); break;
      case 'explode': {
        const col = f.goo ? ['#8a4ac0', '#c080ff', '#4a2f70'] : ['#fff0a0', '#ffb040', '#ff5a1a'];
        this.burst(f.x, f.y, 46, { col, em: true, s0: 40, s1: 240, l0: 0.2, l1: 0.7, g: 160 });
        this.smoke(f.x, f.y, 14, f.goo ? 'rgba(90,50,110,' : 'rgba(70,70,75,', 2);
        this.rings.push({ x: f.x, y: f.y, r: 4, max: f.r * 1.4, t: 0.3, col: f.goo ? '#c080ff' : '#fff0c0' });
        this.stamp(f.goo ? 'ichor' : 'scorch', f.x, f.y, f.goo ? 2.4 : 1.8);
        this.shake = Math.max(this.shake, clamp(9 - dist(f.x, f.y, p.x, p.y) / 40, 1, 9));
        break;
      }
      case 'flame': for (let i = 0; i < 3; i++) { const a = f.ang + r.range(-0.2, 0.2), sp = r.range(150, 240); this.part({ x: f.x, y: f.y - 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, flame: true, em: true, life: f.range / sp, size: 2, drag: 0.6 }); } break;
      case 'claw': this.slashes.push({ x: f.x, y: f.y - 5, ang: f.ang, t: 0.16 }); break;
      case 'swipe': this.slashes.push({ x: f.x + Math.cos(f.ang) * 12, y: f.y + Math.sin(f.ang) * 12 - 4, ang: f.ang, t: 0.2, big: true }); break;
      case 'melee': this.slashes.push({ x: f.x + Math.cos(f.ang) * 11, y: f.y + Math.sin(f.ang) * 11 - 4, ang: f.ang, t: 0.12, white: true }); break;
      case 'door': if (this.near(f.x, f.y)) this.smoke(f.x, f.y, 1); break;
      case 'doorHit': this.burst(f.x, f.y, 6, { col: ['#ffe0a0', '#8590a0'], em: true, s0: 30, s1: 100, l0: 0.1, l1: 0.3 }); this.smoke(f.x, f.y, 2); if (this.near(f.x, f.y, 200)) this.shake = Math.max(this.shake, 1.5); break;
      case 'doorBreak': this.burst(f.x, f.y, 22, { col: ['#59626f', '#3a404a', '#8590a0'], s0: 40, s1: 160, stamp: 'debris', l0: 0.3, l1: 0.7 }); this.smoke(f.x, f.y, 6); this.shake = Math.max(this.shake, 4); break;
      case 'vent': if (this.near(f.x, f.y)) { this.smoke(f.x, f.y, 3, 'rgba(90,95,100,'); this.rings.push({ x: f.x, y: f.y, r: 2, max: 14, t: 0.35, col: '#59626f' }); } break;
      case 'emerge': this.burst(f.x, f.y, 8, { col: ['#3a404a', '#59626f'], s0: 20, s1: 70, stamp: 'debris' }); break;
      case 'spark': this.burst(f.x, f.y, 3, { col: ['#aef2ff', '#fff'], em: true, s0: 20, s1: 80, l0: 0.1, l1: 0.3 }); break;
      case 'zap': this.burst(f.x, f.y, 14, { col: ['#aef2ff', '#fff', '#5fb0ff'], em: true, s0: 40, s1: 150, l0: 0.1, l1: 0.4 }); this.tracers.push({ x: f.x - 10, y: f.y - 8, x2: f.x + 9, y2: f.y + 6, t: 0.3, max: 0.3, w: 'arc' }); this.tracers.push({ x: f.x + 8, y: f.y - 10, x2: f.x - 7, y2: f.y + 8, t: 0.3, max: 0.3, w: 'arc' }); break;
      case 'heal': case 'revive': for (let i = 0; i < 6; i++) this.part({ x: f.x + r.range(-5, 5), y: f.y - r.range(0, 10), vy: -r.range(8, 20), col: '#5fe88a', em: true, life: r.range(0.4, 0.9), plus: true }); break;
      case 'reassure': for (let i = 0; i < 4; i++) this.part({ x: f.x + r.range(-5, 5), y: f.y - 10, vy: -r.range(8, 16), col: '#8fd0ff', em: true, life: 0.7 }); break;
      case 'pickup': case 'give': this.rings.push({ x: f.x, y: f.y, r: 2, max: 9, t: 0.25, col: '#e8e0b0' }); break;
      case 'open': this.smoke(f.x, f.y, 1); break;
      case 'step': if (f.sprint && this.near(f.x, f.y)) this.part({ x: f.x, y: f.y, vy: -4, smoke: 'rgba(110,112,118,', life: 0.4, size: 2 }); break;
      case 'shriek': this.rings.push({ x: f.x, y: f.y, r: 4, max: 220, t: 0.7, col: '#f04ad0' }); this.rings.push({ x: f.x, y: f.y, r: 4, max: 150, t: 0.9, col: '#f04ad0' }); this.shake = Math.max(this.shake, 4); break;
      case 'roar': this.rings.push({ x: f.x, y: f.y, r: 4, max: 60, t: 0.5, col: '#e8463a' }); break;
      case 'slam': this.shake = Math.max(this.shake, 7); this.smoke(f.x, f.y, 8); this.burst(f.x, f.y, 14, { col: ['#59626f', '#8590a0'], s0: 40, s1: 140, stamp: 'debris' }); break;
      case 'thump': if (this.near(f.x, f.y, 170)) this.shake = Math.max(this.shake, 1.3); this.part({ x: f.x, y: f.y, smoke: 'rgba(100,100,105,', life: 0.4, size: 3 }); break;
      case 'acidSplash': this.burst(f.x, f.y, 14, { col: ['#9be84a', '#5a9a2a', '#d0ff80'], em: true, s0: 20, s1: 90 }); this.stamp('acid', f.x, f.y, 1.4); break;
      case 'spit': this.burst(f.x, f.y, 4, { col: ['#9be84a'], em: true, s0: 10, s1: 40 }); break;
      case 'weld': this.burst(f.x, f.y, 18, { col: ['#aef2ff', '#fff', '#5fb0ff'], em: true, s0: 30, s1: 120, l0: 0.2, l1: 0.6 }); break;
      case 'order': if (f.x !== undefined) this.rings.push({ x: f.x, y: f.y, r: 3, max: 14, t: 0.6, col: '#8fd0ff', ui: true }); break;
      case 'beep': this.rings.push({ x: f.x, y: f.y, r: 2, max: 16, t: 0.35, col: '#3fe07a', ui: true }); break;
      case 'flareLand': this.burst(f.x, f.y, 10, { col: ['#ff5040', '#ffc0a0'], em: true, s0: 20, s1: 80 }); break;
      case 'hatch': this.burst(f.x, f.y, 10, { col: ['#6d3a6a', '#a05e98'], s0: 15, s1: 60, stamp: 'ichorDot' }); break;
      case 'armorBreak': this.burst(f.x, f.y, 10, { col: ['#59626e', '#8b96a4'], s0: 30, s1: 100, stamp: 'debris' }); break;
      case 'hiss': this.rings.push({ x: f.x, y: f.y, r: 2, max: 18, t: 0.3, col: '#7fe3ee' }); break;
      case 'panic': if (f.player) this.shake = Math.max(this.shake, 3); break;
    }
  }

  visAt(wx, wy) {
    const cx = Math.floor(wx / CELL) - this.l0x, cy = Math.floor(wy / CELL) - this.l0y;
    if (cx < 0 || cy < 0 || cx >= this.lw || cy >= this.lh) return false;
    return this.vis[cy * this.lw + cx] === 1;
  }

  lightPass(world, camX, camY) {
    const L = world.light, m = world.map, buf = L.buf, d = this.limg.data, p = world.player;
    const l0x = (this.l0x = Math.floor(camX / CELL) - 1), l0y = (this.l0y = Math.floor(camY / CELL) - 1);
    const ex = p.x, ey = p.y - 2;
    const dead = p.dead;
    // Render-only glow so squad members are never fully lost in the dark (does not affect the sim).
    const hs = [];
    for (const h of world.humans) if (!h.dead && Math.abs(h.x - camX - VW / 2) < VW && Math.abs(h.y - camY - VH / 2) < VH) hs.push(h);
    for (let j = 0; j < this.lh; j++) for (let i = 0; i < this.lw; i++) {
      const gx = l0x + i, gy = l0y + j, o = (j * this.lw + i) * 4;
      let r = 0, g = 0, b = 0, v = 0;
      if (gx >= 0 && gy >= 0 && gx < L.w && gy < L.h) {
        const tx = gx >> 1, ty = gy >> 1, ti = ty * m.w + tx;
        let sx = gx, sy = gy;
        if (m.tiles[ti] !== 1 && m.tiles[ti] !== 0) {
          // Walls borrow light and visibility from the floor they face.
          if (m.tiles[ti + m.w] === 1) sy = (ty + 1) * 2;
          else if (m.tiles[ti - m.w] === 1) sy = ty * 2 - 1;
          else if (m.tiles[ti - 1] === 1) sx = tx * 2 - 1;
          else if (m.tiles[ti + 1] === 1) sx = (tx + 1) * 2;
          else if (m.tiles[ti + m.w - 1] === 1) { sx = tx * 2 - 1; sy = (ty + 1) * 2; }
          else if (m.tiles[ti + m.w + 1] === 1) { sx = (tx + 1) * 2; sy = (ty + 1) * 2; }
          else if (m.tiles[ti - m.w - 1] === 1) { sx = tx * 2 - 1; sy = ty * 2 - 1; }
          else if (m.tiles[ti - m.w + 1] === 1) { sx = (tx + 1) * 2; sy = ty * 2 - 1; }
        }
        const gi = sy * L.w + sx;
        if (m.tiles[ti] === 0) { r = g = b = 0.6; v = 2; }
        else {
          v = !dead && rayGrid(m.opaque, m.w, m.h, ex, ey, sx * CELL + 4, sy * CELL + 4, true) >= 1 ? 1 : 0;
          if (v) { const ei = gy * L.w + gx; if (!this.explored[ei]) { this.explored[ei] = 1; const rm = m.rooms[m.roomId[ti]]; if (rm) rm.seen = true; } if (!this.explored[gi]) { this.explored[gi] = 1; const rm = m.rooms[m.roomId[(sy >> 1) * m.w + (sx >> 1)]]; if (rm) rm.seen = true; } }
          const lr = buf[gi * 3], lg = buf[gi * 3 + 1], lb = buf[gi * 3 + 2];
          if (v) {
            r = 0.15 + Math.pow(lr, 0.76); g = 0.17 + Math.pow(lg, 0.76); b = 0.235 + Math.pow(lb, 0.76);
            const cxp = gx * CELL + 4, cyp = gy * CELL + 4;
            for (const h of hs) { const dx = cxp - h.x, dy = cyp - h.y + 4, d2 = dx * dx + dy * dy; if (d2 < 1100) { const k = (1 - d2 / 1100) * (h.isPlayer ? 0.34 : 0.26); r += k * 0.85; g += k * 0.95; b += k * 1.1; } }
          }
          else if (this.explored[gy * L.w + gx] || (m.rooms[m.roomId[ti]] && m.rooms[m.roomId[ti]].visited)) { const k = 0.075 + Math.min(0.07, (lr + lg + lb) * 0.04); r = k * 0.8; g = k * 0.95; b = k * 1.3; }
        }
      }
      this.vis[j * this.lw + i] = v;
      d[o] = r > 1 ? 255 : r * 255; d[o + 1] = g > 1 ? 255 : g * 255; d[o + 2] = b > 1 ? 255 : b * 255; d[o + 3] = 255;
    }
    this.lctx.putImageData(this.limg, 0, 0);
    const c = this.ctx;
    c.globalCompositeOperation = 'multiply';
    c.imageSmoothingEnabled = true;
    c.drawImage(this.lightCv, 0, 0, this.lw, this.lh, l0x * CELL - camX, l0y * CELL - camY, this.lw * CELL, this.lh * CELL);
    c.imageSmoothingEnabled = false;
    c.globalCompositeOperation = 'source-over';
  }

  drawHuman(c, h, sx, sy) {
    const sheet = S.humans[h.charId] || S.humans.player;
    if (h.dead || h.downed) {
      c.save(); c.translate(sx, sy - 2); c.rotate(Math.PI / 2 * (h.id % 2 ? 1 : -1));
      if (h.dead) c.globalAlpha = 0.75;
      c.drawImage(sheet[0][0], -6, -9);
      c.restore();
      return;
    }
    const ca = Math.cos(h.aim), sa = Math.sin(h.aim);
    const dir = Math.abs(ca) > 0.72 ? 2 : sa > 0 ? 0 : 1, flip = dir === 2 && ca < 0;
    const fr = h.moving ? Math.floor(h.anim) % 4 : 0;
    c.fillStyle = 'rgba(0,0,0,0.38)'; c.fillRect(sx - 4, sy - 1, 8, 3); c.fillRect(sx - 3, sy + 2, 6, 1);
    const ang = h.aim + h.sway + (h.reloading ? (ca < 0 ? -0.7 : 0.7) : 0) + (h.busyT > 0 ? (ca < 0 ? -1.2 : 1.2) : 0);
    const gun = () => {
      const w = S.weapons[h.weapons[h.cur].id];
      c.save();
      c.translate(sx + Math.round(Math.cos(ang) * (3 - h.recoil)), sy - 6 + Math.round(Math.sin(ang) * (3 - h.recoil)));
      c.rotate(ang);
      if (ca < 0) c.scale(1, -1);
      c.drawImage(w.cv, -w.px, -w.py);
      c.restore();
    };
    if (dir === 1) gun();
    const body = sheet[dir][fr];
    if (flip) { c.save(); c.translate(sx, 0); c.scale(-1, 1); c.drawImage(body, -6, sy - 15); c.restore(); } else c.drawImage(body, sx - 6, sy - 15);
    if (h.hurtT > 0) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.7; if (flip) { c.save(); c.translate(sx, 0); c.scale(-1, 1); c.drawImage(body, -6, sy - 15); c.restore(); } else c.drawImage(body, sx - 6, sy - 15); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; }
    if (dir !== 1) gun();
  }

  line(c, x0, y0, x1, y1, col) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    c.fillStyle = col;
    for (let n = 0; n < 400; n++) {
      c.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  blob(c, x, y, w, h, col, hi) {
    x = Math.round(x - w / 2); y = Math.round(y - h / 2);
    c.fillStyle = OUTC; c.fillRect(x, y - 1, w, h + 2); c.fillRect(x - 1, y, w + 2, h);
    c.fillStyle = col; c.fillRect(x, y, w, h);
    if (hi) { c.fillStyle = hi; c.fillRect(x, y, Math.max(1, w - 1), 1); c.fillRect(x, y, 1, Math.max(1, h - 1)); }
  }

  // em=true draws only the glowing parts.
  drawAlien(c, a, sx, sy, em) {
    const t = a.anim, fx = Math.cos(a.facing), fy = Math.sin(a.facing), px = -fy, py = fx;
    const hurt = a.hurtT > 0;
    const sp = a.spawnT > 0;
    if (!em && a.type !== 'nest') { c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(Math.round(sx - a.r), Math.round(sy + a.r * 0.4), Math.round(a.r * 2), 2); }
    if (a.type === 'skitterer') {
      const body = hurt ? '#c8a8d8' : '#3d2a44', hi = hurt ? '#fff' : '#6d4c70', leg = hurt ? '#c8a8d8' : '#241828';
      if (!em) {
        const mv = a.moving ? 16 : 2;
        for (let i = -1; i <= 1; i++) for (const s of [-1, 1]) {
          const ph = t * mv + i * 2.1 + (s > 0 ? Math.PI : 0) + (i === 0 ? Math.PI : 0);
          const ax = sx + fx * i * 2.2, ay = sy + fy * i * 2.2;
          const kx = ax + px * s * 3.5 + fx * i, ky = ay + py * s * 3.5 + fy * i - 2;
          const ex = ax + px * s * (6.5 + Math.sin(ph)) + fx * (Math.cos(ph) * 2.4 + i * 1.6), ey = ay + py * s * (6.5 + Math.sin(ph)) + fy * (Math.cos(ph) * 2.4 + i * 1.6);
          this.line(c, ax, ay, kx, ky, leg); this.line(c, kx, ky, ex, ey, leg);
          c.fillStyle = hi; c.fillRect(Math.round(kx), Math.round(ky), 1, 1);
        }
        if (sp) return;
        this.blob(c, sx - fx * 3, sy - fy * 3 - 1, 5, 4, body, hi);
        this.blob(c, sx, sy - 1, 4, 3, body, hi);
        this.blob(c, sx + fx * 3.2, sy + fy * 3.2 - 1, 3, 3, body, hi);
      } else if (!sp) { c.fillStyle = '#ffb040'; c.fillRect(Math.round(sx + fx * 4 + px), Math.round(sy + fy * 4 + py - 1), 1, 1); c.fillRect(Math.round(sx + fx * 4 - px), Math.round(sy + fy * 4 - py - 1), 1, 1); }
    } else if (a.type === 'lurker') {
      const tr = a._tr || (a._tr = []);
      if (!tr.length || dist(tr[0].x, tr[0].y, a.x, a.y) > 3.2) { tr.unshift({ x: a.x, y: a.y }); if (tr.length > 8) tr.pop(); }
      const strike = a.act === 'strike';
      if (!em) {
        if (a.cloak) c.globalAlpha = 0.16 + 0.06 * Math.sin(t * 3);
        const body = hurt ? '#b8d0e0' : '#151b28', hi = hurt ? '#fff' : '#2f3f5a';
        for (let i = tr.length - 1; i >= 1; i--) { const s = Math.max(2, 5 - Math.floor(i * 0.5)); this.blob(c, tr[i].x - this.cam.x, tr[i].y - this.cam.y - 1, s, s, body, hi); }
        const reach = strike ? 10 : 7;
        for (const s of [-1, 1]) {
          const ph = Math.sin(t * (a.moving ? 9 : 1.5) + (s > 0 ? 0 : Math.PI));
          const ex = sx + fx * (reach + ph * 3) + px * s * (5 - ph), ey = sy + fy * (reach + ph * 3) + py * s * (5 - ph);
          const kx = sx + fx * 2 + px * s * 6, ky = sy + fy * 2 + py * s * 6 - 3;
          this.line(c, sx, sy - 1, kx, ky, body); this.line(c, kx, ky, ex, ey, body);
          c.fillStyle = hi; c.fillRect(Math.round(ex), Math.round(ey), 1, 1);
        }
        this.blob(c, sx + fx * 2, sy + fy * 2 - 2, 6, 5, body, hi);
        c.globalAlpha = 1;
      } else if (!a.cloak || Math.sin(t * 1.7 + a.id) > 0.55 || strike) {
        c.fillStyle = '#9ff4ff';
        c.fillRect(Math.round(sx + fx * 4 + px * 1.5), Math.round(sy + fy * 4 + py * 1.5 - 2), 1, 1); c.fillRect(Math.round(sx + fx * 4 - px * 1.5), Math.round(sy + fy * 4 - py * 1.5 - 2), 1, 1);
      }
    } else if (a.type === 'brute') {
      const wob = a.windup > 0 ? Math.round(Math.sin(t * 60)) : 0;
      const body = hurt ? '#e8c0c0' : '#4a2c36', hi = hurt ? '#fff' : '#7a4852', dk = '#2c1a22';
      const X = sx + wob, Y = sy;
      if (!em) {
        for (const s of [-1, 1]) {
          const sw = a.atkAnim > 0 ? 6 : Math.sin(t * (a.moving ? 7 : 1) + (s > 0 ? 0 : Math.PI)) * 3;
          const ex = X + fx * (9 + sw) + px * s * 9, ey = Y + fy * (9 + sw) + py * s * 9;
          const kx = X + px * s * 9, ky = Y + py * s * 9 - 2;
          for (let o = -1; o <= 1; o++) { this.line(c, X + px * s * 5, Y + py * s * 5 + o, kx, ky + o, dk); this.line(c, kx, ky + o, ex, ey + o, dk); }
          this.blob(c, ex, ey, 4, 4, body, hi);
        }
        this.blob(c, X - fx * 4, Y - fy * 4 - 2, 14, 12, body, hi);
        this.blob(c, X + fx * 2, Y + fy * 2 - 3, 12, 10, body, hi);
        c.fillStyle = dk;
        for (let i = -1; i <= 1; i++) c.fillRect(Math.round(X - fx * 4 + px * i * 4 - 1), Math.round(Y - fy * 4 + py * i * 4 - 4), 3, 2);
        this.blob(c, X + fx * 8, Y + fy * 8 - 3, 6, 5, dk, body);
        if (a.stun > 0) for (let i = 0; i < 3; i++) { const an = t * 6 + i * 2.1; c.fillStyle = '#ffe080'; c.fillRect(Math.round(X + Math.cos(an) * 8), Math.round(Y - 12 + Math.sin(an) * 3), 1, 1); }
      } else {
        c.fillStyle = a.windup > 0 || a.charge ? '#ffb090' : '#ff4a3a';
        c.fillRect(Math.round(X + fx * 10 + px * 2), Math.round(Y + fy * 10 + py * 2 - 3), 1, 1); c.fillRect(Math.round(X + fx * 10 - px * 2), Math.round(Y + fy * 10 - py * 2 - 3), 1, 1);
        c.fillStyle = '#a82a22';
        for (const s of [-1, 1]) c.fillRect(Math.round(X - fx * 5 + px * s * 4), Math.round(Y - fy * 5 + py * s * 4 - 3), 2, 1);
      }
    } else if (a.type === 'spitter') {
      const sw = a.atkT > 0 ? 2 : Math.round(Math.sin(t * 3) * 0.6);
      const body = hurt ? '#e0f0c0' : '#2c3a26', hi = hurt ? '#fff' : '#4d6a3a', sac = hurt ? '#fff' : '#5f8a34';
      if (!em) {
        for (const s of [-1, 1]) for (const k of [-1, 0, 1]) { const ph = Math.sin(t * (a.moving ? 12 : 1) + k * 2 + s); const kx = sx + fx * k * 3 + px * s * 4, ky = sy + fy * k * 3 + py * s * 4 - 2; this.line(c, sx + fx * k * 2, sy + fy * k * 2 - 1, kx, ky, '#1a2414'); this.line(c, kx, ky, sx + fx * (k * 4 + ph) + px * s * 7, sy + fy * (k * 4 + ph) + py * s * 7 + 1, '#1a2414'); }
        this.blob(c, sx - fx * 3, sy - fy * 3 - 2, 8 + sw, 7 + sw, sac, '#86b84a');
        c.fillStyle = '#b6e060'; c.fillRect(Math.round(sx - fx * 3 - 2), Math.round(sy - fy * 3 - 4), 2, 1); c.fillRect(Math.round(sx - fx * 3 + 1), Math.round(sy - fy * 3 - 1), 1, 1);
        c.fillStyle = '#3d5a22'; c.fillRect(Math.round(sx - fx * 3 - 3), Math.round(sy - fy * 3), 2, 2);
        this.blob(c, sx + fx * 2, sy + fy * 2 - 2, 6, 5, body, hi);
        this.blob(c, sx + fx * 5, sy + fy * 5 - 2, 3, 3, '#1a2414', body);
      } else { c.fillStyle = a.atkT > 0 ? '#e8ffa0' : '#9be84a'; c.globalAlpha = 0.35 + 0.3 * Math.sin(t * 4) + (a.atkT > 0 ? 0.3 : 0); c.fillRect(Math.round(sx - fx * 3 - 2), Math.round(sy - fy * 3 - 4), 4 + sw, 4 + sw); c.fillStyle = '#d8ff80'; c.globalAlpha = 1; c.fillRect(Math.round(sx + fx * 6), Math.round(sy + fy * 6 - 2), 1, 1); }
    } else if (a.type === 'shrieker') {
      const scr = a.screamT > 0, spread = scr ? 1.5 : 0.45 + Math.sin(t * 2) * 0.08;
      const body = hurt ? '#f0d0e8' : '#3a2238', hi = hurt ? '#fff' : '#6a3a62';
      const jx = scr ? Math.round(Math.sin(t * 70)) : 0;
      if (!em) {
        for (const s of [-1, 1]) for (const k of [-1, 1]) { const ph = Math.sin(t * (a.moving ? 14 : 1) + k * 2 + s); this.line(c, sx, sy, sx + fx * k * (3 + ph) + px * s * 5, sy + fy * k * (3 + ph) + py * s * 5 + 1, '#22141f'); }
        for (let i = -2; i <= 2; i++) { const an = a.facing + Math.PI + (i * spread) / 2, len = scr ? 10 : 7; this.line(c, sx + fx * 2 + jx, sy + fy * 2 - 3, sx + fx * 2 + Math.cos(an) * len + jx, sy + fy * 2 - 3 + Math.sin(an) * len, '#7a2a6c'); }
        this.blob(c, sx - fx * 2 + jx, sy - fy * 2 - 2, 4, 4, body, hi);
        this.blob(c, sx + fx * 2 + jx, sy + fy * 2 - 3, 5, 4, body, hi);
      } else for (let i = -2; i <= 2; i++) { const an = a.facing + Math.PI + (i * spread) / 2, len = scr ? 10 : 7; c.fillStyle = scr ? '#ffd0f8' : '#f04ad0'; c.fillRect(Math.round(sx + fx * 2 + Math.cos(an) * len + jx), Math.round(sy + fy * 2 - 3 + Math.sin(an) * len), 1, 1); }
    } else if (a.type === 'nest') {
      const pu = Math.sin(t * 2.4);
      if (!em) {
        const b = hurt ? '#d0b0d8' : '#3b2140';
        for (let i = 0; i < 7; i++) { const an = i * 0.9 + 0.3, len = 13 + (i % 3) * 3; this.line(c, sx, sy, sx + Math.cos(an) * len, sy + Math.sin(an) * len * 0.7, '#2a1630'); }
        this.blob(c, sx, sy - 2, 22, 15, b, '#5a2e5c');
        this.blob(c, sx - 5, sy - 7, 10, 9, b, '#6d3a6a');
        this.blob(c, sx + 6, sy - 5, 9 + Math.round(pu), 8, b, '#6d3a6a');
        this.blob(c, sx - 1, sy + 1, 8, 6, '#2a1630', '#4a2a50');
      } else {
        c.globalAlpha = 0.5 + 0.3 * pu;
        c.fillStyle = '#e080ff'; c.fillRect(sx - 7, sy - 9, 4, 4); c.fillRect(sx + 5, sy - 6, 4, 3); c.fillRect(sx - 2, sy - 1, 3, 2);
        c.globalAlpha = 1;
      }
    }
  }

  draw(world, dt, ui) {
    const c = this.ctx, m = world.map, p = world.player, r = this.rng;
    this.t += dt;
    // Camera.
    const ax = ui && ui.aimSX !== undefined ? (ui.aimSX - VW / 2) * 0.22 : 0, ay = ui && ui.aimSY !== undefined ? (ui.aimSY - VH / 2) * 0.22 : 0;
    const tx = p.x - VW / 2 + ax, ty = p.y - 4 - VH / 2 + ay;
    const k = 1 - Math.pow(0.0006, dt);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
    this.kx *= Math.pow(0.0001, dt); this.ky *= Math.pow(0.0001, dt);
    this.shake = Math.max(0, this.shake - dt * 18);
    const camX = Math.round(this.cam.x + this.kx + r.range(-1, 1) * this.shake), camY = Math.round(this.cam.y + this.ky + r.range(-1, 1) * this.shake);
    this.camX = camX; this.camY = camY;
    const saveCam = this.cam; this.cam = { x: camX, y: camY, rx: saveCam.x, ry: saveCam.y };
    // Space.
    const ox = ((Math.floor(camX * 0.08) % 256) + 256) % 256, oy = ((Math.floor(camY * 0.08) % 256) + 256) % 256;
    for (let yy = -oy; yy < VH; yy += 256) for (let xx = -ox; xx < VW; xx += 256) c.drawImage(S.stars, xx, yy);
    c.drawImage(this.mapCv, camX, camY, VW, VH, 0, 0, VW, VH);
    c.drawImage(this.decCv, camX, camY, VW, VH, 0, 0, VW, VH);
    const inView = (x, y, pad = 40) => x > camX - pad && x < camX + VW + pad && y > camY - pad && y < camY + VH + pad;
    // Floor layer.
    for (const v of m.vents) if (inView(v.px, v.py)) { if (v.rattle > 0) v.rattle -= dt * 2; const j = v.rattle > 0 ? Math.round(Math.sin(this.t * 80)) : 0; c.drawImage(v.sealed ? S.ventSealed : S.vent, v.px - 7 - camX + j, v.py - 6 - camY); }
    for (const q of world.pools) { const sx = Math.round(q.x - camX), sy = Math.round(q.y - camY); c.fillStyle = 'rgba(90,150,40,' + Math.min(0.7, q.life / 3) + ')'; c.fillRect(sx - 9, sy - 5, 18, 10); c.fillRect(sx - 6, sy - 7, 12, 14); c.fillStyle = 'rgba(190,255,110,0.5)'; c.fillRect(sx - 4 + Math.round(Math.sin(this.t * 5 + q.x) * 3), sy - 2, 2, 1); }
    for (const sp of m.soft) if (inView(sp.px, sp.py)) c.drawImage(S.props['corpse' + (sp.v % 3)].cv, sp.px - 9 - camX, sp.py - 7 - camY);
    for (const h of world.humans) if (h.dead || h.downed) this.drawHuman(c, h, Math.round(h.x - camX), Math.round(h.y - camY));
    // Y-sorted layer.
    const list = [];
    for (const pr of m.props) {
      if (!PROPS[pr.type].solid) continue;
      const bx = pr.x * TILE, by = (pr.y + pr.h) * TILE;
      if (bx > camX + VW + 8 || bx + pr.w * TILE < camX - 8 || by < camY - 8 || by > camY + VH + 70) continue;
      list.push({ y: by - 3, k: 0, o: pr });
    }
    for (const d of m.doors) if (inView(d.px, d.py)) list.push({ y: d.py + (d.orient === 'h' ? 8 : 4), k: 1, o: d });
    for (const h of world.humans) if (!h.dead && !h.downed && inView(h.x, h.y)) list.push({ y: h.y, k: 2, o: h });
    for (const a of world.aliens) if (!a.dead && a.inVent <= 0 && inView(a.x, a.y)) list.push({ y: a.y, k: 3, o: a });
    for (const q of world.pickups) if (inView(q.x, q.y)) list.push({ y: q.y - 2, k: 4, o: q });
    for (const q of world.projs) list.push({ y: q.y, k: 5, o: q });
    list.sort((a, b) => a.y - b.y);
    const emis = [];
    for (const e of list) {
      const o = e.o;
      if (e.k === 0) {
        let name = o.type;
        if (o.type === 'crate' || o.type === 'crate2') name += o.v % 3;
        if (o.searched && S.props[o.type + '_open']) name = o.type + '_open';
        const sp = S.props[name];
        if (!sp) continue;
        const sx = o.x * TILE - camX, sy = o.y * TILE - sp.up - camY;
        c.drawImage(sp.cv, sx, sy);
        if (sp.em) { const on = world.power[m.rooms[o.room] ? m.rooms[o.room].section : 0]; if (on) emis.push({ cv: sp.em, x: sx, y: sy, wx: o.px, wy: o.py }); else if (['objconsole', 'terminal', 'cryopod', 'tank', 'pod', 'reactor', 'medstation'].includes(o.type)) emis.push({ cv: sp.em, x: sx, y: sy, wx: o.px, wy: o.py, a: o.type === 'reactor' ? 0.25 : 0.5 }); }
      } else if (e.k === 1) this.drawDoor(c, o, world, camX, camY, emis);
      else if (e.k === 2) this.drawHuman(c, o, Math.round(o.x - camX), Math.round(o.y - camY));
      else if (e.k === 3) { if (this.visPrev(o.x, o.y) || this.debug) { this.drawAlien(c, o, Math.round(o.x - camX), Math.round(o.y - camY), false); emis.push({ alien: o }); } }
      else if (e.k === 4) {
        const sx = Math.round(o.x - camX), sy = Math.round(o.y - camY + Math.sin(this.t * 3 + o.id) * 1);
        const f = Math.min(1, o.t / 0.25), lx = o.ox + (o.x - o.ox) * f, ly = o.oy + (o.y - o.oy) * f - Math.sin(f * Math.PI) * 8;
        const X = f < 1 ? Math.round(lx - camX) : sx, Y = f < 1 ? Math.round(ly - camY) : sy;
        c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(sx - 4, Math.round(o.y - camY) + 3, 8, 2);
        const ic = o.item.startsWith('w:') ? S.weapons[o.item.slice(2)].cv : S.items[o.item];
        if (ic) c.drawImage(ic, X - (ic.width >> 1), Y - (ic.height >> 1) - 1);
        emis.push({ glint: true, x: X, y: Y - 4, id: o.id, key: !o.item.startsWith('a:') && !o.item.startsWith('w:') && ['fuse', 'relay', 'fuelcell', 'datacore', 'filter', 'key_sec', 'key_cmd'].includes(o.item) });
      } else if (e.k === 5) {
        const sx = Math.round(o.x - camX), sy = Math.round(o.y - camY);
        c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(sx - 2, sy + 1, 4, 2);
        if (o.kind === 'acid') emis.push({ acid: true, x: sx, y: sy - Math.round(o.z) });
        else { const ic = S.items[o.kind]; c.drawImage(ic, sx - 6, sy - 6 - Math.round(o.z)); }
      }
    }
    for (const l of world.lures) { const sx = Math.round(l.x - camX), sy = Math.round(l.y - camY); c.drawImage(S.items.lure, sx - 6, sy - 7); }
    for (const f of world.flares) { const sx = Math.round(f.x - camX), sy = Math.round(f.y - camY); c.drawImage(S.items.flare, sx - 6, sy - 6); if (r.chance(0.5)) this.part({ x: f.x + 4, y: f.y, z: 2, vx: r.range(-20, 20), vy: r.range(-20, 20), vz: r.range(20, 60), g: 120, col: r.pick(['#ff5040', '#ffc0a0', '#fff']), em: true, life: r.range(0.2, 0.5) }); if (r.chance(0.12)) this.smoke(f.x, f.y - 4, 1, 'rgba(150,90,90,'); }
    for (const f of world.fires) if (inView(f.x, f.y) && r.chance(0.1)) { this.part({ x: f.x + r.range(-5, 5), y: f.y - 6, vy: -r.range(15, 30), vx: r.range(-5, 5), col: '#ffb040', em: true, life: r.range(0.4, 0.9) }); if (r.chance(0.3)) this.smoke(f.x, f.y - 8, 1, 'rgba(60,60,64,'); }
    // Particles (lit).
    this.updateParts(dt, c, camX, camY, false);
    // Lighting.
    this.lightPass(world, camX, camY);
    // Emissive pass.
    c.globalCompositeOperation = 'lighter';
    for (const l of m.lights) {
      if (l.off || !inView(l.x, l.y, 30) || !this.visAt(l.x, l.y)) continue;
      const on = world.power[l.section];
      let a = 0;
      if (l.kind === 'emerg') { if (!on) a = 0.5 + 0.3 * Math.sin(world.time * 2.2 + l.phase); }
      else if (l.kind === 'main') { if (on && l.state !== 'dead') a = l.state === 'flicker' ? (l.flickVal === undefined ? 1 : l.flickVal) * 0.8 : 0.8; if (world.light.brownout > 0) a *= 0.3 + 0.7 * (Math.sin(world.time * 31 + l.phase) > 0.2 ? 1 : 0); }
      if (a <= 0.02) continue;
      const col = l.kind === 'emerg' ? [255, 60, 40] : [Math.round(l.col[0] * 255), Math.round(l.col[1] * 255), Math.round(l.col[2] * 255)];
      c.globalAlpha = a * 0.5;
      const g = glow(l.kind === 'emerg' ? 9 : 12, col, 1.6);
      c.drawImage(g, Math.round(l.x - camX - g.width / 2), Math.round(l.y - camY - g.height / 2));
      c.globalAlpha = a;
      c.fillStyle = 'rgb(' + col.join(',') + ')';
      c.fillRect(Math.round(l.x - camX) - 2, Math.round(l.y - camY) - 1, 4, 2);
    }
    c.globalAlpha = 1;
    for (const e of emis) {
      if (e.alien) { this.drawAlien(c, e.alien, Math.round(e.alien.x - camX), Math.round(e.alien.y - camY), true); continue; }
      if ((e.glint || e.led) && !this.visAt(e.x + camX, e.y + camY + 4)) continue;
      if (e.glint) { const tw = Math.sin(this.t * 4 + e.id * 1.7); if (tw > 0.5 || e.key) { c.globalAlpha = e.key ? 0.6 + 0.4 * tw : (tw - 0.5) * 2; c.fillStyle = e.key ? '#ffe080' : '#ffffff'; c.fillRect(e.x - 1, e.y, 3, 1); c.fillRect(e.x, e.y - 1, 1, 3); if (e.key) { const g = glow(8, [255, 210, 110], 2); c.globalAlpha = 0.35; c.drawImage(g, e.x - 8, e.y - 4); } c.globalAlpha = 1; } continue; }
      if (e.acid) { c.fillStyle = '#b8ff60'; c.fillRect(e.x - 2, e.y - 2, 4, 4); c.fillStyle = '#eaffc0'; c.fillRect(e.x - 1, e.y - 2, 2, 2); continue; }
      if (e.led) { c.fillStyle = e.led; c.fillRect(e.x, e.y, 2, 1); continue; }
      if (!this.visAt(e.wx, e.wy)) continue;
      c.globalAlpha = (e.a || 1) * (0.85 + 0.15 * Math.sin(this.t * 9 + e.x));
      c.drawImage(e.cv, e.x, e.y);
      c.globalAlpha = 1;
    }
    // Fires.
    for (const f of world.fires) {
      if (!inView(f.x, f.y)) continue;
      const sx = Math.round(f.x - camX), sy = Math.round(f.y - camY), fl = Math.min(1, f.life / 1.5);
      for (let i = 0; i < 4; i++) {
        const hgt = Math.round((4 + 5 * Math.abs(Math.sin(this.t * (7 + i) + f.ph + i * 1.3))) * fl), xo = (i - 1.5) * 3;
        c.fillStyle = '#ff5a1a'; c.fillRect(Math.round(sx + xo - 1), sy - hgt, 3, hgt + 1);
        c.fillStyle = '#ffb040'; c.fillRect(Math.round(sx + xo), sy - hgt + 2, 2, Math.max(0, hgt - 2));
        if (hgt > 5) { c.fillStyle = '#fff0a0'; c.fillRect(Math.round(sx + xo), sy - 2, 1, 2); }
      }
    }
    for (const f of world.flares) { const g = glow(14, [255, 90, 70], 1.5); c.globalAlpha = 0.7; c.drawImage(g, Math.round(f.x - camX) - 10, Math.round(f.y - camY) - 14); c.globalAlpha = 1; c.fillStyle = '#fff'; c.fillRect(Math.round(f.x - camX) + 3, Math.round(f.y - camY) - 1, 2, 2); }
    for (const l of world.lures) if (l.beep > 0.35) { c.fillStyle = '#3fe07a'; c.fillRect(Math.round(l.x - camX) - 1, Math.round(l.y - camY) - 4, 2, 2); }
    // Tracers and muzzle flashes.
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t -= dt;
      if (tr.t <= 0) { this.tracers.splice(i, 1); continue; }
      const f = tr.t / tr.max;
      if (tr.w === 'arc') {
        let x0 = tr.x - camX, y0 = tr.y - camY;
        const n = Math.max(2, Math.floor(dist(tr.x, tr.y, tr.x2, tr.y2) / 9));
        for (let s = 1; s <= n; s++) { const u = s / n; const x1 = tr.x + (tr.x2 - tr.x) * u - camX + (s < n ? r.range(-4, 4) : 0), y1 = tr.y + (tr.y2 - tr.y) * u - camY + (s < n ? r.range(-4, 4) : 0); this.line(c, x0, y0, x1, y1, f > 0.5 ? '#eaffff' : '#5fd6e8'); x0 = x1; y0 = y1; }
      } else {
        const len = dist(tr.x, tr.y, tr.x2, tr.y2), a0 = Math.max(0, 1 - f - 0.25), a1 = Math.min(1, 1 - f + 0.45);
        c.globalAlpha = 0.85;
        this.line(c, tr.x + (tr.x2 - tr.x) * a0 - camX, tr.y + (tr.y2 - tr.y) * a0 - camY, tr.x + (tr.x2 - tr.x) * a1 - camX, tr.y + (tr.y2 - tr.y) * a1 - camY, len > 0 ? '#ffe9b0' : '#fff');
        c.globalAlpha = 1;
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t -= dt;
      if (f.t <= 0) { this.flashes.splice(i, 1); continue; }
      if (f.w === 'flamer') continue;
      const sx = f.x - camX, sy = f.y - camY - 3, big = f.w === 'shotgun' ? 9 : f.w === 'rifle' ? 7 : 5, col = f.w === 'arc' ? '#aef2ff' : '#ffd070';
      const g = glow(big + 5, f.w === 'arc' ? [140, 220, 255] : [255, 200, 110], 1.4);
      c.drawImage(g, Math.round(sx - g.width / 2), Math.round(sy - g.height / 2));
      this.line(c, sx, sy, sx + Math.cos(f.ang) * big, sy + Math.sin(f.ang) * big, '#fff');
      this.line(c, sx, sy, sx + Math.cos(f.ang + 0.6) * big * 0.6, sy + Math.sin(f.ang + 0.6) * big * 0.6, col);
      this.line(c, sx, sy, sx + Math.cos(f.ang - 0.6) * big * 0.6, sy + Math.sin(f.ang - 0.6) * big * 0.6, col);
      c.fillStyle = '#fff'; c.fillRect(Math.round(sx) - 1, Math.round(sy) - 1, 3, 3);
    }
    this.updateParts(dt, c, camX, camY, true);
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i];
      s.t -= dt;
      if (s.t <= 0) { this.slashes.splice(i, 1); continue; }
      const sx = s.x - camX, sy = s.y - camY, n = s.big ? 4 : 3, len = s.big ? 9 : 5;
      for (let q = 0; q < n; q++) { const o = (q - (n - 1) / 2) * 3, a = s.ang + 1.2; this.line(c, sx + Math.cos(s.ang + 1.57) * o - Math.cos(a) * len, sy + Math.sin(s.ang + 1.57) * o - Math.sin(a) * len, sx + Math.cos(s.ang + 1.57) * o + Math.cos(a) * len, sy + Math.sin(s.ang + 1.57) * o + Math.sin(a) * len, s.white ? '#ffffff' : '#ff8a80'); }
    }
    // Dust motes drifting through light.
    for (const mo of this.motes) {
      mo.x += mo.vx * dt; mo.y += mo.vy * dt + Math.sin(this.t + mo.p) * dt * 2;
      const sx = (((mo.x - camX * 0.9) % VW) + VW) % VW, sy = (((mo.y - camY * 0.9) % VH) + VH) % VH;
      const lv = world.light.at(sx + camX, sy + camY);
      if (lv > 0.22 && this.visAt(sx + camX, sy + camY)) { c.globalAlpha = Math.min(0.5, lv * 0.5) * (0.5 + 0.5 * Math.sin(this.t * 2 + mo.p)); c.fillStyle = '#cfd8e8'; c.fillRect(Math.round(sx), Math.round(sy), 1, 1); }
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const rg = this.rings[i];
      rg.t -= dt; rg.r += (rg.max - rg.r) * Math.min(1, dt * 9);
      if (rg.t <= 0) { this.rings.splice(i, 1); continue; }
      c.globalAlpha = Math.min(1, rg.t * 4) * 0.8;
      this.ring(c, rg.x - camX, rg.y - camY, rg.r, rg.col);
      c.globalAlpha = 1;
    }
    this.vprevOK = true;
    if (this.debug) this.drawDebug(c, world, camX, camY);
    this.cam = saveCam;
  }

  // Visibility test usable before this frame's light pass (uses last frame's grid).
  visPrev(wx, wy) { return !this.vprevOK || this.visAt(wx, wy); }

  ring(c, cx, cy, rad, col) {
    c.fillStyle = col;
    const n = Math.max(8, Math.floor(rad * 3));
    for (let i = 0; i < n; i++) { const a = (i / n) * 6.283; c.fillRect(Math.round(cx + Math.cos(a) * rad), Math.round(cy + Math.sin(a) * rad * 0.8), 1, 1); }
  }

  drawDoor(c, d, world, camX, camY, emis) {
    const x = d.x * TILE - camX, y = d.y * TILE - camY, o = d.open, powered = world.power[d.section];
    const led = d.broken ? null : d.welded ? '#aef2ff' : d.lock ? '#ff4030' : powered ? '#40ff80' : '#ffb030';
    if (d.broken) { c.fillStyle = '#3a414c'; c.fillRect(x + 1, y + 9, 4, 3); c.fillRect(x + 10, y + 3, 5, 2); c.fillStyle = '#59626f'; c.fillRect(x + 2, y + 9, 2, 1); return; }
    if (d.orient === 'h') {
      const w = Math.round(8 * (1 - o));
      c.fillStyle = '#2a303b'; c.fillRect(x, y - 2, 16, 3);
      if (w > 0) {
        for (const s of [0, 1]) {
          const px = s ? x + 16 - w : x;
          c.fillStyle = '#5c687a'; c.fillRect(px, y + 1, w, 15);
          c.fillStyle = '#7d8a9e'; c.fillRect(px, y + 1, w, 1);
          c.fillStyle = '#3d4654'; c.fillRect(px, y + 11, w, 4);
          c.fillStyle = '#b99a2e'; for (let i = 0; i < w; i += 4) c.fillRect(px + i, y + 12, 2, 2);
          c.fillStyle = '#12151b'; c.fillRect(s ? px : px + w - 1, y + 1, 1, 15);
        }
        if (d.welded) { c.fillStyle = '#c8e8ff'; for (let i = 2; i < 15; i += 3) c.fillRect(x + 7, y + i, 2, 2); }
      }
      emis.push({ led, x: x + 7, y: y - 1 });
    } else {
      const hgt = Math.round(8 * (1 - o));
      c.fillStyle = '#2a303b'; c.fillRect(x + 4, y - 1, 8, 2); c.fillRect(x + 4, y + 15, 8, 1);
      if (hgt > 0) {
        for (const s of [0, 1]) {
          const py = s ? y + 16 - hgt : y;
          c.fillStyle = '#6b778a'; c.fillRect(x + 5, py, 6, hgt);
          c.fillStyle = '#8e9bb0'; c.fillRect(x + 5, py, 1, hgt);
          c.fillStyle = '#414a59'; c.fillRect(x + 10, py, 1, hgt);
          c.fillStyle = '#12151b'; c.fillRect(x + 5, s ? py : py + hgt - 1, 6, 1);
        }
        if (d.welded) { c.fillStyle = '#c8e8ff'; for (let i = 5; i < 11; i += 2) c.fillRect(x + i, y + 7, 1, 2); }
      }
      emis.push({ led, x: x + 7, y: y - 1 });
    }
  }

  updateParts(dt, c, camX, camY, em) {
    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      if (!!p.em !== em) continue;
      p.t += dt;
      if (p.t >= p.life) { ps.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.drag) { const f = Math.pow(0.5, dt * p.drag * 3); p.vx *= f; p.vy *= f; }
      if (p.g) {
        p.vz -= p.g * dt; p.z += p.vz * dt;
        if (p.z <= 0) {
          if (p.bounce) { p.bounce--; p.z = 0; p.vz = -p.vz * 0.4; p.vx *= 0.5; p.vy *= 0.5; }
          else {
            if (p.stamp) {
              const d = this.dctx;
              if (p.stamp === 'casing') { d.fillStyle = p.col; d.fillRect(Math.round(p.x), Math.round(p.y), 2, 1); }
              else if (p.stamp === 'debris') { d.fillStyle = p.col; d.fillRect(Math.round(p.x), Math.round(p.y), this.rng.int(1, 2), 1); }
              else { d.fillStyle = p.stamp === 'bloodDot' ? '#5a1212' : '#2f1c48'; d.fillRect(Math.round(p.x), Math.round(p.y), this.rng.int(1, 2), this.rng.int(1, 2)); }
            }
            ps.splice(i, 1); continue;
          }
        }
      }
      const sx = Math.round(p.x - camX), sy = Math.round(p.y - camY - p.z), f = p.t / p.life;
      if (p.smoke) { c.fillStyle = p.smoke + (0.22 * (1 - f)).toFixed(3) + ')'; const s = Math.round(p.size + f * 4); c.fillRect(sx - (s >> 1), sy - (s >> 1), s, s); }
      else if (p.flame) { c.fillStyle = f < 0.3 ? '#fff0a0' : f < 0.65 ? '#ffb040' : '#e0481a'; const s = Math.round(2 + f * 4); c.fillRect(sx - (s >> 1), sy - (s >> 1), s, s); }
      else if (p.plus) { c.fillStyle = p.col; c.fillRect(sx - 1, sy, 3, 1); c.fillRect(sx, sy - 1, 1, 3); }
      else { c.fillStyle = p.col; c.fillRect(sx, sy, p.size, p.size); }
    }
  }

  drawDebug(c, world, camX, camY) {
    for (const h of world.humans) {
      if (h.dead || !h.ai) continue;
      const sx = Math.round(h.x - camX), sy = Math.round(h.y - camY);
      text(c, h.ai.act + ': ' + h.ai.why, sx, sy + 6, '#8fd0ff', { align: 0.5 });
      text(c, h.ai.scores.map((s) => s[0].slice(0, 3) + s[1]).join(' '), sx, sy + 13, '#5d6673', { align: 0.5 });
      if (h.ai.path) { let px = h.x, py = h.y; for (let i = h.ai.pi || 0; i < h.ai.path.length; i++) { const w = h.ai.path[i]; this.line(c, px - camX, py - camY, w.x - camX, w.y - camY, 'rgba(120,200,255,0.5)'); px = w.x; py = w.y; } }
    }
    for (const a of world.aliens) {
      if (a.dead || a.inVent > 0) continue;
      const sx = Math.round(a.x - camX), sy = Math.round(a.y - camY);
      if (sx < -40 || sy < -40 || sx > VW + 40 || sy > VH + 40) continue;
      text(c, a.act + ' ' + (a.aware || 0).toFixed(1), sx, sy + 8, a.target ? '#ff8a80' : '#e8c040', { align: 0.5 });
      text(c, a.why || '', sx, sy + 15, '#8a8f98', { align: 0.5 });
      if (a.lk) { this.ring(c, a.lk.x - camX, a.lk.y - camY, 4, '#e8c040'); this.line(c, sx, sy, a.lk.x - camX, a.lk.y - camY, 'rgba(232,192,64,0.25)'); }
      this.line(c, sx, sy, sx + Math.cos(a.facing) * 12, sy + Math.sin(a.facing) * 12, '#fff');
    }
    for (const n of world.heard) this.ring(c, n.x - camX, n.y - camY, Math.min(120, n.r * 0.3), n.kind === 'alien' ? 'rgba(240,74,208,0.5)' : 'rgba(255,255,255,0.4)');
  }
}
const OUTC = '#0a0b10';
export { ALIENS };

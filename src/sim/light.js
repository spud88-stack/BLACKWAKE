// Light grid at half-tile resolution. Drives rendering, alien sight and stress.
import { rayGrid } from './nav.js';
import { angDiff } from '../core/util.js';

const CELL = 8;

export class LightGrid {
  constructor(map) {
    this.map = map;
    this.w = map.w * 2;
    this.h = map.h * 2;
    const n = this.w * this.h * 3;
    this.stat = new Float32Array(n);
    this.buf = new Float32Array(n);
    this.cache = new Map();
    this.dirty = true;
    this.brownout = 0;
  }

  cast(x, y, r, cone, half) {
    const m = this.map, idx = [], val = [];
    const x0 = Math.max(0, Math.floor((x - r) / CELL)), x1 = Math.min(this.w - 1, Math.floor((x + r) / CELL));
    const y0 = Math.max(0, Math.floor((y - r) / CELL)), y1 = Math.min(this.h - 1, Math.floor((y + r) / CELL));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const px = cx * CELL + 4, py = cy * CELL + 4;
      const dx = px - x, dy = py - y, d = Math.hypot(dx, dy);
      if (d > r) continue;
      let f = 1 - d / r;
      f = f * Math.sqrt(f) * 1.25;
      if (cone !== undefined && d > 3) {
        const a = Math.abs(angDiff(cone, Math.atan2(dy, dx)));
        if (a > half) continue;
        f *= Math.min(1, (half - a) / 0.14);
      }
      if (f < 0.02) continue;
      if (rayGrid(m.opaque, m.w, m.h, x, y, px, py, true) < 1) continue;
      idx.push(cy * this.w + cx);
      val.push(f);
    }
    return { idx, val };
  }

  addCast(c, col, k) {
    const b = this.buf, idx = c.idx, val = c.val;
    const r = col[0] * k, g = col[1] * k, bl = col[2] * k;
    for (let i = 0; i < idx.length; i++) {
      const j = idx[i] * 3, v = val[i];
      b[j] += r * v; b[j + 1] += g * v; b[j + 2] += bl * v;
    }
  }

  invalidateNear(x, y) {
    for (const l of this.map.lights) if (Math.abs(l.x - x) < l.r + 16 && Math.abs(l.y - y) < l.r + 16) this.cache.delete(l.id);
    this.dirty = true;
  }

  // power: bool[] per section. dyn: [{x,y,r,col,k,cone,half}]
  update(time, power, dyn) {
    const lights = this.map.lights;
    const animated = [];
    if (this.dirty || this.brownout > 0 || this._wasBrown) {
      this.buf.fill(0);
      for (const l of lights) {
        const on = power[l.section];
        let k = 0;
        if (l.kind === 'emerg') { if (!on) animated.push(l); continue; }
        if ((!on && !l.backup) || l.state === 'dead' || l.off) continue;
        if (l.state === 'flicker' || l.kind === 'prop' && l.r > 60) { animated.push(l); continue; }
        k = l.inten * (on ? 1 : 0.5);
        if (this.brownout > 0 && l.kind === 'main') k *= 0.25 + 0.75 * (Math.sin(time * 31 + l.phase) > 0.2 ? 1 : 0);
        let c = this.cache.get(l.id);
        if (!c) { c = this.cast(l.x, l.y, l.r); this.cache.set(l.id, c); }
        this.addCast(c, l.col, k);
      }
      this.stat.set(this.buf);
      this._anim = animated;
      this._wasBrown = this.brownout > 0;
      this.dirty = false;
    } else this.buf.set(this.stat);
    for (const l of this._anim) {
      let k;
      if (l.kind === 'emerg') k = 0.8 + 0.25 * Math.sin(time * 2.2 + l.phase);
      else if (l.kind === 'prop') k = (0.8 + 0.2 * Math.sin(time * 1.7)) * (power[l.section] ? 1 : 0.3);
      else {
        const s = Math.sin(time * 13 + l.phase) + Math.sin(time * 7.3 + l.phase * 2.1) + Math.sin(time * 2.9 + l.phase);
        k = s > 1.1 ? 0.08 : s > 0.6 ? 0.5 : 1;
        l.flickVal = k;
      }
      let c = this.cache.get(l.id);
      if (!c) { c = this.cast(l.x, l.y, l.r); this.cache.set(l.id, c); }
      this.addCast(c, l.col, k * l.inten);
    }
    for (const d of dyn) this.addCast(this.cast(d.x, d.y, d.r, d.cone, d.half), d.col, d.k);
  }

  at(px, py) {
    const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return 0;
    const j = (cy * this.w + cx) * 3, b = this.buf;
    return Math.min(1, (b[j] + b[j + 1] + b[j + 2]) / 3);
  }
}

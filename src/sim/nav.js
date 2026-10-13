// Grid navigation: A*, ray casts, collision helpers.
import { TILE, tc } from '../core/util.js';

// Amanatides-Woo traversal. Returns t in [0,1] where the segment first enters a blocked
// tile, or 1 when clear. ignoreEnd lets the destination tile itself be blocked.
export function rayGrid(arr, W, H, x0, y0, x1, y1, ignoreEnd) {
  const dx = x1 - x0, dy = y1 - y0;
  let tx = Math.floor(x0 / TILE), ty = Math.floor(y0 / TILE);
  const ex = Math.floor(x1 / TILE), ey = Math.floor(y1 / TILE);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const tdx = adx > 1e-9 ? TILE / adx : Infinity, tdy = ady > 1e-9 ? TILE / ady : Infinity;
  let tmx = adx > 1e-9 ? (dx > 0 ? (tx + 1) * TILE - x0 : x0 - tx * TILE) / adx : Infinity;
  let tmy = ady > 1e-9 ? (dy > 0 ? (ty + 1) * TILE - y0 : y0 - ty * TILE) / ady : Infinity;
  let t = 0;
  for (let n = 0; n < 400; n++) {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return t;
    const end = tx === ex && ty === ey;
    if (end && ignoreEnd) return 1;
    if (arr[ty * W + tx]) return t;
    if (end) return 1;
    if (tmx < tmy) { t = tmx; tmx += tdx; tx += sx; } else { t = tmy; tmy += tdy; ty += sy; }
    if (t > 1) return 1;
  }
  return 1;
}

class Heap {
  constructor(n) { this.idx = new Int32Array(n); this.f = new Float32Array(n); this.n = 0; }
  clear() { this.n = 0; }
  push(i, f) {
    let k = this.n++;
    const idx = this.idx, ff = this.f;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (ff[p] <= f) break;
      idx[k] = idx[p]; ff[k] = ff[p]; k = p;
    }
    idx[k] = i; ff[k] = f;
  }
  pop() {
    const idx = this.idx, ff = this.f;
    const top = idx[0];
    const n = --this.n;
    if (n > 0) {
      const li = idx[n], lf = ff[n];
      let k = 0;
      for (;;) {
        let c = k * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && ff[c + 1] < ff[c]) c++;
        if (ff[c] >= lf) break;
        idx[k] = idx[c]; ff[k] = ff[c]; k = c;
      }
      idx[k] = li; ff[k] = lf;
    }
    return top;
  }
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

export class Nav {
  constructor(map) {
    this.map = map;
    const n = map.w * map.h;
    this.g = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.cur = 0;
    this.heap = new Heap(n * 4);
    this.searches = 0;
    this.expanded = 0;
  }

  los(x0, y0, x1, y1) {
    const m = this.map;
    return rayGrid(m.opaque, m.w, m.h, x0, y0, x1, y1, false) >= 1;
  }
  // Distance a shot travels before hitting something opaque.
  rayDist(x0, y0, ang, max) {
    const m = this.map;
    return rayGrid(m.opaque, m.w, m.h, x0, y0, x0 + Math.cos(ang) * max, y0 + Math.sin(ang) * max, false) * max;
  }
  walkLine(x0, y0, x1, y1) {
    const m = this.map;
    return rayGrid(m.solid, m.w, m.h, x0, y0, x1, y1, false) >= 1;
  }
  // Fat line test for path smoothing.
  clearLine(x0, y0, x1, y1, r) {
    const m = this.map, dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * r, ny = (dx / len) * r;
    return rayGrid(m.block, m.w, m.h, x0 + nx, y0 + ny, x1 + nx, y1 + ny, false) >= 1 &&
      rayGrid(m.block, m.w, m.h, x0 - nx, y0 - ny, x1 - nx, y1 - ny, false) >= 1 &&
      rayGrid(m.block, m.w, m.h, x0, y0, x1, y1, false) >= 1;
  }
  boxFree(x, y, r) {
    const m = this.map;
    const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h || m.solid[ty * m.w + tx]) return false;
    }
    return true;
  }
  // Axis-separated move. Returns true when blocked on either axis.
  move(e, dx, dy) {
    let hit = false;
    const r = e.r > 6 ? 6.4 : e.r;
    if (dx !== 0) { if (this.boxFree(e.x + dx, e.y, r)) e.x += dx; else hit = true; }
    if (dy !== 0) { if (this.boxFree(e.x, e.y + dy, r)) e.y += dy; else hit = true; }
    return hit;
  }
  freeTile(tx, ty) {
    const m = this.map;
    return tx >= 0 && ty >= 0 && tx < m.w && ty < m.h && !m.block[ty * m.w + tx];
  }
  nearestFree(tx, ty, maxR = 4) {
    if (this.freeTile(tx, ty)) return { x: tx, y: ty };
    for (let r = 1; r <= maxR; r++) {
      let best = null, bd = 1e9;
      for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) {
        if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r) continue;
        if (!this.freeTile(x, y)) continue;
        const d = (x - tx) * (x - tx) + (y - ty) * (y - ty);
        if (d < bd) { bd = d; best = { x, y }; }
      }
      if (best) return best;
    }
    return null;
  }

  // opts.doorCost(door) -> cost or Infinity. opts.extra(i) -> additional tile cost.
  findPath(sx, sy, gx, gy, opts = {}) {
    const m = this.map, W = m.w, H = m.h;
    let s = this.nearestFree(Math.floor(sx / TILE), Math.floor(sy / TILE), 2);
    let gT = this.nearestFree(Math.floor(gx / TILE), Math.floor(gy / TILE), 3);
    if (!s || !gT) return null;
    const si = s.y * W + s.x, gi = gT.y * W + gT.x;
    if (si === gi) return [{ x: gx, y: gy, door: false }];
    const doorCost = opts.doorCost, extra = opts.extra, maxNodes = opts.maxNodes || 5000;
    const cur = ++this.cur, g = this.g, came = this.came, stamp = this.stamp, closed = this.closed, heap = this.heap;
    heap.clear();
    g[si] = 0; came[si] = -1; stamp[si] = cur;
    heap.push(si, 0);
    this.searches++;
    let found = false, nodes = 0;
    const gxT = gT.x, gyT = gT.y;
    while (heap.n > 0) {
      const i = heap.pop();
      if (closed[i] === cur) continue;
      closed[i] = cur;
      if (i === gi) { found = true; break; }
      if (++nodes > maxNodes) break;
      const x = i % W, y = (i / W) | 0, gHere = g[i];
      const hereDoor = m.doorAt[i] !== 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (m.block[ni] || closed[ni] === cur) continue;
        let c = 1;
        if (d >= 4) {
          if (m.block[y * W + nx] || m.block[ny * W + x] || hereDoor || m.doorAt[ni]) continue;
          c = 1.4142;
        }
        const di = m.doorAt[ni];
        if (di) {
          const door = m.doors[di - 1];
          const dc = doorCost ? doorCost(door) : (door.open > 0.5 ? 0 : 2);
          if (dc === Infinity) continue;
          c += dc;
        }
        if (extra) c += extra(ni);
        const ng = gHere + c;
        if (stamp[ni] !== cur || ng < g[ni]) {
          g[ni] = ng; came[ni] = i; stamp[ni] = cur;
          const hx = Math.abs(nx - gxT), hy = Math.abs(ny - gyT);
          heap.push(ni, ng + (hx > hy ? hx + hy * 0.4142 : hy + hx * 0.4142));
        }
      }
    }
    this.expanded += nodes;
    if (!found) return null;
    const raw = [];
    for (let i = gi; i !== -1; i = came[i]) raw.push(i);
    raw.reverse();
    const pts = raw.map((i) => ({ x: tc(i % W), y: tc((i / W) | 0), door: m.doorAt[i] !== 0 }));
    pts[pts.length - 1].x = gx; pts[pts.length - 1].y = gy;
    if (m.block[Math.floor(gy / TILE) * W + Math.floor(gx / TILE)]) { pts[pts.length - 1].x = tc(gT.x); pts[pts.length - 1].y = tc(gT.y); }
    // String-pull, keeping door tiles as mandatory waypoints.
    const out = [];
    let ax = sx, ay = sy, i = 0;
    while (i < pts.length) {
      let j = i;
      for (let k = Math.min(pts.length - 1, i + (opts.smooth || 14)); k > i; k--) {
        let crossesDoor = false;
        for (let q = i; q < k; q++) if (pts[q].door) { crossesDoor = true; break; }
        if (!crossesDoor && this.clearLine(ax, ay, pts[k].x, pts[k].y, 5)) { j = k; break; }
      }
      out.push(pts[j]);
      ax = pts[j].x; ay = pts[j].y;
      i = j + 1;
    }
    return out;
  }

  // Dijkstra tile distance field from a tile. passDoor(door) -> bool.
  distField(tx, ty, passDoor) {
    const m = this.map, W = m.w, n = W * m.h;
    const d = new Float32Array(n).fill(Infinity);
    const q = new Int32Array(n);
    let qh = 0, qt = 0;
    const s = this.nearestFree(tx, ty, 3);
    if (!s) return d;
    d[s.y * W + s.x] = 0; q[qt++] = s.y * W + s.x;
    while (qh < qt) {
      const i = q[qh++], x = i % W, y = (i / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= m.h) continue;
        const ni = ny * W + nx;
        if (m.block[ni] || d[ni] !== Infinity) continue;
        const di = m.doorAt[ni];
        if (di && passDoor && !passDoor(m.doors[di - 1])) continue;
        d[ni] = d[i] + 1; q[qt++] = ni;
      }
    }
    return d;
  }
}

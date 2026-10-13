// Procedural ship generation: deck plan, doors, room typing, dressing, lights, vents.
import { RNG, TILE, tc } from '../core/util.js';
import { PROPS, LOOT, ROOMS, WEAPONS, LOGS } from './data.js';

export const T_VOID = 0, T_FLOOR = 1, T_WALL = 2, T_WINDOW = 3;

export function rollLoot(table, rng, rolls) {
  const out = [];
  for (let i = 0; i < rolls; i++) {
    const e = rng.weighted(LOOT[table].map((l) => [l, l[1]]));
    if (e[0] === 'none') continue;
    out.push({ id: e[0], n: rng.int(e[2], e[3]) });
    if (e[0].startsWith('w:')) {
      const w = WEAPONS[e[0].slice(2)];
      out.push({ id: 'a:' + w.ammo, n: Math.ceil(w.mag * rng.range(0.8, 1.6)) });
    }
  }
  return out;
}

export function emptyMap(w, h) {
  const n = w * h;
  return {
    w, h, tiles: new Uint8Array(n), block: new Uint8Array(n), solid: new Uint8Array(n), opaque: new Uint8Array(n),
    doorAt: new Uint16Array(n), roomId: new Int16Array(n).fill(-1), propAt: new Int16Array(n), choke: new Uint8Array(n),
    organic: new Uint8Array(n), ventAt: new Uint8Array(n),
    rooms: [], doors: [], vents: [], props: [], soft: [], lights: [], decals: [], sections: 1, start: { x: 0, y: 0 },
  };
}

// Finalise derived arrays after tiles/props/doors are set.
export function finishMap(m) {
  const n = m.w * m.h;
  for (let i = 0; i < n; i++) {
    const t = m.tiles[i];
    if (t !== T_FLOOR) { m.block[i] = 1; m.opaque[i] = 1; }
  }
  for (let i = 0; i < n; i++) m.solid[i] = m.block[i];
  m.doors.forEach((d, k) => { const i = d.y * m.w + d.x; m.doorAt[i] = k + 1; if (d.open < 0.5) { m.solid[i] = 1; m.opaque[i] = 1; } });
  for (const r of m.rooms) { r.cx = (r.x + r.w / 2) * TILE; r.cy = (r.y + r.h / 2) * TILE; }
}

export function addDoor(m, x, y, orient, a, b) {
  const d = { id: m.doors.length, x, y, orient, a, b, open: 0, want: false, lock: null, welded: false, broken: false, hp: 100, hold: 0, section: 0, px: tc(x), py: tc(y) };
  m.doors.push(d);
  m.tiles[y * m.w + x] = T_FLOOR;
  return d;
}

export function addProp(m, type, tx, ty, rng) {
  const def = PROPS[type];
  const p = { id: m.props.length, type, x: tx, y: ty, w: def.w, h: def.h, px: (tx + def.w / 2) * TILE, py: (ty + def.h / 2) * TILE, room: m.roomId[ty * m.w + tx], searched: false, loot: null, label: def.label || type.toUpperCase(), interact: def.interact || (def.container ? 'container' : null), v: rng ? rng.int(0, 999) : 0 };
  for (let y = ty; y < ty + def.h; y++) for (let x = tx; x < tx + def.w; x++) {
    const i = y * m.w + x;
    if (def.solid) { m.block[i] = 1; m.solid[i] = 1; m.propAt[i] = p.id + 1; }
    if (def.tall) m.opaque[i] = 1;
  }
  if (!def.solid) m.soft.push(p);
  if (def.container && rng) p.loot = rollLoot(def.container, rng, def.container === 'armory' ? rng.int(2, 3) : def.container === 'weapons' ? 1 : rng.int(1, 2));
  m.props.push(p);
  return p;
}

export function generateShip(seed) {
  for (let a = 0; a < 40; a++) {
    const m = tryGen((seed + a * 7919) >>> 0);
    if (m) { m.seed = seed; return m; }
  }
  throw new Error('ship generation failed for seed ' + seed);
}

function tryGen(seed) {
  const rng = new RNG(seed);
  const W = 146, H = 44, cy = 21;
  const m = emptyMap(W, H);
  const rects = [];
  const add = (x, y, w, h, corridor, section, type) => {
    const r = { id: rects.length, x, y, w, h, corridor, section, type: type || (corridor ? 'corridor' : null), doors: [], spine: false, scene: null, console: -1, damage: 0, visited: false };
    rects.push(r);
    return r;
  };
  let x = 4;
  add(x, cy - 5, 9, 11, false, 0, 'reactor');
  x += 10;
  const nSec = rng.int(4, 5);
  const hangarSec = rng.int(1, nSec - 1), hangarSide = rng.chance(0.5) ? -1 : 1;
  const split = (r, sec, depth) => {
    const canV = r.w >= 11, canH = r.h >= 11;
    if (canV && (r.w >= r.h || !canH) && rng.chance(depth === 0 ? 0.96 : 0.7)) {
      if (depth === 0 && r.w >= 16 && rng.chance(0.4)) {
        const lw = rng.int(5, r.w - 9);
        split({ x: r.x, y: r.y, w: lw, h: r.h }, sec, 1);
        add(r.x + lw + 1, r.y, 2, r.h, true, sec);
        split({ x: r.x + lw + 4, y: r.y, w: r.w - lw - 4, h: r.h }, sec, 1);
        return;
      }
      const sx = rng.int(5, r.w - 6);
      split({ x: r.x, y: r.y, w: sx, h: r.h }, sec, depth + 1);
      split({ x: r.x + sx + 1, y: r.y, w: r.w - sx - 1, h: r.h }, sec, depth + 1);
      return;
    }
    if (canH && rng.chance(0.65)) {
      const sy = rng.int(5, r.h - 6);
      split({ x: r.x, y: r.y, w: r.w, h: sy }, sec, depth + 1);
      split({ x: r.x, y: r.y + sy + 1, w: r.w, h: r.h - sy - 1 }, sec, depth + 1);
      return;
    }
    add(r.x, r.y, r.w, r.h, false, sec);
  };
  for (let s = 0; s < nSec; s++) {
    const isH = s === hangarSec;
    const L = isH ? rng.int(18, 22) : rng.int(15, 21);
    add(x, cy - 1, L, 3, true, s).spine = true;
    for (const side of [-1, 1]) {
      const D = isH && side === hangarSide ? rng.int(11, 14) : rng.int(9, 15);
      const by = side < 0 ? cy - 2 - D : cy + 3;
      if (isH && side === hangarSide) add(x, by, L, D, false, s, 'hangar');
      else split({ x, y: by, w: L, h: D }, s, 0);
    }
    x += L + 1;
  }
  add(x, cy - 5, 8, 11, false, nSec - 1, 'bridge');
  m.sections = nSec;

  // Carve interiors.
  for (const r of rects) for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) {
    m.tiles[yy * W + xx] = T_FLOOR; m.roomId[yy * W + xx] = r.id;
  }
  // Adjacency edges.
  const edges = [];
  for (const a of rects) for (const b of rects) {
    if (a === b) continue;
    const fixed = (r) => r.type === 'reactor' || r.type === 'bridge';
    if ((fixed(a) && !b.corridor) || (fixed(b) && !a.corridor)) continue;
    const need = a.corridor && b.corridor ? 2 : 3;
    if (a.x + a.w + 1 === b.x) {
      const lo = Math.max(a.y, b.y), hi = Math.min(a.y + a.h, b.y + b.h) - 1;
      if (hi - lo + 1 >= need) edges.push({ a, b, orient: 'v', fx: a.x + a.w, lo, hi });
    }
    if (a.y + a.h + 1 === b.y) {
      const lo = Math.max(a.x, b.x), hi = Math.min(a.x + a.w, b.x + b.w) - 1;
      if (hi - lo + 1 >= need) edges.push({ a, b, orient: 'h', fy: a.y + a.h, lo, hi });
    }
  }
  const parent = rects.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const openEdge = (e, forceDoor) => {
    const cc = e.a.corridor && e.b.corridor;
    if (cc && !forceDoor && (!(e.a.spine && e.b.spine) || rng.chance(0.35))) {
      for (let k = e.lo; k <= e.hi; k++) {
        const tx = e.orient === 'v' ? e.fx : k, ty = e.orient === 'v' ? k : e.fy;
        m.tiles[ty * W + tx] = T_FLOOR; m.roomId[ty * W + tx] = e.a.id;
      }
      return;
    }
    let k;
    if (cc) k = (e.lo + e.hi) >> 1;
    else k = e.hi - e.lo >= 2 ? rng.int(e.lo + 1, e.hi - 1) : rng.int(e.lo, e.hi);
    const tx = e.orient === 'v' ? e.fx : k, ty = e.orient === 'v' ? k : e.fy;
    const d = addDoor(m, tx, ty, e.orient, e.a.id, e.b.id);
    d.section = e.a.section;
    d.bulkhead = cc;
    m.roomId[ty * W + tx] = e.a.id;
    e.a.doors.push(d.id); e.b.doors.push(d.id);
  };
  rng.shuffle(edges);
  edges.sort((p, q) => rank(p) - rank(q));
  function rank(e) { return e.a.corridor && e.b.corridor ? 0 : e.a.corridor || e.b.corridor ? 1 : 2; }
  const rest = [];
  for (const e of edges) {
    const pa = find(e.a.id), pb = find(e.b.id);
    if (pa !== pb) { parent[pa] = pb; openEdge(e); } else rest.push(e);
  }
  for (const e of rest) if (!(e.a.corridor && e.b.corridor) && rng.chance(e.a.corridor || e.b.corridor ? 0.3 : 0.28)) openEdge(e);
  const root = find(0);
  for (const r of rects) if (find(r.id) !== root) return null;

  // Walls and windows.
  for (let yy = 1; yy < H - 1; yy++) for (let xx = 1; xx < W - 1; xx++) {
    if (m.tiles[yy * W + xx] !== T_VOID) continue;
    let near = false;
    for (let oy = -1; oy <= 1 && !near; oy++) for (let ox = -1; ox <= 1; ox++) if (m.tiles[(yy + oy) * W + xx + ox] === T_FLOOR) { near = true; break; }
    if (near) m.tiles[yy * W + xx] = T_WALL;
  }
  for (let yy = 1; yy < H - 1; yy++) for (let xx = 1; xx < W - 1; xx++) {
    const i = yy * W + xx;
    if (m.tiles[i] !== T_WALL) continue;
    const below = m.tiles[i + W] === T_FLOOR, above = m.tiles[i - W] === T_VOID;
    if (below && above && m.tiles[i - 1] !== T_FLOOR && m.tiles[i + 1] !== T_FLOOR && xx % 4 < 2 && m.tiles[i - W - 1] === T_VOID && m.tiles[i - W + 1] === T_VOID) m.tiles[i] = T_WINDOW;
  }

  // Room typing.
  const rooms = rects.filter((r) => !r.corridor && !r.type);
  if (rooms.length < 11) return null;
  const xf = (r) => (r.x + r.w / 2) / W, area = (r) => r.w * r.h;
  const take = (type, score) => {
    let best = null, bs = -1e9;
    for (const r of rooms) {
      if (r.type) continue;
      const s = score(r) + rng.range(0, 0.25);
      if (s > bs) { bs = s; best = r; }
    }
    if (best) best.type = type;
    return best;
  };
  take('cargo', (r) => area(r) / 60);
  take('cryo', (r) => -Math.abs(xf(r) - 0.42) * 4 - Math.abs(area(r) - 50) / 60);
  take('lifesupport', (r) => -xf(r) * 3 + Math.min(area(r), 70) / 80);
  take('comms', (r) => xf(r) * 3 - Math.abs(area(r) - 45) / 80);
  take('medbay', (r) => -Math.abs(area(r) - 50) / 50);
  take('armory', (r) => -area(r) / 30 - r.doors.length * 0.5);
  take('pods', (r) => -area(r) / 40 + xf(r));
  take('lab', (r) => Math.min(area(r), 80) / 60);
  take('maint', (r) => -Math.abs(area(r) - 40) / 50);
  const filler = ['quarters', 'storage', 'security', 'mess', 'hydro', 'server', 'quarters', 'storage', 'maint', 'mess'];
  let fi = rng.int(0, 3);
  for (const r of rooms) if (!r.type) r.type = filler[fi++ % filler.length];
  const count = {};
  for (const r of rects) {
    count[r.type] = (count[r.type] || 0) + 1;
    r.name = r.corridor ? (r.spine ? 'SPINE - SECTION ' + 'ABCDEF'[r.section] : 'ACCESS ' + 'ABCDEF'[r.section]) : ROOMS[r.type].name + (count[r.type] > 1 ? ' ' + count[r.type] : '');
  }
  m.rooms = rects;
  finishMap(m);

  dress(m, rng, cy);
  return m;
}

function dress(m, rng, cy) {
  const W = m.w;
  const reserved = new Uint8Array(W * m.h);
  const res = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < m.h) reserved[y * W + x] = 1; };
  for (const d of m.doors) {
    const hz = d.orient === 'v';
    for (const s of [-1, 1]) for (let k = 1; k <= 2; k++) for (let l = -1; l <= 1; l++) {
      const xx = hz ? d.x + s * k : d.x + l, yy = hz ? d.y + l : d.y + s * k;
      if (k === 2 && l !== 0) continue;
      res(xx, yy);
      if (k === 1) m.choke[yy * W + xx] = 1;
    }
    m.choke[d.y * W + d.x] = 1;
  }
  for (const r of m.rooms) if (r.corridor) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (!r.spine || y === cy) res(x, y);
    if (!r.spine) m.choke[y * W + x] = 1;
  }
  // Openings between corridors: keep them clear too.
  for (let i = 0; i < W * m.h; i++) if (m.tiles[i] === T_FLOOR) {
    const x = i % W, y = (i / W) | 0, r = m.rooms[m.roomId[i]];
    if (r && (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h)) { for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) res(x + ox, y + oy); }
  }

  const stack = new Int32Array(1024);
  const mark = new Uint32Array(W * m.h);
  let markCur = 0;
  const connected = (r) => {
    // All free tiles of the room (plus its door tiles) must form one region.
    let total = 0, start = -1;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!m.block[y * W + x]) { total++; if (start < 0) start = y * W + x; }
    if (start < 0) return false;
    markCur++;
    let sp = 0, seen = 0;
    stack[sp++] = start; mark[start] = markCur;
    while (sp > 0) {
      const i = stack[--sp];
      seen++;
      const x = i % W, y = (i / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < r.x || ny < r.y || nx >= r.x + r.w || ny >= r.y + r.h) continue;
        const ni = ny * W + nx;
        if (m.block[ni] || mark[ni] === markCur) continue;
        mark[ni] = markCur; stack[sp++] = ni;
      }
    }
    return seen === total;
  };
  const canPlace = (r, type, tx, ty) => {
    const def = PROPS[type];
    for (let y = ty; y < ty + def.h; y++) for (let x = tx; x < tx + def.w; x++) {
      if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) return false;
      const i = y * W + x;
      if (m.block[i] || reserved[i] || m.ventAt[i]) return false;
    }
    return true;
  };
  const place = (r, type, tx, ty) => {
    if (!canPlace(r, type, tx, ty)) return null;
    const def = PROPS[type];
    const p = addProp(m, type, tx, ty, rng);
    if (def.solid && !connected(r)) {
      for (let y = ty; y < ty + def.h; y++) for (let x = tx; x < tx + def.w; x++) { const i = y * W + x; m.block[i] = 0; m.solid[i] = 0; m.opaque[i] = 0; m.propAt[i] = 0; }
      m.props.pop();
      return null;
    }
    if (p.interact) {
      // Keep one access tile free.
      const opts = [];
      for (let y = ty - 1; y <= ty + def.h; y++) for (let x = tx - 1; x <= tx + def.w; x++) {
        const edgeX = x < tx || x >= tx + def.w, edgeY = y < ty || y >= ty + def.h;
        if (edgeX === edgeY) continue;
        if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h || m.block[y * W + x]) continue;
        opts.push([x, y]);
      }
      if (opts.length) { const o = opts.find((q) => reserved[q[1] * W + q[0]]) || rng.pick(opts); res(o[0], o[1]); }
    }
    return p;
  };
  const perimeter = (r, sides) => {
    const out = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const n = y === r.y, s = y === r.y + r.h - 1, w = x === r.x, e = x === r.x + r.w - 1;
      if (!(n || s || w || e)) continue;
      if (sides && !((n && sides.includes('N')) || (s && sides.includes('S')) || (w && sides.includes('W')) || (e && sides.includes('E')))) continue;
      out.push([x, y, s, e]);
    }
    return rng.shuffle(out);
  };
  const wall = (r, type, lo, hi, sides) => {
    const n = rng.int(lo, hi === undefined ? lo : hi), def = PROPS[type], out = [];
    for (const [x, y, s, e] of perimeter(r, sides)) {
      if (out.length >= n) break;
      const p = place(r, type, e ? x - def.w + 1 : x, s ? y - def.h + 1 : y);
      if (p) out.push(p);
    }
    return out;
  };
  const center = (r, type, lo, hi) => {
    const n = rng.int(lo, hi === undefined ? lo : hi), out = [];
    for (let t = 0; t < n * 8 && out.length < n; t++) {
      if (r.w < 5 || r.h < 5) break;
      const p = place(r, type, rng.int(r.x + 2, r.x + r.w - 3), rng.int(r.y + 2, r.y + r.h - 3));
      if (p) out.push(p);
    }
    return out;
  };
  const grid = (r, types, sx, sy, p = 1) => {
    for (let y = r.y + 2; y < r.y + r.h - 2; y += sy) for (let x = r.x + 2; x < r.x + r.w - 2; x += sx) if (rng.chance(p)) place(r, rng.pick(types), x, y);
  };
  const consoleFor = (r, sides) => {
    const p = wall(r, 'objconsole', 1, 1, sides)[0] || wall(r, 'objconsole', 1)[0] || center(r, 'objconsole', 1)[0];
    if (p) r.console = p.id;
    return p;
  };

  const recipes = {
    reactor: (r) => { place(r, 'reactor', r.x + 3, r.y + 4); consoleFor(r); wall(r, 'machine', 2); wall(r, 'pipes', 2, 3); wall(r, 'toolbox', 1); wall(r, 'console', 1); },
    bridge: (r) => { consoleFor(r, 'E'); wall(r, 'console', 3, 4, 'E'); wall(r, 'rack', 2, 2, 'NS'); wall(r, 'terminal', 1); center(r, 'table', 1); wall(r, 'locker', 1); },
    hangar: (r) => { place(r, 'shuttle', r.x + ((r.w - 6) >> 1), r.y + ((r.h - 3) >> 1)); consoleFor(r); center(r, 'barrel', 3, 5); center(r, 'crate', 2, 4); wall(r, 'toolbox', 1, 2); wall(r, 'crate2', 3, 5); wall(r, 'ammobox', 0, 1); },
    cargo: (r) => {
      for (let y = r.y + 2; y < r.y + r.h - 3; y += 4) for (let x = r.x + 2; x < r.x + r.w - 3; x += 4) if (rng.chance(0.8)) {
        for (let k = 0; k < 4; k++) if (rng.chance(0.8)) place(r, rng.chance(0.55) ? 'crate2' : 'crate', x + (k & 1), y + (k >> 1));
      }
      wall(r, 'barrel', 2, 4); wall(r, 'crate', 1, 3); wall(r, 'toolbox', 0, 1);
    },
    medbay: (r) => { wall(r, 'medstation', 1); wall(r, 'bed', 2, 4, 'N'); wall(r, 'medcab', 2); wall(r, 'console', 1); wall(r, 'terminal', 0, 1); },
    lifesupport: (r) => { consoleFor(r); center(r, 'scrubber', 1, 2); wall(r, 'tank', 3, 5); wall(r, 'pipes', 2, 3); wall(r, 'toolbox', 1); },
    comms: (r) => { consoleFor(r); wall(r, 'rack', 3, 5); wall(r, 'console', 1, 2); wall(r, 'terminal', 1); },
    armory: (r) => { wall(r, 'gunrack', 2); wall(r, 'ammobox', 2, 3); wall(r, 'locker', 1, 2); },
    lab: (r) => { consoleFor(r); wall(r, 'tank', 2, 3); wall(r, 'tankBroken', 1, 2); wall(r, 'labcab', 1, 2); wall(r, 'console', 1, 2); center(r, 'table', 1); wall(r, 'terminal', 1); },
    quarters: (r) => { wall(r, 'bunk', 3, 6, 'NS'); wall(r, 'locker', 2, 4); center(r, 'table', 0, 1); wall(r, 'terminal', 0, 1); },
    mess: (r) => { grid(r, ['table'], 4, 3, 0.8); wall(r, 'locker', 1); wall(r, 'crate', 1, 2); wall(r, 'barrel', 0, 2); },
    security: (r) => { consoleFor(r); wall(r, 'console', 1, 2); wall(r, 'locker', 2); wall(r, 'gunrack', 0, 1); wall(r, 'ammobox', 1); wall(r, 'terminal', 1); },
    hydro: (r) => { grid(r, ['planter'], 3, 3, 0.85); wall(r, 'tank', 1, 2); wall(r, 'toolbox', 1); },
    cryo: (r) => { wall(r, 'cryopod', 4, 6, 'NS'); wall(r, 'console', 1); wall(r, 'locker', 1, 2); wall(r, 'terminal', 1); wall(r, 'medcab', 1); },
    storage: (r) => { grid(r, ['shelf'], 3, 3, 0.8); wall(r, 'crate', 2, 4); wall(r, 'toolbox', 1); wall(r, 'crate2', 1, 3); },
    maint: (r) => { consoleFor(r); wall(r, 'machine', 2, 3); wall(r, 'pipes', 2, 3); wall(r, 'toolbox', 2); },
    server: (r) => { consoleFor(r); grid(r, ['rack'], 2, 3, 0.85); wall(r, 'terminal', 1); },
    pods: (r) => { consoleFor(r); wall(r, 'pod', 3, 4, 'N'); wall(r, 'locker', 0, 1); },
    corridor: (r) => {
      if (!r.spine) return;
      const n = Math.floor(r.w / 7);
      for (let k = 0; k < n; k++) if (rng.chance(0.7)) place(r, rng.pick(['crate', 'barrel', 'pipes', 'crate2', 'locker']), rng.int(r.x + 1, r.x + r.w - 2), rng.chance(0.5) ? r.y : r.y + r.h - 1);
    },
  };

  // Vents first so props avoid them.
  let ventId = 0;
  for (const r of m.rooms) {
    const p = r.corridor ? (r.spine ? 0.5 : 0.35) : r.type === 'cryo' ? 0 : 0.62;
    if (!rng.chance(p)) continue;
    for (const [x, y] of perimeter(r)) {
      const i = y * W + x;
      if (reserved[i] || m.block[i]) continue;
      m.vents.push({ id: ventId++, x, y, px: tc(x), py: tc(y), room: r.id, sealed: false, rattle: 0 });
      m.ventAt[i] = 1; reserved[i] = 1;
      break;
    }
  }
  for (const r of m.rooms) { r.damage = rng.next(); recipes[r.type](r); }

  // Lights.
  const light = (x, y, rad, col, kind, r, extra) => m.lights.push(Object.assign({ id: m.lights.length, x, y, r: rad, col, kind, room: r.id, section: r.section, state: 'ok', phase: rng.range(0, 100), inten: 1 }, extra));
  for (const r of m.rooms) {
    const col = ROOMS[r.type].light;
    if (r.corridor) {
      const long = Math.max(r.w, r.h), n = Math.max(1, Math.round(long / 7));
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n;
        const lx = r.w > r.h ? r.x + r.w * f : r.x + r.w / 2, ly = r.w > r.h ? r.y + r.h / 2 : r.y + r.h * f;
        light(lx * TILE, ly * TILE, 62, col, 'main', r, { state: rng.weighted([['ok', 62], ['flicker', 16], ['dead', 22]]) });
        light(lx * TILE + 24, (r.w > r.h ? r.y + 0.4 : ly) * TILE, 64, [1, 0.16, 0.1], 'emerg', r);
      }
    } else {
      const nx = Math.max(1, Math.round(r.w / 7)), ny = Math.max(1, Math.round(r.h / 7));
      for (let j = 0; j < ny; j++) for (let k = 0; k < nx; k++) {
        const dead = 0.08 + r.damage * 0.22;
        light((r.x + (r.w * (k + 0.5)) / nx) * TILE, (r.y + (r.h * (j + 0.5)) / ny) * TILE, 78, col, 'main', r, { state: rng.weighted([['ok', 1 - dead - 0.12], ['flicker', 0.12], ['dead', dead]]) });
      }
      for (const di of r.doors.slice(0, 3)) { const d = m.doors[di]; light(Math.max(r.x + 0.5, Math.min(r.x + r.w - 0.5, d.x + 0.5)) * TILE, Math.max(r.y + 0.5, Math.min(r.y + r.h - 0.5, d.y + 0.5)) * TILE, 74, [1, 0.16, 0.1], 'emerg', r); }
    }
  }
  for (const p of m.props) {
    const g = PROPS[p.type].glow;
    if (g) light(p.px, p.py, p.type === 'reactor' ? 90 : 26, g, 'prop', m.rooms[p.room], { prop: p.id, inten: p.type === 'reactor' ? 1 : 0.55, backup: ['objconsole', 'terminal', 'cryopod', 'tank', 'pod', 'reactor', 'medstation'].includes(p.type) });
  }

  // Terminals carry logs.
  const logs = rng.shuffle(LOGS.slice());
  let li = 0;
  for (const p of m.props) if (p.type === 'terminal') p.log = logs[li++ % logs.length];

  // Ambient decals.
  const dec = (k, x, y, s, a) => m.decals.push({ k, x, y, s: s || 1, a: a === undefined ? rng.range(0, 6.28) : a });
  for (const r of m.rooms) {
    const n = Math.round((r.w * r.h) / 26);
    for (let k = 0; k < n; k++) {
      const x = rng.range(r.x + 0.3, r.x + r.w - 0.3) * TILE, y = rng.range(r.y + 0.3, r.y + r.h - 0.3) * TILE;
      const roll = rng.next();
      if (roll < 0.3 + r.damage * 0.3) dec('stain', x, y, rng.range(0.6, 1.4));
      else if (roll < 0.55) dec('debris', x, y);
      else if (roll < 0.55 + r.damage * 0.25) dec('blood', x, y, rng.range(0.5, 1.2));
      else if (roll < 0.9) dec('paper', x, y);
      else dec('scorch', x, y, rng.range(0.6, 1.1));
    }
    r.place = (type, tx, ty) => place(r, type, tx, ty);
  }
  m.placeProp = (r, type, tx, ty) => place(r, type, tx, ty);
  m.freeSpots = (r, n, margin = 0) => {
    const out = [];
    for (let t = 0; t < 200 && out.length < n; t++) {
      const x = rng.int(r.x + margin, r.x + r.w - 1 - margin), y = rng.int(r.y + margin, r.y + r.h - 1 - margin), i = y * W + x;
      if (m.block[i] || m.ventAt[i] || out.some((o) => o.x === x && o.y === y)) continue;
      out.push({ x, y });
    }
    return out;
  };
  m.addDecal = dec;

  const cryo = m.rooms.find((r) => r.type === 'cryo');
  const s = m.freeSpots(cryo, 1, 1)[0] || { x: cryo.x + (cryo.w >> 1), y: cryo.y + (cryo.h >> 1) };
  m.start = { x: tc(s.x), y: tc(s.y), room: cryo.id };
}

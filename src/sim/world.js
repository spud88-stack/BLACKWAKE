// World: owns all simulation state and steps it deterministically.
import { RNG, TILE, dist, angDiff, approach, clamp, tc } from '../core/util.js';
import { generateShip } from './gen.js';
import { Nav } from './nav.js';
import { LightGrid } from './light.js';
import { ITEMS, WEAPONS, AMMO, PROPS, CHARACTERS, PLAYER_CHAR } from './data.js';
import { LINES, CHAR_LINES } from './lines.js';
import { makeHuman, updateHuman, useIds, newId, addItem, active, curDef, countItem, useItem, bestMed, throwItem, dropBelt, giveBelt, giveAmmo, startReload } from './humans.js';
import { damageHuman, damageAlien, explode, reviveHuman, addStress } from './combat.js';
import { squadThink } from './squadai.js';
import { updateAliens } from './aliens.js';
import { Director } from './director.js';
import { setupMission } from './mission.js';
import { buildScene } from './scenarios.js';

export class World {
  constructor(opts = {}) {
    this.ids = { n: 1 };
    useIds(this.ids);
    this.opts = opts;
    this.seed = (opts.seed >>> 0) || 1;
    this.rng = new RNG(this.seed ^ 0x9e3779b9);
    this.time = 0; this.tick = 0;
    this.humans = []; this.aliens = []; this.projs = []; this.pickups = []; this.fires = []; this.pools = [];
    this.flares = []; this.lures = []; this.flashes = []; this.arcs = []; this.alarms = [];
    this.noises = []; this.heard = []; this.fx = [];
    this.keys = {}; this.tracker = false; this.air = 100; this.airDecay = 0;
    this.mainPower = true; this.power = [];
    this.stats = { kills: 0, nests: 0, downs: 0, deaths: 0, friendlyHits: 0, panics: 0, shots: 0 };
    this.over = null; this.trail = []; this.memory = new Map(); this.seenTypes = {};
    this.sayT = 0; this.prompt = null; this.autoplay = !!opts.autoplay; this.god = false;
    this.lightEvery = opts.lightEvery || 1;
    this.fireTiles = new Set();
    this.perf = { paths: 0 };
    if (opts.scene) buildScene(this, opts.scene);
    else {
      this.map = generateShip(this.seed);
      this.initMap();
      this.spawnSquad();
      this.director = new Director(this);
      setupMission(this);
    }
    this.updateLights();
  }

  initMap() {
    this.nav = new Nav(this.map);
    this.light = new LightGrid(this.map);
    this.power = [];
    for (let i = 0; i < this.map.sections; i++) this.power.push(true);
    for (const d of this.map.doors) d.solid = d.open < 0.5;
  }

  spawnSquad(ids) {
    const s = this.map.start;
    this.player = makeHuman(this, 'player', PLAYER_CHAR, s.x, s.y, true);
    this.humans.push(this.player);
    addItem(this, this.player, 'bandage', 1); addItem(this, this.player, 'flare', 2);
    const pool = ids || this.rng.shuffle(['okafor', 'lindqvist', 'havel', 'park', 'amari']).slice(0, 3);
    pool.forEach((id) => this.addMate(id, s.x, s.y));
  }

  addMate(id, x, y) {
    const t = this.nav.nearestFree(Math.floor(x / TILE) + this.rng.int(-2, 2), Math.floor(y / TILE) + this.rng.int(-2, 2), 3) || { x: Math.floor(x / TILE), y: Math.floor(y / TILE) };
    const h = makeHuman(this, id, CHARACTERS[id], tc(t.x), tc(t.y), false);
    h.ai = { act: 'follow', why: '', scores: [], thinkT: 0, rank: 1, pressure: 0, nearD: 1e9, order: { type: 'follow' }, slot: this.humans.length, path: null, pathT: 0, burstT: 0, pauseT: 0, reactT: 0, tacT: 0, strafe: 1 };
    for (const t in h.ammo) if (h.ammo[t] > 0) h.ammo[t] = Math.round(h.ammo[t] * 1.5);
    addItem(this, h, 'bandage', h.char.medic ? 3 : 1);
    if (h.char.medic) { addItem(this, h, 'medkit', 2); addItem(this, h, 'stim', 1); }
    this.humans.push(h);
    return h;
  }

  emit(type, data) { data.type = type; this.fx.push(data); }
  msg(text, kind) { this.emit('msg', { text, kind: kind || 'info' }); }
  noise(x, y, r, kind, src) { this.noises.push({ x, y, r, kind, src }); }
  flash(x, y, r, col, life) { this.flashes.push({ x, y, r, col, life, max: life }); }

  say(h, cat, force, name) {
    if (!h || h.dead || h.isPlayer) return false;
    if (!force && (this.time < this.sayT || (h.sayCd[cat] || 0) > this.time)) return false;
    const own = CHAR_LINES[h.charId] && CHAR_LINES[h.charId][cat];
    const pool = own && this.rng.chance(0.6) ? own : LINES[cat];
    if (!pool) return false;
    let text = this.rng.pick(pool);
    if (name) text = text.replace('{n}', name[0] + name.slice(1).toLowerCase());
    else if (text.includes('{n}')) text = text.replace('{n}', 'you');
    h.speech = { text, t: 2.8 };
    h.sayCd[cat] = this.time + (cat.startsWith('idle') || cat === 'dark' || cat === 'noise' || cat === 'vent' || cat === 'clear' || cat === 'lowammo' || cat === 'empty' ? 35 : 9);
    if (this.lastSaid === text && this.time < (this.lastSaidT || 0) + 12) { h.speech = null; return false; }
    this.lastSaid = text; this.lastSaidT = this.time;
    this.sayT = this.time + 1.1;
    this.emit('speech', { id: h.id, name: h.name, text, x: h.x, y: h.y, pitch: h.char.pitch, col: h.char.accent });
    this.noise(h.x, h.y, 70, 'voice', h);
    return true;
  }

  mates() { return this.humans.filter((h) => !h.isPlayer && !h.dead); }
  squadAlive() { return this.humans.filter(active); }
  roomAt(x, y) { return this.map.rooms[this.map.roomId[Math.floor(y / TILE) * this.map.w + Math.floor(x / TILE)]]; }
  sectionAt(x, y) { const r = this.roomAt(x, y); return r ? r.section : 0; }
  poweredAt(x, y) { return this.power[this.sectionAt(x, y)]; }

  // Can a human currently make out this alien?
  canSee(h, a) {
    const d = dist(h.x, h.y, a.x, a.y);
    if (d > 230 || a.inVent > 0 || a.dead) return false;
    if (!this.nav.los(h.x, h.y - 2, a.x, a.y)) return false;
    if (d < 42 || a.revealT > 0 || a.burn > 0) return true;
    const lit = this.light.at(a.x, a.y);
    if (a.type === 'lurker' && a.cloak) return lit > 0.3;
    return lit > 0.07;
  }

  setMainPower(on) {
    this.mainPower = on;
    for (let i = 0; i < this.power.length; i++) this.power[i] = on;
    this.light.dirty = true;
    this.emit('power', { on });
    if (on) {
      for (const d of this.map.doors) if (d.lock === 'power') d.lock = null;
      this.fires = this.fires.filter((f) => !f.perm);
    }
  }

  spawnPickup(item, n, x, y, extra = {}) {
    let px = x, py = y;
    for (let t = 0; t < 12; t++) {
      const a = this.rng.range(0, 6.283), r = this.rng.range(4, 14);
      const cx = x + Math.cos(a) * r, cy = y + Math.sin(a) * r;
      if (this.nav.boxFree(cx, cy, 3) && this.nav.walkLine(x, y, cx, cy)) { px = cx; py = cy; break; }
    }
    const p = { id: newId(), item, n, x: px, y: py, ox: x, oy: y, t: 0, cool: extra.cool || 0.35, mag: extra.mag, charges: extra.charges, age: 0 };
    this.pickups.push(p);
    return p;
  }

  itemName(item, n) {
    if (item.startsWith('a:')) return n + ' ' + AMMO[item.slice(2)].name;
    if (item.startsWith('w:')) return WEAPONS[item.slice(2)].name;
    return ITEMS[item].name + (n > 1 ? ' x' + n : '');
  }

  tryPickup(h, p) {
    const left = addItem(this, h, p.item, p.n, { mag: p.mag, charges: p.charges });
    if (left < p.n) {
      this.emit('pickup', { x: p.x, y: p.y, item: p.item, n: p.n - left, player: h.isPlayer });
      if (h.isPlayer) this.msg('+ ' + this.itemName(p.item, p.n - left), 'loot');
    } else if (h.isPlayer && (p.fullT || 0) < this.time) { this.msg('NO ROOM: ' + this.itemName(p.item, p.n), 'warn'); p.fullT = this.time + 2; }
    p.n = left;
    if (left <= 0) this.pickups.splice(this.pickups.indexOf(p), 1);
    return left <= 0;
  }

  addFire(x, y, life, perm) {
    if (!this.nav.boxFree(x, y, 2)) return;
    if (this.fires.length > 70) return;
    for (const f of this.fires) if (Math.abs(f.x - x) < 7 && Math.abs(f.y - y) < 7) { f.life = Math.max(f.life, life); return; }
    this.fires.push({ x, y, life, perm: !!perm, ph: this.rng.range(0, 6) });
  }

  hitDoor(d, dmg, src) {
    if (d.broken) return;
    d.hp -= dmg;
    this.emit('doorHit', { x: d.px, y: d.py });
    this.noise(d.px, d.py, 230, 'impact', src);
    for (const h of this.humans) if (!h.isPlayer && active(h) && dist(h.x, h.y, d.px, d.py) < 150) { this.say(h, 'door'); break; }
    if (d.hp <= 0) {
      d.broken = true; d.want = true; d.welded = false; d.lock = null;
      this.emit('doorBreak', { x: d.px, y: d.py, orient: d.orient });
    }
  }

  updateDoors(dt) {
    const m = this.map;
    for (const d of m.doors) {
      const powered = this.power[d.section];
      if (d.broken) d.want = true;
      else if (d.welded) d.want = false;
      else {
        if (d.lock === 'sec' || d.lock === 'cmd') {
          const key = d.lock === 'sec' ? 'key_sec' : 'key_cmd';
          if (this.keys[key]) for (const h of this.humans) if (active(h) && dist(h.x, h.y, d.px, d.py) < 26) { d.lock = null; this.emit('unlock', { x: d.px, y: d.py }); if (dist(this.player.x, this.player.y, d.px, d.py) < 120) this.msg(ITEMS[key].name + ' ACCEPTED', 'good'); break; }
        }
        if (d.lock) d.want = false;
        else if (powered) {
          let near = false;
          for (const h of this.humans) if (active(h) && Math.abs(h.x - d.px) < 24 && Math.abs(h.y - d.py) < 24) { near = true; break; }
          if (near) { d.want = true; d.hold = 0.9; } else { d.hold -= dt; if (d.hold <= 0) d.want = false; }
        }
      }
      if (!d.want && d.open > 0) {
        for (const e of this.humans) if (!e.dead && Math.abs(e.x - d.px) < 11 && Math.abs(e.y - d.py) < 11) { d.open = Math.max(d.open, 0.6); }
        for (const e of this.aliens) if (!e.dead && e.inVent <= 0 && Math.abs(e.x - d.px) < 12 && Math.abs(e.y - d.py) < 12) { d.open = Math.max(d.open, 0.6); }
      }
      const prev = d.open;
      d.open = approach(d.open, d.want ? 1 : 0, dt * (d.broken ? 9 : powered ? 5 : 2.4));
      const solid = d.open < 0.5;
      if (solid !== d.solid) {
        d.solid = solid;
        const i = d.y * m.w + d.x;
        m.solid[i] = solid ? 1 : 0; m.opaque[i] = solid ? 1 : 0;
        this.light.invalidateNear(d.px, d.py);
        this.emit('door', { x: d.px, y: d.py, open: !solid, powered });
        this.noise(d.px, d.py, powered ? 60 : 110, 'door', null);
      }
      if (prev !== d.open) d.moving = true; else d.moving = false;
    }
  }

  updateHazards(dt) {
    const tm = this.time;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.life -= dt;
      if (f.life <= 0) { this.fires.splice(i, 1); continue; }
      for (const h of this.humans) if (active(h) && Math.abs(h.x - f.x) < 8 && Math.abs(h.y - f.y) < 8) { damageHuman(this, h, 9 * dt, { kind: 'fire' }); if (!h.isPlayer) this.say(h, 'fire'); }
      for (const a of this.aliens) if (!a.dead && a.inVent <= 0 && Math.abs(a.x - f.x) < 9 + a.r && Math.abs(a.y - f.y) < 9 + a.r) { damageAlien(this, a, 18 * dt * (a.type === 'nest' ? 2 : 1), { fire: true }); a.burn = 1.5; }
    }
    if (this.tick % 15 === 0) {
      this.fireTiles.clear();
      for (const f of this.fires) {
        const tx = Math.floor(f.x / TILE), ty = Math.floor(f.y / TILE);
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) this.fireTiles.add((ty + oy) * this.map.w + tx + ox);
      }
    }
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i];
      p.life -= dt;
      if (p.life <= 0) { this.pools.splice(i, 1); continue; }
      for (const h of this.humans) if (active(h) && dist(h.x, h.y, p.x, p.y) < p.r) damageHuman(this, h, 9 * dt, { kind: 'acid' });
    }
    for (let i = this.flares.length - 1; i >= 0; i--) if ((this.flares[i].life -= dt) <= 0) this.flares.splice(i, 1);
    for (let i = this.lures.length - 1; i >= 0; i--) {
      const l = this.lures[i];
      l.life -= dt; l.beep -= dt;
      if (l.beep <= 0) { l.beep = 0.55; this.noise(l.x, l.y, 300, 'lure', null); this.emit('beep', { x: l.x, y: l.y }); }
      if (l.life <= 0) this.lures.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) if ((this.flashes[i].life -= dt) <= 0) this.flashes.splice(i, 1);
    for (const a of this.arcs) {
      if (!this.power[a.section]) { a.on = false; continue; }
      const ph = (tm + a.ph) % 4.2;
      const on = ph > 3.5;
      if (ph > 2.7 && !on && this.rng.chance(0.2)) this.emit('spark', { x: a.x, y: a.y });
      if (on && !a.on) {
        this.emit('zap', { x: a.x, y: a.y });
        this.flash(a.x, a.y, 70, [0.5, 0.8, 1], 0.5);
        for (const h of this.humans) if (active(h) && dist(h.x, h.y, a.x, a.y) < 15) { damageHuman(this, h, 16, { kind: 'arc' }); h.stunT = 0.35; }
        for (const al of this.aliens) if (!al.dead && al.inVent <= 0 && dist(al.x, al.y, a.x, a.y) < 15 + al.r) damageAlien(this, al, 20, { stagger: 0.6 });
      }
      a.on = on;
    }
    for (const al of this.alarms) {
      if (al.off) continue;
      al.t -= dt;
      if (al.t <= 0) { al.t = 1.6; this.noise(al.x, al.y, 380, 'alarm', null); this.emit('alarm', { x: al.x, y: al.y }); }
    }
    if (this.airDecay > 0) {
      const before = this.air;
      this.air = Math.max(0, this.air - this.airDecay * dt);
      if (before >= 30 && this.air < 30) { this.msg('WARNING: AIR QUALITY CRITICAL', 'bad'); const m = this.mates()[0]; if (m) this.say(m, 'air', true); }
    } else this.air = Math.min(100, this.air + dt * 4);
  }

  updateProjs(dt) {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const p = this.projs[i];
      p.t += dt;
      const f = Math.min(1, p.t / p.dur);
      p.x = p.sx + (p.tx - p.sx) * f; p.y = p.sy + (p.ty - p.sy) * f;
      p.z = Math.sin(f * Math.PI) * (p.kind === 'acid' ? 18 : 12);
      if (p.t < p.dur + (p.kind === 'grenade' ? 0.45 : 0)) continue;
      this.projs.splice(i, 1);
      if (p.kind === 'flare') { this.flares.push({ x: p.x, y: p.y, life: 40, ph: this.rng.range(0, 6) }); this.emit('flareLand', { x: p.x, y: p.y }); this.noise(p.x, p.y, 90, 'impact', p.src); }
      else if (p.kind === 'grenade') explode(this, p.x, p.y, 62, 100, p.src);
      else if (p.kind === 'lure') this.lures.push({ x: p.x, y: p.y, life: 12, beep: 0 });
      else if (p.kind === 'acid') {
        this.pools.push({ x: p.x, y: p.y, life: 6.5, r: 13 });
        this.emit('acidSplash', { x: p.x, y: p.y });
        for (const h of this.humans) if (active(h) && dist(h.x, h.y, p.x, p.y) < 13) damageHuman(this, h, p.dmg, { kind: 'acid', src: p.src, ang: Math.atan2(p.ty - p.sy, p.tx - p.sx) });
      }
    }
  }

  separate() {
    const hs = this.humans, as = this.aliens, nav = this.nav;
    const push = (e, dx, dy) => { if (!e.def || !e.def.static) nav.move(e, dx, dy); };
    for (let i = 0; i < hs.length; i++) {
      const a = hs[i];
      if (a.dead || a.downed) continue;
      for (let j = i + 1; j < hs.length; j++) {
        const b = hs[j];
        if (b.dead || b.downed) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, min = 9;
        if (d >= min) continue;
        const o = (min - d) * 0.5, nx = dx / d, ny = dy / d;
        const wa = a.isPlayer ? 0.15 : b.isPlayer ? 0.85 : 0.5;
        push(a, -nx * o * wa, -ny * o * wa); push(b, nx * o * (1 - wa), ny * o * (1 - wa));
      }
    }
    for (let i = 0; i < as.length; i++) {
      const a = as[i];
      if (a.dead || a.inVent > 0) continue;
      for (let j = i + 1; j < as.length; j++) {
        const b = as[j];
        if (b.dead || b.inVent > 0) continue;
        const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r;
        if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d >= min) continue;
        const o = (min - d) * 0.5, nx = dx / d, ny = dy / d, wa = b.def.mass / (a.def.mass + b.def.mass);
        push(a, -nx * o * wa, -ny * o * wa); push(b, nx * o * (1 - wa), ny * o * (1 - wa));
      }
      for (const h of hs) {
        if (h.dead || h.downed) continue;
        const dx = h.x - a.x, dy = h.y - a.y, min = a.r + h.r;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d >= min) continue;
        const o = min - d, nx = dx / d, ny = dy / d, wa = a.def.static ? 0 : 1 / (1 + a.def.mass);
        push(a, -nx * o * wa, -ny * o * wa); push(h, nx * o * (1 - wa), ny * o * (1 - wa));
      }
    }
  }

  findInteract(h, weld) {
    const m = this.map;
    let best = null, bd = 1e9;
    const consider = (c, d) => { if (d < bd) { bd = d; best = c; } };
    for (const o of this.humans) {
      if (o === h || o.dead) continue;
      const d = dist(h.x, h.y, o.x, o.y);
      if (o.downed && d < 22) consider({ key: 'rev' + o.id, kind: 'revive', label: 'REVIVE ' + o.name, time: h.char.medic ? 1.8 : 3, ref: o, x: o.x, y: o.y }, d - 14);
      else if (!o.downed && h.isPlayer && d < 18 && o.stress > 45 && o.calmCd <= 0) consider({ key: 'calm' + o.id, kind: 'reassure', label: 'REASSURE ' + o.name, time: 1, ref: o, x: o.x, y: o.y }, d + 4);
    }
    for (const p of this.pickups) {
      if (p.cool > 0) continue;
      const d = dist(h.x, h.y, p.x, p.y);
      if (d < 17) consider({ key: 'pk' + p.id, kind: 'pickup', label: 'TAKE ' + this.itemName(p.item, p.n), time: 0, ref: p, x: p.x, y: p.y }, d - 3);
    }
    const tx = Math.floor(h.x / TILE), ty = Math.floor(h.y / TILE);
    const seen = new Set();
    const prop = (p) => {
      if (seen.has(p.id) || !p.interact) return;
      seen.add(p.id);
      const cx = clamp(h.x, p.x * TILE, (p.x + p.w) * TILE), cy = clamp(h.y, p.y * TILE, (p.y + p.h) * TILE);
      const d = dist(h.x, h.y, cx, cy);
      if (d > 11) return;
      const base = { key: 'pr' + p.id, ref: p, x: p.px, y: p.py };
      if (p.interact === 'container') { if (!p.searched) consider(Object.assign(base, { kind: 'container', label: 'SEARCH ' + p.label, time: 0.45 }), d); }
      else if (p.interact === 'medstation') {
        const ok = this.power[m.rooms[p.room].section] && (p.charges === undefined || p.charges > 0);
        consider(Object.assign(base, { kind: 'medstation', label: ok ? 'USE AUTO-DOC' : p.charges === 0 ? 'AUTO-DOC DEPLETED' : 'AUTO-DOC: NO POWER', time: 2.4, disabled: !ok }), d);
      } else if (p.interact === 'log') consider(Object.assign(base, { kind: 'log', label: 'READ TERMINAL', time: 0 }), d + 2);
      else if (p.interact === 'objective' && this.mission) {
        const act = this.mission.consoleAction(this, p, h);
        if (act) consider(Object.assign(base, { kind: 'objective', label: act.label, time: act.time, disabled: act.disabled, obj: act.obj }), d - 2);
      }
    };
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const i = (ty + oy) * m.w + tx + ox, pi = m.propAt[i];
      if (pi) prop(m.props[pi - 1]);
    }
    if (m.soft) for (const p of m.soft) if (Math.abs(p.px - h.x) < 14 && Math.abs(p.py - h.y) < 14) prop(p);
    const hasWelder = weld && h.belt.some((b) => b.id === 'welder');
    for (const d of m.doors) {
      const dd = dist(h.x, h.y, d.px, d.py);
      if (dd > 23 || d.broken) continue;
      const base = { key: 'dr' + d.id, ref: d, x: d.px, y: d.py };
      if (d.welded) consider(Object.assign(base, { kind: 'unweld', label: 'CUT WELD', time: 2.2 }), dd);
      else if (hasWelder) consider(Object.assign(base, { kind: 'weld', label: 'WELD DOOR SHUT', time: 1.5 }), dd - 6);
      else if (d.lock) consider(Object.assign(base, { kind: 'locked', label: d.lock === 'power' ? 'SEALED: NO POWER' : d.lock === 'sec' ? 'LOCKED: SECURITY CARD' : 'LOCKED: COMMAND CARD', time: 1, disabled: true }), dd + 4);
      else if (!this.power[d.section]) consider(Object.assign(base, { kind: 'door', label: d.want ? 'PULL DOOR SHUT' : 'PRY DOOR OPEN', time: d.want ? 0.45 : 0.85 }), dd + 2);
    }
    if (hasWelder) for (const v of m.vents) {
      const dd = dist(h.x, h.y, v.px, v.py);
      if (dd < 20 && !v.sealed) consider({ key: 'vt' + v.id, kind: 'sealvent', label: 'SEAL VENT', time: 1.5, ref: v, x: v.px, y: v.py }, dd - 6);
    }
    return best;
  }

  // Hold-to-use. Returns true once the action fires.
  holdInteract(h, t, dt, speed = 1) {
    if (!t || t.disabled) { h.useT = 0; h.useKey = null; return false; }
    if (h.useKey !== t.key) { h.useKey = t.key; h.useT = 0; }
    h.useNeed = t.time;
    h.useT += dt * speed;
    if (t.kind === 'objective' && this.tick % 30 === 0) this.noise(h.x, h.y, 120, 'machine', h);
    if (h.useT < t.time) return false;
    h.useT = 0; h.useKey = null;
    this.doInteract(h, t);
    return true;
  }

  doInteract(h, t) {
    const r = t.ref;
    switch (t.kind) {
      case 'pickup': this.tryPickup(h, r); break;
      case 'container': {
        r.searched = true;
        this.emit('open', { x: r.px, y: r.py });
        if (!r.loot || !r.loot.length) { if (h.isPlayer) this.msg('EMPTY', 'dim'); break; }
        for (const l of r.loot) this.spawnPickup(l.id, l.n, h.x + (r.px - h.x) * 0.3, h.y + (r.py - h.y) * 0.3, { cool: 0.25 });
        r.loot = [];
        break;
      }
      case 'revive': reviveHuman(this, r, h, h.char.medic ? 18 : 0); break;
      case 'reassure': {
        r.stress = Math.max(r.trauma, r.stress - 30); r.calmCd = 20; r.panicT = 0;
        addStress(h, -5);
        this.say(r, r.stress < 50 ? 'calm' : 'thanks', true);
        this.emit('reassure', { x: r.x, y: r.y });
        break;
      }
      case 'door': r.want = !r.want; this.noise(r.px, r.py, 130, 'door', h); this.emit('pry', { x: r.px, y: r.py }); break;
      case 'weld': case 'sealvent': {
        const b = h.belt.find((q) => q.id === 'welder');
        if (!b) break;
        if (--b.charges <= 0) h.belt.splice(h.belt.indexOf(b), 1);
        if (t.kind === 'weld') { r.welded = true; r.want = false; r.hp = 260; } else r.sealed = true;
        this.emit('weld', { x: t.x, y: t.y });
        this.flash(t.x, t.y, 50, [0.6, 0.8, 1], 0.3);
        if (h.isPlayer) this.msg(t.kind === 'weld' ? 'DOOR WELDED' : 'VENT SEALED', 'good');
        break;
      }
      case 'unweld': r.welded = false; r.hp = 100; this.emit('weld', { x: t.x, y: t.y }); break;
      case 'medstation': {
        if (r.charges === undefined) r.charges = 3;
        r.charges--;
        h.hp = h.maxHp; h.bleed = 0; h.leg = false; h.arm = false; h.acid = 0;
        addStress(h, -20);
        this.emit('heal', { x: h.x, y: h.y, id: h.id, item: 'medkit' });
        if (h.isPlayer) this.msg('AUTO-DOC: TREATMENT COMPLETE (' + r.charges + ' LEFT)', 'good');
        break;
      }
      case 'log': this.emit('log', { title: r.log ? r.log[0] : 'TERMINAL', text: r.log ? r.log[1] : 'NO DATA.' }); break;
      case 'objective': this.mission.consoleDone(this, r, h, t.obj); break;
    }
  }

  playerControl(h, inp, dt) {
    const it = { mx: inp.mx || 0, my: inp.my || 0, sprint: inp.sprint, sneak: inp.sneak, reload: inp.reload, melee: inp.melee };
    if (inp.aimX !== undefined) it.aim = Math.atan2(inp.aimY - h.y, inp.aimX - h.x);
    if (!active(h)) { this.prompt = null; return it; }
    if (inp.firePressed) h.fireBuf = 0.14;
    h.fireBuf = (h.fireBuf || 0) - dt;
    it.fire = curDef(h).auto ? inp.fire : h.fireBuf > 0;
    if (it.fire && h.fireCd <= 0) h.fireBuf = 0;
    if (inp.swap && h.weapons.length > 1) { h.cur = 1 - h.cur; h.reloading = false; h.fireCd = Math.max(h.fireCd, 0.25); this.emit('swap', { id: h.id }); }
    if (inp.slot !== undefined && inp.slot < h.weapons.length && inp.slot !== h.cur) { h.cur = inp.slot; h.reloading = false; h.fireCd = Math.max(h.fireCd, 0.25); this.emit('swap', { id: h.id }); }
    if (inp.heal) { const m = bestMed(h) || (h.stress > 50 && countItem(h, 'stim') ? 'stim' : null); if (m) useItem(this, h, m); else this.msg('NOTHING TO TREAT WITH', 'dim'); }
    if (inp.flashlight) { if (h.battery > 0) { h.flashlight = !h.flashlight; this.emit('click', {}); } else if (countItem(h, 'battery')) useItem(this, h, 'battery'); else this.msg('FLASHLIGHT DEAD: NEED A BATTERY', 'warn'); }
    if (inp.cycleThrow) {
      const order = ['flare', 'grenade', 'lure'].filter((id) => countItem(h, id) > 0);
      if (order.length) h.selThrow = order[(order.indexOf(h.selThrow) + 1) % order.length];
    }
    if (inp.throw) {
      if (!countItem(h, h.selThrow)) { const alt = ['flare', 'grenade', 'lure'].find((id) => countItem(h, id) > 0); if (alt) h.selThrow = alt; }
      if (countItem(h, h.selThrow)) throwItem(this, h, h.selThrow, inp.aimX, inp.aimY);
    }
    if (inp.cmdFollow) this.order('follow');
    if (inp.cmdHold) this.order('hold');
    if (inp.ping) this.order('ping', inp.ping.x, inp.ping.y);
    if (inp.actions) for (const a of inp.actions) {
      if (a.type === 'use') { const b = h.belt[a.slot]; if (b) { if (ITEMS[b.id].kind === 'throw') h.selThrow = b.id; else if (!useItem(this, h, b.id)) this.msg('CANNOT USE THAT NOW', 'dim'); } }
      else if (a.type === 'drop') dropBelt(this, h, a.slot);
      else if (a.type === 'give' || a.type === 'giveAmmo') {
        let to = null, bd = 60;
        for (const o of this.humans) if (o !== h && active(o)) { const d = dist(h.x, h.y, o.x, o.y); if (d < bd) { bd = d; to = o; } }
        if (!to) this.msg('NO ONE CLOSE ENOUGH', 'dim');
        else if (a.type === 'give') { if (!giveBelt(this, h, a.slot, to)) this.msg(to.name + ' HAS NO ROOM', 'dim'); else this.msg('GAVE ITEM TO ' + to.name, 'info'); }
        else { const n = giveAmmo(this, h, a.ammo, to, Math.ceil(AMMO[a.ammo].cap / 5)); if (n) { this.msg('GAVE ' + n + ' ' + AMMO[a.ammo].name + ' TO ' + to.name, 'info'); this.say(to, 'thanks', true); } }
      } else if (a.type === 'dropWeapon' && h.weapons.length > 1) {
        const w = h.weapons.splice(a.slot, 1)[0];
        h.cur = 0; h.reloading = false;
        this.spawnPickup('w:' + w.id, 1, h.x, h.y, { mag: w.mag, cool: 1.5 });
      }
    }
    const t = this.findInteract(h, inp.weld);
    this.prompt = t;
    if (inp.interact && t && !h.useLatch) { if (this.holdInteract(h, t, dt)) h.useLatch = true; }
    else { if (!inp.interact) h.useLatch = false; h.useT = 0; h.useKey = null; }
    return it;
  }

  order(type, x, y) {
    const mates = this.mates().filter(active);
    if (!mates.length) return;
    this.emit('order', { order: type, x, y });
    if (type === 'follow') { for (const m of mates) { m.ai.order = { type: 'follow' }; m.ai.task = null; } this.say(mates[0], 'follow', true); return; }
    if (type === 'hold') {
      let said = false;
      for (const m of mates) {
        if (m.stress >= 60 && m.char.bravery < 0.5) { this.say(m, 'refuse', true); continue; }
        m.ai.order = { type: 'hold', x: m.x, y: m.y };
        if (!said) said = this.say(m, 'hold', true);
      }
      return;
    }
    // Ping: focus fire, operate a console, or move there.
    for (const a of this.aliens) if (!a.dead && a.inVent <= 0 && dist(a.x, a.y, x, y) < 22) { for (const m of mates) { m.ai.focus = a; m.ai.focusT = 8; } this.say(mates[0], 'contact', true); return; }
    if (this.mission) {
      const task = this.mission.taskNear(this, x, y);
      if (task) { const m = mates.slice().sort((p, q) => (q.char.engineer ? 1000 : 0) - (p.char.engineer ? 1000 : 0) + dist(p.x, p.y, x, y) - dist(q.x, q.y, x, y))[0]; m.ai.task = task; this.say(m, 'objective', true); return; }
    }
    mates.forEach((m, i) => {
      const t = this.nav.nearestFree(Math.floor(x / TILE) + (i % 2) - (i > 1 ? 1 : 0), Math.floor(y / TILE) + (i > 0 ? 1 : 0), 3);
      if (t) m.ai.order = { type: 'hold', x: tc(t.x), y: tc(t.y) };
    });
    this.say(mates[0], 'hold', true);
  }

  updateMemory() {
    const now = this.time;
    for (const a of this.aliens) {
      if (a.dead || a.inVent > 0) continue;
      for (const h of this.humans) {
        if (!active(h) || !this.canSee(h, a)) continue;
        this.memory.set(a.id, { x: a.x, y: a.y, t: now, a });
        a.seenT = now;
        if ((this.seenTypes[a.type] || -99) < now - 25 && !a.sleeping) {
          this.seenTypes[a.type] = now;
          const caller = h.isPlayer ? this.mates().find((m) => active(m) && this.canSee(m, a)) : h;
          if (caller) this.say(caller, 'contact_' + a.type, true);
          for (const o of this.humans) if (active(o) && dist(o.x, o.y, a.x, a.y) < 200) addStress(o, a.def.threat * 3, 'CONTACT');
        }
        break;
      }
    }
    for (const [id, m] of this.memory) if (m.a.dead || now - m.t > 8) this.memory.delete(id);
  }

  updateLights() {
    const dyn = [];
    const p = this.player;
    for (const h of this.humans) {
      if (h.dead) continue;
      if (h.downed) continue;
      const on = h.isPlayer ? h.flashlight && h.battery > 0 : this.light.at(h.x, h.y) < 0.5 || this.light.brownout > 0;
      h.lightOn = on;
      if (on) {
        let k = 0.95;
        if (h.isPlayer && h.battery < 15) k *= Math.sin(this.time * 23) > -0.3 ? 0.8 : 0.25;
        dyn.push({ x: h.x, y: h.y - 2, r: h.isPlayer ? 170 : 130, col: [1, 0.96, 0.84], k: k * 1.15, cone: h.aim + h.sway, half: 0.5 });
      }
    }
    for (const f of this.flashes) dyn.push({ x: f.x, y: f.y, r: f.r, col: f.col, k: 1.3 * (f.life / f.max) });
    let n = 0;
    for (const f of this.fires) {
      if (p && Math.abs(f.x - p.x) > 330) continue;
      if (++n > 14) break;
      dyn.push({ x: f.x, y: f.y, r: 44, col: [1, 0.5, 0.18], k: 0.55 + 0.2 * Math.sin(this.time * 17 + f.ph) });
    }
    for (const f of this.flares) dyn.push({ x: f.x, y: f.y, r: 118, col: [1, 0.32, 0.22], k: (0.85 + 0.15 * Math.sin(this.time * 31 + f.ph)) * Math.min(1, f.life / 4) });
    for (const q of this.pools) dyn.push({ x: q.x, y: q.y, r: 22, col: [0.4, 1, 0.2], k: 0.35 });
    for (const a of this.aliens) if (!a.dead && a.type === 'nest') dyn.push({ x: a.x, y: a.y, r: 34, col: [0.8, 0.3, 0.9], k: 0.3 + 0.12 * Math.sin(this.time * 3 + a.id) });
    for (const al of this.alarms) if (!al.off) dyn.push({ x: al.x, y: al.y, r: 100, col: [1, 0.1, 0.05], k: 0.5 + 0.5 * Math.sin(this.time * 6) });
    this.light.brownout = Math.max(0, this.light.brownout);
    this.light.update(this.time, this.power, dyn);
  }

  step(dt, input = {}) {
    if (this.over) { this.overT = (this.overT || 0) + dt; return; }
    useIds(this.ids);
    this.time += dt; this.tick++;
    this.heard = this.noises; this.noises = [];
    this.updateDoors(dt);
    this.updateHazards(dt);
    if (this.light.brownout > 0) this.light.brownout -= dt;
    for (const h of this.humans) {
      let it;
      if (h.isPlayer && !this.autoplay) it = this.playerControl(h, input, dt);
      else it = squadThink(this, h, dt);
      updateHuman(this, h, dt, it);
    }
    updateAliens(this, dt);
    this.updateProjs(dt);
    this.separate();
    const pl = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt; p.cool -= dt; p.age += dt;
      if (p.cool > 0 || !active(pl)) continue;
      const auto = p.item.startsWith('a:') || (ITEMS[p.item] && ITEMS[p.item].kind === 'key');
      if (auto && Math.abs(p.x - pl.x) < 13 && Math.abs(p.y - pl.y) < 13) this.tryPickup(pl, p);
    }
    const last = this.trail[this.trail.length - 1];
    if (!last || dist(last.x, last.y, pl.x, pl.y) > 10) { this.trail.push({ x: pl.x, y: pl.y }); if (this.trail.length > 60) this.trail.shift(); }
    if (this.tick % 12 === 0) this.updateMemory();
    if (this.director) this.director.update(this, dt);
    if (this.mission) this.mission.update(this, dt);
    if (this.tick % this.lightEvery === 0) this.updateLights();
    if (this.tick % 30 === 0) this.aliens = this.aliens.filter((a) => !a.dead);
    const r = this.roomAt(pl.x, pl.y);
    if (r && !r.visited) r.visited = true;
    if (!this.over) {
      if (pl.dead) this.end(false, 'YOU DIED');
      else if (!this.humans.some(active)) this.end(false, 'SQUAD LOST');
    }
  }

  end(win, reason) {
    if (this.over) return;
    this.over = { win, reason, time: this.time, survivors: this.humans.filter((h) => !h.dead && !h.downed).length, total: this.humans.length };
    this.emit('over', { win, reason });
  }

  snapshot() {
    const h2 = (h) => ({ id: h.id, name: h.name, x: Math.round(h.x), y: Math.round(h.y), hp: Math.round(h.hp), stress: Math.round(h.stress), bleed: h.bleed, leg: h.leg, arm: h.arm, downed: h.downed, dead: h.dead, weapon: h.weapons[h.cur].id, mag: h.weapons[h.cur].mag, ammo: Object.assign({}, h.ammo), belt: h.belt.map((b) => b.id + 'x' + b.n), act: h.ai ? h.ai.act : 'player', why: h.ai ? h.ai.why : '', stressors: h.stressors });
    return {
      seed: this.seed, time: +this.time.toFixed(1), over: this.over, power: this.mainPower, air: Math.round(this.air),
      player: h2(this.player), squad: this.humans.filter((h) => !h.isPlayer).map(h2),
      aliens: this.aliens.filter((a) => !a.dead).map((a) => ({ id: a.id, type: a.type, x: Math.round(a.x), y: Math.round(a.y), hp: Math.round(a.hp), act: a.act, why: a.why, aware: +(a.aware || 0).toFixed(2), target: a.target ? a.target.name : null, vent: a.inVent > 0 })),
      objectives: this.mission ? this.mission.objectives.map((o) => ({ id: o.id, title: o.title, state: o.state, progress: o.progress })) : [],
      director: this.director ? { phase: this.director.phase, threat: +this.director.threat.toFixed(2), intensity: +this.director.intensity.toFixed(2) } : null,
      stats: this.stats, perf: { searches: this.nav.searches, expanded: this.nav.expanded }, room: (this.roomAt(this.player.x, this.player.y) || {}).name,
    };
  }
}

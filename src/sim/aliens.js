// Alien perception and per-archetype utility brains.
import { TILE, dist, angDiff, clamp, approach, lerp } from '../core/util.js';
import { ALIENS } from './data.js';
import { newId, active } from './humans.js';
import { damageHuman, addStress, killAlien } from './combat.js';

export function spawnAlien(world, type, x, y, opts = {}) {
  const def = ALIENS[type], rng = world.rng;
  const a = {
    id: newId(), kind: 'alien', type, def, x, y, vx: 0, vy: 0, kx: 0, ky: 0, r: def.r, hp: def.hp, maxHp: def.hp, facing: rng.range(0, 6.28),
    target: null, aware: 0, lk: null, vis: false, seeing: null, act: 'idle', why: '', thinkT: rng.range(0, 0.3), percT: rng.range(0, 0.2), path: null, pathT: 0, pi: 0,
    stun: 0, hurtT: 0, atkCd: rng.range(0, 0.5), atkT: 0, home: opts.home || null, leash: opts.leash || 0, burn: 0, inVent: 0, ventTo: null, anim: rng.range(0, 10), revealT: 0,
    wanderT: rng.range(0, 3), massT: 0, stalkT: 0, strikeCd: rng.range(2, 6), strikeT: 0, hits: 0, withT: 0, chargeCd: 2, charge: null, windup: 0, shots: 0, screamCd: rng.range(0, 3), screamT: 0,
    fleeT: 0, retT: 0, retreatCd: 0, sleeping: !!opts.sleeping, seenT: -99, cloak: false, exposed: 0, spawnT: opts.emerge ? 0.5 : 0, flank: rng.pick([-1, 0, 1]), stepT: 0, dead: false,
    agit: 0, spawnCd: 3, doorT: 0, lungeT: 0, td: 1e9, packN: 0, spotT: 0, spot: null, clickT: rng.range(3, 8), dmgTaken: 0,
  };
  if (opts.lk) a.lk = { x: opts.lk.x, y: opts.lk.y, t: world.time, conf: opts.conf || 0.5 };
  world.aliens.push(a);
  return a;
}

export function pickVent(world, x, y, o = {}) {
  const min = o.min === undefined ? 110 : o.min, max = o.max || 420;
  let best = null, bs = -1e9;
  for (const v of world.map.vents) {
    if (v.sealed || v === o.from) continue;
    let dh = 1e9, seen = false;
    for (const h of world.humans) {
      if (!active(h)) continue;
      const d = dist(h.x, h.y, v.px, v.py);
      if (d < dh) dh = d;
      if (d < 260 && world.nav.los(h.x, h.y, v.px, v.py)) seen = true;
    }
    if (dh < min || (seen && !o.allowSeen)) continue;
    const d = dist(v.px, v.py, x, y);
    if (d > max) continue;
    const s = (o.far ? d : -d) + world.rng.range(0, 50);
    if (s > bs) { bs = s; best = v; }
  }
  return best;
}

function nearestVent(world, a, maxD) {
  let best = null, bd = maxD;
  for (const v of world.map.vents) { if (v.sealed) continue; const d = dist(a.x, a.y, v.px, v.py); if (d < bd) { bd = d; best = v; } }
  return best;
}

function enterVent(world, a, dest) {
  a.inVent = clamp(dist(a.x, a.y, dest.px, dest.py) / 130, 1.6, 7);
  a.ventTo = dest; a.ventWarn = false; a.path = null; a.vx = a.vy = 0;
  world.emit('vent', { x: a.x, y: a.y });
  world.noises.push({ x: a.x, y: a.y, r: 170, kind: 'alien', src: a, vent: true });
}

const doorCost = (a) => (d) => (d.broken || d.open > 0.5 ? 0 : a.def.doorCost * (d.welded ? 2.5 : 1));
const isolated = (world, h) => { for (const o of world.humans) if (o !== h && active(o) && dist(o.x, o.y, h.x, h.y) < 75) return false; return true; };

// Path-follow toward a point. Returns true on arrival.
function go(world, a, x, y, speed, dt, stop = 5) {
  const d = dist(a.x, a.y, x, y);
  if (d < stop) { a.tvx = 0; a.tvy = 0; return true; }
  let wx = x, wy = y;
  const direct = d < 90 && !a.avoid && world.nav.walkLine(a.x, a.y, x, y) && world.nav.clearLine(a.x, a.y, x, y, Math.min(6.4, a.r));
  if (!direct) {
    if (!a.path || a.pathT <= 0 || dist(a.gx, a.gy, x, y) > 18) {
      const fire = world.fireTiles;
      const av = a.avoid, W = world.map.w, useFire = a.def.fearFire && fire.size > 0;
      // Stalkers route around their prey instead of brushing past it.
      const extra = av ? (i) => { const dx = (i % W) * TILE + 8 - av.x, dy = ((i / W) | 0) * TILE + 8 - av.y; return (dx * dx + dy * dy < av.r * av.r ? 22 : 0) + (useFire && fire.has(i) ? 30 : 0); } : useFire ? (i) => (fire.has(i) ? 30 : 0) : null;
      a.path = world.nav.findPath(a.x, a.y, x, y, { doorCost: doorCost(a), extra, smooth: av ? 2 : 14 });
      a.pi = 0; a.gx = x; a.gy = y; a.pathT = 0.55 + world.rng.next() * 0.5;
      world.perf.paths++;
      a.noPath = !a.path;
      if (!a.path) { a.tvx = 0; a.tvy = 0; return false; }
    }
    let wp = a.path[a.pi];
    while (wp && a.pi < a.path.length - 1 && dist(a.x, a.y, wp.x, wp.y) < 6) wp = a.path[++a.pi];
    if (!wp) return true;
    if (wp.door) {
      const m = world.map, door = m.doors[m.doorAt[Math.floor(wp.y / TILE) * m.w + Math.floor(wp.x / TILE)] - 1];
      if (door && door.solid && dist(a.x, a.y, door.px, door.py) < 17 + a.r) {
        a.tvx = 0; a.tvy = 0;
        a.facing = Math.atan2(door.py - a.y, door.px - a.x);
        a.doorT -= dt;
        if (a.doorT <= 0) { a.doorT = a.type === 'brute' ? 0.9 : 0.55; world.hitDoor(door, a.type === 'brute' ? 55 : 13, a); a.atkAnim = 0.25; }
        return false;
      }
    }
    wx = wp.x; wy = wp.y;
  } else a.noPath = false;
  const dx = wx - a.x, dy = wy - a.y, l = Math.hypot(dx, dy) || 1;
  a.tvx = (dx / l) * speed; a.tvy = (dy / l) * speed;
  return false;
}

function away(world, a, fx, fy, speed, extra) {
  let best = null, bs = -1e9;
  for (let k = 0; k < 8; k++) {
    const ang = (k * Math.PI) / 4, x = a.x + Math.cos(ang) * 30, y = a.y + Math.sin(ang) * 30;
    if (!world.nav.boxFree(x, y, a.r) || !world.nav.walkLine(a.x, a.y, x, y)) continue;
    const s = dist(x, y, fx, fy) + (extra ? extra(x, y) : 0);
    if (s > bs) { bs = s; best = { x, y }; }
  }
  if (best) { const l = dist(a.x, a.y, best.x, best.y) || 1; a.tvx = ((best.x - a.x) / l) * speed; a.tvy = ((best.y - a.y) / l) * speed; }
  else { a.tvx = 0; a.tvy = 0; }
}

function wander(world, a, dt, speed) {
  a.wanderT -= dt;
  if (a.wanderT <= 0 || !a.wp) {
    a.wanderT = world.rng.range(2.5, 7);
    const bx = a.home ? a.home.x : a.x, by = a.home ? a.home.y : a.y, rad = a.home ? 3 : 7;
    const t = world.nav.nearestFree(Math.floor(bx / TILE) + world.rng.int(-rad, rad), Math.floor(by / TILE) + world.rng.int(-rad, rad), 2);
    a.wp = t ? { x: t.x * TILE + 8, y: t.y * TILE + 8 } : null;
    if (world.rng.chance(0.35)) a.wp = null;
  }
  if (a.wp) { if (go(world, a, a.wp.x, a.wp.y, speed, dt, 6)) a.wp = null; } else { a.tvx = 0; a.tvy = 0; }
}

function strike(world, a, h, dmg, kind, o = {}) {
  const ang = Math.atan2(h.y - a.y, h.x - a.x);
  damageHuman(world, h, dmg, Object.assign({ kind, src: a, ang }, o));
  world.emit('claw', { x: h.x, y: h.y, ang, type: a.type });
  a.revealT = 1.2;
}

function fireNear(world, a, r) {
  for (const f of world.fires) if (Math.abs(f.x - a.x) < r && Math.abs(f.y - a.y) < r) return f;
  for (const f of world.flares) if (a.type === 'lurker' && dist(f.x, f.y, a.x, a.y) < 70) return f;
  return null;
}

function ventEscape(world, a, dt, speed, destOpts) {
  const v = a.escV && !a.escV.sealed ? a.escV : (a.escV = nearestVent(world, a, 300));
  if (!v) return false;
  if (go(world, a, v.px, v.py, speed, dt, 8)) {
    const tx = a.target ? a.target.x : world.player.x, ty = a.target ? a.target.y : world.player.y;
    const dest = pickVent(world, tx, ty, Object.assign({ from: v }, destOpts)) || pickVent(world, tx, ty, { from: v, min: 60, max: 900, allowSeen: true });
    a.escV = null;
    if (dest) enterVent(world, a, dest); else return false;
  } else if (a.noPath) { a.escV = null; return false; }
  return true;
}

function goalOf(a) { return a.target ? a.target : a.lk; }

const BRAINS = {
  skitterer: {
    fleeFire: { s: (w, a) => (a.burn > 0 || fireNear(w, a, 24) ? 95 : 0), r(w, a, dt) { const f = fireNear(w, a, 40); if (f) away(w, a, f.x, f.y, a.def.rush); else { a.tvx = Math.cos(a.anim * 3) * a.def.rush; a.tvy = Math.sin(a.anim * 3) * a.def.rush; } } },
    retreat: {
      s(w, a) { if (a.retT > 0) return 93; if (a.hp < a.maxHp * 0.42 && a.packN < 2 && a.retreatCd <= 0 && a.lungeT <= 0) { a.retT = 6; return 93; } return 0; },
      r(w, a, dt) {
        a.retT -= dt; a.why = 'hurt and alone';
        if (a.retT <= 0) { a.retreatCd = 18; a.hp = Math.min(a.maxHp, a.hp + 10); }
        const g = goalOf(a);
        if (a.home && dist(a.x, a.y, a.home.x, a.home.y) > 30) go(w, a, a.home.x, a.home.y, a.def.rush, dt);
        else if (g) away(w, a, g.x, g.y, a.def.rush);
      },
    },
    bite: {
      s: (w, a) => (a.target && a.vis && a.td < 32 ? 90 : a.lungeT > 0 ? 90 : 0),
      r(w, a, dt) {
        const h = a.target;
        if (!h) return;
        const ang = Math.atan2(h.y - a.y, h.x - a.x);
        a.facing = ang;
        if (a.atkCd <= 0 && a.lungeT <= 0) { a.atkCd = a.def.atkCd + w.rng.range(0, 0.3); a.lungeT = 0.22; a.lungeHit = false; a.kx += Math.cos(ang) * 190; a.ky += Math.sin(ang) * 190; w.emit('lunge', { x: a.x, y: a.y, type: a.type }); }
        if (a.lungeT > 0) { a.lungeT -= dt; if (!a.lungeHit && dist(a.x, a.y, h.x, h.y) < a.r + h.r + 4) { a.lungeHit = true; strike(w, a, h, a.def.dmg, 'claw'); } }
        // Circle between lunges.
        const side = a.flank || 1;
        a.tvx = -Math.sin(ang) * side * a.def.speed * 0.6 + Math.cos(ang) * (a.td > 22 ? 30 : -20);
        a.tvy = Math.cos(ang) * side * a.def.speed * 0.6 + Math.sin(ang) * (a.td > 22 ? 30 : -20);
        a.why = 'biting ' + h.name;
      },
    },
    rush: {
      s(w, a) {
        const g = a.target || (a.lk && a.lk.conf >= 0.5 ? a.lk : null);
        if (!g) return 0;
        const ok = a.packN >= 2 || a.massT > 4.5 || a.td < 75 || (a.target && isolated(w, a.target)) || a.lured > 0 || w.frenzy;
        return ok ? 70 : 0;
      },
      r(w, a, dt) {
        const h = a.target, g = h || a.lk;
        a.why = h ? 'rushing ' + h.name : 'closing on sound';
        let x = g.x, y = g.y;
        if (h && a.flank && a.td > 60) {
          const base = Math.atan2(a.y - h.y, a.x - h.x) + a.flank * 1.2;
          const fx = h.x + Math.cos(base) * 46, fy = h.y + Math.sin(base) * 46;
          if (w.nav.boxFree(fx, fy, a.r)) { x = fx; y = fy; a.why += ' (flank)'; }
        }
        if (go(w, a, x, y, a.def.rush, dt, 8) && !h) { a.lk.conf -= dt * 0.4; wander(w, a, dt, a.def.speed); if (a.lk.conf < 0.1) a.lk = null; }
      },
    },
    mass: {
      s: (w, a) => (a.target || (a.lk && a.lk.conf >= 0.5) ? 60 : 0),
      r(w, a, dt) {
        const g = goalOf(a);
        a.massT += dt; a.why = 'waiting for the pack';
        const d = dist(a.x, a.y, g.x, g.y);
        if (d < 120 && w.nav.los(a.x, a.y, g.x, g.y)) away(w, a, g.x, g.y, a.def.speed, (x, y) => (w.nav.los(x, y, g.x, g.y) ? 0 : 60) - w.light.at(x, y) * 40);
        else if (d > 190) go(w, a, g.x, g.y, a.def.speed, dt, 140);
        else { a.tvx = 0; a.tvy = 0; a.facing = Math.atan2(g.y - a.y, g.x - a.x); }
      },
    },
    investigate: {
      s: (w, a) => (a.lk ? 40 : 0),
      r(w, a, dt) { a.why = 'heard something'; if (go(w, a, a.lk.x, a.lk.y, a.def.speed, dt, 10)) { a.lk.conf -= dt * 0.22; wander(w, a, dt, a.def.speed * 0.7); if (a.lk.conf <= 0.05) a.lk = null; } },
    },
    home: { s: (w, a) => (a.home && !a.target && dist(a.x, a.y, a.home.x, a.home.y) > a.leash ? 30 : 0), r(w, a, dt) { a.why = 'returning to nest'; go(w, a, a.home.x, a.home.y, a.def.speed, dt, 20); } },
    roam: { s: () => 10, r(w, a, dt) { a.why = 'roaming'; a.massT = 0; wander(w, a, dt, a.def.speed * 0.5); } },
  },

  lurker: {
    withdraw: {
      s(w, a) {
        if (a.withT > 0) return 85;
        const trig = (a.exposed > 0.7 && a.act !== 'strike') || a.hits >= 2 || (a.act === 'strike' && a.dmgTaken > 34) || a.burn > 0 || (a.exposed > 1.6);
        if (trig) { a.withT = 6; a.hits = 0; a.dmgTaken = 0; a.strikeCd = Math.max(a.strikeCd, 8); a.strikeT = 0; w.emit('hiss', { x: a.x, y: a.y }); return 85; }
        return 0;
      },
      r(w, a, dt) {
        a.withT -= dt; a.why = a.exposed > 0.5 ? 'driven off by light' : 'withdrawing';
        if (ventEscape(w, a, dt, a.def.rush * 0.8, { min: 130, max: 340 })) return;
        const g = goalOf(a) || w.player;
        away(w, a, g.x, g.y, a.def.rush * 0.8, (x, y) => -w.light.at(x, y) * 80);
      },
    },
    strike: {
      s(w, a) {
        if (a.strikeT > 0 && a.target) return 80;
        const h = a.target;
        if (!h || a.strikeCd > 0 || a.td > 175 || (a.stalkT < 3.5 && h.hp >= 40)) return 0;
        const behind = Math.abs(angDiff(h.aim, Math.atan2(a.y - h.y, a.x - h.x))) > 1.9;
        const why = isolated(w, h) ? 'isolated' : h.reloading || h.busyT > 0 ? 'busy' : h.hp < 40 ? 'wounded' : behind ? 'back turned' : a.stalkT > 20 ? 'impatient' : null;
        if (!why) return 0;
        a.strikeT = 4.5; a.dmgTaken = 0; a.strikeWhy = why;
        w.emit('lurkerStrike', { x: a.x, y: a.y });
        return 80;
      },
      r(w, a, dt) {
        const h = a.target;
        a.strikeT -= dt; a.stalkT = 0; a.why = 'striking: ' + a.strikeWhy;
        if (!h) { a.strikeT = 0; return; }
        if (a.td < a.def.reach + h.r) {
          a.tvx = 0; a.tvy = 0; a.facing = Math.atan2(h.y - a.y, h.x - a.x);
          if (a.atkCd <= 0) { a.atkCd = a.def.atkCd; a.hits++; a.atkAnim = 0.25; strike(w, a, h, a.def.dmg, 'claw', { bleed: true, knock: 60 }); addStress(h, 9, 'AMBUSHED'); }
        } else go(w, a, h.x, h.y, a.def.rush, dt, a.def.reach);
        if (a.strikeT <= 0) { a.withT = 5; a.strikeCd = 9; }
      },
    },
    stalk: {
      s: (w, a) => (a.target || (a.lk && a.lk.conf > 0.25) ? 60 : 0),
      r(w, a, dt) {
        const g = goalOf(a);
        a.stalkT += dt; a.why = 'stalking (' + a.stalkT.toFixed(0) + 's)';
        a.avoid = { x: g.x, y: g.y, r: 70 };
        a.spotT -= dt;
        if (a.spotT <= 0 || !a.spot) {
          a.spotT = 1.3;
          let best = null, bs = -1e9;
          for (let k = 0; k < 14; k++) {
            const ang = w.rng.range(0, 6.28), r = w.rng.range(72, 155), x = g.x + Math.cos(ang) * r, y = g.y + Math.sin(ang) * r;
            // Stay in the same open space as the prey: somewhere it could be rushed from.
            if (!w.nav.boxFree(x, y, a.r) || !w.nav.walkLine(g.x, g.y, x, y)) continue;
            const s = (1 - w.light.at(x, y)) * 40 - dist(x, y, a.x, a.y) * 0.12 + r * 0.1;
            if (s > bs) { bs = s; best = { x, y }; }
          }
          if (best) a.spot = best;
        }
        if (a.spot) { if (go(w, a, a.spot.x, a.spot.y, a.def.speed * (a.td > 200 ? 2 : 1), dt, 8)) a.facing = Math.atan2(g.y - a.y, g.x - a.x); }
        a.ventCd = (a.ventCd || 0) - dt;
        if (a.noPath && a.ventCd <= 0) { if (ventEscape(w, a, dt, a.def.speed * 1.5, { min: 90, max: 280 }) && a.inVent > 0) a.ventCd = 8; }
        a.clickT -= dt;
        if (a.clickT <= 0) { a.clickT = w.rng.range(5, 10); w.emit('click_alien', { x: a.x, y: a.y }); w.noises.push({ x: a.x, y: a.y, r: 150, kind: 'alien', src: a }); }
        if (!a.target) { a.lk.conf -= dt * 0.03; if (a.lk.conf < 0.2) a.lk = null; }
      },
    },
    roam: { s: () => 10, r(w, a, dt) { a.why = 'lurking'; a.stalkT = 0; wander(w, a, dt, a.def.speed * 0.6); } },
  },

  brute: {
    charging: {
      s: (w, a) => (a.charge ? 99 : 0),
      r(w, a, dt) {
        const c = a.charge, sp = a.def.rush * dt;
        a.why = 'CHARGING'; a.tvx = 0; a.tvy = 0; a.vx = Math.cos(c.dir) * a.def.rush; a.vy = Math.sin(c.dir) * a.def.rush;
        const hit = w.nav.move(a, Math.cos(c.dir) * sp, Math.sin(c.dir) * sp);
        a.vx = 0; a.vy = 0; c.d += sp; a.facing = c.dir;
        for (const h of w.humans) if (active(h) && !c.hit.has(h) && dist(a.x, a.y, h.x, h.y) < a.r + h.r + 3) { c.hit.add(h); strike(w, a, h, a.def.dmg, 'charge', { knock: 280 }); addStress(h, 8, 'TRAMPLED'); }
        if (hit || c.d > 240) {
          a.charge = null; a.chargeCd = 6.5;
          if (hit) {
            const m = w.map, fx = a.x + Math.cos(c.dir) * 12, fy = a.y + Math.sin(c.dir) * 12, di = m.doorAt[Math.floor(fy / TILE) * m.w + Math.floor(fx / TILE)];
            if (di && m.doors[di - 1].solid) { w.hitDoor(m.doors[di - 1], 120, a); a.stun = 0.5; }
            else { a.stun = 1.8; w.emit('slam', { x: a.x, y: a.y }); w.noise(a.x, a.y, 300, 'impact', a); for (const h of w.humans) if (!h.isPlayer && active(h) && dist(h.x, h.y, a.x, a.y) < 160) { w.say(h, 'brute_stun', true); break; } }
          }
        }
      },
    },
    windup: {
      s: (w, a) => (a.windup > 0 ? 98 : 0),
      r(w, a, dt) {
        a.windup -= dt; a.tvx = 0; a.tvy = 0; a.why = 'winding up';
        if (a.target) a.chargeDir = Math.atan2(a.target.y - a.y, a.target.x - a.x);
        a.facing = a.chargeDir;
        if (a.windup <= 0) a.charge = { dir: a.chargeDir, d: 0, hit: new Set() };
      },
    },
    startCharge: {
      s: (w, a) => (a.target && a.vis && a.td > 55 && a.td < 175 && a.chargeCd <= 0 && w.nav.walkLine(a.x, a.y, a.target.x, a.target.y) ? 85 : 0),
      r(w, a) { a.windup = 0.8; a.chargeDir = Math.atan2(a.target.y - a.y, a.target.x - a.x); w.emit('roar', { x: a.x, y: a.y }); w.noises.push({ x: a.x, y: a.y, r: 260, kind: 'alien', src: a }); a.revealT = 2; },
    },
    swipe: {
      s: (w, a) => (a.atkT > 0 ? 81 : a.target && a.td < a.def.reach + 6 ? 80 : 0),
      r(w, a, dt) {
        a.tvx = 0; a.tvy = 0; a.why = 'swiping';
        if (a.atkT <= 0 && a.atkCd <= 0) { a.atkT = 0.42; a.atkAnim = 0.5; }
        if (a.atkT > 0) {
          a.atkT -= dt;
          if (a.atkT <= 0) {
            a.atkCd = a.def.atkCd;
            for (const h of w.humans) if (active(h) && dist(a.x, a.y, h.x, h.y) < a.def.reach + 8 && Math.abs(angDiff(a.facing, Math.atan2(h.y - a.y, h.x - a.x))) < 1.2) strike(w, a, h, 26, 'claw', { knock: 170 });
            w.emit('swipe', { x: a.x, y: a.y, ang: a.facing });
          }
        } else if (a.target) a.facing += clamp(angDiff(a.facing, Math.atan2(a.target.y - a.y, a.target.x - a.x)), -2.6 * dt, 2.6 * dt);
      },
    },
    pursue: {
      s: (w, a) => (a.target || a.lk ? 60 : 0),
      r(w, a, dt) {
        const g = goalOf(a), sp = a.def.speed * (a.hp < a.maxHp * 0.4 ? 1.45 : 1);
        a.why = a.target ? 'pursuing ' + a.target.name : 'investigating';
        if (go(w, a, g.x, g.y, sp, dt, 10) && !a.target) { a.lk.conf -= dt * 0.2; if (a.lk.conf < 0.1) a.lk = null; }
      },
    },
    roam: { s: () => 10, r(w, a, dt) { a.why = 'patrolling'; if (a.home && w.director && w.director.threat > 1.3) a.home = null; wander(w, a, dt, a.def.speed * 0.7); } },
  },

  spitter: {
    fleeFire: { s: (w, a) => (a.burn > 0 || fireNear(w, a, 24) ? 95 : 0), r(w, a) { const f = fireNear(w, a, 40) || a; away(w, a, f.x, f.y, a.def.rush); } },
    flee: {
      s(w, a) { let nd = 1e9, nh = null; for (const h of w.humans) if (active(h)) { const d = dist(h.x, h.y, a.x, a.y); if (d < nd) { nd = d; nh = h; } } a.nearH = nh; return nd < 62 && a.atkT <= 0 ? 85 : 0; },
      r(w, a) { a.why = 'too close, backing off'; away(w, a, a.nearH.x, a.nearH.y, a.def.rush); a.shots = 0; },
    },
    spit: {
      s: (w, a) => (a.atkT > 0 ? 81 : a.target && a.vis && a.td < 172 && a.atkCd <= 0 && a.shots < 2 ? 80 : 0),
      r(w, a, dt) {
        const h = a.target;
        a.tvx = 0; a.tvy = 0; a.why = 'spitting';
        if (!h) { a.atkT = 0; return; }
        a.facing = Math.atan2(h.y - a.y, h.x - a.x);
        if (a.atkT <= 0) { a.atkT = 0.55; w.emit('spitWind', { x: a.x, y: a.y }); a.revealT = 1.5; }
        a.atkT -= dt;
        if (a.atkT <= 0) {
          a.atkCd = a.def.atkCd; a.shots++;
          const dur = 0.4 + a.td / 240;
          const tx = h.x + h.vx * dur * 0.6 + w.rng.range(-7, 7), ty = h.y + h.vy * dur * 0.6 + w.rng.range(-7, 7);
          w.projs.push({ kind: 'acid', x: a.x, y: a.y, sx: a.x, sy: a.y, tx, ty, t: 0, dur, src: a, dmg: a.def.dmg });
          w.emit('spit', { x: a.x, y: a.y });
        }
      },
    },
    retreat: {
      s(w, a) { if (a.retT > 0) return 72; if (a.hp < a.maxHp * 0.4 && !a.healed) { a.retT = 6; a.healed = true; return 72; } return 0; },
      r(w, a, dt) { a.retT -= dt; a.why = 'wounded, hiding'; const g = goalOf(a) || w.player; away(w, a, g.x, g.y, a.def.rush, (x, y) => (w.nav.los(x, y, g.x, g.y) ? 0 : 80)); a.hp = Math.min(a.maxHp, a.hp + 3 * dt); },
    },
    relocate: {
      s: (w, a) => ((a.target || a.lk) && (a.shots >= 2 || !a.vis) ? 62 : 0),
      r(w, a, dt) {
        const g = goalOf(a);
        a.why = 'relocating'; a.spotT -= dt;
        if (!a.spot || a.spotT <= 0) {
          a.spotT = 2.5;
          let best = null, bs = -1e9;
          for (let k = 0; k < 14; k++) {
            const ang = w.rng.range(0, 6.28), r = w.rng.range(100, 160), x = g.x + Math.cos(ang) * r, y = g.y + Math.sin(ang) * r;
            if (!w.nav.boxFree(x, y, a.r) || !w.nav.los(x, y, g.x, g.y)) continue;
            const s = -dist(x, y, a.x, a.y) * 0.2 + (dist(x, y, a.x, a.y) > 50 ? 20 : 0) + w.rng.range(0, 10);
            if (s > bs) { bs = s; best = { x, y }; }
          }
          a.spot = best || { x: g.x, y: g.y };
        }
        if (go(w, a, a.spot.x, a.spot.y, a.def.rush, dt, 8)) { a.shots = 0; a.spot = null; }
        if (a.noPath) { if (!ventEscape(w, a, dt, a.def.rush, { min: 90, max: 260 })) a.spot = null; }
        if (!a.target && a.lk) { a.lk.conf -= dt * 0.08; if (a.lk.conf < 0.1) a.lk = null; }
      },
    },
    hold: { s: (w, a) => (a.target && a.vis ? 55 : 0), r(w, a) { a.why = 'lining up'; a.tvx = 0; a.tvy = 0; a.facing = Math.atan2(a.target.y - a.y, a.target.x - a.x); } },
    roam: { s: () => 10, r(w, a, dt) { a.why = 'grazing'; wander(w, a, dt, a.def.speed * 0.5); } },
  },

  shrieker: {
    scream: {
      s: (w, a) => (a.screamT > 0 ? 91 : (a.seeing || (a.target && a.vis)) && a.td < 165 && a.screamCd <= 0 ? 90 : 0),
      r(w, a, dt) {
        a.tvx = 0; a.tvy = 0; a.why = 'SCREAMING';
        if (a.screamT <= 0) { a.screamT = 1.1; w.emit('shriekWind', { x: a.x, y: a.y }); a.revealT = 3; }
        a.screamT -= dt;
        if (a.screamT > 0) return;
        a.screamCd = 24; a.fleeT = 9;
        w.emit('shriek', { x: a.x, y: a.y });
        w.noises.push({ x: a.x, y: a.y, r: 600, kind: 'alien', src: a });
        const tg = a.target || a.seeing || w.player;
        for (const h of w.humans) { const d = dist(h.x, h.y, a.x, a.y); if (!h.dead && d < 260) addStress(h, 17 * (1 - d / 330), 'SHRIEK'); }
        for (const o of w.aliens) {
          if (o.dead || o.def.static || o === a || dist(o.x, o.y, a.x, a.y) > 480) continue;
          o.sleeping = false; o.aware = Math.max(o.aware, 0.8);
          o.lk = { x: tg.x, y: tg.y, t: w.time, conf: 0.9 };
        }
        w.director && w.director.onShriek(w, a, tg);
      },
    },
    flee: {
      s(w, a) { let nd = 1e9; for (const h of w.humans) if (active(h)) nd = Math.min(nd, dist(h.x, h.y, a.x, a.y)); a.nd = nd; return a.fleeT > 0 || nd < 85 || a.burn > 0 ? 80 : 0; },
      r(w, a, dt) {
        a.fleeT -= dt; a.why = 'fleeing';
        if (ventEscape(w, a, dt, a.def.rush, { min: 200, max: 700, far: true })) return;
        const p = w.player; away(w, a, p.x, p.y, a.def.rush);
      },
    },
    roam: { s: () => 10, r(w, a, dt) { a.why = 'hiding'; wander(w, a, dt, a.def.speed * 0.35); } },
  },
};
const ORDERS = {};
for (const k in BRAINS) ORDERS[k] = Object.keys(BRAINS[k]);

function hear(world, a, n) {
  if (n.kind === 'alien' || n.src === a) return;
  const d = dist(a.x, a.y, n.x, n.y);
  if (a.def.static) { if (d < n.r) a.agit = Math.max(a.agit, 8); return; }
  let range = n.r * a.def.hear;
  if (a.sleeping) range *= 0.22;
  if (d > range) return;
  if (d > range * 0.6 && !world.nav.los(a.x, a.y, n.x, n.y)) return;
  a.sleeping = false;
  const str = 1 - d / range;
  if (n.kind === 'lure') {
    if (a.type === 'shrieker' || a.type === 'spitter') return;
    if (!a.vis) a.target = null;
    a.lk = { x: n.x, y: n.y, t: world.time, conf: 1 };
    a.lured = 1.2;
    return;
  }
  if (a.target && a.vis) return;
  const err = d * 0.2;
  const conf = 0.3 + str * 0.6;
  if (!a.lk || conf >= a.lk.conf * 0.8) a.lk = { x: n.x + world.rng.range(-err, err), y: n.y + world.rng.range(-err, err), t: world.time, conf: Math.max(conf, a.lk ? a.lk.conf * 0.9 : 0) };
  a.aware = Math.min(0.9, a.aware + 0.25 * str);
}

function perceive(world, a) {
  const def = a.def;
  let best = null, bs = -1e9, bestGain = 0, tvis = false;
  if (!a.sleeping) for (const h of world.humans) {
    if (!active(h)) continue;
    const d = dist(a.x, a.y, h.x, h.y);
    if (d > def.sight * 1.1) continue;
    const light = world.light.at(h.x, h.y);
    let vis = lerp(def.darkSight, 1, clamp(light * 2.4, 0, 1));
    if (h.lightOn) vis = Math.max(vis, 0.85);
    if (h.firedT < 0.35) vis = 1;
    if (h.sneak) vis *= 0.6;
    const range = def.sight * vis;
    if (d > range) continue;
    const ang = Math.atan2(h.y - a.y, h.x - a.x);
    if (d > 34 && Math.abs(angDiff(a.facing, ang)) > def.fov / 2 && h !== a.target) continue;
    if (!world.nav.los(a.x, a.y, h.x, h.y)) continue;
    if (h === a.target) tvis = true;
    let s = -d;
    if (a.type === 'lurker' || a.type === 'skitterer') s += isolated(world, h) ? 120 : 0;
    if (h === a.target) s += 40;
    if (s > bs) { bs = s; best = h; bestGain = (1.3 + 2.6 * (1 - d / range)) * 0.2; }
  } else for (const h of world.humans) if (active(h) && dist(h.x, h.y, a.x, a.y) < 26) { a.sleeping = false; a.aware = 1; best = h; bestGain = 1; if (h === a.target) tvis = true; }
  a.seeing = best;
  if (best) {
    a.aware = Math.min(1.2, a.aware + bestGain);
    if (a.aware >= 1 && a.target !== best && (!a.target || !tvis || a.type === 'lurker')) { a.target = best; tvis = true; }
  } else a.aware = Math.max(0, a.aware - 0.05);
  a.vis = false;
  if (a.target) {
    const h = a.target;
    if (!active(h)) a.target = null;
    else if (tvis) { a.vis = true; a.lk = { x: h.x, y: h.y, t: world.time, conf: 1 }; }
    else if (a.lk) { a.lk.conf -= a.type === 'lurker' ? 0.007 : 0.022; if (a.lk.conf < 0.2) { a.target = null; a.aware = 0.4; } }
    else a.target = null;
    if (a.target && a.home && a.leash && dist(a.target.x, a.target.y, a.home.x, a.home.y) > a.leash * 1.6 && !a.vis) a.target = null;
  }
  a.td = a.target ? dist(a.x, a.y, a.target.x, a.target.y) : 1e9;
  let pack = 0;
  for (const o of world.aliens) {
    if (o === a || o.dead || o.inVent > 0 || o.def.static) continue;
    const d = dist(a.x, a.y, o.x, o.y);
    if (d > 110) continue;
    if (o.type === a.type) pack++;
    if (a.target && a.vis && !o.sleeping && !o.target) { o.lk = { x: a.lk.x, y: a.lk.y, t: world.time, conf: 0.85 }; o.aware = Math.max(o.aware, 0.7); if (o.type === 'skitterer' && a.type === 'skitterer') o.target = a.target; }
  }
  a.packN = pack;
  const lit = world.light.at(a.x, a.y);
  a.cloak = a.type === 'lurker' && lit < 0.3 && a.act !== 'strike' && a.revealT <= 0;
  if (a.type === 'lurker') a.exposed = lit > 0.27 ? a.exposed + 0.2 : Math.max(0, a.exposed - 0.3);
}

function updateNest(world, a, dt) {
  a.agit -= dt;
  if (world.tick % 20 === a.id % 20) for (const h of world.humans) if (active(h) && dist(h.x, h.y, a.x, a.y) < 170 && world.nav.los(h.x, h.y, a.x, a.y)) a.agit = Math.max(a.agit, 6);
  if (a.agit <= 0) return;
  a.spawnCd -= dt;
  if (a.spawnCd > 0) return;
  a.spawnCd = 11;
  let local = 0, total = 0;
  for (const o of world.aliens) { if (o.dead) continue; total++; if (o.nest === a) local++; }
  if (local >= 3 || total >= 26) return;
  const ang = world.rng.range(0, 6.28);
  let x = a.x + Math.cos(ang) * 14, y = a.y + Math.sin(ang) * 14;
  if (!world.nav.boxFree(x, y, 4)) { x = a.x; y = a.y; }
  const s = spawnAlien(world, 'skitterer', x, y, { home: { x: a.x, y: a.y }, leash: 230, emerge: true });
  s.nest = a; s.aware = 0.7;
  const h = world.squadAlive().sort((p, q) => dist(p.x, p.y, a.x, a.y) - dist(q.x, q.y, a.x, a.y))[0];
  if (h) s.lk = { x: h.x, y: h.y, t: world.time, conf: 0.8 };
  world.emit('hatch', { x, y });
}

export function updateAliens(world, dt) {
  const heard = world.heard;
  for (const a of world.aliens) {
    if (a.dead) continue;
    a.anim += dt; a.hurtT -= dt; a.revealT -= dt;
    if (a.type === 'nest') { for (const n of heard) hear(world, a, n); updateNest(world, a, dt); continue; }
    if (a.inVent > 0) {
      a.inVent -= dt;
      const v = a.ventTo;
      if (a.inVent < 0.9 && !a.ventWarn) { a.ventWarn = true; v.rattle = 1; world.emit('vent', { x: v.px, y: v.py }); world.noises.push({ x: v.px, y: v.py, r: 170, kind: 'alien', src: a, vent: true }); }
      if (a.inVent <= 0) {
        let dest = v;
        if (dest.sealed) { dest = pickVent(world, v.px, v.py, { min: 0, max: 2000, allowSeen: true }); if (!dest) { dest = v; v.sealed = false; world.emit('doorBreak', { x: v.px, y: v.py, orient: 'h' }); world.noise(v.px, v.py, 260, 'impact', a); } }
        a.x = dest.px; a.y = dest.py; a.spawnT = 0.5; a.inVent = 0; a.path = null;
        world.emit('emerge', { x: a.x, y: a.y, type: a.type });
      }
      continue;
    }
    for (const n of heard) hear(world, a, n);
    a.atkCd -= dt; a.pathT -= dt; a.strikeCd -= dt; a.chargeCd -= dt; a.screamCd -= dt; a.retreatCd -= dt;
    if (a.lured > 0) a.lured -= dt;
    if (a.atkAnim > 0) a.atkAnim -= dt;
    if (a.burn > 0) { a.burn -= dt; a.hp -= 11 * dt; if (a.hp <= 0) { killAlien(world, a, { fire: true }); continue; } }
    a.percT -= dt;
    if (a.percT <= 0) { a.percT = 0.2; perceive(world, a); }
    a.tvx = a.tvx || 0; a.tvy = a.tvy || 0;
    if (a.spawnT > 0) { a.spawnT -= dt; a.tvx = a.tvy = 0; }
    else if (a.stun > 0) { a.stun -= dt; a.tvx = a.tvy = 0; a.windup = 0; a.atkT = 0; a.screamT = Math.min(a.screamT, 0); a.why = 'stunned'; }
    else if (a.sleeping) { a.tvx = a.tvy = 0; a.act = 'dormant'; a.why = 'dormant'; }
    else {
      const brain = BRAINS[a.type];
      a.thinkT -= dt;
      // Re-plan on a timer, or immediately when the current action is no longer valid.
      if (a.thinkT <= 0 || !brain[a.act] || brain[a.act].s(world, a) <= 0) {
        a.thinkT = 0.25;
        let best = 'roam', bs = 0;
        for (const k of ORDERS[a.type]) { let s = brain[k].s(world, a); if (s > 0 && k === a.act) s += 6; if (s > bs) { bs = s; best = k; } }
        if (best !== a.act) { a.act = best; a.path = null; a.spot = null; a.avoid = null; }
      }
      brain[a.act].r(world, a, dt);
    }
    // Integrate.
    const acc = a.type === 'brute' ? 260 : 700;
    a.vx = approach(a.vx, a.tvx, acc * dt); a.vy = approach(a.vy, a.tvy, acc * dt);
    a.kx *= Math.pow(0.001, dt); a.ky *= Math.pow(0.001, dt);
    if (!a.charge) world.nav.move(a, (a.vx + a.kx) * dt, (a.vy + a.ky) * dt);
    const sp = Math.hypot(a.vx, a.vy);
    a.moving = sp > 6;
    if (a.moving) {
      const turn = a.type === 'brute' ? 2.6 : 11;
      a.facing += clamp(angDiff(a.facing, Math.atan2(a.vy, a.vx)), -turn * dt, turn * dt);
      a.stepT -= sp * dt;
      if (a.stepT <= 0) {
        a.stepT = a.type === 'brute' ? 26 : 34;
        if (a.type === 'brute') { world.emit('thump', { x: a.x, y: a.y }); world.noises.push({ x: a.x, y: a.y, r: 150, kind: 'alien', src: a }); }
        else if (a.type === 'skitterer') world.emit('skitter', { x: a.x, y: a.y });
      }
    }
  }
}

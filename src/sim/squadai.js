// Utility AI for squadmates (and the autopilot leader used in tests / ?autoplay).
import { TILE, dist, angDiff, clamp } from '../core/util.js';
import { WEAPONS, AMMO } from './data.js';
import { active, curDef, curWeapon, countItem, useItem, bestMed, throwItem, giveAmmo, totalAmmo, tier } from './humans.js';

const PREF = { pistol: 95, smg: 82, shotgun: 56, rifle: 125, arc: 90, flamer: 50 };
const RANK = { rifle: 5, shotgun: 4, smg: 3, arc: 4, flamer: 3, pistol: 1 };

function ensureAI(h) {
  if (!h.ai) h.ai = { act: 'lead', why: '', scores: [], thinkT: 0, rank: 1, pressure: 0, nearD: 1e9, order: { type: 'follow' }, slot: 0, path: null, pathT: 0, burstT: 0, pauseT: 0, reactT: 0, tacT: 0, strafe: 1, leader: true };
  return h.ai;
}

function steer(it, h, x, y) {
  const dx = x - h.x, dy = y - h.y, d = Math.hypot(dx, dy) || 1;
  it.mx = dx / d; it.my = dy / d;
}

function doorCostFor(world) {
  return (d) => {
    if (d.broken || d.open > 0.5) return 0;
    if (d.welded) return 40;
    if (d.lock === 'power') return Infinity;
    if (d.lock) return world.keys[d.lock === 'sec' ? 'key_sec' : 'key_cmd'] ? 1 : Infinity;
    return world.power[d.section] ? 1 : 5;
  };
}

export function moveTo(world, h, ai, it, x, y, dt, opts = {}) {
  const d = dist(h.x, h.y, x, y);
  if (d < (opts.stop || 4)) return true;
  it.sprint = !!opts.sprint;
  if (d < 64 && world.nav.walkLine(h.x, h.y, x, y) && world.nav.clearLine(h.x, h.y, x, y, 4.8) && !lineBurns(world, h.x, h.y, x, y)) { steer(it, h, x, y); ai.path = null; return false; }
  if (!ai.path || ai.pathT <= 0 || dist(ai.goalX, ai.goalY, x, y) > 14) {
    const fire = world.fireTiles;
    ai.path = world.nav.findPath(h.x, h.y, x, y, { doorCost: doorCostFor(world), extra: fire.size ? (i) => (fire.has(i) ? 40 : 0) : null });
    ai.pi = 0; ai.goalX = x; ai.goalY = y; ai.pathT = 0.7 + world.rng.next() * 0.5;
    world.perf.paths++;
    if (!ai.path) { ai.noPath = (ai.noPath || 0) + 1; return false; }
    ai.noPath = 0;
  }
  let wp = ai.path[ai.pi];
  while (wp && ai.pi < ai.path.length - 1 && dist(h.x, h.y, wp.x, wp.y) < 5) wp = ai.path[++ai.pi];
  if (!wp) return true;
  if (wp.door) {
    const m = world.map, door = m.doors[m.doorAt[Math.floor(wp.y / TILE) * m.w + Math.floor(wp.x / TILE)] - 1];
    if (door && door.open < 0.5 && !door.lock && !door.broken && dist(h.x, h.y, door.px, door.py) < 21) {
      if (door.welded) { world.holdInteract(h, { key: 'dr' + door.id, kind: 'unweld', time: 2.2, ref: door, x: door.px, y: door.py }, dt); it.sprint = false; return false; }
      if (!world.power[door.section]) { if (!door.want) world.holdInteract(h, { key: 'dr' + door.id, kind: 'door', time: 0.85, ref: door, x: door.px, y: door.py }, dt); it.sprint = false; return false; }
    }
  }
  steer(it, h, wp.x, wp.y);
  return false;
}

function lineBurns(world, x0, y0, x1, y1) {
  const ft = world.fireTiles;
  if (!ft.size) return false;
  const n = Math.ceil(dist(x0, y0, x1, y1) / 8), W = world.map.w;
  for (let i = 1; i <= n; i++) { const u = i / n; if (ft.has(Math.floor((y0 + (y1 - y0) * u) / TILE) * W + Math.floor((x0 + (x1 - x0) * u) / TILE))) return true; }
  return false;
}

function laneClear(world, h, tx, ty) {
  const dx = tx - h.x, dy = ty - h.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  for (const o of world.humans) {
    if (o === h || o.dead || o.downed) continue;
    const rx = o.x - h.x, ry = o.y - h.y, t = rx * ux + ry * uy;
    if (t < 2 || t > len + 12) continue;
    if (Math.abs(rx * uy - ry * ux) < 7 + t * (0.1 + (h.weapons ? curDef(h).spread * 0.6 : 0.05))) return false;
  }
  return true;
}

function inHazard(world, h) {
  for (const f of world.fires) if (Math.abs(f.x - h.x) < 13 && Math.abs(f.y - h.y) < 13) return f;
  for (const p of world.pools) if (dist(p.x, p.y, h.x, h.y) < p.r + 4) return p;
  for (const a of world.arcs) if (world.power[a.section] && (world.time + a.ph) % 4.2 > 2.6 && dist(a.x, a.y, h.x, h.y) < 19) return a;
  return null;
}

function aimAt(h, it, ang, dt, rate) {
  it.aim = h.aim + clamp(angDiff(h.aim, ang), -rate * dt, rate * dt);
}

// Sample nearby directions and move to the one that best satisfies score().
function fleeDir(world, h, score) {
  let best = null, bs = -1e9;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4, x = h.x + Math.cos(a) * 26, y = h.y + Math.sin(a) * 26;
    if (!world.nav.boxFree(x, y, 4.5) || !world.nav.walkLine(h.x, h.y, x, y)) continue;
    const s = score(x, y);
    if (s > bs) { bs = s; best = { x, y }; }
  }
  return best;
}

function threatsNear(world, h, range) {
  const out = [];
  for (const [, m] of world.memory) if (!m.a.dead && !m.a.def.static && world.time - m.t < 3 && dist(h.x, h.y, m.a.x, m.a.y) < range) out.push(m.a);
  return out;
}

function sense(world, h, ai) {
  const def = curDef(h);
  let best = null, bs = -1e9, others = 0;
  if (ai.focus && (ai.focus.dead || (ai.focusT -= 0.2) <= 0)) ai.focus = null;
  for (const a of world.aliens) {
    if (a.dead || a.inVent > 0 || a.sleeping) continue;
    if (!world.canSee(h, a)) continue;
    const d = dist(h.x, h.y, a.x, a.y);
    if (a.type !== 'nest') others++;
    let s = 100 - d * 0.3 + (a.target === h ? 18 : 0) + (a.type === 'shrieker' ? 28 : 0) + (a === ai.target ? 12 : 0) + (a.hp < a.maxHp * 0.3 ? 8 : 0) + (a === ai.focus ? 70 : 0);
    if (a.type === 'nest') s -= 45;
    if (d > def.range * 1.25 + 30) s -= 40;
    if (s > bs) { bs = s; best = a; }
  }
  if (best && best.type === 'nest' && (others > 0 || (totalAmmo(h) < def.mag * 2 && !def.flame))) best = ai.focus === best ? best : null;
  if (best && best !== ai.target) ai.reactT = 0.16 + (h.stress / 100) * 0.5 + (1 - h.char.bravery) * 0.14;
  ai.target = best;
  let p = 0, nd = 1e9, cx = 0, cy = 0, n = 0;
  for (const a of threatsNear(world, h, 110)) {
    const d = dist(h.x, h.y, a.x, a.y);
    p += a.def.threat * (d < 50 ? 1.4 : 1);
    if (d < nd) nd = d;
    cx += a.x; cy += a.y; n++;
  }
  ai.pressure = p; ai.nearD = nd;
  ai.tcx = n ? cx / n : h.x; ai.tcy = n ? cy / n : h.y;
  ai.alert = world.memory.size > 0 && [...world.memory.values()].some((m) => dist(m.x, m.y, h.x, h.y) < 260);
  let allies = 0;
  for (const o of world.humans) if (o !== h && active(o) && dist(o.x, o.y, h.x, h.y) < 90) allies++;
  ai.allies = allies;
  const mates = world.humans.filter((o) => !o.isPlayer && active(o));
  ai.rank = Math.max(0, mates.indexOf(h)) + 1;
  // Weapon choice.
  if (h.weapons.length > 1 && !h.reloading) {
    let bi = h.cur, bv = -1e9;
    h.weapons.forEach((w, i) => {
      const wd = WEAPONS[w.id], has = w.mag + h.ammo[wd.ammo];
      let v = has > 0 ? RANK[w.id] : -100;
      if (w.mag === 0 && nd < 60) v -= 3;
      if (i === h.cur) v += 0.5;
      if (v > bv) { bv = v; bi = i; }
    });
    if (bi !== h.cur) { h.cur = bi; h.fireCd = Math.max(h.fireCd, 0.3); }
  }
}

function capacity(h, ai) {
  return 1.3 + h.char.bravery * 1.9 + h.hp / 100 + ai.allies * 0.7 - (h.stress >= 60 ? 0.7 : 0) - (totalAmmo(h) === 0 ? 2 : 0);
}

function findDowned(world, h) {
  let best = null, bd = 1e9;
  for (const o of world.humans) {
    if (o === h || !o.downed || o.dead || inHazard(world, o)) continue;
    const d = dist(h.x, h.y, o.x, o.y);
    let claimed = false;
    for (const m of world.humans) if (m !== h && active(m) && m.ai && m.ai.act === 'revive' && m.ai.reviveT === o && dist(m.x, m.y, o.x, o.y) < d) claimed = true;
    if (!claimed && d < bd) { bd = d; best = o; }
  }
  return best;
}

function findPatient(world, h) {
  let best = null, bs = 0;
  for (const o of world.humans) {
    if (o === h || !active(o)) continue;
    const need = o.hp < 45 || o.bleed >= 2 || (h.char.medic && (o.hp < 62 || o.bleed > 0 || o.leg || o.arm));
    if (!need || o.busyT > 0) continue;
    if (!h.char.medic && bestMed(o)) continue;
    if (!bestMed(h, o)) continue;
    const s = 100 - o.hp + o.bleed * 15 - dist(h.x, h.y, o.x, o.y) * 0.1;
    if (s > bs) { bs = s; best = o; }
  }
  return best;
}

function wants(world, h, p) {
  if (p.cool > 0) return false;
  if (p.item.startsWith('a:')) {
    const t = p.item.slice(2);
    for (const w of h.weapons) if (WEAPONS[w.id].ammo === t && h.ammo[t] < Math.min(AMMO[t].cap, WEAPONS[w.id].mag * (h.ai.leader ? 5 : 3))) return true;
    return false;
  }
  if (p.item.startsWith('w:')) {
    const id = p.item.slice(2);
    if (h.weapons.some((w) => w.id === id)) return false;
    const worst = Math.min(...h.weapons.map((w) => RANK[w.id]));
    if (h.ai.leader) return h.weapons.length < 2 || RANK[id] > worst;
    return p.age > 6 && h.weapons.length < 2 && h.char.prefs.includes(id);
  }
  if (p.item === 'bandage' || p.item === 'medkit') return countItem(h, p.item) < (h.char.medic || h.ai.leader ? 2 : 1) && h.belt.length < h.beltSize;
  if (h.ai.leader) return p.item === 'armor' ? h.armor < 45 : p.item === 'tracker' ? !world.tracker : h.belt.length < h.beltSize - 1 || !!world.keys[p.item] === false && p.item.startsWith('key');
  return false;
}

function findLoot(world, h) {
  let best = null, bd = h.ai.leader ? 150 : 110;
  for (const p of world.pickups) {
    const d = dist(h.x, h.y, p.x, p.y);
    if (d >= bd || !wants(world, h, p)) continue;
    if (!h.ai.leader && dist(world.player.x, world.player.y, p.x, p.y) < 30 && p.age < 5) continue;
    if (!world.nav.los(h.x, h.y, p.x, p.y) && d > 40) continue;
    bd = d; best = p;
  }
  return best;
}

function findShare(world, h) {
  for (const o of world.humans) {
    if (o === h || !active(o) || dist(o.x, o.y, h.x, h.y) > 170) continue;
    const od = curDef(o), t = od.ammo;
    if (o.ammo[t] + curWeapon(o).mag >= od.mag * 0.6) continue;
    const mine = h.weapons.some((w) => WEAPONS[w.id].ammo === t);
    const spare = mine ? h.ammo[t] - curDef(h).mag * 2 : h.ammo[t];
    if (spare >= 6) return { to: o, type: t, n: Math.ceil(spare * (mine ? 0.5 : 1)) };
  }
  return null;
}

function pickTactical(world, h, ai, a) {
  const pref = PREF[curWeapon(h).id] || 90, p = world.player, m = world.map;
  let best = null, bs = -1e9;
  for (let k = 0; k < 17; k++) {
    let x = h.x, y = h.y;
    if (k > 0) { const ang = ((k - 1) % 8) * 0.7854, r = k > 8 ? 42 : 21; x += Math.cos(ang) * r; y += Math.sin(ang) * r; }
    if (k > 0 && (!world.nav.boxFree(x, y, 4.6) || !world.nav.walkLine(h.x, h.y, x, y))) continue;
    const d = dist(x, y, a.x, a.y);
    let s = -Math.abs(d - pref) * 0.16;
    if (!world.nav.los(x, y - 2, a.x, a.y)) s -= 28;
    for (const o of world.aliens) {
      if (o.dead || o.inVent > 0 || o.def.static) continue;
      const od = dist(x, y, o.x, o.y);
      if (od < pref * 0.55) s -= (pref * 0.55 - od) * (o.type === 'brute' ? 0.7 : 0.35);
    }
    if (!laneClear(world, { x, y, r: 4 }, a.x, a.y)) s -= 14;
    for (const o of world.humans) if (o !== h && active(o)) { const od = dist(x, y, o.x, o.y); if (od < 15) s -= 9; }
    const dp = dist(x, y, p.x, p.y);
    if (dp > 130) s -= (dp - 130) * 0.3;
    const ti = Math.floor(y / TILE) * m.w + Math.floor(x / TILE);
    if (m.choke[ti]) s -= 9;
    if (world.fireTiles.has(ti)) s -= 60;
    for (const q of world.pools) if (dist(q.x, q.y, x, y) < q.r + 5) s -= 50;
    const ux = (a.x - x) / (d || 1), uy = (a.y - y) / (d || 1);
    const ci = Math.floor((y + uy * 13) / TILE) * m.w + Math.floor((x + ux * 13) / TILE);
    if (m.block[ci] && !m.opaque[ci]) s += 7;
    if (ai.order.type === 'hold') { const dh = dist(x, y, ai.order.x, ai.order.y); if (dh > 34) s -= (dh - 34) * 0.5; }
    s -= dist(x, y, h.x, h.y) * 0.07;
    if (k === 0) s += 3;
    if (s > bs) { bs = s; best = { x, y }; }
  }
  return best;
}

function pickGuard(world, h, ai, p) {
  const m = world.map, base = p.aim + Math.PI + ai.rank * 2.1;
  for (let k = 0; k < 16; k++) {
    const ang = base + (k >> 1) * 0.7 * (k & 1 ? 1 : -1), r = [32, 24, 42][k % 3];
    const x = p.x + Math.cos(ang) * r, y = p.y + Math.sin(ang) * r;
    if (!world.nav.boxFree(x, y, 4.6) || !world.nav.walkLine(p.x, p.y, x, y)) continue;
    if (m.choke[Math.floor(y / TILE) * m.w + Math.floor(x / TILE)]) continue;
    let clash = false;
    for (const o of world.humans) if (o !== h && o.ai && o.ai.guard && dist(o.ai.guard.x, o.ai.guard.y, x, y) < 15) clash = true;
    if (clash || inHazard(world, { x, y })) continue;
    return { x, y, px: p.x, py: p.y, out: ang };
  }
  return { x: h.x, y: h.y, px: p.x, py: p.y, out: h.aim };
}

function fightingAim(world, h, ai, it, dt) {
  // Aim and shoot at ai.target if possible. Returns true when a shot lane exists.
  const a = ai.target;
  if (!a || a.dead) return false;
  const d = dist(h.x, h.y, a.x, a.y), def = curDef(h);
  const lead = d / 700;
  const ang = Math.atan2(a.y + (a.vy || 0) * lead - h.y, a.x + (a.vx || 0) * lead - h.x);
  aimAt(h, it, ang, dt, 7 + h.char.aim * 6);
  const lane = laneClear(world, h, a.x, a.y);
  const aligned = Math.abs(angDiff(it.aim, ang)) < 0.06 + (a.r + 2) / Math.max(10, d);
  if (ai.reactT > 0 || !aligned || !lane || d > def.range * 1.15) return lane;
  if (a.type === 'nest' && !def.flame && h.fireCd <= 0 && world.rng.chance(0.5)) return lane;
  if (def.auto) {
    if (ai.pauseT > 0 && h.panicT <= 0) ai.pauseT -= dt;
    else { it.fire = true; ai.burstT += dt; if (ai.burstT > 0.3 + 0.45 * h.char.aim) { ai.burstT = 0; ai.pauseT = def.flame ? 0.05 : 0.12 + d / 550; } }
  } else {
    ai.semiT = (ai.semiT || 0) - dt;
    if (h.fireCd <= 0 && ai.semiT <= 0) { it.fire = true; ai.semiT = def.rate + 0.04 + world.rng.next() * 0.14 * (2 - h.char.aim); }
  }
  return lane;
}

const ACTIONS = {
  hazard: {
    score: (w, h, ai) => (inHazard(w, h) ? 92 : 0),
    run(w, h, ai, it, dt) {
      const hz = inHazard(w, h) || ai.lastHz;
      ai.lastHz = hz;
      if (!hz) return;
      // Leave the hazard, preferring the side we were already heading for.
      const gx = ai.goalX, gy = ai.goalY, hasGoal = gx !== undefined && ai.act0 !== 'hazard';
      const d = fleeDir(w, h, (x, y) => dist(x, y, hz.x, hz.y) * 0.6 - (inHazard(w, { x, y }) ? 40 : 0) - (hasGoal ? dist(x, y, gx, gy) * 0.8 : 0));
      if (d) steer(it, h, d.x, d.y);
      it.sprint = true;
      ai.why = 'in hazard';
    },
  },
  panic: {
    score: (w, h, ai) => (h.panicT > 0 && !ai.leader ? 100 : 0),
    run(w, h, ai, it, dt) {
      const mode = h.char.panic;
      ai.why = 'panic:' + mode;
      if (mode === 'freeze') {
        it.aim = h.aim + Math.sin(w.time * 9 + h.id) * 0.04;
        if (ai.target && dist(h.x, h.y, ai.target.x, ai.target.y) < 46) { ai.reactT = 0; fightingAim(w, h, ai, it, dt); }
        return;
      }
      if (mode === 'spray') {
        ai.reactT = 0; ai.pauseT = 0;
        if (ai.target) { fightingAim(w, h, ai, it, dt); const d = fleeDir(w, h, (x, y) => dist(x, y, ai.target.x, ai.target.y)); if (d && dist(h.x, h.y, ai.target.x, ai.target.y) < 70) steer(it, h, d.x, d.y); }
        return;
      }
      const p = w.player;
      if (dist(h.x, h.y, p.x, p.y) > 46 && active(p)) moveTo(w, h, ai, it, p.x, p.y, dt, { sprint: true, stop: 30 });
      else { const d = fleeDir(w, h, (x, y) => dist(x, y, ai.tcx, ai.tcy) - dist(x, y, p.x, p.y) * 0.5); if (d && ai.pressure > 0) { steer(it, h, d.x, d.y); it.sprint = true; } }
    },
  },
  revive: {
    score(w, h, ai) {
      const o = findDowned(w, h);
      ai.reviveC = o;
      if (!o) return 0;
      return 86 - dist(h.x, h.y, o.x, o.y) * 0.07 - (ai.nearD < 40 ? 22 : 0) + (h.char.medic ? 10 : 0);
    },
    run(w, h, ai, it, dt) {
      const o = ai.reviveT = ai.reviveC;
      if (!o) return;
      ai.why = 'revive ' + o.name;
      if (moveTo(w, h, ai, it, o.x, o.y, dt, { sprint: true, stop: 15 })) {
        w.say(h, 'reviving', false, o.name);
        w.holdInteract(h, { key: 'rev' + o.id, kind: 'revive', time: h.char.medic ? 1.8 : 3, ref: o, x: o.x, y: o.y }, dt);
        if (ai.target) fightingAim(w, h, ai, it, dt), (it.fire = false);
      }
    },
  },
  heal: {
    score(w, h, ai) {
      if (h.busyT > 0 && (!h.busyTarget || h.busyTarget === h)) return 72;
      const med = bestMed(h);
      const stim = !med && h.stress > 72 && countItem(h, 'stim') > 0;
      ai.med = med || (stim ? 'stim' : null);
      if (!ai.med) return 0;
      if (stim) return ai.nearD < 60 ? 0 : 50;
      if (!(h.bleed > 0 || h.hp < 55)) return 0;
      return 56 + h.bleed * 8 + (55 - h.hp) * 0.4 - (ai.nearD < 48 ? 30 : 0);
    },
    run(w, h, ai, it, dt) {
      ai.why = 'treating self';
      if (h.busyT <= 0 && ai.med && useItem(w, h, ai.med)) w.say(h, 'healing');
      if (ai.pressure > 0) { const d = fleeDir(w, h, (x, y) => dist(x, y, ai.tcx, ai.tcy)); if (d && ai.nearD < 80) steer(it, h, d.x, d.y); }
    },
  },
  healAlly: {
    score(w, h, ai) {
      if (h.busyT > 0 && h.busyTarget && h.busyTarget !== h) return 74;
      const o = findPatient(w, h);
      ai.patient = o;
      if (!o) return 0;
      return (h.char.medic ? 70 : 52) - dist(h.x, h.y, o.x, o.y) * 0.05 - (ai.nearD < 45 ? 22 : 0);
    },
    run(w, h, ai, it, dt) {
      const o = h.busyTarget || ai.patient;
      if (!o) return;
      ai.why = 'treating ' + o.name;
      if (moveTo(w, h, ai, it, o.x, o.y, dt, { stop: 17, sprint: dist(h.x, h.y, o.x, o.y) > 70 }) && h.busyT <= 0) {
        const med = bestMed(h, o);
        if (med && useItem(w, h, med, o)) w.say(h, 'healally', false, o.isPlayer ? null : o.name);
      }
    },
  },
  reload: {
    score(w, h, ai) {
      const wp = curWeapon(h), def = curDef(h);
      if (h.reloading) return ai.target ? 60 : 44;
      if (h.ammo[def.ammo] <= 0 || h.busyT > 0) return 0;
      if (wp.mag === 0) return 74;
      if (wp.mag < def.mag * 0.35 && !ai.target && ai.pressure === 0) return 42;
      return 0;
    },
    run(w, h, ai, it, dt) {
      ai.why = 'reloading';
      it.reload = true;
      const p = w.player;
      if (ai.nearD < 85) {
        const d = fleeDir(w, h, (x, y) => dist(x, y, ai.tcx, ai.tcy) * 1.2 - dist(x, y, p.x, p.y) * 0.4);
        if (d) steer(it, h, d.x, d.y);
      }
      if (ai.target) { const a = ai.target; aimAt(h, it, Math.atan2(a.y - h.y, a.x - h.x), dt, 8); if (curDef(h).shellReload && curWeapon(h).mag > 0 && dist(h.x, h.y, a.x, a.y) < 50) fightingAim(w, h, ai, it, dt); }
    },
  },
  retreat: {
    score(w, h, ai) {
      if (ai.leader || ai.pressure <= 0) return 0;
      const cap = capacity(h, ai);
      if (ai.pressure > cap || (h.hp < 30 && ai.nearD < 70 && h.char.bravery < 0.85) || (totalAmmo(h) === 0 && ai.nearD < 100)) return 66 + (h.hp < 35 ? 8 : 0);
      return 0;
    },
    run(w, h, ai, it, dt) {
      ai.why = 'overwhelmed ' + ai.pressure.toFixed(1) + '>' + capacity(h, ai).toFixed(1);
      w.say(h, 'fallback');
      const p = w.player;
      const d = fleeDir(w, h, (x, y) => dist(x, y, ai.tcx, ai.tcy) * 1.3 - dist(x, y, p.x, p.y) * 0.6);
      if (dist(h.x, h.y, p.x, p.y) > 90 && active(p)) moveTo(w, h, ai, it, p.x, p.y, dt, { stop: 26, sprint: ai.nearD < 40 });
      else if (d) steer(it, h, d.x, d.y);
      fightingAim(w, h, ai, it, dt);
      if (it.fire) it.sprint = false;
    },
  },
  engage: {
    score(w, h, ai) {
      if (!ai.target) return 0;
      if (totalAmmo(h) === 0) return ai.target.type === 'nest' || (ai.target.type === 'skitterer' && ai.nearD < 40) ? 50 : 0;
      return 55 + (ai.target.target === h ? 6 : 0);
    },
    run(w, h, ai, it, dt) {
      const a = ai.target;
      if (!a) return;
      ai.why = 'target ' + a.type + (ai.reactT > 0 ? ' (reacting)' : '');
      const d = dist(h.x, h.y, a.x, a.y), ang = Math.atan2(a.y - h.y, a.x - h.x);
      if (totalAmmo(h) === 0) { ai.why = 'no ammo: melee'; aimAt(h, it, ang, dt, 12); if (d > 15 + a.r) moveTo(w, h, ai, it, a.x, a.y, dt, { stop: 12 + a.r }); else it.melee = true; return; }
      if (d < 20 + a.r && (curWeapon(h).mag === 0 || h.reloading)) it.melee = true;
      const lane = fightingAim(w, h, ai, it, dt);
      if (!lane) {
        const x = h.x - Math.sin(ang) * ai.strafe * 14, y = h.y + Math.cos(ang) * ai.strafe * 14;
        if (!w.nav.boxFree(x, y, 4.6)) ai.strafe = -ai.strafe;
        it.mx = -Math.sin(ang) * ai.strafe; it.my = Math.cos(ang) * ai.strafe;
        ai.why += ' lane blocked';
        return;
      }
      if (ai.tacT <= 0) { ai.tacT = 0.45; ai.tac = pickTactical(w, h, ai, a); }
      if (ai.tac && dist(h.x, h.y, ai.tac.x, ai.tac.y) > 5) steer(it, h, ai.tac.x, ai.tac.y);
      if (d > curDef(h).range && !w.nav.los(h.x, h.y, a.x, a.y)) moveTo(w, h, ai, it, a.x, a.y, dt, { stop: 40 });
      // Grenades at clusters and heavies.
      ai.nadeCd = (ai.nadeCd || 0) - dt;
      if (ai.nadeCd <= 0 && d > 70 && d < 150 && countItem(h, 'grenade')) {
        let n = 0, safe = true;
        for (const o of w.aliens) if (!o.dead && o.inVent <= 0 && dist(o.x, o.y, a.x, a.y) < 46) n += o.def.threat;
        for (const o of w.humans) if (!o.dead && dist(o.x, o.y, a.x, a.y) < 78) safe = false;
        if (safe && n >= 2.4) { throwItem(w, h, 'grenade', a.x, a.y); ai.nadeCd = 9; }
      }
    },
  },
  task: {
    score(w, h, ai) {
      if (!ai.task) return 0;
      if (!w.mission || !w.mission.taskValid(w, ai.task)) { ai.task = null; return 0; }
      return ai.nearD < 60 ? (h.char.engineer ? 40 : 22) : 60;
    },
    run(w, h, ai, it, dt) {
      if (!ai.task) { ai.thinkT = 0; return; }
      const p = ai.task.prop;
      ai.why = 'working console';
      if (moveTo(w, h, ai, it, p.px, p.py, dt, { stop: 15 }) || dist(h.x, h.y, p.px, p.py) < 17) {
        it.mx = it.my = 0;
        const act = w.mission.consoleAction(w, p, h);
        if (act && !act.disabled) w.holdInteract(h, { key: 'pr' + p.id, kind: 'objective', time: act.time, ref: p, obj: act.obj, x: p.px, y: p.py }, dt, h.char.engineer ? 1.5 : 1);
        else if (!act) ai.task = null;
        aimAt(h, it, Math.atan2(p.py - h.y, p.px - h.x), dt, 8);
      }
    },
  },
  share: {
    score(w, h, ai) {
      if ((ai.shareCd || 0) > w.time || ai.pressure > 0.6) return 0;
      ai.shareC = findShare(w, h);
      return ai.shareC ? 46 : 0;
    },
    run(w, h, ai, it, dt) {
      const s = ai.shareC;
      if (!s) return;
      ai.why = 'sharing ammo';
      if (moveTo(w, h, ai, it, s.to.x, s.to.y, dt, { stop: 18 })) {
        if (giveAmmo(w, h, s.type, s.to, s.n) > 0) { w.say(h, 'share', true); if (s.to.isPlayer) w.msg(h.name + ' GAVE YOU ' + AMMO[s.type].name, 'loot'); }
        ai.shareCd = w.time + 18; ai.shareC = null;
      }
    },
  },
  loot: {
    score(w, h, ai) {
      if (ai.pressure > 0 || ai.target) return 0;
      ai.lootC = findLoot(w, h);
      return ai.lootC ? (ai.leader ? 38 : 34) : 0;
    },
    run(w, h, ai, it, dt) {
      const p = ai.lootC;
      if (!p || p.n <= 0) return;
      ai.why = 'grabbing ' + p.item;
      if (moveTo(w, h, ai, it, p.x, p.y, dt, { stop: 9 })) { if (!w.tryPickup(h, p)) p.cool = 4; ai.lootC = null; ai.thinkT = 0; }
    },
  },
  clearway: {
    score(w, h, ai) {
      if (ai.leader || ai.target) return 0;
      const m = w.map, p = w.player;
      const onChoke = m.choke[Math.floor(h.y / TILE) * m.w + Math.floor(h.x / TILE)];
      if (!onChoke) return 0;
      const d = dist(h.x, h.y, p.x, p.y);
      return d < 44 && (!p.moving || Math.abs(angDiff(Math.atan2(p.vy, p.vx), Math.atan2(h.y - p.y, h.x - p.x))) < 1) ? 41 : 0;
    },
    run(w, h, ai, it, dt) {
      ai.why = 'clearing doorway';
      const m = w.map, p = w.player;
      const d = fleeDir(w, h, (x, y) => (m.choke[Math.floor(y / TILE) * m.w + Math.floor(x / TILE)] ? -30 : 0) + dist(x, y, p.x, p.y) * 0.3 - Math.abs(dist(x, y, p.x, p.y) - 34));
      if (d) steer(it, h, d.x, d.y);
    },
  },
  regroup: {
    score(w, h, ai) {
      if (ai.leader || ai.order.type !== 'follow') return 0;
      const p = w.player, d = dist(h.x, h.y, p.x, p.y);
      return d > 210 || (d > 150 && !w.nav.los(h.x, h.y, p.x, p.y)) ? 50 : 0;
    },
    run(w, h, ai, it, dt) {
      ai.why = 'too far from leader';
      moveTo(w, h, ai, it, w.player.x, w.player.y, dt, { stop: 40, sprint: true });
    },
  },
  hold: {
    score(w, h, ai) {
      if (ai.order.type !== 'hold') return 0;
      if (h.stress >= 75 && h.char.bravery < 0.6 && dist(h.x, h.y, w.player.x, w.player.y) > 120) { ai.order = { type: 'follow' }; w.say(h, 'refuse', true); return 0; }
      return 30;
    },
    run(w, h, ai, it, dt) {
      ai.why = 'holding position';
      moveTo(w, h, ai, it, ai.order.x, ai.order.y, dt, { stop: 6 });
      scan(w, h, ai, it, dt, h.aim);
    },
  },
  investigate: {
    score(w, h, ai) {
      if (ai.leader || ai.order.type !== 'follow' || ai.alert || h.char.bravery < 0.65 || h.stress > 55) return 0;
      if (ai.inv && ai.inv.t > w.time) return 28;
      if ((ai.invCd || 0) > w.time) return 0;
      for (const n of w.heard) if (n.kind === 'alien' && dist(n.x, n.y, h.x, h.y) < Math.min(170, n.r) && dist(n.x, n.y, w.player.x, w.player.y) < 190) { ai.inv = { x: n.x, y: n.y, t: w.time + 4 }; ai.invCd = w.time + 25; w.say(h, n.vent ? 'vent' : 'noise'); return 28; }
      return 0;
    },
    run(w, h, ai, it, dt) {
      const p = w.player, q = ai.inv;
      if (!q) return;
      ai.why = 'checking a noise';
      // Step toward it, but never far from the leader.
      const ang = Math.atan2(q.y - p.y, q.x - p.x), tx = p.x + Math.cos(ang) * 48, ty = p.y + Math.sin(ang) * 48;
      if (w.nav.boxFree(tx, ty, 4.6) && w.nav.walkLine(p.x, p.y, tx, ty)) moveTo(w, h, ai, it, tx, ty, dt, { stop: 6 });
      aimAt(h, it, Math.atan2(q.y - h.y, q.x - h.x), dt, 5);
    },
  },
  follow: {
    score: (w, h, ai) => (ai.leader ? 0 : 20),
    run(w, h, ai, it, dt) {
      const p = w.player, dP = dist(h.x, h.y, p.x, p.y);
      ai.stopT = p.moving ? 0 : (ai.stopT || 0) + dt;
      if (ai.stopT > 0.9 && dP < 120) {
        if (!ai.guard || dist(ai.guard.px, ai.guard.py, p.x, p.y) > 46 || inHazard(w, ai.guard)) ai.guard = pickGuard(w, h, ai, p);
        ai.why = 'guarding';
        moveTo(w, h, ai, it, ai.guard.x, ai.guard.y, dt, { stop: 5 });
        scan(w, h, ai, it, dt, ai.guard.out);
      } else {
        ai.guard = null;
        const tr = w.trail, idx = tr.length - 1 - ai.rank * 2;
        const t = dP > 140 || idx < 0 ? p : tr[idx];
        ai.why = 'following';
        if (dist(h.x, h.y, t.x, t.y) > 7 && dP > 15) moveTo(w, h, ai, it, t.x, t.y, dt, { stop: 5, sprint: dP > 85 || p.sprint });
        it.sneak = p.sneak;
        if (it.mx || it.my) aimAt(h, it, Math.atan2(it.my, it.mx), dt, 6); else scan(w, h, ai, it, dt, h.aim);
      }
      chatter(w, h, ai, dt);
    },
  },
  lead: {
    score: (w, h, ai) => (ai.leader ? 25 : 0),
    run(w, h, ai, it, dt) {
      const g = w.mission ? w.mission.botGoal(w, h) : null;
      if (!g) { ai.why = 'no goal'; return; }
      ai.why = 'goal ' + g.kind;
      // Out of ammunition: go and find some before pressing on.
      if (totalAmmo(h) < curDef(h).mag && ai.pressure === 0 && !g.urgent) {
        let best = null, bd = 1e9;
        for (const p of w.map.props) { if (p.interact !== 'container' || p.searched || p.botSkip) continue; const d = dist(p.px, p.py, h.x, h.y); if (d < bd) { bd = d; best = p; } }
        if (best) {
          ai.why = 'scavenging for ammo';
          best.botT = (best.botT || 0) + dt;
          if (best.botT > 40) best.botSkip = true;
          if (moveTo(w, h, ai, it, best.px, best.py, dt, { stop: 14 }) || dist(h.x, h.y, best.px, best.py) < 17) { const t = w.findInteract(h, false); if (t && t.kind === 'container') { it.mx = it.my = 0; w.holdInteract(h, t, dt); } else best.botSkip = true; }
          if (ai.noPath > 2) best.botSkip = true;
          return;
        }
      }
      // Search containers along the way when it is quiet.
      if (ai.pressure === 0 && !ai.alert && (ai.searchCd || 0) < w.time) {
        for (const p of w.map.props) {
          if (p.interact !== 'container' || p.searched || p.botSkip || p.room !== h.room || Math.abs(p.px - h.x) > 110 || Math.abs(p.py - h.y) > 110) continue;
          if (g.urgent) break;
          p.botT = (p.botT || 0) + dt;
          if (p.botT > 7) { p.botSkip = true; continue; }
          if (moveTo(w, h, ai, it, p.px, p.py, dt, { stop: 14 }) || dist(h.x, h.y, p.px, p.py) < 17) {
            const t = w.findInteract(h, false);
            if (t && t.kind === 'container') { it.mx = it.my = 0; w.holdInteract(h, t, dt); }
          }
          ai.why = 'searching ' + p.label;
          return;
        }
      }
      // Do not outrun the squad.
      let far = 0;
      for (const o of w.humans) if (o !== h && active(o) && dist(o.x, o.y, h.x, h.y) > 130) far++;
      if (far && !g.urgent && (ai.waitT = (ai.waitT || 0) + dt) < 6) { ai.why = 'waiting for squad'; scan(w, h, ai, it, dt, h.aim); return; }
      if (!far) ai.waitT = 0;
      const arrived = moveTo(w, h, ai, it, g.x, g.y, dt, { stop: g.stop || 12, sprint: g.urgent && ai.pressure === 0 });
      if (ai.noPath > 4 && g.o) { g.o.botSkipT = w.time + 20; ai.noPath = 0; }
      if (it.mx || it.my) aimAt(h, it, Math.atan2(it.my, it.mx), dt, 7);
      if (g.kind === 'console' && dist(h.x, h.y, g.x, g.y) < 18) {
        const act = w.mission.consoleAction(w, g.prop, h);
        if (act && !act.disabled) { it.mx = it.my = 0; w.holdInteract(h, { key: 'pr' + g.prop.id, kind: 'objective', time: act.time, ref: g.prop, obj: act.obj, x: g.x, y: g.y }, dt); }
      } else if (arrived && g.kind === 'search') {
        const t = w.findInteract(h, false);
        if (t && !t.disabled && (t.kind === 'container' || t.kind === 'pickup')) w.holdInteract(h, t, dt);
      }
    },
  },
};
const ORDER = Object.keys(ACTIONS);

function scan(w, h, ai, it, dt, base) {
  // Look toward recent disturbances, otherwise sweep.
  for (const n of w.heard) if (n.kind === 'alien' && dist(n.x, n.y, h.x, h.y) < n.r) { ai.lookAt = { x: n.x, y: n.y, t: w.time + 2.5 }; if (!ai.alert) w.say(h, n.vent ? 'vent' : 'noise'); }
  if (ai.lookAt && ai.lookAt.t > w.time) aimAt(h, it, Math.atan2(ai.lookAt.y - h.y, ai.lookAt.x - h.x), dt, 5);
  else { ai.scanBase = ai.scanBase === undefined || ai.guard ? base : ai.scanBase; aimAt(h, it, ai.scanBase + Math.sin(w.time * 0.7 + h.id) * 0.9, dt, 2.2); }
}

function chatter(w, h, ai, dt) {
  if (h.char.scout && (ai.senseCd || 0) < w.time) {
    ai.senseCd = w.time + 7;
    for (const a of w.aliens) { if (a.dead || a.inVent > 0 || a.def.static || a.sleeping || w.memory.has(a.id)) continue; const d = dist(a.x, a.y, h.x, h.y); if (d < 150) { w.say(h, 'noise'); w.emit('sense', { x: a.x + w.rng.range(-14, 14), y: a.y + w.rng.range(-14, 14) }); break; } }
  }
  if (ai.alert || ai.pressure > 0) { ai.quietT = 0; ai.wasAlert = true; return; }
  ai.quietT = (ai.quietT || 0) + dt;
  if (ai.wasAlert && ai.quietT > 5) { ai.wasAlert = false; w.say(h, 'clear'); }
  if (ai.quietT > 22 && w.rng.chance(dt * 0.05)) {
    const r = w.roomAt(h.x, h.y);
    w.say(h, r && r.scene === 'nest' ? 'idle_nest' : r && r.scene ? 'idle_blood' : w.light.at(h.x, h.y) < 0.08 ? 'dark' : 'idle');
  }
  if (h.stress > 55 && w.light.at(h.x, h.y) < 0.08 && countItem(h, 'flare') && (ai.flareCd || 0) < w.time) { throwItem(w, h, 'flare', h.x + Math.cos(h.aim) * 30, h.y + Math.sin(h.aim) * 30); ai.flareCd = w.time + 45; }
  if (totalAmmo(h) < curDef(h).mag) w.say(h, totalAmmo(h) === 0 ? 'empty' : 'lowammo');
}

export function squadThink(world, h, dt) {
  const ai = ensureAI(h);
  const it = { mx: 0, my: 0, aim: h.aim, fire: false };
  if (!active(h)) return it;
  ai.thinkT -= dt; ai.reactT -= dt; ai.pathT -= dt; ai.tacT -= dt;
  if (ai.thinkT <= 0) {
    ai.thinkT = 0.2;
    sense(world, h, ai);
    let best = null, bs = 0;
    const scores = [];
    for (const k of ORDER) {
      let s = ACTIONS[k].score(world, h, ai);
      if (s > 0 && k === ai.act) s += 6;
      if (s > 0) scores.push([k, Math.round(s)]);
      if (s > bs) { bs = s; best = k; }
    }
    if (best && best !== ai.act) { ai.act = best; ai.path = null; ai.pathT = 0; h.useT = 0; h.useKey = null; }
    ai.scores = scores;
  }
  ACTIONS[ai.act].run(world, h, ai, it, dt);
  // Unstick.
  const want = it.mx !== 0 || it.my !== 0;
  if (want && h.stunT <= 0 && h.busyT <= 0 && dist(h.x, h.y, ai.lx || 0, ai.ly || 0) < 0.12) ai.stuck = (ai.stuck || 0) + dt; else ai.stuck = Math.max(0, (ai.stuck || 0) - dt * 2);
  ai.lx = h.x; ai.ly = h.y;
  if (ai.stuck > 0.5) { ai.path = null; ai.pathT = 0; ai.nudge = world.rng.range(0, 6.28); ai.nudgeT = 0.3; ai.stuck = 0; ai.guard = null; world.perf.stucks = (world.perf.stucks || 0) + 1; }
  if (ai.nudgeT > 0) { ai.nudgeT -= dt; it.mx = Math.cos(ai.nudge); it.my = Math.sin(ai.nudge); }
  if (it.fire) it.sprint = false;
  return it;
}

export { tier };

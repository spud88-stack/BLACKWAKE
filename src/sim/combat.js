// Damage, hitscan, explosions, fire. Shared by humans and aliens.
import { dist, angDiff, clamp } from '../core/util.js';

export function addStress(h, amt, why) {
  if (h.dead) return;
  if (amt > 0) amt *= (h.stimT > 0 ? 0.4 : 1) / h.char.resilience;
  h.stress = clamp(h.stress + amt, h.trauma, 100);
  if (why && amt > 3) { h.spike = why; h.spikeT = 2.5; }
}

export function witnesses(world, x, y, range) {
  const out = [];
  for (const h of world.humans) if (!h.dead && dist(h.x, h.y, x, y) < range && world.nav.los(h.x, h.y, x, y)) out.push(h);
  return out;
}

export function damageAlien(world, a, dmg, info = {}) {
  if (a.dead || a.inVent > 0) return;
  const s = info.shooter;
  if (a.def.armored && !info.explosive && !info.fire && a.stun <= 0 && s) {
    const toShooter = Math.atan2(s.y - a.y, s.x - a.x);
    if (Math.abs(angDiff(a.facing, toShooter)) < 1.15) {
      dmg *= 0.3;
      world.emit('ricochet', { x: a.x, y: a.y });
      if (s.kind === 'human' && !s.isPlayer) world.say(s, 'contact_brute');
    }
  }
  a.hp -= dmg;
  a.hurtT = 0.12;
  a.revealT = 1.5;
  a.sleeping = false;
  if (info.stagger) a.stun = Math.max(a.stun, info.stagger / a.def.mass);
  if (info.knock && !a.def.static) {
    const k = info.knock / a.def.mass;
    a.kx += Math.cos(info.ang || 0) * k; a.ky += Math.sin(info.ang || 0) * k;
  }
  if (s && s.kind === 'human' && !a.def.static) {
    a.lk = { x: s.x, y: s.y, t: world.time, conf: 1 };
    if (!a.target || a.target.downed) { a.target = s; a.aware = 1; }
    a.dmgTaken = (a.dmgTaken || 0) + dmg;
  }
  if (a.def.static) a.agit = 20;
  world.emit('alienHit', { x: info.hx !== undefined ? info.hx : a.x, y: info.hy !== undefined ? info.hy : a.y, ang: info.ang || 0, type: a.type, dmg });
  if (a.hp <= 0) killAlien(world, a, info);
  if (s && s.isPlayer) world.emit('hitmark', { kill: a.dead, heavy: a.dead && (a.def.mass > 1 || info.knock > 100) });
}

export function killAlien(world, a, info = {}) {
  if (a.dead) return;
  a.dead = true;
  world.stats.kills++;
  world.emit('alienDeath', { x: a.x, y: a.y, type: a.type, ang: info.ang || 0, r: a.r });
  const s = info.shooter;
  if (a.type === 'nest') {
    world.stats.nests++;
    world.emit('explode', { x: a.x, y: a.y, r: 40, goo: true });
    for (const h of world.humans) if (dist(h.x, h.y, a.x, a.y) < 300) addStress(h, -15);
    if (s && s.kind === 'human') world.say(s, 'nest_dead', true);
    world.mission && world.mission.onNestKilled(world, a);
    return;
  }
  if (s && s.kind === 'human') {
    s.kills++;
    addStress(s, -4);
    for (const h of witnesses(world, a.x, a.y, 160)) if (h !== s) addStress(h, -1.5);
    if (!s.isPlayer && world.rng.chance(0.35)) world.say(s, 'kill');
  }
  world.director && world.director.onKill(world, a);
}

export function damageHuman(world, h, dmg, info = {}) {
  if (h.dead || h.downed || world.god && h.isPlayer) return;
  if (h.armor > 0) {
    const ab = Math.min(h.armor, dmg * 0.45);
    h.armor -= ab; dmg -= ab;
    if (h.armor <= 0.01) { h.armor = 0; world.emit('armorBreak', { x: h.x, y: h.y }); }
  }
  h.hp -= dmg;
  h.hurtT = 0.3;
  h.safeT = 0;
  h.combatT = Math.max(h.combatT, 4);
  h.hurtAng = info.ang || 0;
  addStress(h, Math.min(14, dmg * 0.4), info.friendly ? null : 'HIT');
  const rng = world.rng, k = info.kind;
  if (k === 'claw') {
    if (rng.chance(dmg / 45) || info.bleed) h.bleed = Math.min(3, h.bleed + 1);
    if (rng.chance(0.07)) h.leg = true;
    if (rng.chance(0.08)) h.arm = true;
  } else if (k === 'charge') {
    if (rng.chance(0.45)) h.leg = true;
    h.stunT = 0.8;
  } else if (k === 'acid') {
    h.acid = Math.max(h.acid, 3);
    if (rng.chance(0.04)) h.arm = true;
  } else if (k === 'explosion') {
    if (rng.chance(0.5)) h.bleed = Math.min(3, h.bleed + 1);
  } else if (k === 'bullet') {
    if (rng.chance(0.25)) h.bleed = Math.min(3, h.bleed + 1);
  }
  if (info.knock) { h.kx += Math.cos(info.ang || 0) * info.knock; h.ky += Math.sin(info.ang || 0) * info.knock; }
  world.emit('humanHit', { x: h.x, y: h.y, id: h.id, player: h.isPlayer, dmg, ang: info.ang || 0, kind: k });
  if (info.friendly && info.src && info.src !== h) world.say(h, 'lane');
  else if (!h.isPlayer && dmg > 5) world.say(h, h.bleed >= 2 ? 'bleeding' : 'hurt');
  if (h.hp <= 0) goDown(world, h);
}

export function goDown(world, h) {
  h.hp = 0; h.downed = true; h.bleedout = h.isPlayer ? 40 : 50;
  h.reloading = false; h.useT = 0; h.panicT = 0;
  world.stats.downs++;
  world.emit('down', { x: h.x, y: h.y, id: h.id, player: h.isPlayer });
  if (!h.isPlayer) world.say(h, 'down', true);
  let caller = null;
  for (const o of world.humans) {
    if (o === h || o.dead || o.downed) continue;
    if (dist(o.x, o.y, h.x, h.y) < 240) { addStress(o, 18, 'ALLY DOWN'); if (!o.isPlayer && !caller) caller = o; }
  }
  if (caller) world.say(caller, 'allydown', true, h.name);
  for (const a of world.aliens) if (a.target === h) { a.target = null; a.aware = 0.6; }
}

export function killHuman(world, h) {
  if (h.dead) return;
  h.dead = true; h.downed = false;
  world.stats.deaths++;
  world.emit('humanDeath', { x: h.x, y: h.y, id: h.id, player: h.isPlayer });
  let caller = null;
  for (const o of world.humans) {
    if (o === h || o.dead) continue;
    addStress(o, 24, 'ALLY LOST');
    o.trauma = Math.min(40, o.trauma + 9);
    if (!o.isPlayer && !o.downed && !caller) caller = o;
  }
  if (caller) world.say(caller, 'allydead', true, h.name);
  // Drop gear.
  for (const w of h.weapons) world.spawnPickup('w:' + w.id, 1, h.x, h.y, { mag: w.mag });
  for (const t in h.ammo) if (h.ammo[t] > 0) world.spawnPickup('a:' + t, h.ammo[t], h.x, h.y);
  for (const b of h.belt) world.spawnPickup(b.id, b.n, h.x, h.y, { charges: b.charges });
}

export function reviveHuman(world, h, by, bonus = 0) {
  h.downed = false;
  h.hp = 30 + bonus;
  h.bleed = Math.min(h.bleed, 1);
  h.stress = Math.max(h.stress, 55);
  h.stunT = 0.4;
  world.emit('revive', { x: h.x, y: h.y, id: h.id });
  if (!h.isPlayer) world.say(h, 'revived', true);
  if (by) addStress(by, -8);
}

// Fire a single ray. Returns the end point.
export function hitscan(world, shooter, x, y, ang, def, opts = {}) {
  const max = def.range * 1.3;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const dWall = world.nav.rayDist(x, y, ang, max);
  const hits = [];
  const test = (e, friendly) => {
    const rx = e.x - x, ry = e.y - y;
    const t = rx * dx + ry * dy;
    if (t < 0 || t > dWall + e.r) return;
    const perp = Math.abs(rx * dy - ry * dx), rr = e.r + 1.5;
    if (perp > rr) return;
    hits.push({ t: Math.max(0, t - Math.sqrt(rr * rr - perp * perp)), e, friendly });
  };
  for (const a of world.aliens) if (!a.dead && a.inVent <= 0) test(a, false);
  if (shooter.kind === 'human') for (const h of world.humans) if (h !== shooter && !h.dead && !h.downed) test(h, true);
  hits.sort((p, q) => p.t - q.t);
  let pen = def.pen || 0, dmg = def.dmg * (opts.mul || 1), end = dWall, hitWall = dWall < max - 0.5;
  for (const hit of hits) {
    if (hit.t > dWall) break;
    const fall = hit.t > def.range * 0.6 ? clamp(1 - (hit.t - def.range * 0.6) / (def.range * 0.7), 0.35, 1) : 1;
    const hx = x + dx * hit.t, hy = y + dy * hit.t;
    if (hit.friendly) {
      damageHuman(world, hit.e, dmg * fall * 0.2, { kind: 'bullet', friendly: true, src: shooter, ang });
      world.stats.friendlyHits++;
      end = hit.t; hitWall = false;
      break;
    }
    damageAlien(world, hit.e, dmg * fall, { shooter, ang, stagger: def.stagger, knock: def.knock, hx, hy });
    if (pen > 0) { pen--; dmg *= 0.6; continue; }
    end = hit.t; hitWall = false;
    break;
  }
  const ex = x + dx * end, ey = y + dy * end;
  world.emit('tracer', { x, y, x2: ex, y2: ey, w: opts.kind || 'bullet' });
  if (hitWall) world.emit('impact', { x: ex, y: ey, ang });
  return { x: ex, y: ey, hit: hits.length > 0 && !hitWall ? hits[0].e : null };
}

export function arcShot(world, shooter, x, y, ang, def) {
  const r = hitscan(world, shooter, x, y, ang, def, { kind: 'arc' });
  let from = r.hit && r.hit.kind === 'alien' ? r.hit : null;
  const done = new Set();
  if (from) done.add(from);
  for (let c = 0; from && c < def.chain; c++) {
    let best = null, bd = 76;
    for (const a of world.aliens) {
      if (a.dead || a.inVent > 0 || done.has(a)) continue;
      const d = dist(a.x, a.y, from.x, from.y);
      if (d < bd && world.nav.los(from.x, from.y, a.x, a.y)) { bd = d; best = a; }
    }
    if (!best) break;
    world.emit('tracer', { x: from.x, y: from.y, x2: best.x, y2: best.y, w: 'arc' });
    damageAlien(world, best, def.dmg * 0.6, { shooter, ang: Math.atan2(best.y - from.y, best.x - from.x), stagger: def.stagger });
    done.add(best);
    from = best;
  }
  world.flash(r.x, r.y, 60, [0.4, 0.8, 1], 0.08);
}

export function flameTick(world, shooter, x, y, ang, def) {
  const range = Math.min(def.range, world.nav.rayDist(x, y, ang, def.range));
  for (const a of world.aliens) {
    if (a.dead || a.inVent > 0) continue;
    const d = dist(x, y, a.x, a.y);
    if (d > range + a.r || Math.abs(angDiff(ang, Math.atan2(a.y - y, a.x - x))) > 0.3 + a.r / Math.max(8, d)) continue;
    if (!world.nav.los(x, y, a.x, a.y)) continue;
    damageAlien(world, a, def.dmg * def.rate * (a.type === 'nest' ? 2.2 : 1), { shooter, ang, fire: true });
    a.burn = 2.5;
  }
  for (const h of world.humans) {
    if (h === shooter || h.dead) continue;
    const d = dist(x, y, h.x, h.y);
    if (d < range && Math.abs(angDiff(ang, Math.atan2(h.y - y, h.x - x))) < 0.25 && world.nav.los(x, y, h.x, h.y)) damageHuman(world, h, def.dmg * def.rate * 0.5, { kind: 'fire', friendly: true, src: shooter, ang });
  }
  if (world.rng.chance(0.22)) {
    const d = range * world.rng.range(0.5, 1), a2 = ang + world.rng.range(-0.2, 0.2);
    world.addFire(x + Math.cos(a2) * d, y + Math.sin(a2) * d, world.rng.range(4, 7));
  }
  world.emit('flame', { x, y, ang, range });
}

export function explode(world, x, y, radius, dmg, src) {
  world.emit('explode', { x, y, r: radius });
  world.noise(x, y, 520, 'explosion', src);
  world.flash(x, y, radius * 2.4, [1, 0.75, 0.4], 0.18);
  for (const a of world.aliens) {
    if (a.dead || a.inVent > 0) continue;
    const d = dist(x, y, a.x, a.y);
    if (d > radius + a.r || !world.nav.los(x, y, a.x, a.y)) continue;
    const f = clamp(1 - d / radius, 0.25, 1);
    damageAlien(world, a, dmg * f, { shooter: src, explosive: true, ang: Math.atan2(a.y - y, a.x - x), knock: 200 * f, stagger: 0.9 });
  }
  for (const h of world.humans) {
    if (h.dead) continue;
    const d = dist(x, y, h.x, h.y);
    if (d > radius || !world.nav.los(x, y, h.x, h.y)) continue;
    const f = clamp(1 - d / radius, 0.2, 1);
    damageHuman(world, h, dmg * 0.6 * f, { kind: 'explosion', ang: Math.atan2(h.y - y, h.x - x), knock: 120 * f, friendly: true });
    addStress(h, 6);
  }
  for (let i = 0; i < 3; i++) world.addFire(x + world.rng.range(-14, 14), y + world.rng.range(-14, 14), world.rng.range(2, 4));
}

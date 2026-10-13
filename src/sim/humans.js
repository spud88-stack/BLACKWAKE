// Human bodies: movement, weapons, health conditions, composure, inventory.
import { clamp, dist, angDiff, approach } from '../core/util.js';
import { WEAPONS, ITEMS, AMMO, BELT_SIZE, MATE_BELT, ALIENS } from './data.js';
import { hitscan, arcShot, flameTick, addStress, damageHuman, damageAlien, killHuman, reviveHuman } from './combat.js';

// Entity ids come from the active world so that separate worlds stay deterministic.
let ids = { n: 1 };
export function useIds(o) { ids = o; }
export function newId() { return ids.n++; }

export function makeHuman(world, charId, def, x, y, isPlayer) {
  const h = {
    id: newId(), kind: 'human', isPlayer, charId, char: def, name: def.name, x, y, vx: 0, vy: 0, kx: 0, ky: 0, r: 4.5, aim: 0, face: 0,
    hp: 100, maxHp: 100, bleed: 0, leg: false, arm: false, acid: 0, armor: 0, downed: false, bleedout: 0, dead: false, stunT: 0,
    stress: 8, trauma: 0, stressors: [], spike: null, spikeT: 0, panicT: 0, panicCd: 0, calmCd: 0, stimT: 0, exposure: 0, sway: 0,
    weapons: [], cur: 0, ammo: { light: 0, shell: 0, rifle: 0, cell: 0, fuel: 0 }, belt: [], beltSize: isPlayer ? BELT_SIZE : MATE_BELT,
    flashlight: true, battery: 100, fireCd: 0, reloading: false, reloadT: 0, bloom: 0, recoil: 0, meleeCd: 0, throwCd: 0, firedT: 9, dryT: 0,
    sprint: false, sneak: false, moving: false, stepT: 0, busyT: 0, busyItem: null, busyTarget: null,
    useKey: null, useT: 0, useNeed: 0, hurtT: 0, hurtAng: 0, combatT: 0, safeT: 0, anim: 0, kills: 0, selThrow: 'flare',
    speech: null, sayCd: {}, ai: null, isolatedT: 0, room: -1,
  };
  for (const w of def.weapons) giveWeapon(h, w, true);
  return h;
}

export function giveWeapon(h, id, withAmmo) {
  const def = WEAPONS[id];
  h.weapons.push({ id, mag: def.mag });
  if (withAmmo) h.ammo[def.ammo] = Math.min(AMMO[def.ammo].cap, h.ammo[def.ammo] + def.mag * (def.shellReload ? 4 : 3));
}

export const curWeapon = (h) => h.weapons[h.cur];
export const curDef = (h) => WEAPONS[h.weapons[h.cur].id];
export const tier = (h) => (h.stress >= 85 ? 3 : h.stress >= 60 ? 2 : h.stress >= 30 ? 1 : 0);
export const TIER_NAMES = ['STEADY', 'TENSE', 'SHAKEN', 'PANIC'];
export const active = (h) => !h.dead && !h.downed;

export function countItem(h, id) {
  let n = 0;
  for (const b of h.belt) if (b.id === id) n += b.n;
  return n;
}
export function takeItem(h, id) {
  for (let i = 0; i < h.belt.length; i++) if (h.belt[i].id === id) {
    if (--h.belt[i].n <= 0) h.belt.splice(i, 1);
    return true;
  }
  return false;
}

// Returns leftover count that did not fit.
export function addItem(world, h, id, n, extra = {}) {
  if (id.startsWith('a:')) {
    const t = id.slice(2), room = AMMO[t].cap - h.ammo[t], take = Math.min(room, n);
    h.ammo[t] += take;
    return n - take;
  }
  if (id.startsWith('w:')) {
    const wid = id.slice(2);
    if (h.weapons.some((w) => w.id === wid)) { // strip for ammo
      const left = addItem(world, h, 'a:' + WEAPONS[wid].ammo, extra.mag || 0);
      return left > 0 ? 1 : 0;
    }
    if (h.weapons.length >= 2) {
      const old = h.weapons[h.cur];
      world.spawnPickup('w:' + old.id, 1, h.x, h.y, { mag: old.mag, cool: 1 });
      h.weapons[h.cur] = { id: wid, mag: extra.mag !== undefined ? extra.mag : WEAPONS[wid].mag };
    } else {
      h.weapons.push({ id: wid, mag: extra.mag !== undefined ? extra.mag : WEAPONS[wid].mag });
      h.cur = h.weapons.length - 1;
    }
    h.reloading = false;
    return 0;
  }
  const def = ITEMS[id];
  if (def.kind === 'key') { world.keys[id] = true; world.mission && world.mission.onItem(world, id, h); return 0; }
  if (id === 'armor') { if (h.armor >= 45) return n; h.armor = 60; return n - 1; }
  if (id === 'tracker') { if (world.tracker) return n; world.tracker = true; return 0; }
  for (const b of h.belt) if (b.id === id && b.n < def.stack) {
    const take = Math.min(def.stack - b.n, n);
    b.n += take; n -= take;
    if (n <= 0) return 0;
  }
  while (n > 0 && h.belt.length < h.beltSize) {
    const take = Math.min(def.stack, n);
    h.belt.push({ id, n: take, charges: extra.charges !== undefined ? extra.charges : def.charges });
    n -= take;
  }
  return n;
}

export function startReload(world, h) {
  const w = curWeapon(h), def = WEAPONS[w.id];
  if (h.reloading || w.mag >= def.mag || h.ammo[def.ammo] <= 0 || h.busyT > 0) return false;
  h.reloading = true;
  const t = tier(h);
  h.reloadT = def.reload * (h.arm ? 1.35 : 1) * (t >= 2 ? 1.25 : 1) * (t >= 3 ? 1.3 : 1);
  world.emit('reload', { x: h.x, y: h.y, id: h.id, w: w.id, dur: h.reloadT });
  if (!h.isPlayer) world.say(h, 'reload');
  return true;
}

function finishReload(world, h) {
  const w = curWeapon(h), def = WEAPONS[w.id];
  if (def.shellReload) {
    w.mag++; h.ammo[def.ammo]--;
    world.emit('shell', { x: h.x, y: h.y, id: h.id });
    if (w.mag < def.mag && h.ammo[def.ammo] > 0) { h.reloadT = def.reload * (h.arm ? 1.35 : 1); return; }
  } else {
    const take = Math.min(def.mag - w.mag, h.ammo[def.ammo]);
    w.mag += take; h.ammo[def.ammo] -= take;
    world.emit('reloadDone', { x: h.x, y: h.y, id: h.id, w: w.id });
  }
  h.reloading = false;
}

export function muzzle(h) {
  const len = WEAPONS[h.weapons[h.cur].id].len;
  return { x: h.x + Math.cos(h.aim) * (4 + len * 0.6), y: h.y - 3 + Math.sin(h.aim) * (4 + len * 0.6) };
}

export function tryFire(world, h) {
  const w = curWeapon(h), def = WEAPONS[w.id];
  if (h.fireCd > 0 || h.busyT > 0 || h.stunT > 0 || h.sprint) return false;
  if (h.reloading) {
    if (def.shellReload && w.mag > 0) h.reloading = false; else return false;
  }
  if (w.mag <= 0) {
    if (h.dryT <= 0) { world.emit('dry', { x: h.x, y: h.y, id: h.id }); h.dryT = 0.3; }
    startReload(world, h);
    return false;
  }
  w.mag--;
  h.fireCd = def.rate;
  h.firedT = 0;
  h.combatT = Math.max(h.combatT, 3);
  const ang = h.aim + h.sway;
  // Fire from the body line so muzzles never clip through walls.
  const ox = h.x + Math.cos(ang) * 3, oy = h.y + Math.sin(ang) * 3;
  const skillErr = h.isPlayer ? 0 : (1 - h.char.aim) * 0.07 + (h.stress / 100) * 0.07 + (h.panicT > 0 ? 0.14 : 0);
  const spread = def.spread + h.bloom + (h.moving ? 0.02 : 0) + skillErr + (h.arm ? 0.03 : 0);
  const rng = world.rng;
  if (def.flame) flameTick(world, h, ox, oy, ang, def);
  else if (def.chain) arcShot(world, h, ox, oy, ang + (rng.next() - 0.5) * spread, def);
  else for (let i = 0; i < def.pellets; i++) hitscan(world, h, ox, oy, ang + (rng.next() + rng.next() - 1) * spread, def, {});
  h.bloom = Math.min(def.bloomMax, h.bloom + def.bloom);
  h.recoil = def.kick;
  const m = muzzle(h);
  world.emit('shot', { x: m.x, y: m.y, ang, w: w.id, id: h.id, player: h.isPlayer });
  world.noise(h.x, h.y, def.noise, 'gun', h);
  if (!def.flame) world.flash(m.x, m.y, def.chain ? 70 : 60 + def.kick * 12, def.chain ? [0.4, 0.8, 1] : [1, 0.82, 0.5], 0.06);
  if (w.mag === 0 && h.ammo[def.ammo] <= 0 && !h.isPlayer) world.say(h, 'empty');
  return true;
}

export function melee(world, h) {
  if (h.meleeCd > 0 || h.busyT > 0 || h.stunT > 0) return;
  h.meleeCd = 0.65;
  h.recoil = -3;
  world.emit('melee', { x: h.x, y: h.y, ang: h.aim, id: h.id });
  world.noise(h.x, h.y, 70, 'step', h);
  for (const a of world.aliens) {
    if (a.dead || a.inVent > 0) continue;
    const d = dist(h.x, h.y, a.x, a.y);
    if (d < 20 + a.r && Math.abs(angDiff(h.aim, Math.atan2(a.y - h.y, a.x - h.x))) < 1.1) damageAlien(world, a, 9, { shooter: h, ang: h.aim, knock: 170, stagger: 0.45 });
  }
}

export function throwItem(world, h, id, tx, ty) {
  if (h.throwCd > 0 || h.busyT > 0 || !takeItem(h, id)) return false;
  h.throwCd = 0.6;
  const d = Math.min(150, dist(h.x, h.y, tx, ty)), a = Math.atan2(ty - h.y, tx - h.x);
  const wall = world.nav.rayDist(h.x, h.y, a, d + 6) - 6;
  const dd = Math.max(4, Math.min(d, wall));
  world.projs.push({ kind: id, x: h.x, y: h.y, sx: h.x, sy: h.y, tx: h.x + Math.cos(a) * dd, ty: h.y + Math.sin(a) * dd, t: 0, dur: 0.25 + dd / 260, src: h });
  world.emit('throw', { x: h.x, y: h.y, id: h.id });
  return true;
}

const MED_TIME = { bandage: 1.1, medkit: 2.0, stim: 0.4 };
export function applyMed(world, target, id, by) {
  if (id === 'bandage') { target.hp = Math.min(target.maxHp, target.hp + 12); target.bleed = 0; }
  else if (id === 'medkit') { target.hp = Math.min(target.maxHp, target.hp + 55); target.bleed = 0; target.leg = false; target.arm = false; target.acid = 0; }
  else if (id === 'stim') { target.stress = Math.max(target.trauma, target.stress - 45); target.stimT = 20; target.panicT = 0; }
  world.emit('heal', { x: target.x, y: target.y, id: target.id, item: id });
  if (by && by !== target && !target.isPlayer) world.say(target, 'thanks');
}

// Begin using a belt item (on self or another human).
export function useItem(world, h, id, target) {
  if (h.busyT > 0 || countItem(h, id) <= 0) return false;
  const def = ITEMS[id];
  target = target || h;
  if (def.kind === 'med') {
    h.busyT = MED_TIME[id] * (h.char.medic ? 0.6 : 1);
    h.busyItem = id; h.busyTarget = target; h.reloading = false;
    world.emit('useStart', { x: h.x, y: h.y, id: h.id, item: id });
    return true;
  }
  if (id === 'battery') { if (h.battery > 90) return false; takeItem(h, id); h.battery = 100; h.flashlight = true; world.emit('pickup', { x: h.x, y: h.y, item: id }); return true; }
  return false;
}

export function bestMed(h, forTarget) {
  const t = forTarget || h;
  if ((t.hp < 50 || t.leg || t.arm) && countItem(h, 'medkit')) return 'medkit';
  if ((t.bleed > 0 || t.hp < 80) && countItem(h, 'bandage')) return 'bandage';
  if (t.hp < 70 && countItem(h, 'medkit')) return 'medkit';
  return null;
}

export function dropBelt(world, h, slot) {
  const b = h.belt[slot];
  if (!b) return;
  h.belt.splice(slot, 1);
  world.spawnPickup(b.id, b.n, h.x + Math.cos(h.aim) * 12, h.y + Math.sin(h.aim) * 12, { charges: b.charges, cool: 1.5 });
}

export function giveBelt(world, h, slot, to) {
  const b = h.belt[slot];
  if (!b || !to) return false;
  const left = addItem(world, to, b.id, 1, { charges: b.charges });
  if (left > 0) return false;
  if (--b.n <= 0) h.belt.splice(slot, 1);
  world.emit('give', { x: to.x, y: to.y });
  if (!to.isPlayer) world.say(to, 'thanks', true);
  return true;
}

export function giveAmmo(world, h, type, to, amount) {
  const n = Math.min(h.ammo[type], amount);
  if (n <= 0) return 0;
  const left = addItem(world, to, 'a:' + type, n);
  h.ammo[type] -= n - left;
  if (n - left > 0) world.emit('give', { x: to.x, y: to.y });
  return n - left;
}

export function totalAmmo(h) {
  let n = 0;
  for (const w of h.weapons) n += w.mag + h.ammo[WEAPONS[w.id].ammo];
  return n;
}

const TIER_SWAY = [0, 0.012, 0.045, 0.1];

export function updateStress(world, h, dt) {
  const st = [];
  let p = 0;
  const amb = world.light.at(h.x, h.y);
  const light = Math.max(amb, h.lightOn ? 0.13 : 0);
  let floor = h.trauma;
  if (light < 0.26) { const v = ((0.26 - light) / 0.26) * 1.6; p += v; floor += v * 14; if (v > 0.5) st.push('DARK'); }
  if (!world.poweredAt(h.x, h.y)) floor += 13;
  let allies = 0, nearest = 1e9;
  for (const o of world.humans) {
    if (o === h || !active(o)) continue;
    const d = dist(h.x, h.y, o.x, o.y);
    if (d < nearest) nearest = d;
    if (d < 90) allies++;
  }
  if (nearest > 150) { h.isolatedT += dt; if (h.isolatedT > 3) { p += h.char.scout ? 0.6 : 1.4; floor += h.char.scout ? 5 : 14; st.push('ALONE'); } } else h.isolatedT = 0;
  let threat = 0, hunted = false;
  for (const a of world.aliens) {
    if (a.dead || a.inVent > 0) continue;
    const d = dist(h.x, h.y, a.x, a.y);
    if (d > 190) continue;
    if (a.target === h && d < 150 && !a.def.static) hunted = true;
    if (d < 170 && (a.revealT > 0 || world.light.at(a.x, a.y) > 0.12 || d < 50) && world.nav.los(h.x, h.y, a.x, a.y)) threat += a.def.threat * (d < 60 ? 1.5 : 1);
  }
  if (threat > 0) { p += Math.min(4.5, threat * 0.9); st.push('HOSTILES'); h.safeT = 0; }
  if (hunted) { p += 0.9; st.push('HUNTED'); }
  if (h.hp < 50) { p += (1 - h.hp / 50) * 1.8; floor += 10; st.push('WOUNDED'); }
  if (h.bleed > 0) { p += 0.5 * h.bleed; st.push('BLEEDING'); }
  if (totalAmmo(h) === 0) { p += 0.5; floor += 16; st.push('NO AMMO'); }
  else if (h.weapons[h.cur].mag + h.ammo[curDef(h).ammo] <= curDef(h).mag * 0.5) { p += 0.4; st.push('LOW AMMO'); }
  if (h.combatT > 0 && h.fightT > 25) { p += 0.6; st.push('EXHAUSTED'); }
  const room = world.map.rooms[world.map.roomId[Math.floor(h.y / 16) * world.map.w + Math.floor(h.x / 16)]];
  if (room && room.scene) { floor += 8; if (h.exposure < 22) { h.exposure += dt; p += 1.3; st.push('HORROR'); } }
  if (world.director) floor += Math.min(12, world.director.threat * 3);
  if (world.air < 30) { p += 0.8; st.push('THIN AIR'); }
  if (h.downed) p += 2;
  let relief = 0;
  h.safeT += dt;
  if (h.safeT > 5) relief += 1.7;
  relief += Math.min(1.0, allies * 0.45);
  if (light > 0.45) relief += 0.5;
  for (const f of world.flares) if (dist(f.x, f.y, h.x, h.y) < 80) { relief += 0.9; break; }
  if (h.stimT > 0) { h.stimT -= dt; relief += 1.5; }
  const net = p * 1.9 - relief * 1.5;
  floor = Math.min(58, floor / Math.sqrt(h.char.resilience));
  h.floor = floor;
  if (net > 0) addStress(h, net * dt); else if (h.stress > floor) h.stress = Math.max(floor, h.stress + net * dt); else h.stress = Math.min(floor, h.stress + 1.2 * dt);
  if (h.spikeT > 0) { h.spikeT -= dt; if (h.spike) st.unshift(h.spike); }
  h.stressors = st;
  h.fightT = h.combatT > 0 ? (h.fightT || 0) + dt : Math.max(0, (h.fightT || 0) - dt * 2);
  const t = tier(h);
  const amp = TIER_SWAY[t] + (h.arm ? 0.035 : 0) + (h.panicT > 0 ? 0.05 : 0);
  h.sway = amp * (Math.sin(world.time * 2.3 + h.id) + 0.6 * Math.sin(world.time * 5.3 + h.id * 2.7)) / 1.6;
  h.panicCd -= dt; h.calmCd -= dt;
  if (h.panicT > 0) {
    h.panicT -= dt;
    if (h.panicT <= 0) { h.stress = Math.min(h.stress, 66); if (!h.isPlayer) world.say(h, 'calm'); }
  } else if (h.stress >= 90 && h.panicCd <= 0 && active(h)) {
    h.panicT = world.rng.range(4, 7); h.panicCd = 32;
    world.emit('panic', { x: h.x, y: h.y, id: h.id, player: h.isPlayer });
    world.stats.panics++;
    if (!h.isPlayer) world.say(h, 'panic', true);
  }
}

// intent: {mx,my,aim,fire,reload,sprint,sneak,melee}
export function updateHuman(world, h, dt, it) {
  h.fireCd -= dt; h.meleeCd -= dt; h.throwCd -= dt; h.dryT -= dt; h.firedT += dt;
  h.hurtT -= dt; h.combatT -= dt;
  h.recoil = approach(h.recoil, 0, dt * 22);
  h.bloom = Math.max(0, h.bloom - dt * (curDef(h).bloomMax * 2.2 + 0.05));
  if (h.speech) { h.speech.t -= dt; if (h.speech.t <= 0) h.speech = null; }
  if (h.dead) return;
  // Conditions tick even when down.
  if (h.downed) {
    h.bleedout -= dt;
    h.vx = h.vy = 0; h.moving = false;
    updateStress(world, h, dt);
    if (h.bleedout <= 0) killHuman(world, h);
    return;
  }
  if (h.bleed > 0) { h.hp -= h.bleed * 0.75 * dt; h.bleedDrip = (h.bleedDrip || 0) + dt * h.bleed; if (h.bleedDrip > 0.7) { h.bleedDrip = 0; world.emit('drip', { x: h.x, y: h.y }); } }
  if (h.acid > 0) { h.acid -= dt; h.hp -= 3 * dt; }
  if (world.air <= 0) h.hp -= 1.2 * dt;
  if (h.hp <= 0) { damageHuman(world, h, 0.01, {}); return; }
  updateStress(world, h, dt);
  if (h.flashlight && h.isPlayer) { h.battery -= dt * (100 / 220); if (h.battery <= 0) { h.battery = 0; h.flashlight = false; world.emit('lightDead', {}); } }
  h.stunT -= dt;
  if (h.busyT > 0) {
    h.busyT -= dt;
    if (h.busyT <= 0) {
      const tg = h.busyTarget || h;
      if (!tg.dead && dist(h.x, h.y, tg.x, tg.y) < 30 && takeItem(h, h.busyItem)) applyMed(world, tg, h.busyItem, h);
      h.busyItem = null; h.busyTarget = null;
    }
  }
  if (h.reloading) { h.reloadT -= dt; if (h.reloadT <= 0) finishReload(world, h); }
  // Movement.
  let mx = it.mx || 0, my = it.my || 0;
  const ml = Math.hypot(mx, my);
  if (ml > 1) { mx /= ml; my /= ml; }
  h.sprint = !!it.sprint && !h.leg && ml > 0.2 && h.busyT <= 0;
  h.sneak = !!it.sneak && !h.sprint;
  let sp = 62 * (h.sprint ? 1.6 : 1) * (h.sneak ? 0.52 : 1) * (h.leg ? 0.62 : 1) * (h.busyT > 0 ? 0.45 : 1) * (h.reloading ? 0.85 : 1);
  if (h.stunT > 0) sp = 0;
  h.vx = approach(h.vx, mx * sp, dt * 620); h.vy = approach(h.vy, my * sp, dt * 620);
  h.kx *= Math.pow(0.002, dt); h.ky *= Math.pow(0.002, dt);
  world.nav.move(h, (h.vx + h.kx) * dt, (h.vy + h.ky) * dt);
  const spd = Math.hypot(h.vx, h.vy);
  h.moving = spd > 8;
  if (h.moving) {
    h.anim += dt * spd * 0.16;
    h.stepT -= dt * spd;
    if (h.stepT <= 0) {
      h.stepT = 20;
      if (!h.sneak) world.noise(h.x, h.y, h.sprint ? 150 : 55, 'step', h);
      world.emit('step', { x: h.x, y: h.y, id: h.id, sprint: h.sprint, sneak: h.sneak });
    }
  }
  if (it.aim !== undefined) h.aim = it.aim;
  h.face = h.aim;
  if (it.reload) startReload(world, h);
  if (it.melee) melee(world, h);
  if (it.fire) tryFire(world, h);
  h.room = world.map.roomId[Math.floor(h.y / 16) * world.map.w + Math.floor(h.x / 16)];
}

export { ALIENS, reviveHuman };

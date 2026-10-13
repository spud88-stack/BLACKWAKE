// Headless test suite. Run: jsc -m tests/run.js   (see tests/README or package scripts)
import { World } from '../src/sim/world.js';
import { generateShip } from '../src/sim/gen.js';
import { Nav } from '../src/sim/nav.js';
import { spawnAlien } from '../src/sim/aliens.js';
import { addItem, giveWeapon, useItem, tryFire, countItem, giveBelt, dropBelt, tier, startReload } from '../src/sim/humans.js';
import { damageHuman, damageAlien, addStress } from '../src/sim/combat.js';
import { WEAPONS, BELT_SIZE } from '../src/sim/data.js';
import { tc, dist } from '../src/core/util.js';

const only = globalThis.ONLY;
let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  if (only && !name.includes(only)) return;
  const t0 = Date.now();
  try { fn(); pass++; print('  ok   ' + name + '  (' + (Date.now() - t0) + 'ms)'); }
  catch (e) { fail++; failures.push(name); print('  FAIL ' + name + '\n       ' + (e && e.message ? e.message : e) + (e && e.stack && !e.assert ? '\n' + e.stack.split('\n').slice(0, 3).join('\n') : '')); }
}
function ok(c, msg) { if (!c) { const e = new Error(msg || 'assertion failed'); e.assert = true; throw e; } }
const run = (w, secs, input, each) => { for (let i = 0; i < secs * 60 && !w.over; i++) { w.step(1 / 60, typeof input === 'function' ? input(w) : input || {}); if (each) each(w); w.fx.length = 0; } };
const until = (w, secs, pred, input) => { for (let i = 0; i < secs * 60; i++) { w.step(1 / 60, typeof input === 'function' ? input(w) : input || {}); w.fx.length = 0; if (pred(w)) return true; } return false; };
const scene = (name, o = {}) => new World(Object.assign({ scene: name, seed: 1, lightEvery: 2 }, o));
const put = (e, tx, ty) => { e.x = tc(tx); e.y = tc(ty); };
const aimAt = (w, x, y) => ({ aimX: x, aimY: y });

print('BLACKWAKE tests');

// ---------- Generation ----------
test('gen: 40 seeds build connected ships with every key room', () => {
  for (let s = 1; s <= 40; s++) {
    const m = generateShip(s), nav = new Nav(m);
    const d = nav.distField(Math.floor(m.start.x / 16), Math.floor(m.start.y / 16), null);
    for (const t of ['reactor', 'bridge', 'hangar', 'cargo', 'cryo', 'medbay', 'lifesupport', 'comms', 'armory', 'pods', 'lab', 'maint']) ok(m.rooms.some((r) => r.type === t), 'seed ' + s + ' missing ' + t);
    for (const r of m.rooms) {
      let reach = false;
      for (let y = r.y; y < r.y + r.h && !reach; y++) for (let x = r.x; x < r.x + r.w; x++) if (d[y * m.w + x] !== Infinity) { reach = true; break; }
      ok(reach, 'seed ' + s + ' room ' + r.name + ' unreachable');
    }
    for (const p of m.props) if (p.interact && p.type !== 'corpse') {
      let free = false;
      for (let y = p.y - 1; y <= p.y + p.h && !free; y++) for (let x = p.x - 1; x <= p.x + p.w; x++) if (d[y * m.w + x] !== Infinity) { free = true; break; }
      ok(free, 'seed ' + s + ' prop ' + p.type + ' has no reachable neighbour');
    }
  }
});
test('gen: seeds are deterministic and differ from each other', () => {
  const sig = (s) => { const m = generateShip(s); return m.rooms.length + ':' + m.doors.length + ':' + m.props.length + ':' + m.rooms.map((r) => r.type[0] + r.w + r.h).join(''); };
  ok(sig(7) === sig(7), 'same seed differs');
  const set = new Set();
  for (let s = 1; s <= 12; s++) set.add(sig(s));
  ok(set.size === 12, 'only ' + set.size + ' distinct layouts in 12 seeds');
});
test('sim: identical seeds replay identically', () => {
  const a = new World({ seed: 21, autoplay: true, lightEvery: 3 }), b = new World({ seed: 21, autoplay: true, lightEvery: 3 });
  run(a, 40); run(b, 40);
  ok(JSON.stringify(a.snapshot()) === JSON.stringify(b.snapshot()), 'diverged');
});
test('mission: variety across seeds, and every required target is reachable in lock order', () => {
  const finales = new Set(), comps = new Set(), objs = new Set();
  for (let s = 1; s <= 40; s++) {
    const w = new World({ seed: s, lightEvery: 9 }), M = w.mission, m = w.map;
    finales.add(M.finale); M.comps.forEach((c) => comps.add(c)); M.objectives.forEach((o) => objs.add(o.id));
    const st = [Math.floor(m.start.x / 16), Math.floor(m.start.y / 16)];
    const f0 = w.nav.distField(st[0], st[1], (d) => !d.lock);
    const f1 = w.nav.distField(st[0], st[1], (d) => !d.lock || d.lock === 'sec');
    const near = (f, x, y) => { const tx = Math.floor(x / 16), ty = Math.floor(y / 16); for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (f[(ty + oy) * m.w + tx + ox] !== Infinity) return true; return false; };
    for (const o of M.objectives) {
      if (o.type !== 'fetch') continue;
      const where = o.loc ? [o.loc.px, o.loc.py] : [o.pick.x, o.pick.y];
      ok(near(o.item === 'key_cmd' ? f1 : f0, where[0], where[1]), 'seed ' + s + ' ' + o.id + ' placed behind a lock');
    }
    ok(M.objectives.some((o) => o.final), 'seed ' + s + ' has no finale');
  }
  ok(finales.size === 3, 'finales seen: ' + [...finales]);
  ok(comps.size >= 5, 'complications seen: ' + [...comps]);
  ok(objs.size >= 12, 'objective kinds seen: ' + objs.size);
});

// ---------- Weapons & damage ----------
test('weapons: every archetype fires, spends ammo, damages, and reloads', () => {
  for (const id in WEAPONS) {
    const w = scene('empty'), p = w.player, def = WEAPONS[id];
    p.weapons = [{ id, mag: def.mag }]; p.cur = 0; p.ammo[def.ammo] = def.mag * 2;
    const a = spawnAlien(w, 'brute', p.x + 40, p.y); a.sleeping = true;
    const hp0 = a.hp;
    p.aim = 0;
    run(w, 1.2, () => ({ aimX: p.x + 40, aimY: p.y, fire: true, firePressed: true }));
    ok(p.weapons[0].mag < def.mag || p.reloading, id + ' did not spend ammo');
    ok(a.hp < hp0, id + ' did no damage');
    p.weapons[0].mag = 0; p.reloading = false;
    ok(until(w, 6, () => p.weapons[0].mag === Math.min(def.mag, def.mag) || (def.shellReload && p.weapons[0].mag >= 2), { reload: true }), id + ' did not reload');
  }
});
test('weapons: rifle penetrates, pistol does not', () => {
  const shots = (id) => {
    const w = scene('empty'), p = w.player;
    p.weapons = [{ id, mag: 5 }]; p.cur = 0;
    const a = spawnAlien(w, 'skitterer', p.x + 40, p.y), b = spawnAlien(w, 'skitterer', p.x + 60, p.y);
    a.sleeping = b.sleeping = true; a.hp = b.hp = 500; a.maxHp = b.maxHp = 500;
    p.aim = 0; p.sway = 0; p.bloom = 0;
    w.step(1 / 60, { aimX: p.x + 60, aimY: p.y, firePressed: true, fire: true });
    return [a.hp < 500, b.hp < 500];
  };
  const r = shots('rifle'), q = shots('pistol');
  ok(r[0] && r[1], 'rifle should hit both: ' + r);
  ok(q[0] && !q[1], 'pistol should stop at the first: ' + q);
});
test('weapons: brute armour blocks the front, not the back', () => {
  const w = scene('empty'), p = w.player;
  const a = spawnAlien(w, 'brute', p.x + 50, p.y); a.sleeping = true;
  a.facing = Math.PI; // facing the player
  damageAlien(w, a, 100, { shooter: p, ang: 0 });
  const front = a.maxHp - a.hp;
  a.hp = a.maxHp; a.facing = 0; a.stun = 0;
  damageAlien(w, a, 100, { shooter: p, ang: 0 });
  const back = a.maxHp - a.hp;
  ok(front < 40 && back >= 99, 'front ' + front + ' back ' + back);
});
test('weapons: incinerator burns a nest and leaves fire; arc caster chains', () => {
  let w = scene('empty'), p = w.player;
  p.weapons = [{ id: 'flamer', mag: 100 }]; p.cur = 0;
  const n = spawnAlien(w, 'nest', p.x + 46, p.y);
  run(w, 4, () => ({ aimX: n.x, aimY: n.y, fire: true }));
  ok(n.dead, 'nest survived, hp ' + n.hp);
  w = scene('empty'); p = w.player;
  p.weapons = [{ id: 'arc', mag: 8 }]; p.cur = 0;
  const xs = [0, 1, 2].map((i) => { const a = spawnAlien(w, 'skitterer', p.x + 50 + i * 20, p.y + (i % 2) * 14); a.sleeping = true; a.hp = a.maxHp = 300; return a; });
  w.step(1 / 60, { aimX: xs[0].x, aimY: xs[0].y, firePressed: true });
  ok(xs.filter((a) => a.hp < 300).length === 3, 'chain hit ' + xs.filter((a) => a.hp < 300).length);
  ok(xs.every((a) => a.stun > 0), 'chained targets should be stunned');
});
test('grenade, flare and lure do what they say', () => {
  const w = scene('empty'), p = w.player;
  addItem(w, p, 'grenade', 1); addItem(w, p, 'lure', 1);
  const a = spawnAlien(w, 'skitterer', p.x + 110, p.y); a.sleeping = true;
  p.selThrow = 'grenade';
  w.step(1 / 60, { aimX: a.x, aimY: a.y, throw: true });
  run(w, 2);
  ok(a.dead, 'grenade did not kill');
  const b = spawnAlien(w, 'skitterer', tc(12), tc(14));
  p.selThrow = 'lure'; p.throwCd = 0;
  w.step(1 / 60, { aimX: p.x + 20, aimY: p.y - 20, throw: true });
  ok(until(w, 3, () => w.lures.length === 1), 'lure not deployed');
  const l = w.lures[0];
  ok(until(w, 8, () => dist(b.x, b.y, l.x, l.y) < 40), 'skitterer ignored the lure');
  p.selThrow = 'flare'; p.throwCd = 0;
  const before = w.light.at(p.x + 60, p.y);
  w.step(1 / 60, { aimX: p.x + 60, aimY: p.y, throw: true });
  run(w, 1.5);
  ok(w.flares.length === 1, 'no flare');
});

// ---------- Inventory ----------
test('inventory: stacks, capacity, swap-drop, give, use', () => {
  const w = scene('inventory'), p = w.player, m = w.humans[1];
  p.belt = [];
  ok(addItem(w, p, 'bandage', 6) === 0 && p.belt.length === 2, 'bandages should fill two stacks');
  for (let i = 0; i < 20; i++) addItem(w, p, 'medkit', 1);
  ok(p.belt.length === BELT_SIZE, 'belt overfilled: ' + p.belt.length);
  ok(addItem(w, p, 'stim', 1) === 1, 'full belt accepted an item');
  ok(addItem(w, p, 'a:light', 500) > 0 && p.ammo.light === 120, 'ammo cap');
  giveWeapon(p, 'rifle', true);
  const n0 = w.pickups.length;
  addItem(w, p, 'w:shotgun', 1, { mag: 3 });
  ok(p.weapons.length === 2 && p.weapons.some((x) => x.id === 'shotgun') && w.pickups.length === n0 + 1, 'weapon swap should drop the old one');
  p.x = m.x + 10; p.y = m.y;
  const had = countItem(m, 'bandage');
  ok(giveBelt(w, p, 0, m) && countItem(m, 'bandage') === had + 1, 'give failed');
  dropBelt(w, p, 0);
  ok(w.pickups.some((q) => q.item === 'bandage'), 'drop failed');
  p.hp = 40; p.bleed = 2; p.leg = true;
  ok(useItem(w, p, 'medkit'), 'could not start medkit');
  run(w, 2.5);
  ok(p.hp > 90 && p.bleed === 0 && !p.leg, 'medkit did not treat: hp ' + p.hp);
  ok(w.keys.key_sec === undefined && addItem(w, p, 'key_sec', 1) === 0 && w.keys.key_sec, 'key item');
});
test('interaction: containers spill loot, pickups, medstation, weld, locked door', () => {
  const w = scene('empty'), p = w.player, m = w.map;
  const lk = m.props.find((q) => q.type === 'locker');
  lk.loot = [{ id: 'a:light', n: 10 }, { id: 'stim', n: 1 }];
  put(p, lk.x, lk.y + 1);
  const a0 = p.ammo.light;
  ok(until(w, 3, () => lk.searched, { interact: true }), 'locker not searched');
  run(w, 1.2);
  ok(p.ammo.light === a0 + 10, 'ammo not auto-collected');
  ok(until(w, 3, () => countItem(p, 'stim') === 1, (ww) => ({ interact: ww.tick % 20 < 10 })), 'stim not picked up');
  const d = m.doors[0];
  addItem(w, p, 'welder', 1);
  put(p, d.x, d.y + 1);
  p.y += 4;
  run(w, 1.5); // door auto-opened (powered); step back so it closes
  p.x = d.px - 14; p.y = d.py + 14;
  ok(until(w, 4, () => d.welded, { interact: true, weld: true }), 'weld failed (open=' + d.open + ')');
  const sk = spawnAlien(w, 'skitterer', d.px + 40, d.py);
  sk.target = p; sk.aware = 1; sk.lk = { x: p.x, y: p.y, conf: 1, t: 0 };
  run(w, 3);
  ok(d.hp < 260 && !d.broken, 'welded door should hold for a while, hp ' + d.hp);
});

// ---------- Health & stress ----------
test('health: bleeding drains, bandage stops it, wounds slow you', () => {
  const w = scene('empty'), p = w.player;
  p.bleed = 2; const h0 = p.hp;
  run(w, 4);
  ok(p.hp < h0 - 4, 'bleed did not drain');
  addItem(w, p, 'bandage', 1);
  w.step(1 / 60, { heal: true });
  run(w, 2);
  ok(p.bleed === 0, 'bandage did not stop bleeding');
  const x0 = p.x; run(w, 1, { mx: 1 }); const fast = p.x - x0;
  p.x = x0; p.leg = true; p.vx = 0;
  run(w, 1, { mx: 1, sprint: true }); const slow = p.x - x0;
  ok(slow < fast * 0.75, 'leg wound should slow: ' + fast.toFixed(0) + ' vs ' + slow.toFixed(0));
});
test('health: a downed squadmate is revived; an unattended one bleeds out', () => {
  const w = scene('injured', { autoplay: true });
  const ok1 = w.humans.find((h) => h.name === 'OKAFOR');
  ok(ok1.downed, 'setup');
  ok(until(w, 25, () => !ok1.downed && !ok1.dead), 'nobody revived Okafor');
  const park = w.humans.find((h) => h.name === 'PARK');
  ok(until(w, 30, () => park.bleed === 0), 'nobody treated Park (bleed ' + park.bleed + ')');
  const w2 = scene('empty'), p = w2.player;
  damageHuman(w2, p, 500, {});
  ok(p.downed && !w2.over, 'should be downed');
  run(w2, 45);
  ok(w2.over && !w2.over.win, 'should have bled out');
});
test('stress: darkness and isolation raise it; light, allies and calmex lower it; panic fires', () => {
  const lit = scene('squad'), dark = scene('dark');
  run(lit, 20); run(dark, 20);
  ok(dark.player.stress > lit.player.stress + 12, 'dark+alone ' + dark.player.stress.toFixed(0) + ' vs lit+squad ' + lit.player.stress.toFixed(0));
  ok(dark.player.stressors.includes('DARK') && dark.player.stressors.includes('ALONE'), 'stressors: ' + dark.player.stressors);
  const p = dark.player;
  p.stress = 80; addItem(dark, p, 'stim', 1); useItem(dark, p, 'stim');
  run(dark, 1);
  ok(p.stress < 45, 'calmex: ' + p.stress);
  const w = scene('stress'), park = w.humans.find((h) => h.name === 'PARK');
  park.stress = 95;
  run(w, 0.5);
  ok(park.panicT > 0 && park.ai.act === 'panic', 'Park should be panicking (act ' + park.ai.act + ')');
  const before = w.player.trauma;
  damageHuman(w, park, 999, {}); park.bleedout = 0.01; run(w, 0.2);
  ok(park.dead && w.player.trauma > before, 'ally death should leave trauma');
  ok(tier({ stress: 90 }) === 3 && tier({ stress: 10 }) === 0, 'tiers');
});
test('stress: sway widens with composure tier', () => {
  const w = scene('empty'), p = w.player;
  let calm = 0, shaken = 0;
  p.stress = 0; for (let i = 0; i < 120; i++) { w.step(1 / 60, {}); calm = Math.max(calm, Math.abs(p.sway)); p.stress = 0; }
  for (let i = 0; i < 120; i++) { p.stress = 95; p.panicCd = 99; w.step(1 / 60, {}); shaken = Math.max(shaken, Math.abs(p.sway)); }
  ok(shaken > 0.05 && calm < 0.01, 'sway calm ' + calm + ' shaken ' + shaken);
});

// ---------- Alien behaviour ----------
test('skitterer: hears gunfire through a wall and investigates without knowing where you are', () => {
  const w = scene('empty'), p = w.player;
  const a = spawnAlien(w, 'skitterer', tc(8), tc(4));
  run(w, 1);
  ok(!a.target && !a.lk, 'should be unaware');
  w.step(1 / 60, { aimX: p.x + 50, aimY: p.y, firePressed: true });
  run(w, 0.5);
  ok(a.lk && !a.target, 'should have a last-known position but no target');
  ok(dist(a.lk.x, a.lk.y, p.x, p.y) < 90, 'estimate too far off');
  ok(a.act === 'investigate' || a.act === 'rush' || a.act === 'mass', 'act ' + a.act);
});
test('skitterer: a lone one waits for the pack; a pack rushes', () => {
  const w = scene('empty'), p = w.player;
  put(p, 2, 12); p.aim = 0;
  const lone = spawnAlien(w, 'skitterer', tc(13), tc(12));
  lone.target = p; lone.aware = 1; lone.lk = { x: p.x, y: p.y, conf: 1, t: 0 };
  const mate = w.addMate('okafor', p.x, p.y); mate.x = p.x + 12; mate.y = p.y; mate.weapons[0].mag = 0; mate.ammo.rifle = 0; mate.ammo.light = 0; mate.weapons[1].mag = 0;
  run(w, 1.2);
  ok(lone.act === 'mass', 'lone skitterer should mass up, was ' + lone.act);
  for (let i = 0; i < 3; i++) { const s = spawnAlien(w, 'skitterer', tc(13), tc(10 + i * 2)); s.target = p; s.aware = 1; s.lk = { x: p.x, y: p.y, conf: 1, t: 0 }; }
  run(w, 1);
  ok(lone.act === 'rush' || lone.act === 'bite', 'with a pack it should rush, was ' + lone.act);
});
test('skitterer: breaks off when hurt and alone', () => {
  const w = scene('empty'), p = w.player;
  const a = spawnAlien(w, 'skitterer', p.x + 60, p.y);
  a.target = p; a.aware = 1; a.lk = { x: p.x, y: p.y, conf: 1, t: 0 };
  run(w, 0.5);
  a.hp = a.maxHp * 0.3;
  const d0 = dist(a.x, a.y, p.x, p.y);
  run(w, 1.5);
  ok(a.act === 'retreat' && dist(a.x, a.y, p.x, p.y) > d0, 'act ' + a.act);
});
test('lurker: stalks at range in the dark, strikes an isolated target, withdraws from light', () => {
  const w = scene('dark'), p = w.player;
  put(p, 20, 6); p.flashlight = false;
  const mate = w.addMate('okafor', p.x, p.y); mate.x = p.x + 14; mate.y = p.y;
  const a = spawnAlien(w, 'lurker', tc(20), tc(1));
  a.target = p; a.aware = 1; a.lk = { x: p.x, y: p.y, conf: 1, t: 0 }; a.strikeCd = 99;
  let minD = 1e9, acts = new Set();
  run(w, 6, (ww) => ({ aimX: a.x, aimY: a.y }), () => { if (a.act === 'stalk') minD = Math.min(minD, dist(a.x, a.y, p.x, p.y)); acts.add(a.act); });
  ok(acts.has('stalk') && !acts.has('strike'), 'should stalk while it waits for an opening: ' + [...acts]);
  ok(minD > 40, 'stalker came too close: ' + minD.toFixed(0));
  // A lone target with their back turned gets stalked first, then hit, then it melts away.
  const w1 = scene('dark'), p1 = w1.player;
  put(p1, 20, 6); p1.flashlight = false;
  const c = spawnAlien(w1, 'lurker', tc(20), tc(1));
  c.target = p1; c.aware = 1; c.lk = { x: p1.x, y: p1.y, conf: 1, t: 0 }; c.strikeCd = 0;
  const seq = [];
  const hp0 = p1.hp;
  run(w1, 14, () => ({ aimX: p1.x - (c.x - p1.x), aimY: p1.y - (c.y - p1.y) }), () => { if (seq[seq.length - 1] !== c.act) seq.push(c.act); });
  ok(seq.indexOf('stalk') >= 0 && seq.indexOf('strike') > seq.indexOf('stalk'), 'expected stalk then strike: ' + seq);
  ok(['isolated', 'back turned'].includes(c.strikeWhy), 'strike reason: ' + c.strikeWhy);
  ok(p1.hp < hp0 && (p1.bleed > 0 || p1.downed), 'strike should wound and cause bleeding');
  ok(seq.indexOf('withdraw') > seq.indexOf('strike'), 'should withdraw after striking: ' + seq);
  // Light drives it off.
  const w2 = scene('dark'), p2 = w2.player;
  put(p2, 20, 6);
  const b = spawnAlien(w2, 'lurker', p2.x + 70, p2.y);
  b.target = p2; b.aware = 1; b.lk = { x: p2.x, y: p2.y, conf: 1, t: 0 }; b.strikeCd = 99;
  ok(until(w2, 5, () => b.act === 'withdraw', () => ({ aimX: b.x, aimY: b.y })), 'flashlight did not drive it off (exposed ' + b.exposed + ')');
});
test('lurker: uses vents to reposition', () => {
  const w = scene('dark'), p = w.player;
  const a = spawnAlien(w, 'lurker', tc(33), tc(5));
  a.withT = 6; a.act = 'withdraw';
  ok(until(w, 8, () => a.inVent > 0), 'never entered a vent');
  const from = { x: a.x, y: a.y };
  ok(until(w, 10, () => a.inVent <= 0), 'never came out');
  ok(dist(a.x, a.y, from.x, from.y) > 60 && w.map.vents.some((v) => dist(v.px, v.py, a.x, a.y) < 4), 'should emerge at another vent');
});
test('brute: telegraphs, charges, stuns itself on a wall, smashes doors', () => {
  const w = scene('empty'), p = w.player;
  put(p, 12, 12);
  const a = spawnAlien(w, 'brute', tc(3), tc(12));
  a.target = p; a.aware = 1; a.lk = { x: p.x, y: p.y, conf: 1, t: 0 }; a.chargeCd = 0; a.facing = 0;
  ok(until(w, 3, () => a.windup > 0), 'no wind-up (act ' + a.act + ')');
  ok(until(w, 2, () => !!a.charge), 'no charge');
  p.x = tc(12); p.y = tc(10); // sidestep
  ok(until(w, 3, () => a.stun > 1), 'should stun itself on the wall');
  const w2 = scene('empty'), p2 = w2.player;
  const d = w2.map.doors.find((q) => q.x === 15 && q.y === 10);
  const b = spawnAlien(w2, 'brute', tc(20), tc(10));
  b.target = p2; b.aware = 1; b.lk = { x: p2.x, y: p2.y, conf: 1, t: 0 };
  ok(until(w2, 14, () => d.broken), 'door survived the brute, hp ' + d.hp);
});
test('spitter: keeps its distance, lobs acid that pools, backs off when pressed', () => {
  const w = scene('empty'), p = w.player;
  put(p, 3, 12);
  const a = spawnAlien(w, 'spitter', tc(11), tc(12));
  a.target = p; a.aware = 1; a.lk = { x: p.x, y: p.y, conf: 1, t: 0 }; a.atkCd = 0;
  ok(until(w, 4, () => w.projs.some((q) => q.kind === 'acid')), 'never spat');
  ok(until(w, 3, () => w.pools.length > 0), 'no acid pool');
  ok(dist(a.x, a.y, p.x, p.y) > 70, 'spitter closed in');
  p.x = a.x - 30; p.y = a.y; a.atkT = 0;
  const d0 = dist(a.x, a.y, p.x, p.y);
  run(w, 1.2);
  ok(a.act === 'flee' || dist(a.x, a.y, p.x, p.y) > d0 + 10, 'did not back off: ' + a.act);
});
test('shrieker: screams on sight, spikes stress, alerts the deck, then runs', () => {
  const w = scene('empty'), p = w.player;
  put(p, 3, 12);
  const a = spawnAlien(w, 'shrieker', tc(10), tc(12)); a.facing = Math.PI; a.screamCd = 0;
  const far = spawnAlien(w, 'skitterer', tc(33), tc(4));
  const s0 = p.stress;
  ok(until(w, 5, () => a.screamCd > 20), 'never screamed');
  ok(p.stress > s0 + 8, 'no stress spike: ' + s0 + ' -> ' + p.stress);
  ok(far.lk && far.lk.conf > 0.5, 'distant skitterer was not alerted');
  run(w, 1);
  ok(a.act === 'flee', 'should flee, was ' + a.act);
});
test('aliens: sight depends on light; a flashlight gives you away', () => {
  const see = (flash) => {
    const w = scene('dark'), p = w.player;
    put(p, 3, 12); p.flashlight = flash; p.aim = Math.PI;
    const a = spawnAlien(w, 'skitterer', tc(8), tc(12));
    run(w, 2.5, { aimX: p.x - 50, aimY: p.y }, () => { a.facing = Math.PI; a.stun = 1; });
    return a.aware >= 1;
  };
  ok(!see(false), 'seen in the dark with the light off');
  ok(see(true), 'not seen with the flashlight on');
});
test('nest: spawns when agitated, capped', () => {
  const w = scene('empty'), p = w.player;
  const n = spawnAlien(w, 'nest', tc(10), tc(12));
  run(w, 40);
  const kids = w.aliens.filter((a) => a.nest === n && !a.dead).length;
  ok(kids >= 1 && kids <= 3, 'nest children: ' + kids);
});

// ---------- Squad behaviour ----------
test('squad: follows through doors and corridors without getting lost or stuck', () => {
  const w = scene('squad', { autoplay: true });
  let maxD = 0, sumD = 0, n = 0;
  run(w, 110, null, (ww) => { for (const h of ww.humans) if (!h.isPlayer) { const d = dist(h.x, h.y, ww.player.x, ww.player.y); maxD = Math.max(maxD, d); sumD += d; n++; } });
  ok(w.tourLaps >= 2, 'leader only finished ' + w.tourLaps + ' laps');
  ok(sumD / n < 75, 'average distance to leader ' + (sumD / n).toFixed(0));
  ok(maxD < 260, 'someone fell ' + maxD.toFixed(0) + 'px behind');
  ok((w.perf.stucks || 0) < 12, 'stuck events: ' + w.perf.stucks);
});
test('squad: holds fire when the leader is in the lane', () => {
  const w = scene('empty'), p = w.player;
  put(p, 7, 12);
  const m = w.addMate('okafor', p.x, p.y); put(m, 3, 12); m.aim = 0;
  const a = spawnAlien(w, 'brute', tc(12), tc(12)); a.sleeping = true; a.revealT = 99; a.hp = a.maxHp = 5000;
  w.god = true;
  for (let i = 0; i < 180; i++) { put(p, 7, 12); a.sleeping = false; a.stun = 5; w.step(1 / 60, {}); a.x = tc(12); a.y = tc(12); w.fx.length = 0; }
  ok(w.stats.friendlyHits === 0, 'friendly hits: ' + w.stats.friendlyHits);
  ok(m.ai.act === 'engage', 'mate should be engaging (act ' + m.ai.act + ')');
  ok(a.hp < 5000, 'mate should have found an angle and hit the target');
});
test('squad: reloads, shares ammo with a dry leader, and obeys hold / follow', () => {
  const w = scene('squad'), p = w.player, m = w.humans[1];
  m.weapons[m.cur].mag = 0;
  ok(until(w, 4, () => m.weapons[m.cur].mag > 0), 'mate never reloaded');
  p.weapons[0].mag = 0; p.ammo.light = 0;
  ok(until(w, 12, () => p.ammo.light > 0), 'nobody shared ammo');
  w.step(1 / 60, { cmdHold: true });
  const hx = m.x, hy = m.y;
  run(w, 5, { mx: 1 });
  ok(dist(m.x, m.y, hx, hy) < 30 && m.ai.act === 'hold', 'did not hold: ' + m.ai.act);
  w.step(1 / 60, { cmdFollow: true });
  ok(until(w, 8, () => dist(m.x, m.y, p.x, p.y) < 60), 'did not come back');
});
test('squad: fights, wins a fair fight, and calls targets out', () => {
  const w = scene('combat', { autoplay: true });
  const said = new Set();
  run(w, 30, null, (ww) => { for (const f of ww.fx) if (f.type === 'speech') said.add(f.text); });
  const alive = w.aliens.filter((a) => !a.dead && ['skitterer', 'spitter'].includes(a.type) && a.x < tc(15)).length;
  ok(alive === 0, alive + ' aliens left in the room');
  ok(!w.player.dead && !w.humans[1].dead, 'squad died');
  ok(said.size >= 2, 'callouts: ' + [...said].join(' | '));
});
test('squad: retreats from an overwhelming threat instead of standing still', () => {
  const w = scene('empty'), p = w.player;
  const m = w.addMate('park', p.x, p.y); put(m, 8, 12); put(p, 2, 12);
  w.god = true;
  for (let i = 0; i < 6; i++) { const a = spawnAlien(w, 'skitterer', tc(12), tc(10 + (i % 3) * 2)); a.target = m; a.aware = 1; a.lk = { x: m.x, y: m.y, conf: 1, t: 0 }; a.hp = a.maxHp = 400; }
  const b = spawnAlien(w, 'brute', tc(13), tc(12)); b.target = m; b.aware = 1; b.chargeCd = 99;
  const acts = new Set();
  run(w, 4, null, () => acts.add(m.ai.act));
  ok(acts.has('retreat') || acts.has('panic'), 'acts: ' + [...acts]);
});

// ---------- Objectives & full runs ----------
test('objective scene: fetch -> power -> defend completes', () => {
  const w = scene('objective', { autoplay: true });
  ok(until(w, 150, () => !!w.over), 'did not finish');
  ok(w.over.win, 'lost: ' + w.over.reason);
  ok(w.mainPower, 'power should be on');
});
test('power: restoring it lights the ship, opens sealed bulkheads and wakes the dormant', () => {
  const w = new World({ seed: 7, lightEvery: 3 });
  ok(w.mission.comps.includes('blackout') && !w.mainPower, 'seed 7 should start blacked out');
  const p = w.player, fx = w.map.lights.find((l) => l.kind === 'main' && l.room === w.map.start.room), dark = w.light.at(fx.x, fx.y + 20);
  const sleepers = w.aliens.filter((a) => a.sleeping).length;
  ok(sleepers > 0, 'no dormant aliens');
  w.mission.complete(w, w.mission.get('power'));
  run(w, 0.5);
  ok(w.mainPower && w.aliens.filter((a) => a.sleeping).length === 0, 'sleepers remain');
  ok(!w.map.doors.some((d) => d.lock === 'power'), 'power locks remain');
  ok(w.light.at(fx.x, fx.y + 20) > dark + 0.2, 'no brighter');
});
test('full missions: the autopilot finishes each finale type', () => {
  for (const finale of ['shuttle', 'extract', 'scuttle']) {
    let won = 0, tried = 0;
    for (const seed of [2, 7, 11, 4]) {
      tried++;
      const w = new World({ seed, autoplay: true, lightEvery: 3, finale });
      run(w, 1500);
      ok(w.over, finale + ' seed ' + seed + ' timed out in ' + (w.roomAt(w.player.x, w.player.y) || {}).name + ' doing ' + w.player.ai.why);
      if (w.over.win) { won++; break; }
    }
    ok(won > 0, finale + ' never won in ' + tried + ' seeds');
  }
});
test('full missions: 12 seeds run to a result with no crash or stall, most are won', () => {
  let wins = 0, ms = 0, steps = 0;
  const res = [];
  for (let seed = 1; seed <= 12; seed++) {
    const w = new World({ seed, autoplay: true, lightEvery: 3 });
    const t0 = Date.now();
    for (let i = 0; i < 60 * 1500 && !w.over; i++) { w.step(1 / 60, {}); w.fx.length = 0; steps++; }
    ms += Date.now() - t0;
    ok(w.over, 'seed ' + seed + ' never ended (' + w.player.ai.why + ')');
    if (w.over.win) wins++;
    res.push(seed + (w.over.win ? 'W' : 'L') + Math.round(w.time));
  }
  print('         results: ' + res.join(' ') + '   avg step ' + (ms / steps).toFixed(3) + 'ms');
  ok(wins >= 8, 'only ' + wins + '/12 won');
  ok(ms / steps < 1.5, 'sim too slow: ' + (ms / steps).toFixed(3) + 'ms/step');
});
test('restart: a new world after a loss is clean and identical to a fresh one', () => {
  const a = new World({ seed: 5, lightEvery: 9 });
  const snap = JSON.stringify(a.snapshot());
  damageHuman(a, a.player, 999, {}); a.player.bleedout = 0; run(a, 1);
  ok(a.over && !a.over.win, 'should have lost');
  const b = new World({ seed: 5, lightEvery: 9 });
  ok(JSON.stringify(b.snapshot()) === snap, 'restart state differs');
});

print('\n' + pass + ' passed, ' + fail + ' failed' + (fail ? ': ' + failures.join('; ') : ''));
if (fail) quit(1);

// Procedural mission: objective graph, complications, locks, initial population.
import { RNG, TILE, dist, tc } from '../core/util.js';
import { ITEMS, CHARACTERS } from './data.js';
import { addProp, rollLoot } from './gen.js';
import { spawnAlien } from './aliens.js';
import { active, countItem } from './humans.js';
import { addStress } from './combat.js';

const TITLES = { shuttle: 'LAST FLIGHT', extract: 'DEAD AIR', scuttle: 'CLEAN SLATE' };
const BRIEFS = {
  shuttle: 'The shuttle in the hangar still flies. Fuel it, clear it, and get off this ship.',
  extract: 'Nobody knows we are alive. Bring the comms array back and hold until the rescue boat docks.',
  scuttle: 'This thing cannot reach a port. Arm the scuttle charge and be in a pod when it goes.',
};
const COMP_TEXT = { blackout: 'MAIN POWER OFFLINE', fire: 'FIRE ON DECK', lockdown: 'SECURITY LOCKDOWN', infestation: 'HEAVY INFESTATION', air: 'LIFE SUPPORT FAILING', alarm: 'ALARM ACTIVE' };

export function setupMission(world) {
  world.mission = new Mission(world);
}

export class Mission {
  constructor(world, custom) {
    this.objectives = []; this.countdown = -1; this.volT = 0; this.comps = []; this.nestTotal = 0;
    this.title = 'TEST'; this.brief = ''; this.finale = 'test';
    if (!custom) this.build(world);
  }

  build(world) {
    const rng = (this.rng = new RNG(world.seed ^ 0x51ed270b));
    const map = world.map;
    this.objectives = [];
    this.countdown = -1;
    this.volT = 0;
    this.finale = world.opts.finale || rng.pick(['shuttle', 'extract', 'scuttle']);
    const comps = new Set();
    if (rng.chance(0.68)) comps.add('blackout');
    const pool = [['fire', 2], ['lockdown', 2], ['infestation', 3], ['air', 2], ['alarm', 2], ['none', 2]];
    const c2 = rng.weighted(pool);
    if (c2 !== 'none') comps.add(c2);
    if (comps.size < 2 && rng.chance(0.3)) { const c3 = rng.weighted(pool); if (c3 !== 'none') comps.add(c3); }
    if (world.opts.comps) { comps.clear(); world.opts.comps.forEach((c) => comps.add(c)); }
    if (comps.has('alarm') && !map.rooms.some((r) => r.type === 'security')) comps.delete('alarm');
    this.comps = [...comps];
    this.title = TITLES[this.finale];
    this.brief = BRIEFS[this.finale];

    const room = (t) => map.rooms.find((r) => r.type === t);
    for (const r of map.rooms) {
      r.anchor = null;
      for (let y = r.y; y < r.y + r.h && !r.anchor; y++) for (let x = r.x; x < r.x + r.w; x++) if (!map.block[y * map.w + x]) { r.anchor = { x, y }; break; }
    }
    const st = { x: Math.floor(map.start.x / TILE), y: Math.floor(map.start.y / TILE) };
    const reach = (allowed) => world.nav.distField(st.x, st.y, (d) => !d.lock || allowed.has(d.lock));
    const inField = (f, r) => f[r.anchor.y * map.w + r.anchor.x] !== Infinity;
    const startRoom = map.rooms[map.start.room];
    for (const l of map.lights) if (l.room === startRoom.id && l.kind === 'main') l.state = 'ok';

    // A real weapon is always within reach of the start: the first locker you open.
    const startBox = map.props.find((p) => p.room === startRoom.id && p.type === 'locker') || map.props.find((p) => p.room === startRoom.id && p.interact === 'container');
    if (startBox) { const wid = rng.pick(['shotgun', 'smg', 'smg', 'shotgun', 'rifle']); startBox.loot = [{ id: 'w:' + wid, n: 1 }, { id: 'a:' + { shotgun: 'shell', smg: 'light', rifle: 'rifle' }[wid], n: wid === 'shotgun' ? 12 : 36 }, { id: 'battery', n: 1 }]; }
    // --- Locks ---
    const needCmd = this.finale === 'scuttle' || (this.finale === 'shuttle' && rng.chance(0.5));
    const lockRoom = (r, lock) => { for (const di of r.doors) map.doors[di].lock = lock; };
    const armory = room('armory');
    if (armory) lockRoom(armory, 'sec');
    if (comps.has('lockdown')) {
      const cands = rng.shuffle(map.rooms.filter((r) => ['security', 'storage', 'quarters', 'mess'].includes(r.type) && r !== startRoom));
      cands.slice(0, 2).forEach((r) => lockRoom(r, 'sec'));
      const bulk = rng.shuffle(map.doors.filter((d) => d.bulkhead));
      if (bulk[0] && comps.has('blackout')) bulk[0].lock = 'power';
    }
    if (needCmd) lockRoom(room('bridge'), 'cmd');
    let R0 = reach(new Set());
    const count0 = () => map.rooms.filter((r) => !r.corridor && r !== startRoom && inField(R0, r)).length;
    if ((comps.has('blackout') && !inField(R0, room('reactor'))) || count0() < 5) {
      for (const d of map.doors) if (d.lock === 'power') d.lock = null;
      R0 = reach(new Set());
    }
    if (count0() < 4) { for (const d of map.doors) if (d.lock === 'sec' && !(armory && armory.doors.includes(d.id))) d.lock = null; R0 = reach(new Set()); }
    const R1 = reach(new Set(['sec']));
    const Rp = reach(new Set(['power']));
    const dAll = world.nav.distField(st.x, st.y, null);
    this.dAll = dAll;
    const dOf = (r) => dAll[r.anchor.y * map.w + r.anchor.x];
    const plain = (r) => !r.corridor && r !== startRoom && !r.doors.some((di) => map.doors[di].lock);
    const pickRoom = (field, pred, far) => {
      const c = map.rooms.filter((r) => plain(r) && inField(field, r) && (!pred || pred(r)));
      if (!c.length) return null;
      c.sort((p, q) => (far ? dOf(q) - dOf(p) : dOf(p) - dOf(q)));
      return c[rng.int(0, Math.min(c.length - 1, 2))];
    };

    // --- Scenes ---
    const used = new Set([startRoom.id]);
    const corpse = (r, loot, label) => {
      const s = map.freeSpots(r, 1, 1)[0] || map.freeSpots(r, 1, 0)[0];
      if (!s) return null;
      const p = addProp(map, 'corpse', s.x, s.y, rng);
      p.loot = (loot || []).concat(rollLoot('corpse', rng, 1));
      if (label) p.label = label;
      map.addDecal('blood', p.px, p.py, 1.3);
      map.addDecal('bloodtrail', p.px, p.py, 1, rng.range(0, 6.28));
      return p;
    };
    const stand = pickRoom(R0, (r) => dOf(r) > 14, false);
    if (stand) {
      stand.scene = 'laststand'; used.add(stand.id);
      for (const s of map.freeSpots(stand, 3, 1)) map.placeProp(stand, 'barricade', s.x, s.y);
      for (let i = 0; i < 2; i++) { const cp = corpse(stand, i === 0 ? [{ id: 'key_sec', n: 1 }] : null, i === 0 ? 'SECURITY OFFICER' : null); if (i === 0) this.secCorpse = cp; }
      { const s = map.freeSpots(stand, 1, 1)[0]; if (s) { const pk = world.spawnPickup(rng.chance(0.5) ? 'w:rifle' : 'w:shotgun', 1, tc(s.x), tc(s.y), { cool: 0, mag: rng.int(1, 4) }); pk.x = tc(s.x); pk.y = tc(s.y); } }
      for (let i = 0; i < 14; i++) map.addDecal('casings', rng.range(stand.x + 0.5, stand.x + stand.w - 0.5) * TILE, rng.range(stand.y + 0.5, stand.y + stand.h - 0.5) * TILE);
      for (let i = 0; i < 6; i++) map.addDecal('blood', rng.range(stand.x + 0.5, stand.x + stand.w - 0.5) * TILE, rng.range(stand.y + 0.5, stand.y + stand.h - 0.5) * TILE, rng.range(0.8, 1.6));
      this.secRoom = stand;
    } else { const r = pickRoom(R0, null, false); if (r) { this.secCorpse = corpse(r, [{ id: 'key_sec', n: 1 }], 'SECURITY OFFICER'); this.secRoom = r; } }
    const mass = pickRoom(R1, (r) => !used.has(r.id) && dOf(r) > 20, true);
    if (mass) {
      mass.scene = 'massacre'; used.add(mass.id);
      for (let i = 0; i < 3; i++) corpse(mass);
      for (let i = 0; i < 12; i++) map.addDecal(i % 3 ? 'blood' : 'bloodtrail', rng.range(mass.x + 0.5, mass.x + mass.w - 0.5) * TILE, rng.range(mass.y + 0.5, mass.y + mass.h - 0.5) * TILE, rng.range(1, 1.8));
      for (const l of map.lights) if (l.room === mass.id && l.kind === 'main') l.state = rng.chance(0.5) ? 'flicker' : 'dead';
    }

    // --- Objectives ---
    const add = (o) => { o.state = 'locked'; o.progress = 0; o.requires = o.requires || []; this.objectives.push(o); return o; };
    const consoleOf = (r) => map.props[r.console];
    const req = [];
    let power = null;
    if (comps.has('blackout')) {
      power = add({ id: 'power', type: 'console', title: 'RESTORE MAIN POWER', verb: 'ENGAGE MAIN BUS', room: room('reactor'), time: 4 });
      if (rng.chance(0.4)) { const f = add({ id: 'fuse', type: 'fetch', title: 'FIND A REACTOR FUSE', item: 'fuse' }); power.requires.push('fuse'); power.needItem = 'fuse'; f.before = power; }
    }
    const pReq = power ? ['power'] : [];
    const sides = [];
    const sideDefs = {
      data: () => add({ id: 'data', type: 'console', title: 'PULL THE DATA CORE', verb: 'EXTRACT DATA CORE', room: room('lab') || room('server'), time: 5, gives: 'datacore', requires: pReq.slice(), needPower: !!power }),
      nests: () => add({ id: 'nests', type: 'nests', title: 'BURN OUT THE NESTS' }),
      survivor: () => add({ id: 'survivor', type: 'survivor', title: 'REACH THE SURVIVOR' }),
      air: () => add({ id: 'air', type: 'console', title: 'RESTART LIFE SUPPORT', verb: 'START SCRUBBER CYCLE', room: room('lifesupport'), time: 3, defend: 42, requires: pReq.slice(), needPower: !!power }),
    };
    const sidePool = rng.shuffle(['data', 'nests', 'survivor', 'air']);
    if (comps.has('air')) { sidePool.splice(sidePool.indexOf('air'), 1); sides.push(sideDefs.air()); }
    const nSides = this.finale === 'extract' ? rng.int(1, 2) : 1;
    while (sides.length < nSides) sides.push(sideDefs[sidePool.pop()]());
    if (this.finale === 'scuttle' && !sides.some((s) => s.id === 'nests') && rng.chance(0.5)) sides.push(sideDefs.nests());
    if (comps.has('air') && rng.chance(0.5)) { const o = this.objectives.find((q) => q.id === 'air'); add({ id: 'filter', type: 'fetch', title: 'FIND A SCRUBBER FILTER', item: 'filter' }); o.requires.push('filter'); o.needItem = 'filter'; }
    sides.forEach((s) => req.push(s.id));
    const cardObj = () => add({ id: 'card', type: 'fetch', title: 'RECOVER THE COMMAND CARD', item: 'key_cmd' });
    if (this.finale === 'shuttle') {
      add({ id: 'fuel', type: 'fetch', title: 'FIND A FUEL CELL', item: 'fuelcell' });
      const fr = ['fuel'].concat(pReq, req);
      if (needCmd) { cardObj(); add({ id: 'codes', type: 'console', title: 'PULL LAUNCH CODES', verb: 'DOWNLOAD LAUNCH CODES', room: room('bridge'), time: 4, requires: ['card'].concat(pReq), needPower: !!power }); fr.push('codes'); }
      add({ id: 'final', type: 'console', title: 'LAUNCH THE SHUTTLE', verb: 'BEGIN PRE-FLIGHT', room: room('hangar'), time: 3, defend: 36, requires: fr, needItem: 'fuelcell', needPower: !!power, final: true, win: 'THE SHUTTLE CLEARS THE HANGAR. THE CALLIOPE SHRINKS BEHIND YOU.' });
    } else if (this.finale === 'extract') {
      const cr = pReq.slice();
      if (rng.chance(0.7)) { add({ id: 'relay', type: 'fetch', title: 'FIND A RELAY UNIT', item: 'relay' }); cr.push('relay'); }
      add({ id: 'comms', type: 'console', title: 'RESTORE COMMS', verb: 'REBOOT COMMS ARRAY', room: room('comms'), time: 5, requires: cr, needItem: cr.includes('relay') ? 'relay' : null, needPower: !!power });
      add({ id: 'final', type: 'console', title: 'HOLD THE HANGAR FOR EXTRACTION', verb: 'LIGHT THE DOCKING BEACON', room: room('hangar'), time: 3, defend: 70, requires: ['comms'].concat(req), final: true, win: 'DOCKING CLAMPS BITE. HANDS PULL YOU THROUGH THE LOCK. YOU DO NOT LOOK BACK.' });
    } else {
      cardObj();
      add({ id: 'auth', type: 'console', title: 'AUTHORISE THE SCUTTLE', verb: 'ENTER SCUTTLE AUTHORITY', room: room('bridge'), time: 4, requires: ['card'] });
      add({ id: 'arm', type: 'console', title: 'ARM THE SCUTTLE CHARGE', verb: 'ARM SCUTTLE CHARGE', room: room('reactor'), time: 5, requires: ['auth'].concat(pReq, req), startsCountdown: true });
      add({ id: 'final', type: 'console', title: 'REACH THE ESCAPE PODS', verb: 'LAUNCH POD', room: room('pods'), time: 2, requires: ['arm'], final: true, win: 'THE POD KICKS FREE. BEHIND YOU, THE CALLIOPE BECOMES A SECOND SUN.' });
    }
    if (comps.has('alarm')) {
      const sec = room('security');
      add({ id: 'alarm', type: 'console', title: 'SILENCE THE ALARM', verb: 'KILL ALARM', room: sec, time: 2, optional: true });
      const al = rng.pick(map.rooms.filter((r) => r.spine));
      world.alarms.push({ x: al.cx, y: al.cy, t: 3, off: false });
    }
    if (comps.has('lockdown') && this.secRoom && this.secCorpse) add({ id: 'seccard', type: 'fetch', title: 'FIND A SECURITY CARD', item: 'key_sec', optional: true, room: this.secRoom, x: this.secCorpse.px, y: this.secCorpse.py, hint: this.secRoom.name, loc: this.secCorpse, preset: true });
    for (const o of this.objectives) if (o.type === 'console') { o.prop = consoleOf(o.room); o.x = o.prop.px; o.y = o.prop.py; }

    // --- Place key items ---
    const placed = new Set();
    for (const o of this.objectives) {
      if (o.type !== 'fetch' || o.preset) continue;
      const field = o.item === 'key_cmd' ? R1 : R0;
      let r = pickRoom(field, (q) => !placed.has(q.id) && q !== this.secRoom && dOf(q) > 16, true) || pickRoom(field, (q) => !placed.has(q.id), true) || pickRoom(R0, null, true) || map.rooms.find((q) => !q.corridor && q !== startRoom && inField(R0, q)) || startRoom;
      placed.add(r.id);
      o.room = r; o.x = r.cx; o.y = r.cy;
      if (o.item === 'key_cmd') { const p = corpse(r, [{ id: 'key_cmd', n: 1 }], "CAPTAIN'S BODY"); o.loc = p; }
      else {
        const cont = map.props.filter((p) => p.room === r.id && p.interact === 'container' && p.type !== 'corpse');
        if (cont.length && rng.chance(0.6)) { const p = rng.pick(cont); p.loot.push({ id: o.item, n: 1 }); o.loc = p; }
        else { const s = map.freeSpots(r, 1, 1)[0] || r.anchor; o.pick = world.spawnPickup(o.item, 1, tc(s.x), tc(s.y), { cool: 0 }); o.pick.x = tc(s.x); o.pick.y = tc(s.y); }
      }
      o.hint = r.name;
    }

    // --- Complication effects ---
    if (comps.has('blackout')) { world.mainPower = false; for (let i = 0; i < world.power.length; i++) world.power[i] = false; world.light.dirty = true; }
    if (comps.has('air')) world.airDecay = 100 / 460;
    if (comps.has('fire')) {
      const c = rng.pick(map.rooms.filter((r) => r.corridor && dOf(r) > 18)) || rng.pick(map.rooms.filter((r) => r.corridor));
      const fx = c.cx + rng.range(-20, 20), fy = c.cy, lane = rng.chance(0.5) ? 1 : -1;
      // Burn two of the corridor's three lanes: passable, but only single file along one wall.
      for (let i = 0; i < 16; i++) world.addFire(fx + rng.range(-26, 26), fy + (c.spine ? lane * rng.range(-4, 18) : rng.range(-20, 20)), 260, true);
      for (let i = 0; i < 5; i++) map.addDecal('scorch', fx + rng.range(-30, 30), fy + rng.range(-20, 20), 1.4);
    }
    const corr = map.rooms.filter((r) => r.spine && dOf(r) > 10);
    for (let i = 0; i < rng.int(2, 4) && corr.length; i++) {
      const c = rng.pick(corr), s0 = map.freeSpots(c, 1, 0)[0];
      if (!s0) continue;
      const s = { x: s0.x, y: rng.chance(0.5) ? c.y : c.y + c.h - 1 };
      if (map.block[s.y * map.w + s.x] || map.choke[s.y * map.w + s.x]) continue;
      world.arcs.push({ x: tc(s.x), y: tc(s.y), section: c.section, ph: rng.range(0, 4), on: false });
      map.addDecal('arcpanel', tc(s.x), tc(s.y), 1, 0);
    }

    // --- Population ---
    const eu = (r) => Math.hypot(r.cx - map.start.x, r.cy - map.start.y);
    const far = map.rooms.filter((r) => !r.corridor && r !== startRoom && dOf(r) > 30 && eu(r) > 380 && r.anchor).sort((p, q) => dOf(q) - dOf(p));
    const spot = (r) => { const s = map.freeSpots(r, 1, 1)[0] || map.freeSpots(r, 1, 0)[0] || r.anchor; return { x: tc(s.x), y: tc(s.y) }; };
    const dormant = comps.has('blackout');
    let nNests = 2 + (comps.has('infestation') ? 1 : 0);
    const nestRooms = far.filter((r) => ['storage', 'cargo', 'hydro', 'quarters', 'mess', 'maint', 'server', 'security', 'lab'].includes(r.type) && !used.has(r.id) && !placed.has(r.id) && plain(r) && inField(Rp, r) && eu(r) > 540);
    rng.shuffle(nestRooms);
    this.nestTotal = 0;
    for (const r of nestRooms.slice(0, nNests)) {
      const p = spot(r);
      r.scene = 'nest'; used.add(r.id);
      const n = spawnAlien(world, 'nest', p.x, p.y);
      this.nestTotal++;
      for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
        const tx = Math.floor(p.x / TILE) + x, ty = Math.floor(p.y / TILE) + y;
        if (x * x + y * y <= 10 && tx > 0 && ty > 0 && tx < map.w && ty < map.h && map.roomId[ty * map.w + tx] === r.id) map.organic[ty * map.w + tx] = 1;
      }
      for (let i = 0; i < 2; i++) { const q = spot(r); const a = spawnAlien(world, 'skitterer', q.x, q.y, { home: p, leash: 200, sleeping: dormant }); a.nest = n; }
      for (const l of map.lights) if (l.room === r.id && l.kind === 'main') l.state = 'dead';
      for (let i = 0; i < 5; i++) map.addDecal('egg', p.x + rng.range(-34, 34), p.y + rng.range(-34, 34));
    }
    const anyFar = (minD) => { const c = far.filter((r) => dOf(r) > minD && r.scene !== 'nest'); return c.length ? rng.pick(c) : far[0]; };
    if (far.length) {
      for (let i = 0; i < (comps.has('infestation') ? 2 : 1); i++) { const p = spot(anyFar(34)); spawnAlien(world, 'lurker', p.x, p.y); }
      if (rng.chance(0.75)) { const p = spot(anyFar(50)); spawnAlien(world, 'brute', p.x, p.y, { sleeping: true, home: p, leash: 260 }); }
      for (let i = 0; i < (comps.has('infestation') ? 2 : 1); i++) { const p = spot(anyFar(30)); spawnAlien(world, 'spitter', p.x, p.y, { home: p, leash: 200 }); }
      { const r = nestRooms[0] || anyFar(36); const p = spot(r); spawnAlien(world, 'shrieker', p.x, p.y, { home: p, leash: 120 }); }
      const mid = map.rooms.filter((r) => !r.corridor && dOf(r) > 26 && dOf(r) < 60 && eu(r) > 330 && r.scene !== 'nest' && r !== startRoom);
      for (let i = 0; i < 1 + (comps.has('infestation') ? 1 : 0) && mid.length; i++) { const r = rng.pick(mid); for (let k = 0; k < 2; k++) { const p = spot(r); spawnAlien(world, 'skitterer', p.x, p.y, { home: { x: r.cx, y: r.cy }, leash: 160 }); } }
    }
    const sv = this.objectives.find((o) => o.type === 'survivor');
    if (sv) { const r = pickRoom(Rp, (q) => !used.has(q.id) && dOf(q) > 22, true) || pickRoom(R0, null, true) || far[0]; const p = spot(r); sv.room = r; sv.x = p.x; sv.y = p.y; sv.hint = r.name; }
    this.refresh(world, true);
    world.emit('brief', { title: this.title, text: this.brief, comps: this.comps.map((c) => COMP_TEXT[c]) });
  }

  get(id) { return this.objectives.find((o) => o.id === id); }

  refresh(world, silent) {
    for (const o of this.objectives) {
      if (o.state !== 'locked') continue;
      if (o.requires.every((r) => { const q = this.get(r); return !q || q.state === 'done'; })) {
        o.state = 'active';
        if (!silent) world.emit('objectiveNew', { title: o.title });
      }
    }
  }

  complete(world, o) {
    if (o.state === 'done') return;
    o.state = 'done'; o.progress = 1;
    world.emit('objective', { title: o.title, final: !!o.final });
    for (const h of world.humans) addStress(h, -18);
    const m = world.mates().find(active);
    if (m && !o.final) world.say(m, 'objdone', true);
    world.director && world.director.onObjective(world);
    if (o.id === 'power') {
      world.setMainPower(true);
      const woke = world.director ? world.director.onPower(world, { x: o.x, y: o.y }) : 0;
      world.msg(woke ? 'MAIN BUS LIVE. SOMETHING ON THIS DECK JUST WOKE UP.' : 'MAIN BUS LIVE.', woke ? 'bad' : 'good');
      if (m) world.say(m, 'power', true);
    } else if (o.id === 'air') { world.airDecay = 0; world.msg('SCRUBBERS ONLINE. AIR RECOVERING.', 'good'); }
    else if (o.id === 'comms') { for (const r of world.map.rooms) r.visited = true; world.revealMap = true; world.msg('COMMS UP. RESCUE BOAT INBOUND. DECK PLANS DOWNLOADED.', 'good'); }
    else if (o.id === 'alarm') { for (const a of world.alarms) a.off = true; world.msg('ALARM SILENCED', 'good'); }
    else if (o.gives) { world.keys[o.gives] = true; world.msg('RECOVERED: ' + ITEMS[o.gives].name, 'good'); }
    if (o.startsCountdown) {
      const pods = this.get('final');
      const d = this.dAll ? world.nav.distField(Math.floor(o.x / TILE), Math.floor(o.y / TILE), null)[world.map.rooms[pods.room.id].anchor.y * world.map.w + world.map.rooms[pods.room.id].anchor.x] : 100;
      this.countdown = Math.round(70 + (d * TILE) / 62 * 2.1);
      world.frenzy = true;
      world.director.threat = Math.max(world.director.threat, 2.4);
      world.director.startWave(null, 16);
      world.alarms.push({ x: o.x, y: o.y, t: 0, off: false });
      world.msg('SCUTTLE ARMED. ' + this.countdown + ' SECONDS. RUN.', 'bad');
    }
    if (o.final) { world.director && world.director.stopWave(); world.end(true, o.win); return; }
    this.refresh(world);
  }

  consoleAction(world, prop, h) {
    for (const o of this.objectives) {
      if (o.type !== 'console' || o.prop !== prop || o.state !== 'active') continue;
      if (o.defending) return { label: 'CYCLE RUNNING: HOLD THE ROOM', disabled: true, time: 1, obj: o.id };
      if (o.needPower && !world.power[o.room.section]) return { label: o.verb + ': NO POWER', disabled: true, time: 1, obj: o.id };
      if (o.needItem && !world.keys[o.needItem]) return { label: 'REQUIRES ' + ITEMS[o.needItem].name, disabled: true, time: 1, obj: o.id };
      return { label: o.verb, time: o.time, obj: o.id };
    }
    return null;
  }

  consoleDone(world, prop, h, id) {
    const o = this.get(id);
    if (!o || o.state !== 'active') return;
    if (o.defend) {
      o.defending = true; o.dt = 0;
      world.director && world.director.startWave({ x: o.x, y: o.y }, 17);
      world.msg(o.final ? 'HOLD THE HANGAR. ' + o.defend + ' SECONDS.' : 'CYCLE STARTED. DEFEND THE ROOM.', 'warn');
      world.emit('defendStart', { x: o.x, y: o.y });
      const m = world.mates().find(active);
      if (m) world.say(m, 'hold', true);
    } else this.complete(world, o);
  }

  taskNear(world, x, y) {
    for (const o of this.objectives) if (o.type === 'console' && o.state === 'active' && !o.defending && dist(o.x, o.y, x, y) < 30) return { prop: o.prop, obj: o.id };
    return null;
  }
  taskValid(world, t) { const o = this.get(t.obj); return !!o && o.state === 'active' && !o.defending; }
  onNestKilled() {}
  onItem(world, id, h) {
    if (h.isPlayer || true) world.msg('RECOVERED: ' + ITEMS[id].name, 'good');
  }

  update(world, dt) {
    for (const o of this.objectives) {
      if (o.state !== 'active') continue;
      if (o.type === 'fetch') { if (world.keys[o.item]) this.complete(world, o); }
      else if (o.type === 'nests') {
        let n = 0;
        for (const a of world.aliens) if (!a.dead && a.type === 'nest') n++;
        o.count = this.nestTotal - n; o.total = this.nestTotal; o.progress = this.nestTotal ? o.count / this.nestTotal : 1;
        if (n === 0) this.complete(world, o);
        else if (world.tick % 30 === 0) { let best = null, bd = 1e9; for (const a of world.aliens) if (!a.dead && a.type === 'nest') { const d = dist(a.x, a.y, world.player.x, world.player.y); if (d < bd) { bd = d; best = a; } } o.x = best.x; o.y = best.y; o.room = world.roomAt(best.x, best.y); o.hint = o.room ? o.room.name : ''; }
      } else if (o.type === 'survivor') {
        for (const h of world.humans) if (active(h) && dist(h.x, h.y, o.x, o.y) < 46 && world.nav.los(h.x, h.y, o.x, o.y)) {
          const s = world.addMate('survivor', o.x, o.y);
          s.x = o.x; s.y = o.y; s.stress = 60; s.hp = 70;
          world.say(s, 'joined', true);
          world.msg(CHARACTERS.survivor.full.toUpperCase() + ' JOINS THE SQUAD', 'good');
          this.complete(world, o);
          break;
        }
      } else if (o.defending) {
        let present = false;
        for (const h of world.humans) if (active(h) && (world.roomAt(h.x, h.y) === o.room || dist(h.x, h.y, o.x, o.y) < 110)) present = true;
        if (present) o.dt += dt; else if (world.tick % 120 === 0) world.msg('CYCLE PAUSED: NOBODY IN THE ROOM', 'warn');
        o.progress = o.dt / o.defend;
        if (world.tick % 100 === 0) world.noise(o.x, o.y, 280, 'machine', null);
        if (o.dt >= o.defend) { o.defending = false; world.director && world.director.stopWave(); this.complete(world, o); }
      }
    }
    if (this.countdown > 0) {
      const before = this.countdown;
      this.countdown -= dt;
      for (const mark of [120, 90, 60, 30, 10]) if (before > mark && this.countdown <= mark) world.msg('SCUTTLE IN ' + mark + ' SECONDS', 'bad');
      if (this.countdown <= 0) { world.emit('explode', { x: world.player.x, y: world.player.y, r: 200 }); world.end(false, 'THE CALLIOPE TOOK YOU WITH HER'); }
    }
    // A badly hurt squad with nothing to treat it turns the medbay into an objective of its own.
    if (world.tick % 60 === 0) {
      const squad = world.humans.filter((h) => !h.dead);
      const meds = squad.some((h) => h.belt.some((b) => b.id === 'medkit' || b.id === 'bandage'));
      const hurt = squad.some((h) => h.downed || h.bleed >= 2 || (h.hp < 30 && !meds));
      let med = this.get('medical');
      if (hurt && !meds && !med) {
        const st = world.map.props.find((p) => p.type === 'medstation' && (p.charges === undefined || p.charges > 0));
        if (st) { med = { id: 'medical', type: 'medical', title: 'MEDICAL EMERGENCY', optional: true, state: 'active', progress: 0, requires: [], x: st.px, y: st.py, room: world.map.rooms[st.room], hint: world.map.rooms[st.room].name + ' AUTO-DOC', okT: 0 }; this.objectives.push(med); world.emit('objectiveNew', { title: med.title }); world.msg('SQUAD CRITICAL AND OUT OF SUPPLIES. THE MEDBAY HAS AN AUTO-DOC.', 'warn'); }
      } else if (med && med.state === 'active' && !hurt) { if (++med.okT >= 3) { med.state = 'done'; med.id = 'medical_done'; world.emit('objective', { title: med.title }); } }
    }
    // Volunteer for long, non-defence console work when the leader is close and it is quiet.
    if (world.tick % 20 === 0) {
      const p = world.player;
      for (const o of this.objectives) {
        if (o.type !== 'console' || o.state !== 'active' || o.defend || o.time < 3.5 || o.optional) continue;
        const near = dist(p.x, p.y, o.x, o.y) < 110 && world.roomAt(p.x, p.y) === o.room;
        const act = near && this.consoleAction(world, o.prop, p);
        if (!act || act.disabled || p.useKey === 'pr' + o.prop.id || world.mates().some((m) => m.ai.task)) { this.volT = 0; continue; }
        this.volT += 20 / 60;
        if (this.volT > 2.5) {
          const c = world.mates().filter((m) => active(m) && m.ai.pressure === 0 && m.panicT <= 0).sort((a, b) => (b.char.engineer ? 1 : 0) - (a.char.engineer ? 1 : 0))[0];
          if (c) { c.ai.task = { prop: o.prop, obj: o.id }; world.say(c, 'objective', true); }
          this.volT = 0;
        }
      }
    }
  }

  // HUD list.
  visible() { return this.objectives.filter((o) => o.state !== 'locked'); }

  // Next thing the autopilot should walk to.
  botGoal(world, h) {
    const urgent = this.countdown > 0 || world.air < 45;
    let best = null, bs = 1e9;
    for (const o of this.objectives) {
      if (o.state !== 'active' || o.optional || (o.botSkipT || 0) > world.time) continue;
      let g = null;
      if (o.type === 'console') {
        if (o.defending) g = { kind: 'wait', x: o.x, y: o.y, stop: 34 };
        else { const act = this.consoleAction(world, o.prop, h); if (act && !act.disabled) g = { kind: 'console', prop: o.prop, x: o.x, y: o.y, stop: 13 }; }
      } else if (o.type === 'fetch') {
        const pk = world.pickups.find((p) => p.item === o.item);
        if (pk) g = { kind: 'search', x: pk.x, y: pk.y, stop: 9 };
        else if (o.loc && !o.loc.searched) g = { kind: 'search', x: o.loc.px, y: o.loc.py, stop: 13 };
        else g = { kind: 'room', x: o.x, y: o.y, stop: 20 };
      } else if (o.type === 'nests') {
        g = { kind: 'nest', x: o.x, y: o.y, stop: 60 };
        for (const a of world.aliens) if (!a.dead && a.type === 'nest' && dist(a.x, a.y, h.x, h.y) < 130) { h.ai.focus = a; h.ai.focusT = 5; for (const m of world.mates()) if (m.ai.pressure < 1) { m.ai.focus = a; m.ai.focusT = 5; } }
      } else if (o.type === 'survivor') g = { kind: 'room', x: o.x, y: o.y, stop: 20 };
      if (!g) continue;
      const pri = (o.defending ? -1000 : 0) + (o.id === 'power' ? -400 : 0) + (o.id === 'air' ? -200 : 0) + dist(h.x, h.y, g.x, g.y) * 0.3 + (o.type === 'fetch' ? -150 : 0);
      g.o = o;
      if (pri < bs) { bs = pri; best = g; }
    }
    if (best) best.urgent = urgent;
    return best;
  }
}

export { COMP_TEXT, countItem };

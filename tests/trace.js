import { World } from '../src/sim/world.js';
const seed = globalThis.SEED || 1;
const w = new World({ seed, autoplay: true, lightEvery: 3 });
print(w.mission.finale, w.mission.comps.join(','), w.mission.objectives.map(o => o.id + '@' + (o.room ? o.room.name : '?')).join(' '));
for (let i = 0; i < 60 * 60 * 25 && !w.over; i++) {
  w.step(1 / 60, {});
  for (const f of w.fx) { if (f.type === 'objective' || f.type === 'down' || f.type === 'humanDeath' || f.type === 'msg' && f.kind !== 'loot' && f.kind !== 'dim') print('  ', w.time.toFixed(0), f.type, f.title || f.text || f.id); }
  w.fx.length = 0;
  if (i % (60 * (globalThis.EVERY || 30)) === 0) { const s = w.snapshot(); const p = s.player; print(s.time, s.room, p.act, p.why, 'hp', p.hp, 'st', p.stress, p.weapon, p.mag, JSON.stringify(p.ammo), '| squad', s.squad.map(q => q.name[0] + q.hp + (q.downed ? 'D' : '') + ':' + q.act).join(' '), '| aliens', s.aliens.length, 'dir', s.director.phase, s.director.threat); }
}
print(JSON.stringify(w.over), JSON.stringify(w.stats));

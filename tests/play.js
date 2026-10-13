import { World } from '../src/sim/world.js';
const seeds = (globalThis.SEEDS || [1, 2, 3, 4, 5, 6]);
for (const seed of seeds) {
  const t0 = Date.now();
  let w;
  try { w = new World({ seed, autoplay: true, lightEvery: 3 }); } catch (e) { print('seed', seed, 'GEN FAIL', e, e.stack); continue; }
  const log = [];
  let last = '';
  try {
    for (let i = 0; i < 60 * 60 * 25 && !w.over; i++) {
      w.step(1 / 60, {});
      for (const f of w.fx) if (f.type === 'objective') log.push(Math.round(w.time) + 's ' + f.title);
      w.fx.length = 0;
    }
  } catch (e) { print('seed', seed, 'CRASH at', w.time.toFixed(1), e, e.stack); continue; }
  const s = w.snapshot();
  print('seed', seed, w.mission.finale, '[' + w.mission.comps.join(',') + ']', w.over ? (w.over.win ? 'WIN' : 'LOSS: ' + w.over.reason) : 'TIMEOUT', 't=' + Math.round(w.time) + 's', 'kills', w.stats.kills, 'downs', w.stats.downs, 'deaths', w.stats.deaths, 'ff', w.stats.friendlyHits, 'panics', w.stats.panics, 'stuck', w.perf.stucks || 0, 'ms', Date.now() - t0);
  print('   ', log.join(' | '));
  if (!w.over || !w.over.win) print('    player', JSON.stringify({ act: s.player.act, why: s.player.why, room: s.room, hp: s.player.hp, ammo: s.player.ammo, x: s.player.x, y: s.player.y }), 'pending', s.objectives.filter(o => o.state === 'active').map(o => o.id).join(','));
}

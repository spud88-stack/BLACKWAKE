import { World } from '../src/sim/world.js';
const w = new World({ seed: globalThis.SEED, autoplay: true, lightEvery: 3 });
const T0 = globalThis.T0, T1 = globalThis.T1;
for (let i = 0; i < 60 * T1 && !w.over; i++) {
  w.step(1 / 60, {}); w.fx.length = 0;
  if (w.time > T0 && i % (globalThis.N || 30) === 0) { const p = w.player, a = p.ai; print(w.time.toFixed(1), Math.round(p.x), Math.round(p.y), 'hp', Math.round(p.hp), a.act, a.why, 'goal', Math.round(a.goalX || 0), Math.round(a.goalY || 0), 'noPath', a.noPath || 0, 'fires', w.fires.length, 'prompt', JSON.stringify((w.findInteract(p, false) || {}).label), globalThis.EXTRA ? globalThis.EXTRA(w) : ''); }
}

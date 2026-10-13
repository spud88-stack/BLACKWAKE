import { World } from '../src/sim/world.js';
const t0 = Date.now();
const w = new World({ seed: 1234, autoplay: true, lightEvery: 3 });
print('gen ms', Date.now() - t0, 'rooms', w.map.rooms.length, 'doors', w.map.doors.length, 'vents', w.map.vents.length, 'props', w.map.props.length, 'lights', w.map.lights.length);
print('mission', w.mission.finale, w.mission.comps.join(','), w.mission.objectives.map(o => o.id + ':' + o.state).join(' '));
print('aliens', w.aliens.length);
const t1 = Date.now();
for (let i = 0; i < 60 * 60; i++) { w.step(1 / 60, {}); if (w.over) break; }
print('sim 60s ms', Date.now() - t1);
print(JSON.stringify(w.snapshot(), null, 0).slice(0, 1500));

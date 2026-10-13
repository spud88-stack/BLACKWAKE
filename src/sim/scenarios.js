// Named debug scenes: small deterministic arenas for testing specific situations.
import { TILE, tc } from '../core/util.js';
import { emptyMap, finishMap, addDoor, addProp, T_FLOOR, T_WALL } from './gen.js';
import { RNG } from '../core/util.js';
import { spawnAlien } from './aliens.js';
import { addItem, giveWeapon } from './humans.js';
import { Mission } from './mission.js';
import { Director } from './director.js';

const ARENA = [
  '########################################',
  '#..............#...........#...........#',
  '#..............#...........#...........#',
  '#...cc.........D...........D.....T.....#',
  '#...cC.........#....CC.....#...........#',
  '#..............#....cc.....#...........#',
  '#..............#...........#.....v.....#',
  '#.......L......#...........#...........#',
  '####D###########.....v.....#####D#######',
  '#..............#...........#...........#',
  '#..............D...........D...........#',
  '#..............#...........#...........#',
  '#....v.........########D####...........#',
  '#..............#...........#....cc.....#',
  '#.......M......#...........#....cc.....#',
  '#..............#.....T.....#...........#',
  '########################################',
];

export const SCENES = ['combat', 'pursuit', 'squad', 'objective', 'inventory', 'stress', 'injured', 'horde'];

function arena(world, lit) {
  const h = ARENA.length, w = ARENA[0].length;
  const m = emptyMap(w, h);
  const rng = new RNG(7);
  const room = { id: 0, x: 1, y: 1, w: w - 2, h: h - 2, type: 'storage', corridor: false, section: 0, doors: [], name: 'TEST ARENA', scene: null, console: -1, damage: 0, visited: true };
  m.rooms.push(room);
  const todo = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = ARENA[y][x], i = y * w + x;
    m.tiles[i] = c === '#' ? T_WALL : T_FLOOR;
    m.roomId[i] = 0;
    if (c === 'D') { const d = addDoor(m, x, y, ARENA[y][x - 1] === '#' ? 'h' : 'v', 0, 0); room.doors.push(d.id); }
    else if (c !== '#' && c !== '.') todo.push([c, x, y]);
  }
  finishMap(m);
  const map = { c: 'crate', C: 'crate2', T: 'objconsole', L: 'locker', M: 'medcab' };
  for (const [c, x, y] of todo) {
    if (c === 'v') { m.vents.push({ id: m.vents.length, x, y, px: tc(x), py: tc(y), room: 0, sealed: false, rattle: 0 }); m.ventAt[y * w + x] = 1; }
    else addProp(m, map[c], x, y, rng);
  }
  for (let y = 4; y < h; y += 5) for (let x = 5; x < w; x += 8) m.lights.push({ id: m.lights.length, x: x * TILE, y: y * TILE, r: 80, col: [0.7, 0.8, 0.95], kind: 'main', room: 0, section: 0, state: 'ok', phase: x, inten: 1, off: !lit });
  for (const d of m.doors) { m.choke[d.y * w + d.x] = 1; }
  m.start = { x: tc(4), y: tc(10), room: 0 };
  m.placeProp = () => null; m.freeSpots = () => []; m.addDecal = (k, x, y, s, a) => m.decals.push({ k, x, y, s: s || 1, a: a || 0 });
  world.map = m;
  world.initMap();
  return m;
}

export function buildScene(world, name) {
  const lit = !['pursuit', 'stress', 'dark'].includes(name);
  arena(world, lit);
  world.scene = name;
  world.director = new Director(world);
  world.director.enabled = false;
  const P = (x, y) => ({ x: tc(x), y: tc(y) });
  const al = (type, x, y, o) => spawnAlien(world, type, tc(x), tc(y), o);
  const alert = (a) => { a.aware = 1; a.target = world.player; a.lk = { x: world.player.x, y: world.player.y, t: 0, conf: 1 }; return a; };
  if (name === 'empty' || name === 'dark') {
    world.spawnSquad([]);
  } else if (name === 'combat') {
    world.spawnSquad(['okafor']);
    giveWeapon(world.player, 'rifle', true);
    world.player.cur = 1;
    for (let i = 0; i < 5; i++) alert(al('skitterer', 11 + (i % 3), 10 + i));
    alert(al('spitter', 13, 14));
    al('skitterer', 20, 3); al('skitterer', 21, 4); al('brute', 24, 11);
  } else if (name === 'pursuit') {
    world.spawnSquad([]);
    const l = al('lurker', 22, 11); l.lk = { x: world.player.x, y: world.player.y, t: 0, conf: 0.9 }; l.aware = 0.8;
    al('brute', 33, 11);
  } else if (name === 'squad') {
    world.spawnSquad(['okafor', 'lindqvist', 'havel']);
    world.mission = new Mission(world, true);
    const tour = [P(20, 10), P(33, 4), P(33, 12), P(20, 14), P(6, 14), P(6, 3)];
    let ti = 0;
    world.mission.botGoal = (w, h) => { const g = tour[ti % tour.length]; if (Math.hypot(h.x - g.x, h.y - g.y) < 18) ti++; w.tourLaps = Math.floor(ti / tour.length); return { kind: 'room', x: g.x, y: g.y, stop: 10 }; };
  } else if (name === 'objective') {
    world.spawnSquad(['havel', 'park']);
    const M = (world.mission = new Mission(world, true));
    const consoles = world.map.props.filter((p) => p.type === 'objconsole');
    world.spawnPickup('fuse', 1, tc(10), tc(5), { cool: 0 });
    world.setMainPower(false);
    M.objectives.push({ id: 'fuse', type: 'fetch', title: 'FIND A REACTOR FUSE', item: 'fuse', state: 'active', progress: 0, requires: [], x: tc(10), y: tc(5), room: world.map.rooms[0] });
    M.objectives.push({ id: 'power', type: 'console', title: 'RESTORE MAIN POWER', verb: 'ENGAGE MAIN BUS', room: world.map.rooms[0], prop: consoles[0], x: consoles[0].px, y: consoles[0].py, time: 4, needItem: 'fuse', state: 'locked', progress: 0, requires: ['fuse'] });
    M.objectives.push({ id: 'final', type: 'console', title: 'START THE CYCLE', verb: 'START CYCLE', room: world.map.rooms[0], prop: consoles[1], x: consoles[1].px, y: consoles[1].py, time: 2, defend: 15, needPower: true, state: 'locked', progress: 0, requires: ['power'], final: true, win: 'OBJECTIVE SCENE COMPLETE' });
    al('skitterer', 30, 13, { sleeping: true }); al('skitterer', 31, 14, { sleeping: true });
  } else if (name === 'inventory') {
    world.spawnSquad(['lindqvist']);
    const items = ['w:shotgun', 'w:smg', 'w:arc', 'w:flamer', 'medkit', 'bandage', 'stim', 'flare', 'grenade', 'lure', 'battery', 'welder', 'armor', 'tracker', 'a:shell', 'a:light', 'a:cell', 'a:fuel', 'a:rifle'];
    items.forEach((it, i) => { const p = world.spawnPickup(it, it.startsWith('a:') ? 20 : it === 'grenade' || it === 'flare' ? 2 : 1, 0, 0, { cool: 0 }); p.x = tc(3 + (i % 7) * 1.6); p.y = tc(12 + Math.floor(i / 7) * 1.5); });
  } else if (name === 'stress') {
    world.spawnSquad(['park', 'lindqvist']);
    world.player.stress = 78;
    world.humans[1].stress = 86;
    addItem(world, world.player, 'stim', 2);
    al('shrieker', 22, 10);
    for (let i = 0; i < 3; i++) al('skitterer', 30 + i, 11);
  } else if (name === 'injured') {
    world.spawnSquad(['lindqvist', 'okafor', 'park']);
    const [, med, ok, park] = world.humans;
    ok.hp = 0; ok.downed = true; ok.bleedout = 40; ok.x = tc(10); ok.y = tc(11);
    park.hp = 34; park.bleed = 2; park.leg = true; park.belt = [];
    world.player.hp = 50; world.player.bleed = 1; world.player.arm = true;
    addItem(world, world.player, 'medkit', 1);
    med.x = tc(6); med.y = tc(13);
  } else if (name === 'horde') {
    world.spawnSquad(['okafor', 'havel', 'amari']);
    giveWeapon(world.player, 'flamer', true);
    world.player.ammo.fuel = 200; world.player.cur = 1;
    addItem(world, world.player, 'grenade', 3);
    const n = al('nest', 33, 12); n.agit = 999;
    for (let i = 0; i < 9; i++) alert(al('skitterer', 28 + (i % 5), 9 + Math.floor(i / 5) * 2));
    alert(al('brute', 34, 4));
    alert(al('spitter', 36, 10));
  }
}

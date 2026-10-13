// Pacing director: build / peak / relax, bounded spawning through vents, ambient unease.
import { dist, lerp } from '../core/util.js';
import { spawnAlien, pickVent } from './aliens.js';
import { active } from './humans.js';
import { PA_LINES } from './lines.js';

export class Director {
  constructor(world) {
    this.rng = world.rng.fork();
    this.phase = 'calm';
    this.t = this.rng.range(30, 42);
    this.threat = 0.6;
    this.intensity = 0;
    this.spawnT = 0;
    this.ambT = 12;
    this.shriekCd = 0;
    this.wave = null;
    this.spawned = 0;
    this.enabled = true;
  }
  cap() { return Math.min(20, Math.round(6 + this.threat * 4)); }
  count(world, type) { let n = 0; for (const a of world.aliens) if (!a.dead && !a.def.static && (!type || a.type === type)) n++; return n; }
  centroid(world) {
    let x = 0, y = 0, n = 0;
    for (const h of world.humans) if (active(h)) { x += h.x; y += h.y; n++; }
    return n ? { x: x / n, y: y / n } : { x: world.player.x, y: world.player.y };
  }

  update(world, dt) {
    if (!this.enabled) return;
    const rng = this.rng;
    let s = 0, fighting = false;
    for (const h of world.humans) if (active(h)) { s = Math.max(s, h.stress / 100); if (h.combatT > 0) fighting = true; }
    this.intensity = lerp(this.intensity, Math.max(s, fighting ? 0.6 : 0), Math.min(1, dt * 0.5));
    this.threat += dt * 0.0016;
    this.shriekCd -= dt; this.t -= dt;
    if (this.phase === 'calm') { if (this.t <= 0) this.go('build', rng.range(45, 70)); }
    else if (this.phase === 'build') {
      this.spawnT -= dt;
      if (this.spawnT <= 0) { this.spawnGroup(world); this.spawnT = rng.range(18, 30) / (1 + this.threat * 0.12); }
      if (this.intensity > 0.62 && fighting) this.go('peak', rng.range(14, 22));
      else if (this.t <= 0) this.go('relax', rng.range(28, 40));
    } else if (this.phase === 'peak') { if (this.t <= 0) this.go('relax', rng.range(30, 45), world); }
    else if (this.phase === 'relax') { if (this.t <= 0) this.go('build', rng.range(45, 70)); }
    if (this.wave) {
      this.wave.t -= dt;
      if (this.wave.t <= 0) { this.spawnGroup(world, this.wave.pos, true); this.wave.t = this.wave.every; }
    }
    this.ambT -= dt;
    if (this.ambT <= 0) { this.ambT = rng.range(10, 20); if (this.phase === 'calm' || this.phase === 'relax') this.ambient(world); }
  }

  go(phase, t, world) {
    this.phase = phase; this.t = t; this.spawnT = 2;
    if (phase === 'relax' && world) {
      const c = this.centroid(world);
      for (const a of world.aliens) if (!a.dead && !a.target && !a.home && dist(a.x, a.y, c.x, c.y) > 280) a.lk = null;
    }
  }

  spawnGroup(world, toward, force) {
    const rng = this.rng;
    if (this.count(world) >= this.cap() + (force ? 3 : 0)) return false;
    const p = toward || this.centroid(world);
    const v = pickVent(world, p.x, p.y, { min: 150, max: force ? 420 : 520 });
    if (!v) return false;
    const th = this.threat;
    const type = rng.weighted([
      ['skitterer', 50],
      ['spitter', th > 0.8 ? 14 : 0],
      ['lurker', th > 0.6 && this.count(world, 'lurker') < 2 ? 14 : 0],
      ['brute', th > 1.4 && this.count(world, 'brute') < 2 ? 9 : 0],
      ['shrieker', th > 1 && this.count(world, 'shrieker') < 1 ? 8 : 0],
    ]);
    const n = type === 'skitterer' ? rng.int(2, Math.min(5, 3 + Math.floor(th))) : type === 'spitter' && th > 2 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const a = spawnAlien(world, type, v.px + rng.range(-3, 3), v.py + rng.range(-3, 3), { emerge: true, lk: { x: p.x + rng.range(-60, 60), y: p.y + rng.range(-60, 60) }, conf: force ? 0.9 : 0.5 });
      a.aware = force ? 0.8 : 0.4;
      a.spawnT = 0.4 + i * 0.35;
    }
    this.spawned += n;
    v.rattle = 1;
    world.emit('vent', { x: v.px, y: v.py });
    world.noises.push({ x: v.px, y: v.py, r: 190, kind: 'alien', vent: true });
    return true;
  }

  ambient(world) {
    const rng = this.rng, p = world.player;
    const kind = rng.weighted([['bang', 30], ['vent', 25], ['flicker', world.mainPower ? 20 : 0], ['pa', 12], ['brownout', world.mainPower ? 6 : 0], ['none', 20]]);
    if (kind === 'bang') { const a = rng.range(0, 6.28); world.emit('ambient', { kind: 'bang', x: p.x + Math.cos(a) * 260, y: p.y + Math.sin(a) * 260 }); }
    else if (kind === 'vent') {
      let best = null, bd = 260;
      for (const v of world.map.vents) { const d = dist(v.px, v.py, p.x, p.y); if (d > 50 && d < bd) { bd = d; best = v; } }
      if (best) { best.rattle = 1; world.emit('vent', { x: best.px, y: best.py, fake: true }); world.noises.push({ x: best.px, y: best.py, r: 150, kind: 'alien', vent: true }); }
    } else if (kind === 'flicker') world.light.brownout = 0.5;
    else if (kind === 'pa') world.emit('pa', { text: rng.pick(PA_LINES) });
    else if (kind === 'brownout') { world.light.brownout = rng.range(3, 6); world.msg('POWER FLUCTUATION', 'warn'); world.emit('brownout', {}); }
  }

  onKill() {}
  onShriek(world, a, tg) {
    if (this.shriekCd > 0) return;
    this.shriekCd = 18;
    const v = pickVent(world, tg.x, tg.y, { min: 120, max: 460 });
    if (!v || this.count(world) >= this.cap() + 3) return;
    for (let i = 0; i < 3; i++) { const s = spawnAlien(world, 'skitterer', v.px, v.py, { emerge: true, lk: tg, conf: 0.9 }); s.aware = 0.8; s.spawnT = 0.4 + i * 0.3; }
    world.emit('vent', { x: v.px, y: v.py });
  }
  onPower(world, pos) {
    this.threat += 0.25;
    let woke = 0;
    for (const a of world.aliens) if (!a.dead && a.sleeping) { a.sleeping = false; a.lk = { x: pos.x, y: pos.y, t: world.time, conf: 0.7 }; a.aware = 0.6; woke++; }
    return woke;
  }
  onObjective() { this.threat += 0.2; }
  startWave(pos, every) { this.wave = { pos, every, t: 4 }; }
  stopWave() { this.wave = null; }
}

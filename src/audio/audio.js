// Procedural WebAudio: every sound is synthesised. Positional pan/attenuation/occlusion.
import { clamp, dist } from '../core/util.js';

export class GameAudio {
  constructor() { this.ctx = null; this.muted = false; this.lx = 0; this.ly = 0; this.beatT = 0; this.breathT = 0; this.falseT = 8; this.stepFlip = 0; this.flameT = 0; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.75;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5;
    this.master.connect(comp); comp.connect(ctx.destination);
    // Reverb: generated impulse response.
    const len = Math.floor(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let lp = 0; for (let i = 0; i < len; i++) { const n = Math.random() * 2 - 1; lp += (n - lp) * 0.35; d[i] = lp * Math.pow(1 - i / len, 2.6); } }
    this.rev = ctx.createConvolver(); this.rev.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.5;
    this.rev.connect(wet); wet.connect(this.master);
    const nb = (this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // Ambient bed.
    const loopNoise = (type, f, q, g) => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const gn = ctx.createGain(); gn.gain.value = g; s.connect(fl); fl.connect(gn); gn.connect(this.master); s.start(); return { gn, fl }; };
    this.rumble = loopNoise('lowpass', 90, 0.7, 0.16);
    this.air = loopNoise('bandpass', 2600, 0.6, 0.006);
    const osc = (f, type, g) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; const gn = ctx.createGain(); gn.gain.value = g; o.connect(gn); gn.connect(this.master); gn.connect(this.rev); o.start(); return { o, gn }; };
    this.drone = [osc(41.2, 'sine', 0.07), osc(61.9, 'sine', 0.03), osc(82.9, 'triangle', 0.008)];
    this.tension = [osc(207.6, 'sine', 0), osc(220, 'sine', 0), osc(311.1, 'sine', 0)];
    this.hum = osc(120, 'sawtooth', 0);
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 300; this.hum.gn.disconnect(); this.hum.gn.connect(hf); hf.connect(this.master);
  }
  setMute(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.75; }

  // Spatial params for a world position.
  sp(x, y, world, loud = 1) {
    if (x === undefined) return { g: 1, pan: 0, lp: 20000 };
    const dx = x - this.lx, d = Math.hypot(dx, y - this.ly);
    let g = loud / (1 + Math.pow(d / (110 * loud), 2)), lp = 20000;
    if (world && d > 30 && !world.nav.los(this.lx, this.ly, x, y)) { g *= 0.55; lp = 900; }
    return { g, pan: clamp(dx / 180, -1, 1), lp, d };
  }
  out(s, rev = 0) {
    const ctx = this.ctx, pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null, lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = s.lp;
    if (pan) { pan.pan.value = s.pan; lp.connect(pan); pan.connect(this.master); if (rev) { const r = ctx.createGain(); r.gain.value = rev; pan.connect(r); r.connect(this.rev); } }
    else lp.connect(this.master);
    return lp;
  }
  noise(s, o) {
    if (!this.ctx || s.g < 0.004) return;
    const ctx = this.ctx, t = ctx.currentTime + (o.at || 0), src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noiseBuf; src.loop = true;
    f.type = o.type || 'lowpass'; f.frequency.setValueAtTime(o.f || 1000, t); if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur); f.Q.value = o.q || 0.8;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime((o.g || 0.3) * s.g, t + (o.a || 0.004)); g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(this.out(s, o.rev));
    src.start(t, Math.random() * 1.5); src.stop(t + o.dur + 0.05);
  }
  tone(s, o) {
    if (!this.ctx || s.g < 0.004) return;
    const ctx = this.ctx, t = ctx.currentTime + (o.at || 0), osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.f, t); if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    if (o.vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = o.vib; lg.gain.value = o.vibD || 30; l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + o.dur + 0.05); }
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime((o.g || 0.3) * s.g, t + (o.a || 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g); g.connect(this.out(s, o.rev));
    osc.start(t); osc.stop(t + o.dur + 0.05);
  }

  fx(f, world) {
    if (!this.ctx || this.muted) return;
    const P = (loud) => this.sp(f.x, f.y, world, loud), U = { g: 1, pan: 0, lp: 20000 };
    switch (f.type) {
      case 'shot': {
        const s = P(2.2);
        if (f.w === 'pistol') { this.noise(s, { type: 'bandpass', f: 1500, dur: 0.13, g: 0.55, rev: 0.35 }); this.tone(s, { f: 190, f1: 60, dur: 0.09, g: 0.5, type: 'triangle' }); }
        else if (f.w === 'smg') { this.noise(s, { type: 'bandpass', f: 2100, dur: 0.08, g: 0.42, rev: 0.25 }); this.tone(s, { f: 240, f1: 90, dur: 0.05, g: 0.3, type: 'square' }); }
        else if (f.w === 'shotgun') { this.noise(s, { f: 2600, f1: 300, dur: 0.38, g: 0.95, rev: 0.6 }); this.tone(s, { f: 120, f1: 36, dur: 0.22, g: 0.8 }); this.noise(s, { type: 'bandpass', f: 900, dur: 0.07, g: 0.3, at: 0.34 }); }
        else if (f.w === 'rifle') { this.noise(s, { type: 'bandpass', f: 1900, dur: 0.16, g: 0.62, rev: 0.45 }); this.tone(s, { f: 230, f1: 62, dur: 0.1, g: 0.55, type: 'triangle' }); this.noise(s, { type: 'highpass', f: 5000, dur: 0.03, g: 0.3 }); }
        else if (f.w === 'arc') { this.tone(s, { f: 1400, f1: 180, dur: 0.22, g: 0.3, type: 'sawtooth' }); this.noise(s, { type: 'highpass', f: 3500, dur: 0.18, g: 0.35, rev: 0.3 }); }
        else if (f.w === 'flamer') { if (this.ctx.currentTime > this.flameT) { this.flameT = this.ctx.currentTime + 0.09; this.noise(s, { f: 700, f1: 300, dur: 0.22, g: 0.4, a: 0.03 }); } }
        break;
      }
      case 'dry': this.noise(P(), { type: 'highpass', f: 3000, dur: 0.03, g: 0.25 }); break;
      case 'reload': this.noise(P(), { type: 'bandpass', f: 2400, dur: 0.04, g: 0.25 }); this.noise(P(), { type: 'bandpass', f: 1200, dur: 0.06, g: 0.2, at: 0.14 }); break;
      case 'reloadDone': this.noise(P(), { type: 'bandpass', f: 1800, dur: 0.05, g: 0.3 }); this.tone(P(), { f: 320, f1: 180, dur: 0.05, g: 0.15, type: 'square' }); break;
      case 'shell': this.noise(P(), { type: 'bandpass', f: 1300, dur: 0.06, g: 0.3 }); break;
      case 'swap': this.noise(U, { type: 'bandpass', f: 1600, dur: 0.07, g: 0.18 }); break;
      case 'impact': this.noise(P(), { type: 'highpass', f: 2800, dur: 0.05, g: 0.25 }); break;
      case 'ricochet': this.tone(P(), { f: 2600, f1: 900, dur: 0.18, g: 0.2, type: 'triangle' }); break;
      case 'alienHit': this.noise(P(), { type: 'bandpass', f: 520, dur: 0.07, g: 0.35 }); break;
      case 'hitmark': this.tone(U, { f: f.kill ? 520 : 2000, f1: f.kill ? 200 : 1600, dur: f.kill ? 0.09 : 0.025, g: f.kill ? 0.2 : 0.09, type: 'square' }); break;
      case 'alienDeath': { const s = P(1.4), big = f.r > 6; this.tone(s, { f: big ? 240 : 720, f1: big ? 50 : 130, dur: big ? 0.7 : 0.26, g: 0.32, type: 'sawtooth', vib: 38, vibD: 80, rev: 0.4 }); this.noise(s, { type: 'bandpass', f: 700, dur: 0.2, g: 0.3 }); break; }
      case 'humanHit': this.tone(P(1.3), { f: 130, f1: 48, dur: 0.14, g: f.player ? 0.6 : 0.35 }); this.noise(P(1.3), { f: 700, dur: 0.1, g: 0.3 }); break;
      case 'down': case 'humanDeath': this.tone(P(1.5), { f: 200, f1: 40, dur: 0.6, g: 0.4, type: 'triangle', rev: 0.5 }); break;
      case 'step': { const s = P(f.sprint ? 0.9 : 0.6); this.stepFlip ^= 1; if (!f.sneak) this.noise(s, { f: this.stepFlip ? 420 : 520, dur: 0.05, g: f.sprint ? 0.2 : 0.11 }); break; }
      case 'skitter': { const s = P(1.1); for (let i = 0; i < 3; i++) this.noise(s, { type: 'highpass', f: 3600, dur: 0.02, g: 0.16, at: i * 0.035 }); break; }
      case 'thump': this.tone(P(2.4), { f: 62, f1: 32, dur: 0.24, g: 0.7 }); this.noise(P(2.4), { f: 160, dur: 0.14, g: 0.4 }); break;
      case 'roar': { const s = P(3); this.tone(s, { f: 95, f1: 52, dur: 0.85, g: 0.6, type: 'sawtooth', vib: 22, vibD: 14, rev: 0.6 }); this.noise(s, { f: 500, f1: 180, dur: 0.8, g: 0.45, a: 0.08 }); break; }
      case 'slam': this.tone(P(3), { f: 70, f1: 26, dur: 0.5, g: 0.9, rev: 0.6 }); this.noise(P(3), { f: 900, f1: 120, dur: 0.45, g: 0.7, rev: 0.5 }); break;
      case 'swipe': case 'claw': case 'melee': this.noise(P(1.2), { type: 'bandpass', f: 1800, f1: 500, dur: 0.12, g: 0.3 }); break;
      case 'lunge': this.noise(P(), { type: 'highpass', f: 4200, dur: 0.08, g: 0.2 }); this.tone(P(), { f: 900, f1: 1500, dur: 0.07, g: 0.1, type: 'sawtooth' }); break;
      case 'shriekWind': this.tone(P(3), { f: 700, f1: 2600, dur: 1.1, g: 0.25, type: 'sawtooth', a: 0.4 }); break;
      case 'shriek': { const s = P(5); this.tone(s, { f: 2500, f1: 1700, dur: 0.95, g: 0.5, type: 'sawtooth', vib: 60, vibD: 420, rev: 0.9 }); this.tone(s, { f: 3300, f1: 2100, dur: 0.9, g: 0.3, type: 'square', vib: 47, vibD: 300 }); this.noise(s, { type: 'bandpass', f: 3000, dur: 0.9, g: 0.4, rev: 0.6 }); break; }
      case 'hiss': this.noise(P(1.6), { type: 'highpass', f: 4500, dur: 0.5, g: 0.3, a: 0.05 }); break;
      case 'click_alien': { const s = P(2); for (let i = 0; i < 7; i++) this.noise(s, { type: 'bandpass', f: 2200, q: 6, dur: 0.025, g: 0.3, at: i * (0.11 - i * 0.012), rev: 0.5 }); break; }
      case 'lurkerStrike': this.tone(P(2.5), { f: 1300, f1: 2400, dur: 0.3, g: 0.32, type: 'sawtooth', vib: 50, vibD: 200, rev: 0.6 }); break;
      case 'vent': { const s = P(2.2); for (let i = 0; i < 6; i++) this.noise(s, { type: 'bandpass', f: 800 + Math.random() * 500, q: 9, dur: 0.07, g: 0.5, at: i * 0.09 + Math.random() * 0.04, rev: 0.6 }); this.tone(s, { f: 1180, f1: 1100, dur: 0.3, g: 0.06, at: 0.1, rev: 0.6 }); break; }
      case 'emerge': this.noise(P(1.8), { f: 1200, f1: 200, dur: 0.25, g: 0.45 }); break;
      case 'door': { const s = P(1.3); if (f.powered) { this.noise(s, { type: 'highpass', f: 1800, f1: 4200, dur: 0.22, g: 0.2, a: 0.03 }); this.tone(s, { f: 95, f1: 70, dur: 0.1, g: 0.3, at: 0.2 }); } else { this.tone(s, { f: 74, f1: 52, dur: 0.5, g: 0.25, type: 'sawtooth', vib: 13, vibD: 10 }); this.noise(s, { f: 500, dur: 0.14, g: 0.3, at: 0.4 }); } break; }
      case 'pry': this.tone(P(1.3), { f: 60, f1: 90, dur: 0.3, g: 0.2, type: 'sawtooth' }); break;
      case 'unlock': this.tone(P(), { f: 880, dur: 0.07, g: 0.2, type: 'square' }); this.tone(P(), { f: 1320, dur: 0.1, g: 0.2, type: 'square', at: 0.08 }); break;
      case 'doorHit': this.tone(P(3), { f: 84, f1: 38, dur: 0.3, g: 0.8, rev: 0.7 }); this.noise(P(3), { f: 1000, f1: 200, dur: 0.22, g: 0.55, rev: 0.6 }); break;
      case 'doorBreak': this.noise(P(3.5), { f: 2400, f1: 150, dur: 0.7, g: 0.9, rev: 0.7 }); this.tone(P(3.5), { f: 100, f1: 30, dur: 0.5, g: 0.7 }); break;
      case 'explode': { const s = P(6); this.noise(s, { f: 1400, f1: 70, dur: 1.3, g: 1.2, rev: 0.9 }); this.tone(s, { f: 75, f1: 24, dur: 0.9, g: 1 }); break; }
      case 'flareLand': this.noise(P(1.5), { type: 'highpass', f: 2500, dur: 0.6, g: 0.25, a: 0.02 }); break;
      case 'beep': this.tone(P(1.5), { f: 1560, dur: 0.09, g: 0.25, type: 'square' }); break;
      case 'spitWind': this.noise(P(1.5), { type: 'bandpass', f: 400, f1: 900, dur: 0.5, g: 0.3, a: 0.2 }); break;
      case 'spit': this.noise(P(1.5), { type: 'bandpass', f: 900, f1: 300, dur: 0.15, g: 0.4 }); break;
      case 'acidSplash': this.noise(P(1.5), { type: 'highpass', f: 2600, dur: 0.7, g: 0.3 }); break;
      case 'zap': this.noise(P(2), { type: 'highpass', f: 2000, dur: 0.4, g: 0.5 }); this.tone(P(2), { f: 110, dur: 0.4, g: 0.3, type: 'sawtooth', vib: 60, vibD: 40 }); break;
      case 'spark': this.noise(P(), { type: 'highpass', f: 5000, dur: 0.04, g: 0.2 }); break;
      case 'weld': this.noise(P(1.5), { type: 'highpass', f: 3200, dur: 0.6, g: 0.4 }); break;
      case 'pickup': if (f.player) { this.tone(U, { f: 880, dur: 0.05, g: 0.12, type: 'square' }); this.tone(U, { f: 1320, dur: 0.07, g: 0.12, type: 'square', at: 0.05 }); } break;
      case 'open': this.noise(P(), { type: 'bandpass', f: 700, dur: 0.12, g: 0.3 }); break;
      case 'heal': case 'revive': this.tone(P(), { f: 440, f1: 880, dur: 0.3, g: 0.14, type: 'triangle' }); break;
      case 'useStart': this.noise(P(), { type: 'bandpass', f: 2500, dur: 0.2, g: 0.12, a: 0.05 }); break;
      case 'speech': { const s = P(1.6), n = Math.min(9, 3 + Math.floor(f.text.length / 5)); this.noise(s, { type: 'bandpass', f: 2800, dur: 0.03, g: 0.12 }); for (let i = 0; i < n; i++) this.tone(s, { f: f.pitch * (1.8 + Math.random() * 0.9), dur: 0.05, g: 0.085, type: 'triangle', at: 0.04 + i * 0.062 }); break; }
      case 'pa': for (let i = 0; i < 8; i++) this.noise(U, { type: 'bandpass', f: 900 + Math.random() * 900, q: 4, dur: 0.1, g: 0.05, at: i * 0.11, rev: 0.9 }); break;
      case 'msg': if (f.kind === 'bad' || f.kind === 'warn') { this.tone(U, { f: 520, dur: 0.1, g: 0.14, type: 'square' }); this.tone(U, { f: 390, dur: 0.14, g: 0.14, type: 'square', at: 0.12 }); } break;
      case 'objective': [392, 494, 587, 784].forEach((fr, i) => this.tone(U, { f: fr, dur: 0.35, g: 0.13, type: 'triangle', at: i * 0.09, rev: 0.5 })); break;
      case 'objectiveNew': this.tone(U, { f: 660, dur: 0.1, g: 0.12, type: 'triangle' }); this.tone(U, { f: 660, dur: 0.1, g: 0.12, type: 'triangle', at: 0.15 }); break;
      case 'power': if (f.on) { this.tone(U, { f: 40, f1: 120, dur: 1.6, g: 0.4, type: 'sawtooth', a: 0.8, rev: 0.6 }); for (let i = 0; i < 5; i++) this.noise(U, { f: 600, dur: 0.1, g: 0.4, at: 0.5 + i * 0.22, rev: 0.6 }); } break;
      case 'brownout': this.tone(U, { f: 120, f1: 40, dur: 1.2, g: 0.25, type: 'sawtooth' }); break;
      case 'alarm': { const s = P(3.5); this.tone(s, { f: 620, dur: 0.4, g: 0.16, type: 'square', rev: 0.5 }); this.tone(s, { f: 465, dur: 0.4, g: 0.16, type: 'square', at: 0.45, rev: 0.5 }); break; }
      case 'ambient': this.tone(P(6), { f: 70, f1: 34, dur: 0.6, g: 0.5, rev: 1 }); this.noise(P(6), { f: 500, f1: 120, dur: 0.4, g: 0.4, rev: 1 }); break;
      case 'panic': if (f.player) this.noise(U, { type: 'bandpass', f: 1200, dur: 0.5, g: 0.3, a: 0.2 }); break;
      case 'hatch': this.noise(P(1.5), { type: 'bandpass', f: 500, dur: 0.25, g: 0.4 }); break;
      case 'over': if (f.win) [262, 330, 392, 523].forEach((fr, i) => this.tone(U, { f: fr, dur: 1.6, g: 0.14, type: 'triangle', at: i * 0.22, rev: 0.8 })); else this.tone(U, { f: 110, f1: 30, dur: 2.5, g: 0.5, type: 'sawtooth', rev: 0.9 }); break;
      case 'click': this.noise(U, { type: 'highpass', f: 3000, dur: 0.02, g: 0.2 }); break;
      case 'lightDead': this.tone(U, { f: 300, f1: 80, dur: 0.3, g: 0.15, type: 'square' }); break;
      case 'defendStart': this.tone(U, { f: 60, f1: 180, dur: 1.2, g: 0.3, type: 'sawtooth', a: 0.6 }); break;
    }
  }

  ui(kind) {
    if (!this.ctx || this.muted) return;
    const U = { g: 1, pan: 0, lp: 20000 };
    if (kind === 'move') this.tone(U, { f: 700, dur: 0.03, g: 0.08, type: 'square' });
    else if (kind === 'ok') { this.tone(U, { f: 520, dur: 0.06, g: 0.12, type: 'square' }); this.tone(U, { f: 780, dur: 0.1, g: 0.12, type: 'square', at: 0.06 }); }
  }

  update(world, dt) {
    if (!this.ctx) return;
    const p = world.player, t = this.ctx.currentTime;
    this.lx = p.x; this.ly = p.y;
    const st = p.stress / 100, inten = world.director ? world.director.intensity : 0;
    const powered = world.poweredAt(p.x, p.y);
    this.hum.gn.gain.setTargetAtTime(powered ? 0.012 : 0, t, 0.4);
    this.rumble.gn.gain.setTargetAtTime(0.13 + inten * 0.1, t, 1);
    const tg = clamp(Math.max(inten - 0.25, st - 0.35) * 0.05, 0, 0.035);
    this.tension[0].gn.gain.setTargetAtTime(tg, t, 1.5); this.tension[1].gn.gain.setTargetAtTime(tg, t, 1.5); this.tension[2].gn.gain.setTargetAtTime(tg * 0.5 * (st > 0.6 ? 1 : 0), t, 1.5);
    this.tension[1].o.frequency.setTargetAtTime(220 + st * 9, t, 0.5);
    if (this.muted) return;
    const U = { g: 1, pan: 0, lp: 20000 };
    if (st > 0.28 && !p.dead) {
      this.beatT -= dt;
      if (this.beatT <= 0) { this.beatT = 60 / (62 + st * 86); const g = clamp((st - 0.2) * 0.9, 0.08, 0.7); this.tone(U, { f: 58, f1: 40, dur: 0.1, g }); this.tone(U, { f: 50, f1: 36, dur: 0.12, g: g * 0.7, at: 0.13 }); }
    }
    if (st > 0.6 && !p.dead) {
      this.breathT -= dt;
      if (this.breathT <= 0) { this.breathT = 1.5 - st * 0.7; this.noise(U, { type: 'bandpass', f: 1100, dur: 0.45, g: 0.07 + (st - 0.6) * 0.2, a: 0.18 }); this.noise(U, { type: 'bandpass', f: 800, dur: 0.5, g: 0.05 + (st - 0.6) * 0.15, a: 0.15, at: 0.55 }); }
      // Unreliable sounds.
      this.falseT -= dt;
      if (this.falseT <= 0) {
        this.falseT = 5 + Math.random() * 9 - st * 3;
        const a = Math.random() * 6.28, fx = { x: p.x + Math.cos(a) * 110, y: p.y + Math.sin(a) * 110, type: Math.random() < 0.5 ? 'skitter' : Math.random() < 0.5 ? 'click_alien' : 'vent' };
        this.fx(fx, null);
      }
    }
  }
}

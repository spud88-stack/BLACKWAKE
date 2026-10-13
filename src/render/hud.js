// HUD, overlays, menus. Everything is drawn into the same 480x270 buffer as the world.
import { text, textWidth, wrap } from './font.js';
import { S, glow } from './sprites.js';
import { VW, VH } from './renderer.js';
import { WEAPONS, ITEMS, AMMO, BELT_SIZE } from '../sim/data.js';
import { tier, TIER_NAMES, countItem, active } from '../sim/humans.js';
import { RNG, dist, clamp, TILE } from '../core/util.js';
import { COMP_TEXT } from '../sim/mission.js';

const C = { txt: '#d8dde6', dim: '#7c8594', dark: '#0b0d12', panel: 'rgba(8,10,14,0.78)', edge: '#2e3644', amber: '#ffc24a', red: '#ff5a4a', green: '#5fe88a', cyan: '#7fd8ea', blood: '#c8363a' };
const TIER_COL = ['#5fe88a', '#e8d040', '#ff9a3a', '#ff4a3a'];
const KIND_COL = { info: C.txt, loot: '#e8e0b0', warn: C.amber, bad: C.red, good: C.green, dim: C.dim };
const STATUS = { engage: 'FIRING', reload: 'RELOADING', heal: 'TREATING', healAlly: 'MEDIC', revive: 'REVIVING', retreat: 'FALLING BACK', panic: 'PANIC!', task: 'WORKING', hold: 'HOLDING', follow: '', loot: 'LOOTING', share: 'SHARING', hazard: 'HAZARD', regroup: 'CATCHING UP', clearway: '', lead: '' };

function panel(c, x, y, w, h, edge) {
  c.fillStyle = C.panel; c.fillRect(x, y, w, h);
  c.fillStyle = edge || C.edge; c.fillRect(x, y, w, 1); c.fillRect(x, y + h - 1, w, 1); c.fillRect(x, y, 1, h); c.fillRect(x + w - 1, y, 1, h);
  c.fillStyle = '#566175'; c.fillRect(x, y, 3, 1); c.fillRect(x, y, 1, 3); c.fillRect(x + w - 3, y + h - 1, 3, 1); c.fillRect(x + w - 1, y + h - 3, 1, 3);
}
function bar(c, x, y, w, h, f, col, back) {
  c.fillStyle = back || '#1a1e26'; c.fillRect(x, y, w, h);
  c.fillStyle = col; c.fillRect(x, y, Math.round(w * clamp(f, 0, 1)), h);
  c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(x, y, Math.round(w * clamp(f, 0, 1)), 1);
}

export class Hud {
  constructor(renderer) {
    this.r = renderer;
    this.rng = new RNG(1234);
    this.reset();
  }
  reset() {
    this.msgs = []; this.comms = []; this.banner = null; this.logView = null; this.brief = null; this.roomName = ''; this.roomT = 0;
    this.hit = 0; this.kill = 0; this.ecg = 0; this.beat = 0; this.blips = []; this.sweep = 0; this.phantoms = []; this.sel = -1; this.mapHover = null; this.t = 0; this.fade = 1;
  }

  fx(f, world) {
    switch (f.type) {
      case 'msg': this.msgs.push({ text: f.text, kind: f.kind, t: 4 }); if (this.msgs.length > 5) this.msgs.shift(); break;
      case 'speech': this.comms.push({ name: f.name, text: f.text, col: f.col, t: 6 }); if (this.comms.length > 4) this.comms.shift(); break;
      case 'pa': this.comms.push({ name: 'SHIP PA', text: f.text, col: '#8a8f98', t: 6 }); if (this.comms.length > 4) this.comms.shift(); break;
      case 'objective': this.banner = { top: f.final ? 'MISSION COMPLETE' : 'OBJECTIVE COMPLETE', text: f.title, t: 3.5, col: C.green }; break;
      case 'objectiveNew': if (!this.banner || this.banner.t < 1.5) this.banner = { top: 'NEW OBJECTIVE', text: f.title, t: 3, col: C.amber }; break;
      case 'brief': this.brief = { title: f.title, text: f.text, comps: f.comps, t: 9 }; break;
      case 'log': this.logView = { title: f.title, text: f.text, t: 12 }; break;
      case 'hitmark': this.hit = 0.12; if (f.kill) this.kill = 0.25; break;
      case 'over': this.brief = null; this.logView = null; this.banner = null; break;
      case 'sense': this.r.rings.push({ x: f.x, y: f.y, r: 3, max: 16, t: 0.9, col: '#f04ad0', ui: true }); break;
    }
  }

  drawPost(c, world, dt) {
    const p = world.player, tr = tier(p), t = this.t;
    c.drawImage(S.vignette, 0, 0);
    const st = p.stress / 100;
    if (st > 0.3) {
      const pulse = 0.5 + 0.5 * Math.sin(t * (3 + st * 6));
      c.globalAlpha = (st - 0.3) * 0.8 * (0.6 + 0.4 * pulse);
      c.drawImage(S.vignette, 0, 0);
      c.globalAlpha = 1;
    }
    if (tr >= 2) {
      c.globalCompositeOperation = 'saturation';
      c.fillStyle = 'rgba(128,128,128,' + ((st - 0.55) * 1.3).toFixed(2) + ')';
      c.fillRect(0, 0, VW, VH);
      c.globalCompositeOperation = 'source-over';
    }
    if (tr >= 3 || p.panicT > 0) {
      c.globalAlpha = 0.14;
      c.drawImage(c.canvas, Math.round(Math.sin(t * 13) * 3), 0);
      c.globalAlpha = 1;
    }
    // Phantoms: brief silhouettes at the edge of the light when badly shaken.
    if (tr >= 2 && this.rng.chance(dt * (tr === 3 ? 0.5 : 0.12)) && this.phantoms.length < 2) {
      const a = this.rng.range(0, 6.28), d = this.rng.range(90, 130);
      this.phantoms.push({ x: VW / 2 + Math.cos(a) * d, y: VH / 2 + Math.sin(a) * d * 0.7, t: this.rng.range(0.15, 0.4) });
    }
    for (let i = this.phantoms.length - 1; i >= 0; i--) {
      const ph = this.phantoms[i];
      ph.t -= dt;
      if (ph.t <= 0) { this.phantoms.splice(i, 1); continue; }
      c.fillStyle = 'rgba(4,5,8,0.85)'; c.fillRect(ph.x - 3, ph.y - 8, 6, 9); c.fillRect(ph.x - 5, ph.y - 4, 10, 3);
      c.fillStyle = '#9ff4ff'; c.fillRect(ph.x - 2, ph.y - 6, 1, 1); c.fillRect(ph.x + 1, ph.y - 6, 1, 1);
    }
    if (this.r.hurt > 0) {
      this.r.hurt -= dt;
      c.fillStyle = 'rgba(200,30,30,' + (this.r.hurt * 0.55).toFixed(2) + ')';
      c.fillRect(0, 0, VW, VH);
      const a = this.r.hurtAng + Math.PI, x = VW / 2 + Math.cos(a) * 60, y = VH / 2 + Math.sin(a) * 60;
      c.fillStyle = '#ff5a4a';
      for (let i = -3; i <= 3; i++) c.fillRect(Math.round(x + Math.cos(a + 1.57) * i * 3), Math.round(y + Math.sin(a + 1.57) * i * 3), 2, 2);
    }
    if (p.hp < 35 && !p.dead) { c.fillStyle = 'rgba(160,20,20,' + (0.10 + 0.06 * Math.sin(t * 5)).toFixed(2) + ')'; c.fillRect(0, 0, VW, VH); }
    if (p.downed) { c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, 0, VW, VH); }
    if (world.air < 30) { c.fillStyle = 'rgba(120,150,180,' + ((30 - world.air) / 150).toFixed(2) + ')'; c.fillRect(0, 0, VW, VH); }
    c.globalAlpha = 0.9;
    const g = S.grain[Math.floor(t * 14) % 3];
    for (let y = 0; y < VH; y += 128) for (let x = 0; x < VW; x += 128) c.drawImage(g, x, y);
    c.globalAlpha = 1;
  }

  draw(c, world, ui, dt) {
    this.t += dt;
    const p = world.player, r = this.r, camX = r.camX, camY = r.camY, t = this.t;
    this.drawPost(c, world, dt);
    const S2 = (wx, wy) => [Math.round(wx - camX), Math.round(wy - camY)];
    // --- World-space labels ---
    for (const h of world.humans) {
      if (h.dead) continue;
      const [sx, sy] = S2(h.x, h.y);
      if (h.downed) { text(c, 'DOWN ' + Math.ceil(h.bleedout), sx, sy - 14, Math.sin(t * 8) > 0 ? C.red : '#ffb0a0', { align: 0.5 }); continue; }
      if (!h.isPlayer && (sx < 4 || sy < 4 || sx > VW - 4 || sy > VH - 4)) {
        const a = Math.atan2(sy - VH / 2, sx - VW / 2), ex = clamp(sx, 8, VW - 8), ey = clamp(sy, 8, VH - 8);
        c.fillStyle = h.char.accent; c.fillRect(ex - 1, ey - 1, 3, 3); c.fillStyle = C.dark; c.fillRect(ex + Math.round(Math.cos(a) * 2), ey + Math.round(Math.sin(a) * 2), 1, 1);
        continue;
      }
      if (h.speech) {
        const w = textWidth(h.speech.text) + 6, bx = clamp(sx - w / 2, 2, VW - w - 2), by = sy - 30;
        c.globalAlpha = Math.min(1, h.speech.t * 2);
        c.fillStyle = 'rgba(8,10,14,0.85)'; c.fillRect(bx, by, w, 9); c.fillStyle = h.char.accent; c.fillRect(bx, by, 1, 9);
        text(c, h.speech.text, bx + 3, by + 2, '#e8ecf2', { shadow: false });
        c.globalAlpha = 1;
      } else if (!h.isPlayer && (h.panicT > 0 || h.ai.act === 'task' || h.busyT > 0)) text(c, h.panicT > 0 ? '!!' : h.busyT > 0 ? '+' : '...', sx, sy - 24, h.panicT > 0 ? C.red : C.green, { align: 0.5 });
      if (h.useT > 0 && h.useNeed > 0.3 && !h.isPlayer) bar(c, sx - 8, sy - 20, 16, 2, h.useT / h.useNeed, C.amber);
      if (h.busyT > 0) bar(c, sx - 8, sy - 20, 16, 2, 1 - h.busyT / 2, C.green);
    }
    // Objective markers.
    if (world.mission) for (const o of world.mission.objectives) {
      if (o.state !== 'active' || o.x === undefined) continue;
      const [sx, sy] = S2(o.x, o.y), col = o.optional ? C.cyan : C.amber;
      if (sx > 10 && sy > 22 && sx < VW - 10 && sy < VH - 30) {
        const b = Math.round(Math.sin(t * 4) * 2);
        if (o.type === 'console' || world.pickups.some((q) => q.item === o.item) || o.type === 'nests') { c.fillStyle = C.dark; c.fillRect(sx - 3, sy - 31 + b, 7, 7); c.fillStyle = col; c.fillRect(sx - 2, sy - 30 + b, 5, 5); c.fillStyle = C.dark; c.fillRect(sx - 1, sy - 29 + b, 3, 3); c.fillStyle = col; c.fillRect(sx, sy - 28 + b, 1, 1); }
      } else {
        const a = Math.atan2(sy - VH / 2, sx - VW / 2), ex = clamp(VW / 2 + Math.cos(a) * 400, 14, VW - 14); let ey = clamp(VH / 2 + Math.sin(a) * 400, 16, VH - 52);
        if (ex < 106 && ey < 72) ey = 72; if (ex > VW - 130 && ey < 96) ey = 96; if ((ex < 136 || ex > VW - 122) && ey > VH - 60) ey = VH - 60;
        c.fillStyle = C.dark; c.fillRect(ex - 3, ey - 3, 7, 7); c.fillStyle = col; c.fillRect(ex - 2, ey - 2, 5, 5);
        c.fillRect(Math.round(ex + Math.cos(a) * 5) - 1, Math.round(ey + Math.sin(a) * 5) - 1, 2, 2);
        text(c, Math.round(dist(p.x, p.y, o.x, o.y) / TILE) + 'M', ex, ey + 6, col, { align: 0.5 });
      }
    }
    // Interaction prompt.
    const pr = world.prompt;
    if (pr && active(p)) {
      const [sx, sy] = S2(pr.x, pr.y), label = (pr.disabled ? '' : '[E] ') + pr.label, w = textWidth(label) + 8, bx = clamp(sx - w / 2, 2, VW - w - 2), by = clamp(sy - 26, 20, VH - 60);
      panel(c, bx, by, w, 11, pr.disabled ? '#6a2a24' : C.edge);
      text(c, label, bx + 4, by + 3, pr.disabled ? '#ff8a80' : C.txt);
      if (p.useT > 0 && pr.time > 0) bar(c, bx + 1, by + 11, w - 2, 2, p.useT / pr.time, C.amber);
    }
    // --- Squad panel ---
    let y = 6;
    for (const h of world.humans) {
      if (h.isPlayer) continue;
      panel(c, 6, y, 92, 17);
      c.fillStyle = h.dead ? '#3a3f48' : h.char.accent; c.fillRect(8, y + 2, 2, 13);
      text(c, h.name, 13, y + 3, h.dead ? C.dim : C.txt);
      text(c, h.char.role, 96, y + 3, C.dim, { align: 1 });
      if (h.dead) text(c, 'K.I.A.', 13, y + 10, C.red);
      else {
        bar(c, 13, y + 10, 34, 3, h.hp / h.maxHp, h.downed ? C.red : h.hp < 40 ? '#ff9a3a' : '#c8363a');
        const tr = tier(h);
        for (let i = 0; i < 4; i++) { c.fillStyle = i <= tr ? TIER_COL[tr] : '#232832'; c.fillRect(50 + i * 4, y + 10, 3, 3); }
        const st = h.downed ? 'DOWN ' + Math.ceil(h.bleedout) : h.bleed >= 2 ? 'BLEEDING' : STATUS[h.ai.act] || '';
        if (st) text(c, st, 96, y + 9, h.downed || h.ai.act === 'panic' ? (Math.sin(t * 9) > 0 ? C.red : '#ffb0a0') : h.bleed >= 2 ? C.blood : C.dim, { align: 1 });
      }
      y += 19;
    }
    // Comms log.
    y += 3;
    for (const m of this.comms) {
      m.t -= dt;
      if (m.t <= 0) continue;
      c.globalAlpha = Math.min(1, m.t);
      const w = text(c, m.name + ':', 8, y, m.col);
      const lines = wrap(m.text, 150);
      for (const l of lines) { text(c, l, 12 + w, y, '#b8bfca'); y += 7; }
      c.globalAlpha = 1;
    }
    this.comms = this.comms.filter((m) => m.t > 0);
    // --- Objectives ---
    if (world.mission) {
      const M = world.mission;
      let oy = 6;
      text(c, 'OP: ' + M.title, VW - 6, oy, C.dim, { align: 1 }); oy += 9;
      for (const o of M.visible()) {
        const done = o.state === 'done';
        if (done && (o.doneT = (o.doneT || 0) + dt) > 8) continue;
        const col = done ? '#4a8a5c' : o.optional ? C.cyan : C.amber;
        const label = o.title + (o.type === 'nests' && o.total ? ' ' + (o.count || 0) + '/' + o.total : '');
        text(c, label, VW - 14, oy, col, { align: 1 });
        c.fillStyle = col; c.fillRect(VW - 11, oy, 5, 5); c.fillStyle = C.dark; c.fillRect(VW - 10, oy + 1, 3, 3);
        if (done) { c.fillStyle = col; c.fillRect(VW - 10, oy + 1, 3, 3); }
        oy += 7;
        if (!done) {
          const act = o.type === 'console' ? M.consoleAction(world, o.prop, p) : null;
          const hint = o.defending ? null : act && act.disabled ? act.label : o.hint ? (o.type === 'fetch' ? 'SEARCH: ' : 'LOCATION: ') + o.hint : o.room && o.room.name ? o.room.name : '';
          if (o.defending) { bar(c, VW - 76, oy, 70, 3, o.progress, C.green); oy += 5; }
          else if (hint) { text(c, hint, VW - 14, oy, C.dim, { align: 1 }); oy += 7; }
        }
        oy += 2;
      }
      if (M.countdown > 0) {
        const s = Math.ceil(M.countdown), col = s <= 30 && Math.sin(t * 10) > 0 ? '#fff' : C.red;
        text(c, 'SCUTTLE ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'), VW / 2, 30, col, { align: 0.5, scale: 2 });
      }
      if (world.airDecay > 0 || world.air < 99) { text(c, 'AIR ' + Math.round(world.air) + '%', VW - 6, oy, world.air < 30 ? C.red : C.cyan, { align: 1 }); oy += 8; }
      if (!world.mainPower) text(c, 'MAIN POWER OFFLINE', VW - 6, oy, '#8a5a50', { align: 1 });
    }
    // --- Vitals ---
    const vy = VH - 40;
    panel(c, 6, vy, 126, 34);
    text(c, 'HP', 10, vy + 4, C.dim);
    bar(c, 24, vy + 4, 60, 5, p.hp / p.maxHp, p.hp < 35 ? '#ff5a4a' : '#c8363a');
    text(c, Math.max(0, Math.ceil(p.hp)), 87, vy + 4, C.txt);
    if (p.armor > 0) { bar(c, 24, vy + 10, 60, 2, p.armor / 60, '#8b96a4'); }
    let cxp = 102;
    const chip = (label, col, blink) => { if (blink && Math.sin(t * 8) < 0) col = '#7a2024'; text(c, label, cxp, vy + 4, col); cxp += textWidth(label) + 4; };
    if (p.bleed > 0) chip('BLD' + (p.bleed > 1 ? p.bleed : ''), C.blood, p.bleed >= 2);
    cxp = 102; const chip2 = (label, col) => { text(c, label, cxp, vy + 11, col); cxp += textWidth(label) + 3; };
    if (p.leg) chip2('LEG', '#ff9a3a');
    if (p.arm) chip2('ARM', '#ff9a3a');
    if (p.acid > 0) chip2('ACID', '#9be84a');
    // ECG composure trace.
    const tr = tier(p), ex = 10, ey = vy + 18, ew = 62, eh = 12;
    c.fillStyle = '#0a1210'; c.fillRect(ex, ey, ew, eh);
    const rate = 1.1 + p.stress / 28;
    this.ecg += dt * rate;
    c.fillStyle = TIER_COL[tr];
    for (let i = 0; i < ew; i++) {
      const ph = (this.ecg - (ew - i) / 26 + 100) % 1;
      let v = 0;
      if (ph < 0.06) v = -ph * 30; else if (ph < 0.12) v = -1.8 + (ph - 0.06) * 110; else if (ph < 0.18) v = 4.8 - (ph - 0.12) * 100; else if (ph < 0.22) v = -1.2 + (ph - 0.18) * 30; else if (ph > 0.4 && ph < 0.55) v = Math.sin((ph - 0.4) * 21) * 1.2;
      v *= 0.7 + p.stress / 160;
      if (tr >= 2) v += Math.sin(i * 1.9 + t * 30) * (tr - 1) * 0.5;
      c.globalAlpha = 0.35 + 0.65 * (i / ew);
      c.fillRect(ex + i, Math.round(ey + eh / 2 + 1 - v), 1, 1);
    }
    c.globalAlpha = 1;
    text(c, TIER_NAMES[tr], ex + ew + 4, ey, TIER_COL[tr]);
    text(c, (p.stressors || []).slice(0, 2).join(' '), ex + ew + 4, ey + 7, C.dim);
    // --- Weapon ---
    const w = p.weapons[p.cur], wd = WEAPONS[w.id], wx = VW - 118;
    panel(c, wx, vy, 112, 34);
    text(c, wd.name, wx + 4, vy + 4, C.txt);
    const ws = S.weapons[w.id].cv;
    c.drawImage(ws, wx + 4, vy + 12, ws.width * 2, ws.height * 2);
    const low = w.mag <= wd.mag * 0.25;
    text(c, w.mag, wx + 78, vy + 13, low ? (Math.sin(t * 9) > 0 ? C.red : '#ffb0a0') : '#fff', { align: 1, scale: 2 });
    text(c, '/' + p.ammo[wd.ammo], wx + 80, vy + 18, AMMO[wd.ammo].color);
    if (p.reloading) { bar(c, wx + 44, vy + 27, 62, 2, 1 - p.reloadT / wd.reload, C.amber); text(c, 'RELOADING', wx + 44, vy + 4 + 0, C.amber, { align: 0 }); }
    if (p.weapons.length > 1) { const o = p.weapons[1 - p.cur], os = S.weapons[o.id].cv; c.globalAlpha = 0.6; c.drawImage(os, wx - os.width - 4, vy + 22); c.globalAlpha = 1; text(c, 'Q', wx - 8, vy + 14, C.dim, { align: 1 }); }
    // Flashlight + throwable.
    const fx0 = wx + 44, fy0 = vy + 30;
    c.fillStyle = p.flashlight ? '#ffe9b0' : '#3a3f48'; c.fillRect(fx0, fy0 - 1, 3, 3);
    bar(c, fx0 + 5, fy0, 24, 1, p.battery / 100, p.battery < 20 ? C.red : '#e8d9a0');
    const tn = countItem(p, p.selThrow);
    if (tn > 0) { c.drawImage(S.items[p.selThrow], fx0 + 36, fy0 - 9); text(c, 'x' + tn, fx0 + 48, fy0 - 4, C.txt); }
    // Belt strip.
    const bx0 = VW / 2 - (BELT_SIZE * 13) / 2, by0 = VH - 17;
    for (let i = 0; i < BELT_SIZE; i++) {
      c.fillStyle = 'rgba(8,10,14,0.7)'; c.fillRect(bx0 + i * 13, by0, 12, 12);
      c.fillStyle = '#232a35'; c.fillRect(bx0 + i * 13, by0 + 11, 12, 1);
      const b = p.belt[i];
      if (b) { c.drawImage(S.items[b.id], bx0 + i * 13, by0); if (b.n > 1) text(c, b.n, bx0 + i * 13 + 12, by0 + 7, '#fff', { align: 1 }); else if (b.charges) text(c, b.charges, bx0 + i * 13 + 12, by0 + 7, C.cyan, { align: 1 }); }
    }
    let kx = bx0 + BELT_SIZE * 13 + 4;
    for (const k in world.keys) if (world.keys[k] && S.items[k]) { c.drawImage(S.items[k], kx, by0); kx += 12; }
    if (world.tracker) this.drawTracker(c, world, dt);
    // Room name.
    const rm = world.roomAt(p.x, p.y);
    if (rm && rm.name !== this.roomName) { this.roomName = rm.name; this.roomT = 3; }
    if (this.roomT > 0) { this.roomT -= dt; c.globalAlpha = Math.min(1, this.roomT); text(c, this.roomName, VW / 2, 8, '#aab4c4', { align: 0.5 }); c.globalAlpha = 1; }
    // Messages.
    let my = 40;
    for (const m of this.msgs) { m.t -= dt; if (m.t <= 0) continue; c.globalAlpha = Math.min(1, m.t * 1.5); text(c, m.text, VW / 2, my, KIND_COL[m.kind] || C.txt, { align: 0.5 }); c.globalAlpha = 1; my += 8; }
    this.msgs = this.msgs.filter((m) => m.t > 0);
    if (this.banner) {
      const b = this.banner;
      b.t -= dt;
      const a = Math.min(1, b.t, (3.5 - b.t) * 4 + 0.2);
      c.globalAlpha = clamp(a, 0, 1);
      c.fillStyle = 'rgba(6,8,12,0.75)'; c.fillRect(0, 74, VW, 26);
      c.fillStyle = b.col; c.fillRect(0, 74, VW, 1); c.fillRect(0, 99, VW, 1);
      text(c, b.top, VW / 2, 78, b.col, { align: 0.5 });
      text(c, b.text, VW / 2, 86, '#fff', { align: 0.5, scale: 2 });
      c.globalAlpha = 1;
      if (b.t <= 0) this.banner = null;
    }
    if (p.downed) { text(c, 'YOU ARE DOWN', VW / 2, 110, C.red, { align: 0.5, scale: 2 }); text(c, 'BLEEDING OUT: ' + Math.ceil(p.bleedout) + 'S. HOLD ON.', VW / 2, 126, '#ffb0a0', { align: 0.5 }); }
    if (this.brief) {
      const b = this.brief;
      b.t -= dt;
      c.globalAlpha = clamp(Math.min(b.t, 9 - b.t) * 2, 0, 1);
      panel(c, VW / 2 - 130, 150, 260, 50);
      text(c, 'OPERATION: ' + b.title, VW / 2, 155, C.amber, { align: 0.5, scale: 2 });
      let ly = 170;
      for (const l of wrap(b.text, 244)) { text(c, l, VW / 2, ly, C.txt, { align: 0.5 }); ly += 7; }
      if (b.comps.length) text(c, 'COMPLICATIONS: ' + b.comps.join(', '), VW / 2, ly + 3, C.red, { align: 0.5 });
      text(c, '[P] CONTROLS   [TAB] INVENTORY + MAP', VW / 2, 203, C.dim, { align: 0.5 });
      c.globalAlpha = 1;
      if (b.t <= 0) this.brief = null;
    }
    if (this.logView) {
      const l = this.logView;
      l.t -= dt;
      const lines = wrap(l.text, 200);
      panel(c, VW / 2 - 108, 60, 216, 22 + lines.length * 8, '#2a6a3a');
      text(c, l.title, VW / 2 - 102, 65, C.green);
      lines.forEach((s, i) => text(c, s, VW / 2 - 102, 76 + i * 8, '#b8e8c4'));
      if (l.t <= 0) this.logView = null;
    }
    // Crosshair.
    if (ui && ui.aimSX !== undefined && active(p) && !ui.menu) {
      const a = p.aim + p.sway, d = Math.max(14, dist(ui.aimWX, ui.aimWY, p.x, p.y));
      const cx = Math.round(p.x + Math.cos(a) * d - camX), cy = Math.round(p.y + Math.sin(a) * d - camY);
      const gap = Math.round(2 + (wd.spread + p.bloom) * d * 0.55);
      const col = this.kill > 0 ? C.red : this.hit > 0 ? '#fff' : p.reloading ? C.amber : '#e8ecf2';
      c.fillStyle = C.dark;
      c.fillRect(cx - gap - 4, cy - 1, 5, 3); c.fillRect(cx + gap, cy - 1, 5, 3); c.fillRect(cx - 1, cy - gap - 4, 3, 5); c.fillRect(cx - 1, cy + gap, 3, 5);
      c.fillStyle = col;
      c.fillRect(cx - gap - 3, cy, 3, 1); c.fillRect(cx + gap + 1, cy, 3, 1); c.fillRect(cx, cy - gap - 3, 1, 3); c.fillRect(cx, cy + gap + 1, 1, 3);
      c.fillRect(cx, cy, 1, 1);
      if (this.hit > 0) { this.hit -= dt; for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.fillRect(cx + dx * (gap + 2), cy + dy * (gap + 2), 1, 1); c.fillRect(cx + dx * (gap + 3), cy + dy * (gap + 3), 1, 1); } }
      if (this.kill > 0) this.kill -= dt;
      if (w.mag === 0 && !p.reloading) text(c, p.ammo[wd.ammo] > 0 ? 'RELOAD [R]' : 'NO AMMO', cx, cy + gap + 7, C.red, { align: 0.5 });
    }
  }

  drawTracker(c, world, dt) {
    const p = world.player, cx = VW / 2, cy = VH - 24, R = 26, range = 230, tr = tier(p);
    this.sweep += dt;
    if (this.sweep > 1.6) {
      this.sweep = 0;
      this.blips = [];
      for (const a of world.aliens) { if (a.dead || a.inVent > 0 || !a.moving) continue; const d = dist(a.x, a.y, p.x, p.y); if (d < range) this.blips.push({ x: (a.x - p.x) / range, y: (a.y - p.y) / range }); }
      if (tr >= 2) for (let i = 0; i < tr - 1; i++) if (this.rng.chance(0.5)) { const a = this.rng.range(0, 6.28), d = this.rng.range(0.3, 0.9); this.blips.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, fake: true }); }
      if (this.blips.length) this.ping = true;
    }
    c.fillStyle = 'rgba(6,20,12,0.8)'; c.fillRect(cx - R, cy - R + 8, R * 2, R - 2);
    c.fillStyle = '#1f5a34'; c.fillRect(cx - R, cy - R + 8, R * 2, 1); c.fillRect(cx - R, cy + 5, R * 2, 1);
    const sr = (this.sweep / 1.6) * R;
    c.fillStyle = 'rgba(95,232,138,0.5)';
    for (let i = 0; i < 40; i++) { const a = Math.PI + (i / 39) * Math.PI, x = cx + Math.cos(a) * sr, y = cy + Math.sin(a) * sr * 0.55; if (y > cy - R + 8) c.fillRect(Math.round(x), Math.round(y), 1, 1); }
    c.fillStyle = '#5fe88a'; c.fillRect(cx - 1, cy + 2, 2, 2);
    const fade = 1 - this.sweep / 1.6;
    for (const b of this.blips) {
      const x = cx + b.x * R, y = cy + b.y * R * 0.55 - 4;
      if (y < cy - R + 9 || y > cy + 4) continue;
      c.globalAlpha = fade; c.fillStyle = '#b8ffd0'; c.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2); c.globalAlpha = 1;
    }
  }

  // Inventory + map screen. Returns queued actions.
  drawInventory(c, world, ui) {
    const p = world.player, acts = [], mx = ui.mx, my = ui.my;
    c.fillStyle = 'rgba(4,5,8,0.93)'; c.fillRect(0, 0, VW, VH);
    text(c, 'INVENTORY', 14, 10, C.amber, { scale: 2 });
    text(c, '[TAB] CLOSE   LEFT CLICK: USE / SELECT   RIGHT CLICK: DROP   [G] GIVE TO NEAREST', 14, 24, C.dim);
    let tip = null;
    // Weapons.
    p.weapons.forEach((w, i) => {
      const d = WEAPONS[w.id], x = 14, y = 36 + i * 34;
      const hov = mx >= x && mx < x + 150 && my >= y && my < y + 30;
      panel(c, x, y, 150, 30, i === p.cur ? C.amber : hov ? '#566175' : C.edge);
      const sp = S.weapons[w.id].cv;
      c.drawImage(sp, x + 5, y + 6, sp.width * 2, sp.height * 2);
      text(c, d.name, x + 44, y + 4, C.txt);
      text(c, w.mag + '/' + d.mag + '  ' + AMMO[d.ammo].name + ' ' + p.ammo[d.ammo], x + 44, y + 12, AMMO[d.ammo].color);
      text(c, 'DMG ' + Math.round(d.dmg * Math.max(1, d.pellets)) + '  RPM ' + Math.round(60 / d.rate) + '  NOISE ' + Math.round(d.noise / 33), x + 44, y + 20, C.dim);
      if (hov) { tip = d.desc; if (ui.click) acts.push({ slot: i, type: 'swapTo' }); if (ui.rclick) acts.push({ type: 'dropWeapon', slot: i }); }
    });
    // Belt.
    text(c, 'BELT', 14, 108, C.dim);
    for (let i = 0; i < BELT_SIZE; i++) {
      const x = 14 + (i % 4) * 38, y = 116 + Math.floor(i / 4) * 30, b = p.belt[i];
      const hov = mx >= x && mx < x + 36 && my >= y && my < y + 28;
      if (hov) this.sel = i;
      panel(c, x, y, 36, 28, hov ? C.amber : C.edge);
      if (!b) continue;
      c.drawImage(S.items[b.id], x + 6, y + 2, 24, 24);
      if (b.n > 1) text(c, 'x' + b.n, x + 34, y + 20, '#fff', { align: 1 });
      if (b.charges) text(c, b.charges + 'C', x + 34, y + 20, C.cyan, { align: 1 });
      if (hov) { tip = ITEMS[b.id].name + ': ' + ITEMS[b.id].desc; if (ui.click) acts.push({ type: 'use', slot: i }); if (ui.rclick) acts.push({ type: 'drop', slot: i }); if (ui.give) acts.push({ type: 'give', slot: i }); }
    }
    // Ammo.
    text(c, 'AMMUNITION', 14, 180, C.dim);
    let ai = 0;
    for (const t in AMMO) {
      const x = 14 + (ai % 3) * 52, y = 188 + Math.floor(ai / 3) * 14;
      const hov = mx >= x && mx < x + 50 && my >= y && my < y + 12;
      c.drawImage(S.items['a:' + t], x, y);
      text(c, p.ammo[t] + '/' + AMMO[t].cap, x + 14, y + 4, p.ammo[t] ? AMMO[t].color : '#3a3f48');
      if (hov) { tip = AMMO[t].name + ': PRESS [G] TO GIVE SOME TO THE NEAREST SQUADMATE'; if (ui.give) acts.push({ type: 'giveAmmo', ammo: t }); }
      ai++;
    }
    let kx = 14;
    text(c, 'KEY ITEMS', 14, 220, C.dim);
    for (const k in world.keys) if (world.keys[k]) { c.drawImage(S.items[k], kx, 227); const hov = mx >= kx && mx < kx + 12 && my >= 227 && my < 239; if (hov) tip = ITEMS[k].name; kx += 14; }
    if (p.armor > 0) { c.drawImage(S.items.armor, 120, 227); text(c, Math.round(p.armor), 133, 231, C.txt); }
    if (world.tracker) c.drawImage(S.items.tracker, 150, 227);
    // Map.
    const m = world.map, sc = 2, ox = 180, oy = 44;
    panel(c, ox - 4, oy - 12, m.w * sc + 8, m.h * sc + 40);
    text(c, 'ISV CALLIOPE: DECK PLAN', ox, oy - 8, C.dim);
    let hover = null;
    for (const r of m.rooms) {
      if (!r.seen && !world.revealMap) continue;
      const x = ox + r.x * sc, y = oy + r.y * sc, w = r.w * sc, h = r.h * sc;
      const here = world.roomAt(p.x, p.y) === r;
      c.fillStyle = r.corridor ? '#232a35' : r.scene === 'nest' && r.visited ? '#3b2140' : r.visited ? '#3a4658' : '#2a323f';
      c.fillRect(x, y, w, h);
      if (here) { c.fillStyle = '#566a88'; c.fillRect(x, y, w, h); }
      if (!world.power[r.section]) { c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x, y, w, h); }
      if (mx >= x && mx < x + w && my >= y && my < y + h && !r.corridor) hover = r;
    }
    for (const d of m.doors) { const a = m.rooms[d.a], b = m.rooms[d.b]; if (!(a.seen || b.seen || world.revealMap)) continue; c.fillStyle = d.welded ? '#aef2ff' : d.lock ? C.red : d.broken ? '#6a5a40' : '#8a94a2'; c.fillRect(ox + d.x * sc, oy + d.y * sc, sc, sc); }
    for (const v of m.vents) { const r = m.rooms[v.room]; if (r.visited) { c.fillStyle = v.sealed ? '#aef2ff' : '#a04ad0'; c.fillRect(ox + v.x * sc, oy + v.y * sc, 1, 1); } }
    if (world.mission) for (const o of world.mission.objectives) if (o.state === 'active' && o.x !== undefined && Math.sin(this.t * 6) > -0.3) { c.fillStyle = o.optional ? C.cyan : C.amber; c.fillRect(ox + Math.floor(o.x / TILE) * sc - 1, oy + Math.floor(o.y / TILE) * sc - 1, 4, 4); }
    for (const h of world.humans) if (!h.dead) { c.fillStyle = h.isPlayer ? '#fff' : h.char.accent; c.fillRect(ox + Math.floor(h.x / TILE) * sc, oy + Math.floor(h.y / TILE) * sc, 2, 2); }
    if (hover) text(c, hover.name + (world.power[hover.section] ? '' : '  (NO POWER)'), ox, oy + m.h * sc + 4, C.txt);
    else text(c, 'HOVER A ROOM FOR ITS NAME', ox, oy + m.h * sc + 4, '#3f4856');
    if (world.mission) { let ly = oy + m.h * sc + 14; for (const o of world.mission.visible()) if (o.state === 'active') { text(c, '> ' + o.title + (o.hint ? '  (' + o.hint + ')' : ''), ox, ly, o.optional ? C.cyan : C.amber); ly += 7; if (ly > oy + m.h * sc + 26) break; } }
    // Squad detail.
    let sy = 180;
    text(c, 'SQUAD', ox, sy - 8, C.dim);
    for (const h of world.humans) {
      if (h.isPlayer) continue;
      panel(c, ox - 4, sy, 300, 19);
      c.fillStyle = h.char.accent; c.fillRect(ox - 2, sy + 2, 2, 16);
      text(c, h.char.full, ox + 4, sy + 3, h.dead ? C.dim : C.txt);
      text(c, h.dead ? 'KILLED IN ACTION' : h.char.role + '  HP ' + Math.max(0, Math.round(h.hp)) + '  ' + TIER_NAMES[tier(h)] + (h.bleed ? '  BLEEDING' : '') + (h.leg ? '  LEG' : '') + (h.arm ? '  ARM' : ''), ox + 4, sy + 11, h.dead ? C.red : C.dim);
      if (!h.dead) {
        const wd = WEAPONS[h.weapons[h.cur].id];
        text(c, wd.name + ' ' + h.weapons[h.cur].mag + '/' + h.ammo[wd.ammo], ox + 292, sy + 3, AMMO[wd.ammo].color, { align: 1 });
        let ix = ox + 280;
        for (const b of h.belt) { c.drawImage(S.items[b.id], ix, sy + 8); if (b.n > 1) text(c, b.n, ix + 12, sy + 13, '#fff', { align: 1 }); ix -= 13; }
      }
      sy += 20;
    }
    if (tip) { const lines = wrap(tip, 150); panel(c, 14, 244, 160, 6 + lines.length * 7); lines.forEach((l, i) => text(c, l, 18, 247 + i * 7, C.txt)); }
    // Cursor.
    c.fillStyle = '#fff'; c.fillRect(mx, my, 1, 5); c.fillRect(mx, my, 5, 1); c.fillStyle = C.dark; c.fillRect(mx + 1, my + 1, 1, 4); c.fillRect(mx + 1, my + 1, 4, 1);
    return acts;
  }

  drawPause(c, sel) {
    c.fillStyle = 'rgba(4,5,8,0.8)'; c.fillRect(0, 0, VW, VH);
    text(c, 'PAUSED', VW / 2, 50, C.amber, { align: 0.5, scale: 3 });
    ['RESUME', 'RESTART THIS SEED', 'QUIT TO TITLE'].forEach((s, i) => text(c, (i === sel ? '> ' : '  ') + s + (i === sel ? ' <' : '  '), VW / 2, 90 + i * 12, i === sel ? '#fff' : C.dim, { align: 0.5 }));
    drawControls(c, 160);
  }
}

export function drawControls(c, y) {
  const rows = [['WASD', 'MOVE'], ['MOUSE', 'AIM / FIRE'], ['R', 'RELOAD'], ['E', 'INTERACT (HOLD)'], ['Q / 1 2', 'SWAP WEAPON'], ['SHIFT', 'SPRINT (LOUD)'], ['CTRL / C', 'SNEAK (SILENT)'], ['F', 'FLASHLIGHT'], ['H', 'TREAT WOUNDS'], ['G / T', 'THROW / CYCLE'], ['V', 'MELEE SHOVE'], ['B + E', 'WELD DOOR/VENT'], ['Z / X', 'SQUAD FOLLOW / HOLD'], ['MIDDLE / SPACE', 'PING: MOVE, TARGET, USE'], ['TAB', 'INVENTORY + MAP'], ['M', 'MUTE']];
  rows.forEach((r, i) => { const x = VW / 2 - 190 + (i % 2) * 196, yy = y + Math.floor(i / 2) * 9; text(c, r[0], x + 62, yy, C.amber, { align: 1 }); text(c, r[1], x + 68, yy, C.txt); });
}

export function drawTitle(c, t, seedStr, sel, opts) {
  c.fillStyle = '#04050a'; c.fillRect(0, 0, VW, VH);
  const ox = Math.floor(t * 6) % 256;
  for (let x = -ox; x < VW; x += 256) for (let y = 0; y < VH; y += 256) c.drawImage(S.stars, x, y);
  // Ship silhouette drifting.
  const sx = 70 + Math.sin(t * 0.2) * 6, sy = 96 + Math.sin(t * 0.33) * 3;
  c.fillStyle = '#0b0d13';
  c.fillRect(sx, sy + 10, 300, 26); c.fillRect(sx + 20, sy, 60, 46); c.fillRect(sx + 100, sy - 6, 90, 58); c.fillRect(sx + 210, sy + 4, 60, 38); c.fillRect(sx + 300, sy + 14, 26, 18); c.fillRect(sx - 14, sy + 6, 14, 34); c.fillRect(sx + 326, sy + 19, 12, 8);
  c.fillStyle = '#161a24'; c.fillRect(sx, sy + 10, 300, 2); c.fillRect(sx + 100, sy - 6, 90, 2); c.fillRect(sx + 20, sy, 60, 2); c.fillRect(sx + 210, sy + 4, 60, 2);
  for (let i = 0; i < 22; i++) { const on = Math.sin(t * (0.5 + (i % 5) * 0.3) + i * 2.3) > -0.2; c.fillStyle = i % 7 === 3 ? (on ? '#c8363a' : '#3a1214') : on ? '#3a4a5c' : '#141a22'; c.fillRect(Math.round(sx + 14 + i * 13.5), Math.round(sy + 20 + (i % 3) * 4), 3, 1); }
  c.globalCompositeOperation = 'lighter';
  const g = glow(16, [255, 120, 60], 1.6); c.globalAlpha = 0.5 + 0.2 * Math.sin(t * 7); c.drawImage(g, Math.round(sx - 30), Math.round(sy + 7)); c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.drawImage(S.vignette, 0, 0);
  text(c, 'BLACKWAKE', VW / 2 + 1, 26, '#3a1214', { align: 0.5, scale: 6, shadow: false });
  text(c, 'BLACKWAKE', VW / 2, 24, '#d8dde6', { align: 0.5, scale: 6, shadowCol: '#000' });
  c.fillStyle = C.blood; c.fillRect(VW / 2 - 100, 58, 200, 1);
  text(c, 'LAST SHIFT ON THE ISV CALLIOPE', VW / 2, 63, C.blood, { align: 0.5 });
  const items = ['DEPLOY', 'SEED: ' + seedStr, 'NEW RANDOM SEED', 'CONTROLS'];
  items.forEach((s, i) => { const on = i === sel; text(c, (on ? '> ' : '') + s + (on ? ' <' : ''), VW / 2, i === 0 ? 168 : 174 + i * 12, on ? '#fff' : C.dim, { align: 0.5, scale: i === 0 ? 2 : 1 }); });
  if (opts.controls) { c.fillStyle = 'rgba(4,5,8,0.92)'; c.fillRect(40, 60, VW - 80, 170); text(c, 'CONTROLS', VW / 2, 70, C.amber, { align: 0.5, scale: 2 }); drawControls(c, 92); text(c, 'LIGHT REVEALS YOU. NOISE DRAWS THEM. KEEP THE SQUAD TOGETHER.', VW / 2, 180, C.dim, { align: 0.5 }); text(c, 'PRESS ANY KEY', VW / 2, 212, C.txt, { align: 0.5 }); }
  else { text(c, 'ARROWS / W S: SELECT    ENTER / CLICK: CONFIRM    TYPE DIGITS TO EDIT SEED', VW / 2, 236, '#4a5362', { align: 0.5 }); text(c, 'HEADPHONES RECOMMENDED', VW / 2, 248, '#3a4250', { align: 0.5 }); }
  const gr = S.grain[Math.floor(t * 14) % 3];
  for (let y = 0; y < VH; y += 128) for (let x = 0; x < VW; x += 128) c.drawImage(gr, x, y);
}

export function drawEnd(c, world, t, fade) {
  const o = world.over, win = o.win;
  c.fillStyle = 'rgba(' + (win ? '4,8,12,' : '14,2,2,') + Math.min(0.88, fade * 0.88).toFixed(2) + ')'; c.fillRect(0, 0, VW, VH);
  if (fade < 0.6) return;
  text(c, win ? 'EXTRACTED' : 'LOST WITH ALL HANDS', VW / 2, 40, win ? C.green : C.red, { align: 0.5, scale: 4 });
  let y = 74;
  for (const l of wrap(o.reason, 380)) { text(c, l, VW / 2, y, C.txt, { align: 0.5 }); y += 8; }
  y += 8;
  const mm = Math.floor(o.time / 60), ss = Math.floor(o.time % 60);
  const rows = [['OPERATION', world.mission ? world.mission.title : world.scene || 'TEST'], ['SEED', world.seed], ['TIME', mm + ':' + String(ss).padStart(2, '0')], ['KILLS', world.stats.kills], ['NESTS BURNED', world.stats.nests], ['TIMES DOWNED', world.stats.downs], ['PANIC EPISODES', world.stats.panics]];
  rows.forEach((r) => { text(c, r[0], VW / 2 - 6, y, C.dim, { align: 1 }); text(c, r[1], VW / 2 + 6, y, C.txt); y += 8; });
  y += 6;
  text(c, 'SQUAD', VW / 2, y, C.dim, { align: 0.5 }); y += 9;
  for (const h of world.humans) { const st = h.dead ? 'K.I.A.' : h.downed ? 'LEFT BEHIND' : 'ALIVE'; text(c, h.isPlayer ? 'CPL. R. VANCE (YOU)' : h.char.full, VW / 2 - 6, y, h.dead ? C.dim : C.txt, { align: 1 }); text(c, st, VW / 2 + 6, y, h.dead || h.downed ? C.red : C.green); y += 8; }
  if (Math.sin(t * 4) > -0.5) text(c, '[R] RETRY THIS SEED     [N] NEW SEED     [ESC] TITLE', VW / 2, VH - 22, '#fff', { align: 0.5 });
}

export { COMP_TEXT };

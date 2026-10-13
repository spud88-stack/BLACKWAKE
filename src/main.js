// Boot, input, fixed-step loop, screens, and the debug surface (window.__game).
import { World } from './sim/world.js';
import { Renderer, VW, VH } from './render/renderer.js';
import { Hud, drawTitle, drawEnd } from './render/hud.js';
import { GameAudio } from './audio/audio.js';
import { SCENES } from './sim/scenarios.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const hud = new Hud(renderer);
const audio = new GameAudio();
const ctx = renderer.ctx;
const STEP = 1 / 60;

let scale = 1;
function resize() {
  // Integer scale in device pixels, so pixels stay square and even on any display density.
  const dpr = window.devicePixelRatio || 1;
  scale = Math.max(1, Math.floor(Math.min((window.innerWidth * dpr) / VW, (window.innerHeight * dpr) / VH))) / dpr;
  canvas.style.width = VW * scale + 'px';
  canvas.style.height = VH * scale + 'px';
}
window.addEventListener('resize', resize);
resize();

const G = {
  state: 'title', world: null, seed: params.get('seed') || String(Math.floor(Math.random() * 99999) + 1), titleSel: 0, controls: false, pauseSel: 0,
  speed: Number(params.get('speed')) || 1, acc: 0, t: 0, hitstop: 0, endFade: 0, fps: 60, frameMs: 0, simMs: 0,
};
const keys = {}, edge = {};
const mouse = { x: VW / 2, y: VH / 2, down: false, click: false, rclick: false, mid: false };

function start(opts = {}) {
  const seed = opts.seed !== undefined ? opts.seed : Number(G.seed) || 1;
  G.world = new World({ seed, scene: opts.scene, autoplay: opts.autoplay || params.get('autoplay') === '1', finale: opts.finale, comps: opts.comps });
  G.seed = String(seed);
  renderer.setWorld(G.world);
  renderer.debug = params.get('debug') === '1' || renderer.debug;
  hud.reset();
  G.state = 'play'; G.acc = 0; G.endFade = 0;
  drain();
}

function drain() {
  const w = G.world;
  for (const f of w.fx) {
    renderer.fx(f); hud.fx(f, w); audio.fx(f, w);
    if (f.type === 'hitmark' && f.kill && f.heavy) G.hitstop = 0.035;
  }
  w.fx.length = 0;
}

function buildInput() {
  const k = keys, w = G.world, p = w.player;
  const inp = {
    mx: (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0), my: (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0),
    aimX: mouse.x + renderer.camX, aimY: mouse.y + renderer.camY + 3,
    fire: mouse.down, firePressed: edge.fire, reload: edge.KeyR, interact: !!k.KeyE, weld: !!k.KeyB,
    sprint: !!(k.ShiftLeft || k.ShiftRight), sneak: !!(k.ControlLeft || k.KeyC), melee: edge.KeyV, swap: edge.KeyQ,
    slot: edge.Digit1 ? 0 : edge.Digit2 ? 1 : undefined, heal: edge.KeyH, throw: edge.KeyG, cycleThrow: edge.KeyT, flashlight: edge.KeyF,
    cmdFollow: edge.KeyZ, cmdHold: edge.KeyX, ping: edge.Space || edge.mid ? { x: mouse.x + renderer.camX, y: mouse.y + renderer.camY } : null,
    actions: G.pendingActions,
  };
  G.pendingActions = null;
  if (G.inject) Object.assign(inp, G.inject);
  return inp;
}

function frame(now) {
  requestAnimationFrame(frame);
  const t0 = performance.now();
  let dt = Math.min(0.1, (now - (G.last || now)) / 1000);
  G.last = now;
  G.t += dt;
  G.fps += (1 / Math.max(0.001, dt) - G.fps) * 0.05;
  if (G.state === 'title') {
    drawTitle(ctx, G.t, G.seed, G.titleSel, { controls: G.controls });
  } else {
    const w = G.world;
    const playing = G.state === 'play' || G.state === 'end';
    if (playing) {
      if (G.hitstop > 0) G.hitstop -= dt;
      else {
        G.acc += dt * G.speed;
        let n = 0;
        const s0 = performance.now();
        while (G.acc >= STEP && n < 12) {
          w.step(STEP, G.state === 'play' ? buildInput() : {});
          for (const e in edge) edge[e] = false;
          drain();
          G.acc -= STEP; n++;
          if (G.hitstop > 0) break;
        }
        G.simMs += (performance.now() - s0 - G.simMs) * 0.1;
      }
      audio.update(w, dt);
      if (w.over && G.state === 'play') { G.state = 'end'; G.endFade = 0; }
    }
    const ui = { aimSX: mouse.x, aimSY: mouse.y, aimWX: mouse.x + (renderer.camX || 0), aimWY: mouse.y + (renderer.camY || 0) + 3, menu: G.state !== 'play', mx: Math.round(mouse.x), my: Math.round(mouse.y), click: mouse.click, rclick: mouse.rclick, give: edge.KeyG };
    renderer.draw(w, playing ? dt * (G.hitstop > 0 ? 0 : 1) : 0, ui);
    hud.draw(ctx, w, ui, playing ? dt : 0);
    if (G.state === 'inv') {
      const acts = hud.drawInventory(ctx, w, ui);
      if (acts.length) {
        const sw = acts.find((a) => a.type === 'swapTo');
        if (sw && w.player.weapons[sw.slot]) { w.player.cur = sw.slot; w.player.reloading = false; }
        const rest = acts.filter((a) => a.type !== 'swapTo');
        if (rest.length) { w.playerControl(w.player, { actions: rest, aimX: w.player.x + Math.cos(w.player.aim) * 30, aimY: w.player.y + Math.sin(w.player.aim) * 30 }, 0); drain(); }
        audio.ui('move');
      }
      edge.KeyG = false;
    } else if (G.state === 'pause') hud.drawPause(ctx, G.pauseSel);
    else if (G.state === 'end') { G.endFade = Math.min(1, G.endFade + dt * 0.5); drawEnd(ctx, w, G.t, G.endFade); }
    if (renderer.debug) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(VW / 2 - 90, VH - 58, 180, 8);
      hud.dbg = 'FPS ' + G.fps.toFixed(0) + ' SIM ' + G.simMs.toFixed(2) + 'MS FRAME ' + G.frameMs.toFixed(1) + 'MS A' + w.aliens.length + ' P' + renderer.parts.length + ' ' + (w.director ? w.director.phase : '');
      dbgText(hud.dbg);
    }
  }
  const cur = G.state === 'play' || G.state === 'inv' ? 'none' : 'default';
  if (canvas.style.cursor !== cur) canvas.style.cursor = cur;
  mouse.click = false; mouse.rclick = false;
  G.frameMs += (performance.now() - t0 - G.frameMs) * 0.1;
}
import { text as dbgT } from './render/font.js';
function dbgText(s) { dbgT(ctx, s, VW / 2, VH - 57, '#8fd0ff', { align: 0.5 }); }

function titleKey(e) {
  if (G.controls) { G.controls = false; return; }
  if (e.code === 'ArrowDown' || e.code === 'KeyS') { G.titleSel = (G.titleSel + 1) % 4; audio.ui('move'); }
  else if (e.code === 'ArrowUp' || e.code === 'KeyW') { G.titleSel = (G.titleSel + 3) % 4; audio.ui('move'); }
  else if (e.code === 'Enter' || e.code === 'Space') titleConfirm();
  else if (/^Digit\d$/.test(e.code) || /^Numpad\d$/.test(e.code)) { if (G.titleSel !== 1) { G.titleSel = 1; G.seed = ''; } if (G.seed.length < 7) G.seed += e.code.slice(-1); }
  else if (e.code === 'Backspace') { G.titleSel = 1; G.seed = G.seed.slice(0, -1); }
}
function titleConfirm() {
  audio.init(); audio.ui('ok');
  if (G.titleSel === 0 || G.titleSel === 1) start({ seed: Number(G.seed) || 1 });
  else if (G.titleSel === 2) G.seed = String(Math.floor(Math.random() * 99999) + 1);
  else G.controls = true;
}

window.addEventListener('keydown', (e) => {
  if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].includes(e.code) || (e.ctrlKey && ['KeyS', 'KeyD', 'KeyW', 'KeyA', 'KeyC'].includes(e.code))) e.preventDefault();
  audio.init();
  if (e.repeat) return;
  if (e.code === 'KeyM') audio.setMute(!audio.muted);
  if (e.code === 'F3' || e.code === 'Backquote') { renderer.debug = !renderer.debug; e.preventDefault(); }
  if (G.state === 'title') return titleKey(e);
  if (G.state === 'play') {
    keys[e.code] = true; edge[e.code] = true;
    if (e.code === 'Tab') { G.state = 'inv'; }
    else if (e.code === 'Escape' || e.code === 'KeyP') { G.state = 'pause'; G.pauseSel = 0; }
    if (hud.logView && e.code === 'KeyE') hud.logView.t = Math.min(hud.logView.t, 0.2);
    if (hud.brief && hud.brief.t < 8) hud.brief.t = Math.min(hud.brief.t, 0.5);
  } else if (G.state === 'inv') {
    if (e.code === 'Tab' || e.code === 'Escape') G.state = 'play';
    if (e.code === 'KeyG') edge.KeyG = true;
  } else if (G.state === 'pause') {
    if (e.code === 'Escape' || e.code === 'KeyP') G.state = 'play';
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') G.pauseSel = (G.pauseSel + 1) % 3;
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') G.pauseSel = (G.pauseSel + 2) % 3;
    else if (e.code === 'Enter' || e.code === 'Space') { if (G.pauseSel === 0) G.state = 'play'; else if (G.pauseSel === 1) start({ seed: G.world.seed, scene: G.world.scene }); else G.state = 'title'; }
  } else if (G.state === 'end' && G.endFade > 0.6) {
    if (e.code === 'KeyR') start({ seed: G.world.seed, scene: G.world.scene });
    else if (e.code === 'KeyN') start({ seed: Math.floor(Math.random() * 99999) + 1 });
    else if (e.code === 'Escape') G.state = 'title';
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; if (G.state === 'play' && !G.world.autoplay) G.state = 'pause'; });
function mpos(e) { const r = canvas.getBoundingClientRect(); mouse.x = ((e.clientX - r.left) / r.width) * VW; mouse.y = ((e.clientY - r.top) / r.height) * VH; }
window.addEventListener('mousemove', mpos);
canvas.addEventListener('mousedown', (e) => {
  mpos(e); audio.init(); e.preventDefault();
  if (G.state === 'title') { if (G.controls) G.controls = false; else { const i = mouse.y < 182 ? 0 : Math.floor((mouse.y - 170) / 12); if (mouse.y > 162 && i >= 0 && i < 4) { G.titleSel = i; titleConfirm(); } } return; }
  if (e.button === 0) { mouse.down = true; mouse.click = true; edge.fire = true; }
  else if (e.button === 1) edge.mid = true;
  else if (e.button === 2) mouse.rclick = true;
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.down = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Debug / automation surface.
window.__game = {
  G, renderer, hud, audio, scenes: SCENES,
  get world() { return G.world; },
  start, snapshot: () => (G.world ? G.world.snapshot() : null),
  scene: (name) => start({ scene: name, seed: 1 }),
  step(n = 60, input) { const w = G.world; for (let i = 0; i < n && !w.over; i++) { w.step(STEP, input || {}); drain(); } return w.snapshot(); },
  setSpeed: (s) => (G.speed = s),
  key(code, down = true) { keys[code] = down; if (down) edge[code] = true; },
  perf: () => ({ fps: +G.fps.toFixed(1), simMs: +G.simMs.toFixed(3), frameMs: +G.frameMs.toFixed(2), aliens: G.world ? G.world.aliens.length : 0, parts: renderer.parts.length }),
};

if (params.get('scene')) start({ scene: params.get('scene'), seed: Number(params.get('seed')) || 1 });
else if (params.get('seed') && params.get('go') !== '0' && (params.get('autoplay') || params.get('go'))) start({ seed: Number(params.get('seed')) });
if (params.get('mute') === '1') audio.muted = true;
requestAnimationFrame(frame);

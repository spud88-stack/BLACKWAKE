# BLACKWAKE

Last shift on the ISV Calliope. A top-down pixel-art squad survival-horror game: lead three
AI squadmates through a procedurally generated, infested starship, finish a seeded set of
objectives, and get off alive.

No build step, no dependencies, no assets — everything (art, lighting, audio) is generated
in code.

## Run

```bash
./serve.sh
```

Then open <http://127.0.0.1:8417>. (Any static file server works; `tools/serve.py` just
disables caching so edits show up on reload. ES modules need `http://`, not `file://`.)

## Controls

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| WASD | Move | Mouse | Aim / fire |
| R | Reload | E (hold) | Interact, search, revive, reassure |
| Q / 1 2 | Swap weapon | Shift | Sprint (loud) |
| Ctrl / C | Sneak (silent) | F | Flashlight |
| H | Treat wounds | G / T | Throw / cycle throwable |
| V | Melee shove | B + E | Weld a door or vent (needs welder) |
| Z / X | Squad: follow / hold | Space / middle mouse | Ping: move there, focus a target, work a console |
| Tab | Inventory + deck plan | P / Esc | Pause |
| M | Mute | F3 or ` | AI debug overlay |

Things the game does not tell you twice:

- Light is a mechanic. Your flashlight makes you visible; darkness hides you from most
  things, but not from Lurkers — which avoid a beam pointed at them.
- Noise is a mechanic. Gunfire, sprinting and prying doors all carry. Skitterers hunt by
  ear and wait for the pack. A Lure pulls them off you.
- Brutes are armoured in front and cannot turn quickly. Make them charge a wall.
- Kill the Shrieker first, or do not let it see you.
- Restoring power lights the ship and opens sealed bulkheads. It also wakes things up.
- A squadmate who is panicking can be talked down: stand next to them and hold E.

## Seeds, scenes and debugging

URL parameters:

| Parameter | Effect |
| --- | --- |
| `?seed=1234&go=1` | Start that seed immediately |
| `?scene=<name>` | Small deterministic arena: `combat`, `pursuit`, `squad`, `objective`, `inventory`, `stress`, `injured`, `horde`, `empty`, `dark` |
| `?autoplay=1` | The autopilot plays the leader (same AI the tests use) |
| `?debug=1` | AI overlay: chosen action, reason, utility scores, paths, alien awareness, noise rings |
| `?speed=3` | Simulation speed multiplier |
| `?mute=1` | Start muted |

In the console, `window.__game` exposes `snapshot()` (player, squad, aliens, objectives,
director, perf), `step(n, input)`, `start({seed, scene, finale, comps})`, `scene(name)`,
`setSpeed(x)`, `perf()`, and the live `world`.

## Tests

```bash
./test.sh
```

```bash
./test.sh lurker
```

Runs headless in the JavaScript shell that ships with macOS (falls back to Node 18+ if
present). 35 tests: generation and reachability across 40 seeds, determinism, every weapon,
inventory, injuries, composure, each alien's signature behaviour, squad following / fire
discipline / sharing / retreat, power interactions, and full missions played start to
finish by the autopilot for all three finales and twelve seeds.

## How it is built

- `src/sim/` — the whole game as a DOM-free, fixed-step (60 Hz), seeded simulation.
  - `gen.js` deck plan: spine corridor, sectioned blocks split into typed rooms, doors
    from a spanning tree plus loops, dressing with connectivity checks, vents, lights.
  - `nav.js` tile A* with per-agent door costs and danger costs, string-pulled paths, rays.
  - `light.js` half-tile light grid with occlusion. The same grid drives rendering, alien
    sight, lurker behaviour and composure.
  - `squadai.js`, `aliens.js` utility AI with hysteresis; every agent records what it
    chose and why.
  - `director.js` build / peak / relax pacing with a bounded population and vent spawns.
  - `mission.js` objective graph, complications, lock-and-key placement, initial population.
  - `scenarios.js` named debug scenes.
- `src/render/` — Canvas 2D at 480x270, integer-scaled. Procedural sprites, baked tile
  map, persistent decal layer, y-sorted entities, light-grid multiply, emissive pass.
- `src/audio/` — WebAudio synthesis, positional pan / falloff / occlusion, generated reverb.

## Known limitations

- No image-generation tool was available, so there are no concept paintings; the art
  direction was iterated on real screenshots instead. All art is procedural pixel work.
- Audio is fully synthesised. It was verified to initialise and run without errors, but it
  was tuned by reading code, not by ear.
- Difficulty was balanced against the autopilot (which wins most seeds in 3-6 minutes). A
  human run is slower and takes more director pressure; expect 10-20 minutes and a harder
  time. There is no difficulty setting yet.
- One deck per run; no save/load, no meta-progression, keyboard and mouse only.

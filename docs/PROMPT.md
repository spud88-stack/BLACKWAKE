# BLACKWAKE — build brief (revised prompt)

Build a polished, replayable pixel-art space-horror game: a squad of survivors, led by the
player, fights through an alien infestation aboard the ISV Calliope. It must feel like a
shipped indie game, not a tech demo. The player experience is the final criterion.

## Pillars (in priority order — resolve conflicts in this order)

1. **Gunplay feels great.** Recoil, cadence, muzzle light, tracers, casings, hit-stun,
   knockback, impact particles, screen kick, distinct reports. Ammo is tight but fair.
2. **Light is a game mechanic, not a filter.** One light model drives rendering, alien
   sight, stress, and stealth. Flashlights reveal you; darkness hides both sides.
3. **Characters, not turrets.** Teammates and aliens run on an inspectable utility AI.
   Every decision has a logged reason.
4. **Runs tell stories.** Systems (power, doors, vents, fire, alarms, stress, injuries)
   interact so that emergent chains happen without scripting.
5. **Dread through uncertainty.** A pacing director guarantees quiet stretches, partial
   information, and sounds you can't fully trust.

## Game

- **Perspective:** top-down 3/4, 480x270 internal resolution, integer-scaled, WASD + mouse.
- **Ship:** seeded procedural deck plan — a spine corridor, sectioned blocks split into
  typed rooms (reactor, bridge, hangar, medbay, lab, armory, ...), cross-corridors, loops,
  a vent network for aliens, keycard/power locks placed with lock-and-key reachability
  guarantees. Rooms are dressed by type and by "what happened here" set-pieces (last
  stands, nests, massacres), with readable crew logs.
- **Ship systems that matter:** sectioned power (lights, automatic doors, medbay, arc
  hazards, fire suppression), manual prying of unpowered doors (slow, loud), weldable doors
  and vents, alarms that attract aliens, brownouts, fire that lights rooms and repels
  swarms, life support decay.
- **Weapons (distinct archetypes):** pistol, PDW, pump shotgun (per-shell reload), rifle
  (penetration), arc caster (chains, stuns, quiet), incinerator (cone, sets fires), melee
  shove. Throwables: frag, flare (light + composure), lure (sound decoy). Differ in damage,
  cadence, spread/bloom, range, reload, noise, stagger, penetration, ammo type, rarity.
- **Aliens (each must be recognisable by behaviour alone):**
  - *Skitterer* — sound-hunting pack; masses up out of sight, flanks via other doors,
    claws through doors, breaks off when hurt and alone, fears fire.
  - *Lurker* — stalks in darkness at the edge of vision, shuns flashlight beams, moves
    through vents, strikes the isolated/reloading/trailing squadmate, then withdraws.
  - *Brute* — armoured front, smashes doors, telegraphed charge that stuns it on walls.
  - *Spitter* — holds range, lobs acid that pools, relocates, flees when pressed.
  - *Shrieker* — hides, screams (stress + alerts the deck + reinforcements), runs.
  - *Nests* — spawn skitterers when agitated; guarded; must be burned or shot out.
  Perception = sight (range x light on the target x FOV), hearing (noise events with
  radius and occlusion), decaying last-known positions with error, and pack sharing.
- **Squad (3 drawn from 5 per run):** soldier, medic, engineer, rookie, scout — each with
  composure, bravery, skill, weapon preferences and voice. Utility actions: follow
  (breadcrumb trail in corridors, fan out when halted), hold, engage with tactical
  positioning and firing-lane checks, reload safely, retreat, heal self/ally, revive, share
  and request ammo/meds, loot what they need, investigate, clear doorways, volunteer for
  repairs, avoid hazards, panic by personality (flee / freeze / spray). Player commands:
  follow, hold, ping, reassure, give item.
- **Health:** HP plus conditions — bleeding (stacking drain), leg wound (slow, no sprint),
  arm wound (sway, slow reload), acid burn. Downed state with bleed-out and revives.
  Bandage / medkit / powered medbay station.
- **Composure:** continuous pressure-vs-relief model with event spikes and a permanent
  trauma floor. Named stressors are shown on the HUD (DARK, ALONE, HUNTED, ...). Tiers
  change aim sway, reloads, heartbeat/breath audio, vignette, and at the top end phantom
  sounds, false tracker blips and brief phantom silhouettes. Never removes player control.
- **Loot:** 2 weapon slots + 8 belt slots + pooled ammo + key items. Containers by room
  type; auto-pickup ammo; one-key use/drop/give. Rare finds: arc caster, incinerator,
  motion tracker, armour, welder.
- **Missions:** seeded dependency graph. Finale is one of: launch the shuttle, call
  extraction and hold the airlock, or scuttle the ship and reach the pods on a timer.
  2-4 intermediate objectives (restore power, restart life support under defence, find a
  part, recover the command card, pull the data core, burn nests, rescue a survivor) plus
  1-2 complications (blackout, fire, lockdown, infestation, failing life support, alarm).
  Objectives interact: power wakes a dormant nest and energises arc hazards but stops
  fires and opens bulkheads. Dynamic "medical emergency" side objective.
- **Director:** build / peak / relax pacing, bounded population, vent spawns out of
  sight, ambient false alarms in the quiet.

## Additions beyond the original brief

- Motion tracker item whose blips can lie when you are panicking.
- Squad breadcrumb following + "reassure" interaction to talk a teammate down.
- Welding doors/vents shut as a real tactical verb.
- Crew terminal logs and scene set-pieces for environmental storytelling.
- A deterministic headless simulation with an autopilot leader, so full missions can be
  played end-to-end in automated tests across many seeds.
- End-of-run debrief (survivors, kills, time, seed) and same-seed retry.

## Engineering

- Zero-build vanilla ES modules + Canvas 2D + WebAudio (all art and sound procedural, no
  asset pipeline). Simulation is DOM-free, fixed-step, seeded, and runs headless.
- Tile grid + A* with per-agent door costs and danger costs, string-pulled paths,
  soft agent separation (squadmates never hard-block the player).
- Utility AI with hysteresis for humans and aliens; debug overlay shows action scores.
- Debug surface: `?seed=`, `?scene=<name>`, `?debug=1`, `?autoplay=1`, `window.__game`
  (snapshot, step, speed). Named scenes: combat, pursuit, squad, objective, inventory,
  stress, injured, horde.
- Workflow: vertical slice -> play it -> expand -> dedicated polish passes judged from
  real screenshots. Definition of done: tests green, multiple seeds completed by the
  autopilot, death/restart clean, screenshots reviewed, limitations stated honestly.

// Static game data: weapons, items, aliens, squad, rooms, loot.

export const AMMO = {
  light: { name: '9MM', cap: 120, color: '#e8c468' },
  shell: { name: 'SHELLS', cap: 32, color: '#d9603a' },
  rifle: { name: '5.56', cap: 96, color: '#c9d06a' },
  cell: { name: 'CELLS', cap: 24, color: '#5fd6e8' },
  fuel: { name: 'FUEL', cap: 200, color: '#ff9a3a' },
};

// rate = seconds between shots; spread/bloom in radians; range/noise in px.
export const WEAPONS = {
  pistol: { name: 'P-9 SIDEARM', ammo: 'light', mag: 12, dmg: 17, rate: 0.17, auto: false, spread: 0.018, bloom: 0.035, bloomMax: 0.12, pellets: 1, range: 250, reload: 1.15, kick: 1.6, noise: 210, pen: 0, stagger: 0.14, knock: 26, len: 7, rarity: 0, desc: 'Reliable. Accurate. Quiet enough.' },
  smg: { name: 'WASP PDW', ammo: 'light', mag: 30, dmg: 9.5, rate: 0.068, auto: true, spread: 0.045, bloom: 0.016, bloomMax: 0.2, pellets: 1, range: 210, reload: 1.5, kick: 1.0, noise: 230, pen: 0, stagger: 0.07, knock: 12, len: 9, rarity: 1, desc: 'Fast and hungry. Walks off target.' },
  shotgun: { name: 'BULKHEAD 12G', ammo: 'shell', mag: 6, dmg: 10, rate: 0.72, auto: false, spread: 0.17, bloom: 0, bloomMax: 0.17, pellets: 8, range: 150, reload: 0.42, shellReload: true, kick: 4.2, noise: 330, pen: 0, stagger: 0.5, knock: 130, len: 12, rarity: 1, desc: 'Clears a doorway. Loads one shell at a time.' },
  rifle: { name: 'M4 LANCER', ammo: 'rifle', mag: 24, dmg: 21, rate: 0.115, auto: true, spread: 0.012, bloom: 0.013, bloomMax: 0.11, pellets: 1, range: 340, reload: 1.75, kick: 1.9, noise: 300, pen: 1, stagger: 0.16, knock: 34, len: 13, rarity: 2, desc: 'Punches through one target into the next.' },
  arc: { name: 'ARC CASTER', ammo: 'cell', mag: 8, dmg: 36, rate: 0.55, auto: false, spread: 0.01, bloom: 0, bloomMax: 0.01, pellets: 1, range: 170, reload: 2.0, kick: 2.2, noise: 110, pen: 0, stagger: 0.9, knock: 10, chain: 3, len: 11, rarity: 3, desc: 'Chains between targets and locks them up. Nearly silent.' },
  flamer: { name: 'INCINERATOR', ammo: 'fuel', mag: 100, dmg: 46, rate: 0.05, auto: true, spread: 0.2, bloom: 0, bloomMax: 0.2, pellets: 0, range: 84, reload: 2.4, kick: 0.3, noise: 150, pen: 0, stagger: 0.05, knock: 0, flame: true, len: 12, rarity: 3, desc: 'Burns nests. Lights rooms. Careful where you point it.' },
};

export const BELT_SIZE = 8;
export const MATE_BELT = 4;

// kind: med | throw | util | key | passive
export const ITEMS = {
  bandage: { name: 'BANDAGE', kind: 'med', stack: 4, desc: 'Stops bleeding. Small heal.' },
  medkit: { name: 'MEDKIT', kind: 'med', stack: 2, desc: 'Heals 55. Treats bleeding and wounds.' },
  stim: { name: 'CALMEX', kind: 'med', stack: 3, desc: 'Steadies the nerves. Composure +45.' },
  flare: { name: 'FLARE', kind: 'throw', stack: 4, desc: 'Burns for 40s. Light calms the squad and drives Lurkers back.' },
  grenade: { name: 'FRAG', kind: 'throw', stack: 3, desc: 'Big, loud, indiscriminate.' },
  lure: { name: 'LURE', kind: 'throw', stack: 3, desc: 'Beeps for 12s. Anything hunting by sound goes to it.' },
  battery: { name: 'BATTERY', kind: 'util', stack: 3, desc: 'Refills your flashlight.' },
  welder: { name: 'WELDER', kind: 'util', stack: 1, charges: 4, desc: 'Seal a door or vent. Four charges.' },
  armor: { name: 'PLATE VEST', kind: 'passive', stack: 1, desc: 'Absorbs 45% of damage until it breaks.' },
  tracker: { name: 'TRACKER', kind: 'passive', stack: 1, desc: 'Pings movement nearby. Trust it while you are calm.' },
  key_sec: { name: 'SECURITY CARD', kind: 'key', desc: 'Opens security-locked doors.' },
  key_cmd: { name: 'COMMAND CARD', kind: 'key', desc: 'Opens command-locked doors.' },
  fuse: { name: 'REACTOR FUSE', kind: 'key', desc: 'Mission item.' },
  relay: { name: 'RELAY UNIT', kind: 'key', desc: 'Mission item.' },
  fuelcell: { name: 'FUEL CELL', kind: 'key', desc: 'Mission item.' },
  datacore: { name: 'DATA CORE', kind: 'key', desc: 'Mission item.' },
  filter: { name: 'SCRUBBER FILTER', kind: 'key', desc: 'Mission item.' },
};

export const ALIENS = {
  skitterer: { name: 'SKITTERER', hp: 30, r: 4, speed: 84, rush: 110, sight: 110, darkSight: 0.3, fov: 2.4, hear: 1.25, dmg: 7, atkCd: 0.8, reach: 12, threat: 0.7, fearFire: true, doorCost: 22, color: '#e8a23a', mass: 0.6 },
  lurker: { name: 'LURKER', hp: 110, r: 5, speed: 54, rush: 158, sight: 230, darkSight: 1.0, fov: 3.0, hear: 0.9, dmg: 24, atkCd: 1.1, reach: 15, threat: 1.8, fearFire: true, doorCost: Infinity, vents: true, color: '#7fe3ee', mass: 1.2 },
  brute: { name: 'BRUTE', hp: 380, r: 7.5, speed: 38, rush: 190, sight: 150, darkSight: 0.45, fov: 1.9, hear: 1.0, dmg: 30, atkCd: 1.5, reach: 18, threat: 3.0, fearFire: false, doorCost: 7, armored: true, color: '#e8463a', mass: 4 },
  spitter: { name: 'SPITTER', hp: 60, r: 5, speed: 58, rush: 76, sight: 190, darkSight: 0.6, fov: 2.6, hear: 0.8, dmg: 12, atkCd: 2.6, reach: 150, threat: 1.3, fearFire: true, doorCost: Infinity, vents: true, color: '#9be84a', mass: 1 },
  shrieker: { name: 'SHRIEKER', hp: 42, r: 4.5, speed: 80, rush: 96, sight: 160, darkSight: 0.7, fov: 3.2, hear: 1.1, dmg: 0, atkCd: 24, reach: 0, threat: 1.0, fearFire: true, doorCost: Infinity, vents: true, color: '#f04ad0', mass: 0.8 },
  nest: { name: 'NEST', hp: 260, r: 11, speed: 0, rush: 0, sight: 0, darkSight: 0, fov: 0, hear: 1.0, dmg: 0, atkCd: 0, reach: 0, threat: 0.5, static: true, color: '#c05ae0', mass: 99 },
};

// resilience: >1 gains stress slower. bravery: 0 timid .. 1 fearless. panic: flee | freeze | spray
export const CHARACTERS = {
  okafor: { name: 'OKAFOR', full: 'Sgt. Ilse Okafor', role: 'SOLDIER', suit: '#5d6b4a', accent: '#c9b458', skin: '#8a5a3c', hair: '#1c1a1a', helmet: true, resilience: 1.45, bravery: 0.9, aim: 0.9, prefs: ['rifle', 'shotgun', 'smg'], panic: 'spray', pitch: 150, weapons: ['rifle', 'pistol'] },
  lindqvist: { name: 'LINDQVIST', full: 'Dr. Teo Lindqvist', role: 'MEDIC', suit: '#c8d2d8', accent: '#d8504a', skin: '#e0b090', hair: '#c9a24a', helmet: false, resilience: 1.0, bravery: 0.45, aim: 0.62, prefs: ['smg', 'pistol'], panic: 'flee', pitch: 210, medic: true, weapons: ['pistol'] },
  havel: { name: 'HAVEL', full: 'Dmitri "Rook" Havel', role: 'ENGINEER', suit: '#c27a2c', accent: '#f0d060', skin: '#d8a078', hair: '#5a3a22', helmet: false, resilience: 0.95, bravery: 0.6, aim: 0.7, prefs: ['shotgun', 'smg', 'flamer'], panic: 'spray', pitch: 125, engineer: true, weapons: ['shotgun'] },
  park: { name: 'PARK', full: 'Pvt. June Park', role: 'ROOKIE', suit: '#4a6a8a', accent: '#8ad0f0', skin: '#e6c0a0', hair: '#201820', helmet: true, resilience: 0.7, bravery: 0.35, aim: 0.8, prefs: ['smg', 'rifle', 'pistol'], panic: 'freeze', pitch: 260, weapons: ['smg'] },
  amari: { name: 'AMARI', full: 'Kes Amari', role: 'SCOUT', suit: '#3c3a4a', accent: '#7fe0a0', skin: '#a8724c', hair: '#e8e0d0', helmet: false, resilience: 1.2, bravery: 0.7, aim: 0.85, prefs: ['pistol', 'arc', 'rifle'], panic: 'flee', pitch: 185, scout: true, weapons: ['pistol'] },
  survivor: { name: 'REYES', full: 'Tech. Ana Reyes', role: 'SURVIVOR', suit: '#7a7a82', accent: '#e8e8e8', skin: '#c89070', hair: '#3a2a20', helmet: false, resilience: 0.6, bravery: 0.25, aim: 0.5, prefs: ['pistol'], panic: 'flee', pitch: 230, weapons: ['pistol'] },
};
export const PLAYER_CHAR = { name: 'YOU', full: 'Cpl. R. Vance', role: 'LEADER', suit: '#3f5a78', accent: '#f0f0f0', skin: '#d8a888', hair: '#3a2c20', helmet: true, resilience: 1.0, bravery: 0.7, aim: 1, prefs: [], panic: 'none', pitch: 170, weapons: ['pistol'] };

// light: [r,g,b] room tint with power on.
export const ROOMS = {
  corridor: { name: 'CORRIDOR', floor: 'grate', light: [0.62, 0.74, 0.86] },
  reactor: { name: 'REACTOR CORE', floor: 'plate', light: [0.95, 0.7, 0.45] },
  bridge: { name: 'BRIDGE', floor: 'deck', light: [0.55, 0.75, 0.95] },
  hangar: { name: 'HANGAR BAY', floor: 'cargo', light: [0.8, 0.82, 0.78] },
  cargo: { name: 'CARGO HOLD', floor: 'cargo', light: [0.78, 0.74, 0.62] },
  medbay: { name: 'MEDBAY', floor: 'clean', light: [0.72, 0.95, 0.88] },
  lifesupport: { name: 'LIFE SUPPORT', floor: 'plate', light: [0.6, 0.85, 0.8] },
  comms: { name: 'COMMS ARRAY', floor: 'deck', light: [0.55, 0.7, 0.98] },
  armory: { name: 'ARMORY', floor: 'plate', light: [0.85, 0.8, 0.7] },
  lab: { name: 'XENOBIOLOGY LAB', floor: 'clean', light: [0.55, 0.9, 0.98] },
  quarters: { name: 'CREW QUARTERS', floor: 'carpet', light: [0.98, 0.8, 0.58] },
  mess: { name: 'MESS HALL', floor: 'carpet', light: [0.95, 0.85, 0.65] },
  security: { name: 'SECURITY', floor: 'deck', light: [0.7, 0.75, 0.95] },
  hydro: { name: 'HYDROPONICS', floor: 'grate', light: [0.9, 0.5, 0.9] },
  cryo: { name: 'CRYO BAY', floor: 'clean', light: [0.6, 0.8, 1.0] },
  storage: { name: 'STORAGE', floor: 'plate', light: [0.8, 0.78, 0.7] },
  maint: { name: 'MAINTENANCE', floor: 'grate', light: [0.9, 0.78, 0.5] },
  server: { name: 'SERVER ROOM', floor: 'deck', light: [0.5, 0.65, 0.98] },
  pods: { name: 'ESCAPE PODS', floor: 'deck', light: [0.9, 0.8, 0.6] },
};

// Loot tables: [itemId, weight, min, max]. Ammo ids are 'a:<type>', weapons 'w:<id>'.
export const LOOT = {
  generic: [['a:light', 34, 12, 22], ['a:shell', 14, 4, 8], ['a:rifle', 14, 12, 20], ['bandage', 16, 1, 1], ['battery', 12, 1, 1], ['flare', 12, 1, 2], ['lure', 5, 1, 1], ['stim', 5, 1, 1], ['none', 20, 0, 0]],
  medical: [['bandage', 34, 1, 2], ['medkit', 24, 1, 1], ['stim', 22, 1, 2], ['a:light', 6, 6, 10], ['none', 8, 0, 0]],
  armory: [['a:light', 18, 14, 24], ['a:shell', 18, 6, 10], ['a:rifle', 20, 14, 24], ['a:cell', 8, 3, 6], ['grenade', 14, 1, 2], ['armor', 8, 1, 1], ['flare', 6, 2, 2]],
  weapons: [['w:shotgun', 30, 1, 1], ['w:smg', 30, 1, 1], ['w:rifle', 26, 1, 1], ['w:arc', 7, 1, 1], ['w:flamer', 7, 1, 1]],
  tools: [['battery', 30, 1, 2], ['welder', 14, 1, 1], ['flare', 20, 1, 2], ['lure', 14, 1, 2], ['a:fuel', 10, 30, 60], ['tracker', 5, 1, 1], ['a:shell', 8, 3, 5], ['none', 10, 0, 0]],
  personal: [['a:light', 30, 10, 18], ['bandage', 14, 1, 1], ['stim', 12, 1, 1], ['battery', 14, 1, 1], ['flare', 8, 1, 1], ['none', 30, 0, 0]],
  lab: [['a:cell', 26, 3, 6], ['stim', 18, 1, 2], ['medkit', 12, 1, 1], ['tracker', 8, 1, 1], ['battery', 14, 1, 1], ['w:arc', 5, 1, 1], ['none', 14, 0, 0]],
  corpse: [['a:light', 28, 10, 18], ['a:rifle', 14, 10, 18], ['a:shell', 12, 3, 6], ['bandage', 12, 1, 1], ['flare', 8, 1, 1], ['battery', 8, 1, 1], ['grenade', 5, 1, 1], ['none', 18, 0, 0]],
};

// Props. w/h in tiles. tall blocks sight and bullets. container = loot table.
export const PROPS = {
  crate: { w: 1, h: 1, solid: true, tall: false, container: 'generic', label: 'CRATE' },
  crate2: { w: 1, h: 1, solid: true, tall: true },
  barrel: { w: 1, h: 1, solid: true, tall: false },
  locker: { w: 1, h: 1, solid: true, tall: true, container: 'personal', label: 'LOCKER' },
  toolbox: { w: 1, h: 1, solid: true, tall: false, container: 'tools', label: 'TOOL CABINET' },
  medcab: { w: 1, h: 1, solid: true, tall: true, container: 'medical', label: 'MED CABINET' },
  gunrack: { w: 1, h: 1, solid: true, tall: true, container: 'weapons', label: 'WEAPON RACK' },
  ammobox: { w: 1, h: 1, solid: true, tall: false, container: 'armory', label: 'AMMO CASE' },
  labcab: { w: 1, h: 1, solid: true, tall: true, container: 'lab', label: 'SAMPLE LOCKER' },
  bed: { w: 1, h: 2, solid: true, tall: false },
  bunk: { w: 1, h: 2, solid: true, tall: false },
  table: { w: 2, h: 1, solid: true, tall: false },
  console: { w: 1, h: 1, solid: true, tall: false, glow: [0.25, 0.75, 0.9] },
  rack: { w: 1, h: 1, solid: true, tall: true, glow: [0.2, 0.5, 0.9] },
  tank: { w: 1, h: 1, solid: true, tall: true, glow: [0.3, 0.9, 0.7] },
  tankBroken: { w: 1, h: 1, solid: true, tall: false },
  machine: { w: 2, h: 1, solid: true, tall: true },
  scrubber: { w: 2, h: 2, solid: true, tall: true },
  pipes: { w: 1, h: 1, solid: true, tall: true },
  planter: { w: 1, h: 2, solid: true, tall: false, glow: [0.7, 0.3, 0.7] },
  shelf: { w: 1, h: 2, solid: true, tall: true },
  cryopod: { w: 1, h: 2, solid: true, tall: true, glow: [0.3, 0.6, 0.9] },
  reactor: { w: 3, h: 3, solid: true, tall: true, glow: [1.0, 0.6, 0.25] },
  shuttle: { w: 6, h: 3, solid: true, tall: true },
  pod: { w: 1, h: 2, solid: true, tall: true, glow: [0.9, 0.7, 0.3] },
  barricade: { w: 1, h: 1, solid: true, tall: false },
  medstation: { w: 1, h: 1, solid: true, tall: true, glow: [0.3, 0.9, 0.5], interact: 'medstation', label: 'AUTO-DOC' },
  terminal: { w: 1, h: 1, solid: true, tall: false, glow: [0.3, 0.9, 0.5], interact: 'log', label: 'TERMINAL' },
  objconsole: { w: 1, h: 1, solid: true, tall: false, glow: [0.95, 0.75, 0.25], interact: 'objective', label: 'CONSOLE' },
  corpse: { w: 1, h: 1, solid: false, tall: false, container: 'corpse', label: 'BODY' },
};

export const LOGS = [
  ['MAINT LOG 0412', 'Scraping in the port vent trunk again. Third night. Havel says rats. We do not carry rats.'],
  ['MED LOG', 'Patient woke screaming about the lights. Says they do not like the lights. Sedated. Left the lamp on.'],
  ['CAPTAIN - PRIVATE', 'Sealed the lab on my authority. If command asks, the sample was lost in transit. God forgive me.'],
  ['SECURITY', 'They go quiet when it is dark and you stand still. Kowalski stood still for an hour. Then he sneezed.'],
  ['CARGO MANIFEST', 'Container 7-C logged as "mineral cores". Mineral cores do not need a heartbeat monitor.'],
  ['ENGINEERING', 'Do NOT restore main bus without clearing deck C first. Power wakes them. Learned that once.'],
  ['PERSONAL - J.P.', 'Mom, if this gets out: the big ones cannot turn fast. Get behind them. I love you.'],
  ['LAB NOTES', 'Specimen avoids direct light, tracks sound with remarkable accuracy. The small ones wait for each other.'],
  ['BRIDGE', 'Distress beacon active nine days. No reply. Life support holding. Morale is not.'],
  ['MESS BOARD', 'TUESDAY: STEW. WEDNESDAY: STEW. Someone has scratched: THURSDAY: US.'],
  ['MAINT LOG 0419', 'Welded the galley vent shut. It bought us a night. They found the next one.'],
  ['QUARANTINE NOTICE', 'The one with the frill does not fight. It calls. Kill it first, or do not let it see you.'],
  ['HYDROPONICS', 'Something has been eating the tomatoes. And then something ate Dr. Mbeki.'],
  ['FINAL ENTRY', 'Fire works. Fire is all that works. We are almost out of fire.'],
];

'use strict';
/* exported GUIDE_DATA */

// ── GUIDE CONTENT ────────────────────────────────────────────────────────────
// Everything guide mode shows lives in this one object, so it can be edited
// without touching script.js. It is a plain script (not JSON) because browsers
// refuse to fetch() local files when index.html is opened from disk.
//
// The guide is split into blocks, each with groups inside (see GUIDE_BLOCKS in script.js):
//   Enemies, Fronts and Loadouts, each by faction; Armour perks by armour weight; Guns by gun
//   type; Stratagems by stratagem type; Game mechanics by topic (the galactic map, missions,
//   combat, your ship). Each list below says which field puts an entry in its group, and
//   `groups` lists the groups in reading order. A group with no entries says "Nothing written
//   here yet" on the page.
//
// Rules for editing:
// - Write in your own words. Never paste wiki text.
// - Every entry needs an id (unique across the whole file), a confidence
//   ('high' | 'medium' | 'low') and the ids of its sources.
// - If you checked a fact somewhere, add that place to `sources` and cite it.
// - Numbers change with balance patches. When you re-check an entry against
//   the current patch, raise its confidence and update gameVersion below.
// - pairsWith / loadout ids must point at entries that exist (a test checks).
// - faction is 'terminids', 'automaton' or 'illuminate'.
// - verifiedInPatch (optional, any entry): the patch you checked the entry in, as the game
//   writes it, e.g. verifiedInPatch: '01.004.100'. The card then says "✓ Checked in game
//   (patch …)", and the guide's "Checked in game only" filter finds it. Add 'owner' to its sources.
//
// confidence: high = well established and unlikely to have changed;
//             medium = right in spirit, exact numbers may have moved;
//             low = known to have been rebalanced since, check in game.

const GUIDE_DATA = {
  schemaVersion: 2,
  lastEdited: '2026-09-27',
  // What the content was written against. The game has moved on since; see below.
  gameVersion: '1.003-era (2025 patches)',
  currentPatchWhenWritten: '7.1.0 (released 24 Sep 2026, according to a web search)',
  checkedAgainstCurrentPatch: false,
  // Shown after a bold "Community knowledge, not official." label.
  disclaimer:
    'Put together with the help of AI (Claude, by Anthropic) from general community knowledge, ' +
    'and not yet checked in game; this is not official information from Arrowhead. The game is ' +
    'rebalanced often, so numbers here can be out of date. When the game and this guide ' +
    'disagree, the game is right.',

  sources: [
    {
      id: 'author',
      label: 'General community knowledge up to the 2025 patches, written with the help of AI (Claude, by Anthropic) and not yet checked in game.',
      urls: [],
    },
    {
      id: 'web-search-2026-09-27',
      label: 'Web search result summaries read on 27 Sep 2026. The wiki pages themselves could not be opened from the build environment, so only the facts quoted in the summaries were checked.',
      urls: [
        'https://helldivers.wiki.gg/wiki/Ship_Modules',
        'https://helldivers.wiki.gg/wiki/Reinforce',
        'https://helldivers.wiki.gg/wiki/Armor_Passives',
        'https://www.gamesradar.com/helldivers-2-ship-modules/',
        'https://games.gg/helldivers-2/guides/helldivers-2-armor-passives-guide/',
      ],
    },
    {
      id: 'owner',
      label: 'The site owner\'s own experience in game, checked in the current patch.',
      urls: [],
    },
  ],

  // ── HOW THE GUIDE IS SPLIT ─────────────────────────────────────────────────
  // The groups inside each block, in reading order (the three factions are fixed). To add a
  // group, add a line; entries join it through the field named in each list's comment below.
  groups: {
    armourWeights: [
      { key: 'light', label: 'Light armour' },
      { key: 'medium', label: 'Medium armour' },
      { key: 'heavy', label: 'Heavy armour' },
    ],
    gunTypes: [
      { key: 'assault-rifle', label: 'Assault rifles' },
      { key: 'marksman-rifle', label: 'Marksman rifles' },
      { key: 'submachine-gun', label: 'Submachine guns' },
      { key: 'shotgun', label: 'Shotguns' },
      { key: 'explosive', label: 'Explosive primaries' },
      { key: 'energy', label: 'Energy weapons' },
      { key: 'special-primary', label: 'Special primaries' },
      { key: 'pistol', label: 'Pistols' },
      { key: 'special-secondary', label: 'Special secondaries' },
    ],
    stratagemTypes: [
      { key: 'Orbital', label: 'Orbital strikes' },
      { key: 'Eagle', label: 'Eagle strikes' },
      { key: 'Support weapon', label: 'Support weapons' },
      { key: 'Backpack', label: 'Backpacks' },
      { key: 'Sentry', label: 'Sentries' },
      { key: 'Emplacement', label: 'Emplacements and mines' },
      { key: 'Vehicle', label: 'Vehicles' },
    ],
    mechanicTopics: [
      { key: 'galactic-map', label: 'The galactic map' },
      { key: 'mission', label: 'Missions' },
      { key: 'combat', label: 'Combat and damage' },
      { key: 'ship', label: 'Your Super Destroyer' },
    ],
  },

  // ── ENEMIES (by faction) ───────────────────────────────────────────────────
  // faction: whose enemy it is. summary: what it is (optional). howToKill: how to deal with it.
  enemies: [
    {
      id: 'enemy-hunters-and-stalkers', faction: 'terminids', name: 'Hunters and Stalkers',
      howToKill: 'Fast chasers; kill them first, they slow you and pin you for the swarm.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'enemy-chargers', faction: 'terminids', name: 'Chargers',
      howToKill: 'Dodge, then hit the unarmoured back or legs; anti-tank on the head.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'enemy-bile-spewers', faction: 'terminids', name: 'Bile Spewers',
      howToKill: 'Medium armour; autocannon, grenades or explosives to the sacs.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'enemy-bile-titans', faction: 'terminids', name: 'Bile Titans',
      howToKill: 'Recoilless Rifle, Quasar Cannon, Railcannon or a 500kg bomb.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'enemy-devastators', faction: 'automaton', name: 'Devastators',
      howToKill: 'Headshots with a medium-penetration primary, or an autocannon.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'enemy-hulks', faction: 'automaton', name: 'Hulks',
      howToKill: 'Anti-tank to the eye, or shoot the vents on the back.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'enemy-tanks-and-cannon-towers', faction: 'automaton', name: 'Tanks and Cannon Towers',
      howToKill: 'Anti-tank or a 500kg bomb to the rear vent.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'enemy-gunships', faction: 'automaton', name: 'Gunships',
      howToKill: 'Shoot the engines with an autocannon, anti-materiel rifle or Spear.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'enemy-watchers', faction: 'illuminate', name: 'Watchers',
      howToKill: 'Any hitscan weapon as soon as they appear.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'enemy-voteless', faction: 'illuminate', name: 'Voteless hordes',
      howToKill: 'Machine gun, flamethrower or a gas or cluster stratagem.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'enemy-harvesters', faction: 'illuminate', name: 'Harvesters',
      howToKill: 'Drop the shield, then anti-tank on the leg joints.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'enemy-overseers', faction: 'illuminate', name: 'Overseers',
      howToKill: 'Headshots with a medium-penetration primary.',
      confidence: 'medium', sources: ['author'],
    },
  ],

  // ── FRONTS (by faction) ────────────────────────────────────────────────────
  // What fighting each faction is like. faction: whose front; icon must exist in images/.
  fronts: [
    {
      id: 'faction-terminids',
      faction: 'terminids',
      name: 'Terminids (bugs)',
      icon: 'images/faction-icons/Terminids.svg',
      summary:
        'Fast melee swarms that win by numbers and by surrounding you. A few big ' +
        'armoured bugs (Chargers, Bile Titans, Impalers) punish anyone who stands still.',
      howToFight: [
        'Keep moving and keep the swarm in front of you. Getting surrounded is how bug missions end.',
        'A bug that stops and puffs out an orange cloud is calling reinforcements. Kill it before it finishes.',
        'Close bug holes with a grenade or an explosive stratagem; a nest with open holes keeps spawning.',
        'Chargers: step sideways at the last moment, then shoot the soft rear or strip the front leg armour with anti-tank.',
        'Bile Titans: anti-tank to the head, or a 500kg bomb or Railcannon; do not fight one with a light weapon.',
      ],
      confidence: 'medium',
      sources: ['author'],
    },
    {
      id: 'faction-automaton',
      faction: 'automaton',
      name: 'Automatons (bots)',
      icon: 'images/faction-icons/Automatons.svg',
      summary:
        'Ranged, armoured robots that suppress you with gunfire and rockets. Fabricators ' +
        'keep producing them, and dropships bring more when they spot you.',
      howToFight: [
        'Use cover and break line of sight. Bots only hurt you if they can see you.',
        'A bot firing a red flare is calling a dropship. Kill it before the flare goes up.',
        'Destroy fabricators by throwing a grenade into the vent, or with an explosive or anti-tank hit.',
        'Aim for weak points: Devastator heads, the glowing eye and the rear vents of Hulks, the back of Tank turrets.',
        'Explosions are the big killer; crouching or going prone steadies your aim and makes you a smaller target.',
      ],
      confidence: 'medium',
      sources: ['author'],
    },
    {
      id: 'faction-illuminate',
      faction: 'illuminate',
      name: 'Illuminate (squids)',
      icon: 'images/faction-icons/Illuminate.svg',
      summary:
        'A mix of shambling Voteless hordes, shielded Overseers and large Harvester walkers, ' +
        'with flying Watchers that call in more troops.',
      howToFight: [
        'Shoot Watchers (the flying scouts) first. Left alone, they call reinforcements.',
        'Voteless are weak but come in crowds. Machine guns, fire and area stratagems handle them.',
        'Harvesters carry an energy shield. Break the shield with sustained fire or explosives, then hit the leg joints with anti-tank.',
        'Overseers are armoured infantry. Aim for the head, and watch for the ones with jetpacks.',
      ],
      confidence: 'medium',
      sources: ['author'],
    },
  ],

  // ── LOADOUTS (by faction) ──────────────────────────────────────────────────
  // faction: the front it is for. stratagems: stratagem ids (the support weapon among them);
  // armourPassive: an armour passive id.
  loadouts: [
    {
      id: 'loadout-terminids',
      faction: 'terminids',
      name: 'A good starting loadout against bugs',
      primaryAdvice: 'Something that clears crowds quickly: a shotgun such as the Breaker, or an incendiary option.',
      supportWeapon: 'stalwart',
      stratagems: ['stalwart', 'eagle-cluster-bomb', 'eagle-500kg-bomb', 'machine-gun-sentry'],
      armourPassive: 'engineering-kit',
      why: 'Crowd control first, one answer for big bugs, and extra grenades for closing holes.',
      confidence: 'medium',
      sources: ['author'],
    },
    {
      id: 'loadout-automaton',
      faction: 'automaton',
      name: 'A good starting loadout against bots',
      primaryAdvice: 'A medium-penetration rifle or marksman weapon that can kill Devastators with headshots.',
      supportWeapon: 'autocannon',
      stratagems: ['autocannon', 'orbital-railcannon-strike', 'eagle-500kg-bomb', 'shield-generator-pack'],
      armourPassive: 'fortified',
      why: 'The autocannon handles fabricators, Devastators and gunships; the Railcannon and 500kg deal with Hulks and Tanks.',
      confidence: 'medium',
      sources: ['author'],
    },
    {
      id: 'loadout-illuminate',
      faction: 'illuminate',
      name: 'A good starting loadout against the Illuminate',
      primaryAdvice: 'A primary with enough penetration for Overseers; the support weapon handles the crowds.',
      supportWeapon: 'machine-gun',
      stratagems: ['machine-gun', 'recoilless-rifle', 'eagle-cluster-bomb', 'orbital-gas-strike'],
      armourPassive: 'medic-kit',
      why: 'The machine gun keeps the Voteless off you, the Recoilless handles Harvesters, and the gas and cluster strikes thin the hordes.',
      confidence: 'medium',
      sources: ['author'],
    },
  ],

  // ── GUNS (by gun type) ─────────────────────────────────────────────────────
  // Primaries and secondaries (support weapons are stratagems). type: a key from groups.gunTypes.
  // An entry looks like this (remove the // to use it):
  //   {
  //     id: 'liberator', type: 'assault-rifle', name: 'AR-23 Liberator',
  //     summary: 'One line: what it is good for.',
  //     notes: 'Anything longer: armour penetration, magazine, how to use it.',
  //     strongAgainst: ['terminids'],    // optional: faction keys
  //     confidence: 'high', sources: ['owner'],
  //   },
  guns: [
  ],

  // ── STRATAGEMS ─────────────────────────────────────────────────────────────
  // cooldownSeconds: the last value the author knew (see gameVersion). For an Eagle it is the
  // gap between two calls, not the rearm.
  // uses: null = limited only by cooldown; otherwise {count, per: 'call'|'rearm'|'mission'}.
  // strongAgainst / weakAgainst: faction keys. category: a key from groups.stratagemTypes.
  // Optional, fill them in from the game:
  //   code: the input, only 'up', 'down', 'left' and 'right', shown as arrows on the card,
  //         e.g. code: ['down', 'down', 'up', 'right'],   (a made-up example, copy the real one)
  //   rearmSeconds: Eagles only, how long the Eagle takes to rearm, e.g. rearmSeconds: 150,
  //         shown as "Rearm" next to the cooldown.
  stratagems: [
    {
      id: 'machine-gun', name: 'MG-43 Machine Gun', category: 'Support weapon',
      cooldownSeconds: 480, uses: null,
      purpose: 'Sustained fire that shreds light and medium enemies. Accurate when you crouch or go prone.',
      pairsWith: ['supply-pack', 'orbital-railcannon-strike'],
      strongAgainst: ['terminids', 'illuminate'], weakAgainst: [],
      notes: 'It has no answer to heavy armour, so bring a separate anti-tank option.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'stalwart', name: 'M-105 Stalwart', category: 'Support weapon',
      cooldownSeconds: 480, uses: null,
      purpose: 'A light machine gun you can move and turn with quickly. Built for chewing through crowds.',
      pairsWith: ['eagle-500kg-bomb', 'expendable-anti-tank'],
      strongAgainst: ['terminids', 'illuminate'], weakAgainst: ['automaton'],
      notes: 'Its low penetration struggles with armoured bots such as Devastators.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'anti-materiel-rifle', name: 'APW-1 Anti-Materiel Rifle', category: 'Support weapon',
      cooldownSeconds: 480, uses: null,
      purpose: 'A heavy sniper rifle for picking off armoured targets and weak points from range.',
      pairsWith: ['orbital-railcannon-strike'],
      strongAgainst: ['automaton'], weakAgainst: ['terminids'],
      notes: 'It shines against Devastators and gunship engines, but the slow fire rate is a liability against a swarm.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'expendable-anti-tank', name: 'EAT-17 Expendable Anti-Tank', category: 'Support weapon',
      cooldownSeconds: 70, uses: null,
      purpose: 'Drops two single-shot anti-tank launchers. Fire one and throw it away.',
      pairsWith: ['stalwart', 'machine-gun'],
      strongAgainst: ['terminids', 'automaton', 'illuminate'], weakAgainst: [],
      notes: 'The short cooldown means you can call it at every fight and leave spares for the team.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'recoilless-rifle', name: 'GR-8 Recoilless Rifle', category: 'Support weapon',
      cooldownSeconds: 480, uses: null,
      purpose: 'A reusable anti-tank launcher with an ammo backpack.',
      pairsWith: ['supply-pack'],
      strongAgainst: ['terminids', 'automaton', 'illuminate'], weakAgainst: [],
      notes: 'A teammate can reload it for you from your backpack, which is much faster: a classic two-person team.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'quasar-cannon', name: 'LAS-99 Quasar Cannon', category: 'Support weapon',
      cooldownSeconds: 480, uses: null,
      purpose: 'An energy anti-tank weapon that never runs out of ammo. It charges before each shot and needs a long cooldown afterwards.',
      pairsWith: ['jump-pack', 'guard-dog-rover'],
      strongAgainst: ['terminids', 'automaton', 'illuminate'], weakAgainst: [],
      notes: 'It frees up your backpack slot. The charge-up takes getting used to against moving targets.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'autocannon', name: 'AC-8 Autocannon', category: 'Support weapon',
      cooldownSeconds: 480, uses: null,
      purpose: 'A heavy-hitting explosive cannon with an ammo backpack. Good against medium armour, structures and aircraft.',
      pairsWith: ['supply-pack', 'orbital-railcannon-strike'],
      strongAgainst: ['automaton', 'terminids'], weakAgainst: [],
      notes: 'It can destroy bot fabricators through the vents and close bug holes from range. Team reload works as with the Recoilless.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'flamethrower', name: 'FLAM-40 Flamethrower', category: 'Support weapon',
      cooldownSeconds: 480, uses: null,
      purpose: 'Short-range fire that keeps burning on the ground and on enemies.',
      pairsWith: ['eagle-500kg-bomb'],
      strongAgainst: ['terminids', 'illuminate'], weakAgainst: ['automaton'],
      notes: 'Fire spreads across grass and hurts teammates, so watch where it goes. The Inflammable passive helps.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'arc-thrower', name: 'ARC-3 Arc Thrower', category: 'Support weapon',
      cooldownSeconds: 480, uses: null,
      purpose: 'Lightning that jumps between nearby enemies. It never runs out of ammo.',
      pairsWith: ['guard-dog-rover'],
      strongAgainst: ['terminids'], weakAgainst: [],
      notes: 'Arcs can jump to teammates too. Squad members wearing Electrical Conduit are safe from it.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'spear', name: 'FAF-14 Spear', category: 'Support weapon',
      cooldownSeconds: 480, uses: null,
      purpose: 'A lock-on anti-tank missile launcher with a large ammo backpack.',
      pairsWith: ['supply-pack'],
      strongAgainst: ['automaton'], weakAgainst: [],
      notes: 'Great against Tanks, gunships, cannon towers and fabricators. Getting a lock can be hard in cluttered terrain.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'grenade-launcher', name: 'GL-21 Grenade Launcher', category: 'Support weapon',
      cooldownSeconds: 480, uses: null,
      purpose: 'Arcing explosive rounds for groups, bug holes and fabricators.',
      pairsWith: ['supply-pack'],
      strongAgainst: ['terminids', 'automaton'], weakAgainst: [],
      notes: 'It burns through ammo quickly, and the arc takes practice. Don\'t fire it at your feet.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'railgun', name: 'RS-422 Railgun', category: 'Support weapon',
      cooldownSeconds: 480, uses: null,
      purpose: 'High-penetration single shots for precise hits on heavy enemies.',
      pairsWith: ['shield-generator-pack'],
      strongAgainst: ['automaton'], weakAgainst: [],
      notes: 'It needs accurate hits on weak points. Its strength has changed a lot over the game\'s patches.',
      confidence: 'low', sources: ['author'],
    },
    {
      id: 'supply-pack', name: 'B-1 Supply Pack', category: 'Backpack',
      cooldownSeconds: 480, uses: null,
      purpose: 'Carries resupply packages that you can use on yourself or hand to teammates.',
      pairsWith: ['machine-gun', 'recoilless-rifle', 'autocannon'],
      strongAgainst: ['terminids', 'automaton', 'illuminate'], weakAgainst: [],
      notes: 'It keeps a whole squad\'s ammo and stims going between resupply calls.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'shield-generator-pack', name: 'SH-32 Shield Generator Pack', category: 'Backpack',
      cooldownSeconds: 480, uses: null,
      purpose: 'A bubble shield around you that soaks up incoming projectiles until it breaks, then recharges.',
      pairsWith: ['railgun', 'quasar-cannon'],
      strongAgainst: ['automaton', 'illuminate'], weakAgainst: [],
      notes: 'Most useful against lots of ranged fire. Less valuable when bugs are clawing at you.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'jump-pack', name: 'LIFT-850 Jump Pack', category: 'Backpack',
      cooldownSeconds: 480, uses: null,
      purpose: 'Short jet-assisted jumps to reach high ground and escape bad spots.',
      pairsWith: ['quasar-cannon'],
      strongAgainst: ['terminids'], weakAgainst: [],
      notes: 'High ground is safe ground against bugs. It pairs with support weapons that don\'t need an ammo backpack.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'guard-dog-rover', name: 'AX/LAS-5 "Guard Dog" Rover', category: 'Backpack',
      cooldownSeconds: 480, uses: null,
      purpose: 'A drone that floats over your shoulder and lasers small enemies near you.',
      pairsWith: ['quasar-cannon', 'arc-thrower'],
      strongAgainst: ['terminids', 'illuminate'], weakAgainst: [],
      notes: 'It is great at thinning chasers. It can clip teammates who step into its line of fire.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'ballistic-shield', name: 'SH-20 Ballistic Shield Backpack', category: 'Backpack',
      cooldownSeconds: 300, uses: null,
      purpose: 'A handheld shield that blocks gunfire in front of you. It works with one-handed weapons.',
      pairsWith: [],
      strongAgainst: ['automaton'], weakAgainst: ['terminids'],
      notes: 'Excellent for pushing into bot fire. It is little help when bugs come from every side.',
      confidence: 'low', sources: ['author'],
    },
    {
      id: 'orbital-precision-strike', name: 'Orbital Precision Strike', category: 'Orbital',
      cooldownSeconds: 90, uses: null,
      purpose: 'One big shell on the spot where the beacon lands. Short cooldown.',
      pairsWith: ['orbital-ems-strike'],
      strongAgainst: ['terminids', 'automaton', 'illuminate'], weakAgainst: [],
      notes: 'Use it on bug holes, fabricators and heavies that are standing still. The cooldown has been lowered since this was written.',
      confidence: 'low', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'orbital-railcannon-strike', name: 'Orbital Railcannon Strike', category: 'Orbital',
      cooldownSeconds: 210, uses: null,
      purpose: 'Locks onto the biggest enemy near the beacon and hits it with a very high-damage shot.',
      pairsWith: ['machine-gun', 'autocannon'],
      strongAgainst: ['terminids', 'automaton'], weakAgainst: [],
      notes: 'This is dependable anti-heavy for a team that is otherwise built for crowds.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'orbital-laser', name: 'Orbital Laser', category: 'Orbital',
      cooldownSeconds: 300, uses: { count: 3, per: 'mission' },
      purpose: 'A beam that sweeps the area for a while and burns everything, including heavies.',
      pairsWith: ['orbital-ems-strike'],
      strongAgainst: ['terminids', 'automaton', 'illuminate'], weakAgainst: [],
      notes: 'Uses per mission are limited, so save it for bases and bad moments.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'orbital-380mm-he-barrage', name: 'Orbital 380mm HE Barrage', category: 'Orbital',
      cooldownSeconds: 240, uses: null,
      purpose: 'A long, wide barrage of large shells for flattening bases.',
      pairsWith: ['orbital-ems-strike'],
      strongAgainst: ['terminids', 'automaton'], weakAgainst: [],
      notes: 'Shells scatter and moving targets walk out of it. It is a waste against a small patrol and dangerous near teammates.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'orbital-ems-strike', name: 'Orbital EMS Strike', category: 'Orbital',
      cooldownSeconds: 75, uses: null,
      purpose: 'Stuns and slows enemies in an area without damaging them.',
      pairsWith: ['orbital-380mm-he-barrage', 'orbital-gas-strike', 'orbital-precision-strike'],
      strongAgainst: ['terminids', 'automaton', 'illuminate'], weakAgainst: [],
      notes: 'Stunned enemies stay inside your barrage or gas cloud. It also buys time to revive someone.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'orbital-smoke-strike', name: 'Orbital Smoke Strike', category: 'Orbital',
      cooldownSeconds: 100, uses: null,
      purpose: 'A wall of smoke that blocks line of sight.',
      pairsWith: [],
      strongAgainst: ['automaton'], weakAgainst: ['terminids'],
      notes: 'Bots can\'t shoot what they can\'t see. Bugs just run through smoke.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'orbital-gas-strike', name: 'Orbital Gas Strike', category: 'Orbital',
      cooldownSeconds: 75, uses: null,
      purpose: 'A lingering toxic cloud that damages everything inside it.',
      pairsWith: ['orbital-ems-strike'],
      strongAgainst: ['terminids', 'illuminate'], weakAgainst: [],
      notes: 'It is strong against crowds of lightly armoured enemies. Teammates with Advanced Filtration can stand in it.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'orbital-gatling-barrage', name: 'Orbital Gatling Barrage', category: 'Orbital',
      cooldownSeconds: 70, uses: null,
      purpose: 'A short burst of rapid small shells that clears light enemies in an area.',
      pairsWith: [],
      strongAgainst: ['terminids', 'illuminate'], weakAgainst: [],
      notes: 'This is quick chaff clearing on a short cooldown. The cooldown has been changed since this was written.',
      confidence: 'low', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'eagle-airstrike', name: 'Eagle Airstrike', category: 'Eagle',
      cooldownSeconds: 8, uses: { count: 2, per: 'rearm' },
      purpose: 'A line of bombs along the direction you threw it.',
      pairsWith: ['eagle-500kg-bomb'],
      strongAgainst: ['terminids', 'automaton', 'illuminate'], weakAgainst: [],
      notes: 'This is an all-rounder for fabricators, bug holes and groups. All Eagle calls share one rearm, which takes a couple of minutes.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'eagle-cluster-bomb', name: 'Eagle Cluster Bomb', category: 'Eagle',
      cooldownSeconds: 8, uses: { count: 4, per: 'rearm' },
      purpose: 'A spread of small bombs that wipes out light enemies.',
      pairsWith: ['stalwart'],
      strongAgainst: ['terminids', 'illuminate'], weakAgainst: [],
      notes: 'It does little against armour. It is best for breaking up a swarm before it reaches you.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'eagle-500kg-bomb', name: 'Eagle 500kg Bomb', category: 'Eagle',
      cooldownSeconds: 8, uses: { count: 1, per: 'rearm' },
      purpose: 'One huge bomb that kills heavies and flattens objectives.',
      pairsWith: ['stalwart', 'eagle-airstrike'],
      strongAgainst: ['terminids', 'automaton', 'illuminate'], weakAgainst: [],
      notes: 'The blast is smaller than it looks, so throw it close to the target. The Expanded Weapons Bay ship module adds uses.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'eagle-napalm-airstrike', name: 'Eagle Napalm Airstrike', category: 'Eagle',
      cooldownSeconds: 8, uses: { count: 2, per: 'rearm' },
      purpose: 'A line of fire that keeps burning and blocks an approach.',
      pairsWith: [],
      strongAgainst: ['terminids', 'illuminate'], weakAgainst: ['automaton'],
      notes: 'It is great for sealing a path against bugs. Use it as area denial, not to kill heavies.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'eagle-strafing-run', name: 'Eagle Strafing Run', category: 'Eagle',
      cooldownSeconds: 8, uses: { count: 3, per: 'rearm' },
      purpose: 'A quick line of cannon fire that arrives almost immediately.',
      pairsWith: [],
      strongAgainst: ['terminids', 'illuminate'], weakAgainst: [],
      notes: 'It is fast and fairly safe near teammates. Use it for light enemies in a line.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'machine-gun-sentry', name: 'A/MG-43 Machine Gun Sentry', category: 'Sentry',
      cooldownSeconds: 180, uses: null,
      purpose: 'A turret that sprays light enemies for a while.',
      pairsWith: ['ems-mortar-sentry'],
      strongAgainst: ['terminids', 'illuminate'], weakAgainst: ['automaton'],
      notes: 'Sentries shoot through teammates, so place them behind the squad. The cooldown has been reduced since this was written.',
      confidence: 'low', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'autocannon-sentry', name: 'A/AC-8 Autocannon Sentry', category: 'Sentry',
      cooldownSeconds: 180, uses: null,
      purpose: 'A turret with enough punch for medium armour.',
      pairsWith: ['rocket-sentry'],
      strongAgainst: ['automaton'], weakAgainst: [],
      notes: 'It draws bot fire away from you. Place it with some cover.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'rocket-sentry', name: 'A/MLS-4X Rocket Sentry', category: 'Sentry',
      cooldownSeconds: 180, uses: null,
      purpose: 'A turret that fires rockets and prefers large targets.',
      pairsWith: ['autocannon-sentry'],
      strongAgainst: ['automaton'], weakAgainst: [],
      notes: 'It helps with heavy units when your own anti-tank is on cooldown.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'mortar-sentry', name: 'A/M-12 Mortar Sentry', category: 'Sentry',
      cooldownSeconds: 180, uses: null,
      purpose: 'Long-range indirect fire on anything it spots.',
      pairsWith: ['ems-mortar-sentry'],
      strongAgainst: ['terminids', 'automaton'], weakAgainst: [],
      notes: 'It shines on defense missions. It will happily shell teammates standing near enemies.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'ems-mortar-sentry', name: 'A/M-23 EMS Mortar Sentry', category: 'Sentry',
      cooldownSeconds: 180, uses: null,
      purpose: 'A mortar that stuns and slows instead of killing.',
      pairsWith: ['mortar-sentry', 'machine-gun-sentry'],
      strongAgainst: ['terminids', 'automaton', 'illuminate'], weakAgainst: [],
      notes: 'It is harmless to teammates and makes every other sentry and weapon better.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'tesla-tower', name: 'A/ARC-3 Tesla Tower', category: 'Emplacement',
      cooldownSeconds: 120, uses: null,
      purpose: 'A tower that zaps anything that comes close.',
      pairsWith: [],
      strongAgainst: ['terminids', 'illuminate'], weakAgainst: [],
      notes: 'It kills careless teammates as readily as bugs. Squad members with Electrical Conduit can walk past it.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'anti-personnel-minefield', name: 'MD-6 Anti-Personnel Minefield', category: 'Emplacement',
      cooldownSeconds: 120, uses: null,
      purpose: 'Scatters mines that kill light enemies walking through.',
      pairsWith: [],
      strongAgainst: ['terminids'], weakAgainst: [],
      notes: 'Use it on the approach to something you are defending. Remember where you put it.',
      confidence: 'medium', sources: ['author'],
    },
  ],

  // ── ARMOUR PERKS (by armour weight) ────────────────────────────────────────
  // armourWeights: the armour weights this passive comes on, e.g. ['light', 'medium'] (keys from
  // groups.armourWeights). An entry without it shows under "Not sorted by armour weight yet".
  armourPassives: [
    {
      id: 'scout', name: 'Scout',
      effect: 'Enemies notice you from about 30% closer, and map markers you place keep scanning for enemies.',
      whenWorthIt: 'Stealthy or solo play, and scouting ahead against bots so you pick the fights.',
      confidence: 'medium', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'fortified', name: 'Fortified',
      effect: 'Takes about half damage from explosions. Weapons kick less while you are crouched or prone.',
      whenWorthIt: 'Against bots (rockets, cannons, Hulks) and in squads that throw a lot of explosives.',
      confidence: 'high', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'medic-kit', name: 'Med-Kit',
      effect: 'Two extra stims, both at spawn and as the maximum you can carry. Each stim lasts two seconds longer.',
      whenWorthIt: 'Almost always good. It is the safe pick if you are unsure.',
      confidence: 'high', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'engineering-kit', name: 'Engineering Kit',
      effect: 'Two extra grenades. Weapons kick less while you are crouched or prone.',
      whenWorthIt: 'Closing bug holes and fabricators, and any loadout that leans on grenades.',
      confidence: 'high', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'extra-padding', name: 'Extra Padding',
      effect: 'Raises your armour rating, so every hit hurts a little less.',
      whenWorthIt: 'When nothing else suits the mission. It is a small, steady bonus rather than a game changer.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'servo-assisted', name: 'Servo-Assisted',
      effect: 'Throws grenades and stratagem beacons about 30% further. Arms and legs are much tougher before they get injured.',
      whenWorthIt: 'Placing stratagems precisely from safety, and hitting bug holes or fabricators from range.',
      confidence: 'high', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'democracy-protects', name: 'Democracy Protects',
      effect: 'A 50% chance to survive a hit that would have killed you. Chest injuries don\'t make you bleed.',
      whenWorthIt: 'Against bots and anything that one-shots you, and for players who take risks.',
      confidence: 'high', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'electrical-conduit', name: 'Electrical Conduit',
      effect: 'Almost complete resistance to arc (electric) damage.',
      whenWorthIt: 'When a teammate brings the Arc Thrower or a Tesla Tower.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'peak-physique', name: 'Peak Physique',
      effect: 'Hits harder in melee. Heavy weapons feel lighter to swing and aim.',
      whenWorthIt: 'If you carry a heavy support weapon everywhere and hate how slowly it turns.',
      confidence: 'medium', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'siege-ready', name: 'Siege-Ready',
      effect: 'Primary weapons reload about 30% faster and carry about 20% more ammo.',
      whenWorthIt: 'Builds where the primary does most of the killing.',
      confidence: 'high', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'integrated-explosives', name: 'Integrated Explosives',
      effect: 'Your armour explodes shortly after you die.',
      whenWorthIt: 'A last laugh against whatever killed you. It can also kill teammates standing next to you.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'advanced-filtration', name: 'Advanced Filtration',
      effect: 'Strong resistance to gas damage and its effects.',
      whenWorthIt: 'When you or your squad use gas stratagems or gas grenades.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'inflammable', name: 'Inflammable',
      effect: 'Strong resistance to fire damage.',
      whenWorthIt: 'Flamethrower and napalm users, and planets where things burn a lot.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'unflinching', name: 'Unflinching',
      effect: 'You flinch far less when hit, so your aim stays on target under fire.',
      whenWorthIt: 'Trading shots with bots.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'acclimated', name: 'Acclimated',
      effect: 'Partial resistance to fire, gas, acid and electricity.',
      whenWorthIt: 'Hazardous planets, or mixed loadouts where you can\'t pick just one resistance.',
      confidence: 'medium', sources: ['author'],
    },
  ],

  // ── SHIP MODULES ───────────────────────────────────────────────────────────
  // priority: 1 = buy early, 2 = buy when you use that stratagem type, 3 = later.
  // Ship modules only affect the player who bought them. They show in the Game mechanics block,
  // under "Your Super Destroyer".
  shipModules: [
    {
      id: 'donation-access-license', name: 'Donation Access License', department: 'Patriotic Administration Center',
      effect: 'Support weapons arrive with the maximum number of magazines you can carry.',
      priority: 1, why: 'Cheap, and it helps every support weapon from the first drop.',
      confidence: 'high', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'streamlined-request-process', name: 'Streamlined Request Process', department: 'Patriotic Administration Center',
      effect: 'Support weapon stratagems come off cooldown 10% sooner.',
      priority: 2, why: 'Helps if your support weapon keeps getting lost or dying with you.',
      confidence: 'high', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'superior-packing-methodology', name: 'Superior Packing Methodology', department: 'Patriotic Administration Center',
      effect: 'Resupply boxes fill support weapons back to full ammo.',
      priority: 3, why: 'Expensive, but it fixes support weapon ammo worries for good.',
      confidence: 'high', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'zero-g-breech-loading', name: 'Zero-G Breech Loading', department: 'Orbital Cannons',
      effect: 'Orbital stratagem cooldowns are 10% shorter.',
      priority: 2, why: 'On long orbital cooldowns that can mean an extra call every few minutes.',
      confidence: 'high', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'liquid-ventilated-cockpit', name: 'Liquid-Ventilated Cockpit', department: 'Hangar',
      effect: 'Shortens the wait between separate Eagle calls.',
      priority: 1, why: 'Eagles are many players\' main damage, and the Hangar branch is usually the first recommended.',
      confidence: 'medium', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'pit-crew-hazard-pay', name: 'Pit Crew Hazard Pay', department: 'Hangar',
      effect: 'The Eagle rearms faster.',
      priority: 1, why: 'Less time with no Eagles at all.',
      confidence: 'medium', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'expanded-weapons-bay', name: 'Expanded Weapons Bay', department: 'Hangar',
      effect: 'Eagle stratagems get an extra use per rearm.',
      priority: 1, why: 'With the other Hangar upgrades, it makes Eagles some of the strongest stratagems in the game.',
      confidence: 'medium', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'more-guns', name: 'More Guns', department: 'Orbital Cannons',
      effect: 'Orbital barrages fire an extra salvo.',
      priority: 3, why: 'Only matters if you actually bring barrages.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'dynamic-tracking', name: 'Dynamic Tracking', department: 'Robotics Workshop',
      effect: 'Sentries turn toward targets faster.',
      priority: 2, why: 'Worth it for sentry-heavy loadouts, especially against fast bugs.',
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'targeting-software-upgrade', name: 'Targeting Software Upgrade', department: 'Bridge',
      effect: 'Stratagems arrive a little faster after you throw them.',
      priority: 3, why: 'A small quality-of-life gain that applies to everything.',
      confidence: 'medium', sources: ['author'],
    },
  ],

  // ── GAME MECHANICS (by topic) ──────────────────────────────────────────────
  // topic: a key from groups.mechanicTopics ('galactic-map', 'mission', 'combat', 'ship').
  mechanics: [
    {
      id: 'armour-penetration', topic: 'combat', title: 'Armour values and penetration',
      commonMistake: 'Emptying a magazine into a heavily armoured plate and wondering why nothing happens.',
      explanation:
        'Every weapon has a penetration level and every body part has an armour level. If the armour is ' +
        'higher than your penetration, the shot bounces off or does almost nothing. Unarmoured spots such as ' +
        'joints, backs, vents and glowing weak points take full damage from almost anything.',
      tips: [
        'Hits that spark or deflect mean you are wasting ammo. Change angle or change weapon.',
        'Bring at least one anti-tank option per player, or per pair, on higher difficulties.',
      ],
      confidence: 'high', sources: ['author'],
    },
    {
      id: 'breakpoints', topic: 'combat', title: 'Breakpoints',
      commonMistake: 'Judging a weapon by its damage number instead of how many hits it needs.',
      explanation:
        'What matters is how many hits it takes to kill a given enemy. A small damage boost that turns a ' +
        'three-hit kill into two hits speeds you up by a third; a bigger boost that leaves it at three changes ' +
        'nothing. Headshots and weak points change the count far more than raw damage does.',
      tips: [
        'Learn how many hits your main weapon needs on the enemies you meet most.',
        'Aim for the part that lowers that count, usually the head.',
      ],
      confidence: 'high', sources: ['author'],
    },
    {
      id: 'reinforce-budget', topic: 'mission', title: 'The reinforce budget',
      commonMistake: 'Thinking each player has their own lives, or that an empty budget is the end of the mission.',
      explanation:
        'Reinforcements are a pool shared by the whole squad: five per player, so twenty for a full team, and ' +
        'the Increased Reinforcement Budget booster adds one more per player. Once the pool is empty, a new ' +
        'reinforcement comes back every two minutes, or faster with the Flexible Reinforcement Budget booster.',
      tips: [
        'Throw the reinforce beacon somewhere safe, not into the fight that just killed your teammate.',
        'Once the mission timer runs out, reinforcements and stratagems stop working.',
      ],
      confidence: 'high', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'extraction-timing', topic: 'mission', title: 'Extraction timing',
      commonMistake: 'Calling extraction at the last second, or calling it while the landing zone is swarming.',
      explanation:
        'After you call extraction, the dropship takes a couple of minutes to arrive, and enemies keep coming ' +
        'the whole time. If the mission timer runs out first, your destroyer leaves orbit: no more stratagems ' +
        'and no reinforcements, only what you are carrying.',
      tips: [
        'Clear the area and put up sentries before you call the dropship.',
        'Leave a few minutes on the mission timer so you still have stratagems during the wait.',
      ],
      confidence: 'medium', sources: ['author', 'web-search-2026-09-27'],
    },
    {
      id: 'patrols-and-reinforcements', topic: 'mission', title: 'Patrols and enemy reinforcements',
      commonMistake: 'Fighting every patrol you see, and letting enemies call for help.',
      explanation:
        'Patrols spawn away from the squad and wander the map, more often on higher difficulties. Most of your ' +
        'trouble comes from enemies calling reinforcements: bugs with an orange spore cloud, bots with a red ' +
        'flare, Illuminate through their flying Watchers. Kill the caller and a fight stays small.',
      tips: [
        'Avoiding a patrol usually costs less than beating it.',
        'Staying in one open spot for a long time tends to draw a steady stream of enemies.',
      ],
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'samples', topic: 'mission', title: 'Carrying samples',
      commonMistake: 'Thinking samples are safe once you have picked them up.',
      explanation:
        'Samples only count if someone extracts with them. When you die you drop everything you are carrying ' +
        'in a pile where you fell, and anyone can pick it up. Samples extracted by anyone count for the whole squad.',
      tips: [
        'Hand samples to the player least likely to die before extraction.',
        'After a death, go back for the pile, and mark it on the map so nobody forgets.',
      ],
      confidence: 'high', sources: ['author'],
    },
    {
      id: 'friendly-fire', topic: 'combat', title: 'Friendly fire',
      commonMistake: 'Assuming stratagems, sentries and turrets can tell friend from foe.',
      explanation:
        'Almost everything hurts teammates: bullets, explosions, fire, gas, arcs, sentries and orbital strikes. ' +
        'A sentry keeps shooting at a bug even when you are standing in the way.',
      tips: [
        'Say where you are throwing a barrage, and throw it away from the squad\'s path.',
        'Put sentries behind the squad, not in front of it.',
      ],
      confidence: 'high', sources: ['author'],
    },
    {
      id: 'liberation-and-regeneration', topic: 'galactic-map', title: 'Liberation against regeneration',
      commonMistake: 'Thinking any planet with Helldivers on it is being won.',
      explanation:
        'Enemy planets heal back a little every hour. Liberation only moves forward when the Helldivers there ' +
        'take away more than the planet heals, so a planet can have thousands of players on it and still sit ' +
        'still. Spreading the community across many planets tends to stall all of them; bunching up wins them ' +
        'one at a time.',
      tips: [
        'A planet that has not moved in a while is a poor place to drop unless many more players are coming.',
        'The advanced view shows the pace this page has measured and a rough count of Helldivers needed to beat the healing.',
      ],
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'defense-gambits', topic: 'galactic-map', title: 'Defense gambits',
      commonMistake: 'Only ever defending the planet under attack.',
      explanation:
        'An attack on one of our planets is launched from a neighbouring enemy planet. The community found that ' +
        'if that enemy planet is liberated before the defense runs out, the attack ends with it. Players call ' +
        'this a gambit. It is a gamble: if the liberation does not finish in time, the players who went there ' +
        'were missing from the defense.',
      tips: [
        'Only worth it when the attacking planet is already close to falling, or falling fast.',
        'The advanced view\'s gambit panel compares the attacker\'s measured pace with the defense deadline.',
      ],
      confidence: 'medium', sources: ['author'],
    },
    {
      id: 'stims-and-injuries', topic: 'combat', title: 'Stims and injuries',
      commonMistake: 'Limping around with an injured leg because you are not low on health.',
      explanation:
        'Limb injuries slow you (legs) or make your aim sway (arms) until you use a stim. A stim heals you ' +
        'and fixes injuries at the same time.',
      tips: [
        'Stim to fix a leg even at high health if you need to run.',
        'The Med-Kit passive and the Supply Pack keep stims flowing.',
      ],
      confidence: 'high', sources: ['author'],
    },
  ],
};

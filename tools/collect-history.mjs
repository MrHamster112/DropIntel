// Records the Galactic War for DropIntel's trends, one reading per run. The public repository's
// GitHub Action (.github/workflows/collect-history.yml) runs it every 15 minutes and keeps the
// result, history.json, and the war log of every change of hands, war-log.json (tools/war-log.mjs),
// on the orphan branch "war-history". Plain Node 22, no packages:
//   node tools/collect-history.mjs history.json [war-log.json]
// A missing or broken file starts a fresh one. When both APIs fail, the files are left alone.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWarLogFile, recordReadingInWarLog, seedWarLogFromHistory } from './war-log.mjs';

export const PRIMARY_API = 'https://api.helldivers2.dev';
export const BACKUP_API = 'https://helldiverstrainingmanual.com/api/v1';
// The primary API asks every client to say who it is and how to reach its maintainer
// (the same as the page's PRIMARY_API_REQUIRED_HEADERS).
const PRIMARY_HEADERS = {
  'X-Super-Client': 'dropintel',
  'X-Super-Contact': 'dropintel.contact@gmail.com',
};
const FETCH_TIMEOUT_MILLISECONDS = 15000;
const RATE_LIMIT_WINDOW_MILLISECONDS = 10500;
const FACTION_NAME_BY_ID = { 1: 'Humans', 2: 'Terminids', 3: 'Automaton', 4: 'Illuminate' };
// The backup's campaign list names factions in the plural, and Super Earth for our own.
const FACTION_NAME_BY_BACKUP_NAME = { Terminids: 'Terminids', Automatons: 'Automaton', Illuminates: 'Illuminate', 'Super Earth': 'Humans' };
const ENEMY_FACTIONS = ['Terminids', 'Automaton', 'Illuminate'];
const TARGET_AMOUNT_VALUE_TYPE = 3;
const HOUR_SECONDS = 3600;
const DAY_SECONDS = 24 * HOUR_SECONDS;

export const HISTORY_VERSION = 1;
export const HISTORY_LIMITS = {
  fullDetailSeconds: 48 * HOUR_SECONDS, // every reading for 48 hours, then one per hour
  keepSeconds: 14 * DAY_SECONDS,        // nothing older than 14 days
  maxBytes: 5 * 1024 * 1024,            // and never a file over 5 MB
  maxEvents: 200,
};

// What each sample array holds, written into the file so a reader doesn't have to guess.
const SAMPLE_FIELDS = {
  planet: ['time', 'health', 'players', 'regenPerSecond', 'backupApiPercent'],
  fronts: ['time', 'allPlayers', ...ENEMY_FACTIONS],
  order: ['time', 'progress of each task…'],
};

// ── DOWNLOADING ──────────────────────────────────────────────────────────────

// Waits a number of milliseconds.
function sleep(milliseconds) {
  return new Promise((done) => setTimeout(done, milliseconds));
}

// Downloads one JSON feed with a timeout, waiting out one rate-limit window on a 429.
async function downloadJson(url, { fetchImpl = fetch, wait = sleep, headers = {} } = {}) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'Accept-Language': 'en-US', ...headers },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MILLISECONDS),
    });
    if (response.status === 429 && attempt === 1) {
      await wait(RATE_LIMIT_WINDOW_MILLISECONDS);
      continue;
    }
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response.json();
  }
}

// Downloads an optional feed: null instead of an error, so one missing feed never loses the run.
function downloadOptionalJson(url, options) {
  return downloadJson(url, options).catch(() => null);
}

// Reads the war from the primary API (plus the backup's war status for every planet's owner).
// Sequential on purpose: five primary requests fit the API's limit of about 5 per 10 seconds.
export async function downloadFromPrimaryApi(options = {}, takenAt = nowInSeconds()) {
  const primaryOptions = { ...options, headers: PRIMARY_HEADERS };
  const war = await downloadJson(`${PRIMARY_API}/api/v1/war`, primaryOptions);
  const campaigns = await downloadJson(`${PRIMARY_API}/api/v1/campaigns`, primaryOptions);
  const assignments = await downloadOptionalJson(`${PRIMARY_API}/api/v1/assignments`, primaryOptions);
  const spaceStations = await downloadOptionalJson(`${PRIMARY_API}/api/v2/space-stations`, primaryOptions);
  const warSeason = await downloadOptionalJson(`${PRIMARY_API}/raw/api/WarSeason/current/WarID`, primaryOptions);
  const backupWarStatus = await downloadOptionalJson(`${BACKUP_API}/war/status`, options);
  const backupCampaigns = await downloadOptionalJson(`${BACKUP_API}/war/campaign`, options);
  return snapshotFromPrimary({ war, campaigns, assignments, spaceStations, warSeason, backupWarStatus, backupCampaigns }, takenAt);
}

// Reads the war from the backup API alone.
export async function downloadFromBackupApi(options = {}, takenAt = nowInSeconds()) {
  const warStatus = await downloadJson(`${BACKUP_API}/war/status`, options);
  const campaigns = await downloadJson(`${BACKUP_API}/war/campaign`, options);
  const majorOrders = await downloadOptionalJson(`${BACKUP_API}/war/major-orders`, options);
  return snapshotFromBackup({ warStatus, campaigns, majorOrders }, takenAt);
}

// ── READING A SNAPSHOT ───────────────────────────────────────────────────────
// A snapshot is one reading of the war in the same shape from either API:
// { source, takenAt, season, battles[], owners{}, allPlayers, orders[]|null,
//   dssPlanetIndex (undefined = not read), dssPlanetName }

// The current time in whole Unix seconds, the unit the whole file uses.
function nowInSeconds() {
  return Math.floor(Date.now() / 1000);
}

// A finite number, or null.
function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// An ISO date or Unix seconds → Unix seconds, or null.
function toSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const parsed = Date.parse(typeof value === 'string' ? value : '');
  return Number.isNaN(parsed) ? null : Math.round(parsed / 1000);
}

// The TARGET_AMOUNT of each task, or null where a task has none (a liberate task).
function readTaskTargets(tasks) {
  return (Array.isArray(tasks) ? tasks : []).map((task) => {
    const position = Array.isArray(task?.valueTypes) ? task.valueTypes.indexOf(TARGET_AMOUNT_VALUE_TYPE) : -1;
    return position >= 0 ? numberOrNull(task.values?.[position]) : null;
  });
}

// Every planet's owner from a backup war status, keyed by planet index.
function readOwnersFromBackupStatus(warStatus) {
  const owners = {};
  for (const status of Array.isArray(warStatus?.planetStatus) ? warStatus.planetStatus : []) {
    const owner = FACTION_NAME_BY_ID[status?.owner];
    if (Number.isInteger(status?.index) && owner) owners[status.index] = owner;
  }
  return owners;
}

// The planet the DSS orbits in a backup war status: a number, null (no DSS), or undefined (not read).
function readDssFromBackupStatus(warStatus) {
  if (!Array.isArray(warStatus?.spaceStations)) return undefined;
  return numberOrNull(warStatus.spaceStations[0]?.planetIndex);
}

// A liberation or defense % from health and maximum health, to 3 decimals, or null.
function percentDone(health, maxHealth) {
  if (numberOrNull(health) === null || !(numberOrNull(maxHealth) > 0)) return null;
  return Math.round(Math.max(0, Math.min(100, (1 - health / maxHealth) * 100)) * 1000) / 1000;
}

// The backup API's progress % for each planet (defense % during an attack), read in the same
// run as the primary, so the two APIs can be compared when they disagree.
function readBackupPercents(backupWarStatus, backupCampaigns) {
  const percentByIndex = new Map();
  for (const campaign of Array.isArray(backupCampaigns) ? backupCampaigns : []) {
    if (Number.isInteger(campaign?.planetIndex)) percentByIndex.set(campaign.planetIndex, percentDone(campaign.health, campaign.maxHealth));
  }
  for (const event of Array.isArray(backupWarStatus?.planetEvents) ? backupWarStatus.planetEvents : []) {
    if (Number.isInteger(event?.planetIndex)) percentByIndex.set(event.planetIndex, percentDone(event.health, event.maxHealth));
  }
  return percentByIndex;
}

// Each order's name in the game ("Resource Acquisition"), from the war status's global events:
// the order's own event carries its id. The /v1 and major-orders feeds only say "MAJOR ORDER".
function readOrderNamesFromStatus(warStatus) {
  const names = new Map();
  for (const event of Array.isArray(warStatus?.globalEvents) ? warStatus.globalEvents : []) {
    const orderId = numberOrNull(event?.assignmentId32);
    if (orderId && typeof event.title === 'string' && event.title.trim()) names.set(orderId, event.title.trim());
  }
  return names;
}

// The primary API's feeds → a snapshot.
export function snapshotFromPrimary({ war, campaigns, assignments, spaceStations, warSeason, backupWarStatus, backupCampaigns }, takenAt) {
  if (!Array.isArray(campaigns)) throw new Error('The primary /campaigns is not a list');
  const owners = readOwnersFromBackupStatus(backupWarStatus);
  const backupPercentByIndex = readBackupPercents(backupWarStatus, backupCampaigns);
  const orderNames = readOrderNamesFromStatus(backupWarStatus);
  const battles = [];
  for (const campaign of campaigns) {
    const planet = campaign?.planet;
    if (!Number.isInteger(planet?.index)) continue;
    const event = planet.event && typeof planet.event === 'object' ? planet.event : null;
    if (typeof planet.currentOwner === 'string') owners[planet.index] = planet.currentOwner;
    battles.push({
      index: planet.index,
      name: String(planet.name || `Planet ${planet.index}`),
      kind: event ? 'defense' : 'liberation',
      owner: planet.currentOwner || null,
      enemy: event ? event.faction || null : planet.currentOwner || null,
      campaignId: numberOrNull(campaign.id),
      eventId: event ? numberOrNull(event.id) : null,
      health: numberOrNull(event ? event.health : planet.health),
      maxHealth: numberOrNull(event ? event.maxHealth : planet.maxHealth),
      regenPerSecond: numberOrNull(planet.regenPerSecond),
      players: numberOrNull(planet.statistics?.playerCount) ?? 0,
      endsAt: event ? toSeconds(event.endTime) : null,
      backupApiPercent: backupPercentByIndex.get(planet.index) ?? null,
    });
  }

  let dssPlanetIndex = readDssFromBackupStatus(backupWarStatus);
  let dssPlanetName = null;
  if (Array.isArray(spaceStations)) {
    dssPlanetIndex = numberOrNull(spaceStations[0]?.planet?.index);
    dssPlanetName = spaceStations[0]?.planet?.name || null;
  }

  return {
    source: 'PRIMARY',
    takenAt,
    season: numberOrNull(warSeason?.id) ?? numberOrNull(backupWarStatus?.warId),
    battles,
    owners,
    allPlayers: numberOrNull(war?.statistics?.playerCount),
    orders: Array.isArray(assignments) ? assignments.map((order) => ({
      id: numberOrNull(order?.id),
      title: orderNames.get(numberOrNull(order?.id)) || String(order?.title || order?.briefing || 'Major Order'),
      expiresAt: toSeconds(order?.expiration),
      targets: readTaskTargets(order?.tasks),
      progress: (Array.isArray(order?.progress) ? order.progress : []).map(numberOrNull),
    })).filter((order) => order.id !== null) : null,
    dssPlanetIndex,
    dssPlanetName,
  };
}

// The backup API's feeds → a snapshot. Liberation health comes from the war status, defense
// health from the campaign list (the event's), event ids from the war status's planetEvents.
export function snapshotFromBackup({ warStatus, campaigns, majorOrders }, takenAt) {
  if (!Array.isArray(campaigns)) throw new Error('The backup /war/campaign is not a list');
  if (!Array.isArray(warStatus?.planetStatus)) throw new Error('The backup /war/status has no planets');
  const owners = readOwnersFromBackupStatus(warStatus);
  const orderNames = readOrderNamesFromStatus(warStatus);
  const statusByIndex = new Map(warStatus.planetStatus.map((status) => [status?.index, status]));
  const campaignByIndex = new Map((warStatus.campaigns || []).map((campaign) => [campaign?.planetIndex, campaign]));
  const eventByIndex = new Map((warStatus.planetEvents || []).map((event) => [event?.planetIndex, event]));
  const warTime = numberOrNull(warStatus.time);

  const battles = [];
  for (const campaign of campaigns) {
    const index = campaign?.planetIndex;
    if (!Number.isInteger(index)) continue;
    const status = statusByIndex.get(index) || {};
    const event = eventByIndex.get(index) || null;
    const isDefense = Boolean(campaign.defense || event);
    const campaignFaction = FACTION_NAME_BY_BACKUP_NAME[campaign.faction] || null;
    const eventEndsAt = event && warTime !== null && numberOrNull(event.expireTime) !== null
      ? takenAt + Math.round(event.expireTime - warTime) : null;
    battles.push({
      index,
      name: String(campaign.name || `Planet ${index}`),
      kind: isDefense ? 'defense' : 'liberation',
      owner: owners[index] || null,
      enemy: isDefense ? FACTION_NAME_BY_ID[event?.race] || campaignFaction : owners[index] || campaignFaction,
      campaignId: numberOrNull(campaignByIndex.get(index)?.id),
      eventId: event ? numberOrNull(event.id) : null,
      health: numberOrNull(isDefense ? event?.health ?? campaign.health : status.health ?? campaign.health),
      maxHealth: numberOrNull(isDefense ? event?.maxHealth ?? campaign.maxHealth : campaign.maxHealth),
      regenPerSecond: numberOrNull(status.regenPerSecond),
      players: numberOrNull(status.players ?? campaign.players) ?? 0,
      endsAt: isDefense ? eventEndsAt ?? toSeconds(campaign.expireDateTime) : null,
      backupApiPercent: null,
    });
  }

  return {
    source: 'BACKUP',
    takenAt,
    season: numberOrNull(warStatus.warId),
    battles,
    owners,
    allPlayers: warStatus.planetStatus.reduce((sum, status) => sum + (numberOrNull(status?.players) || 0), 0),
    orders: Array.isArray(majorOrders) ? majorOrders.map((order) => ({
      id: numberOrNull(order?.id32),
      title: orderNames.get(numberOrNull(order?.id32)) || String(order?.setting?.overrideTitle || order?.setting?.overrideBrief || 'Major Order'),
      expiresAt: numberOrNull(order?.expiresIn) !== null ? takenAt + Math.round(order.expiresIn) : null,
      targets: readTaskTargets(order?.setting?.tasks),
      progress: (Array.isArray(order?.progress) ? order.progress : []).map(numberOrNull),
    })).filter((order) => order.id !== null) : null,
    dssPlanetIndex: readDssFromBackupStatus(warStatus),
    dssPlanetName: null,
  };
}

// ── THE HISTORY FILE ─────────────────────────────────────────────────────────

// A new, empty history.
export function createEmptyHistory() {
  return {
    version: HISTORY_VERSION,
    about: 'DropIntel war history: one reading of the Helldivers 2 war every 15 minutes. Times are Unix seconds.',
    fields: SAMPLE_FIELDS,
    updatedAt: null,
    source: null,
    season: null,
    planets: {},
    fronts: [],
    orders: {},
    events: [],
    state: { owners: {}, defenses: {}, orderIds: null, dssPlanetIndex: undefined },
  };
}

// Reads history.json, or starts fresh when it is missing, broken or from another version.
export function readHistoryFile(path) {
  if (!existsSync(path)) return createEmptyHistory();
  try {
    const history = JSON.parse(readFileSync(path, 'utf8'));
    const hasEveryPart = history?.planets && history.orders && history.state?.owners
      && Array.isArray(history.fronts) && Array.isArray(history.events);
    if (history?.version === HISTORY_VERSION && hasEveryPart) return history;
    console.warn(`${path} is from another version or incomplete; starting a fresh history.`);
  } catch (error) {
    console.warn(`${path} could not be read (${error.message}); starting a fresh history.`);
  }
  return createEmptyHistory();
}

// The fields that, when any changes, start a new segment: a sample only compares with
// samples of the same owner, campaign, defense, maximum health, war season and API (the two
// APIs have disagreed about a planet's progress, and a rate across both would be nonsense).
function segmentIdentity(battle, season, source) {
  return {
    source,
    kind: battle.kind,
    owner: battle.owner,
    enemy: battle.enemy,
    campaignId: battle.campaignId,
    eventId: battle.eventId,
    maxHealth: battle.maxHealth,
    season,
  };
}

// True when a planet's last segment is the one this battle belongs to.
function isSameSegment(segment, identity) {
  // segments from before the source was recorded were all read from the primary API
  return (segment.source ?? 'PRIMARY') === identity.source
    && ['kind', 'owner', 'campaignId', 'eventId', 'maxHealth', 'season'].every((field) => segment[field] === identity[field]);
}

// Rounds a regeneration rate so the file doesn't carry float noise.
function roundRate(value) {
  return value === null ? null : Math.round(value * 1000) / 1000;
}

// A planet's name as last read, for event texts.
function planetName(history, snapshot, index) {
  return snapshot.battles.find((battle) => battle.index === index)?.name
    || history.planets[index]?.name
    || (snapshot.dssPlanetIndex === index && snapshot.dssPlanetName)
    || `Planet ${index}`;
}

// A faction as the page says it: "the Automatons".
function describeFaction(faction) {
  return { Terminids: 'the Terminids', Automaton: 'the Automatons', Illuminate: 'the Illuminate' }[faction] || 'the enemy';
}

// How long the primary may be silent before a backup reading's planet numbers go into the
// history. The two APIs have disagreed about planets, so a switch starts new segments; a one-off
// backup reading in between would split every fight for nothing.
const PRIMARY_SILENCE_BEFORE_BACKUP_SAMPLES_SECONDS = 3600;

// When the primary API last gave a reading: kept in state, or (in an older file) the newest
// sample of a segment it wrote. Null when it never did.
function findLastPrimaryReading(history) {
  if (Number.isFinite(history.state.lastPrimaryReadingAt)) return history.state.lastPrimaryReadingAt;
  let newest = null;
  for (const planet of Object.values(history.planets)) {
    for (const segment of planet.segments) {
      if ((segment.source ?? 'PRIMARY') !== 'PRIMARY') continue;
      const time = segment.samples[segment.samples.length - 1]?.[0];
      if (Number.isFinite(time) && (newest === null || time > newest)) newest = time;
    }
  }
  return newest;
}

// Adds one reading to the history: samples, segments, fronts, Major Orders and events. A backup
// reading less than an hour after a primary one adds no planet samples (the rest still counts).
export function addSnapshot(history, snapshot) {
  const time = snapshot.takenAt;
  const season = snapshot.season ?? history.season;
  const events = findEvents(history, snapshot, season);
  history.events.push(...events);

  const lastPrimaryReading = findLastPrimaryReading(history);
  const briefBackupReading = snapshot.source === 'BACKUP' && lastPrimaryReading !== null
    && time - lastPrimaryReading <= PRIMARY_SILENCE_BEFORE_BACKUP_SAMPLES_SECONDS;
  if (snapshot.source === 'PRIMARY') history.state.lastPrimaryReadingAt = time;

  for (const battle of briefBackupReading ? [] : snapshot.battles) {
    const planet = history.planets[battle.index] || (history.planets[battle.index] = { name: battle.name, segments: [] });
    planet.name = battle.name;
    const identity = segmentIdentity(battle, season, snapshot.source);
    let segment = planet.segments[planet.segments.length - 1];
    if (!segment || !isSameSegment(segment, identity)) {
      segment = { ...identity, samples: [] };
      planet.segments.push(segment);
    }
    segment.source = snapshot.source;
    segment.endsAt = battle.endsAt;
    segment.samples.push([time, battle.health, battle.players, roundRate(battle.regenPerSecond), battle.backupApiPercent ?? null]);
  }

  const playersByFront = Object.fromEntries(ENEMY_FACTIONS.map((faction) => [faction, 0]));
  for (const battle of snapshot.battles) {
    if (battle.enemy in playersByFront) playersByFront[battle.enemy] += battle.players;
  }
  history.fronts.push([time, snapshot.allPlayers, ...ENEMY_FACTIONS.map((faction) => playersByFront[faction])]);

  for (const order of snapshot.orders || []) {
    const saved = history.orders[order.id] || (history.orders[order.id] = { samples: [] });
    Object.assign(saved, { title: order.title, expiresAt: order.expiresAt, targets: order.targets, season });
    saved.samples.push([time, ...order.progress]);
  }

  history.updatedAt = time;
  history.source = snapshot.source;
  // a file written by an older collector keeps its old field list otherwise
  history.fields = SAMPLE_FIELDS;
  history.season = season;
  joinSegmentsSplitByBriefBackup(history);
  return events;
}

// Puts back together a fight the primary API read on both sides of a short backup piece (the
// collector before 1 Oct 2026 split it on every one-off backup reading). The backup's samples
// in between are dropped: the two APIs have disagreed about planets.
export function joinSegmentsSplitByBriefBackup(history) {
  const sameFight = (first, second) => ['kind', 'owner', 'campaignId', 'eventId', 'maxHealth', 'season']
    .every((field) => first[field] === second[field]);
  for (const planet of Object.values(history.planets)) {
    const segments = planet.segments;
    for (let position = 1; position < segments.length - 1;) {
      const [before, backup, after] = segments.slice(position - 1, position + 2);
      const backupSpan = backup.samples[backup.samples.length - 1][0] - backup.samples[0][0];
      const joins = backup.source === 'BACKUP' && (before.source ?? 'PRIMARY') === 'PRIMARY'
        && (after.source ?? 'PRIMARY') === 'PRIMARY' && sameFight(before, after)
        && backupSpan <= PRIMARY_SILENCE_BEFORE_BACKUP_SAMPLES_SECONDS;
      if (!joins) {
        position++;
        continue;
      }
      before.samples.push(...after.samples);
      before.endsAt = after.endsAt;
      segments.splice(position, 2);
    }
  }
}

// Compares a reading with the last one and says what happened in between. The first reading
// (or the first of a new war) only sets the baseline, so it never floods the list.
export function findEvents(history, snapshot, season) {
  const state = history.state;
  const time = snapshot.takenAt;
  const events = [];
  // faction: the enemy the event is about (the attacker, the one driven out or the one that won)
  const addEvent = (type, text, planetIndex, faction) =>
    events.push(planetIndex === undefined ? { time, type, text } : { time, type, planet: planetIndex, text, faction });

  if (history.season !== null && snapshot.season !== null && snapshot.season !== history.season) {
    addEvent('newWar', `A new Galactic War began (war ${snapshot.season}).`);
    history.state = { owners: {}, defenses: {}, orderIds: null, dssPlanetIndex: undefined };
    rememberState(history.state, snapshot);
    return events;
  }
  const isBaseline = history.updatedAt === null;

  // Defenses first: a planet that falls after a defense is one "defense failed", not also "lost".
  const currentDefenses = new Map(snapshot.battles.filter((battle) => battle.kind === 'defense').map((battle) => [battle.index, battle]));
  const settledPlanets = new Set();
  for (const [indexText, defense] of Object.entries(state.defenses)) {
    const index = Number(indexText);
    if (currentDefenses.get(index)?.eventId === defense.eventId) continue;
    const owner = snapshot.owners[index];
    const ranOut = defense.endsAt !== null && time >= defense.endsAt - 60;
    const name = planetName(history, snapshot, index);
    if ((owner && owner !== 'Humans') || (!owner && ranOut)) {
      addEvent('defenseFailed', `${name} fell to ${describeFaction(defense.enemy)}: the defense failed.`, index, defense.enemy);
    } else {
      addEvent('defenseWon', `${name} held: the defense against ${describeFaction(defense.enemy)} was won.`, index, defense.enemy);
    }
    settledPlanets.add(index);
  }
  if (!isBaseline) {
    for (const defense of currentDefenses.values()) {
      if (state.defenses[defense.index]?.eventId !== defense.eventId) {
        addEvent('attack', `${describeFaction(defense.enemy).replace(/^t/, 'T')} attack ${defense.name}.`, defense.index, defense.enemy);
      }
    }
  }

  for (const [indexText, owner] of Object.entries(snapshot.owners)) {
    const index = Number(indexText);
    const previousOwner = state.owners[index];
    if (!previousOwner || previousOwner === owner || settledPlanets.has(index)) continue;
    const name = planetName(history, snapshot, index);
    if (owner === 'Humans') addEvent('liberated', `${name} was liberated from ${describeFaction(previousOwner)}.`, index, previousOwner);
    else if (previousOwner === 'Humans') addEvent('lost', `${name} was lost to ${describeFaction(owner)}.`, index, owner);
  }

  if (snapshot.orders && state.orderIds && !isBaseline) {
    for (const order of snapshot.orders) {
      if (!state.orderIds.includes(order.id)) addEvent('newOrder', `New Major Order: ${order.title}`);
    }
  }

  const dssIndex = snapshot.dssPlanetIndex;
  if (dssIndex !== undefined && dssIndex !== null && state.dssPlanetIndex !== undefined && state.dssPlanetIndex !== null
      && dssIndex !== state.dssPlanetIndex) {
    addEvent('dssMoved', `The Democracy Space Station moved to ${planetName(history, snapshot, dssIndex)}.`, dssIndex, null);
  }

  rememberState(state, snapshot);
  return events;
}

// Keeps what the next run compares against. Anything this reading couldn't see stays as it was.
function rememberState(state, snapshot) {
  Object.assign(state.owners, snapshot.owners);
  state.defenses = {};
  for (const battle of snapshot.battles) {
    if (battle.kind === 'defense') state.defenses[battle.index] = { eventId: battle.eventId, enemy: battle.enemy, endsAt: battle.endsAt };
  }
  if (snapshot.orders) state.orderIds = snapshot.orders.map((order) => order.id);
  if (snapshot.dssPlanetIndex !== undefined) state.dssPlanetIndex = snapshot.dssPlanetIndex;
}

// ── KEEPING IT SMALL ─────────────────────────────────────────────────────────

// Drops samples older than keepSeconds and thins those older than fullDetailSeconds to the
// first one of each hour. Samples are [time, ...].
function thinSamples(samples, now, keepSeconds, fullDetailSeconds) {
  const seenHours = new Set();
  return samples.filter(([time]) => {
    if (time < now - keepSeconds) return false;
    if (time >= now - fullDetailSeconds) return true;
    const hour = Math.floor(time / HOUR_SECONDS);
    if (seenHours.has(hour)) return false;
    seenHours.add(hour);
    return true;
  });
}

// Applies one retention to every sample list, then drops what's left empty.
function applyRetention(history, now, keepSeconds, fullDetailSeconds, maxEvents) {
  for (const [index, planet] of Object.entries(history.planets)) {
    for (const segment of planet.segments) segment.samples = thinSamples(segment.samples, now, keepSeconds, fullDetailSeconds);
    planet.segments = planet.segments.filter((segment) => segment.samples.length > 0);
    if (planet.segments.length === 0) delete history.planets[index];
  }
  history.fronts = thinSamples(history.fronts, now, keepSeconds, fullDetailSeconds);
  for (const [id, order] of Object.entries(history.orders)) {
    order.samples = thinSamples(order.samples, now, keepSeconds, fullDetailSeconds);
    if (order.samples.length === 0) delete history.orders[id];
  }
  history.events = history.events.filter((event) => event.time >= now - keepSeconds).slice(-maxEvents);
}

// Keeps 48 hours in full, then hourly, nothing past 14 days, and the file under 5 MB
// (by keeping fewer days when it would grow past that).
export function pruneHistory(history, now, limits = HISTORY_LIMITS) {
  let keepSeconds = limits.keepSeconds;
  let fullDetailSeconds = limits.fullDetailSeconds;
  applyRetention(history, now, keepSeconds, fullDetailSeconds, limits.maxEvents);
  while (Buffer.byteLength(JSON.stringify(history)) > limits.maxBytes && keepSeconds > HOUR_SECONDS) {
    keepSeconds = Math.max(HOUR_SECONDS, keepSeconds - DAY_SECONDS);
    fullDetailSeconds = Math.min(fullDetailSeconds, keepSeconds);
    applyRetention(history, now, keepSeconds, fullDetailSeconds, limits.maxEvents);
  }
  return history;
}

// ── ONE RUN ──────────────────────────────────────────────────────────────────

// Takes one reading and adds it to the history: the primary, then the primary once more one
// rate-limit window later (a busy moment on its side shouldn't switch the record to the other
// API), then the backup. Returns the snapshot and events, or snapshot null when both APIs failed.
export async function collectOnce(history, options = {}, takenAt = nowInSeconds()) {
  const problems = [];
  let snapshot = null;
  const attempts = [downloadFromPrimaryApi, downloadFromPrimaryApi, downloadFromBackupApi];
  for (const [position, download] of attempts.entries()) {
    if (position === 1) await (options.wait ?? sleep)(RATE_LIMIT_WINDOW_MILLISECONDS);
    try {
      snapshot = await download(options, takenAt);
      break;
    } catch (error) {
      problems.push(error.message);
    }
  }
  if (!snapshot) return { snapshot: null, events: [], problems };
  const events = addSnapshot(history, snapshot);
  pruneHistory(history, takenAt, options.limits);
  return { snapshot, events, problems };
}

// Adds a reading to the war log. historyBefore is history.json as it was before the reading: a
// new war log starts where it starts, when that is certain (seedWarLogFromHistory).
export function updateWarLog(warLog, historyBefore, snapshot, events, limits = HISTORY_LIMITS) {
  seedWarLogFromHistory(warLog, historyBefore, historyBefore.state.owners, limits.maxEvents);
  recordReadingInWarLog(warLog, snapshot, events);
  return warLog;
}

// The command line: reads the files, adds a reading, writes them back compactly.
async function main() {
  const path = process.argv[2] || 'history.json';
  const warLogPath = process.argv[3] || null;
  const history = readHistoryFile(path);
  const historyBefore = structuredClone(history);
  const { snapshot, events, problems } = await collectOnce(history);
  for (const problem of problems) console.warn(`Warning: ${problem}`);
  if (!snapshot) {
    console.log('::warning::Both APIs failed; the files were left as they were.');
    return;
  }
  writeFileSync(path, JSON.stringify(history));
  console.log(`${snapshot.source}: ${snapshot.battles.length} battles, ${events.length} new events, `
    + `${Object.keys(history.planets).length} planets kept, ${Buffer.byteLength(JSON.stringify(history))} bytes.`);
  if (warLogPath) {
    const warLog = readWarLogFile(warLogPath);
    if (!warLog) {
      console.log('::warning::war-log.json could not be read, so it was left as it was.');
      return;
    }
    updateWarLog(warLog, historyBefore, snapshot, events);
    writeFileSync(warLogPath, JSON.stringify(warLog));
    console.log(`War log: ${Object.keys(warLog.planets).length} planets, ${Buffer.byteLength(JSON.stringify(warLog))} bytes.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

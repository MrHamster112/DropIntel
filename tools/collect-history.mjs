// Records the Galactic War for DropIntel's trends, one reading per run. The public repository's
// GitHub Action (.github/workflows/collect-history.yml) runs it every 15 minutes and keeps the
// result, history.json, on the orphan branch "war-history", with latest-raw.json beside it (see
// RAW DETAILS). Plain Node 22, no packages:
//   node tools/collect-history.mjs history.json
// A missing or broken file starts a fresh history. When both APIs fail, the file is left alone.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// The primary API's feeds → a snapshot.
export function snapshotFromPrimary({ war, campaigns, assignments, spaceStations, warSeason, backupWarStatus, backupCampaigns }, takenAt) {
  if (!Array.isArray(campaigns)) throw new Error('The primary /campaigns is not a list');
  const owners = readOwnersFromBackupStatus(backupWarStatus);
  const backupPercentByIndex = readBackupPercents(backupWarStatus, backupCampaigns);
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
      title: String(order?.title || order?.briefing || 'Major Order'),
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
      title: String(order?.setting?.overrideTitle || order?.setting?.overrideBrief || 'Major Order'),
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

// Adds one reading to the history: samples, segments, fronts, Major Orders and events.
export function addSnapshot(history, snapshot) {
  const time = snapshot.takenAt;
  const season = snapshot.season ?? history.season;
  const events = findEvents(history, snapshot, season);
  history.events.push(...events);

  for (const battle of snapshot.battles) {
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
  return events;
}

// Compares a reading with the last one and says what happened in between. The first reading
// (or the first of a new war) only sets the baseline, so it never floods the list.
export function findEvents(history, snapshot, season) {
  const state = history.state;
  const time = snapshot.takenAt;
  const events = [];
  const addEvent = (type, text, planetIndex) =>
    events.push(planetIndex === undefined ? { time, type, text } : { time, type, planet: planetIndex, text });

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
      addEvent('defenseFailed', `${name} fell to ${describeFaction(defense.enemy)}: the defense failed.`, index);
    } else {
      addEvent('defenseWon', `${name} held: the defense against ${describeFaction(defense.enemy)} was won.`, index);
    }
    settledPlanets.add(index);
  }
  if (!isBaseline) {
    for (const defense of currentDefenses.values()) {
      if (state.defenses[defense.index]?.eventId !== defense.eventId) {
        addEvent('attack', `${describeFaction(defense.enemy).replace(/^t/, 'T')} attack ${defense.name}.`, defense.index);
      }
    }
  }

  for (const [indexText, owner] of Object.entries(snapshot.owners)) {
    const index = Number(indexText);
    const previousOwner = state.owners[index];
    if (!previousOwner || previousOwner === owner || settledPlanets.has(index)) continue;
    const name = planetName(history, snapshot, index);
    if (owner === 'Humans') addEvent('liberated', `${name} was liberated from ${describeFaction(previousOwner)}.`, index);
    else if (previousOwner === 'Humans') addEvent('lost', `${name} was lost to ${describeFaction(owner)}.`, index);
  }

  if (snapshot.orders && state.orderIds && !isBaseline) {
    for (const order of snapshot.orders) {
      if (!state.orderIds.includes(order.id)) addEvent('newOrder', `New Major Order: ${order.title}`);
    }
  }

  const dssIndex = snapshot.dssPlanetIndex;
  if (dssIndex !== undefined && dssIndex !== null && state.dssPlanetIndex !== undefined && state.dssPlanetIndex !== null
      && dssIndex !== state.dssPlanetIndex) {
    addEvent('dssMoved', `The Democracy Space Station moved to ${planetName(history, snapshot, dssIndex)}.`, dssIndex);
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

// ── RAW DETAILS ──────────────────────────────────────────────────────────────
// A copy of what ArrowHead itself sends about the orders and the war, saved next to the history as
// latest-raw.json (newest only). The community API's /raw endpoints pass ArrowHead's data through
// untouched, so fields its /v1 feeds leave out show up here: the game's Galactic Campaigns (the
// "Active Campaign" screen since patch 6.3) are not in /v1/assignments, whose title is only
// "MAJOR ORDER". Lists longer than RAW_LIST_KEEP_LIMIT (every planet) are cut down to their length
// and one example, so the file stays small.

const RAW_LIST_KEEP_LIMIT = 40;
const RAW_DETAILS_FILE_NAME = 'latest-raw.json';

// A copy of a value with every long list replaced by { items, example }.
export function summarizeLongLists(value) {
  if (Array.isArray(value)) {
    if (value.length > RAW_LIST_KEEP_LIMIT) return { items: value.length, example: summarizeLongLists(value[0]) };
    return value.map(summarizeLongLists);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, summarizeLongLists(entry)]));
  }
  return value;
}

// Downloads ArrowHead's raw orders, war status and war info for a war season. It first waits one
// rate-limit window, so these three requests never share a window with the reading's own five.
// A part that fails is null; it never throws.
export async function downloadRawDetails(season, options = {}, takenAt = nowInSeconds()) {
  await (options.wait ?? sleep)(RATE_LIMIT_WINDOW_MILLISECONDS);
  const primaryOptions = { ...options, headers: PRIMARY_HEADERS };
  const raw = `${PRIMARY_API}/raw/api`;
  const assignments = await downloadOptionalJson(`${raw}/v2/Assignment/War/${season}`, primaryOptions);
  const status = await downloadOptionalJson(`${raw}/WarSeason/${season}/Status`, primaryOptions);
  const warInfo = await downloadOptionalJson(`${raw}/WarSeason/${season}/WarInfo`, primaryOptions);
  return summarizeLongLists({ takenAt, season, assignments, status, warInfo });
}

// ── ONE RUN ──────────────────────────────────────────────────────────────────

// Takes one reading (primary, else backup) and adds it to the history.
// Returns the snapshot and events, or snapshot null when both APIs failed.
export async function collectOnce(history, options = {}, takenAt = nowInSeconds()) {
  const problems = [];
  let snapshot = null;
  for (const download of [downloadFromPrimaryApi, downloadFromBackupApi]) {
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

// The command line: reads the file, adds a reading, writes it back compactly.
async function main() {
  const path = process.argv[2] || 'history.json';
  const history = readHistoryFile(path);
  const { snapshot, events, problems } = await collectOnce(history);
  for (const problem of problems) console.warn(`Warning: ${problem}`);
  if (!snapshot) {
    console.log('::warning::Both APIs failed; history.json was left as it was.');
    return;
  }
  writeFileSync(path, JSON.stringify(history));
  console.log(`${snapshot.source}: ${snapshot.battles.length} battles, ${events.length} new events, `
    + `${Object.keys(history.planets).length} planets kept, ${Buffer.byteLength(JSON.stringify(history))} bytes.`);
  // only the primary API has the raw feeds; a failure here never touches history.json
  const season = snapshot.season ?? history.season;
  if (snapshot.source === 'PRIMARY' && Number.isInteger(season)) {
    const rawDetails = await downloadRawDetails(season).catch(() => null);
    if (rawDetails) writeFileSync(join(dirname(path), RAW_DETAILS_FILE_NAME), JSON.stringify(rawDetails, null, 1));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

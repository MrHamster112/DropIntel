// The war log: who held each planet when, and what happened there, kept for good. history.json
// keeps 14 days of samples for trends and is downloaded by every visitor every 10 minutes; this
// file (war-log.json on the war-history branch) only grows by a line when a planet changes hands
// or is attacked, and the page downloads it when a planet's details are first opened.
//
// Two sources fill it: the collector, every reading from 29 Sep 2026 on, and once, the
// community's War History API (helldivers-2/War-History-API), for 2024 to 18 Aug 2026, read by
// tools/backfill-war-log.mjs. Plain Node 22, no packages.
import { existsSync, readFileSync } from 'node:fs';

export const WAR_LOG_VERSION = 1;
// The events that belong to one planet's story (newOrder, dssMoved and newWar don't).
export const WAR_LOG_PLANET_EVENTS = ['liberated', 'lost', 'attack', 'defenseWon', 'defenseFailed'];
// The events that change who holds a planet.
const OWNER_CHANGE_EVENTS = ['liberated', 'lost', 'defenseFailed'];

// A new, empty war log.
export function createEmptyWarLog() {
  return {
    version: WAR_LOG_VERSION,
    about: 'DropIntel war log: who held each planet when, and what happened there. Times are Unix seconds. '
      + 'owners: [time, owner] from that time until the next entry; a null owner means not recorded. '
      + 'events: [time, type, faction]. coverage says which source recorded which stretch.',
    updatedAt: null,
    // [time, war number] whenever the war number changed (a new war resets every planet)
    seasons: [],
    // [{ source: 'archive' | 'dropintel', from, to, … }], oldest first
    coverage: [],
    planets: {},
  };
}

// Reads war-log.json, or starts fresh when it is missing. A file that is there but broken or
// from another version gives null: unlike history.json's two weeks, the war log can't be
// rebuilt (the archive's part takes hours), so nobody may overwrite it with a fresh one.
export function readWarLogFile(path) {
  if (!existsSync(path)) return createEmptyWarLog();
  try {
    const warLog = JSON.parse(readFileSync(path, 'utf8'));
    const hasEveryPart = warLog?.planets && Array.isArray(warLog.coverage) && Array.isArray(warLog.seasons);
    if (warLog?.version === WAR_LOG_VERSION && hasEveryPart) return warLog;
    console.warn(`${path} is from another version or incomplete; leaving it as it is.`);
  } catch (error) {
    console.warn(`${path} could not be read (${error.message}); leaving it as it is.`);
  }
  return null;
}

// One planet's entry, made when it is first needed.
function planetEntry(warLog, index) {
  return warLog.planets[index] || (warLog.planets[index] = { owners: [], events: [] });
}

// The coverage part of one source, or null.
export function findCoverage(warLog, source) {
  return warLog.coverage.find((part) => part.source === source) || null;
}

// Adds an owner to a planet's timeline when it differs from the last one.
function noteOwner(warLog, index, time, owner) {
  const owners = planetEntry(warLog, index).owners;
  if (owners.length === 0 || owners[owners.length - 1][1] !== owner) owners.push([time, owner]);
}

// When the collector's history.json starts: its oldest reading of any kind, or null.
function findHistoryStart(history) {
  const times = [history.fronts?.[0]?.[0]];
  for (const order of Object.values(history.orders || {})) times.push(order.samples?.[0]?.[0]);
  for (const planet of Object.values(history.planets || {})) {
    for (const segment of planet.segments || []) times.push(segment.samples?.[0]?.[0]);
  }
  const known = times.filter(Number.isFinite);
  return known.length > 0 ? Math.min(...known) : null;
}

// Starts a new war log where history.json starts, so the days the collector recorded before the
// war log existed aren't lost. Only when that is certain: history.json has every event since its
// start (fewer than its limit, none dropped) and none of them changed an owner, so every planet
// was then held by whoever held it at the last reading. Its planet events are copied over.
// history and owners are as they were before this run's reading. Returns true when it did.
export function seedWarLogFromHistory(warLog, history, owners, maxEvents) {
  if (findCoverage(warLog, 'dropintel') || history.updatedAt === null) return false;
  const startedAt = findHistoryStart(history);
  const events = history.events || [];
  if (startedAt === null || events.length >= maxEvents) return false;
  if (events.some((event) => OWNER_CHANGE_EVENTS.includes(event.type))) return false;
  for (const [index, owner] of Object.entries(owners)) noteOwner(warLog, index, startedAt, owner);
  for (const event of events) {
    if (WAR_LOG_PLANET_EVENTS.includes(event.type) && Number.isInteger(event.planet)) {
      planetEntry(warLog, event.planet).events.push([event.time, event.type, event.faction ?? null]);
    }
  }
  if (history.season !== null && history.season !== undefined) warLog.seasons.push([startedAt, history.season]);
  warLog.coverage.push({ source: 'dropintel', from: startedAt, to: history.updatedAt });
  return true;
}

// Adds one collector reading: every planet whose owner changed, and the planet events the
// reading found (from findEvents). Owners the reading couldn't see keep their last entry.
export function recordReadingInWarLog(warLog, snapshot, events) {
  const time = snapshot.takenAt;
  let coverage = findCoverage(warLog, 'dropintel');
  if (!coverage) {
    coverage = { source: 'dropintel', from: time, to: time };
    warLog.coverage.push(coverage);
  }
  const season = snapshot.season ?? null;
  const lastSeason = warLog.seasons[warLog.seasons.length - 1];
  if (season !== null && (!lastSeason || lastSeason[1] !== season)) warLog.seasons.push([time, season]);

  for (const [index, owner] of Object.entries(snapshot.owners || {})) noteOwner(warLog, index, time, owner);
  for (const event of events) {
    if (!WAR_LOG_PLANET_EVENTS.includes(event.type) || !Number.isInteger(event.planet)) continue;
    planetEntry(warLog, event.planet).events.push([event.time, event.type, event.faction ?? null]);
  }
  coverage.to = time;
  warLog.updatedAt = time;
}

// Puts the archive's part ({ coverage, owners: {index: [[time, owner]]}, seasons }) in front of
// our own record, replacing any archive part already there. Where the archive ends before our
// record starts, every planet gets a null entry: not recorded in between. Where they overlap,
// our own record wins.
export function mergeArchiveIntoWarLog(warLog, archive) {
  const ours = findCoverage(warLog, 'dropintel');
  const ourStart = ours ? ours.from : Infinity;
  const cut = Math.min(archive.coverage.to, ourStart);
  const indexes = new Set([...Object.keys(warLog.planets), ...Object.keys(archive.owners)]);
  for (const index of indexes) {
    const planet = planetEntry(warLog, index);
    const ourOwners = planet.owners.filter(([time]) => time >= ourStart);
    const archiveOwners = (archive.owners[index] || []).filter(([time]) => time < cut);
    const gap = archiveOwners.length > 0 && cut < ourStart ? [[cut, null]] : [];
    planet.owners = [...archiveOwners, ...gap, ...ourOwners];
  }
  warLog.seasons = [...(archive.seasons || []).filter(([time]) => time < cut), ...warLog.seasons.filter(([time]) => time >= ourStart)];
  warLog.coverage = [{ ...archive.coverage, to: cut }, ...warLog.coverage.filter((part) => part.source !== 'archive')];
  return warLog;
}

// Copies the war's past into war-log.json, once: who held each planet from 2024 until the
// community's War History API (github.com/helldivers-2/War-History-API, MIT) stopped recording.
// On 2 Oct 2026 its newest reading was from 18 Aug 2026; DropIntel's own record starts on
// 29 Sep 2026, so the war log shows the weeks in between as not recorded.
//
// The archive adds a row whenever a planet's owner, health, regen or player count changes, so a
// busy planet has tens of thousands of rows: far too many to page through. Instead this asks for
// every planet's owner at one moment (/api/planets?time=T) every 6 hours, and where an owner
// differs between two readings, narrows the change down to about 2 hours with single-planet
// questions (/api/planet/N?time=T). A planet that changed hands and back within 6 hours is
// missed. One question at a time, with a pause between them: it is one volunteer's server.
//
// Run by the public repository's "Copy the war's past" workflow, by hand:
//   node tools/backfill-war-log.mjs read archive-part.json [war-log.json]   (a few hours)
//   node tools/backfill-war-log.mjs merge archive-part.json war-log.json
// read carries on from where an unfinished earlier run stopped (the war log says where). It
// saves what it has when it runs out of time or the archive stops answering; run it again.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCoverage, mergeArchiveIntoWarLog, readWarLogFile } from './war-log.mjs';

export const ARCHIVE_API = 'https://api-helldivers.kejax.net/api';
export const ARCHIVE_HOME = 'https://github.com/helldivers-2/War-History-API';
const HOUR_SECONDS = 3600;
const DAY_SECONDS = 24 * HOUR_SECONDS;
// its README: "back to March 5th 2024"
export const ARCHIVE_EARLIEST = Date.UTC(2024, 2, 5) / 1000;
export const SAMPLE_EVERY_SECONDS = 6 * HOUR_SECONDS;
export const PRECISION_SECONDS = 2 * HOUR_SECONDS;
const PAUSE_MILLISECONDS = 1000;               // between questions: well under 60 a minute
const RETRY_WAITS_MILLISECONDS = [5000, 30000, 120000];
const TOO_MANY_REQUESTS_WAIT_MILLISECONDS = 60000;
const FETCH_TIMEOUT_MILLISECONDS = 60000;
const DEFAULT_RUN_MINUTES = 320;              // the workflow's job may run 350
const USER_AGENT = 'DropIntel war-log backfill (https://github.com/MrHamster112/DropIntel; dropintel.contact@gmail.com)';
const FACTION_NAME_BY_ID = { 1: 'Humans', 2: 'Terminids', 3: 'Automaton', 4: 'Illuminate' };

// Waits a number of milliseconds.
function sleep(milliseconds) {
  return new Promise((done) => setTimeout(done, milliseconds));
}

// A number, or null for anything else.
function numberOrNull(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? number : null;
}

// Asks the archive one question after a short pause: its JSON, null for a 404 (nothing recorded
// for that time), and a few retries for anything else, a minute apart after a 429.
export async function downloadArchiveJson(url, { fetchImpl = fetch, wait = sleep } = {}) {
  let problem = null;
  for (let attempt = 0; attempt <= RETRY_WAITS_MILLISECONDS.length; attempt++) {
    await wait(attempt === 0 ? PAUSE_MILLISECONDS
      : problem === 429 ? TOO_MANY_REQUESTS_WAIT_MILLISECONDS : RETRY_WAITS_MILLISECONDS[attempt - 1]);
    try {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MILLISECONDS) });
      if (response.status === 404) return null;
      if (response.ok) return await response.json();
      problem = response.status;
    } catch (error) {
      problem = error.message;
    }
  }
  throw new Error(`${url} failed (${problem})`);
}

// Every planet's owner and war number at one moment, as a Map index → {owner, warId}, or null
// when the archive has nothing for that time.
export async function readOwnersAt(time, options) {
  const rows = await downloadArchiveJson(`${ARCHIVE_API}/planets?time=${time}`, options);
  const owners = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const owner = FACTION_NAME_BY_ID[row?.owner];
    if (Number.isInteger(row?.index) && owner) owners.set(row.index, { owner, warId: numberOrNull(row.warId) });
  }
  return owners.size > 0 ? owners : null;
}

// One planet's owner at one moment, or null when the archive can't say.
export async function readPlanetOwnerAt(index, time, options) {
  const row = await downloadArchiveJson(`${ARCHIVE_API}/planet/${index}?time=${time}`, options);
  return FACTION_NAME_BY_ID[row?.owner] ?? null;
}

// When the archive last recorded: the newest update among its current rows (an unchanged row is
// touched at every reading), never later than now.
export async function findArchiveEnd(options, nowSeconds = Math.floor(Date.now() / 1000)) {
  const rows = await downloadArchiveJson(`${ARCHIVE_API}/planets`, options);
  const times = (Array.isArray(rows) ? rows : [])
    .flatMap((row) => [numberOrNull(row?.valid_start), Date.parse(row?.updated_at ?? '') / 1000])
    .filter(Number.isFinite);
  if (times.length === 0) throw new Error('The archive says nothing about the planets now.');
  return Math.min(Math.floor(Math.max(...times)), nowSeconds);
}

// The first day the archive has a reading for, from its README's 5 March 2024 on: {time, owners}.
export async function findArchiveStart(end, options) {
  for (let time = ARCHIVE_EARLIEST; time <= end; time += DAY_SECONDS) {
    const owners = await readOwnersAt(time, options);
    if (owners) return { time, owners };
  }
  return null;
}

// When a planet's owner differs between two readings: the change(s) in between, each to within
// `precision` seconds, as [[time first seen, new owner]]. Halves the gap with single-planet
// questions; an answer the archive can't give ends the search at the later reading.
export async function findOwnerChanges(index, fromTime, fromOwner, toTime, toOwner, options, precision = PRECISION_SECONDS) {
  if (fromOwner === toOwner) return [];
  if (toTime - fromTime <= precision) return [[toTime, toOwner]];
  const middle = Math.round((fromTime + toTime) / 2);
  const middleOwner = await readPlanetOwnerAt(index, middle, options);
  if (middleOwner === null) return [[toTime, toOwner]];
  return [
    ...await findOwnerChanges(index, fromTime, fromOwner, middle, middleOwner, options, precision),
    ...await findOwnerChanges(index, middle, middleOwner, toTime, toOwner, options, precision),
  ];
}

// Adds an owner to a planet's timeline in the archive part when it differs from the last one.
function noteArchiveOwner(part, index, time, owner) {
  const owners = part.owners[index] || (part.owners[index] = []);
  if (owners.length === 0 || owners[owners.length - 1][1] !== owner) owners.push([time, owner]);
}

// Adds a war number to the archive part when it changed.
function noteArchiveSeason(part, time, warId) {
  const last = part.seasons[part.seasons.length - 1];
  if (warId !== null && (!last || last[1] !== warId)) part.seasons.push([time, warId]);
}

// The archive part an earlier, unfinished run saved into the war log, to carry on from; null
// when there is none or it was finished.
export function readUnfinishedArchivePart(warLog) {
  const coverage = findCoverage(warLog, 'archive');
  if (!coverage || coverage.complete) return null;
  const owners = {};
  for (const [index, planet] of Object.entries(warLog.planets)) {
    const entries = planet.owners.filter(([time, owner]) => time < coverage.to && owner !== null);
    if (entries.length > 0) owners[index] = entries;
  }
  return { coverage: { ...coverage }, owners, seasons: warLog.seasons.filter(([time]) => time < coverage.to) };
}

// Each planet's last owner in an archive part, with the last war number: Map index → {owner, warId}.
function lastOwnersOf(part) {
  const warId = part.seasons[part.seasons.length - 1]?.[1] ?? null;
  return new Map(Object.entries(part.owners).map(([index, owners]) => [Number(index), { owner: owners[owners.length - 1][1], warId }]));
}

// Reads the archive into an archive part ({coverage, owners, seasons}), from the start or from
// an unfinished part. Stops at the deadline (compared with clock(), in milliseconds) or when the
// archive stops answering, and says so with coverage.complete false; run it again to carry on.
export async function readArchive({ unfinished = null, options = {}, deadline = Infinity, clock = Date.now, log = console.log } = {}) {
  const end = await findArchiveEnd(options);
  let part = unfinished;
  let previous;
  if (part) {
    previous = lastOwnersOf(part);
    log(`Carrying on from ${new Date(part.coverage.to * 1000).toISOString()}.`);
  } else {
    const start = await findArchiveStart(end, options);
    if (!start) throw new Error('The archive has no readings at all.');
    part = {
      coverage: { source: 'archive', name: 'War History API (helldivers-2/War-History-API)', url: ARCHIVE_HOME, api: ARCHIVE_API,
        from: start.time, to: start.time, sampledEverySeconds: SAMPLE_EVERY_SECONDS, precisionSeconds: PRECISION_SECONDS, complete: false },
      owners: {},
      seasons: [],
    };
    for (const [index, { owner, warId }] of start.owners) {
      noteArchiveOwner(part, index, start.time, owner);
      noteArchiveSeason(part, start.time, warId);
    }
    previous = start.owners;
  }

  let time = part.coverage.to;
  let readingsUntilProgressLine = 0;
  while (time < end) {
    if (clock() >= deadline) {
      log(`Out of time at ${new Date(time * 1000).toISOString()}: saving what there is. Run it again to carry on.`);
      return part;
    }
    const next = Math.min(time + SAMPLE_EVERY_SECONDS, end);
    try {
      const current = await readOwnersAt(next, options);
      for (const [index, now] of current || []) {
        const before = previous.get(index);
        if (before && before.warId !== now.warId) {
          // a new war resets the planets: no liberation or loss to look for
          noteArchiveSeason(part, next, now.warId);
          noteArchiveOwner(part, index, next, now.owner);
        } else if (!before) {
          noteArchiveOwner(part, index, next, now.owner);
        } else if (before.owner !== now.owner) {
          for (const [changeTime, owner] of await findOwnerChanges(index, time, before.owner, next, now.owner, options)) {
            noteArchiveOwner(part, index, changeTime, owner);
          }
        }
        previous.set(index, now);
      }
    } catch (error) {
      log(`The archive stopped answering (${error.message}): saving what there is. Run it again to carry on.`);
      return part;
    }
    time = next;
    part.coverage.to = time;
    if (--readingsUntilProgressLine <= 0) {
      log(`Read up to ${new Date(time * 1000).toISOString().slice(0, 10)}.`);
      readingsUntilProgressLine = 4 * 30; // a line about every 30 days of war
    }
  }
  part.coverage.complete = true;
  log(`Done: ${new Date(part.coverage.from * 1000).toISOString()} to ${new Date(part.coverage.to * 1000).toISOString()}.`);
  return part;
}

// The command line: read (slow) or merge, see the top of this file.
async function main() {
  const [command, partPath, warLogPath] = process.argv.slice(2);
  if (command === 'read' && partPath) {
    const savedWarLog = warLogPath ? readWarLogFile(warLogPath) : null;
    const unfinished = savedWarLog ? readUnfinishedArchivePart(savedWarLog) : null;
    const minutes = Number(process.env.BACKFILL_MINUTES) || DEFAULT_RUN_MINUTES;
    const part = await readArchive({ unfinished, deadline: Date.now() + minutes * 60 * 1000 });
    writeFileSync(partPath, JSON.stringify(part));
    const changes = Object.values(part.owners).reduce((sum, owners) => sum + owners.length - 1, 0);
    console.log(`${Object.keys(part.owners).length} planets, ${changes} changes of owner, `
      + `${part.coverage.complete ? 'finished' : 'not finished yet'}.`);
  } else if (command === 'merge' && partPath && warLogPath) {
    const part = JSON.parse(readFileSync(partPath, 'utf8'));
    const savedWarLog = readWarLogFile(warLogPath);
    if (!savedWarLog) throw new Error(`${warLogPath} could not be read; it was left as it was.`);
    const warLog = mergeArchiveIntoWarLog(savedWarLog, part);
    writeFileSync(warLogPath, JSON.stringify(warLog));
    console.log(`War log: ${Object.keys(warLog.planets).length} planets, ${Buffer.byteLength(JSON.stringify(warLog))} bytes.`);
  } else {
    console.error('Use: backfill-war-log.mjs read <archive-part.json> [war-log.json] | merge <archive-part.json> <war-log.json>');
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

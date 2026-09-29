'use strict';

// ── CONFIGURATION ────────────────────────────────────────────────────────────

const PRIMARY_API_URL            = 'https://api.helldivers2.dev/api/v1';
const PRIMARY_API_V2_URL         = 'https://api.helldivers2.dev/api/v2';
const PRIMARY_API_REQUIRED_HEADERS = {
  'X-Super-Client':  'dropintel',
  'X-Super-Contact': 'https://github.com/MrHamster112/DropIntel',
};
const BACKUP_API_URL = 'https://helldiverstrainingmanual.com/api/v1';
// The primary API answers in the language the browser asks for (Accept-Language),
// so a browser set to Polish got Polish planet names and Major Orders. The page is
// in English, so every request asks for English whatever the browser prefers.
const API_LANGUAGE = 'en-US';
// Dates and numbers are written in English too, not in the computer's own language.
// British English gives "27 Sep 2026, 18:05": day first, 24-hour clock.
const DISPLAY_LOCALE = 'en-GB';
const EFFECT_NAMES_DATABASE_URL =
  'https://raw.githubusercontent.com/helldivers-2/json/master/effects/planetEffects.json';

// The owner's donation page, opened by the footer's "Support the project" button.
// Set it to '' and the button stays href="#" and does nothing when clicked.
const DONATION_URL = 'https://buycoffee.to/dropintel';

const REFRESH_INTERVAL_SECONDS = 60;
const RATE_LIMIT_WINDOW_MILLISECONDS = 10500;       // primary API allows ~5 requests / 10s
const HEAVY_FEEDS_REFRESH_EVERY_N_CYCLES = 5;
const FETCH_TIMEOUT_MILLISECONDS = 15000;           // a hung request must not stall the loop forever

// Trend measurement. No feed reports how fast a planet is moving, so the page
// remembers what it saw on each refresh and measures the change itself.
const PLANET_HISTORY_STORAGE_KEY = 'hd2_planet_history';
const KNOWN_BIOMES_STORAGE_KEY = 'hd2_known_biomes';          // planet index → primary biome name
const VIEW_MODE_STORAGE_KEY = 'hd2_view_mode';
const PLANET_HISTORY_MAX_AGE_MILLISECONDS = 45 * 60 * 1000;
const MAJOR_ORDER_HISTORY_STORAGE_KEY = 'hd2_major_order_history';
const MAJOR_ORDER_HISTORY_MAX_AGE_MILLISECONDS = 6 * 60 * 60 * 1000; // orders run for days
const TREND_WINDOW_MILLISECONDS = 30 * 60 * 1000;          // rates look at the last 30 minutes…
const TREND_LONGEST_WINDOW_MILLISECONDS = 120 * 60 * 1000; // …reaching back at most 2 hours for sparse samples
const TREND_LARGEST_GAP_MILLISECONDS = 45 * 60 * 1000;     // samples before a longer gap are not "recent"
const TREND_MINIMUM_SPAN_MILLISECONDS = 5 * 60 * 1000;   // shorter spans are mostly noise
const ETA_LONGEST_HOURS = 14 * 24;                        // past two weeks an ETA says nothing useful
const TREND_STALL_THRESHOLD_PERCENT_PER_HOUR = 0.05;
const SAMPLE_MERGE_WINDOW_MILLISECONDS = 20 * 1000;       // two renders in one cycle = one sample
const MINIMUM_PLAYERS_FOR_OUTPUT_ESTIMATE = 100;          // tiny squads make per-player maths noisy
const DEFENSE_MINIMUM_ELAPSED_FOR_AVERAGE_MILLISECONDS = 10 * 60 * 1000;

// ── LOOKUP TABLES ────────────────────────────────────────────────────────────

const FACTION_NAME_BY_ID = { 1: 'Humans', 2: 'Terminids', 3: 'Automaton', 4: 'Illuminate' };

// The numbers in a Major Order task the page reads (helldivers-2/json's
// assignments/tasks/task/valueTypes.json). Tasks also carry an enemy unit id,
// a stratagem id and a difficulty, which the page leaves alone: names for them
// could only be guessed, so the owner writes the exact wording in major-order-fixes.js.
const TASK_VALUE_TYPE = { FACTION_ID: 1, TARGET_AMOUNT: 3, LOCATION_TYPE: 11, LOCATION_INDEX: 12 };

// What value type 11 says value type 12 is. A galaxy-wide "kill 25M Terminids"
// carries location type 0 and index 0, and index 0 there is not Super Earth.
// (Read this way by community tools such as the Galactic Wide Web bot.)
const TASK_LOCATION_TYPE = { NONE: 0, PLANET: 1, SECTOR: 2 };

// Only the task types documented in README.md; anything else is described generically.
const TASK_TYPE = { ERADICATE: 3, COMPLETE_OPERATIONS: 9, LIBERATE_PLANET: 11, HOLD_PLANET: 13 };

const DSS_ACTION_STATUS_NAME = { 1: 'CHARGING', 2: 'ACTIVE', 3: 'COOLDOWN' };

const SERVER_PREFERENCES = ['auto', 'live', 'backup'];

const VIEW_MODES = ['simple', 'advanced', 'guide'];

// How many "where to drop" cards simple mode shows.
const SIMPLE_MODE_DROP_TARGET_COUNT = 4;

// Faction logos. images/faction-icons holds the game's logos (traced by a Helldivers
// Wiki contributor); fan sites and apps commonly use them, but Arrowhead and Sony have
// not given permission. If they ever ask for them to be removed, point this at
// 'images/faction-icons-drawn/': symbols drawn for this page, with the same file names.
const FACTION_ICON_DIRECTORY = 'images/faction-icons/';
const FACTION_ICON_FILE_BY_KEY = {
  automaton: 'Automatons.svg', terminids: 'Terminids.svg',
  illuminate: 'Illuminate.svg', humans: 'Super Earth.svg',
};
const FACTION_DISPLAY_NAME_BY_KEY = {
  automaton: 'Automatons', terminids: 'Terminids', illuminate: 'Illuminate', humans: 'Super Earth',
};

// Built-in snapshot of effect ID → name; the live database is merged on top at startup.
const EFFECT_NAME_BY_ID = {
  1186:'Light Gloom', 1187:'Gloom', 1188:'Dense Gloom', 1190:'Unreachable',
  1193:'Gloom Border', 1197:'Xenoentomology Center', 1198:'Deep Mantle Forge Complex',
  1202:'The Jet Brigade (Enemies)', 1203:'The Jet Brigade',
  1229:'Meridian Black Hole', 1232:'Factory Hub', 1234:'Center of Science',
  1236:'Center for Civilian Surveillance and Safety', 1239:'Jet Brigade Factories',
  1241:'Fractured Planet', 1243:'Predator Strain (Enemies)', 1244:'Spore Burst Strain (Enemies)',
  1245:'Predator Strain', 1246:'Campaign Blocker',
  1248:'The Incineration Corps (Enemies)', 1249:'The Incineration Corps',
  1252:'Fractured Planet', 1282:'Helldiver Training Facilities',
  1287:'New Hope City', 1291:'New Aspiration City', 1292:'New Yearning City',
  1303:'Rupture Strain (Enemies)', 1304:'Outpost Alpha',
  1306:'Dragonroaches (Enemies)', 1307:'Hive Lords (Enemies)', 1308:'Hive Lords',
  1309:'Dragonroaches', 1310:'Rupture Strain', 1311:'Hive World',
  1324:'Ultramafic Mine', 1342:'Center for Confinement of Dissidence',
  1344:'Pandora Base', 1352:'Conventional Black Hole', 1353:'Data Center',
  1360:'Cyborgs (Enemies)', 1361:'Cyborgs', 1376:'The Void',
  1377:'Mindless Masses (Enemies)', 1378:'Mindless Masses',
  1379:'Appropriators', 1380:'Appropriators (Enemies)', 1386:'Spore Burst Strain',
};

// Effect ID → description (what the modifier actually DOES, e.g. "+15s Eagle
// rearm time"). Filled in from the community database at startup.
const EFFECT_DESCRIPTION_BY_ID = {};

// ── BROWSER STORAGE ──────────────────────────────────────────────────────────
// localStorage throws in some privacy modes and sandboxed frames; the page
// must still work there, just without remembering anything.

// Reads a remembered string, or null when storage is unavailable.
function readStoredValue(storageKey) {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

// Remembers a string; returns false when storage is unavailable or full.
function writeStoredValue(storageKey, value) {
  try {
    window.localStorage.setItem(storageKey, value);
    return true;
  } catch {
    return false;
  }
}

// ── SHAPE GUARDS (used only at the API boundary) ─────────────────────────────

// The value when it is an array, otherwise an empty array.
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// True for a plain object (not null, not an array).
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// True when a value is a real, finite number.
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Cleans one planet object so renderers can trust its shape; null if unusable.
function normalizePlanet(planet) {
  if (!isPlainObject(planet) || !isFiniteNumber(planet.index)) return null;
  return {
    ...planet,
    name:       typeof planet.name === 'string' && planet.name ? planet.name : `Planet #${planet.index}`,
    sector:     typeof planet.sector === 'string' ? planet.sector : '',
    biome:      isPlainObject(planet.biome) ? planet.biome : { name: '' },
    hazards:    asArray(planet.hazards).filter(isPlainObject),
    waypoints:  asArray(planet.waypoints).filter(isFiniteNumber),
    attacking:  asArray(planet.attacking).filter(isFiniteNumber),
    regions:    asArray(planet.regions).filter(isPlainObject),
    statistics: isPlainObject(planet.statistics) ? planet.statistics : {},
    event:      isPlainObject(planet.event) ? planet.event : null,
  };
}

// Cleans one campaign; null when it has no usable planet.
function normalizeCampaign(campaign) {
  if (!isPlainObject(campaign)) return null;
  const planet = normalizePlanet(campaign.planet);
  return planet ? { ...campaign, planet } : null;
}

// Cleans one assignment (Major Order) so title/tasks/progress always exist.
function normalizeAssignment(assignment) {
  if (!isPlainObject(assignment)) return null;
  return {
    ...assignment,
    title:    typeof assignment.title === 'string' ? assignment.title : '',
    briefing: typeof assignment.briefing === 'string' ? assignment.briefing : '',
    tasks:    asArray(assignment.tasks).filter(isPlainObject),
    progress: asArray(assignment.progress),
    reward:   isPlainObject(assignment.reward) ? assignment.reward : null,
    rewards:  asArray(assignment.rewards).filter(isPlainObject),
  };
}

// Cleans one news dispatch.
function normalizeDispatch(dispatch) {
  if (!isPlainObject(dispatch)) return null;
  return {
    ...dispatch,
    message:   typeof dispatch.message === 'string' ? dispatch.message : '',
    published: typeof dispatch.published === 'string' ? dispatch.published : null,
  };
}

// ── STATE — everything downloaded ends up in this one object ────────────────
// Full field-by-field documentation lives in README.md.

const apiData = {
  warStatistics: null,        // global stats: playerCount, impactMultiplier, kills…
  assignments: [],            // Major Order + minor orders, with .tasks and .progress
  activeCampaigns: [],        // where you can fight; each has a full .planet object
  defenseEvents: [],          // planets under attack (planet.event is filled in)
  planets: [],                // every known planet (primary: ~269, backup: ~272)
  planetsByIndex: {},         // planets keyed by planet.index for fast lookup
  indexesOfPlanetsWithActiveBattles: new Set(),
  newsDispatches: [],         // latest news from High Command
  spaceStations: [],          // the DSS (rich from primary API, basic from backup)
  planetActiveEffects: [],    // [{index, galacticEffectId}] — fleets, buffs, debuffs
  currentWarTimeSeconds: 0,   // game clock at warTimeCapturedAtTimestamp
  warTimeCapturedAtTimestamp: null, // Date.now() when currentWarTimeSeconds was read
  planetHistoryByIndex: loadPlanetHistory(Date.now()), // samples for trend maths
  majorOrderHistory: loadMajorOrderHistory(Date.now()), // [{timestamp, assignmentId, progress[]}]
  sharedHistory: null,        // the collector's history.json, converted; in memory only (SHARED WAR HISTORY)
  sharedHistoryStatus: 'loading', // 'loading' | 'loaded' | 'unavailable'
  knownBiomeNameByPlanetIndex: loadKnownBiomes(), // primary biome names, remembered for the backup API
  currentDataSource: null,    // 'PRIMARY' | 'FALLBACK' | null
  lastSuccessfulFetchTimestamp: null,
};

// ── HELPER FUNCTIONS ─────────────────────────────────────────────────────────

// Liberation % of an enemy planet (0–100). Lower planet health = more liberated.
function getLiberationPercent(planet) {
  const maxHealth = planet.maxHealth || 1;
  const percent = (1 - planet.health / maxHealth) * 100;
  return Math.max(0, Math.min(100, percent));
}

// Defense progress % (0–100). 100 = defense won.
function getDefenseProgressPercent(defenseEvent) {
  const maxHealth = defenseEvent.maxHealth || 1;
  const percent = (1 - defenseEvent.health / maxHealth) * 100;
  return Math.max(0, Math.min(100, percent));
}

// How fast the enemy claws back liberation, in % per hour.
function getEnemyRegenPercentPerHour(planet) {
  const healthRegenPerHour = (planet.regenPerSecond || 0) * 3600;
  return healthRegenPerHour / (planet.maxHealth || 1) * 100;
}

// True when health and max health are real numbers, so % maths means something.
// (The backup API gives no max health for planets without a campaign.)
function hasKnownHealth(planet) {
  return isFiniteNumber(planet.health) && isFiniteNumber(planet.maxHealth) && planet.maxHealth > 0;
}

// True when the planet has a live defense event.
function planetIsUnderAttack(planet) {
  return planet.event !== null && planet.event !== undefined;
}

// Which enemy is fought here: 'automaton' | 'terminids' | 'illuminate' | null.
function getEnemyFactionOnPlanet(planet) {
  if (planetIsUnderAttack(planet)) {
    return normalizeFactionName(planet.event.faction)
        || normalizeFactionName(planet.currentOwner);
  }
  return normalizeFactionName(planet.currentOwner);
}

// Any faction spelling → lowercase key, or null for Humans/unknown.
function normalizeFactionName(factionName) {
  const lowered = (factionName || '').toLowerCase();
  if (lowered.includes('automaton') || lowered.includes('cyborg')) return 'automaton';
  if (lowered.includes('terminid')  || lowered.includes('bug'))    return 'terminids';
  if (lowered.includes('illuminate'))                              return 'illuminate';
  return null;
}

// Seconds → "2d 6h" / "3h 14m" / "45m".
function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined) return '—';
  if (!isFinite(totalSeconds) || totalSeconds < 0) return '—';
  const days    = Math.floor(totalSeconds / 86400);
  const hours   = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days  > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Seconds from now until an ISO date string (0 if passed, null if invalid).
function getSecondsUntil(isoDateString) {
  if (!isoDateString) return null;
  const targetTime = Date.parse(isoDateString);
  if (isNaN(targetTime)) return null;
  return Math.max(0, (targetTime - Date.now()) / 1000);
}

// 1234567 → "1.23M", 45600 → "45.6K".
function formatBigNumber(number) {
  if (number === null || number === undefined) return '—';
  if (number >= 1e9) return (number / 1e9).toFixed(2) + 'B';
  if (number >= 1e6) return (number / 1e6).toFixed(2) + 'M';
  if (number >= 1e3) return (number / 1e3).toFixed(1) + 'K';
  return Math.round(number).toLocaleString(DISPLAY_LOCALE);
}

// 42.123 → "42.1%"; anything that isn't a number → "—".
function formatPercent(value, decimals = 1) {
  return isFiniteNumber(value) ? `${value.toFixed(decimals)}%` : '—';
}

// 1.234 → "+1.23%/h", -0.5 → "−0.50%/h".
function formatPercentPerHour(value) {
  if (!isFiniteNumber(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(2)}%/h`;
}

// Enemy regeneration for display. Some planets report a negative rate (they
// drift toward us on their own); saying "recovers −1%/h" would read as nonsense.
function formatEnemyRecovery(regenPercentPerHour) {
  if (!isFiniteNumber(regenPercentPerHour)) return '—';
  if (regenPercentPerHour < 0) return `none (${regenPercentPerHour.toFixed(2).replace('-', '−')}%/h)`;
  return `${regenPercentPerHour.toFixed(2)}%/h`;
}

// A past timestamp → "just now" / "4 min ago" / "2 h 5 min ago".
function formatTimeAgo(timestamp, nowTimestamp = Date.now()) {
  if (!isFiniteNumber(timestamp)) return 'never';
  const minutesAgo = Math.floor(Math.max(0, nowTimestamp - timestamp) / 60000);
  if (minutesAgo < 1) return 'just now';
  if (minutesAgo < 60) return `${minutesAgo} min ago`;
  const hoursAgo = Math.floor(minutesAgo / 60);
  if (hoursAgo >= 48) return `${Math.floor(hoursAgo / 24)} days ago`;
  const remainingMinutes = minutesAgo % 60;
  return remainingMinutes ? `${hoursAgo} h ${remainingMinutes} min ago` : `${hoursAgo} h ago`;
}

// Reads one typed value out of an assignment task (use TASK_VALUE_TYPE keys).
function getTaskValue(task, valueTypeId) {
  const position = (task.valueTypes || []).indexOf(valueTypeId);
  if (position === -1) return null;
  return (task.values || [])[position];
}

// The owner's Major Order corrections from major-order-fixes.js, checked:
// entries of the wrong shape are left out. readable is false when the file is
// missing or has a mistake in it; then the page words every task by itself.
function getMajorOrderFixes() {
  const fixes = typeof MAJOR_ORDER_FIXES !== 'undefined' && isPlainObject(MAJOR_ORDER_FIXES) ? MAJOR_ORDER_FIXES : null;
  return {
    readable: fixes !== null,
    taskText: asArray(fixes?.taskText).filter(fix => isPlainObject(fix)
      && typeof fix.pageSays === 'string' && fix.pageSays.trim() !== ''
      && typeof fix.showInstead === 'string' && fix.showInstead.trim() !== ''),
  };
}

// Where a task has to be done: a planet index, a sector index, or neither when
// it counts anywhere. The location type (value type 11) says what the index is.
// A task without one names a planet if it is a liberate/hold task, or if the
// index isn't 0 (0 is only Super Earth when the location type says so).
function getTaskLocation(task) {
  const location = { planetIndex: null, sectorIndex: null };
  const locationIndex = getTaskValue(task, TASK_VALUE_TYPE.LOCATION_INDEX);
  if (!isFiniteNumber(locationIndex)) return location;
  const locationType = getTaskValue(task, TASK_VALUE_TYPE.LOCATION_TYPE);
  if (isFiniteNumber(locationType)) {
    if (locationType === TASK_LOCATION_TYPE.PLANET) location.planetIndex = locationIndex;
    else if (locationType === TASK_LOCATION_TYPE.SECTOR) location.sectorIndex = locationIndex;
    return location;
  }
  const isPlanetTask = task.type === TASK_TYPE.LIBERATE_PLANET || task.type === TASK_TYPE.HOLD_PLANET;
  if (isPlanetTask || locationIndex !== 0) location.planetIndex = locationIndex;
  return location;
}

// Effect ID → readable name, e.g. 1310 → "Rupture Strain".
function getEffectName(effectId) {
  if (EFFECT_NAME_BY_ID[effectId]) return EFFECT_NAME_BY_ID[effectId];
  return `Unknown effect #${effectId}`;
}

// True when an effect ID has a real name (built in or from the database).
function effectHasKnownName(effectId) {
  return Boolean(EFFECT_NAME_BY_ID[effectId]);
}

// Effect ID → description of what the modifier does ('' if unknown).
function getEffectDescription(effectId) {
  return (EFFECT_DESCRIPTION_BY_ID[effectId] || '').replace(/<[^>]*>/g, '').trim();
}

// Strips the game's <i=N>…</i> highlight markup, leaving plain text.
function stripGameMarkup(text) {
  return (text || '').replace(/<[^>]*>/g, '');
}

// Resolves after the given number of milliseconds.
function waitMilliseconds(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

// ── WAR CLOCK ────────────────────────────────────────────────────────────────
// The war clock (seconds since the war began) only comes from the backup
// API's /war/status, fetched every few minutes. Extrapolating from when it was
// read keeps countdowns correct in between.

// Game-clock seconds right now, or null when the clock was never read.
function getCurrentWarTimeSeconds(nowTimestamp = Date.now()) {
  if (!apiData.currentWarTimeSeconds || !isFiniteNumber(apiData.warTimeCapturedAtTimestamp)) {
    return null;
  }
  return apiData.currentWarTimeSeconds
    + (nowTimestamp - apiData.warTimeCapturedAtTimestamp) / 1000;
}

// A game-clock time → real-world Date.now()-style timestamp, or null.
function convertWarTimeToTimestamp(warTimeSeconds, nowTimestamp = Date.now()) {
  const currentWarTime = getCurrentWarTimeSeconds(nowTimestamp);
  if (currentWarTime === null || !isFiniteNumber(warTimeSeconds)) return null;
  return nowTimestamp + (warTimeSeconds - currentWarTime) * 1000;
}

// When the current war began, from the primary /war feed or the war clock.
function getWarStartTimestamp(nowTimestamp = Date.now()) {
  const startedFromPrimary = Date.parse(apiData.warStatistics?.started || '');
  if (!isNaN(startedFromPrimary)) return startedFromPrimary;
  return convertWarTimeToTimestamp(0, nowTimestamp);
}

// ── EFFECT NAMES DATABASE ────────────────────────────────────────────────────

let effectNamesDatabaseWasDownloaded = false;

// Downloads the community ID→name/description file once per session and
// merges it into EFFECT_NAME_BY_ID / EFFECT_DESCRIPTION_BY_ID.
async function downloadEffectNamesDatabase() {
  if (effectNamesDatabaseWasDownloaded) return;
  try {
    const databaseJson = await downloadJson(EFFECT_NAMES_DATABASE_URL, {}, 0);
    for (const [effectId, entry] of Object.entries(isPlainObject(databaseJson) ? databaseJson : {})) {
      if (!isPlainObject(entry)) continue;
      if (entry.name)        EFFECT_NAME_BY_ID[Number(effectId)]        = entry.name;
      if (entry.description) EFFECT_DESCRIPTION_BY_ID[Number(effectId)] = entry.description;
    }
    effectNamesDatabaseWasDownloaded = true;
  } catch (error) {
    console.warn('Could not download effect names database:', error);
  }
}

// ── SERVER PREFERENCE ────────────────────────────────────────────────────────

const SERVER_PREFERENCE_STORAGE_KEY = 'hd2_server_preference';

// The remembered server choice, or 'auto' when nothing valid is stored.
function readServerPreference() {
  const stored = readStoredValue(SERVER_PREFERENCE_STORAGE_KEY);
  return SERVER_PREFERENCES.includes(stored) ? stored : 'auto';
}

let serverPreference = readServerPreference();

// Called by the dropdown: saves the choice and refreshes with the new source.
// A refresh already running used the old source, so queue one more after it.
function changeServerPreference(newPreference) {
  if (!SERVER_PREFERENCES.includes(newPreference)) return Promise.resolve(false);
  serverPreference = newPreference;
  writeStoredValue(SERVER_PREFERENCE_STORAGE_KEY, newPreference);
  return refreshInProgress
    ? refreshInProgress.then(() => refreshEverythingNow())
    : refreshEverythingNow();
}

// ── DOWNLOAD HELPERS ─────────────────────────────────────────────────────────

// Fetches a URL as JSON with retries and a timeout; a 429 waits out the full rate window.
async function downloadJson(url, fetchOptions = {}, retryCount = 1) {
  for (let attempt = 0; ; attempt++) {
    const abortController = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutHandle = abortController
      ? setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MILLISECONDS) : null;
    // Accept-Language is a CORS-safelisted header, so it never adds a preflight request.
    const requestOptions = { ...fetchOptions, headers: { 'Accept-Language': API_LANGUAGE, ...fetchOptions.headers } };
    try {
      const response = await fetch(url, abortController
        ? { ...requestOptions, signal: abortController.signal } : requestOptions);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      const message = error.name === 'AbortError'
        ? `timed out after ${FETCH_TIMEOUT_MILLISECONDS / 1000}s` : error.message;
      const outOfRetries = attempt >= retryCount;
      if (outOfRetries) {
        const shortUrl = url.replace(/^https?:\/\//, '').slice(0, 60);
        throw new Error(`${shortUrl}: ${message}`);
      }
      const wasRateLimited = /429/.test(message);
      await waitMilliseconds(wasRateLimited ? RATE_LIMIT_WINDOW_MILLISECONDS : 1500);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }
}

// Shorthand: download from the primary API with its required headers.
function downloadFromPrimaryApi(path) {
  return downloadJson(PRIMARY_API_URL + path, { headers: PRIMARY_API_REQUIRED_HEADERS });
}

// Feeds that failed this cycle without taking the whole source down.
let lastFeedWarnings = [];

// Notes a failed optional feed and returns null so the caller keeps going.
function recordFeedWarning(feedName, error) {
  lastFeedWarnings.push(`${feedName}: ${error.message}`);
  return null;
}

// ── DATA FETCHING ────────────────────────────────────────────────────────────

let refreshCycleCounter = 0;

const heavyFeedCache = {
  planetList:    null,
  dispatchList:  null,
  spaceStations: null,
};

// Downloads everything from api.helldivers2.dev in two rate-limit-safe waves
// (fast feeds every cycle; heavy feeds every Nth cycle, cached in between).
// onFastWaveReady runs between the waves so the page can render without
// waiting out the rate-limit window.
async function downloadEverythingFromPrimaryApi(onFastWaveReady) {
  const [assignments, campaigns, warInfo, defenseEvents] = await Promise.all([
    downloadFromPrimaryApi('/assignments').catch(error => recordFeedWarning('/assignments', error)),
    downloadFromPrimaryApi('/campaigns'),
    downloadFromPrimaryApi('/war'),
    downloadFromPrimaryApi('/planet-events').catch(error => recordFeedWarning('/planet-events', error)),
  ]);

  if (!Array.isArray(campaigns)) throw new Error('/campaigns: unexpected response shape');
  if (!isPlainObject(warInfo))    throw new Error('/war: unexpected response shape');

  const heavyFeedsAreDue =
    heavyFeedCache.planetList === null ||
    refreshCycleCounter % HEAVY_FEEDS_REFRESH_EVERY_N_CYCLES === 0;

  refreshCycleCounter++;

  apiData.warStatistics   = { ...warInfo, statistics: isPlainObject(warInfo.statistics) ? warInfo.statistics : {} };
  apiData.activeCampaigns = campaigns.map(normalizeCampaign).filter(Boolean);

  // A failed or garbled optional feed keeps the last good copy rather than
  // pretending there is no Major Order / no attack.
  if (Array.isArray(assignments)) {
    apiData.assignments = assignments.map(normalizeAssignment).filter(Boolean);
  } else if (assignments !== null) {
    recordFeedWarning('/assignments', new Error('unexpected response shape'));
  }
  if (Array.isArray(defenseEvents)) {
    apiData.defenseEvents = defenseEvents.map(normalizePlanet).filter(planet => planet && planet.event);
  } else if (defenseEvents !== null) {
    recordFeedWarning('/planet-events', new Error('unexpected response shape'));
  }

  applyHeavyFeedCacheToApiData();
  apiData.currentDataSource = 'PRIMARY';

  if (heavyFeedsAreDue) {
    if (onFastWaveReady) onFastWaveReady();

    await waitMilliseconds(RATE_LIMIT_WINDOW_MILLISECONDS);

    const [planetList, dispatchList, spaceStations] = await Promise.all([
      downloadFromPrimaryApi('/planets').catch(error => recordFeedWarning('/planets', error)),
      downloadFromPrimaryApi('/dispatches').catch(error => recordFeedWarning('/dispatches', error)),
      downloadJson(PRIMARY_API_V2_URL + '/space-stations',
                   { headers: PRIMARY_API_REQUIRED_HEADERS }, 0)
        .catch(error => recordFeedWarning('/space-stations', error)),
    ]);

    if (Array.isArray(planetList)) {
      heavyFeedCache.planetList = planetList.map(normalizePlanet).filter(Boolean);
    }
    if (Array.isArray(dispatchList)) {
      heavyFeedCache.dispatchList = dispatchList.map(normalizeDispatch).filter(Boolean);
    }
    if (Array.isArray(spaceStations)) {
      heavyFeedCache.spaceStations = spaceStations.filter(isPlainObject);
    }

    applyHeavyFeedCacheToApiData();
  }
}

// Copies the cached heavy feeds (planets, news, DSS) into apiData.
function applyHeavyFeedCacheToApiData() {
  apiData.planets        = heavyFeedCache.planetList || [];
  apiData.newsDispatches = heavyFeedCache.dispatchList || [];
  apiData.spaceStations  = heavyFeedCache.spaceStations || [];
}

// Builds a primary-shaped planet from the backup API's per-planet status
// and static info. Max health is unknown outside campaigns, so it stays null.
function buildPlanetFromBackupStatus(planetIndex, planetStatus, staticInfo, attackList) {
  const staticPlanet = isPlainObject(staticInfo) ? staticInfo : {};
  const status = isPlainObject(planetStatus) ? planetStatus : {};
  return {
    index:  planetIndex,
    name:   staticPlanet.name || `Planet #${planetIndex}`,
    sector: staticPlanet.sector || '',
    biome:  { name: staticPlanet.biome?.slug || '' },
    hazards: asArray(staticPlanet.environmentals).filter(isPlainObject).map(hazard =>
      hazard.description ? { name: hazard.name, description: hazard.description } : { name: hazard.name }),
    health:    isFiniteNumber(status.health) ? status.health : null,
    maxHealth: null,
    regenPerSecond: status.regenPerSecond || 0,
    currentOwner: FACTION_NAME_BY_ID[status.owner] || 'Unknown',
    disabled: false,
    waypoints: [],
    attacking: attackList
      .filter(attack => attack.source === planetIndex && isFiniteNumber(attack.target))
      .map(attack => attack.target),
    regions: [],
    position: isPlainObject(status.position) ? status.position : null,
    statistics: { playerCount: status.players || 0 },
    event: null,
  };
}

// Downloads everything from helldiverstrainingmanual.com and reshapes it to
// match the primary API, so the rest of the code never cares which source ran.
async function downloadEverythingFromBackupApi() {
  const [warStatus, campaignList, majorOrders, staticPlanetInfo, newsList] = await Promise.all([
    downloadJson(BACKUP_API_URL + '/war/status'),
    downloadJson(BACKUP_API_URL + '/war/campaign'),
    downloadJson(BACKUP_API_URL + '/war/major-orders').catch(error => recordFeedWarning('backup /war/major-orders', error)),
    downloadJson(BACKUP_API_URL + '/planets').catch(error => recordFeedWarning('backup /planets', error)),
    downloadJson(BACKUP_API_URL + '/war/news').catch(error => recordFeedWarning('backup /war/news', error)),
  ]);

  if (!isPlainObject(warStatus))     throw new Error('backup /war/status: unexpected response shape');
  if (!Array.isArray(campaignList))  throw new Error('backup /war/campaign: unexpected response shape');

  const fetchedAtTimestamp = Date.now();
  const warTimeSeconds = isFiniteNumber(warStatus.time) ? warStatus.time : 0;
  const staticInfoByIndex = isPlainObject(staticPlanetInfo) ? staticPlanetInfo : {};
  const planetStatusList = asArray(warStatus.planetStatus).filter(isPlainObject);
  const planetAttackList = asArray(warStatus.planetAttacks).filter(isPlainObject);

  const planetStatusByIndex = {};
  let totalPlayersOnline = 0;
  for (const planetStatus of planetStatusList) {
    planetStatusByIndex[planetStatus.index] = planetStatus;
    totalPlayersOnline += planetStatus.players || 0;
  }

  apiData.warStatistics = {
    impactMultiplier: warStatus.impactMultiplier,
    statistics: { playerCount: totalPlayersOnline },
  };

  apiData.activeCampaigns = campaignList
    .filter(backupCampaign => isPlainObject(backupCampaign) && isFiniteNumber(backupCampaign.planetIndex))
    .map((backupCampaign, listPosition) => {
    const planetIndex  = backupCampaign.planetIndex;
    const planetStatus = planetStatusByIndex[planetIndex] || {};
    const staticInfo   = isPlainObject(staticInfoByIndex[planetIndex]) ? staticInfoByIndex[planetIndex] : {};
    const isDefense    = Boolean(backupCampaign.defense);
    const basePlanet   = buildPlanetFromBackupStatus(planetIndex, planetStatus, staticInfo, planetAttackList);

    const planet = {
      ...basePlanet,
      name:   backupCampaign.name || basePlanet.name,
      biome:  { name: backupCampaign.biome?.slug || basePlanet.biome.name },
      maxHealth: isDefense ? 1000000 : (backupCampaign.maxHealth || 1000000),
      health:    isDefense ? 1000000 : (backupCampaign.health ?? 1000000),
      currentOwner: isDefense ? 'Humans' : (backupCampaign.faction || 'Unknown'),
      statistics: { playerCount: backupCampaign.players || planetStatus.players || 0 },
      event: isDefense ? {
        id: 'backup-' + planetIndex,
        eventType: 1,
        faction:   backupCampaign.faction,
        health:    backupCampaign.health,
        maxHealth: backupCampaign.maxHealth,
        endTime:   backupCampaign.expireDateTime
                     ? new Date(backupCampaign.expireDateTime * 1000).toISOString()
                     : null,
      } : null,
    };

    return {
      id: listPosition,
      planet: planet,
      type: isDefense ? 4 : 0,
      faction: backupCampaign.faction,
    };
  });

  // Every planet the backup knows about, not just the ones with a campaign,
  // so Major Order tasks and the DSS can still name their planets.
  const planetByIndex = {};
  for (const planetStatus of planetStatusList) {
    planetByIndex[planetStatus.index] = buildPlanetFromBackupStatus(
      planetStatus.index, planetStatus, staticInfoByIndex[planetStatus.index], planetAttackList);
  }
  for (const campaign of apiData.activeCampaigns) {
    planetByIndex[campaign.planet.index] = campaign.planet;
  }
  apiData.planets       = Object.values(planetByIndex);
  apiData.defenseEvents = apiData.planets.filter(planet => planetIsUnderAttack(planet));

  if (Array.isArray(majorOrders)) {
    apiData.assignments = majorOrders.filter(isPlainObject).map(backupOrder => normalizeAssignment({
      id:        backupOrder.id32,
      progress:  backupOrder.progress || [],
      title:     backupOrder.setting?.overrideTitle || 'ORDER',
      briefing:  backupOrder.setting?.overrideBrief || '',
      tasks:     backupOrder.setting?.tasks || [],
      reward:    backupOrder.setting?.reward,
      rewards:   backupOrder.setting?.rewards || [],
      expiration: backupOrder.expiresIn
                    ? new Date(fetchedAtTimestamp + backupOrder.expiresIn * 1000).toISOString()
                    : null,
    }));
  } else if (majorOrders !== null) {
    recordFeedWarning('backup /war/major-orders', new Error('unexpected response shape'));
  }

  // Backup news carries war-clock timestamps; convert them to real dates.
  apiData.newsDispatches = asArray(newsList)
    .filter(isPlainObject)
    .sort((first, second) => (second.published || 0) - (first.published || 0))
    .slice(0, 10)
    .map(newsItem => ({
      id: newsItem.id,
      message: typeof newsItem.message === 'string' ? newsItem.message : '',
      published: isFiniteNumber(newsItem.published) && warTimeSeconds > 0
        ? new Date(fetchedAtTimestamp + (newsItem.published - warTimeSeconds) * 1000).toISOString()
        : null,
    }));

  apiData.spaceStations = convertBackupSpaceStations(warStatus.spaceStations);
  apiData.currentDataSource = 'FALLBACK';
  rememberBackupWarStatus(warStatus, fetchedAtTimestamp);
}

// Backup DSS entries → the backup-flavoured station shape renderers expect.
function convertBackupSpaceStations(backupStationList) {
  return asArray(backupStationList).filter(isPlainObject).map(backupStation => ({
    cameFromBackupApi:  true,
    planetIndex:        backupStation.planetIndex,
    electionEndWarTime: backupStation.currentElectionEndWarTime,
    activeEffectIds:    asArray(backupStation.activeEffectIds),
  }));
}

let supplementalCycleCounter = 0;
let cachedBackupWarStatus = null;
let cachedBackupWarStatusTimestamp = null;

// Keeps a backup /war/status for the supplemental data (effects + war clock).
function rememberBackupWarStatus(warStatus, fetchedAtTimestamp) {
  cachedBackupWarStatus = warStatus;
  cachedBackupWarStatusTimestamp = fetchedAtTimestamp;
  applyCachedBackupWarStatus();
}

// Downloads what only the backup API and the effects database provide, when
// the primary API is the main source. Returns a fresh /war/status or null.
async function downloadSupplementalFeeds() {
  const backupStatusIsDue =
    cachedBackupWarStatus === null ||
    supplementalCycleCounter % HEAVY_FEEDS_REFRESH_EVERY_N_CYCLES === 0;

  supplementalCycleCounter++;

  const [freshBackupStatus] = await Promise.all([
    backupStatusIsDue
      ? downloadJson(BACKUP_API_URL + '/war/status', {}, 0).catch(() => null)
      : null,
    downloadEffectNamesDatabase(),
  ]);

  return isPlainObject(freshBackupStatus) ? freshBackupStatus : null;
}

// Copies effects, the war clock and (if primary has none) the DSS out of the
// cached backup /war/status into apiData.
function applyCachedBackupWarStatus() {
  if (!cachedBackupWarStatus) return;

  apiData.planetActiveEffects = asArray(cachedBackupWarStatus.planetActiveEffects)
    .filter(effect => isPlainObject(effect) && isFiniteNumber(effect.index));
  apiData.currentWarTimeSeconds = isFiniteNumber(cachedBackupWarStatus.time) ? cachedBackupWarStatus.time : 0;
  apiData.warTimeCapturedAtTimestamp = cachedBackupWarStatusTimestamp;

  const primaryDssIsMissing =
    apiData.currentDataSource === 'PRIMARY' && apiData.spaceStations.length === 0;
  if (primaryDssIsMissing) {
    apiData.spaceStations = convertBackupSpaceStations(cachedBackupWarStatus.spaceStations);
  }
}

// ── POST-PROCESSING ──────────────────────────────────────────────────────────

// The /planets feed can be minutes stale; campaigns/defense events are fresh.
// Overlays the fresh planet objects onto the stale list so new attacks never
// go missing, then rebuilds planetsByIndex and the active-battle index set.
function overlayFreshBattleDataOntoPlanetList() {
  const freshestPlanetByIndex = {};
  for (const campaign of apiData.activeCampaigns) {
    if (campaign.planet) {
      freshestPlanetByIndex[campaign.planet.index] = campaign.planet;
    }
  }
  for (const planetUnderAttack of apiData.defenseEvents) {
    freshestPlanetByIndex[planetUnderAttack.index] = planetUnderAttack;
  }

  if (apiData.planets.length > 0) {
    apiData.planets = apiData.planets.map(planet =>
      freshestPlanetByIndex[planet.index] || planet
    );
    const indexesAlreadyInList = new Set(apiData.planets.map(planet => planet.index));
    for (const freshPlanet of Object.values(freshestPlanetByIndex)) {
      if (!indexesAlreadyInList.has(freshPlanet.index)) {
        apiData.planets.push(freshPlanet);
      }
    }
  } else {
    apiData.planets = Object.values(freshestPlanetByIndex);
  }

  apiData.planetsByIndex = {};
  for (const planet of apiData.planets) {
    apiData.planetsByIndex[planet.index] = planet;
  }

  apiData.indexesOfPlanetsWithActiveBattles = new Set();
  for (const campaign of apiData.activeCampaigns) {
    if (campaign.planet) {
      apiData.indexesOfPlanetsWithActiveBattles.add(campaign.planet.index);
    }
  }
  for (const planetUnderAttack of apiData.defenseEvents) {
    apiData.indexesOfPlanetsWithActiveBattles.add(planetUnderAttack.index);
  }
}

// Everything that has to happen after fresh battle data lands.
function processFreshBattleData(nowTimestamp = Date.now()) {
  overlayFreshBattleDataOntoPlanetList();
  recordPlanetHistorySamples(nowTimestamp);
  recordMajorOrderHistory(nowTimestamp);
  rememberKnownBiomes();
}

// ── PLANET HISTORY (for trends) ──────────────────────────────────────────────

// Loads remembered planet samples, dropping anything too old to matter.
function loadPlanetHistory(nowTimestamp) {
  const stored = readStoredValue(PLANET_HISTORY_STORAGE_KEY);
  if (!stored) return {};
  try {
    const parsed = JSON.parse(stored);
    return prunePlanetHistory(isPlainObject(parsed) ? parsed : {}, nowTimestamp);
  } catch {
    return {};
  }
}

// Keeps only well-formed samples younger than the history age limit.
function prunePlanetHistory(historyByIndex, nowTimestamp) {
  const prunedHistory = {};
  for (const [planetIndex, samples] of Object.entries(historyByIndex || {})) {
    const recentSamples = asArray(samples).filter(sample =>
      isPlainObject(sample) && isFiniteNumber(sample.timestamp) &&
      nowTimestamp - sample.timestamp <= PLANET_HISTORY_MAX_AGE_MILLISECONDS &&
      sample.timestamp <= nowTimestamp);
    if (recentSamples.length > 0) prunedHistory[planetIndex] = recentSamples;
  }
  return prunedHistory;
}

// One snapshot of a battle planet's progress, small enough to store.
function buildPlanetSample(planet, timestamp) {
  const isDefense = planetIsUnderAttack(planet);
  return {
    timestamp,
    liberationPercent: hasKnownHealth(planet) ? getLiberationPercent(planet) : null,
    defensePercent:    isDefense ? getDefenseProgressPercent(planet.event) : null,
    eventId:           isDefense ? String(planet.event.id) : null,
    maxHealth:         isDefense ? (planet.event.maxHealth ?? null) : (planet.maxHealth ?? null),
    playerCount:       planet.statistics?.playerCount ?? null,
    source:            getHistorySourceName(),
  };
}

// Which API the page's numbers come from, as the history names it. Samples from the two APIs
// never share a series: they have disagreed about a planet's progress, and a rate measured
// across both would be nonsense (a 16-point gap read 30 minutes apart is "+32 %/h").
function getHistorySourceName() {
  return apiData.currentDataSource === 'FALLBACK' ? 'BACKUP' : 'PRIMARY';
}

// Appends a sample for every planet in battle. A new defense event, a changed max health or
// a switch to the other API means a different series, so it starts over.
function recordPlanetHistorySamples(nowTimestamp) {
  const previousHistory = prunePlanetHistory(apiData.planetHistoryByIndex, nowTimestamp);
  const nextHistory = {};

  for (const planetIndex of apiData.indexesOfPlanetsWithActiveBattles) {
    const planet = apiData.planetsByIndex[planetIndex];
    if (!planet) continue;

    const newSample = buildPlanetSample(planet, nowTimestamp);
    let samples = previousHistory[planetIndex] || [];
    const lastSample = samples[samples.length - 1];

    if (lastSample && (lastSample.eventId !== newSample.eventId ||
                       lastSample.maxHealth !== newSample.maxHealth ||
                       (lastSample.source ?? 'PRIMARY') !== newSample.source)) {
      samples = [];
    } else if (lastSample && nowTimestamp - lastSample.timestamp < SAMPLE_MERGE_WINDOW_MILLISECONDS) {
      samples = samples.slice(0, -1);
    }
    nextHistory[planetIndex] = [...samples, newSample];
  }

  apiData.planetHistoryByIndex = nextHistory;
  writeStoredValue(PLANET_HISTORY_STORAGE_KEY, JSON.stringify(nextHistory));
}

// ── SHARED WAR HISTORY ───────────────────────────────────────────────────────
// The public repository records the war every 15 minutes (tools/collect-history.mjs) into
// history.json on its war-history branch. The page reads it at start and every 10 minutes, keeps
// it in memory only, and merges it with its own samples, so trends and graphs start with hours
// of history instead of minutes. Offline, a broken file or any other failure quietly leaves the
// page on its own samples, as before.

const SHARED_HISTORY_URL = 'https://raw.githubusercontent.com/MrHamster112/DropIntel/war-history/history.json';
const SHARED_HISTORY_REFRESH_MILLISECONDS = 10 * 60 * 1000;
const SHARED_HISTORY_VERSION = 1;

let sharedHistoryDownload = null;
let nextSharedHistoryDueTimestamp = 0;

// One collector segment → the page's own sample shape, oldest first. Health becomes the same
// liberation or defense % the page computes; anything unreadable is dropped.
function convertSharedSegment(rawSegment) {
  const isDefense = rawSegment.kind === 'defense';
  const maxHealth = isFiniteNumber(rawSegment.maxHealth) && rawSegment.maxHealth > 0 ? rawSegment.maxHealth : null;
  const eventId = isDefense && rawSegment.eventId !== null && rawSegment.eventId !== undefined ? String(rawSegment.eventId) : null;
  const samples = maxHealth === null ? [] : asArray(rawSegment.samples)
    .filter(sample => Array.isArray(sample) && isFiniteNumber(sample[0]) && isFiniteNumber(sample[1]))
    .map(([time, health, playerCount]) => {
      const percent = Math.max(0, Math.min(100, (1 - health / maxHealth) * 100));
      return {
        timestamp: time * 1000,
        liberationPercent: isDefense ? null : percent,
        defensePercent: isDefense ? percent : null,
        eventId,
        maxHealth,
        playerCount: isFiniteNumber(playerCount) ? playerCount : null,
        source: rawSegment.source === 'BACKUP' ? 'BACKUP' : 'PRIMARY',
      };
    })
    .sort((first, second) => first.timestamp - second.timestamp);
  return {
    // segments from before the collector recorded its source were all read from the primary API
    source: rawSegment.source === 'BACKUP' ? 'BACKUP' : 'PRIMARY',
    kind: isDefense ? 'defense' : 'liberation',
    owner: typeof rawSegment.owner === 'string' ? rawSegment.owner : null,
    eventId,
    maxHealth,
    samples,
  };
}

// The collector's history.json → { updatedAtTimestamp, planetsByIndex, frontSamples,
// majorOrderSamples, events }, or null when it isn't a history file this page understands.
function convertSharedHistory(rawHistory) {
  if (!isPlainObject(rawHistory) || rawHistory.version !== SHARED_HISTORY_VERSION) return null;
  if (!isFiniteNumber(rawHistory.updatedAt) || !isPlainObject(rawHistory.planets)) return null;

  const planetsByIndex = {};
  for (const [planetIndex, rawPlanet] of Object.entries(rawHistory.planets)) {
    const segments = asArray(rawPlanet?.segments).filter(isPlainObject).map(convertSharedSegment)
      .filter(segment => segment.samples.length > 0);
    if (segments.length > 0) planetsByIndex[planetIndex] = { name: String(rawPlanet.name || ''), segments };
  }

  // fronts: [time, allPlayers, <one column per enemy>], named by fields.fronts
  const frontFields = asArray(rawHistory.fields?.fronts);
  const frontColumns = FRONT_ORDER.map(factionKey => ({
    factionKey, position: frontFields.findIndex(field => normalizeFactionName(String(field)) === factionKey),
  })).filter(column => column.position > 0);
  const frontSamples = asArray(rawHistory.fronts)
    .filter(sample => Array.isArray(sample) && isFiniteNumber(sample[0]))
    .map(sample => ({
      timestamp: sample[0] * 1000,
      playersByFaction: Object.fromEntries(frontColumns
        .filter(column => isFiniteNumber(sample[column.position]))
        .map(column => [column.factionKey, sample[column.position]])),
    }))
    .sort((first, second) => first.timestamp - second.timestamp);

  const majorOrderSamples = [];
  for (const [assignmentId, rawOrder] of Object.entries(isPlainObject(rawHistory.orders) ? rawHistory.orders : {})) {
    for (const sample of asArray(rawOrder?.samples)) {
      if (!Array.isArray(sample) || !isFiniteNumber(sample[0])) continue;
      majorOrderSamples.push({ timestamp: sample[0] * 1000, assignmentId,
        progress: sample.slice(1).map(value => (isFiniteNumber(value) ? value : null)) });
    }
  }
  majorOrderSamples.sort((first, second) => first.timestamp - second.timestamp);

  return {
    updatedAtTimestamp: rawHistory.updatedAt * 1000,
    planetsByIndex,
    frontSamples,
    majorOrderSamples,
    events: asArray(rawHistory.events).filter(event => isPlainObject(event) && isFiniteNumber(event.time)),
  };
}

// Downloads the shared history (single-flight) and re-renders. Never throws: a failure keeps
// the last good copy, or none, and the page carries on with its own samples.
function refreshSharedHistory(nowTimestamp = Date.now()) {
  if (sharedHistoryDownload) return sharedHistoryDownload;
  nextSharedHistoryDueTimestamp = nowTimestamp + SHARED_HISTORY_REFRESH_MILLISECONDS;
  sharedHistoryDownload = downloadJson(SHARED_HISTORY_URL, { cache: 'no-cache' }, 0)
    .then(rawHistory => convertSharedHistory(rawHistory))
    .catch(() => null)
    .then(converted => {
      if (converted) apiData.sharedHistory = converted;
      apiData.sharedHistoryStatus = apiData.sharedHistory ? 'loaded' : 'unavailable';
      renderEverything();
    })
    .finally(() => { sharedHistoryDownload = null; });
  return sharedHistoryDownload;
}

// Refreshes the shared history once its 10 minutes are up (wall clock, like the war feeds).
function refreshSharedHistoryWhenDue(nowTimestamp = Date.now()) {
  if (nowTimestamp >= nextSharedHistoryDueTimestamp) refreshSharedHistory(nowTimestamp);
}

// The shared segment for a planet's current fight: its last segment, when that was read from
// the same API as the page's numbers and is the same kind of fight with the same maximum health
// (and owner, or defense event). Anything else is left out.
function findSharedSegmentForPlanet(planet) {
  const segments = apiData.sharedHistory?.planetsByIndex[planet.index]?.segments;
  const segment = segments ? segments[segments.length - 1] : null;
  if (!segment || segment.source !== getHistorySourceName()) return null;
  if (planetIsUnderAttack(planet)) {
    const eventId = String(planet.event.id);
    // the backup API has no event ids (the page makes one up), so there the maximum health decides
    const sameEvent = segment.eventId === eventId || eventId.startsWith('backup-');
    return segment.kind === 'defense' && sameEvent && segment.maxHealth === (planet.event.maxHealth ?? null) ? segment : null;
  }
  const sameOwner = normalizeFactionName(segment.owner) === normalizeFactionName(planet.currentOwner);
  return segment.kind === 'liberation' && sameOwner && segment.maxHealth === planet.maxHealth ? segment : null;
}

// Joins shared samples with the page's own: the shared ones up to where the page's begin,
// so the two sources never interleave.
function mergeSampleLists(sharedSamples, ownSamples) {
  const ownList = asArray(ownSamples);
  const firstOwnTimestamp = ownList.length > 0 ? ownList[0].timestamp : Infinity;
  return [...asArray(sharedSamples).filter(sample => sample.timestamp < firstOwnTimestamp), ...ownList];
}

// A planet's samples for its current fight, shared history first, oldest first.
function getPlanetSamples(planet) {
  return mergeSampleLists(findSharedSegmentForPlanet(planet)?.samples, apiData.planetHistoryByIndex[planet.index]);
}

// "History: shared, updated 7 min ago" or "History: this browser only".
function describeHistorySource(nowTimestamp = Date.now()) {
  if (apiData.sharedHistoryStatus !== 'loaded' || !apiData.sharedHistory) return 'History: this browser only';
  return `History: shared, updated ${formatTimeAgo(apiData.sharedHistory.updatedAtTimestamp, nowTimestamp)}`;
}

// ── BIOME NAMES AND FACTION ICONS ────────────────────────────────────────────
// The two APIs name biomes differently: primary sends display names ("Desert
// Cliffs"), backup sends slugs ("desert", "jungle"). Some slugs cover several
// biomes, so the best clue in fallback mode is the name the primary API gave
// the same planet earlier, remembered here by planet index.


// Loads the remembered planet index → primary biome name table.
function loadKnownBiomes() {
  try {
    const parsed = JSON.parse(readStoredValue(KNOWN_BIOMES_STORAGE_KEY) || '{}');
    const knownBiomes = {};
    for (const [planetIndex, biomeName] of Object.entries(isPlainObject(parsed) ? parsed : {})) {
      if (typeof biomeName === 'string' && biomeName) knownBiomes[planetIndex] = biomeName;
    }
    return knownBiomes;
  } catch {
    return {};
  }
}

// Learns each planet's biome display name while the primary API is the source.
function rememberKnownBiomes() {
  if (apiData.currentDataSource !== 'PRIMARY') return;
  let somethingChanged = false;
  for (const planet of apiData.planets) {
    const biomeName = planet.biome?.name;
    if (typeof biomeName === 'string' && biomeName &&
        apiData.knownBiomeNameByPlanetIndex[planet.index] !== biomeName) {
      apiData.knownBiomeNameByPlanetIndex[planet.index] = biomeName;
      somethingChanged = true;
    }
  }
  if (somethingChanged) {
    writeStoredValue(KNOWN_BIOMES_STORAGE_KEY, JSON.stringify(apiData.knownBiomeNameByPlanetIndex));
  }
}

// Lowercase letters and digits only: "Desert Cliffs", "desert-cliffs" → "desertcliffs".
function normalizeBiomeKey(biomeName) {
  return String(biomeName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// True for a display name from the primary API ("Moon"), false for a backup slug
// ("moon"). Some slugs are spelled like display names, so the case matters.
function isBiomeDisplayName(biomeName) {
  return typeof biomeName === 'string' && /[A-Z ]/.test(biomeName);
}

// A readable biome name for labels and alt text. A backup slug ("desolate")
// becomes the biome it stands for ("Scorched Moor").
function getBiomeDisplayName(planet) {
  const learnedBiomeName = apiData.knownBiomeNameByPlanetIndex[planet.index];
  if (learnedBiomeName) return learnedBiomeName;
  const biomeName = planet.biome?.name;
  if (isBiomeDisplayName(biomeName)) return biomeName;
  const biomeKey = normalizeBiomeKey(biomeName);
  if (!biomeKey || BIOME_ID_BY_NAME[biomeKey] || BIOME_ID_BY_BACKUP_SLUG[biomeKey]) {
    return BIOME_DISPLAY_NAMES[resolveBiomeId(biomeName, planet.index)];
  }
  const spaced = String(biomeName).replace(/[-_]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ── BIOME ART ────────────────────────────────────────────────────────────────
// Planet cards get a landscape the page draws itself, instead of pictures from
// the game (those belong to Arrowhead and Sony). Every biome has its own
// painter, written from the Helldivers Wiki's description of that biome: which
// trees grow there (pines, broadleaf trees, tropical jungle trees, gnarled swamp
// trees, charred or dead trees, palms, or none at all), the ground, the sky and
// the landmarks. A planet's weather hazards (rain, fog, blizzards, ion storms,
// fire tornadoes, meteors…) are drawn on top, so planets that share a biome
// still look like themselves. The same planet always gets the same picture.
// The colours are illustration data, so they live here rather than in style.css.

const BIOME_ART_WIDTH = 460;
const BIOME_ART_HEIGHT = 148;

// Every biome the page can draw, with the name shown when the feed only sent a
// slug: the primary API's own name, so a label reads the same from either source.
const BIOME_DISPLAY_NAMES = {
  'super-earth': 'Super Earth', cyberstan: 'Cyberstan Megafactory', 'black-hole': 'Black Hole',
  shattered: 'Shattered planet', 'hive-world': 'Hive World', supercolony: 'Supercolony',
  'volcanic-jungle': 'Volcanic Jungle', 'ionic-jungle': 'Ionic Jungle', 'ethereal-jungle': 'Ethereal Jungle',
  deadlands: 'Deadlands', 'scorched-moor': 'Scorched Moor', 'ionic-crimson': 'Ionic Crimson',
  tundra: 'Tundra', plains: 'Plains', 'icy-glaciers': 'Icy Glaciers', boneyard: 'Boneyard',
  'tien-kwan': 'Tien Kwan Special', magma: 'Magma', 'deciduous-forest': 'Deciduous Forest',
  'autumn-forest': 'Deciduous Autumn Forest', 'crimson-forest': 'Deciduous Crimson Forest', moon: 'Moon',
  'basic-swamp': 'Basic Swamp', 'haunted-swamp': 'Haunted Swamp', 'desert-dunes': 'Desert Dunes',
  'desert-cliffs': 'Desert Cliffs', 'rocky-canyons': 'Rocky Canyons', 'acidic-badlands': 'Acidic Badlands',
  'desert-oasis': 'Desert Oasis', 'bleak-oasis': 'Bleak Oasis', unknown: 'Unknown biome',
};

// Biome names (normalized) → biome. The primary API's names, plus the names
// the wiki uses for the same biomes.
const BIOME_ID_BY_NAME = {
  superearth: 'super-earth', superearthmetropolis: 'super-earth', metropolis: 'super-earth', colonies: 'super-earth',
  cyberstanmegafactory: 'cyberstan', automatonmegafactory: 'cyberstan', blackhole: 'black-hole',
  hiveworld: 'hive-world', supercolony: 'supercolony', volcanicjungle: 'volcanic-jungle',
  ionicjungle: 'ionic-jungle', etherealjungle: 'ethereal-jungle', deadlands: 'deadlands',
  scorchedmoor: 'scorched-moor', ioniccrimson: 'ionic-crimson', tundra: 'tundra', plains: 'plains',
  icyglaciers: 'icy-glaciers', boneyard: 'boneyard', tienkwanspecial: 'tien-kwan', magma: 'magma',
  magmadesert: 'magma', deciduousforest: 'deciduous-forest', deciduousautumnforest: 'autumn-forest',
  westfallforest: 'autumn-forest', autumnforest: 'autumn-forest', deciduouscrimsonforest: 'crimson-forest',
  moon: 'moon', basicswamp: 'basic-swamp', hauntedswamp: 'haunted-swamp', desertdunes: 'desert-dunes',
  desertcliffs: 'desert-cliffs', rockycanyons: 'rocky-canyons', acidicbadlands: 'acidic-badlands',
  desertoasis: 'desert-oasis', bleakoasis: 'bleak-oasis', accessdenied: 'unknown', unknown: 'unknown',
};

// Backup-API biome slugs → biome. Each slug's planets were matched to a biome
// by their biome description in the captured /planets feed; every slug covers
// exactly one biome ("swamp" is the Deadlands, "desolate" the Scorched Moor).
const BIOME_ID_BY_BACKUP_SLUG = {
  autumn: 'autumn-forest', blackhole: 'black-hole', canyon: 'rocky-canyons', crimsonmoor: 'ionic-crimson',
  desert: 'desert-cliffs', desolate: 'scorched-moor', ethereal: 'ethereal-jungle', highlands: 'plains',
  icemoss: 'boneyard', icemossspecial: 'tien-kwan', jungle: 'volcanic-jungle', lush: 'deciduous-forest',
  magma: 'magma', mesa: 'desert-dunes', moon: 'moon', morass: 'haunted-swamp', rainforest: 'ionic-jungle',
  shattered: 'shattered', superearth: 'super-earth', swamp: 'deadlands', toxic: 'acidic-badlands',
  tundra: 'tundra', undergrowth: 'basic-swamp', winter: 'icy-glaciers',
};

// Planets whose biome changed after the backup API recorded it, or that it has
// no biome for: the biome the primary API (or, for Khandark, the wiki) shows
// now. Used only when no primary name is known for the planet.
const CURRENT_BIOME_BY_PLANET_INDEX = {
  9: 'basic-swamp', 10: 'tundra', 21: 'ethereal-jungle', 26: 'haunted-swamp', 29: 'tundra', 36: 'haunted-swamp',
  37: 'tundra', 178: 'basic-swamp', 187: 'haunted-swamp', 205: 'haunted-swamp', 259: 'hive-world',
};

// For a biome name the page has never seen: a word in it picks a look-alike.
const BIOME_KEYWORD_GUESSES = [
  ['glacier', 'icy-glaciers'], ['snow', 'icy-glaciers'], ['frost', 'icy-glaciers'], ['arctic', 'icy-glaciers'],
  ['magma', 'magma'], ['lava', 'magma'], ['haunted', 'haunted-swamp'], ['swamp', 'basic-swamp'],
  ['marsh', 'basic-swamp'], ['jungle', 'volcanic-jungle'], ['forest', 'deciduous-forest'], ['wood', 'deciduous-forest'],
  ['oasis', 'desert-oasis'], ['dune', 'desert-dunes'], ['canyon', 'rocky-canyons'], ['desert', 'desert-cliffs'],
  ['moor', 'plains'], ['plain', 'plains'], ['moon', 'moon'], ['hive', 'hive-world'], ['city', 'super-earth'],
  ['factory', 'cyberstan'],
];

// Weather hazards (normalized) → what gets drawn over the landscape.
const WEATHER_BY_HAZARD = {
  rainstorms: 'rain', thickfog: 'fog', blizzards: 'snow', ionstorms: 'ion', firetornadoes: 'fire-tornado',
  meteorstorms: 'meteors', sandstorms: 'sandstorm', acidstorms: 'acid', volcanicactivity: 'embers',
  intenseheat: 'heat', durialintenseheat: 'heat', extremecold: 'frost', nocturnalextremecold: 'frost',
};

let biomeArtCounter = 0;   // gradient ids must be unique on the page

// True when the feed's biome for a planet is the out-of-date slug the backup
// API recorded before the planet changed (Haldus was a moon, now it is a swamp).
function hasOutdatedBackupBiome(biomeName, planetIndex) {
  if (planetIndex === null || !CURRENT_BIOME_BY_PLANET_INDEX[planetIndex]) return false;
  if (BIOME_ID_BY_NAME[normalizeBiomeKey(apiData.knownBiomeNameByPlanetIndex[planetIndex])]) return false;
  if (isBiomeDisplayName(biomeName)) return false;
  const biomeKey = normalizeBiomeKey(biomeName);
  return !biomeKey || Boolean(BIOME_ID_BY_BACKUP_SLUG[biomeKey]);
}

// A biome name or slug (and the planet it belongs to) → the biome to draw.
// The name the primary API gave the planet wins, then a display name sent now,
// then a backup slug (corrected for planets whose biome has changed since),
// then a guess from the words in the name.
function resolveBiomeId(biomeName, planetIndex = null) {
  const learnedBiomeName = planetIndex !== null ? apiData.knownBiomeNameByPlanetIndex[planetIndex] : null;
  const learnedBiome = BIOME_ID_BY_NAME[normalizeBiomeKey(learnedBiomeName)];
  if (learnedBiome) return learnedBiome;
  const biomeKey = normalizeBiomeKey(biomeName);
  if (isBiomeDisplayName(biomeName) && BIOME_ID_BY_NAME[biomeKey]) return BIOME_ID_BY_NAME[biomeKey];
  if (hasOutdatedBackupBiome(biomeName, planetIndex)) return CURRENT_BIOME_BY_PLANET_INDEX[planetIndex];
  const knownBiome = BIOME_ID_BY_BACKUP_SLUG[biomeKey] || BIOME_ID_BY_NAME[biomeKey];
  if (knownBiome) return knownBiome;
  if (!biomeKey) return 'unknown';
  const guess = BIOME_KEYWORD_GUESSES.find(([keyword]) => biomeKey.includes(keyword));
  return guess ? guess[1] : 'plains';
}

// A planet's hazards → the weather to draw ('rain', 'fog', 'snow'…), without repeats.
function getWeatherFromHazards(hazards) {
  const weather = asArray(hazards)
    .map(hazard => WEATHER_BY_HAZARD[normalizeBiomeKey(isPlainObject(hazard) ? hazard.name : hazard)])
    .filter(Boolean);
  return [...new Set(weather)];
}

// What to draw for a planet: its biome and its weather. An out-of-date backup
// biome comes with that old biome's hazards (blizzards on what is now a swamp),
// so they stay out of the picture.
function getBiomeArtRecipe(biomeName, planetIndex = null, hazards = []) {
  const weather = hasOutdatedBackupBiome(biomeName, planetIndex) ? [] : getWeatherFromHazards(hazards);
  return { biome: resolveBiomeId(biomeName, planetIndex), weather };
}

// A 32-bit hash of a string (FNV-1a), to seed a planet's picture.
function hashText(text) {
  let hash = 2166136261;
  for (const character of String(text)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// A small seeded random number generator (mulberry32): same seed, same numbers.
function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// A number between low and high from the seeded generator.
function randomBetween(random, low, high) {
  return low + random() * (high - low);
}

// One decimal place is plenty for a 460×148 picture and keeps the markup small.
function roundForSvg(value) {
  return Math.round(value * 10) / 10;
}

// Mixes two #rrggbb colours; amount 0 gives the first, 1 the second. Used to fade
// distant things into the haze.
function mixColours(firstColour, secondColour, amount) {
  const channels = colour => [1, 3, 5].map(offset => parseInt(colour.slice(offset, offset + 2), 16));
  const first = channels(firstColour);
  const second = channels(secondColour);
  return `#${first.map((channel, position) =>
    Math.round(channel + (second[position] - channel) * amount).toString(16).padStart(2, '0')).join('')}`;
}

// Path commands for a smooth curve through points (quadratic curves between
// midpoints). The path must already stand at the first point.
function smoothCurveThrough(points) {
  let commands = '';
  for (let point = 1; point < points.length - 1; point++) {
    const [x, y] = points[point];
    const [nextX, nextY] = points[point + 1];
    commands += ` Q${roundForSvg(x)},${roundForSvg(y)} ${roundForSvg((x + nextX) / 2)},${roundForSvg((y + nextY) / 2)}`;
  }
  const [lastX, lastY] = points[points.length - 1];
  return `${commands} L${roundForSvg(lastX)},${roundForSvg(lastY)}`;
}

// A closed shape between two smooth edges, both listed in the same direction.
function buildRibbonPath(firstEdge, secondEdge) {
  const backEdge = [...secondEdge].reverse();
  return `M${roundForSvg(firstEdge[0][0])},${roundForSvg(firstEdge[0][1])}${smoothCurveThrough(firstEdge)}` +
    ` L${roundForSvg(backEdge[0][0])},${roundForSvg(backEdge[0][1])}${smoothCurveThrough(backEdge)} Z`;
}

// A drawing in progress: its shapes, gradient definitions, the planet's random
// numbers, and the top edge of every layer of land drawn so far (landTops), so
// that later things can stand on it.
function createArtCanvas(random, idPrefix) {
  const canvas = {
    random, idPrefix, shapes: [], definitions: [], gradientCount: 0, landTops: [],
    between: (low, high) => randomBetween(random, low, high),
    chance: probability => random() < probability,
    pick: list => list[Math.floor(random() * list.length)],
    add: (...nodes) => { for (const node of nodes) if (node) canvas.shapes.push(node); },
  };
  return canvas;
}

// The highest point of the land drawn so far at x, or -Infinity before any land.
function landTopAt(canvas, x) {
  if (!canvas.landTops.length) return -Infinity;
  return Math.min(...canvas.landTops.map(heightAt => heightAt(x)));
}

// Registers a vertical (or radial) gradient and returns its url(#…) fill.
// Stops are [offset, colour, opacity?].
function addArtGradient(canvas, stops, radial = false) {
  const gradientId = `${canvas.idPrefix}-g${++canvas.gradientCount}`;
  const stopElements = stops.map(([offset, colour, opacity = 1]) =>
    createSvgElement('stop', { offset, 'stop-color': colour, 'stop-opacity': opacity }));
  canvas.definitions.push(radial
    ? createSvgElement('radialGradient', { id: gradientId }, stopElements)
    : createSvgElement('linearGradient', { id: gradientId, x1: 0, y1: 0, x2: 0, y2: 1 }, stopElements));
  return `url(#${gradientId})`;
}

// A named group of shapes; the class says what it is (and lets tests find it).
function artGroup(kind, children) {
  return createSvgElement('g', { class: `art-${kind}` }, children);
}

// Positions for scattered things, far (small, high up) to near (big, low down),
// in drawing order so nearer things cover farther ones. depth runs 0…1. A spot
// above the land drawn so far moves down onto it, so nothing stands on thin air.
function scatterByDepth(canvas, count, { minY, maxY, minX = -10, maxX = BIOME_ART_WIDTH + 10 }) {
  const positions = [];
  for (let item = 0; item < count; item++) {
    const x = canvas.between(minX, maxX);
    const y = Math.max(canvas.between(minY, maxY), landTopAt(canvas, x) + 1);
    positions.push({ x, y, depth: maxY > minY ? Math.min(1, (y - minY) / (maxY - minY)) : 1 });
  }
  return positions.sort((first, second) => first.y - second.y);
}

// ── Sky and light ──

// The sky: a vertical gradient through the given colours.
function paintSky(canvas, colours) {
  const fill = addArtGradient(canvas, colours.map((colour, position) => [`${Math.round(position / (colours.length - 1) * 100)}%`, colour]));
  canvas.add(createSvgElement('rect', { class: 'art-sky', width: BIOME_ART_WIDTH, height: BIOME_ART_HEIGHT, fill }));
}

// A sun (or pale moon) with a soft glow around it.
function paintSun(canvas, { colour, glow = colour, x = canvas.between(40, 420), y = canvas.between(20, 46), radius = canvas.between(8, 14) }) {
  canvas.add(artGroup('sun', [
    createSvgElement('circle', { cx: roundForSvg(x), cy: roundForSvg(y), r: roundForSvg(radius * 3), fill: addArtGradient(canvas, [['0%', glow, 0.45], ['100%', glow, 0]], true) }),
    createSvgElement('circle', { cx: roundForSvg(x), cy: roundForSvg(y), r: roundForSvg(radius), fill: colour }),
  ]));
}

// A huge sun eclipsed by a dark disc with a pinhole of light (the Bleak Oasis sky).
function paintEclipsedSun(canvas, { ring, glow }) {
  const x = canvas.between(150, 310);
  const y = canvas.between(36, 50);
  canvas.add(artGroup('eclipsed-sun', [
    createSvgElement('circle', { cx: roundForSvg(x), cy: roundForSvg(y), r: 70, fill: addArtGradient(canvas, [['0%', glow, 0.55], ['100%', glow, 0]], true) }),
    createSvgElement('circle', { cx: roundForSvg(x), cy: roundForSvg(y), r: 30, fill: '#1f1f22', stroke: ring, 'stroke-width': 2.5 }),
    createSvgElement('circle', { cx: roundForSvg(x), cy: roundForSvg(y), r: 1.6, fill: ring }),
  ]));
}

// Stars as one path of dots, with a few brighter ones.
function paintStars(canvas, { count = 30, colour = '#ffffff', maxY = 90 } = {}) {
  let dots = '';
  for (let star = 0; star < count; star++) dots += `M${roundForSvg(canvas.between(0, BIOME_ART_WIDTH))},${roundForSvg(canvas.between(0, maxY))}h0.1`;
  canvas.add(artGroup('stars', [
    createSvgElement('path', { d: dots, stroke: colour, 'stroke-width': 1.3, 'stroke-linecap': 'round', opacity: 0.8 }),
  ]));
}

// Soft clouds made of overlapping ellipses.
function paintClouds(canvas, { colour, count = 3, minY = 10, maxY = 45, opacity = 0.5 }) {
  const puffs = [];
  for (let cloud = 0; cloud < count; cloud++) {
    const x = canvas.between(-20, BIOME_ART_WIDTH);
    const y = canvas.between(minY, maxY);
    const width = canvas.between(40, 90);
    for (let puff = 0; puff < 4; puff++) {
      puffs.push(createSvgElement('ellipse', { cx: roundForSvg(x + puff * width / 4), cy: roundForSvg(y - (puff % 2) * 3),
        rx: roundForSvg(width / 3.2), ry: roundForSvg(canvas.between(4, 8)), fill: colour }));
    }
  }
  canvas.add(createSvgElement('g', { class: 'art-clouds', opacity }, puffs));
}

// Small birds far off (the Volcanic Jungle's four-winged flocks).
function paintBirds(canvas, { colour, count = 5 }) {
  const flockX = canvas.between(60, 380);
  const flockY = canvas.between(18, 40);
  let wings = '';
  for (let bird = 0; bird < count; bird++) {
    const x = flockX + canvas.between(-30, 30);
    const y = flockY + canvas.between(-8, 8);
    const span = canvas.between(2, 3.5);
    wings += `M${roundForSvg(x - span)},${roundForSvg(y - 1)}q${roundForSvg(span / 2)},1.5 ${roundForSvg(span)},1q${roundForSvg(span / 2)},-0.5 ${roundForSvg(span)},-1`;
  }
  canvas.add(artGroup('birds', [createSvgElement('path', { d: wings, stroke: colour, 'stroke-width': 0.9, fill: 'none', opacity: 0.8 })]));
}

// Northern lights: curtains of light hanging from wavy lines, fading upwards.
function paintAurora(canvas, colours) {
  const curtains = colours.map((colour, band) => {
    const bottom = 34 + band * 9 + canvas.between(-3, 3);
    const height = canvas.between(14, 24);
    const lowerEdge = [];
    for (let x = -20; x <= BIOME_ART_WIDTH + 20; x += 40) lowerEdge.push([x, bottom + canvas.between(-9, 9)]);
    const upperEdge = lowerEdge.map(([x, y]) => [x + canvas.between(-6, 6), y - height * canvas.between(0.7, 1.2)]);
    return createSvgElement('path', { d: buildRibbonPath(lowerEdge, upperEdge),
      fill: addArtGradient(canvas, [['0%', colour, 0], ['75%', colour, 0.22], ['100%', colour, 0.45]]) });
  });
  canvas.add(artGroup('aurora', curtains));
}

// A big planet hanging in the sky, lit from one side.
function paintSkyPlanet(canvas, { colour, shade }) {
  const x = canvas.between(60, 400);
  const y = canvas.between(24, 40);
  const radius = canvas.between(14, 22);
  canvas.add(artGroup('sky-planet', [
    createSvgElement('circle', { cx: roundForSvg(x), cy: roundForSvg(y), r: roundForSvg(radius), fill: colour }),
    createSvgElement('circle', { cx: roundForSvg(x + radius * 0.35), cy: roundForSvg(y - radius * 0.15), r: roundForSvg(radius * 0.95), fill: shade, opacity: 0.85 }),
  ]));
}

// ── Land ──

// A rolling ridge: the outline of a band of hills closed along the bottom edge,
// and the height of its crest at any x. Jaggedness adds rough peaks; flatTops
// makes stepped mesas.
function buildRidge(random, { baseY, amplitude, jaggedness = 0, flatTops = false }) {
  const waves = [1, 2, 3].map(() => ({ frequency: randomBetween(random, 0.006, 0.03), phase: randomBetween(random, 0, Math.PI * 2) }));
  const heights = [];
  for (let x = 0; x <= BIOME_ART_WIDTH; x += 10) {
    let offset = waves.reduce((total, wave) => total + Math.sin(x * wave.frequency + wave.phase), 0) / waves.length;
    offset += jaggedness * (random() - 0.5);
    let y = baseY - offset * amplitude;
    if (flatTops) y = Math.round(y / 14) * 14;
    heights.push(roundForSvg(Math.max(4, Math.min(BIOME_ART_HEIGHT, y))));
  }
  const points = heights.map((y, step) => `${step * 10},${y}`);
  return {
    path: `M0,${BIOME_ART_HEIGHT} L${points.join(' L')} L${BIOME_ART_WIDTH},${BIOME_ART_HEIGHT} Z`,
    heightAt: x => {
      const position = Math.max(0, Math.min(heights.length - 1, x / 10));
      const left = Math.floor(position);
      const right = Math.min(heights.length - 1, left + 1);
      return heights[left] + (heights[right] - heights[left]) * (position - left);
    },
  };
}

// A band of hills in one colour, reaching down to the bottom edge. Returns the
// height of its crest at any x; things painted after it can stand on it.
function paintHills(canvas, colour, shape, kind = 'hills') {
  const ridge = buildRidge(canvas.random, shape);
  canvas.landTops.push(ridge.heightAt);
  canvas.add(createSvgElement('path', { class: `art-${kind}`, d: ridge.path, fill: colour }));
  return ridge.heightAt;
}

// Where the line from one point through another meets the bottom edge. Slopes
// are carried on down this way, so a mountain never ends in mid-air above
// lower land; the land in front hides the rest.
function continueToBottom([fromX, fromY], [throughX, throughY]) {
  const run = (throughX - fromX) / Math.max(0.01, throughY - fromY);
  return [throughX + run * (BIOME_ART_HEIGHT - throughY), BIOME_ART_HEIGHT];
}

// The point a share of the way from one point to another.
function pointAlong([fromX, fromY], [toX, toY], share) {
  return [fromX + (toX - fromX) * share, fromY + (toY - fromY) * share];
}

// A closed outline through the given points.
function buildOutlinePath(points) {
  return `M${points.map(([x, y]) => `${roundForSvg(x)},${roundForSvg(y)}`).join(' L')} Z`;
}

// A mountain range of separate peaks, each with a sunlit and a shaded face,
// optionally snow-capped. Their slopes run on to the bottom edge.
function paintPeaks(canvas, { colour, baseY, minHeight, maxHeight, count = 6, snow = null, sharpness = 0.5 }) {
  const shade = mixColours(colour, '#000000', 0.22);
  const peaks = [];
  for (let peak = 0; peak < count; peak++) {
    const x = canvas.between(-40, BIOME_ART_WIDTH + 40);
    const height = canvas.between(minHeight, maxHeight);
    const halfWidth = height * canvas.between(1.1, 2.2) * (1.2 - sharpness);
    const topY = baseY - height;
    const shoulder = canvas.between(-0.25, 0.25) * halfWidth;
    const summit = [x, topY];
    const leftShoulder = [x + shoulder - halfWidth * 0.3, topY + height * 0.35];
    const rightShoulder = [x + halfWidth * 0.35, topY + height * 0.3];
    const leftFoot = [x - halfWidth, baseY];
    const rightFoot = [x + halfWidth, baseY];
    const shadeFoot = [x + halfWidth * 0.12, baseY];
    peaks.push(createSvgElement('path', { fill: colour, d: buildOutlinePath([continueToBottom(leftShoulder, leftFoot), leftFoot, leftShoulder,
      summit, rightShoulder, rightFoot, continueToBottom(rightShoulder, rightFoot)]) }));
    peaks.push(createSvgElement('path', { fill: shade, d: buildOutlinePath([summit, rightShoulder, rightFoot,
      continueToBottom(rightShoulder, rightFoot), continueToBottom(summit, shadeFoot), shadeFoot]) }));
    if (snow) {
      // The cap's corners lie on the peak's own edges, so no snow hangs beside a steep peak.
      const snowLeft = pointAlong(summit, leftShoulder, 0.55);
      const snowRight = pointAlong(summit, rightShoulder, 0.6);
      const [dipX, dipY] = pointAlong(snowLeft, snowRight, 0.35);
      const [bumpX, bumpY] = pointAlong(snowLeft, snowRight, 0.7);
      peaks.push(createSvgElement('path', { class: 'art-snow-cap', fill: snow,
        d: buildOutlinePath([summit, snowRight, [bumpX, bumpY - height * 0.02], [dipX, dipY + height * 0.06], snowLeft]) }));
    }
  }
  canvas.add(artGroup('peaks', peaks));
}

// The ground from a height down to the bottom edge, darker towards the viewer.
function paintGround(canvas, { y, top, bottom }) {
  canvas.landTops.push(() => y);
  canvas.add(createSvgElement('rect', { class: 'art-ground', x: 0, y, width: BIOME_ART_WIDTH, height: BIOME_ART_HEIGHT - y,
    fill: addArtGradient(canvas, [['0%', top], ['100%', bottom]]) }));
}

// Sea or lake from the horizon down to the bottom edge (the land in front hides
// the rest), with a few glints near the horizon.
function paintWater(canvas, { y, height, colour, glint = '#ffffff' }) {
  let glints = '';
  for (let line = 0; line < 6; line++) {
    const x = canvas.between(0, BIOME_ART_WIDTH - 40);
    glints += `M${roundForSvg(x)},${roundForSvg(y + canvas.between(1, height - 1))}h${roundForSvg(canvas.between(10, 40))}`;
  }
  canvas.landTops.push(() => y);
  canvas.add(artGroup('water', [
    createSvgElement('rect', { x: 0, y, width: BIOME_ART_WIDTH, height: BIOME_ART_HEIGHT - y, fill: colour }),
    createSvgElement('path', { d: glints, stroke: glint, 'stroke-width': 0.8, opacity: 0.3 }),
  ]));
}

// A stream winding from the far hills down to the front edge, widening as it
// comes nearer.
function paintStream(canvas, { colour, startY, glint = '#ffffff' }) {
  const startX = canvas.between(110, 350);
  const endX = startX + canvas.between(-110, 110);
  const phase = canvas.between(0, Math.PI * 2);
  const leftEdge = [];
  const rightEdge = [];
  for (let step = 0; step <= 8; step++) {
    const nearness = step / 8;
    const y = startY + (BIOME_ART_HEIGHT + 2 - startY) * nearness;
    const centre = startX + (endX - startX) * nearness + Math.sin(nearness * Math.PI * 2.2 + phase) * 26 * nearness;
    const halfWidth = 0.8 + nearness * nearness * 15;
    leftEdge.push([centre - halfWidth, y]);
    rightEdge.push([centre + halfWidth, y]);
  }
  const glints = leftEdge.slice(3).map(([x, y], step) => `M${roundForSvg(x + 3 + step * 2)},${roundForSvg(y)}h${roundForSvg(3 + step * 2)}`).join('');
  canvas.add(artGroup('stream', [
    createSvgElement('path', { d: buildRibbonPath(leftEdge, rightEdge), fill: colour, opacity: 0.9 }),
    createSvgElement('path', { d: glints, stroke: glint, 'stroke-width': 0.8, opacity: 0.45 }),
  ]));
}

// Tufts of grass as one path of short strokes.
function paintGrass(canvas, { colour, count = 40, minY, maxY, height = 5, width = 1 }) {
  let blades = '';
  for (const { x, y, depth } of scatterByDepth(canvas, count, { minY, maxY })) {
    const size = height * (0.5 + depth * 0.7);
    blades += `M${roundForSvg(x - 2)},${roundForSvg(y)}l1,${roundForSvg(-size * 0.8)}M${roundForSvg(x)},${roundForSvg(y)}l0,${roundForSvg(-size)}M${roundForSvg(x + 2)},${roundForSvg(y)}l-1,${roundForSvg(-size * 0.8)}`;
  }
  canvas.add(artGroup('grass', [createSvgElement('path', { d: blades, stroke: colour, 'stroke-width': width, 'stroke-linecap': 'round', fill: 'none' })]));
}

// Dots of flowers, one path per colour.
function paintFlowers(canvas, { colours, count = 30, minY, maxY, size = 1.8 }) {
  const paths = colours.map(colour => {
    let dots = '';
    for (const { x, y, depth } of scatterByDepth(canvas, Math.ceil(count / colours.length), { minY, maxY })) {
      dots += `M${roundForSvg(x)},${roundForSvg(y)}h0.1`;
      if (depth > 0.7) dots += `M${roundForSvg(x + 2)},${roundForSvg(y + 1)}h0.1`;
    }
    return createSvgElement('path', { d: dots, stroke: colour, 'stroke-width': size, 'stroke-linecap': 'round' });
  });
  canvas.add(artGroup('flowers', paths));
}

// ── Plants ──

// A pine: three stacked tiers on a short trunk, with snow on top if asked.
function buildPineTree(x, baseY, height, { leaves, trunk, snow = null }) {
  const parts = [createSvgElement('rect', { x: roundForSvg(x - height * 0.04), y: roundForSvg(baseY - height * 0.2), width: roundForSvg(height * 0.08), height: roundForSvg(height * 0.2), fill: trunk })];
  for (let tier = 0; tier < 3; tier++) {
    const top = baseY - height + tier * height * 0.24;
    const bottom = top + height * 0.42;
    const halfWidth = height * 0.3 * (0.55 + tier * 0.25);
    parts.push(createSvgElement('polygon', { fill: leaves,
      points: `${roundForSvg(x)},${roundForSvg(top)} ${roundForSvg(x - halfWidth)},${roundForSvg(bottom)} ${roundForSvg(x + halfWidth)},${roundForSvg(bottom)}` }));
    if (snow) {
      const snowLine = top + (bottom - top) * 0.4;
      parts.push(createSvgElement('polygon', { fill: snow,
        points: `${roundForSvg(x)},${roundForSvg(top)} ${roundForSvg(x - halfWidth * 0.4)},${roundForSvg(snowLine)} ${roundForSvg(x + halfWidth * 0.4)},${roundForSvg(snowLine)}` }));
    }
  }
  return artGroup('pine-tree', parts);
}

// A broadleaf tree: a trunk with two limbs under a round, leafy crown.
function buildBroadleafTree(canvas, x, baseY, height, { leaves, trunk }) {
  const trunkWidth = Math.max(1.4, height * 0.08);
  const crownY = baseY - height * 0.62;
  const crownRadius = height * 0.27;
  const [dark, middle, light] = leaves;
  const blob = (dx, dy, scale, fill) => createSvgElement('circle', {
    cx: roundForSvg(x + dx * crownRadius + canvas.between(-1, 1)), cy: roundForSvg(crownY + dy * crownRadius + canvas.between(-1, 1)),
    r: roundForSvg(crownRadius * scale), fill });
  return artGroup('broadleaf-tree', [
    createSvgElement('path', { fill: trunk, d: `M${roundForSvg(x - trunkWidth / 2)},${roundForSvg(baseY)} L${roundForSvg(x - trunkWidth * 0.3)},${roundForSvg(crownY)} L${roundForSvg(x + trunkWidth * 0.3)},${roundForSvg(crownY)} L${roundForSvg(x + trunkWidth / 2)},${roundForSvg(baseY)} Z` }),
    createSvgElement('path', { stroke: trunk, 'stroke-width': roundForSvg(trunkWidth * 0.45), 'stroke-linecap': 'round', fill: 'none',
      d: `M${roundForSvg(x)},${roundForSvg(baseY - height * 0.4)} L${roundForSvg(x - crownRadius * 0.6)},${roundForSvg(crownY + crownRadius * 0.2)} M${roundForSvg(x)},${roundForSvg(baseY - height * 0.45)} L${roundForSvg(x + crownRadius * 0.55)},${roundForSvg(crownY + crownRadius * 0.1)}` }),
    blob(-0.7, 0.3, 0.72, dark), blob(0.7, 0.28, 0.75, dark), blob(0, 0.15, 0.85, dark),
    blob(-0.35, -0.3, 0.72, middle), blob(0.4, -0.25, 0.7, middle), blob(0.05, -0.55, 0.6, middle),
    blob(-0.35, -0.5, 0.35, light), blob(0.2, -0.7, 0.3, light),
  ]);
}

// A tall tropical jungle tree: a slender, slightly bent trunk that forks into
// a dome of leafy clumps, with lianas hanging from it.
function buildJungleTree(canvas, x, baseY, height, { leaves, trunk, vine = leaves[0] }) {
  const bend = canvas.between(-0.1, 0.1) * height;
  const topX = x + bend;
  const crownY = baseY - height * 0.72;
  const spread = height * canvas.between(0.24, 0.32);
  const trunkWidth = Math.max(1.2, height * 0.045);
  const [dark, middle, light] = leaves;
  const clump = (across, rise, radius, fill) => createSvgElement('ellipse', {
    cx: roundForSvg(topX + across * spread + canvas.between(-1, 1)), cy: roundForSvg(crownY - rise * height + canvas.between(-1, 1)),
    rx: roundForSvg(radius * spread), ry: roundForSvg(radius * spread * 0.8), fill });
  const forkY = crownY + height * 0.1;
  let lianas = '';
  for (let liana = 0; liana < 3; liana++) {
    const lianaX = topX + canvas.between(-0.8, 0.8) * spread;
    lianas += `M${roundForSvg(lianaX)},${roundForSvg(crownY + height * 0.02)} q${roundForSvg(canvas.between(-2, 2))},${roundForSvg(height * 0.1)} ${roundForSvg(canvas.between(-1.5, 1.5))},${roundForSvg(height * canvas.between(0.12, 0.3))}`;
  }
  return artGroup('jungle-tree', [
    createSvgElement('path', { stroke: trunk, 'stroke-width': roundForSvg(trunkWidth), fill: 'none', 'stroke-linecap': 'round',
      d: `M${roundForSvg(x)},${roundForSvg(baseY)} Q${roundForSvg(x + bend * 1.4)},${roundForSvg(baseY - height * 0.4)} ${roundForSvg(topX)},${roundForSvg(forkY)}` }),
    createSvgElement('path', { stroke: trunk, 'stroke-width': roundForSvg(trunkWidth * 0.6), fill: 'none', 'stroke-linecap': 'round',
      d: `M${roundForSvg(topX)},${roundForSvg(forkY)} Q${roundForSvg(topX - spread * 0.3)},${roundForSvg(crownY + height * 0.04)} ${roundForSvg(topX - spread * 0.7)},${roundForSvg(crownY)}` +
        ` M${roundForSvg(topX)},${roundForSvg(forkY)} Q${roundForSvg(topX + spread * 0.3)},${roundForSvg(crownY + height * 0.03)} ${roundForSvg(topX + spread * 0.68)},${roundForSvg(crownY - height * 0.01)}` }),
    clump(-0.75, 0, 0.42, dark), clump(0.75, 0.01, 0.42, dark), clump(-0.3, 0.02, 0.48, dark), clump(0.3, 0.03, 0.46, dark),
    clump(-0.45, 0.1, 0.4, middle), clump(0.4, 0.11, 0.4, middle), clump(0, 0.16, 0.44, middle),
    clump(-0.2, 0.22, 0.24, light), clump(0.22, 0.2, 0.2, light),
    createSvgElement('path', { d: lianas, stroke: vine, 'stroke-width': 0.8, fill: 'none', opacity: 0.85 }),
  ]);
}

// The unbroken roof of a jungle seen from afar: overlapping rounded treetops
// rising and falling along the horizon, lit a little on top.
function paintCanopy(canvas, { baseY, height, colours }) {
  const [dark, middle] = colours;
  const phase = canvas.between(0, Math.PI * 2);
  const crowns = [];
  const lights = [];
  for (let x = -10; x <= BIOME_ART_WIDTH + 10; x += canvas.between(6, 10)) {
    const radius = canvas.between(5, 11);
    const top = baseY - height * (0.6 + 0.3 * Math.sin(x / 70 + phase)) - canvas.between(0, height * 0.25);
    // a round top on a solid body, so no sky shows under a treetop that stands high
    crowns.push(createSvgElement('circle', { cx: roundForSvg(x), cy: roundForSvg(top + radius), r: roundForSvg(radius), fill: dark }));
    crowns.push(createSvgElement('rect', { x: roundForSvg(x - radius), y: roundForSvg(top + radius), width: roundForSvg(radius * 2),
      height: roundForSvg(BIOME_ART_HEIGHT - top - radius), fill: dark }));
    if (canvas.chance(0.45)) {
      lights.push(createSvgElement('ellipse', { cx: roundForSvg(x - radius * 0.25), cy: roundForSvg(top + radius * 0.55),
        rx: roundForSvg(radius * 0.55), ry: roundForSvg(radius * 0.35), fill: middle, opacity: 0.7 }));
    }
  }
  const fillerTop = roundForSvg(baseY - height * 0.3);
  canvas.landTops.push(() => fillerTop);
  canvas.add(artGroup('canopy', [
    createSvgElement('rect', { x: 0, y: fillerTop, width: BIOME_ART_WIDTH, height: roundForSvg(BIOME_ART_HEIGHT - fillerTop), fill: dark }),
    ...crowns, ...lights,
  ]));
}

// A palm: a curved trunk and drooping fronds.
function buildPalmTree(canvas, x, baseY, height, { trunk, fronds, droop = 0.5 }) {
  const lean = canvas.between(-0.3, 0.3) * height;
  const topX = x + lean;
  const topY = baseY - height;
  let leaves = '';
  for (let frond = 0; frond < 7; frond++) {
    const angle = Math.PI * (1.05 + frond * 0.15);
    const length = height * canvas.between(0.35, 0.5);
    const endX = topX + Math.cos(angle) * length;
    const endY = topY + Math.sin(angle) * length * 0.35 + length * droop;
    leaves += `M${roundForSvg(topX)},${roundForSvg(topY)} Q${roundForSvg((topX + endX) / 2)},${roundForSvg(topY - length * 0.3)} ${roundForSvg(endX)},${roundForSvg(endY)}`;
  }
  return artGroup('palm-tree', [
    createSvgElement('path', { stroke: trunk, 'stroke-width': roundForSvg(Math.max(1.5, height * 0.06)), fill: 'none', 'stroke-linecap': 'round',
      d: `M${roundForSvg(x)},${roundForSvg(baseY)} Q${roundForSvg(x + lean * 0.2)},${roundForSvg(baseY - height * 0.6)} ${roundForSvg(topX)},${roundForSvg(topY)}` }),
    createSvgElement('path', { d: leaves, stroke: fronds, 'stroke-width': roundForSvg(Math.max(1.4, height * 0.05)), fill: 'none', 'stroke-linecap': 'round' }),
  ]);
}

// A massive gnarled swamp tree, like a mangrove: arching prop roots, a thick
// crooked trunk, a heavy rounded crown of clumps and moss hanging from it.
function buildGnarledTree(canvas, x, baseY, height, { trunk, leaves, vine }) {
  const width = height * 0.075;
  const lean = canvas.between(-0.08, 0.08) * height;
  const crownX = x + lean;
  const crownY = baseY - height * 0.7;
  const rootTop = baseY - height * 0.2;
  const [dark, middle] = leaves;
  let roots = '';
  for (let root = 0; root < 6; root++) {
    const side = root % 2 ? 1 : -1;
    const reach = width * canvas.between(1.4, 4);
    const fromY = rootTop + canvas.between(0, height * 0.1);
    roots += `M${roundForSvg(x + side * width * 0.3)},${roundForSvg(fromY)} Q${roundForSvg(x + side * reach * 0.85)},${roundForSvg(fromY - height * 0.05)} ${roundForSvg(x + side * reach)},${roundForSvg(baseY)}`;
  }
  const trunkShape = `M${roundForSvg(x - width * 0.7)},${roundForSvg(rootTop + height * 0.08)}` +
    ` C${roundForSvg(x - width * 1.1)},${roundForSvg(baseY - height * 0.42)} ${roundForSvg(crownX - width * 1.1)},${roundForSvg(crownY + height * 0.16)} ${roundForSvg(crownX - width * 0.45)},${roundForSvg(crownY)}` +
    ` L${roundForSvg(crownX + width * 0.45)},${roundForSvg(crownY)}` +
    ` C${roundForSvg(crownX + width * 1.1)},${roundForSvg(crownY + height * 0.16)} ${roundForSvg(x + width * 1.1)},${roundForSvg(baseY - height * 0.42)} ${roundForSvg(x + width * 0.7)},${roundForSvg(rootTop + height * 0.08)} Z`;
  const limbs = `M${roundForSvg(crownX)},${roundForSvg(crownY + height * 0.06)} q${roundForSvg(-height * 0.1)},${roundForSvg(-height * 0.02)} ${roundForSvg(-height * 0.2)},${roundForSvg(-height * 0.1)}` +
    ` M${roundForSvg(crownX)},${roundForSvg(crownY + height * 0.04)} q${roundForSvg(height * 0.1)},${roundForSvg(-height * 0.03)} ${roundForSvg(height * 0.22)},${roundForSvg(-height * 0.09)}`;
  const crown = [];
  for (let clump = 0; clump < 7; clump++) {
    const angle = Math.PI * clump / 6;
    crown.push(createSvgElement('ellipse', {
      cx: roundForSvg(crownX + Math.cos(angle) * height * 0.28 * canvas.between(0.75, 1)),
      cy: roundForSvg(crownY - Math.sin(angle) * height * 0.13 - height * 0.02 + canvas.between(-2, 2)),
      rx: roundForSvg(height * canvas.between(0.13, 0.18)), ry: roundForSvg(height * canvas.between(0.07, 0.1)), fill: clump % 2 ? middle : dark }));
  }
  crown.push(createSvgElement('ellipse', { cx: roundForSvg(crownX), cy: roundForSvg(crownY - height * 0.1), rx: roundForSvg(height * 0.22), ry: roundForSvg(height * 0.1), fill: dark }));
  crown.push(createSvgElement('ellipse', { cx: roundForSvg(crownX - height * 0.05), cy: roundForSvg(crownY - height * 0.16), rx: roundForSvg(height * 0.12), ry: roundForSvg(height * 0.05), fill: middle }));
  let moss = '';
  for (let strand = 0; strand < 8; strand++) {
    const strandX = crownX + canvas.between(-0.38, 0.38) * height;
    const strandTop = crownY + canvas.between(-0.02, 0.04) * height;
    moss += `M${roundForSvg(strandX)},${roundForSvg(strandTop)} q${roundForSvg(canvas.between(-2, 2))},${roundForSvg(height * 0.08)} ${roundForSvg(canvas.between(-1, 1))},${roundForSvg(height * canvas.between(0.1, 0.3))}`;
  }
  return artGroup('gnarled-tree', [
    createSvgElement('path', { d: roots, stroke: trunk, 'stroke-width': roundForSvg(Math.max(1, width * 0.45)), fill: 'none', 'stroke-linecap': 'round' }),
    createSvgElement('path', { d: trunkShape, fill: trunk }),
    createSvgElement('path', { d: limbs, stroke: trunk, 'stroke-width': roundForSvg(Math.max(1, width * 0.4)), fill: 'none', 'stroke-linecap': 'round' }),
    ...crown,
    createSvgElement('path', { d: moss, stroke: vine, 'stroke-width': 0.9, fill: 'none', opacity: 0.9 }),
  ]);
}

// A cluster of pale swamp mushrooms.
function buildMushrooms(canvas, x, baseY, size, { cap, stem }) {
  const parts = [];
  for (let mushroom = 0; mushroom < 3; mushroom++) {
    const mushroomX = x + (mushroom - 1) * size * 0.9 + canvas.between(-1, 1);
    const height = size * canvas.between(0.6, 1.1);
    const capRadius = size * canvas.between(0.35, 0.55);
    parts.push(createSvgElement('rect', { x: roundForSvg(mushroomX - size * 0.08), y: roundForSvg(baseY - height), width: roundForSvg(size * 0.16), height: roundForSvg(height), fill: stem }));
    parts.push(createSvgElement('path', { fill: cap,
      d: `M${roundForSvg(mushroomX - capRadius)},${roundForSvg(baseY - height + 0.5)} a${roundForSvg(capRadius)},${roundForSvg(capRadius * 0.8)} 0 0 1 ${roundForSvg(capRadius * 2)},0 Z` }));
  }
  return artGroup('mushrooms', parts);
}

// A leafless tree: a crooked trunk that forks twice. Used for charred trees on the
// Scorched Moor, grey dead trees in the Deadlands and twisted haunted-swamp trees.
// blossoms adds the Deadlands' violet parasitic flowers on the twig ends.
function buildBareTree(canvas, x, baseY, height, { colour, twist = 0.3, blossoms = null, broken = false }) {
  const levels = [[], [], []];
  const tips = [];
  const grow = (fromX, fromY, angle, length, level) => {
    const bendAngle = angle + canvas.between(-twist, twist);
    const toX = fromX + Math.cos(bendAngle) * length;
    const toY = fromY + Math.sin(bendAngle) * length;
    const midX = (fromX + toX) / 2 + canvas.between(-length, length) * twist * 0.4;
    const midY = (fromY + toY) / 2;
    levels[level].push(`M${roundForSvg(fromX)},${roundForSvg(fromY)} Q${roundForSvg(midX)},${roundForSvg(midY)} ${roundForSvg(toX)},${roundForSvg(toY)}`);
    if (level === 2 || (broken && level === 1 && canvas.chance(0.5))) { tips.push([toX, toY]); return; }
    const forks = level === 0 ? 3 : 2;
    for (let fork = 0; fork < forks; fork++) {
      const spreadAngle = (fork - (forks - 1) / 2) * canvas.between(0.45, 0.8);
      grow(toX, toY, angle + spreadAngle, length * canvas.between(0.45, 0.62), level + 1);
    }
  };
  grow(x, baseY, -Math.PI / 2, height * (broken ? 0.6 : 0.55), 0);
  const widths = [Math.max(1.2, height * 0.07), Math.max(0.8, height * 0.035), Math.max(0.5, height * 0.018)];
  const parts = levels.map((segments, level) => createSvgElement('path', {
    d: segments.join(''), stroke: colour, 'stroke-width': roundForSvg(widths[level]), fill: 'none', 'stroke-linecap': 'round' }));
  if (blossoms) {
    const dots = tips.filter(() => canvas.chance(0.6)).map(([tipX, tipY]) => `M${roundForSvg(tipX)},${roundForSvg(tipY)}h0.1`).join('');
    if (dots) parts.push(createSvgElement('path', { d: dots, stroke: blossoms, 'stroke-width': roundForSvg(Math.max(1.6, height * 0.06)), 'stroke-linecap': 'round' }));
  }
  return artGroup('bare-tree', parts);
}

// Dried-out coral: pale stems fanning up from the ground and forking once.
function buildCoral(canvas, x, baseY, height, colour) {
  let stems = '';
  for (let stem = 0; stem < 4; stem++) {
    const angle = -Math.PI / 2 + (stem - 1.5) * 0.35 + canvas.between(-0.1, 0.1);
    const midX = x + Math.cos(angle) * height * 0.55;
    const midY = baseY + Math.sin(angle) * height * 0.55;
    stems += `M${roundForSvg(x)},${roundForSvg(baseY)} L${roundForSvg(midX)},${roundForSvg(midY)}`;
    for (const side of [-0.35, 0.35]) {
      stems += `M${roundForSvg(midX)},${roundForSvg(midY)} l${roundForSvg(Math.cos(angle + side) * height * 0.4)},${roundForSvg(Math.sin(angle + side) * height * 0.4)}`;
    }
  }
  return artGroup('coral', [createSvgElement('path', { d: stems, stroke: colour, 'stroke-width': roundForSvg(Math.max(1, height * 0.08)), fill: 'none', 'stroke-linecap': 'round' })]);
}

// A fern: curved fronds fanning out from one point, with a soft glow if asked.
function buildFern(canvas, x, baseY, size, colour, glow = null) {
  let fronds = '';
  for (let frond = 0; frond < 7; frond++) {
    const angle = Math.PI * (1.08 + frond * 0.14);
    const length = size * canvas.between(0.7, 1);
    fronds += `M${roundForSvg(x)},${roundForSvg(baseY)} q${roundForSvg(Math.cos(angle) * length * 0.4)},${roundForSvg(-length * 0.9)} ${roundForSvg(Math.cos(angle) * length)},${roundForSvg(Math.sin(angle) * length * 0.6)}`;
  }
  return artGroup('fern', [
    glow ? createSvgElement('ellipse', { cx: roundForSvg(x), cy: roundForSvg(baseY - size * 0.3), rx: roundForSvg(size * 1.1), ry: roundForSvg(size * 0.7),
      fill: addArtGradient(canvas, [['0%', glow, 0.4], ['100%', glow, 0]], true) }) : null,
    createSvgElement('path', { d: fronds, stroke: colour, 'stroke-width': roundForSvg(Math.max(1, size * 0.14)), fill: 'none', 'stroke-linecap': 'round' }),
  ]);
}

// A low, rounded bush of two or three colours.
function buildShrub(canvas, x, baseY, size, colours) {
  return artGroup('shrub', [
    createSvgElement('circle', { cx: roundForSvg(x - size * 0.5), cy: roundForSvg(baseY - size * 0.4), r: roundForSvg(size * 0.55), fill: canvas.pick(colours) }),
    createSvgElement('circle', { cx: roundForSvg(x + size * 0.45), cy: roundForSvg(baseY - size * 0.38), r: roundForSvg(size * 0.5), fill: canvas.pick(colours) }),
    createSvgElement('circle', { cx: roundForSvg(x), cy: roundForSvg(baseY - size * 0.72), r: roundForSvg(size * 0.55), fill: canvas.pick(colours) }),
  ]);
}

// A tall, dead desert shrub: thin dry twigs.
function buildDryShrub(canvas, x, baseY, size, colour) {
  let twigs = '';
  for (let twig = 0; twig < 6; twig++) {
    const angle = -Math.PI / 2 + (twig - 2.5) * 0.28;
    twigs += `M${roundForSvg(x)},${roundForSvg(baseY)} q${roundForSvg(Math.cos(angle) * size * 0.3)},${roundForSvg(-size * 0.5)} ${roundForSvg(Math.cos(angle) * size)},${roundForSvg(Math.sin(angle) * size)}`;
  }
  return artGroup('dry-shrub', [createSvgElement('path', { d: twigs, stroke: colour, 'stroke-width': 0.8, fill: 'none', 'stroke-linecap': 'round' })]);
}

// ── Rocks and landmarks ──

// A rounded boulder with a lit upper edge.
function buildBoulder(x, baseY, width, height, { rock, light }) {
  return artGroup('boulder', [
    createSvgElement('path', { fill: rock, d: `M${roundForSvg(x - width)},${roundForSvg(baseY)} C${roundForSvg(x - width)},${roundForSvg(baseY - height * 0.8)} ${roundForSvg(x - width * 0.4)},${roundForSvg(baseY - height)} ${roundForSvg(x)},${roundForSvg(baseY - height)} C${roundForSvg(x + width * 0.55)},${roundForSvg(baseY - height)} ${roundForSvg(x + width)},${roundForSvg(baseY - height * 0.6)} ${roundForSvg(x + width)},${roundForSvg(baseY)} Z` }),
    createSvgElement('path', { fill: light, opacity: 0.45, d: `M${roundForSvg(x - width * 0.7)},${roundForSvg(baseY - height * 0.55)} C${roundForSvg(x - width * 0.6)},${roundForSvg(baseY - height * 0.9)} ${roundForSvg(x - width * 0.1)},${roundForSvg(baseY - height * 0.95)} ${roundForSvg(x + width * 0.2)},${roundForSvg(baseY - height * 0.85)} Z` }),
  ]);
}

// A tall rock pillar with a lit side and an optional cap (moss or snow).
function buildRockPillar(canvas, x, baseY, width, height, { rock, light, cap = null }) {
  const top = baseY - height;
  const tilt = canvas.between(-0.15, 0.15) * width;
  return artGroup('rock-pillar', [
    createSvgElement('polygon', { fill: rock, points: `${roundForSvg(x - width / 2)},${roundForSvg(baseY)} ${roundForSvg(x - width * 0.38 + tilt)},${roundForSvg(top + 2)} ${roundForSvg(x + tilt)},${roundForSvg(top)} ${roundForSvg(x + width * 0.36 + tilt)},${roundForSvg(top + 3)} ${roundForSvg(x + width / 2)},${roundForSvg(baseY)}` }),
    createSvgElement('polygon', { fill: light, opacity: 0.4, points: `${roundForSvg(x - width / 2)},${roundForSvg(baseY)} ${roundForSvg(x - width * 0.38 + tilt)},${roundForSvg(top + 2)} ${roundForSvg(x - width * 0.12 + tilt)},${roundForSvg(top + 1)} ${roundForSvg(x - width * 0.2)},${roundForSvg(baseY)}` }),
    cap ? createSvgElement('polygon', { fill: cap, points: `${roundForSvg(x - width * 0.4 + tilt)},${roundForSvg(top + 4)} ${roundForSvg(x + tilt)},${roundForSvg(top - 1)} ${roundForSvg(x + width * 0.38 + tilt)},${roundForSvg(top + 5)} ${roundForSvg(x + tilt)},${roundForSvg(top + 7)}` }) : null,
  ]);
}

// A huge flat-topped rock formation with horizontal layers in its face. A far
// one (reachBottom) carries its sides on down to the bottom edge, so its foot
// is hidden by the land in front instead of hanging in the air.
function buildMesa(canvas, x, baseY, width, height, { rock, light, strata, reachBottom = false }) {
  const top = baseY - height;
  const leftTop = x - width * canvas.between(0.3, 0.4);
  const rightTop = x + width * canvas.between(0.3, 0.4);
  const leftFoot = [x - width / 2, baseY];
  const rightFoot = [x + width / 2, baseY];
  const litFoot = [x - width * 0.25, baseY];
  const down = (from, foot) => (reachBottom ? [continueToBottom(from, foot)] : []);
  // The layer lines run from side to side of the rock at their height, never past it.
  const sideAt = ([topX, topY], [footX, footY], y) => topX + (footX - topX) * (y - topY) / (footY - topY);
  let layers = '';
  for (let layer = 1; layer < 4; layer++) {
    const y = top + height * layer / 4;
    layers += `M${roundForSvg(sideAt([leftTop, top + 3], leftFoot, y) + 1.5)},${roundForSvg(y)}H${roundForSvg(sideAt([rightTop, top + 4], rightFoot, y) - 1.5)}`;
  }
  return artGroup('mesa', [
    createSvgElement('path', { fill: rock, d: buildOutlinePath([...down([leftTop, top + 3], leftFoot), leftFoot, [leftTop, top + 3], [leftTop + 4, top],
      [rightTop - 3, top], [rightTop, top + 4], rightFoot, ...down([rightTop, top + 4], rightFoot)]) }),
    createSvgElement('path', { fill: light, opacity: 0.35, d: buildOutlinePath([...down([leftTop, top + 3], leftFoot), leftFoot, [leftTop, top + 3],
      [leftTop + 4, top], [x - width * 0.15, top], litFoot, ...down([x - width * 0.15, top], litFoot)]) }),
    createSvgElement('path', { d: layers, stroke: strata, 'stroke-width': 1, opacity: 0.5 }),
  ]);
}

// Ice spikes pointing up out of the snow.
function buildIcicles(canvas, x, baseY, size, { ice, light }) {
  const spikes = [];
  for (let spike = 0; spike < 5; spike++) {
    const spikeX = x + (spike - 2) * size * 0.28 + canvas.between(-2, 2);
    const height = size * canvas.between(0.5, 1.1);
    const halfWidth = size * 0.09;
    spikes.push(createSvgElement('polygon', { fill: spike % 2 ? light : ice,
      points: `${roundForSvg(spikeX - halfWidth)},${roundForSvg(baseY)} ${roundForSvg(spikeX + canvas.between(-1, 1))},${roundForSvg(baseY - height)} ${roundForSvg(spikeX + halfWidth)},${roundForSvg(baseY)}` }));
  }
  return artGroup('icicles', spikes);
}

// A tall organic Terminid spire with ribs. A far one (reachBottom) carries its
// sides on down to the bottom edge, behind the land in front of it.
function buildTerminidSpire(canvas, x, baseY, height, { matter, ridge, reachBottom = false }) {
  const width = height * canvas.between(0.12, 0.18);
  const lean = canvas.between(-0.15, 0.15) * height;
  let ribs = '';
  for (let rib = 1; rib < 5; rib++) {
    const ribY = baseY - height * rib / 5;
    const ribWidth = width * (1 - rib / 6);
    ribs += `M${roundForSvg(x + lean * rib / 5 - ribWidth)},${roundForSvg(ribY)} q${roundForSvg(ribWidth)},3 ${roundForSvg(ribWidth * 2)},0`;
  }
  const foot = reachBottom ? ` L${roundForSvg(x + width)},${BIOME_ART_HEIGHT} L${roundForSvg(x - width)},${BIOME_ART_HEIGHT}` : '';
  return artGroup('terminid-spire', [
    createSvgElement('path', { fill: matter, d: `M${roundForSvg(x - width)},${roundForSvg(baseY)} Q${roundForSvg(x - width * 0.5 + lean * 0.4)},${roundForSvg(baseY - height * 0.55)} ${roundForSvg(x + lean)},${roundForSvg(baseY - height)} Q${roundForSvg(x + width * 0.5 + lean * 0.4)},${roundForSvg(baseY - height * 0.5)} ${roundForSvg(x + width)},${roundForSvg(baseY)}${foot} Z` }),
    createSvgElement('path', { d: ribs, stroke: ridge, 'stroke-width': 1, fill: 'none', opacity: 0.7 }),
  ]);
}

// A rounded hive mound with a dark opening.
function buildHiveMound(x, baseY, width, height, { matter, hole }) {
  return artGroup('hive-mound', [
    createSvgElement('path', { fill: matter, d: `M${roundForSvg(x - width / 2)},${roundForSvg(baseY)} Q${roundForSvg(x)},${roundForSvg(baseY - height * 2)} ${roundForSvg(x + width / 2)},${roundForSvg(baseY)} Z` }),
    createSvgElement('ellipse', { cx: roundForSvg(x), cy: roundForSvg(baseY - height * 0.5), rx: roundForSvg(width * 0.1), ry: roundForSvg(height * 0.14), fill: hole }),
  ]);
}

// A volcano: a cone with a glowing crater, lava running down and a smoke plume.
// The cone's slopes run on to the bottom edge.
function buildVolcano(canvas, x, baseY, width, height, { rock, glow, smoke }) {
  const top = baseY - height;
  const crater = width * 0.14;
  const puffs = [];
  for (let puff = 0; puff < 6; puff++) {
    puffs.push(createSvgElement('circle', { cx: roundForSvg(x + puff * canvas.between(3, 7)), cy: roundForSvg(top - 6 - puff * 7),
      r: roundForSvg(5 + puff * 2.5), fill: smoke, opacity: roundForSvg(0.5 - puff * 0.06) }));
  }
  // Lava runs down the slope from the crater's rim, so it leans out as the cone does.
  const lavaFlows = [-1, 1].filter(() => canvas.chance(0.8)).map(side => {
    const startX = x + side * crater * canvas.between(0.2, 0.7);
    const length = height * canvas.between(0.3, 0.6);
    const slope = (width - crater) / height;
    const leftEdge = [];
    const rightEdge = [];
    for (let step = 0; step <= 4; step++) {
      const down = step / 4;
      const flowX = startX + side * slope * length * down * 0.8 + Math.sin(down * 6) * 1.2;
      const halfWidth = 0.5 + down * 1.2;
      leftEdge.push([flowX - halfWidth, top + length * down]);
      rightEdge.push([flowX + halfWidth, top + length * down]);
    }
    return createSvgElement('path', { d: buildRibbonPath(leftEdge, rightEdge), fill: glow, opacity: 0.8 });
  });
  return artGroup('volcano', [
    ...puffs,
    createSvgElement('path', { fill: rock, d: buildOutlinePath([continueToBottom([x - crater, top], [x - width, baseY]), [x - width, baseY],
      [x - crater, top], [x + crater, top], [x + width, baseY], continueToBottom([x + crater, top], [x + width, baseY])]) }),
    createSvgElement('ellipse', { cx: roundForSvg(x), cy: roundForSvg(top), rx: roundForSvg(crater * 1.1), ry: 2.5, fill: glow }),
    ...lavaFlows,
  ]);
}

// A pool of magma: a soft glow, the molten surface and a bright core.
function buildLavaPool(canvas, x, y, width, { lava, core, glow }) {
  return artGroup('lava-pool', [
    createSvgElement('ellipse', { cx: roundForSvg(x), cy: roundForSvg(y), rx: roundForSvg(width), ry: roundForSvg(width * 0.28), fill: addArtGradient(canvas, [['0%', glow, 0.55], ['100%', glow, 0]], true) }),
    createSvgElement('ellipse', { cx: roundForSvg(x), cy: roundForSvg(y), rx: roundForSvg(width * 0.5), ry: roundForSvg(width * 0.12), fill: lava }),
    createSvgElement('ellipse', { cx: roundForSvg(x - width * 0.08), cy: roundForSvg(y - width * 0.02), rx: roundForSvg(width * 0.26), ry: roundForSvg(width * 0.05), fill: core }),
  ]);
}

// A fire tornado: a twisting column of flame, wider at the top, glowing where
// it touches the ground, with smoke above.
function buildFireTornado(canvas, x, baseY, height) {
  const sway = canvas.between(-0.2, 0.2) * height;
  const phase = canvas.between(0, Math.PI * 2);
  const leftEdge = [];
  const rightEdge = [];
  let swirls = '';
  for (let step = 0; step <= 6; step++) {
    const rise = step / 6;
    const y = baseY - height * rise;
    const centre = x + sway * rise * rise + Math.sin(rise * 7 + phase) * 3;
    const halfWidth = 1.5 + height * 0.2 * rise ** 1.4;
    leftEdge.push([centre - halfWidth, y]);
    rightEdge.push([centre + halfWidth, y]);
    if (step > 0 && step < 6) swirls += `M${roundForSvg(centre - halfWidth * 0.9)},${roundForSvg(y + 2)} q${roundForSvg(halfWidth)},${roundForSvg(-3)} ${roundForSvg(halfWidth * 1.8)},${roundForSvg(-1)}`;
  }
  const [topX, topY] = [(leftEdge[6][0] + rightEdge[6][0]) / 2, leftEdge[6][1]];
  const smoke = [0, 1, 2].map(puff => createSvgElement('circle', { cx: roundForSvg(topX + canvas.between(-8, 8)), cy: roundForSvg(topY - 3 - puff * 5),
    r: roundForSvg(6 + puff * 3), fill: '#3a2a26', opacity: roundForSvg(0.35 - puff * 0.08) }));
  return artGroup('fire-tornado', [
    ...smoke,
    createSvgElement('ellipse', { cx: roundForSvg(x), cy: roundForSvg(baseY), rx: roundForSvg(height * 0.3), ry: roundForSvg(height * 0.07),
      fill: addArtGradient(canvas, [['0%', '#ffb347', 0.7], ['100%', '#ff7a1a', 0]], true) }),
    createSvgElement('path', { d: buildRibbonPath(leftEdge, rightEdge),
      fill: addArtGradient(canvas, [['0%', '#c8501a', 0.35], ['45%', '#ff7a1a', 0.8], ['100%', '#ffe08a', 0.95]]) }),
    createSvgElement('path', { d: swirls, stroke: '#fff1c4', 'stroke-width': 1, fill: 'none', opacity: 0.65, 'stroke-linecap': 'round' }),
  ]);
}

// Short glowing cracks in dark ground.
function paintLavaCracks(canvas, { colour, count = 6, minY, maxY }) {
  let cracks = '';
  for (const { x, y } of scatterByDepth(canvas, count, { minY, maxY })) {
    cracks += `M${roundForSvg(x)},${roundForSvg(y)} l${roundForSvg(canvas.between(4, 8))},${roundForSvg(canvas.between(-1.5, 1.5))} l${roundForSvg(canvas.between(3, 7))},${roundForSvg(canvas.between(-1.5, 1.5))}`;
  }
  canvas.add(artGroup('lava-cracks', [createSvgElement('path', { d: cracks, stroke: colour, 'stroke-width': 1.2, fill: 'none', 'stroke-linecap': 'round', opacity: 0.9 })]));
}

// Craters: flat ellipses with a lit rim.
function paintCraters(canvas, { floor, rim, count = 5, minY, maxY }) {
  const craters = scatterByDepth(canvas, count, { minY, maxY, minX: 20, maxX: BIOME_ART_WIDTH - 20 }).map(({ x, y, depth }) => {
    const radius = 6 + depth * canvas.between(10, 22);
    return artGroup('crater', [
      createSvgElement('ellipse', { cx: roundForSvg(x), cy: roundForSvg(y), rx: roundForSvg(radius), ry: roundForSvg(radius * 0.22), fill: floor }),
      createSvgElement('path', { d: `M${roundForSvg(x - radius)},${roundForSvg(y)} a${roundForSvg(radius)},${roundForSvg(radius * 0.22)} 0 0 0 ${roundForSvg(radius * 2)},0`, stroke: rim, 'stroke-width': 1, fill: 'none', opacity: 0.6 }),
    ]);
  });
  canvas.add(...craters);
}

// ── Weather ──

// Slanted rain streaks.
function paintRain(canvas) {
  let streaks = '';
  for (let drop = 0; drop < 70; drop++) streaks += `M${roundForSvg(canvas.between(-10, BIOME_ART_WIDTH))},${roundForSvg(canvas.between(-5, BIOME_ART_HEIGHT))}l-2.5,8`;
  canvas.add(artGroup('rain', [createSvgElement('path', { d: streaks, stroke: '#cfdceb', 'stroke-width': 0.7, opacity: 0.4 })]));
}

// A blizzard: snowflakes and wind-driven streaks.
function paintSnow(canvas) {
  let flakes = '';
  let streaks = '';
  for (let flake = 0; flake < 70; flake++) flakes += `M${roundForSvg(canvas.between(0, BIOME_ART_WIDTH))},${roundForSvg(canvas.between(0, BIOME_ART_HEIGHT))}h0.1`;
  for (let streak = 0; streak < 25; streak++) streaks += `M${roundForSvg(canvas.between(-20, BIOME_ART_WIDTH))},${roundForSvg(canvas.between(0, BIOME_ART_HEIGHT))}l14,3`;
  canvas.add(artGroup('snow', [
    createSvgElement('path', { d: flakes, stroke: '#ffffff', 'stroke-width': 1.8, 'stroke-linecap': 'round', opacity: 0.8 }),
    createSvgElement('path', { d: streaks, stroke: '#ffffff', 'stroke-width': 0.6, opacity: 0.45 }),
  ]));
}

// Fog: soft horizontal bands that fade in and out. The default bands hang over
// the distance and leave the nearest ground clear, so the scene still reads.
function paintFog(canvas, { colour, bands = [[62, 50, 0.5], [96, 36, 0.32]] }) {
  canvas.add(artGroup('fog', bands.map(([y, height, opacity]) => createSvgElement('rect', { x: 0, y, width: BIOME_ART_WIDTH, height,
    fill: addArtGradient(canvas, [['0%', colour, 0], ['50%', colour, opacity], ['100%', colour, 0]]) }))));
}

// An ion storm: a dark cloud bank with jagged blue lightning.
function paintIonStorm(canvas) {
  const clouds = [];
  for (let cloud = 0; cloud < 7; cloud++) {
    clouds.push(createSvgElement('ellipse', { cx: roundForSvg(canvas.between(-20, BIOME_ART_WIDTH + 20)), cy: roundForSvg(canvas.between(0, 16)), rx: roundForSvg(canvas.between(40, 80)), ry: roundForSvg(canvas.between(10, 18)), fill: '#2a3246', opacity: 0.55 }));
  }
  let bolts = '';
  for (let bolt = 0; bolt < 3; bolt++) {
    let x = canvas.between(40, BIOME_ART_WIDTH - 40);
    let y = canvas.between(4, 14);
    bolts += `M${roundForSvg(x)},${roundForSvg(y)}`;
    const length = canvas.between(4, 7);
    for (let step = 0; step < length; step++) {
      x += canvas.between(-12, 12);
      y += canvas.between(5, 10);
      bolts += `L${roundForSvg(x)},${roundForSvg(y)}`;
    }
  }
  canvas.add(artGroup('ion-storm', [
    ...clouds,
    createSvgElement('path', { d: bolts, stroke: '#7fd4ff', 'stroke-width': 4, fill: 'none', opacity: 0.25 }),
    createSvgElement('path', { d: bolts, stroke: '#c9f0ff', 'stroke-width': 1.1, fill: 'none', opacity: 0.9 }),
  ]));
}

// Meteors streaking down with glowing tails.
function paintMeteors(canvas) {
  const meteors = [];
  for (let meteor = 0; meteor < 3; meteor++) {
    const headX = canvas.between(60, BIOME_ART_WIDTH - 20);
    const headY = canvas.between(20, 70);
    const tail = addArtGradient(canvas, [['0%', '#ffe6b0', 0], ['100%', '#ffb060', 0.9]]);
    meteors.push(createSvgElement('path', { d: `M${roundForSvg(headX - 40)},${roundForSvg(headY - 26)} L${roundForSvg(headX)},${roundForSvg(headY)}`, stroke: tail, 'stroke-width': 2, 'stroke-linecap': 'round' }));
    meteors.push(createSvgElement('circle', { cx: roundForSvg(headX), cy: roundForSvg(headY), r: 1.8, fill: '#fff4d6' }));
  }
  canvas.add(artGroup('meteors', meteors));
}

// A wall of sand on the horizon that fades out towards the ground, and haze over
// everything.
function paintSandstorm(canvas, { colour }) {
  let top = 'M0,112 L0,60';
  for (let x = 30; x <= BIOME_ART_WIDTH; x += 30) top += ` Q${x - 15},${roundForSvg(canvas.between(30, 50))} ${x},${roundForSvg(canvas.between(48, 64))}`;
  canvas.add(artGroup('sandstorm', [
    createSvgElement('path', { d: `${top} L${BIOME_ART_WIDTH},112 Z`, fill: addArtGradient(canvas, [['0%', colour, 0.55], ['70%', colour, 0.45], ['100%', colour, 0]]) }),
    createSvgElement('rect', { width: BIOME_ART_WIDTH, height: BIOME_ART_HEIGHT, fill: colour, opacity: 0.15 }),
  ]));
}

// Floating specks: ash, embers or spores.
function paintSpecks(canvas, { colour, count = 40, size = 1.2, opacity = 0.6, kind = 'ash' }) {
  let specks = '';
  for (let speck = 0; speck < count; speck++) specks += `M${roundForSvg(canvas.between(0, BIOME_ART_WIDTH))},${roundForSvg(canvas.between(0, BIOME_ART_HEIGHT))}h0.1`;
  canvas.add(artGroup(kind, [createSvgElement('path', { d: specks, stroke: colour, 'stroke-width': size, 'stroke-linecap': 'round', opacity })]));
}

// A tint over part of the picture: heat near the ground, frost at the edges, acid haze.
function paintTint(canvas, { colour, from = 0, to = 1, opacity = 0.2, kind = 'tint' }) {
  canvas.add(createSvgElement('rect', { class: `art-${kind}`, width: BIOME_ART_WIDTH, height: BIOME_ART_HEIGHT,
    fill: addArtGradient(canvas, [['0%', colour, from ? 0 : opacity], [`${Math.round(from * 100)}%`, colour, from ? 0 : opacity], [`${Math.round(to * 100)}%`, colour, opacity], ['100%', colour, to < 1 ? 0 : opacity]]) }));
}

// Draws a planet's weather hazards over its landscape.
function paintWeather(canvas, weather, { fogColour = '#c8ccd0' } = {}) {
  const has = kind => weather.includes(kind);
  if (has('heat')) paintTint(canvas, { colour: '#ff8a3a', from: 0.55, to: 1, opacity: 0.18, kind: 'heat' });
  if (has('fog')) paintFog(canvas, { colour: fogColour });
  if (has('sandstorm')) paintSandstorm(canvas, { colour: '#d9b27a' });
  if (has('acid')) paintTint(canvas, { colour: '#c8e04a', opacity: 0.18, kind: 'acid-storm' });
  if (has('ion')) paintIonStorm(canvas);
  if (has('fire-tornado')) {
    const x = canvas.between(30, 430);
    canvas.add(buildFireTornado(canvas, x, Math.max(canvas.between(114, 130), landTopAt(canvas, x) + 2), canvas.between(50, 76)));
  }
  if (has('meteors')) paintMeteors(canvas);
  if (has('embers')) paintSpecks(canvas, { colour: '#ff9a3a', count: 25, size: 1.6, opacity: 0.8, kind: 'embers' });
  if (has('rain')) paintRain(canvas);
  if (has('snow')) paintSnow(canvas);
  if (has('frost')) paintTint(canvas, { colour: '#e6f4ff', from: 0, to: 0.35, opacity: 0.22, kind: 'frost' });
}

// ── One painter per biome ──
// Each draws sky → distance → ground → plants and rocks (far to near); the
// weather comes after. The comments say what the wiki describes.

// Plants placed across the ground far to near, drawn by the given builder.
function paintPlants(canvas, count, area, build) {
  for (const position of scatterByDepth(canvas, count, area)) canvas.add(build(position));
}

const BIOME_PAINTERS = {
  // Tropical: jungle under an unbroken canopy, palms and ferns, grassy
  // clearings, beaches and sea, distant mountains and a smoking volcano,
  // flocks of birds.
  'volcanic-jungle': canvas => {
    paintSky(canvas, ['#3d7fa6', '#9cc4c8', '#dce8c8']);
    paintClouds(canvas, { colour: '#ffffff', count: 3, opacity: 0.45 });
    paintBirds(canvas, { colour: '#2f3f3a' });
    paintPeaks(canvas, { colour: '#7f9aa8', baseY: 96, minHeight: 18, maxHeight: 36, count: 5, sharpness: 0.3 });
    canvas.add(buildVolcano(canvas, canvas.between(80, 380), 98, 42, canvas.between(38, 52), { rock: '#6c7a7e', glow: '#ff8a3a', smoke: '#8e9696' }));
    if (canvas.chance(0.6)) paintWater(canvas, { y: 96, height: 8, colour: '#3f9fa8' });
    paintCanopy(canvas, { baseY: 110, height: 16, colours: ['#2c6a34', '#3f8a40', '#6ab25a'] });
    paintGround(canvas, { y: 118, top: '#3f7a38', bottom: '#2c6a2c' });
    paintPlants(canvas, 6, { minY: 112, maxY: 146 }, ({ x, y, depth }) => (canvas.chance(0.2)
      ? buildPalmTree(canvas, x, y, 24 + depth * 34, { trunk: '#6a5238', fronds: '#2f8a3a' })
      : buildJungleTree(canvas, x, y, 30 + depth * 44, { leaves: ['#236b2e', '#2f8a3a', '#56b04e'], trunk: '#4a3a2a', vine: '#2a5a2a' })));
    paintPlants(canvas, 9, { minY: 122, maxY: 148 }, ({ x, y, depth }) => buildFern(canvas, x, y, 5 + depth * 7, '#5aa84f'));
    paintGrass(canvas, { colour: '#6fbf58', minY: 120, maxY: 148, count: 40 });
    paintFlowers(canvas, { colours: ['#f2d34a', '#e8566b'], count: 14, minY: 124, maxY: 148 });
  },

  // Like the Volcanic Jungle but dim, with blue leaves, blue grass and glowing
  // ferns.
  'ionic-jungle': canvas => {
    paintSky(canvas, ['#0c1a33', '#1f3f66', '#3a6a8c']);
    paintStars(canvas, { count: 12, colour: '#bfe6ff', maxY: 50 });
    paintPeaks(canvas, { colour: '#243f63', baseY: 96, minHeight: 16, maxHeight: 34, count: 5, sharpness: 0.3 });
    if (canvas.chance(0.6)) paintWater(canvas, { y: 96, height: 8, colour: '#1f5f8f', glint: '#9fdcff' });
    paintCanopy(canvas, { baseY: 110, height: 16, colours: ['#163f78', '#1f5aa8', '#4f9ae0'] });
    paintGround(canvas, { y: 118, top: '#1a4a80', bottom: '#123866' });
    paintPlants(canvas, 6, { minY: 112, maxY: 146 }, ({ x, y, depth }) => buildJungleTree(canvas, x, y, 30 + depth * 44,
      { leaves: ['#1d5aa8', '#2f7fd6', '#6fc2ff'], trunk: '#2a2a44', vine: '#1d4a88' }));
    paintPlants(canvas, 8, { minY: 122, maxY: 148 }, ({ x, y, depth }) => buildFern(canvas, x, y, 5 + depth * 7, '#7fe6ff', '#7fe6ff'));
    paintGrass(canvas, { colour: '#4a9ae8', minY: 120, maxY: 148, count: 40 });
  },

  // Rose-tinted air, lavender trees, crimson bushes, lilac grass and teal water.
  'ethereal-jungle': canvas => {
    paintSky(canvas, ['#5a3f7a', '#b98ab8', '#f2c2d2']);
    paintPeaks(canvas, { colour: '#9a7aaa', baseY: 96, minHeight: 16, maxHeight: 34, count: 5, sharpness: 0.3 });
    if (canvas.chance(0.7)) paintWater(canvas, { y: 96, height: 8, colour: '#3fb8a8' });
    paintCanopy(canvas, { baseY: 110, height: 14, colours: ['#8a64c0', '#a882dc', '#d4b8f4'] });
    paintGround(canvas, { y: 118, top: '#a07cc8', bottom: '#7e5aac' });
    paintPlants(canvas, 6, { minY: 112, maxY: 146 }, ({ x, y, depth }) => buildJungleTree(canvas, x, y, 30 + depth * 44,
      { leaves: ['#9a70d0', '#b890e8', '#e0c8ff'], trunk: '#5a3a6a', vine: '#8a64c0' }));
    paintPlants(canvas, 7, { minY: 124, maxY: 148 }, ({ x, y, depth }) => buildShrub(canvas, x, y, 4 + depth * 5, ['#b4304f', '#d0405c', '#962844']));
    paintGrass(canvas, { colour: '#d8b0f4', minY: 120, maxY: 148, count: 40 });
    paintFlowers(canvas, { colours: ['#ff9ac8', '#fff0ff'], count: 12, minY: 124, maxY: 148 });
  },

  // Lifeless grey: dead trees, dried-out coral and parasitic growths with
  // violet flowers, the distance lost in fog.
  deadlands: canvas => {
    paintSky(canvas, ['#66636a', '#96919a', '#c2bdbf']);
    paintHills(canvas, '#8f8a8d', { baseY: 98, amplitude: 12 });
    paintPlants(canvas, 7, { minY: 96, maxY: 104 }, ({ x, y }) => buildBareTree(canvas, x, y, canvas.between(14, 22), { colour: '#78727a', twist: 0.35 }));
    paintFog(canvas, { colour: '#d8d4d6', bands: [[66, 46, 0.6]] });
    paintGround(canvas, { y: 110, top: '#7c7677', bottom: '#5a5455' });
    paintPlants(canvas, 6, { minY: 116, maxY: 146 }, ({ x, y, depth }) => buildBareTree(canvas, x, y, 26 + depth * 36,
      { colour: '#3a3538', twist: 0.4, blossoms: '#b06cf0' }));
    paintPlants(canvas, 7, { minY: 122, maxY: 148 }, ({ x, y, depth }) => buildCoral(canvas, x, y, 6 + depth * 9, '#ddd4cc'));
    paintPlants(canvas, 5, { minY: 124, maxY: 148 }, ({ x, y, depth }) => artGroup('parasite', [
      createSvgElement('ellipse', { cx: roundForSvg(x), cy: roundForSvg(y - 3 - depth * 2), rx: roundForSvg(3 + depth * 3), ry: roundForSvg(2.5 + depth * 2), fill: '#5e4a63' }),
      createSvgElement('path', { d: `M${roundForSvg(x - 2)},${roundForSvg(y - 5 - depth * 3)}h0.1M${roundForSvg(x + 2)},${roundForSvg(y - 6 - depth * 3)}h0.1M${roundForSvg(x)},${roundForSvg(y - 7 - depth * 4)}h0.1`,
        stroke: '#b86cf8', 'stroke-width': 2.4, 'stroke-linecap': 'round' }),
    ]));
  },

  // The original planet buried under Terminid matter: spires, mounds, yellow
  // puddles and drifting spores, with patches of grass and grey rock.
  supercolony: canvas => {
    paintSky(canvas, ['#3e3018', '#7e6430', '#d0aa60']);
    paintPlants(canvas, 5, { minY: 96, maxY: 100 }, ({ x, y }) => buildTerminidSpire(canvas, x, y, canvas.between(26, 44), { matter: '#6a4a24', ridge: '#4a3218', reachBottom: true }));
    paintHills(canvas, '#7a5222', { baseY: 108, amplitude: 10 });
    paintGround(canvas, { y: 116, top: '#7a5222', bottom: '#563614' });
    canvas.add(artGroup('grass-patch', [createSvgElement('ellipse', { cx: roundForSvg(canvas.between(60, 400)), cy: 132, rx: 36, ry: 6, fill: '#5a7a3a' })]));
    paintPlants(canvas, 4, { minY: 118, maxY: 146 }, ({ x, y, depth }) => buildTerminidSpire(canvas, x, y, 30 + depth * 50, { matter: '#8a5a26', ridge: '#5e3c18' }));
    paintPlants(canvas, 4, { minY: 124, maxY: 146 }, ({ x, y, depth }) => buildHiveMound(x, y, 20 + depth * 20, 10 + depth * 10, { matter: '#6e461c', hole: '#2a1606' }));
    paintPlants(canvas, 5, { minY: 128, maxY: 148 }, ({ x, y, depth }) => artGroup('puddle', [createSvgElement('ellipse', { cx: roundForSvg(x), cy: roundForSvg(y), rx: roundForSvg(6 + depth * 10), ry: roundForSvg(1.5 + depth * 2), fill: '#e6c83a', opacity: 0.85 })]));
    paintSpecks(canvas, { colour: '#e8e070', count: 30, size: 1.4, opacity: 0.5, kind: 'spores' });
  },

  // Dark, craggy ground broken by towering rock spires, orange pools and pits.
  'hive-world': canvas => {
    paintSky(canvas, ['#1a120b', '#3e2412', '#7a4418']);
    paintPeaks(canvas, { colour: '#2e1e14', baseY: 104, minHeight: 30, maxHeight: 70, count: 7, sharpness: 0.85 });
    paintGround(canvas, { y: 112, top: '#3a2618', bottom: '#24160e' });
    paintPlants(canvas, 3, { minY: 118, maxY: 146 }, ({ x, y, depth }) => buildTerminidSpire(canvas, x, y, 34 + depth * 46, { matter: '#4a3020', ridge: '#2e1e14' }));
    paintPlants(canvas, 4, { minY: 122, maxY: 148 }, ({ x, y, depth }) => buildLavaPool(canvas, x, y, 10 + depth * 18, { lava: '#e07a1a', core: '#ffb347', glow: '#ff8a2a' }));
    paintPlants(canvas, 2, { minY: 126, maxY: 148 }, ({ x, y, depth }) => artGroup('pit', [createSvgElement('ellipse', { cx: roundForSvg(x), cy: roundForSvg(y), rx: roundForSvg(8 + depth * 12), ry: roundForSvg(2 + depth * 3), fill: '#080504' })]));
    paintSpecks(canvas, { colour: '#ffb060', count: 15, size: 1.3, opacity: 0.5, kind: 'embers' });
  },

  // Scorched brown grass, charred leafless trees, rock pillars and massive sharp
  // mountains under a hot, smoky sky, swept by fire tornadoes.
  'scorched-moor': canvas => {
    paintSky(canvas, ['#4a2418', '#9a4a28', '#e8a060']);
    paintPeaks(canvas, { colour: '#4a2a22', baseY: 104, minHeight: 34, maxHeight: 66, count: 7, sharpness: 0.9 });
    paintHills(canvas, '#6a4630', { baseY: 112, amplitude: 8 });
    paintGround(canvas, { y: 118, top: '#8a6236', bottom: '#5e4226' });
    paintPlants(canvas, 3, { minY: 116, maxY: 140 }, ({ x, y, depth }) => buildRockPillar(canvas, x, y, 8 + depth * 8, 18 + depth * 26, { rock: '#5e3a2c', light: '#9a6a4a' }));
    paintPlants(canvas, 5, { minY: 118, maxY: 147 }, ({ x, y, depth }) => buildBareTree(canvas, x, y, 18 + depth * 30, { colour: '#1c1411', twist: 0.3, broken: true }));
    paintGrass(canvas, { colour: '#b08a52', minY: 120, maxY: 148, count: 50 });
    paintSpecks(canvas, { colour: '#2a2020', count: 30, size: 1.2, opacity: 0.5, kind: 'ash' });
  },

  // Red algae-covered grass and rocky hills, grey rock pillars, sea cliffs,
  // a yellowish sky, and no trees at all.
  'ionic-crimson': canvas => {
    paintSky(canvas, ['#5e5436', '#a8985a', '#e6d48c']);
    paintClouds(canvas, { colour: '#8a8264', count: 4, opacity: 0.45 });
    if (canvas.chance(0.6)) paintWater(canvas, { y: 98, height: 8, colour: '#4a6a82' });
    paintHills(canvas, '#8a2c2a', { baseY: 102, amplitude: 14, jaggedness: 0.3 });
    paintHills(canvas, '#a8302a', { baseY: 116, amplitude: 9 });
    paintGround(canvas, { y: 124, top: '#b0322c', bottom: '#7a1e1e' });
    paintPlants(canvas, 4, { minY: 112, maxY: 146 }, ({ x, y, depth }) => (depth > 0.5 || canvas.chance(0.4)
      ? buildBoulder(x, y, 6 + depth * 10, 5 + depth * 8, { rock: '#6e6664', light: '#b8b0aa' })
      : buildRockPillar(canvas, x, y, 7 + depth * 6, 16 + depth * 20, { rock: '#6a6260', light: '#aaa29c' })));
    paintGrass(canvas, { colour: '#d8483e', minY: 118, maxY: 148, count: 60 });
  },

  // Orange grass, colourful shrubs and flowers, pine trees and grey rock
  // pillars under a chilly sky with a faint aurora.
  tundra: canvas => {
    paintSky(canvas, ['#233f60', '#5f86a4', '#b4ccd6']);
    paintAurora(canvas, ['#5fe0a0', '#7ff0c8']);
    paintPeaks(canvas, { colour: '#6a7a86', baseY: 100, minHeight: 16, maxHeight: 34, count: 5, snow: '#e8f0f4', sharpness: 0.5 });
    paintHills(canvas, '#a86a34', { baseY: 110, amplitude: 9 });
    paintGround(canvas, { y: 118, top: '#c07a34', bottom: '#9a5a26' });
    paintPlants(canvas, 2, { minY: 114, maxY: 138 }, ({ x, y, depth }) => buildRockPillar(canvas, x, y, 8 + depth * 7, 16 + depth * 22, { rock: '#7a7a7e', light: '#b8b8bc' }));
    paintPlants(canvas, 5, { minY: 110, maxY: 146 }, ({ x, y, depth }) => buildPineTree(x, y, 16 + depth * 30, { leaves: '#2a4636', trunk: '#3a2a1e' }));
    paintPlants(canvas, 10, { minY: 120, maxY: 148 }, ({ x, y, depth }) => buildShrub(canvas, x, y, 3 + depth * 5, ['#d0502a', '#e8a030', '#e8d04a', '#a0508a']));
    paintGrass(canvas, { colour: '#e0924a', minY: 120, maxY: 148, count: 45 });
    paintFlowers(canvas, { colours: ['#f4e04a', '#f06a8a'], count: 14, minY: 124, maxY: 148 });
  },

  // Misty highland fields of tall green grass, rocky outcrops and boulders,
  // cloudy rainy skies, and no trees.
  plains: canvas => {
    paintSky(canvas, ['#556f8e', '#8ea6b8', '#ccd8dc']);
    paintClouds(canvas, { colour: '#eef2f4', count: 5, opacity: 0.55 });
    paintHills(canvas, '#8aa294', { baseY: 96, amplitude: 14 });
    paintFog(canvas, { colour: '#dfe6e8', bands: [[78, 30, 0.45]] });
    paintHills(canvas, '#5e8a42', { baseY: 112, amplitude: 9 });
    paintGround(canvas, { y: 120, top: '#6a9a44', bottom: '#4a7a30' });
    paintPlants(canvas, 3, { minY: 110, maxY: 146 }, ({ x, y, depth }) => (canvas.chance(0.5)
      ? buildRockPillar(canvas, x, y, 8 + depth * 8, 16 + depth * 24, { rock: '#7a7c78', light: '#b8bab4' })
      : buildBoulder(x, y, 6 + depth * 10, 5 + depth * 8, { rock: '#7e807a', light: '#c0c2bc' })));
    paintGrass(canvas, { colour: '#88bc5a', minY: 116, maxY: 148, count: 80, height: 7 });
  },

  // Snowy rocky mountains, glacial ice, up-facing icicles, a few snowy pines
  // and frost flowers under a pale, cold sky.
  'icy-glaciers': canvas => {
    paintSky(canvas, ['#35557a', '#7c9cb8', '#d6e6ee']);
    paintPeaks(canvas, { colour: '#6f8494', baseY: 100, minHeight: 26, maxHeight: 52, count: 6, snow: '#f4f8fb', sharpness: 0.7 });
    paintHills(canvas, '#a8d0e6', { baseY: 110, amplitude: 10, jaggedness: 0.6 }, 'glacier');
    paintGround(canvas, { y: 118, top: '#eef4f8', bottom: '#d8e6ee' });
    paintPlants(canvas, 3, { minY: 118, maxY: 146 }, ({ x, y, depth }) => buildIcicles(canvas, x, y, 10 + depth * 16, { ice: '#bfe4f5', light: '#eaf8ff' }));
    paintPlants(canvas, 3, { minY: 112, maxY: 146 }, ({ x, y, depth }) => buildPineTree(x, y, 14 + depth * 24, { leaves: '#2e4444', trunk: '#3a2e26', snow: '#f4f8fb' }));
    paintFlowers(canvas, { colours: ['#9fdcf5'], count: 10, minY: 128, maxY: 148, size: 1.6 });
  },

  // Rock cliffs and formations covered in ice and moss, ferns and frost
  // flowers near the rocks, snow patches. (No bones, whatever the name says.)
  boneyard: canvas => {
    paintSky(canvas, ['#34403e', '#6a7a76', '#a8b4b0']);
    paintPeaks(canvas, { colour: '#555c5a', baseY: 104, minHeight: 28, maxHeight: 60, count: 6, snow: '#dfe8ea', sharpness: 0.8 });
    paintGround(canvas, { y: 112, top: '#6e7472', bottom: '#50565a' });
    paintPlants(canvas, 6, { minY: 116, maxY: 148 }, ({ x, y, depth }) => artGroup('ground-patch', [createSvgElement('ellipse', {
      cx: roundForSvg(x), cy: roundForSvg(y), rx: roundForSvg(8 + depth * 16), ry: roundForSvg(2 + depth * 3), fill: canvas.chance(0.5) ? '#5a7a44' : '#e6eef0' })]));
    paintPlants(canvas, 4, { minY: 112, maxY: 146 }, ({ x, y, depth }) => buildRockPillar(canvas, x, y, 10 + depth * 10, 18 + depth * 30, { rock: '#666c6a', light: '#a0a8a6', cap: '#6a8a4a' }));
    paintPlants(canvas, 6, { minY: 124, maxY: 148 }, ({ x, y, depth }) => buildFern(canvas, x, y, 4 + depth * 6, '#6f8f54'));
    paintFlowers(canvas, { colours: ['#a8dcf0'], count: 8, minY: 128, maxY: 148, size: 1.6 });
  },

  // Tien Kwan: the same icy, mossy rock, but darker, under greenish-grey fog,
  // with sparse dry bushes.
  'tien-kwan': canvas => {
    paintSky(canvas, ['#262e2a', '#48544e', '#76847c']);
    paintPeaks(canvas, { colour: '#3e4643', baseY: 104, minHeight: 28, maxHeight: 60, count: 6, snow: '#c8d2d0', sharpness: 0.8 });
    paintGround(canvas, { y: 112, top: '#565c58', bottom: '#3e4440' });
    paintPlants(canvas, 4, { minY: 112, maxY: 146 }, ({ x, y, depth }) => buildRockPillar(canvas, x, y, 10 + depth * 10, 18 + depth * 30, { rock: '#4e5451', light: '#7e8683', cap: '#3e5a3a' }));
    paintPlants(canvas, 6, { minY: 122, maxY: 148 }, ({ x, y, depth }) => buildShrub(canvas, x, y, 3 + depth * 4, ['#3a4a36', '#4a5446', '#5e6258']));
    paintFog(canvas, { colour: '#8fa294', bands: [[50, 60, 0.45], [100, 48, 0.35]] });
  },

  // Black basalt ridges, magma lakes and distant volcanoes under a thick ashen
  // sky that barely lets light through, with a light fog.
  magma: canvas => {
    paintSky(canvas, ['#100b0c', '#2a1512', '#6e2e16']);
    for (let volcano = 0; volcano < 2; volcano++) {
      canvas.add(buildVolcano(canvas, canvas.between(40, 420), 96, canvas.between(30, 48), canvas.between(28, 46), { rock: '#221615', glow: '#ff7a1a', smoke: '#3a2a26' }));
    }
    paintPeaks(canvas, { colour: '#1a1314', baseY: 106, minHeight: 10, maxHeight: 26, count: 8, sharpness: 0.9 });
    paintGround(canvas, { y: 108, top: '#171213', bottom: '#0c0a0a' });
    paintPlants(canvas, 4, { minY: 114, maxY: 146 }, ({ x, y, depth }) => buildLavaPool(canvas, x, y, 12 + depth * 30, { lava: '#ff6a10', core: '#ffc84a', glow: '#ff7a1a' }));
    paintLavaCracks(canvas, { colour: '#ff8a2a', count: 8, minY: 118, maxY: 148 });
    paintSpecks(canvas, { colour: '#5a4a46', count: 40, size: 1.1, opacity: 0.6, kind: 'ash' });
    paintFog(canvas, { colour: '#6a2a1a', bands: [[88, 30, 0.35]] });
  },

  // Broadleaf woodlands on rolling hills, flower meadows and shallow streams.
  'deciduous-forest': canvas => {
    paintSky(canvas, ['#3f80cc', '#86b8e0', '#d4ecf2']);
    paintSun(canvas, { colour: '#fff6d0', glow: '#fff2b0' });
    paintClouds(canvas, { colour: '#ffffff', count: 3, opacity: 0.6 });
    paintHills(canvas, '#7aa87a', { baseY: 100, amplitude: 12 });
    paintPlants(canvas, 10, { minY: 96, maxY: 104 }, ({ x, y }) => buildBroadleafTree(canvas, x, y, canvas.between(10, 16), { leaves: ['#4f7e52', '#5f9460', '#7aac78'], trunk: '#4a3a2a' }));
    paintHills(canvas, '#5a9a48', { baseY: 114, amplitude: 8 });
    paintGround(canvas, { y: 120, top: '#5aa048', bottom: '#3f8a36' });
    paintStream(canvas, { colour: '#7ec0e8', startY: 112 });
    paintPlants(canvas, 7, { minY: 114, maxY: 146 }, ({ x, y, depth }) => buildBroadleafTree(canvas, x, y, 22 + depth * 36,
      { leaves: ['#2f6e30', '#3f8a3a', '#6ab25a'], trunk: '#5a3a22' }));
    paintFlowers(canvas, { colours: ['#f2d34a', '#ffffff', '#ef86b6', '#9a70d0'], count: 40, minY: 122, maxY: 148 });
  },

  // The autumn variant of the deciduous forest: amber groves and golden grass
  // at sunset.
  'autumn-forest': canvas => {
    paintSky(canvas, ['#3a2e58', '#b0607a', '#f4a45a']);
    paintSun(canvas, { colour: '#ffd79a', glow: '#ffb060', y: canvas.between(58, 74), radius: canvas.between(12, 16) });
    paintHills(canvas, '#9a5a3a', { baseY: 102, amplitude: 12 });
    paintPlants(canvas, 10, { minY: 98, maxY: 106 }, ({ x, y }) => buildBroadleafTree(canvas, x, y, canvas.between(10, 16), { leaves: ['#a8522a', '#c06a2e', '#d88a3a'], trunk: '#3e2a1e' }));
    paintHills(canvas, '#b8843a', { baseY: 114, amplitude: 8 });
    paintGround(canvas, { y: 120, top: '#c8923e', bottom: '#a0702c' });
    paintPlants(canvas, 7, { minY: 114, maxY: 146 }, ({ x, y, depth }) => buildBroadleafTree(canvas, x, y, 22 + depth * 36,
      { leaves: ['#bf5f26', '#d9822a', '#f0b04a'], trunk: '#4a2e1e' }));
    paintGrass(canvas, { colour: '#e0b058', minY: 120, maxY: 148, count: 50 });
    paintFlowers(canvas, { colours: ['#e0702a', '#c84a22'], count: 16, minY: 124, maxY: 148, size: 1.5 });
  },

  // Broadleaf woods with crimson leaves.
  'crimson-forest': canvas => {
    paintSky(canvas, ['#4a6a9a', '#98a8c0', '#e6cfc4']);
    paintHills(canvas, '#8a5a52', { baseY: 102, amplitude: 12 });
    paintPlants(canvas, 10, { minY: 98, maxY: 106 }, ({ x, y }) => buildBroadleafTree(canvas, x, y, canvas.between(10, 16), { leaves: ['#7a2a32', '#94343a', '#b04a48'], trunk: '#3e2a24' }));
    paintHills(canvas, '#6a7a42', { baseY: 114, amplitude: 8 });
    paintGround(canvas, { y: 120, top: '#6e8246', bottom: '#526434' });
    paintPlants(canvas, 7, { minY: 114, maxY: 146 }, ({ x, y, depth }) => buildBroadleafTree(canvas, x, y, 22 + depth * 36,
      { leaves: ['#8a1e2e', '#a8283a', '#d0504a'], trunk: '#4a2e24' }));
    paintGrass(canvas, { colour: '#8aa04e', minY: 120, maxY: 148, count: 40 });
    paintFlowers(canvas, { colours: ['#ffffff', '#f2d34a'], count: 14, minY: 124, maxY: 148 });
  },

  // A rocky, lonely moon: flat grey sandy dunes covered in craters, a black
  // starry sky, a planet hanging above.
  moon: canvas => {
    paintSky(canvas, ['#04060b', '#0e1220', '#262c3a']);
    paintStars(canvas, { count: 45, maxY: 100 });
    paintSkyPlanet(canvas, { colour: '#7a9ac0', shade: '#0e1220' });
    paintHills(canvas, '#6e6e76', { baseY: 106, amplitude: 8 });
    paintGround(canvas, { y: 114, top: '#8e8e94', bottom: '#66666c' });
    paintCraters(canvas, { floor: '#5e5e64', rim: '#c8c8ce', count: 6, minY: 118, maxY: 146 });
    paintPlants(canvas, 3, { minY: 118, maxY: 146 }, ({ x, y, depth }) => buildBoulder(x, y, 4 + depth * 8, 3 + depth * 6, { rock: '#74747a', light: '#b4b4ba' }));
  },

  // A forested swamp: massive gnarled trees with thick roots and hanging
  // vines, deep water channels, fungal growths, grass and flowers under
  // filtered sunlight.
  'basic-swamp': canvas => {
    paintSky(canvas, ['#3e5846', '#7a9678', '#b8cca6']);
    canvas.add(artGroup('light-rays', [0, 1, 2].map(ray => {
      const x = canvas.between(40, 420);
      return createSvgElement('polygon', { points: `${roundForSvg(x)},0 ${roundForSvg(x + 16)},0 ${roundForSvg(x + 60)},148 ${roundForSvg(x + 30)},148`, fill: '#f6f2c8', opacity: 0.12 + ray * 0.02 });
    })));
    paintHills(canvas, '#4a6a4a', { baseY: 100, amplitude: 10, jaggedness: 0.8 }, 'treeline');
    paintPlants(canvas, 5, { minY: 98, maxY: 106 }, ({ x, y }) => buildGnarledTree(canvas, x, y, canvas.between(24, 34),
      { trunk: '#3e4a36', leaves: ['#35533a', '#42623f'], vine: '#56704a' }));
    paintWater(canvas, { y: 112, height: 36, colour: '#3e5e4e', glint: '#cfe0c0' });
    paintPlants(canvas, 4, { minY: 118, maxY: 146 }, ({ x, y, depth }) => artGroup('bank', [createSvgElement('ellipse', { cx: roundForSvg(x), cy: roundForSvg(y + 2), rx: roundForSvg(20 + depth * 30), ry: roundForSvg(3 + depth * 4), fill: '#3a5a32' })]));
    paintPlants(canvas, 4, { minY: 118, maxY: 146 }, ({ x, y, depth }) => buildGnarledTree(canvas, x, y, 52 + depth * 50,
      { trunk: '#3e2c20', leaves: ['#23401f', '#34582e'], vine: '#6a8a4a' }));
    paintPlants(canvas, 3, { minY: 126, maxY: 148 }, ({ x, y, depth }) => buildMushrooms(canvas, x, y, 3 + depth * 4, { cap: '#e8d8b8', stem: '#cfc2a4' }));
    paintGrass(canvas, { colour: '#6a9a4a', minY: 122, maxY: 148, count: 30 });
    paintFlowers(canvas, { colours: ['#f0e060', '#ffffff'], count: 8, minY: 126, maxY: 148 });
  },

  // Squelching mud, murky water and twisting roots under dim skies and thick
  // fog, with walls of rock in the distance and glowing volcano plants.
  'haunted-swamp': canvas => {
    paintSky(canvas, ['#223029', '#44574f', '#72857b']);
    paintPeaks(canvas, { colour: '#3c4a45', baseY: 104, minHeight: 22, maxHeight: 40, count: 4, sharpness: 0.2 });
    paintHills(canvas, '#33403b', { baseY: 106, amplitude: 3 }, 'far-shore');
    paintPlants(canvas, 6, { minY: 100, maxY: 108 }, ({ x, y }) => buildBareTree(canvas, x, y, canvas.between(16, 26), { colour: '#3a4843', twist: 0.55 }));
    paintFog(canvas, { colour: '#98aaa0', bands: [[64, 50, 0.6]] });
    paintGround(canvas, { y: 110, top: '#3c372d', bottom: '#29251f' });
    paintPlants(canvas, 4, { minY: 118, maxY: 146 }, ({ x, y, depth }) => artGroup('murky-water', [
      createSvgElement('ellipse', { cx: roundForSvg(x), cy: roundForSvg(y), rx: roundForSvg(18 + depth * 30), ry: roundForSvg(2 + depth * 4), fill: '#2c3d39' }),
      createSvgElement('path', { d: `M${roundForSvg(x - 8 - depth * 12)},${roundForSvg(y - 0.5)}h${roundForSvg(10 + depth * 10)}`, stroke: '#7a948a', 'stroke-width': 0.7, opacity: 0.5 }),
    ]));
    paintPlants(canvas, 5, { minY: 112, maxY: 146 }, ({ x, y, depth }) => buildBareTree(canvas, x, y, 28 + depth * 42, { colour: '#141816', twist: 0.55 }));
    let roots = '';
    for (const { x, y, depth } of scatterByDepth(canvas, 7, { minY: 124, maxY: 148 })) {
      const reach = 8 + depth * 16;
      roots += `M${roundForSvg(x)},${roundForSvg(y)} q${roundForSvg(reach / 2)},${roundForSvg(-reach * 0.8)} ${roundForSvg(reach)},0`;
    }
    canvas.add(artGroup('roots', [createSvgElement('path', { d: roots, stroke: '#1e1a15', 'stroke-width': 2.4, fill: 'none', 'stroke-linecap': 'round' })]));
    paintPlants(canvas, 3, { minY: 126, maxY: 148 }, ({ x, y }) => artGroup('volcano-plant', [
      createSvgElement('circle', { cx: roundForSvg(x), cy: roundForSvg(y - 3), r: 6, fill: '#ff6a2a', opacity: 0.3 }),
      createSvgElement('circle', { cx: roundForSvg(x), cy: roundForSvg(y - 3), r: 2.2, fill: '#ff8a4a' }),
    ]));
    paintFog(canvas, { colour: '#98aaa0', bands: [[112, 30, 0.25]] });
  },

  // Sand dunes, dead shrubs and small rocks under a blue sky with sand-coloured
  // clouds, one or more big suns and a sandstorm approaching on the horizon.
  'desert-dunes': canvas => {
    paintSky(canvas, ['#3a6ab4', '#8ab0d0', '#ecd09a']);
    paintSun(canvas, { colour: '#fff4d0', glow: '#ffe6a0', radius: canvas.between(12, 18) });
    if (canvas.chance(0.5)) paintSun(canvas, { colour: '#ffe8c0', glow: '#ffd890', radius: canvas.between(6, 10) });
    paintClouds(canvas, { colour: '#e6c890', count: 3, opacity: 0.6 });
    paintSandstorm(canvas, { colour: '#c8a068' });
    paintHills(canvas, '#dcae68', { baseY: 106, amplitude: 10 }, 'dunes');
    paintHills(canvas, '#c8944e', { baseY: 122, amplitude: 9 }, 'dunes');
    paintGround(canvas, { y: 132, top: '#b8843e', bottom: '#a47236' });
    paintPlants(canvas, 3, { minY: 122, maxY: 146 }, ({ x, y, depth }) => buildBoulder(x, y, 4 + depth * 8, 3 + depth * 6, { rock: '#9a6a44', light: '#d0a070' }));
    paintPlants(canvas, 4, { minY: 120, maxY: 146 }, ({ x, y, depth }) => buildDryShrub(canvas, x, y, 6 + depth * 10, '#7a5a3a'));
  },

  // Hilly sand and rock: stepped cliffs, large rock formations and tall dead
  // shrubs under a hot sky.
  'desert-cliffs': canvas => {
    paintSky(canvas, ['#4a70a6', '#98acc0', '#eab98a']);
    paintSun(canvas, { colour: '#fff4d6', glow: '#ffe2a8' });
    paintHills(canvas, '#b8784a', { baseY: 90, amplitude: 22, jaggedness: 0.6, flatTops: true }, 'cliffs');
    paintHills(canvas, '#a4643c', { baseY: 106, amplitude: 14, jaggedness: 0.4, flatTops: true }, 'cliffs');
    paintHills(canvas, '#c88a52', { baseY: 118, amplitude: 8 });
    paintGround(canvas, { y: 124, top: '#cf9660', bottom: '#b27646' });
    paintPlants(canvas, 3, { minY: 116, maxY: 146 }, ({ x, y, depth }) => buildRockPillar(canvas, x, y, 14 + depth * 16, 20 + depth * 34, { rock: '#9a5a36', light: '#d08a5a' }));
    paintPlants(canvas, 5, { minY: 120, maxY: 148 }, ({ x, y, depth }) => buildDryShrub(canvas, x, y, 6 + depth * 12, '#6e4e32'));
  },

  // Sand and rock with mega rock formations taller than buildings, and dead shrubs.
  'rocky-canyons': canvas => {
    paintSky(canvas, ['#5a7aa4', '#a8b8c4', '#e6bd92']);
    paintPlants(canvas, 3, { minY: 104, maxY: 112 }, ({ x, y }) => buildMesa(canvas, x, y, canvas.between(50, 90), canvas.between(40, 70), { rock: '#8a5034', light: '#c08058', strata: '#6a3a24', reachBottom: true }));
    paintHills(canvas, '#c08654', { baseY: 118, amplitude: 8 });
    paintGround(canvas, { y: 124, top: '#cc9460', bottom: '#aa7446' });
    paintPlants(canvas, 2, { minY: 124, maxY: 146 }, ({ x, y, depth }) => buildMesa(canvas, x, y, 30 + depth * 30, 20 + depth * 30, { rock: '#9c5a3a', light: '#d09068', strata: '#6e3e26' }));
    paintPlants(canvas, 5, { minY: 122, maxY: 148 }, ({ x, y, depth }) => buildDryShrub(canvas, x, y, 6 + depth * 12, '#6e4e32'));
  },

  // Toxic haze over rock and sand: mega rock formations with yellow mist
  // spilling down their sides, patches of tall grass and acid flowers.
  'acidic-badlands': canvas => {
    paintSky(canvas, ['#4e5a2c', '#98a05a', '#dcdc94']);
    paintPlants(canvas, 3, { minY: 104, maxY: 112 }, ({ x, y }) => {
      const width = canvas.between(40, 80);
      const height = canvas.between(40, 66);
      const mist = [-0.3, 0.05, 0.28].filter(() => canvas.chance(0.75)).map(across => {
        const mistX = x + across * width;
        const topY = y - height + 2;
        return createSvgElement('path', { fill: addArtGradient(canvas, [['0%', '#f4ec70', 0.6], ['100%', '#f4ec70', 0.1]]),
          d: `M${roundForSvg(mistX - 2)},${roundForSvg(topY)} Q${roundForSvg(mistX - 4)},${roundForSvg(topY + height * 0.5)} ${roundForSvg(mistX - 9)},${roundForSvg(y)} L${roundForSvg(mistX + 9)},${roundForSvg(y)} Q${roundForSvg(mistX + 4)},${roundForSvg(topY + height * 0.5)} ${roundForSvg(mistX + 2)},${roundForSvg(topY)} Z` });
      });
      return artGroup('mega-rock', [
        buildMesa(canvas, x, y, width, height, { rock: '#6e6040', light: '#a09060', strata: '#4e4430', reachBottom: true }),
        ...mist,
        createSvgElement('ellipse', { cx: roundForSvg(x), cy: roundForSvg(y), rx: roundForSvg(width * 0.75), ry: 6, fill: addArtGradient(canvas, [['0%', '#f4ec70', 0.5], ['100%', '#f4ec70', 0]], true) }),
      ]);
    });
    paintHills(canvas, '#a09456', { baseY: 118, amplitude: 8 });
    paintGround(canvas, { y: 124, top: '#b4a466', bottom: '#8e8250' });
    paintGrass(canvas, { colour: '#8aa044', minY: 122, maxY: 148, count: 40, height: 7 });
    paintFlowers(canvas, { colours: ['#d8f040'], count: 12, minY: 126, maxY: 148, size: 2 });
    paintTint(canvas, { colour: '#d8e060', from: 0.4, to: 1, opacity: 0.18, kind: 'toxic-haze' });
  },

  // Dunes around a pool of water with green palms and ferns.
  'desert-oasis': canvas => {
    paintSky(canvas, ['#3a7ac0', '#9ac0dc', '#f0d8a0']);
    paintSun(canvas, { colour: '#fff4d0', glow: '#ffe6a0' });
    paintHills(canvas, '#e0b070', { baseY: 108, amplitude: 10 }, 'dunes');
    paintGround(canvas, { y: 120, top: '#d8a864', bottom: '#c08e50' });
    const poolX = canvas.between(120, 340);
    canvas.add(artGroup('pond', [createSvgElement('ellipse', { cx: roundForSvg(poolX), cy: 134, rx: 70, ry: 8, fill: '#3fa8a0' })]));
    paintPlants(canvas, 5, { minY: 118, maxY: 146, minX: poolX - 110, maxX: poolX + 110 }, ({ x, y, depth }) => buildPalmTree(canvas, x, y, 24 + depth * 30, { trunk: '#8a6a44', fronds: '#3f8a3a' }));
    paintPlants(canvas, 6, { minY: 126, maxY: 148, minX: poolX - 100, maxX: poolX + 100 }, ({ x, y, depth }) => buildFern(canvas, x, y, 4 + depth * 6, '#4f9a45'));
  },

  // Grey sand dunes, grey drooping palms and colourless ferns under a grey sky
  // dominated by a huge eclipsed sun with a pinhole of light.
  'bleak-oasis': canvas => {
    paintSky(canvas, ['#4a4a4e', '#7c7c80', '#b4b4b4']);
    paintEclipsedSun(canvas, { ring: '#f4f4f0', glow: '#d8d8d4' });
    paintHills(canvas, '#9c9c9c', { baseY: 108, amplitude: 10 }, 'dunes');
    paintGround(canvas, { y: 120, top: '#929292', bottom: '#7a7a7a' });
    paintPlants(canvas, 5, { minY: 116, maxY: 146 }, ({ x, y, depth }) => buildPalmTree(canvas, x, y, 24 + depth * 30, { trunk: '#5e5e5e', fronds: '#8a8a8a', droop: 0.9 }));
    paintPlants(canvas, 6, { minY: 124, maxY: 148 }, ({ x, y, depth }) => buildFern(canvas, x, y, 4 + depth * 6, '#a0a0a0'));
    paintGrass(canvas, { colour: '#a8a8a8', minY: 124, maxY: 148, count: 20 });
  },

  // Super Earth: a skyline of towers with lit windows, on a dark street level.
  'super-earth': canvas => {
    paintSky(canvas, ['#1f3a64', '#4f75a4', '#9ab8dc']);
    paintClouds(canvas, { colour: '#ffffff', count: 3, opacity: 0.4 });
    paintGround(canvas, { y: 106, top: '#2c3e5e', bottom: '#18233a' });
    for (const [base, colour, minHeight, maxHeight] of [[112, '#3e5680', 30, 70], [148, '#22324e', 40, 95]]) {
      let x = -5;
      while (x < BIOME_ART_WIDTH) {
        const width = canvas.between(14, 34);
        const height = canvas.between(minHeight, maxHeight);
        const lights = [];
        if (base === 148) {
          for (let row = 0; row < height / 14; row++) {
            if (canvas.chance(0.55)) lights.push(`M${roundForSvg(x + canvas.between(3, width - 6))},${roundForSvg(base - height + 6 + row * 12)}h3`);
          }
        }
        canvas.add(artGroup('tower', [
          createSvgElement('rect', { x: roundForSvg(x), y: roundForSvg(base - height), width: roundForSvg(width - 2), height: roundForSvg(height), fill: colour }),
          lights.length ? createSvgElement('path', { d: lights.join(''), stroke: '#f5c518', 'stroke-width': 2.2, opacity: 0.85 }) : null,
        ]));
        x += width;
      }
    }
  },

  // Cyberstan: factory blocks and smoking chimneys under a red sky.
  cyberstan: canvas => {
    paintSky(canvas, ['#1c0e10', '#3e1a1a', '#6a2a26']);
    let x = -5;
    while (x < BIOME_ART_WIDTH) {
      const width = canvas.between(20, 44);
      const height = canvas.between(20, 60);
      const parts = [createSvgElement('rect', { x: roundForSvg(x), y: roundForSvg(BIOME_ART_HEIGHT - height), width: roundForSvg(width - 3), height: roundForSvg(height), fill: '#1e1416' })];
      if (canvas.chance(0.4)) {
        parts.push(createSvgElement('rect', { x: roundForSvg(x + width / 2), y: roundForSvg(BIOME_ART_HEIGHT - height - 26), width: 6, height: 26, fill: '#1e1416' }));
        parts.push(createSvgElement('circle', { cx: roundForSvg(x + width / 2 + 3), cy: roundForSvg(BIOME_ART_HEIGHT - height - 36), r: roundForSvg(canvas.between(7, 12)), fill: '#4a3434', opacity: 0.55 }));
      }
      if (canvas.chance(0.6)) parts.push(createSvgElement('rect', { x: roundForSvg(x + canvas.between(3, width - 9)), y: roundForSvg(BIOME_ART_HEIGHT - height + 6), width: 4, height: 3, fill: '#ff5a4a' }));
      canvas.add(artGroup('factory', parts));
      x += width;
    }
  },

  // Meridia: a black hole with a glowing accretion disc.
  'black-hole': canvas => {
    paintSky(canvas, ['#020205', '#05050c', '#0a0a16']);
    paintStars(canvas, { count: 50, maxY: BIOME_ART_HEIGHT });
    const x = canvas.between(170, 290);
    canvas.add(artGroup('black-hole', [
      createSvgElement('ellipse', { cx: roundForSvg(x), cy: 74, rx: 120, ry: 30, fill: addArtGradient(canvas, [['0%', '#ffb04a', 0.5], ['100%', '#ff6a2a', 0]], true) }),
      createSvgElement('ellipse', { cx: roundForSvg(x), cy: 74, rx: 96, ry: 18, fill: 'none', stroke: '#ffcf8a', 'stroke-width': 5, opacity: 0.85 }),
      createSvgElement('circle', { cx: roundForSvg(x), cy: 74, r: 30, fill: '#000000', stroke: '#ffe6b0', 'stroke-width': 1.5 }),
      createSvgElement('path', { d: `M${roundForSvg(x - 96)},74 a96,18 0 0 0 192,0`, stroke: '#fff0d0', 'stroke-width': 3, fill: 'none', opacity: 0.9 }),
    ]));
  },

  // A planet torn apart by the Meridian singularity: rock fragments floating
  // in space, lit by a purple glow.
  shattered: canvas => {
    paintSky(canvas, ['#07060c', '#120e20', '#1c1430']);
    paintStars(canvas, { count: 40, maxY: BIOME_ART_HEIGHT });
    canvas.add(createSvgElement('circle', { class: 'art-singularity-glow', cx: roundForSvg(canvas.between(20, 440)), cy: roundForSvg(canvas.between(20, 60)), r: 80, fill: addArtGradient(canvas, [['0%', '#b27aff', 0.5], ['100%', '#6a3aaa', 0]], true) }));
    for (const { x, y, depth } of scatterByDepth(canvas, 14, { minY: 20, maxY: 140 })) {
      const size = 3 + depth * 16;
      const points = [0, 1, 2, 3, 4].map(corner => {
        const angle = corner / 5 * Math.PI * 2 + canvas.between(-0.3, 0.3);
        const reach = size * canvas.between(0.6, 1);
        return `${roundForSvg(x + Math.cos(angle) * reach)},${roundForSvg(y + Math.sin(angle) * reach * 0.8)}`;
      }).join(' ');
      canvas.add(artGroup('fragment', [createSvgElement('polygon', { points, fill: mixColours('#3a3444', '#0a0812', 1 - depth), stroke: '#9a7ad0', 'stroke-width': 0.8, 'stroke-opacity': 0.6 })]));
    }
  },

  // No data: a screen without a signal.
  unknown: canvas => {
    paintSky(canvas, ['#1a1d22', '#22262c', '#2a2f36']);
    for (let band = 0; band < 14; band++) {
      canvas.add(createSvgElement('rect', { class: 'art-static', x: 0, y: roundForSvg(canvas.between(0, BIOME_ART_HEIGHT)), width: BIOME_ART_WIDTH,
        height: roundForSvg(canvas.between(1, 5)), fill: '#8d9ab2', opacity: roundForSvg(canvas.between(0.05, 0.2)) }));
    }
  },
};

// Fog colour per biome, so fog blends with the scene it covers.
const BIOME_FOG_COLOURS = {
  deadlands: '#d8d4d4', 'haunted-swamp': '#8a9c92', 'basic-swamp': '#c8d4c0', magma: '#6a2a1a', 'tien-kwan': '#8fa294',
  'ionic-jungle': '#6a8aaa', 'volcanic-jungle': '#d8e0d8', moon: '#8a8e98',
};

// A planet's landscape as an SVG: its biome's painter, then its weather.
// Labelled for screen readers as an illustration.
function buildBiomeArt(biomeLabel, planetIndex, recipe = getBiomeArtRecipe(biomeLabel, planetIndex)) {
  const biome = BIOME_PAINTERS[recipe.biome] ? recipe.biome : 'plains';
  const weather = asArray(recipe.weather);
  const random = createSeededRandom(hashText(`${biome}:${planetIndex ?? biomeLabel}`));
  const canvas = createArtCanvas(random, `biome-art-${++biomeArtCounter}`);
  BIOME_PAINTERS[biome](canvas);
  paintWeather(canvas, weather, { fogColour: BIOME_FOG_COLOURS[biome] });
  return createSvgElement('svg', {
    class: `planet-card-biome biome-art biome-${biome}`,
    viewBox: `0 0 ${BIOME_ART_WIDTH} ${BIOME_ART_HEIGHT}`,
    preserveAspectRatio: 'xMidYMid slice',
    role: 'img',
    'aria-label': `${biomeLabel} (drawn illustration)`,
    'data-biome': biome,
    'data-weather': weather.join(' '),
  }, [createSvgElement('defs', {}, canvas.definitions), ...canvas.shapes]);
}

// Any faction spelling → 'automaton' | 'terminids' | 'illuminate' | 'humans' | null.
function getFactionKey(factionName) {
  const enemyKey = normalizeFactionName(factionName);
  if (enemyKey) return enemyKey;
  const lowered = (factionName || '').toLowerCase();
  return lowered.includes('human') || lowered.includes('super earth') ? 'humans' : null;
}

// Faction icon path for any faction spelling, or null for unknown factions.
function getFactionIconFile(factionName) {
  const factionKey = getFactionKey(factionName);
  return factionKey ? FACTION_ICON_DIRECTORY + FACTION_ICON_FILE_BY_KEY[factionKey] : null;
}

// Faction key → name players use ("Automatons", "Super Earth").
function getFactionDisplayName(factionKey) {
  return FACTION_DISPLAY_NAME_BY_KEY[factionKey] || 'Unknown enemy';
}

// Known (named) effects active on one planet, deduplicated. Unknown IDs are
// left out here; advanced mode lists them by number.
function getKnownEffectNamesForPlanet(planetIndex) {
  const names = apiData.planetActiveEffects
    .filter(effect => effect.index === planetIndex && effectHasKnownName(effect.galacticEffectId))
    .map(effect => getEffectName(effect.galacticEffectId));
  return [...new Set(names)];
}

// ── DERIVED NUMBERS ──────────────────────────────────────────────────────────
// Everything here is maths on apiData; nothing is fetched. Rates are measured
// from the remembered samples, so they need a few minutes of watching first.

// Where the measuring window starts in a list of sample times (oldest first). It covers the
// last 30 minutes, reaching back to the first sample at least 30 minutes old so sparse shared
// samples still give a full half hour, but never past 2 hours and never across a gap of more
// than 45 minutes. brokenByGap says a gap cut off older samples.
function findTrendWindowStart(timestamps) {
  const latest = timestamps[timestamps.length - 1];
  let start = timestamps.length - 1;
  let brokenByGap = false;
  while (start > 0 && latest - timestamps[start] < TREND_WINDOW_MILLISECONDS) {
    const earlier = timestamps[start - 1];
    if (timestamps[start] - earlier > TREND_LARGEST_GAP_MILLISECONDS) {
      brokenByGap = true;
      break;
    }
    if (latest - earlier > TREND_LONGEST_WINDOW_MILLISECONDS) break;
    start--;
  }
  return { start, brokenByGap };
}

// How fast a planet's liberation (or defense) % is moving, from its samples.
// Returns {status:'gathering'} until the samples span long enough, or
// {status:'no-recent-data'} when a gap left too little recent history.
function calculatePlanetTrend(samples) {
  const sampleList = asArray(samples).filter(sample => isFiniteNumber(sample?.timestamp));
  if (sampleList.length < 2) return { status: 'gathering', spanMinutes: 0 };

  const latestSample = sampleList[sampleList.length - 1];
  const { start, brokenByGap } = findTrendWindowStart(sampleList.map(sample => sample.timestamp));
  const windowSamples = sampleList.slice(start);
  const earliestSample = windowSamples[0];
  const spanMilliseconds = latestSample.timestamp - earliestSample.timestamp;
  const spanMinutes = spanMilliseconds / 60000;

  if (spanMilliseconds < TREND_MINIMUM_SPAN_MILLISECONDS) {
    return { status: brokenByGap ? 'no-recent-data' : 'gathering', spanMinutes };
  }

  const measuredField = latestSample.defensePercent !== null ? 'defensePercent' : 'liberationPercent';
  if (!isFiniteNumber(earliestSample[measuredField]) || !isFiniteNumber(latestSample[measuredField])) {
    return { status: 'gathering', spanMinutes };
  }

  const percentPerHour =
    (latestSample[measuredField] - earliestSample[measuredField]) / (spanMilliseconds / 3600000);
  if (!isFiniteNumber(percentPerHour)) return { status: 'gathering', spanMinutes };

  return {
    status: 'measured',
    percentPerHour,
    spanMinutes,
    sampleCount: windowSamples.length,
    // A planet stuck at 0% hides how hard players are pushing: health is
    // capped at max, so all we know is that they are not out-damaging regen.
    isPinnedAtZero: windowSamples.every(sample => sample[measuredField] === 0),
  };
}

// The measured trend for a planet, from the shared history and the page's own samples.
function getPlanetTrend(planet) {
  return calculatePlanetTrend(getPlanetSamples(planet));
}

// An ETA or duration in hours, or null when it is negative, infinite or not a number.
function sanitizeHours(hours) {
  return isFiniteNumber(hours) && hours >= 0 ? hours : null;
}

// A whole number of Helldivers, or null when the maths ran off the rails.
function sanitizePlayerCount(count) {
  return isFiniteNumber(count) && count >= 0 ? Math.ceil(count) : null;
}

// Absolute planet health players remove per hour, per Helldiver, from a trend.
// Null when it can't be measured (no trend, pinned at 0%, too few players).
function calculateOutputPerPlayer(planet, trend) {
  const playerCount = planet.statistics?.playerCount || 0;
  if (!hasKnownHealth(planet) || trend.status !== 'measured' || trend.isPinnedAtZero) return null;
  if (playerCount < MINIMUM_PLAYERS_FOR_OUTPUT_ESTIMATE) return null;

  const netHealthPerHour   = trend.percentPerHour / 100 * planet.maxHealth;
  const regenHealthPerHour = (planet.regenPerSecond || 0) * 3600;
  const playerHealthPerHour = netHealthPerHour + regenHealthPerHour;
  return playerHealthPerHour > 0 ? playerHealthPerHour / playerCount : null;
}

// Median per-Helldiver output across every measurable liberation front, used
// to estimate planets whose own numbers can't show it (e.g. stuck at 0%).
function estimateGalaxyOutputPerPlayer() {
  const outputs = apiData.activeCampaigns
    .map(campaign => campaign.planet)
    .filter(planet => planet && !planetIsUnderAttack(planet))
    .map(planet => calculateOutputPerPlayer(planet, getPlanetTrend(planet)))
    .filter(isFiniteNumber)
    .sort((first, second) => first - second);
  if (outputs.length === 0) return null;
  const middle = Math.floor(outputs.length / 2);
  return outputs.length % 2 ? outputs[middle] : (outputs[middle - 1] + outputs[middle]) / 2;
}

// Is this liberation being won? Combines liberation %, enemy regen, the
// measured trend and player count into one verdict plus the numbers behind it.
// verdict: 'liberated' | 'winning' | 'stalled' | 'losing' | 'unknown'
function describeLiberationOutlook(planet, trend, galaxyOutputPerPlayer = null) {
  const playerCount = planet.statistics?.playerCount || 0;
  const outlook = {
    verdict: 'unknown',
    liberationPercent: null,
    regenPercentPerHour: null,
    netPercentPerHour: null,
    playerOutputPercentPerHour: null,
    playersNeededToOutpaceRegen: null,
    playersNeededIsGalaxyEstimate: false,
    hoursToLiberation: null,
    trendStatus: trend.status,
    trendSpanMinutes: trend.spanMinutes || 0,
    playerCount,
  };
  if (!hasKnownHealth(planet)) return outlook;

  outlook.liberationPercent   = getLiberationPercent(planet);
  outlook.regenPercentPerHour = getEnemyRegenPercentPerHour(planet);
  if (outlook.liberationPercent >= 100) return { ...outlook, verdict: 'liberated' };

  const ownOutputPerPlayer = calculateOutputPerPlayer(planet, trend);
  const outputPerPlayer = ownOutputPerPlayer ?? galaxyOutputPerPlayer;
  const regenHealthPerHour = (planet.regenPerSecond || 0) * 3600;
  if (isFiniteNumber(outputPerPlayer) && outputPerPlayer > 0 && regenHealthPerHour > 0) {
    outlook.playersNeededToOutpaceRegen = sanitizePlayerCount(regenHealthPerHour / outputPerPlayer);
    outlook.playersNeededIsGalaxyEstimate = ownOutputPerPlayer === null;
  }

  if (trend.status !== 'measured') return outlook;

  outlook.netPercentPerHour = trend.percentPerHour;
  if (!trend.isPinnedAtZero) {
    outlook.playerOutputPercentPerHour = trend.percentPerHour + outlook.regenPercentPerHour;
  }

  if (trend.isPinnedAtZero || Math.abs(trend.percentPerHour) <= TREND_STALL_THRESHOLD_PERCENT_PER_HOUR) {
    outlook.verdict = 'stalled';
  } else if (trend.percentPerHour > 0) {
    outlook.verdict = 'winning';
    outlook.hoursToLiberation = sanitizeHours((100 - outlook.liberationPercent) / trend.percentPerHour);
  } else {
    outlook.verdict = 'losing';
  }
  return outlook;
}

// Can this defense still be won before its deadline? Uses the measured trend,
// or (primary API only) the average pace since the attack started.
// verdict: 'won' | 'expired' | 'on-track' | 'at-risk' | 'losing' | 'unknown'
function describeDefenseOutlook(planet, trend, nowTimestamp = Date.now()) {
  const defenseEvent = planet.event || {};
  const progressPercent = getDefenseProgressPercent(defenseEvent);
  const endTimestamp = Date.parse(defenseEvent.endTime || '');
  const hoursLeft = isNaN(endTimestamp) ? null : Math.max(0, (endTimestamp - nowTimestamp) / 3600000);
  const playerCount = planet.statistics?.playerCount || 0;

  const outlook = {
    verdict: 'unknown',
    progressPercent,
    hoursLeft,
    ratePercentPerHour: null,
    rateSource: null,
    requiredPercentPerHour: null,
    projectedPercentAtDeadline: null,
    hoursToWin: null,
    playersNeededToWinInTime: null,
    playerCount,
    trendStatus: trend.status,
  };

  if (progressPercent >= 100) return { ...outlook, verdict: 'won' };
  if (hoursLeft === 0) return { ...outlook, verdict: 'expired' };
  if (hoursLeft !== null) outlook.requiredPercentPerHour = (100 - progressPercent) / hoursLeft;

  const startTimestamp = Date.parse(defenseEvent.startTime || '');
  const millisecondsSinceStart = nowTimestamp - startTimestamp;
  if (trend.status === 'measured') {
    outlook.ratePercentPerHour = trend.percentPerHour;
    outlook.rateSource = 'measured';
  } else if (!isNaN(startTimestamp) && millisecondsSinceStart >= DEFENSE_MINIMUM_ELAPSED_FOR_AVERAGE_MILLISECONDS) {
    outlook.ratePercentPerHour = progressPercent / (millisecondsSinceStart / 3600000);
    outlook.rateSource = 'average-since-start';
  }

  const rate = outlook.ratePercentPerHour;
  if (rate === null || hoursLeft === null) return outlook;

  outlook.projectedPercentAtDeadline = Math.max(0, Math.min(100, progressPercent + rate * hoursLeft));
  if (rate > 0) outlook.hoursToWin = sanitizeHours((100 - progressPercent) / rate);
  if (rate > 0 && playerCount > 0) {
    outlook.playersNeededToWinInTime = sanitizePlayerCount(playerCount * outlook.requiredPercentPerHour / rate);
  }

  if (progressPercent + rate * hoursLeft >= 100) outlook.verdict = 'on-track';
  else if (rate <= 0) outlook.verdict = 'losing';
  else outlook.verdict = 'at-risk';
  return outlook;
}

// Which planets and enemy factions the current assignments point players at.
// Faction targets only come from tasks without a planet (e.g. "kill 5M bugs").
function getMajorOrderTargets(assignments = apiData.assignments) {
  const planetIndexes = new Set();
  const factionKeys = new Set();
  for (const assignment of asArray(assignments)) {
    for (const task of asArray(assignment.tasks)) {
      const { planetIndex } = getTaskLocation(task);
      const factionId   = getTaskValue(task, TASK_VALUE_TYPE.FACTION_ID);
      if (isFiniteNumber(planetIndex)) {
        planetIndexes.add(planetIndex);
      } else if (isFiniteNumber(factionId)) {
        const factionKey = normalizeFactionName(FACTION_NAME_BY_ID[factionId]);
        if (factionKey) factionKeys.add(factionKey);
      }
    }
  }
  return { planetIndexes, factionKeys };
}

// Turns one assignment task into a sentence and a progress figure. The owner's
// wording fixes (major-order-fixes.js) replace a sentence the page got wrong.
function describeAssignmentTask(task, progressValue) {
  const fixes = getMajorOrderFixes();
  const description = describeAssignmentTaskAutomatically(task, progressValue);
  const fix = fixes.taskText.find(entry => entry.pageSays.trim() === description.sentence);
  if (fix) {
    description.automaticSentence = description.sentence;
    description.sentence = fix.showInstead.trim();
  }
  return description;
}

// The page's own wording of one task, from the game's numbers. It names the
// enemy faction, not the exact enemy, so it can be less exact than the game.
function describeAssignmentTaskAutomatically(task, progressValue) {
  const targetAmount = getTaskValue(task, TASK_VALUE_TYPE.TARGET_AMOUNT);
  const { planetIndex, sectorIndex } = getTaskLocation(task);
  const factionId    = getTaskValue(task, TASK_VALUE_TYPE.FACTION_ID);
  const planet       = isFiniteNumber(planetIndex) ? apiData.planetsByIndex[planetIndex] : null;
  const planetName   = planet ? planet.name : (isFiniteNumber(planetIndex) ? `planet #${planetIndex}` : null);
  // Sector names aren't in the feeds by index, so a sector is named by its number.
  const placeText    = planetName ? ` on ${planetName}` : (isFiniteNumber(sectorIndex) ? ` in sector #${sectorIndex}` : '');
  const factionName  = isFiniteNumber(factionId) ? (FACTION_NAME_BY_ID[factionId] || null) : null;
  const progress     = isFiniteNumber(progressValue) ? progressValue : 0;

  const description = {
    sentence: '',
    progressPercent: null,
    progressText: '',
    isComplete: false,
    planetIndex: isFiniteNumber(planetIndex) ? planetIndex : null,
    sectorIndex: isFiniteNumber(sectorIndex) ? sectorIndex : null,
    factionName,
  };

  if (task.type === TASK_TYPE.LIBERATE_PLANET || task.type === TASK_TYPE.HOLD_PLANET) {
    const verb = task.type === TASK_TYPE.LIBERATE_PLANET ? 'Liberate' : 'Hold';
    description.sentence = `${verb} ${planetName || 'the target planet'}`;
    const planetIsOurs = planet ? planet.currentOwner === 'Humans' && !planetIsUnderAttack(planet) : false;
    description.isComplete = progress >= 1 || (task.type === TASK_TYPE.LIBERATE_PLANET && planetIsOurs);
    if (description.isComplete) {
      description.progressPercent = 100;
      description.progressText = task.type === TASK_TYPE.HOLD_PLANET ? 'Held' : 'Liberated';
    } else if (planet && hasKnownHealth(planet) && planet.currentOwner !== 'Humans') {
      description.progressPercent = getLiberationPercent(planet);
      description.progressText = `${formatPercent(description.progressPercent)} liberated`;
    } else {
      description.progressText = task.type === TASK_TYPE.HOLD_PLANET ? 'Not held' : 'Not liberated';
    }
    return description;
  }

  const factionKey = normalizeFactionName(factionName);
  const factionText = factionKey ? getFactionDisplayName(factionKey) : null;
  if (task.type === TASK_TYPE.ERADICATE) {
    description.sentence = `Kill ${formatBigNumber(targetAmount)} ${factionText || 'enemies'}${placeText}`;
  } else if (task.type === TASK_TYPE.COMPLETE_OPERATIONS) {
    description.sentence = `Complete ${formatBigNumber(targetAmount)} operations`
      + (factionText ? ` against the ${factionText}` : '') + placeText;
  } else {
    // Unknown task type: say what we know without guessing what it means.
    const details = [planetName, isFiniteNumber(sectorIndex) ? `sector #${sectorIndex}` : null, factionText]
      .filter(Boolean).join(', ');
    description.sentence = `Objective (type ${task.type ?? '?'})` + (details ? `: ${details}` : '');
  }

  if (isFiniteNumber(targetAmount) && targetAmount > 0) {
    description.progressPercent = Math.max(0, Math.min(100, progress / targetAmount * 100));
    description.progressText = `${formatBigNumber(progress)} / ${formatBigNumber(targetAmount)}`;
    description.isComplete = progress >= targetAmount;
  } else {
    description.progressText = formatBigNumber(progress);
  }
  return description;
}

// Liberation campaigns ranked by how much a drop there matters right now,
// each with plain-language reasons. Defenses are ranked separately.
function rankLiberationCampaigns(nowTimestamp = Date.now()) {
  const majorOrderTargets = getMajorOrderTargets();
  const galaxyOutputPerPlayer = estimateGalaxyOutputPerPlayer();
  const liberationCampaigns = apiData.activeCampaigns.filter(campaign =>
    campaign.planet && !planetIsUnderAttack(campaign.planet));
  const mostPlayersOnOnePlanet = Math.max(0, ...liberationCampaigns.map(campaign =>
    campaign.planet.statistics?.playerCount || 0));

  const ranked = liberationCampaigns.map(campaign => {
    const planet = campaign.planet;
    const outlook = describeLiberationOutlook(planet, getPlanetTrend(planet), galaxyOutputPerPlayer);
    const factionKey = getEnemyFactionOnPlanet(planet);
    const isMajorOrderPlanet = majorOrderTargets.planetIndexes.has(planet.index);
    const countsForMajorOrderFaction = !isMajorOrderPlanet && factionKey !== null &&
      majorOrderTargets.factionKeys.has(factionKey);
    const playerCount = planet.statistics?.playerCount || 0;
    const liberationPercent = outlook.liberationPercent || 0;

    let score = liberationPercent;
    const reasons = [];
    if (isMajorOrderPlanet)         { score += 1000; reasons.push('Major Order target'); }
    if (countsForMajorOrderFaction) { score += 300;  reasons.push('Counts toward the Major Order'); }

    if (outlook.verdict === 'winning') {
      score += 200;
      if (outlook.hoursToLiberation !== null && outlook.hoursToLiberation < 6) score += 100;
      reasons.push(`Liberation in about ${formatDuration(outlook.hoursToLiberation * 3600)} at this pace`);
    } else if (outlook.verdict === 'stalled') {
      score -= 100;
      reasons.push('Stalled: enemy regeneration is keeping up');
    } else if (outlook.verdict === 'losing') {
      score -= 150;
      reasons.push('Losing ground');
    } else if (liberationPercent >= 75) {
      reasons.push(`Nearly liberated (${formatPercent(liberationPercent, 0)})`);
    }

    if (mostPlayersOnOnePlanet > 0) score += 100 * playerCount / mostPlayersOnOnePlanet;
    if (playerCount > 0 && playerCount === mostPlayersOnOnePlanet) reasons.push('Most Helldivers are here');

    return { campaign, planet, outlook, reasons, score, isMajorOrderPlanet, countsForMajorOrderFaction };
  });

  return ranked.sort((first, second) => second.score - first.score);
}

// Defenses, most urgent first: losing and at-risk before on-track, then by deadline.
function rankDefenses(nowTimestamp = Date.now()) {
  const verdictUrgency = { losing: 0, 'at-risk': 1, unknown: 2, 'on-track': 3, expired: 4, won: 5 };
  const majorOrderTargets = getMajorOrderTargets();
  return apiData.planets
    .filter(planet => planetIsUnderAttack(planet))
    .map(planet => ({
      planet,
      outlook: describeDefenseOutlook(planet, getPlanetTrend(planet), nowTimestamp),
      isMajorOrderPlanet: majorOrderTargets.planetIndexes.has(planet.index),
    }))
    .sort((first, second) =>
      (verdictUrgency[first.outlook.verdict] - verdictUrgency[second.outlook.verdict]) ||
      ((first.outlook.hoursLeft ?? Infinity) - (second.outlook.hoursLeft ?? Infinity)));
}

// Players, campaigns and defenses per enemy faction, biggest front first.
function summarizeFronts() {
  const frontByFaction = {};
  for (const campaign of apiData.activeCampaigns) {
    const planet = campaign.planet;
    const factionKey = planet ? getEnemyFactionOnPlanet(planet) : null;
    if (!factionKey) continue;
    const front = frontByFaction[factionKey] ||
      (frontByFaction[factionKey] = { factionKey, playerCount: 0, campaignCount: 0, defenseCount: 0 });
    front.playerCount += planet.statistics?.playerCount || 0;
    front.campaignCount++;
    if (planetIsUnderAttack(planet)) front.defenseCount++;
  }
  return Object.values(frontByFaction).sort((first, second) => second.playerCount - first.playerCount);
}

// ── ORCHESTRATOR ─────────────────────────────────────────────────────────────

let lastErrorMessage = '';

// Picks the API per serverPreference, downloads everything, post-processes.
// Returns true on success, false if every allowed source failed.
// onPartialDataReady (optional) fires once the primary's fast feeds are in,
// so the page can render ~10 s before the heavy feeds arrive.
async function downloadAllData(onPartialDataReady) {
  lastErrorMessage = '';
  lastFeedWarnings = [];

  let supplementalDownload = null;
  const startSupplementalDownload = () => {
    supplementalDownload = supplementalDownload || downloadSupplementalFeeds();
    return supplementalDownload;
  };

  // Runs between the primary's two waves; a rendering error must never be
  // mistaken for an API failure and trigger the fallback.
  const handleFastWaveReady = () => {
    startSupplementalDownload();
    try {
      processFreshBattleData();
      if (onPartialDataReady) onPartialDataReady();
    } catch (error) {
      console.error('Partial render failed:', error);
    }
  };

  try {
    if (serverPreference === 'backup') {
      await downloadEverythingFromBackupApi();
    } else {
      try {
        await downloadEverythingFromPrimaryApi(handleFastWaveReady);
      } catch (primaryApiError) {
        lastErrorMessage = primaryApiError.message;

        if (serverPreference === 'live') {
          apiData.currentDataSource = null;
          return false;
        }

        await downloadEverythingFromBackupApi();
      }
    }
  } catch (everyApiError) {
    lastErrorMessage = everyApiError.message;
    apiData.currentDataSource = null;
    return false;
  }

  if (apiData.currentDataSource === 'PRIMARY') {
    const freshBackupStatus = await startSupplementalDownload();
    if (freshBackupStatus) {
      rememberBackupWarStatus(freshBackupStatus, Date.now());
    } else {
      applyCachedBackupWarStatus();
    }
  } else {
    // The backup path already read /war/status this cycle; only names are missing.
    await downloadEffectNamesDatabase();
  }

  processFreshBattleData();
  apiData.lastSuccessfulFetchTimestamp = Date.now();
  return true;
}

// ── CONNECTION STATE ─────────────────────────────────────────────────────────

let refreshInProgress = null;
let lastRefreshFailed = false;

// What the status bar should say about where the data came from and how
// fresh it is. kind: 'loading' | 'live' | 'fallback' | 'stale' | 'offline'
function describeConnectionState(nowTimestamp = Date.now()) {
  const allMessages = [lastErrorMessage, ...lastFeedWarnings].join(' ');
  const state = {
    kind: 'loading',
    sourceLabel: apiData.currentDataSource || 'OFFLINE',
    isRefreshing: refreshInProgress !== null,
    isStale: false,
    wasRateLimited: /HTTP 429/.test(allMessages),
    dataAgeText: formatTimeAgo(apiData.lastSuccessfulFetchTimestamp, nowTimestamp),
    errorMessage: lastErrorMessage,
    feedWarnings: [...lastFeedWarnings],
  };
  // During the first cycle the fast feeds render before the heavy wave has
  // finished, so a known source already counts as having data.
  const hasData = apiData.lastSuccessfulFetchTimestamp !== null || apiData.currentDataSource !== null;
  if (apiData.lastSuccessfulFetchTimestamp === null && hasData) state.dataAgeText = 'just now';

  if (lastRefreshFailed) {
    state.kind = hasData ? 'stale' : 'offline';
    state.isStale = hasData;
  } else if (!hasData) {
    state.kind = 'loading';
  } else if (apiData.currentDataSource === 'FALLBACK') {
    state.kind = 'fallback';
  } else {
    state.kind = 'live';
  }
  return state;
}

// ── VIEW MODE ────────────────────────────────────────────────────────────────
// Simple mode answers "where do I drop?" in five seconds; advanced mode shows
// everything; guide mode explains the game. The two war views render on every
// refresh and the guide once; switching only hides views.

// The remembered view mode, or 'simple' when nothing valid is stored.
function readViewMode() {
  const stored = readStoredValue(VIEW_MODE_STORAGE_KEY);
  return VIEW_MODES.includes(stored) ? stored : 'simple';
}

let viewMode = readViewMode();

// Called by the header buttons: remembers the mode and shows it.
function changeViewMode(newMode) {
  if (!VIEW_MODES.includes(newMode)) return;
  viewMode = newMode;
  writeStoredValue(VIEW_MODE_STORAGE_KEY, newMode);
  applyViewMode();
}

// Shows the current mode's view, hides the other, and updates the buttons.
function applyViewMode() {
  document.body.dataset.currentView = viewMode;
  for (const view of document.querySelectorAll('[data-view]')) {
    view.hidden = view.dataset.view !== viewMode;
  }
  for (const button of document.querySelectorAll('.view-mode-button')) {
    button.setAttribute('aria-pressed', String(button.dataset.viewMode === viewMode));
  }
  for (const element of document.querySelectorAll('.advanced-only')) {
    element.hidden = viewMode !== 'advanced';
  }
}

// ── DOM BUILDERS ─────────────────────────────────────────────────────────────
// Every string from an API goes into the page through textContent, never as
// HTML, so a planet name can't inject markup.

// Creates an element with a class, text, attributes and children in one call.
function buildElement(tagName, options = {}, children = []) {
  const element = document.createElement(tagName);
  if (options.className) element.className = options.className;
  if (options.text !== undefined && options.text !== null) element.textContent = String(options.text);
  for (const [attributeName, attributeValue] of Object.entries(options.attributes || {})) {
    if (attributeValue === null || attributeValue === undefined || attributeValue === false) continue;
    element.setAttribute(attributeName, attributeValue === true ? '' : String(attributeValue));
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) element.append(child);
  }
  return element;
}

// An <img> with alt text and a fixed size (no layout jump while it loads).
function buildImage(path, altText, className, width, height) {
  return buildElement('img', {
    className,
    attributes: { src: encodeURI(path), alt: altText, width, height, loading: 'lazy', decoding: 'async' },
  });
}

// A labelled progress bar; its colour comes from the status class.
function buildMeter(percent, label, statusName = 'neutral') {
  const clampedPercent = isFiniteNumber(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  const fill = buildElement('div', { className: 'meter-fill' });
  fill.style.width = `${clampedPercent}%`;
  return buildElement('div', {
    className: `meter status-${statusName}`,
    attributes: {
      role: 'progressbar',
      'aria-label': label,
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': Number(clampedPercent.toFixed(1)),
      'aria-valuetext': isFiniteNumber(percent) ? `${formatPercent(percent)} ${label.toLowerCase()}` : 'unknown',
    },
  }, [fill]);
}

// A status line: an icon (hidden from screen readers) plus words that carry the meaning.
function buildStatusLine(verdictLine, className = 'verdict') {
  return buildElement('p', { className: `${className} status-${verdictLine.status}` }, [
    buildElement('span', { className: 'status-icon', text: verdictLine.icon, attributes: { 'aria-hidden': 'true' } }),
    buildElement('span', { text: verdictLine.text }),
  ]);
}

// A <dl> of label → value pairs; pairs with an empty value are skipped.
function buildFactList(facts, className = 'fact-list') {
  const children = [];
  for (const [label, value] of facts) {
    if (value === null || value === undefined || value === '') continue;
    children.push(buildElement('div', { className: 'fact' }, [
      buildElement('dt', { text: label }),
      buildElement('dd', { text: value }),
    ]));
  }
  return buildElement('dl', { className }, children);
}

// Game text with <i=N>…</i> highlight markup → paragraphs with <strong>
// highlights; any other tag is dropped.
function buildGameMessage(message) {
  const paragraphs = String(message || '').split(/\n\s*\n/).filter(paragraph => paragraph.trim());
  return paragraphs.map(paragraph => {
    const paragraphElement = buildElement('p');
    const highlightPattern = /<i=\d+>([\s\S]*?)<\/i>/g;
    let lastIndex = 0;
    for (const match of paragraph.matchAll(highlightPattern)) {
      paragraphElement.append(stripGameMarkup(paragraph.slice(lastIndex, match.index)));
      paragraphElement.append(buildElement('strong', { text: stripGameMarkup(match[1]) }));
      lastIndex = match.index + match[0].length;
    }
    paragraphElement.append(stripGameMarkup(paragraph.slice(lastIndex)));
    return paragraphElement;
  });
}

// Replaces everything inside an element (by id) with the given nodes.
function replaceContent(elementId, nodes) {
  const element = document.getElementById(elementId);
  if (element) element.replaceChildren(...asArray(nodes).filter(Boolean));
}

// True once any source has delivered data (even just the first fast wave).
function hasAnyData() {
  return apiData.currentDataSource !== null || apiData.lastSuccessfulFetchTimestamp !== null;
}

// What an empty section says before the first data arrives, or while offline.
function buildWaitingMessage() {
  const state = describeConnectionState();
  const text = state.kind === 'offline'
    ? 'Can\'t reach the war servers right now. The page keeps retrying.'
    : 'Waiting for the first report from Super Earth…';
  return buildElement('p', { className: 'empty-state', text });
}

// ── PLAIN-LANGUAGE VERDICTS ──────────────────────────────────────────────────

// A liberation outlook → {status, icon, text} for the card's status line.
function describeLiberationVerdict(outlook) {
  switch (outlook.verdict) {
    case 'liberated':
      return { status: 'good', icon: '✔', text: 'Liberated' };
    case 'winning':
      if (outlook.hoursToLiberation === null || outlook.hoursToLiberation > ETA_LONGEST_HOURS) {
        return { status: 'good', icon: '▲', text: 'Winning slowly — more than two weeks to go at this pace' };
      }
      return { status: 'good', icon: '▲',
        text: `Winning — liberated in about ${formatDuration(outlook.hoursToLiberation * 3600)} at this pace` };
    case 'stalled':
      return { status: 'warning', icon: '■',
        text: outlook.playersNeededToOutpaceRegen
          ? `Stalled — needs about ${formatBigNumber(outlook.playersNeededToOutpaceRegen)} Helldivers to out-fight the enemy's recovery`
          : 'Stalled — the enemy recovers as fast as we push' };
    case 'losing':
      return { status: 'critical', icon: '▼', text: 'Losing ground — the enemy is taking it back' };
    default:
      return outlook.trendStatus === 'no-recent-data'
        ? { status: 'neutral', icon: '…', text: 'Not enough recent data for a pace yet' }
        : { status: 'neutral', icon: '…', text: 'Measuring progress — needs a few minutes of watching' };
  }
}

// A defense outlook → {status, icon, text} for the card's status line.
function describeDefenseVerdict(outlook) {
  const timeLeft = outlook.hoursLeft !== null ? formatDuration(outlook.hoursLeft * 3600) : null;
  switch (outlook.verdict) {
    case 'won':
      return { status: 'good', icon: '✔', text: 'Defended' };
    case 'expired':
      return { status: 'neutral', icon: '•', text: 'Deadline passed — waiting for the result' };
    case 'on-track':
      return { status: 'good', icon: '✔',
        text: (outlook.hoursToWin !== null ? `On track — held in about ${formatDuration(outlook.hoursToWin * 3600)}` : 'On track')
          + (timeLeft ? `, ${timeLeft} before the deadline` : '') };
    case 'at-risk':
      return { status: 'warning', icon: '▲',
        text: outlook.playersNeededToWinInTime
          ? `At risk — needs about ${formatBigNumber(outlook.playersNeededToWinInTime)} Helldivers (has ${formatBigNumber(outlook.playerCount)})`
          : `At risk — needs ${(outlook.requiredPercentPerHour / outlook.ratePercentPerHour).toFixed(1)}× the current pace` };
    case 'losing':
      return { status: 'critical', icon: '✖', text: 'Being lost — no progress against the attack' };
    default:
      return { status: 'neutral', icon: '…',
        text: (outlook.trendStatus === 'no-recent-data' ? 'Not enough recent data for a pace yet' : 'Measuring progress')
          + (timeLeft ? ` — deadline in ${timeLeft}` : '') };
  }
}

// An assignment reward → "45 Medals" (type 1 is Medals in the API docs) or just the amount.
function describeReward(reward) {
  if (!isPlainObject(reward) || !isFiniteNumber(reward.amount)) return '';
  return reward.type === 1 ? `${formatBigNumber(reward.amount)} Medals` : formatBigNumber(reward.amount);
}

// ── PLANET CARDS (TASKS 1) ───────────────────────────────────────────────────

// The landscape at the top of a planet card, drawn from its biome and weather.
function buildBiomeBanner(planet) {
  return buildBiomeArt(getBiomeDisplayName(planet), planet.index, getBiomeArtRecipe(planet.biome?.name, planet.index, planet.hazards));
}

// Chips for weather hazards and known planet effects ("Tremors", "Jet Brigade").
function buildConditionChips(planet, limit = 4) {
  const hazardNames = asArray(planet.hazards)
    .map(hazard => hazard.name).filter(name => name && name !== 'None');
  const conditionNames = [...new Set([...hazardNames, ...getKnownEffectNamesForPlanet(planet.index)])];
  if (conditionNames.length === 0) return null;
  const shownNames = conditionNames.slice(0, limit);
  const chips = shownNames.map(name => buildElement('li', { className: 'chip', text: name }));
  if (conditionNames.length > limit) {
    chips.push(buildElement('li', { className: 'chip chip-more', text: `+${conditionNames.length - limit} more` }));
  }
  return buildElement('ul', { className: 'chip-list', attributes: { 'aria-label': 'Conditions' } }, chips);
}

// One planet card. Pass liberationOutlook for a liberation, defenseOutlook for
// a defense; reasons are the "why this planet" chips.
function buildPlanetCard(planet, { idPrefix, reasons = [], liberationOutlook = null,
                                   defenseOutlook = null, isMajorOrderPlanet = false, extraContent = [] }) {
  const isDefense = defenseOutlook !== null;
  const enemyKey = getEnemyFactionOnPlanet(planet);
  const headingId = `${idPrefix}-planet-${planet.index}`;
  const enemyName = enemyKey ? getFactionDisplayName(enemyKey) : 'Unknown enemy';
  const enemyIcon = enemyKey ? getFactionIconFile(enemyKey) : null;

  const reasonChips = reasons.length === 0 ? null : buildElement('ul', { className: 'reason-list' },
    reasons.map(reason => buildElement('li', {
      className: reason === 'Major Order target' ? 'reason reason-major-order' : 'reason',
      text: reason,
    })));

  let meter;
  let headline;
  let facts;
  let verdictLine;
  if (isDefense) {
    verdictLine = describeDefenseVerdict(defenseOutlook);
    meter = buildMeter(defenseOutlook.progressPercent, 'Defended', verdictLine.status);
    headline = `${formatPercent(defenseOutlook.progressPercent)} defended`;
    facts = [
      ['Time left', defenseOutlook.hoursLeft !== null ? formatDuration(defenseOutlook.hoursLeft * 3600) : 'unknown'],
      ['Helldivers here', formatBigNumber(defenseOutlook.playerCount)],
      ['Current pace', isFiniteNumber(defenseOutlook.ratePercentPerHour)
        ? formatPercentPerHour(defenseOutlook.ratePercentPerHour) : 'measuring…'],
      ['Pace needed', isFiniteNumber(defenseOutlook.requiredPercentPerHour)
        ? formatPercentPerHour(defenseOutlook.requiredPercentPerHour) : null],
    ];
  } else {
    const outlook = liberationOutlook;
    verdictLine = describeLiberationVerdict(outlook);
    meter = buildMeter(outlook.liberationPercent, 'Liberated', verdictLine.status);
    headline = `${formatPercent(outlook.liberationPercent)} liberated`;
    facts = [
      ['Helldivers here', formatBigNumber(outlook.playerCount)],
      ['Enemy recovers', isFiniteNumber(outlook.regenPercentPerHour)
        ? formatEnemyRecovery(outlook.regenPercentPerHour) : null],
      ['Net progress', isFiniteNumber(outlook.netPercentPerHour)
        ? formatPercentPerHour(outlook.netPercentPerHour) : 'measuring…'],
    ];
  }

  return buildElement('article', {
    className: `planet-card faction-${enemyKey || 'unknown'}${isMajorOrderPlanet ? ' is-major-order' : ''}`,
    attributes: { 'aria-labelledby': headingId },
  }, [
    buildBiomeBanner(planet),
    buildElement('div', { className: 'planet-card-body' }, [
      buildElement('header', { className: 'planet-card-header' }, [
        enemyIcon ? buildImage(enemyIcon, enemyName, 'faction-icon', 28, 28) : null,
        buildElement('div', {}, [
          buildElement('h3', { className: 'planet-card-name', text: planet.name, attributes: { id: headingId } }),
          buildElement('p', { className: 'planet-card-subline',
            text: [isDefense ? `Under ${enemyName} attack` : `${enemyName}-held`,
                   planet.sector ? `${planet.sector} sector` : null].filter(Boolean).join(' · ') }),
        ]),
      ]),
      reasonChips,
      buildElement('p', { className: 'planet-card-headline', text: headline }),
      meter,
      buildStatusLine(verdictLine),
      buildFactList(facts),
      buildConditionChips(planet),
      ...extraContent,
    ]),
  ]);
}

// ── RENDER FUNCTIONS ────────────

// Sets the text content of an element by id.
function putTextInElement(elementId, text) {
  const element = document.getElementById(elementId);
  if (element) element.textContent = text;
}

// Calls every render function below. Each one is isolated so a surprise in
// one section can't blank the rest of the page.
function renderEverything() {
  const renderers = [
    renderSimpleGlance, renderMajorOrder, renderSimpleDefenses, renderSimpleDropTargets,
    renderSimpleLatestDispatch,
    renderWarMap, renderGambits, renderWarStatistics, renderTrendGraphs, renderAssignmentsInFull, renderCampaigns, renderDefenseEvents,
    renderPlanets, renderPlanetEffects, renderSpaceStation, renderNewsDispatches, renderRawData,
    renderPlanetJumpOptions, renderPlanetDrawer,
    renderStatusBar,
  ];
  for (const renderer of renderers) {
    try {
      renderer();
    } catch (error) {
      console.error(`${renderer.name} failed:`, error);
    }
  }
  document.body.classList.toggle('is-stale', describeConnectionState().isStale);
}

// ── SIMPLE MODE ──────────────────────────────────────────────────────────────

// Players online (the hero number), one tile per enemy front, and the
// number of planets under attack → #simple-glance
function renderSimpleGlance() {
  if (!hasAnyData()) {
    replaceContent('simple-glance', [buildWaitingMessage()]);
    return;
  }
  const playersOnline = apiData.warStatistics?.statistics?.playerCount;
  const defenses = rankDefenses();
  const defensesAtRisk = defenses.filter(entry =>
    entry.outlook.verdict === 'at-risk' || entry.outlook.verdict === 'losing').length;

  const heroTile = buildElement('div', { className: 'stat-tile stat-tile-hero' }, [
    buildElement('p', { className: 'stat-value', text: formatBigNumber(playersOnline) }),
    buildElement('p', { className: 'stat-label', text: 'Helldivers online' }),
  ]);

  const frontTiles = summarizeFronts().map(front => {
    const frontName = getFactionDisplayName(front.factionKey);
    return buildElement('div', { className: `stat-tile front-tile faction-${front.factionKey}` }, [
      buildElement('p', { className: 'stat-label' }, [
        buildImage(getFactionIconFile(front.factionKey), '', 'faction-icon faction-icon-small', 20, 20),
        ` ${frontName} front`,
      ]),
      buildElement('p', { className: 'stat-value', text: formatBigNumber(front.playerCount) }),
      buildElement('p', { className: 'stat-detail',
        text: `Helldivers on ${front.campaignCount} planet${front.campaignCount === 1 ? '' : 's'}`
          + (front.defenseCount ? ` · ${front.defenseCount} under attack` : '') }),
    ]);
  });

  const defenseTile = buildElement('div', {
    className: `stat-tile ${defensesAtRisk ? 'status-warning' : ''}` }, [
    buildElement('p', { className: 'stat-label', text: 'Planets under attack' }),
    buildElement('p', { className: 'stat-value', text: String(defenses.length) }),
    buildElement('p', { className: 'stat-detail',
      text: defenses.length === 0 ? 'None right now'
        : defensesAtRisk ? `${defensesAtRisk} at risk of falling` : 'None at risk right now' }),
  ]);

  replaceContent('simple-glance', [heroTile, defenseTile, ...frontTiles]);
}

// The first Major Order: title, time left, briefing, each task as a sentence
// with a progress bar, the reward, and a line for any other orders
// → #mo-box (#mo-empty / #mo-content)
function renderMajorOrder() {
  const emptyMessage = document.getElementById('mo-empty');
  const moContent    = document.getElementById('mo-content');

  if (apiData.assignments.length === 0) {
    emptyMessage.textContent = hasAnyData()
      ? 'No Major Order right now. Any liberation or defense still helps the war.'
      : buildWaitingMessage().textContent;
    emptyMessage.style.display = '';
    moContent.style.display    = 'none';
    return;
  }
  emptyMessage.style.display = 'none';
  moContent.style.display    = '';

  const assignment = apiData.assignments[0];
  const secondsLeft = getSecondsUntil(assignment.expiration);

  putTextInElement('mo-title', assignment.title || 'Major Order');
  putTextInElement('mo-timeLeft', secondsLeft === null ? 'No deadline given'
    : secondsLeft === 0 ? 'Deadline passed' : `${formatDuration(secondsLeft)} left`);
  putTextInElement('mo-briefing', stripGameMarkup(assignment.briefing));

  replaceContent('mo-tasks', assignment.tasks.map((task, taskPosition) => {
    const described = describeAssignmentTask(task, assignment.progress[taskPosition]);
    const statusName = described.isComplete ? 'good' : 'neutral';
    const pace = describeMajorOrderTaskPace(assignment, taskPosition);
    const paceFacts = describeMajorOrderPaceFacts(pace);
    const taskPlanet = apiData.planetsByIndex[getTaskLocation(task).planetIndex] || null;
    return buildElement('li', { className: `mo-task${described.isComplete ? ' is-complete' : ''}` }, [
      buildElement('p', { className: 'mo-task-sentence' }, [
        described.isComplete
          ? buildElement('span', { className: 'status-icon', text: '✔', attributes: { 'aria-hidden': 'true' } }) : null,
        ...buildTaskSentenceWithPlanet(described.sentence, taskPlanet),
      ]),
      described.progressPercent !== null ? buildMeter(described.progressPercent, 'Complete', statusName) : null,
      buildElement('p', { className: 'mo-task-progress',
        text: described.isComplete ? `Done — ${described.progressText}` : described.progressText }),
      pace.status === 'done' ? null : buildElement('div', { className: 'mo-task-pace' }, [
        buildStatusLine(describeMajorOrderPaceLine(pace)),
        paceFacts ? buildElement('p', { className: 'mo-task-pace-facts', text: paceFacts }) : null,
      ]),
    ]);
  }));

  const rewardText = describeReward(assignment.reward);
  putTextInElement('mo-reward', rewardText ? `Reward: ${rewardText}` : '');

  const otherOrders = apiData.assignments.slice(1);
  putTextInElement('mo-more', otherOrders.length === 0 ? '' : 'Also active: ' + otherOrders.map(order => {
    const orderSecondsLeft = getSecondsUntil(order.expiration);
    return `${order.title || 'Order'}${orderSecondsLeft ? ` (${formatDuration(orderSecondsLeft)} left)` : ''}`;
  }).join(' · '));
}

// A task sentence with its planet's name as a button that opens the planet drawer: the name
// where the sentence says it, otherwise after the sentence.
function buildTaskSentenceWithPlanet(sentence, planet) {
  if (!planet) return [buildElement('span', { text: sentence })];
  const position = sentence.toLowerCase().indexOf(planet.name.toLowerCase());
  if (position < 0) return [buildElement('span', { text: `${sentence} ` }), buildPlanetDrawerButton(planet)];
  const nameAsWritten = sentence.slice(position, position + planet.name.length);
  return [
    position > 0 ? buildElement('span', { text: sentence.slice(0, position) }) : null,
    buildPlanetDrawerButton(planet, nameAsWritten),
    position + planet.name.length < sentence.length ? buildElement('span', { text: sentence.slice(position + planet.name.length) }) : null,
  ].filter(Boolean);
}

// Every planet under attack, most urgent first, as cards → #simple-defenses
function renderSimpleDefenses() {
  if (!hasAnyData()) {
    replaceContent('simple-defenses', [buildWaitingMessage()]);
    return;
  }
  const defenses = rankDefenses();
  if (defenses.length === 0) {
    replaceContent('simple-defenses', [buildStatusLine(
      { status: 'good', icon: '✔', text: 'No planets under attack right now.' }, 'empty-state')]);
    return;
  }
  replaceContent('simple-defenses', defenses.map(entry => buildPlanetCard(entry.planet, {
    idPrefix: 'simple-defense',
    defenseOutlook: entry.outlook,
    isMajorOrderPlanet: entry.isMajorOrderPlanet,
    reasons: entry.isMajorOrderPlanet ? ['Major Order target'] : [],
    extraContent: [buildPlanetDrawerButton(entry.planet, `More about ${entry.planet.name}`, 'link-button planet-card-more')],
  })));
}

// The few liberation campaigns that matter most right now → #simple-drop-targets
function renderSimpleDropTargets() {
  if (!hasAnyData()) {
    replaceContent('simple-drop-targets', [buildWaitingMessage()]);
    return;
  }
  const ranked = rankLiberationCampaigns().slice(0, SIMPLE_MODE_DROP_TARGET_COUNT);
  if (ranked.length === 0) {
    replaceContent('simple-drop-targets', [buildElement('p', {
      className: 'empty-state', text: 'No liberation campaigns are open right now.' })]);
    return;
  }
  replaceContent('simple-drop-targets', ranked.map(entry => buildPlanetCard(entry.planet, {
    idPrefix: 'simple-drop',
    liberationOutlook: entry.outlook,
    reasons: entry.reasons.slice(0, 2),
    isMajorOrderPlanet: entry.isMajorOrderPlanet,
    extraContent: [buildPlanetDrawerButton(entry.planet, `More about ${entry.planet.name}`, 'link-button planet-card-more')],
  })));
}

// Newest dispatch first: news with a real date, most recent wins.
function getNewestDispatch() {
  const dated = apiData.newsDispatches
    .map(dispatch => ({ dispatch, publishedTimestamp: Date.parse(dispatch.published || '') }))
    .sort((first, second) => (isNaN(second.publishedTimestamp) ? -Infinity : second.publishedTimestamp)
                           - (isNaN(first.publishedTimestamp) ? -Infinity : first.publishedTimestamp));
  return dated.length > 0 ? dated[0] : null;
}

// The newest message from High Command → #simple-latest-dispatch
function renderSimpleLatestDispatch() {
  if (!hasAnyData()) {
    replaceContent('simple-latest-dispatch', [buildWaitingMessage()]);
    return;
  }
  const newest = getNewestDispatch();
  if (!newest) {
    // News comes with the primary's slower second wave, so on a first visit
    // "none yet" would be a lie for the first ~10 seconds.
    const firstCycleStillRunning = apiData.lastSuccessfulFetchTimestamp === null;
    replaceContent('simple-latest-dispatch', [buildElement('p', {
      className: 'empty-state',
      text: firstCycleStillRunning ? 'Loading the latest news…' : 'No dispatches from High Command yet.' })]);
    return;
  }
  const dateText = isNaN(newest.publishedTimestamp) ? 'Date unknown'
    : `${formatTimeAgo(newest.publishedTimestamp)} · ${formatDateTime(newest.publishedTimestamp)}`;
  replaceContent('simple-latest-dispatch', [
    buildElement('p', { className: 'dispatch-date', text: dateText }),
    ...buildGameMessage(newest.dispatch.message),
  ]);
}

// ── ADVANCED MODE ────────────────────────────────────────────────────────────
// Same apiData, same derived numbers, more of them. No extra fetching.

// A planet index → its name, or "Planet #N" when no source knows it.
function getPlanetName(planetIndex) {
  return apiData.planetsByIndex[planetIndex]?.name || `Planet #${planetIndex}`;
}

// Indexes of planets whose attack lines point at this planet.
function getAttackersOfPlanet(planetIndex) {
  return apiData.planets
    .filter(planet => asArray(planet.attacking).includes(planetIndex))
    .map(planet => planet.index);
}

// A list of planet indexes → "A, B, C +2 more".
function formatPlanetNameList(planetIndexes, limit = 4) {
  const names = asArray(planetIndexes).map(getPlanetName);
  if (names.length === 0) return '';
  const shown = names.slice(0, limit).join(', ');
  return names.length > limit ? `${shown} +${names.length - limit} more` : shown;
}

// 1234567 → "1,234,567" (for exact health figures).
function formatExactNumber(number) {
  return isFiniteNumber(number) ? Math.round(number).toLocaleString(DISPLAY_LOCALE) : '—';
}

// A timestamp → "27 Sep 2026, 18:05" in the viewer's time zone, always in English.
function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString(DISPLAY_LOCALE,
    { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// A local date/time plus how far away it is: "27 Sep, 18:00 (in 3h 5m)".
function formatDeadline(isoDateString) {
  const timestamp = Date.parse(isoDateString || '');
  if (isNaN(timestamp)) return '—';
  const secondsAway = (timestamp - Date.now()) / 1000;
  const when = new Date(timestamp).toLocaleString(DISPLAY_LOCALE,
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return secondsAway >= 0 ? `${when} (in ${formatDuration(secondsAway)})` : `${when} (passed)`;
}

// A small table: caption, header row, body rows (arrays of strings or nodes),
// optional ids per row. Wrapped so it scrolls sideways on its own instead of
// the whole page.
function buildTable(caption, headers, rows, rowIds = []) {
  const table = buildElement('table', { className: 'data-table' }, [
    buildElement('caption', { text: caption }),
    buildElement('thead', {}, [buildElement('tr', {},
      headers.map(header => buildElement('th', { text: header, attributes: { scope: 'col' } })))]),
    buildElement('tbody', {}, rows.map((row, rowPosition) => buildElement('tr', { attributes: { id: rowIds[rowPosition] } },
      row.map((cell, cellPosition) => {
        const cellElement = buildElement(cellPosition === 0 ? 'th' : 'td',
          { attributes: cellPosition === 0 ? { scope: 'row' } : {} });
        cellElement.append(cell instanceof Node ? cell : String(cell ?? '—'));
        return cellElement;
      })))),
  ]);
  return buildElement('div', { className: 'table-scroll', attributes: { tabindex: 0, role: 'region', 'aria-label': caption } }, [table]);
}

// Enemy recovery vs Helldiver pressure as two bars on one scale.
function buildPressureComparison(outlook) {
  const regen = outlook.regenPercentPerHour;
  const pressure = outlook.playerOutputPercentPerHour;
  if (!isFiniteNumber(regen)) return null;
  const scaleMaximum = Math.max(regen, isFiniteNumber(pressure) ? pressure : 0, 0) || 1;

  // One labelled bar row of the comparison.
  const buildRow = (label, value, className, valueText) => {
    const bar = buildElement('div', { className: `pressure-bar ${className}` });
    bar.style.width = `${isFiniteNumber(value) ? Math.max(0, value) / scaleMaximum * 100 : 0}%`;
    return buildElement('div', { className: 'pressure-row' }, [
      buildElement('span', { className: 'pressure-label', text: label }),
      buildElement('div', { className: 'pressure-track', attributes: { 'aria-hidden': 'true' } }, [bar]),
      buildElement('span', { className: 'pressure-value', text: valueText }),
    ]);
  };

  const pressureText = isFiniteNumber(pressure) ? `${pressure.toFixed(2)}%/h`
    : outlook.verdict === 'stalled' ? '≤ recovery' : 'measuring…';
  return buildElement('div', { className: 'pressure-comparison' }, [
    buildElement('p', { className: 'pressure-title', text: 'Enemy recovery vs Helldiver pressure' }),
    buildRow('Enemy', regen, 'pressure-enemy', formatEnemyRecovery(regen)),
    buildRow('Helldivers', pressure, 'pressure-helldivers', pressureText),
  ]);
}

// Region (city) rows for a campaign card: capture %, liberation bonus, players.
function buildRegionTable(planet) {
  const regions = asArray(planet.regions);
  if (regions.length === 0) return null;
  return buildTable(`Regions on ${planet.name}`,
    ['Region', 'Size', 'Captured', 'Planet bonus', 'Recovers', 'Open', 'Helldivers'],
    regions.map(region => {
      const capturePercent = isFiniteNumber(region.health) && region.maxHealth > 0
        ? Math.max(0, Math.min(100, (1 - region.health / region.maxHealth) * 100)) : null;
      const planetBonusPercent = region.maxHealth > 0 && planet.maxHealth > 0
        ? region.maxHealth / planet.maxHealth * 100 : null;
      const regionRegenPercent = isFiniteNumber(region.regenPerSecond) && region.maxHealth > 0
        ? region.regenPerSecond * 3600 / region.maxHealth * 100 : null;
      return [
        region.name || 'Unnamed region',
        region.size || '—',
        formatPercent(capturePercent, 0),
        isFiniteNumber(planetBonusPercent) ? `+${planetBonusPercent.toFixed(0)}%` : '—',
        isFiniteNumber(regionRegenPercent) ? `${regionRegenPercent.toFixed(1)}%/h` : '—',
        region.isAvailable ? 'Yes' : 'No',
        formatBigNumber(region.players),
      ];
    }));
}

// The extra numbers a full (advanced) campaign card carries.
function buildCampaignDetails(planet, liberationOutlook, defenseOutlook) {
  const facts = [
    ['Planet index', String(planet.index)],
    ['Biome', getBiomeDisplayName(planet)],
    ['Health', hasKnownHealth(planet)
      ? `${formatExactNumber(planet.health)} / ${formatExactNumber(planet.maxHealth)}` : null],
    ['Enemy recovery', isFiniteNumber(planet.regenPerSecond) ? `${planet.regenPerSecond.toFixed(2)} HP/s` : null],
  ];
  if (liberationOutlook) {
    facts.push(
      ['Helldiver pressure', isFiniteNumber(liberationOutlook.playerOutputPercentPerHour)
        ? `${liberationOutlook.playerOutputPercentPerHour.toFixed(2)}%/h` : null],
      ['Helldivers to break even', isFiniteNumber(liberationOutlook.playersNeededToOutpaceRegen)
        ? `≈ ${formatBigNumber(liberationOutlook.playersNeededToOutpaceRegen)}`
          + (liberationOutlook.playersNeededIsGalaxyEstimate ? ' (galaxy estimate)' : '') : null],
      ['Liberated in', isFiniteNumber(liberationOutlook.hoursToLiberation)
        ? `≈ ${formatDuration(liberationOutlook.hoursToLiberation * 3600)}` : null],
      ['Measured over', liberationOutlook.trendSpanMinutes > 0
        ? `${Math.round(liberationOutlook.trendSpanMinutes)} min` : 'not yet'],
    );
  }
  if (defenseOutlook) {
    facts.push(
      ['Deadline', formatDeadline(planet.event?.endTime)],
      ['Attack began', planet.event?.startTime ? formatDeadline(planet.event.startTime) : null],
      ['Pace source', defenseOutlook.rateSource === 'measured' ? 'measured by this page'
        : defenseOutlook.rateSource === 'average-since-start' ? 'average since the attack began' : null],
      ['Projected at deadline', formatPercent(defenseOutlook.projectedPercentAtDeadline)],
      ['Event ID', String(planet.event?.id ?? '—')],
    );
  }

  const statistics = planet.statistics || {};
  if (isFiniteNumber(statistics.missionsWon)) {
    facts.push(
      ['Missions won / lost', `${formatBigNumber(statistics.missionsWon)} / ${formatBigNumber(statistics.missionsLost)}`],
      ['Mission success', formatPercent(statistics.missionSuccessRate, 0)],
      ['Helldiver deaths here', formatBigNumber(statistics.deaths)],
    );
  }

  const supplyLines = [
    ['Supply lines to', formatPlanetNameList(planet.waypoints)],
    ['Attacking', formatPlanetNameList(planet.attacking)],
    ['Attacked from', formatPlanetNameList(getAttackersOfPlanet(planet.index))],
  ];

  const hazardDescriptions = asArray(planet.hazards)
    .filter(hazard => hazard.name && hazard.name !== 'None' && hazard.description)
    .map(hazard => buildElement('li', {}, [buildElement('strong', { text: hazard.name }), ` — ${hazard.description}`]));

  return [
    liberationOutlook ? buildPressureComparison(liberationOutlook) : null,
    buildFactList(facts, 'fact-list fact-list-detailed'),
    buildFactList(supplyLines, 'fact-list fact-list-detailed'),
    buildRegionTable(planet),
    hazardDescriptions.length || planet.biome?.description
      ? buildElement('details', { className: 'planet-notes' }, [
        buildElement('summary', { text: 'Hazards and biome notes' }),
        hazardDescriptions.length ? buildElement('ul', {}, hazardDescriptions) : null,
        planet.biome?.description ? buildElement('p', { text: planet.biome.description }) : null,
      ]) : null,
  ];
}

// Every active campaign (defenses and liberations) with the chosen front
// filter and sort order applied. Pure: takes the choices, returns entries.
function getAdvancedCampaignEntries(factionFilter = 'all', sortKey = 'priority') {
  const defenseEntries = rankDefenses().map(entry => ({
    planet: entry.planet, defenseOutlook: entry.outlook, liberationOutlook: null,
    reasons: entry.isMajorOrderPlanet ? ['Major Order target'] : [], isMajorOrderPlanet: entry.isMajorOrderPlanet,
  }));
  const liberationEntries = rankLiberationCampaigns().map(entry => ({
    planet: entry.planet, defenseOutlook: null, liberationOutlook: entry.outlook,
    reasons: entry.reasons, isMajorOrderPlanet: entry.isMajorOrderPlanet,
  }));
  const entries = [...defenseEntries, ...liberationEntries].filter(entry =>
    factionFilter === 'all' || getEnemyFactionOnPlanet(entry.planet) === factionFilter);

  // Progress on one scale: defense % for defenses, liberation % otherwise.
  const progressOf = entry => entry.defenseOutlook
    ? entry.defenseOutlook.progressPercent : (entry.liberationOutlook.liberationPercent || 0);
  const playersOf = entry => entry.planet.statistics?.playerCount || 0;

  if (sortKey === 'players')  return [...entries].sort((first, second) => playersOf(second) - playersOf(first));
  if (sortKey === 'progress') return [...entries].sort((first, second) => progressOf(second) - progressOf(first));
  if (sortKey === 'name')     return [...entries].sort((first, second) => first.planet.name.localeCompare(second.planet.name));
  return entries;
}

// The current value of a <select> by id, or the fallback when it's missing.
function readSelectValue(elementId, fallbackValue) {
  const select = document.getElementById(elementId);
  return select && select.value ? select.value : fallbackValue;
}

// Full statistics, the impact multiplier and the war clock → #output-war-statistics
function renderWarStatistics() {
  if (!hasAnyData()) {
    replaceContent('output-war-statistics', [buildWaitingMessage()]);
    return;
  }
  const statistics = apiData.warStatistics?.statistics || {};
  const warStart = getWarStartTimestamp();
  const warTime = getCurrentWarTimeSeconds();

  const facts = [
    ['Helldivers online', formatBigNumber(statistics.playerCount)],
    ['Impact multiplier', isFiniteNumber(apiData.warStatistics?.impactMultiplier)
      ? `${apiData.warStatistics.impactMultiplier.toFixed(4)} (drops as more players come online)` : null],
    ['Missions won', formatBigNumber(statistics.missionsWon)],
    ['Missions lost', formatBigNumber(statistics.missionsLost)],
    ['Mission success rate', formatPercent(statistics.missionSuccessRate, 0)],
    ['Terminid kills', formatBigNumber(statistics.terminidKills)],
    ['Automaton kills', formatBigNumber(statistics.automatonKills)],
    ['Illuminate kills', formatBigNumber(statistics.illuminateKills)],
    ['Helldiver deaths', formatBigNumber(statistics.deaths)],
    ['Friendly kills', formatBigNumber(statistics.friendlies)],
    ['Revives', formatBigNumber(statistics.revives)],
    ['Bullets fired', formatBigNumber(statistics.bulletsFired)],
    ['Bullets hit', formatBigNumber(statistics.bulletsHit)],
    ['Accuracy', formatPercent(statistics.accuracy, 0)],
    ['Time in missions', isFiniteNumber(statistics.missionTime)
      ? `${formatBigNumber(statistics.missionTime / 31557600)} years` : null],
  ];
  const clockFacts = [
    ['War began', warStart !== null ? new Date(warStart).toLocaleDateString(DISPLAY_LOCALE,
      { year: 'numeric', month: 'long', day: 'numeric' }) : null],
    ['Day of the war', warStart !== null ? `Day ${Math.floor((Date.now() - warStart) / 86400000) + 1}` : null],
    ['War clock', warTime !== null ? `${formatExactNumber(warTime)} s` : 'not read yet (comes from the backup API)'],
    ['Client version', apiData.warStatistics?.clientVersion || null],
    ['Data source', apiData.currentDataSource || 'offline'],
  ];

  const statisticsLookOdd = isFiniteNumber(statistics.bulletsHit) && isFiniteNumber(statistics.bulletsFired)
    && statistics.bulletsHit > statistics.bulletsFired;

  replaceContent('output-war-statistics', [
    buildFactList(facts, 'fact-list fact-list-grid'),
    buildElement('h3', { text: 'War clock' }),
    buildFactList(clockFacts, 'fact-list fact-list-grid'),
    statisticsLookOdd ? buildElement('p', { className: 'section-hint',
      text: 'Some totals look inconsistent at the source (more bullets hit than fired); they are shown exactly as the API reports them.' }) : null,
  ]);
}

// Every assignment with its raw task values, progress and deadline → #output-assignments
function renderAssignmentsInFull() {
  if (!hasAnyData()) {
    replaceContent('output-assignments', [buildWaitingMessage()]);
    return;
  }
  if (apiData.assignments.length === 0) {
    replaceContent('output-assignments', [buildElement('p', { className: 'empty-state', text: 'No orders active.' })]);
    return;
  }
  replaceContent('output-assignments', [buildMajorOrderFixesNote(), ...apiData.assignments.map(assignment => {
    const rows = assignment.tasks.map((task, taskPosition) => {
      const described = describeAssignmentTask(task, assignment.progress[taskPosition]);
      const rawValues = asArray(task.valueTypes)
        .map((valueType, valuePosition) => `${valueType}=${asArray(task.values)[valuePosition]}`).join(' ');
      const sentence = described.automaticSentence
        ? `${described.sentence} (fixed by hand; the page said "${described.automaticSentence}")` : described.sentence;
      return [String(taskPosition + 1), sentence, String(task.type ?? '—'), rawValues || '—',
              described.progressText, formatPercent(described.progressPercent)];
    });
    return buildElement('article', { className: 'order-detail' }, [
      buildElement('h3', { text: assignment.title || 'Order' }),
      buildFactList([
        ['Deadline', formatDeadline(assignment.expiration)],
        ['Reward', describeReward(assignment.reward) || null],
        ['Order ID', String(assignment.id ?? '—')],
      ], 'fact-list fact-list-grid'),
      assignment.briefing ? buildElement('div', { className: 'order-briefing' }, buildGameMessage(assignment.briefing)) : null,
      rows.length ? buildTable(`Tasks for ${assignment.title || 'this order'}`,
        ['#', 'Task', 'Type', 'Raw values', 'Progress', 'Done'], rows) : null,
    ]);
  })]);
}

// Where to correct a task the page words wrong, and a warning when the fixes
// file couldn't be read (a mistake in it), so the owner notices.
function buildMajorOrderFixesNote() {
  const fixes = getMajorOrderFixes();
  if (!fixes.readable) {
    return buildStatusLine({ status: 'warning', icon: '⚠',
      text: 'major-order-fixes.js couldn\'t be read (a missing comma or quote?), so the page words every task by itself.' });
  }
  const fixCount = fixes.taskText.length;
  return buildElement('p', { className: 'section-hint',
    text: 'The page words each task by itself and names the faction, not the exact enemy, so it can be wrong. '
      + 'Fix the wording in major-order-fixes.js in the public DropIntel repository; that file says how.'
      + (fixCount ? ` ${fixCount} fix${fixCount === 1 ? ' is' : 'es are'} in the file.` : '') });
}

// Every campaign as a full card, filtered and sorted by the section controls → #output-campaigns
function renderCampaigns() {
  if (!hasAnyData()) {
    replaceContent('output-campaigns', [buildWaitingMessage()]);
    return;
  }
  const entries = getAdvancedCampaignEntries(
    readSelectValue('campaign-faction-filter', 'all'), readSelectValue('campaign-sort', 'priority'));
  if (entries.length === 0) {
    replaceContent('output-campaigns', [buildElement('p', { className: 'empty-state',
      text: apiData.activeCampaigns.length ? 'No campaigns on this front.' : 'No active campaigns.' })]);
    return;
  }
  replaceContent('output-campaigns', entries.map(entry => buildPlanetCard(entry.planet, {
    idPrefix: 'advanced-campaign',
    liberationOutlook: entry.liberationOutlook,
    defenseOutlook: entry.defenseOutlook,
    reasons: entry.reasons,
    isMajorOrderPlanet: entry.isMajorOrderPlanet,
    extraContent: buildCampaignDetails(entry.planet, entry.liberationOutlook, entry.defenseOutlook),
  })));
}

// Every defense with the pace it has vs the pace it needs → #output-defense-events
function renderDefenseEvents() {
  if (!hasAnyData()) {
    replaceContent('output-defense-events', [buildWaitingMessage()]);
    return;
  }
  const defenses = rankDefenses();
  if (defenses.length === 0) {
    replaceContent('output-defense-events', [buildElement('p', { className: 'empty-state', text: 'No active defense events.' })]);
    return;
  }
  replaceContent('output-defense-events', [buildTable('Defense events, most urgent first',
    ['Planet', 'Attacker', 'Defended', 'Deadline', 'Helldivers', 'Pace', 'Needed', 'At deadline', 'Verdict'],
    defenses.map(({ planet, outlook }) => [
      planet.name,
      planet.event?.faction || '—',
      formatPercent(outlook.progressPercent),
      formatDeadline(planet.event?.endTime),
      formatBigNumber(outlook.playerCount),
      formatPercentPerHour(outlook.ratePercentPerHour),
      formatPercentPerHour(outlook.requiredPercentPerHour),
      formatPercent(outlook.projectedPercentAtDeadline),
      describeDefenseVerdict(outlook).text,
    ]))]);
}

// Every enemy-held or contested planet in one table → #output-planets
function renderPlanets() {
  if (!hasAnyData()) {
    replaceContent('output-planets', [buildWaitingMessage()]);
    return;
  }
  const interestingPlanets = apiData.planets
    .filter(planet =>
      planet.currentOwner !== 'Humans' ||
      planetIsUnderAttack(planet) ||
      apiData.indexesOfPlanetsWithActiveBattles.has(planet.index))
    .sort((first, second) =>
      String(first.currentOwner).localeCompare(String(second.currentOwner)) || first.name.localeCompare(second.name));

  if (interestingPlanets.length === 0) {
    replaceContent('output-planets', [buildElement('p', { className: 'empty-state', text: 'No planet data yet.' })]);
    return;
  }
  const hazardNamesOf = planet => asArray(planet.hazards)
    .map(hazard => hazard.name).filter(name => name && name !== 'None').join(', ');

  replaceContent('output-planets', [
    buildTable(`${interestingPlanets.length} planets held by an enemy or being fought over`,
      ['Planet', 'Owner', 'Sector', 'Biome', 'Liberated', 'Recovers', 'Helldivers', 'Hazards', 'Supply lines', 'Battle'],
      interestingPlanets.map(planet => [
        planet.name,
        planet.currentOwner,
        planet.sector || '—',
        getBiomeDisplayName(planet),
        hasKnownHealth(planet) ? formatPercent(getLiberationPercent(planet)) : 'unknown',
        hasKnownHealth(planet) ? formatEnemyRecovery(getEnemyRegenPercentPerHour(planet)) : '—',
        formatBigNumber(planet.statistics?.playerCount),
        hazardNamesOf(planet) || '—',
        formatPlanetNameList(planet.waypoints, 3) || '—',
        planetIsUnderAttack(planet) ? 'Defense'
          : apiData.indexesOfPlanetsWithActiveBattles.has(planet.index) ? 'Liberation' : '—',
      ]),
      interestingPlanets.map(planet => `planet-row-${planet.index}`)),
    apiData.currentDataSource === 'FALLBACK' ? buildElement('p', { className: 'section-hint',
      text: 'The backup API gives no maximum health or supply lines for planets without a campaign.' }) : null,
  ]);
}

// Every dispatch in the feed, newest first, with dates → #output-dispatches
function renderNewsDispatches() {
  if (!hasAnyData()) {
    replaceContent('output-dispatches', [buildWaitingMessage()]);
    return;
  }
  const dispatches = apiData.newsDispatches
    .map(dispatch => ({ dispatch, publishedTimestamp: Date.parse(dispatch.published || '') }))
    .sort((first, second) => (isNaN(second.publishedTimestamp) ? -Infinity : second.publishedTimestamp)
                           - (isNaN(first.publishedTimestamp) ? -Infinity : first.publishedTimestamp))
    .slice(0, 10);
  if (dispatches.length === 0) {
    replaceContent('output-dispatches', [buildElement('p', { className: 'empty-state',
      text: apiData.lastSuccessfulFetchTimestamp === null ? 'Loading the latest news…' : 'No dispatches.' })]);
    return;
  }
  replaceContent('output-dispatches', dispatches.map(({ dispatch, publishedTimestamp }) =>
    buildElement('article', { className: 'dispatch dispatch-full' }, [
      buildElement('p', { className: 'dispatch-date', text: isNaN(publishedTimestamp) ? 'Date unknown'
        : `${formatDateTime(publishedTimestamp)} · ${formatTimeAgo(publishedTimestamp)}` }),
      ...buildGameMessage(dispatch.message),
    ])));
}

// One DSS tactical action → a table row: name, status, charge, timing.
function describeTacticalAction(action) {
  const statusName = DSS_ACTION_STATUS_NAME[action.status] || `status ${action.status}`;
  const donationProgress = asArray(action.costs)[0];
  let charge = '—';
  let timing = '—';
  if (action.status === 1 && isPlainObject(donationProgress) && donationProgress.targetValue > 0) {
    charge = formatPercent(donationProgress.currentValue / donationProgress.targetValue * 100);
    timing = donationProgress.deltaPerSecond > 0
      ? `ready in ${formatDuration((donationProgress.targetValue - donationProgress.currentValue) / donationProgress.deltaPerSecond)}`
      : 'charging paused (another boost is active, or no donations)';
  } else if (action.status === 2) {
    timing = `ends in ${formatDuration(getSecondsUntil(action.statusExpire))}`;
  } else if (action.status === 3) {
    timing = `ready again in ${formatDuration(getSecondsUntil(action.statusExpire))}`;
  }
  return [action.name || 'Unnamed action', statusName, charge, timing];
}

// The DSS: where it is, when the next move vote ends, each tactical action → #output-space-station
function renderSpaceStation() {
  if (!hasAnyData()) {
    replaceContent('output-space-station', [buildWaitingMessage()]);
    return;
  }
  if (apiData.spaceStations.length === 0) {
    replaceContent('output-space-station', [buildElement('p', { className: 'empty-state',
      text: 'Neither API reports a Democracy Space Station right now.' })]);
    return;
  }
  replaceContent('output-space-station', apiData.spaceStations.map(station => {
    if (station.cameFromBackupApi) {
      const voteEndTimestamp = convertWarTimeToTimestamp(station.electionEndWarTime);
      return buildElement('article', { className: 'station-detail' }, [
        buildFactList([
          ['Location', getPlanetName(station.planetIndex)],
          ['Next move vote ends', voteEndTimestamp !== null
            ? formatDeadline(new Date(voteEndTimestamp).toISOString()) : 'unknown (war clock not read yet)'],
          ['Active effects', asArray(station.activeEffectIds).map(getEffectName).join(', ') || 'none'],
          ['Source', 'backup API (no tactical action details)'],
        ], 'fact-list fact-list-grid'),
      ]);
    }
    const planet = isPlainObject(station.planet) ? station.planet : {};
    const actions = asArray(station.tacticalActions).filter(isPlainObject);
    return buildElement('article', { className: 'station-detail' }, [
      buildFactList([
        ['Location', planet.name ? `${planet.name}${planet.sector ? ` (${planet.sector} sector)` : ''}` : 'unknown'],
        ['Helldivers on-planet', formatBigNumber(planet.statistics?.playerCount)],
        ['Next move vote ends', formatDeadline(station.electionEnd)],
      ], 'fact-list fact-list-grid'),
      actions.length ? buildTable('Tactical actions', ['Action', 'Status', 'Charged', 'Timing'],
        actions.map(describeTacticalAction)) : null,
    ]);
  }));
}

// Every planet's modifiers, known and unknown, with what they do → #output-planet-effects
function renderPlanetEffects() {
  if (!hasAnyData()) {
    replaceContent('output-planet-effects', [buildWaitingMessage()]);
    return;
  }
  const effectIdsByPlanetIndex = {};
  for (const effect of apiData.planetActiveEffects) {
    (effectIdsByPlanetIndex[effect.index] = effectIdsByPlanetIndex[effect.index] || []).push(effect.galacticEffectId);
  }

  const planetBlocks = [];
  for (const [planetIndexString, effectIds] of Object.entries(effectIdsByPlanetIndex)) {
    const planet = apiData.planetsByIndex[Number(planetIndexString)];

    // The effects feed lags behind liberations, so skip planets that are
    // safely human-owned with no battle (their listed fleets are stale).
    if (!planet) continue;
    const planetHasActiveBattle =
      planetIsUnderAttack(planet) || apiData.indexesOfPlanetsWithActiveBattles.has(planet.index);
    if (planet.currentOwner === 'Humans' && !planetHasActiveBattle) continue;

    planetBlocks.push(buildElement('article', { className: 'effect-planet' }, [
      buildElement('h3', { text: `${planet.name} (${planet.currentOwner})` }),
      buildElement('ul', { className: 'effect-list' }, [...new Set(effectIds)].map(effectId => {
        const description = getEffectDescription(effectId);
        return buildElement('li', { className: effectHasKnownName(effectId) ? '' : 'effect-unknown' }, [
          buildElement('strong', { text: getEffectName(effectId) }),
          description ? ` — ${description}` : '',
        ]);
      })),
    ]));
  }

  if (planetBlocks.length === 0) {
    replaceContent('output-planet-effects', [buildElement('p', { className: 'empty-state',
      text: apiData.planetActiveEffects.length === 0 && apiData.warTimeCapturedAtTimestamp === null
        ? 'Effects come from the backup API, which has not answered yet.'
        : 'No modifiers on contested planets.' })]);
    return;
  }
  replaceContent('output-planet-effects', planetBlocks);
}

// Turns an apiData value into JSON (Sets become arrays).
function formatApiDataValueAsJson(value) {
  return JSON.stringify(value, (key, innerValue) =>
    innerValue instanceof Set ? [...innerValue] : innerValue, 2);
}

// One collapsible block per apiData field; the JSON is only built when a
// block is opened, because the planet list alone is hundreds of KB → #output-raw-data
function renderRawData() {
  const container = document.getElementById('output-raw-data');
  if (!container) return;
  const openFields = new Set([...container.querySelectorAll('details[open]')].map(details => details.dataset.field));

  container.replaceChildren(...Object.keys(apiData).map(fieldName => {
    const value = apiData[fieldName];
    const size = Array.isArray(value) ? `${value.length} items`
      : value instanceof Set ? `${value.size} items`
      : isPlainObject(value) ? `${Object.keys(value).length} keys` : String(value);
    const output = buildElement('pre', { className: 'raw-json' });
    const details = buildElement('details', { className: 'raw-data-field', attributes: { 'data-field': fieldName } }, [
      buildElement('summary', {}, [buildElement('code', { text: fieldName }), ` — ${size}`]),
      output,
    ]);
    const fillOutput = () => { if (details.open) output.textContent = formatApiDataValueAsJson(apiData[fieldName]); };
    details.addEventListener('toggle', fillOutput);
    if (openFields.has(fieldName)) {
      details.open = true;
      fillOutput();
    }
    return details;
  }));
}

// The live-region headline: where the data comes from and whether it is
// trustworthy. Kept free of the ticking age so screen readers only hear changes.
function describeStatusHeadline(state) {
  const extras = [];
  if (state.wasRateLimited) extras.push('Rate limited by the API.');
  if (state.errorMessage && state.kind !== 'live') extras.push(state.errorMessage);
  // Per-feed failures only matter when the rest of the source worked.
  if (state.feedWarnings.length > 0 && (state.kind === 'live' || state.kind === 'fallback')) {
    extras.push(`Some feeds failed: ${state.feedWarnings.map(warning => warning.split(':')[0]).join(', ')}.`);
  }
  const headlineByKind = {
    loading:  'Loading the war status…',
    live:     `Live — ${state.sourceLabel} API`,
    fallback: serverPreference === 'backup'
      ? `Backup data — ${state.sourceLabel} API (chosen in Data source)`
      : `Backup data — ${state.sourceLabel} API (the primary API is not answering)`,
    stale:    `OFFLINE — showing data from ${state.dataAgeText}.`,
    offline:  'OFFLINE — no data yet.',
  };
  return [headlineByKind[state.kind], ...extras].join(' ');
}

// Writes the source headline → #status-bar and the data age → #data-age (text only, never HTML)
function renderStatusBar() {
  const state = describeConnectionState();
  const statusBar = document.getElementById('status-bar');
  if (statusBar) {
    const headline = describeStatusHeadline(state);
    if (statusBar.textContent !== headline) statusBar.textContent = headline;
    statusBar.dataset.connectionState = state.kind;
  }
  putTextInElement('data-age', state.kind === 'loading' || state.kind === 'offline' ? ''
    : `Updated ${state.dataAgeText}${state.isRefreshing ? ' · refreshing…' : ''} · ${describeHistorySource()}`);
}

// What the countdown says: refreshing, retrying after a failure, or the next refresh.
function describeCountdown(nowTimestamp = Date.now()) {
  if (refreshInProgress) return 'Refreshing…';
  const secondsLeft = getSecondsUntilNextRefresh(nowTimestamp);
  return lastRefreshFailed ? `Retrying in ${secondsLeft}s` : `Next refresh in ${secondsLeft}s`;
}

// ── GRAPHS: DATA ─────────────────────────────────────────────────────────────
// Graphs only draw what the page has actually watched. Until the history
// spans TREND_MINIMUM_SPAN_MILLISECONDS they say "measuring" instead of
// drawing a misleading flat line.

// Loads remembered Major Order progress samples, dropping old ones.
function loadMajorOrderHistory(nowTimestamp) {
  try {
    const parsed = JSON.parse(readStoredValue(MAJOR_ORDER_HISTORY_STORAGE_KEY) || '[]');
    return asArray(parsed).filter(sample => isPlainObject(sample) && isFiniteNumber(sample.timestamp)
      && typeof sample.assignmentId === 'string' && Array.isArray(sample.progress)
      && nowTimestamp - sample.timestamp <= MAJOR_ORDER_HISTORY_MAX_AGE_MILLISECONDS
      && sample.timestamp <= nowTimestamp);
  } catch {
    return [];
  }
}

// Remembers each active assignment's task progress for this refresh.
// Two samples seconds apart (partial + final render) count as one.
function recordMajorOrderHistory(nowTimestamp) {
  const activeIds = new Set(apiData.assignments.map(assignment => String(assignment.id)));
  let history = asArray(apiData.majorOrderHistory).filter(sample =>
    activeIds.has(sample.assignmentId) && nowTimestamp - sample.timestamp <= MAJOR_ORDER_HISTORY_MAX_AGE_MILLISECONDS);

  for (const assignment of apiData.assignments) {
    const assignmentId = String(assignment.id);
    const previousSamples = history.filter(sample => sample.assignmentId === assignmentId);
    const lastSample = previousSamples[previousSamples.length - 1];
    if (lastSample && nowTimestamp - lastSample.timestamp < SAMPLE_MERGE_WINDOW_MILLISECONDS) {
      history = history.filter(sample => sample !== lastSample);
    }
    history.push({ timestamp: nowTimestamp, assignmentId, progress: assignment.progress.map(value => (isFiniteNumber(value) ? value : null)) });
  }

  apiData.majorOrderHistory = history;
  writeStoredValue(MAJOR_ORDER_HISTORY_STORAGE_KEY, JSON.stringify(history));
}

// Whether a set of sample times spans long enough to draw, and if not,
// roughly how many more minutes of watching it needs.
function describeHistoryReadiness(timestamps) {
  const sortedTimes = asArray(timestamps).filter(isFiniteNumber).sort((first, second) => first - second);
  const spanMilliseconds = sortedTimes.length > 1 ? sortedTimes[sortedTimes.length - 1] - sortedTimes[0] : 0;
  const ready = sortedTimes.length >= 2 && spanMilliseconds >= TREND_MINIMUM_SPAN_MILLISECONDS;
  return {
    ready,
    pointCount: sortedTimes.length,
    minutesWatched: spanMilliseconds / 60000,
    minutesNeeded: ready ? 0 : Math.max(1, Math.ceil((TREND_MINIMUM_SPAN_MILLISECONDS - spanMilliseconds) / 60000)),
  };
}

// A planet's remembered progress as graph points: liberation %, or defense %
// while it is under attack.
function buildPlanetProgressSeries(samples) {
  const sampleList = asArray(samples);
  const latestSample = sampleList[sampleList.length - 1];
  const field = latestSample && latestSample.defensePercent !== null ? 'defensePercent' : 'liberationPercent';
  const points = sampleList
    .filter(sample => isFiniteNumber(sample[field]))
    .map(sample => ({ x: sample.timestamp, y: sample[field] }));
  return { field, points, ...describeHistoryReadiness(points.map(point => point.x)) };
}

// The order fronts are drawn in, so each keeps its colour and position.
const FRONT_ORDER = ['terminids', 'automaton', 'illuminate'];

// How far back the graphs look. The page's own samples cover 45 minutes (6 hours for the Major
// Order); the longer ranges fill from the shared history.
const GRAPH_RANGES = [
  { hours: 1, label: '1h' }, { hours: 6, label: '6h' }, { hours: 24, label: '24h' }, { hours: 168, label: '7d' },
];
const GRAPH_RANGE_STORAGE_KEY = 'hd2_graph_range';
// Lines break where samples are further apart than this (the shared history is hourly after 48 h).
const CHART_GAP_MILLISECONDS = 90 * 60 * 1000;

// The remembered graph range in hours, 6 when nothing valid is stored.
function readGraphRangeHours() {
  const storedHours = Number(readStoredValue(GRAPH_RANGE_STORAGE_KEY));
  return GRAPH_RANGES.some(range => range.hours === storedHours) ? storedHours : 6;
}

let graphRangeHours = readGraphRangeHours();

// Called by the range buttons: remembers the range and redraws the graphs.
function changeGraphRange(hours) {
  if (!GRAPH_RANGES.some(range => range.hours === hours)) return;
  graphRangeHours = hours;
  writeStoredValue(GRAPH_RANGE_STORAGE_KEY, String(hours));
  renderTrendGraphs();
  const pressedButton = document.querySelector(`.graph-range-button[data-graph-range="${hours}"]`);
  if (pressedButton) pressedButton.focus();
}

// The points of a line that fall inside the chosen range.
function keepPointsInRange(points, nowTimestamp = Date.now()) {
  const rangeStart = nowTimestamp - graphRangeHours * 3600000;
  return asArray(points).filter(point => point.x >= rangeStart);
}

// Helldivers on active campaigns per enemy front at every refresh the page
// remembers, summed from the per-planet samples, after the shared history's own totals.
function buildFrontPlayerSeries() {
  const playersByTimestamp = {};
  for (const [planetIndex, samples] of Object.entries(apiData.planetHistoryByIndex)) {
    const planet = apiData.planetsByIndex[planetIndex];
    const factionKey = planet ? getEnemyFactionOnPlanet(planet) : null;
    if (!factionKey) continue;
    for (const sample of asArray(samples)) {
      if (!isFiniteNumber(sample.playerCount)) continue;
      const totals = playersByTimestamp[sample.timestamp] || (playersByTimestamp[sample.timestamp] = {});
      totals[factionKey] = (totals[factionKey] || 0) + sample.playerCount;
    }
  }
  // the shared history's front totals (same sums, taken by the collector) up to where ours begin
  const firstOwnTimestamp = Math.min(...Object.keys(playersByTimestamp).map(Number));
  for (const sharedSample of asArray(apiData.sharedHistory?.frontSamples)) {
    if (sharedSample.timestamp >= firstOwnTimestamp) break;
    playersByTimestamp[sharedSample.timestamp] = { ...sharedSample.playersByFaction };
  }
  const timestamps = Object.keys(playersByTimestamp).map(Number).sort((first, second) => first - second);
  const factionKeys = FRONT_ORDER.filter(factionKey =>
    timestamps.some(timestamp => playersByTimestamp[timestamp][factionKey] !== undefined));
  const series = factionKeys.map(factionKey => ({
    factionKey,
    points: timestamps
      .filter(timestamp => playersByTimestamp[timestamp][factionKey] !== undefined)
      .map(timestamp => ({ x: timestamp, y: playersByTimestamp[timestamp][factionKey] })),
  }));
  return { series, ...describeHistoryReadiness(timestamps) };
}

// True for tasks measured against a target amount (kill N, complete N
// operations). Liberate/hold tasks follow a planet instead.
function taskHasTargetAmount(task) {
  const targetAmount = getTaskValue(task, TASK_VALUE_TYPE.TARGET_AMOUNT);
  return isFiniteNumber(targetAmount) && targetAmount > 0;
}

// One Major Order task's progress over the remembered history, plus the pace
// it needs to finish before the deadline and the pace it is actually making.
function buildMajorOrderTaskSeries(assignment, taskPosition, nowTimestamp = Date.now()) {
  const task = assignment.tasks[taskPosition];
  const current = describeAssignmentTask(task, assignment.progress[taskPosition]);
  const points = getMajorOrderSamples(String(assignment.id))
    .map(sample => ({ x: sample.timestamp, y: describeAssignmentTask(task, sample.progress[taskPosition]).progressPercent }))
    .filter(point => isFiniteNumber(point.y));
  const readiness = describeHistoryReadiness(points.map(point => point.x));
  const deadlineTimestamp = Date.parse(assignment.expiration || '');
  const hoursLeft = isNaN(deadlineTimestamp) ? null : Math.max(0, (deadlineTimestamp - nowTimestamp) / 3600000);

  const series = {
    sentence: current.sentence,
    chartable: taskHasTargetAmount(task),
    isComplete: current.isComplete,
    currentPercent: current.progressPercent,
    deadlineTimestamp: isNaN(deadlineTimestamp) ? null : deadlineTimestamp,
    hoursLeft,
    requiredPercentPerHour: null,
    measuredPercentPerHour: null,
    projectedPercentAtDeadline: null,
    points,
    ...readiness,
  };
  if (hoursLeft && isFiniteNumber(current.progressPercent)) {
    series.requiredPercentPerHour = (100 - current.progressPercent) / hoursLeft;
  }
  series.projectedCompletionTimestamp = null;
  series.paceMinutes = 0;
  series.notEnoughRecentData = false;
  if (readiness.ready) {
    // the pace comes from the recent window only (30 minutes to 2 hours, no big gap), like planets
    const { start, brokenByGap } = findTrendWindowStart(points.map(point => point.x));
    const firstPoint = points[start];
    const lastPoint = points[points.length - 1];
    const spanMilliseconds = lastPoint.x - firstPoint.x;
    const measuredPercentPerHour = (lastPoint.y - firstPoint.y) / (spanMilliseconds / 3600000);
    if (spanMilliseconds < TREND_MINIMUM_SPAN_MILLISECONDS || !isFiniteNumber(measuredPercentPerHour)) {
      series.notEnoughRecentData = brokenByGap;
      return series;
    }
    series.measuredPercentPerHour = measuredPercentPerHour;
    series.paceMinutes = spanMilliseconds / 60000;
    if (hoursLeft !== null) {
      series.projectedPercentAtDeadline = Math.max(0, Math.min(100, lastPoint.y + measuredPercentPerHour * hoursLeft));
    }
    if (measuredPercentPerHour > 0) {
      series.projectedCompletionTimestamp = lastPoint.x + (100 - lastPoint.y) / measuredPercentPerHour * 3600000;
    }
  }
  return series;
}

// A Major Order's progress samples: the shared history's, then the page's own.
function getMajorOrderSamples(assignmentId) {
  return mergeSampleLists(
    asArray(apiData.sharedHistory?.majorOrderSamples).filter(sample => sample.assignmentId === assignmentId),
    asArray(apiData.majorOrderHistory).filter(sample => sample.assignmentId === assignmentId));
}

// ── GRAPHS: DRAWING ──────────────────────────────────────────────────────────
// Inline SVG built with DOM calls, no library. Text inside charts always uses
// text colours; only the marks carry series colours.

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

// Creates an SVG element with attributes and children.
function createSvgElement(tagName, attributes = {}, children = []) {
  const element = document.createElementNS(SVG_NAMESPACE, tagName);
  for (const [attributeName, attributeValue] of Object.entries(attributes)) {
    if (attributeValue !== null && attributeValue !== undefined) element.setAttribute(attributeName, String(attributeValue));
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

// Maps a value from one range onto another (straight line).
function scaleValue(value, domainMinimum, domainMaximum, rangeMinimum, rangeMaximum) {
  if (domainMaximum === domainMinimum) return (rangeMinimum + rangeMaximum) / 2;
  return rangeMinimum + (value - domainMinimum) / (domainMaximum - domainMinimum) * (rangeMaximum - rangeMinimum);
}

// A y range that fits the values with a little air, never narrower than
// minimumSpan, and clamped to [floor, ceiling] (e.g. 0–100 for percents).
function fitValueDomain(values, minimumSpan, floor = -Infinity, ceiling = Infinity) {
  const finiteValues = values.filter(isFiniteNumber);
  if (finiteValues.length === 0) return [0, 1];
  let minimum = Math.min(...finiteValues);
  let maximum = Math.max(...finiteValues);
  const padding = Math.max((maximum - minimum) * 0.15, (minimumSpan - (maximum - minimum)) / 2, 0);
  minimum = Math.max(floor, minimum - padding);
  maximum = Math.min(ceiling, maximum + padding);
  if (maximum - minimum < minimumSpan) {
    if (minimum === floor) maximum = Math.min(ceiling, minimum + minimumSpan);
    else minimum = Math.max(floor, maximum - minimumSpan);
  }
  return [minimum, maximum];
}

// A timestamp → local "17:05".
function formatClockTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString(DISPLAY_LOCALE, { hour: '2-digit', minute: '2-digit' });
}

// A chart time: "17:05", or "Tue 17:05" when the chart spans most of a day or more.
function formatChartTime(timestamp, spanMilliseconds) {
  if (spanMilliseconds < 20 * 3600000) return formatClockTime(timestamp);
  return new Date(timestamp).toLocaleString(DISPLAY_LOCALE, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

// Splits a line's points wherever two samples are further apart than CHART_GAP_MILLISECONDS,
// so a gap in the history shows as a break instead of a made-up straight line.
function splitPointsAtGaps(points) {
  const runs = [];
  for (const point of points) {
    const currentRun = runs[runs.length - 1];
    if (currentRun && point.x - currentRun[currentRun.length - 1].x <= CHART_GAP_MILLISECONDS) currentRun.push(point);
    else runs.push([point]);
  }
  return runs;
}

// How wide to draw charts: the viewport minus page padding, within limits,
// so text inside the SVG stays readable on phones instead of shrinking.
function getChartWidth(maximumWidth = 760) {
  const viewportWidth = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 800;
  return Math.max(280, Math.min(maximumWidth, viewportWidth - 72));
}

// The "measuring" line shown instead of a graph without enough history.
function buildMeasuringMessage(readiness, subject) {
  return buildStatusLine({
    status: 'neutral', icon: '…',
    text: `Measuring ${subject} — about ${readiness.minutesNeeded} more minute${readiness.minutesNeeded === 1 ? '' : 's'} of watching before there is anything honest to draw.`,
  }, 'verdict chart-measuring');
}

// A line chart as a <figure>: hairline grid, 2px lines with an end dot and an
// end label, a legend for two or more series, a crosshair readout driven by
// pointer or arrow keys, and every number in a table underneath.
function buildLineChart({ title, series, yDomain, formatY, width = getChartWidth(), height = 200,
                          referenceLines = [], compact = false }) {
  const margin = { top: 14, right: compact ? 64 : 96, bottom: 26, left: compact ? 46 : 52 };
  const allPoints = series.flatMap(line => line.points);
  const allTimes = [...new Set(allPoints.map(point => point.x))].sort((first, second) => first - second);
  const xDomain = [Math.min(...allTimes, ...referenceLines.flatMap(line => line.points.map(point => point.x))),
                   Math.max(...allTimes, ...referenceLines.flatMap(line => line.points.map(point => point.x)))];
  const xOf = time => scaleValue(time, xDomain[0], xDomain[1], margin.left, width - margin.right);
  const formatTime = time => formatChartTime(time, xDomain[1] - xDomain[0]);
  const yOf = value => scaleValue(value, yDomain[0], yDomain[1], height - margin.bottom, margin.top);

  const svg = createSvgElement('svg', {
    viewBox: `0 0 ${width} ${height}`, width, height, class: 'line-chart',
    role: 'img', tabindex: 0,
    'aria-label': `${title}. Use the left and right arrow keys to read values; the numbers are also in the table below.`,
  });

  // hairline grid: the top and bottom of the value range, labelled
  for (const gridValue of [yDomain[0], yDomain[1]]) {
    // every chart keeps its scale: a zoomed-in y range without labels would
    // make a half-point wobble look like a cliff
    svg.append(createSvgElement('line', { class: 'chart-grid', x1: margin.left, x2: width - margin.right, y1: yOf(gridValue), y2: yOf(gridValue) }));
    svg.append(createSvgElement('text', { class: 'chart-axis-label', x: margin.left - 6, y: yOf(gridValue) + 4, 'text-anchor': 'end' },
      [document.createTextNode(formatY(gridValue))]));
  }
  // time axis: first and last time
  svg.append(createSvgElement('text', { class: 'chart-axis-label', x: margin.left, y: height - 6 }, [document.createTextNode(formatTime(xDomain[0]))]));
  svg.append(createSvgElement('text', { class: 'chart-axis-label', x: width - margin.right, y: height - 6, 'text-anchor': 'end' },
    [document.createTextNode(formatTime(xDomain[1]))]));

  for (const referenceLine of referenceLines) {
    svg.append(createSvgElement('polyline', {
      class: `chart-reference ${referenceLine.className || ''}`,
      points: referenceLine.points.map(point => `${xOf(point.x)},${yOf(point.y)}`).join(' '),
    }));
  }

  // End labels only when none would collide; otherwise the legend and the
  // readout carry the values (stacked, nudged labels detach from their lines).
  const endYs = series.filter(line => line.points.length > 0).map(line => yOf(line.points[line.points.length - 1].y));
  const endLabelsFit = endYs.every((endY, position) => endYs.every((otherY, otherPosition) =>
    position === otherPosition || Math.abs(endY - otherY) >= 14));
  for (const line of series) {
    if (line.points.length === 0) continue;
    for (const run of splitPointsAtGaps(line.points)) {
      // a lone sample between two gaps still shows, as a dot
      svg.append(run.length === 1
        ? createSvgElement('circle', { class: `chart-lone-point ${line.className}`, cx: xOf(run[0].x), cy: yOf(run[0].y), r: 2 })
        : createSvgElement('polyline', {
          class: `chart-line ${line.className}`,
          points: run.map(point => `${xOf(point.x)},${yOf(point.y)}`).join(' '),
        }));
    }
    const lastPoint = line.points[line.points.length - 1];
    svg.append(createSvgElement('circle', { class: `chart-end-dot ${line.className}`, cx: xOf(lastPoint.x), cy: yOf(lastPoint.y), r: 4 }));
    if (endLabelsFit) {
      svg.append(createSvgElement('text', { class: 'chart-end-label', x: xOf(lastPoint.x) + 8, y: yOf(lastPoint.y) + 4 },
        [document.createTextNode(formatY(lastPoint.y))]));
    }
  }

  // crosshair + readout: one line listing every series at the nearest time
  const crosshair = createSvgElement('line', { class: 'chart-crosshair', x1: 0, x2: 0, y1: margin.top, y2: height - margin.bottom, visibility: 'hidden' });
  svg.append(crosshair);
  const readout = buildElement('p', { className: 'chart-readout', text: 'Hover, tap or use the arrow keys for values.' });

  let readoutPosition = allTimes.length - 1;
  // Moves the crosshair to one sample time and lists every series there.
  const showReadoutAt = position => {
    if (allTimes.length === 0) return;
    readoutPosition = Math.max(0, Math.min(allTimes.length - 1, position));
    const time = allTimes[readoutPosition];
    crosshair.setAttribute('x1', xOf(time));
    crosshair.setAttribute('x2', xOf(time));
    crosshair.setAttribute('visibility', 'visible');
    const values = series.map(line => {
      const point = line.points.find(candidate => candidate.x === time);
      return point ? `${line.label} ${formatY(point.y)}` : null;
    }).filter(Boolean);
    readout.textContent = `${formatTime(time)} — ${values.join(' · ') || 'no value'}`;
  };
  svg.addEventListener('pointermove', event => {
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width) return;
    const pointerX = (event.clientX - bounds.left) / bounds.width * width;
    let nearest = 0;
    allTimes.forEach((time, position) => {
      if (Math.abs(xOf(time) - pointerX) < Math.abs(xOf(allTimes[nearest]) - pointerX)) nearest = position;
    });
    showReadoutAt(nearest);
  });
  svg.addEventListener('focus', () => showReadoutAt(readoutPosition));
  svg.addEventListener('keydown', event => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const move = moves[event.key];
    showReadoutAt(Number.isFinite(move) ? readoutPosition + move : (move < 0 ? 0 : allTimes.length - 1));
  });

  const legend = series.length >= 2 || referenceLines.length > 0
    ? buildElement('ul', { className: 'chart-legend' }, [
      ...series.map(line => buildElement('li', {}, [buildElement('span', { className: `legend-key ${line.className}`, attributes: { 'aria-hidden': 'true' } }), line.label])),
      ...referenceLines.map(line => buildElement('li', {}, [buildElement('span', { className: `legend-key legend-key-reference ${line.className || ''}`, attributes: { 'aria-hidden': 'true' } }), line.label])),
    ]) : null;

  const table = buildTable(`${title}: the numbers`, ['Time', ...series.map(line => line.label)],
    allTimes.map(time => [formatTime(time), ...series.map(line => {
      const point = line.points.find(candidate => candidate.x === time);
      return point ? formatY(point.y) : '—';
    })]));

  return buildElement('figure', { className: `chart${compact ? ' chart-compact' : ''}` }, [
    buildElement('figcaption', { className: 'chart-title', text: title }),
    legend,
    buildElement('div', { className: 'chart-frame' }, [svg]),
    readout,
    buildElement('details', { className: 'chart-table' }, [buildElement('summary', { text: 'Show the numbers' }), table]),
  ]);
}

// Enemy recovery against Helldiver pressure per planet: two bars per row on
// one shared scale, values at the bar tips, "measuring" where unknown.
function buildPressureChart(rows, width = getChartWidth()) {
  const labelWidth = Math.min(150, Math.round(width * 0.32));
  const valueWidth = 84;
  const barThickness = 10;
  const rowHeight = 44;
  const height = rows.length * rowHeight + 8;
  const scaleMaximum = Math.max(0.5, ...rows.flatMap(row => [row.regen, row.pressure]).filter(isFiniteNumber));
  const barLength = value => scaleValue(Math.max(0, value), 0, scaleMaximum, 0, width - labelWidth - valueWidth);

  const svg = createSvgElement('svg', {
    viewBox: `0 0 ${width} ${height}`, width, height, class: 'bar-chart', role: 'img',
    'aria-label': 'Enemy recovery against Helldiver pressure for each liberation campaign. The numbers are also in the table below.',
  });
  rows.forEach((row, rowPosition) => {
    const rowTop = rowPosition * rowHeight + 4;
    svg.append(createSvgElement('text', { class: 'chart-row-label', x: 0, y: rowTop + 17 }, [document.createTextNode(row.planet.name)]));
    const bars = [
      { value: row.regen, className: 'pressure-enemy', text: formatEnemyRecovery(row.regen), offset: 6 },
      { value: row.pressure, className: 'pressure-helldivers', offset: 6 + barThickness + 6,
        text: isFiniteNumber(row.pressure) ? `${row.pressure.toFixed(2)}%/h` : (row.verdict === 'stalled' ? '≤ recovery' : 'measuring…') },
    ];
    for (const bar of bars) {
      const length = isFiniteNumber(bar.value) ? barLength(bar.value) : 0;
      if (length > 0) {
        svg.append(createSvgElement('rect', { class: bar.className, x: labelWidth, y: rowTop + bar.offset, width: length, height: barThickness, rx: 4 }));
      }
      svg.append(createSvgElement('text', { class: 'chart-end-label', x: labelWidth + length + 6, y: rowTop + bar.offset + barThickness - 1 },
        [document.createTextNode(bar.text)]));
    }
  });

  const table = buildTable('Enemy recovery vs Helldiver pressure: the numbers', ['Planet', 'Enemy recovery', 'Helldiver pressure'],
    rows.map(row => [row.planet.name, formatEnemyRecovery(row.regen),
      isFiniteNumber(row.pressure) ? `${row.pressure.toFixed(2)}%/h` : (row.verdict === 'stalled' ? '≤ recovery (stuck at 0%)' : 'measuring')]));

  return buildElement('figure', { className: 'chart' }, [
    buildElement('figcaption', { className: 'chart-title', text: 'Enemy recovery vs Helldiver pressure (% of the planet per hour)' }),
    buildElement('ul', { className: 'chart-legend' }, [
      buildElement('li', {}, [buildElement('span', { className: 'legend-key legend-key-bar pressure-enemy', attributes: { 'aria-hidden': 'true' } }), 'Enemy recovery']),
      buildElement('li', {}, [buildElement('span', { className: 'legend-key legend-key-bar pressure-helldivers', attributes: { 'aria-hidden': 'true' } }), 'Helldiver pressure']),
    ]),
    buildElement('div', { className: 'chart-frame' }, [svg]),
    buildElement('details', { className: 'chart-table' }, [buildElement('summary', { text: 'Show the numbers' }), table]),
  ]);
}

// The 1h / 6h / 24h / 7d buttons and where the history comes from, above the graphs.
function buildGraphRangeControls() {
  const buttons = GRAPH_RANGES.map(range => {
    const button = buildElement('button', {
      className: 'graph-range-button', text: range.label,
      attributes: { type: 'button', 'aria-pressed': String(range.hours === graphRangeHours), 'data-graph-range': range.hours },
    });
    button.addEventListener('click', () => changeGraphRange(range.hours));
    return button;
  });
  return buildElement('div', { className: 'graph-controls' }, [
    buildElement('div', { className: 'graph-range', attributes: { role: 'group', 'aria-label': 'Time range of the graphs' } }, buttons),
    buildElement('p', { className: 'section-hint graph-history-source', text:
      `${describeHistorySource()}. `
      + (apiData.sharedHistoryStatus === 'loaded'
        ? 'The long ranges come from a war record the site keeps every 15 minutes; breaks in a line are gaps in it.'
        : 'This browser only remembers the last 45 minutes, so the long ranges fill in once the shared history loads.') }),
  ]);
}

// Everything the graphs section shows → #output-graphs
function renderTrendGraphs() {
  if (!hasAnyData()) {
    replaceContent('output-graphs', [buildWaitingMessage()]);
    return;
  }
  const blocks = [buildGraphRangeControls()];

  // 1. Major Order progress against time left
  blocks.push(buildElement('h3', { text: 'Major Order progress against time left' }));
  const majorOrder = apiData.assignments[0];
  if (!majorOrder) {
    blocks.push(buildElement('p', { className: 'empty-state', text: 'No Major Order right now.' }));
  } else {
    majorOrder.tasks.forEach((task, taskPosition) => {
      const taskSeries = buildMajorOrderTaskSeries(majorOrder, taskPosition);
      if (!taskSeries.chartable) {
        blocks.push(buildElement('p', { className: 'section-hint',
          text: `${taskSeries.sentence}: follows a planet, so see that planet's liberation graph below.` }));
        return;
      }
      if (taskSeries.isComplete) {
        blocks.push(buildStatusLine({ status: 'good', icon: '✔', text: `${taskSeries.sentence}: done.` }));
        return;
      }
      const visiblePoints = keepPointsInRange(taskSeries.points);
      const visibleReadiness = describeHistoryReadiness(visiblePoints.map(point => point.x));
      if (!visibleReadiness.ready) {
        blocks.push(buildMeasuringMessage(visibleReadiness, `"${taskSeries.sentence}"`));
        return;
      }
      const lastPoint = visiblePoints[visiblePoints.length - 1];
      const hasPace = taskSeries.measuredPercentPerHour !== null;
      const referenceLines = taskSeries.deadlineTimestamp ? [
        { label: 'Pace needed to finish by the deadline', className: 'reference-needed',
          points: [lastPoint, { x: taskSeries.deadlineTimestamp, y: 100 }] },
        hasPace ? { label: 'Current pace, projected', className: 'reference-projected',
          // stops where it reaches 100% if that happens before the deadline
          points: [lastPoint, taskSeries.projectedCompletionTimestamp !== null && taskSeries.projectedCompletionTimestamp < taskSeries.deadlineTimestamp
            ? { x: taskSeries.projectedCompletionTimestamp, y: 100 }
            : { x: taskSeries.deadlineTimestamp, y: taskSeries.projectedPercentAtDeadline ?? lastPoint.y }] } : null,
      ].filter(Boolean) : [];
      blocks.push(buildLineChart({
        title: taskSeries.sentence,
        series: [{ label: 'Progress', className: 'series-progress', points: visiblePoints }],
        referenceLines,
        yDomain: [0, 100],
        formatY: value => formatPercent(value),
      }));
      blocks.push(buildElement('p', { className: 'section-hint', text: hasPace
        ? `Measured pace ${formatPercentPerHour(taskSeries.measuredPercentPerHour)}, needed ${formatPercentPerHour(taskSeries.requiredPercentPerHour)}; `
          + `at this pace it reaches about ${formatPercent(taskSeries.projectedPercentAtDeadline, 0)} by the deadline. An estimate from the last ${Math.round(taskSeries.paceMinutes)} minutes.`
        : `Needed pace ${formatPercentPerHour(taskSeries.requiredPercentPerHour)}. Not enough recent data for the current pace yet.` }));
    });
  }

  // 2. Helldivers per front over time
  blocks.push(buildElement('h3', { text: 'Helldivers per front' }));
  const fronts = buildFrontPlayerSeries();
  const visibleFronts = fronts.series.map(line => ({ ...line, points: keepPointsInRange(line.points) }))
    .filter(line => line.points.length > 0);
  const visibleFrontReadiness = describeHistoryReadiness(visibleFronts.flatMap(line => line.points.map(point => point.x)));
  if (!visibleFrontReadiness.ready) {
    blocks.push(buildMeasuringMessage(visibleFrontReadiness, 'player counts'));
  } else {
    const allPlayerCounts = visibleFronts.flatMap(line => line.points.map(point => point.y));
    blocks.push(buildLineChart({
      title: 'Helldivers on active campaigns, per front',
      series: visibleFronts.map(line => ({ label: getFactionDisplayName(line.factionKey), className: `series-${line.factionKey}`, points: line.points })),
      yDomain: fitValueDomain(allPlayerCounts, 100, 0),
      formatY: value => formatBigNumber(value),
    }));
  }

  // 3. Enemy recovery against Helldiver pressure
  blocks.push(buildElement('h3', { text: 'Enemy recovery vs Helldiver pressure' }));
  const pressureRows = rankLiberationCampaigns().map(entry => ({
    planet: entry.planet, regen: entry.outlook.regenPercentPerHour,
    pressure: entry.outlook.playerOutputPercentPerHour, verdict: entry.outlook.verdict,
  })).filter(row => isFiniteNumber(row.regen));
  if (pressureRows.length === 0) {
    blocks.push(buildElement('p', { className: 'empty-state', text: 'No liberation campaigns right now.' }));
  } else {
    blocks.push(buildPressureChart(pressureRows));
    blocks.push(buildElement('p', { className: 'section-hint',
      text: 'Pressure is measured from how fast each planet moves plus its recovery, so it shows "measuring" for the first few minutes.' }));
  }

  // 4. Liberation (or defense) over the remembered window, one small chart per planet
  blocks.push(buildElement('h3', { text: 'Progress on each planet (its current fight)' }));
  const planetCharts = [];
  const stillMeasuring = [];
  for (const planetIndex of apiData.indexesOfPlanetsWithActiveBattles) {
    const planet = apiData.planetsByIndex[planetIndex];
    if (!planet) continue;
    const allProgress = buildPlanetProgressSeries(getPlanetSamples(planet));
    const visibleProgressPoints = keepPointsInRange(allProgress.points);
    const progress = { ...allProgress, points: visibleProgressPoints,
      ...describeHistoryReadiness(visibleProgressPoints.map(point => point.x)) };
    if (!progress.ready) {
      stillMeasuring.push({ planet, progress });
      continue;
    }
    const label = progress.field === 'defensePercent' ? 'Defended' : 'Liberated';
    planetCharts.push(buildLineChart({
      title: `${planet.name} — ${label.toLowerCase()}`,
      series: [{ label, className: 'series-progress', points: progress.points }],
      yDomain: fitValueDomain(progress.points.map(point => point.y), 2, 0, 100),
      formatY: value => formatPercent(value),
      width: Math.min(getChartWidth(), 360), height: 120, compact: true,
    }));
  }
  if (planetCharts.length > 0) blocks.push(buildElement('div', { className: 'chart-grid' }, planetCharts));
  if (stillMeasuring.length > 0) {
    const minutesNeeded = Math.max(...stillMeasuring.map(entry => entry.progress.minutesNeeded));
    blocks.push(buildMeasuringMessage({ minutesNeeded },
      `${stillMeasuring.length} planet${stillMeasuring.length === 1 ? '' : 's'} (${stillMeasuring.slice(0, 4).map(entry => entry.planet.name).join(', ')}${stillMeasuring.length > 4 ? '…' : ''})`));
  }
  if (planetCharts.length === 0 && stillMeasuring.length === 0) {
    blocks.push(buildElement('p', { className: 'empty-state', text: 'No planets are being fought over right now.' }));
  }

  replaceContent('output-graphs', blocks);
}

// ── GALACTIC WAR MAP ─────────────────────────────────────────────────────────
// Planets at their API positions, supply lines from waypoints, attack lines
// from `attacking`, coloured by owner. Battle planets are in the tab
// order; arrow keys move between neighbouring planets; Enter or a click
// jumps to the planet's section in advanced mode.

const MAP_SIZE = 1000;
const MAP_PADDING = 40;
const MAP_ZOOM_LEVELS = [1, 2, 4];
// The API's y grows upward (Super Earth at 0,0; the bot and bug fronts have
// positive y), while SVG's y grows downward. Unverified against the in-game
// map: flip this if the owner finds the map upside down.
const MAP_Y_AXIS_POINTS_UP = true;

// Zoom and focus survive re-renders on every refresh.
const mapViewState = { zoomLevel: 1, center: { x: MAP_SIZE / 2, y: MAP_SIZE / 2 }, focusedPlanetIndex: null };

// An API position {x, y} in -1…1 → SVG coordinates; null when unusable.
function projectPlanetPosition(position, size = MAP_SIZE, padding = MAP_PADDING) {
  if (!isPlainObject(position) || !isFiniteNumber(position.x) || !isFiniteNumber(position.y)) return null;
  const halfSpan = size / 2 - padding;
  const clampedX = Math.max(-1, Math.min(1, position.x));
  const clampedY = Math.max(-1, Math.min(1, position.y));
  return {
    x: size / 2 + clampedX * halfSpan,
    y: size / 2 + (MAP_Y_AXIS_POINTS_UP ? -clampedY : clampedY) * halfSpan,
  };
}

// Supply lines as unique, unordered planet pairs (A–B once, never A–A),
// only between planets that are on the map.
function buildSupplyLinePairs(planets) {
  const onMap = new Set(planets.filter(planet => projectPlanetPosition(planet.position)).map(planet => planet.index));
  const seen = new Set();
  const pairs = [];
  for (const planet of planets) {
    if (!onMap.has(planet.index)) continue;
    for (const neighbourIndex of asArray(planet.waypoints)) {
      if (neighbourIndex === planet.index || !onMap.has(neighbourIndex)) continue;
      const key = [planet.index, neighbourIndex].sort((first, second) => first - second).join('-');
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ fromIndex: Math.min(planet.index, neighbourIndex), toIndex: Math.max(planet.index, neighbourIndex) });
    }
  }
  return pairs;
}

// Attack lines as unique, directed pairs (attacker → target). In real data
// most are Super Earth's own lanes into enemy planets (every one of the 67 in
// the captured war status was); enemy lines appear when an enemy attacks a
// planet we hold. Super Earth's lanes come first so enemy lines draw on top.
function buildAttackLines(planets) {
  const onMap = new Set(planets.filter(planet => projectPlanetPosition(planet.position)).map(planet => planet.index));
  const seen = new Set();
  const lines = [];
  for (const planet of planets) {
    if (!onMap.has(planet.index)) continue;
    for (const targetIndex of asArray(planet.attacking)) {
      const key = `${planet.index}>${targetIndex}`;
      if (targetIndex === planet.index || !onMap.has(targetIndex) || seen.has(key)) continue;
      seen.add(key);
      lines.push({ fromIndex: planet.index, toIndex: targetIndex, isSuperEarthLane: getMapOwnerKey(planet) === 'humans' });
    }
  }
  return lines.sort((first, second) => second.isSuperEarthLane - first.isSuperEarthLane);
}

// The visible part of the map for a zoom level around a centre, kept inside
// the map so zooming near an edge doesn't show empty space.
function computeMapViewBox(zoomLevel, center, size = MAP_SIZE) {
  const zoom = Math.max(1, zoomLevel || 1);
  const width = size / zoom;
  const x = Math.max(0, Math.min(size - width, center.x - width / 2));
  const y = Math.max(0, Math.min(size - width, center.y - width / 2));
  return { x, y, width, height: width };
}

// The closest planet roughly in one direction ('left'|'right'|'up'|'down')
// from a point, among {index, x, y} candidates. Planets off to the side
// count as further away, so the choice matches what the eye expects.
function findNearestPlanetInDirection(from, direction, candidates) {
  const directionVectors = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
  const vector = directionVectors[direction];
  if (!vector || !from) return null;
  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const deltaX = candidate.x - from.x;
    const deltaY = candidate.y - from.y;
    const along = deltaX * vector[0] + deltaY * vector[1];
    if (along <= 0.5) continue;                         // behind or level with us
    const across = Math.abs(deltaX * vector[1] - deltaY * vector[0]);
    if (across > along * 2) continue;                   // too far off to the side
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = candidate.index;
    }
  }
  return best;
}

// Owner key for colouring: an enemy faction key, 'humans' or 'unknown'.
function getMapOwnerKey(planet) {
  return normalizeFactionName(planet.currentOwner) || getFactionKey(planet.currentOwner) || 'unknown';
}

// One sentence of numbers for a planet: owner, progress, players, and
// whether the Major Order wants it. Used for aria-labels and the info panel.
function describeMapPlanet(planet, majorOrderTargets = getMajorOrderTargets()) {
  const parts = [planet.name];
  const ownerKey = getMapOwnerKey(planet);
  parts.push(ownerKey === 'humans' ? 'held by Super Earth' : ownerKey === 'unknown' ? 'owner unknown' : `held by the ${getFactionDisplayName(ownerKey)}`);
  if (planetIsUnderAttack(planet)) {
    parts.push(`under attack, ${formatPercent(getDefenseProgressPercent(planet.event))} defended`);
    const secondsLeft = getSecondsUntil(planet.event.endTime);
    if (secondsLeft !== null) parts.push(`${formatDuration(secondsLeft)} left`);
  } else if (apiData.indexesOfPlanetsWithActiveBattles.has(planet.index) && hasKnownHealth(planet)) {
    parts.push(`${formatPercent(getLiberationPercent(planet))} liberated`);
  }
  const players = planet.statistics?.playerCount;
  if (isFiniteNumber(players) && players > 0) parts.push(`${formatBigNumber(players)} Helldivers`);
  if (majorOrderTargets.planetIndexes.has(planet.index)) parts.push('Major Order target');
  return parts.join(', ');
}

// Planets that can be drawn, with their projected positions.
function getMapPlanets() {
  return apiData.planets
    .map(planet => ({ planet, point: projectPlanetPosition(planet.position) }))
    .filter(entry => entry.point !== null);
}

// How much to scale planet markers: shrink them as you zoom in (so they stay
// the same size on screen) and grow them on a narrow map (so a phone can
// still read labels and hit a planet with a finger).
function getMapMarkerScale(zoom, mapPixelWidth) {
  const viewportWidth = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 800;
  const drawnWidth = mapPixelWidth > 0 ? mapPixelWidth : Math.min(1160, viewportWidth - 48);
  const narrowScreenBoost = Math.min(2, Math.max(1, 640 / drawnWidth));
  return narrowScreenBoost / Math.max(1, zoom);
}

// Applies the current zoom to the map without rebuilding it.
function applyMapZoom() {
  const svg = document.querySelector('#output-war-map svg.war-map');
  if (!svg) return;
  const viewBox = computeMapViewBox(MAP_ZOOM_LEVELS[mapViewState.zoomLevel - 1] || mapViewState.zoomLevel, mapViewState.center);
  svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
  const zoom = MAP_SIZE / viewBox.width;
  // keep labels and markers roughly the same on-screen size at every zoom
  const markerScale = getMapMarkerScale(zoom, svg.clientWidth);
  svg.style.setProperty('--map-scale', String(1 / zoom));
  for (const markerBody of svg.querySelectorAll('.map-marker-body')) {
    markerBody.setAttribute('transform', `scale(${markerScale})`);
  }
  svg.classList.toggle('is-zoomed', zoom > 1);
  putTextInElement('map-zoom-level', `Zoom ×${zoom}`);
}

// Zooms in or out one step, centred on the focused planet if there is one.
function changeMapZoom(step) {
  const zoomLevels = MAP_ZOOM_LEVELS;
  const currentPosition = Math.max(0, zoomLevels.indexOf(MAP_ZOOM_LEVELS[mapViewState.zoomLevel - 1]));
  const nextPosition = step === 0 ? 0 : Math.max(0, Math.min(zoomLevels.length - 1, currentPosition + step));
  mapViewState.zoomLevel = nextPosition + 1;
  const focusedPlanet = apiData.planetsByIndex[mapViewState.focusedPlanetIndex];
  const focusedPoint = focusedPlanet ? projectPlanetPosition(focusedPlanet.position) : null;
  mapViewState.center = step === 0 || !focusedPoint ? { x: MAP_SIZE / 2, y: MAP_SIZE / 2 } : focusedPoint;
  applyMapZoom();
}

// Shows a planet's numbers in the panel under the map.
function showMapPlanetInfo(planetIndex) {
  const planet = apiData.planetsByIndex[planetIndex];
  if (!planet) return;
  mapViewState.focusedPlanetIndex = planetIndex;
  putTextInElement('map-planet-info', `${describeMapPlanet(planet)}. Press Enter or click for its details beside the map.`);
  for (const marker of document.querySelectorAll('#output-war-map .map-planet.is-selected')) marker.classList.remove('is-selected');
  const marker = document.querySelector(`#output-war-map .map-planet[data-planet-index="${planetIndex}"]`);
  if (marker) marker.classList.add('is-selected');
}

// Keyboard on a focused planet: Enter/Space open its details, arrows move to a neighbour.
function handleMapKeydown(event) {
  const marker = event.target.closest && event.target.closest('.map-planet');
  if (!marker) return;
  const planetIndex = Number(marker.dataset.planetIndex);
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openPlanetDrawer(planetIndex, { opener: marker, moveFocus: false });
    return;
  }
  const directionByKey = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  const direction = directionByKey[event.key];
  if (!direction) return;
  event.preventDefault();
  const candidates = getMapPlanets().map(entry => ({ index: entry.planet.index, ...entry.point }));
  const from = candidates.find(candidate => candidate.index === planetIndex);
  const nextIndex = findNearestPlanetInDirection(from, direction, candidates);
  const nextMarker = nextIndex !== null
    ? document.querySelector(`#output-war-map .map-planet[data-planet-index="${nextIndex}"]`) : null;
  if (nextMarker) nextMarker.focus();
}

// The whole map → #output-war-map: zoom controls, the SVG, a legend, the
// info panel and notes about what the current source can't show.
function renderWarMap() {
  if (!hasAnyData()) {
    replaceContent('output-war-map', [buildWaitingMessage()]);
    return;
  }
  const mapPlanets = getMapPlanets();
  if (mapPlanets.length === 0) {
    replaceContent('output-war-map', [buildElement('p', { className: 'empty-state', text: 'No planet positions yet.' })]);
    return;
  }
  const pointByIndex = Object.fromEntries(mapPlanets.map(entry => [entry.planet.index, entry.point]));
  const majorOrderTargets = getMajorOrderTargets();
  const topRankedIndexes = new Set(rankLiberationCampaigns().slice(0, SIMPLE_MODE_DROP_TARGET_COUNT).map(entry => entry.planet.index));

  const svg = createSvgElement('svg', {
    class: 'war-map', viewBox: `0 0 ${MAP_SIZE} ${MAP_SIZE}`, role: 'group',
    'aria-label': 'Galactic war map. Tab moves between planets being fought over; arrow keys move to the nearest planet in that direction; Enter shows a planet\'s details beside the map, and Escape closes them.',
  });

  const supplyLayer = createSvgElement('g', { class: 'map-supply-lines', 'aria-hidden': 'true' });
  for (const pair of buildSupplyLinePairs(apiData.planets)) {
    const from = pointByIndex[pair.fromIndex];
    const to = pointByIndex[pair.toIndex];
    supplyLayer.append(createSvgElement('line', { class: 'map-supply-line', x1: from.x, y1: from.y, x2: to.x, y2: to.y }));
  }
  const attackLayer = createSvgElement('g', { class: 'map-attack-lines', 'aria-hidden': 'true' });
  for (const attack of buildAttackLines(apiData.planets)) {
    const from = pointByIndex[attack.fromIndex];
    const to = pointByIndex[attack.toIndex];
    const attacker = apiData.planetsByIndex[attack.fromIndex];
    attackLayer.append(createSvgElement('line', {
      class: `map-attack-line owner-${attacker ? getMapOwnerKey(attacker) : 'unknown'}`,
      x1: from.x, y1: from.y, x2: to.x, y2: to.y,
    }));
  }

  const planetLayer = createSvgElement('g', { class: 'map-planets' });
  // Quiet planets first so battle planets are drawn (and hit-tested) on top.
  const sortedPlanets = [...mapPlanets].sort((first, second) =>
    apiData.indexesOfPlanetsWithActiveBattles.has(first.planet.index) - apiData.indexesOfPlanetsWithActiveBattles.has(second.planet.index));
  for (const { planet, point } of sortedPlanets) {
    const isBattle = apiData.indexesOfPlanetsWithActiveBattles.has(planet.index);
    const isDefense = planetIsUnderAttack(planet);
    const isMajorOrderTarget = majorOrderTargets.planetIndexes.has(planet.index);
    const classNames = ['map-planet', `owner-${getMapOwnerKey(planet)}`];
    if (isBattle) classNames.push('is-battle');
    if (isDefense) classNames.push('is-defense');
    if (isMajorOrderTarget) classNames.push('is-major-order');
    if (planet.index === mapViewState.focusedPlanetIndex) classNames.push('is-selected');

    // The outer group places the planet; the inner one is rescaled on zoom
    // so markers and labels stay the same size on screen.
    const markerBody = createSvgElement('g', { class: 'map-marker-body' }, [
      createSvgElement('circle', { class: 'map-hit-area', r: 16 }),
      isBattle ? createSvgElement('circle', { class: 'map-battle-ring', r: 13 }) : null,
      createSvgElement('circle', { class: 'map-planet-dot', r: isBattle ? 8 : 5 }),
    ]);
    const labelIsPriority = isDefense || isMajorOrderTarget || topRankedIndexes.has(planet.index);
    if (isBattle) {
      // labels near the right edge go on the left so they aren't cut off
      const labelOnLeft = point.x > MAP_SIZE * 0.7;
      markerBody.append(createSvgElement('text', {
        class: `map-label${labelIsPriority ? ' is-priority' : ''}`, y: 5,
        x: labelOnLeft ? -16 : 16, 'text-anchor': labelOnLeft ? 'end' : 'start',
      }, [document.createTextNode(planet.name)]));
    }
    planetLayer.append(createSvgElement('g', {
      class: classNames.join(' '), 'data-planet-index': planet.index, role: 'button',
      tabindex: isBattle ? 0 : -1, 'aria-label': describeMapPlanet(planet, majorOrderTargets),
      transform: `translate(${point.x} ${point.y})`,
    }, [markerBody]));
  }
  svg.append(supplyLayer, attackLayer, planetLayer);

  svg.addEventListener('focusin', event => {
    const marker = event.target.closest && event.target.closest('.map-planet');
    if (marker) showMapPlanetInfo(Number(marker.dataset.planetIndex));
  });
  svg.addEventListener('pointerover', event => {
    const marker = event.target.closest && event.target.closest('.map-planet');
    if (marker) showMapPlanetInfo(Number(marker.dataset.planetIndex));
  });
  svg.addEventListener('click', event => {
    const marker = event.target.closest && event.target.closest('.map-planet');
    if (marker) openPlanetDrawer(Number(marker.dataset.planetIndex), { opener: marker, moveFocus: false });
  });
  svg.addEventListener('keydown', handleMapKeydown);

  // Builds one legend entry: a swatch drawn the way the map draws it, plus words.
  const legendItem = (swatchClass, label) => buildElement('li', {}, [
    buildElement('span', { className: `map-swatch ${swatchClass}`, attributes: { 'aria-hidden': 'true' } }), label]);
  const notes = [];
  const missingPositions = apiData.planets.length - mapPlanets.length;
  if (missingPositions > 0) notes.push(`${missingPositions} planet${missingPositions === 1 ? ' has' : 's have'} no position and ${missingPositions === 1 ? 'is' : 'are'} not shown.`);
  if (apiData.currentDataSource === 'FALLBACK') notes.push('The backup API has no supply lines, so only attack lines are drawn.');
  else if (apiData.lastSuccessfulFetchTimestamp === null) notes.push('Supply lines and quiet planets arrive with the full planet list in a few seconds.');

  replaceContent('output-war-map', [
    buildElement('div', { className: 'map-controls' }, [
      buildElement('button', { text: 'Zoom in', attributes: { type: 'button', id: 'map-zoom-in' } }),
      buildElement('button', { text: 'Zoom out', attributes: { type: 'button', id: 'map-zoom-out' } }),
      buildElement('button', { text: 'Reset', attributes: { type: 'button', id: 'map-zoom-reset' } }),
      buildElement('span', { className: 'section-hint', attributes: { id: 'map-zoom-level' } }),
    ]),
    buildElement('div', { className: 'map-frame' }, [svg]),
    buildElement('p', { className: 'map-info', text: 'Hover or focus a planet for its numbers; click or press Enter for its details beside the map.',
      attributes: { id: 'map-planet-info', 'aria-live': 'polite' } }),
    buildElement('ul', { className: 'map-legend' }, [
      legendItem('owner-humans', 'Super Earth'),
      legendItem('owner-terminids', 'Terminids'),
      legendItem('owner-automaton', 'Automatons'),
      legendItem('owner-illuminate', 'Illuminate'),
      legendItem('swatch-battle', 'Being fought over'),
      legendItem('swatch-defense', 'Under attack'),
      legendItem('swatch-major-order', 'Major Order target'),
      legendItem('swatch-supply', 'Supply line'),
      legendItem('swatch-push', 'Super Earth attack lane'),
      legendItem('swatch-attack', 'Enemy attack, in the enemy\'s colour'),
    ]),
    ...notes.map(note => buildElement('p', { className: 'section-hint', text: note })),
  ]);

  document.getElementById('map-zoom-in').addEventListener('click', () => changeMapZoom(1));
  document.getElementById('map-zoom-out').addEventListener('click', () => changeMapZoom(-1));
  document.getElementById('map-zoom-reset').addEventListener('click', () => changeMapZoom(0));
  applyMapZoom();
  if (mapViewState.focusedPlanetIndex !== null && apiData.planetsByIndex[mapViewState.focusedPlanetIndex]) {
    showMapPlanetInfo(mapViewState.focusedPlanetIndex);
  }
}

// ── GAMBIT ANALYSER ──────────────────────────────────────────────────────────
// A per-front "what should we do next" read, worked out in the browser from
// the numbers the page already has, with fixed weights. No network and no
// randomness: the same apiData always gives the same advice, and every point
// a planet scores comes with the sentence that earned it.
//
// A "gambit" is the community's name for ending an enemy attack by liberating
// the planet it comes from instead of defending the target directly.

// Points each fact adds to (or takes from) a planet's score. In one place so
// the advice stays predictable and the owner can tune it.
const GAMBIT_WEIGHTS = {
  majorOrderPlanet: 50,
  majorOrderFaction: 15,
  defenseLosing: 45,
  defenseAtRisk: 35,
  defenseUnmeasured: 20,
  defenseOnTrack: 5,
  defenseDeadlineSoon: 10,
  defenseOutOfReach: -30,       // needs more Helldivers than the whole front has
  gambitInTime: 40,             // liberating it ends an attack before that attack's deadline
  gambitLaunchPad: 15,          // it launches an attack, but in time is not known or not likely
  liberationWinning: 25,
  liberationFinishingSoon: 10,
  liberationStalled: -20,
  liberationLosing: -25,
  regenGapWithinReach: 10,
  pointsPerTenPercentDone: 1,
  pointsPerSupplyLineNeighbour: 3,
  supplyLinePointsCap: 9,
  playerShareMaximum: 10,       // every Helldiver on the front is here → 10
};
const GAMBIT_SOON_HOURS = 6;                    // "deadline soon" and "finishing soon"
const GAMBIT_REGEN_GAP_SHARE_OF_FRONT = 0.25;   // a gap this share of the front could close
const GAMBIT_PICK_COUNT = 3;
const GAMBIT_AVOID_COUNT = 2;

// Planets joined to this one by a supply line, in either direction (the feeds
// don't promise to list a link on both ends).
function getSupplyLineNeighbours(planet) {
  const neighbourIndexes = new Set(asArray(planet.waypoints));
  for (const other of apiData.planets) {
    if (asArray(other.waypoints).includes(planet.index)) neighbourIndexes.add(other.index);
  }
  neighbourIndexes.delete(planet.index);
  return [...neighbourIndexes].map(index => apiData.planetsByIndex[index]).filter(Boolean);
}

// Enemy-held planets whose attack lines point at this planet.
function findEnemyAttackSources(planet) {
  return getAttackersOfPlanet(planet.index)
    .map(index => apiData.planetsByIndex[index])
    .filter(source => source && normalizeFactionName(source.currentOwner) !== null);
}

// Could liberating the planet an attack comes from end that attack in time?
// verdict: 'in-time' | 'too-slow' | 'failing' | 'unmeasured' | 'not-needed'
//        | 'no-campaign' | 'several-sources' | 'no-source'
function describeGambitOption(defensePlanet, nowTimestamp = Date.now(), galaxyOutputPerPlayer = null) {
  const defenseOutlook = describeDefenseOutlook(defensePlanet, getPlanetTrend(defensePlanet), nowTimestamp);
  const sources = findEnemyAttackSources(defensePlanet);
  const option = { defensePlanet, defenseOutlook, sourcePlanet: null, sourceOutlook: null, verdict: 'no-source', sentence: '' };
  const defenseName = defensePlanet.name;

  if (sources.length === 0) {
    option.sentence = `The feeds don't say which planet the attack on ${defenseName} comes from, so there is no gambit to check.`;
    return option;
  }
  if (sources.length > 1) {
    option.verdict = 'several-sources';
    option.sentence = `${defenseName} is attacked from ${formatPlanetNameList(sources.map(source => source.index))}. `
      + 'The page can\'t tell which one launched this attack, so it doesn\'t suggest a gambit.';
    return option;
  }

  const sourcePlanet = sources[0];
  option.sourcePlanet = sourcePlanet;
  const sourceHasCampaign = apiData.indexesOfPlanetsWithActiveBattles.has(sourcePlanet.index);
  if (!sourceHasCampaign) {
    option.verdict = 'no-campaign';
    option.sentence = `${defenseName} is attacked from ${sourcePlanet.name}, but Super Earth isn't fighting on `
      + `${sourcePlanet.name} right now, so there is no gambit: defend ${defenseName} directly.`;
    return option;
  }

  const sourceOutlook = describeLiberationOutlook(sourcePlanet, getPlanetTrend(sourcePlanet), galaxyOutputPerPlayer);
  option.sourceOutlook = sourceOutlook;
  const hoursLeft = defenseOutlook.hoursLeft;
  const deadlineText = hoursLeft === null ? 'no known deadline' : `${formatDuration(hoursLeft * 3600)} left`;

  if (defenseOutlook.verdict === 'on-track') {
    option.verdict = 'not-needed';
    option.sentence = `${defenseName} is on track to hold, so a gambit on ${sourcePlanet.name} isn't needed.`;
  } else if (sourceOutlook.verdict === 'winning' && hoursLeft !== null) {
    const hoursToLiberation = sourceOutlook.hoursToLiberation;
    const sourcePace = `At its measured pace ${sourcePlanet.name} falls in about ${formatDuration(hoursToLiberation * 3600)}`;
    if (hoursToLiberation < hoursLeft) {
      option.verdict = 'in-time';
      option.sentence = `Liberating ${sourcePlanet.name} would end the attack on ${defenseName}. `
        + `${sourcePace}, before ${defenseName}'s deadline (${deadlineText}).`;
    } else {
      option.verdict = 'too-slow';
      option.sentence = `${sourcePace}, longer than the ${deadlineText} ${defenseName} has. Defend ${defenseName} directly.`;
    }
  } else if (sourceOutlook.verdict === 'stalled' || sourceOutlook.verdict === 'losing') {
    option.verdict = 'failing';
    option.sentence = `${sourcePlanet.name} launched the attack on ${defenseName}, but it is `
      + `${sourceOutlook.verdict === 'stalled' ? 'stalled' : 'losing ground'}, so a gambit there would fail as things stand. `
      + `Defend ${defenseName} directly.`;
  } else {
    option.verdict = 'unmeasured';
    const missing = hoursLeft === null ? 'there is no deadline to compare against'
      : sourceOutlook.trendStatus !== 'measured' ? `${sourcePlanet.name}'s pace isn't measured yet`
        : `${sourcePlanet.name}'s progress can't be measured`;
    option.sentence = `Liberating ${sourcePlanet.name} would end the attack on ${defenseName} (${deadlineText}), `
      + `but ${missing}, so the page can't say whether it would be in time.`;
  }
  return option;
}

// One scored planet: every point comes from a reason, so score = sum of reasons.
function addGambitReason(candidate, points, text) {
  const roundedPoints = Math.round(points);
  if (roundedPoints === 0) return;
  candidate.reasons.push({ points: roundedPoints, text });
  candidate.score += roundedPoints;
}

// Scores one defense for its front: urgency, deadline, whether the front can
// even save it, the Major Order, supply lines and where Helldivers are.
function scoreDefenseCandidate(planet, context) {
  const candidate = { planet, kind: 'defense', score: 0, reasons: [], notes: [], outlook: null, gambit: null, tieBreakerPoints: 0 };
  const outlook = describeDefenseOutlook(planet, getPlanetTrend(planet), context.nowTimestamp);
  candidate.outlook = outlook;
  candidate.gambit = context.gambitByDefenseIndex.get(planet.index) || null;

  addMajorOrderReason(candidate, context);

  const timeLeft = outlook.hoursLeft === null ? null : formatDuration(outlook.hoursLeft * 3600);
  if (outlook.verdict === 'losing') {
    addGambitReason(candidate, GAMBIT_WEIGHTS.defenseLosing, 'Being lost: no progress against the attack');
  } else if (outlook.verdict === 'at-risk') {
    addGambitReason(candidate, GAMBIT_WEIGHTS.defenseAtRisk,
      `At risk: at this pace it reaches about ${formatPercent(outlook.projectedPercentAtDeadline, 0)} by the deadline`);
  } else if (outlook.verdict === 'on-track') {
    addGambitReason(candidate, GAMBIT_WEIGHTS.defenseOnTrack,
      `On track to hold (about ${formatDuration(outlook.hoursToWin * 3600)} to win, ${timeLeft} left)`);
  } else if (outlook.verdict === 'unknown') {
    addGambitReason(candidate, GAMBIT_WEIGHTS.defenseUnmeasured,
      outlook.hoursLeft === null ? 'No deadline known, so its urgency can\'t be measured' : 'Pace not measured yet, so it could be slipping');
  }

  const stillInDanger = outlook.verdict !== 'on-track';
  if (stillInDanger && outlook.hoursLeft !== null && outlook.hoursLeft < GAMBIT_SOON_HOURS) {
    addGambitReason(candidate, GAMBIT_WEIGHTS.defenseDeadlineSoon, `Only ${timeLeft} left`);
  }
  if (stillInDanger && outlook.playersNeededToWinInTime !== null && outlook.playersNeededToWinInTime > context.frontPlayerCount) {
    addGambitReason(candidate, GAMBIT_WEIGHTS.defenseOutOfReach,
      `Needs about ${formatBigNumber(outlook.playersNeededToWinInTime)} Helldivers to win in time (estimate), `
      + `more than the whole front has (${formatBigNumber(context.frontPlayerCount)})`);
  }

  const heldNeighbours = getSupplyLineNeighbours(planet).filter(neighbour => getMapOwnerKey(neighbour) === 'humans');
  if (heldNeighbours.length > 0) {
    addGambitReason(candidate,
      Math.min(GAMBIT_WEIGHTS.supplyLinePointsCap, heldNeighbours.length * GAMBIT_WEIGHTS.pointsPerSupplyLineNeighbour),
      `Supply lines to ${heldNeighbours.length} Super Earth planet${heldNeighbours.length === 1 ? '' : 's'}, which the enemy reaches if it falls`);
  }
  addPlayerShareReason(candidate, context);

  if (candidate.gambit && candidate.gambit.verdict === 'in-time') {
    candidate.notes.push(`A gambit on ${candidate.gambit.sourcePlanet.name} looks faster than defending (see Gambits).`);
  }
  return candidate;
}

// Scores one liberation for its front: the Major Order, whether it is being
// won, regeneration, gambits it could win, supply lines and players.
function scoreLiberationCandidate(planet, context) {
  const candidate = { planet, kind: 'liberation', score: 0, reasons: [], notes: [], outlook: null, gambit: null, tieBreakerPoints: 0 };
  const outlook = describeLiberationOutlook(planet, getPlanetTrend(planet), context.galaxyOutputPerPlayer);
  candidate.outlook = outlook;
  const playerCount = planet.statistics?.playerCount || 0;

  addMajorOrderReason(candidate, context);

  // Gambits this planet could win: liberating it ends the attack it launched.
  const gambits = context.gambitsBySourceIndex.get(planet.index) || [];
  const inTime = gambits.find(gambit => gambit.verdict === 'in-time');
  const launchPad = gambits.find(gambit => ['too-slow', 'failing', 'unmeasured'].includes(gambit.verdict));
  if (inTime) {
    candidate.gambit = inTime;
    addGambitReason(candidate, GAMBIT_WEIGHTS.gambitInTime,
      `Gambit: liberating it ends the attack on ${inTime.defensePlanet.name}, before that attack's deadline`);
  } else if (launchPad) {
    candidate.gambit = launchPad;
    addGambitReason(candidate, GAMBIT_WEIGHTS.gambitLaunchPad,
      `Launches the attack on ${launchPad.defensePlanet.name}: liberating it would end that attack`);
  }

  if (outlook.verdict === 'winning') {
    addGambitReason(candidate, GAMBIT_WEIGHTS.liberationWinning,
      `Being won: about ${formatDuration(outlook.hoursToLiberation * 3600)} to liberation at the measured pace`);
    if (outlook.hoursToLiberation < GAMBIT_SOON_HOURS) addGambitReason(candidate, GAMBIT_WEIGHTS.liberationFinishingSoon, 'Close to finishing');
  } else if (outlook.verdict === 'stalled') {
    addGambitReason(candidate, GAMBIT_WEIGHTS.liberationStalled,
      playerCount > 0 ? `Stalled: ${formatBigNumber(playerCount)} Helldivers here aren't beating regeneration` : 'Stalled: nobody is beating regeneration here');
  } else if (outlook.verdict === 'losing') {
    addGambitReason(candidate, GAMBIT_WEIGHTS.liberationLosing, 'Losing ground to regeneration');
  } else if (outlook.trendStatus !== 'measured' && !context.nothingMeasuredYet) {
    // when nothing on the front is measured yet, one note for the whole front says so
    candidate.notes.push(`Pace not measured yet (${Math.round(outlook.trendSpanMinutes)} of 5 minutes watched).`);
  }

  const playersNeeded = outlook.playersNeededToOutpaceRegen;
  if (outlook.verdict !== 'winning' && playersNeeded !== null && playerCount < playersNeeded) {
    const gap = playersNeeded - playerCount;
    const source = outlook.playersNeededIsGalaxyEstimate ? 'estimate from other fronts' : 'estimate';
    if (gap <= context.frontPlayerCount * GAMBIT_REGEN_GAP_SHARE_OF_FRONT) {
      addGambitReason(candidate, GAMBIT_WEIGHTS.regenGapWithinReach,
        `About ${formatBigNumber(gap)} more Helldivers would beat regeneration (${source})`);
    } else {
      candidate.notes.push(`Needs about ${formatBigNumber(gap)} more Helldivers to beat regeneration (${source}), more than a quarter of this front.`);
    }
  }

  const liberationPercent = outlook.liberationPercent || 0;
  if (liberationPercent >= 10) {
    const scoreBefore = candidate.score;
    addGambitReason(candidate, Math.floor(liberationPercent / 10) * GAMBIT_WEIGHTS.pointsPerTenPercentDone,
      `Already ${formatPercent(liberationPercent, 0)} liberated`);
    candidate.tieBreakerPoints += candidate.score - scoreBefore;
  }

  const enemyNeighboursWithoutCampaign = getSupplyLineNeighbours(planet).filter(neighbour =>
    normalizeFactionName(neighbour.currentOwner) !== null && !apiData.indexesOfPlanetsWithActiveBattles.has(neighbour.index));
  if (enemyNeighboursWithoutCampaign.length > 0) {
    addGambitReason(candidate,
      Math.min(GAMBIT_WEIGHTS.supplyLinePointsCap, enemyNeighboursWithoutCampaign.length * GAMBIT_WEIGHTS.pointsPerSupplyLineNeighbour),
      `Supply lines lead on to ${enemyNeighboursWithoutCampaign.length} more enemy planet${enemyNeighboursWithoutCampaign.length === 1 ? '' : 's'}`);
  }
  addPlayerShareReason(candidate, context);
  return candidate;
}

// Major Order points: a named target, or any mission on a front an order counts.
function addMajorOrderReason(candidate, context) {
  if (context.majorOrderTargets.planetIndexes.has(candidate.planet.index)) {
    addGambitReason(candidate, GAMBIT_WEIGHTS.majorOrderPlanet, 'Major Order target');
  } else if (context.majorOrderTargets.factionKeys.has(context.factionKey)) {
    addGambitReason(candidate, GAMBIT_WEIGHTS.majorOrderFaction,
      `Counts toward the Major Order's ${getFactionDisplayName(context.factionKey)} task`);
  }
}

// Up to 10 points for the share of this front's Helldivers already on a planet.
function addPlayerShareReason(candidate, context) {
  const playerCount = candidate.planet.statistics?.playerCount || 0;
  if (context.frontPlayerCount <= 0 || playerCount <= 0) return;
  const share = playerCount / context.frontPlayerCount;
  const scoreBefore = candidate.score;
  addGambitReason(candidate, share * GAMBIT_WEIGHTS.playerShareMaximum,
    `${formatPercent(share * 100, 0)} of this front's Helldivers are here`);
  candidate.tieBreakerPoints += candidate.score - scoreBefore;
}

// Highest score first; ties go to more Helldivers, then the lower planet index,
// so the order never depends on how the feeds happened to sort things.
function compareGambitCandidates(first, second) {
  return (second.score - first.score)
    || ((second.planet.statistics?.playerCount || 0) - (first.planet.statistics?.playerCount || 0))
    || (first.planet.index - second.planet.index);
}

// The full read of one front: every battle planet scored, the best moves, the
// ones giving poor returns, each defense's gambit, and what the data can't say.
function analyseFront(factionKey, nowTimestamp = Date.now()) {
  const battlePlanets = apiData.activeCampaigns
    .map(campaign => campaign.planet)
    .filter(planet => planet && getEnemyFactionOnPlanet(planet) === factionKey);
  const uniquePlanets = [...new Map(battlePlanets.map(planet => [planet.index, planet])).values()];
  const allBattlePlayers = apiData.activeCampaigns.reduce((total, campaign) => total + (campaign.planet?.statistics?.playerCount || 0), 0);
  const frontPlayerCount = uniquePlanets.reduce((total, planet) => total + (planet.statistics?.playerCount || 0), 0);
  const galaxyOutputPerPlayer = estimateGalaxyOutputPerPlayer();

  const defensePlanets = uniquePlanets.filter(planetIsUnderAttack);
  const gambits = defensePlanets
    .map(planet => describeGambitOption(planet, nowTimestamp, galaxyOutputPerPlayer))
    .filter(gambit => !['won', 'expired'].includes(gambit.defenseOutlook.verdict));
  const gambitByDefenseIndex = new Map(gambits.map(gambit => [gambit.defensePlanet.index, gambit]));
  const gambitsBySourceIndex = new Map();
  for (const gambit of gambits) {
    if (!gambit.sourcePlanet) continue;
    const list = gambitsBySourceIndex.get(gambit.sourcePlanet.index) || [];
    gambitsBySourceIndex.set(gambit.sourcePlanet.index, [...list, gambit]);
  }

  const unmeasuredCount = uniquePlanets.filter(planet => getPlanetTrend(planet).status !== 'measured').length;
  const context = {
    factionKey, nowTimestamp, frontPlayerCount, galaxyOutputPerPlayer,
    majorOrderTargets: getMajorOrderTargets(), gambitByDefenseIndex, gambitsBySourceIndex,
    nothingMeasuredYet: unmeasuredCount === uniquePlanets.length,
  };
  const candidates = uniquePlanets
    .filter(planet => !planetIsUnderAttack(planet) || gambitByDefenseIndex.has(planet.index))
    .map(planet => planetIsUnderAttack(planet) ? scoreDefenseCandidate(planet, context) : scoreLiberationCandidate(planet, context))
    .sort(compareGambitCandidates);

  const dataNotes = [];
  if (unmeasuredCount > 0) {
    dataNotes.push(`${unmeasuredCount} of ${uniquePlanets.length} planets haven't been watched long enough to measure their pace; leave the page open a few minutes for a better read.`);
  }
  if (apiData.currentDataSource === 'FALLBACK') dataNotes.push('The backup API has no supply lines, so supply-line value is left out.');

  const inTimeGambit = gambits.find(gambit => gambit.verdict === 'in-time');
  const topPick = candidates.find(candidate => candidate.score > 0) || null;
  // Where Helldivers already are, and how far along a planet is, only break
  // ties; on their own they are no reason to call a priority.
  const topPickHasSubstance = topPick !== null && topPick.score - topPick.tieBreakerPoints > 0;
  const busiestPlanet = [...uniquePlanets].sort((first, second) =>
    (second.statistics?.playerCount || 0) - (first.statistics?.playerCount || 0))[0];
  let headline = 'No battles on this front right now.';
  if (inTimeGambit) {
    headline = `Gambit available: liberate ${inTimeGambit.sourcePlanet.name} to end the attack on ${inTimeGambit.defensePlanet.name}.`;
  } else if (topPickHasSubstance) {
    headline = topPick.kind === 'defense' ? `Priority: hold ${topPick.planet.name}.` : `Priority: push on ${topPick.planet.name}.`;
  } else if (candidates.length > 0 && unmeasuredCount > 0) {
    headline = 'Too early to call: the page needs a few minutes of watching to measure the pace.'
      + (busiestPlanet && (busiestPlanet.statistics?.playerCount || 0) > 0 ? ` Most of this front is on ${busiestPlanet.name}.` : '');
  } else if (candidates.length > 0) {
    headline = 'Nothing here scores well right now; the other fronts may be a better use of a drop.';
  }

  return {
    factionKey,
    playerCount: frontPlayerCount,
    shareOfBattlePlayers: allBattlePlayers > 0 ? frontPlayerCount / allBattlePlayers : null,
    liberationCount: uniquePlanets.length - defensePlanets.length,
    defenseCount: defensePlanets.length,
    candidates,
    picks: candidates.filter(candidate => candidate.score > 0).slice(0, GAMBIT_PICK_COUNT),
    avoid: candidates.filter(candidate => candidate.score < 0).sort((first, second) => first.score - second.score).slice(0, GAMBIT_AVOID_COUNT),
    gambits,
    headline,
    dataNotes,
  };
}

// Every enemy front, in the page's usual front order.
function analyseAllFronts(nowTimestamp = Date.now()) {
  return FRONT_ORDER.map(factionKey => analyseFront(factionKey, nowTimestamp));
}

// Icon + words for a gambit verdict (colour alone never carries the meaning).
const GAMBIT_VERDICT_LINES = {
  'in-time':         { status: 'good',     icon: '✔', text: 'Gambit looks possible in time' },
  'too-slow':        { status: 'warning',  icon: '⚠', text: 'Gambit too slow at this pace' },
  failing:           { status: 'critical', icon: '✖', text: 'Gambit would fail as things stand' },
  unmeasured:        { status: 'neutral',  icon: '…', text: 'Gambit possible, timing not measured' },
  'not-needed':      { status: 'good',     icon: '✔', text: 'No gambit needed' },
  'no-campaign':     { status: 'neutral',  icon: '–', text: 'No gambit: the attacker has no campaign' },
  'several-sources': { status: 'neutral',  icon: '–', text: 'No gambit suggested: several attackers' },
  'no-source':       { status: 'neutral',  icon: '–', text: 'No gambit: attacker unknown' },
};

// A planet name in the gambit panel: opens the planet drawer.
function buildPlanetJumpButton(planet) {
  return buildPlanetDrawerButton(planet);
}

// One scored planet as a list item: name, what to do, score, and each reason with its points.
function buildGambitCandidateItem(candidate) {
  const kindLabel = candidate.kind === 'defense' ? 'Defend'
    : candidate.gambit && candidate.gambit.verdict === 'in-time' ? 'Gambit' : 'Liberate';
  return buildElement('li', { className: 'gambit-candidate' }, [
    buildElement('div', { className: 'gambit-candidate-header' }, [
      buildPlanetJumpButton(candidate.planet),
      buildElement('span', { className: `chip gambit-kind gambit-kind-${kindLabel.toLowerCase()}`, text: kindLabel }),
      buildElement('span', { className: 'gambit-score', text: `score ${candidate.score}` }),
    ]),
    buildElement('ul', { className: 'gambit-reasons' }, [
      ...candidate.reasons.map(reason => buildElement('li', {}, [
        buildElement('span', { className: `gambit-points ${reason.points > 0 ? 'is-plus' : 'is-minus'}`,
          text: `${reason.points > 0 ? '+' : '−'}${Math.abs(reason.points)}` }),
        buildElement('span', { text: reason.text }),
      ])),
      ...candidate.notes.map(note => buildElement('li', { className: 'gambit-note', text: note })),
    ]),
  ]);
}

// One front's panel: headline, best moves, gambits, poor returns and data notes.
function buildGambitFrontPanel(analysis) {
  const factionName = getFactionDisplayName(analysis.factionKey);
  const iconPath = getFactionIconFile(analysis.factionKey);
  const summaryParts = [
    `${formatBigNumber(analysis.playerCount)} Helldivers`
      + (analysis.shareOfBattlePlayers !== null ? ` (${formatPercent(analysis.shareOfBattlePlayers * 100, 0)} of those in battle)` : ''),
    `${analysis.liberationCount} liberation${analysis.liberationCount === 1 ? '' : 's'}`,
    `${analysis.defenseCount} defense${analysis.defenseCount === 1 ? '' : 's'}`,
  ];
  const hasBattles = analysis.candidates.length > 0 || analysis.gambits.length > 0;

  return buildElement('article', { className: `gambit-front faction-${analysis.factionKey}`,
    attributes: { id: `gambit-front-${analysis.factionKey}`, 'aria-labelledby': `gambit-front-${analysis.factionKey}-heading` } }, [
    buildElement('header', { className: 'gambit-front-header' }, [
      iconPath ? buildImage(iconPath, `${factionName} logo`, 'gambit-faction-icon', 32, 32) : null,
      buildElement('h3', { text: factionName, attributes: { id: `gambit-front-${analysis.factionKey}-heading` } }),
      buildElement('p', { className: 'section-hint', text: summaryParts.join(' · ') }),
    ]),
    buildElement('p', { className: 'gambit-headline', text: analysis.headline }),
    hasBattles && analysis.picks.length > 0 ? buildElement('h4', { text: 'Best moves' }) : null,
    hasBattles && analysis.picks.length > 0 ? buildElement('ol', { className: 'gambit-candidates' }, analysis.picks.map(buildGambitCandidateItem)) : null,
    analysis.gambits.length > 0 ? buildElement('h4', { text: 'Gambits' }) : null,
    ...analysis.gambits.map(gambit => buildElement('div', { className: 'gambit-option' }, [
      buildStatusLine(GAMBIT_VERDICT_LINES[gambit.verdict], 'verdict gambit-verdict'),
      buildElement('p', { text: gambit.sentence }),
    ])),
    hasBattles && analysis.defenseCount === 0 ? buildElement('p', { className: 'section-hint', text: 'No planets under attack on this front, so there is no gambit to weigh.' }) : null,
    analysis.avoid.length > 0 ? buildElement('h4', { text: 'Poor returns right now' }) : null,
    analysis.avoid.length > 0 ? buildElement('ul', { className: 'gambit-candidates gambit-avoid' }, analysis.avoid.map(buildGambitCandidateItem)) : null,
    ...analysis.dataNotes.map(note => buildElement('p', { className: 'section-hint', text: note })),
    hasBattles ? buildLlmCommentaryBlock(analysis.factionKey) : null,
  ]);
}

// Clicks inside the gambit panel: an Ask button requests the optional AI summary for its
// front. (Planet names open the drawer through the page-wide handleDrawerClicks.)
function handleGambitPanelClick(event) {
  const askButton = event.target.closest && event.target.closest('[data-llm-faction]');
  if (askButton) requestLlmCommentary(askButton.dataset.llmFaction);
}

// Every front's analysis → #output-gambits
function renderGambits() {
  if (!hasAnyData()) {
    replaceContent('output-gambits', [buildWaitingMessage()]);
    return;
  }
  const analyses = analyseAllFronts();
  replaceContent('output-gambits', analyses.map(buildGambitFrontPanel));
}

// ── OPTIONAL AI COMMENTARY ───────────────────────────────────────────────────
// Layer two of the gambit panel, off unless the user pastes their own API key.
// It sends one front's local analysis (the numbers and reasons already on the
// page) to an LLM and shows the reply, clearly labelled, next to the analysis.
// Nothing depends on it: with no key, no network or a failed call, the local
// analysis above is the whole answer.

const LLM_API_KEY_STORAGE_KEY = 'hd2_llm_api_key';   // the user's own key; never in the code or the repo
const LLM_MODEL_STORAGE_KEY = 'hd2_llm_model';
const LLM_TIMEOUT_MILLISECONDS = 60000;               // per call; model replies are slower than war feeds
const LLM_PROMPT_CANDIDATE_LIMIT = 6;
const LLM_REPLY_CHARACTER_LIMIT = 4000;

// The only code that knows which LLM is used. To swap providers, write another
// object with the same members and point LLM_PROVIDER at it.
// Google Gemini was picked because its API has a free tier for its Flash models
// and accepts calls straight from a browser page (including file://).
const GEMINI_PROVIDER = {
  name: 'Google Gemini',
  shortName: 'Gemini',
  origin: 'https://generativelanguage.googleapis.com',
  defaultModel: 'gemini-3.8-flash',
  keyHelpUrl: 'https://aistudio.google.com/apikey',
  modelListUrl: 'https://ai.google.dev/gemini-api/docs/models',

  // The model's generation from its name ("gemini-3.8-flash" → 3.8), or NaN.
  generationOf(model) {
    return Number((/^gemini-(\d+(?:\.\d+)?)/.exec(model) || [])[1]);
  },

  // Room for the model's thinking plus its answer (thinking counts against it).
  // Gemini 2.5 and later can write up to 65,536 tokens, so they get plenty;
  // older models top out at 8,192. Only what is written is counted, not the room.
  maxOutputTokensFor(model) {
    return this.generationOf(model) >= 2.5 ? 32768 : 8192;
  },

  // How hard the model may think before it answers. Gemini 3 models think at
  // "high" by default, and that thinking can use up the whole answer length,
  // leaving no answer at all. A short overview needs little: 'low' first, and
  // 'least' when a 'low' answer still came back empty. Gemini 3 and later take
  // a level, 2.5 takes a token budget, older models don't think.
  thinkingConfigFor(model, effort = 'low') {
    const generation = this.generationOf(model);
    if (generation >= 3) return { thinkingLevel: effort === 'least' ? 'minimal' : 'low' };
    if (generation >= 2.5) return { thinkingBudget: effort === 'least' ? 512 : 1024 };
    return null;
  },

  // URL and fetch options for one prompt. The key goes in a header, not the
  // URL, so it can't end up in logs or the browser history. plain leaves out
  // the thinking setting and asks for the length every model accepts.
  buildRequest(apiKey, model, systemText, userText, { thinkingEffort = 'low', plain = false } = {}) {
    const thinkingConfig = plain ? null : this.thinkingConfigFor(model, thinkingEffort);
    const maxOutputTokens = plain ? 8192 : this.maxOutputTokensFor(model);
    return {
      url: `${this.origin}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText }] },
          contents: [{ role: 'user', parts: [{ text: userText }] }],
          generationConfig: { maxOutputTokens, ...(thinkingConfig ? { thinkingConfig } : {}) },
        }),
      },
    };
  },

  // True when a failed call was about the thinking or length setting, so it is
  // worth one more try with plain settings (a model that doesn't take them).
  rejectedGenerationSettings(status, body) {
    return status === 400 && /thinking|output.?tokens/i.test(String(body?.error?.message || ''));
  },

  // True for an answer that came back empty because thinking used up its length.
  ranOutWhileThinking(body) {
    const candidate = asArray(body?.candidates)[0];
    const hasText = asArray(candidate?.content?.parts).some(part => typeof part?.text === 'string' && part.text.trim() && !part.thought);
    return candidate?.finishReason === 'MAX_TOKENS' && !hasText;
  },

  // The reply's text from a successful response body; throws with the reason otherwise.
  readReply(body) {
    const blockReason = body?.promptFeedback?.blockReason;
    if (blockReason) throw new Error(`Gemini declined to answer (${blockReason}).`);
    const candidate = asArray(body?.candidates)[0];
    const text = asArray(candidate?.content?.parts)
      .filter(part => typeof part?.text === 'string' && !part.thought)
      .map(part => part.text).join('').trim();
    if (!text && candidate?.finishReason === 'MAX_TOKENS') {
      throw new Error('Gemini used up its answer length thinking and wrote nothing (finish reason: MAX_TOKENS), even when asked to think less. Ask again, or try another model.');
    }
    if (!text) throw new Error(`Gemini sent no text (finish reason: ${candidate?.finishReason || 'unknown'}).`);
    return text;
  },

  // A plain-language reason for a failed call, from its status and error body.
  describeFailure(status, body, model) {
    const reason = asArray(body?.error?.details).map(detail => detail?.reason).find(Boolean);
    if (reason === 'API_KEY_INVALID') return 'Google says this API key is not valid.';
    if (status === 403) return 'Google refused this key (HTTP 403). Check that it is a Gemini API key from Google AI Studio.';
    if (status === 404) return `Google has no model called "${model}". Pick a current one from ${this.modelListUrl}.`;
    if (status === 429) return 'Google\'s rate limit or free-tier quota for this key was reached. Try again later.';
    if (status >= 500) return `Google's service had a problem (HTTP ${status}). Try again later.`;
    const message = typeof body?.error?.message === 'string' ? body.error.message.slice(0, 200) : '';
    return `The request failed (HTTP ${status})${message ? `: ${message}` : '.'}`;
  },
};
const LLM_PROVIDER = GEMINI_PROVIDER;

// AI replies per front, kept in memory only: {status, text, model, timestamp, errorMessage}.
const llmCommentaryByFaction = {};

// The saved key and model; the key is '' when none is saved.
function readLlmSettings() {
  const model = (readStoredValue(LLM_MODEL_STORAGE_KEY) || '').trim();
  return {
    apiKey: (readStoredValue(LLM_API_KEY_STORAGE_KEY) || '').trim(),
    model: model || LLM_PROVIDER.defaultModel,
  };
}

// True for a model name that is safe to put in the request path.
function isValidLlmModelName(model) {
  return typeof model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(model);
}

// True for something that could be an API key: one token of printable characters.
function looksLikeApiKey(apiKey) {
  return typeof apiKey === 'string' && /^[\x21-\x7e]{20,200}$/.test(apiKey);
}

// Turns one front's analysis into the system and user text for the model.
// It only restates what the page already shows, so the model has nothing
// else to go on and the prompt holds no personal data.
function buildGambitPrompt(analysis) {
  const factionName = getFactionDisplayName(analysis.factionKey);
  const systemText = [
    'You help Helldivers 2 players decide where to fight in the game\'s shared Galactic War.',
    'You are given an analysis of one front, worked out by a web page from public war data.',
    'In at most 120 words of plain English, say what this front should do next and why.',
    'Use only the planets, numbers and reasons given. Do not invent planets, numbers, events or game mechanics.',
    'Where the analysis says something is not measured or is an estimate, say it is uncertain.',
    'A gambit means ending an enemy attack by liberating the planet the attack comes from.',
    'Write plain text only: no markdown, no headings, no lists.',
  ].join(' ');

  const lines = [
    `Front: ${factionName}.`,
    `${analysis.playerCount} Helldivers`
      + (analysis.shareOfBattlePlayers !== null ? ` (${formatPercent(analysis.shareOfBattlePlayers * 100, 0)} of all Helldivers in battle)` : '')
      + `, ${analysis.liberationCount} liberation campaigns, ${analysis.defenseCount} defenses.`,
    `Page's verdict: ${analysis.headline}`,
  ];
  const candidates = analysis.candidates.slice(0, LLM_PROMPT_CANDIDATE_LIMIT);
  if (candidates.length > 0) {
    lines.push('', 'Planets, best first (score = sum of the points listed):');
    for (const candidate of candidates) {
      const reasons = candidate.reasons.map(reason => `${reason.points > 0 ? '+' : ''}${reason.points} ${reason.text}`);
      lines.push(`- ${candidate.planet.name} (${candidate.kind === 'defense' ? 'defend' : 'liberate'}, score ${candidate.score}): `
        + (reasons.length ? reasons.join('; ') : 'no scoring reasons')
        + (candidate.notes.length ? `. Notes: ${candidate.notes.join(' ')}` : ''));
    }
    if (analysis.candidates.length > candidates.length) lines.push(`(${analysis.candidates.length - candidates.length} lower-scoring planets left out.)`);
  }
  if (analysis.gambits.length > 0) {
    lines.push('', 'Gambit checks:');
    for (const gambit of analysis.gambits) lines.push(`- ${gambit.sentence}`);
  }
  if (analysis.dataNotes.length > 0) {
    lines.push('', 'Limits of the data:');
    for (const note of analysis.dataNotes) lines.push(`- ${note}`);
  }
  return { systemText, userText: lines.join('\n') };
}

// "a", "a and b", "a, b and c".
function joinInWords(items) {
  return items.length <= 1 ? (items[0] || '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// The Major Order's unfinished tasks, grouped by the enemy front each one
// points at: {factionKey: [task descriptions]}. A task on a planet belongs to
// that planet's enemy; a task without one, to the faction it names. Tasks for
// no enemy front (holding a quiet planet of ours) are left out.
function groupOpenMajorOrderTasksByFront(assignments = apiData.assignments) {
  const tasksByFront = {};
  for (const assignment of asArray(assignments)) {
    asArray(assignment.tasks).forEach((task, taskPosition) => {
      const described = describeAssignmentTask(task, asArray(assignment.progress)[taskPosition]);
      if (described.isComplete) return;
      const planet = described.planetIndex !== null ? apiData.planetsByIndex[described.planetIndex] : null;
      const factionKey = planet ? getEnemyFactionOnPlanet(planet) : normalizeFactionName(described.factionName);
      if (!factionKey) return;
      if (!tasksByFront[factionKey]) tasksByFront[factionKey] = [];
      tasksByFront[factionKey].push(described);
    });
  }
  return tasksByFront;
}

// The Major Order note on top of an AI overview, worked out by the page from
// the order itself (not by the AI): whether the order counts this front, or
// which fronts it wants instead. Null when no unfinished task points at a front.
function describeMajorOrderFocus(factionKey, assignments = apiData.assignments) {
  const tasksByFront = groupOpenMajorOrderTasksByFront(assignments);
  const orderFronts = FRONT_ORDER.filter(front => tasksByFront[front]);
  if (orderFronts.length === 0) return null;
  const listTasks = tasks => tasks.map(task => task.sentence
    + (task.progressPercent !== null ? ` (${formatPercent(task.progressPercent, 0)} done)` : '')).join('; ');
  if (tasksByFront[factionKey]) {
    return { countsThisFront: true,
      text: `this front counts for it: ${listTasks(tasksByFront[factionKey])}. Dropping here helps the order.` };
  }
  const wanted = orderFronts.map(front => `the ${getFactionDisplayName(front)}`);
  return { countsThisFront: false,
    text: `it wants ${joinInWords(wanted)} right now, not the ${getFactionDisplayName(factionKey)}: `
      + `${orderFronts.map(front => listTasks(tasksByFront[front])).join('; ')}. `
      + `Focus there to help it most. The normal overview of the ${getFactionDisplayName(factionKey)} front is below.` };
}

// Sends one prompt to the provider and returns the reply text. If the model
// refuses the thinking or length setting, it asks once more with plain ones; if
// an answer comes back empty because thinking used up its length, it asks once
// more with the least thinking. At most three calls.
async function askLlm(apiKey, model, prompt) {
  let settings = { thinkingEffort: 'low', plain: false };
  for (;;) {
    const { response, body } = await sendLlmRequest(apiKey, model, prompt, settings);
    if (!response.ok) {
      if (!settings.plain && LLM_PROVIDER.rejectedGenerationSettings(response.status, body)) {
        settings = { plain: true };
        continue;
      }
      throw new Error(LLM_PROVIDER.describeFailure(response.status, body, model));
    }
    if (!settings.plain && settings.thinkingEffort === 'low' && LLM_PROVIDER.ranOutWhileThinking(body)) {
      settings = { thinkingEffort: 'least', plain: false };
      continue;
    }
    return LLM_PROVIDER.readReply(body);
  }
}

// One call to the provider: its response and parsed body. The request goes to
// LLM_PROVIDER.origin only, and times out rather than hang.
async function sendLlmRequest(apiKey, model, prompt, settings) {
  const request = LLM_PROVIDER.buildRequest(apiKey, model, prompt.systemText, prompt.userText, settings);
  if (!request.url.startsWith(`${LLM_PROVIDER.origin}/`)) throw new Error('Refused to send the key anywhere but the provider.');

  const abortController = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutHandle = abortController ? setTimeout(() => abortController.abort(), LLM_TIMEOUT_MILLISECONDS) : null;
  let response;
  try {
    response = await fetch(request.url, abortController ? { ...request.options, signal: abortController.signal } : request.options);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`No answer after ${LLM_TIMEOUT_MILLISECONDS / 1000} seconds.`);
    throw new Error('Could not reach Google (no network, or the request was blocked).');
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
  // error bodies are usually JSON too, but a proxy's may not be
  const body = await response.json().catch(() => null);
  return { response, body };
}

// Asks the LLM about one front and keeps the outcome for the panel to show.
// One question per front at a time; any failure leaves the local analysis as it is.
async function requestLlmCommentary(factionKey, nowTimestamp = Date.now()) {
  if (llmCommentaryByFaction[factionKey]?.status === 'loading') return llmCommentaryByFaction[factionKey];
  const { apiKey, model } = readLlmSettings();
  const frontName = getFactionDisplayName(factionKey);
  const finish = (entry) => {
    llmCommentaryByFaction[factionKey] = { model, timestamp: nowTimestamp, text: '', errorMessage: '', ...entry };
    renderGambits();
    // the panel is rebuilt on every render, so a fixed live region tells screen readers
    putTextInElement('llm-announcer', entry.status === 'loading' ? `Asking ${LLM_PROVIDER.shortName} about the ${frontName} front.`
      : entry.status === 'done' ? `${LLM_PROVIDER.shortName}'s summary for the ${frontName} front is ready. It is AI-written and can be wrong.`
        : `No AI summary for the ${frontName} front: ${entry.errorMessage}`);
    return llmCommentaryByFaction[factionKey];
  };

  if (!apiKey) return finish({ status: 'failed', errorMessage: 'No API key is saved.' });
  if (!isValidLlmModelName(model)) return finish({ status: 'failed', errorMessage: `"${model}" is not a valid model name.` });
  if (window.navigator && window.navigator.onLine === false) {
    return finish({ status: 'failed', errorMessage: 'This device is offline.' });
  }

  finish({ status: 'loading' });
  try {
    const reply = await askLlm(apiKey, model, buildGambitPrompt(analyseFront(factionKey, nowTimestamp)));
    const text = reply.length > LLM_REPLY_CHARACTER_LIMIT ? `${reply.slice(0, LLM_REPLY_CHARACTER_LIMIT)}…` : reply;
    return finish({ status: 'done', text, majorOrderFocus: describeMajorOrderFocus(factionKey) });
  } catch (error) {
    return finish({ status: 'failed', errorMessage: error.message || 'Unknown error.' });
  }
}

// The AI part of one front's panel: an Ask button when a key is saved, then the
// AI overview (a Major Order note on top, the labelled reply under it) or the
// reason it failed. Nothing at all without a key.
function buildLlmCommentaryBlock(factionKey) {
  const { apiKey } = readLlmSettings();
  const entry = llmCommentaryByFaction[factionKey];
  if (!apiKey && !entry) return null;

  const isLoading = entry?.status === 'loading';
  const askButton = apiKey ? buildElement('button', {
    className: 'llm-ask-button',
    text: isLoading ? `Asking ${LLM_PROVIDER.shortName}…` : `Ask ${LLM_PROVIDER.shortName} to explain this front`,
    attributes: { type: 'button', 'data-llm-faction': factionKey, disabled: isLoading, 'aria-busy': isLoading ? 'true' : null },
  }) : null;

  const hint = apiKey ? buildElement('p', { className: 'llm-hint',
    text: 'Bonus info: an AI overview of this front, with a Major Order note on top when the order wants you elsewhere.' }) : null;

  let result = null;
  if (entry?.status === 'done') {
    const focus = entry.majorOrderFocus;
    result = buildElement('aside', { className: 'llm-commentary', attributes: { 'aria-label': 'AI overview' } }, [
      focus ? buildElement('p', { className: `llm-major-order${focus.countsThisFront ? ' counts-this-front' : ''}` }, [
        buildElement('span', { className: 'status-icon', text: '★', attributes: { 'aria-hidden': 'true' } }),
        buildElement('strong', { text: 'Major Order: ' }),
        focus.text,
        buildElement('span', { className: 'llm-source', text: ' (From the order itself, not AI.)' }),
      ]) : null,
      buildElement('p', { className: 'llm-label' }, [
        buildElement('span', { className: 'status-icon', text: '⚠', attributes: { 'aria-hidden': 'true' } }),
        buildElement('strong', { text: 'AI-written, can be wrong. ' }),
        `${LLM_PROVIDER.name} (${entry.model}) at ${formatClockTime(entry.timestamp)}, from the numbers above at that time. `
          + 'Check it against them before you act on it.',
      ]),
      buildElement('p', { className: 'llm-text', text: entry.text }),
    ]);
  } else if (entry?.status === 'failed') {
    result = buildStatusLine({ status: 'warning', icon: '⚠',
      text: `No AI summary: ${entry.errorMessage} The analysis above doesn't need it.` }, 'verdict llm-error');
  }
  return buildElement('div', { className: 'llm-block' }, [askButton, hint, result]);
}

// Shows whether a key is saved (never the key itself, only its last 4 characters).
function describeLlmSettings() {
  const { apiKey, model } = readLlmSettings();
  return apiKey
    ? `Key saved in this browser (ending …${apiKey.slice(-4)}), model ${model}. Ask buttons for an AI overview are on each front.`
    : 'No key saved: AI summaries are off, and the local analysis is all you\'ll see.';
}

// Saves the settings form. An empty key field keeps the saved key, so the
// model can be changed without pasting the key again.
function handleLlmSettingsSubmit(event) {
  if (event) event.preventDefault();
  const keyInput = document.getElementById('llm-api-key');
  const modelInput = document.getElementById('llm-model');
  const status = document.getElementById('llm-settings-status');
  const typedKey = (keyInput?.value || '').trim();
  const typedModel = (modelInput?.value || '').trim() || LLM_PROVIDER.defaultModel;

  if (typedKey && !looksLikeApiKey(typedKey)) {
    if (status) status.textContent = 'That doesn\'t look like an API key (it should be one long word, no spaces). Nothing was saved.';
    return false;
  }
  if (!isValidLlmModelName(typedModel)) {
    if (status) status.textContent = 'Model names are letters, digits, dots and dashes only. Nothing was saved.';
    return false;
  }
  const keySaved = typedKey ? writeStoredValue(LLM_API_KEY_STORAGE_KEY, typedKey) : true;
  writeStoredValue(LLM_MODEL_STORAGE_KEY, typedModel);
  if (keyInput) keyInput.value = '';            // don't leave the key sitting in the page
  if (status) {
    status.textContent = keySaved ? describeLlmSettings()
      : 'This browser won\'t let the page store anything, so the key wasn\'t saved and AI summaries stay off.';
  }
  renderGambits();
  return true;
}

// Removes the saved key (and any replies it produced) from this browser.
function forgetLlmApiKey() {
  try {
    window.localStorage.removeItem(LLM_API_KEY_STORAGE_KEY);
  } catch {
    // storage blocked: there was nothing saved to forget
  }
  for (const factionKey of Object.keys(llmCommentaryByFaction)) delete llmCommentaryByFaction[factionKey];
  const status = document.getElementById('llm-settings-status');
  if (status) status.textContent = describeLlmSettings();
  renderGambits();
}

// Hooks up the settings form and fills in the current model and status.
function wireLlmSettings() {
  const form = document.getElementById('llm-settings-form');
  if (form) form.addEventListener('submit', handleLlmSettingsSubmit);
  const forgetButton = document.getElementById('llm-forget-key');
  if (forgetButton) forgetButton.addEventListener('click', forgetLlmApiKey);
  const modelInput = document.getElementById('llm-model');
  if (modelInput) {
    modelInput.value = readLlmSettings().model;
    modelInput.placeholder = LLM_PROVIDER.defaultModel;
  }
  const status = document.getElementById('llm-settings-status');
  if (status) status.textContent = describeLlmSettings();
}

// ── MAJOR ORDER PACE ─────────────────────────────────────────────────────────
// Whether each Major Order task will be done in time at the current pace. Tasks with a target
// amount use the order's own progress history; liberate and hold tasks follow their planet.

// A short date for a finish estimate: "Thu 14:00" within the week, "3 Oct, 14:00" after.
function formatShortDateTime(timestamp, nowTimestamp = Date.now()) {
  const withinWeek = Math.abs(timestamp - nowTimestamp) < 6 * 24 * 3600000;
  return new Date(timestamp).toLocaleString(DISPLAY_LOCALE, withinWeek
    ? { weekday: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// How one Major Order task is going against the deadline.
// status: 'done' | 'on-pace' | 'behind' | 'not-enough-data'
function describeMajorOrderTaskPace(assignment, taskPosition, nowTimestamp = Date.now()) {
  const task = assignment.tasks[taskPosition];
  const described = describeAssignmentTask(task, assignment.progress[taskPosition]);
  const deadlineTimestamp = Date.parse(assignment.expiration || '');
  const hasDeadline = !isNaN(deadlineTimestamp);
  const pace = {
    status: 'not-enough-data',
    ratePercentPerHour: null,
    requiredPercentPerHour: null,
    projectedFinishTimestamp: null,
    hoursLeft: hasDeadline ? Math.max(0, (deadlineTimestamp - nowTimestamp) / 3600000) : null,
    planetIsHeld: false,
    planet: null,
  };
  if (described.isComplete) return { ...pace, status: 'done' };

  let progressPercent = described.progressPercent;
  if (taskHasTargetAmount(task)) {
    const series = buildMajorOrderTaskSeries(assignment, taskPosition, nowTimestamp);
    pace.ratePercentPerHour = series.measuredPercentPerHour;
    pace.projectedFinishTimestamp = series.projectedCompletionTimestamp;
  } else {
    const planet = apiData.planetsByIndex[getTaskLocation(task).planetIndex];
    if (!planet) return pace;
    pace.planet = planet;
    if (planetIsUnderAttack(planet)) {
      const defense = describeDefenseOutlook(planet, getPlanetTrend(planet), nowTimestamp);
      progressPercent = defense.progressPercent;
      pace.ratePercentPerHour = defense.ratePercentPerHour;
      if (defense.hoursToWin !== null) pace.projectedFinishTimestamp = nowTimestamp + defense.hoursToWin * 3600000;
    } else if (normalizeFactionName(planet.currentOwner) === null) {
      // ours and not under attack: a hold task is on pace as long as that lasts
      return { ...pace, status: 'on-pace', planetIsHeld: true };
    } else {
      const liberation = describeLiberationOutlook(planet, getPlanetTrend(planet));
      progressPercent = liberation.liberationPercent;
      pace.ratePercentPerHour = liberation.netPercentPerHour;
      if (liberation.hoursToLiberation !== null) pace.projectedFinishTimestamp = nowTimestamp + liberation.hoursToLiberation * 3600000;
    }
  }
  if (pace.hoursLeft && isFiniteNumber(progressPercent)) {
    pace.requiredPercentPerHour = (100 - progressPercent) / pace.hoursLeft;
  }
  if (!isFiniteNumber(pace.ratePercentPerHour)) return pace;
  const finishesInTime = pace.projectedFinishTimestamp !== null
    && (!hasDeadline || pace.projectedFinishTimestamp <= deadlineTimestamp);
  pace.status = finishesInTime ? 'on-pace' : 'behind';
  return pace;
}

// A task's pace → {status, icon, text} for its status line (icon and words, never colour alone).
function describeMajorOrderPaceLine(pace, nowTimestamp = Date.now()) {
  if (pace.status === 'on-pace' && pace.planetIsHeld) {
    return { status: 'good', icon: '✔', text: 'On pace — the planet is held' };
  }
  if (pace.status === 'on-pace') {
    return { status: 'good', icon: '✔', text: `On pace — done around ${formatShortDateTime(pace.projectedFinishTimestamp, nowTimestamp)} at the current rate` };
  }
  if (pace.status === 'behind') {
    return pace.projectedFinishTimestamp === null
      ? { status: 'critical', icon: '✖', text: 'Behind — no progress at the current rate' }
      : { status: 'warning', icon: '▲', text: `Behind — done around ${formatShortDateTime(pace.projectedFinishTimestamp, nowTimestamp)} at the current rate, after the deadline` };
  }
  return { status: 'neutral', icon: '…', text: 'Not enough data for a pace yet' };
}

// The rate, the rate needed and the time left, as one small line.
function describeMajorOrderPaceFacts(pace) {
  const parts = [];
  if (isFiniteNumber(pace.ratePercentPerHour)) parts.push(`Current rate ${formatPercentPerHour(pace.ratePercentPerHour)}`);
  if (isFiniteNumber(pace.requiredPercentPerHour)) parts.push(`needed ${formatPercentPerHour(pace.requiredPercentPerHour)}`);
  if (pace.hoursLeft !== null) parts.push(`${formatDuration(pace.hoursLeft * 3600)} left`);
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ── PLANET DRAWER ────────────────────────────────────────────────────────────
// Everything about one planet in one panel, opened from the map, the gambit panel, the
// simple-mode cards and Major Order tasks. It sits beside the page on a wide screen and is a
// bottom sheet on a phone. It is not modal: the map keeps working behind it, another planet
// just changes what it shows, and Esc or the close button shuts it.

const planetDrawerState = { planetIndex: null, openerSelector: null };

// A selector that finds the element that opened the drawer again after a re-render.
function describeDrawerOpener(element) {
  if (!element || !element.closest) return null;
  if (element.id) return `#${element.id}`;
  const marker = element.closest('.map-planet');
  if (marker) return `#output-war-map .map-planet[data-planet-index="${marker.dataset.planetIndex}"]`;
  const button = element.closest('[data-open-planet]');
  const container = button && button.parentElement ? button.parentElement.closest('[id]') : null;
  return button && container ? `#${container.id} [data-open-planet="${button.dataset.openPlanet}"]` : null;
}

// What the drawer shows about a planet, as plain data (the builder below turns it into DOM).
function describePlanetForDrawer(planet, nowTimestamp = Date.now()) {
  const ownerKey = getMapOwnerKey(planet);
  const enemyKey = getEnemyFactionOnPlanet(planet);
  const isDefense = planetIsUnderAttack(planet);
  const isBattle = apiData.indexesOfPlanetsWithActiveBattles.has(planet.index);
  const details = {
    planet,
    kind: isDefense ? 'defense' : isBattle ? 'liberation' : 'quiet',
    ownerText: ownerKey === 'humans' ? 'Held by Super Earth' : ownerKey === 'unknown' ? 'Owner unknown' : `Held by the ${getFactionDisplayName(ownerKey)}`,
    enemyKey,
    progressPercent: null,
    progressLabel: null,
    verdictLine: null,
    etaText: null,
    timeLeftText: null,
    playerCount: planet.statistics?.playerCount ?? null,
    regenPercentPerHour: hasKnownHealth(planet) ? getEnemyRegenPercentPerHour(planet) : null,
    netPercentPerHour: null,
    modifiers: [...new Set([
      ...asArray(planet.hazards).map(hazard => hazard.name).filter(name => name && name !== 'None'),
      ...getKnownEffectNamesForPlanet(planet.index),
    ])],
    neighbours: getSupplyLineNeighbours(planet),
    attackedFrom: findEnemyAttackSources(planet),
    attacking: asArray(planet.attacking).map(index => apiData.planetsByIndex[index]).filter(Boolean),
    isMajorOrderTarget: getMajorOrderTargets().planetIndexes.has(planet.index),
    gambitCandidate: null,
    gambitOption: null,
    guideEntryId: null,
  };

  if (isDefense) {
    const outlook = describeDefenseOutlook(planet, getPlanetTrend(planet), nowTimestamp);
    details.progressPercent = outlook.progressPercent;
    details.progressLabel = 'Defended';
    details.verdictLine = describeDefenseVerdict(outlook);
    details.netPercentPerHour = outlook.ratePercentPerHour;
    details.timeLeftText = outlook.hoursLeft !== null ? formatDuration(outlook.hoursLeft * 3600) : null;
    details.etaText = outlook.hoursToWin !== null ? `held in about ${formatDuration(outlook.hoursToWin * 3600)} (estimate)`
      : isFiniteNumber(outlook.ratePercentPerHour) ? 'not at the current rate'
      : outlook.trendStatus === 'no-recent-data' ? 'not enough recent data' : 'measuring…';
    details.gambitOption = describeGambitOption(planet, nowTimestamp);
  } else if (isBattle && hasKnownHealth(planet)) {
    const outlook = describeLiberationOutlook(planet, getPlanetTrend(planet), estimateGalaxyOutputPerPlayer());
    details.progressPercent = outlook.liberationPercent;
    details.progressLabel = 'Liberated';
    details.verdictLine = describeLiberationVerdict(outlook);
    details.netPercentPerHour = outlook.netPercentPerHour;
    details.etaText = outlook.verdict === 'liberated' ? 'liberated'
      : outlook.hoursToLiberation !== null && outlook.hoursToLiberation <= ETA_LONGEST_HOURS
        ? `about ${formatDuration(outlook.hoursToLiberation * 3600)} (estimate)`
      : outlook.verdict === 'winning' ? 'more than two weeks'
      : outlook.verdict === 'stalled' || outlook.verdict === 'losing' ? 'none at the current rate'
      : outlook.trendStatus === 'no-recent-data' ? 'not enough recent data' : 'measuring…';
  }

  if (enemyKey && isBattle) {
    details.gambitCandidate = analyseFront(enemyKey, nowTimestamp).candidates
      .find(candidate => candidate.planet.index === planet.index) || null;
  }
  const guideFactionKey = enemyKey || (ownerKey !== 'humans' && ownerKey !== 'unknown' ? ownerKey : null);
  if (guideFactionKey && findGuideEntry(getGuideData(), `faction-${guideFactionKey}`)) {
    details.guideEntryId = `faction-${guideFactionKey}`;
  }
  return details;
}

// A button that opens the drawer on a planet (used in the drawer, the gambit panel, the
// simple-mode cards and Major Order tasks).
function buildPlanetDrawerButton(planet, text = planet.name, className = 'link-button') {
  return buildElement('button', { className, text,
    attributes: { type: 'button', 'data-open-planet': planet.index, 'aria-label': `${planet.name}: show its details` } });
}

// A list of planets as drawer buttons, each with its owner in words.
function buildDrawerPlanetList(planets) {
  return buildElement('ul', { className: 'planet-drawer-links' }, planets.map(other => {
    const ownerKey = getMapOwnerKey(other);
    const ownerName = ownerKey === 'humans' ? 'Super Earth' : ownerKey === 'unknown' ? 'unknown' : getFactionDisplayName(ownerKey);
    return buildElement('li', {}, [buildPlanetDrawerButton(other), ' ', buildElement('span', { className: 'planet-drawer-owner', text: `(${ownerName})` })]);
  }));
}

// The drawer's content for one planet.
function buildPlanetDrawerBody(details) {
  const planet = details.planet;
  const sections = [
    buildElement('p', { className: 'planet-drawer-subline', text: [details.ownerText, planet.sector ? `${planet.sector} sector` : null,
      details.isMajorOrderTarget ? 'Major Order target' : null].filter(Boolean).join(' · ') }),
  ];
  if (details.progressPercent !== null) {
    sections.push(buildMeter(details.progressPercent, details.progressLabel, details.verdictLine.status));
    sections.push(buildStatusLine(details.verdictLine));
  } else {
    sections.push(buildElement('p', { className: 'section-hint', text: 'No battle on this planet right now.' }));
  }
  sections.push(buildFactList([
    ['Progress', details.progressPercent !== null ? `${formatPercent(details.progressPercent)} ${details.progressLabel.toLowerCase()}` : null],
    ['ETA', details.etaText],
    ['Time left', details.timeLeftText],
    ['Helldivers here', isFiniteNumber(details.playerCount) ? formatBigNumber(details.playerCount) : null],
    ['Enemy recovers', details.kind === 'liberation' && isFiniteNumber(details.regenPercentPerHour) ? formatEnemyRecovery(details.regenPercentPerHour) : null],
    ['Net pace', details.kind !== 'quiet' ? (isFiniteNumber(details.netPercentPerHour) ? formatPercentPerHour(details.netPercentPerHour) : 'measuring…') : null],
  ]));

  sections.push(buildElement('h3', { text: 'Modifiers' }));
  sections.push(details.modifiers.length > 0
    ? buildElement('ul', { className: 'chip-list', attributes: { 'aria-label': 'Modifiers' } },
      details.modifiers.map(name => buildElement('li', { className: 'chip', text: name })))
    : buildElement('p', { className: 'section-hint', text: 'None known.' }));

  if (details.kind === 'defense') {
    sections.push(buildElement('h3', { text: 'Attack comes from' }));
    sections.push(details.attackedFrom.length > 0 ? buildDrawerPlanetList(details.attackedFrom)
      : buildElement('p', { className: 'section-hint', text: 'The feeds don\'t say.' }));
    if (details.gambitOption) {
      sections.push(buildStatusLine(GAMBIT_VERDICT_LINES[details.gambitOption.verdict], 'verdict gambit-verdict'));
      sections.push(buildElement('p', { className: 'section-hint', text: details.gambitOption.sentence }));
    }
  }
  if (details.attacking.length > 0) {
    sections.push(buildElement('h3', { text: 'Attack lanes from here' }));
    sections.push(buildDrawerPlanetList(details.attacking));
  }

  sections.push(buildElement('h3', { text: 'Neighbours (supply lines)' }));
  sections.push(details.neighbours.length > 0 ? buildDrawerPlanetList(details.neighbours)
    : buildElement('p', { className: 'section-hint', text: apiData.currentDataSource === 'FALLBACK'
      ? 'The backup API has no supply lines.' : 'None known.' }));

  if (details.gambitCandidate) {
    sections.push(buildElement('h3', { text: `Gambit score ${details.gambitCandidate.score}` }));
    sections.push(buildElement('ul', { className: 'gambit-reasons' }, details.gambitCandidate.reasons.map(reason => buildElement('li', {}, [
      buildElement('span', { className: `gambit-points ${reason.points > 0 ? 'is-plus' : 'is-minus'}`,
        text: `${reason.points > 0 ? '+' : '−'}${Math.abs(reason.points)}` }),
      buildElement('span', { text: reason.text }),
    ]))));
  }

  const guideEntry = details.guideEntryId ? findGuideEntry(getGuideData(), details.guideEntryId) : null;
  sections.push(buildElement('div', { className: 'planet-drawer-actions' }, [
    buildElement('button', { text: 'Full details', attributes: { type: 'button', 'data-drawer-action': 'details', 'data-drawer-focus-key': 'details' } }),
    guideEntry ? buildElement('button', { text: `Guide: ${guideEntry.name || guideEntry.title}`,
      attributes: { type: 'button', 'data-drawer-action': 'guide', 'data-guide-entry': details.guideEntryId, 'data-drawer-focus-key': 'guide' } }) : null,
  ]));
  return sections;
}

// Fills the drawer for the planet it is open on (called on open and on every refresh).
// Keeps keyboard focus on the same control when the content is rebuilt.
function renderPlanetDrawer() {
  const drawer = document.getElementById('planet-drawer');
  if (!drawer || planetDrawerState.planetIndex === null) return;
  const planet = apiData.planetsByIndex[planetDrawerState.planetIndex];
  const focusedInside = drawer.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = focusedInside?.dataset?.drawerFocusKey || (focusedInside?.dataset?.openPlanet ? `planet-${focusedInside.dataset.openPlanet}` : null);

  putTextInElement('planet-drawer-title', planet ? planet.name : 'Planet');
  const body = planet ? buildPlanetDrawerBody(describePlanetForDrawer(planet))
    : [buildElement('p', { className: 'empty-state', text: 'This planet is no longer in the feeds.' })];
  replaceContent('planet-drawer-body', body);

  if (focusKey) {
    const again = drawer.querySelector(`[data-drawer-focus-key="${focusKey}"]`)
      || drawer.querySelector(`[data-open-planet="${focusKey.replace('planet-', '')}"]`);
    (again || document.getElementById('planet-drawer-title')).focus({ preventScroll: true });
  }
}

// Opens the drawer on a planet. From a button, focus moves to the drawer's title; from the map
// it stays on the marker, so the arrow keys keep moving between planets.
function openPlanetDrawer(planetIndex, { opener = null, moveFocus = true } = {}) {
  const drawer = document.getElementById('planet-drawer');
  if (!drawer || !apiData.planetsByIndex[planetIndex]) return false;
  planetDrawerState.planetIndex = planetIndex;
  const openerSelector = describeDrawerOpener(opener);
  // a planet button inside the drawer keeps the original opener to return to
  if (openerSelector && !drawer.contains(opener)) planetDrawerState.openerSelector = openerSelector;
  drawer.hidden = false;
  document.body.classList.add('has-planet-drawer');
  renderPlanetDrawer();
  if (moveFocus) document.getElementById('planet-drawer-title').focus({ preventScroll: true });
  return true;
}

// Closes the drawer and, unless told not to, puts focus back where it was opened from.
function closePlanetDrawer({ returnFocus = true } = {}) {
  const drawer = document.getElementById('planet-drawer');
  if (!drawer || drawer.hidden) return;
  drawer.hidden = true;
  document.body.classList.remove('has-planet-drawer');
  const opener = planetDrawerState.openerSelector ? document.querySelector(planetDrawerState.openerSelector) : null;
  planetDrawerState.planetIndex = null;
  planetDrawerState.openerSelector = null;
  if (returnFocus && opener) opener.focus({ preventScroll: true });
}

// Shows a guide entry in guide mode, with the filters cleared so it isn't hidden.
function showGuideEntry(entryId) {
  changeViewMode('guide');
  const searchBox = document.getElementById('guide-search');
  const factionFilter = document.getElementById('guide-faction-filter');
  if (searchBox) searchBox.value = '';
  if (factionFilter) factionFilter.value = 'all';
  applyGuideFilters();
  focusAndReveal(document.getElementById(`guide-entry-${entryId}`));
}

// Page-wide clicks: any [data-open-planet] button opens the drawer; the drawer's own buttons
// close it, open full details or open the guide.
function handleDrawerClicks(event) {
  const target = event.target;
  if (!target || !target.closest) return;
  const planetButton = target.closest('[data-open-planet]');
  if (planetButton) {
    openPlanetDrawer(Number(planetButton.dataset.openPlanet), { opener: planetButton });
    return;
  }
  if (target.closest('#planet-drawer-close')) {
    closePlanetDrawer();
    return;
  }
  const action = target.closest('[data-drawer-action]');
  if (!action) return;
  const planetIndex = planetDrawerState.planetIndex;
  closePlanetDrawer({ returnFocus: false });
  if (action.dataset.drawerAction === 'details') jumpToPlanet(planetIndex);
  if (action.dataset.drawerAction === 'guide') showGuideEntry(action.dataset.guideEntry);
}

// Esc closes the drawer from anywhere on the page.
function handleDrawerKeydown(event) {
  if (event.key !== 'Escape') return;
  const drawer = document.getElementById('planet-drawer');
  if (!drawer || drawer.hidden) return;
  event.preventDefault();
  closePlanetDrawer();
}

// ── ADVANCED NAVIGATION ──────────────────────────────────────────────────────
// A sticky toolbar (section links, jump to planet, expand/collapse all) and
// collapsible sections whose open/closed state survives a reload.

const COLLAPSED_SECTIONS_STORAGE_KEY = 'hd2_collapsed_sections';

// Sections that start collapsed for a first-time visitor: the raw JSON is
// for debugging, not for reading between missions.
const SECTIONS_COLLAPSED_BY_DEFAULT = ['advanced-section-raw-data'];

// The ids of collapsed sections, from storage or the defaults.
function readCollapsedSectionIds() {
  try {
    const stored = JSON.parse(readStoredValue(COLLAPSED_SECTIONS_STORAGE_KEY));
    if (Array.isArray(stored)) return new Set(stored.filter(sectionId => typeof sectionId === 'string'));
  } catch {
    // unreadable storage falls through to the defaults
  }
  return new Set(SECTIONS_COLLAPSED_BY_DEFAULT);
}

let collapsedSectionIds = readCollapsedSectionIds();

// Opens or closes one section in the page and remembers the choice.
function setSectionCollapsed(sectionId, collapsed) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const toggle = section.querySelector('.collapse-toggle');
  const body = section.querySelector('.collapsible-body');
  if (toggle) toggle.setAttribute('aria-expanded', String(!collapsed));
  if (body) body.hidden = collapsed;
  section.classList.toggle('is-collapsed', collapsed);

  if (collapsed) collapsedSectionIds.add(sectionId);
  else collapsedSectionIds.delete(sectionId);
  writeStoredValue(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify([...collapsedSectionIds]));
}

// Puts every collapsible section into its remembered state.
function applyCollapsedSections() {
  for (const section of document.querySelectorAll('.collapsible-section')) {
    setSectionCollapsed(section.id, collapsedSectionIds.has(section.id));
  }
}

// Opens or closes every collapsible section at once.
function setAllSectionsCollapsed(collapsed) {
  for (const section of document.querySelectorAll('.collapsible-section')) {
    setSectionCollapsed(section.id, collapsed);
  }
}

// Moves keyboard focus (and the view) to an element, making it focusable if needed.
function focusAndReveal(element) {
  if (!element) return;
  if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
  element.focus({ preventScroll: true });
  if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// Section-menu links open their section before the browser jumps to it.
function handleSectionNavClick(event) {
  const link = event.target.closest && event.target.closest('a[data-section]');
  if (!link) return;
  setSectionCollapsed(link.dataset.section, false);
}

// Planets whose name contains the query, active battles first, then names
// that start with the query. Case and spacing don't matter.
function findPlanetsMatching(query, limit = 8) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  // Sort key: battles before quiet planets, prefix matches before the rest.
  const rank = planet => (apiData.indexesOfPlanetsWithActiveBattles.has(planet.index) ? 0 : 2)
    + (planet.name.toLowerCase().startsWith(needle) ? 0 : 1);
  return apiData.planets
    .filter(planet => planet.name.toLowerCase().includes(needle))
    .sort((first, second) => rank(first) - rank(second) || first.name.localeCompare(second.name))
    .slice(0, limit);
}

// Shows a planet in advanced mode: its campaign card when it is being
// fought over, otherwise its row in the planets table. Returns the element
// it moved to, or null when the planet isn't on the page.
function jumpToPlanet(planetIndex) {
  if (viewMode !== 'advanced') changeViewMode('advanced');

  // a front filter could be hiding the card, so show every front first
  const factionFilter = document.getElementById('campaign-faction-filter');
  const isBattlePlanet = apiData.indexesOfPlanetsWithActiveBattles.has(planetIndex);
  if (isBattlePlanet && factionFilter && factionFilter.value !== 'all') {
    factionFilter.value = 'all';
    renderCampaigns();
  }

  const campaignHeading = document.getElementById(`advanced-campaign-planet-${planetIndex}`);
  if (campaignHeading) {
    setSectionCollapsed('advanced-section-campaigns', false);
    const card = campaignHeading.closest('.planet-card');
    focusAndReveal(card);
    return card;
  }
  const row = document.getElementById(`planet-row-${planetIndex}`);
  if (row) {
    setSectionCollapsed('advanced-section-planets', false);
    focusAndReveal(row);
    return row;
  }
  return null;
}

// The jump form: finds the best match for what was typed and goes there.
function handlePlanetJumpSubmit(event) {
  if (event) event.preventDefault();
  const input = document.getElementById('planet-jump-input');
  const query = input ? input.value : '';
  const exactMatch = apiData.planets.find(planet => planet.name.toLowerCase() === query.trim().toLowerCase());
  const target = exactMatch || findPlanetsMatching(query, 1)[0];
  if (!target) {
    putTextInElement('planet-jump-status', query.trim() ? `No planet called "${query.trim()}".` : 'Type a planet name first.');
    return null;
  }
  const landedOn = jumpToPlanet(target.index);
  putTextInElement('planet-jump-status', landedOn ? `Showing ${target.name}.` : `${target.name} has no section on this page.`);
  return landedOn;
}

// Fills the jump box's suggestions: planets in battle first, then the rest.
function renderPlanetJumpOptions() {
  const datalist = document.getElementById('planet-jump-options');
  if (!datalist) return;
  const planets = [...apiData.planets].sort((first, second) =>
    (apiData.indexesOfPlanetsWithActiveBattles.has(second.index) - apiData.indexesOfPlanetsWithActiveBattles.has(first.index))
    || first.name.localeCompare(second.name));
  datalist.replaceChildren(...planets.map(planet => buildElement('option', { attributes: { value: planet.name } })));
}

// Wires the toolbar and the section toggles (called once from startApp).
function wireAdvancedNavigation() {
  for (const toggle of document.querySelectorAll('.collapse-toggle')) {
    toggle.addEventListener('click', () => {
      const section = toggle.closest('.collapsible-section');
      setSectionCollapsed(section.id, toggle.getAttribute('aria-expanded') === 'true');
    });
  }
  const sectionNav = document.querySelector('.advanced-toolbar .section-nav');
  if (sectionNav) sectionNav.addEventListener('click', handleSectionNavClick);
  const jumpForm = document.getElementById('planet-jump-form');
  if (jumpForm) jumpForm.addEventListener('submit', handlePlanetJumpSubmit);
  const expandAll = document.getElementById('expand-all-sections');
  if (expandAll) expandAll.addEventListener('click', () => setAllSectionsCollapsed(false));
  const collapseAll = document.getElementById('collapse-all-sections');
  if (collapseAll) collapseAll.addEventListener('click', () => setAllSectionsCollapsed(true));
  const gambitPanel = document.getElementById('output-gambits');
  if (gambitPanel) gambitPanel.addEventListener('click', handleGambitPanelClick);
  applyCollapsedSections();
}

// ── GUIDE MODE ───────────────────────────────────────────────────────────────
// Game knowledge from guide-data.js (GUIDE_DATA). It doesn't depend on the war
// feeds, so it is rendered once at start-up and only re-filtered afterwards.

const GUIDE_CONFIDENCE_LABELS = {
  high: null,
  medium: 'Numbers may have changed',
  low: 'Likely out of date: check in game',
};

// The guide content, or null when guide-data.js failed to load.
function getGuideData() {
  return typeof GUIDE_DATA !== 'undefined' && isPlainObject(GUIDE_DATA) ? GUIDE_DATA : null;
}

// Every entry in the guide as {kind, entry}, in display order.
function listGuideEntries(guideData) {
  if (!guideData) return [];
  const kinds = [
    ['faction', guideData.factions], ['stratagem', guideData.stratagems],
    ['armourPassive', guideData.armourPassives], ['shipModule', guideData.shipModules],
    ['mechanic', guideData.mechanics],
  ];
  return kinds.flatMap(([kind, entries]) => asArray(entries).map(entry => ({ kind, entry })));
}

// Finds one guide entry by id, across every section.
function findGuideEntry(guideData, entryId) {
  return listGuideEntries(guideData).find(item => item.entry.id === entryId)?.entry || null;
}

// Everything searchable about an entry, lowercased into one string.
function getGuideEntrySearchText(entry) {
  const parts = [];
  // Collects every string inside a value, however deeply nested.
  const collect = value => {
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (isPlainObject(value)) Object.values(value).forEach(collect);
  };
  collect(entry);
  return parts.join(' ').toLowerCase();
}

// Should this entry show for the current search text and front filter?
// The front filter narrows factions and stratagems; general knowledge
// (passives, modules, mechanics) is never hidden by it.
function guideEntryMatches(kind, entry, searchText = '', factionKey = 'all') {
  if (factionKey !== 'all') {
    if (kind === 'faction' && entry.key !== factionKey) return false;
    if (kind === 'stratagem' && !asArray(entry.strongAgainst).includes(factionKey)) return false;
  }
  const words = searchText.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = getGuideEntrySearchText(entry);
  return words.every(word => haystack.includes(word));
}

// {count: 2, per: 'rearm'} → "2 per rearm"; null → "Limited by cooldown".
function formatStratagemUses(uses) {
  if (!isPlainObject(uses) || !isFiniteNumber(uses.count)) return 'Limited by cooldown';
  return `${uses.count} per ${uses.per === 'call' ? 'call-in' : uses.per}`;
}

// Cooldown seconds → "≈ 8m" (seconds under a minute stay in seconds).
function formatStratagemCooldown(seconds) {
  if (!isFiniteNumber(seconds)) return '—';
  return seconds < 60 ? `≈ ${seconds}s` : `≈ ${formatDuration(seconds)}`;
}

// A small "check in game" badge for entries that may be out of date.
function buildGuideConfidenceBadge(confidence) {
  const label = GUIDE_CONFIDENCE_LABELS[confidence];
  if (!label) return null;
  return buildElement('span', { className: `guide-confidence guide-confidence-${confidence}`, text: label });
}

// A link to another guide entry, by id (plain text when the id is unknown).
function buildGuideEntryLink(guideData, entryId) {
  const target = findGuideEntry(guideData, entryId);
  if (!target) return buildElement('span', { text: entryId });
  return buildElement('a', { className: 'guide-link', text: target.name || target.title,
    attributes: { href: `#guide-entry-${entryId}` } });
}

// Comma-separated links to other entries.
function buildGuideLinkList(guideData, entryIds) {
  const container = buildElement('span');
  asArray(entryIds).forEach((entryId, position) => {
    if (position > 0) container.append(', ');
    container.append(buildGuideEntryLink(guideData, entryId));
  });
  return container;
}

// Faction chips with icon + name, for "strong against" / "weak against".
function buildGuideFactionChips(factionKeys) {
  return buildElement('ul', { className: 'chip-list' }, asArray(factionKeys).map(factionKey =>
    buildElement('li', { className: `chip faction-chip faction-${factionKey}` }, [
      buildImage(getFactionIconFile(factionKey), '', 'faction-icon faction-icon-small', 20, 20),
      ` ${getFactionDisplayName(factionKey)}`,
    ])));
}

// One label → content row inside a guide card (skipped when empty).
function buildGuideRow(label, content) {
  if (content === null || content === undefined || content === '') return null;
  if (content instanceof Node && content.childNodes.length === 0) return null;
  return buildElement('div', { className: 'fact' }, [
    buildElement('dt', { text: label }),
    buildElement('dd', {}, [content instanceof Node ? content : String(content)]),
  ]);
}

// The card for one guide entry, shaped by its kind.
function buildGuideEntryCard(guideData, kind, entry) {
  const title = entry.name || entry.title;
  const rows = [];
  const body = [];

  if (kind === 'faction') {
    const loadout = entry.loadout || {};
    body.push(buildElement('p', { text: entry.summary }));
    body.push(buildElement('h4', { text: 'How to fight them' }));
    body.push(buildElement('ul', { className: 'guide-list' },
      asArray(entry.howToFight).map(tip => buildElement('li', { text: tip }))));
    body.push(buildTable(`Threats: ${title}`, ['Enemy', 'Answer'],
      asArray(entry.threats).map(threat => [threat.enemy, threat.answer])));
    body.push(buildElement('h4', { text: 'A good starting loadout' }));
    rows.push(
      buildGuideRow('Primary', loadout.primaryAdvice),
      buildGuideRow('Stratagems', buildGuideLinkList(guideData, loadout.stratagems)),
      buildGuideRow('Armour passive', buildGuideEntryLink(guideData, loadout.armourPassive)),
      buildGuideRow('Why', loadout.why),
    );
  } else if (kind === 'stratagem') {
    body.push(buildElement('p', { text: entry.purpose }));
    rows.push(
      buildGuideRow('Type', entry.category),
      buildGuideRow('Cooldown', formatStratagemCooldown(entry.cooldownSeconds)),
      buildGuideRow('Uses', formatStratagemUses(entry.uses)),
      buildGuideRow('Pairs with', buildGuideLinkList(guideData, entry.pairsWith)),
      buildGuideRow('Shines against', buildGuideFactionChips(entry.strongAgainst)),
      buildGuideRow('A waste against', buildGuideFactionChips(entry.weakAgainst)),
      buildGuideRow('Notes', entry.notes),
    );
  } else if (kind === 'armourPassive') {
    rows.push(buildGuideRow('What it does', entry.effect), buildGuideRow('Worth it when', entry.whenWorthIt));
  } else if (kind === 'shipModule') {
    const priorityText = { 1: 'Buy early', 2: 'Buy if you use it', 3: 'Later' }[entry.priority] || '—';
    rows.push(
      buildGuideRow('Department', entry.department),
      buildGuideRow('What it does', entry.effect),
      buildGuideRow('Priority', `${priorityText}: ${entry.why}`),
    );
  } else if (kind === 'mechanic') {
    body.push(buildElement('p', { className: 'guide-mistake' }, [
      buildElement('strong', { text: 'Common mistake: ' }), entry.commonMistake]));
    body.push(buildElement('p', { text: entry.explanation }));
    body.push(buildElement('ul', { className: 'guide-list' },
      asArray(entry.tips).map(tip => buildElement('li', { text: tip }))));
  }

  // the logo comes from getFactionIconFile() so FACTION_ICON_DIRECTORY switches it too
  const factionIconPath = kind === 'faction' ? (getFactionIconFile(entry.key) || entry.icon) : null;
  const factionIcon = factionIconPath ? buildImage(factionIconPath, entry.name, 'faction-icon', 28, 28) : null;
  return buildElement('article', {
    className: `guide-entry guide-entry-${kind}`,
    attributes: { id: `guide-entry-${entry.id}`, 'data-guide-kind': kind, tabindex: -1 },
  }, [
    buildElement('header', { className: 'guide-entry-header' }, [
      factionIcon,
      buildElement('h3', { text: title }),
      buildGuideConfidenceBadge(entry.confidence),
    ]),
    ...body,
    rows.some(Boolean) ? buildElement('dl', { className: 'fact-list fact-list-detailed' }, rows) : null,
  ]);
}

// The five guide sections, in reading order.
const GUIDE_SECTIONS = [
  { kind: 'faction',       id: 'guide-factions',       title: 'Fighting each faction', dataKey: 'factions' },
  { kind: 'stratagem',     id: 'guide-stratagems',     title: 'Stratagems',            dataKey: 'stratagems' },
  { kind: 'armourPassive', id: 'guide-armour-passives', title: 'Armour passives',      dataKey: 'armourPassives' },
  { kind: 'shipModule',    id: 'guide-ship-modules',   title: 'Ship modules',          dataKey: 'shipModules' },
  { kind: 'mechanic',      id: 'guide-mechanics',      title: 'Mechanics people get wrong', dataKey: 'mechanics' },
];

// Builds the whole guide into #guide-content. Called once at start-up.
function renderGuide() {
  const guideData = getGuideData();
  if (!guideData) {
    replaceContent('guide-content', [buildElement('p', { className: 'empty-state',
      text: 'The guide could not be loaded (guide-data.js is missing or broken).' })]);
    return;
  }
  putTextInElement('guide-version',
    `Written for ${guideData.gameVersion}. The game is now on ${guideData.currentPatchWhenWritten}`
    + (guideData.checkedAgainstCurrentPatch ? '.' : ' and this guide has not been re-checked against it.')
    + ` Last edited ${guideData.lastEdited}.`);
  putTextInElement('guide-disclaimer', guideData.disclaimer);

  replaceContent('guide-content', GUIDE_SECTIONS.map(section => {
    const entries = asArray(guideData[section.dataKey]);
    // Stratagems read better grouped by category (support weapon, orbital…).
    const sortedEntries = section.kind === 'shipModule'
      ? [...entries].sort((first, second) => (first.priority || 9) - (second.priority || 9))
      : entries;
    return buildElement('section', { className: 'panel guide-section', attributes: { id: section.id, 'aria-labelledby': `${section.id}-heading` } }, [
      buildElement('h2', { text: section.title, attributes: { id: `${section.id}-heading` } }),
      buildElement('p', { className: 'empty-state guide-no-matches', text: 'Nothing here matches your search.', attributes: { hidden: true } }),
      buildElement('div', { className: 'guide-grid' },
        sortedEntries.map(entry => buildGuideEntryCard(guideData, section.kind, entry))),
    ]);
  }));
  applyGuideFilters();
}

// Shows only the entries matching the search box and front filter, and
// says so when a section ends up empty.
function applyGuideFilters() {
  const guideData = getGuideData();
  if (!guideData) return;
  const searchText = document.getElementById('guide-search')?.value || '';
  const factionKey = document.getElementById('guide-faction-filter')?.value || 'all';

  let visibleCount = 0;
  for (const section of GUIDE_SECTIONS) {
    const sectionElement = document.getElementById(section.id);
    if (!sectionElement) continue;
    let visibleInSection = 0;
    for (const entry of asArray(guideData[section.dataKey])) {
      const card = document.getElementById(`guide-entry-${entry.id}`);
      if (!card) continue;
      const matches = guideEntryMatches(section.kind, entry, searchText, factionKey);
      card.hidden = !matches;
      if (matches) visibleInSection++;
    }
    sectionElement.querySelector('.guide-no-matches').hidden = visibleInSection > 0;
    visibleCount += visibleInSection;
  }
  const filtering = searchText.trim() !== '' || factionKey !== 'all';
  putTextInElement('guide-match-count', filtering ? `${visibleCount} entries match` : '');
}

// Following a "pairs with" link to an entry the filters are hiding clears
// the filters first, so the jump always lands on something visible.
function handleGuideLinkClick(event) {
  const link = event.target.closest && event.target.closest('a.guide-link');
  if (!link) return;
  const target = document.getElementById(link.getAttribute('href').slice(1));
  if (target && target.hidden) {
    const searchBox = document.getElementById('guide-search');
    const factionFilter = document.getElementById('guide-faction-filter');
    if (searchBox) searchBox.value = '';
    if (factionFilter) factionFilter.value = 'all';
    applyGuideFilters();
  }
}

// ── SUPPORT BOX ──────────────────────────────────────────────────────────────

// Points the footer's support button at DONATION_URL, or keeps it inert
// (href="#", clicks ignored so the page doesn't jump to the top) until set.
function applyDonationLink(donationUrl = DONATION_URL) {
  const supportLink = document.getElementById('support-link');
  if (!supportLink) return;
  const isRealUrl = typeof donationUrl === 'string' && /^https:\/\//.test(donationUrl);
  if (isRealUrl) {
    supportLink.setAttribute('href', donationUrl);
    supportLink.setAttribute('target', '_blank');
    supportLink.setAttribute('rel', 'noopener noreferrer');
    supportLink.onclick = null;
  } else {
    supportLink.setAttribute('href', '#');
    supportLink.removeAttribute('target');
    supportLink.onclick = event => event.preventDefault();
  }
}

// The header's Super Earth logo, from the same folder as every other faction logo.
function applySiteEmblem() {
  const emblem = document.querySelector('.site-emblem');
  const emblemPath = getFactionIconFile('Humans');
  if (emblem && emblemPath) emblem.setAttribute('src', encodeURI(emblemPath));
}

// ── REFRESH LOOP ─────────────────────────────────────────────────────────────

let lastRefreshStartedTimestamp = 0;
let nextRefreshDueTimestamp = 0;
let countdownTimer = null;

// Starts a full download + render unless one is already running, in which
// case callers share the running one (button mashing can't stack requests).
function refreshEverythingNow() {
  if (refreshInProgress) return refreshInProgress;
  refreshInProgress = runRefreshCycle().finally(() => {
    refreshInProgress = null;
    renderStatusBar();
  });
  return refreshInProgress;
}

// One refresh: keeps a rate-limit window between cycles, renders as soon as
// the fast feeds land, then renders the complete picture.
async function runRefreshCycle() {
  const millisecondsSinceLastStart = Date.now() - lastRefreshStartedTimestamp;
  if (millisecondsSinceLastStart < RATE_LIMIT_WINDOW_MILLISECONDS) {
    await waitMilliseconds(RATE_LIMIT_WINDOW_MILLISECONDS - millisecondsSinceLastStart);
  }
  lastRefreshStartedTimestamp = Date.now();
  renderStatusBar();

  const downloadSucceeded = await downloadAllData(renderEverything);
  lastRefreshFailed = !downloadSucceeded;
  renderEverything();

  scheduleNextRefresh();
  return downloadSucceeded;
}

// Sets the next automatic refresh one interval from now (wall-clock based,
// so a throttled background tab catches up as soon as a timer fires).
function scheduleNextRefresh(nowTimestamp = Date.now()) {
  nextRefreshDueTimestamp = nowTimestamp + REFRESH_INTERVAL_SECONDS * 1000;
}

// Whole seconds until the next automatic refresh (never negative).
function getSecondsUntilNextRefresh(nowTimestamp = Date.now()) {
  return Math.max(0, Math.ceil((nextRefreshDueTimestamp - nowTimestamp) / 1000));
}

// Once a second: updates the countdown and the data age, and refreshes when due
// (the war feeds every minute, the shared history every 10 minutes).
function tickCountdown() {
  if (getSecondsUntilNextRefresh() <= 0 && !refreshInProgress) refreshEverythingNow();
  refreshSharedHistoryWhenDue();
  putTextInElement('countdown-text', describeCountdown());
  renderStatusBar();
}

// Ticks the on-screen countdown every second.
function startCountdownTimer() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(tickCountdown, 1000);
}

// Coming back to the tab (e.g. alt-tabbing out of the game) refreshes at once
// if the data is older than one refresh interval.
function handleVisibilityChange() {
  if (document.hidden || refreshInProgress) return;
  const dataAgeMilliseconds = Date.now() - (apiData.lastSuccessfulFetchTimestamp || 0);
  if (dataAgeMilliseconds >= REFRESH_INTERVAL_SECONDS * 1000) refreshEverythingNow();
}

// Wires the page's controls and starts the refresh loop. Runs on
// DOMContentLoaded so every element exists before it is touched.
function startApp() {
  const serverSelect = document.getElementById('server-select');
  if (serverSelect) {
    serverSelect.value = serverPreference;
    serverSelect.addEventListener('change', () => changeServerPreference(serverSelect.value));
  }
  const refreshButton = document.getElementById('refresh-button');
  if (refreshButton) refreshButton.addEventListener('click', () => refreshEverythingNow());
  for (const button of document.querySelectorAll('.view-mode-button')) {
    button.addEventListener('click', () => changeViewMode(button.dataset.viewMode));
  }
  for (const campaignControlId of ['campaign-faction-filter', 'campaign-sort']) {
    const campaignControl = document.getElementById(campaignControlId);
    if (campaignControl) campaignControl.addEventListener('change', () => renderCampaigns());
  }
  const guideSearch = document.getElementById('guide-search');
  if (guideSearch) guideSearch.addEventListener('input', () => applyGuideFilters());
  const guideFactionFilter = document.getElementById('guide-faction-filter');
  if (guideFactionFilter) guideFactionFilter.addEventListener('change', () => applyGuideFilters());
  const guideView = document.getElementById('guide-view');
  if (guideView) guideView.addEventListener('click', handleGuideLinkClick);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener('click', handleDrawerClicks);
  document.addEventListener('keydown', handleDrawerKeydown);

  applySiteEmblem();
  wireAdvancedNavigation();
  wireLlmSettings();
  applyDonationLink();
  applyViewMode();
  renderGuide();
  renderEverything();
  scheduleNextRefresh();
  refreshEverythingNow();
  refreshSharedHistory();
  startCountdownTimer();
}

document.addEventListener('DOMContentLoaded', startApp);

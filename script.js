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

// TODO(owner): put your donation page here, e.g. 'https://ko-fi.com/yourname'.
// While it is empty the footer's "Support the project" button stays href="#"
// and does nothing when clicked.
const DONATION_URL = '';

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
const TREND_WINDOW_MILLISECONDS = 30 * 60 * 1000;
const TREND_MINIMUM_SPAN_MILLISECONDS = 5 * 60 * 1000;   // shorter spans are mostly noise
const TREND_STALL_THRESHOLD_PERCENT_PER_HOUR = 0.05;
const SAMPLE_MERGE_WINDOW_MILLISECONDS = 20 * 1000;       // two renders in one cycle = one sample
const MINIMUM_PLAYERS_FOR_OUTPUT_ESTIMATE = 100;          // tiny squads make per-player maths noisy
const DEFENSE_MINIMUM_ELAPSED_FOR_AVERAGE_MILLISECONDS = 10 * 60 * 1000;

// ── LOOKUP TABLES ────────────────────────────────────────────────────────────

const FACTION_NAME_BY_ID = { 1: 'Humans', 2: 'Terminids', 3: 'Automaton', 4: 'Illuminate' };

const TASK_VALUE_TYPE = { FACTION_ID: 1, TARGET_AMOUNT: 3, PLANET_INDEX: 12 };

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
  };
}

// Appends a sample for every planet in battle. A new defense event or a
// changed max health means a different fight, so its series starts over.
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
                       lastSample.maxHealth !== newSample.maxHealth)) {
      samples = [];
    } else if (lastSample && nowTimestamp - lastSample.timestamp < SAMPLE_MERGE_WINDOW_MILLISECONDS) {
      samples = samples.slice(0, -1);
    }
    nextHistory[planetIndex] = [...samples, newSample];
  }

  apiData.planetHistoryByIndex = nextHistory;
  writeStoredValue(PLANET_HISTORY_STORAGE_KEY, JSON.stringify(nextHistory));
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

// A readable biome name for labels and alt text ("icemoss-special" → "Icemoss special").
function getBiomeDisplayName(planet) {
  const learnedBiomeName = apiData.knownBiomeNameByPlanetIndex[planet.index];
  if (learnedBiomeName) return learnedBiomeName;
  const biomeName = planet.biome?.name;
  if (typeof biomeName !== 'string' || !biomeName) return 'Unknown biome';
  if (/[A-Z ]/.test(biomeName)) return biomeName;
  const spaced = biomeName.replace(/[-_]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ── BIOME ART ────────────────────────────────────────────────────────────────
// Planet cards get a small landscape the page draws itself from the biome's
// name, instead of pictures taken from the game, which belong to Arrowhead and
// Sony. The same planet always gets the same picture; biomes that sound alike
// share a style. The colours are illustration data, so they live here rather
// than in style.css.

const BIOME_ART_WIDTH = 460;
const BIOME_ART_HEIGHT = 148;

// Which landscape a biome gets: the first rule with a keyword inside the
// normalized biome name wins, so the more specific words come first.
const BIOME_TERRAIN_RULES = [
  ['void',    ['blackhole']],
  ['static',  ['accessdenied', 'unknown']],
  ['factory', ['megafactory', 'cyberstan']],
  ['city',    ['superearth', 'metropolis', 'colonies']],
  ['hive',    ['hive', 'supercolony']],
  ['bones',   ['boneyard', 'deadlands', 'desolate', 'shattered']],
  ['lava',    ['magma', 'volcanic', 'scorched']],
  ['ice',     ['glacier', 'icy', 'icemoss', 'winter', 'tundra']],
  ['swamp',   ['swamp', 'moor', 'morass', 'bog']],
  ['oasis',   ['oasis']],
  ['dunes',   ['dunes', 'mesa']],
  ['canyon',  ['cliffs', 'canyon', 'badlands', 'desert', 'toxic']],
  ['forest',  ['jungle', 'forest', 'undergrowth', 'autumn', 'lush', 'crimson', 'ethereal']],
  ['craters', ['moon']],
  ['hills',   ['plains', 'highlands']],
];

// Words that recolour a landscape ("Deciduous Autumn Forest" is a forest in autumn colours).
const BIOME_PALETTE_RULES = [
  ['autumn',   ['autumn']],
  ['crimson',  ['crimson']],
  ['ethereal', ['ethereal']],
  ['ionic',    ['ionic']],
  ['acid',     ['acid', 'toxic']],
  ['haunted',  ['haunted']],
  ['bleak',    ['bleak']],
];

// Sky gradient, far and near ground, a feature colour (trees, water, lava…)
// and a light colour (sun, windows, glow).
const BIOME_PALETTES = {
  hills:    { skyTop: '#1b2a41', skyBottom: '#58708c', far: '#4a6457', near: '#2c3f34', feature: '#6d8a5c', light: '#f1e2b0' },
  forest:   { skyTop: '#132235', skyBottom: '#3e6770', far: '#2d5144', near: '#182d22', feature: '#2e6a44', light: '#d9ecc9' },
  autumn:   { skyTop: '#2a1f2e', skyBottom: '#8a5a3c', far: '#6b4a2f', near: '#3a2a1c', feature: '#c8702d', light: '#f6d49a' },
  crimson:  { skyTop: '#2a1420', skyBottom: '#7a2f3a', far: '#5a2430', near: '#2e1218', feature: '#b23a48', light: '#f3b5a0' },
  ethereal: { skyTop: '#1c1636', skyBottom: '#5a4a8c', far: '#3e3a6b', near: '#221f3f', feature: '#8f7fd6', light: '#e6dcff' },
  ionic:    { skyTop: '#0f2130', skyBottom: '#2f7f8f', far: '#1f5560', near: '#112f36', feature: '#3fb0b8', light: '#cff4f4' },
  acid:     { skyTop: '#1e2616', skyBottom: '#7a8a3a', far: '#5a6a2a', near: '#2e3616', feature: '#a8c43a', light: '#eef7a0' },
  haunted:  { skyTop: '#151a1c', skyBottom: '#4a5a58', far: '#34403d', near: '#1c2322', feature: '#5f7a6a', light: '#c9d6cf' },
  bleak:    { skyTop: '#23211f', skyBottom: '#7d7466', far: '#5c554b', near: '#34302a', feature: '#5f8a86', light: '#e8e0cc' },
  dunes:    { skyTop: '#2a2438', skyBottom: '#c98f5a', far: '#b07a48', near: '#7a5230', feature: '#d9a66a', light: '#fff0c8' },
  oasis:    { skyTop: '#1f2a44', skyBottom: '#d6a36a', far: '#b58450', near: '#86603a', feature: '#2f8f7f', light: '#fff2cf' },
  canyon:   { skyTop: '#2b2030', skyBottom: '#b0643e', far: '#8a4a30', near: '#5a2e1e', feature: '#c47a4a', light: '#ffe0b0' },
  ice:      { skyTop: '#14223a', skyBottom: '#6e8fb4', far: '#9fb8d0', near: '#d8e6f2', feature: '#b9d3ea', light: '#f4fbff' },
  swamp:    { skyTop: '#16201c', skyBottom: '#4f6a56', far: '#2f4536', near: '#1b2a20', feature: '#2d4a4a', light: '#dfe8c0' },
  lava:     { skyTop: '#1a0f12', skyBottom: '#6a2418', far: '#3a1c1a', near: '#1c0d0c', feature: '#ff7a1a', light: '#ffcf6a' },
  city:     { skyTop: '#111a2c', skyBottom: '#3c5478', far: '#2a3a58', near: '#18233a', feature: '#7f9bc8', light: '#f5c518' },
  factory:  { skyTop: '#1c0e10', skyBottom: '#6a2a26', far: '#3a2224', near: '#1e1416', feature: '#5a3a3a', light: '#ff5a4a' },
  hive:     { skyTop: '#24160c', skyBottom: '#9a5a1c', far: '#7a4414', near: '#4a2a0c', feature: '#2a1606', light: '#ffd27a' },
  bones:    { skyTop: '#1e1c1a', skyBottom: '#8a7a66', far: '#6a5e50', near: '#3e362e', feature: '#e6dcc8', light: '#f0e6d0' },
  craters:  { skyTop: '#06080d', skyBottom: '#1a2230', far: '#5a5f68', near: '#3a3e46', feature: '#2a2d33', light: '#c8ccd4' },
  void:     { skyTop: '#020205', skyBottom: '#0a0a14', far: '#1a1030', near: '#05050a', feature: '#f0a040', light: '#ffe6b0' },
  static:   { skyTop: '#1a1d22', skyBottom: '#2a2f36', far: '#3a3f46', near: '#22262c', feature: '#50565e', light: '#8d9ab2' },
};

// Landscapes under a dark sky get stars instead of a sun.
const BIOME_TERRAINS_WITH_STARS = ['void', 'craters', 'city', 'lava', 'ethereal'];

let biomeArtCounter = 0;   // gradient ids must be unique on the page

// The first rule whose keyword appears in the key, or null.
function findBiomeRule(rules, biomeKey) {
  const rule = rules.find(([, keywords]) => keywords.some(keyword => biomeKey.includes(keyword)));
  return rule ? rule[0] : null;
}

// A biome name or slug → {terrain, palette}. The name the primary API gave the
// planet wins over a backup slug, as for the labels.
function getBiomeArtRecipe(biomeName, planetIndex = null) {
  const learnedBiomeName = planetIndex !== null ? apiData.knownBiomeNameByPlanetIndex[planetIndex] : null;
  const biomeKey = normalizeBiomeKey(learnedBiomeName || biomeName);
  if (!biomeKey) return { terrain: 'static', palette: 'static' };
  const terrain = findBiomeRule(BIOME_TERRAIN_RULES, biomeKey) || 'hills';
  const palette = findBiomeRule(BIOME_PALETTE_RULES, biomeKey) || terrain;
  return { terrain, palette };
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

// The outline of a range of hills or mountains, closed along the bottom edge.
// Waves set the rolling shape, jaggedness adds peaks, flatTops makes mesas.
function buildRidgePath(random, { baseY, amplitude, jaggedness = 0, flatTops = false }) {
  const waves = [1, 2, 3].map(() => ({ frequency: randomBetween(random, 0.006, 0.03), phase: randomBetween(random, 0, Math.PI * 2) }));
  const points = [];
  for (let x = 0; x <= BIOME_ART_WIDTH; x += 10) {
    let offset = waves.reduce((total, wave) => total + Math.sin(x * wave.frequency + wave.phase), 0) / waves.length;
    offset += jaggedness * (random() - 0.5);
    let y = baseY - offset * amplitude;
    if (flatTops) y = Math.round(y / 14) * 14;
    points.push(`${x},${Math.max(4, Math.min(BIOME_ART_HEIGHT, y)).toFixed(1)}`);
  }
  return `M0,${BIOME_ART_HEIGHT} L${points.join(' L')} L${BIOME_ART_WIDTH},${BIOME_ART_HEIGHT} Z`;
}

// A ridge as an SVG path in one colour.
function buildRidge(random, colour, shape) {
  return createSvgElement('path', { d: buildRidgePath(random, shape), fill: colour });
}

// The terrain-specific shapes drawn in front of the far hills.
function buildBiomeFeatures(terrain, colours, random) {
  const shapes = [];
  const count = (low, high) => Math.round(randomBetween(random, low, high));
  switch (terrain) {
    case 'forest':
    case 'hills':
      shapes.push(buildRidge(random, colours.near, { baseY: 118, amplitude: 16 }));
      for (let tree = 0, total = terrain === 'forest' ? count(14, 20) : count(3, 6); tree < total; tree++) {
        const x = randomBetween(random, 0, BIOME_ART_WIDTH);
        const baseY = randomBetween(random, 118, 146);
        const height = randomBetween(random, 16, 34);
        shapes.push(createSvgElement('polygon', { fill: colours.feature,
          points: `${x.toFixed(1)},${(baseY - height).toFixed(1)} ${(x - height / 3).toFixed(1)},${baseY.toFixed(1)} ${(x + height / 3).toFixed(1)},${baseY.toFixed(1)}` }));
      }
      break;
    case 'ice':
      for (let spike = 0, total = count(6, 10); spike < total; spike++) {
        const x = randomBetween(random, 0, BIOME_ART_WIDTH);
        const height = randomBetween(random, 30, 70);
        shapes.push(createSvgElement('polygon', { fill: colours.feature, opacity: 0.9,
          points: `${x.toFixed(1)},${(130 - height).toFixed(1)} ${(x - height / 4).toFixed(1)},130 ${(x + height / 4).toFixed(1)},130` }));
      }
      shapes.push(buildRidge(random, colours.near, { baseY: 128, amplitude: 8 }));
      break;
    case 'dunes':
    case 'oasis':
      shapes.push(buildRidge(random, colours.near, { baseY: 124, amplitude: 14 }));
      if (terrain === 'oasis') {
        const waterX = randomBetween(random, 120, 340);
        shapes.push(createSvgElement('ellipse', { cx: waterX, cy: 136, rx: 70, ry: 7, fill: colours.feature }));
        const trunkX = waterX + randomBetween(random, -60, 60);
        shapes.push(createSvgElement('path', { d: `M${trunkX},138 Q${trunkX + 6},112 ${trunkX + 2},92`, stroke: colours.near, 'stroke-width': 4, fill: 'none' }));
        for (const [dx, dy] of [[-22, 6], [22, 6], [-14, -4], [16, -4]]) {
          shapes.push(createSvgElement('path', { d: `M${trunkX + 2},92 Q${trunkX + 2 + dx / 2},${86 + dy / 2} ${trunkX + 2 + dx},${92 + dy}`, stroke: colours.feature, 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round' }));
        }
      }
      break;
    case 'canyon':
      shapes.push(buildRidge(random, colours.near, { baseY: 122, amplitude: 26, flatTops: true }));
      break;
    case 'swamp':
      shapes.push(createSvgElement('rect', { x: 0, y: 118, width: BIOME_ART_WIDTH, height: 30, fill: colours.feature }));
      for (let ripple = 0; ripple < 6; ripple++) {
        const x = randomBetween(random, 0, BIOME_ART_WIDTH - 60);
        const y = randomBetween(random, 124, 144);
        shapes.push(createSvgElement('line', { x1: x, y1: y, x2: x + randomBetween(random, 20, 60), y2: y, stroke: colours.light, 'stroke-opacity': 0.25, 'stroke-width': 1.5 }));
      }
      for (let reed = 0, total = count(10, 18); reed < total; reed++) {
        const x = randomBetween(random, 0, BIOME_ART_WIDTH);
        shapes.push(createSvgElement('line', { x1: x, y1: 124, x2: x + randomBetween(random, -4, 4), y2: randomBetween(random, 96, 112), stroke: colours.near, 'stroke-width': 2.5, 'stroke-linecap': 'round' }));
      }
      break;
    case 'lava':
      // a soft glow on the horizon, behind the near peaks
      shapes.push(createSvgElement('ellipse', { cx: BIOME_ART_WIDTH / 2, cy: 112, rx: BIOME_ART_WIDTH * 0.6, ry: 16, fill: colours.feature, opacity: 0.16 }));
      shapes.push(buildRidge(random, colours.near, { baseY: 120, amplitude: 36, jaggedness: 1.2 }));
      shapes.push(createSvgElement('path', { d: `M-10,${randomBetween(random, 132, 142)} Q${randomBetween(random, 120, 340)},${randomBetween(random, 118, 146)} 470,${randomBetween(random, 130, 144)}`, stroke: colours.feature, 'stroke-width': 4, fill: 'none', opacity: 0.9 }));
      break;
    case 'city':
    case 'factory': {
      let x = 0;
      while (x < BIOME_ART_WIDTH) {
        const width = randomBetween(random, 18, 42);
        const height = randomBetween(random, terrain === 'city' ? 30 : 20, terrain === 'city' ? 90 : 55);
        shapes.push(createSvgElement('rect', { x: x.toFixed(1), y: (BIOME_ART_HEIGHT - height).toFixed(1), width: (width - 3).toFixed(1), height: height.toFixed(1), fill: colours.near }));
        if (terrain === 'factory' && random() < 0.35) {
          const chimneyX = x + width / 2;
          shapes.push(createSvgElement('rect', { x: chimneyX.toFixed(1), y: (BIOME_ART_HEIGHT - height - 26).toFixed(1), width: 6, height: 26, fill: colours.near }));
          shapes.push(createSvgElement('circle', { cx: (chimneyX + 3).toFixed(1), cy: (BIOME_ART_HEIGHT - height - 34).toFixed(1), r: randomBetween(random, 6, 11).toFixed(1), fill: colours.feature, opacity: 0.45 }));
        }
        for (let light = 0, total = Math.floor(height / 22); light < total; light++) {
          if (random() < 0.5) continue;
          shapes.push(createSvgElement('rect', { x: (x + randomBetween(random, 3, width - 9)).toFixed(1), y: (BIOME_ART_HEIGHT - height + 6 + light * 20).toFixed(1), width: 4, height: 4, fill: colours.light, opacity: 0.85 }));
        }
        x += width;
      }
      break;
    }
    case 'hive':
      shapes.push(buildRidge(random, colours.far, { baseY: 126, amplitude: 8 }));
      for (let mound = 0, total = count(6, 9); mound < total; mound++) {
        const x = randomBetween(random, -40, BIOME_ART_WIDTH - 20);
        const width = randomBetween(random, 60, 120);
        const height = randomBetween(random, 26, 62);
        shapes.push(createSvgElement('path', { d: `M${x.toFixed(1)},148 Q${(x + width / 2).toFixed(1)},${(148 - height * 2).toFixed(1)} ${(x + width).toFixed(1)},148 Z`, fill: colours.near }));
        shapes.push(createSvgElement('ellipse', { cx: (x + width / 2).toFixed(1), cy: (148 - height * 0.55).toFixed(1), rx: (width / 9).toFixed(1), ry: (height / 8).toFixed(1), fill: colours.feature }));
      }
      break;
    case 'bones':
      shapes.push(buildRidge(random, colours.near, { baseY: 128, amplitude: 10 }));
      for (let rib = 0, total = count(4, 8); rib < total; rib++) {
        const x = randomBetween(random, 20, BIOME_ART_WIDTH - 40);
        const height = randomBetween(random, 20, 40);
        shapes.push(createSvgElement('path', { d: `M${x.toFixed(1)},134 Q${(x + 12).toFixed(1)},${(134 - height).toFixed(1)} ${(x + 26).toFixed(1)},${(134 - height * 0.6).toFixed(1)}`, stroke: colours.feature, 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }));
      }
      break;
    case 'craters':
      shapes.push(buildRidge(random, colours.near, { baseY: 122, amplitude: 8 }));
      for (let crater = 0, total = count(3, 6); crater < total; crater++) {
        const x = randomBetween(random, 20, BIOME_ART_WIDTH - 20);
        const y = randomBetween(random, 128, 142);
        const radius = randomBetween(random, 10, 28);
        shapes.push(createSvgElement('ellipse', { cx: x.toFixed(1), cy: y.toFixed(1), rx: radius.toFixed(1), ry: (radius / 4).toFixed(1), fill: colours.feature, stroke: colours.far, 'stroke-width': 1.5 }));
      }
      break;
    case 'void': {
      const centreX = randomBetween(random, 150, 310);
      shapes.push(createSvgElement('ellipse', { cx: centreX.toFixed(1), cy: 74, rx: 92, ry: 20, fill: 'none', stroke: colours.feature, 'stroke-width': 5, opacity: 0.8 }));
      shapes.push(createSvgElement('circle', { cx: centreX.toFixed(1), cy: 74, r: 28, fill: colours.skyTop, stroke: colours.light, 'stroke-width': 1.5, 'stroke-opacity': 0.6 }));
      break;
    }
    default:   // 'static': a screen with no signal
      for (let band = 0; band < 14; band++) {
        const y = randomBetween(random, 0, BIOME_ART_HEIGHT);
        shapes.push(createSvgElement('rect', { x: 0, y: y.toFixed(1), width: BIOME_ART_WIDTH, height: randomBetween(random, 1, 5).toFixed(1), fill: colours.light, opacity: randomBetween(random, 0.05, 0.2).toFixed(2) }));
      }
  }
  return shapes;
}

// A planet's landscape as an SVG: sky, a sun or stars, far hills, then the
// terrain's own shapes. Labelled for screen readers as an illustration.
function buildBiomeArt(biomeName, planetIndex, recipe = getBiomeArtRecipe(biomeName, planetIndex)) {
  const colours = BIOME_PALETTES[recipe.palette] || BIOME_PALETTES[recipe.terrain] || BIOME_PALETTES.hills;
  const random = createSeededRandom(hashText(`${recipe.terrain}:${recipe.palette}:${planetIndex ?? biomeName}`));
  const gradientId = `biome-sky-${++biomeArtCounter}`;
  const sky = [
    createSvgElement('defs', {}, [createSvgElement('linearGradient', { id: gradientId, x1: 0, y1: 0, x2: 0, y2: 1 }, [
      createSvgElement('stop', { offset: '0%', 'stop-color': colours.skyTop }),
      createSvgElement('stop', { offset: '100%', 'stop-color': colours.skyBottom }),
    ])]),
    createSvgElement('rect', { width: BIOME_ART_WIDTH, height: BIOME_ART_HEIGHT, fill: `url(#${gradientId})` }),
  ];
  if (BIOME_TERRAINS_WITH_STARS.includes(recipe.terrain) || BIOME_TERRAINS_WITH_STARS.includes(recipe.palette)) {
    for (let star = 0; star < 18; star++) {
      sky.push(createSvgElement('circle', { cx: randomBetween(random, 0, BIOME_ART_WIDTH).toFixed(1), cy: randomBetween(random, 0, 80).toFixed(1),
        r: randomBetween(random, 0.6, 1.6).toFixed(1), fill: colours.light, opacity: randomBetween(random, 0.4, 0.9).toFixed(2) }));
    }
  } else if (recipe.terrain !== 'static') {
    sky.push(createSvgElement('circle', { cx: randomBetween(random, 40, 420).toFixed(1), cy: randomBetween(random, 22, 50).toFixed(1),
      r: randomBetween(random, 9, 16).toFixed(1), fill: colours.light, opacity: 0.85 }));
  }
  const hasFarHills = !['void', 'static', 'city', 'factory', 'hive'].includes(recipe.terrain);
  const farHills = hasFarHills
    ? buildRidge(random, colours.far, { baseY: 98, amplitude: recipe.terrain === 'lava' ? 34 : 22, jaggedness: recipe.terrain === 'lava' ? 0.8 : 0.2 })
    : null;
  return createSvgElement('svg', {
    class: `planet-card-biome biome-art biome-${recipe.terrain}`,
    viewBox: `0 0 ${BIOME_ART_WIDTH} ${BIOME_ART_HEIGHT}`,
    preserveAspectRatio: 'xMidYMid slice',
    role: 'img',
    'aria-label': `${biomeName} (drawn illustration)`,
    'data-terrain': recipe.terrain,
    'data-palette': recipe.palette,
  }, [...sky, farHills, ...buildBiomeFeatures(recipe.terrain, colours, random)]);
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

// How fast a planet's liberation (or defense) % is moving, from its samples.
// Returns {status:'gathering'} until the samples span long enough.
function calculatePlanetTrend(samples) {
  const sampleList = asArray(samples);
  if (sampleList.length < 2) return { status: 'gathering', spanMinutes: 0 };

  const latestSample = sampleList[sampleList.length - 1];
  const windowSamples = sampleList.filter(sample =>
    latestSample.timestamp - sample.timestamp <= TREND_WINDOW_MILLISECONDS);
  const earliestSample = windowSamples[0];
  const spanMilliseconds = latestSample.timestamp - earliestSample.timestamp;
  const spanMinutes = spanMilliseconds / 60000;

  if (spanMilliseconds < TREND_MINIMUM_SPAN_MILLISECONDS) return { status: 'gathering', spanMinutes };

  const measuredField = latestSample.defensePercent !== null ? 'defensePercent' : 'liberationPercent';
  if (!isFiniteNumber(earliestSample[measuredField]) || !isFiniteNumber(latestSample[measuredField])) {
    return { status: 'gathering', spanMinutes };
  }

  const percentPerHour =
    (latestSample[measuredField] - earliestSample[measuredField]) / (spanMilliseconds / 3600000);

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

// The measured trend for a planet, straight from apiData's history.
function getPlanetTrend(planet) {
  return calculatePlanetTrend(apiData.planetHistoryByIndex[planet.index]);
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
    outlook.playersNeededToOutpaceRegen = Math.ceil(regenHealthPerHour / outputPerPlayer);
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
    outlook.hoursToLiberation = (100 - outlook.liberationPercent) / trend.percentPerHour;
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

  outlook.projectedPercentAtDeadline = Math.min(100, progressPercent + rate * hoursLeft);
  if (rate > 0) outlook.hoursToWin = (100 - progressPercent) / rate;
  if (rate > 0 && playerCount > 0) {
    outlook.playersNeededToWinInTime = Math.ceil(playerCount * outlook.requiredPercentPerHour / rate);
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
      const planetIndex = getTaskValue(task, TASK_VALUE_TYPE.PLANET_INDEX);
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

// Turns one assignment task into a sentence and a progress figure.
function describeAssignmentTask(task, progressValue) {
  const targetAmount = getTaskValue(task, TASK_VALUE_TYPE.TARGET_AMOUNT);
  const planetIndex  = getTaskValue(task, TASK_VALUE_TYPE.PLANET_INDEX);
  const factionId    = getTaskValue(task, TASK_VALUE_TYPE.FACTION_ID);
  const planet       = isFiniteNumber(planetIndex) ? apiData.planetsByIndex[planetIndex] : null;
  const planetName   = planet ? planet.name : (isFiniteNumber(planetIndex) ? `planet #${planetIndex}` : null);
  const factionName  = isFiniteNumber(factionId) ? (FACTION_NAME_BY_ID[factionId] || null) : null;
  const progress     = isFiniteNumber(progressValue) ? progressValue : 0;

  const description = {
    sentence: '',
    progressPercent: null,
    progressText: '',
    isComplete: false,
    planetIndex: isFiniteNumber(planetIndex) ? planetIndex : null,
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

  if (task.type === TASK_TYPE.ERADICATE) {
    description.sentence = `Kill ${formatBigNumber(targetAmount)} ${factionName || 'enemies'}`
      + (planetName ? ` on ${planetName}` : '');
  } else if (task.type === TASK_TYPE.COMPLETE_OPERATIONS) {
    description.sentence = `Complete ${formatBigNumber(targetAmount)} operations`
      + (factionName ? ` against the ${factionName}` : '')
      + (planetName ? ` on ${planetName}` : '');
  } else {
    // Unknown task type: say what we know without guessing what it means.
    const details = [planetName, factionName].filter(Boolean).join(', ');
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
      return { status: 'neutral', icon: '…', text: 'Measuring progress — needs a few minutes of watching' };
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
        text: `On track — held in about ${formatDuration(outlook.hoursToWin * 3600)}` + (timeLeft ? `, ${timeLeft} before the deadline` : '') };
    case 'at-risk':
      return { status: 'warning', icon: '▲',
        text: outlook.playersNeededToWinInTime
          ? `At risk — needs about ${formatBigNumber(outlook.playersNeededToWinInTime)} Helldivers (has ${formatBigNumber(outlook.playerCount)})`
          : `At risk — needs ${(outlook.requiredPercentPerHour / outlook.ratePercentPerHour).toFixed(1)}× the current pace` };
    case 'losing':
      return { status: 'critical', icon: '✖', text: 'Being lost — no progress against the attack' };
    default:
      return { status: 'neutral', icon: '…',
        text: timeLeft ? `Measuring progress — deadline in ${timeLeft}` : 'Measuring progress' };
  }
}

// An assignment reward → "45 Medals" (type 1 is Medals in the API docs) or just the amount.
function describeReward(reward) {
  if (!isPlainObject(reward) || !isFiniteNumber(reward.amount)) return '';
  return reward.type === 1 ? `${formatBigNumber(reward.amount)} Medals` : formatBigNumber(reward.amount);
}

// ── PLANET CARDS (TASKS 1) ───────────────────────────────────────────────────

// The landscape at the top of a planet card, drawn from its biome.
function buildBiomeBanner(planet) {
  return buildBiomeArt(getBiomeDisplayName(planet), planet.index, getBiomeArtRecipe(planet.biome?.name, planet.index));
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
    renderPlanetJumpOptions,
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
    return buildElement('li', { className: `mo-task${described.isComplete ? ' is-complete' : ''}` }, [
      buildElement('p', { className: 'mo-task-sentence' }, [
        described.isComplete
          ? buildElement('span', { className: 'status-icon', text: '✔', attributes: { 'aria-hidden': 'true' } }) : null,
        buildElement('span', { text: described.sentence }),
      ]),
      described.progressPercent !== null ? buildMeter(described.progressPercent, 'Complete', statusName) : null,
      buildElement('p', { className: 'mo-task-progress',
        text: described.isComplete ? `Done — ${described.progressText}` : described.progressText }),
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
  replaceContent('output-assignments', apiData.assignments.map(assignment => {
    const rows = assignment.tasks.map((task, taskPosition) => {
      const described = describeAssignmentTask(task, assignment.progress[taskPosition]);
      const rawValues = asArray(task.valueTypes)
        .map((valueType, valuePosition) => `${valueType}=${asArray(task.values)[valuePosition]}`).join(' ');
      return [String(taskPosition + 1), described.sentence, String(task.type ?? '—'), rawValues || '—',
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
  }));
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
    : `Updated ${state.dataAgeText}${state.isRefreshing ? ' · refreshing…' : ''}`);
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

// Helldivers on active campaigns per enemy front at every refresh the page
// remembers, summed from the per-planet samples.
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
  const points = asArray(apiData.majorOrderHistory)
    .filter(sample => sample.assignmentId === String(assignment.id))
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
  if (readiness.ready) {
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    series.measuredPercentPerHour = (lastPoint.y - firstPoint.y) / ((lastPoint.x - firstPoint.x) / 3600000);
    if (hoursLeft !== null) {
      series.projectedPercentAtDeadline = Math.max(0, Math.min(100, lastPoint.y + series.measuredPercentPerHour * hoursLeft));
    }
    if (series.measuredPercentPerHour > 0) {
      series.projectedCompletionTimestamp = lastPoint.x + (100 - lastPoint.y) / series.measuredPercentPerHour * 3600000;
    }
  }
  return series;
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
  svg.append(createSvgElement('text', { class: 'chart-axis-label', x: margin.left, y: height - 6 }, [document.createTextNode(formatClockTime(xDomain[0]))]));
  svg.append(createSvgElement('text', { class: 'chart-axis-label', x: width - margin.right, y: height - 6, 'text-anchor': 'end' },
    [document.createTextNode(formatClockTime(xDomain[1]))]));

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
    svg.append(createSvgElement('polyline', {
      class: `chart-line ${line.className}`,
      points: line.points.map(point => `${xOf(point.x)},${yOf(point.y)}`).join(' '),
    }));
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
    readout.textContent = `${formatClockTime(time)} — ${values.join(' · ') || 'no value'}`;
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
    allTimes.map(time => [formatClockTime(time), ...series.map(line => {
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

// Everything the graphs section shows → #output-graphs
function renderTrendGraphs() {
  if (!hasAnyData()) {
    replaceContent('output-graphs', [buildWaitingMessage()]);
    return;
  }
  const blocks = [];

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
      if (!taskSeries.ready) {
        blocks.push(buildMeasuringMessage(taskSeries, `"${taskSeries.sentence}"`));
        return;
      }
      const lastPoint = taskSeries.points[taskSeries.points.length - 1];
      const referenceLines = taskSeries.deadlineTimestamp ? [
        { label: 'Pace needed to finish by the deadline', className: 'reference-needed',
          points: [lastPoint, { x: taskSeries.deadlineTimestamp, y: 100 }] },
        { label: 'Current pace, projected', className: 'reference-projected',
          // stops where it reaches 100% if that happens before the deadline
          points: [lastPoint, taskSeries.projectedCompletionTimestamp !== null && taskSeries.projectedCompletionTimestamp < taskSeries.deadlineTimestamp
            ? { x: taskSeries.projectedCompletionTimestamp, y: 100 }
            : { x: taskSeries.deadlineTimestamp, y: taskSeries.projectedPercentAtDeadline }] },
      ] : [];
      blocks.push(buildLineChart({
        title: taskSeries.sentence,
        series: [{ label: 'Progress', className: 'series-progress', points: taskSeries.points }],
        referenceLines,
        yDomain: [0, 100],
        formatY: value => formatPercent(value),
      }));
      blocks.push(buildElement('p', { className: 'section-hint', text:
        `Measured pace ${formatPercentPerHour(taskSeries.measuredPercentPerHour)}, needed ${formatPercentPerHour(taskSeries.requiredPercentPerHour)}; `
        + `at this pace it reaches about ${formatPercent(taskSeries.projectedPercentAtDeadline, 0)} by the deadline. An estimate from ${Math.round(taskSeries.minutesWatched)} minutes of watching.` }));
    });
  }

  // 2. Helldivers per front over time
  blocks.push(buildElement('h3', { text: 'Helldivers per front' }));
  const fronts = buildFrontPlayerSeries();
  if (!fronts.ready) {
    blocks.push(buildMeasuringMessage(fronts, 'player counts'));
  } else {
    const allPlayerCounts = fronts.series.flatMap(line => line.points.map(point => point.y));
    blocks.push(buildLineChart({
      title: 'Helldivers on active campaigns, per front',
      series: fronts.series.map(line => ({ label: getFactionDisplayName(line.factionKey), className: `series-${line.factionKey}`, points: line.points })),
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
  blocks.push(buildElement('h3', { text: 'Progress on each planet, last 45 minutes' }));
  const planetCharts = [];
  const stillMeasuring = [];
  for (const planetIndex of apiData.indexesOfPlanetsWithActiveBattles) {
    const planet = apiData.planetsByIndex[planetIndex];
    if (!planet) continue;
    const progress = buildPlanetProgressSeries(apiData.planetHistoryByIndex[planetIndex]);
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
  putTextInElement('map-planet-info', `${describeMapPlanet(planet)}. Press Enter or click to open its details.`);
  for (const marker of document.querySelectorAll('#output-war-map .map-planet.is-selected')) marker.classList.remove('is-selected');
  const marker = document.querySelector(`#output-war-map .map-planet[data-planet-index="${planetIndex}"]`);
  if (marker) marker.classList.add('is-selected');
}

// Keyboard on a focused planet: Enter/Space jump, arrows move to a neighbour.
function handleMapKeydown(event) {
  const marker = event.target.closest && event.target.closest('.map-planet');
  if (!marker) return;
  const planetIndex = Number(marker.dataset.planetIndex);
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    jumpToPlanet(planetIndex);
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
    'aria-label': 'Galactic war map. Tab moves between planets being fought over; arrow keys move to the nearest planet in that direction; Enter opens a planet\'s details.',
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
    if (marker) jumpToPlanet(Number(marker.dataset.planetIndex));
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
    buildElement('p', { className: 'map-info', text: 'Hover or focus a planet for its numbers; click or press Enter to open its details.',
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

// A button that takes you to a planet's card or table row in advanced mode.
function buildPlanetJumpButton(planet) {
  return buildElement('button', { className: 'link-button', text: planet.name,
    attributes: { type: 'button', 'data-jump-planet': planet.index, 'aria-label': `${planet.name}: show its details` } });
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

// Clicks inside the gambit panel: a planet name jumps to that planet, and an
// Ask button requests the optional AI summary for its front.
function handleGambitPanelClick(event) {
  const jumpButton = event.target.closest && event.target.closest('[data-jump-planet]');
  if (jumpButton) jumpToPlanet(Number(jumpButton.dataset.jumpPlanet));
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
const LLM_TIMEOUT_MILLISECONDS = 45000;               // model replies are slower than war feeds
const LLM_PROMPT_CANDIDATE_LIMIT = 6;
const LLM_REPLY_CHARACTER_LIMIT = 2000;

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

  // URL and fetch options for one prompt. The key goes in a header, not the
  // URL, so it can't end up in logs or the browser history.
  buildRequest(apiKey, model, systemText, userText) {
    return {
      url: `${this.origin}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText }] },
          contents: [{ role: 'user', parts: [{ text: userText }] }],
          // room for the model's own thinking plus a short answer
          generationConfig: { maxOutputTokens: 4096 },
        }),
      },
    };
  },

  // The reply's text from a successful response body; throws with the reason otherwise.
  readReply(body) {
    const blockReason = body?.promptFeedback?.blockReason;
    if (blockReason) throw new Error(`Gemini declined to answer (${blockReason}).`);
    const candidate = asArray(body?.candidates)[0];
    const text = asArray(candidate?.content?.parts)
      .filter(part => typeof part?.text === 'string' && !part.thought)
      .map(part => part.text).join('').trim();
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

// Sends one prompt to the provider and returns the reply text. The request
// goes to LLM_PROVIDER.origin only, and times out rather than hang.
async function askLlm(apiKey, model, prompt) {
  const request = LLM_PROVIDER.buildRequest(apiKey, model, prompt.systemText, prompt.userText);
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
  if (!response.ok) throw new Error(LLM_PROVIDER.describeFailure(response.status, body, model));
  return LLM_PROVIDER.readReply(body);
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
    return finish({ status: 'done', text });
  } catch (error) {
    return finish({ status: 'failed', errorMessage: error.message || 'Unknown error.' });
  }
}

// The AI part of one front's panel: an Ask button when a key is saved, then
// the labelled reply or the reason it failed. Nothing at all without a key.
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

  let result = null;
  if (entry?.status === 'done') {
    result = buildElement('aside', { className: 'llm-commentary', attributes: { 'aria-label': 'AI-written summary' } }, [
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
  return buildElement('div', { className: 'llm-block' }, [askButton, result]);
}

// Shows whether a key is saved (never the key itself, only its last 4 characters).
function describeLlmSettings() {
  const { apiKey, model } = readLlmSettings();
  return apiKey
    ? `Key saved in this browser (ending …${apiKey.slice(-4)}), model ${model}. Ask buttons are on each front.`
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

// Once a second: updates the countdown and the data age, and refreshes when due.
function tickCountdown() {
  if (getSecondsUntilNextRefresh() <= 0 && !refreshInProgress) refreshEverythingNow();
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

  applySiteEmblem();
  wireAdvancedNavigation();
  wireLlmSettings();
  applyDonationLink();
  applyViewMode();
  renderGuide();
  renderEverything();
  scheduleNextRefresh();
  refreshEverythingNow();
  startCountdownTimer();
}

document.addEventListener('DOMContentLoaded', startApp);

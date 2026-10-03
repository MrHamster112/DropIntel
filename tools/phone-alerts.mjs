// Phone alerts with the page closed: after each reading the collector (tools/collect-history.mjs)
// posts the war's new events to a public ntfy.sh topic, so anyone with the free ntfy app (Android,
// iPhone) or ntfy.sh open in a browser gets them. Plain Node 22, no packages. The workflow sets:
//   NTFY_TOPIC   the topic (empty: "dropintel"; "off" sends nothing)
//   NTFY_SERVER  the server (empty: https://ntfy.sh)
//   NTFY_TOKEN   an access token, only needed once the topic is reserved so that only DropIntel can
//                post to it (on ntfy.sh's free plan anyone who knows a topic can post to it)
// A failed post only warns: an alert is never worth a failed reading.

export const DEFAULT_NTFY_SERVER = 'https://ntfy.sh';
export const DEFAULT_NTFY_TOPIC = 'dropintel';
export const PUBLIC_PAGE_ADDRESS = 'https://mrhamster112.github.io/DropIntel/';
const ALERT_ICON_ADDRESS = `${PUBLIC_PAGE_ADDRESS}images/app-icons/icon-192.png`;
// More changes than this in one reading (the collector was away for a while) become one summary,
// so a phone never gets a burst.
export const MAX_ALERTS_PER_READING = 5;
const POST_TIMEOUT_MILLISECONDS = 10000;
// ntfy's own rule for topic names
const TOPIC_PATTERN = /^[-_A-Za-z0-9]{1,64}$/;
// ntfy refuses longer messages (4,096 bytes); the summary stays well under that
const SUMMARY_MAX_CHARACTERS = 3000;

// How each event reads on a phone. ntfy's priorities run 1 (min) to 5 (max), 3 being the default:
// High (4) is what needs players now, so a subscriber who sets the app's minimum to High gets only
// new orders and attacks. The tag is an emoji shortcode, which ntfy shows as the emoji.
export const PHONE_ALERT_STYLE_BY_EVENT_TYPE = {
  newOrder: { priority: 4, tag: 'scroll', title: () => 'New Major Order' },
  attack: { priority: 4, tag: 'rotating_light', title: (name) => `${name} is under attack` },
  defenseFailed: { priority: 3, tag: 'skull', title: (name) => `${name} fell` },
  defenseWon: { priority: 3, tag: 'shield', title: (name) => `${name} held` },
  lost: { priority: 3, tag: 'x', title: (name) => `${name} was lost` },
  liberated: { priority: 3, tag: 'tada', title: (name) => `${name} was liberated` },
  dssMoved: { priority: 2, tag: 'artificial_satellite', title: () => 'The Democracy Space Station moved' },
  newWar: { priority: 4, tag: 'globe_with_meridians', title: () => 'A new Galactic War began' },
};

// The topic, server and token from the workflow's environment, with the defaults. topic is null
// when alerts are off.
export function readPhoneAlertSettings(environment = process.env) {
  const topic = String(environment.NTFY_TOPIC || '').trim() || DEFAULT_NTFY_TOPIC;
  const server = (String(environment.NTFY_SERVER || '').trim() || DEFAULT_NTFY_SERVER).replace(/\/+$/, '');
  const token = String(environment.NTFY_TOKEN || '').trim() || null;
  return { topic: topic.toLowerCase() === 'off' ? null : topic, server, token };
}

// "about 23 hours", "about 40 minutes": how long until a moment, for a message.
function describeTimeLeft(seconds) {
  if (seconds < 3600) return `about ${Math.max(1, Math.round(seconds / 60))} minutes`;
  const hours = Math.round(seconds / 3600);
  return hours === 1 ? 'about 1 hour' : `about ${hours} hours`;
}

// The message under the title: the event as the war record says it, plus the defense's deadline for
// an attack when the reading has it.
function describeAlertMessage(event, battles) {
  if (event.type === 'newOrder') return event.text.replace(/^New Major Order:\s*/, '') || event.text;
  if (event.type === 'attack') {
    const defense = battles.find((battle) => battle.index === event.planet && battle.kind === 'defense');
    const secondsLeft = defense && Number.isFinite(defense.endsAt) ? defense.endsAt - event.time : null;
    if (secondsLeft !== null && secondsLeft > 0) return `${event.text} The defense ends in ${describeTimeLeft(secondsLeft)}.`;
  }
  return event.text;
}

// One reading's events as ntfy messages: a title, the message, an emoji and the enemy as tags, a
// priority, and a tap that opens the page (on the planet when there is one). nameOfPlanet(index)
// gives a planet's name; battles are the reading's battles (for a defense's deadline).
export function buildPhoneAlerts(events, { nameOfPlanet = (index) => `Planet ${index}`, battles = [] } = {}) {
  const alerts = [];
  for (const event of events) {
    const style = PHONE_ALERT_STYLE_BY_EVENT_TYPE[event.type];
    if (!style) continue;
    const hasPlanet = Number.isInteger(event.planet);
    alerts.push({
      title: style.title(hasPlanet ? nameOfPlanet(event.planet) : ''),
      message: describeAlertMessage(event, battles),
      tags: event.faction ? [style.tag, event.faction] : [style.tag],
      priority: style.priority,
      click: hasPlanet ? `${PUBLIC_PAGE_ADDRESS}#planet=${event.planet}` : PUBLIC_PAGE_ADDRESS,
      icon: ALERT_ICON_ADDRESS,
    });
  }
  if (alerts.length <= MAX_ALERTS_PER_READING) return alerts;
  // The most urgent first (a stable sort keeps the record's order within a priority), then one
  // summary of the rest.
  const byUrgency = [...alerts].sort((first, second) => second.priority - first.priority);
  const kept = byUrgency.slice(0, MAX_ALERTS_PER_READING - 1);
  const rest = byUrgency.slice(MAX_ALERTS_PER_READING - 1);
  let message = '';
  for (const alert of rest) {
    const line = `${alert.title}: ${alert.message}`;
    if (message.length + line.length + 1 > SUMMARY_MAX_CHARACTERS) {
      message += `${message ? '\n' : ''}…`;
      break;
    }
    message += `${message ? '\n' : ''}${line}`;
  }
  kept.push({
    title: `${rest.length} more changes in the war`,
    message,
    tags: ['newspaper'],
    priority: Math.max(...rest.map((alert) => alert.priority)),
    click: PUBLIC_PAGE_ADDRESS,
    icon: ALERT_ICON_ADDRESS,
  });
  return kept;
}

// Posts the alerts one by one (ntfy's JSON publishing: the topic goes in the body). Stops at the
// first failure, since the server is then most likely down; never throws. Returns how many were sent
// and what went wrong.
export async function sendPhoneAlerts(alerts, { topic, server = DEFAULT_NTFY_SERVER, token = null, fetchImpl = fetch } = {}) {
  const problems = [];
  if (!topic || alerts.length === 0) return { sent: 0, problems };
  if (!TOPIC_PATTERN.test(topic)) {
    problems.push(`"${topic}" is not an ntfy topic name (letters, digits, - and _ only, 64 at most).`);
    return { sent: 0, problems };
  }
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let sent = 0;
  for (const alert of alerts) {
    try {
      const response = await fetchImpl(`${server}/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ topic, ...alert }),
        signal: AbortSignal.timeout(POST_TIMEOUT_MILLISECONDS),
      });
      if (!response.ok) {
        problems.push(`${server} answered ${response.status} for "${alert.title}".`);
        break;
      }
      sent += 1;
    } catch (error) {
      problems.push(`${server} could not be reached for "${alert.title}": ${error.message}`);
      break;
    }
  }
  return { sent, problems };
}

// DropIntel's service worker. It is what lets Chrome and Edge install the page as an app
// (home screen on Android, Start menu and taskbar on Windows) and start it without a connection.
//
// It only handles the page's own files, and always asks the network first, so a new version
// shows as soon as it is published; the cached copy is only for when the network fails. The war
// feeds, the shared history and Gemini are other hosts and pass straight through: the page keeps
// its own saved copy of the war (hd2_last_snapshot). Nothing here runs with the page closed (no
// push alerts). Opened from disk (file://), the page doesn't register it at all.
'use strict';

const PAGE_CACHE_NAME = 'dropintel-page-v1';

// Stored at install, so the installed app can start offline even before these were reloaded.
// Everything else the page loads from its own folder (the faction logos) is kept on first use.
const PAGE_FILES = [
  './',
  'style.css',
  'guide-data.js',
  'major-order-fixes.js',
  'galactic-campaigns.js',
  'script.js',
  'manifest.webmanifest',
  'images/app-icons/icon-192.png',
  'images/faction-icons-drawn/Super%20Earth.svg',
];

// Install: keep a copy of the page. A file that fails is skipped rather than failing the install.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PAGE_CACHE_NAME)
      .then((cache) => Promise.all(PAGE_FILES.map((path) => cache.add(path).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

// Activate: drop caches from older versions of this file and take over open pages at once.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== PAGE_CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

// Fetch: the page's own files, network first. Other hosts and other sites on the same host
// (github.io serves every project from one origin) are left alone.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  event.respondWith(fetchNetworkFirst(event));
});

// Answers from the network and refreshes the copy; without a network, from the copy (an
// opened page falls back to the stored front page, so links like #planet=… still start).
async function fetchNetworkFirst(event) {
  const request = event.request;
  const cache = await caches.open(PAGE_CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') event.waitUntil(cache.put(request, response.clone()));
    return response;
  } catch (error) {
    const stored = await cache.match(request, { ignoreSearch: true })
      || (request.mode === 'navigate' ? await cache.match('./') : undefined);
    if (stored) return stored;
    throw error;
  }
}

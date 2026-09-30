# DropIntel

By [MrHamster112](https://github.com/MrHamster112).

A fan-made war tracker for Helldivers 2: the Major Order, planets under attack, where to drop
next, a galactic war map, gambit analysis per front and a field guide.

## Use it

- **Online:** https://mrhamster112.github.io/DropIntel/
- **On your own computer:** [download DropIntel (ZIP)](https://github.com/MrHamster112/DropIntel/archive/refs/heads/main.zip),
  unzip it and double-click `index.html`. Nothing to install. The live war data needs an internet
  connection; the field guide works without one. The Major Order in a downloaded copy can be
  worded wrong (see below).

The page refreshes itself every minute while you look at it (a tab in the background waits,
unless alerts are on), and on your next visit it shows the last war status it saw straight away,
labelled with its age, while it loads the new one. Settings (view mode, folded sections, your
front, watched planets, alerts, and an optional Google Gemini key for AI summaries) and that
saved war status are kept only in your own browser. Alerts are off until you turn them on in Settings, and only work while the page is open. Links can point
at a planet, for example `https://mrhamster112.github.io/DropIntel/#planet=Heeth`.

## Install it as an app

On Android and Windows, DropIntel can be installed like an app from Chrome or Edge: it goes on
your home screen, or in the Start menu and taskbar, and opens in its own window. Open
https://mrhamster112.github.io/DropIntel/, then use the browser's install icon in the address
bar or its menu ("Install app" or "Add to Home screen"), or the Install button in the page's
Settings. It is the same page, with nothing else to download, and it can start without a
connection, showing the last war status it saw. On an iPhone, use Safari's Share button, then
"Add to Home Screen". A downloaded ZIP copy can't be installed.

## War history

Every 15 minutes a GitHub Action in this repository records the war (planet progress, players
per front, Major Order progress and events such as planets liberated or lost) into
`history.json` on the [`war-history`](https://github.com/MrHamster112/DropIntel/tree/war-history)
branch. It keeps two weeks. The page loads it, so trends, ETAs and graphs (up to 7 days) work
from the first minute instead of after a few minutes of watching.

## Support

DropIntel is free and has no ads. If it helps you between missions, you can buy me a coffee:
https://buycoffee.to/dropintel

## Made with AI help

DropIntel is made by MrHamster112 with help from AI: most of the code and text were written with
Claude, an AI assistant made by Anthropic.

## Credits

Unofficial fan project, not affiliated with or endorsed by Arrowhead Game Studios or Sony
Interactive Entertainment. HELLDIVERS™ 2 is their trademark. The planet landscapes are drawn by
the page itself. Faction logos © Arrowhead Game Studios, as traced by Helldivers Wiki contributors.
War data from the community APIs at api.helldivers2.dev and helldiverstrainingmanual.com, and
from this repository's own war history.

## Major Orders can be wrong

The page works out Major Order tasks by itself from the game's data. It names the enemy faction
("Kill 25.00M Terminids"), not the exact enemy the game names, so a task can be worded less
exactly or wrong. When the game names one kind of enemy, the page adds "(exact enemy not
identified)". The online version is corrected by hand in `major-order-fixes.js` in this
repository (open it on GitHub and press the pencil; the file explains how). **A downloaded
(offline) copy only has the corrections made before you downloaded it**, so its Major Order
can be wrong: check the game, or use the online version.
